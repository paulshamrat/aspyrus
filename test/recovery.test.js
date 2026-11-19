import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const recovery = require('../src/recovery.cjs');

test('recovery survives reload, deduplicates and keeps saved versions apart from drafts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localleaf-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'main.tex');
  fs.writeFileSync(file, 'Original manuscript');
  recovery.checkpoint(root, file, 'Original manuscript');
  recovery.checkpoint(root, file, 'Original manuscript');
  for (let i = 0; i < 105; i++) recovery.checkpoint(root, file, `Draft ${i}`, 'draft');
  delete require.cache[require.resolve('../src/recovery.cjs')];
  const reloaded = require('../src/recovery.cjs');
  const entries = reloaded.list(root, file);
  assert.equal(entries.filter((entry) => entry.kind === 'saved').length, 1);
  assert.equal(entries.filter((entry) => entry.kind === 'draft').length, 100);
  assert.ok(entries.some((entry) => entry.content === 'Original manuscript'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'Original manuscript');
  const alias = path.join(root, 'alias.tex');
  fs.symlinkSync(file, alias);
  assert.deepEqual(reloaded.list(root, alias), entries);
});
