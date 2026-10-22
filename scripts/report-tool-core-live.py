"""Frozen Tool core coding comparison: all costs retained; independent quality dimensions."""
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
metrics=['successfulEdits','validationToolResults','commandTimeouts']
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
        'attemptsWithSuccessfulEdits':sum(bool(x['successfulEdits']) for x in samples)}
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
matched_totals={arm:sum(pair[i]['usage']['totalTokens'] for pair in matched) if matched else None for i,arm in enumerate(arms)}
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
    if requests and requests[0].get('usageComplete') and isinstance(requests[0].get('reportedInputTokens'),int):first_pairs.setdefault((row['taskId'],row['repeat']),{})[row['arm']]=requests[0]['reportedInputTokens']
    elif requests:row['firstRequestInputTokens']=None
first_deltas=[p['candidate']-p['baseline'] for p in first_pairs.values() if len(p)==2]
audit=json.loads((source.parent/'tool-core-audit.json').read_text(encoding='utf8'))
if audit['auditedAttempts']!=len(rows):raise RuntimeError('Complete audit required')
parity=json.loads((ROOT/'benchmarks/reports/tool-core-parity-20261016/summary.json').read_text(encoding='utf8'))
assert parity['paidCalls']==0 and not parity['providerTokensMeasured']
assert all(x['identical'] for x in parity['definitions']) and all(x['identical'] for x in parity['conversations'])

report={key:raw.get(key) for key in ['schema','runId','createdAt','endedAt','engine','harnessSha256','harnessNormalizedSha256','manifestSha256','repeats','planned','config','hypothesis','scope','gate','stopReason','sourceUnchanged','consumedUsd','preflight','fixedDefinitions','candidateFlag']}
report.update({'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverageComplete':complete,'totals':totals,'changePercent':change,
    'bothAcceptedPairs':{'count':len(matched),'totals':matched_totals,'changePercent':matched_change,'candidateLowerPairs':sum(x<0 for x in pair_changes),'medianPairChangePercent':statistics.median(pair_changes) if pair_changes else None},
    'qualityGatePassed':quality_ok,'gatePassed':gate,'qualityGateMeaning':'Full acceptance and independent code behavior must not decline overall or in any task family',
    'firstInputDeltas':first_deltas,'executionAudit':audit,'offlineParity':parity,'perTask':by_task,'perRepeat':per_repeat,'rows':rows})
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')

plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,(ax,failed_ax)=plt.subplots(2,1,figsize=(12.5,8.4),sharex=True,gridspec_kw={'height_ratios':[3,1.3],'hspace':.28})
colors={'baseline':'#8c83b8','candidate':'#318473'}
plot_tasks=[x for x in by_task if x['baseline']['attempted'] or x['candidate']['attempted']]
for i,family in enumerate(plot_tasks):
    for arm,shift in [('baseline',-.18),('candidate',.18)]:
        samples=[x for x in rows if x['taskId']==family['id'] and x['arm']==arm]
        passed=[x for x in samples if x['accepted'] and x['usage']]
        if passed:ax.bar(i+shift,statistics.mean(x['usage']['totalTokens'] for x in passed)/1000,width=.34,color=colors[arm],edgecolor='white',zorder=2)
        else:ax.annotate('n/a',(i+shift,0),xytext=(0,6),textcoords='offset points',ha='center',fontsize=8,color=colors[arm])
        for n,x in enumerate(samples):
            if x['usage']:
                axis=ax if x['accepted'] else failed_ax
                axis.scatter(i+shift+(n-1)*.065,x['usage']['totalTokens']/1000,marker='o' if x['accepted'] else 'x',s=28,color=colors[arm],edgecolors='white' if x['accepted'] else None,zorder=3)
        unknown=sum(x['usage'] is None for x in samples)
        if unknown:failed_ax.text(i+shift,.5,f'{unknown} unknown\n(provider usage)',transform=failed_ax.get_xaxis_transform(),ha='center',va='center',color=colors[arm])
        ax.annotate(f'{len(passed)}/{len(samples)}',(i+shift,0),xytext=(0,-15),textcoords='offset points',ha='center',fontsize=8)
