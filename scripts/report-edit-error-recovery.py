"""Publish reviewed aggregate counters, never journals or raw model reasoning."""
import json
from pathlib import Path
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

run_id = sys.argv[1]
if not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run_id):
    raise ValueError('Invalid run ID')
root = Path(__file__).resolve().parents[1]
raw_dir = root / 'benchmarks/results' / run_id
raw = json.loads((raw_dir / 'comparison.json').read_text(encoding='utf-8'))
audit = json.loads((raw_dir / 'action-audit.json').read_text(encoding='utf-8'))
assert raw.get('endedAt') and not any(r['running'] for r in raw['rows'])
by_id = {r['id']: r for r in audit['rows']}
rows = [{**r, **{k: v for k, v in by_id[r['id']].items() if k != 'sequence'}} for r in raw['rows']]
totals = {}
for arm in ['baseline', 'candidate']:
    rs = [r for r in rows if r['arm'] == arm]
    known = [r for r in rs if r.get('usage')]
    totals[arm] = dict(attempts=len(rs), knownUsage=len(known),
        providerTokens=sum(r['usage']['totalTokens'] for r in known),
        knownTokenLowerBound=sum(r['knownTokenLowerBound'] for r in rs),
        unknownUsageRequests=sum(r['unknownUsageRequests'] for r in rs),
        requests=sum(r['usage']['requests'] for r in known),
        accepted=sum(r['fullAcceptanceWithProcedure'] for r in rs),
        codeBehaviorPassed=sum(r.get('codeBehaviorPass', False) for r in rs),
        protectedUnchanged=sum(r.get('protectedFilesUnchanged', False) for r in rs),
        rulesReadBeforeEdit=sum(r['ruleReadBeforeTargetEdit'] for r in rs),
        toolErrors=sum(r.get('toolErrors', 0) for r in rs),
        existingWriteErrors=sum(r['existingWriteErrors'] for r in rs),
        duplicateReads=sum(r['duplicateReadCalls'] for r in rs),
        notices=sum(r['notices'] for r in rs))
    recoveries = [e for r in rs for e in r['existingFileRecoveries']]
    totals[arm].update(existingFileErrorExposures=len(recoveries),
        recoveredExistingErrors=sum(e['recovered'] for e in recoveries),
        targetReadsBeforeRecovery=sum(e['targetReads'] for e in recoveries),
        listingsBeforeRecovery=sum(e['listings'] for e in recoveries))
complete = raw['complete'] and len(rows) == 12 and all(r.get('usage') for r in rows)
delta = (totals['candidate']['providerTokens'] / totals['baseline']['providerTokens'] - 1) * 100 if complete else None
task_ids = list(dict.fromkeys(r['taskId'] for r in rows))
task_totals = {}
for task_id in task_ids:
    task_totals[task_id] = {}
    for arm in totals:
        rs = [r for r in rows if r['taskId'] == task_id and r['arm'] == arm]
        task_totals[task_id][arm] = dict(tokens=sum(r['usage']['totalTokens'] for r in rs if r.get('usage')),
            accepted=sum(r['fullAcceptanceWithProcedure'] for r in rs), attempts=len(rs), knownUsage=sum(bool(r.get('usage')) for r in rs))
paired = []
for task_id in task_ids:
    for repeat in [1, 2]:
        pair = {r['arm']: r for r in rows if r['taskId'] == task_id and r['repeat'] == repeat}
        if len(pair) == 2 and all(r.get('usage') for r in pair.values()):
            paired.append(pair)
paired_totals = {arm: dict(tokens=sum(p[arm]['usage']['totalTokens'] for p in paired),
    requests=sum(p[arm]['usage']['requests'] for p in paired),
    accepted=sum(p[arm]['fullAcceptanceWithProcedure'] for p in paired)) for arm in totals}
paired_delta = (paired_totals['candidate']['tokens'] / paired_totals['baseline']['tokens'] - 1) * 100 if paired else None
quality_not_lower = totals['candidate']['accepted'] >= totals['baseline']['accepted'] and all(
    arms['candidate']['accepted'] >= arms['baseline']['accepted'] for arms in task_totals.values())
