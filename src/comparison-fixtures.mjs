import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const command = promisify(execFile);

export async function assertNoAncestorInstructions(workspace) {
  const names = ['AGENTS.override.md','AGENTS.md','AGENTS.MD','CLAUDE.md','CLAUDE.MD'];
  let directory = path.dirname(path.resolve(workspace));
  while (true) {
    for (const name of names) {
      const info = await stat(path.join(directory,name)).catch(error => { if(error.code==='ENOENT')return null;throw error; });
      if(info?.isFile())throw new Error('Unexpected ancestor context file outside the fixture; use a clean external workspace directory');
    }
    const parent = path.dirname(directory);
    if(parent===directory)break;
    directory=parent;
  }
  return true;
}
export const SCALES = [{ name: 'small', files: 12 }, { name: 'medium', files: 120 }, { name: 'large', files: 1200 }];
const FAMILIES = [
  { name: 'cache-key', entry: 'src/services/cache-key.mjs',
    prompt: 'Fix cache key collisions between values of different primitive types. Preserve object key order independence and the current API. Read the project instructions, make the smallest relevant change, and run the public tests.',
    source: `export function cacheKey(value) {\n  if (value && typeof value === 'object' && !Array.isArray(value)) {\n    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + cacheKey(value[key])).join(',') + '}';\n  }\n  if (Array.isArray(value)) return '[' + value.map(cacheKey).join(',') + ']';\n  return String(value);\n}\n`,
    public: `assert.equal(cacheKey({b:2,a:1}), cacheKey({a:1,b:2}));\nassert.notEqual(cacheKey({a:1}), cacheKey({a:2}));\n`,
    hidden: `for (const [a,b] of [[1,'1'],[false,'false'],[null,'null'],[true,'true'],[[1],['1']]]) assert.notEqual(cacheKey(a),cacheKey(b));\nassert.equal(cacheKey({nested:{z:2,a:1}}),cacheKey({nested:{a:1,z:2}}));\n`, export: 'cacheKey' },
  { name: 'retry-budget', entry: 'src/services/retry-budget.mjs',
    prompt: 'Fix the retry budget logic: zero retries must still allow the initial attempt, and a budget of N retries permits N+1 total attempts. Preserve immediate success and do not swallow the last error. Read the project instructions and run the public tests.',
    source: `export async function retry(operation, retries) {\n  let last;\n  for (let attempt = 0; attempt < retries; attempt++) {\n    try { return await operation(attempt); } catch (error) { last = error; }\n  }\n  throw last || new Error('No attempt made');\n}\n`,
    public: `assert.equal(await retry(async () => 7,2),7);\nlet attempts=0;\nassert.equal(await retry(async () => { if (++attempts===1) throw new Error('retry'); return 3; },2),3);\n`,
    hidden: `assert.equal(await retry(async () => 9,0),9);\nfor (const budget of [0,1,2,4]) { let attempts=0; const error=new Error('last'); await assert.rejects(retry(async () => { attempts++; throw error; },budget),e=>e===error); assert.equal(attempts,budget+1); }\n`, export: 'retry' },
  { name: 'unicode', entry: 'src/services/text.mjs',
    prompt: 'Make the text truncation utility count Unicode code points instead of UTF-16 code units, including astral characters. Keep zero limits and shorter strings correct. Read the project instructions, preserve the API, and run the public tests.',
    source: `export function truncateText(text, limit) {\n  return text.slice(0,Math.max(0,limit));\n}\n`,
    public: `assert.equal(truncateText('hello',3),'hel');\nassert.equal(truncateText('hi',5),'hi');\nassert.equal(truncateText('hi',0),'');\n`,
    hidden: `assert.equal(truncateText('A\u{1f680}B',2),'A\u{1f680}');\nassert.equal(truncateText('\u{1f600}\u{1f603}Z',1),'\u{1f600}');\nassert.equal(truncateText('你好\u{1f680}abc',3),'你好\u{1f680}');\nassert.equal(truncateText('\u{1f600}',0),'');\n`, export: 'truncateText' },
];

