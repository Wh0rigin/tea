import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceTools, TOOL_DEFINITIONS } from '../src/tools.mjs';
import { loadCliConfig } from '../src/config.mjs';
import { runtimeCapabilities, capabilityNotice } from '../src/tool-feedback.mjs';

test('S1 guidance is opt-in and describes create-only versus existing-file editing', () => {
  assert.equal(loadCliConfig({},{}).editGuidance,false);
  assert.equal(loadCliConfig({editGuidance:true},{}).editGuidance,true);
  const standard=new WorkspaceTools({workspace:process.cwd()}),guided=new WorkspaceTools({workspace:process.cwd(),editGuidance:true});
  const original=JSON.stringify(TOOL_DEFINITIONS),before=standard.modelToolDefinitions(),after=guided.modelToolDefinitions();
  assert.match(after.find(x=>x.name==='write_file').description,/CREATE ONLY/);
  assert.match(after.find(x=>x.name==='apply_patch').description,/EXISTING/);
  assert.deepEqual(after.map(x=>x.input_schema),before.map(x=>x.input_schema));
  assert.equal(JSON.stringify(TOOL_DEFINITIONS),original);
  assert.notEqual(runtimeCapabilities({fileCreation:true}).version,runtimeCapabilities({fileCreation:true,editGuidance:true}).version);
  assert.match(capabilityNotice(runtimeCapabilities({fileCreation:true,editGuidance:true})),/already exist/);
});

test('S1 preserves evidence fingerprints, exact patches and overwrite refusal', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'tea-s1-guidance-'));
  try {
    await writeFile(path.join(root,'value.mjs'),'export const value = 1;\n');
    const tools=new WorkspaceTools({workspace:root,editGuidance:true});await tools.init();
    const read=await tools.readFile({path:'value.mjs'});
    assert.match(read,/^\[evidence ref=[^\n]+ sha256=[a-f0-9]{64}\]\nExisting file: edit with apply_patch\./);
    assert.match(read,/1: export const value = 1;/);
    await assert.rejects(tools.writeFile({path:'value.mjs',content:'replace'}),/already exists; no write occurred/);
    assert.equal(await readFile(path.join(root,'value.mjs'),'utf8'),'export const value = 1;\n');
    await tools.applyPatch({path:'value.mjs',search:'value = 1',replace:'value = 2'});
    assert.match(await readFile(path.join(root,'value.mjs'),'utf8'),/value = 2/);
  } finally {
    const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root));assert.ok(relative.startsWith('tea-s1-guidance-')&&!relative.includes(path.sep));
    await rm(root,{recursive:true,force:true});
  }
});
