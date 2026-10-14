import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceTools } from '../src/tools.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-discovery-'));
  try { const tools = new WorkspaceTools({ workspace: root }); await tools.init(); await fn(root, tools); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function files(root, count, content = 'ordinary content\n') {
  for (let start = 0; start < count; start += 50) await Promise.all(Array.from({length: Math.min(50, count - start)}, (_, n) =>
    writeFile(path.join(root, `file-${String(start + n).padStart(4, '0')}.txt`), content)));
}

test('fair discovery reaches arbitrary small sibling and descendant directories before a 700-file cap', async () => {
  await fixture(async (root, tools) => {
    await mkdir(path.join(root, 'warehouse'), {recursive:true}); await files(path.join(root,'warehouse'),850);
    await mkdir(path.join(root,'zz_feature','deep'),{recursive:true});
    await writeFile(path.join(root,'zz_feature','deep','needle.go'),'package feature\nconst restored_cursor = true\n');
    const inventory = await tools.initialInventory({task:'Update restored cursor in needle',limit:8});
    assert.ok(inventory.selectedFiles.includes('zz_feature/deep/needle.go'));
    const output = await tools.searchCode({query:'restored_cursor'});
    assert.match(output,/zz_feature\/deep\/needle.go:2/);
    assert.match(output,/complete=false/);
  });
});

test('default listing is small, explicit pages remain available, and pagination covers all paths', async () => {
  await fixture(async (root, tools) => {
    await files(root,125);
    const output = await tools.listFiles();
    assert.match(output,/32 paths\. nextOffset=32; complete=false/); assert.ok(Buffer.byteLength(output)<2500);
    assert.match(await tools.listFiles({maxFiles:100}),/100 paths\. nextOffset=100/);
    const all=[];let offset=0;
    for(let page=0;page<10;page++){
      const output=await tools.listFiles({offset});all.push(...output.split('\n').slice(1));
      const value=output.match(/nextOffset=(null|\d+)/)[1];if(value==='null')break;offset=Number(value);
    }
    assert.equal(all.length,125);assert.equal(new Set(all).size,125);
    assert.deepEqual(all,await tools.listFilePaths({maxFiles:700}));
  });
});

test('default UTF-8 listing budget retains complete paths and offers lossless continuation', async () => {
  await fixture(async (root, tools) => {
    for(let n=0;n<35;n++)await writeFile(path.join(root,`文件${n}-${'文'.repeat(30)}.txt`),'present');
    const output=await tools.listFiles();assert.ok(Buffer.byteLength(output)<2500);assert.doesNotMatch(output,/�/);
    const names=output.split('\n').slice(1);const next=Number(output.match(/nextOffset=(\d+)/)[1]);
    assert.equal(next,names.length);assert.ok(next<32);
    assert.equal(names.length+(await tools.listFilePaths({offset:next,maxFiles:100})).length,35);
  });
});

test('search file-budget continuation reaches late matches without rescanning the first page', async () => {
  await fixture(async (root, tools) => {
    await files(root,720);await writeFile(path.join(root,'zz-last.py'),'future_match = True\n');
    const first=await tools.searchCode({query:'future_match'});assert.match(first,/No matches/);assert.match(first,/nextOffset=700/);
    const next=await tools.searchCode({query:'future_match',offset:700});assert.match(next,/zz-last.py:1/);assert.match(next,/complete=true/);
  });
});

test('search resumes within a file when a result limit is reached', async () => {
  await fixture(async (root, tools) => {
    await writeFile(path.join(root,'alpha.rs'),'needle one\nneedle two\nneedle three\nneedle four');
    await writeFile(path.join(root,'beta.ts'),'needle five');
    const matches=[];let offset=0,startLine=1;
    for(let n=0;n<10;n++){
      const output=await tools.searchCode({query:'needle',maxResults:2,offset,startLine});
      matches.push(...output.split('\n').filter(line=>/^(alpha.rs|beta.ts):/.test(line)));
      const value=output.match(/nextOffset=(null|\d+)/)[1];if(value==='null')break;
      offset=Number(value);startLine=Number(output.match(/nextLine=(\d+)/)[1]);
    }
    assert.deepEqual(matches,['alpha.rs:1: needle one','alpha.rs:2: needle two','alpha.rs:3: needle three','alpha.rs:4: needle four','beta.ts:1: needle five']);
  });
});

test('filtered directories can be explicitly searched while secrets and agent storage stay excluded', async () => {
  await fixture(async (root, tools) => {
    for(const directory of ['.hidden','node_modules','generated','.tea','.git']){
      await mkdir(path.join(root,directory));await writeFile(path.join(root,directory,'visible.go'),'needle');
    }
    await writeFile(path.join(root,'.env'),'needle secret');
    await writeFile(path.join(root,'credentials.json'),'needle secret');
    const defaultOutput=await tools.searchCode({query:'needle'});assert.match(defaultOutput,/generated\/visible.go/);
    const expanded=await tools.searchCode({query:'needle',includeOmitted:true});
    assert.match(expanded,/\.hidden\/visible.go/);assert.match(expanded,/node_modules\/visible.go/);
    assert.doesNotMatch(expanded,/\.tea\/|\.git\/|credentials|\.env/);
  });
});

test('invalid cursors fail and oversized sources cannot trap continuation on the same file', async () => {
  await fixture(async (root, tools) => {
    for(const args of [{offset:-1},{offset:1.5},{offset:100001},{startLine:0}])await assert.rejects(tools.searchCode({query:'needle',...args}),/offset|startLine/);
    await assert.rejects(tools.listFiles({offset:-1}),/offset/);
    await writeFile(path.join(root,'a-large.txt'),'x'.repeat(160001));await writeFile(path.join(root,'z.txt'),'needle');
    assert.match(await tools.searchCode({query:'needle'}),/z.txt:1/);
  });
});

test('listing offset exhaustion does not publish an invalid continuation or claim completeness', async () => {
  const tools = new WorkspaceTools({workspace: process.cwd()});
  tools.listFilePaths = async () => ['one.txt','two.txt'];
  const output = await tools.listFiles({offset:100000,maxFiles:1});
  assert.match(output,/nextOffset=null; complete=false/);assert.match(output,/Offset limit reached; narrow path/);
});

test('small inventories keep previous schemas until a real search needs continuation', async () => {
  await fixture(async(root,tools)=>{
    await writeFile(path.join(root,'small.go'),'needle one\nneedle two\nneedle three');
    await tools.initialInventory({task:'needle'});
    const before=tools.modelToolDefinitions().find(tool=>tool.name==='search_code');
    assert.equal(before.input_schema.properties.offset,undefined);
    await tools.searchCode({query:'needle',maxResults:1});
    const after=tools.modelToolDefinitions().find(tool=>tool.name==='search_code');
    assert.equal(after.input_schema.properties.offset.type,'integer');
    assert.equal(after.input_schema.properties.startLine.type,'integer');
  });
});
