"""Frozen direct-parent S4 gate; no zero substitution for unknown/failed samples."""
import hashlib,json,pathlib,sys,statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=pathlib.Path(__file__).resolve().parents[1];run_id=sys.argv[1]
if not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run_id):raise ValueError('Invalid run ID')
source=ROOT/'benchmarks/results'/run_id/'comparison.json';raw=json.loads(source.read_text(encoding='utf8'))
if any(x['running'] for x in raw['rows']):raise RuntimeError('Experiment still active')
if raw['mode']!='live':raise RuntimeError('Offline preflight is not provider evidence')
keys=['id','taskId','title','level','repeat','arm','status','accepted','functionalPass','validationPassed','validationAttempts','toolCalls',
      'toolErrors','writeExistingErrors','usageComplete','usage','protectedFilesUnchanged','allowedChanges','publicPassed','hiddenPassed',
      'hiddenCompleted','addedTestsPassed','elapsedMs','accountedUsd','singleReadCalls','logicalReadAttempts','firstRequestInputTokens','changedFiles','deletedFiles','resolvedReferenceOccurrences','requestsWithResolvedFailures','uniqueResolvedFailures']
rows=[{key:x.get(key) for key in keys} for x in raw['rows']]
for row in rows:row['codeBehaviorPass']=bool(row['publicPassed'] and row['hiddenPassed'] and row['addedTestsPassed'])
for x in rows:
    if x['usage'] and x['usage']['totalTokens']!=x['usage']['inputTokens']+x['usage']['outputTokens']:raise RuntimeError('Inconsistent usage')
arms={arm:[x for x in rows if x['arm']==arm] for arm in ['baseline','candidate']}
complete=raw['complete'] and raw['sourceUnchanged'] and len(rows)==48 and all(x['usage'] is not None for x in rows)
totals={arm:{'attempted':len(samples),'accepted':sum(bool(x['accepted']) for x in samples),'functionalPass':sum(bool(x['functionalPass']) for x in samples),
             'codeBehaviorPass':sum(x['codeBehaviorPass'] for x in samples),
             'providerTokens':sum(x['usage']['totalTokens'] for x in samples) if samples and all(x['usage'] for x in samples) else None,
             'knownTokenSubtotal':sum(x['usage']['totalTokens'] for x in samples if x['usage']),
             'requests':sum(x['usage']['requests'] for x in samples if x['usage']),
             'toolCalls':sum(x['toolCalls'] or 0 for x in samples),'toolErrors':sum(x['toolErrors'] or 0 for x in samples),
             'writeExistingErrors':sum(x['writeExistingErrors'] or 0 for x in samples)} for arm,samples in arms.items()}
for arm,samples in arms.items():
    totals[arm]['singleReadCalls']=sum(x['singleReadCalls'] or 0 for x in samples)
    totals[arm]['logicalReadAttempts']=sum(x['logicalReadAttempts'] or 0 for x in samples)
    totals[arm]['requests']=sum(x['usage']['requests'] for x in samples if x['usage'])
for arm,samples in arms.items():
    for field in ['inputTokens','outputTokens','cachedInputTokens','cacheCreationInputTokens']:
        totals[arm][field]=sum(x['usage'][field] or 0 for x in samples if x['usage'])
for arm,samples in arms.items():
    for field in ['resolvedReferenceOccurrences','requestsWithResolvedFailures','uniqueResolvedFailures']:
        totals[arm][field]=sum(x[field] or 0 for x in samples)
    totals[arm]['attemptsWithResolvedFailures']=sum(bool(x['uniqueResolvedFailures']) for x in samples)
matched=[]
for b in arms['baseline']:
    c=next((x for x in arms['candidate'] if x['taskId']==b['taskId'] and x['repeat']==b['repeat']),None)
    if c and b['accepted'] and c['accepted'] and b['usage'] and c['usage']:matched.append((b,c))
matched_totals={arm:sum(pair[i]['usage']['totalTokens'] for pair in matched) for i,arm in enumerate(['baseline','candidate'])}
pair_changes=[100*(c['usage']['totalTokens']/b['usage']['totalTokens']-1) for b,c in matched]
matched_change=100*(matched_totals['candidate']/matched_totals['baseline']-1) if matched_totals['baseline'] else None
task_ids=[x['id'] for x in raw['preflight']];by_task=[]
for task_id in task_ids:
    family={'id':task_id,'title':next((x['title'] for x in rows if x['taskId']==task_id),task_id)}
    for arm in arms:
        samples=[x for x in arms[arm] if x['taskId']==task_id]
        family[arm]={'attempted':len(samples),'accepted':sum(bool(x['accepted']) for x in samples),
                     'providerTokens':sum(x['usage']['totalTokens'] for x in samples) if samples and all(x['usage'] for x in samples) else None,
                     'writeExistingErrors':sum(x['writeExistingErrors'] or 0 for x in samples)}
    by_task.append(family)
