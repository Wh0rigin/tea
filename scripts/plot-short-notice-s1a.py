"""All-attempt S1a provider comparison; byte savings are not token results."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1];FOLDER=ROOT/'benchmarks/reports/short-notice-s1a-glm-20261012'
data=json.loads((FOLDER/'results.json').read_bytes());summary=json.loads((FOLDER/'summary.json').read_bytes())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none','svg.hashsalt':'s1a-20261012'})
colors={'baseline':'#64748b','candidate':'#0f766e'}
fig,axes=plt.subplots(1,4,figsize=(13.5,4.9),layout='constrained')
for ax,scale,title in zip(axes,['small','medium','large','long-session'],['Small: 12 files','Medium: 120 files','Large: 1,200 files','Long: 30 reads + repair']):
 rows={role:[r for r in data['runs'] if r['agent']==role and r['scale']==scale] for role in colors}
 b,c=[sum(r['totalTokens'] for r in rows[role]) for role in colors];delta=(c/b-1)*100
 for x,role in enumerate(colors):
  rs=rows[role];values=[r['totalTokens']/1000 for r in rs];ax.bar(x,sum(values)/len(values),color=colors[role],alpha=.72,width=.55)
  for i,r in enumerate(rs):
   offset=(i-(len(rs)-1)/2)*min(.02,.32/len(rs));ax.scatter(x+offset,r['totalTokens']/1000,s=24,color=colors[role] if r['accepted'] else '#b45309',marker='o' if r['accepted'] else 'x',edgecolors='white' if r['accepted'] else None,zorder=3)
 ax.set_xticks([0,1],[f'S1 parent\n{sum(r["accepted"] for r in rows["baseline"])}/{len(rows["baseline"])} accepted',f'Short notice\n{sum(r["accepted"] for r in rows["candidate"])}/{len(rows["candidate"])} accepted']);ax.set_title(title+f'\nToken change {delta:+.2f}%');ax.set_ylim(bottom=0);ax.yaxis.grid(alpha=.15);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Provider tokens / run (thousands)')
fig.suptitle('S1a: resident capability notice — paired provider measurements',fontsize=14,weight='bold')
fig.supxlabel('Bars: means · Dots: all runs · Orange crosses: frozen v3 nonacceptance\n108 runs / 54 pairs · Same GLM-5.3-flash enabled/low 4096 · All cache and output tokens count',fontsize=9)
fig.savefig(FOLDER/'s1a-tokens.png',dpi=180);svg=FOLDER/'s1a-tokens.svg';fig.savefig(svg,metadata={'Date':None});svg.write_bytes(('\n'.join(s.rstrip() for s in svg.read_text(encoding='utf-8').splitlines())+'\n').encode());plt.close(fig)
long=next(c for c in summary['cohorts'] if c['name']=='long');fig,axes=plt.subplots(1,2,figsize=(11.8,4.9),layout='constrained')
for role in colors:
 rs=[r for r in data['runs'] if r['agent']==role and r['scale']=='long-session'];means=[sum(r['turns'][i]['totalTokens'] for r in rs)/len(rs)/1000 for i in range(30)]
 axes[0].plot(range(1,31),means,color=colors[role],label='S1 parent' if role=='baseline' else 'Short notice')
axes[0].set(title='Read-only turns: mean of 6 runs',xlabel='Workflow turn',ylabel='Provider tokens / turn (thousands)');axes[0].legend(frameon=False)
for i,pair in enumerate(long['pairs'],1):
 change=(pair['candidateTokens']-pair['baselineTokens'])/1000;axes[1].bar(i,change,color='#b45309' if change>0 else colors['candidate'],width=.55)
axes[1].set(title='Whole-session paired change',xlabel='Paired repetition',ylabel='Short notice minus parent (thousand tokens)',xticks=range(1,7));axes[1].axhline(0,color='#64748b',linewidth=.8)
for ax in axes:ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
fig.suptitle(f'Long session: {-long["tokenReductionPercent"]:+.2f}% provider token consumption',fontsize=14,weight='bold')
saved_lo,saved_hi=long['pairedRepeatBootstrap95Percent'];lo,hi=-saved_hi,-saved_lo;fig.supxlabel(f'Frozen six paired repeats · Diagnostic token-change 95% interval [{lo:+.2f}%, {hi:+.2f}%]\nOne self-authored workflow; not six independent projects · All attempts retained',fontsize=9)
fig.savefig(FOLDER/'s1a-long-tokens.png',dpi=180);svg=FOLDER/'s1a-long-tokens.svg';fig.savefig(svg,metadata={'Date':None});svg.write_bytes(('\n'.join(s.rstrip() for s in svg.read_text(encoding='utf-8').splitlines())+'\n').encode());plt.close(fig)
