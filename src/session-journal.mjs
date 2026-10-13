import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { open, mkdir, readFile, readdir, lstat, realpath, unlink, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { validateRunId } from './run-id.mjs';

const exec = promisify(execFile);
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const OMIT = new Set(['.tea', '.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next']);
const SECRET_PATH = /(?:^|\/)(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|auth\.json|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i;
const MAX_ARTIFACT = 64 * 1024 * 1024;

async function safeDirectory(directory, create = false) {
  if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Session storage must be a real directory, not a symlink');
}
async function sessionRoot(workspace, create = false) {
  const root = await realpath(workspace);
  for (const suffix of ['.tea', path.join('.tea', 'sessions')]) await safeDirectory(path.join(root, suffix), create);
  return path.join(root, '.tea', 'sessions');
}
async function regularFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Session files must be regular files');
  return info;
}
async function exclusiveWrite(filename, data) {
  const file = await open(filename, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}

/** Source identity is content-based; changed timestamps alone do not expire evidence. */
export async function workspaceIdentity(workspace) {
  const root = await realpath(workspace), paths = [];
  let head = null;
  try { head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim(); } catch { /* Non-Git workspaces supported. */ }
  if (head) {
    const listed = await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, windowsHide: true, maxBuffer: 8_000_000 });
    paths.push(...new Set(listed.stdout.split('\0').filter(Boolean)));
  } else {
    async function walk(directory, prefix = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (OMIT.has(entry.name) || entry.isSymbolicLink()) continue;
        const rel = prefix + entry.name;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), rel + '/');
        else if (entry.isFile()) paths.push(rel);
        if (paths.length > 10000) throw new Error('Workspace identity exceeds the 10,000-file bound');
      }
    }
    await walk(root);
  }
  if (paths.length > 10000) throw new Error('Workspace identity exceeds the 10,000-file bound');
  const hash = createHash('sha256');
  for (const relative of paths.sort()) {
    const rel = relative.replaceAll('\\', '/');
    if (rel.split('/').some(part => OMIT.has(part)) || SECRET_PATH.test(rel)) continue;
    const filename = path.resolve(root, relative), resolvedRelative = path.relative(root, filename);
    if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) throw new Error('Invalid Git file path');
    hash.update(rel + '\0');
    const info = await lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) { hash.update('missing'); continue; }
    if (!info.isFile() || info.isSymbolicLink()) { hash.update('non-regular'); continue; }
    // Ancestor symlinks must not cause a fingerprint to read outside the workspace.
    const resolved = await realpath(filename), inside = path.relative(root, resolved);
    if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Fingerprint path escapes workspace');
    for await (const chunk of createReadStream(resolved)) hash.update(chunk);
    hash.update('\0');
  }
  return { workspace: root, head, filesSha256: hash.digest('hex') };
}

