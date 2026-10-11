"""Validate provider evidence and export bilingual reports plus scientific plots."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter

source, destination = map(Path, sys.argv[1:3])
test_count = int(sys.argv[3])
new_test_count = test_count - 128
report = json.loads(source.read_text(encoding='utf-8'))
if not report['complete'] or not report['sourceUnchanged']:
    raise SystemExit('An incomplete experiment or changed engine cannot produce a completed report')
runs, pairs = report['runs'], report['analysis']['pairs']
for run in runs:
    if run.get('running'):
        raise SystemExit('Experiment still running')
    if not run['usageComplete']:
        continue  # Unknowns remain visible with null totals; never fill them with zero.
    input_tokens = output_tokens = summary_tokens = 0
    for row in run['requests']:
        usage = row['usage']
        assert row['usageComplete'] and row['usageStatus'] == 'complete'
        inp = sum(usage.get(field, 0) for field in ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'])
        out = usage['output_tokens']  # Includes thinking; do not add reasoning again.
        assert inp >= 0 and out >= 0
        input_tokens += inp
        output_tokens += out
        if row['purpose'] == 'compaction':
            summary_tokens += inp + out
    assert (input_tokens, output_tokens, summary_tokens) == (run['inputTokens'], run['outputTokens'], run['summaryTokens'])
    assert input_tokens + output_tokens == run['totalTokens']
    if run['category'] == 'model-workflow' and run['accepted']:
        assert run['turns'][0]['changedFiles'] == [], 'Read-only inspection modified source'
for pair in pairs:
    if pair['knownUsage']:
        assert pair['savedTokens'] == pair['offTokens'] - pair['autoTokens']
    if pair['eligible']:
        assert abs(pair['savingsPercent'] - 100 * pair['savedTokens'] / pair['offTokens']) < 1e-9
destination.mkdir(parents=True, exist_ok=True)
(destination / 'evidence.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
                     'axes.spines.right': False, 'axes.spines.left': False, 'svg.hashsalt': report['engineSha256']})
fig, ax = plt.subplots(figsize=(13, 9))
off_color, auto_color, summary_color = '#64748b', '#27765c', '#dca444'
largest = max((r['totalTokens'] or 0) for r in runs)
labels = []
for i, pair in enumerate(pairs):
    labels.append(f"{pair['caseId']}\nrepeat {pair['pairId'].rsplit('/', 1)[1]}")
    group = [r for r in runs if f"{r['caseId']}/{r['repeat']}" == pair['pairId']]
    for variant, offset, color in [('off', -.18, off_color), ('auto', .18, auto_color)]:
        run = next((r for r in group if r['variant'] == variant), None)
        if run is None or not run['usageComplete']:
            ax.text(0, i + offset, f'{variant}: usage unknown or missing', va='center')
            continue
        summary_cost = run['summaryTokens']
        coding_cost = run['totalTokens'] - summary_cost
        hatch = None if run['accepted'] else '///'
        ax.barh(i + offset, coding_cost, height=.3, color=color, hatch=hatch)
        if summary_cost:
            ax.barh(i + offset, summary_cost, left=coding_cost, height=.3, color=summary_color, hatch=hatch)
        ax.text(run['totalTokens'] + largest * .015, i + offset,
                f"{run['totalTokens']:,} | {'PASS' if run['accepted'] else 'FAIL'}", va='center', fontsize=9)
ax.set_yticks(range(len(pairs)), labels)
ax.invert_yaxis()
ax.set_xlim(0, largest * 1.32)
ax.xaxis.set_major_formatter(FuncFormatter(lambda n, _: f'{n:,.0f}'))
ax.set_xlabel('Provider input + output tokens (including all summary requests)')
ax.grid(axis='x', alpha=.14)
ax.set_axisbelow(True)
ax.legend(handles=[Patch(color=off_color, label='Compaction off'), Patch(color=auto_color, label='Auto: coding'),
                   Patch(color=summary_color, label='Auto: summarization')], loc='upper right')
fig.suptitle('TEA conversation compaction: paired GLM-5.3-flash measurements', fontsize=16, fontweight='bold', y=.97)
fig.text(.02, .018, 'Self-authored JS fixtures; 2 repeats per case. Scripted seed stress and model-generated workflow are reported separately.\n'
         'Same model, enabled thinking / low effort; native summary cap 1,200, coding cap 4,096. Byte threshold tuned to 35%; default auto remains off.\n'
         f'Run: {destination.name}; measured engine: {report["engineCommit"][:12]}; source hash: {report["engineSha256"][:12]}.', fontsize=9, color='#475569')
fig.tight_layout(rect=[0, .09, 1, .94])
for extension in ['png', 'svg']:
    artifact = destination / f'tokens.{extension}'
    fig.savefig(artifact, dpi=180, metadata={'Creator': 'TEA'})
    if extension == 'svg':
        # Matplotlib emits trailing spaces inside path data; normalize for Git.
        artifact.write_text('\n'.join(line.rstrip() for line in artifact.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
plt.close(fig)

categories = report['analysis']['categories']
case_lines = []
for case in report['cases']:
    selected = [p for p in pairs if p['caseId'] == case['id']]
    eligible = [p for p in selected if p['eligible']]
    off = sum(p['offTokens'] for p in eligible)
    auto = sum(p['autoTokens'] for p in eligible)
    percent = f'{100 * (off - auto) / off:.2f}%' if off else 'unknown'
    variations = ', '.join(f"{p['savingsPercent']:.2f}%" if p['eligible'] else 'failed/unknown' for p in selected)
    summaries = sum(r['summaryTokens'] or 0 for r in runs if r['caseId'] == case['id'] and r['variant'] == 'auto')
    case_lines.append((case, off, auto, percent, variations, summaries, len(eligible), len(selected)))
def category_line(name, zh=False):
    c = categories[name]
    gain = f"{c['savingsPercent']:.2f}%" if c['savingsPercent'] is not None else 'unknown'
    return (f"{c['offTokens']:,} → {c['autoTokens']:,} Token，净节省 **{gain}**，有效配对 {c['eligiblePairs']}/{c['pairs']}。" if zh
            else f"{c['offTokens']:,} → {c['autoTokens']:,} tokens; net savings **{gain}**; eligible pairs {c['eligiblePairs']}/{c['pairs']}.")
spend = report['analysis']['conservativeSpendUsd']
p = report['profile']
common = (f"{report['model']}; {p['thinkingMode']} thinking; {p['effort']} effort; "
          f"coding output {p['taskMaxOutputTokens']:,}; summary output {p['summaryMaxOutputTokens']:,} "
          f"(thinking budget {p['summaryMaxOutputTokens'] - 1:,}); {p['maxRequestWireBytes']:,} UTF-8 wire bytes; "
          f"trigger {p['triggerRatio']}; recent retention {p['keepRecentBytes']:,} bytes; history {p['historyStrategy']}; "
          f"v1 context; {p['maxCompactionAttemptsPerTurn']} attempts/turn; {p['maxToolCallsPerTurn']} tools/turn; "
          f"{p['maxRequestsPerRun']} requests/run; {p['requestTimeoutMs'] / 1000:g} s/request; "
          f"{p['turnTimeoutMs'] / 1000:g} s/turn; ${p['perRunBudgetUsd']:.2f}/run; "
          f"${p['totalBudgetUsd']:.7f} cap for this experiment.")
en = f"""# Conversation compaction validation — 2026-10-11

