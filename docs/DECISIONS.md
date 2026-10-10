# 架构决策记录

## D1 — Node.js 原生 ESM，不引入运行时依赖

当前优先做出能直接运行的终端工具，并依靠 Node 内置 `fetch`、`node:test`、文件 API。避免部署额外服务和测试环境变量。随维护负担及 Benchmark 证据再决定是否引入 tokenizer/解析器依赖。

## D2 — Anthropic Messages 是首个 Provider wire protocol

用户指定 `anthropic-messages`。实现工具调用、SSE 事件终止、usage 和 reasoning effort 字段。Z.AI 官方 [GLM-5.3-Flash 文档](https://docs.z.ai/guides/vlm/glm-5.3-flash) 和 [Chat Completion 参数文档](https://docs.z.ai/api-reference/llm/chat-completion) 说明该模型只支持 `low`、`high`、`max`，且 thinking 不能关闭；不是 `medium` / `xhigh`。GLM 官方文档使用 Chat Completions 协议的 `thinking.type=enabled` 和 `reasoning_effort`。PackyAPI 模型广场才可确认对应令牌组是否公开 Anthropic Messages 及其桥接映射。当前请求里的 `thinking.type=adaptive` 与 `output_config.effort` 是根据用户给出的兼容提示构造的候选，不等于已通过 Packy 实测。

PackyAPI 的[公开 Anthropic Messages 示例](https://docs.packyapi.com/docs/cli/7-kimi-code.html)用 `https://cf.api.fan`，路径 `/v1/messages`；`https://www.packyapi.ai` 是产品首页域名，未作为 API endpoint 验证。应用可通过 `ANTHROPIC_BASE_URL` 覆盖服务地址。

## D3 — 本地成本预留需明确价格

PackyAPI 的费用受令牌分组和倍率影响。项目不硬编码公共标价或猜测用户账户实际费率；启动时要求两个输入/输出价格和成本上限。预检按单次输入上限和最大输出预留，不因缓存折扣降低预估。真实账单以服务端计费页为准。

## D4 — 测试后置条件

Patch 后 Runtime 保持“待验证”状态，直至后续测试命令返回 0。预算或工具限制导致未验证时返回 `needs_validation`/`tool_limit_reached`，不以模型自评代替。

## D5 — 记录内容默认脱敏

默认存储哈希、计数、模型标识和 usage，不存用户代码、提示或模型回复原文。必须显式开启 `TEA_STORE_RAW=1` 才保留原文。真实运行目录被 `.gitignore` 排除。
