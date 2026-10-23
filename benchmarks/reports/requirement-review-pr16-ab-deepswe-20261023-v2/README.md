# Requirement evidence review: interrupted before comparison

[中文](RESULTS.zh-CN.md)

**No correctness or token benefit can be determined.** One of eight planned attempts ran: the first Helm baseline. The other baseline runs and every candidate run were not started. The feature was off, so its mechanism was not tested by the live run.

## What happened

The previously user-provided official credential authenticated successfully. Requests 1–7 completed with a known provider-token subtotal of **43,004** (input + output + cache read + cache creation). Request 8 returned HTTP 200, then ended after 180,461ms with an explicit provider error: `Internal Network Failure`. It had no normal `message_stop`; reported 0/0 values are not treated as known zero usage. Whole-attempt tokens and all comparative percentages remain null.

The client was locating source (five reads, six searches), with no code edits, tests, compaction or review. Estimated input was 17,978, below the 64,665 compaction trigger and 80,832 input guard. The failure was not a local context-limit stop, an output-limit stop or evidence of a review regression. The exact network layer inside the provider/forwarding chain is not established by this metadata.

The official verifier checked the untouched repository: new checks 0/5, old checks 2/2. That result is retained, but cannot establish model coding ability. Seven attempts remain explicitly unstarted. The predeclared first-unknown stop rule ended the queue; no retry was made. The full USD 10-equivalent attempt allocation remains reserved, not an actual invoice.

## Integrity

Runtime `c63fb1344f22790c207bc0c71980494f3b82705a`, protocol frozen/pushed in `474d6b5` before calls. Both planned variants preserve complete PR16 settings, differing only in requirementReview. Original task/base/instruction, runtime archive blobs, adapter hashes, actual configuration, client/relay request hashes and usage states reconciled. Source working-set audit observed residency within the 24,000-byte cap. The zero-provider preflight demonstrated actual review activation with synthetic SSE and independent patch checks, not live task success.

[V1 credential failure](../requirement-review-pr16-ab-deepswe-20261023-v1/README.md) remains separate: one HTTP401 request before any tools, unknown usage and its own USD 10-equivalent reservation. It is not pooled into this comparison. Pi/Claude were not rerun. Full original 3/4 quality configuration remains intact; requirement review stays off.

Next priority is stream reliability diagnosis using framing/error metadata and offline cases. A new paid round requires a separately frozen recovery/stop policy; this interrupted round must remain visible.
