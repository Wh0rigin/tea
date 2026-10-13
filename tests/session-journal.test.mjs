import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, appendFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionJournal, workspaceIdentity, listSessions, deleteSession } from '../src/session-journal.mjs';

async function scenario(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tea-journal-'));
  try { await writeFile(path.join(root, 'code.mjs'), 'export const value = 1;'); await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test('encrypted journal round-trips signed blocks and arbitrary Unicode exactly', async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'roundtrip' });
  const message = { role: 'assistant', content: [{ type: 'thinking', thinking: '秘密🚀', signature: 'signed-verbatim' }, { type: 'text', text: '中文\uFFFD' }] };
  await journal.append('message', message); await journal.close();
  const resumed = await SessionJournal.open({ workspace: root, id: 'roundtrip', resume: true });
  try { assert.deepEqual((await resumed.events())[0].value, message); assert.equal(resumed.rows[0].eventId, 'e00000001'); }
  finally { await resumed.close(); }
}));
test('content-addressed payloads deduplicate without plaintext secrets on disk', async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'encrypted' });
  const secret = 'sk-this-is-an-intentionally-fake-test-credential';
  try {
    await journal.append('message', { secret }); await journal.append('message', { secret });
    assert.equal(journal.rows[0].artifact, journal.rows[1].artifact);
    assert.equal((await readdir(journal.artifacts)).length, 1);
    for (const filename of [journal.logPath, path.join(journal.artifacts, journal.rows[0].artifact + '.bin')]) {
      assert.equal((await readFile(filename)).includes(Buffer.from(secret)), false);
    }
  } finally { await journal.close(); }
}));
test('restart discards an unterminated crash tail and preserves committed rows', async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'tail' });
  await journal.append('note', { text: 'committed' }); const log = journal.logPath; await journal.close();
  await appendFile(log, '{"schema":1,"unfinished":');
  const resumed = await SessionJournal.open({ workspace: root, id: 'tail', resume: true });
  try {
    assert.ok(resumed.recoveredTailBytes > 0); assert.equal(resumed.rows.length, 1);
    await resumed.append('note', { text: 'next' }); assert.equal(resumed.rows[1].seq, 2);
  } finally { await resumed.close(); }
  const again = await SessionJournal.open({ workspace: root, id: 'tail', resume: true });
  try { assert.equal(again.rows.length, 2); assert.equal(again.recoveredTailBytes, undefined); } finally { await again.close(); }
}));
test('a corrupt complete row fails closed and is never silently truncated', async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'corrupt' });
  await journal.append('note', { value: 1 }); const log = journal.logPath; await journal.close();
  const original = await readFile(log, 'utf8'); await writeFile(log, original.replace('"seq":1', '"seq":2'));
  await assert.rejects(SessionJournal.open({ workspace: root, id: 'corrupt', resume: true }), /integrity/);
  assert.match(await readFile(log, 'utf8'), /"seq":2/);
}));
for (const mode of ['missing', 'corrupt']) test(`${mode} committed artifact prevents resume`, async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'payload' });
  await journal.append('note', { value: 1 }); const filename = path.join(journal.artifacts, journal.rows[0].artifact + '.bin'); await journal.close();
  if (mode === 'missing') await rm(filename); else await writeFile(filename, Buffer.from('bad'));
  await assert.rejects(SessionJournal.open({ workspace: root, id: 'payload', resume: true }));
}));
test('writer lock prevents two sessions from modifying the same journal', async () => scenario(async root => {
  const first = await SessionJournal.open({ workspace: root, id: 'locked' });
  try { await assert.rejects(SessionJournal.open({ workspace: root, id: 'locked', resume: true }), /already open/); }
  finally { await first.close(); }
  const second = await SessionJournal.open({ workspace: root, id: 'locked', resume: true }); await second.close();
}));
test('duplicate create and invalid IDs cannot overwrite or escape sessions', async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'safe' }); await journal.append('note', { value: 1 }); await journal.close();
  await assert.rejects(SessionJournal.open({ workspace: root, id: 'safe' }), /EEXIST/);
  for (const id of ['..', '../escape', 'C:\\escape', 'CON', 'unsafe.']) await assert.rejects(SessionJournal.open({ workspace: root, id }));
  const resumed = await SessionJournal.open({ workspace: root, id: 'safe', resume: true });
  try { assert.equal(resumed.rows.length, 1); } finally { await resumed.close(); }
}));
test('concurrent appends commit in a stable ordered hash chain', async () => scenario(async root => {
  const journal = await SessionJournal.open({ workspace: root, id: 'ordered' });
  try { await Promise.all(Array.from({ length: 20 }, (_, n) => journal.append('note', { n }))); }
  finally { await journal.close(); }
  const resumed = await SessionJournal.open({ workspace: root, id: 'ordered', resume: true });
  try { assert.deepEqual((await resumed.events()).map(event => event.value.n), Array.from({ length: 20 }, (_, n) => n)); }
  finally { await resumed.close(); }
}));
test('workspace fingerprint changes with content, ignores local agent storage', async () => scenario(async root => {
  const first = await workspaceIdentity(root);
  const journal = await SessionJournal.open({ workspace: root, id: 'fingerprint' }); await journal.append('note', {}); await journal.close();
  assert.deepEqual(await workspaceIdentity(root), first);
  await writeFile(path.join(root, 'code.mjs'), 'export const value = 2;');
  assert.notEqual((await workspaceIdentity(root)).filesSha256, first.filesSha256);
}));
test('list and cleanup operate only on the named unlocked session', async () => scenario(async root => {
  for (const id of ['keep', 'remove']) { const journal = await SessionJournal.open({ workspace: root, id }); await journal.close(); }
  assert.equal((await listSessions(root)).length, 2);
  await deleteSession(root, 'remove'); assert.deepEqual((await listSessions(root)).map(row => row.id), ['keep']);
  assert.match(await readFile(path.join(root, 'code.mjs'), 'utf8'), /value = 1/);
  await assert.rejects(deleteSession(root, '../keep'));
}));
test('storage symlinks are rejected before external writes', async t => scenario(async root => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'tea-journal-outside-'));
  try {
    try { await symlink(target, path.join(root, '.tea'), 'junction'); }
    catch (error) { if (error.code === 'EPERM') { t.skip('Symlink permission unavailable'); return; } throw error; }
    await assert.rejects(SessionJournal.open({ workspace: root, id: 'escape' }), /symlink/);
    assert.deepEqual(await readdir(target), []);
  } finally { await rm(target, { recursive: true, force: true }); }
}));
