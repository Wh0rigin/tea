import {mkdir,mkdtemp,readFile,writeFile,readdir,lstat,cp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const execute=promisify(execFile),hash=data=>createHash('sha256').update(data).digest('hex');
const childEnv = { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '',
  WINDIR: process.env.WINDIR || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '' };
async function writeTree(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => ['..', '.git', '.tea'].includes(x))) throw new Error('Invalid fixture path');
    const filename = path.join(directory, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, content);
  }
}
async function command(directory, args) {
  try {
    const result = await execute(process.execPath, args, { cwd: directory, env: childEnv, windowsHide: true, timeout: 15000, maxBuffer: 262144 });
    return { passed: true, output: result.stdout + result.stderr, code: 0 };
  } catch (error) { return { passed: false, output: (error.stdout || '') + (error.stderr || ''), code: error.code || null }; }
}
async function removeTemporary(directory) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
  if (!relative.startsWith('tea-coding-accept-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe cleanup target');
  await rm(directory, { recursive: true, force: true });
}
async function listSource(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symlink in candidate sources');
    if (entry.isDirectory()) result.push(...await listSource(path.join(directory, entry.name), relative));
    else if (entry.isFile()) {
      if ((await lstat(path.join(directory, entry.name))).size > 160000) throw new Error('Oversized candidate source');
      result.push(relative);
    }
    if (result.length > 200) throw new Error('Too many candidate sources');
  }
  return result.sort();
}
async function acceptance(workspace, fixture) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tea-coding-accept-'));
  try {
    const source = path.join(workspace, 'src');
    if (await lstat(source).then(() => true, () => false)) {
      await listSource(source); await cp(source, path.join(directory, 'src'), { recursive: true, dereference: false });
    }
    const witness = `TEA_FINISHED_${randomUUID()}`;
    await writeFile(path.join(directory, 'hidden.test.mjs'), `${fixture.acceptance}\nimport {after} from 'node:test';after(()=>console.log('${witness}'));\n`);
    const result = await command(directory, ['--test', 'hidden.test.mjs']);
    const completed = result.output.includes(witness);
    return { passed: result.passed && completed, completed, code: result.code, outputSha256: hash(result.output),
      diagnostic: result.output.replaceAll(directory, '<acceptance>').slice(-4000) };
  } finally { await removeTemporary(directory); }
}
async function snapshot(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['.tea', '.git', '__pycache__'].includes(item.name)) continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error('Symlink in fixture tree');
    if (item.isDirectory()) entries.push(...await snapshot(path.join(directory, item.name), relative));
    else entries.push([relative, hash(await readFile(path.join(directory, item.name)))]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

export {writeTree,command,acceptance,snapshot};
