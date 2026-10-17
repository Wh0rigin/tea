"""Reviewed screening aggregates; no provider calls and no raw transcripts exported."""
import hashlib,json,pathlib,statistics,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root=pathlib.Path(__file__).resolve().parents[1]
run=sys.argv[1]
if not run or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run):raise ValueError('Invalid run')
p=root/'benchmarks/results'/run
raw=json.loads((p/'comparison.json').read_text(encoding='utf8'))
assert raw.get('endedAt') and all(not r['running'] for r in raw['rows'])
assert raw['planned']==12
keys=['id','taskId','title','repeat','arm','accepted','functionalPass','codeBehaviorPass','status','usage','usageComplete',
      'toolCalls','outerToolCalls','toolErrors','successfulEdits','validationToolResults','commandTimeouts',
      'retrievalCalls','retrievalErrors','retrievalSuboperations','retrievalSuccessfulOps','codeFirstRouteDenials','protectedFilesUnchanged','allowedChanges','publicPassed','addedTestsPassed','hiddenPassed','hiddenCompleted','validationPassed','changedFiles']
rows=[{k:r.get(k) for k in keys} for r in raw['rows']]
first_inputs=[]
for r,original in zip(rows,raw['rows']):
    location=json.loads((p/(r['id']+'-workspace.json')).read_text(encoding='utf8'))['workspace']
    entries=[json.loads(x) for x in (pathlib.Path(location)/'.tea/runs/agent/ledger.jsonl').read_text(encoding='utf8').splitlines()]
    calls=[e for e in entries if e['type']=='tool_call']
    assert r['retrievalCalls']==sum(x['name']=='retrieve_code' for x in calls)
    assert r['retrievalErrors']==sum(x['name']=='retrieve_code' and bool(x.get('error')) for x in calls)
    assert r['retrievalSuboperations']==sum(x['type']=='retrieval_operation' and x['stage']=='intent' for x in entries)
    assert r['retrievalSuccessfulOps']==sum(x['type']=='retrieval_operation' and x['stage']=='settled' and not x['isError'] for x in entries)
    assert r['outerToolCalls']==len(calls)
    assert r['codeFirstRouteDenials']==sum(bool(x.get('error')) and any(term in x['error'] for term in ['Code-first','code-first','instructions-only','Use retrieve_code']) for x in calls)
    groups=[];current=[]
    for event in entries:
        if event['type']=='retrieval_operation' and event['stage']=='intent':current.append(event['name'])
        if event['type']=='tool_call' and event['name']=='retrieve_code':groups.append({'operations':current,'successful':not bool(event.get('error'))});current=[]
    assert len(groups)==r['retrievalCalls']
    r['retrievalOperationGroups']=groups
    r['multiOperationPrograms']=sum(len(g['operations'])>=2 for g in groups)
    r['successfulMultiOperationPrograms']=sum(len(g['operations'])>=2 and g['successful'] for g in groups)
    categories={}
    for call in calls:
        if call['name']!='retrieve_code' or not call.get('error'):continue
        error=call['error']
        category='syntax' if 'SyntaxError:' in error else 'import-denied' if 'ImportError:' in error else 'filesystem-api-denied' if "name 'open' is not defined" in error else 'opaque-page-contract' if any(s in error for s in ['Opaque evidence','Emit evidence pages directly']) else 'api-contract' if any(s in error for s in ['KeyError:','TypeError:','AttributeError:','NameError:']) else 'instruction-read-route' if 'workspace instructions' in error else 'bounded-execution' if any(s in error.lower() for s in ['limit','10kb','at most','memoryerror']) else 'other'
        categories[category]=categories.get(category,0)+1
    r['retrievalErrorCategories']=categories
    requests=[x for x in entries if x['type']=='model_request']
    if r['usage']:
        assert all(x['usageComplete'] for x in requests)
        assert sum(x['reportedInputTokens']+x['reportedOutputTokens'] for x in requests)==r['usage']['totalTokens']
    first_inputs.append({'id':r['id'],'taskId':r['taskId'],'repeat':r['repeat'],'arm':r['arm'],
        'input':requests[0]['reportedInputTokens'] if requests and requests[0]['usageComplete'] else None})

