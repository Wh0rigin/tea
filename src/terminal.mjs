import { createInterface, cursorTo, moveCursor, clearScreenDown } from 'node:readline';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { compactAgentSession, createAgentSession, resetConversation, runTask } from './agent.mjs';
import { sessionContext } from './compaction.mjs';
import { assertLiveConfig, hasProviderPrices } from './config.mjs';
import { redactText } from './tools.mjs';
import { attachSessionJournal, closeSessionJournal } from './session-memory.mjs';

const HELP = [
  '/help          Show commands',
  '/status        Show session usage, budget and outstanding validation',
  '/memory        Explain context references, freshness and retention',
  '/tools         List the last 100 tool records',
  '/tools N       Expand one tool result',
  '/diff          Show the current Git diff (up to 24,000 characters)',
  '/compact [hint] Summarize older conversation; optional retention instructions',
  '/new           Clear conversation and vocabulary; spending is retained',
  '/clear         Clear the terminal display; conversation is retained',
  '/cancel        Stop the current turn (also Esc or Ctrl+C)',
  '/exit          Exit (also Ctrl+D, or Ctrl+C while idle)',
  'End a line with \\ to compose a multi-line task. Arrow keys recall history.',
].join('\n');

// Provider output and filenames must never become terminal control sequences.
export function terminalText(value) {
  return redactText(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '');
}

const tokens = (value) => value === null || value === undefined ? '?' : value.toLocaleString('en-US');
const dollars = (value) => Number.isFinite(value) ? `$${value.toFixed(4)}` : '?';

