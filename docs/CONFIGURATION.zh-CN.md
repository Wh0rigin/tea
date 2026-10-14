# 用户配置文件

[English](CONFIGURATION.md)

配置一次，之后在任意项目目录直接执行 `tea`：

```sh
tea config
tea
```

向导依次询问接口、模型、思考模式、思考等级和 API 密钥。密钥输入不回显、不进入 readline 历史；回车保留已有值，Ctrl+C 取消未完成配置。修改文件后，已启动的 TEA 需要重启才能加载。

## 路径与命令

文件位于 `~/.tea/config.json`，Windows 通常为 `%USERPROFILE%\.tea\config.json`，独立于项目仓库。凭据以明文保存；新建文件在 Unix 使用 0600 权限，Windows 继承用户目录文件权限。Agent 的普通目录发现和源码读取排除 `.tea`，这些限制不是操作系统沙箱。

```sh
tea config init   # 创建模板，已有文件不会覆盖
tea config show   # 查看配置，密钥隐藏
tea config path   # 查看绝对路径
```

也可直接编辑 JSON。此前 GLM 配置示例，密钥请换成自己的：

```json
{
  "apiKey": "<YOUR_API_KEY>",
  "baseUrl": "https://cf.api.fan",
  "model": "glm-5.3-flash",
  "thinkingMode": "enabled",
  "effort": "low"
}
```

日常 CLI 仍默认开启 ContextOS、自动压缩、GC，不设置费用上限，无需把这些默认值全部写进文件。

## 优先级与字段

优先级：**命令行选项 > 环境变量 > 用户配置文件 > 内置默认值**。环境中的 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 均覆盖文件密钥；显式设置为空也会覆盖。不自动读取项目级配置或 `.env` 文件。

字符串字段：`apiKey`、`baseUrl`、`model`、`apiVersion`、`thinkingMode`、`effort`、`memoryPolicy`、`historyStrategy`、`compaction`、`memoryGc`、`contextStrategy`。

数值字段：`maxOutputTokens`、`maxRequestInputBytes`、`maxToolCalls`、`timeoutMs`、`contextosTargetBytes`、`historyKeepRecent`、`initialFileLimit`、`compactionTriggerRatio`、`compactionKeepRecentBytes`、`inputPriceUsdPerMillion`、`outputPriceUsdPerMillion`。输入保护按 UTF-8 字节计算。`stream`、`capabilityFeedback` 为布尔值。

`maxCostUsd` 为正数，或 `null` 表示无费用上限。显式设置费用上限仍要求两个价格，恢复会话保留原较严格上限。

非法 JSON、未知字段或非法值会停止加载，错误不打印文件内容。写入使用独占锁、私有临时文件和原子替换；异常退出可能留下 `config.json.lock`，确认没有配置进程运行后，可删除该锁再重试。

## 实验与程序接口

真实基准和对比脚本继续使用显式环境配置及有限预算，不自动继承用户配置。`loadConfig()` 保持纯选项/环境加载；程序需要用户配置时，可调用 `resolveUserEnvironment()`，将结果传给 `loadConfig()`。
