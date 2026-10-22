"""S6 frozen live experiment: all attempts, independent quality, and execution exposure."""
import hashlib,json,pathlib,statistics,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
run_id=sys.argv[1]
if not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in run_id):raise ValueError('Invalid run ID')
source=ROOT/'benchmarks/results'/run_id/'comparison.json';raw=json.loads(source.read_text(encoding='utf8'))
assert raw['mode']=='live' and raw.get('endedAt') and not any(x['running'] for x in raw['rows'])
keys=['id','taskId','title','repeat','arm','status','accepted','publicPassed','hiddenPassed','addedTestsPassed',
      'protectedFilesUnchanged','allowedChanges','changedFiles','deletedFiles','validationPassed','validationAttempts',
      'usage','usageComplete','toolCalls','toolErrors','writeExistingErrors','singleReadCalls','firstRequestInputTokens',
      'versionedWriteAttempts','versionedWriteSuccesses','versionedWriteErrors','commandTimeouts','elapsedMs','knownPartialUsage','retainedReservationUsd']
rows=[{k:r.get(k) for k in keys} for r in raw['rows']]
for r,original in zip(rows,raw['rows']):
 r['codeBehaviorPass']=bool(r['publicPassed'] and r['hiddenPassed'] and r['addedTestsPassed'])
 assert r['codeBehaviorPass']==original.get('codeBehaviorPass',False)
 if r['usage']:assert r['usage']['inputTokens']+r['usage']['outputTokens']==r['usage']['totalTokens']
complete=raw['complete'] and raw['sourceUnchanged'] and len(rows)==raw['planned'] and all(r['usage'] and r['usageComplete'] for r in rows)
def aggregate(samples):
 known=bool(samples) and all(r['usage'] for r in samples)
 result={'attempted':len(samples),'accepted':sum(bool(r['accepted']) for r in samples),'codeBehaviorPass':sum(r['codeBehaviorPass'] for r in samples),
  'providerTokens':sum(r['usage']['totalTokens'] for r in samples) if known else None,
  'knownTokenSubtotal':sum(r['usage']['totalTokens'] for r in samples if r['usage']),
  'knownPartialTokenSubtotal':sum((r.get('knownPartialUsage') or {}).get('totalTokens',0) for r in samples),
  'interruptedAttempts':sum(r['status']=='interrupted_unknown_usage' for r in samples),
  'completedAttempts':sum(bool(r['usageComplete']) for r in samples),
  'completedAccepted':sum(bool(r['accepted']) for r in samples if r['usageComplete']),
  'completedCodeBehaviorPass':sum(r['codeBehaviorPass'] for r in samples if r['usageComplete']),
  'attemptsWithReplacement':sum(bool(r['versionedWriteSuccesses']) for r in samples)}
 for k in ['versionedWriteAttempts','versionedWriteSuccesses','versionedWriteErrors','commandTimeouts','toolCalls','toolErrors','writeExistingErrors','singleReadCalls']:result[k]=sum(r.get(k) or 0 for r in samples)
 for k in ['inputTokens','outputTokens','cachedInputTokens','cacheCreationInputTokens','requests','compactionRequests']:result[k]=sum(r['usage'][k] or 0 for r in samples) if known else None
 return result
