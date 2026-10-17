# 同步 Python Code Agent 实验（2026-10-17）

## 假设

上一轮 QuickJS 测量出现 15 次空对象输出，源于检索函数返回 Promise、模型漏写 await。本轮采用同步 Python 工具接口，验证消除异步契约错误后，能否减少检索修复轮次，并在验收不下降时减少累计 provider Token。比较正常工具模式与完整 Python code-first 模式，不是单独切换语言的消融实验。

## 实现与边界

- Node.js 主循环、源码工具、精确编辑、验证、计量和 ContextOS 保持原有后端；Python 只通过逐条 JSON RPC 编排现有只读检索。
- 独立 CPython 子进程；固定 RestrictedPython 8.5、依赖 wheel SHA-256；使用成熟受限编译器，不自制 Python 语法解释器。
- 工具同步返回字典或宿主签发的不透明证据页。支持关键词参数/字典参数、普通循环、切片、函数、推导式、emit/print；不用 await。
- 不继承 API 凭据；只传递启动所需的系统路径环境变量。禁止导入、宿主文件/进程 API 和反射入口；RPC 不暴露任意宿主方法。
- 限额：每程序最多 8 次子操作、4 页、10 KB 结果；15 秒墙钟、30000 个 Python trace 事件、10 秒 CPU、256 MiB 地址空间/提交内存。Linux 使用 rlimit，Windows 使用 Job Object；建立资源限制失败则不执行程序。
- 只有配额耗尽且已有 emit/print 才交付标记 incomplete 的前缀；语法、非法路径、取消和其他执行错误不提交暂存证据。
- 页只能直接输出；不得拼接、嵌套、伪造或读取 page.text。tool_result 持久化后才将已输出的范围计入证据。复用 SHA-256 版本校验及过期失效。
- RestrictedPython 是语言限制机制，并非操作系统权限沙箱。进程资源限制也不等于权限隔离；本原型默认关闭，不把它作为对恶意代码的生产安全边界。

## 离线门槛

31/31 专项通过：真实同步返回、上一轮错误调用模式的 Python 对应操作、字段错误、页序列化/伪造、部分交付、计数、取消、超时、CPU/内存、非法路径、导入与反射、ContextOS 过期及历史召回、真实编辑后验证。完整回归首版 364/364；UTF-8 修正及完整同步调用策略回归后 **365/365 通过**。

本轮不把旧 JavaScript 程序翻译成 Python 后声称“原样回放成功”；使用明确的 Python 对应回归验证接口契约。

## 付费前冻结协议

- 三道已用过的自编 Node 任务：短任务、依赖检索修复、分页修复，各两轮、两边，共 12 次；交替顺序，每次全新工作区。
- 正常 TEA 基线 b6f9395，对比本轮冻结 Python 候选，保留默认关闭配置；固定 GLM-5.3-flash、enabled thinking、low effort、4096 最大输出、streaming、ContextOS 和自动压缩设置。
- 同一初始文件、任务要求、隐藏行为验收、公共/新增测试和保护文件规则；所有参考控制在付费前通过，不修改判定以接纳候选。
- 每任务 1 USD 预留，总 4 USD 控制上限；估价输入/输出 0.8/2.8 USD 每百万 Token，仅作控制，非发票。
- 请求 90 秒、命令 120 秒、任务 600 秒、24 次工具额度（包括代码中的子检索）。未知用量保留预留并停止，不自动付费重试；不把未知计作零。
- 冻结 Git 源码、task manifest、runner、transport observer、RestrictedPython 安装内容与 requirements、Python 解释器二进制及版本指纹；每次提交前及结束核对。
- 用量包含缓存输入和思考输出，采用 provider 计数。保留所有失败成本；柱状图只纳入成功任务，失败另列。
- 保留条件：覆盖/用量完整，各题族验收和独立代码行为不下降，全部尝试累计 provider Token 减少。否则撤销运行时变动、保留实现提交和负面证据。
- 样本为反复使用的自编任务，不能据此声称生产平均收益；下一阶段需独立审核，本阶段后停止。

## 依赖与复现

Python 3.10+（本机实际版本及二进制指纹随结果记录）：

```sh
python -m pip install --require-hashes --no-deps --target .tea/python-runtime -r requirements-python-retrieval.txt
npm test
```

实验模式通过 TEA_CODE_FIRST=1 开启；普通模式无需 Python 依赖。可用 TEA_PYTHON_EXECUTABLE / TEA_PYTHON_DEPS 指定解释器与依赖目录，不固定用户账户路径。CI 候选分支安装同一哈希固定的测试依赖。

[RestrictedPython 官方边界说明](https://restrictedpython.readthedocs.io/en/latest/) · [Windows Job 内存限制](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)

## 首次启动后的编码检查与中止记录

首版候选 61b0992、runner 2306a48 在 `python-code-first-screen-glm-20261017-v1` 启动。额外离线 Unicode 探测发现本机 Python 管道默认为 GBK，UTF-8 字面量往返失真。立即设置 STOP_AFTER_CURRENT，待当前基线结算后停止；没有启动候选。

这次基线验收通过，9,647 provider Token；已知控制估价 0.0097456 USD。该孤立样本保留在中止报告，不纳入重新冻结的配对比例。首版冻结源码/依赖在中止时未改变。没有未知用量或自动重试。

修正：显式传递 Python `-X utf8`，新增中文程序字面量、查询、源码与文件名的双向 IPC 回归。之后另开 v2 对照，同一计划；v2 控制上限调整为 3.99 USD，加上前次已知支出小于原总控制上限 4 USD。

最终结果待 v2 冻结测量后补充。
