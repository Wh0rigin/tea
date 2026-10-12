"""Plots from settled small-task provider evidence; no synthetic token forecast."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec

source = Path(sys.argv[1]).resolve()
data = json.loads(source.read_text(encoding='utf-8'))
out = source.parent
plt.rcParams.update({'font.family': 'DejaVu Sans', 'axes.spines.top': False,
                     'axes.spines.right': False, 'figure.facecolor': '#FAFAF7', 'axes.facecolor': '#FAFAF7'})
green, purple, red = '#287B61', '#7B64B5', '#AD4D39'

def save(fig, name):
    fig.savefig(out / f'{name}.png', dpi=180, bbox_inches='tight')
    svg = out / f'{name}.svg'
    fig.savefig(svg, bbox_inches='tight')
    svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n').encode('utf-8'))
    plt.close(fig)

fig = plt.figure(figsize=(12, 6.2))
grid = GridSpec(2, 2, figure=fig, width_ratios=[2.25, 1], hspace=.75, wspace=.32)
ax = fig.add_subplot(grid[:, 0])
pairs = sorted(data['pairs'], key=lambda p: p['extraTokens'])
values = [p['extraTokens']/1000 for p in pairs]
ax.barh(range(len(pairs)), values, color=[red if v > 0 else green for v in values])
ax.set_yticks(range(len(pairs)), [p['caseId'].removeprefix('small-') for p in pairs])
ax.axvline(0, color='#555555', linewidth=.8)
ax.set_xlim(-9, 59)
for i, value in enumerate(values):
    ax.text(value + .65 if value >= 0 else .65, i, f'{value:+.2f}k',
            ha='left', va='center', fontsize=9)
ax.set_xlabel('Extra provider tokens: TEA minus Pi (thousands)')
ax.set_ylabel('Paired task / repetition')
ax.set_title('Where the +53,461 small-task tokens came from', loc='left', fontsize=12)
ax.grid(axis='x', alpha=.16); ax.set_axisbelow(True)
for position, key, title, unit in [(grid[0, 1], 'requests', 'Total provider requests', 'Requests across 9 runs'),
                                  (grid[1, 1], 'meanTokensPerRequest', 'Mean provider tokens per request', 'Tokens / request')]:
    sub = fig.add_subplot(position)
    vals = [data['totals'][a][key] for a in ['tea', 'pi']]
    sub.bar(['TEA', 'Pi'], vals, color=[green, purple], width=.5)
    sub.set_ylim(0, max(vals)*1.2)
    for i, v in enumerate(vals):
        sub.text(i, v, f'{v:,.0f}', ha='center', va='bottom')
    sub.set_ylabel(unit); sub.set_xlabel('Native agent')
    sub.set_title(title, fontsize=11)
    sub.grid(axis='y', alpha=.16); sub.set_axisbelow(True)
fig.suptitle('Small tasks — fewer tokens per request, more requests per task', fontsize=14, y=1.02)
fig.text(.5, -.07, 'Source: settled default-24 paired GLM-5.3-flash run, Oct 11–12, 2026 (Asia/Shanghai).\nAll 9 pairs and failures retained; 3 repeats per family. Red = TEA costs more tokens; green = fewer. Native full acceptance: 8/9 each.', ha='center', fontsize=9)
save(fig, 'small-task-overview')

run = next(r for r in data['runs'] if r['caseId'] == 'small-unicode-r3')
requests = run['requests']
x = [q['index'] for q in requests]
cumulative, total = [], 0
for q in requests:
    total += q['totalTokens']
    cumulative.append(total/1000)
fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True, gridspec_kw={'height_ratios': [2, 1]})
top = axes[0]
top.plot(x, cumulative, color=green, linewidth=2.4, label='TEA cumulative actual provider tokens')
pi = next(p for p in data['pairs'] if p['caseId'] == run['caseId'])
top.axhline(pi['piTokens']/1000, color=purple, linestyle='--', label='Pi final total (5 requests; native validation unconfirmed)')
top.axvspan(6.5, 12.5, color=red, alpha=.07, label='6 denied extra validation calls')
for index, label, shift in [(6, 'First public test passed', (-3, 9)), (13, 'Export removed by patch', (-3, 12)),
                            (18, 'Invalid function declaration', (-4, 9)), (22, 'Public test passed again', (-4, 6))]:
    value = cumulative[index-1]
    top.scatter([index], [value], color=red if index in [13, 18] else green, s=28, zorder=4)
    top.annotate(label, xy=(index, value), xytext=(index+shift[0], value+shift[1]), fontsize=9,
                 arrowprops={'arrowstyle': '-', 'color': '#666666'})
top.set_ylabel('Cumulative provider tokens (thousands)')
top.set_title('Small Unicode r3 — recorded verification and recovery sequence', loc='left')
top.set_ylim(0, 66); top.legend(loc='upper left', frameon=False, fontsize=8)
bottom = axes[1]
bottom.plot(x, [q['fullWireBytes']/1000 for q in requests], color='#666666', linewidth=1.5, label='Full-history request bytes')
bottom.plot(x, [q['sentWireBytes']/1000 for q in requests], color=green, linewidth=1.8, label='Sent request bytes after stale-source withholding')
bottom.axhline(32, color='#777777', linestyle=':', label='ContextOS soft target: 32,000 bytes')
bottom.set_ylabel('Serialized request (kB; 1,000 bytes/kB)')
bottom.set_xlabel('TEA provider request index (24 total)')
bottom.set_ylim(0, 35); bottom.set_xticks(range(1, 25)); bottom.legend(loc='lower right', frameon=False, fontsize=8)
for axis in axes:
    axis.set_xlim(1, 24.7); axis.grid(alpha=.15); axis.set_axisbelow(True)
fig.text(.5, -.045, 'Source: original gateway usage and read-only authenticated TEA journal, Oct 12, 2026 (Asia/Shanghai).\nPublic tests do not cover the target Unicode boundary. Final code passes independent checks; TEA turn hits tool quota. Bytes are not tokens.', ha='center', fontsize=9)
fig.tight_layout()
save(fig, 'small-unicode-r3-timeline')
print('Generated small-task diagnosis PNG/SVG artifacts')
