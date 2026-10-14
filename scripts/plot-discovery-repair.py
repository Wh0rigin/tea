"""Plot the frozen small/large TEA discovery cohort without dropping attempts."""
import json
import sys
from pathlib import Path
from statistics import mean

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

folder = Path(sys.argv[1] if len(sys.argv) > 1 else
              'benchmarks/reports/discovery-repair-20261014')
report = json.loads((folder / 'comparison.json').read_bytes())
runs = report['runs']
if len(runs) != 36 or not all(row['accepted'] and row['usageComplete'] for row in runs):
    raise ValueError('This cohort plot requires all 36 accepted, measured attempts; never omit failed/unknown samples.')

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'svg.fonttype': 'none'})
fig, axes = plt.subplots(1, 2, figsize=(13.6, 5.9), layout='constrained')
colors = {'baseline': '#8A9099', 'candidate': '#237F6C'}
for ax, scale, title in zip(axes, ['small', 'large'], ['Small: 12 files', 'Large: 1,200 files']):
    tasks = [scale + '-' + name for name in ['cache-key', 'retry-budget', 'unicode']]
    for role, delta, label in [('baseline', -.19, 'TEA before repair'),
                               ('candidate', .19, 'TEA fair discovery')]:
        samples = [[row['totalTokens'] / 1000 for row in runs
                    if row['taskId'] == task and row['agent'] == role] for task in tasks]
        if any(len(values) != 3 for values in samples):
            raise ValueError('Every task and arm must have exactly three repetitions')
        ax.bar([n + delta for n in range(3)], [mean(values) for values in samples],
               .34, color=colors[role], label=label, zorder=2)
        for n, values in enumerate(samples):
            ax.scatter([n + delta + jitter for jitter in [-.05, 0, .05]], values,
                       s=33, c=colors[role], edgecolors='white', linewidths=1, zorder=3)
    ax.set_xticks(range(3), ['Cache keys', 'Retry budgets', 'Unicode'])
    ax.set_title(title + '\n9 paired attempts · 18/18 accepted', fontsize=13, pad=10)
    ax.set_ylabel('Provider tokens / run (thousands)')
    ax.set_xlabel('Task family · 3 repeats per agent')
    ax.grid(axis='y', color='#DCDCDC', linewidth=.6, zorder=0)
    ax.set_axisbelow(True)
    maximum = max(row['totalTokens'] / 1000 for row in runs if row['scale'] == scale)
    ax.set_ylim(0, max(18 if scale == 'small' else 84, maximum * 1.12))
    for n, task in enumerate(tasks):
        totals = {role: sum(row['totalTokens'] for row in runs
                           if row['taskId'] == task and row['agent'] == role)
                  for role in ['baseline', 'candidate']}
        change = 100 * (totals['candidate'] / totals['baseline'] - 1)
        high = max(row['totalTokens'] / 1000 for row in runs if row['taskId'] == task)
        ax.text(n, high + (.5 if scale == 'small' else 2.2), f'{change:+.2f}%',
                ha='center', fontsize=10, color='#9E3434' if change > 0 else '#237F6C')
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc='outside upper right', ncol=2, frameon=False)
fig.suptitle('TEA fair discovery repair — measured provider token usage',
             fontsize=17, x=.01, ha='left')
fig.supxlabel('GLM-5.3-flash · enabled / low · both ContextOS + auto compaction + GC\n'
              'Dots: all measured attempts. Percentages: three-repeat total change; negative means fewer tokens.\n'
              'Source: TEA-only frozen revision experiment, 2026-10-14. All cache input and thinking output included.', fontsize=9)
fig.savefig(folder / 'tokens.png', dpi=170)
fig.savefig(folder / 'tokens.svg')
(folder / 'tokens.svg').write_bytes((folder / 'tokens.svg').read_bytes().replace(b'\r\n', b'\n'))
plt.close(fig)
