# 只读检索代码编排实验

日期：2026-10-17。默认关闭，SDK `retrievalCode:true` 或实验环境 `TEA_RETRIEVAL_CODE=1` 启用。生产默认行为不变，是否采用等待实测与审核。

## 机制

借鉴 [Agentic RAG 的动态检索策略](https://github.com/run-llama/llama_index/blob/main/docs/src/content/docs/framework/optimizing/agentic_strategies/agentic_strategies.md) 与 [smolagents CodeAgent 的代码动作](https://huggingface.co/docs/smolagents/main/guided_tour)，让模型在一次 retrieve_code 调用中表达有依赖的搜索、条件回退、局部读取和输出选择。已有工具保持可用，不强制所有任务先规划，不新增独立规划模型调用。

这是受限 JavaScript 子集的解释器实验，不是完整 JavaScript/Python CodeAgent，不运行任意代码。支持 let/const、赋值、if/else、for-of、await、对象/数组及自有数据字段。仅能调用 search/list/read/readHit/history/recall/take/empty/emit，无 import、eval、Function、vm、宿主对象、任意函数/方法、网络、写入或 shell。第一版子操作顺序执行，目标是减少有依赖操作的模型往返，不宣称并行加速。

```javascript
let s = await search({query:"retry", path:"src"});
if (empty(s.items)) { s = await search({query:"retry"}); }
for (const hit of take(s.items,2)) { emit(await readHit(hit)); }
```

API 名称是编排层接口，复用已有检索/文件保护；不解析普通搜索展示文本。搜索返回结构化路径、行号、版本和最多 240 字符的单行预览，覆盖/游标语义保留。list 的完整性只针对过滤和深度边界内的分页，不代表整个仓库。

## 边界和证据

- 每次最多 8 个子操作、4 个输出证据页、10KB 返回；程序 6000 字符、2000 token（解释器词法单元，不是模型 Token）、有限 AST 深度/循环/求值步数。15 秒为操作间检查的期限，不是强制中断底层文件 I/O 的操作系统沙箱。
- 子操作计入 Agent 原工具次数上限，代码编排不能绕过预算。沿用现有计数语义：被拒绝的下一次外层调用也可能计入尝试数。子操作 intent/settled 仅记协议元数据到本地 ledger。
- 中间读取仅留本次临时状态；不设置全局已交付标记。只有 emit 的原始证据页在外层 tool_result 持久追加后更新 presentedSource；部分失败/取消/未 emit 不能污染去重缓存。多次编排结果同轮交付分别确认。
- 任意输出保守携带此次观察到的全部源码版本依赖，不自动宣称筛选后的内容具备更强语义。外部编辑令旧引用失效。恢复缺少交付元数据时视为 stale，禁止返回旧源码。
- 第一版一次编排输出是一个 ContextOS 单元，可分页召回；依赖任一文件变更则整单元失效。尚不支持逐子页独立淘汰，这是明确的保守局限。
- AGENTS.md 全文必须走普通 read_file，保留其独立规则身份。编排不学习或提交未命中词表映射，不保存跨调用的脚本变量。

## 付费前冻结的筛选协议

三道自编 Node 任务：原水仙花数短任务、新增多步检索重试策略任务、原多层分页任务；每题两轮、两边，共 12 次。双方初始文件、用户要求、GLM-5.3-flash、enabled thinking / low、4096 输出、流式、ContextOS、自动压缩相同，仅候选启用检索编排；按任务/轮次交替先后。

原始工具定义逐字一致，仅候选增加 retrieve_code；不要求模型必须使用它。记录实际采用率、成功率、子操作数、首次输入变化、请求轮数和全部 provider Token。短任务作为固定开销对照；所有任务先完成初始公开通过/隐藏失败、参考实现全通过控制。自编任务不是保密留出，筛选不代表泛化验证。

每请求 90 秒、命令 120 秒、任务 600 秒；原工具上限 24（包括编排子操作），每次 1 USD 预留、全组 4 USD 有限上限。0.8/2.8 USD/MTok 为保守预算参数，不作发票依据。用量未知保留预留并停止，不自动重试、不填零。质量失败继续其他独立样本，失败费用保留。

只有覆盖、用量完整且候选完整验收/独立代码行为总体及逐题均不下降、全部尝试 Token 更低，才通过筛选；仍不证明统计显著性或通用收益。不按成功子集替代全量，不将历史不同批次混算。失败候选关闭/撤销运行时变动，冻结提交与记录保留；通过也等待审核，不自动下一阶段。
