"""Native, offline read/write/edit/shell/SSE/export contract. No provider calls.

Place beside the external native adapter; set NATIVE_BENCH_KIND=deepswe|wb.
No benchmark answers or hidden test implementations are read by this fixture.
"""
import asyncio
import hashlib
import http.server
import json
import os
import socketserver
import threading
from pathlib import Path
from types import SimpleNamespace
import tea_adapter
from inference_relay import normalize

KIND = os.environ['NATIVE_BENCH_KIND']
NAME = Path(__file__).parent.name
PREFLIGHT_ID = os.environ.get('NATIVE_PREFLIGHT_ID', 'v1')
B = tea_adapter.BASE
if KIND == 'deepswe':
    from pier.models.trial.config import TrialConfig, TaskConfig, AgentConfig, EnvironmentConfig
    from pier.trial.trial import Trial
else:
    from harbor.models.trial.config import TrialConfig, TaskConfig, AgentConfig, EnvironmentConfig, VerifierConfig
    from harbor.trial.trial import Trial

relay = SimpleNamespace(calls=0, active=False, accounted=0, requestBytes=[], hashes=[], controls=[], arm=None)
tea_adapter.RELAY = relay
python = 'print("fixture-cli-ok")\n'
source = 'export const value = 1;\n' + '// resident source detail\n' * 200
cli_command = 'python -m tea_preflight_cli' if KIND == 'deepswe' else 'python tea_preflight_cli.py'
args = "['-m','tea_preflight_cli']" if KIND == 'deepswe' else "['tea_preflight_cli.py']"
node = "import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {value} from './tea-resident.mjs';test('cli',()=>assert.equal(execFileSync('python'," + args + ",{encoding:'utf8'}).trim(),'fixture-cli-ok'));test('value',()=>assert.equal(value,2));\n"


