"""Plot observed provider tokens; no model calls or counterfactual token estimates."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'benchmarks/reports/small-task-s1-long-diagnosis-20261012'
data = json.loads((FOLDER / 'diagnosis.json').read_bytes())
colors = {'baseline': '#64748b', 'candidate': '#0f766e'}
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'svg.fonttype': 'none', 'svg.hashsalt': 's1-long-diagnosis-20261012'})
fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), layout='constrained')
for role, color in colors.items():
    runs = [r for r in data['runs'] if r['agent'] == role]
    means = [sum(r['phases'][i]['totalTokens'] for r in runs) / 3000 for i in range(30)]
    axes[0].plot(range(1, 31), means, color=color, label='S0 parent' if role == 'baseline' else 'S1 candidate')
axes[0].set(title='First 30 read-only turns — mean of 3 runs', xlabel='Workflow turn', ylabel='Provider tokens / turn (thousands)')
axes[0].legend(frameon=False)
axes[0].annotate('ContextOS evicts older tool output\nS1 starts at turn 12 or early turn 13', xy=(13, 9), xytext=(15, 4), arrowprops={'arrowstyle': '->', 'color': '#64748b'}, fontsize=9)
for i in range(1, 4):
    rows = {role: next(r for r in data['runs'] if r['caseId'] == f'long-30-r{i}' and r['agent'] == role) for role in colors}
    delta = rows['candidate']['phases'][-1]['totalTokens'] - rows['baseline']['phases'][-1]['totalTokens']
    axes[1].bar(i, delta / 1000, color='#b45309' if delta > 0 else colors['candidate'], width=.55)
    axes[1].annotate(f'{delta:+,} tokens\nRequests {rows["baseline"]["phases"][-1]["requests"]} → {rows["candidate"]["phases"][-1]["requests"]}', (i, delta / 1000), xytext=(0, 8 if delta > 0 else -8), textcoords='offset points', ha='center', va='bottom' if delta > 0 else 'top', fontsize=9)
axes[1].set(title='Final repair turn — S1 minus parent', xlabel='Paired repetition', ylabel='Provider token change (thousands)', xticks=[1, 2, 3], ylim=(-6, 10))
axes[1].axhline(0, color='#64748b', linewidth=.8)
for ax in axes:
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=.15)
    ax.set_axisbelow(True)
fig.suptitle('Why S1 long sessions use 3.67% more tokens', fontsize=14, weight='bold')
fig.supxlabel('Frozen S1 protection cohort · 393 provider requests · All 6 runs accepted · No new API calls\nInput includes cache reads; byte-only notice removal is not plotted as token savings', fontsize=9)
fig.savefig(FOLDER / 'long-session-diagnosis.png', dpi=180)
svg = FOLDER / 'long-session-diagnosis.svg'
fig.savefig(svg, metadata={'Date': None})
svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n').encode())
plt.close(fig)