[中文](README.zh-CN.md)

## Results

- Scripted seed stress: {category_line('seeded-stress')}
- Model-generated inspection → repair workflow: {category_line('model-workflow')}
- Acceptance: **{report['analysis']['acceptedRuns']}/{len(runs)}** runs passed public tests, independent hidden tests, edit scope and task completion. Unknown usage: {report['analysis']['unknownUsageRuns']}.
- All summary requests are included in these totals, including rejected summaries. Conservative spend: **${spend:.6f}**; this is not an invoice.

![Provider tokens including summaries](tokens.png)

## Individual cases

"""
zh = f"""# 会话压缩专项测试与真实 Token 收益 — 2026-10-11

[English](README.md)

## 结果

- 固定历史压力测试：{category_line('seeded-stress', True)}
- 模型自行生成历史的“检查 → 修复”多轮任务：{category_line('model-workflow', True)}
- 验收 **{report['analysis']['acceptedRuns']}/{len(runs)}**：同时要求公开测试、独立隐藏测试、修改范围和任务完成。未知 usage {report['analysis']['unknownUsageRuns']} 次。
- 所有摘要请求均计入总 Token，包括被拒绝的摘要。保守费用 **${spend:.6f}**，不是账户账单。

![包含摘要费用的真实 Token](tokens.png)

