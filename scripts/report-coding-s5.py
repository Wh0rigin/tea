"""Frozen S5 coding comparison: all costs retained; independent quality dimensions."""
import hashlib,json,pathlib,statistics,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
run_id=sys.argv[1]
if not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run_id):raise ValueError('Invalid run ID')
source=ROOT/'benchmarks/results'/run_id/'comparison.json'
raw=json.loads(source.read_text(encoding='utf8'))
if raw['mode']!='live' or not raw.get('endedAt') or any(x['running'] for x in raw['rows']):raise RuntimeError('Ended live run required')
metrics=['repairGuidanceResults','validationTimeoutResults','validationFailureResults','commandTimeouts','retriesAfterTimeoutWithoutEdit']
keys=['id','taskId','title','level','repeat','arm','status','accepted','functionalPass','validationPassed','validationAttempts','toolCalls',
      'toolErrors','writeExistingErrors','usageComplete','usage','protectedFilesUnchanged','allowedChanges','publicPassed','hiddenPassed',
      'hiddenCompleted','addedTestsPassed','elapsedMs','accountedUsd','singleReadCalls','logicalReadAttempts','firstRequestInputTokens','changedFiles','deletedFiles']+metrics
rows=[{key:x.get(key) for key in keys} for x in raw['rows']]
for original,row in zip(raw['rows'],rows):
    row['codeBehaviorPass']=bool(row['publicPassed'] and row['hiddenPassed'] and row['addedTestsPassed'])
    if original.get('codeBehaviorPass') is not None and original['codeBehaviorPass']!=row['codeBehaviorPass']:raise RuntimeError('Code grade changed')
    if row['usage'] and row['usage']['totalTokens']!=row['usage']['inputTokens']+row['usage']['outputTokens']:raise RuntimeError('Usage inconsistent')
complete=raw['complete'] and raw['sourceUnchanged'] and len(rows)==48 and all(x['usage'] is not None and x['usageComplete'] for x in rows)
arms={arm:[x for x in rows if x['arm']==arm] for arm in ['baseline','candidate']}
def aggregate(samples):
    known=bool(samples) and all(x['usage'] is not None for x in samples)
    result={'attempted':len(samples),'accepted':sum(bool(x['accepted']) for x in samples),'codeBehaviorPass':sum(x['codeBehaviorPass'] for x in samples),
        'providerTokens':sum(x['usage']['totalTokens'] for x in samples) if known else None,
        'knownTokenSubtotal':sum(x['usage']['totalTokens'] for x in samples if x['usage']),
        'attemptsWithRepairGuidance':sum(bool(x['repairGuidanceResults']) for x in samples)}
    for key in ['toolCalls','toolErrors','writeExistingErrors','singleReadCalls']+metrics:result[key]=sum(x.get(key) or 0 for x in samples)
    for key in ['inputTokens','outputTokens','cachedInputTokens','cacheCreationInputTokens','requests','compactionRequests']:
        result[key]=sum(x['usage'][key] or 0 for x in samples) if known else None
    return result
totals={arm:aggregate(samples) for arm,samples in arms.items()}
by_task=[{'id':p['id'],'title':next((x['title'] for x in rows if x['taskId']==p['id']),p['id']),
    **{arm:aggregate([x for x in samples if x['taskId']==p['id']]) for arm,samples in arms.items()}} for p in raw['preflight']]
quality_ok=complete and all(totals['candidate'][key]>=totals['baseline'][key] and all(x['candidate'][key]>=x['baseline'][key] for x in by_task)
    for key in ['accepted','codeBehaviorPass'])
change=100*(totals['candidate']['providerTokens']/totals['baseline']['providerTokens']-1) if complete else None
gate=quality_ok and change<0
per_repeat=[{'repeat':n,**{arm:aggregate([x for x in samples if x['repeat']==n]) for arm,samples in arms.items()}} for n in [1,2,3]]
matched=[]
for b in arms['baseline']:
    c=next((x for x in arms['candidate'] if x['taskId']==b['taskId'] and x['repeat']==b['repeat']),None)
    if c and b['accepted'] and c['accepted'] and b['usage'] and c['usage']:matched.append((b,c))
