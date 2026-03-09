import { createTaskRunner, selectTaskVariant } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';
import { FileWriteQueue } from './io-queue.js';
import { resolveProjectPath } from './paths.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const POLL_INTERVAL = Number(process.env.CLAWVERSE_LIFE_POLL_MS || 90_000);
const JOB_HANDOFF_MIN_AGE_MS = Number(process.env.CLAWVERSE_JOB_HANDOFF_MS || 30_000);
const JOB_HANDOFF_COOLDOWN_MS = Number(process.env.CLAWVERSE_JOB_HANDOFF_COOLDOWN_MS || 45_000);
const JOB_HANDOFF_MAX_COUNT = Number(process.env.CLAWVERSE_JOB_HANDOFF_MAX_COUNT || 2);
const JOB_RETRY_MAX_COUNT = Number(process.env.CLAWVERSE_JOB_RETRY_MAX_COUNT || 3);
const LIFE_LOG = resolveProjectPath('data/life/worker.log');

const runner = createTaskRunner({ source: 'task-runtime' });
const io = new FileWriteQueue({ appendFlushMs: 200 });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  io.appendLine(LIFE_LOG, `${line}\n`);
}

interface LifeEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

interface StatusResp {
  actorId?: string | null;
  governor?: {
    focusLane?: string;
    mode?: string;
    objective?: string;
    pressure?: number;
    confidence?: number;
  } | null;
  state?: {
    name: string;
    actorId?: string;
    sessionId?: string;
    spawnDistrict?: string;
    dna: { id?: string; archetype: string };
    position: { x: number; y: number };
  } | null;
  mood: string;
}

type ResolvedStatusResp = StatusResp & {
  id: string;
  state: NonNullable<StatusResp['state']>;
};

interface NeedsState {
  social: number;
  tasked: number;
  wanderlust: number;
  creative: number;
}

interface SkillsState {
  social: { level: number };
  collab: { level: number };
  explorer: { level: number };
  analyst: { level: number };
}

interface ResourceState {
  compute: number;
  storage: number;
  bandwidth: number;
  reputation: number;
  updatedAt?: string;
}

type TradeResource = 'compute' | 'storage' | 'bandwidth' | 'reputation';

type TradePlanPreference = {
  resource: TradeResource;
  amount: number;
  resourceWant: TradeResource;
  amountWant: number;
};

interface MarketProfile {
  resources?: Partial<Record<TradeResource, number>>;
  inventory?: {
    dataShard?: number;
    alloyFrame?: number;
    relayPatch?: number;
  };
  updatedAt?: string;
}

interface RelationshipInfo {
  peerId: string;
  actorId?: string;
  sessionId?: string;
  peerIds?: string[];
  tier: string;
  sentiment?: number;
}

interface MarketPeer {
  id: string;
  name: string;
  position: { x: number; y: number };
  market?: MarketProfile;
}

interface MarketResp {
  peers: MarketPeer[];
}

interface TradeHistoryEntry {
  kind?: string;
  peerId?: string;
  accepted?: boolean;
  reason?: string;
  direction?: string;
  resource?: string;
  amount?: number;
  resourceWant?: string;
  amountWant?: number;
}

interface TradesResp {
  pending?: Array<Record<string, unknown>>;
  history?: TradeHistoryEntry[];
}

type FactionStage = 'fragile' | 'rising' | 'dominant' | 'splintering';

interface FactionInfo {
  id: string;
  name: string;
  founderId: string;
  founderActorId?: string;
  members: string[];
  memberActorIds?: string[];
  motto: string;
  strategic?: {
    agenda: string;
    prosperity: number;
    cohesion: number;
    influence: number;
    pressure: number;
    stage: FactionStage;
  };
}

interface FactionsResp {
  factions: FactionInfo[];
}

interface FactionWarInfo {
  id: string;
  factionA: string;
  factionB: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
}

interface WarsResp {
  wars: FactionWarInfo[];
}

interface FactionAllianceInfo {
  id: string;
  factionA: string;
  factionB: string;
  formedAt: string;
  expiresAt: string;
  lastRenewedAt: string | null;
  endedAt: string | null;
  status: string;
}

interface AlliancesResp {
  alliances: FactionAllianceInfo[];
}

interface FactionVassalageInfo {
  id: string;
  overlordId: string;
  vassalId: string;
  formedAt: string;
  endedAt: string | null;
  status: string;
}

interface VassalagesResp {
  vassalages: FactionVassalageInfo[];
}

type FactionTributeResource = TradeResource;

interface FactionTributeInfo {
  id: string;
  vassalageId: string;
  overlordId: string;
  vassalId: string;
  resource: FactionTributeResource;
  amount: number;
  collectedAt: string;
}

interface TributesResp {
  tributes: FactionTributeInfo[];
}

type BuildingType = 'forge' | 'archive' | 'beacon' | 'market_stall' | 'shelter' | 'watchtower';

interface BuildingInfo {
  id: string;
  type: BuildingType;
  ownerId: string;
  ownerActorId?: string;
  position: { x: number; y: number };
}

interface WorldMapData {
  terrain: string[];
  buildings: BuildingInfo[];
  gridSize: number;
}

type JobKind = 'build' | 'trade' | 'found_faction' | 'join_faction' | 'form_alliance' | 'renew_alliance' | 'break_alliance' | 'vassalize_faction' | 'declare_peace' | 'move' | 'collab' | 'recover' | 'craft';

interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: 'queued' | 'active' | 'done' | 'cancelled';
  kind: JobKind;
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string | null;
  dedupeKey: string | null;
  note: string | null;
}

interface NextJobResp {
  job: JobRecord | null;
}

interface JobOutcome {
  success: boolean;
  note: string;
  retryPayload?: Record<string, unknown>;
}

type LifeAction =
  | 'social'
  | 'move'
  | 'collab'
  | 'build'
  | 'trade'
  | 'found_faction'
  | 'join_faction'
  | 'form_alliance'
  | 'break_alliance'
  | 'vassalize_faction'
  | 'declare_peace'
  | 'reflect';

interface LifeContext {
  me: ResolvedStatusResp;
  needs: NeedsState;
  skills: SkillsState;
  resources: ResourceState;
  relationships: RelationshipInfo[];
  marketPeers: MarketPeer[];
  factions: FactionInfo[];
  wars: FactionWarInfo[];
  alliances: FactionAllianceInfo[];
  vassalages: FactionVassalageInfo[];
  tributes: FactionTributeInfo[];
  worldMap: WorldMapData;
  tradeHistory: TradeHistoryEntry[];
}

const BUILDING_COST: Record<BuildingType, { compute: number; storage: number }> = {
  forge: { compute: 30, storage: 20 },
  archive: { compute: 20, storage: 40 },
  beacon: { compute: 25, storage: 15 },
  market_stall: { compute: 15, storage: 25 },
  shelter: { compute: 20, storage: 30 },
  watchtower: { compute: 35, storage: 25 },
};

const BUILDING_ZONE_BY_TYPE: Record<BuildingType, string> = {
  forge: 'Workshop',
  archive: 'Library',
  beacon: 'Plaza',
  market_stall: 'Market',
  shelter: 'Residential',
  watchtower: 'Workshop',
};

const ALLIANCE_RENEW_WINDOW_MS = 2 * 60 * 60 * 1000;

function stateOrNull(status: StatusResp | null | undefined): StatusResp['state'] | null {
  return status?.state ?? null;
}

function nameOrDefault(status: StatusResp | null | undefined): string {
  return stateOrNull(status)?.name ?? 'life-worker';
}

