"""Run one pre-frozen native task schedule; never retries a failed attempt."""
import asyncio
import hashlib
import json
import os
import sys
import tarfile
import time
from pathlib import Path
import tea_adapter
from inference_relay import Relay

KIND = os.environ['NATIVE_BENCH_KIND']
NAME = Path(__file__).parent.name
B = tea_adapter.BASE
ADAPTER = B/'adapters'/NAME
if KIND == 'deepswe':
    from pier.models.trial.config import TrialConfig, TaskConfig, AgentConfig, EnvironmentConfig
    from pier.trial.trial import Trial
else:
    from harbor.models.trial.config import TrialConfig, TaskConfig, AgentConfig, EnvironmentConfig, VerifierConfig
    from harbor.trial.trial import Trial


def trial_config(item):
    arm, task, repeat = item['arm'], item['task'], item['repeat']
    if KIND == 'deepswe':
        return TrialConfig(task=TaskConfig(path=B/'sources/deep-swe/tasks'/task), trial_name=f'pis0-r{repeat}-{arm}-{task}',
                          trials_dir=B/'results'/NAME, agent=AgentConfig(import_path='tea_adapter:TeaAgent', model_name='glm-5.3-flash', override_timeout_sec=1860, override_setup_timeout_sec=360),
                          environment=EnvironmentConfig(import_path='tea_adapter:TeaEnvironment', delete=False))
    return TrialConfig(task=TaskConfig(path=B/'framework/datasets/wb-bench-code-v1.0/tasks'/task), trial_name=f'{task}__r{repeat}-{arm}-pis0',
                       trials_dir=B/'results'/NAME/arm, agent=AgentConfig(import_path='tea_adapter:TeaAgent', model_name='glm-5.3-flash', override_timeout_sec=1860, override_setup_timeout_sec=360),
                       environment=EnvironmentConfig(import_path='tea_adapter:TeaEnvironment', delete=False, extra_docker_compose=[ADAPTER/'docker-compat.yaml'],
                       mounts=[{'type':'bind','source':str(B/'runtime'/('inference-'+NAME)),'target':'/tea-relay','read_only':True}]),
                       verifier=VerifierConfig(import_path='workbuddy_bench.judge:CompositeVerifier', override_timeout_sec=1200))


def verify(protocol):
    assert protocol['status'] == 'frozen_before_model_calls'
    assert json.loads((B/'results'/(NAME+'-preflight.json')).read_text())['status'] == 'passed'
    for filename, expected in protocol['adapterSha256'].items():
        assert hashlib.sha256((ADAPTER/filename).read_bytes()).hexdigest() == expected, filename
    for arm, expected in protocol['archivesSha256'].items():
        archive = B/'archives'/(NAME+'-'+arm+'.tar')
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
        source = B/'sources'/NAME/arm
        with tarfile.open(archive) as tar:
            members = [m for m in tar.getmembers() if m.isfile()]
            assert {m.name for m in members} == {f.relative_to(source).as_posix() for f in source.rglob('*') if f.is_file()}
            for m in members:
                assert tar.extractfile(m).read() == (source/m.name).read_bytes()
    assets = protocol['nativeAssets']
    assert hashlib.sha256((tea_adapter.ASSETS/'node').read_bytes()).hexdigest() == assets['nodeSha256']
    assert hashlib.sha256((tea_adapter.ASSETS.parents[1]/'archives/pi-native-s0-20261022.tar.gz').read_bytes()).hexdigest() == assets['piArchiveSha256']
    for task in protocol['tasks']:
        directory = B/'sources/deep-swe/tasks'/task['id'] if KIND == 'deepswe' else B/'framework/datasets/wb-bench-code-v1.0/tasks'/task['id']
        files = {'task.toml':task['taskTomlSha256'],'instruction.md':task['instructionSha256']} if KIND == 'deepswe' else task['inputSha256']
        for name, expected in files.items():
            assert hashlib.sha256((directory/name).read_bytes()).hexdigest() == expected
    assert protocol['suiteControlBudgetUsd'] == len(protocol['order']) * 10


