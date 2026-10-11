"""Export provider token measurements. Invoke through chart-pi.mjs for integrity checks."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter

source = Path(sys.argv[1]).resolve()
report = json.loads(source.read_text(encoding="utf-8"))
summary = json.loads((source.parent / "summary.json").read_text(encoding="utf-8"))
if not summary["validComparison"] or report["mode"] != "live":
    raise SystemExit("No verified live comparison to plot")
pairs = summary["pairs"]
if not any(pair[agent] and pair[agent]["usageComplete"] for pair in pairs for agent in ["tea", "pi"]):
    raise SystemExit("No complete provider token measurements")

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.spines.left": False})
fig, ax = plt.subplots(figsize=(14, max(6, len(pairs) * .84 + 2.8)))
height = fig.get_figheight()
colors = {"tea": "#246B53", "pi": "#3F6F9F"}
largest = max(pair[agent]["totalTokens"] for pair in pairs for agent in colors
              if pair[agent] and pair[agent]["usageComplete"])
for index, pair in enumerate(pairs):
    for agent, offset in [("tea", -.18), ("pi", .18)]:
        run = pair[agent]
        y = index + offset
        if not run or not run["usageComplete"]:
            ax.text(0, y, f"{agent.upper()}: {'not run' if not run else 'usage unknown'}",
                    va="center", fontsize=9, color="#555555")
            continue
        hatch = None if run["accepted"] else "///"
        ax.barh(y, run["inputTokens"], height=.31, color=colors[agent], hatch=hatch)
        ax.barh(y, run["outputTokens"], left=run["inputTokens"], height=.31,
                color=colors[agent], alpha=.43, hatch=hatch)
        status = "PASS" if run["accepted"] else "FAIL"
        if not run["accepted"] and any("Input byte guard" in guard for guard in run.get("guards", [])):
            status += " (input limit)"
        ax.text(run["totalTokens"] + largest * .015, y,
                f'{run["totalTokens"]:,}  |  {status}', va="center", fontsize=9)
labels = [f'{pair["caseId"]}\n{pair["fileCount"]:,} files / {pair["lines"]:,} lines' for pair in pairs]
ax.set_yticks(range(len(pairs)), labels)
ax.invert_yaxis()
ax.set_xlim(0, largest * 1.32 if largest else 1)
ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:,.0f}"))
ax.set_xlabel("Provider-reported tokens per agent/task (input + output)")
ax.set_ylabel("Paired tasks and repository size")
ax.grid(axis="x", alpha=.17)
ax.set_axisbelow(True)
fig.legend(handles=[Patch(color=colors["tea"], label="TEA"), Patch(color=colors["pi"], label=f'Pi {report["pi"]["version"]}'),
                   Patch(facecolor="#555555", label="Input incl. all cache tokens"),
                   Patch(facecolor="#BBBBBB", label="Output incl. reasoning"),
                   Patch(facecolor="white", edgecolor="#555555", hatch="///", label="Acceptance failed")],
           loc="upper center", bbox_to_anchor=(.60, 1.23/height), ncol=3, frameon=False)
profile = report["commonProfile"]
fig.suptitle("TEA / Pi — measured token consumption", fontsize=19, x=.025, ha="left", y=1-.16/height)
fig.text(.025, 1-.64/height, f'{profile["model"]} | {profile["thinkingMode"]}/{profile["effort"]} | output cap {profile["maxOutputTokens"]:,} tokens | request byte guard {profile["maxRequestInputBound"]:,}\n'
         'Same task and Git snapshot per pair; native agent prompts/tools differ.', ha="left", va="top", fontsize=10)
overall = summary["overall"]
ratio = overall["allPairsTokenReductionPercent"]
reduction = "unknown (incomplete coverage)" if ratio is None else f"{ratio:+.2f}%"
fig.text(.025, .16/height, f'Acceptance: TEA {overall["teaAccepted"]}/{overall["expectedPairs"]}, Pi {overall["piAccepted"]}/{overall["expectedPairs"]}. '
         f'All-pair TEA token reduction: {reduction}. Failed tasks included.\n'
         f'Source: provider-wire ledger, {report["runId"]} | {report["startedAt"]} to {report.get("endedAt", "unfinished")}\n'
         'Self-authored JavaScript fixtures; three bug families repeated across sizes. Exploratory sample; no production generalization.',
         ha="left", va="bottom", fontsize=8, color="#555555")
fig.subplots_adjust(left=.24, right=.96, top=1-1.15/height, bottom=1.8/height, hspace=.4)
for extension in ["png", "svg"]:
    destination = source.parent / f"tea-vs-pi.{extension}"
    fig.savefig(destination, dpi=180, facecolor="white")
    if extension == "svg":
        destination.write_text("\n".join(line.rstrip() for line in destination.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
    print(destination)
plt.close(fig)
