# CLI file creation and compaction repair

## Observed failure

An empty-workspace task could not create a file with the editing-only `apply_patch` tool. The model tried Bash syntax and Windows built-ins through a direct executable runner, then hit the old 12,000-byte request guard. Two rejected summaries consumed 3,978 of the run's 20,592 provider tokens without reducing its next request. These are diagnostic measurements from one failed run, not an improvement benchmark.

## Changes

- `write_file` creates UTF-8 files and missing parent directories without overwriting any existing file. Workspace escapes, symlink parents, credentials, Git metadata, agent storage, invalid Unicode, NUL and files above 160 KB are refused. Successful creation marks edits as requiring actual validation.
- CLI capability feedback explicitly explains native creation and direct executable commands. Missing executables return actionable feedback. The runner continues to require approval for unlisted commands.
- Daily CLI defaults: 160,000 serialized request bytes, 4,096 output tokens, ContextOS target 32,000 bytes. The SDK keeps its previous request/output defaults. Explicit configuration still wins; remove or update an old 12,000-byte override if needed. The historical environment variable `TEA_MAX_REQUEST_INPUT_TOKENS` measures bytes.
- Automatic summary preflight skips a candidate whose minimal checkpoint preview does not shrink the projected request. ContextOS selection is nonmonotonic, so this is a conservative policy rather than a proof that all possible summaries are unhelpful.
- A nonreducing summary stops further automatic summary attempts in the same turn. Later turns require growth of at least the larger of 4,096 bytes and 25% in either request or resident history before retrying. This state persists; successful compaction and conversation reset clear it. Explicit `/compact` remains available. Actual post-summary size checks still protect adoption.
- Command records distinguish approval wait and execution time. Python child processes use UTF-8 output on Windows.

## Configuration

`enableFileCreation` is a boolean in `~/.tea/config.json` (environment: `TEA_ENABLE_FILE_CREATION`). Creation and capability feedback are enabled by default in the daily CLI. Existing per-session budget and validation obligations remain authoritative.

## Verification scope

Deterministic model responses drive an empty-workspace create/test loop, while Node executes the generated tests. Python unittest also runs where Python is installed. Dedicated checks cover overwrite refusal, unsafe paths, invalid content, unavailable executables, separate approval timing, preflight avoidance and nonreducing-summary backoff. The complete existing suite also runs. These tests establish runtime behavior; they do not measure new provider Token savings or guarantee arbitrary task success.

Restart an already running `tea` process to load this repair. A global installation linked with `npm link` loads the updated checkout automatically.
