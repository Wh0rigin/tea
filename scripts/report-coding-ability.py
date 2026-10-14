"""Render reviewed aggregate results; never copy raw model transcripts or credentials."""
import hashlib
import json
import pathlib
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parents[1]
run_id = sys.argv[1]
if not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run_id):
    raise ValueError('Invalid run ID')
source = ROOT / 'benchmarks/results' / run_id
raw = json.loads((source / 'results.json').read_text(encoding='utf-8'))
for name, field in [('benchmarks/tasks/coding-ability.mjs', 'manifestSha256'), ('scripts/test-coding-ability.mjs', 'harnessSha256')]:
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != raw[field]:
        raise RuntimeError('Frozen fixture/harness changed during evaluation')
if any(row['status'] == 'running' for row in raw['rows']):
    raise RuntimeError('Run is still active')
target = ROOT / 'benchmarks/reports' / run_id
target.mkdir(exist_ok=False)
rows = []
for row in raw['rows']:
    ledger = source / 'workspaces' / row['id'] / '.tea/runs/agent/ledger.jsonl'
    events = [json.loads(line) for line in ledger.read_text(encoding='utf-8').splitlines()] if ledger.exists() else []
    errors = [event for event in events if event.get('type') == 'tool_call' and event.get('error')]
    categories = {}
    for event in errors:
        key = event.get('name', 'unknown')
        categories[key] = categories.get(key, 0) + 1
    workspace = source / 'workspaces' / row['id']
    added_tests = [p.relative_to(workspace).as_posix() for p in (workspace / 'tests').rglob('*.test.mjs') if p.name != 'public.test.mjs']
    rows.append({key: row.get(key) for key in ['id', 'level', 'title', 'status', 'agentStarted', 'accepted', 'functionalPass',
        'validationPassed', 'validationAttempts', 'publicPassed', 'addedTestsPassed', 'hiddenPassed', 'hiddenCompleted',
        'protectedFilesUnchanged', 'allowedChanges', 'elapsedMs', 'toolCalls', 'usageStatus', 'usage', 'changedFiles', 'deletedFiles']}
        | {'toolErrors': len(errors), 'toolErrorCategories': categories, 'addedRegressionTests': len(added_tests)})
attempted = [row for row in rows if row['agentStarted']]
known = [row for row in attempted if row['usage'] is not None]
for row in known:
    usage = row['usage']
    if usage['totalTokens'] != usage['inputTokens'] + usage['outputTokens']:
        raise RuntimeError('Inconsistent provider token total')
    if usage['inputTokens'] < usage['cachedInputTokens'] + usage['cacheCreationInputTokens']:
        raise RuntimeError('Cache inputs exceed canonical total')
complete = len(known) == len(attempted) and bool(attempted)
report = {key: raw.get(key) for key in ['schema', 'runId', 'mode', 'commit', 'sourceSha256', 'manifestSha256', 'harnessSha256',
    'createdAt', 'model', 'thinkingMode', 'effort', 'maxOutputTokens', 'contextWindowTokens', 'contextReserveTokens',
    'maxRequestInputBytes', 'maxToolCalls', 'timeoutMs', 'taskTimeoutMs', 'taskCap', 'suiteCap', 'consumedUsd',
    'priceSource', 'sourceUnchangedDuringRun', 'stopReason', 'limitations']}
report['totals'] = {'planned': 8, 'attempted': len(attempted), 'accepted': sum(bool(row['accepted']) for row in attempted),
    'functionalPass': sum(bool(row['functionalPass']) for row in attempted), 'usageComplete': complete,
    'providerTokens': sum(row['usage']['totalTokens'] for row in known) if complete else None,
    'knownProviderTokenSubtotal': sum(row['usage']['totalTokens'] for row in known), 'knownSamples': len(known)}
