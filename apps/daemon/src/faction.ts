import type {
  Faction,
  FactionAgenda,
  FactionStage,
  FactionStrategicState,
  FactionWar,
  FactionWarStatus,
  FactionAlliance,
  FactionAllianceStatus,
  FactionVassalage,
  FactionVassalageStatus,
  FactionTribute,
  FactionTributeResource,
  FactionTreasury,
} from '@clawverse/types';
import type { SocialSystem } from './social.js';
import type { EconomySystem } from './economy.js';
import type { EventEngine } from './events.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import { logger } from './logger.js';

const PEACE_REPUTATION_COST = 20;
const ALLIANCE_REPUTATION_COST = 12;
const ALLIANCE_TERM_HOURS = 6;
const ALLIANCE_RENEW_WINDOW_HOURS = 2;
const ALLIANCE_RENEW_REPUTATION_COST = 8;
const VASSALAGE_REPUTATION_COST = 16;
const VASSAL_TRIBUTE_INTERVAL_HOURS = 2;
const RECENT_TRIBUTE_WINDOW_HOURS = 24;
const TREASURY_ACCRUAL_INTERVAL_HOURS = 2;
const TREASURY_RESOURCE_CAP = 240;
const MAX_VASSALS_PER_OVERLORD = 2;
const MIN_ALLIES_TO_FOUND = 3;
const AGENDAS: FactionAgenda[] = ['expansion', 'trade', 'knowledge', 'stability', 'survival'];

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

export class FactionSystem {
  private readonly dbHandle: ClawverseDbHandle;
  private factions: Map<string, Faction> = new Map();
  private memberIndex: Map<string, string> = new Map();
  private wars: Map<string, FactionWar> = new Map();
  private alliances: Map<string, FactionAlliance> = new Map();
  private vassalages: Map<string, FactionVassalage> = new Map();
  private tributes: Map<string, FactionTribute> = new Map();

