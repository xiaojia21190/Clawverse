import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackAddress, normalizeRemoteAddress, resolveRequestOperatorKind } from '../src/request-origin.js';

test('resolveRequestOperatorKind prefers explicit source tags', () => {
  assert.equal(resolveRequestOperatorKind('town-viewer', null, null), 'town-viewer');
  assert.equal(resolveRequestOperatorKind('life-worker', null, null), 'openclaw-worker');
  assert.equal(resolveRequestOperatorKind('daemon-policy', null, null), 'daemon-policy');
  assert.equal(resolveRequestOperatorKind('manual-cli', null, null), 'manual-cli');
});

test('resolveRequestOperatorKind recognizes browser and cli fallback signals', () => {
  assert.equal(
    resolveRequestOperatorKind(
      null,
      'http://127.0.0.1:5173',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    ),
    'town-viewer',
  );
  assert.equal(
    resolveRequestOperatorKind(null, null, 'curl/8.1.0'),
    'manual-cli',
  );
  assert.equal(
    resolveRequestOperatorKind('mystery-source', 'https://example.com', 'strange-agent'),
    'unknown',
  );
});

test('loopback helpers normalize and detect local addresses', () => {
  assert.equal(normalizeRemoteAddress(undefined), 'unknown');
  assert.equal(normalizeRemoteAddress(' 127.0.0.1 '), '127.0.0.1');
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);
});
