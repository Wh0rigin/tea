import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { buildBaselineInventory, buildProgressiveInventory } from './context.mjs';
import { BoundedOutput } from './output.mjs';

const OMIT = new Set(['.git', '.tea', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next']);
const TEXT_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.json', '.md', '.mjs', '.py', '.rb', '.rs', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml']);
const MAX_READ_BYTES = 160_000;
const MAX_TOOL_OUTPUT = 14_000;
const MAX_FILES = 700;
const MAX_SHELL_MS = 120_000;
const SENSITIVE_FILE = /^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|auth\.json|service-account(?:\..*)?|private[_-]?key(?:\..*)?|id_(?:rsa|ed25519).*)$/i;
const SECRET_TEXT = /(?:\bsk-[A-Za-z0-9_-]{12,}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b)/g;
const SECRET_ASSIGNMENT = /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)["']?\s*[=:]\s*)(["']?)([^\s"'`,;}]+)/ig;
const VALIDATION_COMMANDS = [
  /^node\s+--test(?:\s+[^;&|<>`]+)?$/,
  /^npm\s+(?:test|run\s+(?:test|lint|check|typecheck))(?:\s+--\s+[^;&|<>`]+)?$/,
  /^python\s+-m\s+(?:pytest|unittest)(?:\s+[^;&|<>`]+)?$/,
  /^pytest(?:\s+[^;&|<>`]+)?$/,
];
const DIAGNOSTIC_COMMANDS = [/^git\s+(?:status(?:\s+--short)?|diff(?:\s+--check)?|log\s+-\d+(?:\s+--oneline)?)$/];
const NON_VALIDATING_FLAGS = /(?:^|\s)(?:-h|--help|--version|--list(?:-[a-z-]+)?|--collect-only|--collectonly|--co|--fixtures(?:-per-test)?|--inspect(?:-brk)?|--eval|--print)(?:=|\s|$)/i;
const BLOCKED_SHELL = /(?:\brm\b|\bdel\b|\berase\b|\brmdir\b|\bformat\b|\bmkfs\b|\bshutdown\b|\breg\s+(?:add|delete)\b|git\s+(?:reset|clean|push|restore|checkout\s+-f)|\bRemove-Item\b)/i;

function isAllowedCommand(command) {
  return typeof command === 'string' && !/[;&|<>`\n\r]/.test(command)
    && [...VALIDATION_COMMANDS, ...DIAGNOSTIC_COMMANDS].some((pattern) => pattern.test(command.trim()));
}

export function isValidationCommand(command) {
  return isAllowedCommand(command) && VALIDATION_COMMANDS.some((pattern) => pattern.test(command.trim()))
    && !NON_VALIDATING_FLAGS.test(command)
    && !(command.trim().split(/\s+/)[0] === 'node' && /(?:^|\s)(?:-v|-e|-p)(?:\s|$)/.test(command));
}