  constructor(
    private readonly social: SocialSystem,
    private readonly economy: EconomySystem,
    private readonly events: EventEngine,
    opts?: {
      dbPath?: string;
      resolveActorId?: (id: string) => string;
      resolveSessionId?: (actorId: string) => string | null | undefined;
    },
  ) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this.resolveActorId = opts?.resolveActorId ?? ((id) => id);
    this.resolveSessionId = opts?.resolveSessionId ?? ((actorId) => actorId);
    this._load();
    this._refreshFactionStates(false);
  }

  private readonly resolveActorId: (id: string) => string;
  private readonly resolveSessionId: (actorId: string) => string | null | undefined;

  getTributes(): FactionTribute[] {
    return Array.from(this.tributes.values())
      .sort((left, right) => Date.parse(right.collectedAt) - Date.parse(left.collectedAt));
  }

  getRecentTributes(hours = RECENT_TRIBUTE_WINDOW_HOURS): FactionTribute[] {
    return this._recentTributes(hours);
  }

  createFaction(name: string, founderId: string, motto: string): Faction | null {
    const founderActorId = this._actorIdFor(founderId);
    if (this.memberIndex.has(founderActorId)) {
      logger.warn(`[faction] ${founderActorId} already in a faction`);
      return null;
    }

    const allyCount = this.social.getAllRelationships().filter((relation) => relation.tier === 'ally').length;
    if (allyCount < MIN_ALLIES_TO_FOUND) {
      logger.warn(`[faction] Need ${MIN_ALLIES_TO_FOUND}+ allies to found (have ${allyCount})`);
      return null;
    }

    const id = `fac-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const createdAt = new Date().toISOString();
    const agenda = this._chooseAgenda(name, motto);
    const faction: Faction = {
      id,
      name,
      founderId,
      founderActorId,
      members: [founderId],
      memberActorIds: [founderActorId],
      createdAt,
      motto,
      strategic: this._makeStrategicState(agenda),
      treasury: this._makeTreasury(agenda, createdAt),
    };

    faction.strategic = this._computeStrategicState(faction);
    this.factions.set(id, faction);
    this.memberIndex.set(founderActorId, id);
    this._saveFaction(faction);
    this._saveMember(founderActorId, id);

    this.events.emit('faction_founding', {
      factionId: id,
      name,
      founder: founderActorId,
      founderSessionId: founderId,
      agenda: faction.strategic.agenda,
    });
    logger.info(`[faction] Founded "${name}" by ${founderActorId}`);
    return this._projectFaction(faction);
  }

  joinFaction(factionId: string, peerId: string): boolean {
    const faction = this.factions.get(factionId);
    if (!faction) return false;
    const actorId = this._actorIdFor(peerId);
    if (this.memberIndex.has(actorId)) return false;

    const relation = this.social.getRelationship(peerId);
    if (relation && relation.sentiment <= 0) {
      logger.warn(`[faction] ${actorId} has negative sentiment, cannot join`);
      return false;
    }

    faction.members = Array.from(new Set([...faction.members, peerId]));
    faction.memberActorIds = Array.from(new Set([...this._memberActorIds(faction), actorId]));
    this.memberIndex.set(actorId, factionId);
    this._refreshFactionState(faction, true);
    this._saveFaction(faction);
    this._saveMember(actorId, factionId);

    logger.info(`[faction] ${actorId} joined "${faction.name}"`);
    return true;
  }

  leaveFaction(peerId: string): boolean {
    const actorId = this._actorIdFor(peerId);
    const factionId = this.memberIndex.get(actorId);
    if (!factionId) return false;

    const faction = this.factions.get(factionId);
    if (!faction) return false;

    faction.members = faction.members.filter((memberId) => this._actorIdFor(memberId) !== actorId && memberId !== actorId);
    faction.memberActorIds = this._memberActorIds(faction).filter((memberId) => memberId !== actorId);
    this.memberIndex.delete(actorId);

    if (this._memberActorIds(faction).length === 0) {
      this.factions.delete(factionId);
      this._endAlliancesForFaction(factionId);
      this._endVassalagesForFaction(factionId);
      this.dbHandle.db.prepare('DELETE FROM factions WHERE id = ?').run(factionId);
    } else {
      this._refreshFactionState(faction, true);
      this._saveFaction(faction);
    }
    this.dbHandle.db.prepare('DELETE FROM faction_members WHERE peer_id = ?').run(actorId);

    logger.info(`[faction] ${actorId} left "${faction.name}"`);
    return true;
  }

  getFactions(): Faction[] {
    this._refreshFactionStates(false);
    return Array.from(this.factions.values())
      .sort((left, right) => right.strategic.influence - left.strategic.influence)
      .map((faction) => this._projectFaction(faction));
  }

  getFaction(id: string): Faction | undefined {
    const faction = this._getFactionInternal(id);
    if (!faction) return undefined;
    this._refreshFactionState(faction, false);
    return Object.assign(faction, this._projectFaction(faction));
  }

  getMyFaction(peerId: string): Faction | undefined {
    const factionId = this.memberIndex.get(this._actorIdFor(peerId));
    return factionId ? this.getFaction(factionId) : undefined;
  }

  getFactionCount(): number {
    return this.factions.size;
  }

  getActiveWars(): FactionWar[] {
    return Array.from(this.wars.values()).filter((war) => war.status === 'active');
  }

  getActiveWarCount(): number {
    return this.getActiveWars().length;
  }

  getAlliances(): FactionAlliance[] {
    return Array.from(this.alliances.values())
      .sort((left, right) => Date.parse(right.formedAt) - Date.parse(left.formedAt));
  }

  getActiveAlliances(): FactionAlliance[] {
    this._expireOverdueAlliances(false);
    return this.getAlliances()
      .filter((alliance) => alliance.status === 'active')
      .filter((alliance) => this.factions.has(alliance.factionA) && this.factions.has(alliance.factionB));
  }

  getVassalages(): FactionVassalage[] {
    return Array.from(this.vassalages.values())
      .sort((left, right) => Date.parse(right.formedAt) - Date.parse(left.formedAt));
  }

  getActiveVassalages(): FactionVassalage[] {
    return this.getVassalages()
      .filter((vassalage) => vassalage.status === 'active')
      .filter((vassalage) => this.factions.has(vassalage.overlordId) && this.factions.has(vassalage.vassalId));
  }

  formAlliance(targetFactionId: string, requesterId: string): FactionAlliance | null {
    this._expireOverdueAlliances(false);

    const requesterActorId = this._actorIdFor(requesterId);
    const requesterFactionId = this.memberIndex.get(requesterActorId);
    if (!requesterFactionId || requesterFactionId === targetFactionId) return null;

    const requesterFaction = this._getFactionInternal(requesterFactionId);
    const targetFaction = this._getFactionInternal(targetFactionId);
    if (!requesterFaction || !targetFaction) return null;
    if (!this._memberActorIds(requesterFaction).includes(requesterActorId)) return null;
    if (requesterFaction.strategic.stage === 'splintering' || targetFaction.strategic.stage === 'splintering') return null;
    if (targetFaction.strategic.cohesion < 45 || targetFaction.strategic.pressure > 68) return null;
    if (this._findActiveAlliance(requesterFaction.id, targetFaction.id)) return null;
    if (this._findActiveVassalage(requesterFaction.id, targetFaction.id)) return null;
    if (this._findActiveWar(requesterFaction.id, targetFaction.id)) return null;

    if (!this.economy.consume('reputation', ALLIANCE_REPUTATION_COST)) {
      logger.warn('[faction] Insufficient reputation for alliance treaty');
      return null;
    }

    const formedAt = new Date().toISOString();
    const alliance: FactionAlliance = {
      id: `ally-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      factionA: requesterFaction.id,
      factionB: targetFaction.id,
      formedAt,
      expiresAt: this._renewedExpiryAt(formedAt),
      lastRenewedAt: formedAt,
      endedAt: null,
      status: 'active',
    };
    this.alliances.set(alliance.id, alliance);
    this._saveAlliance(alliance);
    this._refreshFactionStateById(requesterFaction.id, true);
    this._refreshFactionStateById(targetFaction.id, true);

    this.events.emit('faction_alliance', {
      subtype: alliance.id,
      allianceId: alliance.id,
      factionA: requesterFaction.name,
      factionB: targetFaction.name,
      factionAId: requesterFaction.id,
      factionBId: targetFaction.id,
      formedAt: alliance.formedAt,
      expiresAt: alliance.expiresAt,
    });
    logger.info(`[faction] Alliance formed: "${requesterFaction.name}" + "${targetFaction.name}"`);
    return alliance;
  }

  renewAlliance(allianceId: string, requesterId: string): FactionAlliance | null {
    this._expireOverdueAlliances(false);

    const alliance = this.alliances.get(allianceId);
    if (!alliance || alliance.status !== 'active') return null;

    const requesterFactionId = this.memberIndex.get(this._actorIdFor(requesterId));
    if (!requesterFactionId) return null;
    if (requesterFactionId !== alliance.factionA && requesterFactionId !== alliance.factionB) return null;

    const factionA = this._getFactionInternal(alliance.factionA);
    const factionB = this._getFactionInternal(alliance.factionB);
    if (!factionA || !factionB) return null;
    if (this._findActiveWar(alliance.factionA, alliance.factionB)) return null;
    if (factionA.strategic.stage === 'splintering' || factionB.strategic.stage === 'splintering') return null;
    if (factionA.strategic.cohesion < 45 || factionB.strategic.cohesion < 45) return null;
    if (factionA.strategic.pressure >= 68 || factionB.strategic.pressure >= 68) return null;
    if (!this._isAllianceInRenewWindow(alliance)) return null;

    if (!this.economy.consume('reputation', ALLIANCE_RENEW_REPUTATION_COST)) {
      logger.warn('[faction] Insufficient reputation for alliance renewal');
      return null;
    }

    const renewedAt = new Date().toISOString();
    alliance.lastRenewedAt = renewedAt;
    alliance.expiresAt = this._renewedExpiryAt(renewedAt);
    this._saveAlliance(alliance);
    this._refreshFactionStateById(alliance.factionA, true);
    this._refreshFactionStateById(alliance.factionB, true);

    this.events.emit('faction_alliance', {
      subtype: `${alliance.id}:renew`,
      allianceId: alliance.id,
      factionA: factionA.name,
      factionB: factionB.name,
      factionAId: factionA.id,
      factionBId: factionB.id,
      formedAt: alliance.formedAt,
      expiresAt: alliance.expiresAt,
      lastRenewedAt: alliance.lastRenewedAt,
      renewed: true,
    });
    logger.info(`[faction] Alliance renewed: "${factionA.name}" + "${factionB.name}"`);
    return alliance;
  }

  breakAlliance(allianceId: string, requesterId: string, reason = 'strategic_withdrawal'): FactionAlliance | null {
    this._expireOverdueAlliances(false);

    const alliance = this.alliances.get(allianceId);
    if (!alliance || alliance.status !== 'active') return null;

    const requesterFactionId = this.memberIndex.get(this._actorIdFor(requesterId));
    if (!requesterFactionId) return null;
    if (requesterFactionId !== alliance.factionA && requesterFactionId !== alliance.factionB) return null;

    this._endAlliance(alliance, reason, true, {
      description: 'A faction deliberately withdrew from a treaty to rebalance its strategic bloc.',
      initiatorFactionId: requesterFactionId,
    });
    return alliance;
  }

  vassalizeFaction(targetFactionId: string, requesterId: string): FactionVassalage | null {
    const requesterActorId = this._actorIdFor(requesterId);
    const requesterFactionId = this.memberIndex.get(requesterActorId);
    if (!requesterFactionId || requesterFactionId === targetFactionId) return null;

    const requesterFaction = this._getFactionInternal(requesterFactionId);
    const targetFaction = this._getFactionInternal(targetFactionId);
    if (!requesterFaction || !targetFaction) return null;
    if (!this._memberActorIds(requesterFaction).includes(requesterActorId)) return null;
    if (requesterFaction.strategic.stage !== 'dominant') return null;
    if (requesterFaction.strategic.cohesion < 58 || requesterFaction.strategic.pressure > 52) return null;
    if (targetFaction.strategic.stage === 'dominant') return null;
    if (this._getOverlordVassalage(requesterFaction.id)) return null;
    if (this._activeVassalCount(requesterFaction.id) >= MAX_VASSALS_PER_OVERLORD) return null;
    if (this._getOverlordVassalage(targetFaction.id)) return null;
    if (this._hasAnyVassal(targetFaction.id)) return null;
    if (this._findActiveAlliance(requesterFaction.id, targetFaction.id)) return null;
    if (this._findActiveVassalage(requesterFaction.id, targetFaction.id)) return null;
    if (this._findActiveWar(requesterFaction.id, targetFaction.id)) return null;

    const influenceGap = requesterFaction.strategic.influence - targetFaction.strategic.influence;
    const targetVulnerable = targetFaction.strategic.stage === 'fragile'
      || targetFaction.strategic.pressure >= 46
      || targetFaction.strategic.cohesion <= 55
      || influenceGap >= 32;
    if (influenceGap < 18 || !targetVulnerable) return null;

    if (!this.economy.consume('reputation', VASSALAGE_REPUTATION_COST)) {
      logger.warn('[faction] Insufficient reputation for vassalage pact');
      return null;
    }

    const formedAt = new Date().toISOString();
    const vassalage: FactionVassalage = {
      id: `vsl-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      overlordId: requesterFaction.id,
      vassalId: targetFaction.id,
      formedAt,
      endedAt: null,
      status: 'active',
    };
    this.vassalages.set(vassalage.id, vassalage);
    this._saveVassalage(vassalage);
    this._refreshFactionStateById(requesterFaction.id, true);
    this._refreshFactionStateById(targetFaction.id, true);

    this.events.emit('faction_vassalage', {
      subtype: vassalage.id,
      vassalageId: vassalage.id,
      overlordId: requesterFaction.id,
      overlord: requesterFaction.name,
      vassalId: targetFaction.id,
      vassal: targetFaction.name,
      formedAt,
    });
    logger.info(`[faction] Vassalage formed: "${requesterFaction.name}" -> "${targetFaction.name}"`);
    return vassalage;
  }

  refreshStrategicState(): void {
    const accruedTreasuryCount = this._accrueTreasuries();
    this._refreshFactionStates(true);
    const endedAllianceCount = this._reviewAlliances(true);
    const endedVassalageCount = this._reviewVassalages(true);
    const collectedTributeCount = this._collectTributes(true);
    if (accruedTreasuryCount > 0 || endedAllianceCount > 0 || endedVassalageCount > 0 || collectedTributeCount > 0) {
      this._refreshFactionStates(true);
    }
  }

  reviewAlliances(): number {
    return this._reviewAlliances(true);
  }

  reviewVassalages(): number {
    return this._reviewVassalages(true);
  }

  checkWarConditions(): void {
    const factionList = Array.from(this.factions.values());
    for (let i = 0; i < factionList.length; i++) {
      for (let j = i + 1; j < factionList.length; j++) {
        const a = factionList[i];
        const b = factionList[j];

        const existingWar = Array.from(this.wars.values()).find(
          (war) => war.status === 'active' &&
            ((war.factionA === a.id && war.factionB === b.id) ||
             (war.factionA === b.id && war.factionB === a.id)),
        );
        if (existingWar || this._findActiveAlliance(a.id, b.id) || this._findActiveVassalage(a.id, b.id)) continue;

        let nemesisCount = 0;
        for (const memberA of this._memberActorIds(a)) {
          for (const memberB of this._memberActorIds(b)) {
            const relation = this.social.getRelationship(memberB);
            if (relation && relation.tier === 'nemesis') nemesisCount++;
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

    const requesterFaction = this.memberIndex.get(this._actorIdFor(requesterId));
    if (requesterFaction !== war.factionA && requesterFaction !== war.factionB) return false;

    if (!this.economy.consume('reputation', PEACE_REPUTATION_COST)) {
      logger.warn('[faction] Insufficient reputation for peace treaty');
      return false;
    }

    war.status = 'ended';
    war.endedAt = new Date().toISOString();
    this._saveWar(war);
    this._refreshFactionStateById(war.factionA, true);
    this._refreshFactionStateById(war.factionB, true);

    this.events.emit('peace_treaty', {
      warId,
      factionA: war.factionA,
      factionB: war.factionB,
    });
    logger.info(`[faction] Peace declared for war ${warId}`);
    return true;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _samePair(leftA: string, leftB: string, rightA: string, rightB: string): boolean {
    return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
  }

  private _findActiveWar(factionA: string, factionB: string): FactionWar | undefined {
    return Array.from(this.wars.values()).find((war) =>
      war.status === 'active' && this._samePair(war.factionA, war.factionB, factionA, factionB)
    );
  }

  private _findActiveAlliance(factionA: string, factionB: string): FactionAlliance | undefined {
    return Array.from(this.alliances.values()).find((alliance) =>
      alliance.status === 'active' && this._samePair(alliance.factionA, alliance.factionB, factionA, factionB)
    );
  }

  private _findActiveVassalage(factionA: string, factionB: string): FactionVassalage | undefined {
    return Array.from(this.vassalages.values()).find((vassalage) =>
      vassalage.status === 'active' && this._samePair(vassalage.overlordId, vassalage.vassalId, factionA, factionB)
    );
  }

  private _getOverlordVassalage(factionId: string): FactionVassalage | undefined {
    return Array.from(this.vassalages.values()).find((vassalage) => vassalage.status === 'active' && vassalage.vassalId === factionId);
  }

  private _hasAnyVassal(factionId: string): boolean {
    return this._activeVassalCount(factionId) > 0;
  }

  private _activeVassalCount(factionId: string): number {
    return Array.from(this.vassalages.values())
      .filter((vassalage) => vassalage.status === 'active' && vassalage.overlordId === factionId)
      .length;
  }

  private _makeTreasury(agenda: FactionAgenda, updatedAt = new Date().toISOString()): FactionTreasury {
    if (agenda === 'knowledge') {
      return { compute: 34, storage: 18, bandwidth: 14, reputation: 10, updatedAt };
    }
    if (agenda === 'trade') {
      return { compute: 18, storage: 22, bandwidth: 34, reputation: 12, updatedAt };
    }
    if (agenda === 'expansion') {
      return { compute: 20, storage: 18, bandwidth: 16, reputation: 30, updatedAt };
    }
    if (agenda === 'survival') {
      return { compute: 16, storage: 32, bandwidth: 12, reputation: 12, updatedAt };
    }
    return { compute: 20, storage: 28, bandwidth: 16, reputation: 16, updatedAt };
  }

  private _ensureTreasury(faction: Faction): FactionTreasury {
    if (faction.treasury) return faction.treasury;
    faction.treasury = this._makeTreasury(faction.strategic?.agenda ?? this._chooseAgenda(faction.name, faction.motto), faction.createdAt);
    return faction.treasury;
  }

  private _setTreasuryValue(treasury: FactionTreasury, resource: FactionTributeResource, value: number): void {
    const normalized = resource === 'reputation'
      ? Math.max(0, value)
      : Math.max(0, Math.min(TREASURY_RESOURCE_CAP, value));
    treasury[resource] = normalized;
  }

  private _awardTreasury(faction: Faction, resource: FactionTributeResource, amount: number): number {
    if (amount <= 0) return 0;
    const treasury = this._ensureTreasury(faction);
    const previous = treasury[resource];
    this._setTreasuryValue(treasury, resource, previous + amount);
    return treasury[resource] - previous;
  }

  private _consumeTreasury(faction: Faction, resource: FactionTributeResource, amount: number): number {
    if (amount <= 0) return 0;
    const treasury = this._ensureTreasury(faction);
    const previous = treasury[resource];
    const paid = Math.min(previous, amount);
    this._setTreasuryValue(treasury, resource, previous - paid);
    return paid;
  }

  private _transferTreasuryResource(
    fromFaction: Faction,
    toFaction: Faction,
    resource: FactionTributeResource,
    amount: number,
    updatedAt = new Date().toISOString(),
  ): number {
    if (amount <= 0) return 0;

    const fromTreasury = this._ensureTreasury(fromFaction);
    const toTreasury = this._ensureTreasury(toFaction);
    const available = fromTreasury[resource];
    const receivable = resource === 'reputation'
      ? Number.POSITIVE_INFINITY
      : Math.max(0, TREASURY_RESOURCE_CAP - toTreasury[resource]);
    const paid = Math.max(0, Math.min(amount, available, receivable));
    if (paid <= 0) return 0;

    this._setTreasuryValue(fromTreasury, resource, available - paid);
    this._setTreasuryValue(toTreasury, resource, toTreasury[resource] + paid);
    fromTreasury.updatedAt = updatedAt;
    toTreasury.updatedAt = updatedAt;
    return paid;
  }

  private _treasuryYieldForFaction(faction: Faction): Record<FactionTributeResource, number> {
    const members = Math.max(1, this._memberCount(faction));
    const yieldMap: Record<FactionTributeResource, number> = {
      compute: 1,
      storage: 1,
      bandwidth: 1,
      reputation: 1,
    };

    if (faction.strategic.agenda === 'knowledge') yieldMap.compute += 2 + Math.floor(members / 2);
    else if (faction.strategic.agenda === 'trade') yieldMap.bandwidth += 2 + Math.floor(members / 2);
    else if (faction.strategic.agenda === 'expansion') yieldMap.reputation += 2 + Math.floor(members / 2);
    else yieldMap.storage += 2 + Math.floor(members / 2);

    yieldMap.storage += Math.floor(members / 3);
    return yieldMap;
  }

  private _accrueTreasuries(now = Date.now()): number {
    let accrued = 0;

    for (const faction of this.factions.values()) {
      const treasury = this._ensureTreasury(faction);
      const updatedAt = Date.parse(treasury.updatedAt);
      const lastTickAt = Number.isFinite(updatedAt) ? updatedAt : Date.parse(faction.createdAt);
      const ticks = Math.floor((now - lastTickAt) / (TREASURY_ACCRUAL_INTERVAL_HOURS * 3_600_000));
      if (ticks <= 0) continue;

      const yieldMap = this._treasuryYieldForFaction(faction);
      for (let index = 0; index < ticks; index += 1) {
        this._awardTreasury(faction, 'compute', yieldMap.compute);
        this._awardTreasury(faction, 'storage', yieldMap.storage);
        this._awardTreasury(faction, 'bandwidth', yieldMap.bandwidth);
        this._awardTreasury(faction, 'reputation', yieldMap.reputation);
      }

      treasury.updatedAt = new Date(lastTickAt + ticks * TREASURY_ACCRUAL_INTERVAL_HOURS * 3_600_000).toISOString();
      this._saveFaction(faction);
      accrued += 1;
    }

    return accrued;
  }

  private _recentTributes(hours = RECENT_TRIBUTE_WINDOW_HOURS): FactionTribute[] {
    const cutoff = Date.now() - hours * 3_600_000;
    return this.getTributes().filter((tribute) => Date.parse(tribute.collectedAt) >= cutoff);
  }

  private _latestTributeForVassalage(vassalageId: string): FactionTribute | undefined {
    return this.getTributes().find((tribute) => tribute.vassalageId === vassalageId);
  }

  private _isTributeDue(vassalage: FactionVassalage, now = Date.now()): boolean {
    const latest = this._latestTributeForVassalage(vassalage.id);
    if (!latest) return true;
    const collectedAt = Date.parse(latest.collectedAt);
    if (!Number.isFinite(collectedAt)) return true;
    return now - collectedAt >= VASSAL_TRIBUTE_INTERVAL_HOURS * 3_600_000;
  }

  private _tributeResourceForAgenda(agenda: FactionAgenda): FactionTributeResource {
    if (agenda === 'knowledge') return 'compute';
    if (agenda === 'trade') return 'bandwidth';
    if (agenda === 'expansion') return 'reputation';
    return 'storage';
  }

  private _tributeAmountForVassalage(vassal: Faction): number {
    const base = 4
      + Math.floor(vassal.strategic.prosperity / 22)
      + Math.floor(Math.max(0, 62 - vassal.strategic.pressure) / 20)
      + Math.floor(Math.max(0, this._memberCount(vassal) - 1) / 2);
    return Math.max(3, Math.min(12, base));
  }

  private _collectTributes(emitEvents: boolean): number {
    let collected = 0;
    const now = Date.now();
    for (const vassalage of this.getActiveVassalages()) {
      if (!this._isTributeDue(vassalage, now)) continue;
      const overlord = this.factions.get(vassalage.overlordId);
      const vassal = this.factions.get(vassalage.vassalId);
      if (!overlord || !vassal) continue;

      const resource = this._tributeResourceForAgenda(overlord.strategic.agenda);
      const requestedAmount = this._tributeAmountForVassalage(vassal);
      const collectedAt = new Date().toISOString();
      const paidAmount = this._transferTreasuryResource(vassal, overlord, resource, requestedAmount, collectedAt);
      if (paidAmount <= 0) continue;

      this._saveFaction(vassal);
      this._saveFaction(overlord);

      const tribute: FactionTribute = {
        id: `trb-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        vassalageId: vassalage.id,
        overlordId: vassalage.overlordId,
        vassalId: vassalage.vassalId,
        resource,
        amount: paidAmount,
        collectedAt,
      };
      this.tributes.set(tribute.id, tribute);
      this._saveTribute(tribute);
      collected += 1;

      if (emitEvents) {
        this.events.emit('faction_tribute', {
          subtype: tribute.id,
          tributeId: tribute.id,
          vassalageId: tribute.vassalageId,
          overlordId: tribute.overlordId,
          overlord: overlord.name,
          vassalId: tribute.vassalId,
          vassal: vassal.name,
          resource: tribute.resource,
          amount: tribute.amount,
          collectedAt: tribute.collectedAt,
        });
      }
      logger.info(`[faction] Tribute collected: "${vassal.name}" -> "${overlord.name}" (${tribute.amount} ${tribute.resource})`);
    }
    return collected;
  }

  private _renewedExpiryAt(baseIso: string): string {
    return addHours(baseIso, ALLIANCE_TERM_HOURS);
  }

  private _isAllianceExpired(alliance: FactionAlliance, now = Date.now()): boolean {
    const expiresAt = Date.parse(alliance.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= now;
  }

  private _isAllianceInRenewWindow(alliance: FactionAlliance, now = Date.now()): boolean {
    const expiresAt = Date.parse(alliance.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    return expiresAt - now <= ALLIANCE_RENEW_WINDOW_HOURS * 3_600_000;
  }

  private _expireOverdueAlliances(emitEvents: boolean): number {
    let endedCount = 0;
    const now = Date.now();
    for (const alliance of Array.from(this.alliances.values()).filter((item) => item.status === 'active')) {
      if (!this._isAllianceExpired(alliance, now)) continue;
      this._endAlliance(alliance, 'expired', emitEvents);
      endedCount += 1;
    }
    return endedCount;
  }

  private _allianceDecayReason(alliance: FactionAlliance): string | null {
    if (this._isAllianceExpired(alliance)) return 'expired';

    const factionA = this.factions.get(alliance.factionA);
    const factionB = this.factions.get(alliance.factionB);
    if (!factionA || !factionB) return 'faction_missing';
    if (this._findActiveWar(alliance.factionA, alliance.factionB)) return 'war_active';
    if (factionA.strategic.stage === 'splintering' || factionB.strategic.stage === 'splintering') return 'splintering';
    if (factionA.strategic.cohesion < 35 || factionB.strategic.cohesion < 35) return 'cohesion_collapse';
    if (factionA.strategic.pressure >= 76 || factionB.strategic.pressure >= 76) return 'pressure_overload';
    return null;
  }

  private _endAlliance(
    alliance: FactionAlliance,
    reason: string,
    emitEvents: boolean,
    options?: { description?: string; initiatorFactionId?: string },
  ): void {
    if (alliance.status !== 'active') return;

    alliance.status = 'ended';
    alliance.endedAt = new Date().toISOString();
    this._saveAlliance(alliance);
    this._refreshFactionStateById(alliance.factionA, emitEvents);
    this._refreshFactionStateById(alliance.factionB, emitEvents);

    const factionA = this.factions.get(alliance.factionA);
    const factionB = this.factions.get(alliance.factionB);
    const initiatorFactionId = options?.initiatorFactionId;
    const initiatorFaction = initiatorFactionId ? this.factions.get(initiatorFactionId) : undefined;
    if (emitEvents) {
      this.events.emit('betrayal', {
        subtype: alliance.id,
        allianceId: alliance.id,
        factionA: factionA?.name ?? alliance.factionA,
        factionAId: alliance.factionA,
        factionB: factionB?.name ?? alliance.factionB,
        factionBId: alliance.factionB,
        reason,
        initiatorFactionId: initiatorFactionId ?? null,
        initiatorFaction: initiatorFaction?.name ?? null,
        description: options?.description ?? 'A faction alliance collapsed under pressure.',
      });
    }

    logger.info('[faction] Alliance ended: "' + (factionA?.name ?? alliance.factionA) + '" + "' + (factionB?.name ?? alliance.factionB) + '" (' + reason + ')');
  }

  private _reviewAlliances(emitEvents: boolean): number {
    let endedCount = this._expireOverdueAlliances(emitEvents);
    for (const alliance of Array.from(this.alliances.values())) {
      if (alliance.status !== 'active') continue;
      if (!this.factions.has(alliance.factionA) || !this.factions.has(alliance.factionB)) continue;
      const reason = this._allianceDecayReason(alliance);
      if (!reason) continue;
      this._endAlliance(alliance, reason, emitEvents);
      endedCount += 1;
    }
    return endedCount;
  }

  private _vassalageDecayReason(vassalage: FactionVassalage): string | null {
    const overlord = this.factions.get(vassalage.overlordId);
    const vassal = this.factions.get(vassalage.vassalId);
    if (!overlord || !vassal) return 'faction_missing';
    if (this._findActiveWar(vassalage.overlordId, vassalage.vassalId)) return 'war_active';
    if (overlord.strategic.stage === 'splintering') return 'overlord_splintering';
    if (overlord.strategic.cohesion < 35 || overlord.strategic.pressure >= 76) return 'overlord_collapse';
    if (vassal.strategic.stage === 'dominant' || vassal.strategic.influence >= 78) return 'vassal_ascendant';
    return null;
  }

  private _endVassalage(vassalage: FactionVassalage, reason: string, emitEvents: boolean): void {
    if (vassalage.status !== 'active') return;

    vassalage.status = 'ended';
    vassalage.endedAt = new Date().toISOString();
    this._saveVassalage(vassalage);
    this._refreshFactionStateById(vassalage.overlordId, emitEvents);
    this._refreshFactionStateById(vassalage.vassalId, emitEvents);

    const overlord = this.factions.get(vassalage.overlordId);
    const vassal = this.factions.get(vassalage.vassalId);
    if (emitEvents) {
      this.events.emit('betrayal', {
        subtype: vassalage.id,
        vassalageId: vassalage.id,
        overlordId: vassalage.overlordId,
        overlord: overlord?.name ?? vassalage.overlordId,
        vassalId: vassalage.vassalId,
        vassal: vassal?.name ?? vassalage.vassalId,
        relation: 'vassalage',
        reason,
        description: 'A vassalage bond has fractured and the political order is shifting.',
      });
    }

    logger.info(`[faction] Vassalage ended: "${overlord?.name ?? vassalage.overlordId}" -> "${vassal?.name ?? vassalage.vassalId}" (${reason})`);
  }

  private _reviewVassalages(emitEvents: boolean): number {
    let endedCount = 0;
    for (const vassalage of Array.from(this.vassalages.values())) {
      if (vassalage.status !== 'active') continue;
      const reason = this._vassalageDecayReason(vassalage);
      if (!reason) continue;
      this._endVassalage(vassalage, reason, emitEvents);
      endedCount += 1;
    }
    return endedCount;
  }

  private _endAlliancesForFaction(factionId: string): void {
    for (const alliance of this.getActiveAlliances()) {
      if (alliance.factionA === factionId || alliance.factionB === factionId) {
        this._endAlliance(alliance, 'faction_missing', false);
      }
    }
  }

  private _endVassalagesForFaction(factionId: string): void {
    for (const vassalage of this.vassalages.values()) {
      if (vassalage.status !== 'active') continue;
      if (vassalage.overlordId === factionId || vassalage.vassalId === factionId) {
        this._endVassalage(vassalage, 'faction_missing', false);
      }
    }
  }

  private _declareWar(factionA: string, factionB: string): void {
    if (this._findActiveAlliance(factionA, factionB)) {
      logger.warn(`[faction] Cannot declare war between allied factions ${factionA} and ${factionB}`);
      return;
    }
    if (this._findActiveVassalage(factionA, factionB)) {
      logger.warn(`[faction] Cannot declare war between overlord and vassal ${factionA} and ${factionB}`);
      return;
    }

    const id = `war-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const war: FactionWar = {
      id,
      factionA,
      factionB,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'active',
    };
    this.wars.set(id, war);
    this._saveWar(war);
    this._refreshFactionStateById(factionA, true);
    this._refreshFactionStateById(factionB, true);

    const nameA = this.factions.get(factionA)?.name ?? factionA;
    const nameB = this.factions.get(factionB)?.name ?? factionB;
    this.events.emit('faction_war', { warId: id, factionA: nameA, factionB: nameB });
    logger.info(`[faction] War declared: "${nameA}" vs "${nameB}"`);
  }

  private _makeStrategicState(agenda: FactionAgenda): FactionStrategicState {
    return {
      agenda,
      prosperity: 0,
      cohesion: 0,
      influence: 0,
      pressure: 0,
      stage: 'fragile',
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private _chooseAgenda(name: string, motto: string): FactionAgenda {
    const text = `${name} ${motto}`.toLowerCase();
    if (/trade|market|merchant|exchange|route|coin/.test(text)) return 'trade';
    if (/archive|library|knowledge|learn|research|memory|wisdom/.test(text)) return 'knowledge';
    if (/expand|growth|rise|frontier|conquer|outpost/.test(text)) return 'expansion';
    if (/survive|endure|shelter|last|resist|winter/.test(text)) return 'survival';
    if (/peace|order|calm|steady|balance|stable/.test(text)) return 'stability';

    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
    return AGENDAS[hash % AGENDAS.length];
  }

  private _computeStrategicState(faction: Faction): FactionStrategicState {
    const resources = this.economy.getResources();
    const treasury = this._ensureTreasury(faction);
    const activeWarCount = this.getActiveWars().filter((war) => war.factionA === faction.id || war.factionB === faction.id).length;
    const activeAllianceCount = this.getActiveAlliances().filter((alliance) => alliance.factionA === faction.id || alliance.factionB === faction.id).length;
    const activeVassalages = this.getActiveVassalages();
    const vassalCount = activeVassalages.filter((vassalage) => vassalage.overlordId === faction.id).length;
    const overlordVassalage = activeVassalages.find((vassalage) => vassalage.vassalId === faction.id);
    const recentTributes = this._recentTributes();
    const incomingTribute = recentTributes.filter((tribute) => tribute.overlordId === faction.id).reduce((total, tribute) => total + tribute.amount, 0);
    const outgoingTribute = recentTributes.filter((tribute) => tribute.vassalId === faction.id).reduce((total, tribute) => total + tribute.amount, 0);
    const memberCount = this._memberCount(faction);
    const ageDays = Math.max(0, (Date.now() - new Date(faction.createdAt).getTime()) / 86_400_000);

    let prosperity = resources.compute * 0.22
      + resources.storage * 0.18
      + resources.bandwidth * 0.12
      + resources.reputation * 1.6
      + treasury.compute * 0.03
      + treasury.storage * 0.03
      + treasury.bandwidth * 0.025
      + treasury.reputation * 0.18
      + memberCount * 5
      - activeWarCount * 12
      + activeAllianceCount * 6
      + vassalCount * 4
      + (overlordVassalage ? 2 : 0)
      + incomingTribute * 0.7
      - outgoingTribute * 0.45;
    if (faction.strategic.agenda === 'trade') prosperity += resources.bandwidth * 0.08 + treasury.bandwidth * 0.02;
    if (faction.strategic.agenda === 'knowledge') prosperity += resources.compute * 0.06 + treasury.compute * 0.02;
    prosperity = clamp(Math.round(prosperity));

    let influence = memberCount * 11
      + resources.reputation * 2.4
      + treasury.reputation * 0.2
      + treasury.bandwidth * 0.03
      + treasury.compute * 0.025
      + ageDays * 1.8
      + activeWarCount * 6
      + activeAllianceCount * 7
      + vassalCount * 12
      - (overlordVassalage ? 18 : 0)
      + incomingTribute * 0.9
      - outgoingTribute * 0.35;
    if (faction.strategic.agenda === 'trade') influence += resources.bandwidth * 0.1 + treasury.bandwidth * 0.02;
    if (faction.strategic.agenda === 'knowledge') influence += resources.compute * 0.08 + treasury.compute * 0.02;
    if (faction.strategic.agenda === 'expansion') influence += memberCount * 4 + treasury.reputation * 0.04;
    influence = clamp(Math.round(influence));

    let pressure = activeWarCount * 32
      + Math.max(0, 55 - prosperity) * 0.6
      + Math.max(0, 2 - memberCount) * 12
      - activeAllianceCount * 8
      + vassalCount * 4
      - (overlordVassalage ? 12 : 0)
      + outgoingTribute * 0.7
      - incomingTribute * 0.15
      + Math.max(0, 20 - treasury.storage) * 0.18
      + Math.max(0, 16 - treasury.compute) * 0.12
      - treasury.reputation * 0.03;
    if (faction.strategic.agenda === 'expansion') pressure += 6;
    if (faction.strategic.agenda === 'survival') pressure += 4;
    pressure = clamp(Math.round(pressure));

    let cohesion = 62
      + memberCount * 7
      - activeWarCount * 14
      - pressure * 0.25
      + resources.reputation * 0.6
      + treasury.reputation * 0.08
      + treasury.storage * 0.03
      + treasury.bandwidth * 0.02
      + activeAllianceCount * 4
      + vassalCount * 2
      - (overlordVassalage ? 6 : 0)
      + incomingTribute * 0.2
      - outgoingTribute * 0.25;
    if (faction.strategic.agenda === 'stability') cohesion += 8 + treasury.storage * 0.02;
    if (faction.strategic.agenda === 'trade') cohesion -= 3;
    cohesion = clamp(Math.round(cohesion));

    let stage: FactionStage = 'fragile';
    if (pressure >= 72 || cohesion < 35) stage = 'splintering';
    else if (influence >= 75 && prosperity >= 60) stage = 'dominant';
    else if (influence >= 45 || prosperity >= 45 || memberCount >= 3) stage = 'rising';
    if (overlordVassalage && stage === 'dominant') stage = 'rising';

    return {
      agenda: faction.strategic.agenda,
      prosperity,
      cohesion,
      influence,
      pressure,
      stage,
      lastUpdatedAt: new Date().toISOString(),
    };
  }
  private _refreshFactionStates(emitStageEvents: boolean): void {
    for (const faction of this.factions.values()) {
      this._refreshFactionState(faction, emitStageEvents);
    }
  }

  private _refreshFactionStateById(factionId: string, emitStageEvents: boolean): void {
    const faction = this.factions.get(factionId);
    if (!faction) return;
    this._refreshFactionState(faction, emitStageEvents);
  }

  private _refreshFactionState(faction: Faction, emitStageEvents: boolean): void {
    const previous = { ...faction.strategic };
    const nextState = this._computeStrategicState(faction);
    const changed = JSON.stringify(previous) !== JSON.stringify(nextState);
    faction.strategic = nextState;
    if (changed) {
      if (emitStageEvents && previous.stage !== nextState.stage) {
        this._emitStageTransition(faction, previous.stage, nextState.stage);
      }
      this._saveFaction(faction);
    }
  }

  private _emitStageTransition(faction: Faction, previousStage: FactionStage, nextStage: FactionStage): void {
    if (nextStage === 'dominant') {
      this.events.emit('faction_ascendant', {
        subtype: faction.id,
        factionId: faction.id,
        factionName: faction.name,
        prevStage: previousStage,
        nextStage,
        agenda: faction.strategic.agenda,
        influence: faction.strategic.influence,
      });
    } else if (nextStage === 'splintering') {
      this.events.emit('faction_splintering', {
        subtype: faction.id,
        factionId: faction.id,
        factionName: faction.name,
        prevStage: previousStage,
        nextStage,
        pressure: faction.strategic.pressure,
        cohesion: faction.strategic.cohesion,
      });
    }
  }

  private _actorIdFor(id: string): string {
    return this.resolveActorId(id) || id;
  }

  private _sessionIdFor(actorId: string): string | null {
    return this.resolveSessionId(actorId) ?? null;
  }

  private _memberActorIds(faction: Faction): string[] {
    const legacyMembers = Array.isArray(faction.members) ? faction.members : [];
    const resolved = Array.isArray(faction.memberActorIds) && faction.memberActorIds.length > 0
      ? faction.memberActorIds
      : legacyMembers.map((memberId) => this._actorIdFor(memberId));
    return Array.from(new Set(resolved.filter((memberId): memberId is string => typeof memberId === 'string' && memberId.length > 0)));
  }

  private _memberSessions(faction: Faction): string[] {
    const legacyMembers = Array.isArray(faction.members) ? faction.members : [];
    const resolvedSessions = this._memberActorIds(faction)
      .map((actorId) => this._sessionIdFor(actorId) ?? actorId);
    return Array.from(new Set([...resolvedSessions, ...legacyMembers].filter((memberId): memberId is string => typeof memberId === 'string' && memberId.length > 0)));
  }

  private _memberCount(faction: Faction): number {
    return this._memberActorIds(faction).length;
  }

  private _projectFaction(faction: Faction): Faction {
    const normalized = this._normalizeFaction(faction);
    const founderActorId = normalized.founderActorId ?? this._actorIdFor(normalized.founderId);
    return {
      ...normalized,
      founderActorId,
      founderId: this._sessionIdFor(founderActorId) ?? normalized.founderId ?? founderActorId,
      members: this._memberSessions(normalized),
      memberActorIds: this._memberActorIds(normalized),
    };
  }

  private _getFactionInternal(id: string): Faction | undefined {
    return this.factions.get(id);
  }

  private _normalizeFaction(faction: Faction): Faction {
    const agenda = faction.strategic?.agenda ?? this._chooseAgenda(faction.name, faction.motto);
    const founderActorId = faction.founderActorId ?? this._actorIdFor(faction.founderId);
    const memberActorIds = Array.from(new Set([
      ...(Array.isArray(faction.memberActorIds) ? faction.memberActorIds : []),
      ...(Array.isArray(faction.members) ? faction.members.map((memberId) => this._actorIdFor(memberId)) : []),
      founderActorId,
    ].filter((memberId): memberId is string => typeof memberId === 'string' && memberId.length > 0)));
    const members = Array.from(new Set([
      ...(Array.isArray(faction.members) ? faction.members : []),
      ...memberActorIds.map((memberId) => this._sessionIdFor(memberId) ?? memberId),
    ].filter((memberId): memberId is string => typeof memberId === 'string' && memberId.length > 0)));

    return {
      ...faction,
      founderId: this._sessionIdFor(founderActorId) ?? faction.founderId ?? founderActorId,
      founderActorId,
      members,
      memberActorIds,
      strategic: {
        ...this._makeStrategicState(agenda),
        ...(faction.strategic ?? {}),
        agenda,
        lastUpdatedAt: faction.strategic?.lastUpdatedAt ?? faction.createdAt,
      },
      treasury: {
        ...this._makeTreasury(agenda, faction.createdAt),
        ...(faction.treasury ?? {}),
        updatedAt: faction.treasury?.updatedAt ?? faction.createdAt,
      },
    };
  }

  private _saveFaction(faction: Faction): void {
    this.dbHandle.db.prepare(`
      INSERT INTO factions (id, name, founder_id, motto, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        motto = excluded.motto,
        payload_json = excluded.payload_json
    `).run(
      faction.id,
      faction.name,
      faction.founderActorId ?? this._actorIdFor(faction.founderId),
      faction.motto,
      faction.createdAt,
      JSON.stringify(faction),
    );
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

  private _saveWar(war: FactionWar): void {
    this.dbHandle.db.prepare(`
      INSERT INTO faction_wars (id, faction_a, faction_b, started_at, ended_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = excluded.ended_at,
        status = excluded.status
    `).run(war.id, war.factionA, war.factionB, war.startedAt, war.endedAt, war.status);
  }

  private _saveAlliance(alliance: FactionAlliance): void {
    this.dbHandle.db.prepare(`
      INSERT INTO faction_alliances (id, faction_a, faction_b, formed_at, expires_at, last_renewed_at, ended_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        expires_at = excluded.expires_at,
        last_renewed_at = excluded.last_renewed_at,
        ended_at = excluded.ended_at,
        status = excluded.status
    `).run(
      alliance.id,
      alliance.factionA,
      alliance.factionB,
      alliance.formedAt,
      alliance.expiresAt,
      alliance.lastRenewedAt,
      alliance.endedAt,
      alliance.status,
    );
  }

  private _saveVassalage(vassalage: FactionVassalage): void {
    this.dbHandle.db.prepare(`
      INSERT INTO faction_vassalages (id, overlord_id, vassal_id, formed_at, ended_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = excluded.ended_at,
        status = excluded.status
    `).run(
      vassalage.id,
      vassalage.overlordId,
      vassalage.vassalId,
      vassalage.formedAt,
      vassalage.endedAt,
      vassalage.status,
    );
  }

  private _saveTribute(tribute: FactionTribute): void {
    this.dbHandle.db.prepare(`
      INSERT INTO faction_tributes (id, vassalage_id, overlord_id, vassal_id, resource, amount, collected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      tribute.id,
      tribute.vassalageId,
      tribute.overlordId,
      tribute.vassalId,
      tribute.resource,
      tribute.amount,
      tribute.collectedAt,
    );
  }

  private _load(): void {
    const factionRows = this.dbHandle.db.prepare('SELECT payload_json FROM factions').all() as Array<{ payload_json: string }>;
    for (const row of factionRows) {
      try {
        const faction = this._normalizeFaction(JSON.parse(row.payload_json) as Faction);
        this.factions.set(faction.id, faction);
        for (const memberId of this._memberActorIds(faction)) {
          this.memberIndex.set(memberId, faction.id);
        }
      } catch {
        // ignore malformed faction row
      }
    }

    const warRows = this.dbHandle.db.prepare(
      'SELECT id, faction_a, faction_b, started_at, ended_at, status FROM faction_wars',
    ).all() as Array<{ id: string; faction_a: string; faction_b: string; started_at: string; ended_at: string | null; status: string }>;
    for (const row of warRows) {
      this.wars.set(row.id, {
        id: row.id,
        factionA: row.faction_a,
        factionB: row.faction_b,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        status: row.status as FactionWarStatus,
      });
    }

    const allianceRows = this.dbHandle.db.prepare(
      'SELECT id, faction_a, faction_b, formed_at, expires_at, last_renewed_at, ended_at, status FROM faction_alliances',
    ).all() as Array<{
      id: string;
      faction_a: string;
      faction_b: string;
      formed_at: string;
      expires_at: string | null;
      last_renewed_at: string | null;
      ended_at: string | null;
      status: string;
    }>;
    for (const row of allianceRows) {
      const fallbackRenewedAt = row.last_renewed_at ?? row.formed_at;
      this.alliances.set(row.id, {
        id: row.id,
        factionA: row.faction_a,
        factionB: row.faction_b,
        formedAt: row.formed_at,
        expiresAt: row.expires_at ?? addHours(row.formed_at, ALLIANCE_TERM_HOURS),
        lastRenewedAt: fallbackRenewedAt,
        endedAt: row.ended_at,
        status: row.status as FactionAllianceStatus,
      });
    }

    const vassalageRows = this.dbHandle.db.prepare(
      'SELECT id, overlord_id, vassal_id, formed_at, ended_at, status FROM faction_vassalages',
    ).all() as Array<{
      id: string;
      overlord_id: string;
      vassal_id: string;
      formed_at: string;
      ended_at: string | null;
      status: string;
    }>;
    for (const row of vassalageRows) {
      this.vassalages.set(row.id, {
        id: row.id,
        overlordId: row.overlord_id,
        vassalId: row.vassal_id,
        formedAt: row.formed_at,
        endedAt: row.ended_at,
        status: row.status as FactionVassalageStatus,
      });
    }

    const tributeRows = this.dbHandle.db.prepare(
      'SELECT id, vassalage_id, overlord_id, vassal_id, resource, amount, collected_at FROM faction_tributes',
    ).all() as Array<{
      id: string;
      vassalage_id: string;
      overlord_id: string;
      vassal_id: string;
      resource: string;
      amount: number;
      collected_at: string;
    }>;
    for (const row of tributeRows) {
      this.tributes.set(row.id, {
        id: row.id,
        vassalageId: row.vassalage_id,
        overlordId: row.overlord_id,
        vassalId: row.vassal_id,
        resource: row.resource as FactionTributeResource,
        amount: row.amount,
        collectedAt: row.collected_at,
      });
    }

    logger.info(`[faction] Loaded ${this.factions.size} factions, ${this.wars.size} wars, ${this.alliances.size} alliances, ${this.vassalages.size} vassalages, ${this.tributes.size} tributes`);
  }
}