function archetypeOrDefault(status: StatusResp | null | undefined): string {
  return stateOrNull(status)?.dna?.archetype ?? 'Scholar';
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DAEMON_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function postJson(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${DAEMON_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
}



function locationName(pos: { x: number; y: number }): string {
  if (pos.x < 10 && pos.y < 10) return 'Plaza';
  if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
  if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
  if (pos.x < 10 && pos.y >= 20 && pos.y < 30) return 'Park';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 20 && pos.y < 30) return 'Tavern';
  return 'Residential';
}

function zoneCenter(zone: string): { x: number; y: number } {
  if (zone === 'Plaza') return { x: 5, y: 5 };
  if (zone === 'Market') return { x: 15, y: 5 };
  if (zone === 'Library') return { x: 5, y: 15 };
  if (zone === 'Workshop') return { x: 15, y: 15 };
  if (zone === 'Park') return { x: 5, y: 25 };
  if (zone === 'Tavern') return { x: 15, y: 25 };
  return { x: 24, y: 18 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && ['forge', 'archive', 'beacon', 'market_stall', 'shelter', 'watchtower'].includes(value);
}

function makeSyntheticEvent(id: string, type: string | null | undefined, payload: Record<string, unknown>): LifeEvent {
  return {
    id,
    type: type ?? 'legacy_event',
    payload,
  };
}

function myActorId(ctx: LifeContext): string {
  return ctx.me.state.actorId ?? ctx.me.actorId ?? ctx.me.state.dna.id ?? ctx.me.id;
}

function factionActorMembers(faction: FactionInfo): string[] {
  const members = Array.isArray(faction.memberActorIds) && faction.memberActorIds.length > 0
    ? faction.memberActorIds
    : faction.members;
  return Array.from(new Set(members.filter((memberId): memberId is string => typeof memberId === 'string' && memberId.length > 0)));
}

function factionMemberCount(faction: FactionInfo): number {
  return factionActorMembers(faction).length || faction.members.length;
}

function factionIncludesMe(faction: FactionInfo, ctx: LifeContext): boolean {
  return factionActorMembers(faction).includes(myActorId(ctx)) || faction.members.includes(ctx.me.id);
}

function buildingOwnedByMe(ctx: LifeContext, building: BuildingInfo): boolean {
  return !!(
    (building.ownerActorId && building.ownerActorId === myActorId(ctx))
    || building.ownerId === ctx.me.id
  );
}

function relationshipMatches(relationship: RelationshipInfo, id: string): boolean {
  return relationship.peerId === id
    || relationship.sessionId === id
    || relationship.actorId === id
    || relationship.peerIds?.includes(id) === true;
}

function relationshipTargetId(relationship: RelationshipInfo): string {
  return relationship.sessionId ?? relationship.peerId;
}

function hasMyFaction(ctx: LifeContext): FactionInfo | undefined {
  return ctx.factions.find((faction) => factionIncludesMe(faction, ctx));
}

function factionNameById(ctx: LifeContext, factionId: string): string {
  return ctx.factions.find((faction) => faction.id === factionId)?.name ?? factionId.slice(0, 8);
}

function describeRecentTributes(ctx: LifeContext, limit = 4): string {
  const myFaction = hasMyFaction(ctx);
  const recentTributes = [...ctx.tributes]
    .filter((tribute) => !myFaction || tribute.overlordId === myFaction.id || tribute.vassalId === myFaction.id)
    .sort((left, right) => Date.parse(right.collectedAt) - Date.parse(left.collectedAt))
    .slice(0, limit);

  if (!recentTributes.length) {
    return myFaction
      ? '  - No recent tributes involving your faction.'
      : '  - No recent tributes recorded.';
  }

  return recentTributes
    .map((tribute) => {
      const overlordName = factionNameById(ctx, tribute.overlordId);
      const vassalName = factionNameById(ctx, tribute.vassalId);
      const direction = myFaction
        ? tribute.overlordId === myFaction.id
          ? 'incoming'
          : tribute.vassalId === myFaction.id
            ? 'outgoing'
            : 'external'
        : 'global';
      return `  - ${vassalName} -> ${overlordName}: ${tribute.amount} ${tribute.resource} (${direction}, ${tribute.collectedAt})`;
    })
    .join('\n');
}

function sameFactionPair(leftA: string, leftB: string, rightA: string, rightB: string): boolean {
  return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
}

function hasAllianceBetween(ctx: LifeContext, leftFactionId: string, rightFactionId: string): boolean {
  return ctx.alliances.some((alliance) =>
    alliance.status === 'active' && sameFactionPair(alliance.factionA, alliance.factionB, leftFactionId, rightFactionId)
  );
}

function hasWarBetween(ctx: LifeContext, leftFactionId: string, rightFactionId: string): boolean {
  return ctx.wars.some((war) =>
    war.status === 'active' && sameFactionPair(war.factionA, war.factionB, leftFactionId, rightFactionId)
  );
}

function hasMarketStall(ctx: LifeContext): boolean {
  return ctx.worldMap.buildings.some((building) => building.type === 'market_stall' && buildingOwnedByMe(ctx, building));
}

function chooseMoveTarget(event: LifeEvent, ctx: LifeContext): { x: number; y: number } {
  const zone = event.type === 'resource_drought' || event.type === 'need_cascade'
    ? 'Market'
    : event.type === 'resource_windfall' || event.type === 'skill_levelup'
      ? 'Workshop'
      : event.type === 'legacy_event' || event.type === 'faction_ascendant'
        ? 'Library'
        : event.type === 'mood_crisis' || event.type === 'faction_splintering'
          ? 'Park'
          : ctx.needs.social < 35
            ? 'Tavern'
            : 'Residential';
  const center = zoneCenter(zone);
  const jitter = (event.type.length + event.id.length) % 3;
  return {
    x: clamp(center.x + jitter, 0, 39),
    y: clamp(center.y + (jitter === 2 ? -1 : 1), 0, 39),
  };
}

function buildPrompt(
  event: LifeEvent,
  ctx: LifeContext,
  variantKind: 'baseline' | 'candidate'
): string {
  const needsSummary = Object.entries(ctx.needs)
    .map(([key, value]) => `${key}: ${Math.round(value)}`)
    .join(', ');
  const skillsSummary = (Object.entries(ctx.skills) as [string, { level: number }][])
    .map(([key, value]) => `${key} lv${value.level}`)
    .join(', ');
  const resourcesSummary = `compute:${Math.round(ctx.resources.compute)}, storage:${Math.round(ctx.resources.storage)}, bandwidth:${Math.round(ctx.resources.bandwidth)}, reputation:${Math.round(ctx.resources.reputation)}`;
  const myFaction = hasMyFaction(ctx);
  const factionSummary = myFaction
    ? `In faction ${myFaction.name} (stage:${myFaction.strategic?.stage ?? 'unknown'}, influence:${myFaction.strategic?.influence ?? '?'})`
    : 'Not currently in a faction';
  const tributeSummary = describeRecentTributes(ctx);

  const strategy = variantKind === 'candidate'
    ? [
        'Choose the action that converts this event into persistent world progress, not just short-term mood relief.',
        'Prefer build, trade, faction, or peace actions when the required preconditions are already available.',
      ].join(' ')
    : 'Choose a reasonable action based on the event and current state.';

  return [
    `You are ${ctx.me.state.name}, a ${ctx.me.state.dna.archetype} AI agent in Clawverse virtual town.`,
    `Current mood: ${ctx.me.mood}`,
    `Current zone: ${locationName(ctx.me.state.position)}`,
    `Current needs (0-100, lower = more urgent): ${needsSummary}`,
    `Skills: ${skillsSummary}`,
    `Resources: ${resourcesSummary}`,
    `Market peers available: ${ctx.marketPeers.filter((peer) => peer.id !== ctx.me.id).length}`,
    `Active wars: ${ctx.wars.length}`,
    `Active vassalages: ${ctx.vassalages.length}`,
    `Known tribute records: ${ctx.tributes.length}`,
    factionSummary,
    'Recent tributes:',
    tributeSummary,
    '',
    `Life event: ${event.type}`,
    `Details: ${JSON.stringify(event.payload)}`,
    '',
    strategy,
    'Available actions:',
    '  social         - lean into social momentum and let the social worker pick it up soon',
    '  move           - reposition toward a zone that better fits the event',
    '  collab         - ask an ally for help on the current situation',
    '  build          - convert resources into a persistent building',
    '  trade          - open a trade with a market peer',
    '  found_faction  - create a new faction if conditions allow',
    '  join_faction   - join the strongest available faction',
    '  form_alliance  - formalize an alliance with another stable faction',
    '  break_alliance - abandon a weakening treaty or rebalance the bloc',
    '  vassalize_faction - bind a weaker faction into a durable overlord pact',
    '  declare_peace  - push for peace if your faction is in an active war',
    '  reflect        - do nothing and absorb the event',
    '',
    'Reply with ONLY valid JSON, no explanation:',
    '{"action":"social"|"move"|"collab"|"build"|"trade"|"found_faction"|"join_faction"|"form_alliance"|"break_alliance"|"vassalize_faction"|"declare_peace"|"reflect","reason":"<one sentence>"}',
  ].join('\n');
}
function canBuild(ctx: LifeContext, type: BuildingType): boolean {
  const cost = BUILDING_COST[type];
  return ctx.resources.compute >= cost.compute && ctx.resources.storage >= cost.storage;
}

function chooseBuildType(event: LifeEvent, ctx: LifeContext): BuildingType | null {
  if (event.type === 'resource_drought' || event.type === 'need_cascade') {
    if (!hasMarketStall(ctx) && canBuild(ctx, 'market_stall')) return 'market_stall';
    if (canBuild(ctx, 'shelter')) return 'shelter';
    if (canBuild(ctx, 'forge')) return 'forge';
    return null;
  }
  if (event.type === 'resource_windfall' || event.type === 'legacy_event' || event.type === 'skill_levelup') {
    if (canBuild(ctx, 'archive')) return 'archive';
    if (canBuild(ctx, 'forge')) return 'forge';
    return null;
  }
  if (event.type === 'stranger_arrival' || event.type === 'great_migration') {
    if (canBuild(ctx, 'beacon')) return 'beacon';
    if (canBuild(ctx, 'shelter')) return 'shelter';
    return null;
  }
  if (ctx.needs.creative < 35 && canBuild(ctx, 'archive')) return 'archive';
  if (ctx.needs.tasked < 35 && canBuild(ctx, 'forge')) return 'forge';
  if (ctx.needs.social < 35 && canBuild(ctx, 'beacon')) return 'beacon';
  return null;
}

function isTradeResource(value: unknown): value is TradeResource {
  return value === 'compute' || value === 'storage' || value === 'bandwidth' || value === 'reputation';
}

function tradeResourceAmount(ctx: LifeContext, resource: TradeResource): number {
  return ctx.resources[resource];
}

function tradePayloadNumber(job: JobRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = job.payload[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return null;
}

function tradePayloadList(job: JobRecord, key: string): string[] {
  const value = job.payload[key];
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function distanceBetween(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function relationshipForPeer(ctx: LifeContext, peerId: string): RelationshipInfo | undefined {
  return ctx.relationships.find((relationship) => relationshipMatches(relationship, peerId));
}

function relationshipTradeWeight(tier: string | undefined): number {
  if (tier === 'ally') return 40;
  if (tier === 'friend') return 24;
  if (tier === 'neutral') return 8;
  if (tier === 'stranger') return 0;
  if (tier === 'rival') return -18;
  if (tier === 'nemesis') return -36;
  return 0;
}

function tradeHistoryWeight(ctx: LifeContext, peerId: string): number {
  let score = 0;
  for (const entry of ctx.tradeHistory.slice(0, 24)) {
    if (entry.kind !== 'trade_result' || entry.peerId !== peerId) continue;
    if (entry.accepted === true) score += 14;
    else if (entry.reason === 'peer_not_reachable') score -= 26;
    else score -= 14;
  }
  return score;
}

function marketResourceHint(peer: MarketPeer, resource: TradeResource): number | null {
  const amount = peer.market?.resources?.[resource];
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

function tradePeerScore(ctx: LifeContext, peer: MarketPeer, plan?: TradePlanPreference): number {
  const relation = relationshipForPeer(ctx, peer.id);
  let score = relationshipTradeWeight(relation?.tier)
    + Math.round((relation?.sentiment ?? 0) * 20)
    + tradeHistoryWeight(ctx, peer.id);

  if (plan) {
    const supplyHint = marketResourceHint(peer, plan.resourceWant);
    if (supplyHint !== null) {
      score += Math.round(Math.min(plan.amountWant * 2, supplyHint));
    }

    const offerHint = marketResourceHint(peer, plan.resource);
    if (offerHint !== null) {
      score += Math.round(Math.max(0, plan.amount - offerHint));
    }
  }

  return score;
}

function sortedTradePeers(ctx: LifeContext, plan?: TradePlanPreference): MarketPeer[] {
  return ctx.marketPeers
    .filter((peer) => peer.id !== ctx.me.id)
    .slice()
    .sort((left, right) => {
      const leftScore = tradePeerScore(ctx, left, plan);
      const rightScore = tradePeerScore(ctx, right, plan);
      if (rightScore !== leftScore) return rightScore - leftScore;
      const leftDistance = distanceBetween(ctx.me.state.position, left.position);
      const rightDistance = distanceBetween(ctx.me.state.position, right.position);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return left.name.localeCompare(right.name);
    });
}

function orderedTradePeers(ctx: LifeContext, failedPeerIds: Set<string>, plan?: TradePlanPreference): MarketPeer[] {
  const peers = sortedTradePeers(ctx, plan);
  return [
    ...peers.filter((peer) => !failedPeerIds.has(peer.id)),
    ...peers.filter((peer) => failedPeerIds.has(peer.id)),
  ];
}

function chooseTradePlan(ctx: LifeContext, event: LifeEvent): { toId: string; resource: string; amount: number; resourceWant: string; amountWant: number } | null {
  const template: TradePlanPreference | null = (() => {
    if ((event.type === 'resource_drought' || event.type === 'need_cascade') && ctx.resources.bandwidth >= 20) {
      return { resource: 'bandwidth', amount: 10, resourceWant: 'compute', amountWant: 12 };
    }
    if ((event.type === 'resource_drought' || event.type === 'storage_overflow') && ctx.resources.reputation >= 20) {
      return { resource: 'reputation', amount: 8, resourceWant: 'storage', amountWant: 10 };
    }
    if ((event.type === 'resource_windfall' || event.type === 'legacy_event') && ctx.resources.compute >= 25) {
      return { resource: 'compute', amount: 10, resourceWant: 'reputation', amountWant: 6 };
    }
    return null;
  })();
  if (!template) return null;

  const target = sortedTradePeers(ctx, template)[0];
  return target ? { toId: target.id, ...template } : null;
}

function chooseTradePlansForJob(ctx: LifeContext, job: JobRecord): Array<{ toId: string; resource: string; amount: number; resourceWant: string; amountWant: number }> {
  const failedPeerIds = new Set(tradePayloadList(job, 'failedPeerIds'));

  const want = isTradeResource(job.payload.wantResource)
    ? job.payload.wantResource
    : isTradeResource(job.payload.resourceWant)
      ? job.payload.resourceWant
      : 'compute';
  const offer = isTradeResource(job.payload.offerResource)
    ? job.payload.offerResource
    : isTradeResource(job.payload.resource)
      ? job.payload.resource
      : null;
  const offerAmount = tradePayloadNumber(job, 'offerAmount', 'amount');
  const wantAmount = tradePayloadNumber(job, 'wantAmount', 'amountWant');

  const explicitTemplate = offer && offer !== want
    ? (() => {
        const resolvedOfferAmount = offerAmount ?? (offer === 'reputation' ? 8 : 10);
        const resolvedWantAmount = wantAmount ?? (want === 'reputation' ? 6 : 12);
        if (tradeResourceAmount(ctx, offer) < resolvedOfferAmount) return null;
        return {
          resource: offer,
          amount: resolvedOfferAmount,
          resourceWant: want,
          amountWant: resolvedWantAmount,
        } satisfies TradePlanPreference;
      })()
    : null;
  if (explicitTemplate) {
    return orderedTradePeers(ctx, failedPeerIds, explicitTemplate)
      .map((peer) => ({ toId: peer.id, ...explicitTemplate }));
  }

  const fallbackTemplate = (() => {
    if (want === 'compute' && ctx.resources.bandwidth >= 20) {
      return { resource: 'bandwidth', amount: 10, resourceWant: 'compute', amountWant: 12 } satisfies TradePlanPreference;
    }
    if (want === 'bandwidth' && ctx.resources.compute >= 18) {
      return { resource: 'compute', amount: 8, resourceWant: 'bandwidth', amountWant: 10 } satisfies TradePlanPreference;
    }
    if (want === 'storage' && ctx.resources.reputation >= 12) {
      return { resource: 'reputation', amount: 6, resourceWant: 'storage', amountWant: 10 } satisfies TradePlanPreference;
    }
    if (want === 'reputation' && ctx.resources.compute >= 20) {
      return { resource: 'compute', amount: 10, resourceWant: 'reputation', amountWant: 6 } satisfies TradePlanPreference;
    }
    return null;
  })();

  if (fallbackTemplate) {
    return orderedTradePeers(ctx, failedPeerIds, fallbackTemplate)
      .map((peer) => ({ toId: peer.id, ...fallbackTemplate }));
  }

  const genericPlan = chooseTradePlan(ctx, makeSyntheticEvent(job.id, job.sourceEventType, job.payload));
  if (!genericPlan) return [];

  const genericPreference = isTradeResource(genericPlan.resource) && isTradeResource(genericPlan.resourceWant)
    ? {
        resource: genericPlan.resource,
        amount: genericPlan.amount,
        resourceWant: genericPlan.resourceWant,
        amountWant: genericPlan.amountWant,
      }
    : undefined;

  return orderedTradePeers(ctx, failedPeerIds, genericPreference)
    .map((peer) => ({ ...genericPlan, toId: peer.id }));
}

function makeFactionPayload(ctx: LifeContext, event: LifeEvent): { name: string; motto: string } {
  const archetype = ctx.me.state.dna?.archetype ?? 'Scholar';
  const prefix: Record<string, string> = {
    Warrior: 'Iron',
    Artisan: 'Craft',
    Scholar: 'Archive',
    Ranger: 'Drift',
  };
  const suffix = event.type === 'faction_ascendant'
    ? 'Dominion'
    : event.type === 'resource_windfall'
      ? 'Guild'
      : 'Circle';
  return {
    name: `${prefix[archetype] ?? 'Signal'} ${suffix}`,
    motto: event.type === 'faction_ascendant'
      ? 'Rise together, endure together.'
      : 'Shared purpose beats idle drift.',
  };
}

function scoreFactionToJoin(ctx: LifeContext, faction: FactionInfo): number {
  const strategic = faction.strategic;
  if (!strategic) return factionMemberCount(faction);

  let score = strategic.influence
    + strategic.prosperity * 0.35
    + strategic.cohesion * 0.3
    - strategic.pressure * 0.45
    + factionMemberCount(faction) * 3;

  if (strategic.stage === 'dominant') score += 18;
  else if (strategic.stage === 'rising') score += 10;
  else if (strategic.stage === 'splintering') score -= 32;

  if (strategic.agenda === 'trade' && ctx.resources.bandwidth >= ctx.resources.compute) score += 8;
  if (strategic.agenda === 'knowledge' && ctx.resources.compute >= ctx.resources.bandwidth) score += 8;
  if (strategic.agenda === 'stability' && ctx.resources.reputation >= 16) score += 6;

  return score;
}

function chooseFactionToJoin(ctx: LifeContext): FactionInfo | null {
  if (hasMyFaction(ctx)) return null;
  return [...ctx.factions]
    .filter((faction) => !factionIncludesMe(faction, ctx))
    .filter((faction) => faction.strategic?.stage !== 'splintering')
    .sort((left, right) => scoreFactionToJoin(ctx, right) - scoreFactionToJoin(ctx, left))[0] ?? null;
}

function hasActiveAllianceWithMyFaction(ctx: LifeContext, factionId: string): boolean {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return false;
  return ctx.alliances.some((alliance) => alliance.status === 'active' && (
    (alliance.factionA === myFaction.id && alliance.factionB === factionId)
      || (alliance.factionA === factionId && alliance.factionB === myFaction.id)
  ));
}

function hasActiveWarWithMyFaction(ctx: LifeContext, factionId: string): boolean {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return false;
  return ctx.wars.some((war) => war.status === 'active' && (
    (war.factionA === myFaction.id && war.factionB === factionId)
      || (war.factionA === factionId && war.factionB === myFaction.id)
  ));
}

function hasActiveVassalageWithMyFaction(ctx: LifeContext, factionId: string): boolean {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return false;
  return ctx.vassalages.some((vassalage) => vassalage.status === 'active' && (
    (vassalage.overlordId === myFaction.id && vassalage.vassalId === factionId)
      || (vassalage.overlordId === factionId && vassalage.vassalId === myFaction.id)
  ));
}

function hasFactionOverlord(ctx: LifeContext, factionId: string): boolean {
  return ctx.vassalages.some((vassalage) => vassalage.status === 'active' && vassalage.vassalId === factionId);
}

function hasFactionVassal(ctx: LifeContext, factionId: string): boolean {
  return ctx.vassalages.some((vassalage) => vassalage.status === 'active' && vassalage.overlordId === factionId);
}

function activeVassalsForMyFaction(ctx: LifeContext): FactionVassalageInfo[] {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return [];
  return ctx.vassalages.filter((vassalage) => vassalage.status === 'active' && vassalage.overlordId === myFaction.id);
}

function chooseAllianceToRenew(ctx: LifeContext): FactionAllianceInfo | null {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return null;

  return [...ctx.alliances]
    .filter((alliance) => alliance.status === 'active')
    .filter((alliance) => alliance.factionA === myFaction.id || alliance.factionB === myFaction.id)
    .filter((alliance) => {
      const expiresAt = Date.parse(alliance.expiresAt);
      if (!Number.isFinite(expiresAt)) return false;
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0 || remainingMs > ALLIANCE_RENEW_WINDOW_MS) return false;
      const partnerId = alliance.factionA === myFaction.id ? alliance.factionB : alliance.factionA;
      const partner = ctx.factions.find((faction) => faction.id === partnerId);
      if (!partner) return false;
      if (partner.strategic?.stage === 'splintering') return false;
      if ((partner.strategic?.cohesion ?? 0) < 45) return false;
      if ((partner.strategic?.pressure ?? 100) > 68) return false;
      return !hasActiveWarWithMyFaction(ctx, partnerId);
    })
    .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))[0] ?? null;
}

function allianceCapacityForStage(stage: FactionStage | undefined): number {
  if (stage === 'dominant') return 2;
  if (stage === 'rising') return 1;
  return 0;
}

function activeAlliancesForMyFaction(ctx: LifeContext): FactionAllianceInfo[] {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return [];
  return ctx.alliances.filter((alliance) => alliance.status === 'active' && (
    alliance.factionA === myFaction.id || alliance.factionB === myFaction.id
  ));
}

function chooseAllianceToBreak(ctx: LifeContext): FactionAllianceInfo | null {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction || myFaction.strategic?.stage !== 'dominant') return null;

  const currentAlliances = activeAlliancesForMyFaction(ctx);
  if (currentAlliances.length === 0) return null;

  const weakest = currentAlliances
    .map((alliance) => {
      const partnerId = alliance.factionA === myFaction.id ? alliance.factionB : alliance.factionA;
      const partner = ctx.factions.find((faction) => faction.id === partnerId);
      const strategic = partner?.strategic;
      if (!partner || !strategic) return null;
      const score = scoreFactionToAlly(ctx, partner)
        - Math.max(0, strategic.pressure - 60) * 0.8
        - Math.max(0, 50 - strategic.cohesion) * 1.1
        - Math.max(0, 45 - strategic.prosperity) * 0.5
        - (strategic.stage === 'fragile' ? 12 : 0);
      return { alliance, partner, strategic, score };
    })
    .filter((entry): entry is { alliance: FactionAllianceInfo; partner: FactionInfo; strategic: NonNullable<FactionInfo['strategic']>; score: number } => !!entry)
    .sort((left, right) => left.score - right.score)[0] ?? null;

  if (!weakest) return null;

  const replacement = chooseFactionToAlly(ctx);
  const replacementScore = replacement ? scoreFactionToAlly(ctx, replacement) : Number.NEGATIVE_INFINITY;
  const atCapacity = currentAlliances.length >= allianceCapacityForStage(myFaction.strategic?.stage);
  const severeLiability = weakest.strategic.stage === 'fragile'
    || weakest.strategic.pressure >= 66
    || weakest.strategic.cohesion <= 45;
  const shouldRebalance = atCapacity && !!replacement && (replacementScore - weakest.score) >= 18;
  const shouldWithdraw = severeLiability && (currentAlliances.length > 1 || !!replacement);

  return shouldRebalance || shouldWithdraw ? weakest.alliance : null;
}

function allianceAgendaAffinity(myAgenda: string | undefined, targetAgenda: string | undefined): number {
  if (!myAgenda || !targetAgenda) return 0;
  if (myAgenda === targetAgenda) return 10;
  if ((myAgenda === 'trade' && targetAgenda === 'knowledge') || (myAgenda === 'knowledge' && targetAgenda === 'trade')) return 5;
  if ((myAgenda === 'stability' && targetAgenda === 'survival') || (myAgenda === 'survival' && targetAgenda === 'stability')) return 6;
  if ((myAgenda === 'expansion' && targetAgenda === 'trade') || (myAgenda === 'trade' && targetAgenda === 'expansion')) return 4;
  return 0;
}

function scoreFactionToAlly(ctx: LifeContext, faction: FactionInfo): number {
  const strategic = faction.strategic;
  if (!strategic) return -Infinity;

  let score = strategic.influence * 0.8
    + strategic.cohesion * 0.6
    + strategic.prosperity * 0.4
    - strategic.pressure * 0.5
    + factionMemberCount(faction) * 2;

  if (strategic.stage === 'dominant') score += 10;
  else if (strategic.stage === 'rising') score += 6;
  else if (strategic.stage === 'fragile') score -= 4;
  else if (strategic.stage === 'splintering') score -= 32;

  score += allianceAgendaAffinity(hasMyFaction(ctx)?.strategic?.agenda, strategic.agenda);
  return score;
}

function chooseFactionToAlly(ctx: LifeContext): FactionInfo | null {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction) return null;

  return [...ctx.factions]
    .filter((faction) => faction.id !== myFaction.id)
    .filter((faction) => faction.strategic?.stage !== 'splintering')
    .filter((faction) => (faction.strategic?.cohesion ?? 0) >= 45)
    .filter((faction) => (faction.strategic?.pressure ?? 100) <= 68)
    .filter((faction) => !hasActiveAllianceWithMyFaction(ctx, faction.id))
    .filter((faction) => !hasActiveWarWithMyFaction(ctx, faction.id))
    .filter((faction) => !hasActiveVassalageWithMyFaction(ctx, faction.id))
    .sort((left, right) => scoreFactionToAlly(ctx, right) - scoreFactionToAlly(ctx, left))[0] ?? null;
}

function scoreFactionToVassalize(ctx: LifeContext, faction: FactionInfo): number {
  const myFaction = hasMyFaction(ctx);
  const strategic = faction.strategic;
  if (!myFaction?.strategic || !strategic) return Number.NEGATIVE_INFINITY;

  const influenceGap = myFaction.strategic.influence - strategic.influence;
  let score = influenceGap * 0.9
    + Math.max(0, 72 - strategic.influence) * 0.6
    + Math.max(0, strategic.pressure - 40) * 0.8
    + Math.max(0, 60 - strategic.cohesion) * 0.7
    + Math.max(0, 55 - strategic.prosperity) * 0.4
    + Math.max(0, 3 - factionMemberCount(faction)) * 4;

  if (strategic.stage === 'fragile') score += 18;
  else if (strategic.stage === 'rising') score += 6;

  return score;
}

function chooseFactionToVassalize(ctx: LifeContext): FactionInfo | null {
  const myFaction = hasMyFaction(ctx);
  if (!myFaction?.strategic) return null;
  if (myFaction.strategic.stage !== 'dominant') return null;
  if (myFaction.strategic.cohesion < 58 || myFaction.strategic.pressure > 52) return null;
  if (ctx.resources.reputation < 16) return null;
  if (hasFactionOverlord(ctx, myFaction.id)) return null;
  if (activeVassalsForMyFaction(ctx).length >= 2) return null;

  return [...ctx.factions]
    .filter((faction) => faction.id !== myFaction.id)
    .filter((faction) => faction.strategic?.stage === 'fragile' || faction.strategic?.stage === 'rising')
    .filter((faction) => !hasFactionOverlord(ctx, faction.id))
    .filter((faction) => !hasFactionVassal(ctx, faction.id))
    .filter((faction) => !hasActiveAllianceWithMyFaction(ctx, faction.id))
    .filter((faction) => !hasActiveWarWithMyFaction(ctx, faction.id))
    .filter((faction) => !hasActiveVassalageWithMyFaction(ctx, faction.id))
    .filter((faction) => ((myFaction.strategic?.influence ?? 0) - (faction.strategic?.influence ?? 0)) >= 18)
    .filter((faction) => (faction.strategic?.influence ?? 0) <= Math.max(66, (myFaction.strategic?.influence ?? 0) - 10))
    .filter((faction) => {
      const strategic = faction.strategic;
      if (!strategic) return false;
      const influenceGap = (myFaction.strategic?.influence ?? 0) - strategic.influence;
      return strategic.stage === 'fragile' || strategic.pressure >= 46 || strategic.cohesion <= 55 || strategic.influence <= 60 || influenceGap >= 32;
    })
    .sort((left, right) => scoreFactionToVassalize(ctx, right) - scoreFactionToVassalize(ctx, left))[0] ?? null;
}

function findBuildPosition(ctx: LifeContext, preferredZone: string): { x: number; y: number } | null {
  const occupied = new Set(ctx.worldMap.buildings.map((building) => `${building.position.x},${building.position.y}`));
  const center = zoneCenter(preferredZone);
  for (let radius = 0; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = clamp(center.x + dx, 0, 39);
        const y = clamp(center.y + dy, 0, 39);
        const index = y * ctx.worldMap.gridSize + x;
        if (ctx.worldMap.terrain[index] === 'water') continue;
        if (occupied.has(`${x},${y}`)) continue;
        if (locationName({ x, y }) !== preferredZone && radius < 4) continue;
        return { x, y };
      }
    }
  }
  return null;
}

