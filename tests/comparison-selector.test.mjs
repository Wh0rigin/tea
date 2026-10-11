import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute=promisify(execFile);
const script=fileURLToPath(new URL('../scripts/compare-contextos-pi.mjs',import.meta.url));
test('invalid comparison selections fail before Pi installation, filesystem fixtures or API access', async () => {
  for(const args of [['--groups','unknown'],['--groups','fresh,fresh'],['--scales','huge'],['--scales','small,small']]) {
    await assert.rejects(execute(process.execPath,[script,'--mode','prepare',...args],{windowsHide:true,timeout:10000}),error=>{
      assert.equal(error.code,1);assert.match(error.stderr,/Invalid task selection/);return true;
    });
  }
});