matched_totals={arm:sum(pair[i]['usage']['totalTokens'] for pair in matched) for i,arm in enumerate(arms)}
matched_change=100*(matched_totals['candidate']/matched_totals['baseline']-1) if matched_totals['baseline'] else None
pair_changes=[100*(c['usage']['totalTokens']/b['usage']['totalTokens']-1) for b,c in matched]
first_pairs={}
for row in rows:
    location=json.loads((source.parent/(row['id']+'-workspace.json')).read_text(encoding='utf8'))
    ledger=pathlib.Path(location['workspace'])/'.tea/runs/agent/ledger.jsonl'
    if not ledger.exists():
        if row['usage']:raise RuntimeError('Missing ledger for known usage')
        continue
    records=[json.loads(line) for line in ledger.read_text(encoding='utf8').splitlines()]
    requests=[x for x in records if x['type']=='model_request']
    if row['usage'] and sum((x.get('reportedInputTokens') or 0)+(x.get('reportedOutputTokens') or 0) for x in requests)!=row['usage']['totalTokens']:raise RuntimeError('Ledger/summary mismatch')
    if requests and isinstance(requests[0].get('reportedInputTokens'),int):first_pairs.setdefault((row['taskId'],row['repeat']),{})[row['arm']]=requests[0]['reportedInputTokens']
first_deltas=[p['candidate']-p['baseline'] for p in first_pairs.values() if len(p)==2]
audit=json.loads((source.parent/'feedback-audit.json').read_text(encoding='utf8'))
if audit['partial'] or (complete and audit['completedAttempts']!=len(rows)):raise RuntimeError('Complete audit required')
controls=json.loads((source.parent/'feedback-controls.json').read_text(encoding='utf8'))
report={key:raw.get(key) for key in ['schema','runId','createdAt','endedAt','engine','harnessSha256','harnessNormalizedSha256','manifestSha256','repeats','planned','config','hypothesis','scope','gate','stopReason','sourceUnchanged','consumedUsd','preflight','fixedDefinitions','candidateFlag']}
report.update({'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverageComplete':complete,'totals':totals,'changePercent':change,
    'bothAcceptedPairs':{'count':len(matched),'totals':matched_totals,'changePercent':matched_change,'candidateLowerPairs':sum(x<0 for x in pair_changes),'medianPairChangePercent':statistics.median(pair_changes) if pair_changes else None},
    'qualityGatePassed':quality_ok,'gatePassed':gate,'qualityGateMeaning':'Full acceptance and independent code behavior must not decline overall or in any task family',
    'firstInputDeltas':first_deltas,'feedbackAudit':audit,'feedbackControls':controls,'perTask':by_task,'perRepeat':per_repeat,'rows':rows})
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')

plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,(ax,failed_ax)=plt.subplots(2,1,figsize=(12.5,8.4),sharex=True,gridspec_kw={'height_ratios':[3,1.3],'hspace':.28})
colors={'baseline':'#8c83b8','candidate':'#318473'}
for i,family in enumerate(by_task):
    for arm,shift in [('baseline',-.18),('candidate',.18)]:
        samples=[x for x in rows if x['taskId']==family['id'] and x['arm']==arm]
        passed=[x for x in samples if x['accepted'] and x['usage']]
        if passed:ax.bar(i+shift,statistics.mean(x['usage']['totalTokens'] for x in passed)/1000,width=.34,color=colors[arm],edgecolor='white',zorder=2)
        else:ax.annotate('n/a',(i+shift,0),xytext=(0,6),textcoords='offset points',ha='center',fontsize=8,color=colors[arm])
        for n,x in enumerate(samples):
            if x['usage']:
                axis=ax if x['accepted'] else failed_ax
                axis.scatter(i+shift+(n-1)*.065,x['usage']['totalTokens']/1000,marker='o' if x['accepted'] else 'x',s=28,color=colors[arm],edgecolors='white' if x['accepted'] else None,zorder=3)
        ax.annotate(f'{len(passed)}/{len(samples)}',(i+shift,0),xytext=(0,-15),textcoords='offset points',ha='center',fontsize=8)