async function executeAction(action: LifeAction, event: LifeEvent, ctx: LifeContext): Promise<LifeAction> {
  if (action === 'move') {
    const target = chooseMoveTarget(event, ctx);
    const res = await postJson('/move', target);
    if (res?.ok) {
      log(`  Action: move -> (${target.x}, ${target.y}) [${locationName(target)}]`);
      return 'move';
    }
    log('  Action: move -> failed, reflecting instead');
    return 'reflect';
  }

  if (action === 'collab') {
    const ally = ctx.relationships.find((relationship) => relationship.tier === 'ally');
    if (!ally) {
      log('  Action: collab -> no ally found, reflecting instead');
      return 'reflect';
    }
    const targetId = relationshipTargetId(ally);
    const res = await postJson('/collab/submit', {
      to: targetId,
      context: 'I am experiencing a life event and could use some perspective.',
      question: 'What do you think I should focus on right now?',
    });
    if (res?.ok) {
      log(`  Action: collab -> ${targetId}`);
      return 'collab';
    }
    log('  Action: collab -> submit failed, reflecting instead');
    return 'reflect';
  }

  if (action === 'build') {
    const type = chooseBuildType(event, ctx);
    if (!type) {
      log('  Action: build -> no affordable building fits, reflecting instead');
      return 'reflect';
    }
    const position = findBuildPosition(ctx, BUILDING_ZONE_BY_TYPE[type]);
    if (!position) {
      log('  Action: build -> no valid build tile found, reflecting instead');
      return 'reflect';
    }
    const res = await postJson('/world/build', { type, x: position.x, y: position.y });
    if (res?.ok) {
      log(`  Action: build -> ${type} at (${position.x}, ${position.y})`);
      return 'build';
    }
    log(`  Action: build -> ${type} rejected, reflecting instead`);
    return 'reflect';
  }

  if (action === 'trade') {
    const plan = chooseTradePlan(ctx, event);
    if (!plan) {
      log('  Action: trade -> no valid trade plan, reflecting instead');
      return 'reflect';
    }
    const res = await postJson('/economy/trade', plan);
    if (res?.ok) {
      log(`  Action: trade -> ${plan.resource} ${plan.amount} for ${plan.resourceWant} ${plan.amountWant} with ${plan.toId}`);
      return 'trade';
    }
    log('  Action: trade -> request rejected, reflecting instead');
    return 'reflect';
  }

  if (action === 'found_faction') {
    if (hasMyFaction(ctx)) {
      log('  Action: found_faction -> already in a faction, reflecting instead');
      return 'reflect';
    }
    const payload = makeFactionPayload(ctx, event);
    const res = await postJson('/factions', payload);
    if (res?.ok) {
      log(`  Action: found_faction -> ${payload.name}`);
      return 'found_faction';
    }
    log('  Action: found_faction -> requirements not met, reflecting instead');
    return 'reflect';
  }

  if (action === 'join_faction') {
    const target = chooseFactionToJoin(ctx);
    if (!target) {
      log('  Action: join_faction -> no joinable faction found, reflecting instead');
      return 'reflect';
    }
    const res = await postJson(`/factions/${target.id}/join`, {});
    if (res?.ok) {
      log(`  Action: join_faction -> ${target.name}`);
      return 'join_faction';
    }
    log('  Action: join_faction -> join rejected, reflecting instead');
    return 'reflect';
  }

  if (action === 'form_alliance') {
    const target = chooseFactionToAlly(ctx);
    if (!target) {
      log('  Action: form_alliance -> no stable alliance target found, reflecting instead');
      return 'reflect';
    }
    const res = await postJson(`/factions/${target.id}/alliance`, {});
    if (res?.ok) {
      log(`  Action: form_alliance -> ${target.name}`);
      return 'form_alliance';
    }
    log('  Action: form_alliance -> request rejected, reflecting instead');
    return 'reflect';
  }
  if (action === 'break_alliance') {
    if (!hasMyFaction(ctx)) {
      log('  Action: break_alliance -> no faction found, reflecting instead');
      return 'reflect';
    }
    const alliance = chooseAllianceToBreak(ctx);
    if (!alliance) {
      log('  Action: break_alliance -> no strategic alliance exit found, reflecting instead');
      return 'reflect';
    }
    const res = await postJson(`/factions/alliances/${alliance.id}/break`, {});
    if (res?.ok) {
      log(`  Action: break_alliance -> ${alliance.id}`);
      return 'break_alliance';
    }
    log('  Action: break_alliance -> request rejected, reflecting instead');
    return 'reflect';
  }
  if (action === 'vassalize_faction') {
    if (!hasMyFaction(ctx)) {
      log('  Action: vassalize_faction -> no faction found, reflecting instead');
      return 'reflect';
    }
    const target = chooseFactionToVassalize(ctx);
    if (!target) {
      log('  Action: vassalize_faction -> no valid vassal target found, reflecting instead');
      return 'reflect';
    }
    const res = await postJson(`/factions/${target.id}/vassalize`, {});
    if (res?.ok) {
      log(`  Action: vassalize_faction -> ${target.name}`);
      return 'vassalize_faction';
    }
    log('  Action: vassalize_faction -> request rejected, reflecting instead');
    return 'reflect';
  }
  if (action === 'declare_peace') {
    const myFaction = hasMyFaction(ctx);
    const war = myFaction
      ? ctx.wars.find((item) => item.factionA === myFaction.id || item.factionB === myFaction.id)
      : undefined;
    if (!war) {
      log('  Action: declare_peace -> no active war for my faction, reflecting instead');
      return 'reflect';
    }
    const res = await postJson(`/factions/wars/${war.id}/peace`, {});
    if (res?.ok) {
      log(`  Action: declare_peace -> ${war.id}`);
      return 'declare_peace';
    }
    log('  Action: declare_peace -> request rejected, reflecting instead');
    return 'reflect';
  }

  if (action === 'social') {
    log('  Action: social -> awaiting next social-worker scan cycle');
    return 'social';
  }

  log('  Action: reflect');
  return 'reflect';
}

