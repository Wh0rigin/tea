"""Scientific charts from sanitized, paired provider usage; no synthetic tokens."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

source = Path(sys.argv[1]).resolve()
data = json.loads(source.read_text(encoding='utf-8'))
if not data['analysis']['validComparison']:
    raise SystemExit('Cannot plot an invalid comparison')
runs = [r for r in data['runs'] if r.get('usageComplete')]
out = source.parent
colors = {'tea': '#287B61', 'pi': '#7B64B5'}
plt.rcParams.update({'font.family': 'DejaVu Sans', 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.labelsize': 11, 'axes.titlesize': 12, 'figure.facecolor': '#FAFAF7', 'axes.facecolor': '#FAFAF7'})

def save(fig, name):
    fig.savefig(out / f'{name}.png', dpi=180, bbox_inches='tight')
    fig.savefig(out / f'{name}.svg', bbox_inches='tight')
    plt.close(fig)

groups = [('small', 'Small: 12 files'), ('medium', 'Medium: 120 files'), ('large', 'Large: 1,200 files'), ('long-session', '30 inspections + repair')]
fig, axes = plt.subplots(1, 2, figsize=(13, 5.7), gridspec_kw={'width_ratios': [3, 1.35]})
for ax, entries in zip(axes, [groups[:3], groups[3:]]):
    for i, (scale, label) in enumerate(entries):
        for agent, offset in [('tea', -.19), ('pi', .19)]:
            selected = [r for r in runs if r['scale'] == scale and r['agent'] == agent]
            values = [r['totalTokens'] / 1000 for r in selected]
            if not values:
                continue
            mean = np.mean(values)
            ax.bar(i + offset, mean, .34, color=colors[agent], alpha=.88, label='TEA ContextOS C' if agent == 'tea' else f"Pi {data['pi']['version']}" if i == 0 else None)
            ax.scatter(i + offset + np.linspace(-.075, .075, len(values)), values, s=20, c=colors[agent], edgecolors='white', linewidth=.6, zorder=3)
            ax.text(i + offset, mean + max(mean * .025, .5), f'{mean:,.1f}k', ha='center', fontsize=9)
        selected = [r for r in runs if r['scale'] == scale]
        accepted = [sum(r['accepted'] for r in selected if r['agent'] == a) for a in ['tea', 'pi']]
        n = max(sum(r['agent'] == a for r in selected) for a in ['tea', 'pi'])
        ax.text(i, -.15, f'Accepted TEA/Pi: {accepted[0]}/{n} · {accepted[1]}/{n}', ha='center', va='top', fontsize=8, transform=ax.get_xaxis_transform())
    ax.set_xticks(range(len(entries)), [label for _, label in entries])
    ax.set_ylabel('Mean provider tokens per run (thousands)')
    ax.grid(axis='y', alpha=.18)
    ax.set_axisbelow(True)
    ax.margins(y=.17)
axes[0].set_title('Fresh coding tasks: 3 bug families × 3 repeats per size')
axes[1].set_title('Actual long conversation: 3 repeats')
handles, labels = axes[1].get_legend_handles_labels()
fig.legend(handles, labels, loc='upper center', bbox_to_anchor=(.5, .91), ncol=2, frameon=False)
fig.suptitle('TEA / Pi — same GLM-5.3-flash, enabled thinking, low effort', fontsize=15, y=1.015)
fig.text(.5, -.035, f"All measured attempts, including failures. TEA tools/turn limit: {data['teaProfile']['maxToolCallsPerTurn']}. Dots = runs. Separate y-scales.\nInput includes cache reads/writes; output includes reasoning. Self-authored fixtures; native prompts/tools differ.", ha='center', fontsize=9, color='#555555')
fig.tight_layout(rect=[0, 0, 1, .86])
save(fig, 'tea-contextos-vs-pi')

families = [('cache-key', 'Primitive cache keys'), ('retry-budget', 'Retry budgets'), ('unicode', 'Unicode truncation')]
fig, axes = plt.subplots(1, 3, figsize=(13, 4.7))
for ax, (scale, label) in zip(axes, groups[:3]):
    for i, (family, name) in enumerate(families):
        for agent, offset in [('tea', -.19), ('pi', .19)]:
            values = [r['totalTokens'] / 1000 for r in runs if r['agent'] == agent and r['taskId'] == f'{scale}-{family}']
            if not values:
                continue
            ax.bar(i + offset, np.mean(values), .34, color=colors[agent], alpha=.88)
            ax.scatter(i + offset + np.linspace(-.06, .06, len(values)), values, c=colors[agent], s=22, edgecolors='white', zorder=3)
    ax.set_title(label)
    ax.set_xticks(range(3), [name for _, name in families], rotation=20, ha='right', fontsize=9)
    ax.set_ylabel('Mean provider tokens / run (thousands)')
    ax.grid(axis='y', alpha=.18); ax.set_axisbelow(True)
fig.suptitle('Fresh tasks — 3 repeats per task; dots show every measured attempt', fontsize=14)
fig.text(.5, -.04, f"Green: TEA ContextOS C · Purple: Pi {data['pi']['version']}. TEA tools/turn limit: {data['teaProfile']['maxToolCallsPerTurn']}. All attempts retained; see acceptance in report.", ha='center', fontsize=9)
fig.tight_layout()
save(fig, 'tea-contextos-vs-pi-fresh')

long_runs = [r for r in runs if r['group'] == 'long-session']
if long_runs:
    fig, ax = plt.subplots(figsize=(10, 5.5))
    for agent in ['tea', 'pi']:
        selected = [r for r in long_runs if r['agent'] == agent and len(r['turns']) == 31 and all(t['totalTokens'] is not None for t in r['turns'])]
        if not selected:
            continue
        curves = np.array([np.cumsum([t['totalTokens'] for t in r['turns']]) / 1000 for r in selected])
        x = np.arange(1, 32)
        for curve in curves:
            ax.plot(x, curve, color=colors[agent], linewidth=1, alpha=.28)
        ax.plot(x, curves.mean(axis=0), color=colors[agent], linewidth=2.7, label=f'{agent.upper()} (n={len(selected)})')
        ax.text(31.3, curves.mean(axis=0)[-1], f"{curves.mean(axis=0)[-1]:,.1f}k", color=colors[agent], va='center')
    ax.axvline(30, color='#777777', linestyle=':', alpha=.6)
    ax.set_title('Long conversation — cumulative actual provider tokens from an empty session')
    ax.set_xlabel('Completed native turns (1–30 inspections; 31 repair + tests)')
    ax.set_ylabel('Cumulative provider tokens (thousands)')
    ax.set_xlim(1, 34); ax.grid(alpha=.16); ax.legend(frameon=False)
    fig.text(.5, -.035, 'Bold = mean; faint lines = repeats. No scripted history. Full settled reads and read-only constraints audited.\nPi automatic compaction enabled; actual compaction event counts are in the report.', ha='center', fontsize=9)
    fig.tight_layout()
    save(fig, 'tea-contextos-vs-pi-long')
print(f'Chart files saved in {out.name}')
