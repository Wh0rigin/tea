"""Plot the complete S1 provider comparison; all paid attempts stay included."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'benchmarks/reports/small-task-s1-glm-20261012'
data=json.loads((FOLDER/'results.json').read_bytes())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none'})
colors={'baseline':'#64748b','candidate':'#0f766e'}
names={'cache-key':'Cache keys','retry-budget':'Retry budgets','unicode':'Unicode'}
small=[r for r in data['runs'] if r['scale']=='small']
fig,axes=plt.subplots(1,3,figsize=(11.8,4.8),layout='constrained')
for ax,family in zip(axes,['cache-key','retry-budget','unicode']):
 rows={role:[r for r in small if r['taskId']==f'small-{family}' and r['agent']==role] for role in colors}
 for x,role in enumerate(colors):
  values=[r['totalTokens']/1000 for r in rows[role]]
  ax.bar(x,sum(values)/len(values),color=colors[role],alpha=.7,width=.55)
  for i,r in enumerate(rows[role]):
   offset=(i-(len(values)-1)/2)*.025
   ax.scatter(x+offset,r['totalTokens']/1000,s=28,marker='o' if r['accepted'] else 'x',
      color=colors[role] if r['accepted'] else '#b45309',edgecolors='white' if r['accepted'] else None,zorder=3)
 ax.set_xticks([0,1],[f'S0 parent\n{sum(r["accepted"] for r in rows["baseline"])}/10 accepted',f'S1 candidate\n{sum(r["accepted"] for r in rows["candidate"])}/10 accepted'])
 ax.set_title(names[family]);ax.set_ylim(bottom=0);ax.yaxis.grid(alpha=.15);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Provider tokens / run (thousands)')
fig.suptitle('S1 small tasks — 10 paired repeats per family',weight='bold',fontsize=14)
fig.supxlabel('Bars: means · Dots: all runs · Orange crosses: frozen v3 nonacceptance · Native cache and reasoning count',fontsize=9)
fig.savefig(FOLDER/'s1-small-tokens.png',dpi=180);fig.savefig(FOLDER/'s1-small-tokens.svg');plt.close(fig)
protected=[r for r in data['runs'] if r['scale']!='small']
if protected:
 fig,axes=plt.subplots(1,3,figsize=(11.8,4.8),layout='constrained')
 for ax,scale in zip(axes,['medium','large','long-session']):
  rows={role:[r for r in protected if r['scale']==scale and r['agent']==role] for role in colors}
  for x,role in enumerate(colors):
   values=[r['totalTokens']/1000 for r in rows[role]]
   ax.bar(x,sum(values)/len(values),color=colors[role],alpha=.7,width=.55)
   for i,r in enumerate(rows[role]):
    offset=(i-(len(values)-1)/2)*.035
    ax.scatter(x+offset,r['totalTokens']/1000,s=28,marker='o' if r['accepted'] else 'x',color=colors[role] if r['accepted'] else '#b45309',edgecolors='white' if r['accepted'] else None,zorder=3)
  ax.set_xticks([0,1],['S0 parent','S1 candidate']);ax.set_title({'medium':'Medium: 120 files','large':'Large: 1,200 files','long-session':'30 inspections + repair'}[scale]);ax.set_ylim(bottom=0)
  ax.yaxis.grid(alpha=.15);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
 axes[0].set_ylabel('Provider tokens / run (thousands)');fig.suptitle('S1 protection cohort — 3 paired repeats per task',weight='bold',fontsize=14)
 fig.supxlabel('All attempted work included · Same 24-tool quota per turn · Self-authored fixtures; not S5 holdout',fontsize=9)
 fig.savefig(FOLDER/'s1-protected-tokens.png',dpi=180);fig.savefig(FOLDER/'s1-protected-tokens.svg');plt.close(fig)
for filename in FOLDER.glob('*.svg'):
 filename.write_bytes(('\n'.join(line.rstrip() for line in filename.read_text(encoding='utf-8').splitlines())+'\n').encode())