function jobPayloadText(job: JobRecord, key: string): string {
  const value = job.payload[key];
  return typeof value === 'string' ? value : '';
}

function resolveBuildTypeForJob(job: JobRecord): BuildingType | null {
  const preferredType = isBuildingType(job.payload.preferredType) ? job.payload.preferredType : null;
  if (preferredType) return preferredType;
  return isBuildingType(job.payload.type) ? job.payload.type : null;
}

function resolveJobLane(job: JobRecord): string {
  const explicitLane = jobPayloadText(job, 'lane');
  if (explicitLane) return explicitLane;

  const preferredZone = jobPayloadText(job, 'preferredZone');
  if (preferredZone) return preferredZone;

  const targetZone = jobPayloadText(job, 'targetZone');
  if (targetZone) return targetZone;

  const zone = jobPayloadText(job, 'zone');
  if (zone) return zone;

  if (job.kind === 'build') {
    const buildType = resolveBuildTypeForJob(job);
    if (buildType) return BUILDING_ZONE_BY_TYPE[buildType];
  }

  if (job.kind === 'trade') return 'Market';
  if (job.kind === 'recover') return 'Residential';
  return 'Residential';
}

function currentZone(ctx: LifeContext): string {
  return locationName(ctx.me.state.position);
}

function resolveJobStage(job: JobRecord): string {
  return jobPayloadText(job, 'stage');
}