export function taskDefinitions() {
  return SCALES.flatMap(scale => FAMILIES.map(family => ({ ...family, taskId: `${scale.name}-${family.name}`, scale: scale.name, targetFileCount: scale.files })));
}

export async function treeFingerprint(root) {
  const files = [];
  const walk = async directory => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === '.tea') continue;
      const full = path.join(directory,entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push([path.relative(root,full).replaceAll(path.sep,'/'),await readFile(full)]);
      else throw new Error('Fixture contains a non-regular entry');
    }
  };
  await walk(root);
  const hash = createHash('sha256');
  let bytes=0, lines=0;
  for (const [filename,content] of files) { hash.update(filename); hash.update('\0'); hash.update(content); hash.update('\0'); bytes+=content.length; lines+=content.toString('utf8').split('\n').length-1; }
  return { sha256:hash.digest('hex'),fileCount:files.length,bytes,lines };
}

export async function prepareFixture(root, definition) {
  const put = async (filename,source) => { const full=path.join(root,filename); await mkdir(path.dirname(full),{recursive:true}); await writeFile(full,source,'utf8'); };
  await mkdir(root,{recursive:true});
  await put('AGENTS.md', 'Modify only the relevant existing service implementation. Do not edit tests, project instructions, package configuration, or unrelated modules. Do not add dependencies. Run node --test tests/public.test.mjs after your change. The repository contains unrelated generated domain modules; discover relevant files as needed.\n');
  await put('README.md', '# Modular service project\n\nService implementations live under src/services. Unrelated domain data and utilities live under src/generated. The public suite is node --test tests/public.test.mjs.\n');
  await put('package.json', JSON.stringify({name:definition.taskId,version:'1.0.0',private:true,type:'module',license:'MIT',scripts:{test:'node --test tests/public.test.mjs'}},null,2)+'\n');
  await put(definition.entry,definition.source);
  await put('tests/public.test.mjs',`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${definition.export} } from '../${definition.entry}';\ntest('existing API',async()=>{\n${definition.public}});\n`);
  for (let index=0;index<definition.targetFileCount-5;index++) {
    const id=String(index).padStart(4,'0');
    await put(`src/generated/domain-${String(index%12).padStart(2,'0')}/module-${id}.mjs`, `// Unrelated domain utility ${id}.\nexport const defaults${index} = Object.freeze({ enabled: true, region: 'region-${index%12}', version: ${index} });\nexport function normalize${index}(rows) {\n  return rows.filter(row => row.enabled !== false).map(row => ({\n    id: String(row.id), weight: Number(row.weight || 0), region: row.region || defaults${index}.region\n  })).sort((a,b) => a.weight-b.weight || a.id.localeCompare(b.id));\n}\nexport function aggregate${index}(rows) {\n  const totals = new Map();\n  for (const row of normalize${index}(rows)) totals.set(row.region,(totals.get(row.region)||0)+row.weight);\n  return Object.fromEntries(totals);\n}\n`);
  }
  const git = async args => (await command('git',args,{cwd:root,windowsHide:true,env:{...process.env,GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'}})).stdout.trim();
  await git(['-c','init.defaultBranch=main','init','-q']);
  await git(['-c','core.autocrlf=false','add','--all']);
  await git(['-c','user.name=TEA benchmark','-c','user.email=benchmark@example.invalid','-c','commit.gpgsign=false','commit','-q','-m','Pinned comparison fixture']);
  const commit=await git(['rev-parse','HEAD']);
  return {commit,...await treeFingerprint(root)};
}

export async function cloneFixture(source,destination) {
  await command('git',['-c','core.autocrlf=false','clone','--no-local','--quiet',source,destination],{windowsHide:true});
}