function assertWindowsCommand(command) {
  if (process.platform === 'win32' && /[%!^()\"']/.test(command)) {
    throw new Error('CMD metacharacters are not allowed in Windows validation commands');
  }
}

function truncate(text, max = MAX_TOOL_OUTPUT) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}\n… [truncated; ${value.length - max} chars omitted]` : value;
}

function redactText(text) {
  return String(text).replace(SECRET_TEXT, '[REDACTED]').replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]');
}

function isSensitivePath(relativePath) {
  return relativePath.split(/[\\/]/).some((part) => SENSITIVE_FILE.test(part)) || /\.(?:pem|key|p12|pfx)$/i.test(relativePath);
}

export class WorkspaceTools {
  constructor({ workspace, ledger, maxCommandMs = MAX_SHELL_MS, deduplicateReads = true }) {
    this.workspace = path.resolve(workspace);
    this.ledger = ledger;
    this.maxCommandMs = maxCommandMs;
    this.deduplicateReads = deduplicateReads;
    this.readEvidence = new Map();
  }

  async init() {
    const root = await realpath(this.workspace);
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Workspace is not a directory: ${root}`);
    this.workspace = root;
  }

  async resolveFile(relativePath, { mustExist = true } = {}) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('path must be a non-empty relative path');
    if (path.isAbsolute(relativePath)) throw new Error('Absolute paths are not allowed');
    const candidate = path.resolve(this.workspace, relativePath);
    const rel = path.relative(this.workspace, candidate);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Path escapes the workspace');
    if (mustExist) {
      const resolved = await realpath(candidate);
      const realRel = path.relative(this.workspace, resolved);
      if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) throw new Error('Symlink target escapes the workspace');
      return resolved;
    }
    return candidate;
  }

  async listFilePaths({ maxFiles = 250, offset = 0 } = {}) {
    const pageSize = Math.max(1, Math.min(MAX_FILES, Math.floor(Number(maxFiles) || 250)));
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const stop = Math.min(MAX_FILES, start + pageSize);
    const rows = [];
    const walk = async (directory, depth) => {
      if (depth > 12 || rows.length >= stop) return;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (rows.length >= stop) break;
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        if (OMIT.has(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) {
          if (isSensitivePath(path.relative(this.workspace, full))) continue;
          const extension = path.extname(entry.name).toLowerCase();
          if (TEXT_EXTENSIONS.has(extension) || !extension) rows.push(path.relative(this.workspace, full).replaceAll(path.sep, '/'));
        }
      }
    };
    await walk(this.workspace, 0);
    return rows.slice(start, stop);
  }

  async listFiles({ maxFiles = 250, offset = 0 } = {}) {
    const files = await this.listFilePaths({ maxFiles, offset });
    const listing = files.join('\n') || '(no text files found)';
    return Number(offset) > 0 ? `File listing from 0-based offset ${Math.floor(Number(offset))} (${files.length} paths returned):\n${listing}` : listing;
  }

  async initialInventory({ task, strategy = 'v1', limit = 8 } = {}) {
    const files = await this.listFilePaths({ maxFiles: MAX_FILES });
    return strategy === 'baseline' || strategy === 'v1-dedup'
      ? buildBaselineInventory(files, 160)
      : buildProgressiveInventory(task, files, {
        limit,
        queryExpansion: ['v1-inventory-expanded', 'v1-expanded'].includes(strategy)
          ? true
          : ['v1', 'v1-inventory-auto', 'v1-auto'].includes(strategy) ? 'auto' : false,
      });
  }

  async readFile({ path: relativePath, startLine = 1, endLine } = {}) {
    const filename = await this.resolveFile(relativePath);
    const normalizedPath = path.relative(this.workspace, filename);
    if (isSensitivePath(normalizedPath)) throw new Error('Reading credential and key files is blocked');
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_READ_BYTES) throw new Error(`File must be a regular text file smaller than ${MAX_READ_BYTES} bytes`);
    if (!TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase()) && path.basename(filename).includes('.')) {
      throw new Error('This file type is not in the text-reading allowlist');
    }
    const source = redactText(await readFile(filename, 'utf8'));
    const lines = source.split(/\r?\n/);
    const start = Math.max(1, Number(startLine) || 1);
    const end = Math.min(lines.length, Number(endLine) || lines.length);
    if (end < start) throw new Error('endLine must be greater than or equal to startLine');
    const relative = path.relative(this.workspace, filename).replaceAll(path.sep, '/');
    const rangeKey = `${relative}:${start}-${end}`;
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const evidenceRef = `${relative}#L${start}-L${end}@${sourceHash.slice(0, 16)}`;
    const fullEvidence = `[evidence ref=${evidenceRef} sha256=${sourceHash}]\n${lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n')}`;
    const complete = fullEvidence.length <= MAX_TOOL_OUTPUT;
    const partialHint = '\nOnly a prefix of the requested lines is shown. Use smaller startLine/endLine ranges to read omitted lines; this range is not cached as complete evidence.';
    const evidence = complete ? fullEvidence : `${truncate(fullEvidence, MAX_TOOL_OUTPUT - partialHint.length - 80)}${partialHint}`;
    if (this.deduplicateReads && complete && this.readEvidence.get(rangeKey) === sourceHash) {
      const reference = `Evidence unchanged; ref=${evidenceRef}. Original lines remain in history.`;
      return reference.length < evidence.length ? reference : evidence;
    }
    if (this.deduplicateReads) {
      if (complete) this.readEvidence.set(rangeKey, sourceHash);
      else this.readEvidence.delete(rangeKey);
    }
    return evidence;
  }

  async searchCode({ query, maxResults = 30 } = {}) {
    if (typeof query !== 'string' || !query) throw new Error('query must be a non-empty string');
    const needle = query.toLowerCase();
    const results = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    const walk = async (directory, depth) => {
      if (depth > 12 || results.length >= Math.min(Number(maxResults) || 30, 80) || filesScanned >= MAX_FILES || bytesScanned >= 25_000_000) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= Math.min(Number(maxResults) || 30, 80) || filesScanned >= MAX_FILES || bytesScanned >= 25_000_000) break;
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        if (OMIT.has(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
        if (isSensitivePath(path.relative(this.workspace, full))) continue;
        if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const info = await stat(full);
        if (info.size > MAX_READ_BYTES) continue;
        filesScanned += 1;
        bytesScanned += info.size;
        const lines = (await readFile(full, 'utf8')).split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].toLowerCase().includes(needle)) {
            results.push(redactText(`${path.relative(this.workspace, full).replaceAll(path.sep, '/')}:${index + 1}: ${lines[index].trim()}`));
            if (results.length >= Math.min(Number(maxResults) || 30, 80)) break;
          }
        }
      }
    };
    await walk(this.workspace, 0);
    return results.join('\n') || 'No matches.';
  }

  async applyPatch({ path: relativePath, search, replace } = {}) {
    if (typeof search !== 'string' || !search.length || typeof replace !== 'string') {
      throw new Error('apply_patch requires a non-empty search string and a replace string');
    }
    if (typeof relativePath === 'string' && (relativePath === '.git' || relativePath.startsWith('.git/') || relativePath === '.env' || relativePath.startsWith('.env.'))) {
      throw new Error('Patching Git metadata and environment files is blocked');
    }
    const filename = await this.resolveFile(relativePath);
    const fileStat = await lstat(filename);
    if (!fileStat.isFile() || fileStat.size > MAX_READ_BYTES) throw new Error('Patch target must be a regular file smaller than 160 KB');
    const normalizedPath = path.relative(this.workspace, filename).replaceAll(path.sep, '/');
    if (isSensitivePath(normalizedPath)) throw new Error('Patching credential and key files is blocked');
    if (normalizedPath === '.git' || normalizedPath.startsWith('.git/') || normalizedPath === '.env' || normalizedPath.startsWith('.env.')) {
      throw new Error('Patching Git metadata and environment files is blocked');
    }
    const source = await readFile(filename, 'utf8');
    const first = source.indexOf(search);
    if (first < 0) throw new Error('Patch search text was not found');
    if (source.indexOf(search, first + search.length) >= 0) throw new Error('Patch search text is ambiguous; include more surrounding lines');
    await writeFile(filename, source.slice(0, first) + replace + source.slice(first + search.length), 'utf8');
    return `Updated ${normalizedPath}`;
  }

  async runTests({ command } = {}) {
    if (!isAllowedCommand(command)) {
      throw new Error('Only the documented test, lint, typecheck, and read-only Git commands are allowed in run_tests');
    }
    assertWindowsCommand(command);
    return this.#spawnCommand(command.trim(), this.maxCommandMs);
  }

  async runShell({ command } = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command must be a non-empty string');
    const value = command.trim();
    if (BLOCKED_SHELL.test(value)) throw new Error('Destructive commands and Git history mutations are blocked');
    if (/[;&|<>`\n\r]/.test(value)) throw new Error('Shell operators and multiline commands are blocked');
    if (isAllowedCommand(value)) {
      assertWindowsCommand(value);
      return this.#spawnCommand(value, this.maxCommandMs);
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Unlisted shell commands require an interactive terminal for approval');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try { answer = await rl.question(`Allow this command in the workspace?\n  ${value}\nType yes to continue: `); }
    finally { rl.close(); }
    if (answer.trim().toLowerCase() !== 'yes') return 'Command denied by user.';
    return this.#spawnCommand(value, this.maxCommandMs);
  }

  async #spawnCommand(command, timeoutMs) {
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const executable = (parts.shift() || '').replace(/^"|"$/g, '');
    const args = parts.map((part) => part.replace(/^"|"$/g, ''));
    if (!executable) throw new Error('Command is empty');
    const safeEnv = { PATH: process.env.PATH || '', PATHEXT: process.env.PATHEXT || '', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', ComSpec: process.env.ComSpec || 'cmd.exe' };
    const output = await new Promise((resolve, reject) => {
      const npmCommand = process.platform === 'win32' && executable.toLowerCase() === 'npm';
      const child = spawn(npmCommand ? safeEnv.ComSpec : executable, npmCommand ? ['/d', '/s', '/c', ['npm', ...args].join(' ')] : args, {
        cwd: this.workspace,
        env: safeEnv,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = new BoundedOutput();
      const stderr = new BoundedOutput();
      let settled = false;
      let timedOut = false;
      let timeoutCleanup = Promise.resolve();
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32' && child.pid) {
          // Node's Windows kill only ends the parent; test workers can retain the workspace.
          timeoutCleanup = new Promise((done) => {
            const terminator = spawn(path.join(safeEnv.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
              env: safeEnv, shell: false, windowsHide: true, stdio: 'ignore',
            });
            terminator.once('error', () => { child.kill(); done(); });
            terminator.once('close', done);
          });
        } else child.kill();
      }, timeoutMs);
      for (const [stream, target] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          (target === 'stdout' ? stdout : stderr).append(chunk);
        });
      }
      child.once('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
      child.once('close', async (code, signal) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (timedOut) {
          await timeoutCleanup;
          reject(new Error(`Command timed out after ${timeoutMs} ms`));
          return;
        }
        const maxChars = code === 0 ? 2_000 : 6_500;
        const sanitized = redactText(`exit=${code ?? signal}\nstdout:\n${stdout.render({ maxChars })}\nstderr:\n${stderr.render({ maxChars })}`);
        // Redaction can expand short assignments, so bound the sanitized result too.
        const finalOutput = new BoundedOutput({ maxChars: MAX_TOOL_OUTPUT });
        finalOutput.append(sanitized);
        resolve(finalOutput.render());
      });
    });
    return output;
  }
}

export const TOOL_DEFINITIONS = [
  { name: 'list_files', description: 'List a page of text file paths in the workspace. Use offset to inspect later pages; dependencies and generated folders are omitted.', input_schema: { type: 'object', properties: { maxFiles: { type: 'integer', minimum: 1, maximum: 250 }, offset: { type: 'integer', minimum: 0, maximum: 700 } }, additionalProperties: false } },
  { name: 'search_code', description: 'Search for a literal string in text source files.', input_schema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 80 } }, required: ['query'], additionalProperties: false } },
  { name: 'read_file', description: 'Read a text file, optionally selecting a line range.', input_schema: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false } },
  { name: 'apply_patch', description: 'Replace one unique exact text span in a workspace file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'], additionalProperties: false } },
  { name: 'run_tests', description: 'Run an allowlisted test, lint, typecheck, or read-only Git diagnostic command. Only actual validation commands can satisfy the post-edit validation requirement. Long output retains the beginning and end; successful commands use a smaller output budget.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } },
  { name: 'run_shell', description: 'Run a bounded command in the workspace. Unlisted commands need explicit interactive approval; destructive commands are blocked.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } },
];

export async function dispatchTool(tools, name, input) {
  switch (name) {
    case 'list_files': return tools.listFiles(input);
    case 'search_code': return tools.searchCode(input);
    case 'read_file': return tools.readFile(input);
    case 'apply_patch': return tools.applyPatch(input);
    case 'run_tests': return tools.runTests(input);
    case 'run_shell': return tools.runShell(input);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
