import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_SQLITE_PATH = 'data/state/clawverse.db';
const dbPool = new Map<string, { db: DatabaseSync; refs: number }>();

export interface ClawverseDbHandle {
  db: DatabaseSync;
  path: string;
  close(): void;
}

export function getDefaultSqlitePath(): string {
  return process.env.CLAWVERSE_SQLITE_PATH || DEFAULT_SQLITE_PATH;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS state_snapshots (
      snapshot_key TEXT PRIMARY KEY,
      saved_at TEXT NOT NULL,
      update_base64 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_relationships (
      peer_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_pending (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      resolved INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS economy_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      compute REAL NOT NULL,
      storage REAL NOT NULL,
      bandwidth REAL NOT NULL,
      reputation REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS needs_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      social REAL NOT NULL,
      tasked REAL NOT NULL,
      wanderlust REAL NOT NULL,
      creative REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS economy_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      amount REAL NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_buildings (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collab_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      dir TEXT NOT NULL,
      task_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collab_stats (
      peer_id TEXT PRIMARY KEY,
      tasks_received INTEGER NOT NULL,
      tasks_sent INTEGER NOT NULL,
      success_count INTEGER NOT NULL,
      reputation_delta INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS life_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      event_type TEXT NOT NULL,
      resolved INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evolution_episodes (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      variant TEXT NOT NULL,
      success INTEGER NOT NULL,
      latency_ms REAL NOT NULL,
      token_total INTEGER,
      cost_usd REAL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_episodes_variant
      ON evolution_episodes(variant);
    CREATE INDEX IF NOT EXISTS idx_evolution_episodes_ts
      ON evolution_episodes(ts);
  `);
}

export function openClawverseDb(dbPath?: string): ClawverseDbHandle {
  const resolvedPath = resolve(process.cwd(), dbPath || getDefaultSqlitePath());
  let slot = dbPool.get(resolvedPath);
  if (!slot) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    const db = new DatabaseSync(resolvedPath);
    initSchema(db);
    slot = { db, refs: 0 };
    dbPool.set(resolvedPath, slot);
  }

  slot.refs += 1;

  return {
    db: slot.db,
    path: resolvedPath,
    close: () => {
      const current = dbPool.get(resolvedPath);
      if (!current) return;
      current.refs -= 1;
      if (current.refs <= 0) {
        try {
          current.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        } catch {
          // ignore checkpoint errors on shutdown
        }
        current.db.close();
        dbPool.delete(resolvedPath);
      }
    },
  };
}
