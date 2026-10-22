# 编辑权限与工具策略

[English](EDIT_PERMISSIONS.md)

TEA 参考 Claude Code 将“任务指令、权限规则、执行前拦截”分开的设计，在 `apply_patch` 和 `write_file` 写入前检查配置的路径规则。配置语法是 TEA 自己的，不是 Claude 配置的直接兼容实现。

## 配置受保护路径

将下面的字段合并进现有 `~/.tea/config.json`，保留原有模型和凭据设置：

```json
{
  "editPermissions": {
    "deny": ["tests/public.test.mjs"],
    "ask": ["package.json"],
    "allow": []
  }
}
```

重启 TEA 生效。用户配置对所有工作区生效，路径相对于各自工作区；不自动加载或信任项目配置。单次任务规则可通过 `loadConfig({editPermissions: ...}, env)` / `loadCliConfig(...)` 传入，或设置内容为 JSON 对象的 `TEA_EDIT_PERMISSIONS`。选项覆盖环境变量，环境变量覆盖用户配置。

- `deny`：写入前拒绝，审批回调不能覆盖。
- `ask`：每次操作单独审批。交互式 `tea` 展示目标路径和修改预览，敏感文本脱敏、控制字符清理，最多 4,000 字符并标注截断；输入 yes 只批准当次，其他回答拒绝，Esc 取消。SDK 回调能获得完整拟写内容或 search/replace。
- `allow`：非空时作为允许列表，未命中路径拒绝；显式命中 ask 的路径可在当次批准后继续。空列表不增加允许列表限制。
- 优先级：**deny → ask → allow → 默认行为**。不配置规则时保留原有编辑行为。

路径使用 `/`；配置中的 Windows 反斜杠会归一化。`*`、`?` 匹配一个路径段内的字符，单独的 `**` 段可匹配零层或多层目录，结尾 `/` 表示后代路径。规则从工作区根目录匹配：`tests/*` 不匹配 `tests/deep/a.mjs`，`tests/**` 可以。其他字符按普通字符匹配，不支持否定、花括号展开或正则。Windows 忽略大小写。每组最多 32 条、每条最多 160 字符，错误配置会停止加载。

同时检查请求路径和解析后的真实目标：任一命中 deny 即拒绝；允许列表必须覆盖两者。既有工作区、凭据、元数据、新文件父目录及精确补丁检查继续有效。审批不缓存；取消、审批期间规则变化或符号链接改指目标都会阻止本次操作。

**不默认禁止所有测试文件。** 正常项目可能确实需要修改已有测试，应按具体任务配置保护清单。AGENTS.md 中的自然语言禁改要求不会自动转成可执行权限。

## SDK 审批与执行前拦截

```js
await runTask(task, config, {
  approveEdit: async ({ path, operation, change }) => {
    // 向应用用户展示完整方案，明确返回 true 才批准当次。
    return await askUser({ path, operation, change });
  },
  beforeToolUse: async ({ name, input }, context) => {
    if (name === 'write_file' && taskIsReadOnly) {
      return { decision: 'deny', reason: 'This task permits reading only.' };
    }
    // undefined 或 {decision:'allow'} 继续后端常规检查。
  }
});
```

`approveEdit` 收到 `{path, resolvedPath, operation, rule, change}`；新建时 change 是不可变 `{content}`，补丁时是 `{search, replace}`。无审批回调的程序调用/无交互执行遇到 ask 会拒绝；使用交互式 tea 或自行提供处理器。批准文件编辑不会同时授权 shell，也不能覆盖内置保护。

`beforeToolUse` 在统一 ToolService 入口执行，覆盖读取、写入、验证和历史工具。允许返回 undefined、allow 或带原因的 deny；非法返回值或异常均阻止执行。它是应用主动传入的可信宿主函数，不会自动运行项目中的脚本。涉及外部等待时应响应 `context.signal`。SDK 直接调用后端方法仍检查编辑路径，但不触发 ToolService hook。核心接口 `new ToolService({context, specs, beforeExecute})` 也使用 `(event, context)` 参数顺序。

配置生效时，权限判断与审批结果记入 ledger 元数据，不记录补丁内容。错误码包括 EDIT_PERMISSION_DENIED、EDIT_APPROVAL_UNAVAILABLE、EDIT_APPROVAL_DENIED、TOOL_POLICY_DENIED，反馈会要求保留受保护文件并选择可行替代操作。

## 边界与验证

这是**工具层编辑控制，不是操作系统文件沙箱**。测试程序、npm 脚本、获批可执行程序、扩展或宿主回调内部的写入，不会自动经过这些路径检查。读取权限不变。需要同时约束任意子进程时，应使用文件系统权限或隔离执行环境，并继续保留独立文件快照及最终 diff 检查。

确定性回归包含“受保护测试编辑被拒绝 → 新建独立回归文件 → 实际验证通过”的完整过程。不配置规则时，模型工具定义与能力提示原文不变；启用规则时增加简短的版本化能力说明。本次没有宣称真实 provider Token 收益。

[用户配置](CONFIGURATION.zh-CN.md) · [Claude Code 权限](https://code.claude.com/docs/en/permissions) · [Claude Code 执行前拦截](https://code.claude.com/docs/en/hooks-guide#block-edits-to-protected-files)
