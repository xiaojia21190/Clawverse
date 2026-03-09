import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveProjectPath } from './paths.js';

const DEFAULT_SQLITE_PATH = 'data/state/clawverse.db';
const dbPool = new Map<string, { db: DatabaseSync; refs: number }>();

export interface ClawverseDbHandle {
  db: DatabaseSync;
  path: string;
  close(): void;
}

export function getDefaultSqlitePath(): string {
  return resolveProjectPath(process.env.CLAWVERSE_SQLITE_PATH || DEFAULT_SQLITE_PATH);
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

    CREATE TABLE IF NOT EXISTS economy_inventory (
      item_id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS economy_production_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      founder_id TEXT NOT NULL,
      motto TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS faction_members (
      peer_id TEXT PRIMARY KEY,
      faction_id TEXT NOT NULL,
      joined_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS faction_wars (
      id TEXT PRIMARY KEY,
      faction_a TEXT NOT NULL,
      faction_b TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS faction_alliances (
      id TEXT PRIMARY KEY,
      faction_a TEXT NOT NULL,
      faction_b TEXT NOT NULL,
      formed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_renewed_at TEXT,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS faction_vassalages (
      id TEXT PRIMARY KEY,
      overlord_id TEXT NOT NULL,
      vassal_id TEXT NOT NULL,
      formed_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS faction_tributes (
      id TEXT PRIMARY KEY,
      vassalage_id TEXT NOT NULL,
      overlord_id TEXT NOT NULL,
      vassal_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      amount REAL NOT NULL,
      collected_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_faction_tributes_vassalage
      ON faction_tributes(vassalage_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_faction_tributes_overlord
      ON faction_tributes(overlord_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_faction_tributes_vassal
      ON faction_tributes(vassal_id, collected_at DESC);

    CREATE TABLE IF NOT EXISTS pending_trades (
      trade_id TEXT PRIMARY KEY,
      from_peer_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      amount REAL NOT NULL,
      resource_want TEXT NOT NULL,
      amount_want REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs_queue (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      priority INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      source_event_type TEXT,
      dedupe_key TEXT,
      note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_queue_status_priority
      ON jobs_queue(status, priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_jobs_queue_dedupe
      ON jobs_queue(dedupe_key, status);

    CREATE TABLE IF NOT EXISTS combat_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS combat_logs (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_combat_logs_ts
      ON combat_logs(ts DESC);

    CREATE TABLE IF NOT EXISTS economy_inventory (
      item_id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS economy_production_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  const allianceColumns = db.prepare('PRAGMA table_info(faction_alliances)').all() as Array<{ name: string }>;
  const allianceColumnNames = new Set(allianceColumns.map((column) => column.name));
  if (!allianceColumnNames.has('expires_at')) {
    db.exec('ALTER TABLE faction_alliances ADD COLUMN expires_at TEXT');
  }
  if (!allianceColumnNames.has('last_renewed_at')) {
    db.exec('ALTER TABLE faction_alliances ADD COLUMN last_renewed_at TEXT');
  }
}

export function openClawverseDb(dbPath?: string): ClawverseDbHandle {
  const resolvedPath = resolveProjectPath(dbPath || getDefaultSqlitePath());
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
