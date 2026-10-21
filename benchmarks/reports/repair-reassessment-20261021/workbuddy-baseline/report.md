# WB-Bench-Code 对照版评测报告

## 1. 数据与方法检查

逻辑运行根 `native-run:baseline`；模型 GLM-5.3-flash，源码 `5cb519899cccf5a0f91ab2ff74c215dd948f4448`。4 道已见 Code80 子集任务，每题 2 次，共 8 次。原生 Harbor Trial + 官方 CompositeVerifier/scorer，自定义串行编排，不是完整榜单成绩。

任务、源码初始状态、兼容镜像、模型和限额与另一个版本相同。全部请求与独立传输记录对账，计量 8/8 完整，官方评分文件 8/8；对照含一次 build_error 零分回退，未完成常规检查。无自动重试。官方 `reward` 是任务得分均值，`pass_rate` 是整题满分比例。[方法与失败口径](../METHODS.zh-CN.md)

## 2. 摘要

官方 `reward` **0.7875**，整题通过 **5/8（62.5%）**；完成且满分 **3/8**。所有尝试供应商用量 **3,220,424 Token**，包括失败。

## 3. 编码能力分解

- **Black 缺陷修复（medium）**：第1次 6/6、811,924 Token、`completed`；第2次 6/6、654,043 Token、`completed`。

- **FastAPI 功能开发（medium）**：第1次 4/4、1,001,940 Token、`needs_validation`；第2次 4/4、313,370 Token、`completed`。

- **Python 迁移（medium）**：第1次 14/20、34,075 Token、`completed`；第2次 12/20、41,721 Token、`completed`。

- **注册漏斗分析（hard）**：第1次 13/13、114,955 Token、`needs_validation`；第2次 0/1、248,396 Token、`needs_validation`（官方 build_error 回退，未完成常规检查）。

三个 medium 类别、一个 hard 类别，均使用官方 Code profile；未覆盖的类别和难度不作推断。

## 4. 正确性与失败模式

- Python 迁移（medium）第1次：post template receives markdown content；post template receives tags；markdown content renders heading for another post；post template placeholders are replaced；index uses site title；index template placeholders are replaced。

- 注册漏斗分析（hard）第2次：TypeError: string indices must be integers, not 'str'。

- Python 迁移（medium）第2次：post template receives tags；index includes all posts；index lists posts newest first；index links to post pages；home tag groups matching posts；drink tag only includes tea；food tag includes food posts；tag page links to post pages。

评分来自事后官方输出；没有读取隐藏测试源文件/参考解答或将评分提示反馈给冻结运行。分析题对照第2次是产出结构引起官方评分器 TypeError，官方回退为 0/1、build_error，不等于正常执行后 13 项全部失败。

## 5. 补丁定位与执行轨迹

- Black 缺陷修复（medium）第1次：请求 63，工具 67，验证尝试 3；补丁 7 个文件、文本 +369/−1，二进制项 0。

- Python 迁移（medium）第1次：请求 8，工具 9，验证尝试 1；补丁 4 个文件、文本 +200/−4，二进制项 2。

- FastAPI 功能开发（medium）第1次：请求 79，工具 88，验证尝试 14；补丁 4 个文件、文本 +138/−8，二进制项 0。

- 注册漏斗分析（hard）第1次：请求 19，工具 18，验证尝试 7；补丁 4 个文件、文本 +160/−2，二进制项 1。

- 注册漏斗分析（hard）第2次：请求 39，工具 38，验证尝试 13；补丁 7 个文件、文本 +151/−2，二进制项 3。

- FastAPI 功能开发（medium）第2次：请求 36，工具 48，验证尝试 6；补丁 3 个文件、文本 +134/−8，二进制项 0。

- Python 迁移（medium）第2次：请求 10，工具 15，验证尝试 1；补丁 21 个文件、文本 +245/−1，二进制项 2。

- Black 缺陷修复（medium）第2次：请求 45，工具 47，验证尝试 5；补丁 5 个文件、文本 +88/−1，二进制项 0。

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
