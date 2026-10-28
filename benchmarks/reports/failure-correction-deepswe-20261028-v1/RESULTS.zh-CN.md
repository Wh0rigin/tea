# 失败纠正：DeepSWE 对照结果

结论：未通过正确率优先的采用门槛。源码修复的机制回归通过，但本轮不能证明自主纠错或解题收益。保留 Draft，等待审核。

八次均已运行，未运行样本为零。调度器在最后一次验收后仍标记 candidate_quality_futility；这是最终质量失败标记，本轮实际没有提前省略任何计划样本。全部 460 次请求计量完整，无未知用量和网络重试。

候选失败分别是 Helm 确定性渲染顺序（新增 1/5、旧 2/2）和 Mnamer 嵌套状态路径日志（369/370）。候选第二次 Mnamer 经过八次本地测试错误后通过官方 370/370；第二次 Helm 也通过 7/7，说明原有纠错链能成功，但验证覆盖存在波动。基线第二次 Mnamer 自测通过仍漏掉启动、重启和日志边界（366/370）。因此更多自测或更少 Token 本身都不能代替行为覆盖。

四次候选均未触发新分类，逐对首请求哈希一致；不能把路径波动归因于未介入的提示。后续应优先研究真实失败命令反复重跑，以及公开需求到真实 CLI/持久化边界的验证覆盖，而不是仅继续扩充调用错误分类。本轮不追加新改动或付费测试。

状态：stopped；停止原因：candidate_quality_futility。未合并正式代码。

- 基线：已验收 4 次，通过 3 次；计划四次、已运行 4 次。原生完成且官方通过 2 次；完整计量 4 次。已知 Token 小计 6,233,170，提交请求 292 次。新分类反馈 0 次，涉及 0 次运行。
- 候选：已验收 4 次，通过 2 次；计划四次、已运行 4 次。原生完成且官方通过 2 次；完整计量 4 次。已知 Token 小计 3,489,889，提交请求 168 次。新分类反馈 0 次，涉及 0 次运行。

整轮全部尝试 Token 变化（候选相对基线）：-44.01%；官方验收率变化 -25.00 个百分点。若验收下降，不能将 Token 减少称为有效优化。

## 全部已运行样本

- helm-unified-manifest-stream / baseline r1: official 5/5 new + 2/2 regression; native needs_validation; tokens 2530497; requests 103; correction feedback 0.
- helm-unified-manifest-stream / candidate r2: official 1/5 new + 2/2 regression; native needs_validation; tokens 1267429; requests 59; correction feedback 0.
- mnamer-daemon-watch-lifecycle / candidate r1: official 50/51 new + 319/319 regression; native completed; tokens 469740; requests 23; correction feedback 0.
- mnamer-daemon-watch-lifecycle / baseline r2: official 51/51 new + 319/319 regression; native completed; tokens 597354; requests 31; correction feedback 0.
- mnamer-daemon-watch-lifecycle / baseline r3: official 47/51 new + 319/319 regression; native completed; tokens 1760438; requests 97; correction feedback 0.
- mnamer-daemon-watch-lifecycle / candidate r4: official 51/51 new + 319/319 regression; native completed; tokens 1025703; requests 47; correction feedback 0.
- helm-unified-manifest-stream / candidate r3: official 5/5 new + 2/2 regression; native completed; tokens 727017; requests 39; correction feedback 0.
- helm-unified-manifest-stream / baseline r4: official 5/5 new + 2/2 regression; native completed; tokens 1344881; requests 61; correction feedback 0.

## 解释边界

候选未触发任何新分类反馈，不能据此建立反馈收益或伤害的因果结论。触发前路径波动不能算作反馈作用。

直接基于正式 a3571e5，对照候选 ca7a27a；不包含优先级 1/2 和固定复核轮次。PR16 数值配置、模型、思考、端点、流式、提示词、工具定义、初始任务源码及验收一致，仅三个运行文件不同。两道已知题、每组最多重复两次，不是完整或未见任务的 DeepSWE 分数。官方补丁通过和 Agent 原生完成分开记录，失败、未知用量和未运行样本均保留。

专项与相关回归 74/74，全量 485/485，付费前六组 CI 全通过；服务器两组零模型调用预检通过。源码归档、适配器、配置、任务、请求哈希及真实用量核查见 verification.json。脚本模型测试只证明机制，不证明真实解题能力。

[冻结协议](protocol.json) · [预检](preflight.json) · [逐次结果](results.json) · [行为诊断](diagnostics.json) · [完整性核查](verification.json)。未读取私有思维链或隐藏验收实现。
