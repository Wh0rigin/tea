"""Align already measured TEA/Pi/Claude cohorts; never call a provider."""
import hashlib
import json
from pathlib import Path
from statistics import mean

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'benchmarks/reports'
OUT = BASE / 'tea-complete-coverage-vs-recorded-agents-20261014'
NEW = BASE / 'discovery-repair-20261014/comparison.json'
OLD = BASE / 'tea-pi-claude-v5-glm-20261013/results.json'
PLAN = BASE / 'tea-pi-claude-v5-glm-20261013/frozen-plan.json'

def read(file):
    return json.loads(file.read_bytes())

def save(name, value):
    (OUT / name).write_bytes((json.dumps(value, indent=2) + '\n').encode())

tea, previous, plan = read(NEW), read(OLD), read(PLAN)
manifest = plan['manifests'][0]
supplement = read(BASE / 'tea-coverage-completion-20261014/comparison.json')
long_plan_file = BASE / 'tea-pi-claude-v6-retry1-glm-20261014/frozen-plan.json'
long_file = BASE / 'tea-pi-claude-v6-retry1-glm-20261014/results.json'
long_plan, long_data = read(long_plan_file), read(long_file)
assert supplement['engines']['candidate']['commit'] == tea['engines']['candidate']['commit']
assert supplement['sourceUnchanged'] and supplement['complete']
original_tea = tea
tea = dict(tea) | {key: tea[key] + supplement[key] for key in ['tasks', 'runs', 'requests']}
previous = dict(previous) | {key: [r for r in previous[key] if not r['caseId'].startswith('long-30-')] + long_data[key] for key in ['runs', 'requests']}
manifest = dict(manifest) | {'tasks': manifest['tasks'] + long_plan['manifests'][0]['tasks']}
alignment = {'tasks': []}
OUT.mkdir(parents=True, exist_ok=True)
controls = ['model', 'thinkingMode', 'effort', 'maxOutputTokens',
            'maxRequestInputBound', 'maxRequestsPerAgentTask', 'api', 'apiVersion',
            'endpointSha256', 'turnTimeoutMs']
assert all(tea['commonProfile'][key] == manifest['commonProfile'][key] == supplement['commonProfile'][key] == long_plan['manifests'][0]['commonProfile'][key] for key in controls)
task_ids = {task['taskId'] for task in tea['tasks']}
assert len(task_ids) == 10 and {task['scale'] for task in tea['tasks']} == {'small', 'medium', 'large', 'long-session'}
for task in tea['tasks']:
    old = next(row for row in manifest['tasks'] if row['taskId'] == task['taskId'])
    proof = {'taskId': task['taskId'], 'initialSourceSha256': task['sha256'], 'promptSha256': [hashlib.sha256(p.encode()).hexdigest() for p in task['prompts']], 'fileCount': task['fileCount'], 'plannedTurns': task['plannedTurns']} if 'prompts' in task else next(row for row in read(BASE / 'tea-fair-discovery-vs-recorded-agents-20261014/alignment.json')['tasks'] if row['taskId'] == task['taskId'])
    alignment['tasks'].append(proof)
    assert task['sha256'] == old['sha256'] == proof['initialSourceSha256']
    assert proof['promptSha256'] == old['promptSha256']
    assert task['fileCount'] == old['fileCount'] == proof['fileCount']
    assert task['plannedTurns'] == old['plannedTurns'] == proof['plannedTurns']

runs = []
keys = ['taskId', 'caseId', 'repetition', 'scale', 'group', 'initialSha256',
        'initialCommit', 'status', 'accepted', 'usageComplete', 'requests',
        'inputTokens', 'outputTokens', 'totalTokens', 'qualityDimensions',
        'engineCommit', 'engineSha256', 'compactions', 'toolCalls']
for source, agent, tag in [(tea, 'candidate', 'tea'),
                           (previous, 'pi', 'pi'), (previous, 'claude', 'claude')]:
    for row in source['runs']:
        if row['agent'] != agent or row['taskId'] not in task_ids:
            continue
        clean = {key: row[key] for key in keys if key in row}
        clean.update(agent=tag, measurement='new TEA cohort' if tag == 'tea' else 'historical fresh-v5 or long-v6-retry cohort')
        task = next(task for task in tea['tasks'] if task['taskId'] == row['taskId'])
        assert row['initialSha256'] == task['sha256']
        assert row['usageComplete'] and row['totalTokens'] is not None
        runs.append(clean)
assert len(runs) == 90
for agent in ['tea', 'pi', 'claude']:
    arm = [row for row in runs if row['agent'] == agent]
    assert len(arm) == 30 and len({(row['taskId'], row['repetition']) for row in arm}) == 30
    assert all(row['qualityDimensions']['nativeCompleted'] for row in arm)
    assert all(row['qualityDimensions']['codeCorrect'] for row in arm)

