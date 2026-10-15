"""Frozen direct-parent S2 gate; no zero substitution for unknown/failed samples."""
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
      'hiddenCompleted','addedTestsPassed','elapsedMs','accountedUsd','batchReadCalls','singleReadCalls','logicalReadAttempts','changedFiles','deletedFiles']
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
    totals[arm]['batchReadCalls']=sum(x['batchReadCalls'] or 0 for x in samples)
    totals[arm]['singleReadCalls']=sum(x['singleReadCalls'] or 0 for x in samples)
    totals[arm]['logicalReadAttempts']=sum(x['logicalReadAttempts'] or 0 for x in samples)
    totals[arm]['requests']=sum(x['usage']['requests'] for x in samples if x['usage'])
for arm,samples in arms.items():
    for field in ['inputTokens','outputTokens','cachedInputTokens','cacheCreationInputTokens']:
        totals[arm][field]=sum(x['usage'][field] or 0 for x in samples if x['usage'])
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
mechanism={arm:{'initialInputTokens':[], 'readRounds':0,'multiReadRounds':0,'batchReadErrors':0,'batchUsingAttempts':0} for arm in arms}
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
    mechanism[row['arm']]['batchReadErrors']+=sum(x['type']=='tool_call' and x['name']=='read_files' and bool(x.get('error')) for x in records)
    mechanism[row['arm']]['batchUsingAttempts']+=bool(row['batchReadCalls'])
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
report={key:raw.get(key) for key in ['schema','runId','createdAt','endedAt','engine','harnessSha256','manifestSha256','repeats','planned','config','hypothesis','scope','stopReason','sourceUnchanged','consumedUsd','preflight']}
report.update({'mechanism':mechanism,'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverageComplete':complete,'totals':totals,'changePercent':change,
               'bothAcceptedPairs':{'count':len(matched),'totals':matched_totals,'changePercent':matched_change,'candidateLowerPairs':sum(x<0 for x in pair_changes),'medianPairChangePercent':statistics.median(pair_changes) if pair_changes else None},'qualityGatePassed':quality_ok,'gatePassed':gate,'perTask':by_task,'perRepeat':per_repeat,'rows':rows})
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,(ax,failed_ax)=plt.subplots(2,1,figsize=(12.5,8.4),sharex=True,gridspec_kw={'height_ratios':[3,1.3],'hspace':.28});colors={'baseline':'#8c83b8','candidate':'#318473'}
for i,task_id in enumerate(task_ids):
    for arm,shift in [('baseline',-.18),('candidate',.18)]:
        samples=[x for x in rows if x['taskId']==task_id and x['arm']==arm]
        passed=[x for x in samples if x['accepted'] and x['usage']]
        if passed:ax.bar(i+shift,sum(x['usage']['totalTokens'] for x in passed)/len(passed)/1000,width=.34,color=colors[arm],edgecolor='white',zorder=2)
        for n,x in enumerate(samples):
            if x['usage']:
                axis=ax if x['accepted'] else failed_ax
                axis.scatter(i+shift+(n-1)*.065,x['usage']['totalTokens']/1000,marker='o' if x['accepted'] else 'x',s=28,color=colors[arm],edgecolors='white' if x['accepted'] else None,zorder=3)
        ax.annotate(f'{len(passed)}/{len(samples)}',(i+shift,0),xytext=(0,-15),textcoords='offset points',ha='center',fontsize=8)