ax.set_title('Accepted samples only — bars: mean; dots: each accepted attempt',fontsize=11)
ax.set_ylabel('Provider tokens / attempt (thousands)');ax.grid(axis='y',color='#e8eaed',zorder=0);ax.margins(y=.15)
ax.legend(handles=[Patch(facecolor=colors['baseline'],label='Direct parent'),Patch(facecolor=colors['candidate'],label='Unified tool core')],frameon=False)
labels=dict(zip([x['id'] for x in by_task],['Narcissistic\nmodule','Interval\nmerging','Quoted\nCSV','TTL\ncache','Async\nscheduler','Cursor\npagination','Atomic\ntransfers','Dependency\nplanner']))
ax.set_xticks(range(len(plot_tasks)),[labels[x['id']] for x in plot_tasks])
failed_ax.tick_params(axis='x',pad=10);failed_ax.set_ylabel('Failed attempts\n(thousands)');failed_ax.set_xlabel('Tasks; acceptance counts below upper bars')
failed_ax.grid(axis='y',color='#e8eaed');failed_ax.set_ylim(bottom=0)
failed_ax.set_title('Failed attempt costs — separate scale; included in all-attempt totals',fontsize=10)
if not any(not x['accepted'] and x['usage'] for x in rows):failed_ax.set_yticks([]);failed_ax.set_ylabel('Unknown usage\nnot plotted as zero')
fig.suptitle('Tool core coding experiment — '+('three attempts per task and arm' if complete else 'incomplete; three attempts planned per task and arm'),fontsize=16,y=.97)
fig.text(.5,.02,'Upper panel: accepted samples only. Lower panel: failed attempts, separate scale (all costs retained).\nGLM-5.3-flash · enabled / low · 4,096 output cap · alternating order · self-authored Node.js fixtures. Source: '+run_id,ha='center',fontsize=9)
fig.subplots_adjust(left=.09,right=.98,bottom=.21,top=.88);fig.savefig(target/'tool-core-coding.png',dpi=200);fig.savefig(target/'tool-core-coding.svg');plt.close(fig)
svg=target/'tool-core-coding.svg';svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf8').splitlines())+'\n',encoding='utf8')

lines=['# 统一工具层：真实 Token 配对实验','','候选为 ToolContext / ToolSpec / ToolService 架构重构，模型侧参数与工具语义保持一致。离线等价检查不是 provider 用量测量，本报告记录真实独立任务轨迹。','',
 f'原八道自编 Node.js 编码题 × 三轮 × 两版本，共计划 48 次；结束 {len(rows)} 次，覆盖/用量完整：{complete}。','']
if complete:lines += [f'完整验收：{totals["baseline"]["accepted"]}/24 → {totals["candidate"]["accepted"]}/24；独立代码行为：{totals["baseline"]["codeBehaviorPass"]}/24 → {totals["candidate"]["codeBehaviorPass"]}/24。','']
if complete:lines += [f'全尝试累计 provider Token：**{totals["baseline"]["providerTokens"]:,} → {totals["candidate"]["providerTokens"]:,}，候选{ "增加" if change>=0 else "减少"} {abs(change):.2f}%**。','']
else:lines += ['覆盖或用量不完整，不给整组收益百分比；未知不按零。','']
if audit['totals']['candidate']['incompleteStreamRequests']:
 lines += ['**候选存在缺少 message_stop 的上游流响应。** 用量未知的请求保留预留；该样本不能用于推断架构导致编码正确率下降。若在任何工具执行前失败，也不能视为新增工具执行错误。','']
lines += [f'总体及逐题质量门槛：{quality_ok}；完整用量、质量不下降且 Token 更低的数值门槛：{gate}。','',
 'Token 包含全部缓存输入、输出中的思考；缓存和思考不重复累加。独立随机生成的差额不等于内部架构重构的因果效应。','',
 '![逐题用量](tool-core-coding.png)','','## 每题结果','']
for x in by_task:
 if not x['baseline']['attempted'] and not x['candidate']['attempted']:continue
 a=x['baseline'];b=x['candidate'];lines += [f'- {x["title"]}：完整验收 {a["accepted"]}/3 → {b["accepted"]}/3；代码行为 {a["codeBehaviorPass"]}/3 → {b["codeBehaviorPass"]}/3；累计 Token {a["providerTokens"]} → {b["providerTokens"]}。']
