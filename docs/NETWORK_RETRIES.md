# Internal Network Failure recovery

## User-visible behavior

An explicit provider `Internal Network Failure` now receives up to **five automatic retries after the original request**: at most six submissions for that logical model call. The same system/messages/tools and configured model/thinking settings are reused. Waits are 1, 2, 4, 8 and 16 seconds. A successful attempt continues the normal agent loop.

`internalNetworkRetries` in `~/.tea/config.json`, or `TEA_INTERNAL_NETWORK_RETRIES`, accepts integers 0–5 (default 5). Zero disables this policy. Other model/context settings of the frozen PR16 profile remain intact. `/status` lists this transport change as a profile override; the historical benchmark reconstruction explicitly keeps retries off.

Only the explicit error is retried: SSE error events, matching HTTP 5xx error bodies, or matching JSON error envelopes. Authentication failures, unrelated errors, plain EOF/missing message_stop, malformed response JSON and local timeouts are not newly made retryable. Cancellation, an exhausted explicit monetary/input cap or a failed durable accounting callback can stop before all five retries. Request timeouts still apply separately to each attempt; a caller's overall turn/benchmark deadline remains authoritative.

## Partial output and tools

The terminal reports each retry and that the failed response is discarded. Text already streamed may remain visible, but it is not a completed answer. Failed-response tool blocks never reach tool dispatch: only a fully accepted subsequent response can execute tools. Existing actions from earlier successful model calls are not replayed. The single-request lock also covers backoff, so another caller cannot submit concurrently against the same adapter.

## Unknown usage remains unknown

Each submission gets a distinct request ID, request-intent/settlement accounting and ledger row. A failed unknown/partial attempt retains its full conservative monetary reservation when prices are configured; unpriced spending stays unknown. Every retry passes the existing cost, input, context and wire guards again. No reservation is released just because a later attempt succeeds, and full provider token totals stay unavailable when any attempt has unknown usage.

Successful retry settlements identify precisely the failed request IDs they recovered. They authorize continuation past those specific recovery blocks under the user's requested policy; they do not assert that earlier billing became known. Unrelated/historical unknown requests remain blocked. Persistent accounting records the recovery relationship and retained spending. If the process crashes during backoff/in flight, or all retries fail, recovery stays blocked; restarting the session does not silently reset the retry allowance for that interrupted operation.

## Verification and limits

Dedicated offline tests cover the full six-submission failure path, success after failure, unchanged payloads, independent IDs, reservations, narrow error classification, disabling, JSON/HTTP error envelopes, cancellation/concurrency, cost-cap precedence and callback failures. Agent integration uses real file writes and a real Node test process with mocked provider responses: failed-stream tools are never executed, successful recovery continues validation, unknown usage remains in the ledger, and persistent recovery/exhaustion behave correctly.

These are deterministic mocked-network tests, not proof of official GLM availability, new DeepSWE accuracy or token savings. No paid test was launched for this implementation.

## Benchmark policy

Earlier DeepSWE rounds froze a first-unknown stop rule and a relay that blocks after unknown usage. Those artifacts are unchanged and must not be resumed or reinterpreted as five-retry experiments. A future live comparison must freeze a new retry-aware relay/request policy, preserve every attempt and reservation, and allocate finite per-task/cohort controls before calls. Production retry behavior alone does not override an external benchmark harness guard.
