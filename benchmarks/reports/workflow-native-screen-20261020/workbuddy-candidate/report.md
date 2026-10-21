# WB-Bench-Code 候选版评测报告

## 1. 数据与方法检查

逻辑运行根：`native-run:candidate`（发布时隐藏服务器绝对路径）；模型 GLM-5.3-flash，TEA 源码 `7bd236f4d548af1214ddf498ccaf7a5c3b928100`；数据集 `wb-bench-code`，4 题，每题 2 次，共 8 次。采用原生 Harbor Trial 和官方 CompositeVerifier/scorer，自定义串行编排，不是官方完整 job/榜单成绩。

原始评分、任务和补丁保持不变，官方 scorer 输出的公开副本见 [metrics.json](metrics.json)，仅脱敏 `run_dir` 并记录原输出哈希。所有 8 份评分均存在，无缺题或 build-error 记录。模型参数、兼容镜像和权限与对照版本一致，详见[方法](../METHODS.zh-CN.md)。

`reward` 是官方任务得分均值；`pass_rate` 是整题满分比例，不是所有检查逐项拼接后的通过率。

## 2. 摘要

官方 `reward` **0.7043**，`pass_rate` **37.5%**；整题满分 **3/8**，未满分 **5/8**。全部尝试实际消耗 **1,777,033 Token**，计量 8/8 完整。Black 两次满分，迁移和功能题存在明显重复波动。

## 3. 编码能力分解

- **Black 缺陷修复（medium）**：平均 reward 1.0000，满分 2/2；第1次 6/6、191,866 Token、`completed`；第2次 6/6、391,805 Token、`completed`。

- **FastAPI 功能开发（medium）**：平均 reward 0.6250，满分 1/2；第1次 4/4、502,348 Token、`completed`；第2次 1/4、405,147 Token、`completed`。

- **Python 迁移（medium）**：平均 reward 0.5000，满分 0/2；第1次 17/20、47,909 Token、`completed`；第2次 3/20、39,121 Token、`completed`。

- **产品数据分析（hard）**：平均 reward 0.6923，满分 0/2；第1次 6/13、112,780 Token、`needs_validation`；第2次 12/13、86,057 Token、`needs_validation`。

本子集为三个 medium 类别及一个 hard 类别；产物是代码与相应测试/数据产物，验证使用官方 Code profile。未抽到的其他能力类别、复杂度和验证模式不作推断。

## 4. 正确性与失败模式

- Python 迁移第二次只有 3/20，真实构建入口出现 `KeyError: tags`；简化自测通过，没有覆盖真实模板上下文。第一次 17/20 仍遗漏 Markdown 正文、站点标题。

- FastAPI 第一次 4/4，第二次 1/4；`test_index`、`test_routerindex`、`test_routerprefixindex` 出现 API TypeError，表明应用/路由集成入口没有覆盖齐。

- 数据分析 6/13、12/13；第二次 `steps are stable` 出现 `KeyError: steps`。两次都缺 pytest，待验证机制保留无法执行的原命令；第二次 unittest 通过也没有清除该环境阻塞，最终均为 `needs_validation`。

文件级路径传入只支持目录的 `search_code`，以及冻结命令策略拒绝原生 grep/多段命令，都产生了额外往返。它们属于共享工具/评测权限限制，不应直接归因于某个工作流提示。失败签名来自事后官方输出，未读取参考答案或将其反馈给冻结运行。[失败摘要](../failure-signatures.json)

## 5. 补丁定位与执行轨迹

- `bug_fix-medium-incorrect_linenos_on_fstring` 第1次：补丁 2 个文件，文本 +59/−1，二进制项 0；请求 21，工具 25，批量调用 1，验证尝试 1。

- `bug_fix-medium-incorrect_linenos_on_fstring` 第2次：补丁 3 个文件，文本 +83/−1，二进制项 0；请求 31，工具 35，批量调用 4，验证尝试 2。

- `feature-medium-add_support_for_dependencies` 第1次：补丁 3 个文件，文本 +113/−9，二进制项 0；请求 46，工具 57，批量调用 4，验证尝试 3。

- `feature-medium-add_support_for_dependencies` 第2次：补丁 3 个文件，文本 +134/−6，二进制项 0；请求 30，工具 41，批量调用 4，验证尝试 1。

- `product_analytics-hard-signup_funnel` 第1次：补丁 3 个文件，文本 +126/−2，二进制项 0；请求 21，工具 21，批量调用 3，验证尝试 3。

- `product_analytics-hard-signup_funnel` 第2次：补丁 4 个文件，文本 +151/−2，二进制项 1；请求 16，工具 16，批量调用 0，验证尝试 3。

- `python_port-medium-blog_tags` 第1次：补丁 5 个文件，文本 +336/−6，二进制项 2；请求 10，工具 11，批量调用 1，验证尝试 2。

- `python_port-medium-blog_tags` 第2次：补丁 13 个文件，文本 +216/−4，二进制项 2；请求 11，工具 14，批量调用 2，验证尝试 1。

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
