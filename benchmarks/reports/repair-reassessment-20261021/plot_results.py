"""Plot fully reconciled, frozen repair reassessment results; no model calls."""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

ROOT = Path(__file__).resolve().parent
DATA = [
    ("DeepSWE v1.1", "deepswe-results.json", 4, "officialCompleteTaskPassed"),
    ("WB-Bench-Code", "workbuddy-results.json", 8, "officialFullPass"),
]
COLORS = ["#526C91", "#258579"]
LABELS = ["Baseline\n5cb5198", "Repairs\nd0b566b"]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                     "svg.fonttype": "none", "svg.hashsalt": "tea-repair-reassessment-20261021"})
fig, axes = plt.subplots(2, 2, figsize=(12, 9.3))
fig.patch.set_facecolor("#F7F9FC")
fig.suptitle("TEA repair reassessment: quality and same-work Token use", x=0.065,
             y=0.98, ha="left", fontsize=17, fontweight="bold", color="#152A40")
fig.text(0.065, 0.94, "Fresh baseline + candidate · GLM-5.3-flash · thinking enabled / low · two repeats per seen task",
         color="#526177", fontsize=10)

for row, (name, filename, planned, pass_key) in enumerate(DATA):
    data = json.loads((ROOT / filename).read_text(encoding="utf-8"))
    assert len(data["runs"]) == planned * 2, "Do not render an unfinished schedule as final"
    ax = axes[row, 0]
    for i, arm in enumerate(["baseline", "candidate"]):
        runs = [r for r in data["runs"] if r["arm"] == arm]
        assert len(runs) == planned
        passed = sum(r[pass_key] is True and r["agentStatus"] == "completed" for r in runs)
        official = sum(r[pass_key] is True for r in runs)
        rate = official / planned * 100
        ax.bar(i, rate, color=COLORS[i], width=0.55, zorder=3)
        ax.text(i, rate + 3, f"{official}/{planned}", ha="center", fontsize=13, fontweight="bold")
        ax.scatter(i, passed / planned * 100, marker="D", facecolors="white", edgecolors="#172C42",
                   linewidths=1.5, s=45, zorder=4, clip_on=False)
        ax.text(i, -0.21, f"Completed + full-pass: {passed}/{planned}", ha="center",
                transform=ax.get_xaxis_transform(), fontsize=8, color="#526177")
    ax.set_title(f"{name}: official whole-task acceptance", loc="left", fontsize=12, pad=15)
    ax.set_ylabel("Official full-pass / scheduled attempts")
    ax.set_ylim(0, 112)
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.yaxis.set_major_formatter(PercentFormatter())

    ax = axes[row, 1]
    pairs = [p for p in data["pairs"] if p["eligibleForCompleteWorkEfficiency"]]
    if pairs:
        for i, key in enumerate(["baselineTokens", "candidateTokens"]):
            values = [p[key] / 1000 for p in pairs]
            mean = sum(values) / len(values)
            ax.bar(i, mean, color=COLORS[i], width=0.55, zorder=3, alpha=0.92)
            offsets = [0] if len(values) == 1 else [-0.14 + 0.28 * j / (len(values) - 1) for j in range(len(values))]
            ax.scatter([i + x for x in offsets], values, color=COLORS[i], edgecolors="white",
                       linewidths=1.3, s=42, zorder=4)
            ax.text(i, max(values) * 1.035, f"{mean:.1f}K mean", ha="center", fontsize=10)
        change = data["bothCompleteWorkEfficiency"]["tokenChangePercent"]
        task_ids = {p["taskId"] for p in pairs}
        task_label = "Black repair" if task_ids == {"bug_fix-medium-incorrect_linenos_on_fstring"} else "Matched full-pass work"
        ax.set_title(f"{task_label}: {change:+.2f}% Token change\n{len(pairs)} matched pairs; dots show every included run",
                     loc="left", fontsize=12, pad=15)
        ax.set_ylim(0, max(p[k] for p in pairs for k in ["baselineTokens", "candidateTokens"]) / 1000 * 1.20)
        ax.set_ylabel("Provider tokens per run (thousands)")
    else:
        ax.set_title("Same-work Token efficiency: not established", loc="left", fontsize=12, pad=15)
        ax.text(0.5, 0.5, "No pair completed + fully passed in both arms.\nFailed attempts are excluded from Token bars.",
                transform=ax.transAxes, ha="center", va="center", color="#526177", fontsize=10)
        ax.set_ylim(0, 1)
        ax.set_yticks([])

for ax in axes.flat:
    ax.set_xticks([0, 1], LABELS)
    ax.set_xlim(-0.65, 1.65)
    ax.set_facecolor("white")
    ax.grid(axis="y", color="#E5EAF1", zorder=0)
    ax.set_axisbelow(True)
    ax.spines[["top", "right"]].set_visible(False)
    for spine in ["left", "bottom"]:
        ax.spines[spine].set_color("#C8D2DF")
    ax.tick_params(axis="both", colors="#35465C", length=3)

fig.legend(handles=[Patch(facecolor="#526C91", label="Bars: official full-pass"),
                    Line2D([], [], color="#172C42", marker="D", markerfacecolor="white", linestyle="None",
                           label="Diamonds: completed + official full-pass")],
           loc="lower left", bbox_to_anchor=(0.06, 0.063), frameon=False, ncol=2, fontsize=9)
fig.text(0.065, 0.045, "Provider input includes cache once; output includes thinking without adding it again. All failed attempts remain in the reports.",
         color="#35465C", fontsize=9)
fig.text(0.065, 0.02, "Seen regression subsets, small samples, no provider seed control. Not full leaderboard scores or unseen generalization.",
         color="#65758A", fontsize=9)
fig.subplots_adjust(left=0.085, right=0.97, top=0.86, bottom=0.19, wspace=0.36, hspace=0.85)
fig.savefig(ROOT / "outcomes.png", dpi=180, facecolor=fig.get_facecolor())
svg = ROOT / "outcomes.svg"
fig.savefig(svg, facecolor=fig.get_facecolor(), metadata={"Date": None})
svg.write_text("\n".join(line.rstrip() for line in svg.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
plt.close(fig)
