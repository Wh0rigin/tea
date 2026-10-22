"""Collect native S0 results without exposing conversations or grader source."""
import argparse, hashlib, json
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--base',type=Path,required=True)
parser.add_argument('--kind',choices=['deepswe','wb'],required=True)
args=parser.parse_args(); B=args.base; kind=args.kind; name=f'native-pi-s0-{kind}-20261022'
def load(p,default=None):
 return json.loads(p.read_text()) if p.exists() else default
def lines(p):
 return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
protocol=load(B/'adapters'/name/'protocol.json'); progress=load(B/'results'/(name+'-progress.json'))
audit=lines(B/'logs'/('inference-transport-'+name+'.jsonl')); rows=[]
fields=['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']
for item in progress['completed']:
 arm,task,repeat=item['arm'],item['task'],item['repeat']
 trialname=f'pis0-r{repeat}-{arm}-{task}' if kind=='deepswe' else f'{task}__r{repeat}-{arm}-pis0'
 trial=B/'results'/name
 if kind=='wb':trial=trial/arm
 trial=trial/trialname; agent=trial/'agent'
 result=load(agent/('tea-result.json' if arm=='tea' else 'pi-result.json'),{})
 ledger=agent/'ledger/ledger.jsonl'
 if arm=='tea' and not ledger.exists():
  found=list((agent/'recovered-runs').rglob('ledger.jsonl')); ledger=found[0] if found else ledger
 entries=lines(ledger) if arm=='tea' else []
 client=[e for e in entries if e.get('type')=='model_request'] if arm=='tea' else sorted(lines(agent/'pi-requests.jsonl'),key=lambda x:x['call'])
 wire=sorted([r for r in audit if r['trial']==trialname],key=lambda r:r['call'])
 submitted=[r for r in wire if r.get('submitted')]
 count=bool(client) and len(client)==len(wire)==item['relayClientRequests']
 hashes=count and all(c.get('requestSha256')==w['requestSha256'] for c,w in zip(client,wire))
 usage=count and all(all((c.get('usage') or {}).get(f,0)==(w.get('usage') or {}).get(f,0) for f in fields) for c,w in zip(client,wire) if w['submitted'])
 complete=bool(submitted) and count and all(w.get('usageComplete') and c.get('usageComplete') for c,w in zip(client,wire) if w['submitted'])
 controls=bool(wire) and all(w['controls'].get('model')=='glm-5.3-flash' and w['controls'].get('stream') is True and w['controls'].get('thinking',{}).get('type')=='enabled' and w['controls'].get('thinking',{}).get('budget_tokens')==min(8000,w['controls']['max_tokens']-1) and w['controls'].get('output_config',{}).get('effort')=='low' and 0<w['controls']['max_tokens']<=131072 and w.get('nonControlPayloadUnchanged') for w in wire)
 metered=bool(hashes and usage and complete and controls)
 tokens={f:sum(w['usage'].get(f,0) for w in submitted) for f in fields} if metered else None
 grade=load(trial/'verifier'/('reward.json' if kind=='deepswe' else 'score.json'))
 safegrade={k:grade[k] for k in ['reward','f2p_total','f2p_passed','p2p_total','p2p_passed','test_status','tests_passed','tests_total'] if k in grade} if grade else None
 setup=load(agent/('git-setup.json' if kind=='deepswe' else 'initial-state.json'),{})
 base=setup.get('baseCommit') if kind=='deepswe' else (setup.get('stdout') or '\n').splitlines()[0]
 info=next(t for t in protocol['tasks'] if t['id']==task)
 expected=info['baseCommit'] if kind=='deepswe' else info['initialState'].splitlines()[0]
 instruction=agent/'instruction.txt'
 events=lines(agent/('tea-events.jsonl' if arm=='tea' else 'pi-events.jsonl'))
 tooltypes={};errors={}
 for e in events:
  if arm=='tea' and e.get('type')=='tool_end':tool=e.get('name'); failed=e.get('isError')
  elif arm=='pi' and e.get('type')=='tool_execution_end':tool=e.get('toolName');failed=e.get('isError')
  else:continue
  tooltypes[tool]=tooltypes.get(tool,0)+1
  if failed:errors[tool]=errors.get(tool,0)+1
 summary=result.get('summary',{})
 rows.append({'arm':arm,'taskId':task,'repeat':repeat,'agentStatus':result.get('status','native_runtime_failure'),'terminalSummaryPresent':bool(result),'officialGrade':safegrade,'officialFullPass':grade.get('reward')==1 if grade else None,'metered':metered,'requestCountMatched':count,'requestHashesMatched':hashes,'wireUsageMatched':usage,'allSubmittedStreamsComplete':complete,'controlProfileMatched':controls,'clientRequests':len(client),'providerSubmittedRequests':len(submitted),'unknownSubmittedRequests':[{k:w.get(k) for k in ['call','status','httpStatus','messageStopSeen','auditInvalid','elapsedMs']} for w in submitted if not w.get('usageComplete')],'knownNotSubmittedGuards':[w.get('guard') for w in wire if not w['submitted']],'tokenComponents':tokens,'totalTokens':sum(tokens.values()) if tokens else None,'reportedTokenLowerBound':sum(sum((w.get('usage') or {}).get(f,0) for f in fields) for w in submitted),'initialBaseCommit':base,'initialBaseMatchesProtocol':base==expected,'instructionSha256':hashlib.sha256(instruction.read_bytes()).hexdigest() if instruction.exists() else None,'toolCallsByName':tooltypes,'toolErrorsByName':errors,'compactionRequests':summary.get('compactionRequests') if arm=='tea' else result.get('compactions'),'adoptedCompactions':sum(e.get('type')=='conversation_compaction' for e in entries) if arm=='tea' else None,'errorCode':(result.get('error') or {}).get('code') if arm=='tea' else None,'validationPassedByTea':result.get('validationPassed') if arm=='tea' else None,'nativePiLastStop':result.get('lastStop') if arm=='pi' else None,'taskOutputLimitStops':sum(e.get('purpose')=='task' and e.get('stopReason')=='max_tokens' for e in client) if arm=='tea' else None,'originalControlAllocationUsd':10})
