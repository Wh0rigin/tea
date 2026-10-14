"""Matched-task diagnostic report; failures retain their measured token cost."""
import hashlib
import json
import pathlib
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
run_id = sys.argv[1]
if not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run_id): raise ValueError('Invalid run ID')
raw = json.loads((ROOT/'benchmarks/results'/run_id/'comparison.json').read_text(encoding='utf8'))
tea_file = ROOT/'benchmarks/reports/coding-ability-glm-20261014-v1/summary.json'
tea = json.loads(tea_file.read_text(encoding='utf8'))
if hashlib.sha256(tea_file.read_bytes()).hexdigest() != raw['baselineSummarySha256']: raise RuntimeError('Recorded TEA results changed')
if any(row.get('running') for row in raw['rows']): raise RuntimeError('Pi run is still active')
if raw['mode'] != 'live': raise RuntimeError('Prepare/scripted data is not provider evidence')
if not raw['piSourceUnchanged']: raise RuntimeError('Native Pi changed during run')
expected={'model':raw['common']['model'],'maxTokens':4096,'thinking':{'type':'enabled','budget_tokens':4095},'outputConfig':{'effort':'low'}}
if any(row.get('submitted') and row.get('normalizedControls') != expected for row in raw['requests']): raise RuntimeError('Model controls mismatch')
pi_map={row['id']:row for row in raw['rows']}
rows=[]
for old in tea['tasks']:
    new=pi_map.get(old['id'])
    if new and new.get('usage'):
        u=new['usage']
        if u['totalTokens'] != u['inputTokens']+u['outputTokens']: raise RuntimeError('Inconsistent Pi usage')
    rows.append({'id':old['id'],'level':old['level'],'title':old['title'],
        'tea':{key:old.get(key) for key in ['accepted','functionalPass','status','usage','toolCalls','toolErrors','validationPassed','validationAttempts']},
        'pi':{key:new.get(key) for key in ['agentStarted','accepted','functionalPass','status','usage','toolCalls','toolErrors','validationPassed','validationAttempts',
            'publicPassed','addedTestsPassed','hiddenPassed','hiddenCompleted','protectedFilesUnchanged','allowedChanges','compactions','guards','matchedInitialTreeSha256']} if new else None})
complete=raw['complete'] and len(rows)==8 and all(row['pi'] and row['pi']['agentStarted'] and row['pi']['usage'] and row['tea']['usage'] for row in rows)
def total(agent,subset): return sum(row[agent]['usage']['totalTokens'] for row in subset)
known=[row for row in rows if row['pi'] and row['pi']['usage']]
both_passed=[row for row in known if row['tea']['accepted'] and row['pi']['accepted']]
both_functional=[row for row in known if row['tea']['functionalPass'] and row['pi']['functionalPass']]
totals={'plannedTasks':8,'piAttempted':sum(bool(row['pi'] and row['pi']['agentStarted']) for row in rows),
        'teaAccepted':sum(bool(row['tea']['accepted']) for row in rows),'piAccepted':sum(bool(row['pi'] and row['pi']['accepted']) for row in rows),
        'piFunctionalPass':sum(bool(row['pi'] and row['pi']['functionalPass']) for row in rows),'usageComplete':complete,
        'teaAllAttemptTokens':total('tea',rows),'piAllAttemptTokens':total('pi',rows) if complete else None,
        'piKnownSubtotal':total('pi',known),'knownMatchedSamples':len(known),
        'bothPassedTasks':len(both_passed),'teaBothPassedTokens':total('tea',both_passed),'piBothPassedTokens':total('pi',both_passed)}
totals.update({'bothFunctionalTasks':len(both_functional),'teaBothFunctionalTokens':total('tea',both_functional),'piBothFunctionalTokens':total('pi',both_functional)})
totals['teaChangeVsPiPercent']=100*(totals['teaAllAttemptTokens']/totals['piAllAttemptTokens']-1) if complete and totals['piAllAttemptTokens'] else None
totals['teaBothPassedChangeVsPiPercent']=100*(totals['teaBothPassedTokens']/totals['piBothPassedTokens']-1) if totals['piBothPassedTokens'] else None
totals['teaBothFunctionalChangeVsPiPercent']=100*(totals['teaBothFunctionalTokens']/totals['piBothFunctionalTokens']-1) if totals['piBothFunctionalTokens'] else None
report={key:raw.get(key) for key in ['schema','runId','createdAt','endedAt','source','baselineRunId','baselineSummarySha256','manifestSha256','pi','common','differences','complete','stopReason','piSourceUnchanged','accountedUsd']}
report.update({'totals':totals,'tasks':rows,'comparisonRawSha256':hashlib.sha256((ROOT/'benchmarks/results'/run_id/'comparison.json').read_bytes()).hexdigest()})
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')

plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(figsize=(12.6,6.4));colors={'tea':'#318473','pi':'#8873b7'}
for i,row in enumerate(rows):
    for agent,shift in [('tea',-.18),('pi',.18)]:
        sample=row[agent];value=sample['usage']['totalTokens']/1000 if sample and sample['usage'] else None
        if value is None: ax.text(i+shift,.02,'Unknown / not run',rotation=90,ha='center',transform=ax.get_xaxis_transform());continue
        failed=not sample['functionalPass']; unconfirmed=sample['functionalPass'] and not sample['accepted']
        ax.bar(i+shift,value,width=.34,color=colors[agent],hatch='///' if failed else None,edgecolor='black' if failed else 'white',linewidth=.6,zorder=3)
        ax.annotate(f'{value:.1f}'+(' F' if failed else ' U' if unconfirmed else ''),(i+shift,value),xytext=(0,4),textcoords='offset points',ha='center',fontsize=9)
