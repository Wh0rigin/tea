"""Offline fixtures for result selection, independent metering and missing usage."""
import hashlib,json,subprocess,sys,tempfile,unittest
from pathlib import Path

class CollectionTests(unittest.TestCase):
 def run_fixture(self,*,unknown=False,guard=False,failed=False,bad_hash=False,different_prompt=False):
  with tempfile.TemporaryDirectory() as temp:
   b=Path(temp);name='native-pi-s0-deepswe-20261022';adapter=b/'adapters'/name;adapter.mkdir(parents=True)
   order=[{'arm':a,'task':'fixture','repeat':1} for a in ['tea','pi']]
   (adapter/'protocol.json').write_text(json.dumps({'order':order,'tasks':[{'id':'fixture','baseCommit':'same'}]}))
   (b/'results').mkdir();(b/'logs').mkdir();wire=[];completed=[]
   for item in order:
    arm=item['arm'];trialname=f'pis0-r1-{arm}-fixture';trial=b/'results'/name/trialname;agent=trial/'agent';agent.mkdir(parents=True);(trial/'verifier').mkdir()
    (agent/'git-setup.json').write_text(json.dumps({'baseCommit':'same'}));(agent/'instruction.txt').write_text('different' if different_prompt and arm=='pi' else 'same')
    (agent/f'{arm}-result.json').write_text(json.dumps({'status':'completed'}));(trial/'verifier/reward.json').write_text(json.dumps({'reward':0 if failed and arm=='tea' else 1}))
    usage={'input_tokens':100 if arm=='tea' else 200,'output_tokens':10,'cache_read_input_tokens':20,'cache_creation_input_tokens':5};complete=not(unknown and arm=='tea')
    row={'trial':trialname,'call':1,'requestSha256':arm,'submitted':True,'usage':usage,'usageComplete':complete,'nonControlPayloadUnchanged':True,'controls':{'model':'glm-5.3-flash','stream':True,'max_tokens':131072,'thinking':{'type':'enabled','budget_tokens':8000},'output_config':{'effort':'low'}}};wire.append(row)
    client={'type':'model_request','requestSha256':'wrong' if bad_hash and arm=='tea' else arm,'usage':usage,'usageComplete':complete,'call':1}
    clients=[client]
    if guard:
     wire.append({**row,'call':2,'requestSha256':arm+'guard','submitted':False,'usage':None,'usageComplete':None,'guard':'request_limit','knownNotSubmitted':True});clients.append({'type':'model_request','call':2,'requestSha256':arm+'guard','usage':{},'usageComplete':False,'providerSubmitted':False})
    p=agent/'ledger/ledger.jsonl' if arm=='tea' else agent/'pi-requests.jsonl';p.parent.mkdir(exist_ok=True);p.write_text(''.join(json.dumps(c)+'\n' for c in clients))
    completed.append({**item,'relayClientRequests':len(clients)})
   (b/'results'/(name+'-progress.json')).write_text(json.dumps({'status':'completed','completed':completed}))
   (b/'logs'/('inference-transport-'+name+'.jsonl')).write_text(''.join(json.dumps(w)+'\n' for w in wire))
   subprocess.run([sys.executable,str(Path(__file__).with_name('collect.py')),'--base',str(b),'--kind','deepswe'],capture_output=True,check=True)
   return json.loads((b/'results'/(name+'-aggregate.json')).read_text())
 def test_complete_pair(self):
  r=self.run_fixture();self.assertTrue(all(x['metered'] for x in r['runs']));self.assertEqual(r['bothPassedEfficiency']['pairs'],1);self.assertEqual(r['bothPassedEfficiency']['teaTokens'],135);self.assertEqual(r['bothPassedEfficiency']['piTokens'],235)
 def test_unknown_never_zero(self):
  r=self.run_fixture(unknown=True);self.assertIsNone(r['runs'][0]['totalTokens']);self.assertEqual(r['bothPassedEfficiency']['pairs'],0)
 def test_known_unsubmitted_guard_is_not_missing_provider_usage(self):
  r=self.run_fixture(guard=True);self.assertTrue(all(x['metered'] for x in r['runs']));self.assertEqual(r['runs'][0]['totalTokens'],135);self.assertEqual(r['runs'][0]['providerSubmittedRequests'],1)
 def test_failed_work_excluded(self):self.assertEqual(self.run_fixture(failed=True)['bothPassedEfficiency']['pairs'],0)
 def test_hash_mismatch_excluded(self):self.assertFalse(self.run_fixture(bad_hash=True)['runs'][0]['metered'])
 def test_different_prompt_excluded(self):self.assertEqual(self.run_fixture(different_prompt=True)['bothPassedEfficiency']['pairs'],0)

if __name__=='__main__':unittest.main()