ax.set_xticks(range(8),['Narcissistic\nmodule','Interval\nmerging','Quoted\nCSV','TTL\ncache','Async\nscheduler','Cursor\npagination','Atomic\ntransfers','Dependency\nplanner']);failed_ax.tick_params(axis='x',pad=10)
failed_ax.set_ylabel('Failed attempts\n(thousands)');failed_ax.set_xlabel('Tasks; acceptance counts below upper bars');failed_ax.grid(axis='y',color='#e8eaed');failed_ax.set_ylim(bottom=0);ax.set_title('Accepted samples only — bars: mean; dots: each accepted attempt',fontsize=11);failed_ax.set_title('Failed attempt costs — separate scale; included in all-attempt totals',fontsize=10);ax.set_ylabel('Provider tokens / attempt (thousands)');ax.grid(axis='y',color='#e8eaed',zorder=0);ax.margins(y=.15)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(facecolor=colors['baseline'],label='Direct parent'),Patch(facecolor=colors['candidate'],label='S2 batch reads')],frameon=False)
fig.suptitle('S2 coding experiment — three attempts per task and arm',fontsize=16,y=.97)
fig.text(.5,.02,'Upper panel: accepted samples only. Lower panel: failed attempts, separate scale (all costs retained).\nGLM-5.3-flash · enabled / low · 4,096 output cap · alternating order · self-authored Node.js fixtures. Source: '+run_id,ha='center',fontsize=9)
fig.subplots_adjust(left=.09,right=.98,bottom=.21,top=.88);fig.savefig(target/'s2-coding.png',dpi=200);fig.savefig(target/'s2-coding.svg');plt.close(fig)
lines=['# S2 编码 Token 优化实验','',f'修改：提供可选 read_files 工具，一次最多读取四个相关文件，每个文件最多 2500 字符；沿用范围读取、脱敏、版本指纹和覆盖保护。ContextOS 按依赖检查整批有效性，任一文件变化则保守地停止召回整批旧内容。','',
       f'真实运行计划：八题 × 三次 × 两个版本 = 48 次；已完成 {len(rows)} 次，完整覆盖与用量：{complete}。','',
       f'修改前验收：{totals["baseline"]["accepted"]}/{totals["baseline"]["attempted"]}；候选：{totals["candidate"]["accepted"]}/{totals["candidate"]["attempted"]}。','']
lines += [f'单看独立代码行为（原有测试、新增测试及隐藏断言）：修改前 {totals["baseline"]["codeBehaviorPass"]}/24，候选 {totals["candidate"]["codeBehaviorPass"]}/24。完整验收还要求保护文件保持不变。','']
if complete:lines += [f'全尝试累计 Token：修改前 {totals["baseline"]["providerTokens"]:,}，候选 {totals["candidate"]["providerTokens"]:,}；候选 {"增加" if change>=0 else "减少"} **{abs(change):.2f}%**。','']
lines += [f'已有文件创建误用：{totals["baseline"]["writeExistingErrors"]} → {totals["candidate"]["writeExistingErrors"]}。',
          f'质量门槛通过：{quality_ok}；综合门槛（完整覆盖、各题质量不降低、全尝试 Token 更低）：**{gate}**。','',
          '![S2 逐题对照](s2-coding.png)','','## 每题结果','']
for x in by_task:lines += [f'- **{x["title"]}**：修改前 {x["baseline"]["accepted"]}/{x["baseline"]["attempted"]}，候选 {x["candidate"]["accepted"]}/{x["candidate"]["attempted"]}；Token 总量 {x["baseline"]["providerTokens"]} / {x["candidate"]["providerTokens"]}。']
lines += [f'双方均通过的配对：{len(matched)} 对；Token 总量 {matched_totals["baseline"]} / {matched_totals["candidate"]}；变化 {round(matched_change,2) if matched_change is not None else "未知"}%。','','累计 Token 包含缓存输入；输出包含思考，不重复累加思考。此处使用 provider 实测，不使用字符或字节估算。','','']
lines += [f'模型请求数：{totals["baseline"]["requests"]} → {totals["candidate"]["requests"]}；候选批量读取调用：{totals["candidate"]["batchReadCalls"]}；请求的文件范围数量（含被拒绝的批次项，非磁盘 I/O 次数）：{totals["baseline"]["logicalReadAttempts"]} → {totals["candidate"]["logicalReadAttempts"]}。','','## 方法与限制','','两个版本从已提交源码提取并冻结，工作区在没有祖先指令的临时目录，每次独立初始化。同题配对轮流先运行前版/候选；模型、思考、输出、费用、超时及独立验收一致。失败保留真实用量，未知用量停止且保留预留，不自动付费重试。','',
          '柱形图仅展示验收通过样本均值，不替代含失败的全尝试汇总。门槛检查包括总验收与每题验收不下降；每题只有三次，仍是小样本，不证明生产环境泛化或显著性。','',
          '未通过门槛的运行时修改已撤销；通过时也等待用户审核。冻结指纹、逐次明细及逐轮结果见 [summary.json](summary.json)。']
