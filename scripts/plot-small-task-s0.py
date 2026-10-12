"""Plot S0 evaluation checks; this figure never displays provider token savings."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
report = ROOT / 'benchmarks/reports/small-task-s0-20261012'
data = json.loads((report / 'summary.json').read_bytes())
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'svg.fonttype': 'none'})
fig, axes = plt.subplots(1, 2, figsize=(10, 4.6), layout='constrained')
values = [data['equivalentCommandReplay']['oldConfirmed'], data['equivalentCommandReplay']['v3Confirmed']]
axes[0].bar(['Old matcher', 'v3 matcher'], values, color=['#94a3b8', '#0f766e'], width=.55)
axes[0].set_ylim(0, 21); axes[0].set_ylabel('Confirmed / 18 constructed command checks')
axes[0].set_title('Equivalent validation command recognition')
for i, value in enumerate(values): axes[0].text(i, value + .5, f'{value}/18', ha='center', weight='bold')
axes[1].bar(['Original passes', 'Seeded faults detected'], [20, 20], color=['#0f766e', '#2563eb'], width=.55)
axes[1].set_ylim(0, 23); axes[1].set_ylabel('Tasks / 20 frozen seeded-fault tasks')
axes[1].set_title('Five upstream projects: offline preflight')
for i in range(2): axes[1].text(i, 20.5, '20/20', ha='center', weight='bold')
for ax in axes:
    ax.spines[['top', 'right']].set_visible(False); ax.yaxis.grid(True, alpha=.18); ax.set_axisbelow(True)
fig.suptitle('TEA S0 — evaluation infrastructure checks', fontsize=15, weight='bold')
fig.supxlabel('0 paid provider requests · No measured token or speed improvement', fontsize=10)
fig.savefig(report / 's0-checks.png', dpi=180)
fig.savefig(report / 's0-checks.svg')
svg = report / 's0-checks.svg'
svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n').encode())
plt.close(fig)
