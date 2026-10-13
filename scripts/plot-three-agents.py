"""Render recorded provider usage only; no API calls or synthetic token estimates."""
import argparse,json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
p=argparse.ArgumentParser();p.add_argument('report',type=Path);args=p.parse_args();folder=args.report
s=json.loads((folder/'summary.json').read_bytes());runs=json.loads((folder/'results.json').read_bytes())['runs']
plt.rcParams.update({'font.size':10,'svg.hashsalt':'tea-three-fixed'})
fig,axes=plt.subplots(1,4,figsize=(19,6.5));agents=['tea','pi','claude'];colors=['#3d8974','#8974be','#cb8a45']
scales=['small','medium','large','long-session'];titles=['Small: 12 files','Medium: 120 files','Large: 1,200 files','Long: 30 reads + repair']
for ax,scale,title in zip(axes,scales,titles):
    xs=[r for r in runs if r['scale']==scale];ax.set_title(title);ax.set_ylabel('Provider tokens / run (thousands)')
    ax.set_xticks([0,1,2],['TEA compact\nmetadata','Pi\n0.87.1','Claude Code\n2.1.281']);ax.grid(axis='y',alpha=.25);ax.set_axisbelow(True);ax.spines[['top','right']].set_visible(False)
    stats=next((v for c in s['cohorts'] for v in c.get('scales',[]) if v['scale']==scale),None)
    if not xs:ax.text(.5,.5,'Not started\nNever zero imputation',ha='center',va='center',transform=ax.transAxes)
    for pos,(agent,color) in enumerate(zip(agents,colors)):
        arm=[r for r in xs if r['agent']==agent];known=[r for r in arm if r['usageComplete'] and r['totalTokens'] is not None]
        if known:
            ys=[r['totalTokens']/1000 for r in known]
            bar_rows=[r for r in known if r['qualityDimensions']['nativeCompleted']] if scale=='long-session' else known
            if bar_rows:ax.bar(pos,np.mean([r['totalTokens']/1000 for r in bar_rows]),width=.6,color=color,alpha=.85)
            for offset,row,y in zip(np.linspace(-.20,.20,len(ys)),known,ys):
                dims=row['qualityDimensions'];unconfirmed=not row['accepted'] and all(v for k,v in dims.items() if k!='nativePostEditValidation')
                marker='o' if row['accepted'] else '^' if unconfirmed else 'x'
                ax.scatter(pos+offset,y,s=30,marker=marker,color='white' if marker!='x' else '#333333',edgecolors=color if marker!='x' else None,zorder=3,clip_on=False)
        count=sum(not r['usageComplete'] for r in arm)
        if count:ax.text(pos,.1,f'{count} unknown',ha='center',transform=ax.get_xaxis_transform(),color='#ab3b36',fontsize=9)
    vals=[r['totalTokens']/1000 for r in xs if r['usageComplete'] and r['totalTokens'] is not None];ax.set_ylim(0,max(vals)*1.3 if vals else 1)
    if stats:
        def text(v):return 'incomplete' if v is None else f"{abs(v):.2f}% "+('fewer' if v>=0 else 'more')
        label='TEA vs Pi: '+text(stats['reductionVsPi'])+'\nTEA vs Claude: '+text(stats['reductionVsClaude'])
        if scale=='long-session':
            completed=' / '.join(str(sum(r['qualityDimensions']['nativeCompleted'] for r in xs if r['agent']==a)) for a in agents)
            label='Bars: completed workflows only\nTEA / Pi / Claude: '+completed+'\nUnequal samples; no overall ratio'
        expected=3 if scale=='long-session' else 9
        if scale!='long-session' and any(v['accepted']<expected for v in stats['roles'].values()):label+='\nValidation unconfirmed; see report'
        ax.text(.5,.98,label,ha='center',va='top',transform=ax.transAxes,fontsize=9)
        acc=' · '.join(f"{stats['roles'][a]['accepted']}/{expected}" for a in agents)
        code=' · '.join(f"{stats['roles'][a]['qualityDimensions']['codeCorrect']}/{expected}" for a in agents)
        ax.text(.5,-.24,'TEA / Pi / Claude\nAccepted: '+acc+'\nCode behavior: '+code,ha='center',transform=ax.transAxes,fontsize=9)
fig.suptitle('Three native coding agents — same GLM-5.3-flash, enabled/low; three repeats',fontsize=16)
fig.text(.5,.03,'Fresh bars: all-attempt means. Long bars: completed-workflow means only. Every known attempt remains a point.\n○: accepted; △: final validation unconfirmed; ×: other acceptance failure. Historical v3 grades and tokens unchanged; not production generalization.',ha='center',fontsize=10)
fig.subplots_adjust(left=.055,right=.99,top=.81,bottom=.29,wspace=.35)
fig.savefig(folder/'three-agents.png',dpi=160);fig.savefig(folder/'three-agents.svg',metadata={'Date':None});plt.close(fig)
svg=folder/'three-agents.svg';svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n').encode())
print('Saved three-agent PNG and SVG from recorded provider usage.')
