import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('project declares and ships MIT licensing metadata', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const license = await fs.readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  const notices = await fs.readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');

  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.build.files.includes('LICENSE'));
  assert.ok(pkg.build.files.includes('THIRD_PARTY_NOTICES.md'));
  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 antidark0605/);
  assert.match(notices, /Electron/);
  assert.match(notices, /BSD-3-Clause/);
  assert.match(notices, /Apache-2\.0/);
});
