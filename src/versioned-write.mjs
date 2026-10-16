import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ToolFeedbackError } from './tool-feedback.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mismatch = () => new ToolFeedbackError('SOURCE_MISMATCH', 'Replacement evidence expired. Read the complete current file before retrying.');

/** Atomic content publication, not atomic compare-and-swap against unrelated writers.
 * A final path/version check precedes rename; external edits in that remaining window
 * cannot be excluded by portable Node filesystem primitives. No unlink fallback.
 * The injected filesystem is for deterministic fault/race checks only.
 */
export async function replaceVersionedFile({ workspace, filename, evidence, data, signal }, io = fs) {
  const relative = path.relative(workspace, filename);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw mismatch();
  async function verify() {
    let current = workspace;
    for (const part of relative.split(path.sep).slice(0, -1)) {
      current = path.join(current, part);
      const info = await io.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw mismatch();
    }
    if (await io.realpath(path.dirname(filename)) !== path.dirname(filename)) throw mismatch();
    const info = await io.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !(info.mode & 0o222) || info.size > 160000
      || info.dev !== evidence.dev || info.ino !== evidence.ino || info.mode !== evidence.mode) throw mismatch();
    const contents = await io.readFile(filename);
    if (hash(contents) !== evidence.rawHash) throw mismatch();
    return info;
  }
  signal?.throwIfAborted();
  const original = await verify();
  const temporary = path.join(path.dirname(filename), `.tea-write-${randomUUID()}.tmp`);
  let file, owned = false;
  try {
    file = await io.open(temporary, 'wx', original.mode & 0o777); owned = true;
    await file.chmod(original.mode & 0o777);
    await file.writeFile(data); await file.sync(); await file.close(); file = null;
    signal?.throwIfAborted();
    await verify(); signal?.throwIfAborted();
    // A failed rename leaves the target intact. Never delete it to force success.
    await io.rename(temporary, filename); owned = false;
  } finally {
    await file?.close().catch(() => {});
    if (owned) await io.unlink(temporary).catch(() => {});
  }
}