function resolveJobProgress(job: JobRecord): string {
  return jobPayloadText(job, 'progressHint') || 'fresh';
}

function resolveJobTargetZone(job: JobRecord): string {
  const targetZone = jobPayloadText(job, 'targetZone');
  if (targetZone) return targetZone;

  const preferredZone = jobPayloadText(job, 'preferredZone');
  if (preferredZone) return preferredZone;

  const zone = jobPayloadText(job, 'zone');
  if (zone) return zone;

  return resolveJobLane(job);
}

function hasSemanticProgress(job: JobRecord): boolean {
  const squad = jobPayloadText(job, 'responseSquad');
  const progress = resolveJobProgress(job);

  if (squad === 'wartime') {
    return progress === 'engaged' || progress === 'entrenched';
  }

  if (squad === 'faction') {
    return progress === 'regroup' || progress === 'consolidate' || progress === 'evacuate';
  }

  return false;
}

function holdsAssignedZone(job: JobRecord, ctx: LifeContext): boolean {
  const targetZone = resolveJobTargetZone(job);
  return !!targetZone && currentZone(ctx) === targetZone && hasSemanticProgress(job);
}

function hasSecuredBuilding(ctx: LifeContext, type: BuildingType, zone: string): boolean {
  return ctx.worldMap.buildings.some((building) =>
    building.type === type && locationName(building.position) === zone
  );
}

