import type { Faction, FactionWar, FactionWarStatus } from '@clawverse/types';
import type { SocialSystem } from './social.js';
import type { EconomySystem } from './economy.js';
import type { EventEngine } from './events.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import { logger } from './logger.js';

const PEACE_REPUTATION_COST = 20;
const MIN_ALLIES_TO_FOUND = 3;

export class FactionSystem {
  private readonly dbHandle: ClawverseDbHandle;
  private factions: Map<string, Faction> = new Map();
  private memberIndex: Map<string, string> = new Map(); // peerId -> factionId
  private wars: Map<string, FactionWar> = new Map();

  constructor(
    private readonly social: SocialSystem,
    private readonly economy: EconomySystem,
    private readonly events: EventEngine,
    opts?: { dbPath?: string },
  ) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  createFaction(name: string, founderId: string, motto: string): Faction | null {
    if (this.memberIndex.has(founderId)) {
      logger.warn(`[faction] ${founderId} already in a faction`);
      return null;
    }

    const allyCount = this.social.getAllRelationships()
      .filter(r => r.tier === 'ally').length;
    if (allyCount < MIN_ALLIES_TO_FOUND) {
      logger.warn(`[faction] Need ${MIN_ALLIES_TO_FOUND}+ allies to found (have ${allyCount})`);
      return null;
    }

    const id = `fac-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const faction: Faction = {
      id, name, founderId, motto,
      members: [founderId],
      createdAt: new Date().toISOString(),
    };

    this.factions.set(id, faction);
    this.memberIndex.set(founderId, id);
    this._saveFaction(faction);
    this._saveMember(founderId, id);

    this.events.emit('faction_founding', { factionId: id, name, founder: founderId });
    logger.info(`[faction] Founded "${name}" by ${founderId}`);
    return faction;
  }

  joinFaction(factionId: string, peerId: string): boolean {
    const faction = this.factions.get(factionId);
    if (!faction) return false;
    if (this.memberIndex.has(peerId)) return false;

    const rel = this.social.getRelationship(peerId);
    if (rel && rel.sentiment <= 0) {
      logger.warn(`[faction] ${peerId} has negative sentiment, cannot join`);
      return false;
    }

    faction.members.push(peerId);
    this.memberIndex.set(peerId, factionId);
    this._saveFaction(faction);
    this._saveMember(peerId, factionId);

    logger.info(`[faction] ${peerId} joined "${faction.name}"`);
    return true;
  }

  leaveFaction(peerId: string): boolean {
    const factionId = this.memberIndex.get(peerId);
    if (!factionId) return false;

    const faction = this.factions.get(factionId);
    if (!faction) return false;

    faction.members = faction.members.filter(m => m !== peerId);
    this.memberIndex.delete(peerId);

    if (faction.members.length === 0) {
      this.factions.delete(factionId);
      this.dbHandle.db.prepare('DELETE FROM factions WHERE id = ?').run(factionId);
    } else {
      this._saveFaction(faction);
    }
    this.dbHandle.db.prepare('DELETE FROM faction_members WHERE peer_id = ?').run(peerId);

    logger.info(`[faction] ${peerId} left "${faction.name}"`);
    return true;
  }

  getFactions(): Faction[] {
    return Array.from(this.factions.values());
  }

  getFaction(id: string): Faction | undefined {
    return this.factions.get(id);
  }

  getMyFaction(peerId: string): Faction | undefined {
    const factionId = this.memberIndex.get(peerId);
    return factionId ? this.factions.get(factionId) : undefined;
  }

  getFactionCount(): number {
    return this.factions.size;
  }

  getActiveWars(): FactionWar[] {
    return Array.from(this.wars.values()).filter(w => w.status === 'active');
  }

  getActiveWarCount(): number {
    return this.getActiveWars().length;
  }

  checkWarConditions(): void {
    const factionList = this.getFactions();
    for (let i = 0; i < factionList.length; i++) {
      for (let j = i + 1; j < factionList.length; j++) {
        const a = factionList[i];
        const b = factionList[j];

        const existingWar = Array.from(this.wars.values()).find(
          w => w.status === 'active' &&
            ((w.factionA === a.id && w.factionB === b.id) ||
             (w.factionA === b.id && w.factionB === a.id))
        );
        if (existingWar) continue;

        let nemesisCount = 0;
        for (const mA of a.members) {
          for (const mB of b.members) {
            const rel = this.social.getRelationship(mB);
            if (rel && rel.tier === 'nemesis') nemesisCount++;
          }
        }

        if (nemesisCount >= 2) {
          this._declareWar(a.id, b.id);
        }
      }
    }
  }

  declarePeace(warId: string, requesterId: string): boolean {
    const war = this.wars.get(warId);
    if (!war || war.status !== 'active') return false;

    const requesterFaction = this.memberIndex.get(requesterId);
    if (requesterFaction !== war.factionA && requesterFaction !== war.factionB) return false;

    if (!this.economy.consume('reputation', PEACE_REPUTATION_COST)) {
      logger.warn(`[faction] Insufficient reputation for peace treaty`);
      return false;
    }

    war.status = 'ended';
    war.endedAt = new Date().toISOString();
    this._saveWar(war);

    this.events.emit('peace_treaty', {
      warId, factionA: war.factionA, factionB: war.factionB,
    });
    logger.info(`[faction] Peace declared for war ${warId}`);
    return true;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _declareWar(factionA: string, factionB: string): void {
    const id = `war-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const war: FactionWar = {
      id, factionA, factionB,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'active',
    };
    this.wars.set(id, war);
    this._saveWar(war);

    const nameA = this.factions.get(factionA)?.name ?? factionA;
    const nameB = this.factions.get(factionB)?.name ?? factionB;
    this.events.emit('faction_war', { warId: id, factionA: nameA, factionB: nameB });
    logger.info(`[faction] War declared: "${nameA}" vs "${nameB}"`);
  }

