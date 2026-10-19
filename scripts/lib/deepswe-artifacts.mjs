import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { commandEnvironment } from '../../src/commands.mjs';

const exec = promisify(execFile);
const sha256 = data => createHash('sha256').update(data).digest('hex');
export async function exportDeepSweArtifact({ workspace, baseCommit, artifactDirectory }) {
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new TypeError('Expected a pinned base commit');
  const root = await realpath(workspace);
  const requested = path.relative(root, path.resolve(artifactDirectory));
  if (!requested || !requested.startsWith(`..${path.sep}`) && requested !== '..' && !path.isAbsolute(requested)) throw new Error('Artifacts must live outside the task workspace');
  await mkdir(artifactDirectory, { recursive: true }); const output = await realpath(artifactDirectory);
  const rel = path.relative(root, output);
  if (!rel || !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)) throw new Error('Artifacts must live outside the task workspace');
  const git = async args => (await exec('git', args, { cwd: root, env: commandEnvironment(root), encoding: 'buffer', timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true })).stdout;
  const repositoryRoot = (await git(['rev-parse','--show-toplevel'])).toString('utf8').trim();
  if (await realpath(repositoryRoot) !== root) throw new Error('Artifact workspace must be the repository root');
  await git(['merge-base','--is-ancestor',baseCommit,'HEAD']);
  const trackedState = await git(['ls-files','-z','--','.tea']);
  if (trackedState.length) throw new Error('Refusing to export tracked private TEA state');
  try { await git(['check-ignore','--quiet','--','.tea/tea-private-probe']); }
  catch { throw new Error('Trusted setup must ignore .tea before artifact staging'); }
  await git(['add','-A','--','.']);
  const staged = (await git(['diff','--cached','--name-only','-z'])).toString('utf8').split('\0').filter(Boolean);
  if (staged.some(x => x === '.tea' || x.startsWith('.tea/'))) throw new Error('Private TEA state appeared in staged artifact');
  // Persist the exact candidate before commit/hooks/collector can fail.
  const snapshot = await git(['diff','--binary',baseCommit]);
  await writeFile(path.join(output,'working-tree.patch'), snapshot, { flag: 'wx' });
  if (staged.length) await git(['-c','user.name=TEA-Benchmark','-c','user.email=benchmark@localhost','commit','-s','-m','TEA benchmark solution']);
  const patch = await git(['diff','--binary',baseCommit,'HEAD']);
  await writeFile(path.join(output,'model.patch'), patch, { flag: 'wx' });
  if (!snapshot.equals(patch)) throw new Error('Commit changed the candidate patch; both artifacts preserved for inspection');
  const files = (await git(['diff','--name-only','-z',baseCommit,'HEAD'])).toString('utf8').split('\0').filter(Boolean);
  const manifest = { schema: 1, kind: 'artifact-export-only', baseCommit, changedFiles: files, patchBytes: patch.length, patchSha256: sha256(patch), snapshotSha256: sha256(snapshot), modelCalls: 0 };
  await writeFile(path.join(output,'manifest.json'), JSON.stringify(manifest,null,2)+'\n', { flag: 'wx' });
  return manifest;
}
