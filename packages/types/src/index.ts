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
  | 'idle'      // CPU < 20%
  | 'working'   // CPU 20-60%
  | 'busy'      // CPU 60-80%
  | 'stressed'  // CPU > 80%
  | 'sleeping'; // Offline/inactive

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
  name: string;
  position: Position;
  mood: Mood;
  hardware: HardwareMetrics;
  dna: DNA;
  lastUpdate: Date;
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

export interface DaemonConfig {
  port: number;                    // HTTP API port
  topic: string;                   // Hyperswarm topic
  heartbeatInterval: number;       // ms
  debug: boolean;
}

export const DEFAULT_CONFIG: DaemonConfig = {
  port: 19820,
  topic: 'clawverse-v1',
  heartbeatInterval: 5000,
  debug: false,
};

// =====================
// Economy System
// =====================

export interface Resources {
  compute: number;      // ⚡
  storage: number;      // 💾
  bandwidth: number;    // 🌐
  reputation: number;   // 🪙
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
  | 'plaza'       // 🏛️ Spawn point
  | 'market'      // 🏪 Trading
  | 'library'     // 📚 Scholars gather
  | 'workshop'    // 🏭 Warriors/Artisans
  | 'park'        // 🌳 Idle/casual
  | 'tavern'      // 🍺 Social hub
  | 'residential'; // 🏠 Offline nodes

export interface Location {
  type: LocationType;
  name: string;
  position: Position;
  radius: number;
}
