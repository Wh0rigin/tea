# TEA terminal

TEA supports an interactive conversation and the original single-task command.
The interface uses Node.js readline and ANSI terminal output with no additional
runtime packages. Windows Terminal, PowerShell, and standard Unix terminals can
run it. `NO_COLOR=1` disables colors; `TERM=dumb` uses a plain prompt without the refreshing status bar.

## Start

```sh
npm run tea -- --interactive --workspace ../my-project --max-cost-usd 0.10
npm run tea -- --interactive "Investigate the pagination bug" --max-cost-usd 0.10
npm run tea -- --demo
```

Live tasks require the same provider configuration as single-task mode. The
interface can open before credentials are configured and explains missing
configuration when a task is submitted. After `npm link`, use `tea` directly.
With no arguments in a terminal, `tea` opens interactive mode. Outside a terminal,
no arguments show help. An explicit quoted task retains single-task behavior.

`--demo` runs scripted responses with real read-only workspace tools. It never
contacts a provider or applies a patch. In a noninteractive output stream, it
prints one demonstration and exits.

## Display

- Header: TEA, Token Efficient Agent, model and workspace.
- Conversation: provider answer lines as they arrive; complete lines are buffered
  for redaction. Thinking and signature blocks remain in model history and are
  not printed as reasoning.
- Tools: start/end, elapsed time, execution errors or command exit status, and a
  numbered result reference. Patch previews show the first six removed/added
  lines; use `/diff` for more context.
- Prompt: state, accounted spend, session cap, input/output tokens and cached
  input. Cached input is already part of total input. Unknown counts show `?`.

No claimed token-savings percentage is inferred from the display. The ledger is
the measurement record. Cost display uses the adapter's conservative accounting,
including retained reservations, and is not a provider invoice.

## Commands and input

- `/help`: show commands.
- `/status`: usage, remaining cost budget, outstanding validation, original and
  active context sizes, conversation compaction count and learned query count.
- `/tools`: list up to 100 recent tool records. `/tools N` expands one result.
- `/diff`: current tracked-file changes relative to HEAD, with external diff
  drivers disabled. The preview is bounded to 24,000 characters; untracked files
  are not included.
- `/compact [instructions]`: summarize older conversation, optionally naming
  requirements or unresolved work to preserve. Summary usage shares the session budget.
- `/new`: clear conversation, source references and learned mappings. Keep
  spending, cumulative input reservations and outstanding validation.
- `/clear`: clear the display; keep the conversation.
- `/cancel`, Esc, or Ctrl+C during a turn: interrupt.
- `/exit`, Ctrl+D, or Ctrl+C while idle: close the session.

Arrow keys recall in-memory input history. A trailing backslash continues a task
on another line. Only one task runs at a time. Stop a turn before submitting the
next task. Unlisted shell commands request `yes` approval through the same input
prompt; Esc denies the prompt and cancels the turn.

## Session and interruption

Follow-up tasks reuse the adapter, message history, workspace tools and learned
vocabulary. Each turn has its own ledger under `.tea/runs/`. Adapter cost and
cumulative input limits cover the entire terminal session, including after
`/new`. The tool-call limit applies separately to each turn.

Cancellation aborts a provider request and stops an active command. Windows
command cancellation terminates the spawned process tree. Completed file edits
are retained; cancellation does not roll them back. Remaining tool calls receive
explicit skipped results so the next turn has paired tool-use/result history.
An interrupted request can have unknown usage and retain its cost reservation.

Model context can eventually exceed the configured input limit. `/new` releases
the conversation context; it does not replenish spending. Optional
`--history-strategy compact-tools` retains the existing recovery rules.
`--compaction auto` enables a bounded summary attempt before large coding requests;
`/compact` remains available with automatic compaction off. See
[Conversation compaction](COMPACTION.md) for the byte trigger, retained boundaries,
request accounting, failure handling and limits.

Conversation and expanded tool records remain in process memory. There is no
disk-based session resume yet. Normal ledger storage remains hashes and counts
unless raw storage is enabled explicitly. The interface is not an OS sandbox.