complete=raw['complete'] and raw['sourceUnchanged'] and raw.get('harnessUnchanged') and len(rows)==12 and all(r['usage'] is not None for r in rows)
tasks=list(dict.fromkeys(r['taskId'] for r in rows))
def aggregate(samples):
    return {'attempted':len(samples),'accepted':sum(bool(x['accepted']) for x in samples),
      'codePassed':sum(bool(x['codeBehaviorPass']) for x in samples),'unknown':sum(x['usage'] is None for x in samples),
      'knownTokenSubtotal':sum(x['usage']['totalTokens'] for x in samples if x['usage']),
      'requests':sum(x['usage']['requests'] for x in samples if x['usage']),
      'adoptingAttempts':sum(bool(x['retrievalCalls']) for x in samples),
      **{k:sum(x.get(k) or 0 for x in samples) for k in ['retrievalCalls','retrievalErrors','retrievalSuboperations','retrievalSuccessfulOps','codeFirstRouteDenials','multiOperationPrograms','successfulMultiOperationPrograms']}}
totals={a:aggregate([x for x in rows if x['arm']==a]) for a in ['baseline','candidate']}
per_task={t:{a:aggregate([x for x in rows if x['taskId']==t and x['arm']==a]) for a in totals} for t in tasks}
quality=complete and totals['candidate']['accepted']>=totals['baseline']['accepted'] and totals['candidate']['codePassed']>=totals['baseline']['codePassed']
quality=quality and all(v['candidate']['accepted']>=v['baseline']['accepted'] and v['candidate']['codePassed']>=v['baseline']['codePassed'] for v in per_task.values())
change=100*(totals['candidate']['knownTokenSubtotal']/totals['baseline']['knownTokenSubtotal']-1) if complete else None
first_deltas=[]
for b in first_inputs:
    if b['arm']!='baseline' or b['input'] is None:continue
    c=next((x for x in first_inputs if x['arm']=='candidate' and x['taskId']==b['taskId'] and x['repeat']==b['repeat'] and x['input'] is not None),None)
    if c:first_deltas.append(c['input']-b['input'])
repeats={str(i):{a:aggregate([x for x in rows if x['repeat']==i and x['arm']==a]) for a in totals} for i in [1,2]}
summary={'runId':run,'scope':raw['scope'],'sourceCommits':{a:v['commit'] for a,v in raw['engine'].items()},
 'harnessSha256':raw['harnessSha256'],'manifestSha256':raw['manifestSha256'],'dependencySha256':raw['dependencySha256'],'dependenciesUnchanged':raw['dependenciesUnchanged'],'observerSha256':raw['observerSha256'],'python':raw['python'],'priorInterruptedRun':raw.get('priorInterruptedRun'),'prefixAudit':json.loads((p/'python-prefix-audit.json').read_text(encoding='utf8')),'config':raw['config'],
 'sourceUnchanged':raw['sourceUnchanged'],'harnessUnchanged':raw['harnessUnchanged'],
 'complete':complete,'planned':12,'stopReason':raw['stopReason'],'changePercent':change,'qualityGate':bool(quality),
 'gatePassed':bool(quality and change is not None and change<0),
 'mechanismExercised':totals['candidate']['retrievalSuboperations']>0,
 'successfulProgramEvidence':any(r['evidencePrograms'] for r in json.loads((p/'python-prefix-audit.json').read_text(encoding='utf8'))['rows']),
 'totals':totals,'perTask':per_task,'perRepeat':repeats,
 'firstInputDeltas':first_deltas,'rows':rows,'audit':json.loads((p/'tool-core-audit.json').read_text(encoding='utf8'))}
out=root/'benchmarks/reports'/run;out.mkdir(exist_ok=False)
text=json.dumps(summary,ensure_ascii=False,indent=2)
assert not any(x in text.lower() for x in ['administrator','appdata','api_key','bearer '])
(out/'summary.json').write_text(text,encoding='utf8')

