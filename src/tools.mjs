import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

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
  /^git\s+(?:status(?:\s+--short)?|diff(?:\s+--check)?|log\s+-\d+(?:\s+--oneline)?)$/,
];
const BLOCKED_SHELL = /(?:\brm\b|\bdel\b|\berase\b|\brmdir\b|\bformat\b|\bmkfs\b|\bshutdown\b|\breg\s+(?:add|delete)\b|git\s+(?:reset|clean|push|restore|checkout\s+-f)|\bRemove-Item\b)/i;

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
  constructor({ workspace, ledger, maxCommandMs = MAX_SHELL_MS }) {
    this.workspace = path.resolve(workspace);
    this.ledger = ledger;
    this.maxCommandMs = maxCommandMs;
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

  async listFiles({ maxFiles = 250 } = {}) {
    const rows = [];
    const walk = async (directory, depth) => {
      if (depth > 12 || rows.length >= Math.min(maxFiles, MAX_FILES)) return;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (rows.length >= Math.min(maxFiles, MAX_FILES)) break;
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
    return rows.join('\n') || '(no text files found)';
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
    const source = await readFile(filename, 'utf8');
    const lines = source.split(/\r?\n/);
    const start = Math.max(1, Number(startLine) || 1);
    const end = Math.min(lines.length, Number(endLine) || lines.length);
    if (end < start) throw new Error('endLine must be greater than or equal to startLine');
    return truncate(redactText(lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n')));
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
    if (typeof command !== 'string' || !VALIDATION_COMMANDS.some((pattern) => pattern.test(command.trim()))) {
      throw new Error('Only the documented test, lint, typecheck, and read-only Git commands are allowed in run_tests');
    }
    if (process.platform === 'win32' && /[%!^()\"']/.test(command)) {
      throw new Error('CMD metacharacters are not allowed in Windows validation commands');
    }
    return this.#spawnCommand(command.trim(), 120_000);
  }

  async runShell({ command } = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command must be a non-empty string');
    const value = command.trim();
    if (BLOCKED_SHELL.test(value)) throw new Error('Destructive commands and Git history mutations are blocked');
    if (/[;&|<>`\n\r]/.test(value)) throw new Error('Shell operators and multiline commands are blocked');
    if (VALIDATION_COMMANDS.some((pattern) => pattern.test(value))) return this.#spawnCommand(value, this.maxCommandMs);
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
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!settled) { settled = true; reject(new Error(`Command timed out after ${timeoutMs} ms`)); }
      }, timeoutMs);
      for (const [stream, target] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          if (target === 'stdout') stdout += chunk;
          else stderr += chunk;
          if (stdout.length + stderr.length > MAX_TOOL_OUTPUT * 2) child.kill();
        });
      }
      child.once('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(truncate(`exit=${code ?? signal}\n${stdout}\n${stderr}`));
      });
    });
    return redactText(output);
  }
}

export const TOOL_DEFINITIONS = [
  { name: 'list_files', description: 'List text files in the workspace, excluding dependencies and generated folders.', input_schema: { type: 'object', properties: { maxFiles: { type: 'integer', minimum: 1, maximum: 250 } }, additionalProperties: false } },
  { name: 'search_code', description: 'Search for a literal string in text source files.', input_schema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 80 } }, required: ['query'], additionalProperties: false } },
  { name: 'read_file', description: 'Read a text file, optionally selecting a line range.', input_schema: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false } },
  { name: 'apply_patch', description: 'Replace one unique exact text span in a workspace file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'], additionalProperties: false } },
  { name: 'run_tests', description: 'Run an allowlisted test or read-only Git validation command.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } },
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
