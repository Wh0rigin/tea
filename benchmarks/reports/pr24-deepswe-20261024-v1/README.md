# PR24 DeepSWE fresh-output guidance screen

Status: protocol frozen before paid calls; results pending.

Runtime: `ae96163c05071c896cb37456b6216745c11bc2a9`. Only the verification prompt differs from production PR22. The full PR16 model/context profile is retained.

Four serial TEA attempts: Helm and Mnamer, two repeats each, on the same pinned initial repositories. Official GLM-5.3-flash endpoint, streaming, thinking enabled/low, 131072 max output tokens and 216000 context window. Control bounds: 30 USD-equivalent per attempt / 120 total, 128 requests, 4096 tools, 900 seconds per request, 1800 seconds per agent. These are conservative control estimates, not invoices.

See [frozen protocol](protocol.json) and [zero-provider preflight](preflight.json). Preflight uses self-authored scripted responses and does not measure coding quality.

The previous PR22 cohort is a historical reference only; Pi and the parent are not rerun. Two previously seen tasks repeated twice do not establish a full/unseen benchmark score or a causal accuracy/token improvement. Keep every failure and unknown usage; unknown is never zero. Only explicit Internal Network Failure may use up to five identical-payload retries. Stop on unrecovered unknown usage and retain the allocation. No automatic relaunch or replacement tasks.

Analysis uses observable operations, model-authored patches and official acceptance metadata; no private reasoning or hidden verifier implementation inspection.
