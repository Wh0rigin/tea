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

Failed turns expose a structured `error` in the return value, ledger summary and `agent_error` / `turn_end` events. Local context and wire rejections identify the stage, estimates, limits and whether a request was submitted. Error records omit request bodies, headers and stacks and redact configured credentials. Callers should save the returned result even without an `onText` observer.

## 中文说明

现在分别管理：模型能容纳多少 Token、为输出与安全空间预留多少 Token、请求体允许多少字节。未知模型暂按 32,768 Token 保守调度；这不是声称 GLM 只有这个容量。确认服务商容量后设置 `contextWindowTokens`，例如上面的 216k 仅为示例。

默认估算输入达到 19,660 Token 时尝试压缩；设置 216k 窗口后为 166,246。达到阈值仍要经过收益预检查和退避规则。API 返回的实际用量用于向上校准估算，缓存输入也计入；本地估算不冒充实际用量，也不能保证所有模型均不会超窗。独立请求体保护默认 2 MiB，ContextOS 目标仍为 32,000 字节，内存历史保护仍为 4 MiB。旧的显式字节限制依然有效。

失败返回值、账本和结束事件会保存结构化 `error`，包含停止阶段、估算值、限制及是否已提交请求；不保存请求正文、认证头或堆栈，并脱敏配置中的凭据。即使未提供 `onText` 回调，也可从返回结果查看错误。独立摘要预算与紧急压缩的试验结果见 [恢复机制实验记录](COMPACTION_RECOVERY_REVIEW.zh-CN.md)；这两项未作为默认行为保留。
