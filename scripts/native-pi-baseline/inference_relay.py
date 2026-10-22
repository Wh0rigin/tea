"""Budgeted Unix inference relay shared by native clients; credentials in memory.

Only common model controls are normalized. Prompts, messages and tools are not
rewritten. Client/provider hashes, rejected unsubmitted requests and complete
provider usage are separate. This module never starts a provider call on import.
"""
import codecs
import hashlib
import http.client
import http.server
import json
import os
import socketserver
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(data):
    body = json.loads(data)
    if body.get('model') != 'glm-5.3-flash' or body.get('stream') is not True:
        raise ValueError('Unexpected model/stream profile')
    maximum = body.get('max_tokens')
    if type(maximum) is not int or not 1 < maximum <= 131072:
        raise ValueError('Unexpected output ceiling')
    keys = ['model', 'max_tokens', 'thinking', 'output_config', 'stream']
    original = {key: body.get(key) for key in keys}
    payload = {k: v for k, v in body.items() if k not in keys}
    payload_hash = digest(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode())
    body['thinking'] = {'type': 'enabled', 'budget_tokens': min(8000, maximum - 1)}
    body['output_config'] = {**(body.get('output_config') or {}), 'effort': 'low'}
    forwarded = json.dumps(body, separators=(',', ':'), ensure_ascii=False).encode()
    assert payload == {k: v for k, v in json.loads(forwarded).items() if k not in keys}
    return forwarded, original, {key: body.get(key) for key in keys}, payload_hash


class StreamAudit:
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder('utf8')()
        self.pending = ''; self.data = []; self.stop = False; self.invalid = False; self.usage = {}

    def dispatch(self):
        if not self.data:
            return
        try:
            body = json.loads('\n'.join(self.data))
            if body.get('type') == 'message_stop':
                self.stop = True
            usage = (body.get('message', {}).get('usage') if body.get('type') == 'message_start' else body.get('usage')) or {}
            for key in ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']:
                if key in usage:
                    if type(usage[key]) is int and usage[key] >= 0:
                        self.usage[key] = usage[key]
                    else:
                        self.invalid = True
        except (ValueError, AttributeError, TypeError):
            self.invalid = True
        self.data = []

    def line(self, line):
        line = line.removesuffix('\r')
        if not line:
            self.dispatch()
        elif line.startswith('data:'):
            self.data.append(line[5:].removeprefix(' '))

    def feed(self, data):
        self.pending += self.decoder.decode(data)
        while '\n' in self.pending:
            line, self.pending = self.pending.split('\n', 1)
            self.line(line)
        if len(self.pending) > 2097152:
            self.invalid = True; self.pending = ''

    def finish(self):
        self.pending += self.decoder.decode(b'', final=True)
        if self.pending:
            self.line(self.pending)
        self.dispatch()
        return {'usage': self.usage, 'messageStopSeen': self.stop, 'auditInvalid': self.invalid,
                'usageComplete': self.stop and not self.invalid and all(type(self.usage.get(k)) is int for k in ['input_tokens', 'output_tokens'])}