has_failures=any(not r['accepted'] or r['usage'] is None for r in rows)
fig,ax=plt.subplots(1,2 if has_failures else 1,figsize=(12 if has_failures else 7,4.8))
axes=list(ax) if has_failures else [ax]
labels={'l1-narcissistic':'Short: new module','retrieval-retry':'Discovery: retry policy','l3-pagination':'Multi-file: pagination'}
for i,t in enumerate(tasks):
    for a,offset,color in [('baseline',-.18,'#737b86'),('candidate',.18,'#287d70')]:
        chosen=[r for r in rows if r['taskId']==t and r['arm']==a]
        good=[r['usage']['totalTokens']/1000 for r in chosen if r['accepted'] and r['usage']]
        bad=[r['usage']['totalTokens']/1000 for r in chosen if not r['accepted'] and r['usage']]
        x=i+offset
        if good:axes[0].bar(x,statistics.mean(good),width=.32,color=color,label=a if i==0 else None)
        for value in good:axes[0].scatter(x,value,color=color,edgecolor='white',s=28,zorder=3)
        for value in bad:axes[1].scatter(x,value,marker='x',color=color,s=45,label=a if i==0 else None)
        axes[0].text(x,0,f"{len(good)}/{len(chosen)}",ha='center',va='bottom',fontsize=8)
        if any(r['usage'] is None for r in chosen):axes[1].text(x,.5,'unknown',ha='center',transform=axes[1].get_xaxis_transform(),fontsize=8)
for ax,title in zip(axes,['Accepted attempts only: mean and individual runs','Failed attempts: individual known costs']):
    ax.set_title(title,fontsize=10);ax.set_ylabel('Provider tokens / run (thousands)');ax.set_xlabel('Self-authored task')
    ax.set_xticks(range(len(tasks)),[labels.get(t,t) for t in tasks],rotation=12);ax.set_ylim(bottom=0);ax.set_xlim(-.6,len(tasks)-.4);ax.grid(axis='y',alpha=.18);ax.set_axisbelow(True)
    ax.spines[['top','right']].set_visible(False)
axes[0].legend()
fig.suptitle('Synchronous Python Code Agent — streaming screening\n'+(f"Acceptance {totals['baseline']['accepted']}/{totals['baseline']['attempted']} to {totals['candidate']['accepted']}/{totals['candidate']['attempted']} | Gate passed: {summary['gatePassed']}" if complete else 'Incomplete run: no matched performance conclusion'),fontsize=13)
fig.text(.5,.015,'Source: '+run+f"\nCandidate adoption {totals['candidate']['adoptingAttempts']}/{totals['candidate']['attempted']} | GLM-5.3-flash enabled/low | Failed costs retained; unknown never zero",ha='center',fontsize=7)
fig.tight_layout(rect=[0,.05,1,.89])
for ext in ['png','svg']:fig.savefig(out/('retrieval-coding.'+ext),dpi=170)
plt.close(fig)

