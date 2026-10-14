import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, open, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { buildBaselineInventory, buildProgressiveInventory } from './context.mjs';
import { BoundedOutput } from './output.mjs';
import { ToolFeedbackError } from './tool-feedback.mjs';

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
    throw new ToolFeedbackError('CAPABILITY_DENIED', 'CMD metacharacters are not allowed in Windows validation commands');
  }
}

function truncate(text, max = MAX_TOOL_OUTPUT) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}\n… [truncated; ${value.length - max} chars omitted]` : value;
}

export function redactText(text) {
  return String(text).replace(SECRET_TEXT, '[REDACTED]').replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]');
}

export function isSensitivePath(relativePath) {
  return relativePath.split(/[\\/]/).some((part) => SENSITIVE_FILE.test(part)) || /\.(?:pem|key|p12|pfx)$/i.test(relativePath);
}

// Inspect bytes rather than requiring a language-specific filename suffix.
export function decodeText(buffer) {
  if (buffer.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return null; }
}

export class WorkspaceTools {
  constructor({ workspace, ledger, maxCommandMs = MAX_SHELL_MS, deduplicateReads = true, enableFileCreation = true, editGuidance = false }) {
    this.workspace = path.resolve(workspace);
    this.ledger = ledger;
    this.maxCommandMs = maxCommandMs;
    this.deduplicateReads = deduplicateReads;
    this.enableFileCreation = enableFileCreation;
    this.editGuidance = editGuidance;
    this.readEvidence = new Map();
    // Vocabulary belongs to this run only; never modify the shared hand-written table.
    this.sessionTerms = new Map();
    this.unresolvedQueries = new Set();
    this.presentedSource = new Map();
    this.searchEvidence = new Map();
    this.sourceEvidence = new Map();
  }

  async init() {
    const root = await realpath(this.workspace);
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Workspace is not a directory: ${root}`);
    this.workspace = root;
  }

  async resolveFile(relativePath, { mustExist = true } = {}) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) throw new ToolFeedbackError('INPUT_INVALID', 'path must be a non-empty relative path');
    if (path.isAbsolute(relativePath)) throw new ToolFeedbackError('INPUT_INVALID', 'Absolute paths are not allowed');
    const candidate = path.resolve(this.workspace, relativePath);
    const rel = path.relative(this.workspace, candidate);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Path escapes the workspace');
    if (mustExist) {
      const resolved = await realpath(candidate);
      const realRel = path.relative(this.workspace, resolved);
      if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Symlink target escapes the workspace');
      return resolved;
    }
    return candidate;
  }

  // Rotate directories and visit child directories before their sibling files.
  // A single large directory cannot consume the whole discovery budget.
  async *#walkFiles(scope, includeOmitted) {
    const root = await this.resolveFile(scope);
    if (!(await stat(root)).isDirectory() || isSensitivePath(path.relative(this.workspace, root))
      || path.relative(this.workspace, root).split(path.sep).some(part => ['.git', '.tea'].includes(part))) {
      throw new ToolFeedbackError('INPUT_INVALID', 'Listing/search scope must be a non-sensitive workspace directory');
    }
    const frame = async (directory, depth) => ({ directory, depth, index: 0,
      entries: (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)) });
    const queue = [await frame(root, 0)]; let head = 0;
    while (head < queue.length) {
      this.signal?.throwIfAborted();
      const current = queue[head]; queue[head++] = null;
      const entry = current.entries[current.index++];
      if (!entry) continue;
      const full = path.join(current.directory, entry.name), relative = path.relative(this.workspace, full);
      if (!entry.isSymbolicLink() && !isSensitivePath(relative)
        && !['.git', '.tea'].includes(entry.name)
        && (includeOmitted || ((!entry.name.startsWith('.') || entry.name === '.github') && !OMIT.has(entry.name)))) {
        if (entry.isDirectory() && current.depth < 12) queue.push(await frame(full, current.depth + 1));
        else if (entry.isFile()) {
          const extension = path.extname(entry.name).toLowerCase(), info = await stat(full);
          if (TEXT_EXTENSIONS.has(extension) || !extension
            || (info.size <= MAX_READ_BYTES && decodeText(await readFile(full)) !== null)) yield relative.replaceAll(path.sep, '/');
        }
      }
      if (current.index < current.entries.length) queue.push(current);
      if (head >= 1024 && head * 2 > queue.length) { queue.splice(0, head); head = 0; }
    }
  }

  async listFilePaths({ maxFiles = 250, offset = 0, path: scope = '.', includeOmitted = false } = {}) {
    const pageSize = Math.max(1, Math.min(MAX_FILES, Math.floor(Number(maxFiles) || 250)));
    const start = Math.max(0, Math.floor(Number(offset) || 0)), rows = []; let index = 0;
    for await (const file of this.#walkFiles(scope, includeOmitted)) {
      if (index++ < start) continue;
      rows.push(file); if (rows.length >= pageSize) break;
    }
    return rows;
  }

  async listFiles({ maxFiles, offset = 0, path: scope = '.', includeOmitted = false } = {}) {
    const start = Number(offset);
    if (!Number.isSafeInteger(start) || start < 0 || start > 100000) throw new ToolFeedbackError('INPUT_INVALID', 'offset must be an integer from 0 to 100000');
    const count = Math.max(1, Math.min(250, Math.floor(Number(maxFiles) || 32)));
    const candidates = await this.listFilePaths({ maxFiles: count + 1, offset: start, path: scope, includeOmitted });
    const files = []; let bodyBytes = 0;
    for (const file of candidates.slice(0, count)) {
      const size = Buffer.byteLength(file, 'utf8') + (files.length ? 1 : 0);
      // Preserve one complete path even if it exceeds the default byte budget.
      if (maxFiles === undefined && files.length && bodyBytes + size > 2048) break;
      files.push(file); bodyBytes += size;
    }
    const more = candidates.length > files.length, next = start + files.length;
    const nextOffset = more && next <= 100000 ? next : null;
    const limitHint = more && nextOffset === null ? ' Offset limit reached; narrow path.' : '';
    return `Scoped listing: ${scope}; offset=${start}; ${files.length} paths. nextOffset=${nextOffset}; complete=${!more}. Filters/depth limits apply. Continue with the same path/includeOmitted and nextOffset; restart at 0 after tree changes.${limitHint}\n${files.join('\n') || '(no text files found)'}`;
  }

  async initialInventory({ task, strategy = 'v1', limit = 8 } = {}) {
    const files = await this.listFilePaths({ maxFiles: MAX_FILES });
    this.discoveryWide = files.length > 32;
    const inventory = strategy === 'baseline' || strategy === 'v1-dedup'
      ? buildBaselineInventory(files, 160)
      : buildProgressiveInventory(task, files, {
        limit,
        queryExpansion: ['v1-inventory-expanded', 'v1-expanded'].includes(strategy)
          ? true
          : ['v1', 'v1-inventory-auto', 'v1-auto'].includes(strategy) ? 'auto' : false,
      });
    inventory.text += '\nInventory covers a bounded default-filter scan (up to 700 paths, depth 12), not necessarily the entire workspace. Use scoped list_files/search_code and includeOmitted when relevant paths are absent.';
    return inventory;
  }

  async readFile({ path: relativePath, startLine = 1, endLine } = {}) {
    const filename = await this.resolveFile(relativePath);
    const normalizedPath = path.relative(this.workspace, filename);
    if (normalizedPath.split(path.sep).some(part => ['.tea', '.git'].includes(part))) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Reading agent storage and Git metadata is blocked');
    if (isSensitivePath(normalizedPath)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Reading credential and key files is blocked');
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_READ_BYTES) throw new Error(`File must be a regular text file smaller than ${MAX_READ_BYTES} bytes`);
    const decoded = decodeText(await readFile(filename));
    if (decoded === null) throw new Error('File must be valid UTF-8 text without NUL bytes');
    const source = redactText(decoded);
    const lines = source.split(/\r?\n/);
    const start = Math.max(1, Number(startLine) || 1);
    const end = Math.min(lines.length, Number(endLine) || lines.length);
    if (end < start) throw new Error('endLine must be greater than or equal to startLine');
    const relative = path.relative(this.workspace, filename).replaceAll(path.sep, '/');
    const rangeKey = `${relative}:${start}-${end}`;
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const evidenceRef = `${relative}#L${start}-L${end}@${sourceHash.slice(0, 16)}`;
    const fullEvidence = `[evidence ref=${evidenceRef} sha256=${sourceHash}]\n${this.editGuidance ? 'Existing file: edit with apply_patch.\n' : ''}${lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n')}`;
    const complete = fullEvidence.length <= MAX_TOOL_OUTPUT;
    const partialHint = '\nOnly a prefix of the requested lines is shown. Use smaller startLine/endLine ranges to read omitted lines; this range is not cached as complete evidence.';
    const evidence = complete ? fullEvidence : `${truncate(fullEvidence, MAX_TOOL_OUTPUT - partialHint.length - 80)}${partialHint}`;
    const seen = this.presentedSource.get(relative);
    const presented = seen?.sourceHash === sourceHash ? seen : { sourceHash, lines: new Map() };
    for (const match of evidence.matchAll(/^(\d+): (.*)$/gm)) presented.lines.set(Number(match[1]), match[2]);
    this.presentedSource.set(relative, presented);
    if (this.presentedSource.size > 32) this.presentedSource.delete(this.presentedSource.keys().next().value);
    if (this.deduplicateReads && complete && this.readEvidence.get(rangeKey) === sourceHash) {
      const reference = `Evidence unchanged; ref=${evidenceRef}. Original lines remain in history.`;
      const output = reference.length < evidence.length ? reference : evidence;
      this.recordSourceSnapshot(output,relative,sourceHash);return output;
    }
    if (this.deduplicateReads) {
      if (complete) this.readEvidence.set(rangeKey, sourceHash);
      else this.readEvidence.delete(rangeKey);
    }
    this.recordSourceSnapshot(evidence,relative,sourceHash);return evidence;
  }

  recordSourceSnapshot(output,relative,sourceHash) {
    this.sourceEvidence.set(createHash('sha256').update(output).digest('hex'),{path:relative,sourceHash});
    if(this.sourceEvidence.size>128)this.sourceEvidence.delete(this.sourceEvidence.keys().next().value);
  }

  async searchCode({ query, maxResults = 30, path: scope = '.', includeOmitted = false, offset = 0, startLine = 1 } = {}) {
    if (typeof query !== 'string' || !query) throw new Error('query must be a non-empty string');
    const needle = query.toLowerCase();
    const learned = [];
    // Revalidate learned evidence before reuse: edits must not preserve stale names.
    for (const mapping of this.sessionTerms.get(needle) || []) {
      try {
        const currentFile = await this.resolveFile(mapping.path);
        const info = await stat(currentFile);
        if (!info.isFile() || info.size > MAX_READ_BYTES || isSensitivePath(mapping.path)) continue;
        const current = redactText(await readFile(currentFile, 'utf8'));
        if (createHash('sha256').update(current).digest('hex') === mapping.sourceHash) learned.push(mapping);
      } catch { /* A removed or inaccessible file invalidates its mapping. */ }
    }
    if (this.sessionTerms.has(needle)) {
      if (learned.length) this.sessionTerms.set(needle, learned);
      else this.sessionTerms.delete(needle);
    }
    const needles = [needle, ...learned.map(mapping => mapping.target.toLowerCase())];
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(startLine) || startLine < 1) {
      throw new ToolFeedbackError('INPUT_INVALID', 'Search offset must be 0..100000 and startLine a positive integer');
    }
    const results = [], dependencies = new Map(), limit = Math.max(1, Math.min(Number(maxResults) || 30, 80));
    let filesScanned = 0, bytesScanned = 0, fileIndex = 0, nextOffset = null, nextLine = 1;
    for await (const relative of this.#walkFiles(scope, includeOmitted)) {
      const index = fileIndex++; if (index < offset) continue;
      const full = await this.resolveFile(relative), info = await stat(full);
      if (info.size > MAX_READ_BYTES) continue;
      if (filesScanned >= MAX_FILES || bytesScanned + info.size > 25_000_000) { nextOffset = index; break; }
      filesScanned++; bytesScanned += info.size;
      const decoded = decodeText(await readFile(full)); if (decoded === null) continue;
      const lines = decoded.split(/\r?\n/);
      for (let line = index === offset ? startLine - 1 : 0; line < lines.length; line++) {
        if (!needles.some(term => lines[line].toLowerCase().includes(term))) continue;
        dependencies.set(relative, { path: relative, sourceHash: createHash('sha256').update(redactText(decoded)).digest('hex') });
        results.push(redactText(`${relative}:${line + 1}: ${lines[line].trim()}`));
        if (results.length >= limit) {
          nextOffset = line + 1 < lines.length ? index : index + 1;
          nextLine = line + 1 < lines.length ? line + 2 : 1;
          break;
        }
      }
      if (results.length >= limit) break;
    }
    const complete = nextOffset === null, cursorExceeded = nextOffset > 100000;
    if (!complete) this.searchCursorNeeded = true;
    if (cursorExceeded) nextOffset = null;
    const coverage = `Search scope=${scope}; scanned=${filesScanned} files/${bytesScanned} bytes; nextOffset=${nextOffset}; nextLine=${nextLine}; complete=${complete}. Filters/depth/size limits apply. Continue the same query/path/includeOmitted with nextOffset and startLine=nextLine; restart at 0 after tree changes.${cursorExceeded ? ' Offset limit reached; narrow path.' : ''}`;
    if (!results.length) {
      if (this.unresolvedQueries.size < 32) this.unresolvedQueries.add(needle);
      return `No matches in the scanned scope. ${coverage}`;
    }
    this.unresolvedQueries.delete(needle);
    const mappingHint = learned.length ? `Session query mapping: ${query} -> ${learned.map(item => item.target).join(', ')}\n` : '';
    const output = mappingHint + results.join('\n') + '\n' + coverage;
    this.searchEvidence.set(createHash('sha256').update(output).digest('hex'), [...dependencies.values()]);
    if (this.searchEvidence.size > 128) this.searchEvidence.delete(this.searchEvidence.keys().next().value);
    return output;
  }

  modelToolDefinitions({ includeMemory = true } = {}) {
    const selected = this.discoveryWide === false && !this.searchCursorNeeded ? SMALL_DISCOVERY_DEFINITIONS : TOOL_DEFINITIONS;
    const available = this.enableFileCreation ? selected : selected.filter(tool => tool.name !== 'write_file');
    const descriptions = { read_file: 'Read an existing text file, optionally a line range. Edit it with apply_patch.',
      apply_patch: 'Edit an EXISTING file: replace one unique exact search span with replace. Read current source first; use this even for a full implementation replacement.',
      write_file: 'CREATE ONLY: create a file at an ABSENT path and any missing parent directories. Existing paths from inventory/search/read MUST use apply_patch. write_file cannot overwrite or replace existing files. Run relevant tests after creation.' };
    const base = this.editGuidance ? available.map(tool => descriptions[tool.name] ? { ...tool, description: descriptions[tool.name] } : tool) : available;
    const definitions = this.unresolvedQueries.size ? [...base, TERM_MAPPING_TOOL] : base;
    return includeMemory && this.contextMemory?.evicted.size ? [...definitions, ...this.contextMemory.definitions] : definitions;
  }

  async rememberTermMapping({ query, target, path: relativePath, line } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 160) throw new Error('Mapping query must be a nonempty string of at most 160 characters');
    const key = query.toLowerCase();
    if (!this.unresolvedQueries.has(key)) throw new Error('Only an unresolved query from an actual search can be learned');
    if (typeof target !== 'string' || target.length > 80 || !/^[\p{L}_$][\p{L}\p{N}_$.:/-]*$/u.test(target)) throw new Error('Mapping target must be a real code name, optionally qualified');
    if (!Number.isSafeInteger(line) || line < 1) throw new Error('Mapping requires a positive source line number');
    const filename = await this.resolveFile(relativePath);
    const relative = path.relative(this.workspace, filename).replaceAll(path.sep, '/');
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_READ_BYTES || isSensitivePath(relative)) throw new Error('Mapping evidence must be a readable source file');
    const presented = this.presentedSource.get(relative);
    if (!presented?.lines.has(line)) throw new Error('Read the evidence line with read_file before learning a mapping');
    const source = redactText(await readFile(filename, 'utf8'));
    const sourceHash = createHash('sha256').update(source).digest('hex');
    if (sourceHash !== presented.sourceHash || source.split(/\r?\n/)[line - 1] !== presented.lines.get(line)) throw new Error('Evidence changed or was truncated; read the current source line again');
    // Language-neutral occurrence evidence. This proves presence, not a
    // declaration or semantic match; the discovering model must confirm those.
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrence = new RegExp(`(?:^|[^\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, 'u');
    if (!occurrence.test(source.split(/\r?\n/)[line - 1] || '')) throw new Error('Target does not occur as a complete name on the observed line');
    const entries = this.sessionTerms.get(key) || [];
    if (!entries.some(item => item.target === target && item.path === relative)) {
      if (entries.length >= 4 || (!this.sessionTerms.has(key) && this.sessionTerms.size >= 32)) throw new Error('Session vocabulary limit reached');
      entries.push({ target, path: relative, line, sourceHash });
      this.sessionTerms.set(key, entries);
    }
    this.unresolvedQueries.delete(key);
    return `Session mapping saved with source occurrence evidence: ${query} -> ${target}; evidence=${relative}#L${line}@${sourceHash.slice(0, 16)}. Applies only to this in-memory conversation.`;
  }

  async writeFile({ path: relativePath, content } = {}) {
    if (!this.enableFileCreation) throw new ToolFeedbackError('CAPABILITY_DENIED', 'File creation is disabled in this configuration');
    if (typeof content !== 'string' || content.includes('\0')) throw new ToolFeedbackError('INPUT_INVALID', 'write_file content must be UTF-8 text without NUL bytes');
    const data = Buffer.from(content, 'utf8');
    if (data.length > MAX_READ_BYTES || data.toString('utf8') !== content) throw new ToolFeedbackError('INPUT_INVALID', 'write_file content must be valid UTF-8 text of at most 160 KB');
    const filename = await this.resolveFile(relativePath, { mustExist: false });
    const normalized = path.relative(this.workspace, filename).replaceAll(path.sep, '/');
    const parts = normalized.split('/');
    if (!normalized || parts.length > 64 || parts.some(part => !part || part.includes(':'))) throw new ToolFeedbackError('INPUT_INVALID', 'write_file requires a regular workspace-relative file path');
    if (parts.some(part => ['.git', '.tea'].includes(part.toLowerCase())) || isSensitivePath(normalized)) {
      throw new ToolFeedbackError('CAPABILITY_DENIED', 'Creating credential files, Git metadata or agent storage is blocked');
    }
    let directory = this.workspace;
    for (const part of parts.slice(0, -1)) {
      this.signal?.throwIfAborted();
      directory = path.join(directory, part);
      try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ToolFeedbackError('CAPABILITY_DENIED', 'New files cannot use symlink or non-directory parents');
      const actual = await realpath(directory), relative = path.relative(this.workspace, actual);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Creation parent escapes the workspace');
    }
    this.signal?.throwIfAborted();
    let file;
    try { file = await open(filename, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new ToolFeedbackError('SOURCE_MISMATCH', this.editGuidance ? 'File already exists; no write occurred. Use apply_patch on text from read_file.' : 'File already exists. Read it and use apply_patch; write_file never overwrites existing files');
      throw error;
    }
    let identity;
    try { identity = await file.stat(); await file.writeFile(data); }
    catch (error) {
      await file.close().catch(() => {});
      // Remove only this operation's incomplete file, preserving any replacement by another writer.
      try { const current = await lstat(filename); if (identity && current.isFile() && current.dev === identity.dev && current.ino === identity.ino) await unlink(filename); } catch { /* retain original error */ }
      throw error;
    }
    await file.close();
    return `Created ${normalized} (${data.length} UTF-8 bytes). Run relevant tests before claiming completion.`;
  }

  async applyPatch({ path: relativePath, search, replace } = {}) {
    if (typeof search !== 'string' || !search.length || typeof replace !== 'string') {
      throw new ToolFeedbackError('INPUT_INVALID', 'apply_patch requires a non-empty search string and a replace string. To create a new file, use write_file with path and content');
    }
    if (typeof relativePath === 'string' && (relativePath === '.git' || relativePath.startsWith('.git/') || relativePath === '.env' || relativePath.startsWith('.env.'))) {
      throw new ToolFeedbackError('CAPABILITY_DENIED', 'Patching Git metadata and environment files is blocked');
    }
    const filename = await this.resolveFile(relativePath);
    const fileStat = await lstat(filename);
    if (!fileStat.isFile() || fileStat.size > MAX_READ_BYTES) throw new Error('Patch target must be a regular file smaller than 160 KB');
    const normalizedPath = path.relative(this.workspace, filename).replaceAll(path.sep, '/');
    if (normalizedPath.split('/').includes('.tea')) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Patching agent storage is blocked');
    if (isSensitivePath(normalizedPath)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Patching credential and key files is blocked');
    if (normalizedPath === '.git' || normalizedPath.startsWith('.git/') || normalizedPath === '.env' || normalizedPath.startsWith('.env.')) {
      throw new ToolFeedbackError('CAPABILITY_DENIED', 'Patching Git metadata and environment files is blocked');
    }
    const source = await readFile(filename, 'utf8');
    const first = source.indexOf(search);
    if (first < 0) throw new ToolFeedbackError('SOURCE_MISMATCH', 'Patch search text was not found');
    if (source.indexOf(search, first + search.length) >= 0) throw new ToolFeedbackError('SOURCE_MISMATCH', 'Patch search text is ambiguous; include more surrounding lines');
    await writeFile(filename, source.slice(0, first) + replace + source.slice(first + search.length), 'utf8');
    return `Updated ${normalizedPath}`;
  }

  async runTests({ command } = {}) {
    this.lastCommandTiming = { approvalMs: 0, executionMs: 0 };
    if (typeof command !== 'string' || !command.trim()) throw new ToolFeedbackError('INPUT_INVALID', 'command must be a non-empty string');
    if (!isAllowedCommand(command)) {
      throw new ToolFeedbackError('CAPABILITY_DENIED', 'Only the documented test, lint, typecheck, and read-only Git commands are allowed in run_tests');
    }
    assertWindowsCommand(command);
    return this.#spawnCommand(command.trim(), this.maxCommandMs);
  }

  async runShell({ command } = {}) {
    this.lastCommandTiming = { approvalMs: 0, executionMs: 0 };
    if (typeof command !== 'string' || !command.trim()) throw new ToolFeedbackError('INPUT_INVALID', 'command must be a non-empty string');
    const value = command.trim();
    if (BLOCKED_SHELL.test(value)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Destructive commands and Git history mutations are blocked');
    if (/[;&|<>`\n\r]/.test(value)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Shell operators and multiline commands are blocked');
    if (isAllowedCommand(value)) {
      assertWindowsCommand(value);
      return this.#spawnCommand(value, this.maxCommandMs);
    }
    if (this.approveCommand) {
      const approvalStarted = Date.now();
      let approved;
      try { approved = await this.approveCommand(value); }
      finally { this.lastCommandTiming.approvalMs = Date.now() - approvalStarted; }
      if (!approved) return 'Command denied by user.';
      this.signal?.throwIfAborted();
      return this.#spawnCommand(value, this.maxCommandMs);
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new ToolFeedbackError('APPROVAL_UNAVAILABLE', 'Unlisted shell commands require an interactive terminal for approval');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    const approvalStarted = Date.now();
    try { answer = await rl.question(`Allow this command in the workspace?\n  ${value}\nType yes to continue: `); }
    finally { this.lastCommandTiming.approvalMs = Date.now() - approvalStarted; rl.close(); }
    if (answer.trim().toLowerCase() !== 'yes') return 'Command denied by user.';
    return this.#spawnCommand(value, this.maxCommandMs);
  }

  async #spawnCommand(command, timeoutMs) {
    this.signal?.throwIfAborted();
    const signal = this.signal;
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const executable = (parts.shift() || '').replace(/^"|"$/g, '');
    const args = parts.map((part) => part.replace(/^"|"$/g, ''));
    if (!executable) throw new Error('Command is empty');
    const safeEnv = { PATH: process.env.PATH || '', PATHEXT: process.env.PATHEXT || '', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', ComSpec: process.env.ComSpec || 'cmd.exe', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
    const executionStarted = Date.now();
    try {
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
      let cancelled = false;
      let terminating = false;
      let timeoutCleanup = Promise.resolve();
      const terminate = () => {
        if (terminating) return;
        terminating = true;
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
      };
      const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
      const cancel = () => { cancelled = true; terminate(); };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      for (const [stream, target] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          (target === 'stdout' ? stdout : stderr).append(chunk);
        });
      }
      child.once('error', (error) => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (!settled) {
          settled = true;
          if (error.code === 'ENOENT') {
            const hint = process.platform === 'win32' ? ' Windows CMD built-ins are not standalone executables.' : '';
            const failure = new ToolFeedbackError('EXECUTABLE_UNAVAILABLE', `Executable unavailable (ENOENT).${hint} Use write_file to create files and parents, read_file to read source, or an installed executable for validation.`);
            failure.code = error.code; reject(failure);
          } else reject(error);
        }
      });
      child.once('close', async (code, processSignal) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (settled) return;
        settled = true;
        if (timedOut || cancelled) {
          await timeoutCleanup;
          reject(new Error(cancelled ? 'Command cancelled; completed edits remain in the workspace' : `Command timed out after ${timeoutMs} ms`));
          return;
        }
        const maxChars = code === 0 ? 2_000 : 6_500;
        const sanitized = redactText(`exit=${code ?? processSignal}\nstdout:\n${stdout.render({ maxChars })}\nstderr:\n${stderr.render({ maxChars })}`);
        // Redaction can expand short assignments, so bound the sanitized result too.
        const finalOutput = new BoundedOutput({ maxChars: MAX_TOOL_OUTPUT });
        finalOutput.append(sanitized);
        resolve(finalOutput.render());
      });
    });
    return output;
    } finally { this.lastCommandTiming = { ...this.lastCommandTiming, executionMs: Date.now() - executionStarted }; }
  }
}

export const TOOL_DEFINITIONS = [
  { name: 'list_files', description: 'List workspace text paths fairly across directories. Default: 32 paths / about 2KB; set maxFiles for larger pages. Use nextOffset to continue the same scope. includeOmitted expands ordinary excluded folders; secrets and Git/agent storage remain excluded.', input_schema: { type: 'object', properties: { maxFiles: { type: 'integer', minimum: 1, maximum: 250 }, offset: { type: 'integer', minimum: 0, maximum: 100000 }, path: { type: 'string' }, includeOmitted: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'search_code', description: 'Use nextOffset and nextLine (as startLine) to continue a capped search in the same scope. Search literal text and learned session names. Use path to search another directory after bounded scans; includeOmitted enables ordinary excluded folders. A miss does not prove repository-wide absence.', input_schema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0, maximum: 100000 }, startLine: { type: 'integer', minimum: 1 }, query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 80 }, path: { type: 'string' }, includeOmitted: { type: 'boolean' } }, required: ['query'], additionalProperties: false } },
  { name: 'read_file', description: 'Read a text file, optionally selecting a line range.', input_schema: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false } },
  { name: 'apply_patch', description: 'Replace one unique exact text span in a workspace file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'], additionalProperties: false } },
  { name: 'write_file', description: 'Create a new UTF-8 text file within the workspace and create missing parent directories. Never overwrites an existing file: read it and use apply_patch instead. Do not use shell commands to create files. Run relevant tests after creation.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'run_tests', description: 'Run an allowlisted test, lint, typecheck, or read-only Git diagnostic command. Only actual validation commands can satisfy the post-edit validation requirement. Long output retains the beginning and end; successful commands use a smaller output budget.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } },
  { name: 'run_shell', description: 'Run a bounded command in the workspace. Unlisted commands need explicit interactive approval; destructive commands are blocked.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } },
];

// Small inventories retain the previous wire schemas until continuation is
// actually needed. Additional fields should not tax unrelated short tasks.
const SMALL_DISCOVERY_DEFINITIONS = TOOL_DEFINITIONS.map(tool => {
  if (tool.name === 'list_files') return { ...tool, description: 'List workspace text paths. Use offset for later pages and path for a narrower directory. includeOmitted enables ordinary hidden/generated/dependency folders; credential files and Git metadata remain excluded.' };
  if (tool.name !== 'search_code') return tool;
  const properties = { ...tool.input_schema.properties }; delete properties.offset; delete properties.startLine;
  return { ...tool, description: 'Search literal text and learned session names. Use path to search another directory after bounded scans; includeOmitted enables ordinary excluded folders. A miss does not prove repository-wide absence.',
    input_schema: { ...tool.input_schema, properties } };
});

export const TERM_MAPPING_TOOL = {
  name: 'remember_term_mapping',
  description: 'An earlier literal lookup missed. Continue model-led discovery with list_files/search_code/read_file. Once you identify the relevant real code name, save the unresolved query -> identifier mapping for this in-memory conversation. Supply an exact source line already read via read_file. Confirm from code context that this is the real relevant name, not a guess or an incidental mention in comments/strings. Runtime checks unchanged evidence and name presence, not declaration syntax or semantic equivalence; those remain your responsibility.',
  input_schema: { type: 'object', properties: { query: { type: 'string', maxLength: 160 }, target: { type: 'string', maxLength: 80 }, path: { type: 'string' }, line: { type: 'integer', minimum: 1 } }, required: ['query', 'target', 'path', 'line'], additionalProperties: false },
};

export async function dispatchTool(tools, name, input) {
  if (['recall_context', 'search_history'].includes(name)) {
    if (!tools.contextMemory) throw new Error('ContextOS retrieval is unavailable in this session');
    return name === 'recall_context' ? tools.contextMemory.recall(input) : tools.contextMemory.search(input);
  }
  switch (name) {
    case 'list_files': return tools.listFiles(input);
    case 'search_code': return tools.searchCode(input);
    case 'read_file': return tools.readFile(input);
    case 'remember_term_mapping': return tools.rememberTermMapping(input);
    case 'apply_patch': return tools.applyPatch(input);
    case 'write_file': return tools.writeFile(input);
    case 'run_tests': return tools.runTests(input);
    case 'run_shell': return tools.runShell(input);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