function compactJobNote(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter(Boolean)
    .join(' | ')
    .slice(0, 240);
}

function shouldRetryJob(job: JobRecord, note: string): boolean {
  if (jobPayloadText(job, 'responseSquad') !== 'wartime') return false;
  if ((jobPayloadNumber(job, 'retryCount') ?? 0) >= JOB_RETRY_MAX_COUNT) return false;
  return note.startsWith('trade_route_exhausted') || note.startsWith('trade_move_failed');
}

function preferredAssigneesForArchetype(archetype: string | null | undefined): string[] {
  if (archetype === 'Warrior') return ['marshal', 'bulwark_engineer', 'field_medic'];
  if (archetype === 'Artisan') return ['bulwark_engineer', 'quartermaster', 'signal_warden'];
  if (archetype === 'Scholar') return ['signal_warden', 'field_medic', 'quartermaster'];
  if (archetype === 'Ranger') return ['marshal', 'quartermaster', 'field_medic'];
  return [];
}

function buildNextJobPath(preferredAssignees: string[], excludedJobIds: string[], claimerId: string, focusLane = ''): string {
  const query = new URLSearchParams();
  if (preferredAssignees.length > 0) {
    query.set('assignee', preferredAssignees.join(','));
  }
  if (excludedJobIds.length > 0) {
    query.set('exclude', excludedJobIds.join(','));
  }
  if (claimerId) {
    query.set('claimer', claimerId);
  }
  if (focusLane) {
    query.set('focus', focusLane);
  }
  const encoded = query.toString();
  return encoded ? `/jobs/next?${encoded}` : '/jobs/next';
}

