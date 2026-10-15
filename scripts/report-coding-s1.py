"""Frozen direct-parent S1 gate; no zero substitution for unknown/failed samples."""
import hashlib,json,pathlib,sys
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
      'hiddenCompleted','addedTestsPassed','elapsedMs','accountedUsd']
rows=[{key:x.get(key) for key in keys} for x in raw['rows']]
for row in rows:row['codeBehaviorPass']=bool(row['publicPassed'] and row['hiddenPassed'] and row['addedTestsPassed'])
for x in rows:
    if x['usage'] and x['usage']['totalTokens']!=x['usage']['inputTokens']+x['usage']['outputTokens']:raise RuntimeError('Inconsistent usage')
arms={arm:[x for x in rows if x['arm']==arm] for arm in ['baseline','candidate']}
complete=raw['complete'] and raw['sourceUnchanged'] and len(rows)==48 and all(x['usage'] is not None for x in rows)
totals={arm:{'attempted':len(samples),'accepted':sum(bool(x['accepted']) for x in samples),'functionalPass':sum(bool(x['functionalPass']) for x in samples),
             'codeBehaviorPass':sum(x['codeBehaviorPass'] for x in samples),
             'providerTokens':sum(x['usage']['totalTokens'] for x in samples) if all(x['usage'] for x in samples) else None,
             'knownTokenSubtotal':sum(x['usage']['totalTokens'] for x in samples if x['usage']),
             'requests':sum(x['usage']['requests'] for x in samples if x['usage']),
             'toolCalls':sum(x['toolCalls'] or 0 for x in samples),'toolErrors':sum(x['toolErrors'] or 0 for x in samples),
             'writeExistingErrors':sum(x['writeExistingErrors'] or 0 for x in samples)} for arm,samples in arms.items()}
task_ids=[x['id'] for x in raw['preflight']];by_task=[]
for task_id in task_ids:
    family={'id':task_id,'title':next(x['title'] for x in rows if x['taskId']==task_id)}
    for arm in arms:
        samples=[x for x in arms[arm] if x['taskId']==task_id]
        family[arm]={'attempted':len(samples),'accepted':sum(bool(x['accepted']) for x in samples),
                     'providerTokens':sum(x['usage']['totalTokens'] for x in samples) if all(x['usage'] for x in samples) else None,
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
report={key:raw.get(key) for key in ['schema','runId','createdAt','endedAt','engine','harnessSha256','manifestSha256','repeats','planned','config','hypothesis','scope','stopReason','sourceUnchanged','consumedUsd']}
report.update({'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverageComplete':complete,'totals':totals,'changePercent':change,
               'qualityGatePassed':quality_ok,'gatePassed':gate,'perTask':by_task,'perRepeat':per_repeat,'rows':rows})
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(figsize=(12.5,6.3));colors={'baseline':'#8c83b8','candidate':'#318473'}
for i,task_id in enumerate(task_ids):
    for arm,shift in [('baseline',-.18),('candidate',.18)]:
        samples=[x for x in rows if x['taskId']==task_id and x['arm']==arm]
        passed=[x for x in samples if x['accepted'] and x['usage']]
        if passed:ax.bar(i+shift,sum(x['usage']['totalTokens'] for x in passed)/len(passed)/1000,width=.34,color=colors[arm],edgecolor='white',zorder=2)
        for n,x in enumerate(samples):
            if x['usage']:ax.scatter(i+shift+(n-1)*.065,x['usage']['totalTokens']/1000,marker='o' if x['accepted'] else 'x',s=28,color=colors[arm],edgecolors='white' if x['accepted'] else None,zorder=3)
        ax.annotate(f'{len(passed)}/{len(samples)}',(i+shift,0),xytext=(0,-15),textcoords='offset points',ha='center',fontsize=8)
ax.set_xticks(range(8),['Narcissistic\nmodule','Interval\nmerging','Quoted\nCSV','TTL\ncache','Async\nscheduler','Cursor\npagination','Atomic\ntransfers','Dependency\nplanner']);ax.tick_params(axis='x',pad=22)
ax.set_ylabel('Provider tokens / attempt (thousands)');ax.set_xlabel('Tasks; acceptance counts below bars');ax.grid(axis='y',color='#e8eaed',zorder=0);ax.margins(y=.15)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(facecolor=colors['baseline'],label='Direct parent'),Patch(facecolor=colors['candidate'],label='S1 edit guidance')],frameon=False)
fig.suptitle('S1 coding experiment — three attempts per task and arm',fontsize=16,y=.97)
fig.text(.5,.02,'Bars: accepted-sample mean only; dots: accepted attempts; crosses: failed attempts (cost retained separately).\nGLM-5.3-flash · enabled / low · 4,096 output cap · alternating order · self-authored Node.js fixtures. Source: '+run_id,ha='center',fontsize=9)
fig.tight_layout(rect=(0,.1,1,.94));fig.savefig(target/'s1-coding.png',dpi=200);fig.savefig(target/'s1-coding.svg');plt.close(fig)
lines=['# S1 编码 Token 优化实验','',f'修改：明确创建/编辑边界；读取结果增加简短编辑提示；缩短创建覆盖失败反馈。创建保护、补丁逻辑和验证标准保持原样。','',
       f'真实运行计划：八题 × 三次 × 两个版本 = 48 次；已完成 {len(rows)} 次，完整覆盖与用量：{complete}。','',
       f'修改前验收：{totals["baseline"]["accepted"]}/{totals["baseline"]["attempted"]}；候选：{totals["candidate"]["accepted"]}/{totals["candidate"]["attempted"]}。','']
lines += [f'单看独立代码行为（原有测试、新增测试及隐藏断言）：修改前 {totals["baseline"]["codeBehaviorPass"]}/24，候选 {totals["candidate"]["codeBehaviorPass"]}/24。完整验收还要求保护文件保持不变。','']
if complete:lines += [f'全尝试累计 Token：修改前 {totals["baseline"]["providerTokens"]:,}，候选 {totals["candidate"]["providerTokens"]:,}；候选 {"增加" if change>=0 else "减少"} **{abs(change):.2f}%**。','']
lines += [f'已有文件创建误用：{totals["baseline"]["writeExistingErrors"]} → {totals["candidate"]["writeExistingErrors"]}。',
          f'质量门槛通过：{quality_ok}；综合门槛（完整覆盖、各题质量不降低、全尝试 Token 更低）：**{gate}**。','',
          '![S1 逐题对照](s1-coding.png)','','## 每题结果','']
for x in by_task:lines += [f'- **{x["title"]}**：修改前 {x["baseline"]["accepted"]}/{x["baseline"]["attempted"]}，候选 {x["candidate"]["accepted"]}/{x["candidate"]["attempted"]}；Token 总量 {x["baseline"]["providerTokens"]} / {x["candidate"]["providerTokens"]}。']
lines += ['','## 方法与限制','','两个版本从已提交源码提取并冻结，工作区在没有祖先指令的临时目录，每次独立初始化。同题配对轮流先运行前版/候选；模型、思考、输出、费用、超时及独立验收一致。失败保留真实用量，未知用量停止且保留预留，不自动付费重试。','',
          '柱形图仅展示验收通过样本均值，不替代含失败的全尝试汇总。门槛检查包括总验收与每题验收不下降；每题只有三次，仍是小样本，不证明生产环境泛化或显著性。','',
          '未通过门槛的运行时修改已撤销；通过时也等待用户审核。冻结指纹、逐次明细及逐轮结果见 [summary.json](summary.json)。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'gatePassed':gate,'changePercent':change,'totals':totals},ensure_ascii=False))
