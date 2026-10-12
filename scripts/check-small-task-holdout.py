"""Zero-provider integrity/preflight check for the S0 frozen seeded-fault manifest.

Uses already fetched pinned repositories and explicit local runtimes. No downloads,
model calls, upstream edits, global installation, or recursive cleanup.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SHA = lambda value: hashlib.sha256(value).hexdigest()


def execute(args, cwd, env=None):
    try:
        run = subprocess.run(args, cwd=cwd, env=env, capture_output=True, timeout=60)
        return {'exitCode': run.returncode, 'outputSha256': SHA(run.stdout + run.stderr)}, run.stdout + run.stderr
    except subprocess.TimeoutExpired:
        return {'exitCode': None, 'timedOut': True}, b'timeout'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, default=ROOT / '.tea/s0-holdout-sources')
    parser.add_argument('--deps', type=Path, default=ROOT / '.tea/s0-deps/node_modules')
    parser.add_argument('--node', default='node')
    parser.add_argument('--go', default='go')
    parser.add_argument('--output', type=Path, default=ROOT / '.tea/s0-holdout-preflight.json')
    args = parser.parse_args()
    args.sources = args.sources.resolve(); args.deps = args.deps.resolve()
    if '/' in args.go or '\\' in args.go:
        args.go = str(Path(args.go).resolve())
    manifest_path = ROOT / 'benchmarks/holdouts/small-task-v1.json'
    manifest = json.loads(manifest_path.read_bytes())
    assert len(manifest['tasks']) == 20 and len(manifest['repositories']) == 5
    repos = {r['id']: r for r in manifest['repositories']}
    assert all(sum(t['repository'] == name for t in manifest['tasks']) == 4 for name in repos)
    for task in manifest['tasks']:
        payload = {k: v for k, v in task.items() if k != 'taskSha256'}
        assert SHA(json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()) == task['taskSha256']
    runtime_commands = {'node': [args.node, '--version'], 'python': [sys.executable, '--version'],
                        'go': [args.go, 'version'], 'typescript': [args.node, str(args.deps / 'typescript/bin/tsc'), '--version']}
    versions = {}
    for name, command in runtime_commands.items():
        result, output = execute(command, ROOT)
        assert result['exitCode'] == 0, f'Unavailable {name} runtime'
        versions[name] = output.decode().strip()
        assert manifest['runtimePins'][name] in versions[name], f'Runtime pin mismatch: {name}'
    assert json.loads((args.deps / 'yocto-queue/package.json').read_bytes())['version'] == manifest['runtimePins']['yocto-queue']
    private = ROOT / '.tea'
    workspace = Path(tempfile.mkdtemp(prefix='s0-holdout-preflight-', dir=private))
    report = {'kind': 'frozen seeded-fault preflight; no agent execution', 'manifestSha256': SHA(manifest_path.read_bytes()),
              'runtimes': versions, 'paidProviderRequests': 0, 'tasks': [], 'complete': False}
    for task in manifest['tasks']:
        repo = repos[task['repository']]
        local = args.sources / repo['id']
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=local, text=True).strip()
        assert commit == repo['commit'], 'Upstream commit mismatch'
        archive = subprocess.check_output(['git', 'archive', '--format=zip', commit], cwd=local)
        task_root = workspace / task['id']; task_root.mkdir()
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            for entry in bundle.infolist():
                target = (task_root / entry.filename).resolve()
                assert target.is_relative_to(task_root.resolve()), 'Archive path escape'
                assert ((entry.external_attr >> 16) & 0o170000) != 0o120000, 'Archive symlink rejected'
            bundle.extractall(task_root)
        # Git archive can apply export EOL attributes. Canonical identities use
        # committed blob bytes; restore the declared targets and license exactly.
        license_file = task_root / repo['licensePath']
        license_file.write_bytes(subprocess.check_output(['git', 'show', f"{commit}:{repo['licensePath']}"], cwd=local))
        assert SHA(license_file.read_bytes()) == repo['licenseSha256']
        for source in task['sourceFiles']:
            (task_root / source['path']).write_bytes(subprocess.check_output(['git', 'show', f"{commit}:{source['path']}"], cwd=local))
            assert SHA((task_root / source['path']).read_bytes()) == source['sha256']
        if repo['id'] == 'p-limit':
            shutil.copytree(args.deps / 'yocto-queue', task_root / 'node_modules/yocto-queue')
        if task['language'].startswith('JavaScript'):
            validation = task_root / 'tea_acceptance.mjs'
            validation.write_bytes(task['acceptanceCode'].encode())
            commands = [[args.node, str(validation)]]
            if 'typescriptAcceptanceCode' in task:
                ts = task_root / 'tea_acceptance.ts'; ts.write_bytes(task['typescriptAcceptanceCode'].encode())
                commands.append([args.node, str(args.deps / 'typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', str(ts)])
        elif task['language'] == 'Python':
            validation = task_root / 'tea_acceptance.py'; validation.write_bytes(task['acceptanceCode'].encode())
            commands = [[sys.executable, str(validation)]]
        else:
            validation = task_root / 'tea_acceptance_test.go'; validation.write_bytes(task['acceptanceCode'].encode())
            commands = [[args.go, 'test', '-vet=off', '-run', '^TestFrozenAcceptance$', '-count=1', '.']]
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', GOTOOLCHAIN='local', GOPROXY='off', GOSUMDB='off',
                   GOCACHE=str(private / 's0-go-cache'), GOMODCACHE=str(private / 's0-go-modules'), GOTELEMETRY='off')
        original = [execute(command, task_root, env) for command in commands]
        for mutation in task['mutations']:
            filename = task_root / mutation['path']
            text = filename.read_text(encoding='utf-8')
            assert text.count(mutation['search']) == 1, 'Nonunique frozen mutation'
            filename.write_bytes(text.replace(mutation['search'], mutation['replace']).encode())
        faulty = [execute(command, task_root, env) for command in commands]
        passed = all(r['exitCode'] == 0 for r, _ in original) and all(r['exitCode'] is not None and r['exitCode'] != 0 for r, _ in faulty)
        record = {'id': task['id'], 'taskSha256': task['taskSha256'], 'language': task['language'],
                  'original': [r for r, _ in original], 'seededFault': [r for r, _ in faulty], 'preflightPassed': passed}
        report['tasks'].append(record)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes((json.dumps(report, indent=2) + '\n').encode())
        print(f"{task['id']}: original-pass / seeded-fault-detected = {passed}", flush=True)
        if not passed:
            (workspace / f"{task['id']}-failure.log").write_bytes(b'\n'.join(output for _, output in original + faulty))
            raise RuntimeError(f"Preflight failed for {task['id']}; evidence retained in ignored workspace")
    report['complete'] = True
    args.output.write_bytes((json.dumps(report, indent=2) + '\n').encode())
    print('20/20 preflights passed; 0 provider requests; not an agent completion/token experiment')


if __name__ == '__main__':
    main()
