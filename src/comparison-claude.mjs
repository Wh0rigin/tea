import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { comparisonChildEnvironment } from './comparison-pi.mjs';

const execute = promisify(execFile);
/** Decode only complete contiguous numbered Read output; never fill missing source. */
export function decodeClaudeRead(text) {
  const lines = String(text).split('\n');
  const content = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*(\d+)(?:\t|→)([\s\S]*)$/);
    if (!match || Number(match[1]) !== i + 1) return null;
    content.push(match[2]);
  }
  return content.join('\n');
}
export function claudeToolArgs(block) {
  return { ...block.input, ...(typeof block.input?.file_path === 'string' ? { path: block.input.file_path } : {}) };
}
/** One native CLI process/conversation per task; stdout is parsed in memory, never published. */
export async function createClaudeComparisonSession({ claudeCli, workspace, agentDir, baseUrl, token, config, timeoutMs = 300000 }) {
  await mkdir(agentDir, { recursive: true });
  let gitBash = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (process.platform === 'win32' && !gitBash) {
    const found = await execute('where.exe', ['git'], { windowsHide: true });
    for (const file of found.stdout.trim().split(/\r?\n/)) {
      const candidate = path.resolve(path.dirname(file), '..', 'bin', 'bash.exe');
      if ((await stat(candidate).catch(() => null))?.isFile()) { gitBash = candidate; break; }
    }
    if (!gitBash) throw new Error('Claude comparison requires Git Bash on Windows');
  }
  const env = { ...comparisonChildEnvironment(), ANTHROPIC_API_KEY: token, ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: config.model, CLAUDE_CONFIG_DIR: agentDir, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens), MAX_THINKING_TOKENS: String(config.maxOutputTokens - 1),
    ...(gitBash ? { CLAUDE_CODE_GIT_BASH_PATH: gitBash } : {}) };
  const tools = 'Read,Edit,Write,Glob,Grep,Bash';
  const args = ['--safe-mode', '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--model', config.model, '--effort', config.effort, '--setting-sources', '',
    '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', tools, '--allowedTools', tools];
  const child = spawn(claudeCli, args, { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const digest = createHash('sha256');
  let buffer = '', stderrBytes = 0, active = null, closed = false, fatal = null, receipt = null, observedTools = null;
  const pending = new Map();
  const exit = new Promise(resolve => child.once('close', resolve));
  const fail = error => { fatal = error; if (active) { clearTimeout(active.timer); active.reject(error); active = null; } };
  const kill = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32' && child.pid) await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill());
    else child.kill();
  };
  const consume = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { fail(new Error('Malformed Claude Code JSONL')); void kill(); return; }
    if (event.type === 'system' && event.subtype === 'init') observedTools = event.tools;
    if (!active) return;
    try {
      if (event.type === 'system' && event.subtype === 'compact_boundary') active.compactions++;
      if (event.type === 'assistant') for (const block of event.message?.content || []) if (block.type === 'tool_use') {
        if (pending.has(block.id)) throw new Error('Duplicate Claude tool start');
        pending.set(block.id, block); active.toolCalls++;
        active.onEvent?.({ type: 'tool_execution_start', toolCallId: block.id, toolName: block.name.toLowerCase(), args: claudeToolArgs(block) });
      }
      if (event.type === 'user') for (const block of event.message?.content || []) if (block.type === 'tool_result') {
        const prior = pending.get(block.tool_use_id); if (!prior) throw new Error('Unmatched Claude tool result');
        pending.delete(block.tool_use_id);
        const native = typeof block.content === 'string' ? block.content : (block.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        const decoded = prior.name === 'Read' && !block.is_error ? decodeClaudeRead(native) : null;
        active.onEvent?.({ type: 'tool_execution_end', toolCallId: block.tool_use_id, isError: Boolean(block.is_error),
          result: { content: [{ type: 'text', text: decoded ?? native }], details: { nativeOutputSha256: createHash('sha256').update(native).digest('hex'),
            readNumberingDecoded: decoded !== null } } });
      }
      if (event.type === 'result') {
        if (pending.size) throw new Error('Claude turn ended with unfinished tools');
        const value = active; active = null; clearTimeout(value.timer);
        value.resolve({ status: event.subtype === 'success' && !event.is_error ? 'completed' : 'failed',
          errorMessage: event.is_error ? 'Native Claude Code result failed' : null, toolCalls: value.toolCalls, compactions: value.compactions });
      }
    } catch (error) { fail(error); void kill(); }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    digest.update(chunk); buffer += chunk;
    let n; while ((n = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, n).replace(/\r$/, '')); buffer = buffer.slice(n + 1); }
    if (buffer.length > 8_000_000) { fail(new Error('Claude JSONL record too large')); void kill(); }
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  child.on('error', error => fail(error)); child.stdin.on('error', error => fail(error));
  child.once('close', code => { if (buffer) consume(buffer); closed = true; if (active) fail(new Error(`Claude exited before completion (${code})`)); });
  return {
    prompt(message, { onEvent } = {}) {
      if (active || closed || fatal) throw fatal || new Error('Claude session unavailable');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { fail(new Error('Native Claude turn timeout')); void kill(); }, timeoutMs);
        active = { resolve, reject, timer, onEvent, toolCalls: 0, compactions: 0 };
        child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: message } }) + '\n');
      });
    },
    async close() {
      if (receipt) return receipt;
      if (active) { fail(new Error('Claude closed during turn')); await kill(); }
      if (!closed) child.stdin.end();
      const timer = setTimeout(() => { void kill(); }, 3000); await exit; clearTimeout(timer);
      receipt = { stdoutSha256: digest.digest('hex'), stderrBytes, observedTools, processClosed: true }; return receipt;
    },
  };
}
