"""Render sanitized S0 aggregates; paired token bars exclude failed/unknown work."""
import argparse,json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
p=argparse.ArgumentParser();p.add_argument('report',type=Path);a=p.parse_args();root=a.report
reports=[json.loads((root/f'{kind}-results.json').read_text()) for kind in ['deepswe','wb']]
colors={'tea':'#247F72','pi':'#8261B5'}
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none'})
fig,axes=plt.subplots(1,3,figsize=(16,5),gridspec_kw={'width_ratios':[1,1,1.6]})
for i,r in enumerate(reports):
 ax=axes[i];arms=['tea','pi'];passed=[r['aggregates'][x]['officialFullPassed'] for x in arms];planned=[r['aggregates'][x]['planned'] for x in arms]
 ax.bar(arms,[100*x/n for x,n in zip(passed,planned)],color=[colors[x] for x in arms],width=.55)
 for j,(v,n) in enumerate(zip(passed,planned)):ax.text(j,100*v/n+3,f'{v}/{n}',ha='center')
 ax.set_ylim(0,115);ax.set_yticks([0,25,50,75,100]);ax.set_ylabel('Official full-task acceptance (%)');ax.set_title('DeepSWE: 2 seen tasks' if i==0 else 'WorkBuddy: 4 seen tasks');ax.set_xticks([0,1],['TEA','Pi 0.87.1']);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
pairs=[p for r in reports for p in r['pairs'] if p['eligibleBothPassed']];ax=axes[2]
if pairs:
 display={'helm-unified-manifest-stream':'Helm','bug_fix-medium-incorrect_linenos_on_fstring':'Black','feature-medium-add_support_for_dependencies':'FastAPI','python_port-medium-blog_tags':'Blog Tags','product_analytics-hard-signup_funnel':'Analytics','mnamer-daemon-watch-lifecycle':'Mnamer'}
 labels=[display.get(p['taskId'],p['taskId'])+f"\nr{p['repeat']}" for p in pairs];x=np.arange(len(pairs));w=.35
 for arm,offset in [('tea',-w/2),('pi',w/2)]:ax.bar(x+offset,[p[arm+'Tokens']/1000 for p in pairs],w,label='TEA' if arm=='tea' else 'Pi',color=colors[arm])
 ax.set_xticks(x,labels);ax.set_ylabel('Provider tokens (thousands)');ax.legend(frameon=False);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
else:ax.text(.5,.5,'No eligible both-passed pairs\nNo token-efficiency claim',ha='center',va='center',transform=ax.transAxes);ax.set_xticks([]);ax.set_yticks([])
ax.set_title(f'Officially both-passed: {len(pairs)}/12 pairs')
fig.suptitle('TEA vs native Pi — frozen S0 baseline',fontsize=17,y=1.02)
fig.text(.5,-.12,'Same GLM-5.3-flash / low effort. Two repeats per agent. Seen-task diagnostic; not a full benchmark score.\nTokens include cache input and thinking output. Official failures and unknown usage excluded from token bars; native completion is reported separately.',ha='center',fontsize=10)
fig.tight_layout()
for ext in ['png','svg']:fig.savefig(root/f'native-pi-s0.{ext}',dpi=180,bbox_inches='tight')
svg=root/'native-pi-s0.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n',encoding='utf-8')
plt.close(fig)
