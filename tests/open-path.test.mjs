import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstUsableDirectory,
  isUsableDirectory
} from '../src/open-path.mjs';

test('falls back when a remembered directory no longer exists', async () => {
  const calls = [];
  const stat = async (candidate) => {
    calls.push(candidate);

    if (candidate === 'Z:\\offline-share') {
      const error = new Error('Network path unavailable');
      error.code = 'ENOENT';
      throw error;
    }

    if (candidate === 'C:\\Users\\demo\\Documents') {
      return { isDirectory: () => true };
    }

    throw new Error('Unexpected candidate');
  };

  const selected = await firstUsableDirectory(
    ['Z:\\offline-share', 'C:\\Users\\demo\\Documents'],
    { stat, timeoutMs: 50 }
  );

  assert.equal(selected, 'C:\\Users\\demo\\Documents');
  assert.deepEqual(calls, ['Z:\\offline-share', 'C:\\Users\\demo\\Documents']);
});

test('does not block forever on an unavailable network directory', async () => {
  const stat = async (candidate) => {
    if (candidate === '\\\\nas\\slow-share') {
      return new Promise(() => {});
    }

    return { isDirectory: () => true };
  };

  const started = Date.now();
  const selected = await firstUsableDirectory(
    ['\\\\nas\\slow-share', 'C:\\fallback'],
    { stat, timeoutMs: 20 }
  );

  assert.equal(selected, 'C:\\fallback');
  assert.ok(Date.now() - started < 250);
});

test('rejects files and invalid candidates as open-dialog directories', async () => {
  const stat = async () => ({ isDirectory: () => false });

  assert.equal(await isUsableDirectory('', { stat, timeoutMs: 20 }), false);
  assert.equal(await isUsableDirectory('C:\\file.html', { stat, timeoutMs: 20 }), false);
});