release_gate = complete and quality_not_lower and delta is not None and delta < 0
repeat_totals = {}
for repeat in [1, 2]:
    per_arm = {arm: sum(r['usage']['totalTokens'] for r in rows if r['repeat'] == repeat and r['arm'] == arm and r.get('usage')) for arm in totals}
    per_arm['complete'] = all(sum(r['repeat'] == repeat and r['arm'] == arm and bool(r.get('usage')) for r in rows) == len(task_ids) for arm in totals)
    per_arm['deltaPercent'] = (per_arm['candidate'] / per_arm['baseline'] - 1) * 100 if per_arm['complete'] else None
    repeat_totals[str(repeat)] = per_arm
summary = dict(runId=run_id, complete=complete, baseline=raw['engine']['baseline']['commit'], candidate=raw['engine']['candidate']['commit'],
    frozenSha256=raw['frozenSha256'], taskManifestSha256=raw['taskManifestSha256'], sourceUnchanged=raw['sourceUnchanged'],
    config=raw['config'], totals=totals, tokenDeltaPercent=delta, tasks=task_totals, rows=rows,
    completePairs=len(paired), pairedTotals=paired_totals, pairedTokenDeltaPercent=paired_delta,
    releaseGatePassed=release_gate,
    repeats=repeat_totals,
    controlSpendUsd=raw['consumedUsd'], stopReason=raw['stopReason'],
    scope=raw['scope'], limitation='Two repeats, self-authored fixtures; all-attempt token totals include failures. No causal attribution of ordinary test-repair variance to error feedback; inspect actual error exposure.')
output_name = sys.argv[2] if len(sys.argv) > 2 else run_id
if not output_name or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in output_name):
    raise ValueError('Invalid output name')
output = root / 'benchmarks/reports' / output_name
output.mkdir(parents=True, exist_ok=False)
(output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
# Keep failed samples out of cost bars; preserve their costs in the report totals.
fig, axes = plt.subplots(1, 2, figsize=(11, 4.5), layout='constrained')
colors = {'baseline': '#8B91A8', 'candidate': '#208C7B'}
for arm_i, arm in enumerate(totals):
    xs = [i + (arm_i - .5) * .34 for i in range(len(task_ids))]
    passed_by_task = [[r for r in rows if r['taskId'] == t and r['arm'] == arm and r.get('usage') and r['fullAcceptanceWithProcedure']] for t in task_ids]
    values = [sum(r['usage']['totalTokens'] for r in rs) / len(rs) / 1000 if rs else float('nan') for rs in passed_by_task]
    axes[0].bar(xs, values, width=.32, label=arm.title(), color=colors[arm])
    for i, t in enumerate(task_ids):
        rs = passed_by_task[i]
        for j, r in enumerate(rs):
            axes[0].scatter(xs[i] + (j - .5) * .065, r['usage']['totalTokens'] / 1000,
                color='#243146', marker='o', s=32, zorder=3)
        if not rs:
            axes[0].text(xs[i], 1, 'No accepted\nsamples', ha='center', fontsize=8)
    axes[1].bar(arm_i, totals[arm]['accepted'], color=colors[arm], width=.6)
    unknown = totals[arm]['attempts'] - totals[arm]['knownUsage']
    label = f"{totals[arm]['accepted']}/{totals[arm]['attempts']}" + (f"\n({unknown} stream interruption)" if unknown else '')
    axes[1].text(arm_i, totals[arm]['accepted'] + .15, label, ha='center')
axes[0].set_xticks(range(len(task_ids)), ['Small coding', 'Nested retry', 'Pagination'])
axes[0].set_ylabel('Mean provider tokens / accepted attempt (thousands)')
same_accepted_counts = len({task_totals[t][arm]['accepted'] for t in task_ids for arm in totals}) == 1
axes[0].set_title('Accepted attempts only; equal sample counts' if same_accepted_counts else 'Accepted attempts only; unequal counts')
axes[0].legend(frameon=False)
axes[1].set_xticks([0, 1], ['Baseline', 'Candidate'])
axes[1].set_ylim(0, 7)
axes[1].set_title('Full acceptance, including local procedure')
for ax in axes:
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=.15)
fig.suptitle('TEA edit-error recovery · GLM-5.3-flash\nPartial run; see report for coverage and unknown usage' if not complete else 'TEA edit-error recovery · GLM-5.3-flash', fontsize=12)
fig.savefig(output / 'edit-error-recovery.png', dpi=180)
fig.savefig(output / 'edit-error-recovery.svg')
plt.close(fig)
lines = ['# 编辑错误恢复：真实任务对照', '', f'运行：`{run_id}`。完整：{complete}。源码冻结校验：{raw["sourceUnchanged"]}。', '',
    '3 道自编题，各组各重复 2 次；同模型、思考等级、流式和任务。仅比较错误恢复反馈，两组规则发现功能相同。', '',
    f'基线：`{summary["baseline"]}`；候选：`{summary["candidate"]}`。', '', '## 全尝试结果', '']
