"""Scientific figure from the complete four-arm provider comparison."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
import numpy as np
root=Path(__file__).resolve().parents[1];p=root/'benchmarks/reports/combined-memory-glm-20261013'
r=json.loads((p/'results.json').read_bytes());s=json.loads((p/'summary.json').read_bytes())
if not r['complete']:raise SystemExit('No full-experiment figure from an incomplete run')
roles=['full_off','full_auto','contextos_off','contextos_auto'];labels=['Full/off','Full/auto','Ctx/off','Ctx/auto'];colors=['#afb3bb','#d09a54','#8170b6','#35866f']
fig,axes=plt.subplots(1,3,figsize=(16,5.4),layout='constrained')
for ax,case,title in zip(axes,['short','protected','evictable'],['Short task','Protected seeded history','Evictable seeded history']):
 rows=[x for x in r['runs'] if x['caseId']==case]
 for i,(role,color) in enumerate(zip(roles,colors)):
  subset=[x for x in rows if x['variant']==role];values=[x['totalTokens'] for x in subset]
  ax.bar(i,sum(values)/len(values),color=color,width=.63)
  for offset,x in zip(np.linspace(-.17,.17,len(subset)),subset):ax.scatter(i+offset,x['totalTokens'],c=color,edgecolors='white',s=33,marker='o' if x['accepted'] else 'x',zorder=3)
  ax.text(i,.97,f"{sum(x['accepted'] for x in subset)}/4 accepted\n{sum(x['summaryRequests'] for x in subset)} summaries",ha='center',va='top',transform=ax.get_xaxis_transform(),fontsize=8)
 b=sum(x['totalTokens'] for x in rows if x['variant']=='contextos_off');c=sum(x['totalTokens'] for x in rows if x['variant']=='contextos_auto')
 active=sum(x['summaryRequests'] for x in rows if x['variant']=='contextos_auto')>0
 ax.set_title(f'{title}\nCombined vs Ctx/off: {(c/b-1)*100:+.2f}%'+(' (active)' if active else ' (summary inactive)'),fontsize=11)
 ax.set_xticks(range(4),labels,rotation=20)
 ax.set_ylim(0,max(x['totalTokens'] for x in rows)*1.28);ax.yaxis.set_major_formatter(FuncFormatter(lambda v,_:f'{v/1000:g}k'))
 ax.grid(axis='y',alpha=.2);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Mean provider tokens/run; every attempt shown')
fig.suptitle('ContextOS + automatic compaction — four repeats per case, same GLM-5.3-flash',fontsize=15)
fig.supxlabel('All cache input, thinking output and summary calls included. Pressure history is scripted real-tool setup, not model-generated.\nConditional retrieval-entry gap remains; no default-enablement claim. Inactive-summary differences are observational.',fontsize=10)
for ext in ['png','svg']:
 target=p/('combined-tokens.'+ext);fig.savefig(target,dpi=170)
 if ext=='svg':target.write_bytes(target.read_bytes().replace(b'\r\n',b'\n'))
print('Generated complete four-arm provider-token figure')
