import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { redactText } from './tools.mjs';

const exec = promisify(execFile);

export function comparisonChildEnvironment() {
  const env = {};
  for (const name of ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'ProgramFiles', 'ProgramFiles(x86)']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.PI_OFFLINE = '1';
  return env;
}

export async function configurePiComparison({ agentDir, baseUrl, token, config }) {
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { comparison: {
    baseUrl, api: 'anthropic-messages', apiKey: token, models: [{
      id: config.model, name: config.model, reasoning: true, input: ['text'], contextWindow: config.contextWindowTokens ?? 200000,
      maxTokens: config.maxOutputTokens, cost: { input: config.inputRateUsdPerMillion, output: config.outputRateUsdPerMillion,
        cacheRead: config.inputRateUsdPerMillion, cacheWrite: config.cacheCreationRateUsdPerMillion ?? config.inputRateUsdPerMillion * 2 },
    }],
  } } }, null, 2));
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
    compaction: { enabled: config.piAutoCompaction ?? false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off',
  }));
}

/** Run the installed native Pi CLI with a fresh configuration and no real API key. */
export async function runPiTask({ piCli, workspace, agentDir, baseUrl, token, config, prompt, timeoutMs }) {
  await configurePiComparison({ agentDir, baseUrl, token, config });
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const args = ['--offline', '--mode', 'json', '--print', '--no-session', '--no-extensions', '--no-skills',
    '--no-prompt-templates', '--no-themes', '--no-approve', '--provider', 'comparison', '--model', config.model,
    '--thinking', config.effort, '--tools', `read,${shell},edit,write`, '--', prompt];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [piCli, ...args], { cwd: workspace,
      env: { ...comparisonChildEnvironment(), PI_CODING_AGENT_DIR: agentDir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', toolCalls = 0, parseErrors = 0, settled = false, timedOut = false, lastStop = null, errorMessage = null;
    const digest = createHash('sha256');
    const consume = line => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === 'tool_execution_start') toolCalls++;
        if (event.type === 'agent_settled') settled = true;
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          lastStop = event.message.stopReason;
          if (event.message.errorMessage) errorMessage = redactText(event.message.errorMessage).slice(0,1000);
        }
      } catch { parseErrors++; }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      digest.update(chunk); buffer += chunk;
      let newline;
      // JSON can contain U+2028/U+2029; only LF separates protocol records.
      while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline).replace(/\r$/, '')); buffer = buffer.slice(newline + 1); }
      if (buffer.length > 8_000_000) { parseErrors++; buffer = ''; child.kill(); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    let cleanup = Promise.resolve();
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) cleanup = exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill());
      else child.kill();
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', async code => {
      clearTimeout(timer); await cleanup; if (buffer) consume(buffer);
      resolve({ status: timedOut ? 'timeout' : code === 0 && settled && parseErrors === 0 && lastStop === 'stop' ? 'completed' : 'failed',
        exitCode: code, toolCalls, parseErrors, settled, lastStop, errorMessage, stdoutSha256: digest.digest('hex'), stderr: redactText(stderr) });
    });
  });
}
