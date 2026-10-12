"""Plot only B1 known paired diagnostics; the incomplete experiment is explicit."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
import numpy as np
root=Path(__file__).resolve().parents[1];p=root/'benchmarks/reports/batch-patch-b1-glm-20261012'
r=json.loads((p/'results.json').read_bytes());s=json.loads((p/'summary.json').read_bytes())
fig,axes=plt.subplots(1,3,figsize=(13,5.5),layout='constrained')
for ax,task,title in zip(axes,['small-cache-key','small-retry-budget','small-unicode'],['Cache keys','Retry budgets','Unicode']):
 rows=[x for x in r['completePairDiagnostics'] if x['taskId']==task]
 for i,role,color in [(0,'baseline','#8671bb'),(1,'candidate','#398b75')]:
  vals=[x[role+'Tokens'] for x in rows]
  ax.bar(i,sum(vals)/len(vals),color=color,width=.62)
  ax.scatter(i+np.linspace(-.16,.16,len(vals)),vals,c=color,edgecolors='white',s=36,zorder=3)
 b=sum(x['baselineTokens'] for x in rows);c=sum(x['candidateTokens'] for x in rows)
 ax.set_title(f'{title}\nKnown-pair diagnostic: {(c/b-1)*100:+.2f}%',fontsize=12)
 ax.set_xticks([0,1],['TEA baseline','TEA batch'])
 ax.yaxis.set_major_formatter(FuncFormatter(lambda v,_:f'{v/1000:g}k'))
 ax.set_ylim(0,max(x[k] for x in rows for k in ['baselineTokens','candidateTokens'])*1.15)
 ax.grid(axis='y',alpha=.18);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Mean provider tokens/run — known paired subset only')
fig.suptitle('B1 interrupted pilot — NO full-experiment performance conclusion',fontsize=15)
fig.supxlabel('21 known pairs shown; one additional pair has unknown baseline usage and is retained in the report.\n44/102 planned runs attempted; timeout halted paid calls. Runtime reverted. Dots show every sample in this subset.',fontsize=10)
for extension in ['png','svg']:fig.savefig(p/('b1-tokens.'+extension),dpi=170)
print('Generated explicitly incomplete B1 diagnostic plot')
