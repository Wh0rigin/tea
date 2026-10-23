# 单项实验：输出额度按剩余容量适配

本实验开关 `TEA_FIT_OUTPUT_BUDGET=1` 默认关闭，仅作用于 `TEA_CONTEXT_BUDGET_POLICY=reserved-output`。它保留旧策略的压缩触发点，放宽输入硬检查，并按窗口减安全预留减估算输入收缩本次输出额度。估算不是供应商精确 Token 保证。

## 与最新 main 的兼容

main 合并 Pi 预算策略后，CLI 默认使用 `pi`：不再全额预留最大输出，默认预留 16384 Token、近期保留约 20000 Token，输出额度已按剩余容量适配。此策略下本实验开关不改变 main 的预算、压缩、工具或输出行为。需要复现旧策略隔离实验时，必须同时显式设置 `TEA_CONTEXT_BUDGET_POLICY=reserved-output`。

原始离线适用性报告对应冻结源码 `a90fde8`，没有启动付费任务。与最新 main 合并后的版本未重新做付费收益评测，不能将历史报告归因于此组合，也未更改生产默认或自动合并 PR。
