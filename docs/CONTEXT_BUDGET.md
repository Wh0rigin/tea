# Token context budget / Token 上下文预算

Daily CLI compaction now separates model context capacity from serialized request bytes. Unknown models use a conservative **32,768-token scheduling window**, not an assertion of the provider's actual capacity. Set the window to your endpoint's documented limit in `~/.tea/config.json`:

```json
{
  "contextWindowTokens": 216000,
  "contextReserveTokens": 4096,
  "maxOutputTokens": 4096,
  "compactionTriggerRatio": 0.8,
  "maxRequestInputBytes": 2097152
}
```

216,000 is only an example, not a verified GLM-5.3-flash limit. Environment equivalents: `TEA_CONTEXT_WINDOW_TOKENS`, `TEA_CONTEXT_RESERVE_TOKENS`, `TEA_MAX_OUTPUT_TOKENS`, `TEA_COMPACTION_TRIGGER_RATIO`, `TEA_MAX_REQUEST_INPUT_BYTES`. The old `TEA_MAX_REQUEST_INPUT_TOKENS` remains a byte-limit alias; the new name takes precedence when both are explicitly set.

Automatic trigger: `floor((contextWindowTokens - maxOutputTokens - contextReserveTokens) × compactionTriggerRatio)`. Defaults produce **19,660 estimated input tokens**. The example produces **166,246**. The full request includes system, tools and projected conversation. ContextOS still has its separate 32,000-byte projection target; history memory pressure can also trigger compaction at 4 MiB.

The local estimator handles ASCII and Unicode separately and adds structural and safety overhead. Provider-reported input usage, including cache reads/writes, increases a persisted calibration factor when the estimate was too low. It never reduces that factor from a cheaper response. These are scheduling estimates, not exact tokenizer counts or billing measurements; no extra count-token API request is made. A configurable window cannot enlarge a provider's actual context capacity, and estimates cannot guarantee against every overflow.

Both task and summary requests check their estimated input budget before submission. Summary planning selects only complete historical groups that fit. Automatic summaries still require a smaller projected request before adoption and retain the existing nonreducing-summary backoff. Recent-history retention defaults to 16,000 bytes independently of the 2 MiB wire guard. Wire pressure at 95% also attempts compaction; the wire guard is enforced independently. Explicit monetary caps retain conservative reservations and may need adjustment for a larger wire guard.

Legacy SDK/experiment configurations without a Token window keep their old byte-trigger behavior, preserving explicit historical experiment controls. Setting `contextWindowTokens` enables the new budget there too. Restart TEA to load changed settings.

## Bounded failure recovery

The normal per-turn compaction limit remains two. Rejected summaries enter a growth-based cooldown instead of disabling compaction for the whole task. A truncated summary receives at most one repair with a larger output allowance, within the main output and monetary caps. Unknown or partial billing, cancellation and transport failures never enter that repair path.

If a coding request still exceeds a local hard limit, automatic mode permits one additional emergency compaction per turn. It selects at most the first half of the eligible complete history groups (at least one); tool batches and user requirements remain protected. No fitting or smaller checkpoint means the request still stops safely. This does not guarantee completion of arbitrarily long tasks.

Failed turns return an `error` record and persist it in the ledger, summary and `agent_error` / `turn_end` events. Context-limit errors include estimates, configured limits, request bytes and recovery counts. Request bodies, headers and stacks are omitted and configured credentials are redacted. Callers should save the returned result even when they do not supply `onText`.

## 中文说明

现在分别管理：模型能容纳多少 Token、为输出与安全空间预留多少 Token、请求体允许多少字节。未知模型暂按 32,768 Token 保守调度；这不是声称 GLM 只有这个容量。确认服务商容量后设置 `contextWindowTokens`，例如上面的 216k 仅为示例。

默认估算输入达到 19,660 Token 时尝试压缩；设置 216k 窗口后为 166,246。达到阈值仍要经过收益预检查和退避规则。API 返回的实际用量用于向上校准估算，缓存输入也计入；本地估算不冒充实际用量，也不能保证所有模型均不会超窗。独立请求体保护默认 2 MiB，ContextOS 目标仍为 32,000 字节，内存历史保护仍为 4 MiB。旧的显式字节限制依然有效。

摘要默认输出上限为 `min(maxOutputTokens, 2048)`，启用思考时使用独立的 1,024 Token 思考预算。摘要被截断后最多修复一次，修复上限不超过主请求输出限制，所有调用均计费并受同一费用上限约束。摘要无效或没有收益时进入按历史增长判断的冷却；不再整轮禁止压缩。正常每轮最多两次压缩保持不变，真正达到本地硬上限时额外允许一次更小完整前缀的紧急压缩。未知用量、传输失败和取消均不会触发摘要修复。

失败返回值、账本和结束事件均保存结构化 `error`，包含停止阶段、预算与恢复次数；不记录请求正文、认证头或堆栈，并脱敏配置中的凭据。保留的近期内容或用户要求本身过大时仍会安全停止，这些恢复措施不保证任意长任务都能完成。
