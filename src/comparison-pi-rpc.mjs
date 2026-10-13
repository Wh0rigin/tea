import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { configurePiComparison, comparisonChildEnvironment } from './comparison-pi.mjs';
import { redactText } from './tools.mjs';

const execute = promisify(execFile);

/** Native Pi RPC: one process/conversation per run, no real provider key in child. */
export async function createPiComparisonSession({ piCli, workspace, agentDir, baseUrl, token, config, timeoutMs = 180000 }) {
  await configurePiComparison({ agentDir, baseUrl, token, config });
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const args = ['--offline', '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates',
    '--no-themes', '--no-approve', '--provider', 'comparison', '--model', config.model, '--thinking', config.effort,
    '--tools', `read,${shell},edit,write`];
  const child = spawn(process.execPath, [piCli, ...args], { cwd: workspace, env: { ...comparisonChildEnvironment(), PI_CODING_AGENT_DIR: agentDir },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(), digest = createHash('sha256');
  let buffer = '', stderr = '', sequence = 0, active = null, closed = false, fatal = null, closeResult = null;
  const exit = new Promise(resolve => child.once('close', resolve));
  const fail = error => {
    fatal = error;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    if (active) { clearTimeout(active.timer); active.reject(error); active = null; }
  };
  const kill = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32' && child.pid) await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill());
    else child.kill();
  };
  const consume = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { fail(new Error('Malformed native Pi JSONL')); void kill(); return; }
    if (event.type === 'response' && pending.has(event.id)) {
      const request = pending.get(event.id); pending.delete(event.id); clearTimeout(request.timer);
      if (event.success) request.resolve(event.data); else request.reject(new Error(redactText(event.error || 'Pi command rejected')));
    }
    if (!active) return;
    try { active.onEvent?.(event); } catch (error) { fail(error); void kill(); return; }
    if (event.type === 'tool_execution_start') active.toolCalls++;
    if (event.type === 'auto_compaction_start') active.compactions++;
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      active.lastStop = event.message.stopReason;
      active.errorMessage = event.message.errorMessage ? redactText(event.message.errorMessage).slice(0, 500) : null;
    }
    if (event.type === 'agent_settled') {
      const result = active; active = null; clearTimeout(result.timer);
      result.resolve({ status: result.lastStop === 'stop' && !result.errorMessage ? 'completed' : 'failed',
        lastStop: result.lastStop, errorMessage: result.errorMessage, toolCalls: result.toolCalls, compactions: result.compactions });
    }
  };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    digest.update(chunk); buffer += chunk;
    let n; while ((n = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, n).replace(/\r$/, '')); buffer = buffer.slice(n + 1); }
    if (buffer.length > 8_000_000) { fail(new Error('Native Pi JSONL record too large')); void kill(); }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
  child.once('error', error => fail(error)); child.stdin.on('error', error => fail(error));
  child.once('close', code => {
    if (buffer) consume(buffer); closed = true;
    if (active || pending.size) fail(new Error(`Native Pi exited before completion (${code}); ${redactText(stderr).slice(-500)}`));
  });
  const command = (type, fields = {}) => new Promise((resolve, reject) => {
    if (closed || fatal) { reject(fatal || new Error('Pi session closed')); return; }
    const id = `rpc-${++sequence}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Pi command timeout')); void kill(); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
  });
  try { await command('get_state'); } catch (error) { await kill(); await exit; throw error; }
  return {
    async prompt(message, { onEvent } = {}) {
      if (active || closed || fatal) throw fatal || new Error('Pi session unavailable or busy');
      let accepted;
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { fail(new Error('Native Pi turn timeout')); void kill(); }, timeoutMs);
        active = { resolve, reject, timer, onEvent, toolCalls: 0, compactions: 0, lastStop: null, errorMessage: null };
        accepted = command('prompt', { message });
      });
      try { const [, result] = await Promise.all([accepted, completed]); return result; }
      catch (error) { fail(error); await completed.catch(() => {}); await kill(); throw error; }
    },
    async close() {
      if (closeResult) return closeResult;
      if (active) { fail(new Error('Pi session closed during a turn')); await kill(); }
      if (!closed) child.stdin.end();
      const timer = setTimeout(() => { void kill(); }, 3000);
      await exit; clearTimeout(timer);
      closeResult = { stdoutSha256: digest.digest('hex'), stderr: redactText(stderr) };
      return closeResult;
    },
  };
}
