# 架构

## 当前实现（V0 基线）

- `src/cli.mjs`：命令解析、`tea` 任务入口、Benchmark 子命令。
- `src/agent.mjs`：运行循环、工具调用、测试后置条件、失败和预算停止状态。
- `src/model.mjs`：Anthropic Messages 适配、工具调用和 SSE `message_stop` 处理、请求前成本预留、provider usage 读取。
- `src/tools.mjs`：限定到工作区的文件树/搜索/读取/精确文本 Patch、白名单验证命令和需交互批准的其他 Shell 调用。
- `src/ledger.mjs`：请求级和任务级 token、成本估算、耗时、工具输出长度以及内容哈希；默认不保留代码或模型正文。
- `src/benchmark.mjs`：可复现的离线受控 Replay、CSV/JSON/Markdown 输出、配对估算比较与 Bootstrap 诊断。

当前 Agent 是单代理、单模型循环。V2 的选择性历史、V3 双向策略和结构化交接尚未实现。V1 的 Progressive Context 也尚未通过 live 评测，不能据 Replay 的字符数估算宣称成功。

## 请求与预算

1. 任务开始时检查密钥、正数成本上限、输入/输出单价。
2. 生成 Anthropic Messages 请求；默认启用流式返回，累积文本、思考块、工具 JSON、usage 和明确终止事件。
3. 发请求前以单请求输入上限和最大输出 Token 做最坏情况成本预留。序列化请求 UTF-8 字节数用于保守的单次输入预筛，另保存 provider 实际 usage。
4. 每个成功请求按 provider 报告的输入/输出 Token 和配置单价核算；缓存输入按普通输入价保守计入。传输错误按最大预留计入，阻止盲目重试。
5. 任何修改后必须通过至少一次修改后的测试，才返回 `completed`；达到工具上限或预算不足时明确返回未完成状态。

该本地成本保护依赖使用者填入准确的当前价格、模型和输出上限。服务端隐藏附加量或异常 usage 可能突破预留，Runtime 会检测 provider usage 超额并立即停止后续请求。

## 信任边界

- 密钥只从 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 读取。项目不会读取用户给出的其他文件来发现密钥。
- 默认只把请求/响应 hash、usage、工具名、结果长度写入 `.tea/runs/`；原文记录需显式设置 `TEA_STORE_RAW=1`。
- 文件读取和写入要求 realpath 位于工作区内；隐藏文件、`.git`、环境文件、依赖与生成目录不会被一般文件枚举读取。
- Shell 子进程不继承 API 密钥等环境变量。高风险 Git 操作、删除、重定向和 Shell 操作符会拒绝；非白名单命令在交互终端显示准确命令并要求输入 `yes`。

## 扩展点

后续应把模型适配拆成 provider capability profile，以明确区分 Anthropic thinking 字段、GLM `reasoning_effort` 扩展与服务商桥接行为；每种能力以真实请求回执校验。上下文引擎应输出带 source reference 的可追溯证据片段，支持过期检测和去重。策略决策必须记录状态、理由、估算开销及验证预留，不得只记录所选模型。