arms={a:[r for r in rows if r['arm']==a] for a in ['baseline','candidate']}
totals={a:aggregate(rs) for a,rs in arms.items()}
tasks=[{'id':tid,'title':next((r['title'] for r in rows if r['taskId']==tid),tid),**{a:aggregate([r for r in rs if r['taskId']==tid]) for a,rs in arms.items()}} for tid in raw['taskIds']]
quality=bool(complete and all(totals['candidate'][k]>=totals['baseline'][k] and all(t['candidate'][k]>=t['baseline'][k] for t in tasks) for k in ['accepted','codeBehaviorPass']))
change=100*(totals['candidate']['providerTokens']/totals['baseline']['providerTokens']-1) if complete else None
gate=bool(quality and change<0 and totals['candidate']['versionedWriteSuccesses']>0)
assert quality==raw['qualityGatePassed'] and gate==raw['gatePassed']
audit=json.loads((source.parent/'versioned-write-audit.json').read_text(encoding='utf8'))
assert audit['auditedAttempts']==len(rows)
matched=[];first=[]
for r in arms['baseline']:
 c=next((c for c in arms['candidate'] if c['taskId']==r['taskId'] and c['repeat']==r['repeat']),None)
 if c and c['accepted'] and r['accepted'] and r['usage'] and c['usage']:matched.append((r,c))
 if c and c['firstRequestInputTokens'] is not None and r['firstRequestInputTokens'] is not None:first.append(c['firstRequestInputTokens']-r['firstRequestInputTokens'])
paired={a:sum(pair[i]['usage']['totalTokens'] for pair in matched) for i,a in enumerate(arms)}
paired_change=100*(paired['candidate']/paired['baseline']-1) if paired['baseline'] else None
repeats=[{'repeat':n,**{a:aggregate([r for r in rs if r['repeat']==n]) for a,rs in arms.items()}} for n in range(1,raw['repeats']+1)]
summary={k:raw.get(k) for k in ['runId','phase','createdAt','endedAt','engine','config','taskIds','repeats','planned','candidateFlag','hypothesis','stoppingPolicy','gate','scope','harnessSha256','harnessNormalizedSha256','manifestSha256','preflight','fixedDefinitions','sourceUnchanged','stopReason','consumedUsd','interruption']}
summary.update({'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverageComplete':complete,'totals':totals,'changePercent':change,'qualityGatePassed':quality,'gatePassed':gate,'perTask':tasks,'perRepeat':repeats,'rows':rows,'audit':audit,
 'bothAccepted':{'pairs':len(matched),'totals':paired,'changePercent':paired_change},'firstInputDeltas':first})
