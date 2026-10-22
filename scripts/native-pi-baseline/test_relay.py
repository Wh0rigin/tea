"""Offline relay invariants. Fake HTTPS only; no provider or credential access."""
import http.client
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from inference_relay import Relay, StreamAudit, normalize


def stream(stop=True):
    events = [{'type':'message_start','message':{'usage':{'input_tokens':7,'output_tokens':0,'cache_read_input_tokens':4,'cache_creation_input_tokens':2}}},
              {'type':'content_block_delta','delta':{'text':'汉字'}},
              {'type':'message_delta','usage':{'output_tokens':3}}]
    if stop:
        events.append({'type':'message_stop'})
    return b''.join(('data: '+json.dumps(e,ensure_ascii=False)+'\n\n').encode() for e in events)


class FakeHTTPS:
    calls=0; payload=stream(); last_body=None; last_path=None; last_headers=None
    def __init__(self,*args,**kwargs):
        pass
    def request(self,method,path,body,headers):
        type(self).calls+=1;type(self).last_body=body;type(self).last_path=path;type(self).last_headers=headers
    def getresponse(self):
        owner=self
        class Response:
            status=200;offset=0
            def getheader(self,*args):return 'text/event-stream'
            def read1(self,size):
                value=owner.payload[self.offset:self.offset+13];self.offset+=len(value);return value
        return Response()
    def close(self):
        pass


class Invariants(unittest.TestCase):
    def request(self,**overrides):
        return {'model':'glm-5.3-flash','stream':True,'max_tokens':131072,'thinking':{'type':'enabled','budget_tokens':2048},
                'system':'unchanged system','messages':[{'role':'user','content':'unchanged input'}],'tools':[{'name':'native'}],**overrides}

    def test_controls_only_and_original_identity(self):
        body=self.request();forwarded,original,controls,payload_hash=normalize(json.dumps(body).encode())
        parsed=json.loads(forwarded)
        self.assertEqual(original['thinking']['budget_tokens'],2048)
        self.assertEqual(controls['thinking']['budget_tokens'],8000)
        self.assertEqual(controls['output_config']['effort'],'low')
        for field in ['system','messages','tools']:self.assertEqual(parsed[field],body[field])
        self.assertEqual(len(payload_hash),64)

    def test_summary_ceiling_is_preserved(self):
        _,_,controls,_=normalize(json.dumps(self.request(max_tokens=1200)).encode())
        self.assertEqual(controls['max_tokens'],1200)
        self.assertEqual(controls['thinking']['budget_tokens'],1199)

    def test_invalid_profile_is_rejected_before_io(self):
        for fields in [{'model':'other'},{'stream':False},{'max_tokens':True},{'max_tokens':131073},{'max_tokens':0}]:
            with self.assertRaises(ValueError):normalize(json.dumps(self.request(**fields)).encode())

    def test_every_utf8_and_sse_boundary(self):
        for size in [1,2,7,31,8192]:
            audit=StreamAudit();raw=stream()
            for i in range(0,len(raw),size):audit.feed(raw[i:i+size])
            result=audit.finish();self.assertTrue(result['usageComplete'])
            self.assertEqual(sum(result['usage'].values()),16)

    def test_missing_end_event_is_unknown(self):
        audit=StreamAudit();audit.feed(stream(False));self.assertFalse(audit.finish()['usageComplete'])

    def test_invalid_usage_is_not_zero(self):
        audit=StreamAudit();audit.feed(b'data: {"type":"message_start","message":{"usage":{"input_tokens":null,"output_tokens":3}}}\n\ndata: {"type":"message_stop"}\n\n')
        self.assertFalse(audit.finish()['usageComplete'])

    @unittest.skipUnless(hasattr(socket,'AF_UNIX'),'Unix socket unavailable')
    def test_forwarding_unknown_halts_and_guard_is_known_unsubmitted(self):
        with tempfile.TemporaryDirectory(prefix='pi-relay-') as tmp, patch('inference_relay.http.client.HTTPSConnection',FakeHTTPS):
            root=Path(tmp);FakeHTTPS.calls=0;FakeHTTPS.payload=stream()
            relay=Relay({'baseUrl':'https://fixture.invalid/messages-api','apiKey':'fixture-only-key'},socket_path=root/'api.sock',audit_path=root/'audit.jsonl')
            relay.start();relay.begin_trial('fixture');relay.active=True
            def post():
                class Unix(http.client.HTTPConnection):
                    def connect(self):
                        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.connect(str(root/'api.sock'))
                client=Unix('localhost');client.request('POST','/v1/messages?beta=true',body=json.dumps(self.request()).encode(),headers={'content-type':'application/json','anthropic-beta':'fixture-beta'})
                response=client.getresponse();response.read();status=response.status;client.close();relay.idle.wait(2);return status
            try:
                self.assertEqual(post(),200);self.assertTrue(relay.rows[0]['usageComplete']);self.assertEqual(FakeHTTPS.calls,1)
                self.assertEqual(FakeHTTPS.last_path,'/messages-api/v1/messages')
                self.assertEqual(FakeHTTPS.last_headers['anthropic-beta'],'fixture-beta')
                self.assertTrue(relay.rows[0]['nonControlPayloadUnchanged'])
                FakeHTTPS.payload=stream(False)
                self.assertEqual(post(),200);self.assertTrue(relay.unknown);self.assertFalse(relay.rows[1]['usageComplete'])
                self.assertEqual(post(),403);self.assertEqual(FakeHTTPS.calls,2)
                self.assertFalse(relay.rows[2]['submitted']);self.assertIsNone(relay.rows[2]['usage'])
                self.assertTrue(relay.rows[2]['knownNotSubmitted'])
                self.assertNotIn('fixture-only-key',(root/'audit.jsonl').read_text())
            finally:
                relay.stop()


if __name__=='__main__':
    unittest.main()
