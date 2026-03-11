import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMigrationSquads } from '../src/migration-squads.js';

test('summarizeMigrationSquads groups migration intents into refugee squads by route', () => {
  const squads = summarizeMigrationSquads([
    {
      id: 'mig-1',
      actorId: 'actor-a',
      sessionId: 'session-a',
      fromTopic: 'topic-alpha',
      toTopic: 'topic-beta',
      triggerEventType: 'great_migration',
      summary: 'Actor A is fleeing toward topic-beta.',
      score: 84,
      status: 'planned',
      source: 'life-worker',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    },
    {
      id: 'mig-2',
      actorId: 'actor-b',
      sessionId: 'session-b',
      fromTopic: 'topic-alpha',
      toTopic: 'topic-beta',
      triggerEventType: 'great_migration',
      summary: 'Actor B is fleeing toward topic-beta.',
      score: 76,
      status: 'planned',
      source: 'life-worker',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:01:00.000Z',
    },
    {
      id: 'mig-3',
      actorId: 'actor-c',
      sessionId: 'session-c',
      fromTopic: 'topic-alpha',
      toTopic: 'topic-gamma',
      triggerEventType: 'resource_drought',
      summary: 'Actor C is probing topic-gamma.',
      score: 48,
      status: 'planned',
      source: 'life-worker',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:02:00.000Z',
    },
  ]);

  assert.equal(squads.length, 2);
  assert.equal(squads[0]?.toTopic, 'topic-beta');
  assert.equal(squads[0]?.actorCount, 2);
  assert.equal(squads[0]?.urgency, 84);
  assert.equal(squads[0]?.status, 'staged');
  assert.equal(squads[1]?.toTopic, 'topic-gamma');
  assert.equal(squads[1]?.status, 'forming');
});