pairs=[]
for task,repeat in sorted({(i['task'],i['repeat']) for i in protocol['order']}):
 match={r['arm']:r for r in rows if r['taskId']==task and r['repeat']==repeat}
 if set(match)!={'tea','pi'}:continue
 t,p=match['tea'],match['pi']; same=t['initialBaseMatchesProtocol'] and p['initialBaseMatchesProtocol'] and t['initialBaseCommit']==p['initialBaseCommit'] and t['instructionSha256']==p['instructionSha256']
 eligible=bool(same and t['metered'] and p['metered'] and t['officialFullPass'] and p['officialFullPass'])
 pairs.append({'taskId':task,'repeat':repeat,'sameSnapshotAndInstruction':same,'bothMetered':bool(same and t['metered'] and p['metered']),'teaPassed':t['officialFullPass'],'piPassed':p['officialFullPass'],'teaTokens':t['totalTokens'],'piTokens':p['totalTokens'],'eligibleBothPassed':eligible,'bothNativeCompleted':t['agentStatus']==p['agentStatus']=='completed','teaTokenReductionPercent':100*(1-t['totalTokens']/p['totalTokens']) if eligible and p['totalTokens'] else None})
aggregates={}
for arm in ['tea','pi']:
 selected=[r for r in rows if r['arm']==arm];planned=sum(i['arm']==arm for i in protocol['order']); allknown=len(selected)==planned and all(r['metered'] for r in selected)
 aggregates[arm]={'planned':planned,'attempted':len(selected),'officialEvaluated':sum(r['officialFullPass'] is not None for r in selected),'officialFullPassed':sum(r['officialFullPass'] is True for r in selected),'nativeCompletedAndOfficialPassed':sum(r['officialFullPass'] is True and r['agentStatus']=='completed' for r in selected),'meteredAttempts':sum(r['metered'] for r in selected),'allAttemptTokens':sum(r['totalTokens'] for r in selected) if allknown else None,'reportedTokenLowerBound':sum(r['reportedTokenLowerBound'] for r in selected)}
eligible=[p for p in pairs if p['eligibleBothPassed']]; t=sum(p['teaTokens'] for p in eligible);p=sum(x['piTokens'] for x in eligible)
report={'schemaVersion':1,'benchmark':kind,'scope':'six previously seen tasks overall; two repeats; no unseen/full-benchmark claim','status':progress['status'],'plannedAttempts':len(protocol['order']),'runs':rows,'pairs':pairs,'aggregates':aggregates,'bothPassedEfficiency':{'pairs':len(eligible),'teaTokens':t if eligible else None,'piTokens':p if eligible else None,'teaTokenReductionPercent':100*(1-t/p) if p else None},'unknownReservations':progress.get('unknownReservations',[]),'protocolSha256':hashlib.sha256((B/'adapters'/name/'protocol.json').read_bytes()).hexdigest(),'unstarted':[i for i in protocol['order'] if not any(r['arm']==i['arm'] and r['repeat']==i['repeat'] and r['taskId']==i['task'] for r in rows)]}
(B/'results'/(name+'-aggregate.json')).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','aggregates','bothPassedEfficiency']}))