class Relay:
    def __init__(self, credentials, *, socket_path, audit_path):
        self.key = credentials['apiKey']; self.url = urlsplit(credentials['baseUrl'])
        assert self.url.scheme == 'https' and not self.url.username and not self.url.query and not self.url.fragment
        self.path = self.url.path.rstrip('/') + '/v1/messages'
        self.socket_path = Path(socket_path); self.audit_path = Path(audit_path)
        self.lock = threading.Lock(); self.idle = threading.Event(); self.idle.set()
        self.active = False; self.trial = None; self.calls = 0; self.submitted_calls = 0
        self.accounted = 0.; self.reserved = 0.; self.unknown = False; self.inflight = 0; self.rows = []

    def begin_trial(self, trial):
        assert self.idle.is_set()
        with self.lock:
            self.trial = trial; self.calls = 0; self.submitted_calls = 0
            self.accounted = 0.; self.reserved = 0.; self.unknown = False; self.rows = []; self.active = False

    def start(self):
        relay = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    self.send_error(400); return
                api_path = urlsplit(self.path)
                if api_path.path != '/v1/messages' or api_path.query not in ['', 'beta=true'] or not 0 < size <= 2097152:
                    self.send_error(400); return
                data = self.rfile.read(size)
                try:
                    forwarded, original, controls, payload_hash = normalize(data)
                except (ValueError, TypeError):
                    self.send_error(400); return
                # UTF-8 byte count is a conservative tokenizer upper-bound for
                # this control allocation, charged at the higher input/cache rate.
                reserve = len(forwarded) * 1.6 / 1e6 + controls['max_tokens'] * 2.8 / 1e6
                with relay.lock:
                    relay.calls += 1
                    row = {'trial': relay.trial, 'call': relay.calls, 'requestSha256': digest(data),
                           'providerRequestSha256': digest(forwarded), 'requestBytes': len(data),
                           'providerRequestBytes': len(forwarded), 'nativeControls': original,
                           'controls': controls, 'nonControlPayloadSha256': payload_hash,
                           'nonControlPayloadUnchanged': True, 'apiQuery': api_path.query,
                           'anthropicBeta': self.headers.get('anthropic-beta'), 'timestamp': time.time()}
                    guard = ('inactive_or_unknown_usage' if not relay.active or relay.unknown else
                             'request_limit' if relay.submitted_calls >= 128 else
                             'cost_reservation_limit' if relay.accounted + relay.reserved + reserve > 10 else None)
                    if guard:
                        row.update(submitted=False, guard=guard, usage=None, usageComplete=None,
                                   knownNotSubmitted=True, status='guard_rejected')
                        relay.rows.append(row)
                        with relay.audit_path.open('a') as f:
                            f.write(json.dumps(row) + '\n')
                    else:
                        relay.submitted_calls += 1; relay.inflight += 1; relay.idle.clear(); relay.reserved += reserve
                if guard:
                    self.send_response(403); self.send_header('Content-Type', 'application/json')
                    self.send_header('X-Benchmark-Submitted', 'false'); self.end_headers()
                    self.wfile.write(json.dumps({'type': 'error', 'error': {'type': 'benchmark_guard', 'message': guard}}).encode()); return
                started = time.monotonic(); audit = StreamAudit(); conn = None; status = 'transport_not_started'; http_status = None
                try:
                    conn = http.client.HTTPSConnection(relay.url.hostname, relay.url.port or 443, timeout=915)
                    headers = {'Content-Type': 'application/json', 'anthropic-version': self.headers.get('anthropic-version', '2023-06-01'), 'x-api-key': relay.key}
                    if self.headers.get('anthropic-beta'):
                        headers['anthropic-beta'] = self.headers['anthropic-beta']
                    # SDK beta=true routing is canonicalized to the same existing
                    # Messages endpoint used by both clients; beta headers remain.
                    conn.request('POST', relay.path, body=forwarded, headers=headers)
                    incoming = conn.getresponse(); http_status = incoming.status
                    self.send_response(incoming.status); self.send_header('Content-Type', incoming.getheader('Content-Type', 'application/json'))
                    self.send_header('X-Benchmark-Submitted', 'true'); self.end_headers()
                    while chunk := incoming.read1(65536):
                        audit.feed(chunk); self.wfile.write(chunk); self.wfile.flush()
                    status = 'transport_finished'
                except Exception as error:
                    status = 'transport_failed:' + type(error).__name__
                finally:
                    if conn:
                        conn.close()
                    try:
                        result = audit.finish()
                    except Exception:
                        result = {'usageComplete': False, 'usage': {}, 'auditInvalid': True, 'messageStopSeen': False}
                    row.update(submitted=True, status=status, httpStatus=http_status,
                               elapsedMs=round(1000 * (time.monotonic() - started)), **result)
                    with relay.lock:
                        relay.reserved -= reserve
                        if result['usageComplete']:
                            u = result['usage']
                            row['controlCostEstimateUsd'] = (.8 * (u['input_tokens'] + u.get('cache_read_input_tokens', 0)) + 1.6 * u.get('cache_creation_input_tokens', 0) + 2.8 * u['output_tokens']) / 1e6
                            relay.accounted += row['controlCostEstimateUsd']
                        else:
                            relay.unknown = True; relay.active = False
                        relay.rows.append(row)
                        with relay.audit_path.open('a') as f:
                            f.write(json.dumps(row) + '\n')
                        relay.inflight -= 1
                        if not relay.inflight:
                            relay.idle.set()

        class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
            daemon_threads = True
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        if self.socket_path.exists():
            self.socket_path.unlink()
        self.server = Server(str(self.socket_path), Handler)
        os.chmod(self.socket_path, 0o666)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.active = False; self.server.shutdown(); self.server.server_close()