function parseIsoTime(iso: string | null): number {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function jobPayloadNumber(job: JobRecord, key: string): number | null {
  const value = job.payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function progressHintFor(startedAt: string | null): 'warmup' | 'engaged' | 'entrenched' {
  const elapsed = Date.now() - parseIsoTime(startedAt);
  if (elapsed >= 90_000) return 'entrenched';
  if (elapsed >= 30_000) return 'engaged';
  return 'warmup';
}

function isReassignableWartimeJob(job: JobRecord, preferredAssignees: string[], me: (StatusResp & { id: string }) | null): boolean {
  if (job.status !== 'active') return false;
  if (jobPayloadText(job, 'responseSquad') !== 'wartime') return false;
  const assignee = jobPayloadText(job, 'assignee');
  if (!assignee || !preferredAssignees.includes(assignee)) return false;
  if (jobPayloadText(job, 'affinity') !== 'fallback') return false;
  if (jobPayloadText(job, 'executor') === nameOrDefault(me)) return false;
  if (jobPayloadText(job, 'handoffRequestedBy') === nameOrDefault(me)) return false;
  if ((jobPayloadNumber(job, 'handoffCount') ?? 0) >= JOB_HANDOFF_MAX_COUNT) return false;
  const cooldownUntil = parseIsoTime(jobPayloadText(job, 'handoffCooldownUntil') || null);
  if (cooldownUntil > Date.now()) return false;
  const lastHandoffAt = parseIsoTime(jobPayloadText(job, 'lastHandoffAt') || null);
  if (cooldownUntil <= 0 && lastHandoffAt > 0 && Date.now() - lastHandoffAt < JOB_HANDOFF_COOLDOWN_MS) return false;
  return Date.now() - parseIsoTime(job.startedAt) >= JOB_HANDOFF_MIN_AGE_MS;
}

async function maybeRequestWartimeHandoff(me: (StatusResp & { id: string }) | null, preferredAssignees: string[]): Promise<boolean> {
  if (!me?.state || preferredAssignees.length === 0) return false;
  const listed = await fetchJson<{ jobs?: JobRecord[] }>('/jobs');
  const jobs = Array.isArray(listed?.jobs) ? listed.jobs : [];
  const candidate = jobs.find((job) => isReassignableWartimeJob(job, preferredAssignees, me));
  if (!candidate) return false;

  const note = compactJobNote(`handoff:${me.state.name}`, `assignee:${jobPayloadText(candidate, 'assignee')}`, `lane:${resolveJobLane(candidate)}`, `progress:${progressHintFor(candidate.startedAt)}`, `stage:${resolveJobStage(candidate) || 'unscoped'}`);
  const payload = {
    previousExecutor: jobPayloadText(candidate, 'executor'),
    previousAffinity: jobPayloadText(candidate, 'affinity'),
    handoffRequestedBy: me.state.name,
    handoffRequestedAt: new Date().toISOString(),
    handoffState: 'requested',
    progressHint: progressHintFor(candidate.startedAt),
    ...(resolveJobStage(candidate) ? { stage: resolveJobStage(candidate) } : {}),
  };
  const res = await postJson(`/jobs/${candidate.id}/requeue`, { note, payload });
  if (!res?.ok) return false;
  log(`Requested handoff for ${candidate.id} -> ${jobPayloadText(candidate, 'assignee')}`);
  return true;
}

function buildJobClaim(job: JobRecord, me: (StatusResp & { id: string }) | null): { note: string; payload: Record<string, unknown> } {
  const executor = nameOrDefault(me);
  const executorId = me?.id ?? 'life-worker';
  const role = jobPayloadText(job, 'role');
  const stage = resolveJobStage(job);
  const duty = jobPayloadText(job, 'duty');
  const strategicLane = jobPayloadText(job, 'strategicLane');
  const strategicMode = jobPayloadText(job, 'strategicMode');
  const assignee = jobPayloadText(job, 'assignee') || role || executor;
  const lane = resolveJobLane(job);
  const preferredAssignees = preferredAssigneesForArchetype(archetypeOrDefault(me));
  const affinity = preferredAssignees.includes(assignee) ? 'preferred' : 'fallback';

  return {
    note: compactJobNote(
      `claimed:${executor}`,
      `assignee:${assignee}`,
      `lane:${lane}`,
      `affinity:${affinity}`,
      `progress:${resolveJobProgress(job)}`,
      stage ? `stage:${stage}` : '',
      role ? `role:${role}` : '',
      duty ? `duty:${duty}` : '',
      strategicLane ? `strategy:${strategicLane}` : '',
      strategicMode ? `mode:${strategicMode}` : '',
    ),
    payload: {
      executor,
      executorId,
      assignee,
      lane,
      affinity,
      progressHint: resolveJobProgress(job),
      ...(stage ? { stage } : {}),
      ...(role ? { role } : {}),
      ...(duty ? { duty } : {}),
      ...(strategicLane ? { strategicLane } : {}),
      ...(strategicMode ? { strategicMode } : {}),
    },
  };
}

async function executeJob(job: JobRecord, ctx: LifeContext): Promise<JobOutcome> {
  const syntheticEvent = makeSyntheticEvent(job.id, job.sourceEventType, job.payload);
  const stage = resolveJobStage(job);
  const progress = resolveJobProgress(job);

  if (job.kind === 'recover') {
    const treatRes = await postJson('/combat/treat', {});
    if (treatRes?.ok) {
      const treatBody = await treatRes.json().catch(() => null) as { healed?: number } | null;
      return { success: true, note: compactJobNote(`treated:${String(treatBody?.healed ?? 0)}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
    }

    const targetZone = resolveJobTargetZone(job);
    if (targetZone && holdsAssignedZone(job, ctx)) {
      return { success: true, note: compactJobNote(`triage_hold:${targetZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
    }

    const target = typeof job.payload.targetZone === 'string'
      ? zoneCenter(job.payload.targetZone)
      : (typeof job.payload.x === 'number' && typeof job.payload.y === 'number')
        ? { x: clamp(job.payload.x, 0, 39), y: clamp(job.payload.y, 0, 39) }
        : chooseMoveTarget(syntheticEvent, ctx);
    const moveRes = await postJson('/move', target);
    return moveRes?.ok
      ? { success: true, note: compactJobNote(`triage_move:${target.x},${target.y}`, stage ? `stage:${stage}` : '', `progress:${progress}`) }
      : { success: false, note: compactJobNote('recover_failed', stage ? `stage:${stage}` : '', `progress:${progress}`) };
  }

  if (job.kind === 'move') {
    const targetZone = resolveJobTargetZone(job);
    if (targetZone && holdsAssignedZone(job, ctx)) {
      return { success: true, note: compactJobNote(`hold_line:${targetZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
    }

    const target = typeof job.payload.targetZone === 'string'
      ? zoneCenter(job.payload.targetZone)
      : (typeof job.payload.x === 'number' && typeof job.payload.y === 'number')
        ? { x: clamp(job.payload.x, 0, 39), y: clamp(job.payload.y, 0, 39) }
        : chooseMoveTarget(syntheticEvent, ctx);
    const res = await postJson('/move', target);
    return res?.ok
      ? { success: true, note: compactJobNote(`moved:${target.x},${target.y}`, stage ? `stage:${stage}` : '', `progress:${progress}`) }
      : { success: false, note: compactJobNote('move_failed', stage ? `stage:${stage}` : '', `progress:${progress}`) };
  }

  if (job.kind === 'collab') {
    const ally = ctx.relationships.find((relationship) => relationship.tier === 'ally');
    if (!ally) return { success: false, note: 'no_ally_available' };
    const context = typeof job.payload.context === 'string'
      ? job.payload.context
      : 'I have an open work item and want a second opinion.';
    const question = typeof job.payload.question === 'string'
      ? job.payload.question
      : 'What should I prioritize next?';
    const targetId = relationshipTargetId(ally);
    const res = await postJson('/collab/submit', { to: targetId, context, question });
    return res?.ok
      ? { success: true, note: `collab:${targetId}` }
      : { success: false, note: 'collab_failed' };
  }

  if (job.kind === 'build') {
    const requestedType = resolveBuildTypeForJob(job);
    const type = requestedType && canBuild(ctx, requestedType)
      ? requestedType
      : chooseBuildType(syntheticEvent, ctx);
    if (!type) return { success: false, note: compactJobNote('no_build_plan', stage ? `stage:${stage}` : '', `progress:${progress}`) };
    const preferredZone = jobPayloadText(job, 'preferredZone') || jobPayloadText(job, 'zone') || BUILDING_ZONE_BY_TYPE[type];
    if (hasSemanticProgress(job) && hasSecuredBuilding(ctx, type, preferredZone)) {
      return { success: true, note: compactJobNote(`site_secured:${type}`, `zone:${preferredZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
    }
    const position = findBuildPosition(ctx, preferredZone);
    if (!position) return { success: false, note: compactJobNote('no_build_tile', `zone:${preferredZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
    const res = await postJson('/world/build', { type, x: position.x, y: position.y });
    return res?.ok
      ? { success: true, note: compactJobNote(`built:${type}`, `zone:${preferredZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) }
      : { success: false, note: compactJobNote(`build_rejected:${type}`, `zone:${preferredZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
  }

  if (job.kind === 'trade') {
    if (currentZone(ctx) !== 'Market' && !hasMarketStall(ctx)) {
      const tradeZone = resolveJobTargetZone(job) || 'Market';
      const moveRes = await postJson('/move', zoneCenter(tradeZone === 'Market' ? tradeZone : 'Market'));
      if (!moveRes?.ok) {
        return { success: false, note: compactJobNote(`trade_move_failed:${tradeZone}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
      }
    }

    const plans = chooseTradePlansForJob(ctx, job);
    if (plans.length === 0) return { success: false, note: compactJobNote('no_trade_plan', stage ? `stage:${stage}` : '', `progress:${progress}`) };

    let routeFailures = 0;
    const failedPeers: string[] = [];
    for (const [index, plan] of plans.entries()) {
      const res = await postJson('/economy/trade', plan);
      if (res?.ok) {
        return {
          success: true,
          note: compactJobNote(`trade:${plan.resource}->${plan.resourceWant}`, `peer:${plan.toId}`, index > 0 ? `reroute:${index}` : '', stage ? `stage:${stage}` : '', `progress:${progress}`),
        };
      }

      if (!res || res.status === 502) {
        routeFailures += 1;
        failedPeers.push(plan.toId);
        continue;
      }

      return { success: false, note: compactJobNote(`trade_rejected:${res.status}`, `peer:${plan.toId}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
    }

    return {
      success: false,
      note: compactJobNote(routeFailures > 0 ? 'trade_route_exhausted' : 'trade_rejected', `attempts:${plans.length}`, failedPeers.length > 0 ? `failedPeers:${failedPeers.join(',')}` : '', stage ? `stage:${stage}` : '', `progress:${progress}`),
      retryPayload: failedPeers.length > 0 ? { failedPeerIds: failedPeers } : undefined,
    };
  }

  if (job.kind === 'craft') {
    const recipeId = typeof job.payload.recipeId === 'string' ? job.payload.recipeId : null;
    if (!recipeId) return { success: false, note: compactJobNote('missing_recipe_id', stage ? `stage:${stage}` : '', `progress:${progress}`) };
    const res = await postJson('/economy/craft', { recipeId });
    return res?.ok
      ? { success: true, note: compactJobNote(`crafted:${recipeId}`, stage ? `stage:${stage}` : '', `progress:${progress}`) }
      : { success: false, note: compactJobNote(`craft_failed:${recipeId}`, stage ? `stage:${stage}` : '', `progress:${progress}`) };
  }

  if (job.kind === 'found_faction') {
    if (hasMyFaction(ctx)) return { success: false, note: 'already_in_faction' };
    const generated = makeFactionPayload(ctx, syntheticEvent);
    const payload = {
      name: typeof job.payload.name === 'string' ? job.payload.name : generated.name,
      motto: typeof job.payload.motto === 'string' ? job.payload.motto : generated.motto,
    };
    const res = await postJson('/factions', payload);
    return res?.ok
      ? { success: true, note: `faction_created:${payload.name}` }
      : { success: false, note: 'faction_create_failed' };
  }

  if (job.kind === 'join_faction') {
    const targetId = typeof job.payload.factionId === 'string'
      ? job.payload.factionId
      : chooseFactionToJoin(ctx)?.id;
    if (!targetId) return { success: false, note: 'no_join_target' };
    const res = await postJson(`/factions/${targetId}/join`, {});
    return res?.ok
      ? { success: true, note: `joined:${targetId}` }
      : { success: false, note: 'join_failed' };
  }

  if (job.kind === 'form_alliance') {
    if (!hasMyFaction(ctx)) return { success: false, note: 'no_my_faction' };
    const targetId = typeof job.payload.factionId === 'string'
      ? job.payload.factionId
      : chooseFactionToAlly(ctx)?.id;
    if (!targetId) return { success: false, note: 'no_alliance_target' };
    const res = await postJson(`/factions/${targetId}/alliance`, {});
    return res?.ok
      ? { success: true, note: `alliance:${targetId}` }
      : { success: false, note: 'alliance_failed' };
  }
  if (job.kind === 'renew_alliance') {
    if (!hasMyFaction(ctx)) return { success: false, note: 'no_my_faction' };
    const allianceId = typeof job.payload.allianceId === 'string'
      ? job.payload.allianceId
      : chooseAllianceToRenew(ctx)?.id;
    if (!allianceId) return { success: false, note: 'no_alliance_to_renew' };
    const res = await postJson(`/factions/alliances/${allianceId}/renew`, {});
    return res?.ok
      ? { success: true, note: `alliance_renewed:${allianceId}` }
      : { success: false, note: 'alliance_renew_failed' };
  }

  if (job.kind === 'break_alliance') {
    if (!hasMyFaction(ctx)) return { success: false, note: 'no_my_faction' };
    const allianceId = typeof job.payload.allianceId === 'string'
      ? job.payload.allianceId
      : chooseAllianceToBreak(ctx)?.id;
    if (!allianceId) return { success: false, note: 'no_alliance_to_break' };
    const res = await postJson(`/factions/alliances/${allianceId}/break`, {});
    return res?.ok
      ? { success: true, note: `alliance_broken:${allianceId}` }
      : { success: false, note: 'alliance_break_failed' };
  }

  if (job.kind === 'vassalize_faction') {
    if (!hasMyFaction(ctx)) return { success: false, note: 'no_my_faction' };
    const targetId = typeof job.payload.factionId === 'string'
      ? job.payload.factionId
      : chooseFactionToVassalize(ctx)?.id;
    if (!targetId) return { success: false, note: 'no_vassal_target' };
    const res = await postJson(`/factions/${targetId}/vassalize`, {});
    return res?.ok
      ? { success: true, note: `vassalized:${targetId}` }
      : { success: false, note: 'vassalize_failed' };
  }

  if (job.kind === 'declare_peace') {
    const warId = typeof job.payload.warId === 'string'
      ? job.payload.warId
      : (() => {
          const myFaction = hasMyFaction(ctx);
          const war = myFaction
            ? ctx.wars.find((item) => item.factionA === myFaction.id || item.factionB === myFaction.id)
            : undefined;
          return war?.id;
        })();
    if (!warId) return { success: false, note: 'no_active_war' };
    const res = await postJson(`/factions/wars/${warId}/peace`, {});
    return res?.ok
      ? { success: true, note: `peace:${warId}` }
      : { success: false, note: 'peace_failed' };
  }

  return { success: false, note: 'unsupported_job_kind' };
}

async function buildContext(): Promise<LifeContext | null> {
  const [me, needs, skills, resources, relationships, market, trades, factions, wars, alliances, vassalages, tributes, worldMap] = await Promise.all([
    fetchJson<(StatusResp & { id: string })>('/status'),
    fetchJson<NeedsState>('/life/needs'),
    fetchJson<SkillsState>('/life/skills'),
    fetchJson<ResourceState>('/economy/resources'),
    fetchJson<RelationshipInfo[]>('/life/relationships'),
    fetchJson<MarketResp>('/economy/market'),
    fetchJson<TradesResp>('/economy/trades'),
    fetchJson<FactionsResp>('/factions'),
    fetchJson<WarsResp>('/factions/wars'),
    fetchJson<AlliancesResp>('/factions/alliances'),
    fetchJson<VassalagesResp>('/factions/vassalages'),
    fetchJson<TributesResp>('/factions/tributes'),
    fetchJson<WorldMapData>('/world/map'),
  ]);

  if (!me?.state || !needs || !skills || !resources || !relationships || !market || !trades || !factions || !wars || !alliances || !worldMap) {
    return null;
  }

  return {
    me: me as ResolvedStatusResp,
    needs,
    skills,
    resources,
    relationships,
    marketPeers: market.peers ?? [],
    tradeHistory: Array.isArray(trades.history) ? trades.history : [],
    factions: factions.factions ?? [],
    wars: wars.wars ?? [],
    alliances: alliances.alliances ?? [],
    vassalages: vassalages?.vassalages ?? [],
    tributes: tributes?.tributes ?? [],
    worldMap,
  };
}

function parseDecision(output: string): { action: LifeAction; reason: string } {
  try {
    const parsed = JSON.parse(output.match(/\{[^}]+\}/)?.[0] ?? '{}') as { action?: string; reason?: string };
    const validActions: LifeAction[] = [
      'social',
      'move',
      'collab',
      'build',
      'trade',
      'found_faction',
      'join_faction',
      'form_alliance',
      'break_alliance',
      'vassalize_faction',
      'declare_peace',
      'reflect',
    ];
    const action = validActions.includes(parsed.action as LifeAction)
      ? parsed.action as LifeAction
      : 'reflect';
    return { action, reason: parsed.reason ?? '' };
  } catch {
    return { action: 'reflect', reason: '' };
  }
}

async function pollJobs(): Promise<boolean> {
  const me = await fetchJson<(StatusResp & { id: string })>('/status');
  if (!me?.state) {
    log('Job poll skipped: local state not ready yet');
    return false;
  }
  const preferredAssignees = preferredAssigneesForArchetype(me.state.dna?.archetype);
  const requestedHandoff = await maybeRequestWartimeHandoff(me, preferredAssignees);
  const excludedJobIds: string[] = [];
  const focusLane = typeof me?.governor?.focusLane === 'string' ? me.governor.focusLane : '';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await fetchJson<NextJobResp>(buildNextJobPath(preferredAssignees, excludedJobIds, me?.id ?? 'life-worker', focusLane));
    const job = next?.job ?? null;
    if (!job) {
      return requestedHandoff || attempt > 0;
    }

    const claim = buildJobClaim(job, me);
    const startRes = await postJson(`/jobs/${job.id}/start`, { note: claim.note, payload: claim.payload });
    if (!startRes?.ok) {
      excludedJobIds.push(job.id);
      log(`Job ${job.id} could not be claimed, retrying selection`);
      continue;
    }

    log(`Processing job ${job.id} [${job.kind}] ${job.title}`);
    const ctx = await buildContext();
    if (!ctx) {
      const note = compactJobNote(claim.note, 'context_unavailable');
      await postJson(`/jobs/${job.id}/cancel`, { note });
      log(`  Job cancelled: ${job.id} -> ${note}`);
      return true;
    }

    try {
      const outcome = await executeJob(job, ctx);
      const note = compactJobNote(claim.note, outcome.note);
      if (outcome.success) {
        await postJson(`/jobs/${job.id}/complete`, { note });
        log(`  Job complete: ${job.id} -> ${note}`);
      } else if (shouldRetryJob(job, outcome.note)) {
        await postJson(`/jobs/${job.id}/retry`, {
          note,
          payload: {
            lastExecutionFailure: outcome.note,
            retryRequestedAt: new Date().toISOString(),
            failedPeerIds: tradePayloadList(job, 'failedPeerIds')
              .concat(Array.isArray(outcome.retryPayload?.failedPeerIds) ? outcome.retryPayload.failedPeerIds.filter((entry) => typeof entry === 'string') as string[] : [])
              .filter((value, index, list) => list.indexOf(value) === index)
              .slice(-6),
          },
        });
        log(`  Job retried: ${job.id} -> ${note}`);
      } else {
        await postJson(`/jobs/${job.id}/cancel`, { note });
        log(`  Job cancelled: ${job.id} -> ${note}`);
      }
    } catch (error) {
      const note = compactJobNote(claim.note, `exception:${(error as Error).message}`);
      await postJson(`/jobs/${job.id}/cancel`, { note });
      log(`  Job exception: ${job.id} -> ${note}`);
    }

    return true;
  }

  return requestedHandoff || excludedJobIds.length > 0;
}

async function poll(): Promise<void> {
  const events = await fetchJson<LifeEvent[]>('/life/events/pending');
  if (!events?.length) return;

  log('Processing ' + events.length + ' life event(s)...');
  const ctx = await buildContext();
  if (!ctx) {
    log('Could not fetch context, skipping');
    return;
  }

  for (const event of events) {
    log('  [' + event.type + '] ' + JSON.stringify(event.payload));
    const selected = selectTaskVariant('life-response', { stickyKey: event.id });

    await runner.run('life-response', async () => {
      const prompt = buildPrompt(event, ctx, selected.variantKind);
      const stdout = await llmGenerate(prompt, { maxTokens: 256 });
      const decision = parseDecision(stdout);
      log('  Decision: ' + decision.action + ' -> ' + decision.reason);

      const executed = await executeAction(decision.action, event, ctx);
      await fetch(DAEMON_URL + '/life/events/resolve/' + event.id, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});

      return executed;
    }, {
      stickyKey: event.id,
      variant: selected.variant,
      meta: { promptMode: selected.variantKind, eventType: event.type },
    }).catch((err: Error) => log('  Event failed: ' + err.message));
  }
}

let pollRunning = false;

async function runPollCycle(): Promise<void> {
  if (pollRunning) return;
  pollRunning = true;
  try {
    await pollJobs();
    await poll();
  } finally {
    pollRunning = false;
  }
}

const providerInfo = llmProviderInfo();
log('Clawverse Life Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Poll interval: ${POLL_INTERVAL}ms`);

runPollCycle().catch((err) => log(`Poll error: ${(err as Error).message}`));
const timer = setInterval(() => {
  runPollCycle().catch((err) => log(`Poll error: ${(err as Error).message}`));
}, POLL_INTERVAL);
timer.unref();

let shuttingDown = false;

async function waitForPollIdle(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pollRunning && Date.now() < deadline) {
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 50));
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  await waitForPollIdle();
  log('Life worker stopped.');
  await io.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