for arm, t in totals.items():
    lines.append(f'- {arm}：完整用量样本 {t["knownUsage"]}/{t["attempts"]}，这些样本合计 {t["providerTokens"]:,} provider Tokens；含部分样本已报告用量的下界 {t["knownTokenLowerBound"]:,}，未知请求 {t["unknownUsageRequests"]}；代码行为通过 {t["codeBehaviorPassed"]}，完整验收通过 {t["accepted"]}；工具错误 {t["toolErrors"]}。')
paired_note = '已覆盖计划的全部 6 对。' if complete else '仅代表这部分配对，不能代替计划的全部 6 对。'
lines += ['', f'Token 变化：{delta:+.2f}%。' if delta is not None else '覆盖不完整，不计算完整 Token 百分比。',
    '失败用量保留在全尝试统计中；用量未知不记为零。缓存读写按 ledger 规范化口径计入，思考不重复加算。', '',
    '![结果](edit-error-recovery.png)', '', '## 用量完整的配对样本', '',
    f'共有 {len(paired)} 对。基线 {paired_totals["baseline"]["tokens"]:,} → 候选 {paired_totals["candidate"]["tokens"]:,} Tokens（{paired_delta:+.2f}%）；完整验收 {paired_totals["baseline"]["accepted"]}/{len(paired)} → {paired_totals["candidate"]["accepted"]}/{len(paired)}。{paired_note}', '', '## 分题结果', '']
for task_id, arms in task_totals.items():
    a, b = arms['baseline'], arms['candidate']
    covered = a['attempts'] == b['attempts'] and a['knownUsage'] == a['attempts'] and b['knownUsage'] == b['attempts']
    diff = (b['tokens'] / a['tokens'] - 1) * 100 if covered and a['tokens'] else None
    label = f'{diff:+.2f}%' if diff is not None else '用量覆盖不同，不计算百分比'
    lines.append(f'- {task_id}：完整用量样本成本 {a["tokens"]:,} → {b["tokens"]:,} Tokens（{label}）；完整验收 {a["accepted"]}/{a["attempts"]} → {b["accepted"]}/{b["attempts"]}。')
lines += ['', '## 重复间波动', '']
for repeat, values in repeat_totals.items():
    label = f'{values["deltaPercent"]:+.2f}%' if values['deltaPercent'] is not None else '覆盖不完整'
    lines.append(f'- 重复 {repeat}：{values["baseline"]:,} → {values["candidate"]:,} Tokens（{label}）。')
lines += ['', '## 过程审计', '']
for arm, t in totals.items():
    lines.append(f'- {arm}：适用规则在目标编辑前读取 {t["rulesReadBeforeEdit"]}/{t["attempts"]}；已有文件误用新建 {t["existingWriteErrors"]}；相同参数重复读取 {t["duplicateReads"]}；工具结果中规则提示 {t["notices"]}。')
lines += ['', '## 已有文件错误恢复', '']
for arm, t in totals.items():
    lines.append(f'- {arm}：已有文件错误暴露 {t["existingFileErrorExposures"]} 次，成功补丁恢复 {t["recoveredExistingErrors"]} 次；恢复前目标重读 {t["targetReadsBeforeRecovery"]} 次、列目录 {t["listingsBeforeRecovery"]} 次。')
lines += ['', f'冻结数值门槛通过：{release_gate}。完整覆盖、各题完整验收不下降且全尝试 Token 下降才通过；自然错误发生的任务与轮次不同，条件恢复统计仅供诊断。门槛通过不证明因果或稳定收益。', '',
    '重复读取不必然无用；“读过规则”不保证遵守。审计工具顺序不等于还原内部思维链。', '',
    f'控制费用估算 {raw["consumedUsd"]:.6f} USD，非供应商账单。停止原因：{raw["stopReason"]}。', '',
    '## 局限', '', '仅 2 次重复，含复用的自编编码题及新增局部规则，不能泛化为生产正确率或普遍 Token 收益。普通测试断言错误导致的修复轮次变化，不直接归因于错误恢复反馈。详见同目录 summary.json 和仓库中的冻结协议。']
(output / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps(dict(totals=totals, tasks=task_totals, tokenDeltaPercent=delta, directory=str(output)), ensure_ascii=False))
