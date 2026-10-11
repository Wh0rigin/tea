import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit files work on Node 20+ and prevent generated benchmark repositories
// from being rediscovered as project tests on every run.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'tests');
const files = (await readdir(directory)).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => path.join(directory, name));
if (!files.length) throw new Error('No project tests found');
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit', windowsHide: true });
child.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
