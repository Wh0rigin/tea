"""Render audited subset results. Requires Matplotlib; makes no model calls."""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

ROOT = Path(__file__).resolve().parent
deep = json.loads((ROOT / "deepswe-results.json").read_text(encoding="utf-8"))
wb = json.loads((ROOT / "workbuddy-results.json").read_text(encoding="utf-8"))
colors = ["#526C91", "#258579"]
labels = ["Parent\nb400577", "Candidate\n7bd236f"]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "svg.fonttype": "none",
                     "svg.hashsalt": "tea-workflow-native-screen-20261020"})
fig, axes = plt.subplots(1, 3, figsize=(14.4, 5.5), gridspec_kw={"width_ratios": [1, 1, 1.35]})
fig.patch.set_facecolor("#F7F9FC")
fig.suptitle("TEA workflow package: quality first, then comparable Token use", x=0.055,
             y=0.98, ha="left", fontsize=17, fontweight="bold", color="#152A40")
fig.text(0.055, 0.915, "GLM-5.3-flash · thinking enabled / low · fixed snapshots and limits · two repeats per task",
         color="#526177", fontsize=10)

for ax, data, title, full_key in [
    (axes[0], deep, "DeepSWE v1.1\n2 seen tasks / 8 attempts", "officialCompleteTaskPassed"),
    (axes[1], wb, "WB-Bench-Code\n4 tasks / 16 attempts", "officialFullPass"),
]:
    for i, arm in enumerate(["baseline", "candidate"]):
        rows = [r for r in data["runs"] if r["arm"] == arm]
        passed = sum(r[full_key] is True and r["agentStatus"] == "completed" for r in rows)
        rate = passed / len(rows) * 100
        ax.bar(i, rate, color=colors[i], width=0.55, zorder=3)
        ax.text(i, rate + 4, f"{passed}/{len(rows)}", ha="center", fontsize=13, fontweight="bold")
    ax.set_title(title, loc="left", fontsize=12, pad=16)
    ax.set_ylabel("End-to-end full task success")
    ax.set_ylim(0, 105)
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.yaxis.set_major_formatter(PercentFormatter())
    ax.set_xticks([0, 1], labels)
    ax.set_xlim(-0.65, 1.65)

pairs = [p for p in wb["pairs"] if p["eligibleForCompleteWorkEfficiency"]]
assert len(pairs) == 2 and len({p["taskId"] for p in pairs}) == 1
ax = axes[2]
for i, key in enumerate(["baselineTokens", "candidateTokens"]):
    values = [p[key] / 1000 for p in pairs]
    mean = sum(values) / len(values)
    ax.bar(i, mean, color=colors[i], width=0.55, zorder=3, alpha=0.92)
    ax.scatter([i - 0.075, i + 0.075], values, color=colors[i], edgecolors="white",
               linewidths=1.7, s=54, zorder=4)
    ax.text(i, max(values) + 24, f"{mean:.1f}K mean", ha="center", fontsize=11)
change = wb["bothCompleteWorkEfficiency"]["tokenChangePercent"]
ax.set_title(f"Black repair: both arms fully passed\nToken use {change:.2f}% / 2 matched repeats",
             loc="left", fontsize=12, pad=16)
ax.set_ylabel("Provider tokens per run (thousands)")
ax.set_xticks([0, 1], labels)
ax.set_xlim(-0.65, 1.65)
ax.set_ylim(0, max(p["baselineTokens"] for p in pairs) / 1000 * 1.25)

for ax in axes:
    ax.set_facecolor("white")
    ax.grid(axis="y", color="#E5EAF1", zorder=0)
    ax.set_axisbelow(True)
    ax.spines[["top", "right"]].set_visible(False)
    for spine in ["left", "bottom"]:
        ax.spines[spine].set_color("#C8D2DF")
    ax.tick_params(axis="both", colors="#35465C", length=3)

fig.text(0.055, 0.115, "Token bars: completed + full-pass pairs only. Dots show every included run. Input includes cache once.",
         color="#35465C", fontsize=10)
fig.text(0.055, 0.065, "DeepSWE: one parent runtime failure is ungraded. These small subsets are not full leaderboard scores.",
         color="#65758A", fontsize=9)
fig.subplots_adjust(left=0.065, right=0.98, top=0.75, bottom=0.28, wspace=0.47)
fig.savefig(ROOT / "outcomes.png", dpi=180, facecolor=fig.get_facecolor())
svg = ROOT / "outcomes.svg"
fig.savefig(svg, facecolor=fig.get_facecolor(), metadata={"Date": None})
svg.write_text("\n".join(line.rstrip() for line in svg.read_text(encoding="utf-8").splitlines()) + "\n",
               encoding="utf-8")
plt.close(fig)