lines += ['','## 每轮结果','']
for x in per_repeat:
 if not x['baseline']['attempted'] and not x['candidate']['attempted']:continue
 a=x['baseline'];b=x['candidate'];delta=100*(b['providerTokens']/a['providerTokens']-1) if a['providerTokens'] and b['providerTokens'] is not None else None
 lines += [f'- 第 {x["repeat"]} 轮：验收 {a["accepted"]}/8 → {b["accepted"]}/8；代码行为 {a["codeBehaviorPass"]}/8 → {b["codeBehaviorPass"]}/8；Token {a["providerTokens"]} → {b["providerTokens"]}；变化 {round(delta,2) if delta is not None else "未知"}%。']
if matched:lines += ['',f'双方均通过 {len(matched)} 对：Token {matched_totals["baseline"]:,} → {matched_totals["candidate"]:,}；变化 {round(matched_change,2) if matched_change is not None else "未知"}%。子集不替代全量；单对变化中位数 {round(statistics.median(pair_changes),2) if pair_changes else "未知"}%。']
else:lines += ['','没有双方均通过且用量完整的配对，不能计算配对收益。']
lines += ['','## 请求、输入与执行审计','']
for arm,x in totals.items():
 lines += [f'- {arm}：模型请求 {x["requests"]}；输入 {x["inputTokens"]}、输出 {x["outputTokens"]}、缓存读取 {x["cachedInputTokens"]}；工具调用 {x["toolCalls"]}、错误 {x["toolErrors"]}、创建遇到已有文件拒绝 {x["writeExistingErrors"]}；成功编辑 {x["successfulEdits"]}、验证结果 {x["validationToolResults"]}、命令超时 {x["commandTimeouts"]}。']
if first_deltas:lines += ['',f'首次输入配对差均值 **{statistics.mean(first_deltas):.2f} provider Token**，范围 {min(first_deltas)}–{max(first_deltas)}（候选减基线）。独立工作区标识可能带来少量分词差异。']
lines += ['',f'两版冻结源码离线比较 {len(parity["definitions"])} 组工具视图、{sum(len(x["requests"]) for x in parity["conversations"])} 个受控请求逐字节一致；其中模型及验证回复固定构造，不能作真实收益或正确率。',
 '', '真实用量从 ledger 核对；编辑、验证和超时计数与加密工具事件独立审计一致。','','## 未通过样本','']
for x in rows:
 if not x['accepted']:lines += [f'- {x["id"]}：status={x["status"]}；public={x["publicPassed"]}；hidden={x["hiddenPassed"]}；addedTests={x["addedTestsPassed"]}；protectedFiles={x["protectedFilesUnchanged"]}；allowedChanges={x["allowedChanges"]}；validation={x["validationPassed"]}；Token={x["usage"]["totalTokens"] if x["usage"] else "未知"}。']
lines += ['','## 解释与限制','','相同 GLM-5.3-flash、enabled thinking / low、4096 输出、初始源码及验收；交替先运行版本，每次新工作区。源码、任务、入口冻结，先检查初始与参考实现。每请求 90 秒、命令 120 秒、任务 10 分钟，单次预留 1 USD、全组 8 USD；未知保留预留并停止，不重试。',
 '', '全量包含失败费用；成功柱排除失败，失败成本在独立刻度展示；未知不填零。三次重复、自编题目及外部缓存状态限制了泛化和因果解释。',
 '', '架构未改变受控模型输入，无法根据独立轨迹的一个汇总百分比声称节省。需要结合请求数、每轮方向、具体失败及重复试验判断；不把质量下降解释为减少工作量的收益。',
 '', '[公开逐次数据](summary.json)；原始工作区、模型交互与日志私有。协议见 [真实实验说明](../../../docs/TOOL_CORE_TOKEN_EXPERIMENT.zh-CN.md)。','','## 采用与审核','',
 '本轮数值门槛满足，仍不构成因果收益证明，等待审核。' if gate else ('覆盖或用量不完整，无法评估 Token 优化门槛；架构保留与性能结论分开审核，不自动合并。' if not complete else '未满足本轮 Token 优化数值门槛，不作为节省 Token 的优化通过；架构保留与性能结论分开审核，不自动合并。'),
 '', '阶段结束等待用户审核，不启动下一个改进。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'gatePassed':gate,'changePercent':change,'totals':totals},ensure_ascii=False))