ax.set_title('Accepted samples only — bars: mean; dots: each accepted attempt',fontsize=11)
ax.set_ylabel('Provider tokens / attempt (thousands)');ax.grid(axis='y',color='#e8eaed',zorder=0);ax.margins(y=.15)
ax.legend(handles=[Patch(facecolor=colors['baseline'],label='Direct parent'),Patch(facecolor=colors['candidate'],label='S5 test repair feedback')],frameon=False)
ax.set_xticks(range(8),['Narcissistic\nmodule','Interval\nmerging','Quoted\nCSV','TTL\ncache','Async\nscheduler','Cursor\npagination','Atomic\ntransfers','Dependency\nplanner'])
failed_ax.tick_params(axis='x',pad=10);failed_ax.set_ylabel('Failed attempts\n(thousands)');failed_ax.set_xlabel('Tasks; acceptance counts below upper bars')
failed_ax.grid(axis='y',color='#e8eaed');failed_ax.set_ylim(bottom=0)
failed_ax.set_title('Failed attempt costs — separate scale; included in all-attempt totals',fontsize=10)
fig.suptitle('S5 coding experiment — '+('three attempts per task and arm' if complete else 'incomplete; three attempts planned per task and arm'),fontsize=16,y=.97)
fig.text(.5,.02,'Upper panel: accepted samples only. Lower panel: failed attempts, separate scale (all costs retained).\nGLM-5.3-flash · enabled / low · 4,096 output cap · alternating order · self-authored Node.js fixtures. Source: '+run_id,ha='center',fontsize=9)
fig.subplots_adjust(left=.09,right=.98,bottom=.21,top=.88);fig.savefig(target/'s5-coding.png',dpi=200);fig.savefig(target/'s5-coding.svg');plt.close(fig)
svg=target/'s5-coding.svg';svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf8').splitlines())+'\n',encoding='utf8')

lines=['# S5 编码 Token 优化实验','','修改：仅在验证失败时反馈任务约定/断言核查建议，或对执行器命令超时提供诊断后再重试的建议。未添加固定提示、工具或自动执行；原始输出、验证与权限保持不变。实验 SDK 开关 testRepairFeedback 默认关闭。','',
    f'八题 × 三次 × 两个版本 = 48 次计划；已结束 {len(rows)} 次，覆盖及用量完整：{complete}。','',
    f'完整验收：{totals["baseline"]["accepted"]}/24 → {totals["candidate"]["accepted"]}/24。',
    f'独立代码行为（原有、新增及隐藏测试）：{totals["baseline"]["codeBehaviorPass"]}/24 → {totals["candidate"]["codeBehaviorPass"]}/24。','']
if complete:lines += [f'所有尝试累计 provider Token：{totals["baseline"]["providerTokens"]:,} → {totals["candidate"]["providerTokens"]:,}，候选 **{"增加" if change>=0 else "减少"} {abs(change):.2f}%**。','']
else:lines += ['覆盖或用量不完整，不给出整组 Token 变化百分比；未知没有被按零计入。','']
lines += [f'质量门槛（总体及逐题的完整验收和代码行为不下降）：{quality_ok}；综合采用门槛：**{gate}**。','',
    'Token 包含缓存输入，思考包含在输出中且不重复累加；来自 provider，不使用字符或字节估算。','',
    '![S5 逐题对照](s5-coding.png)','','## 每题结果','']
for x in by_task:
    a=x['baseline'];b=x['candidate'];lines += [f'- **{x["title"]}**：完整验收 {a["accepted"]}/3 → {b["accepted"]}/3；代码行为 {a["codeBehaviorPass"]}/3 → {b["codeBehaviorPass"]}/3；累计 Token {a["providerTokens"]} → {b["providerTokens"]}。']