## 各案例

"""
for case, off, auto, percent, variations, summaries, eligible, total in case_lines:
    en += f"- **{case['id']}** ({case['fileCount']:,} files, {case['lines']:,} lines, seed {case['seed']['bytes']:,} bytes): {off:,} → {auto:,}; net savings {percent}; repeats {variations}; summary tokens {summaries:,}; eligible {eligible}/{total}.\n"
    zh += f"- **{case['id']}**（{case['fileCount']:,} 文件、{case['lines']:,} 行，固定历史 {case['seed']['bytes']:,} 字节）：{off:,} → {auto:,}，净节省 {percent}；各轮 {variations}；摘要消耗 {summaries:,}；有效配对 {eligible}/{total}。\n"
untriggered = ', '.join(f"{r['caseId']}/{r['repeat']}" for r in runs if r['variant'] == 'auto' and r['summaryRequests'] == 0)
if untriggered:
    en += f"\nPairs with no summary request: **{untriggered}**. Their token differences are stochastic variation and cannot be attributed to compaction.\n"
    zh += f"\n未提交摘要的配对：**{untriggered}**。这些配对的 Token 差异不能归因于压缩，只能视为模型随机波动。\n"
en += f"""
## Method and reproducibility

{common}

Each pair starts from the same pinned Git commit and task prompts. Run order alternates off/auto then auto/off. No automatic retry; unknown billing retains the full reservation and stops the experiment. Cases contain 12, 120 or 1,200 files. Scripted setup executes real read-only tools and provides identical messages to both sides; **it is not a naturally model-generated conversation**. The workflow case uses a fresh session and pays for every model request from inventory inspection through repair; its inspection phase must leave source unchanged.

Input totals include ordinary, cache-read and cache-write input. Thinking already included in provider output is not added again. Byte reduction is never substituted for measured token savings. Successful-pair rates exclude failed, missing or unknown runs; those runs and their spend remain in [evidence.json](evidence.json) and the chart.

Engine commit `{report['engineCommit']}`; measured source hash `{report['engineSha256']}` remained unchanged throughout the experiment. Initial fixture commits, seed hashes, prompts, controls, per-request usage, checkpoint/rejection records and acceptance hashes are in the public evidence. No keys, raw model messages or runtime workspace paths are published.

Re-run `npm test` for deterministic coverage. Set credentials and explicit rates in environment, plus the recorded profile, then run `node scripts/compare-compaction.mjs benchmarks/results/<new-directory>`. Export with `python scripts/report-compaction.py <comparison.json> <report-directory> <verified-full-suite-count>`; Matplotlib is required only for plotting. Existing output is never overwritten by the paid runner.

## Dedicated tests and limits

**{new_test_count} new tests; full suite {test_count}/{test_count} passed on Windows / Node 24.14.0.** Coverage includes complete tool batches, malformed history, repeated and partial summaries, latest-user retention, retained thinking/signatures, Unicode excerpts, invalid/truncated/non-reducing summaries, source cache invalidation, cancellation before and during ledger commit, ledger failure, pending validation, /new, finite automatic attempts, shared adapter budgets, unknown billing, summary cache accounting and negative/failed experiment pairs.