  private _saveFaction(f: Faction): void {
    this.dbHandle.db.prepare(`
      INSERT INTO factions (id, name, founder_id, motto, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        payload_json = excluded.payload_json
    `).run(f.id, f.name, f.founderId, f.motto, f.createdAt, JSON.stringify(f));
  }

  private _saveMember(peerId: string, factionId: string): void {
    this.dbHandle.db.prepare(`
      INSERT INTO faction_members (peer_id, faction_id, joined_at)
      VALUES (?, ?, ?)
      ON CONFLICT(peer_id) DO UPDATE SET
        faction_id = excluded.faction_id,
        joined_at = excluded.joined_at
    `).run(peerId, factionId, new Date().toISOString());
  }

  private _saveWar(w: FactionWar): void {
    this.dbHandle.db.prepare(`
      INSERT INTO faction_wars (id, faction_a, faction_b, started_at, ended_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = excluded.ended_at,
        status = excluded.status
    `).run(w.id, w.factionA, w.factionB, w.startedAt, w.endedAt, w.status);
  }

  private _load(): void {
    // Load factions
    const fRows = this.dbHandle.db.prepare('SELECT payload_json FROM factions').all() as Array<{ payload_json: string }>;
    for (const row of fRows) {
      try {
        const f = JSON.parse(row.payload_json) as Faction;
        this.factions.set(f.id, f);
        for (const m of f.members) this.memberIndex.set(m, f.id);
      } catch { /* skip bad row */ }
    }

    // Load wars
    const wRows = this.dbHandle.db.prepare(
      'SELECT id, faction_a, faction_b, started_at, ended_at, status FROM faction_wars'
    ).all() as Array<{ id: string; faction_a: string; faction_b: string; started_at: string; ended_at: string | null; status: string }>;
    for (const row of wRows) {
      this.wars.set(row.id, {
        id: row.id,
        factionA: row.faction_a,
        factionB: row.faction_b,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        status: row.status as FactionWarStatus,
      });
    }

    logger.info(`[faction] Loaded ${this.factions.size} factions, ${this.wars.size} wars`);
  }
}
