# Edit permissions and tool policy

[简体中文](EDIT_PERMISSIONS.zh-CN.md)

TEA can enforce configured edit paths before its `apply_patch` and `write_file` tools change a file. The design follows Claude Code's separation of instructions, permission rules, and pre-tool decisions. It is not a drop-in implementation of Claude's settings syntax.

## Configure protected paths

Merge this field into your existing `~/.tea/config.json`; preserve your model and credential settings:

```json
{
  "editPermissions": {
    "deny": ["tests/public.test.mjs"],
    "ask": ["package.json"],
    "allow": []
  }
}
```

Restart TEA to load file changes. User configuration applies to every workspace; patterns are relative to each workspace. No project configuration is automatically trusted or loaded. For task-specific rules use `loadConfig({editPermissions: ...}, env)` / `loadCliConfig(...)`, or the `TEA_EDIT_PERMISSIONS` environment variable containing a JSON object. Option values override environment values; environment values override user-file values.

- `deny`: reject the edit before writing. An approval callback cannot override it.
- `ask`: request approval for this one operation. Interactive `tea` shows the target and a redacted, control-character-cleaned proposal preview (up to 4,000 characters). `yes` approves once; other answers deny. Esc cancels. SDK approval receives the complete proposed content or search/replace strings.
- `allow`: if nonempty, other targets are denied unless an `ask` rule requires and receives approval. An empty allow list adds no allowlist restriction.
- Precedence is **deny → ask → allow → default**. No configured rules preserves existing edit behavior.

Paths use `/`; Windows `\` separators in patterns are normalized. `*` and `?` match within a path segment, and a whole `**` segment matches zero or more segments. A trailing `/` means descendants. Patterns are anchored at the workspace root; `tests/*` does not match `tests/deep/a.mjs`, while `tests/**` does. Other characters are literal; negation, brace expansion and regular expressions are not supported. Matching is case-insensitive on Windows. Each list accepts up to 32 patterns of at most 160 characters. Invalid configuration stops loading.

Both the requested path and its resolved canonical target are checked. A deny match on either rejects the edit; an allowlist must cover both. Built-in workspace, credential, metadata, creation-parent and exact-patch checks remain authoritative. Approval is not cached; cancellation, changed policy, or a redirected target invalidates a pending operation.

**Tests are not universally read-only.** Existing tests may legitimately need edits in normal projects. Explicitly protect the files required by a task rather than denying all test files by default. Natural-language rules in AGENTS.md are not automatically converted into executable permissions.

## SDK approval and pre-tool decisions

```js
await runTask(task, config, {
  approveEdit: async ({ path, operation, change }) => {
    // Display the full proposal to your application's user.
    return await askUser({ path, operation, change }); // literal true approves once
  },
  beforeToolUse: async ({ name, input }, context) => {
    if (name === 'write_file' && taskIsReadOnly) {
      return { decision: 'deny', reason: 'This task permits reading only.' };
    }
    // undefined or {decision:'allow'} continues to normal backend checks.
  }
});
```

`approveEdit` receives `{path, resolvedPath, operation, rule, change}`. `change` is an immutable `{content}` for creation or `{search, replace}` for a patch. Without an approval handler, an `ask` edit fails closed in headless/programmatic runs; use interactive `tea` or supply a handler. An approval does not grant shell execution or override built-in restrictions.

`beforeToolUse` runs at the ToolService entry before execution, including read, write, validation and history tools. It can return `undefined`, `{decision:'allow'}`, or `{decision:'deny', reason}`. Invalid results and exceptions block execution. It is a trusted host callback, supplied by the application, not an executable script automatically loaded from a project. It should observe `context.signal` if it waits on external work. Direct backend methods still enforce edit paths but do not invoke a ToolService hook. Core integrations can use `new ToolService({context, specs, beforeExecute})` with the same `(event, context)` callback order.

Configured edit decisions and approval results are recorded as ledger metadata, without patch contents. Errors use `EDIT_PERMISSION_DENIED`, `EDIT_APPROVAL_UNAVAILABLE`, `EDIT_APPROVAL_DENIED`, or `TOOL_POLICY_DENIED`, with next actions that preserve protected files.

## Boundary and verification

This is **tool-level edit control, not an OS filesystem sandbox**. Code inside a test runner, npm script, approved shell executable, extension, or host callback does not automatically pass through these path checks. Read access is unchanged. Use filesystem permissions or an isolated execution environment when arbitrary subprocess writes must also be prevented. File snapshots and final diffs remain useful independent checks.

The deterministic regression covers protected-file denial followed by creating a separate regression test and actual validation. No live provider-token reduction is claimed. With no edit rules configured, model tool definitions and capability text remain unchanged; configured rules add a short versioned capability notice.

[Configuration](CONFIGURATION.md) · [Claude Code permissions](https://code.claude.com/docs/en/permissions) · [Claude Code pre-tool hooks](https://code.claude.com/docs/en/hooks-guide#block-edits-to-protected-files)