export class TerminalView {
  constructor(output, config, { demo = false } = {}) {
    this.output = output;
    this.config = config;
    this.demo = demo;
    this.rich = Boolean(output.isTTY && process.env.TERM !== 'dumb');
    this.color = Boolean(output.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb');
    this.records = [];
    this.nextRecord = 1;
    this.baseUsage = { input: 0, output: 0, cached: 0, complete: true };
    this.usage = { ...this.baseUsage };
    this.spent = hasProviderPrices(config) ? 0 : null;
    this.costCap = config.maxCostUsd;
    this.mode = 'Ready';
    this.frame = 0;
    this.streaming = false;
    this.streamBuffer = '';
    this.multiline = false;
    this.editorAttached = false;
  }

  paint(text, code) { return this.color ? `\x1b[${code}m${text}\x1b[0m` : text; }

  clearEditor() {
    if (!this.rl || !this.editorAttached) return;
    if (!this.rich) { this.output.write('\n'); this.editorAttached = false; return; }
    const position = this.rl.getCursorPos();
    cursorTo(this.output, 0);
    if (position.rows) moveCursor(this.output, 0, -position.rows);
    clearScreenDown(this.output);
    this.editorAttached = false;
  }

  prompt() {
    if (!this.rl || this.closed || this.streaming) return;
    if (!this.rich) {
      if ((this.busy && !this.approval) || this.editorAttached) return;
      this.rl.setPrompt(this.approval ? 'allow yes/no > ' : this.multiline ? '... > ' : 'tea > ');
      this.rl.prompt(true);
      this.editorAttached = true;
      return;
    }
    const budget = this.demo ? 'DEMO · no API calls' : this.costCap == null ? `spent ${dollars(this.spent)} · no cost cap` : `budget ${dollars(this.spent)}/${dollars(this.costCap)}`;
    const knownUsage = this.usage.complete && !this.demo;
    const usage = `in ${tokens(knownUsage ? this.usage.input : null)} · out ${tokens(knownUsage ? this.usage.output : null)} · cache ${tokens(knownUsage ? this.usage.cached : null)}`;
    const mark = this.busy ? ['|', '/', '-', '\\'][this.frame++ % 4] : '>';
    const status = terminalText(`${mark} ${this.mode} · ${budget} · ${usage}`);
    const width = Math.max(12, (this.output.columns || 100) - 2);
    this.rl.setPrompt(`${this.paint(status.slice(0, width), '2')}\n${this.paint(this.approval ? 'allow yes/no > ' : this.multiline ? '... > ' : 'tea > ', '32')}`);
    // After writing scrollback, allocate the old editor height before readline
    // refreshes it. This prevents its previous wrapped prompt erasing a log.
    if (!this.editorAttached) this.output.write('\n'.repeat(this.rl.getCursorPos().rows));
    this.rl.prompt(true);
    this.editorAttached = true;
  }

  write(text, { raw = false } = {}) {
    this.clearEditor();
    this.output.write((raw ? text : terminalText(text)) + '\n');
    this.prompt();
  }

  banner() {
    if (this.config.contextWindowTokens) this.write(`Context window: ${tokens(this.config.contextWindowTokens)} tokens configured · automatic compaction uses local estimates · wire guard ${tokens(this.config.maxRequestInputBytes)} bytes\n`);
    this.write(this.paint('  ( )\n <___>  TEA\n        Token Efficient Agent', '32'), { raw: true });
    this.write(`Save tokens while preserving performance.\nModel: ${this.config.model}\nProfile: ${this.config.configurationProfile || 'custom'}\nWorkspace: ${this.config.workspace}\nContext: ${this.config.memoryPolicy} · compaction ${this.config.compaction} · GC ${this.config.memoryGc}\n${this.demo ? 'SCRIPTED DEMO: local read-only tools, no model or billing.' : this.costCap == null ? 'No monetary cap. /status shows Token usage and available cost estimates.' : 'Budget applies to the entire session, including after /new.'}\n/help for commands · Esc to stop · /tools to expand tool details\n`);
  }

  delta(text) {
    if (!this.streaming) {
      this.clearEditor();
      this.output.write(this.paint('\nTEA\n', '32'));
      this.streaming = true;
    }
    // Buffer complete lines so split credential strings are redacted together.
    this.streamBuffer += text;
    let newline;
    while ((newline = this.streamBuffer.indexOf('\n')) >= 0) {
      this.output.write(terminalText(this.streamBuffer.slice(0, newline + 1)));
      this.streamBuffer = this.streamBuffer.slice(newline + 1);
    }
  }

  endStream() {
    if (!this.streaming) return;
    this.output.write(terminalText(this.streamBuffer));
    this.streamBuffer = '';
    this.output.write('\n\n');
    this.streaming = false;
    this.prompt();
  }

  event(event) {
    if (event.type === 'compaction_start') { this.mode = 'Summarizing context · Esc to stop'; this.prompt(); }
    if (event.type === 'compaction_end') {
      this.mode = event.status === 'compacted' ? 'Context compacted' : 'Context compaction finished';
      this.write(event.status === 'compacted'
        ? `Context: ${event.coveredMessages} older messages summarized · request ${tokens(event.beforeBytes)} → ${tokens(event.afterBytes)} UTF-8 bytes${event.partial ? ' · partial prefix' : ''}`
        : `Context: ${event.status}${event.detail ? ` · ${event.detail}` : ''}`);
    }
    if (event.type === 'model_start') { this.mode = 'Thinking · Esc to stop'; this.prompt(); }
    if (event.type === 'model_end') this.endStream();
    if (event.type === 'usage') {
      this.usage = {
        input: this.baseUsage.input + event.totals.inputTokens,
        output: this.baseUsage.output + event.totals.outputTokens,
        cached: this.baseUsage.cached + event.totals.cachedInputTokens,
        complete: this.baseUsage.complete && event.usageComplete,
      };
      if (event.spentUsd === null || Number.isFinite(event.spentUsd)) this.spent = event.spentUsd;
      this.prompt();
    }
    if (event.type === 'tool_start') {
      this.mode = `Running ${event.name} · Esc to stop`;
      const detail = event.input?.path || event.input?.query || event.input?.command || '';
      this.write(this.paint(`  > ${terminalText(event.name)} ${terminalText(detail).slice(0, 120)}`, '2'), { raw: true });
    }
    if (event.type === 'tool_end') {
      const record = { id: this.nextRecord++, ...event, output: terminalText(event.output).slice(0, 14000) };
      this.records.push(record);
      if (this.records.length > 100) this.records.shift();
      const exit = /^exit=([^\n]+)/.exec(event.output);
      const failed = event.isError || (exit && exit[1] !== '0');
      const status = event.isError ? 'error' : exit ? `exit=${exit[1]}` : 'done';
      const timing = Number.isFinite(event.executionMs) ? `${(event.executionMs / 1000).toFixed(1)}s execute${event.approvalMs > 0 ? ` · ${(event.approvalMs / 1000).toFixed(1)}s approval` : ''}` : `${(event.elapsedMs / 1000).toFixed(1)}s`;
      this.write(this.paint(`  ${failed ? '!' : '+'} [${record.id}] ${event.name} · ${status} · ${timing} · /tools ${record.id}`, failed ? '31' : '2'), { raw: true });
      if (event.name === 'apply_patch' && !event.isError) {
        const lines = (text, prefix) => terminalText(text || '').split('\n').slice(0, 6).map(line => prefix + line.slice(0, 160)).join('\n');
        const edits = event.input?.edits || [event.input || {}];
        for (const edit of edits.slice(0, 3)) {
          this.write(this.paint(lines(edit.search, '- '), '31') + '\n' + this.paint(lines(edit.replace, '+ '), '32'), { raw: true });
        }
        if (edits.length > 3) this.write(`  ... ${edits.length - 3} more replacements; /tools ${record.id}`);
      }
      if (failed) this.write(record.output.slice(0, 800));
    }
    if (event.type === 'turn_end') {
      this.endStream();
      this.baseUsage = { ...this.usage, complete: this.usage.complete && (this.demo || event.summary.requests === 0 || event.summary.providerUsageComplete) };
      this.usage = { ...this.baseUsage };
      if (event.spentUsd === null || Number.isFinite(event.spentUsd)) this.spent = event.spentUsd;
      this.mode = event.status;
      this.write(`\nTurn: ${event.status}${event.pendingValidation ? ' · edits still require validation' : ''}\nLedger: ${event.runDirectory}`);
    }
  }

  showTools(id) {
    if (id !== undefined) {
      const record = this.records.find(item => item.id === Number(id));
      if (!record) { this.write('No retained tool record with that number.'); return; }
      this.write(`[${record.id}] ${record.name}\nArguments: ${JSON.stringify(record.input, null, 2)}\n${record.output}`);
      return;
    }
    this.write(this.records.map(item => `[${item.id}] ${item.name} · ${item.isError ? 'error' : 'result'} · ${item.elapsedMs}ms`).join('\n') || 'No tool calls yet.');
  }
}

// The demo uses the real agent loop and read-only workspace tools, never a provider.
export function demoAdapterFactory() {
  let serial = 0;
  return () => ({ complete: async ({ messages, signal, onTextDelta }) => {
    signal?.throwIfAborted();
    if (!Array.isArray(messages.at(-1)?.content)) {
      return { content: [{ type: 'tool_use', id: `demo-${++serial}`, name: 'list_files', input: { maxFiles: 4 } }], stop_reason: 'tool_use' };
    }
    const text = 'This is a scripted TEA demo. The tool above inspected your workspace without editing files.\nYou can continue the conversation, inspect /tools, view /diff, or start /new.\nLive mode uses the same interface with your configured provider; this demo does not solve coding tasks.';
    if (onTextDelta) for (const part of text.match(/.{1,28}/gs) || []) {
      await new Promise(resolve => setTimeout(resolve, 25));
      signal?.throwIfAborted();
      onTextDelta(part);
    }
    return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
  } });
}

export async function runInteractive(config, { demo = false, initialTask, input = process.stdin, output = process.stdout } = {}) {
  const view = new TerminalView(output, config, { demo });
  const session = createAgentSession(config);
  if (session.persistent) {
    await attachSessionJournal(session, config);
    await closeSessionJournal(session);
    if (session.restoredBudget) {
      view.spent = session.restoredBudget.costKnown === false || !hasProviderPrices(config) ? null : session.restoredBudget.spentUsd;
      view.costCap = session.restoredBudget.maxCostUsd;
    }
    // The budget is restored exactly; old output/cache totals are not inferred
    // from an input-only counter. Show '?' until a full accounting view exists.
    if (config.resume) { view.baseUsage.complete = false; view.usage.complete = false; }
    view.write('Persistent session: ' + session.sessionId);
  }
  const adapterFactory = demo ? demoAdapterFactory() : undefined;
  if (!input.isTTY || !output.isTTY) {
    if (!demo) throw new Error('Interactive mode requires a terminal. Use tea "task" for pipes, or --demo for an offline preview.');
    view.banner();
    await runTask(initialTask || 'Show the terminal demo', { ...config, runId: `${config.runId}-${randomUUID().slice(0, 8)}` }, {
      session, adapterFactory, onText: text => view.write(text), onDelta: text => view.delta(text), onEvent: event => view.event(event),
    });
    return;
  }

  // Keep cancellation keys active while suppressing input echo over streamed
  // model text. The next prompt restores any input still being composed.
  const editorOutput = new Writable({ write(chunk, encoding, callback) {
    if (!view.streaming) output.write(chunk, encoding);
    callback();
  } });
  Object.defineProperty(editorOutput, 'columns', { get: () => output.columns });
  const resize = () => editorOutput.emit('resize');
  output.on('resize', resize);
  const rl = createInterface({ input, output: editorOutput, terminal: true, historySize: 100, removeHistoryDuplicates: true, escapeCodeTimeout: 50 });
  view.rl = rl;
  let controller;
  let approval;
  let composed = [];
  let closed = false;
  let resolveExit;
  let finished = false;
  const done = new Promise(resolve => { resolveExit = resolve; });
  const tick = setInterval(() => { if (view.rich && view.busy && !view.streaming) view.prompt(); }, 150);

  const finish = () => {
    if (!closed || view.busy || finished) return;
    finished = true;
    clearInterval(tick);
    input.removeListener('keypress', keypress);
    output.removeListener('resize', resize);
    process.removeListener('SIGTERM', exit);
    process.removeListener('SIGINT', sigint);
    editorOutput.end();
    view.closed = true;
    output.write('\nTEA session closed.\n');
    resolveExit();
  };
  const cancel = () => {
    if (!view.busy) return;
    controller?.abort(new Error('Interrupted by user'));
    approval?.(false);
    approval = undefined;
    view.approval = false;
    view.mode = 'Stopping · edits are retained';
    view.prompt();
  };
  const exit = () => { closed = true; view.closed = true; cancel(); rl.close(); finish(); };
  const keypress = (_, key) => { if (key?.name === 'escape') cancel(); };
  const sigint = () => { if (view.busy) cancel(); else exit(); };
  input.on('keypress', keypress);
  rl.on('SIGINT', sigint);
  process.on('SIGINT', sigint);
  process.on('SIGTERM', exit);
  rl.on('close', () => { closed = true; view.closed = true; cancel(); finish(); });

  const approveCommand = (command) => new Promise(resolve => {
    if (controller?.signal.aborted || closed) { resolve(false); return; }
    view.approval = true;
    approval = (allowed) => { view.approval = false; resolve({ decision: allowed ? 'allow' : 'deny', source: 'user', reason: 'Command denied by user.' }); };
    view.write(`\nAllow this command in ${config.workspace}?\n${command}\nType yes to approve; anything else denies it.`);
  });

  const approveEdit = (event) => new Promise(resolve => {
    if (controller?.signal.aborted || closed) { resolve(false); return; }
    view.approval = true;
    approval = allowed => { view.approval = false; resolve(allowed); };
    const proposal=event.operation==='create'?event.change.content
      :(event.change.edits || [event.change]).map(edit=>`- ${edit.search}\n+ ${edit.replace}`).join('\n');
    const preview=terminalText(redactText(proposal));
    view.write(`\nAllow this ${event.operation} in ${config.workspace}?\n${event.path}${event.resolvedPath===event.path?'':` -> ${event.resolvedPath}`}\n${preview.slice(0,4000)}${preview.length>4000?'\n[Preview truncated]':''}\nType yes to approve once; anything else denies it.`);
  });

  const submit = async (line) => {
    const task = line.trim();
    if (approval) { const answer = approval; approval = undefined; answer(task.toLowerCase() === 'yes'); view.prompt(); return; }
    if (['/exit', '/quit'].includes(task)) { exit(); return; }
    if (task === '/cancel') { cancel(); return; }
    if (view.busy) { view.write('A turn is running. Press Esc or enter /cancel before sending another task.'); return; }
    if (!task) { view.prompt(); return; }
    if (task.startsWith('/') && !composed.length) {
      if (task === '/help') view.write(HELP);
      else if (task === '/status') view.write(`Model: ${config.model}\nWorkspace: ${config.workspace}\nProvider input: ${tokens(view.usage.complete && !demo ? view.usage.input : null)}\nProvider output: ${tokens(view.usage.complete && !demo ? view.usage.output : null)}\nCached input (part of input): ${tokens(view.usage.complete && !demo ? view.usage.cached : null)}\nConservative accounted spend: ${dollars(view.spent)}\nRemaining budget: ${view.costCap == null ? 'unlimited' : view.spent === null ? 'unknown' : dollars(Math.max(0, view.costCap - view.spent))}\nProfile: ${config.configurationProfile || 'custom'}\nProfile overrides: ${(config.configurationProfileOverrides || []).join(', ') || 'none'}\nSource working set: ${config.contextosWorkingSetBytes} bytes\nBudget policy: ${config.contextBudgetPolicy}\nMemory policy: ${config.memoryPolicy}\nOutstanding validation: ${session.pendingValidation ? session.changedFiles.join(', ') || 'workspace checks' : 'none'}\nUnavailable checks (still unverified): ${redactText(JSON.stringify((session.validationUnavailable || []).map(({ command, alternativeCommand }) => ({ command, ...(alternativeCommand ? { alternativeCommand } : {}) }))))}\nResident history messages: ${session.messages.length}\nArchived history messages: ${session.archivedMessageCount || 0}\nActive context messages: ${sessionContext(session).length}\nConversation compactions: ${session.compactionCount}\nAuto compaction: ${config.compaction}\nSession mappings: ${session.tools?.sessionTerms.size || 0}`);
      else if (/^\/tools(?:\s+\d+)?$/.test(task)) view.showTools(task.split(/\s+/)[1]);
      else if (task === '/new') { await resetConversation(session, config); composed = []; view.multiline = false; view.mode = 'Ready'; view.write('New conversation. Spending and outstanding edits are retained.'); }
      else if (task === '/memory') view.write(JSON.stringify({ sessionId: session.persistent ? session.sessionId : null,
        policy: config.memoryPolicy, diagnostics: session.memoryDiagnostics, pendingValidation: session.pendingValidation }, null, 2));
      else if (task === '/clear') { if (view.rich) output.write('\x1b[2J\x1b[H'); else output.write('\n'); view.editorAttached = false; view.banner(); }
      else if (/^\/compact(?:\s|$)/.test(task)) {
        if (demo) { view.write('Conversation summaries require a live model. The demo makes no provider requests.'); return; }
        try { assertLiveConfig(config); }
        catch (error) { view.write(`Setup required: ${error.message}`); return; }
        view.baseUsage = { ...view.usage };
        view.busy = true;
        controller = new AbortController();
        view.mode = 'Preparing conversation summary';
        view.prompt();
        try {
          await compactAgentSession({ ...config, runId: `${config.runId}-${randomUUID().slice(0, 8)}` }, {
            session, instructions: task.slice('/compact'.length).trim(), signal: controller.signal,
            onText: text => view.write(text), onEvent: event => view.event(event),
          });
        } catch (error) { view.write(`Compaction error: ${error.message}`); view.mode = 'Failed'; }
        finally { controller = undefined; view.busy = false; if (closed) finish(); else view.prompt(); }
      }
      else if (task === '/diff') {
        view.busy = true;
        controller = new AbortController();
        view.mode = 'Reading Git diff';
        view.prompt();
        try {
          const { stdout } = await promisify(execFile)('git', ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--color=never', 'HEAD', '--'], { cwd: config.workspace, windowsHide: true, timeout: 10000, maxBuffer: 2_000_000, signal: controller.signal });
          view.write(stdout ? stdout.slice(0, 24000) + (stdout.length > 24000 ? '\n[Diff preview truncated]' : '') : 'No tracked-file changes relative to HEAD. Untracked files are not included.');
        } catch (error) { view.write(`Could not read Git diff: ${error.message}`); }
        finally { controller = undefined; view.busy = false; view.mode = 'Ready'; if (closed) finish(); else view.prompt(); }
      } else view.write('Unknown command. Enter /help.');
      return;
    }
    if (task.endsWith('\\')) { composed.push(line.slice(0, line.lastIndexOf('\\'))); view.multiline = true; view.prompt(); return; }
    const prompt = [...composed, line].join('\n');
    composed = [];
    view.multiline = false;
    try { if (!demo) assertLiveConfig(config); }
    catch (error) { view.write(`Setup required: ${error.message}`); return; }
    view.baseUsage = { ...view.usage };
    view.busy = true;
    controller = new AbortController();
    view.mode = 'Discovering workspace · Esc to stop';
    view.prompt();
    try {
      await runTask(prompt, { ...config, runId: `${config.runId}-${randomUUID().slice(0, 8)}` }, {
        session, signal: controller.signal, adapterFactory, approveCommand, approveEdit,
        onText: text => view.write(`\nTEA\n${text}\n`), onDelta: text => view.delta(text), onEvent: event => view.event(event),
      });
    } catch (error) { view.endStream(); view.write(`Turn error: ${error.message}`); view.mode = 'Failed'; }
    finally { controller = undefined; approval = undefined; view.approval = false; view.busy = false; if (closed) finish(); else view.prompt(); }
  };
  // Do not add shell approval answers to readline's in-memory task history.
  rl.on('history', history => { if (view.approval) history.splice(0, 1); });
  rl.on('line', line => { view.editorAttached = false; void submit(line).catch(error => { view.write(error.message); exit(); }); });
  view.rl = undefined;
  view.banner();
  view.rl = rl;
  if (initialTask) void submit(initialTask);
  else view.prompt();
  await done;
}