This is eight paired measurements on self-authored JavaScript fixtures, with two repetitions per case and one model/provider. It does not establish long-session semantic retention, unseen real-repository generalization, or a comparison with Pi. The 35% threshold is an experimental setting; these figures do not measure the default 80% trigger. Automatic compaction remains opt-in. The output caps differ by purpose as recorded above, equally for every variant that submits that purpose. Actual latency and stochastic tool choices vary; token reductions need not imply lower latency. The short control never triggers a summary: its positive or negative differences are stochastic variation, not evidence of compaction benefit. Compact-tools interaction has not been measured live in this experiment.

Published rates were rechecked on 2026-10-11: [Packy pricing API](https://www.packyapi.ai/api/pricing), model ratio 0.4, completion ratio 3.5 and applicable group ratio 1, interpreted using [New API billing formulas](https://docs.newapi.pro/en/docs/guide/console/settings/rate-settings). Conservative rates are $0.80/$2.80 per million input/output; cache read receives no discount and cache creation uses twice input for budgeting.
"""
zh += f"""
## 方法和复现

共同配置：{common}

每组从相同固定 Git 快照、相同任务开始，两轮按 off/auto、auto/off 交替顺序。没有自动重试；未知计费保留完整预留并停止实验。项目规模为 12、120、1,200 文件。固定历史由脚本真实调用只读工具生成，两边输入完全相同；**这部分不是模型自然产生的完整会话**。多轮任务从空会话开始，检查目录到修复的全部模型请求都计费，检查阶段要求源码不变。

总输入包括普通输入、缓存读取和缓存写入。思考已含在供应商输出中，不重复相加。字节缩减不充当 Token 收益。收益率只统计双方验收通过且 usage 完整的配对；失败、缺失、未知及其费用仍留在[公开证据](evidence.json)和图中。

实测引擎 commit `{report['engineCommit']}`；源码哈希 `{report['engineSha256']}`，实验期间未变。公开证据包含初始快照、历史哈希、任务、全部参数、逐请求 usage、压缩/拒绝事件和验收哈希；不发布密钥、原始模型消息或运行工作区路径。

`npm test` 运行确定性测试。凭据与明确单价放入环境变量，使用记录的配置，执行 `node scripts/compare-compaction.mjs benchmarks/results/<新目录>`。`python scripts/report-compaction.py <comparison.json> <报告目录> <实际通过的全套测试数>` 校验并绘图，仅绘图需要 Matplotlib。付费执行器不会覆盖旧结果目录。

## 专项测试和限制

新增 **{new_test_count} 项**测试，全套 **{test_count}/{test_count}** 在 Windows 通过。覆盖完整工具配对、异常历史、重复/部分压缩、用户原文保留、近期思考与签名原样保留、Unicode、摘要格式/截断/无收益拒绝、源码缓存清理、账本提交前与提交期间取消、账本失败、待验证状态、/new、自动尝试上限、共享预算、未知计费、摘要缓存用量、负收益及失败配对。

只有 8 组配对、每案例 2 轮、一个模型与供应商，样本是自编 JavaScript 项目。尚不能证明长期语义保留、未见真实仓库的泛化能力或优于 Pi。35% 为实验阈值，不是默认 80% 的收益；自动压缩仍默认关闭。不同用途的输出上限如上记录，提交相同用途时配置相同。Token 减少不保证耗时减少，工具选择有随机波动；短会话对照组没有触发摘要，其正负差异只能视为随机波动，不能归因为压缩收益。本轮没有真实测量与 compact-tools 叠加的收益。

2026-10-11 重查[公开价格 API](https://www.packyapi.ai/api/pricing)：模型倍率 0.4、输出倍率 3.5、适用分组倍率 1，依据[计费公式](https://docs.newapi.pro/en/docs/guide/console/settings/rate-settings)，输入/输出采用每百万 $0.80/$2.80；缓存读不打折，缓存写按双倍输入做预算。费用是保守估算，不是账户账单。
"""
(destination / 'README.md').write_text(en, encoding='utf-8')
(destination / 'README.zh-CN.md').write_text(zh, encoding='utf-8')
print(json.dumps({'accepted': report['analysis']['acceptedRuns'], 'runs': len(runs), 'categories': categories, 'spendUsd': spend}))
