import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capabilityNotice, runtimeCapabilities } from '../src/tool-feedback.mjs';
import { WorkspaceTools } from '../src/tools.mjs';

test('Windows notice distinguishes allowlisted quote restrictions from explicitly approved unlisted quoting', async () => {
  const notice = capabilityNotice(runtimeCapabilities({ platform: 'win32', approveCommand: () => true }));
  assert.match(notice, /Windows [^.]*\b(?:allowlisted|allowlist)\b/i);
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'tea-notice-scope-'));
  const tools = new WorkspaceTools({ workspace });
  await tools.init();
  let approvals = 0;
  tools.approveCommand = () => { approvals++; return true; };
  const output = await tools.runShell({ command: 'node -e "process.stdout.write(String(42))"' });
  assert.match(output, /^exit=0\b/); assert.match(output, /42/); assert.equal(approvals, 1);
  if (process.platform === 'win32') {
    await assert.rejects(tools.runShell({ command: 'node --test "fixture.test.mjs"' }), error => error.feedbackCode === 'CAPABILITY_DENIED');
    assert.equal(approvals, 1, 'Allowlisted Windows quoting is blocked before approval');
  }
});
