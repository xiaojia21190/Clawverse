import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import type { TopicClusterSnapshot } from './cluster-scorer.js';

export class ClusterRegistry {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly clusters = new Map<string, TopicClusterSnapshot>();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  list(topic?: string): TopicClusterSnapshot[] {
    return Array.from(this.clusters.values())
      .filter((cluster) => !topic || cluster.topic === topic)
      .sort((left, right) =>
        Number(right.local) - Number(left.local)
        || right.stability - left.stability
        || right.actorCount - left.actorCount
        || left.label.localeCompare(right.label)
      )
      .map((cluster) => ({
        ...cluster,
        center: { ...cluster.center },
        actorIds: [...cluster.actorIds],
        reasons: [...cluster.reasons],
      }));
  }

  replaceTopic(topic: string, clusters: TopicClusterSnapshot[]): TopicClusterSnapshot[] {
    const normalizedTopic = topic.trim();
    const nextIds = new Set<string>();
    const normalized = clusters.map((cluster) => {
      const record: TopicClusterSnapshot = {
        ...cluster,
        topic: normalizedTopic,
        center: { ...cluster.center },
        actorIds: [...cluster.actorIds],
        reasons: [...cluster.reasons],
      };
      nextIds.add(record.id);
      this.clusters.set(record.id, record);
      this._save(record);
      return record;
    });

    for (const [id, cluster] of this.clusters.entries()) {
      if (cluster.topic !== normalizedTopic) continue;
      if (nextIds.has(id)) continue;
      this.clusters.delete(id);
      this.dbHandle.db.prepare(`
        DELETE FROM world_clusters
        WHERE id = ?
      `).run(id);
    }

    return normalized;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM world_clusters
    `).all() as Array<{ payload_json: string }>;

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json) as TopicClusterSnapshot;
        if (!payload?.id || !payload?.topic) continue;
        this.clusters.set(payload.id, {
          ...payload,
          center: { ...payload.center },
          actorIds: [...payload.actorIds],
          reasons: [...payload.reasons],
        });
      } catch {
        // ignore malformed rows
      }
    }
  }

  private _save(record: TopicClusterSnapshot): void {
    this.dbHandle.db.prepare(`
      INSERT INTO world_clusters (id, topic, updated_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      record.id,
      record.topic,
      record.updatedAt,
      JSON.stringify(record),
    );
  }
}
