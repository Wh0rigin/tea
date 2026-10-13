"""Plot only settled, sanitized E1/Pi records; no API calls."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('report', type=Path)
args = parser.parse_args()
folder = args.report
summary = json.loads((folder / 'summary.json').read_bytes())
runs = json.loads((folder / 'results.json').read_bytes())['runs']
plt.rcParams.update({'font.size': 11, 'svg.hashsalt': 'tea-e1-pi-fixed'})
fig, axes = plt.subplots(1, 4, figsize=(17, 5.8))
scales = ['small', 'medium', 'large', 'long-session']
titles = ['Small: 12 files', 'Medium: 120 files', 'Large: 1,200 files', 'Long: 30 reads + repair']
colors = {'tea': '#3d8974', 'pi': '#8974be'}
for ax, scale, title in zip(axes, scales, titles):
    xs = [r for r in runs if r['scale'] == scale]
    ax.set_title(title)
    ax.set_ylabel('Provider tokens / run (thousands)')
    ax.set_xticks([0, 1], ['TEA compact\nmetadata', 'Pi 0.87.1'])
    ax.grid(axis='y', alpha=.25)
    ax.set_axisbelow(True)
    ax.spines[['top', 'right']].set_visible(False)
    expected = 3 if scale == 'long-session' else 9
    stats = next((s for c in summary['cohorts'] for s in c.get('scales', []) if s['scale'] == scale), None)
    if not xs:
        ax.text(.5, .5, 'Not started\nNo zero imputation', ha='center', va='center', transform=ax.transAxes)
    for position, agent in enumerate(['tea', 'pi']):
        arm = [r for r in xs if r['agent'] == agent]
        known = [r for r in arm if r['usageComplete'] and r['totalTokens'] is not None]
        if known:
            ys = [r['totalTokens'] / 1000 for r in known]
            ax.bar(position, np.mean(ys), color=colors[agent], width=.55, alpha=.85)
            offsets = np.linspace(-.18, .18, len(ys))
            for offset, row, y in zip(offsets, known, ys):
                ax.scatter(position + offset, y, s=34, marker='o' if row['accepted'] else 'x',
                           color=colors[agent] if not row['accepted'] else 'white',
                           edgecolors=colors[agent] if row['accepted'] else None, zorder=3, clip_on=False)
        unknown = sum(not r['usageComplete'] for r in arm)
        if unknown:
            ax.text(position, .12, f'{unknown} unknown', ha='center', color='#ab3b36', transform=ax.get_xaxis_transform())
    known_values = [r['totalTokens']/1000 for r in xs if r['usageComplete'] and r['totalTokens'] is not None]
    ax.set_ylim(0, max(known_values)*1.22 if known_values else 1)
    if stats:
        p = stats['allPairsTokenReductionPercent']
        label = (f'TEA {abs(p):.2f}% '+('fewer' if p >= 0 else 'more')+' tokens') if p is not None else 'Incomplete: known attempts only'
        if scale == 'long-session' and stats['bothAcceptedPairs'] < expected:
            label = 'All attempts: '+label+'\nUnequal completion; see report'
        ax.text(.5, .97, label, va='top', ha='center', transform=ax.transAxes, fontsize=10)
        ax.text(.5, -.25, f"Accepted TEA/Pi: {stats['teaAccepted']}/{expected} · {stats['piAccepted']}/{expected}\nKnown-usage pairs: {stats['measuredPairs']}/{expected}", ha='center', transform=ax.transAxes, fontsize=9)
fig.suptitle('Compact source evidence metadata TEA vs Pi — same GLM-5.3-flash, enabled/low', fontsize=16)
fig.text(.5, .025, 'Bars: mean known provider tokens; dots: every known attempt; ×: unaccepted. Unknown usage is never zero.\nThree self-authored bug families, three repeats; native clients and prompts differ. This is not production generalization evidence.', ha='center', fontsize=10)
fig.subplots_adjust(top=.81, bottom=.29, left=.06, right=.99, wspace=.37)
fig.savefig(folder / 'tea-vs-pi.png', dpi=160)
fig.savefig(folder / 'tea-vs-pi.svg', metadata={'Date': None})
svg = folder / 'tea-vs-pi.svg'
svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines())+'\n').encode())
plt.close(fig)
print('Saved TEA/Pi PNG and SVG from recorded provider usage.')
