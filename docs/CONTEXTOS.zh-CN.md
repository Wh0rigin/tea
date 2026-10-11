# ContextOS 使用与边界

目标是保留编程任务的正确性，同时减少每次模型请求中反复发送的历史。持久化、完整历史和发送上下文分别管理；功能默认不开启。

## 开启、恢复和回退

在同一工作区运行；真实调用沿用现有 API 凭据、模型、价格及有限预算配置。

```sh
tea --interactive --session work --memory-policy contextos --max-cost-usd 1.00
tea --interactive --resume work --memory-policy contextos --max-cost-usd 1.00
tea --interactive --resume work --memory-policy full-history --max-cost-usd 1.00
```

- `--session ID` 创建日志；已存在的 ID 必须用 `--resume`，避免覆盖。
- `--memory-policy contextos` 自动开启持久化；建议指定 ID，便于以后恢复。
- `--contextos-target-bytes 32000` 是完整序列化请求的软目标，包含系统提示、消息、工具和模型控制参数。保留内容可能超过目标；硬请求上限仍生效。
- `full-history` 恢复原始上下文；已有 `compact-tools` 和摘要压缩仍可单独选择。
- 恢复只允许原工作区、模型和端点。思考档位是配置接口；跨模型自动路由尚未接入。`memoryHandoff` 仅提供未来交接的数据契约。
- 预算会恢复并取原值与当前值的较小值。未知计费阻止再次调用，避免不确定请求被自动重试。`/new` 清空当前会话和词表，保留费用与待验证修改。

## 看清模型拿到了什么

```sh
tea sessions list
tea sessions inspect work
tea sessions delete work
```

交互会话使用 `/memory`。检查器提供每个记忆单元的来源、文件版本、字节、估算 Token、保留/引用的原因、失效状态及恢复次数。它显示本地信息，可能包含任务文本和文件名，请先审查再分享。删除只针对明确指定的本地会话，正在写入或日志损坏时拒绝删除；需要按提示人工处理损坏日志。

模型可用 `recall_context` 恢复精确工具内容，按 UTF-8 字节分页；也可用 `search_history` 检索历史源码或模型推测。源码变了就拒绝恢复旧代码，并要求 `read_file` 重读。历史搜索返回来源标签；模型的推测不会升级成验证结论。恢复工具本身不调用模型，但后续模型请求的全部费用和 Token 都计入实验。

## 数据保存和局限

日志位于 `.tea/sessions/<id>/`，已被 Git 忽略。原始消息、签名、工具结果与预算使用 AES-256-GCM 和哈希链保存；密钥也在本机。Windows 沿用目录权限；能读到密钥和密文的人仍能解密。不开启外部记忆服务。

保留的是工具实际返回给 Agent 的完整内容。现有命令工具已截断的超长标准输出中段，不会因此重新出现；流哈希也不能还原它。完整消息仍在内存中，本实现缩小模型请求，并未实现有界进程内存。文件版本校验不证明业务语义；源码外部并发修改存在校验后的时间窗口。

文件指纹最多覆盖 10,000 个文件，排除 `.tea`、Git、常见构建/依赖目录和凭据文件。排除目录变化不在检测范围内。保留用户要求、失败日志和签名思考意味着非常长会话仍可能触及硬上限；可使用现有 `/compact`，其模型开销另行计费。

## 复现实验

`tea benchmark contextos --mode preflight --run-id check` 只生成并验证固定项目，无网络和计费。真实实验配置、预算、三组对照、重复次数及回退条件见[实验协议](CONTEXTOS_BENCHMARK.md)。测试覆盖 Java 源码表示与协议，但这台主机没有 Java 运行时，不宣称 Java 编译验收。TypeScript 的真实用例需要 Node 24 原生类型擦除能力，未单独执行类型检查。

`node scripts/replay-contextos.mjs benchmarks/results/contextos-replay` 可复现短任务、30/50 轮、重复读取、失败、源码变化与任务切换的工具回放，不调用模型。它测量请求字节，并检查用户要求、工具配对和精确恢复；不能替代真实 Token 对照。输出目录必须不存在。

A 的短任务负收益、B 的越界修改均已淘汰并保留[详细负面证据](../benchmarks/reports/contextos-glm-20261011/README.zh-CN.md)。当前 C 仍是待真实验证的候选；本地测试通过不保证任意任务都节省 Token 或遵守范围。