quality_ok=complete and totals['candidate']['accepted']>=totals['baseline']['accepted'] and all(x['candidate']['accepted']>=x['baseline']['accepted'] for x in by_task)
change=100*(totals['candidate']['providerTokens']/totals['baseline']['providerTokens']-1) if complete else None
gate=quality_ok and change<0
per_repeat=[]
for repeat in [1,2,3]:
    row={'repeat':repeat}
    for arm in arms:
        samples=[x for x in arms[arm] if x['repeat']==repeat]
        row[arm]={'accepted':sum(bool(x['accepted']) for x in samples),'tokens':sum(x['usage']['totalTokens'] for x in samples) if len(samples)==8 and all(x['usage'] for x in samples) else None}
    per_repeat.append(row)
mechanism={arm:{'initialInputTokens':[], 'readRounds':0,'multiReadRounds':0} for arm in arms}
initial_pairs={}
for row in rows:
    location=json.loads((source.parent/(row['id']+'-workspace.json')).read_text(encoding='utf8'))
    ledger=pathlib.Path(location['workspace'])/'.tea/runs/agent/ledger.jsonl'
    if not ledger.exists():continue
    records=[json.loads(line) for line in ledger.read_text(encoding='utf8').splitlines()]
    requests=[x for x in records if x['type']=='model_request']
    if requests and isinstance(requests[0].get('reportedInputTokens'),int):
        first=requests[0]['reportedInputTokens']
        mechanism[row['arm']]['initialInputTokens'].append(first)
        initial_pairs.setdefault((row['taskId'],row['repeat']),{})[row['arm']]=first
    counts=[];reads=0
    for event in records:
        if event['type']=='model_request':
            if reads:counts.append(reads)
            reads=0
        elif event['type']=='tool_call' and event['name'] in ['read_file','read_files']:reads+=1
    if reads:counts.append(reads)
    mechanism[row['arm']]['readRounds']+=len(counts)
    mechanism[row['arm']]['multiReadRounds']+=sum(x>1 for x in counts)
mechanism['pairedInitialInputDeltas']=[x['candidate']-x['baseline'] for x in initial_pairs.values() if len(x)==2]
report={key:raw.get(key) for key in ['schema','runId','createdAt','endedAt','engine','harnessSha256','manifestSha256','repeats','planned','config','hypothesis','scope','stopReason','sourceUnchanged','consumedUsd','preflight','fixedDefinitions','candidateFlag','harnessNormalizedSha256']}
report.update({'mechanism':mechanism,'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverageComplete':complete,'totals':totals,'changePercent':change,
               'bothAcceptedPairs':{'count':len(matched),'totals':matched_totals,'changePercent':matched_change,'candidateLowerPairs':sum(x<0 for x in pair_changes),'medianPairChangePercent':statistics.median(pair_changes) if pair_changes else None},'qualityGatePassed':quality_ok,'gatePassed':gate,'perTask':by_task,'perRepeat':per_repeat,'rows':rows})
report['projectionControls']=json.loads((source.parent/'projection-controls.json').read_text(encoding='utf8'))
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,(ax,failed_ax)=plt.subplots(2,1,figsize=(12.5,8.4),sharex=True,gridspec_kw={'height_ratios':[3,1.3],'hspace':.28});colors={'baseline':'#8c83b8','candidate':'#318473'}
for i,task_id in enumerate(task_ids):
    for arm,shift in [('baseline',-.18),('candidate',.18)]:
        samples=[x for x in rows if x['taskId']==task_id and x['arm']==arm]
        passed=[x for x in samples if x['accepted'] and x['usage']]
        if passed:ax.bar(i+shift,sum(x['usage']['totalTokens'] for x in passed)/len(passed)/1000,width=.34,color=colors[arm],edgecolor='white',zorder=2)
        else:ax.annotate('n/a',(i+shift,0),xytext=(0,6),textcoords='offset points',ha='center',fontsize=8,color=colors[arm])
        for n,x in enumerate(samples):
            if x['usage']:
                axis=ax if x['accepted'] else failed_ax
                axis.scatter(i+shift+(n-1)*.065,x['usage']['totalTokens']/1000,marker='o' if x['accepted'] else 'x',s=28,color=colors[arm],edgecolors='white' if x['accepted'] else None,zorder=3)
        ax.annotate(f'{len(passed)}/{len(samples)}',(i+shift,0),xytext=(0,-15),textcoords='offset points',ha='center',fontsize=8)