async def main():
    protocol = json.loads((ADAPTER/'protocol.json').read_text())
    verify(protocol)
    progress_path = B/'results'/(NAME+'-progress.json')
    assert not progress_path.exists(), 'Never overwrite/restart a paid schedule'
    if '--validate-only' in sys.argv:
        print(json.dumps({'status':'passed','providerCalls':0,'mode':'protocol-and-source-validation'})); return
    credentials = json.loads(sys.stdin.readline())
    assert hashlib.sha256(credentials['baseUrl'].encode()).hexdigest() == protocol['endpointSha256']
    relay = Relay(credentials, socket_path=B/'runtime'/('inference-'+NAME)/'api.sock', audit_path=B/'logs'/('inference-transport-'+NAME+'.jsonl'))
    credentials = None; relay.start(); tea_adapter.RELAY = relay
    progress = {'status':'running','startedAt':time.time(),'completed':[],'plannedAttempts':len(protocol['order'])}
    results = []
    def save():
        progress_path.write_text(json.dumps(progress)+'\n')
    if KIND == 'wb':
        for arm in ['tea','pi']:
            root = B/'results'/NAME/arm; root.mkdir(parents=True,exist_ok=True)
            (root/'config.json').write_text(json.dumps({'benchmark':'wb-bench-code','agent':arm,'model':'glm-5.3-flash','n_attempts':2,'task_names':[t['id'] for t in protocol['tasks']],'orchestration':'serial native Harbor Trial'}))
            (root/'manifest.json').write_text(json.dumps({'selected_tasks':[t['id'] for t in protocol['tasks']],'n_attempts':2}))
            (root/'job.log').touch()
    save()
    try:
        for item in protocol['order']:
            tea_adapter.ARM = item['arm']; progress['current'] = item; save()
            config = trial_config(item)
            assert not (config.trials_dir/config.trial_name).exists()
            name = config.trial_name; relay.begin_trial(name)
            print('trial_start '+name,flush=True)
            trial = await Trial.create(config)
            if KIND == 'wb':
                trial.task.config.agent.user = 'dev'; trial.task.config.verifier.user = 'root'
            result = await trial.run()
            drained = await asyncio.to_thread(relay.idle.wait,30)
            results.append({**item,'result':result.model_dump(mode='json')})
            (B/'results'/(NAME+'-results.json')).write_text(json.dumps(results,indent=2)+'\n')
            if KIND == 'wb':
                (config.trials_dir/'result.json').write_text(json.dumps({'customSerialNativeTrialResults':[r for r in results if r['arm']==item['arm']]},indent=2))
            rows = sorted(relay.rows,key=lambda row:row['call'])
            submitted = [r for r in rows if r['submitted']]
            known = bool(submitted) and drained and all(r['usageComplete'] for r in submitted)
            tokens = sum(sum(r['usage'].get(k,0) for k in ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']) for r in submitted) if known else None
            terminal = config.trials_dir/config.trial_name/'agent'/('tea-result.json' if item['arm']=='tea' else 'pi-result.json')
            row = {**item,'transportUsageKnown':known,'relayClientRequests':relay.calls,'providerSubmittedRequests':relay.submitted_calls,
                   'totalTokens':tokens,'terminalSummaryPresent':terminal.exists(),'controlCostEstimateUsd':relay.accounted,
                   'knownNotSubmittedGuards':sum(not r['submitted'] for r in rows),
                   'rewards':getattr(result.verifier_result,'rewards',None) if result.verifier_result else None}
            progress['completed'].append(row)
            if not known:
                progress.setdefault('unknownReservations',[]).append({**item,'reservationUsd':10 if relay.submitted_calls else 0,'notRetried':True})
            save(); print('trial_end '+name+' transport_usage_known='+str(known),flush=True)
            if not drained or (result.exception_info and not relay.submitted_calls):
                progress['status']='stopped'; progress['stopReason']='relay_not_drained' if not drained else 'pre_inference_infrastructure_failure'; save(); break
        else:
            progress['status']='completed_with_unknown_usage' if progress.get('unknownReservations') else 'completed'; save()
    finally:
        relay.stop()


if __name__ == '__main__':
    asyncio.run(main())
