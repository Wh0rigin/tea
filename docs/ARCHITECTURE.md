# 架构

## 当前实现与实验

- `src/cli.mjs`：命令解析、`tea` 任务入口、Benchmark 子命令。
- `src/agent.mjs`：运行循环、工具调用、测试后置条件、失败和预算停止状态。
- `src/model.mjs`：Anthropic Messages 适配、工具调用和 SSE `message_stop` 处理、请求前成本预留、provider usage 读取。
- `src/tools.mjs`：限定到工作区的文件树/搜索/读取/精确文本 Patch、渐进初始 inventory、白名单验证命令和需交互批准的其他 Shell 调用。
- `src/context.mjs`：任务与路径重合度排序、少重合时的受限领域同义词扩展、固定项目说明文件优先级以及离线相关路径召回诊断。
- `src/ledger.mjs`：请求级和任务级 token、成本估算、耗时、工具输出长度以及内容哈希；默认不保留代码或模型正文。
- `src/benchmark.mjs`：可复现的离线受控 Replay、CSV/JSON/Markdown 输出、配对估算比较与 Bootstrap 诊断。
- `src/runtime-benchmark.mjs`：12 个自编可执行仓库的固定初始化、脚本化/Live 运行入口、独立验收、逐项 checkpoint、源码前后身份校验及套件总预算。
- `src/output.mjs`：有界日志头尾、完整流哈希和可缩小的返回预算；输出量不再中止进程。
- `src/usage.mjs` / `src/run-id.mjs`：缓存输入归一化、完整 usage 判定和安全运行目录名。
- `src/memory.mjs`：请求视图中的旧工具结果选择性压缩；完整历史不变，保留源码/失败/补丁/最近两轮/assistant 原始块，重复或无法配对的 ID 不压缩。
- `src/memory-benchmark.mjs`：真实工具固定轨迹的成对序列化字节诊断与独立保留检查，不调用模型。

当前 Agent 是单代理、单模型循环。V1 已提交离线检查点，默认发送最多 8 个任务相关路径，优先保留适用的 `AGENTS.md` 和根项目说明；词面重合弱时自动扩展少量领域同义词。完整发送过的文件范围且脱敏后内容未变时回传 evidence ref，内容变化后发送新片段。V2 `compact-tools` 是可选请求历史视图，压缩旧发现结果和成功日志；全请求字节/字符/估算需均下降（含恢复说明），否则回退到原始输入。默认仍为 `full`。V3 双向策略/结构化交接进入下一阶段实验，尚未接入 Live。

`context_request` 事件和 `contextDiagnostics` 累计准备给 adapter 的 system/messages/tools 序列化大小。它们在 complete 调用前记录，可能包含被 provider 预算预检拒绝的输入，不是 HTTP 网络量或 provider Token。完整计费用量仍只取 provider usage。

## 请求与预算

1. 任务开始时检查密钥、正数成本上限、输入/输出单价。
2. 生成 Anthropic Messages 请求；默认启用流式返回，累积文本、思考块、工具 JSON、usage 和明确终止事件。
3. 发请求前以单请求输入上限和最大输出 Token 做最坏情况成本预留。序列化请求 UTF-8 字节数用于保守的单次输入预筛，另保存 provider 实际 usage。
4. 输入总量为普通输入 + 缓存读取 + 缓存写入，不重复累加流式 usage。缓存读取按普通输入价、写入默认按 2 倍价保守计入。缺失/无效 usage 或中断流只存已报告下界，完整总量为空；传输错误保留最大预留。
5. 修改后需真实验证命令成功；Git 诊断、help/collect-only 和 Node 零通过测试不满足后置条件。后续编辑或验证失败会重新置为待验证。独立 fixture 验收还要求公开与隐藏断言成功，不能只看模型自评或子进程退出码。

该本地成本保护依赖使用者填入准确的当前价格、模型和输出上限。服务端隐藏附加量或异常 usage 可能突破预留，Runtime 会检测 provider usage 超额并立即停止后续请求。

## 信任边界

- 密钥只从 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 读取。项目不会读取用户给出的其他文件来发现密钥。
- 默认只把请求/响应 hash、usage、工具名、结果长度写入 `.tea/runs/`；原文记录需显式设置 `TEA_STORE_RAW=1`。
- 文件读取和写入要求 realpath 位于工作区内；隐藏文件、`.git`、环境文件、依赖与生成目录不会被一般文件枚举读取。
- Shell 子进程不继承 API 密钥等环境变量。高风险 Git 操作、删除、重定向和 Shell 操作符会拒绝；非白名单命令在交互终端显示准确命令并要求输入 `yes`。
- 文件 API 的路径检查不是 OS 沙箱。测试程序可访问宿主机可访问的其他路径；当前自编 fixture 的隐藏断言与答案存于项目 manifest，因此不能用其声称保密验收或正式安全门禁已通过。

## 扩展点

后续应把模型适配拆成 provider capability profile，以明确区分 Anthropic thinking 字段、GLM `reasoning_effort` 扩展与服务商桥接行为；每种能力以真实请求回执校验。上下文引擎应输出带 source reference 的可追溯证据片段，支持过期检测和去重。策略决策必须记录状态、理由、估算开销及验证预留，不得只记录所选模型。
