"""S1b provider measurements; core and seeded recovery are labeled separately."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1];FOLDER=ROOT/'benchmarks/reports/bounded-directory-s1b-glm-20261012'
data=json.loads((FOLDER/'results.json').read_bytes());summary=json.loads((FOLDER/'summary.json').read_bytes())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none','svg.hashsalt':'s1b-20261012'})
colors={'baseline':'#64748b','candidate':'#0f766e'}
def save(fig,name):
 fig.savefig(FOLDER/(name+'.png'),dpi=180);p=FOLDER/(name+'.svg');fig.savefig(p,metadata={'Date':None});p.write_bytes(('\n'.join(s.rstrip() for s in p.read_text(encoding='utf-8').splitlines())+'\n').encode());plt.close(fig)
fig,axes=plt.subplots(1,5,figsize=(16.8,5),layout='constrained')
for ax,scale,title in zip(axes,['small','medium','large','long-session','recovery-control'],['Small: 12 files','Medium: 120 files','Large: 1,200 files','Long: 30 reads + repair','Seeded receipt recovery']):
 rows={role:[r for r in data['runs'] if r['agent']==role and r['scale']==scale] for role in colors}
 b,c=[sum(r['totalTokens'] for r in rows[role]) for role in colors];delta=(c/b-1)*100
 for x,role in enumerate(colors):
  rs=rows[role];values=[r['totalTokens']/1000 for r in rs];ax.bar(x,sum(values)/len(values),color=colors[role],alpha=.72,width=.55)
  for i,r in enumerate(rs):
   offset=(i-(len(rs)-1)/2)*min(.02,.32/len(rs));ax.scatter(x+offset,r['totalTokens']/1000,s=24,color=colors[role] if r['accepted'] else '#b45309',marker='o' if r['accepted'] else 'x',edgecolors='white' if r['accepted'] else None,zorder=3)
 ax.set_xticks([0,1],[f'Full directory\n{sum(r["accepted"] for r in rows["baseline"])}/{len(rows["baseline"])} accepted',f'Latest eight\n{sum(r["accepted"] for r in rows["candidate"])}/{len(rows["candidate"])} accepted']);ax.set_title(title+f'\nToken change {delta:+.2f}%'+('\nCap inactive' if scale in ['small','medium','large'] else '\nCap active'));ax.set_ylim(bottom=0);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Provider tokens / run (thousands)')
fig.suptitle('S1b: bounded historical reference directory — all paired attempts',fontsize=14,weight='bold')
fig.supxlabel('Bars: means · Dots: all runs · Orange crosses: frozen nonacceptance\nCore: 108 runs / 54 pairs · Separate seeded recovery: 12 / 6 · Same GLM-5.3-flash enabled/low 4096 · All cache and output count\nFresh-task differences are live observations, not directory-patch benefits; 562/562 same-history projections equal. Trial reverted.',fontsize=9)
save(fig,'s1b-tokens')
long=next(c for c in summary['cohorts'] if c['name']=='long');diag=json.loads((FOLDER/'long-diagnosis.json').read_bytes())
fig,axes=plt.subplots(1,3,figsize=(15,4.9),layout='constrained')
for role in colors:
 rs=[r for r in data['runs'] if r['agent']==role and r['scale']=='long-session'];means=[sum(r['turns'][i]['totalTokens'] for r in rs if len(r['turns'])>i)/sum(len(r['turns'])>i for r in rs)/1000 if any(len(r['turns'])>i for r in rs) else float('nan') for i in range(30)]
 axes[0].plot(range(1,31),means,color=colors[role],label='Full directory' if role=='baseline' else 'Latest eight')
 ds=[r for r in diag['runs'] if r['agent']==role];means=[sum(p['components']['referenceDirectory'] for r in ds for p in r['phases'] if p['phase']==i)/max(1,sum(p['requests'] for r in ds for p in r['phases'] if p['phase']==i))/1000 for i in range(1,31)]
 axes[1].plot(range(1,31),means,color=colors[role])
axes[0].set(title='Read-only: mean of observed turns',xlabel='Workflow turn',ylabel='Provider tokens / turn (thousands)');axes[0].legend(frameon=False)
axes[1].set(title='Reference directory: wire diagnostic',xlabel='Workflow turn',ylabel='Mean directory bytes / request (thousands)')
for i,pair in enumerate(long['pairs'],1):
 change=(pair['candidateTokens']-pair['baselineTokens'])/1000;axes[2].bar(i,change,color='#b45309' if change>0 else colors['candidate'],width=.55)
axes[2].set(title='Whole-session paired change',xlabel='Paired repetition',ylabel='Latest eight minus parent (thousand tokens)',xticks=range(1,7));axes[2].axhline(0,color='#64748b',linewidth=.8)
for ax in axes:ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
lo,hi=long['pairedRepeatBootstrap95Percent'];fig.suptitle(f'Long session: {-long["tokenReductionPercent"]:+.2f}% provider token consumption',fontsize=14,weight='bold')
fig.supxlabel(f'Six paired repeats · Diagnostic consumption-change 95% interval [{-hi:+.2f}%, {-lo:+.2f}%]\nOne self-authored workflow, not six independent projects · Bytes are not provider tokens',fontsize=9)
save(fig,'s1b-long-tokens')
