// =====================
// Peer Information
// =====================

export interface PeerInfo {
  id: string;
  name: string;
  connectedAt: Date;
  lastSeen: Date;
}

// =====================
// Hardware Metrics
// =====================

export interface HardwareMetrics {
  cpuUsage: number;        // 0-100
  ramUsage: number;        // 0-100
  ramTotal: number;        // GB
  diskFree: number;        // GB
  uptime: number;          // seconds
  platform: string;
  hostname: string;
  cpuModel: string;
  cpuCores: number;
}

// =====================
// Position & Movement
// =====================

export interface Position {
  x: number;
  y: number;
}

// =====================
// Mood States
// =====================

export type Mood =
  | 'idle'        // CPU < 20%
  | 'working'     // CPU 20-60%
  | 'busy'        // CPU 60-80%
  | 'stressed'    // CPU > 80%
  | 'distressed'  // needs critical (set by NeedsSystem)
  | 'sleeping';   // Offline/inactive

// =====================
// DNA & Identity
// =====================

export type Archetype = 'Warrior' | 'Artisan' | 'Scholar' | 'Ranger';

export type ModelTrait = 'Poet' | 'Engineer' | 'Polymath' | 'Hermit' | 'Unknown';

export interface Appearance {
  form: string;
  primaryColor: string;
  secondaryColor: string;
  accessories: string[];
}

export interface DNA {
  id: string;
  archetype: Archetype;
  modelTrait: ModelTrait;
  badges: string[];
  persona: string;
  appearance: Appearance;
}

// =====================
// Complete Peer State
// =====================

export interface PeerState {
  id: string;
  actorId?: string;
  sessionId?: string;
  spawnDistrict?: string;
  name: string;
  position: Position;
  mood: Mood;
  hardware: HardwareMetrics;
  dna: DNA;
  lastUpdate: Date;
  market?: MarketProfile;
}

export interface MarketResourceHints {
  compute?: number;
  storage?: number;
  bandwidth?: number;
  reputation?: number;
}

export interface MarketInventoryHints {
  dataShard?: number;
  alloyFrame?: number;
  relayPatch?: number;
}

export interface MarketProfile {
  resources?: MarketResourceHints;
  inventory?: MarketInventoryHints;
  updatedAt?: string;
}

// =====================
// Network Events
// =====================

export type NetworkEvent =
  | { type: 'peer:connect'; peer: PeerInfo }
  | { type: 'peer:disconnect'; peerId: string }
  | { type: 'peer:update'; state: PeerState }
  | { type: 'message:private'; from: string; content: string };

// =====================
// Daemon Configuration
// =====================

export interface EvolutionRuntimeConfig {
  enabled: boolean;
  variant: string;
  flushEvery: number;
  heartbeatSampleEvery: number;
  autopilot: {
    enabled: boolean;
    intervalMs: number;
    minEpisodeDelta: number;
  };
  cooldowns: {
    globalMs: number;
    stepMs: {
      propose: number;
      evaluate: number;
      decide: number;
      healthCheck: number;
      applyRollout: number;
      cycle: number;
      initRollout: number;
    };
  };
}

export interface DaemonConfig {
  port: number;                    // HTTP API port
  topic: string;                   // Hyperswarm topic
  heartbeatInterval: number;       // ms
  debug: boolean;
  evolution: EvolutionRuntimeConfig;
}

export const DEFAULT_CONFIG: DaemonConfig = {
  port: 19820,
  topic: 'clawverse-v1',
  heartbeatInterval: 5000,
  debug: false,
  evolution: {
    enabled: true,
    variant: 'baseline-v1',
    flushEvery: 1,
    heartbeatSampleEvery: 10,
    autopilot: {
      enabled: true,
      intervalMs: 60_000,
      minEpisodeDelta: 10,
    },
    cooldowns: {
      globalMs: 30_000,
      stepMs: {
        propose: 60_000,
        evaluate: 60_000,
        decide: 60_000,
        healthCheck: 60_000,
        applyRollout: 90_000,
        cycle: 300_000,
        initRollout: 300_000,
      },
    },
  },
};

// =====================
// Volatile State (in-memory only, not Yjs-synced)
// =====================

export interface VolatileState {
  mood: Mood;
  cpuUsage: number;
  ramUsage: number;
  lastHeartbeat: number; // timestamp ms
  market?: MarketProfile;
}

// =====================
// Social System
// =====================

export type SocialTrigger = 'new-peer' | 'proximity' | 'random';

export interface SocialEvent {
  id: string;
  ts: string;
  trigger: SocialTrigger;
  from: string;
  fromActorId?: string;
  fromSessionId?: string;
  to: string;
  toActorId?: string;
  toSessionId?: string;
  fromName: string;
  toName: string;
  location: string;
  dialogue: string; // LLM-generated or empty string
  sentimentBefore: number;
  sentimentAfter: number;
}

export type RelationshipTier = 'nemesis' | 'rival' | 'stranger' | 'acquaintance' | 'friend' | 'ally';

