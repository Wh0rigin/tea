/** Native Pi benchmark driver. No provider credential enters this process.
 * Environment supplies PI_BENCH_PACKAGE, PI_BENCH_WORKSPACE, PI_BENCH_LOGS,
 * PI_BENCH_INSTRUCTION and PI_BENCH_SOCKET. Native tools and prompts are retained.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const workspace = process.env.PI_BENCH_WORKSPACE;
const logs = process.env.PI_BENCH_LOGS || '/logs/agent';
const packageRoot = process.env.PI_BENCH_PACKAGE || '/opt/benchmark-pi';
const socketPath = process.env.PI_BENCH_SOCKET || '/tea-relay/api.sock';
if (!workspace || !process.env.PI_BENCH_INSTRUCTION) throw new Error('Missing explicit benchmark workspace/instruction');
await mkdir(logs, { recursive: true });
const agentDir = path.join(logs, 'pi-config');
await mkdir(agentDir, { recursive: true });
let submitted = 0, completedRequests = 0, toolCalls = 0, compactions = 0;
const requests = [], eventUsage = [];
let writing = Promise.resolve();
const record = (name, value) => { writing = writing.then(() => appendFile(path.join(logs, name), JSON.stringify(value) + '\n')); };

// A client-side SSE observer, independent from the server's transport observer.
class Audit {
  pending = ''; data = []; usage = {}; stop = false; invalid = false;
  decoder = new TextDecoder();
  dispatch() {
    if (!this.data.length) return;
    try {
      const event = JSON.parse(this.data.join('\n'));
      if (event.type === 'message_stop') this.stop = true;
      const usage = (event.type === 'message_start' ? event.message?.usage : event.usage) || {};
      for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
        if (key in usage) {
          if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) this.usage[key] = usage[key];
          else this.invalid = true;
        }
      }
    } catch { this.invalid = true; }
    this.data = [];
  }
  line(value) {
    const line = value.replace(/\r$/, '');
    if (!line) this.dispatch();
    else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
  }
  feed(chunk) {
    this.pending += this.decoder.decode(chunk, { stream: true });
    let end;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      this.line(this.pending.slice(0, end)); this.pending = this.pending.slice(end + 1);
    }
    if (this.pending.length > 2_097_152) { this.invalid = true; this.pending = ''; }
  }
  finish() {
    this.pending += this.decoder.decode();
    if (this.pending) this.line(this.pending);
    this.dispatch();
    return this.stop && !this.invalid && ['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(this.usage[k]));
  }
}

const server = http.createServer(async (request, response) => {
  const apiUrl = new URL(request.url, 'http://localhost');
  if (request.method !== 'POST' || apiUrl.pathname !== '/v1/messages' || !['', '?beta=true'].includes(apiUrl.search)) { response.writeHead(404).end(); return; }
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_097_152) { response.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks), call = ++submitted, audit = new Audit(), started = Date.now();
  let settled = false;
  const finish = (status, httpStatus = null, providerSubmitted = true) => {
    if (settled) return; settled = true;
    const row = { call, requestSha256: hash(data), requestBytes: data.length,
      status, httpStatus, providerSubmitted, usage: audit.usage,
      usageComplete: providerSubmitted ? audit.finish() : null, elapsedMs: Date.now() - started };
    // finish() may update usage on an unterminated final SSE line.
    row.usage = { ...audit.usage }; requests.push(row); completedRequests++;
    record('pi-requests.jsonl', row);
  };
  const upstream = http.request({ socketPath, path: request.url, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': data.length,
      ...(request.headers['anthropic-version'] ? { 'anthropic-version': request.headers['anthropic-version'] } : {}),
      ...(request.headers['anthropic-beta'] ? { 'anthropic-beta': request.headers['anthropic-beta'] } : {}) } }, incoming => {
    response.writeHead(incoming.statusCode, { 'content-type': incoming.headers['content-type'] || 'application/json' });
    incoming.on('data', chunk => { audit.feed(chunk); response.write(chunk); });
    incoming.on('end', () => { finish('transport_finished', incoming.statusCode, incoming.headers['x-benchmark-submitted'] !== 'false'); response.end(); });
    incoming.on('error', () => { finish('upstream_response_failed', incoming.statusCode); response.destroy(); });
  });
  upstream.setTimeout(900_000, () => upstream.destroy(new Error('Request deadline')));
  upstream.on('error', () => { finish('upstream_request_failed'); response.destroy(); });
  upstream.end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { comparison: {
  baseUrl: `http://127.0.0.1:${server.address().port}`, api: 'anthropic-messages', apiKey: 'relay-placeholder',
  models: [{ id: 'glm-5.3-flash', name: 'glm-5.3-flash', reasoning: true, input: ['text'],
    contextWindow: 216000, maxTokens: 131072, cost: { input: .8, output: 2.8, cacheRead: .8, cacheWrite: 1.6 } }],
} } }));
await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
  compaction: { enabled: true }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off',
}));

const args = [path.join(packageRoot, 'dist/bundle/cli.js'), '--offline', '--mode', 'rpc', '--no-session',
  '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-approve',
  '--provider', 'comparison', '--model', 'glm-5.3-flash', '--thinking', 'low', '--tools', 'read,bash,edit,write'];
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8',
  TMPDIR: process.env.TMPDIR || '/tmp', PI_OFFLINE: '1', PI_CODING_AGENT_DIR: agentDir };
const child = spawn(process.execPath, args, { cwd: workspace, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', stderr = '', lastStop = null, status = 'running', errorMessage = null, nativeSettled = false;
let finishTurn;
const turn = new Promise(resolve => { finishTurn = resolve; });
const kill = () => {
  if (child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
};
let promptSent = false;
const prompt = await readFile(process.env.PI_BENCH_INSTRUCTION, 'utf8');
const consume = line => {
  if (!line.trim()) return;
  let event;
  try { event = JSON.parse(line); }
  catch { status = 'failed'; errorMessage = 'Malformed native Pi JSONL'; kill(); finishTurn(); return; }
  record('pi-events.jsonl', event);
  if (event.type === 'response' && event.id === 'state') {
    if (!event.success) { status = 'failed'; errorMessage = 'Pi get_state rejected'; finishTurn(); return; }
    if (!promptSent) { promptSent = true; child.stdin.write(JSON.stringify({ id: 'task', type: 'prompt', message: prompt }) + '\n'); }
  }
  if (event.type === 'response' && event.id === 'task' && !event.success) {
    status = 'failed'; errorMessage = String(event.error).slice(0, 500); finishTurn();
  }
  if (event.type === 'tool_execution_start' && ++toolCalls > 4096) { status = 'tool_limit_reached'; kill(); finishTurn(); }
  if (event.type === 'auto_compaction_start') compactions++;
  if (event.type === 'message_end' && event.message?.role === 'assistant') {
    lastStop = event.message.stopReason; errorMessage = event.message.errorMessage || null;
    if (event.message.usage) eventUsage.push(event.message.usage);
  }
  if (event.type === 'agent_settled') { nativeSettled = true; finishTurn(); }
};
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk; let end;
  while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
  if (buffer.length > 8_000_000) { status = 'failed'; errorMessage = 'Native Pi JSONL record too large'; kill(); finishTurn(); }
});
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
child.on('error', error => { status = 'failed'; errorMessage = error.code || error.name; finishTurn(); });
child.stdin.on('error', () => { if (!nativeSettled) { status = 'failed'; errorMessage = 'Pi stdin closed'; finishTurn(); } });
child.on('exit', () => { if (!nativeSettled) { status = 'failed'; errorMessage ||= 'Pi exited before settling'; finishTurn(); } });
child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
const timer = setTimeout(() => { status = 'timeout'; errorMessage = 'Agent wall deadline'; kill(); finishTurn(); }, 1_800_000);
await turn; clearTimeout(timer);
if (status === 'running') status = nativeSettled && lastStop === 'stop' && !errorMessage ? 'completed' : 'failed';
child.stdin.end();
await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 1500))]);
kill();
const deadline = Date.now() + 30_000;
while (completedRequests < submitted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
const complete = submitted > 0 && completedRequests === submitted && requests.every(r => r.usageComplete || r.providerSubmitted === false);
const input = requests.reduce((sum, r) => sum + ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((s, k) => s + (r.usage[k] || 0), 0), 0);
const output = requests.reduce((sum, r) => sum + (r.usage.output_tokens || 0), 0);
record('pi-native-usage.jsonl', { assistantMessageUsage: eventUsage });
await writing;
await writeFile(path.join(logs, 'pi-result.json'), JSON.stringify({ status, lastStop, errorMessage, nativeSettled,
  toolCalls, compactions, stderr, providerUsageComplete: complete, requests: submitted,
  providerSubmittedRequests: requests.filter(r => r.providerSubmitted).length,
  inputTokensIncludingCache: complete ? input : null, outputTokens: complete ? output : null,
  totalTokens: complete ? input + output : null, reportedTokenLowerBound: input + output,
  missingUsageIsNotZero: true, nativeTools: ['read', 'bash', 'edit', 'write'] }, null, 2) + '\n');
console.log(JSON.stringify({ status, toolCalls, requests: submitted, providerUsageComplete: complete, totalTokens: complete ? input + output : null }));
