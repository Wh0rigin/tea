import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isSensitivePath } from './tools.mjs';

/** Synchronous observation at event receipt; no writes or model-visible data. */
export function createSourceCapture(workspace, files) {
  const root = realpathSync(workspace);
  const names = [...new Set(files)].sort();
  if (!names.length || names.length > 32 || names.some(file => typeof file !== 'string' || path.isAbsolute(file) || isSensitivePath(file))) throw new Error('Invalid comparison source selection');
  return () => Object.fromEntries(names.map(file => {
    const filename = path.resolve(root, file), relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Comparison source escapes workspace');
    const info = lstatSync(filename), resolved = path.relative(root, realpathSync(filename));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 160000 || resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('Invalid comparison source file');
    return [file.replaceAll(path.sep, '/'), createHash('sha256').update(readFileSync(filename)).digest('hex')];
  }));
}

export function createPackageScriptReader(workspace) {
  const root = realpathSync(workspace), filename = path.join(root, 'package.json');
  return () => {
    const info = lstatSync(filename), resolved = path.relative(root, realpathSync(filename));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 160000 || resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('Invalid comparison package file');
    const scripts = JSON.parse(readFileSync(filename, 'utf8')).scripts || {};
    return typeof scripts === 'object' && !Array.isArray(scripts) ? scripts : {};
  };
}