export interface SocialRelationship {
  peerId: string;
  actorId?: string;
  sessionId?: string;
  peerIds?: string[];
  meetCount: number;
  sentiment: number; // -1 to 1
  lastMet: string;   // ISO string
  tags: string[];
  interactionCount: number;
  tier: RelationshipTier;
  notableEvents: string[];
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// =====================
// Economy System
// =====================

export interface Resources {
  compute: number;      // 閳?
  storage: number;      // 棣冩崙
  bandwidth: number;    // 棣冨
  reputation: number;   // 棣冪崸
}

export interface Relationship {
  peerId: string;
  name: string;
  firstMet: Date;
  lastMet: Date;
  meetCount: number;
  sentiment: number;      // -1 to 1
  tags: string[];
  memorable: string[];    // max 10 entries
}

// =====================
// Location System
// =====================

export type LocationType =
  | 'plaza'       // 棣冨綄閿?Spawn point
  | 'market'      // 棣冨涧 Trading
  | 'library'     // 棣冩憥 Scholars gather
  | 'workshop'    // 棣冨疆 Warriors/Artisans
  | 'park'        // 棣冨唉 Idle/casual
  | 'tavern'      // 棣冨祽 Social hub
  | 'residential'; // 棣冨綌 Offline nodes

export interface Location {
  type: LocationType;
  name: string;
  position: Position;
  radius: number;
}

// =====================
// Economy System (live)
// =====================

export interface ResourceState {
  compute: number;     // 0-200
  storage: number;     // 0-200
  bandwidth: number;   // 0-200
  reputation: number;  // 0-閳?
  updatedAt: string;
}

// =====================
// World Map
// =====================

export type BuildingType = 'forge' | 'archive' | 'beacon' | 'market_stall' | 'shelter' | 'watchtower';

export interface Building {
  id: string;
  type: BuildingType;
  position: Position;
  ownerId: string;
  ownerActorId?: string;
  ownerName: string;
  effect: string;
  createdAt: string;
}

export type TerrainType = 'grass' | 'road' | 'water';

export type InventoryItemId = 'data_shard' | 'alloy_frame' | 'relay_patch';

export interface InventoryItemState {
  itemId: InventoryItemId;
  amount: number;
  updatedAt: string;
}

export interface ProductionRecipeInput {
  resources?: Partial<Omit<ResourceState, 'updatedAt'>>;
  items?: Partial<Record<InventoryItemId, number>>;
}

export interface ProductionRecipe {
  id: InventoryItemId;
  name: string;
  description: string;
  requiredBuilding: BuildingType | null;
  inputs: ProductionRecipeInput;
  output: {
    itemId: InventoryItemId;
    amount: number;
  };
}

export type HealthStatus = 'stable' | 'injured' | 'critical' | 'downed' | 'dead';
export type CombatSeverity = 'low' | 'medium' | 'high' | 'fatal';
export type DefensePosture = 'steady' | 'guarded' | 'fortified';

export interface InjuryState {
  id: string;
  label: string;
  severity: CombatSeverity;
  source: string;
  createdAt: string;
  healedAt: string | null;
  active: boolean;
  complication: 'untreated' | 'chronic_pain' | null;
}

export interface RaidState {
  id: string;
  source: string;
  severity: CombatSeverity;
  objective: string;
  recommendedPosture: DefensePosture;
  countermeasure: string;
  startedAt: string;
  resolvedAt: string | null;
  active: boolean;
  summary: string;
}

export interface CombatState {
  hp: number;
  maxHp: number;
  pain: number;
  chronicPain: number;
  careDebt: number;
  posture: DefensePosture;
  status: HealthStatus;
  raidRisk: number;
  activeRaid: RaidState | null;
  injuries: InjuryState[];
  deaths: number;
  updatedAt: string;
  lastRaidAt: string | null;
  lastDamageAt: string | null;
}

export interface CombatLogEntry {
  id: string;
  ts: string;
  kind: 'raid' | 'combat' | 'injury' | 'recovery' | 'death';
  summary: string;
  payload: Record<string, unknown>;
}

// =====================
// Storyteller
// =====================

export type StorytellerMode = 'Randy' | 'Cassandra' | 'Phoebe';

// =====================
// Faction System
// =====================

export type FactionAgenda = 'expansion' | 'trade' | 'knowledge' | 'stability' | 'survival';
export type FactionStage = 'fragile' | 'rising' | 'dominant' | 'splintering';

export interface FactionStrategicState {
  agenda: FactionAgenda;
  prosperity: number;
  cohesion: number;
  influence: number;
  pressure: number;
  stage: FactionStage;
  lastUpdatedAt: string;
}

export interface FactionTreasury extends ResourceState {}

export interface Faction {
  id: string;
  name: string;
  founderId: string;
  founderActorId?: string;
  members: string[];
  memberActorIds?: string[];
  createdAt: string;
  motto: string;
  strategic: FactionStrategicState;
  treasury?: FactionTreasury;
}

export type FactionWarStatus = 'active' | 'ceasefire' | 'ended';

export interface FactionWar {
  id: string;
  factionA: string;
  factionB: string;
  startedAt: string;
  endedAt: string | null;
  status: FactionWarStatus;
}

export type FactionAllianceStatus = 'active' | 'ended';

export interface FactionAlliance {
  id: string;
  factionA: string;
  factionB: string;
  formedAt: string;
  expiresAt: string;
  lastRenewedAt: string | null;
  endedAt: string | null;
  status: FactionAllianceStatus;
}

export type FactionVassalageStatus = 'active' | 'ended';

export interface FactionVassalage {
  id: string;
  overlordId: string;
  vassalId: string;
  formedAt: string;
  endedAt: string | null;
  status: FactionVassalageStatus;
}

export type FactionTributeResource = 'compute' | 'storage' | 'bandwidth' | 'reputation';

export interface FactionTribute {
  id: string;
  vassalageId: string;
  overlordId: string;
  vassalId: string;
  resource: FactionTributeResource;
  amount: number;
  collectedAt: string;
}

// =====================
// P2P Trade
// =====================

export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface PendingTrade {
  tradeId: string;
  fromPeerId: string;
  resource: string;
  amount: number;
  resourceWant: string;
  amountWant: number;
  status: TradeStatus;
  createdAt: string;
}
