"""Publish reviewed scalar aggregates only; never consumes raw transcripts."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--private-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
reports=[]
for kind in ['deepswe','wb']:
 r=json.loads((a.private_root/f'native-pi-s0-{kind}-20261022/aggregate-final.json').read_text())
 if r['status'] not in ['completed','completed_with_unknown_usage','stopped']:raise ValueError('Cohort still running')
 reports.append(r)
runs=[x for r in reports for x in r['runs']];pairs=[x for r in reports for x in r['pairs']];eligible=[x for x in pairs if x['eligibleBothPassed']]
s={}
for arm in ['tea','pi']:
 selected=[r for r in runs if r['arm']==arm];known=bool(selected) and all(r['metered'] for r in selected)
 s[arm]={'planned':12,'attempted':len(selected),'officialEvaluated':sum(r['officialFullPass'] is not None for r in selected),'officialFullPassed':sum(r['officialFullPass'] is True for r in selected),'meteredAttempts':sum(r['metered'] for r in selected),'allAttemptTokens':sum(r['totalTokens'] for r in selected) if known and len(selected)==12 else None}
t=sum(x['teaTokens'] for x in eligible);q=sum(x['piTokens'] for x in eligible)
combined={'plannedAttempts':24,'attempted':len(runs),'scope':'Six previously seen tasks; two repeats per agent; diagnostic only','aggregates':s,'officialPassRateGapPercentagePoints':100*(s['tea']['officialFullPassed']-s['pi']['officialFullPassed'])/12,'bothPassedEfficiency':{'pairs':len(eligible),'plannedPairs':12,'teaTokens':t if eligible else None,'piTokens':q if eligible else None,'teaTokenReductionPercent':100*(1-t/q) if q else None},'unknownReservations':[x for r in reports for x in r['unknownReservations']],'unstarted':[x for r in reports for x in r['unstarted']]}
for kind,r in zip(['deepswe','wb'],reports):(a.report/f'{kind}-results.json').write_text(json.dumps(r,indent=2)+'\n')
(a.report/'summary.json').write_text(json.dumps(combined,indent=2)+'\n')
md=['# S0 实测结果：TEA 与原生 Pi','',f"已执行 {len(runs)}/24 次。任务均为此前见过的 6 道题，每个 Agent 每题重复两次；不代表完整基准分数或未见题泛化能力。",'','## 正确率优先','']
for kind,r in zip(['DeepSWE','WorkBuddy'],reports):
 for arm in ['tea','pi']:
  z=r['aggregates'][arm];md.append(f"- {kind} / {arm.upper()}：官方整题通过 **{z['officialFullPassed']}/{z['planned']}**；已验收 {z['officialEvaluated']} 次；原生完成且整题通过 {z['nativeCompletedAndOfficialPassed']} 次。")
md+=['',f"合计 TEA **{s['tea']['officialFullPassed']}/12**，Pi **{s['pi']['officialFullPassed']}/12**；观察到的通过率差为 **{combined['officialPassRateGapPercentagePoints']:+.2f} 个百分点**。这是小样本结果，不能据此证明统计等效。",'','## Token','']
if eligible:md.append(f"双方整题都通过且初始状态、指令及独立用量核对一致的 **{len(eligible)}/12 对**：TEA **{t:,}**，Pi **{q:,}**；TEA 总 Token **{'减少' if t<q else '增加'} {abs(100*(1-t/q)):.2f}%**。该数字只适用于这些对应样本。")
else:md.append('没有符合条件的双方通过样本，不能给出等质量工作的 Token 节省结论。')
if combined['officialPassRateGapPercentagePoints']<0:md+=['','**TEA 本轮整体通过率较低，不能把上述子集用量差异表述为整体优化成功。**']
md+=['','Token 包含输入、输出、缓存读取及缓存写入；思考已计入输出，不重复加算。失败不进入收益条形图，但保留在验收分母和完整记录中。未知用量保持 null，不能当作 0。','']
for arm in ['tea','pi']:
 z=s[arm];v=f"{z['allAttemptTokens']:,}" if z['allAttemptTokens'] is not None else '未知或未完成';md.append(f"- {arm.upper()} 全部尝试用量（含失败）：{v} Token；独立核对通过 {z['meteredAttempts']}/{z['attempted']} 次。这个总量不构成等质量收益。")
md+=['','![Official acceptance and matched token use](native-pi-s0.png)','','## 每次结果','']
for r in reports:
 for x in r['runs']:
  v=f"{x['totalTokens']:,}" if x['totalTokens'] is not None else 'unknown';g=x['officialGrade'] or {};test=f"{g.get('tests_passed')}/{g.get('tests_total')}" if 'tests_total' in g else str(g.get('reward','unknown'));md.append(f"- {r['benchmark']} · {x['taskId']} · r{x['repeat']} · {x['arm']}：official={'pass' if x['officialFullPass'] is True else 'fail' if x['officialFullPass'] is False else 'unknown'} ({test})；native={x['agentStatus']}；Token={v}；工具报错={sum(x['toolErrorsByName'].values())}；未提交保护={','.join(x['knownNotSubmittedGuards']) or 'none'}。")
md+=['','## 解释边界','', '- 本轮只建立新的原生 Agent 基线，没有修改 TEA 的解题逻辑。先审核本轮，再决定 S1。','- 模型、上游思考预算及 effort 一致；原生提示词、工具、命令权限和压缩策略保留差异。TEA 命令策略比 Pi 原生 Bash 更受限，因此不能把差距全部归因于模型或 ContextOS。','- 新实验工具上限为 4096，主约束是 128 次提供商请求、1800 秒和每次 10 USD 控制预算。不能复用此前 96 工具上限的历史总量。','- 131072 是任务输出上限；Pi 会按原生上下文策略降低实际输出限额，双方摘要请求也有不同的原生限额。','- 两次重复、见过的任务和随机轨迹不足以证明普遍优劣。官方评分故障、执行失败和未知用量均保留，不能静默重试或改分。','- 详细协议、源码/镜像哈希见 [英文方法](README.md)，逐次标量见 [DeepSWE](deepswe-results.json)、[WorkBuddy](wb-results.json)。不发布模型推理或完整会话。','']
(a.report/'RESULTS.zh-CN.md').write_text('\n'.join(md),encoding='utf-8')
print(json.dumps(combined))