ax.set_xticks(range(8),['Narcissistic\nmodule','Interval\nmerging','Quoted\nCSV','TTL\ncache','Async\nscheduler','Cursor\npagination','Atomic\ntransfers','Dependency\nplanner']);failed_ax.tick_params(axis='x',pad=10)
failed_ax.set_ylabel('Failed attempts\n(thousands)');failed_ax.set_xlabel('Tasks; acceptance counts below upper bars');failed_ax.grid(axis='y',color='#e8eaed');failed_ax.set_ylim(bottom=0);ax.set_title('Accepted samples only — bars: mean; dots: each accepted attempt',fontsize=11);failed_ax.set_title('Failed attempt costs — separate scale; included in all-attempt totals',fontsize=10);ax.set_ylabel('Provider tokens / attempt (thousands)');ax.grid(axis='y',color='#e8eaed',zorder=0);ax.margins(y=.15)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(facecolor=colors['baseline'],label='Direct parent'),Patch(facecolor=colors['candidate'],label='S4 resolved failures')],frameon=False)
fig.suptitle('S4 coding experiment — three attempts per task and arm',fontsize=16,y=.97)
fig.text(.5,.02,'Upper panel: accepted samples only. Lower panel: failed attempts, separate scale (all costs retained).\nGLM-5.3-flash · enabled / low · 4,096 output cap · alternating order · self-authored Node.js fixtures. Source: '+run_id,ha='center',fontsize=9)
fig.subplots_adjust(left=.09,right=.98,bottom=.21,top=.88);fig.savefig(target/'s4-coding.png',dpi=200);fig.savefig(target/'s4-coding.svg');plt.close(fig)
svg=target/'s4-coding.svg';svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf8').splitlines())+'\n',encoding='utf8')
lines=['# S4 编码 Token 优化实验','',f'修改：同一用户回合内，完全相同的验证命令随后成功时，旧失败允许变为 ContextOS 可召回历史引用。保留最近输出、未解决失败、原始历史与验证状态；净请求字节不减则回退。实验 SDK 开关 compactResolvedTests 默认关闭。','',
       f'真实运行计划：八题 × 三次 × 两个版本 = 48 次；已完成 {len(rows)} 次，完整覆盖与用量：{complete}。','',
       f'修改前验收：{totals["baseline"]["accepted"]}/{totals["baseline"]["attempted"]}；候选：{totals["candidate"]["accepted"]}/{totals["candidate"]["attempted"]}。','']
lines += [f'单看独立代码行为（原有测试、新增测试及隐藏断言）：修改前 {totals["baseline"]["codeBehaviorPass"]}/24，候选 {totals["candidate"]["codeBehaviorPass"]}/24。完整验收还要求保护文件保持不变。','']
if complete:lines += [f'全尝试累计 Token：修改前 {totals["baseline"]["providerTokens"]:,}，候选 {totals["candidate"]["providerTokens"]:,}；候选 {"增加" if change>=0 else "减少"} **{abs(change):.2f}%**。','']
lines += [f'已有文件创建误用：{totals["baseline"]["writeExistingErrors"]} → {totals["candidate"]["writeExistingErrors"]}。',
          f'质量门槛通过：{quality_ok}；综合门槛（完整覆盖、各题质量不降低、全尝试 Token 更低）：**{gate}**。','',
          '![S4 逐题对照](s4-coding.png)','','## 每题结果','']
