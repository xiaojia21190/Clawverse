import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRingConfig } from '../src/ring-config.js';

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('loadRingConfig reads ring federation settings from file and includes current topic', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-ring-config-'));

  try {
    mkdirSync(join(root, 'data', 'ring'), { recursive: true });
    writeFileSync(join(root, 'data', 'ring', 'ring.json'), JSON.stringify({
      topics: ['topic-alpha', 'topic-beta'],
      selfBaseUrl: 'http://home.local/',
      peerTtlMs: 240000,
      mirrorPollMs: 45000,
      mirrorSources: [{ topic: 'topic-alpha', baseUrl: 'http://alpha.local/' }],
      mirrorPushMs: 90000,
      mirrorTargets: [{ baseUrl: 'http://beta.local/' }],
    }, null, 2));

    const config = withEnv({
      CLAWVERSE_PROJECT_ROOT: root,
      CLAWVERSE_RING_CONFIG_PATH: 'data/ring/ring.json',
      CLAWVERSE_RING_SELF_URL: undefined,
      CLAWVERSE_RING_TOPICS: undefined,
      CLAWVERSE_RING_MIRROR_SOURCES: undefined,
      CLAWVERSE_RING_PEER_TTL_MS: undefined,
      CLAWVERSE_RING_MIRROR_POLL_MS: undefined,
      CLAWVERSE_RING_MIRROR_PUSH_MS: undefined,
      CLAWVERSE_RING_MIRROR_TARGETS: undefined,
    }, () => loadRingConfig('topic-home'));

    assert.deepEqual(config, {
      topics: ['topic-alpha', 'topic-beta', 'topic-home'],
      selfBaseUrl: 'http://home.local/',
      peerTtlMs: 240000,
      mirrorPollMs: 45000,
      mirrorSources: [{ topic: 'topic-alpha', baseUrl: 'http://alpha.local' }],
      mirrorPushMs: 90000,
      mirrorTargets: [{ baseUrl: 'http://beta.local' }],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadRingConfig lets environment overrides replace file values', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-ring-config-'));

  try {
    mkdirSync(join(root, 'data', 'ring'), { recursive: true });
    writeFileSync(join(root, 'data', 'ring', 'ring.json'), JSON.stringify({
      topics: ['topic-alpha'],
      selfBaseUrl: 'http://home.local/',
      peerTtlMs: 240000,
      mirrorPollMs: 45000,
      mirrorSources: [{ topic: 'topic-alpha', baseUrl: 'http://alpha.local/' }],
      mirrorPushMs: 90000,
      mirrorTargets: [{ baseUrl: 'http://beta.local/' }],
    }, null, 2));

    const config = withEnv({
      CLAWVERSE_PROJECT_ROOT: root,
      CLAWVERSE_RING_CONFIG_PATH: 'data/ring/ring.json',
      CLAWVERSE_RING_SELF_URL: 'http://override.local/',
      CLAWVERSE_RING_TOPICS: 'topic-gamma,topic-delta',
      CLAWVERSE_RING_MIRROR_SOURCES: 'topic-gamma=http://gamma.local/',
      CLAWVERSE_RING_PEER_TTL_MS: '180000',
      CLAWVERSE_RING_MIRROR_POLL_MS: '30000',
      CLAWVERSE_RING_MIRROR_PUSH_MS: '120000',
      CLAWVERSE_RING_MIRROR_TARGETS: 'http://delta.local/',
    }, () => loadRingConfig('topic-home'));

    assert.deepEqual(config, {
      topics: ['topic-gamma', 'topic-delta', 'topic-home'],
      selfBaseUrl: 'http://override.local/',
      peerTtlMs: 180000,
      mirrorPollMs: 30000,
      mirrorSources: [{ topic: 'topic-gamma', baseUrl: 'http://gamma.local' }],
      mirrorPushMs: 120000,
      mirrorTargets: [{ baseUrl: 'http://delta.local' }],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
