import type { MigrationIntentRecord } from './migration-registry.js';

export interface RefugeeSquadSnapshot {
  id: string;
  fromTopic: string;
  toTopic: string;
  actorIds: string[];
  actorCount: number;
  urgency: number;
  averageScore: number;
  triggerEventType: string;
  status: 'forming' | 'staged';
  summary: string;
  updatedAt: string;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
}

export function summarizeMigrationSquads(intents: MigrationIntentRecord[]): RefugeeSquadSnapshot[] {
  const groups = new Map<string, MigrationIntentRecord[]>();

  for (const intent of intents) {
    const key = `${intent.fromTopic}::${intent.toTopic}`;
    const list = groups.get(key);
    if (list) list.push(intent);
    else groups.set(key, [intent]);
  }

  return Array.from(groups.entries()).map(([key, squadIntents]) => {
    const actorIds = Array.from(new Set(squadIntents.map((intent) => intent.actorId))).sort();
    const totalScore = squadIntents.reduce((sum, intent) => sum + intent.score, 0);
    const averageScore = clamp(Math.round(totalScore / Math.max(1, squadIntents.length)));
    const urgency = clamp(Math.max(...squadIntents.map((intent) => intent.score)));
    const lead = [...squadIntents].sort((left, right) => right.score - left.score || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? squadIntents[0];
    const updatedAt = [...squadIntents]
      .map((intent) => Date.parse(intent.updatedAt))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0];
    const triggerCounts = new Map<string, number>();
    for (const intent of squadIntents) {
      triggerCounts.set(intent.triggerEventType, (triggerCounts.get(intent.triggerEventType) ?? 0) + 1);
    }
    const triggerEventType = [...triggerCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'migration';

    return {
      id: `sqd-${hashString(`${key}:${actorIds.join('|')}`)}`,
      fromTopic: lead?.fromTopic ?? '',
      toTopic: lead?.toTopic ?? '',
      actorIds,
      actorCount: actorIds.length,
      urgency,
      averageScore,
      triggerEventType,
      status: actorIds.length >= 3 || urgency >= 75 ? 'staged' : 'forming',
      summary: lead?.summary ?? 'A refugee squad is attempting to migrate.',
      updatedAt: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : new Date().toISOString(),
    } satisfies RefugeeSquadSnapshot;
  }).sort((left, right) =>
    right.urgency - left.urgency
    || right.actorCount - left.actorCount
    || left.toTopic.localeCompare(right.toTopic)
  );
}
