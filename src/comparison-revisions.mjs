import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const git = async (repository, args) => (await execute('git', args, {
  cwd: repository, windowsHide: true, encoding: 'buffer', maxBuffer: 16_000_000,
})).stdout;

/** Extract committed engine bytes only. No checkout/reset or setup scripts. */
export async function prepareRevisionEngine({ repository, ref, directory }) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\r\n\0]/.test(ref)) throw new Error('Invalid engine Git reference');
  const commit = (await git(repository, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid resolved engine commit');
  const entries = (await git(repository, ['ls-tree', '-r', '-z', commit, '--', 'src', 'package.json'])).toString().split('\0').filter(Boolean);
  const selected = entries.map(entry => {
    const match = entry.match(/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/);
    if (!match) throw new Error('Invalid engine Git tree');
    return { mode: match[1], type: match[2], file: match[4] };
  }).filter(entry => entry.file === 'package.json' || entry.file.startsWith('src/') && entry.file.endsWith('.mjs'));
  if (!selected.some(entry => entry.file === 'src/agent.mjs') || !selected.some(entry => entry.file === 'src/tools.mjs')) throw new Error('Revision has no supported TEA engine');
  if (selected.some(entry => !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob' || entry.file.split('/').some(part => ['..', '.'].includes(part)))) throw new Error('Engine must contain regular committed files');
  await mkdir(directory, { recursive: false });
  const files = [];
  for (const entry of selected.sort((a, b) => a.file.localeCompare(b.file))) {
    const bytes = await git(repository, ['show', `${commit}:${entry.file}`]);
    const filename = path.join(directory, entry.file);
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
    files.push({ path: entry.file, sha256: sha(bytes), bytes: bytes.length });
  }
  const metadata = { commit, sourceSha256: sha(JSON.stringify(files)), files };
  const engine = await import(pathToFileURL(path.join(directory, 'src/agent.mjs')).href);
  const tools = await import(pathToFileURL(path.join(directory, 'src/tools.mjs')).href);
  if (typeof engine.runTask !== 'function' || typeof engine.createAgentSession !== 'function' || typeof tools.WorkspaceTools !== 'function') throw new Error('Revision does not expose supported native session APIs');
  return { metadata, engine, tools, async verify() {
    const actual = [];
    const walk = async folder => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const filename = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(filename);
        else if (entry.isFile()) actual.push(path.relative(directory, filename).replaceAll(path.sep, '/'));
        else throw new Error('Frozen engine contains non-regular entries');
      }
    };
    await walk(directory);
    if (actual.length !== files.length || actual.some(file => !files.some(expected => expected.path === file))) return false;
    for (const file of files) if (sha(await readFile(path.join(directory, file.path))) !== file.sha256) return false;
    return true;
  } };
}

export function revisionPairOptions(options) {
  const baseline = options['baseline-ref'], candidate = options['candidate-ref'];
  if (Boolean(baseline) !== Boolean(candidate)) throw new Error('Both --baseline-ref and --candidate-ref are required');
  return baseline ? { baseline, candidate } : null;
}
