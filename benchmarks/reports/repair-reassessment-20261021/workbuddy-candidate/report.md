# WB-Bench-Code 候选版评测报告

## 1. 数据与方法检查

逻辑运行根 `native-run:candidate`；模型 GLM-5.3-flash，源码 `d0b566b36c6babe287fb96e4b2f63c31af5a752c`。4 道已见 Code80 子集任务，每题 2 次，共 8 次。原生 Harbor Trial + 官方 CompositeVerifier/scorer，自定义串行编排，不是完整榜单成绩。

任务、源码初始状态、兼容镜像、模型和限额与另一个版本相同。全部请求与独立传输记录对账，计量 8/8 完整，官方评分文件 8/8；对照含一次 build_error 零分回退，未完成常规检查。无自动重试。官方 `reward` 是任务得分均值，`pass_rate` 是整题满分比例。[方法与失败口径](../METHODS.zh-CN.md)

## 2. 摘要

官方 `reward` **0.7048**，整题通过 **3/8（37.5%）**；完成且满分 **3/8**。所有尝试供应商用量 **2,048,101 Token**，包括失败。

## 3. 编码能力分解

- **Black 缺陷修复（medium）**：第1次 6/6、801,329 Token、`completed`；第2次 6/6、448,541 Token、`completed`。

- **FastAPI 功能开发（medium）**：第1次 1/4、213,529 Token、`completed`；第2次 1/4、167,006 Token、`completed`。

- **Python 迁移（medium）**：第1次 19/20、54,395 Token、`completed`；第2次 13/20、228,040 Token、`completed`。

- **注册漏斗分析（hard）**：第1次 13/13、66,986 Token、`completed`；第2次 7/13、68,275 Token、`completed`。

三个 medium 类别、一个 hard 类别，均使用官方 Code profile；未覆盖的类别和难度不作推断。

## 4. 正确性与失败模式

- Python 迁移（medium）第1次：post template receives tags。

- 第1次 Python 迁移（medium）：`python -m pytest target_python/test_main.py -q` 不可用；替代命令 `python -m unittest target_python.test_main -v`。原命令保持未验证，不声称覆盖等价。

- FastAPI 功能开发（medium）第1次：tests.test_ws_dependencies::test_index - TypeError: FastAPI.websock...；tests.test_ws_dependencies::test_routerindex - TypeError: FastAPI.w...；tests.test_ws_dependencies::test_routerprefixindex - TypeError: Fas...；TypeError: FastAPI.websocket() got an unexpected keyword argument 'dependencies'；TypeError: FastAPI.websock...；TypeError: FastAPI.w...；TypeError: Fas...。

- 第1次 注册漏斗分析（hard）：`python -m pytest -q` 不可用；替代命令 `python -m unittest discover -s app -p "test*.py" -v`。原命令保持未验证，不声称覆盖等价。

- 注册漏斗分析（hard）第2次：signup count all users；verify count respects step order；create project requires prior verify in order；invite count one user；ads activation only u1 qualifies because u2 out of order；organic delayed create still counts if ordered；TypeError: list indices must be integers or slices, not str"；TypeError: list indices must be integers or slices, not str。

- 第2次 注册漏斗分析（hard）：`pytest` 不可用；替代命令 `python -m unittest`。原命令保持未验证，不声称覆盖等价。

- FastAPI 功能开发（medium）第2次：tests.test_ws_dependencies::test_index - TypeError: FastAPI.websock...；tests.test_ws_dependencies::test_routerindex - TypeError: FastAPI.w...；tests.test_ws_dependencies::test_routerprefixindex - TypeError: Fas...；TypeError: FastAPI.websocket() got an unexpected keyword argument 'dependencies'；TypeError: FastAPI.websock...；TypeError: FastAPI.w...；TypeError: Fas...。

- Python 迁移（medium）第2次：post template receives title；post template receives markdown content；post template receives tags；post template receives date；markdown content renders heading for another post；index links to post pages；tag page links to post pages。

- 第2次 Python 迁移（medium）：`python -m pytest target_python/test_main.py -q` 不可用；替代命令 `python -m unittest discover -s target_python -p "test_main.py" -v`。原命令保持未验证，不声称覆盖等价。

评分来自事后官方输出；没有读取隐藏测试源文件/参考解答或将评分提示反馈给冻结运行。分析题对照第2次是产出结构引起官方评分器 TypeError，官方回退为 0/1、build_error，不等于正常执行后 13 项全部失败。

## 5. 补丁定位与执行轨迹

- Black 缺陷修复（medium）第1次：请求 46，工具 51，验证尝试 6；补丁 4 个文件、文本 +128/−1，二进制项 0。

- Python 迁移（medium）第1次：请求 9，工具 9，验证尝试 2；补丁 4 个文件、文本 +357/−4，二进制项 2。

- FastAPI 功能开发（medium）第1次：请求 27，工具 31，验证尝试 2；补丁 3 个文件、文本 +90/−4，二进制项 0。

- 注册漏斗分析（hard）第1次：请求 15，工具 15，验证尝试 3；补丁 5 个文件、文本 +162/−2，二进制项 2。

- 注册漏斗分析（hard）第2次：请求 16，工具 18，验证尝试 4；补丁 6 个文件、文本 +187/−2，二进制项 2。

- FastAPI 功能开发（medium）第2次：请求 29，工具 37，验证尝试 4；补丁 2 个文件、文本 +73/−2，二进制项 0。

- Python 迁移（medium）第2次：请求 25，工具 26，验证尝试 7；补丁 4 个文件、文本 +215/−4，二进制项 2。

- Black 缺陷修复（medium）第2次：请求 36，工具 36，验证尝试 5；补丁 5 个文件、文本 +124/−1，二进制项 0。

16/16 实际补丁均在隐藏检查注入前保存；发布路径/行数/哈希元数据，不发布原始会话。文件计数包含字节码等生成产物，不等于模型主动编辑源码数。[补丁元数据](../workbuddy-patch-metadata.json)

## 6. 代表案例

- Black：两版本两次均完成且 6/6，是唯一符合成功工作 Token 比较条件的任务。

- FastAPI：对照两次 4/4，候选两次 1/4；候选第2次只改路由实现及自测，实际应用入口的覆盖不足。

- Python 迁移：对照 14/20、12/20，候选 19/20、13/20；模板数据与页面输出仍不完整。

- 注册漏斗：对照 13/13 后待验证、第二次官方 build_error；候选完成但成绩为 13/13、7/13。缺失运行器的恢复有真实案例支持，业务结果仍有重复波动。

## 7. 改进建议

将工具可靠性修复与通用提示改动拆开做消融；优先解决真实入口/API 数据契约覆盖，防止简化自测形成错误完成感。对运行器缺失保留明确未验证记录。修改后另行冻结实验，不替换本轮失败。

## 8. 对照解读与限制

Black 两个成功配对合计 Token **−14.74%**，但仅一种任务、两次重复（各次 −1.30% / −31.42%）。全体消耗 **−36.40%** 同时伴随整题通过 **5/8 → 3/8**，不能称整体优化成功。两组完成且满分均为 3/8；流程完成度与官方正确性不是同一个指标。

任务已见、样本小、供应商无固定随机种子、使用兼容镜像和自定义串行编排；不能作为完整 Code80 榜单或普遍收益。[总报告](../RESULTS.zh-CN.md)