target=ROOT/'benchmarks/reports'/run_id;target.mkdir(exist_ok=False)
(target/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,(ax,bx)=plt.subplots(2,1,figsize=(max(8,len(tasks)*1.4),7),sharex=True,gridspec_kw={'height_ratios':[3,1.2],'hspace':.3})
colors={'baseline':'#8c83b8','candidate':'#318473'}
for i,t in enumerate(tasks):
 for a,shift in [('baseline',-.18),('candidate',.18)]:
  samples=[r for r in arms[a] if r['taskId']==t['id']];passed=[r for r in samples if r['accepted'] and r['usage']]
  if passed:ax.bar(i+shift,statistics.mean(r['usage']['totalTokens'] for r in passed)/1000,width=.34,color=colors[a])
  else:ax.annotate('n/a',(i+shift,0),xytext=(0,5),textcoords='offset points',ha='center')
  for n,r in enumerate(samples):
   if r['usage']:(ax if r['accepted'] else bx).scatter(i+shift+(n-(len(samples)-1)/2)*.06,r['usage']['totalTokens']/1000,marker='o' if r['accepted'] else 'x',color=colors[a],edgecolors='white' if r['accepted'] else None,zorder=3)
  unknown=sum(not r['usage'] for r in samples)
  if unknown:bx.text(i+shift,.5,f'{unknown} unknown\n(interrupted)',transform=bx.get_xaxis_transform(),ha='center',va='center',color=colors[a],fontsize=9)
  ax.annotate(f'{len(passed)}/{len(samples)}',(i+shift,0),xytext=(0,-15),textcoords='offset points',ha='center',fontsize=8)
ax.set_title('Accepted attempts only: mean bars and individual dots');ax.set_ylabel('Provider tokens / attempt (thousands)');ax.margins(y=.2)
ax.legend(handles=[Patch(facecolor=colors[a],label=a) for a in arms],frameon=False)
bx.set_title('Failed attempt costs: separate scale, included in total');bx.set_ylabel('Failed attempts\n(thousands)');bx.set_ylim(bottom=0)
bx.set_title('Failed/interrupted attempts: unknown usage has no numeric value')
if not any(not r['accepted'] and r['usage'] for r in rows):bx.set_yticks([]);bx.set_ylabel('Unknown usage\nnot plotted as zero')
labels={'l1-narcissistic':'New module','l1-intervals':'Interval merge','l2-ttl-cache':'TTL cache'}
bx.set_xticks(range(len(tasks)),[labels.get(t['id'],t['id']) for t in tasks]);bx.tick_params(axis='x',pad=8);bx.set_xlabel('Task; acceptance counts below upper bars')
for axis in [ax,bx]:axis.grid(axis='y',alpha=.15);axis.set_axisbelow(True)
fig.suptitle(f'S6 {raw["phase"]} — '+('version-checked full replacement' if complete else 'INCOMPLETE; no full-suite token ratio'),fontsize=15)
fig.text(.5,.02,f'GLM-5.3-flash · enabled / low · {raw["repeats"]} repeats planned per task and arm · unknown usage unplotted.\nSource: {run_id}. Self-authored Node.js tasks; no production/generalization claim.',ha='center',fontsize=8)
fig.subplots_adjust(left=.12,right=.97,top=.89,bottom=.19)
fig.savefig(target/'s6-coding.png',dpi=200);fig.savefig(target/'s6-coding.svg');plt.close(fig)
svg=target/'s6-coding.svg';svg.write_text('\n'.join(x.rstrip() for x in svg.read_text(encoding='utf8').splitlines())+'\n',encoding='utf8')
lines=[f'# S6 {raw["phase"]}：版本校验完整替换','',f'计划 {raw["planned"]} 次，尝试 {len(rows)} 次，其中用量完整 {sum(bool(r["usageComplete"]) for r in rows)} 次；覆盖与用量完整：{complete}。','']
if not raw.get('interruption'):lines += [f'完整验收：{totals["baseline"]["accepted"]}/{len(arms["baseline"])} → {totals["candidate"]["accepted"]}/{len(arms["candidate"])}；独立代码行为：{totals["baseline"]["codeBehaviorPass"]}/{len(arms["baseline"])} → {totals["candidate"]["codeBehaviorPass"]}/{len(arms["candidate"])}。','']
if complete:lines += [f'全尝试 provider Token **{totals["baseline"]["providerTokens"]:,} → {totals["candidate"]["providerTokens"]:,}，{"增加" if change>=0 else "减少"} {abs(change):.2f}%**。','']
else:lines += ['用量或覆盖不完整，不给整组百分比；未知不按零处理。','']
if raw.get('interruption'):
 lines += ['**运行中断，不能据此推断 Agent 正确率下降。** 原测试进程已不存在，第九次尝试有一个未结算请求；原始结果快照保留，离线结束记录，不重试模型请求。',
  f'已完成且用量完整的样本：基线验收 {totals["baseline"]["completedAccepted"]}/{totals["baseline"]["completedAttempts"]}、代码行为 {totals["baseline"]["completedCodeBehaviorPass"]}/{totals["baseline"]["completedAttempts"]}；候选验收 {totals["candidate"]["completedAccepted"]}/{totals["candidate"]["completedAttempts"]}、代码行为 {totals["candidate"]["completedCodeBehaviorPass"]}/{totals["candidate"]["completedAttempts"]}。',
  f'中断尝试的已确认请求片段另有 {totals["baseline"]["knownPartialTokenSubtotal"]+totals["candidate"]["knownPartialTokenSubtotal"]:,} Token；该尝试总用量未知，预留 1 USD 保持，不伪造为完整计费。','']
lines += [f'质量门槛：{quality}；综合门槛：**{gate}**。Token 包含缓存输入与输出中的思考，不重复累加。','',
 '![逐题结果](s6-coding.png)','','## 每题与每轮','']
for t in tasks:lines += [f'- {t["title"]}：验收 {t["baseline"]["accepted"]} → {t["candidate"]["accepted"]}；代码行为 {t["baseline"]["codeBehaviorPass"]} → {t["candidate"]["codeBehaviorPass"]}；Token {t["baseline"]["providerTokens"]} → {t["candidate"]["providerTokens"]}。']
for t in repeats:lines += [f'- 第 {t["repeat"]} 轮：验收 {t["baseline"]["accepted"]} → {t["candidate"]["accepted"]}；Token {t["baseline"]["providerTokens"]} → {t["candidate"]["providerTokens"]}。']
lines += ['',f'双方均通过 {len(matched)} 对，累计 Token {paired["baseline"]} → {paired["candidate"]}，变化 {round(paired_change,2) if paired_change is not None else "未知"}%。此子集不替代总体。','','## 触发与成本','']
for a,x in totals.items():lines += [f'- {a}：版本替换 {x["versionedWriteAttempts"]} 次尝试、{x["versionedWriteSuccesses"]} 成功、{x["versionedWriteErrors"]} 错误，{x["attemptsWithReplacement"]} 次任务采用；创建遇到已有文件拒绝 {x["writeExistingErrors"]} 次；模型请求 {x["requests"]} 次，工具错误 {x["toolErrors"]} 次，单文件读取 {x["singleReadCalls"]} 次。']
if first:lines += ['',f'首次输入配对差均值 **{statistics.mean(first):.2f} provider Token**（候选减基线，范围 {min(first)}–{max(first)}）。固定工具定义及能力说明有开销，工作区标识也有少量分词差异。']
lines += ['','加密工具事件与实时观察器逐项核对；每次 provider ledger 总量与结果一致。审计同时记录模型哈希不匹配、证据不可用及版本过期计数，前两者可能重叠，见 summary.json。','','## 未通过样本','']
failed=[r for r in rows if not r['accepted']]
for r in failed:lines += [f'- {r["id"]}：status={r["status"]}；公开={r["publicPassed"]}；隐藏={r["hiddenPassed"]}；新增测试={r["addedTestsPassed"]}；保护文件={r["protectedFilesUnchanged"]}；允许变更={r["allowedChanges"]}；验证={r["validationPassed"]}；Token={r["usage"]["totalTokens"] if r["usage"] else "未知"}。']
if not failed:lines += ['全部样本完整验收通过。']
lines += ['','## 方法与解释边界','','同模型、思考等级、任务与初始文件；交替顺序，每次新工作区，题目/源码/入口冻结。有限预算和超时，未知用量停止并保留预留，不付费重试。成功柱排除失败，失败成本另图并计入全量。',
 '', '短筛选只决定是否进入完整确认，不证明统计显著性。独立生成轨迹的变化不能全部归因于替换机制；未触发样本尤其不能作机制归因。筛选与确认分开报告，不挑选合并百分比。',
 '', '替换有提交前复核与暂存失败保护，最终复核到 rename 仍有外部竞争窗口，且 rename 改变 inode；自定义 ACL/扩展属性等生产语义未完整保证。实验开关默认关闭，不宣称原子 CAS 或生产可用。',
 '', '[公开逐次数据与配置指纹](summary.json)；原始日志及工作区私有。阶段协议见 [S6](../../../docs/CODING_S6_EXPERIMENT.md)。','','## 决定','',
 ('筛选通过，可按冻结协议进入完整确认；目前不能作为最终收益。' if raw['phase']=='screen' else '确认门槛通过，仍保持默认关闭等待用户审核和生产兼容性审查。') if gate else '未通过预设门槛，停止后续付费确认并撤销运行时改动；最终回归记录见阶段文档。']
(target/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'report':target.relative_to(ROOT).as_posix(),'gatePassed':gate,'changePercent':change,'totals':totals},ensure_ascii=False))