for cut in [1.5,3.5,5.5]:ax.axvline(cut,color='#dadce0',linewidth=.8)
ax.set_xticks(range(8),['Narcissistic\nmodule','Interval\nmerging','Quoted\nCSV','TTL\ncache','Async\nscheduler','Cursor\npagination','Atomic\ntransfers','Dependency\nplanner'])
ax.set_ylabel('Provider tokens / attempt (thousands)');ax.set_xlabel('Author-assigned difficulty: L1 / L2 / L3 / L4');ax.grid(axis='y',color='#eaebee',zorder=0);ax.margins(y=.22)
ax.legend(handles=[Patch(facecolor=colors['tea'],label='TEA (recorded cohort)'),Patch(facecolor=colors['pi'],label='Pi 0.87.1 (new cohort)'),Patch(facecolor='white',edgecolor='black',hatch='///',label='F: functional failure; U: native validation unconfirmed')],frameon=False,loc='upper right')
fig.suptitle(f'Functional checks — TEA 8/8 · Pi {totals["piFunctionalPass"]}/8 | Workflow checks — TEA 8/8 · Pi {totals["piAccepted"]}/8',fontsize=15,y=.97)
fig.text(.5,.02,'GLM-5.3-flash · enabled thinking / low · 4,096 output cap · one attempt per task\nAll known attempted costs shown, including failures. Inputs include cache reads/writes; reasoning not added twice.\nSequential self-authored Node.js cohorts; no timing speedup or general coding-accuracy claim. Source: '+run_id,ha='center',fontsize=9)
fig.tight_layout(rect=(0,.12,1,.94));fig.savefig(target/'tea-vs-pi-coding.png',dpi=200);fig.savefig(target/'tea-vs-pi-coding.svg');plt.close(fig)

def change(value): return f'{"增加" if value>=0 else "减少"} **{abs(value):.2f}%**'
lines=['# TEA / Pi 编码能力横向对比','',f'模型：GLM-5.3-flash / enabled thinking / low；输出上限 4,096 Token。相同 8 道自编 Node.js 题，每题一次。复用先前 TEA 数据，新增 Pi 原生运行。','',
       f'完整验收：**TEA {totals["teaAccepted"]}/8，Pi {totals["piAccepted"]}/8**。Pi 功能验收 {totals["piFunctionalPass"]}/8；功能正确与工作流验证分开计数。','']
if complete:
    lines += [f'全尝试累计 Token：TEA **{totals["teaAllAttemptTokens"]:,}**；Pi **{totals["piAllAttemptTokens"]:,}**。TEA 相比 Pi {change(totals["teaChangeVsPiPercent"])}。此总量包含失败样本的实际消耗，需结合验收率阅读。','']
else: lines += ['覆盖或用量不完整，不报告全轮 Token 比例；未知不按零处理。','']
lines += [f'双方功能均通过的 **{len(both_functional)} 道题**：TEA {totals["teaBothFunctionalTokens"]:,} Token；Pi {totals["piBothFunctionalTokens"]:,} Token。'+(f'TEA {change(totals["teaBothFunctionalChangeVsPiPercent"])}。' if both_functional else ''), '',
          f'双方完整工作流均通过的 **{len(both_passed)} 道题**：TEA {totals["teaBothPassedTokens"]:,} Token；Pi {totals["piBothPassedTokens"]:,} Token。'+(f'TEA {change(totals["teaBothPassedChangeVsPiPercent"])}。' if both_passed else ''), '',
          '![逐题对比](tea-vs-pi-coding.png)','','## 每题结果','']
for row in rows:
    p=row['pi']; t=row['tea']; pt=f'{p["usage"]["totalTokens"]:,}' if p and p['usage'] else '未知/未运行'
    grade='通过' if p and p['accepted'] else '功能通过，原生验证未确认' if p and p['functionalPass'] else '功能未通过/未运行'
    lines += [f'- **L{row["level"]} · {row["title"]}**：TEA {t["usage"]["totalTokens"]:,} Token（{"通过" if t["accepted"] else "未通过"}）；Pi {pt} Token（{grade}）。']
lines += ['','## 方法与限制','','独立验收与 TEA 首轮相同：原有公开测试、额外边界测试、保护文件、增加的测试、任务完成与修改后实际验证。功能失败样本保留消耗，图中用斜线和 F 标记；U 表示代码通过独立检查，但原生验证未确认，不直接当作编码错误。没有将失败计作零，也没有静默重试。','',
          '两组先后运行，每题仅一次，不能证明稳定优势或给出通用成功率。相同模型/思考/输出参数通过新 Pi 请求观察及旧 TEA 冻结配置匹配；旧 TEA 未记录服务端地址指纹，地址连续性依赖此前配置记录。保留原生工具和压缩策略，Pi 原生 PowerShell 与 TEA 批准策略不同。Pi 模型容量匹配相同保守配置，其摘要预留保持原生默认值。','',
          '费用是有限预算下的保守核算，非账户账单。原始会话和临时路径未发布；源码指纹、完整逐题数据、实际用量及限制见 [summary.json](summary.json)。复现方法见 [横向评测说明](../../../docs/CODING_PI_COMPARISON.md)。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'totals':totals},ensure_ascii=False))