/** Append-only metadata with authenticated, content-addressed encrypted payloads. */
export class SessionJournal {
  static async open({ workspace, id, resume = false }) {
    const root = await sessionRoot(workspace, true), name = validateRunId(id);
    const directory = path.join(root, name);
    if (!resume) await mkdir(directory, { mode: 0o700 });
    await safeDirectory(directory);
    const journal = new SessionJournal(directory, name);
    try {
      await journal.acquire();
      if (!resume) {
        await mkdir(journal.artifacts, { mode: 0o700 });
        await exclusiveWrite(journal.keyPath, randomBytes(32));
        await exclusiveWrite(journal.logPath, '');
      }
      await safeDirectory(journal.artifacts);
      const keyInfo = await regularFile(journal.keyPath);
      if (keyInfo.size !== 32) throw new Error('Invalid session encryption key');
      journal.key = await readFile(journal.keyPath);
      await journal.recover();
      return journal;
    } catch (error) { await journal.close(); throw error; }
  }
  constructor(directory, id) {
    this.directory = directory; this.id = id;
    this.artifacts = path.join(directory, 'artifacts');
    this.keyPath = path.join(directory, 'key.bin');
    this.logPath = path.join(directory, 'journal.jsonl');
    this.lockPath = path.join(directory, 'writer.lock');
    this.rows = []; this.queue = Promise.resolve(); this.ownedLock = false;
  }
  async acquire() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await exclusiveWrite(this.lockPath, JSON.stringify({ pid: process.pid }));
        this.ownedLock = true; return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await regularFile(this.lockPath);
        const { pid } = JSON.parse(await readFile(this.lockPath, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid session lock');
        try { process.kill(pid, 0); throw new Error('Session is already open in another writer'); }
        catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
        await unlink(this.lockPath);
      }
    }
    throw new Error('Could not acquire session writer lock');
  }
  async recover() {
    await regularFile(this.logPath);
    const data = await readFile(this.logPath);
    const end = data.lastIndexOf(10) + 1;
    if (end !== data.length) {
      const file = await open(this.logPath, 'r+');
      try { await file.truncate(end); await file.sync(); } finally { await file.close(); }
      this.recoveredTailBytes = data.length - end;
    }
    let previous = null;
    for (const line of data.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line), { sha256, ...body } = row;
      if (row.schema !== 1 || row.sessionId !== this.id || row.seq !== this.rows.length + 1
        || row.eventId !== `e${String(row.seq).padStart(8, '0')}` || row.previous !== previous || digest(body) !== sha256) throw new Error('Session journal integrity or schema failure');
      await this.get(row.artifact); // Fail closed on missing/corrupt committed payloads.
      this.rows.push(row); previous = sha256;
    }
  }
  async put(value) {
    const plain = Buffer.from(JSON.stringify(value)), ref = digest(plain.toString('utf8'));
    if (plain.length > MAX_ARTIFACT) throw new Error('Session artifact exceeds 64 MiB');
    const filename = path.join(this.artifacts, ref + '.bin');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(this.id + ':' + ref));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    try { await exclusiveWrite(filename, Buffer.concat([Buffer.from('TEA1'), iv, cipher.getAuthTag(), encrypted])); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await this.get(ref); }
    return ref;
  }
  async get(ref) {
    if (typeof ref !== 'string' || !/^[a-f0-9]{64}$/.test(ref)) throw new Error('Invalid artifact reference');
    const filename = path.join(this.artifacts, ref + '.bin'), info = await regularFile(filename);
    if (info.size > MAX_ARTIFACT + 32) throw new Error('Oversized session artifact');
    const data = await readFile(filename);
    if (data.subarray(0, 4).toString() !== 'TEA1') throw new Error('Unsupported artifact schema');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(4, 16));
    decipher.setAAD(Buffer.from(this.id + ':' + ref)); decipher.setAuthTag(data.subarray(16, 32));
    const plain = Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]).toString('utf8');
    if (digest(plain) !== ref) throw new Error('Artifact content hash mismatch');
    return JSON.parse(plain);
  }
  append(kind, value) {
    this.queue = this.queue.then(async () => {
      if (!this.ownedLock) throw new Error('Session journal is closed');
      const artifact = await this.put(value), seq = this.rows.length + 1;
      const body = { schema: 1, sessionId: this.id, seq, eventId: `e${String(seq).padStart(8, '0')}`,
        timestamp: new Date().toISOString(), kind, artifact, previous: this.rows.at(-1)?.sha256 || null };
      const row = { ...body, sha256: digest(body) };
      const file = await open(this.logPath, 'a');
      try { await file.writeFile(JSON.stringify(row) + '\n'); await file.sync(); } finally { await file.close(); }
      this.rows.push(row); return row;
    });
    return this.queue;
  }
  async events() {
    return Promise.all(this.rows.map(async row => ({ ...row, value: await this.get(row.artifact) })));
  }
  async close() {
    await this.queue.catch(() => {});
    if (this.ownedLock) { this.ownedLock = false; await unlink(this.lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    this.key?.fill(0);
  }
}

export async function listSessions(workspace) {
  let root;
  try { root = await sessionRoot(workspace); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    validateRunId(entry.name);
    const info = await lstat(path.join(root, entry.name, 'journal.jsonl'));
    rows.push({ id: entry.name, journalBytes: info.size, updatedAt: info.mtime.toISOString() });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSession(workspace, id) {
  const root = await sessionRoot(workspace), name = validateRunId(id), target = path.join(root, name);
  if (path.dirname(target) !== root || await realpath(target) !== target) throw new Error('Invalid session cleanup target');
  const journal = await SessionJournal.open({ workspace, id: name, resume: true });
  try {
    // Keep the lock through deletion; never remove sibling sessions or the workspace.
    await rm(target, { recursive: true }); journal.ownedLock = false;
  } finally { await journal.close(); }
}