for x in by_task:lines += [f'- **{x["title"]}**：修改前 {x["baseline"]["accepted"]}/{x["baseline"]["attempted"]}，候选 {x["candidate"]["accepted"]}/{x["candidate"]["attempted"]}；Token 总量 {x["baseline"]["providerTokens"]} / {x["candidate"]["providerTokens"]}。']
lines += ['',f'双方均通过的配对：{len(matched)} 对；Token 总量 {matched_totals["baseline"]} / {matched_totals["candidate"]}；变化 {round(matched_change,2) if matched_change is not None else "未知"}%。','','累计 Token 包含缓存输入；输出包含思考，不重复累加思考。此处使用 provider 实测，不使用字符或字节估算。','','']
lines += [f'模型请求数：{totals["baseline"]["requests"]} → {totals["candidate"]["requests"]}；单文件读取调用：{totals["baseline"]["logicalReadAttempts"]} → {totals["candidate"]["logicalReadAttempts"]}。','','## 方法与限制','','两个版本从已提交源码提取并冻结，工作区在没有祖先指令的临时目录，每次独立初始化。同题配对轮流先运行前版/候选；模型、思考、输出、费用、超时及独立验收一致。失败保留真实用量，未知用量停止且保留预留，不自动付费重试。','',
          '柱形图仅展示验收通过样本均值，不替代含失败的全尝试汇总。门槛检查包括总验收与每题验收不下降；每题只有三次，仍是小样本，不证明生产环境泛化或显著性。','',
          '最终处置见采用决定。冻结指纹、逐次明细及逐轮结果见 [summary.json](summary.json)。']

lines += ['','## 每轮结果','']
for item in per_repeat:
    a=item['baseline'];b=item['candidate']
    delta=round(100*(b['tokens']/a['tokens']-1),2) if a['tokens'] and b['tokens'] is not None else None
    lines += [f'- 第 {item["repeat"]} 轮：验收 {a["accepted"]}/8 → {b["accepted"]}/8；Token {a["tokens"]} → {b["tokens"]}；候选变化 {delta if delta is not None else "未知"}%。']
lines += ['','## 固定开销与解释边界','',
    f'首次配对输入差异（候选减基线）均值 {statistics.mean(mechanism["pairedInitialInputDeltas"]):.2f} Token，范围 {min(mechanism["pairedInitialInputDeltas"])}–{max(mechanism["pairedInitialInputDeltas"])}。这是 provider 首次请求用量，区别于下列离线字节指标。','']
for item in raw['fixedDefinitions']:
    lines += [f'- {"大目录" if item["discoveryWide"] else "小目录"}：固定工具定义 {item["baselineBytes"]} / {item["candidateBytes"]} UTF-8 字节，完整定义指纹一致；不是 Token 估算。']
lines += ['','## 固定历史的离线投影控制','',report['projectionControls']['unit'],'']
for item in report['projectionControls']['controls']:
    lines += [f'- {item["kind"]}：{item["baseline"]["bytes"]} → {item["candidate"]["bytes"]} 字节；请求指纹相同：{item["identical"]}。']
lines += ['','这些是固定历史上的请求序列化字节，不代表模型实际 Token 或独立编码正确率。','','## 实际触发','']
for arm in arms:
    x=totals[arm]
    lines += [f'- {arm}：{x["attemptsWithResolvedFailures"]}/24 次任务触发，{x["uniqueResolvedFailures"]} 条不同的旧失败被引用；{x["requestsWithResolvedFailures"]} 次请求投影包含这类引用，累计 {x["resolvedReferenceOccurrences"]} 次引用出现。']
lines += ['','触发计数来自请求发出前的 ContextOS 投影，非 provider Token。没有触发的任务不能把随机用量变化归因于 S4；即使全组成本更低，也要结合触发样本判断机制是否有实证。','',
    '已解决匹配不保证后来源码仍正确；待验证状态、最新失败与最后验证结果继续保留。每题三次，未证明统计显著性或生产泛化。','',
    '## 未通过的尝试','']
for row in rows:
    if not row['accepted']:
        lines += [f'- {row["id"]}：status={row["status"]}；public={row["publicPassed"]}；hidden={row["hiddenPassed"]}；addedTests={row["addedTestsPassed"]}；protectedFiles={row["protectedFilesUnchanged"]}；allowedChanges={row["allowedChanges"]}；validation={row["validationPassed"]}；Token={row["usage"]["totalTokens"] if row["usage"] else "未知"}。']
lines += ['','## 采用决定','',
    '通过预设门槛，实验开关保持默认关闭，等待用户审核。' if gate else '未达到预设门槛，候选运行时改动撤销，保留实验记录，等待用户审核。',
    '', 'S1/S2/S3 的运行时修改均未包含在本轮；此处只评估 S4。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'gatePassed':gate,'changePercent':change,'totals':totals},ensure_ascii=False))
