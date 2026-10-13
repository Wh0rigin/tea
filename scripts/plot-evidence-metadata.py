import json, sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams['svg.hashsalt']='tea-e1-source-evidence'
import matplotlib.pyplot as plt
import numpy as np

directory=Path(sys.argv[1])
data=json.loads((directory/'results.json').read_bytes())
rows=data['runs']
fig, axes=plt.subplots(1,4,figsize=(18.5,5.5),layout='constrained')
colors={'baseline':'#8174B8','candidate':'#40876F'}
panels=[('small','small','Small: 12 files'),('scale','medium','Medium: 120 files'),('scale','large','Large: 1,200 files'),('long','small','Long: 30 inspections + repair')]
for ax,(cohort,scale,title) in zip(axes,panels):
    subset=[r for r in rows if r['cohort']==cohort and r['scale']==scale]
    if not subset:
        ax.set_title(title,fontsize=11,pad=11)
        ax.text(.5,.5,'Not started',ha='center',va='center',transform=ax.transAxes,fontsize=12)
        ax.set_axis_off(); continue
    for index,role in enumerate(['baseline','candidate']):
        selected=[r for r in subset if r['agent']==role]
        known=[r for r in selected if r['usageComplete'] and r['totalTokens'] is not None]
        if known:
            mean=sum(r['totalTokens'] for r in known)/len(known)/1000
            ax.bar(index,mean,width=.55,color=colors[role],alpha=.90,zorder=2)
            for j,r in enumerate(known):
                jitter=((j+.5)/len(known)-.5)*.32
                ax.scatter(index+jitter,r['totalTokens']/1000,s=22,marker='o' if r['accepted'] else 'x',c=colors[role],edgecolors='white' if r['accepted'] else None,linewidths=.7,zorder=3)
        accepted=sum(r['accepted'] for r in selected)
        unknown=sum(not r['usageComplete'] for r in selected)
        label=f'{role.title()}\nAccepted {accepted}/{len(selected)}'+(f'\nUnknown usage: {unknown}' if unknown else '')
        ax.text(index,-.09,label,ha='center',va='top',transform=ax.get_xaxis_transform(),fontsize=9)
    complete=cohort in data['completedCohorts'] and all(r['usageComplete'] for r in subset) and sum(r['agent']=='baseline' for r in subset)==sum(r['agent']=='candidate' for r in subset)
    if complete:
        b=sum(r['totalTokens'] for r in subset if r['agent']=='baseline'); c=sum(r['totalTokens'] for r in subset if r['agent']=='candidate')
        change=100*(c/b-1)
        title+=f'\nCandidate {change:+.2f}% tokens'
    else:title+='\nIncomplete; known attempts only'
    ax.set_title(title,fontsize=11,pad=11); ax.set_xticks([]); ax.set_xlim(-.65,1.65)
    ax.set_ylim(bottom=0); ax.grid(axis='y',alpha=.20); ax.set_axisbelow(True)
    ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Mean provider tokens / run (thousands)',fontsize=11)
fig.suptitle('TEA E1 — source evidence metadata A/B\nDots retain every known attempt; summary off, same model and thinking controls',fontsize=15)
fig.supxlabel('Purple: original headers · Green: compact headers. Cache input and thinking output included. Unknown usage is not zero.\nSmall cohort complete; scale controls incomplete. Synthetic repeated tasks do not establish production generalization.',fontsize=10,y=-.12)
fig.savefig(directory/'evidence-metadata-tokens.png',dpi=160,bbox_inches='tight')
fig.savefig(directory/'evidence-metadata-tokens.svg',bbox_inches='tight',metadata={'Date':None})
svg=directory/'evidence-metadata-tokens.svg'
svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n').encode())
