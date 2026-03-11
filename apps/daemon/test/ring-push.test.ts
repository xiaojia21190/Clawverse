import test from 'node:test';
import assert from 'node:assert/strict';
import { RingMirrorPusher } from '../src/ring-push.js';

test('ring mirror pusher posts local topic summary to configured targets', async () => {
  const requests: Array<{ url: string; body: unknown; method: string | undefined }> = [];
  const pusher = new RingMirrorPusher({
    targets: [{ baseUrl: 'http://mirror-beta.local/' }],
    intervalMs: 60_000,
    payload: () => ({
      topic: 'topic-home',
      baseUrl: 'http://home.local',
      actorCount: 5,
      branchCount: 8,
      brainStatus: 'authoritative',
      updatedAt: '2026-03-08T11:00:00.000Z',
      source: 'imported',
    }),
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await pusher.syncNow();

  assert.deepEqual(requests, [
    {
      url: 'http://mirror-beta.local/world/ring/mirror',
      method: 'POST',
      body: {
        topic: 'topic-home',
        baseUrl: 'http://home.local',
        actorCount: 5,
        branchCount: 8,
        brainStatus: 'authoritative',
        updatedAt: '2026-03-08T11:00:00.000Z',
        source: 'imported',
      },
    },
  ]);

  pusher.stop();
});
