# 统一工具协议与执行层

本轮先将现有工具接入 `src/tools/core.mjs`，不扩大命令权限，不改模型工具名称、参数、说明、返回文本或 ContextOS 引用格式。属于架构重构，不宣称直接节省 Token。

## 三个组件

- **ToolContext**：引用当前 WorkspaceTools 执行器，提供工作目录、signal、ledger、权限回调、ContextOS 和会话。关键环境使用 getter，避免下一回合沿用旧取消信号或旧记账对象。只存在宿主进程，不发给模型。
- **ToolSpec**：工具名、模型定义解析器、执行函数、可选输入校验器，以及修改/验证/阶段/命令计时分类。标准工具的参数校验继续由已有执行器落实，不增加一套含糊或较弱的 Schema 校验。
- **ToolService**：注册检查、动态工具选择、执行前取消检查、可选校验、统一调用和操作分类。命令期限、权限、路径、源码校验及输出限制继续由原执行器实施；不会用 Promise.race 提前释放仍在写入的操作。

## 执行流程

模型调用 → Agent 记录意图 → ToolService → ToolSpec → WorkspaceTools / ContextOS → Agent 统一记录结果、错误反馈及验证状态。

Agent 通过 ToolSpec 分类判断修改后待验证状态及真实验证命令。日志和会话提交保留一个写入位置，避免 Service 与 Agent 重复计费、重复追加工具结果。`dispatchTool` 保留为兼容入口，基准与现有 SDK 调用也经过相同服务。

工具注册覆盖 `list_files`、`search_code`、`read_file`、`apply_patch`、`write_file`、`run_tests`、`run_shell`、会话词表映射及两种 ContextOS 检索工具。标准视图仍保持原工具顺序；宽目录、搜索续页、禁用创建、未命中词表和按需召回继续动态选择，未注册名称不能出现在新服务的选择结果中。

## 本轮边界

本轮没有新增名为 Bash / PowerShell / Glob / Grep 的模型工具。现有内容检索是文字搜索，目录遍历不是 glob 表达式匹配；不能改名字就宣称拥有相应能力。`run_shell` 仍直接启动可执行文件，不因重构成为完整 shell。

后续可将真正的 PowerShell、Bash 或 glob 实现接入 ToolSpec。接入前需实现其执行器、权限和命令期限，明确文件变更及 ContextOS 证据的识别方式，单独做正确性与真实 Token 对比。宿主注册不等于模型获得新增权限。

## 验证原则

专项覆盖注册、输入/输出及错误透传、取消、动态环境、执行器替换、文件保护、真实验证命令分类、ContextOS 更换和动态工具视图。继续运行原有 Agent、权限、持久化、GC 与 ContextOS 全量测试。

额外从 Git 冻结基线与候选：比较 64 组工具视图，并比较 full-history 与发生引用淘汰/召回的 ContextOS 受控会话请求。构造模型回复及固定验证输出只用于协议等价检查，不作为真实模型正确率、Token 或性能数据。请求逐字节相同也不代表真实随机生成轨迹将完全相同。

不为内部架构名称增加系统提示，不用定义字节或本地执行时长冒充 provider Token 收益。阶段结束等待审核，再决定后续执行器实验。