lines += ['','## 原因与采用决定','',
    f'只有 {mechanism["candidate"]["batchUsingAttempts"]}/24 个候选任务使用 read_files，共 {totals["candidate"]["batchReadCalls"]} 次调用，其中 {mechanism["candidate"]["batchReadErrors"]} 次参数错误。基线已有 {mechanism["baseline"]["multiReadRounds"]} 轮一次发起多个读取；模型请求总数仍从 {totals["baseline"]["requests"]} 增至 {totals["candidate"]["requests"]}。减少读取调用数不等于减少模型往返。','',
    f'同题首次请求输入差异平均 {statistics.mean(mechanism["pairedInitialInputDeltas"]):.2f} Token，范围 {min(mechanism["pairedInitialInputDeltas"])}–{max(mechanism["pairedInitialInputDeltas"])}。新增工具定义形成固定开销；不能将全部涨幅归因于定义，也包含不同实现与修复路径。','',
    '第一轮候选缓存任务消耗 130,364 Token 后触及工具限制；并发任务消耗 87,261 Token 后触及任务时间限制。缓存源码及独立测试通过，但产生 tests/_debug.mjs 超出允许变更范围，并未完成最后验证；并发隐藏断言与新增测试未通过。基线也有 CSV 实际缺陷、转账验证未完成和原有测试文件变动。','',
    '基线最后一次依赖图任务保留原测试全文并追加 1170 字符，未观察到削弱断言；按冻结规则仍属于修改受保护文件，因此完整验收失败。独立代码行为计分与保护/流程计分分开，未调整验收规则。','',
    '18 对双方均通过子集的减少不代表整体收益：排除失败会改变样本构成。全部尝试计入后增加 11.47%，且缓存、并发各题验收下降。因此撤销 S2 运行时改动，保留实验证据，等待用户审核。','',
    '## 离线取消反例与恢复验证','',
    '候选还存在交付边界缺陷：读取已更新去重缓存，整批结果交付前取消；后续读取返回“原文仍在历史中”，但模型没有收到原文。此反例是额外确定性检查，未计入 provider Token 或用于归因真实实验失败。候选已撤销。','',
    '无 API 复现：`node scripts/check-coding-s2-cancellation.mjs`。脚本固定检查历史提交 7ea8d82；退出成功表示历史反例成功复现，不能解读为当前运行时失败。见 [反例结果](cancellation-counterexample.json)。','',
    '候选最初专项及完整测试 325/325；上述反例补充了当时缺失的交付边界检查。恢复版首跑 319/320：本地模拟网关 fetch bad port。未改源码或测试，专项重跑 14/14、全量重跑 320/320。运行时源码与 e9ff015 一致。','',
    '原实测脚本来自 7ea8d82，记录的 Windows CRLF SHA-256 为 44fcdafc6722aeb482b0e32bfd14b162804f8ce4846ea69060ab6ced15ddb90c；其 Git LF blob SHA-256 为 f333ebf2a0ee3ee66b8420a636ad5c0f1453bc312e52ee51d5987fb8ae274e71。已核对仅换行不同。当前发布入口只把默认 candidate-ref 从 HEAD 固定为 7ea8d82；原实测已显式指定该候选。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'gatePassed':gate,'changePercent':change,'totals':totals},ensure_ascii=False))