requests = []
expected_controls = tea['requests'][0]['normalizedControls']
for source, agent, tag in [(tea, 'candidate', 'tea'),
                           (previous, 'pi', 'pi'), (previous, 'claude', 'claude')]:
    for row in source['requests']:
        if row['agent'] != agent or row['caseId'] not in {run['caseId'] for run in runs if run['agent'] == tag}:
            continue
        assert row['submitted'] and row['complete'] and not row.get('guard') and not row.get('limitExceeded')
        assert row['normalizedControls'] == expected_controls
        requests.append({key: row[key] for key in ['caseId', 'complete', 'inputTokens', 'outputTokens',
                        'totalTokens', 'requestSha256', 'responseSha256', 'normalizedControls']}
                        | {'agent': tag})
for run in runs:
    rows = [row for row in requests if row['agent'] == run['agent'] and row['caseId'] == run['caseId']]
    assert len(rows) == run['requests']
    assert sum(row['totalTokens'] for row in rows) == run['totalTokens']

def status(row):
    if row['accepted']:
        return 'accepted'
    dims = row['qualityDimensions']
    if not dims['nativePostEditValidation'] and all(v for k, v in dims.items() if k != 'nativePostEditValidation'):
        return 'unconfirmed'
    return 'failed'

def aggregate(scale=None):
    selected = [row for row in runs if scale is None or (row['group'] == 'fresh' if scale == 'fresh' else row['scale'] == scale)]
    roles = {}
    for agent in ['tea', 'pi', 'claude']:
        arm = [row for row in selected if row['agent'] == agent]
        roles[agent] = {'runs': len(arm), 'totalTokens': sum(row['totalTokens'] for row in arm),
                        'accepted': sum(row['accepted'] for row in arm),
                        'codeCorrect': sum(row['qualityDimensions']['codeCorrect'] for row in arm),
                        'validationUnconfirmed': sum(status(row) == 'unconfirmed' for row in arm),
                        'failed': sum(status(row) == 'failed' for row in arm)}
    diagnostic = {}
    for other in ['pi', 'claude']:
        paired = [(a, b) for a in selected if a['agent'] == 'tea' for b in selected
                  if b['agent'] == other and a['caseId'] == b['caseId'] and a['accepted'] and b['accepted']]
        diagnostic[other] = {'caseAlignedBothAcceptedPairs': len(paired),
                             'reductionPercent': 100 * (1 - sum(a['totalTokens'] for a, _ in paired) /
                                                        sum(b['totalTokens'] for _, b in paired))}
    return {'scale': scale or 'all-30-cases', 'roles': roles,
            'reductionVsPi': 100 * (1 - roles['tea']['totalTokens'] / roles['pi']['totalTokens']),
            'reductionVsClaude': 100 * (1 - roles['tea']['totalTokens'] / roles['claude']['totalTokens']),
            'bothAcceptedDiagnostic': diagnostic}

