# User configuration

[简体中文](CONFIGURATION.zh-CN.md)

Configure TEA once, then run `tea` in any project:

```sh
tea config
tea
```

The wizard asks for the Messages API base URL, model, thinking mode, effort and API key. Key input is hidden and is not added to readline history. Enter keeps an existing value. Ctrl+C cancels an unfinished setup. Restart an already running TEA conversation to reload file changes.

## Location and commands

The file is `~/.tea/config.json`; on Windows this is normally `%USERPROFILE%\.tea\config.json`. It lives outside the project repository. It contains plaintext credentials: newly created files use mode 0600 on Unix; Windows inherits the user directory's filesystem permissions. `.tea` directories are excluded from normal Agent discovery and source reading; TEA is not an OS sandbox.

```sh
tea config init   # create a template; an existing file is preserved
tea config show   # display settings with apiKey hidden
tea config path   # show its absolute path
```

You can also edit the JSON directly. For the GLM provider used in our experiments, replace the key placeholder with your own key:

```json
{
  "apiKey": "<YOUR_API_KEY>",
  "baseUrl": "https://cf.api.fan",
  "model": "glm-5.3-flash",
  "thinkingMode": "enabled",
  "effort": "low"
}
```

Daily CLI defaults are ContextOS, automatic compaction, memory GC, native file creation, capability feedback and no monetary cap. The Pi-style budget policy uses a conservative 32,768-token fallback window with a 16,384-token context reserve and a 4,096-token output ceiling fitted to remaining estimated capacity; set the window to your provider's documented capacity. The independent wire guard is 2 MiB and ContextOS target 32,000 bytes. See [Token budget configuration](CONTEXT_BUDGET.md).

## Precedence and options

`contextWindowTokens` and `contextReserveTokens` are positive integer settings. The window must exceed output plus safety reserve. `maxRequestInputBytes` remains a separate request-body protection setting; it does not represent model capacity.

CLI options override environment variables, which override file settings, which override built-in defaults. Either `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in the environment overrides the file key; explicitly empty credential variables also override it. No project-level config or `.env` file is automatically loaded.

Supported string fields: `apiKey`, `baseUrl`, `model`, `apiVersion`, `thinkingMode`, `effort`, `memoryPolicy`, `historyStrategy`, `compaction`, `memoryGc`, `contextStrategy`.

Supported numeric fields: `maxOutputTokens`, `maxRequestInputBytes`, `maxToolCalls`, `timeoutMs`, `contextosTargetBytes`, `historyKeepRecent`, `initialFileLimit`, `compactionTriggerRatio`, `compactionKeepRecentBytes`, `inputPriceUsdPerMillion`, `outputPriceUsdPerMillion`. The input-byte guard is measured in UTF-8 bytes, not provider tokens. `stream`, `capabilityFeedback` and `enableFileCreation` are booleans.

`maxCostUsd` accepts a positive number or `null` for no cap. An explicit monetary cap still requires both provider prices. Resume preserves the original stricter cap. For example:

```json
{
  "apiKey": "<YOUR_API_KEY>",
  "maxCostUsd": null,
  "memoryPolicy": "contextos",
  "compaction": "auto",
  "memoryGc": "auto"
}
```

Invalid JSON, unsupported fields and invalid values stop configuration loading without printing file contents. Writes use an exclusive lock, a private temporary file and atomic replacement. An interrupted writer can leave `config.json.lock`; after confirming no configuration process is active, remove that lock before retrying.

## Experiments and programmatic use

Live benchmark commands and comparison harnesses keep their explicit environment configuration and finite budget requirements; they do not automatically consume the personal config. `loadConfig()` remains a pure options/environment loader. Programmatic clients can explicitly call `resolveUserEnvironment()` and pass its result to `loadConfig()` to opt into user settings.

## Edit permissions

`editPermissions` accepts workspace-relative `deny`, `ask` and `allow` lists. Configure protected existing tests, approval-only files and optional write scopes in your user config or per-task options. See [Edit permissions and tool policy](EDIT_PERMISSIONS.md) for matching, SDK hooks and subprocess limitations.


## Pi-style budget fields

The config file accepts `contextBudgetPolicy` (`pi` or `reserved-output`), `compactionKeepRecentTokens` and `compactionReserveTokens`. Defaults and compatibility details: [context budget guide](CONTEXT_BUDGET.md). Omit `maxToolCalls` to use the uncapped daily default; an existing explicit numeric setting continues to apply. Environment variables override saved settings. This change does not rewrite your config file.

## Frozen PR16 profile / PR16 冻结配置

Set `configurationProfile` to `"pr16-quality"` (GLM default) or `"pi"`. `contextosWorkingSetBytes` and `compactionMaxPerTurn` can override the profile. Environment equivalents are `TEA_CONFIG_PROFILE`, `TEA_CONTEXTOS_WORKING_SET_BYTES` and `TEA_COMPACTION_MAX_PER_TURN`. Explicit options and environment settings retain precedence. See [full settings and limitations](PR16_QUALITY_PROFILE.md).

## Internal Network Failure retries / 内部网络错误重试

`internalNetworkRetries` / `TEA_INTERNAL_NETWORK_RETRIES`: integer 0–5, default **5**. This means one original submission plus up to five retries for an explicit `Internal Network Failure`. Backoff is 1, 2, 4, 8 and 16 seconds. Set 0 to disable. Cancel and explicit spending/input limits take precedence. See [retry behavior and accounting](NETWORK_RETRIES.md).