report['tasks'] = rows
report['rawResultsSha256'] = hashlib.sha256((source / 'results.json').read_bytes()).hexdigest()
(target / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
labels = ['Narcissistic\nmodule', 'Interval\nmerging', 'Quoted\nCSV', 'TTL\ncache', 'Async\nscheduler', 'Cursor\npagination', 'Atomic\ntransfers', 'Dependency\nplanner']
fig, axes = plt.subplots(2, 1, figsize=(12.4, 7.5), sharex=True)
for axis, field, factor, ylabel in [(axes[0], 'tokens', 1000, 'Provider tokens / attempt (thousands)'),
                                     (axes[1], 'time', 1000, 'Agent wall time / attempt (seconds)')]:
    for index, row in enumerate(rows):
        value = row['usage']['totalTokens'] if field == 'tokens' and row['usage'] else row['elapsedMs'] if field == 'time' else None
        if value is None:
            axis.text(index, 0.02, 'Unknown / not run', rotation=90, ha='center', transform=axis.get_xaxis_transform())
            continue
        axis.bar(index, value / factor, width=.65, color='#318473' if row['accepted'] else '#a5aab1',
                 hatch=None if row['accepted'] else '///', edgecolor='white', zorder=3)
        axis.annotate(f'{value/factor:.1f}', (index, value/factor), xytext=(0, 5), textcoords='offset points', ha='center', fontsize=9)
    axis.set_ylabel(ylabel); axis.grid(axis='y', color='#e9eaed', zorder=0); axis.margins(y=.22)
    for cut in [1.5, 3.5, 5.5]: axis.axvline(cut, color='#d4d8dc', linewidth=.8)
axes[1].set_xticks(range(len(rows)), labels[:len(rows)])
axes[1].set_xlabel('Tasks grouped by author-assigned difficulty: L1 / L2 / L3 / L4')
fig.suptitle(f'TEA coding ability — {report["totals"]["accepted"]}/{len(attempted)} accepted attempts', fontsize=17, y=.98)
fig.text(.5, .01, 'GLM-5.3-flash · low effort · one attempt/task · green: accepted; gray hatch: failed\nAll attempted samples retained. Tokens include cache inputs and output; reasoning is not added twice. Source: frozen run ' + run_id,
         ha='center', fontsize=9)
fig.tight_layout(rect=(0,.075,1,.955))
fig.savefig(target / 'coding-ability.png', dpi=200)
fig.savefig(target / 'coding-ability.svg')
plt.close(fig)

lines = ['# TEA 编码能力分级测试', '', f'运行：`{run_id}`。模型：GLM-5.3-flash，enabled thinking / low，每题一次。', '',
    f'共计划 8 题，实际运行 {len(attempted)} 题；完整验收通过 **{report["totals"]["accepted"]}/{len(attempted)}**，功能验收通过 **{report["totals"]["functionalPass"]}/{len(attempted)}**。', '',
    f'实际累计 Token：**{report["totals"]["providerTokens"]:,}**（含缓存输入及输出，思考输出不重复相加）。' if complete else '存在未知用量，累计 Token 不完整；已知子集单独记录，不将未知当作零。', '',
    '![分级测试结果](coding-ability.png)', '', '## 每题结果', '']
for row in rows:
    tokens = f'{row["usage"]["totalTokens"]:,}' if row['usage'] else '未知'
    duration = f'{row["elapsedMs"]/1000:.1f} 秒' if row['elapsedMs'] else '未记录'
    lines += [f'### L{row["level"]} · {row["title"]}', '',
        f'- 完整验收：**{"通过" if row["accepted"] else "未通过"}**；执行状态：`{row["status"]}`。',
        f'- Token：{tokens}；耗时：{duration}；工具调用：{row["toolCalls"]}；失败工具调用：{row["toolErrors"]}。',
        f'- 功能验收：{row["functionalPass"]}；原有测试：{row["publicPassed"]}；独立边界测试：{row["hiddenPassed"]}；保护文件保持：{row["protectedFilesUnchanged"]}。',
        f'- 新增回归测试文件：{row["addedRegressionTests"]}；实际验证次数：{row["validationAttempts"]}。', '']
lines += ['## 判定与范围', '', '先验证初始版本能通过公开测试且不能通过新增验收，再验证参考实现两者均通过。真实模型只看到任务工作区和题意；完整验收还要求保护文件不变、新增测试通过、任务完成且修改后运行过实际验证。功能通过与工作流通过分开记录。', '',
    '这是 8 道自编 Node.js 题的首轮诊断，难度等级由作者指定，每题仅一次，不能外推通用正确率或与以前的 Pi/Claude 不同任务数据直接比较。独立验收位于同一主机，不具有 OS 沙箱隔离。失败和未知样本均保留，无静默重试。', '',
    f'费用核算值：{raw["consumedUsd"]:.6f} USD，采用此前记录的服务商价格作为保护配置，未核验账户账单。每题保护 {raw["taskCap"]} USD，全轮 {raw["suiteCap"]} USD。', '',
    f'Agent 源码提交：`{raw["commit"]}`；源码在运行期间未变：`{raw.get("sourceUnchangedDuringRun")}`。冻结题目、工具参数与源代码指纹见 [summary.json](summary.json)；原始本地输出保留在 Git 忽略的 results 目录。', '',
    '复现方法见 [编码能力评测说明](../../../docs/CODING_ABILITY.md)。']
(target / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'report': target.relative_to(ROOT).as_posix(), 'totals': report['totals']}, ensure_ascii=False))
