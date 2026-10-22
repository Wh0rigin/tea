import { exportDeepSweArtifact } from './lib/deepswe-artifacts.mjs';

const options = {};
const names = { '--workspace':'workspace', '--base-commit':'baseCommit', '--output':'artifactDirectory' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!names[args[i]] || !args[i + 1] || options[names[args[i]]]) throw new Error('Expected --workspace PATH --base-commit SHA --output DIRECTORY');
  options[names[args[i]]] = args[i + 1];
}
if (Object.keys(options).length !== 3) throw new Error('Expected --workspace PATH --base-commit SHA --output DIRECTORY');
console.log(JSON.stringify(await exportDeepSweArtifact(options)));
