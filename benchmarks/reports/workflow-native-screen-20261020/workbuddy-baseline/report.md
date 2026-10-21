# WB-Bench-Code 父版本评测报告

## 1. 数据与方法检查

逻辑运行根：`native-run:baseline`（发布时隐藏服务器绝对路径）；模型 GLM-5.3-flash，TEA 源码 `b400577185f0b224850540cc9289672f62450f33`；数据集 `wb-bench-code`，4 题，每题 2 次，共 8 次。采用原生 Harbor Trial 和官方 CompositeVerifier/scorer，自定义串行编排，不是官方完整 job/榜单成绩。

原始评分、任务和补丁保持不变，官方 scorer 输出的公开副本见 [metrics.json](metrics.json)，仅脱敏 `run_dir` 并记录原输出哈希。所有 8 份评分均存在，无缺题或 build-error 记录。模型参数、兼容镜像和权限与对照版本一致，详见[方法](../METHODS.zh-CN.md)。

`reward` 是官方任务得分均值；`pass_rate` 是整题满分比例，不是所有检查逐项拼接后的通过率。

## 2. 摘要

官方 `reward` **0.7611**，`pass_rate` **50.0%**；整题满分 **4/8**，未满分 **4/8**。全部尝试实际消耗 **2,441,127 Token**，计量 8/8 完整。Black 两次满分，迁移和功能题存在明显重复波动。

## 3. 编码能力分解

- **Black 缺陷修复（medium）**：平均 reward 1.0000，满分 2/2；第1次 6/6、439,628 Token、`completed`；第2次 6/6、642,090 Token、`completed`。

- **FastAPI 功能开发（medium）**：平均 reward 0.3750，满分 0/2；第1次 2/4、502,163 Token、`completed`；第2次 1/4、363,970 Token、`completed`。

- **Python 迁移（medium）**：平均 reward 0.9000，满分 1/2；第1次 16/20、57,422 Token、`completed`；第2次 20/20、126,570 Token、`completed`。

- **产品数据分析（hard）**：平均 reward 0.7692，满分 1/2；第1次 7/13、154,900 Token、`completed`；第2次 13/13、154,384 Token、`completed`。

本子集为三个 medium 类别及一个 hard 类别；产物是代码与相应测试/数据产物，验证使用官方 Code profile。未抽到的其他能力类别、复杂度和验证模式不作推断。

## 4. 正确性与失败模式

- FastAPI 2/4、1/4；`test_routerindex` / `test_routerprefixindex` 等组合入口断言失败，自写测试通过没有证明接口需求完整。

- Python 迁移第一次 16/20，遗漏正文渲染及索引/标签页面链接；第二次 20/20，说明表现受执行轨迹影响。

- 数据分析第一次 7/13，第二次 13/13。两次都遇到 pytest 不存在，随后切换 unittest。旧验证器允许另一命令通过后完成，但这不能说明最初失败的检查获得了等价覆盖。

文件级路径传入只支持目录的 `search_code`，以及冻结命令策略拒绝原生 grep/多段命令，都产生了额外往返。它们属于共享工具/评测权限限制，不应直接归因于某个工作流提示。失败签名来自事后官方输出，未读取参考答案或将其反馈给冻结运行。[失败摘要](../failure-signatures.json)

## 5. 补丁定位与执行轨迹

- `bug_fix-medium-incorrect_linenos_on_fstring` 第1次：补丁 3 个文件，文本 +92/−1，二进制项 0；请求 33，工具 38，批量调用 0，验证尝试 3。

- `bug_fix-medium-incorrect_linenos_on_fstring` 第2次：补丁 3 个文件，文本 +102/−1，二进制项 0；请求 50，工具 59，批量调用 0，验证尝试 4。

- `feature-medium-add_support_for_dependencies` 第1次：补丁 3 个文件，文本 +128/−8，二进制项 0；请求 58，工具 65，批量调用 0，验证尝试 8。

- `feature-medium-add_support_for_dependencies` 第2次：补丁 3 个文件，文本 +133/−8，二进制项 0；请求 41，工具 53，批量调用 0，验证尝试 6。

- `product_analytics-hard-signup_funnel` 第1次：补丁 7 个文件，文本 +155/−2，二进制项 3；请求 26，工具 29，批量调用 0，验证尝试 7。

- `product_analytics-hard-signup_funnel` 第2次：补丁 6 个文件，文本 +159/−2，二进制项 2；请求 26，工具 27，批量调用 0，验证尝试 6。

- `python_port-medium-blog_tags` 第1次：补丁 10 个文件，文本 +177/−6，二进制项 2；请求 12，工具 19，批量调用 0，验证尝试 2。

- `python_port-medium-blog_tags` 第2次：补丁 15 个文件，文本 +374/−4，二进制项 2；请求 17，工具 25，批量调用 0，验证尝试 4。

16 份真实 Agent 补丁均在隐藏检查注入前保存。该版本每次均修改相应产品源码，并补充自己的测试；没有只修改测试而得到满分的证据。文件计数包含生成文件/字节码，不等于模型主动编辑源码数。逐项路径、补丁哈希见[元数据](../workbuddy-patch-metadata.json)，公开报告不复制原始对话和隐藏测试实现。

## 6. 代表案例

- **Black / bug-fix / medium**：两次均 6/6，实际修改 `src/blib2to3/pgen2/tokenize.py` 并补测试；它是本轮双方完整通过的唯一任务类型。

- **FastAPI / feature / medium**：修改 `fastapi/applications.py` 和 `fastapi/routing.py`，关键风险为 application/router/prefix 的组合覆盖；重复结果不能只取最高分。

- **blog_tags / python-port / medium**：修改 `target_python` 实现并添加构建样例；模板数据契约与真实页面产物决定成败，自建最简输入不足以验证迁移等价。

- **signup_funnel / product-analytics / hard**：修改 `app/report.py`，需同时保证时序漏斗逻辑和 JSON 输出结构；环境工具缺失、测试框架替代和业务结果正确性需要分别判断。

## 7. 改进建议

优先在官方 unit/integration/script 验证模式下补应用/路由组合与真实模板入口检查；针对数据分析区分依赖缺失和源码失败，提供有证据的替代验证入口；减少检索参数错误，追踪重复检索是否收敛。修改后需要重新冻结对照，不能把本轮失败静默替换。

## 8. 对照解读与限制

完整对照见[中文总报告](../RESULTS.zh-CN.md)。候选 Black 两次完整通过的合计 Token −46.04%；全体 WB 尝试虽然 −27.20%，整题通过却由 4/8 降到 3/8，不能称整体优化成功。四题两次重复且无随机种子控制，环境经过明确兼容适配，不能代表完整 80 题分数或通用编码能力。