def steps(arm):
    values = [('write_file', {'path': 'tea_preflight_cli.py', 'content': python}), ('run_shell', {'command': cli_command}),
              ('write_file', {'path': 'tea-resident.mjs', 'content': source}), ('write_file', {'path': 'tea-preflight.test.mjs', 'content': node}),
              ('read_file', {'path': 'tea-resident.mjs'}), ('apply_patch', {'path': 'tea-resident.mjs', 'search': 'value = 1', 'replace': 'value = 2'}),
              ('read_file', {'path': 'tea-resident.mjs'}), ('read_file', {'path': 'tea-resident.mjs'}), ('run_tests', {'command': 'node --test tea-preflight.test.mjs'}), None]
    if arm == 'pi':
        values = [(dict(write_file='write', run_shell='bash', read_file='read', apply_patch='edit', run_tests='bash')[name],
                   {'path': data['path'], 'oldText': data['search'], 'newText': data['replace']} if name == 'apply_patch' else data)
                  if step is not None else None for step in values for name, data in ([step] if step else [(None, None)])]
    return values


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        _, native, controls, _ = normalize(body)
        assert controls['thinking'] == {'type': 'enabled', 'budget_tokens': min(8000, controls['max_tokens'] - 1)}
        relay.requestBytes.append(len(body)); relay.hashes.append(hashlib.sha256(body).hexdigest()); relay.controls.append(native)
        sequence = steps(relay.arm)
        assert relay.active and relay.calls < len(sequence)
        step = sequence[relay.calls]; relay.calls += 1
        def event(kind, value):
            return ('event: ' + kind + '\ndata: ' + json.dumps({'type':kind, **value}) + '\n\n').encode()
        data = event('message_start', {'message': {'id': 'fixture-' + str(relay.calls), 'type': 'message', 'role': 'assistant', 'model': 'glm-5.3-flash',
                    'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 7, 'output_tokens': 0, 'cache_read_input_tokens': 0, 'cache_creation_input_tokens': 0}}})
        if step:
            name, args = step
            data += event('content_block_start', {'index': 0, 'content_block': {'type': 'tool_use', 'id': 'fixture-' + str(relay.calls), 'name': name, 'input': {}}})
            data += event('content_block_delta', {'index': 0, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(args)}})
        else:
            data += event('content_block_start', {'index': 0, 'content_block': {'type': 'text', 'text': ''}})
            data += event('content_block_delta', {'index': 0, 'delta': {'type': 'text_delta', 'text': 'Fixture validated.'}})
        data += event('content_block_stop', {'index': 0}) + event('message_delta', {'delta': {'stop_reason': 'tool_use' if step else 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 3}}) + event('message_stop', {})
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        for i in range(0, len(data), 31):
            self.wfile.write(data[i:i+31]); self.wfile.flush()


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def config(arm, suffix):
    protocol = json.loads((B/'adapters'/NAME/'protocol.json').read_text())
    task = protocol['tasks'][0]['id']
    if KIND == 'deepswe':
        return TrialConfig(task=TaskConfig(path=B/'sources/deep-swe/tasks'/task), trial_name=NAME+'-'+arm+'-'+suffix+'-'+PREFLIGHT_ID,
                          trials_dir=B/'results'/(NAME+'-preflight-'+PREFLIGHT_ID), agent=AgentConfig(import_path='tea_adapter:TeaAgent', model_name='synthetic-sse-fixture'),
                          environment=EnvironmentConfig(import_path='tea_adapter:TeaEnvironment', delete=False))
    return TrialConfig(task=TaskConfig(path=B/'framework/datasets/wb-bench-code-v1.0/tasks'/task), trial_name=task+'__fixture-'+arm+'-'+suffix+'-'+PREFLIGHT_ID,
                       trials_dir=B/'results'/(NAME+'-preflight-'+PREFLIGHT_ID), agent=AgentConfig(import_path='tea_adapter:TeaAgent', model_name='synthetic-sse-fixture'),
                       environment=EnvironmentConfig(import_path='tea_adapter:TeaEnvironment', delete=False, extra_docker_compose=[B/'adapters'/NAME/'docker-compat.yaml'],
                       mounts=[{'type':'bind','source':str(B/'runtime'/('inference-'+NAME)), 'target':'/tea-relay','read_only':True}]),
                       verifier=VerifierConfig(import_path='workbuddy_bench.judge:CompositeVerifier'))


async def check(arm):
    tea_adapter.ARM = arm; relay.arm = arm; relay.calls = 0; relay.hashes = []; relay.requestBytes = []; relay.controls = []
    trial = await Trial.create(config(arm, 'agent'))
    if KIND == 'wb':
        trial.task.config.agent.user = 'dev'; trial.task.config.verifier.user = 'root'
    env = trial._environment if KIND == 'deepswe' else trial.agent_environment
    agent = trial._agent if KIND == 'deepswe' else trial.agent
    workspace = '/app' if KIND == 'deepswe' else '/workspace'
    other = None
    try:
        await env.start(force_build=False)
        if KIND == 'wb':
            with env.with_default_user('dev'):
                await agent.setup(env)
        else:
            await agent.setup(env)
        ignore = await env.exec("printf '\n__pycache__/\n' >> .git/info/exclude", cwd=workspace, timeout_sec=10)
        assert ignore.return_code == 0
        if KIND == 'deepswe' and arm == 'tea':
            profile = json.loads((agent.logs_dir/'command-policy.json').read_text()); profile['cliModules'] = ['tea_preflight_cli']
            pp = agent.logs_dir/'command-policy.json'; pp.write_text(json.dumps(profile)); await env.upload_file(pp, '/opt/tea/command-policy.json')
        if KIND == 'wb':
            with env.with_default_user('dev'):
                await asyncio.wait_for(agent.run('Self-authored infrastructure fixture: edit a module, execute CLI and validate.', env, SimpleNamespace()), 240)
        else:
            await asyncio.wait_for(agent.run('Self-authored infrastructure fixture: edit a module, execute CLI and validate.', env, SimpleNamespace()), 240)
        result = json.loads((agent.logs_dir/('tea-result.json' if arm == 'tea' else 'pi-result.json')).read_text())
        assert result['status'] == 'completed', result
        assert relay.calls == 10, relay.calls
        if arm == 'tea':
            ledger = [json.loads(x) for x in (agent.logs_dir/'ledger/ledger.jsonl').read_text().splitlines()]
            audits = [x for x in ledger if x.get('type') == 'model_request']
            assert result['validationPassed'] and result['summary']['providerUsageComplete']
        else:
            audits = [json.loads(x) for x in (agent.logs_dir/'pi-requests.jsonl').read_text().splitlines()]
            assert result['providerUsageComplete'] and result['totalTokens'] == 100
        assert len(audits) == 10 and [x['requestSha256'] for x in audits] == relay.hashes
        assert all(x['usageComplete'] for x in audits)
        verified = await env.exec('node --test tea-preflight.test.mjs', cwd=workspace, timeout_sec=60)
        assert verified.return_code == 0
        patch_sha = None
        if KIND == 'deepswe':
            artifacts = agent.logs_dir.parent/'artifacts/tea-export'; manifest = json.loads((artifacts/'manifest.json').read_text())
            assert manifest['changedFiles'] == ['tea-preflight.test.mjs', 'tea-resident.mjs', 'tea_preflight_cli.py']
            other_trial = await Trial.create(config(arm, 'verifier')); other = other_trial._environment; await other.start(force_build=False)
            await other.upload_file(artifacts/'model.patch', '/tmp/fixture.patch')
            verified = await other.exec('git apply /tmp/fixture.patch && node --test tea-preflight.test.mjs', cwd='/app', timeout_sec=60)
            assert verified.return_code == 0
            patch_sha = manifest['patchSha256']
        return {'arm': arm, 'status': 'passed', 'providerCalls': 0, 'syntheticResponses': relay.calls,
                'realToolsExecuted': result['toolCalls'], 'requestHashesReconciled': True, 'usageComplete': True,
                'firstNativeControls': relay.controls[0], 'fixtureValidationPassed': True,
                'independentPatchValidationPassed': KIND == 'deepswe', 'patchSha256': patch_sha}
    finally:
        if other:
            await other.stop(delete=False)
        await env.stop(delete=False)


async def main():
    socket = B/'runtime'/('inference-'+NAME)/'api.sock'; socket.parent.mkdir(parents=True, exist_ok=True)
    if socket.exists(): socket.unlink()
    server = Server(str(socket), Handler); os.chmod(socket, 0o666)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        rows = [await check(arm) for arm in ['tea', 'pi']]
        if KIND == 'deepswe': assert rows[0]['patchSha256'] == rows[1]['patchSha256']
        result = {'status':'passed','selfAuthoredFixture':True,'notOfficialTaskAcceptance':True,'providerCalls':0,'arms':rows}
        (B/'results'/(NAME+'-preflight.json')).write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))
    finally:
        server.shutdown(); server.server_close()


asyncio.run(main())