lines=['# 同步 Python Code Agent：真实流式筛查','',
 f"三题 × 两轮 × 两边，计划 12 次；完成 {len(rows)} 次，覆盖及用量完整：{complete}。",'',
 '本轮基线 b6f9395；候选源码和 Python/依赖指纹见 summary.json；候选及入口指纹见 summary.json。相同任务、模型、思考等级、流式与验收；候选替换检索入口、模式说明与能力声明，命令限于验证。比较整个模式，不是语言单变量消融。', '',
 f"全尝试已知 Token：{totals['baseline']['knownTokenSubtotal']:,} → {totals['candidate']['knownTokenSubtotal']:,}。"+
 (f'完整组变化 **{change:+.2f}%**。' if change is not None else '覆盖或用量不完整，不给整组变化百分比。'),'',
 f"完整验收 {totals['baseline']['accepted']}/{totals['baseline']['attempted']} → {totals['candidate']['accepted']}/{totals['candidate']['attempted']}；代码行为 {totals['baseline']['codePassed']} → {totals['candidate']['codePassed']}。",'',
 f"模型请求数 {totals['baseline']['requests']} → {totals['candidate']['requests']}。候选采用 {totals['candidate']['adoptingAttempts']}/{totals['candidate']['attempted']}；编排 {totals['candidate']['retrievalCalls']} 次，错误 {totals['candidate']['retrievalErrors']} 次，子操作 {totals['candidate']['retrievalSuboperations']} 次，成功 {totals['candidate']['retrievalSuccessfulOps']} 次。",'',
 f"候选多子操作程序 {totals['candidate']['multiOperationPrograms']} 次，其中未报工具错误（不代表程序完整或证据有效） {totals['candidate']['successfulMultiOperationPrograms']} 次；路由拒绝 {totals['candidate']['codeFirstRouteDenials']} 次。",'',
 f"同题首次输入候选减基线：{statistics.mean(first_deltas):+.2f} provider Token（配对均值）。" if first_deltas else '没有完整首次输入配对。','',
 f"质量门槛 {bool(quality)}，完整覆盖、质量不下降且总量减少的筛选门槛 **{summary['gatePassed']}**。",'',
 'v2 候选一次修改 tests/public.test.mjs，违反现有文件保护规则；该次公共/新增/隐藏行为测试仍通过，因此完整验收与代码行为单独报告。v1 仅有一个中止前的基线样本，没有候选或同题配对，不据此判断优化。','',
 '以上为预先声明的数值门槛。代码优先还需要实际成功编排的机制证据；空目录创建任务允许不检索。若实际采用率为零，即使数值门槛通过，也没有编排减少往返的真实证据，不能据此默认开启或宣称 Code Agent 收益。','',
 '![逐题成功用量与失败成本](retrieval-coding.png)','','## 逐题结果','']
for t,v in per_task.items():
    b,c=v['baseline'],v['candidate']
    lines.append(f"- {labels.get(t,t)}：验收 {b['accepted']}/{b['attempted']} → {c['accepted']}/{c['attempted']}；已知 Token {b['knownTokenSubtotal']:,} → {c['knownTokenSubtotal']:,}；候选采用 {c['adoptingAttempts']} 次任务。")
lines+=['','## 轮次和限制','']
for i,v in repeats.items():
    b,c=v['baseline'],v['candidate'];lines.append(f"- 第 {i} 轮：完成 {b['attempted']} / {c['attempted']}；已知 Token {b['knownTokenSubtotal']:,} → {c['knownTokenSubtotal']:,}。")
lines+=['','缓存输入和输出中的思考均包含且不重复累加；失败成本保留在总量，成功柱排除失败，未知不画成零。工具尝试包含子操作；外层调用与子操作分别报告。', '',
 '只有三道先前已使用的自编 Node 任务、每题两次，不是保密留出或生产泛化证明。首次输入差和生成路径波动不等于全部涨跌的因果份额。重试题是检索密集对照，短任务用于观察固定开销。', '',
 '每次 1 USD 预留；v2 组上限 3.99 USD，另保留中止 v1 的 9,647 Token / 0.0097456 USD 已知控制估价（不参与配对比例）；v1 原上限 4 USD；请求 90 秒、命令 120 秒、任务 600 秒、工具上限 24（包括子操作）。用量未知保留预留并停止，不自动重试；预算价格非发票。源码、入口和任务指纹核对，真实用量及编排计数从 ledger 审计，编辑和验证计数由加密事件独立核对。', '',
 '证据程序数、页数、空对象和 incomplete 前缀通过加密事件单独审计，详见 prefixAudit；无报错不等于实际交付有效证据。','',
 '筛选结束等待审核，不自动部署、合并或开始下一阶段。运行时是否撤销及失败原因另见实验协议的实际结果节。','',
 '[逐次数据](summary.json) · [设计、协议及实际决定](../../../docs/PYTHON_CODE_FIRST_EXPERIMENT.zh-CN.md)']
(out/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':str(out.relative_to(root)),'complete':complete,'changePercent':change,'gatePassed':summary['gatePassed'],'totals':totals}))