lines += ['',f'双方均通过：{len(matched)} 对；累计 Token {matched_totals["baseline"]:,} → {matched_totals["candidate"]:,}；变化 {round(matched_change,2) if matched_change is not None else "未知"}%。子集不替代整组结果。','','## 每轮结果','']
for x in per_repeat:
    a=x['baseline'];b=x['candidate'];delta=100*(b['providerTokens']/a['providerTokens']-1) if a['providerTokens'] and b['providerTokens'] is not None else None
    lines += [f'- 第 {x["repeat"]} 轮：验收 {a["accepted"]}/8 → {b["accepted"]}/8；代码行为 {a["codeBehaviorPass"]}/8 → {b["codeBehaviorPass"]}/8；Token {a["providerTokens"]} → {b["providerTokens"]}；变化 {round(delta,2) if delta is not None else "未知"}%。']
lines += ['','## 实际触发及修复轨迹','']
for arm,x in totals.items():
    a=audit['totals'][arm];lines += [f'- {arm}：新反馈触发任务 {x["attemptsWithRepairGuidance"]}/24，结果 {x["repairGuidanceResults"]} 次；验证失败反馈 {x["validationFailureResults"]} 次，命令超时 {x["commandTimeouts"]} 次，其中新超时分类 {x["validationTimeoutResults"]} 次；超时后无成功文件编辑的同命令重试 {x["retriesAfterTimeoutWithoutEdit"]} 次。',
        f'  新反馈之后源码/测试编辑 {a["sourceEditsAfterGuidance"]}/{a["testEditsAfterGuidance"]} 次，模型请求 {a["modelRequestsAfterGuidance"]} 次。']
lines += ['',f'总模型请求 {totals["baseline"]["requests"]} → {totals["candidate"]["requests"]}；工具错误 {totals["baseline"]["toolErrors"]} → {totals["candidate"]["toolErrors"]}。',
    '计数由实时观察器与加密日志逐项交叉验证。重试计数不判断是否有新的诊断证据，反馈后的编辑也不单独证明因果改善。未触发的独立任务用量变化不能归因于 S5。','','## 无固定开销控制','',
    f'冻结引擎的离线首次请求完全相同：{controls["firstRequest"]["identical"]}；序列化 {controls["firstRequest"]["bytes"]} 字节，不调用 API。']
for c in controls['controls']:lines += [f'- {c["kind"]}：反馈一致 {c["identical"]}，JSON 字节 {c["baseline"]["bytes"]} → {c["candidate"]["bytes"]}。']
if first_deltas:lines += ['',f'真实首次输入配对差（候选减基线）均值 {statistics.mean(first_deltas):.2f} Token，范围 {min(first_deltas)}–{max(first_deltas)}；独立临时工作区标识可能造成分词差异。']
lines += ['','新失败反馈本身更长，且会随历史发送；能否减少往返必须由实测判断。离线字节差不是 provider Token 收益。','','## 未通过样本','']
for x in rows:
    if not x['accepted']:lines += [f'- {x["id"]}：status={x["status"]}；public={x["publicPassed"]}；hidden={x["hiddenPassed"]}；addedTests={x["addedTestsPassed"]}；protectedFiles={x["protectedFilesUnchanged"]}；allowedChanges={x["allowedChanges"]}；validation={x["validationPassed"]}；Token={x["usage"]["totalTokens"] if x["usage"] else "未知"}。']
lines += ['','## 方法与限制','','固定相同模型、思考模式、等级、输出上限、初始源码及验收；同题交替先运行版本。每次新工作区，源码和入口冻结，八题初始/参考控制先于付费调用。有限预算、超时，用量未知停止，不付费重试；所有失败保留。',
    '', '柱形图仅含成功样本；失败成本在独立刻度显示，同时计入全量累计。三个重复为自编任务诊断证据，不证明统计显著性、生产泛化或所有模型适用。两条独立模型轨迹的差异不等于新反馈的因果效果。','',
    '原始日志和工作区私有；公开字段、配置指纹、逐次结果与审计计数见 [summary.json](summary.json)。','','## 采用决定','',
    '满足预设门槛，候选保持默认关闭，等待审核。' if gate else '未满足预设门槛，按方案不采用运行时变动；最终代码与回归验证见阶段文档。',
    '', 'S1/S2/S3/S4 运行时变动未纳入本轮；阶段结束等待审核，不继续下一项。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'gatePassed':gate,'changePercent':change,'totals':totals},ensure_ascii=False))