summary = {'comparisonKind': 'case-aligned historical-cohort comparison', 'newProviderCalls': supplement['paidProviderRequests'],
           'completeKnownUsage': True, 'allSelectedAttemptsRetained': True,
           'commonProfile': {key: tea['commonProfile'][key] for key in controls},
           'effectiveControls': expected_controls, 'overall': aggregate(), 'fresh': aggregate('fresh'),
           'scales': [aggregate(scale) for scale in ['small', 'medium', 'large', 'long-session']],
           'sources': {key: {'path': str(file.relative_to(ROOT)).replace('\\', '/'),
                            'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                       for key, file in [('tea', NEW), ('historicalAgents', OLD), ('historicalPlan', PLAN), ('teaSupplement', BASE / 'tea-coverage-completion-20261014/comparison.json'), ('historicalLong', long_file), ('historicalLongPlan', long_plan_file)]},
           'identities': {'tea': tea['engines']['candidate']['commit'], 'pi': manifest['pi'], 'claude': manifest['claude']},
           'limitations': ['Separate measurement rounds, not a simultaneous three-agent rerun.',
                           'Cache state, server load and backend sampling are not fixed across rounds.',
                           'Nine Claude fresh attempts have final validation unconfirmed; historical grades are unchanged.',
                           'TEA small/large and medium/long are separate rounds using the identical frozen runtime.',
                           'Self-authored JavaScript fixtures, three repeats; not production generalization.']}
alignment.update(historicalGradesUnchanged=True, sourceAudit=read(BASE / 'tea-coverage-completion-20261014/source-audit.json'), priorSmallLargeProofSha256=hashlib.sha256((BASE / 'tea-fair-discovery-vs-recorded-agents-20261014/alignment.json').read_bytes()).hexdigest())
prior_tea_file = BASE / 'contextos-gc-tokens-20261014/natural.json'
prior_tea = read(prior_tea_file)
diag = []
for scale in ['medium', 'long-session']:
    a = [r for r in supplement['runs'] if r['scale'] == scale]
    b = [r for r in prior_tea['runs'] if r['agent'] == 'candidate' and r['scale'] == scale]
    assert len(a) == len(b) and all(next(x for x in b if x['caseId'] == r['caseId'])['initialSha256'] == r['initialSha256'] for r in a)
    old_total, new_total = sum(r['totalTokens'] for r in b), sum(r['totalTokens'] for r in a)
    diag.append({'scale': scale, 'runs': len(a), 'previousGcTokens': old_total, 'currentTokens': new_total, 'increasePercent': 100 * (new_total / old_total - 1)})
summary['priorTeaDiagnostic'] = {'kind': 'cross-round historical diagnostic, not paired optimization gate', 'source': str(prior_tea_file.relative_to(ROOT)).replace('\\', '/'), 'sourceSha256': hashlib.sha256(prior_tea_file.read_bytes()).hexdigest(), 'scales': diag}
save('alignment.json', alignment)
save('results.json', {'usageSource': 'provider-wire', 'runs': runs, 'requests': requests})
save('summary.json', summary)

plt.rcParams.update({'font.size': 11, 'svg.fonttype': 'none', 'svg.hashsalt': 'tea-recorded-comparison'})
fig, axes = plt.subplots(1, 4, figsize=(24, 7.2))
agents, colors = ['tea', 'pi', 'claude'], ['#237F6C', '#8974BE', '#CB8A45']
for ax, stats, title in zip(axes, summary['scales'], ['Small: 12 files', 'Medium: 120 files', 'Large: 1,200 files', 'Long: 30 reads + repair']):
    arm_rows = [row for row in runs if row['scale'] == stats['scale']]
    ax.set_title(title, fontsize=14)
    ax.set_ylabel('Mean provider tokens / run (thousands)')
    ax.set_xticks(range(3), ['TEA d76f45f\nnew measurements', 'Pi 0.87.1\nhistorical', 'Claude Code 2.1.281\nhistorical'])
    ax.grid(axis='y', color='#DDDDDD', linewidth=.6)
    ax.set_axisbelow(True)
    ax.spines[['top', 'right']].set_visible(False)
    for pos, (agent, color) in enumerate(zip(agents, colors)):
        arm = [row for row in arm_rows if row['agent'] == agent]
        eligible = [row for row in arm if status(row) != 'failed']
        if eligible:
            ax.bar(pos, mean(row['totalTokens'] / 1000 for row in eligible), width=.58, color=color, alpha=.9)
        for n, row in enumerate(arm):
            marker = {'accepted': 'o', 'unconfirmed': '^', 'failed': 'x'}[status(row)]
            ax.scatter(pos + .05 * (n - (len(arm) - 1) / 2), row['totalTokens'] / 1000, s=35, marker=marker,
                       facecolors='white' if marker != 'x' else color, edgecolors=color, zorder=3)
    ax.set_xlim(-.5, 2.5)
    ax.set_ylim(0, max(row['totalTokens'] / 1000 for row in arm_rows) * 1.3)
    label = f"TEA vs Pi: {stats['reductionVsPi']:.2f}% fewer\nTEA vs Claude Code: {stats['reductionVsClaude']:.2f}% fewer"
    if any(status(row) == 'failed' for row in arm_rows):
        label = 'Failures excluded from bars; all-attempt ratios are in the report'
    ax.text(.5, .98, label, ha='center', va='top', transform=ax.transAxes, fontsize=10)
    counts = ' / '.join(str(stats['roles'][agent]['accepted']) + '/' + str(stats['roles'][agent]['runs']) for agent in agents)
    ax.text(.5, -.27, 'Full acceptance TEA / Pi / Claude: ' + counts + '\nCode behavior: ' + str(len(arm_rows)//3) + '/' + str(len(arm_rows)//3) + ' for all three',
            ha='center', transform=ax.transAxes, fontsize=10)
fig.suptitle('TEA complete coverage vs recorded Pi and Claude Code\n30 runs per agent · same frozen TEA runtime d76f45f · historical case alignment', fontsize=16)
fig.text(.5, .035, 'Same GLM-5.3-flash · enabled / low · 4096 output cap · three repeats per task\n'
         'Circles: accepted. Triangles: final validation unconfirmed, still eligible. Failures excluded from bars but retained.\n'
         'TEA: two measurement cohorts, identical frozen runtime. Pi/Claude: historical fresh-v5 and long-v6-retry cohorts. Cache/backend state uncontrolled across rounds.',
         ha='center', fontsize=9)
fig.subplots_adjust(left=.075, right=.99, top=.81, bottom=.32, wspace=.24)
fig.savefig(OUT / 'three-agents.png', dpi=170)
fig.savefig(OUT / 'three-agents.svg', metadata={'Date': None})
(OUT / 'three-agents.svg').write_bytes((OUT / 'three-agents.svg').read_bytes().replace(b'\r\n', b'\n'))
plt.close(fig)
save('chart-audit.json', {'barPolicy': 'Known accepted + validation-only-unconfirmed completed runs; failures excluded.',
                         'allKnownAttemptsPlotted': 90, 'unknownImputedAsZero': False,
                         'validationUnconfirmedMarkers': sum(status(row) == 'unconfirmed' for row in runs),
                         'failureMarkers': sum(status(row) == 'failed' for row in runs),
                         'ratiosMatchBarPopulation': all(status(row) != 'failed' for row in runs)})
print(json.dumps(summary['overall']))
