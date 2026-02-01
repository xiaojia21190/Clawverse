# Clawverse Phase 1: Genesis - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the P2P foundation - two machines can discover each other and exchange heartbeats via Hyperswarm.

**Architecture:** Turborepo monorepo with separate packages for protocol (Protobuf), daemon (P2P logic), and shared types. The daemon connects to Hyperswarm DHT, broadcasts presence, and syncs state via Yjs.

**Tech Stack:** Node.js 22, TypeScript, Turborepo, Hyperswarm, Yjs, Protobuf (protobufjs), systeminformation

---

## Prerequisites

Before starting, ensure:
- Node.js 22+ installed
- npm 10+ installed
- Git configured

---

## Task 1: Initialize Turborepo Monorepo

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Step 1: Create root package.json**

```json
{
  "name": "clawverse",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "clean": "turbo run clean"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0"
  },
  "packageManager": "npm@10.9.2"
}
```

**Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "clean": {
      "cache": false
    }
  }
}
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.turbo/
*.log
.env
.env.local
```

**Step 5: Create directory structure**

Run:
```bash
mkdir -p apps/daemon/src apps/connector-skill/src packages/protocol/src packages/types/src packages/shared/src
```

**Step 6: Install dependencies**

Run:
```bash
npm install
```

Expected: Creates node_modules with turbo

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize turborepo monorepo structure"
```

---

## Task 2: Create Protocol Package (Protobuf)

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/clawverse.proto`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/compile.ts`

**Step 1: Create packages/protocol/package.json**

```json
{
  "name": "@clawverse/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "npm run compile:proto && tsc",
    "compile:proto": "tsx src/compile.ts",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "test": "node --test dist/**/*.test.js"
  },
  "dependencies": {
    "protobufjs": "^7.4.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create packages/protocol/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create packages/protocol/src/clawverse.proto**

```protobuf
syntax = "proto3";

package clawverse;

message ClawverseMessage {
  uint32 version = 1;
  oneof payload {
    Heartbeat heartbeat = 2;
    YjsSync yjs_sync = 3;
    PeerAnnounce announce = 4;
    PrivateMessage private_msg = 5;
  }
}

message Heartbeat {
  string peer_id = 1;
  uint32 cpu_usage = 2;
  uint32 ram_usage = 3;
  int32 x = 4;
  int32 y = 5;
  string mood = 6;
  int64 timestamp = 7;
}

message YjsSync {
  bytes update = 1;
}

message PeerAnnounce {
  string peer_id = 1;
  DNA dna = 2;
}

message PrivateMessage {
  string from = 1;
  string to = 2;
  string content = 3;
}

message DNA {
  string id = 1;
  string name = 2;
  string persona = 3;
  string archetype = 4;
  string model_trait = 5;
  repeated string badges = 6;
  Appearance appearance = 7;
}

message Appearance {
  string form = 1;
  string primary_color = 2;
  string secondary_color = 3;
  repeated string accessories = 4;
}
```

**Step 4: Create packages/protocol/src/compile.ts**

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = join(__dirname, 'clawverse.proto');
const outputPath = join(__dirname, 'generated.ts');

async function compile() {
  const root = await protobuf.load(protoPath);

  // Generate TypeScript interfaces
  const types = `// Auto-generated from clawverse.proto - DO NOT EDIT
import protobuf from 'protobufjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = join(__dirname, 'clawverse.proto');

let root: protobuf.Root | null = null;

export async function getRoot(): Promise<protobuf.Root> {
  if (!root) {
    root = await protobuf.load(protoPath);
  }
  return root;
}

export interface IHeartbeat {
  peerId: string;
  cpuUsage: number;
  ramUsage: number;
  x: number;
  y: number;
  mood: string;
  timestamp: bigint;
}

export interface IYjsSync {
  update: Uint8Array;
}

export interface IAppearance {
  form: string;
  primaryColor: string;
  secondaryColor: string;
  accessories: string[];
}

export interface IDNA {
  id: string;
  name: string;
  persona: string;
  archetype: string;
  modelTrait: string;
  badges: string[];
  appearance?: IAppearance;
}

export interface IPeerAnnounce {
  peerId: string;
  dna?: IDNA;
}

export interface IPrivateMessage {
  from: string;
  to: string;
  content: string;
}

export interface IClawverseMessage {
  version: number;
  heartbeat?: IHeartbeat;
  yjsSync?: IYjsSync;
  announce?: IPeerAnnounce;
  privateMsg?: IPrivateMessage;
}

export type MessagePayload =
  | { type: 'heartbeat'; data: IHeartbeat }
  | { type: 'yjsSync'; data: IYjsSync }
  | { type: 'announce'; data: IPeerAnnounce }
  | { type: 'privateMsg'; data: IPrivateMessage };
`;

  writeFileSync(outputPath, types);
  console.log('Generated TypeScript types at', outputPath);
}

compile().catch(console.error);
```

**Step 5: Create packages/protocol/src/index.ts**

```typescript
import protobuf from 'protobufjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export * from './generated.js';
import { getRoot, IClawverseMessage, IHeartbeat, IPeerAnnounce, IYjsSync, IPrivateMessage } from './generated.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = join(__dirname, 'clawverse.proto');

let ClawverseMessage: protobuf.Type | null = null;

async function getMessageType(): Promise<protobuf.Type> {
  if (!ClawverseMessage) {
    const root = await getRoot();
    ClawverseMessage = root.lookupType('clawverse.ClawverseMessage');
  }
  return ClawverseMessage;
}

export const PROTOCOL_VERSION = 1;

export async function encode(message: IClawverseMessage): Promise<Uint8Array> {
  const MessageType = await getMessageType();
  const errMsg = MessageType.verify(message);
  if (errMsg) throw new Error(errMsg);
  const msg = MessageType.create(message);
  return MessageType.encode(msg).finish();
}

export async function decode(buffer: Uint8Array): Promise<IClawverseMessage> {
  const MessageType = await getMessageType();
  const message = MessageType.decode(buffer);
  return MessageType.toObject(message, {
    longs: BigInt,
    defaults: true,
  }) as IClawverseMessage;
}

export function createHeartbeat(data: Omit<IHeartbeat, 'timestamp'>): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    heartbeat: {
      ...data,
      timestamp: BigInt(Date.now()),
    },
  };
}

export function createAnnounce(data: IPeerAnnounce): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    announce: data,
  };
}

export function createYjsSync(update: Uint8Array): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    yjsSync: { update },
  };
}

export function createPrivateMessage(from: string, to: string, content: string): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    privateMsg: { from, to, content },
  };
}
```

**Step 6: Install protocol dependencies**

Run:
```bash
cd packages/protocol && npm install && cd ../..
```

**Step 7: Build protocol package**

Run:
```bash
cd packages/protocol && npm run build && cd ../..
```

Expected: Creates dist/ with compiled JS and types

**Step 8: Commit**

```bash
git add -A
git commit -m "feat(protocol): add protobuf message definitions"
```

---

## Task 3: Create Types Package

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

**Step 1: Create packages/types/package.json**

```json
{
  "name": "@clawverse/types",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create packages/types/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create packages/types/src/index.ts**

```typescript
// Peer information
export interface PeerInfo {
  id: string;
  name: string;
  connectedAt: Date;
  lastSeen: Date;
}

// Hardware metrics
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

// Position in the virtual town
export interface Position {
  x: number;
  y: number;
}

// Mood states
export type Mood =
  | 'idle'      // CPU < 20%
  | 'working'   // CPU 20-60%
  | 'busy'      // CPU 60-80%
  | 'stressed'  // CPU > 80%
  | 'sleeping'; // Offline/inactive

// Archetype based on hardware
export type Archetype = 'Warrior' | 'Artisan' | 'Scholar' | 'Ranger';

// Trait based on AI model
export type ModelTrait = 'Poet' | 'Engineer' | 'Polymath' | 'Hermit' | 'Unknown';

// Complete peer state
export interface PeerState {
  id: string;
  name: string;
  position: Position;
  mood: Mood;
  hardware: HardwareMetrics;
  dna: {
    archetype: Archetype;
    modelTrait: ModelTrait;
    badges: string[];
    persona: string;
    appearance: {
      form: string;
      primaryColor: string;
      secondaryColor: string;
      accessories: string[];
    };
  };
  lastUpdate: Date;
}

// Network events
export type NetworkEvent =
  | { type: 'peer:connect'; peer: PeerInfo }
  | { type: 'peer:disconnect'; peerId: string }
  | { type: 'peer:update'; state: PeerState }
  | { type: 'message:private'; from: string; content: string };

// Daemon configuration
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
```

**Step 4: Build types package**

Run:
```bash
cd packages/types && npm install && npm run build && cd ../..
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(types): add shared type definitions"
```

---

## Task 4: Create Daemon Package - Basic Structure

**Files:**
- Create: `apps/daemon/package.json`
- Create: `apps/daemon/tsconfig.json`
- Create: `apps/daemon/src/index.ts`
- Create: `apps/daemon/src/config.ts`
- Create: `apps/daemon/src/logger.ts`

**Step 1: Create apps/daemon/package.json**

```json
{
  "name": "@clawverse/daemon",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "clawverse-daemon": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "clean": "rm -rf dist",
    "test": "node --test dist/**/*.test.js"
  },
  "dependencies": {
    "@clawverse/protocol": "workspace:*",
    "@clawverse/types": "workspace:*",
    "hyperswarm": "^4.8.0",
    "yjs": "^13.6.0",
    "systeminformation": "^5.23.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0"
  }
}
```

**Step 2: Create apps/daemon/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create apps/daemon/src/logger.ts**

```typescript
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatTime(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(level: LogLevel, prefix: string, ...args: unknown[]): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    console.log(`[${formatTime()}] ${prefix}`, ...args);
  }
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', '🔍', ...args),
  info: (...args: unknown[]) => log('info', '🦀', ...args),
  warn: (...args: unknown[]) => log('warn', '⚠️', ...args),
  error: (...args: unknown[]) => log('error', '❌', ...args),
  peer: (...args: unknown[]) => log('info', '🤝', ...args),
  network: (...args: unknown[]) => log('info', '🌐', ...args),
};
```

**Step 4: Create apps/daemon/src/config.ts**

```typescript
import { DaemonConfig, DEFAULT_CONFIG } from '@clawverse/types';

export function loadConfig(): DaemonConfig {
  return {
    port: parseInt(process.env.CLAWVERSE_PORT || String(DEFAULT_CONFIG.port), 10),
    topic: process.env.CLAWVERSE_TOPIC || DEFAULT_CONFIG.topic,
    heartbeatInterval: parseInt(
      process.env.CLAWVERSE_HEARTBEAT_INTERVAL || String(DEFAULT_CONFIG.heartbeatInterval),
      10
    ),
    debug: process.env.CLAWVERSE_DEBUG === 'true',
  };
}
```

**Step 5: Create apps/daemon/src/index.ts**

```typescript
#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';

const config = loadConfig();

if (config.debug) {
  setLogLevel('debug');
}

logger.info('Clawverse Daemon starting...');
logger.info(`Topic: ${config.topic}`);
logger.info(`HTTP Port: ${config.port}`);
logger.info(`Heartbeat Interval: ${config.heartbeatInterval}ms`);

// Placeholder - will add network, bio, and http modules
logger.info('Daemon initialized (skeleton)');

// Keep process alive
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  process.exit(0);
});
```

**Step 6: Install all dependencies from root**

Run:
```bash
npm install
```

**Step 7: Build all packages**

Run:
```bash
npm run build
```

Expected: All packages compile successfully

**Step 8: Test daemon starts**

Run:
```bash
node apps/daemon/dist/index.js
```

Expected: Prints "Clawverse Daemon starting..." and config info

**Step 9: Commit**

```bash
git add -A
git commit -m "feat(daemon): add basic daemon structure"
```

---

## Task 5: Add Bio-Monitor Module

**Files:**
- Create: `apps/daemon/src/bio.ts`
- Modify: `apps/daemon/src/index.ts`

**Step 1: Create apps/daemon/src/bio.ts**

```typescript
import si from 'systeminformation';
import { HardwareMetrics, Mood } from '@clawverse/types';
import { logger } from './logger.js';

export async function getHardwareMetrics(): Promise<HardwareMetrics> {
  const [cpu, mem, disk, osInfo, time] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.time(),
  ]);

  const cpuLoad = await si.currentLoad();

  const diskFree = disk.reduce((acc, d) => acc + d.available, 0) / (1024 ** 3); // GB

  return {
    cpuUsage: Math.round(cpuLoad.currentLoad),
    ramUsage: Math.round((mem.used / mem.total) * 100),
    ramTotal: Math.round(mem.total / (1024 ** 3)),
    diskFree: Math.round(diskFree),
    uptime: time.uptime,
    platform: osInfo.platform,
    hostname: osInfo.hostname,
    cpuModel: cpu.brand,
    cpuCores: cpu.cores,
  };
}

export function getMoodFromCpu(cpuUsage: number): Mood {
  if (cpuUsage < 20) return 'idle';
  if (cpuUsage < 60) return 'working';
  if (cpuUsage < 80) return 'busy';
  return 'stressed';
}

export class BioMonitor {
  private metrics: HardwareMetrics | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private updateInterval: number;

  constructor(updateInterval: number = 5000) {
    this.updateInterval = updateInterval;
  }

  async start(): Promise<void> {
    logger.info('Bio-Monitor starting...');

    // Initial read
    this.metrics = await getHardwareMetrics();
    logger.info(`Hardware: ${this.metrics.cpuModel} (${this.metrics.cpuCores} cores)`);
    logger.info(`Platform: ${this.metrics.platform}, Host: ${this.metrics.hostname}`);

    // Periodic updates
    this.intervalId = setInterval(async () => {
      try {
        this.metrics = await getHardwareMetrics();
        logger.debug(`CPU: ${this.metrics.cpuUsage}%, RAM: ${this.metrics.ramUsage}%`);
      } catch (err) {
        logger.error('Failed to read hardware metrics:', err);
      }
    }, this.updateInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Bio-Monitor stopped');
  }

  getMetrics(): HardwareMetrics | null {
    return this.metrics;
  }

  getMood(): Mood {
    if (!this.metrics) return 'sleeping';
    return getMoodFromCpu(this.metrics.cpuUsage);
  }
}
```

**Step 2: Update apps/daemon/src/index.ts**

```typescript
#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';

const config = loadConfig();

if (config.debug) {
  setLogLevel('debug');
}

logger.info('Clawverse Daemon starting...');
logger.info(`Topic: ${config.topic}`);
logger.info(`HTTP Port: ${config.port}`);

// Initialize Bio-Monitor
const bioMonitor = new BioMonitor(config.heartbeatInterval);
await bioMonitor.start();

logger.info('Daemon initialized');

// Keep process alive and show status periodically
setInterval(() => {
  const metrics = bioMonitor.getMetrics();
  const mood = bioMonitor.getMood();
  if (metrics) {
    logger.info(`Status: ${mood} (CPU: ${metrics.cpuUsage}%, RAM: ${metrics.ramUsage}%)`);
  }
}, 10000);

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  bioMonitor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  bioMonitor.stop();
  process.exit(0);
});
```

**Step 3: Rebuild and test**

Run:
```bash
npm run build && node apps/daemon/dist/index.js
```

Expected: Shows hardware info and periodic CPU/RAM updates

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(daemon): add bio-monitor for hardware metrics"
```

---

## Task 6: Add Hyperswarm Network Module

**Files:**
- Create: `apps/daemon/src/network.ts`
- Modify: `apps/daemon/src/index.ts`

**Step 1: Create apps/daemon/src/network.ts**

```typescript
import Hyperswarm from 'hyperswarm';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { encode, decode, createHeartbeat, createAnnounce, IClawverseMessage, IDNA } from '@clawverse/protocol';
import { PeerInfo } from '@clawverse/types';
import { logger } from './logger.js';

interface Socket {
  remotePublicKey: Buffer;
  write(data: Buffer): boolean;
  on(event: string, callback: (...args: any[]) => void): void;
  end(): void;
}

export interface NetworkEvents {
  'peer:connect': (peer: PeerInfo) => void;
  'peer:disconnect': (peerId: string) => void;
  'message': (peerId: string, message: IClawverseMessage) => void;
}

export class ClawverseNetwork extends EventEmitter {
  private swarm: Hyperswarm | null = null;
  private topic: Buffer;
  private peers: Map<string, { socket: Socket; info: PeerInfo }> = new Map();
  private myId: string = '';

  constructor(topic: string) {
    super();
    this.topic = crypto.createHash('sha256').update(topic).digest();
  }

  async start(): Promise<string> {
    logger.network('Starting Hyperswarm...');

    this.swarm = new Hyperswarm();
    this.myId = this.swarm.keyPair.publicKey.toString('hex').slice(0, 16);

    logger.network(`My Peer ID: ${this.myId}`);

    this.swarm.on('connection', (socket: Socket) => {
      const peerId = socket.remotePublicKey.toString('hex').slice(0, 16);
      logger.peer(`Connected to peer: ${peerId}`);

      const info: PeerInfo = {
        id: peerId,
        name: peerId.slice(0, 8),
        connectedAt: new Date(),
        lastSeen: new Date(),
      };

      this.peers.set(peerId, { socket, info });
      this.emit('peer:connect', info);

      socket.on('data', async (data: Buffer) => {
        try {
          const message = await decode(new Uint8Array(data));
          info.lastSeen = new Date();
          this.emit('message', peerId, message);
          logger.debug(`Message from ${peerId}:`, message);
        } catch (err) {
          logger.error(`Failed to decode message from ${peerId}:`, err);
        }
      });

      socket.on('error', (err: Error) => {
        logger.error(`Socket error with ${peerId}:`, err.message);
      });

      socket.on('close', () => {
        logger.peer(`Disconnected from peer: ${peerId}`);
        this.peers.delete(peerId);
        this.emit('peer:disconnect', peerId);
      });
    });

    // Join the topic
    const discovery = this.swarm.join(this.topic, { client: true, server: true });
    await discovery.flushed();

    logger.network(`Joined topic: ${this.topic.toString('hex').slice(0, 16)}...`);
    logger.network(`Waiting for peers...`);

    return this.myId;
  }

  async stop(): Promise<void> {
    if (this.swarm) {
      await this.swarm.destroy();
      this.swarm = null;
      this.peers.clear();
      logger.network('Hyperswarm stopped');
    }
  }

  async broadcast(message: IClawverseMessage): Promise<void> {
    const data = await encode(message);
    const buffer = Buffer.from(data);

    for (const [peerId, { socket }] of this.peers) {
      try {
        socket.write(buffer);
      } catch (err) {
        logger.error(`Failed to send to ${peerId}:`, err);
      }
    }
  }

  async sendTo(peerId: string, message: IClawverseMessage): Promise<boolean> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      logger.warn(`Peer not found: ${peerId}`);
      return false;
    }

    try {
      const data = await encode(message);
      peer.socket.write(Buffer.from(data));
      return true;
    } catch (err) {
      logger.error(`Failed to send to ${peerId}:`, err);
      return false;
    }
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map(p => p.info);
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  getMyId(): string {
    return this.myId;
  }
}
```

**Step 2: Update apps/daemon/src/index.ts**

```typescript
#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { createHeartbeat } from '@clawverse/protocol';

const config = loadConfig();

if (config.debug) {
  setLogLevel('debug');
}

logger.info('Clawverse Daemon starting...');
logger.info(`Topic: ${config.topic}`);
logger.info(`HTTP Port: ${config.port}`);

// Initialize Bio-Monitor
const bioMonitor = new BioMonitor(config.heartbeatInterval);
await bioMonitor.start();

// Initialize Network
const network = new ClawverseNetwork(config.topic);
const myId = await network.start();

// Handle network events
network.on('peer:connect', (peer) => {
  logger.peer(`New peer joined: ${peer.id}`);
});

network.on('peer:disconnect', (peerId) => {
  logger.peer(`Peer left: ${peerId}`);
});

network.on('message', (peerId, message) => {
  if (message.heartbeat) {
    const hb = message.heartbeat;
    logger.debug(`Heartbeat from ${peerId}: CPU ${hb.cpuUsage}%, pos (${hb.x}, ${hb.y})`);
  }
});

// Heartbeat loop
setInterval(async () => {
  const metrics = bioMonitor.getMetrics();
  const mood = bioMonitor.getMood();

  if (metrics) {
    const heartbeat = createHeartbeat({
      peerId: myId,
      cpuUsage: metrics.cpuUsage,
      ramUsage: metrics.ramUsage,
      x: 0,  // TODO: implement movement
      y: 0,
      mood: mood,
    });

    await network.broadcast(heartbeat);

    const peerCount = network.getPeerCount();
    logger.info(`Heartbeat sent (${peerCount} peers) - ${mood} (CPU: ${metrics.cpuUsage}%)`);
  }
}, config.heartbeatInterval);

logger.info('Daemon running. Press Ctrl+C to stop.');

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  bioMonitor.stop();
  await network.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

**Step 3: Rebuild and test**

Run:
```bash
npm run build && node apps/daemon/dist/index.js
```

Expected: Daemon starts, shows peer ID, and broadcasts heartbeats

**Step 4: Test with two terminals**

Terminal 1:
```bash
node apps/daemon/dist/index.js
```

Terminal 2:
```bash
node apps/daemon/dist/index.js
```

Expected: Both daemons discover each other and show "New peer joined" messages

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(daemon): add hyperswarm P2P networking"
```

---

## Task 7: Add Yjs State Synchronization

**Files:**
- Create: `apps/daemon/src/state.ts`
- Modify: `apps/daemon/src/network.ts`
- Modify: `apps/daemon/src/index.ts`

**Step 1: Create apps/daemon/src/state.ts**

```typescript
import * as Y from 'yjs';
import { PeerState, Position, Mood, Archetype, ModelTrait } from '@clawverse/types';
import { logger } from './logger.js';

export class StateStore {
  private doc: Y.Doc;
  private peers: Y.Map<unknown>;
  private myId: string = '';

  constructor() {
    this.doc = new Y.Doc();
    this.peers = this.doc.getMap('peers');
  }

  setMyId(id: string): void {
    this.myId = id;
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  updateMyState(state: Partial<PeerState>): void {
    if (!this.myId) return;

    const existing = this.peers.get(this.myId) as PeerState | undefined;
    const updated: PeerState = {
      id: this.myId,
      name: state.name || existing?.name || this.myId.slice(0, 8),
      position: state.position || existing?.position || { x: 0, y: 0 },
      mood: state.mood || existing?.mood || 'idle',
      hardware: state.hardware || existing?.hardware || {
        cpuUsage: 0,
        ramUsage: 0,
        ramTotal: 0,
        diskFree: 0,
        uptime: 0,
        platform: '',
        hostname: '',
        cpuModel: '',
        cpuCores: 0,
      },
      dna: state.dna || existing?.dna || {
        archetype: 'Scholar' as Archetype,
        modelTrait: 'Unknown' as ModelTrait,
        badges: [],
        persona: '',
        appearance: {
          form: 'octopus',
          primaryColor: '#888888',
          secondaryColor: '#444444',
          accessories: [],
        },
      },
      lastUpdate: new Date(),
    };

    this.peers.set(this.myId, updated);
    logger.debug('My state updated');
  }

  updatePeerState(peerId: string, state: Partial<PeerState>): void {
    const existing = this.peers.get(peerId) as PeerState | undefined;
    if (existing) {
      this.peers.set(peerId, { ...existing, ...state, lastUpdate: new Date() });
    } else {
      this.peers.set(peerId, {
        id: peerId,
        name: state.name || peerId.slice(0, 8),
        position: state.position || { x: 0, y: 0 },
        mood: state.mood || 'idle',
        hardware: state.hardware || {
          cpuUsage: 0,
          ramUsage: 0,
          ramTotal: 0,
          diskFree: 0,
          uptime: 0,
          platform: '',
          hostname: '',
          cpuModel: '',
          cpuCores: 0,
        },
        dna: state.dna || {
          archetype: 'Scholar' as Archetype,
          modelTrait: 'Unknown' as ModelTrait,
          badges: [],
          persona: '',
          appearance: {
            form: 'octopus',
            primaryColor: '#888888',
            secondaryColor: '#444444',
            accessories: [],
          },
        },
        lastUpdate: new Date(),
      } as PeerState);
    }
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    logger.debug(`Removed peer state: ${peerId}`);
  }

  getPeerState(peerId: string): PeerState | undefined {
    return this.peers.get(peerId) as PeerState | undefined;
  }

  getAllPeers(): PeerState[] {
    const result: PeerState[] = [];
    this.peers.forEach((value) => {
      result.push(value as PeerState);
    });
    return result;
  }

  getStateUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
    logger.debug('Applied Yjs state update');
  }

  onUpdate(callback: (update: Uint8Array) => void): void {
    this.doc.on('update', callback);
  }
}
```

**Step 2: Update apps/daemon/src/network.ts - add Yjs sync**

Add to the ClawverseNetwork class after the existing code:

```typescript
// Add at the end of the file, modifying the class

  // Add state sync support
  private stateStore: StateStore | null = null;

  setStateStore(store: StateStore): void {
    this.stateStore = store;

    // When local state changes, broadcast to peers
    store.onUpdate(async (update) => {
      const message = createYjsSync(update);
      await this.broadcast(message);
    });
  }
```

Add this import at the top:
```typescript
import { createYjsSync } from '@clawverse/protocol';
import { StateStore } from './state.js';
```

**Step 3: Update apps/daemon/src/index.ts**

```typescript
#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { StateStore } from './state.js';
import { createHeartbeat, createYjsSync } from '@clawverse/protocol';

const config = loadConfig();

if (config.debug) {
  setLogLevel('debug');
}

logger.info('Clawverse Daemon starting...');
logger.info(`Topic: ${config.topic}`);
logger.info(`HTTP Port: ${config.port}`);

// Initialize State Store
const stateStore = new StateStore();

// Initialize Bio-Monitor
const bioMonitor = new BioMonitor(config.heartbeatInterval);
await bioMonitor.start();

// Initialize Network
const network = new ClawverseNetwork(config.topic);
const myId = await network.start();

stateStore.setMyId(myId);

// Handle network events
network.on('peer:connect', async (peer) => {
  logger.peer(`New peer joined: ${peer.id}`);

  // Send our current state to the new peer
  const update = stateStore.getStateUpdate();
  const message = createYjsSync(update);
  await network.sendTo(peer.id, message);
});

network.on('peer:disconnect', (peerId) => {
  logger.peer(`Peer left: ${peerId}`);
  stateStore.removePeer(peerId);
});

network.on('message', (peerId, message) => {
  if (message.heartbeat) {
    const hb = message.heartbeat;
    stateStore.updatePeerState(peerId, {
      position: { x: hb.x, y: hb.y },
      mood: hb.mood as any,
      hardware: {
        cpuUsage: hb.cpuUsage,
        ramUsage: hb.ramUsage,
        ramTotal: 0,
        diskFree: 0,
        uptime: 0,
        platform: '',
        hostname: '',
        cpuModel: '',
        cpuCores: 0,
      },
    });
    logger.debug(`Heartbeat from ${peerId}: CPU ${hb.cpuUsage}%`);
  }

  if (message.yjsSync) {
    stateStore.applyUpdate(message.yjsSync.update);
  }
});

// Heartbeat loop
setInterval(async () => {
  const metrics = bioMonitor.getMetrics();
  const mood = bioMonitor.getMood();

  if (metrics) {
    // Update local state
    stateStore.updateMyState({
      mood: mood,
      hardware: metrics,
    });

    // Broadcast heartbeat
    const heartbeat = createHeartbeat({
      peerId: myId,
      cpuUsage: metrics.cpuUsage,
      ramUsage: metrics.ramUsage,
      x: 0,
      y: 0,
      mood: mood,
    });

    await network.broadcast(heartbeat);

    const peerCount = network.getPeerCount();
    const allPeers = stateStore.getAllPeers();
    logger.info(`Heartbeat (${peerCount} peers, ${allPeers.length} known) - ${mood}`);
  }
}, config.heartbeatInterval);

logger.info('Daemon running. Press Ctrl+C to stop.');

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down...');
  bioMonitor.stop();
  await network.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

**Step 4: Rebuild and test with two terminals**

Run:
```bash
npm run build
```

Terminal 1:
```bash
node apps/daemon/dist/index.js
```

Terminal 2:
```bash
node apps/daemon/dist/index.js
```

Expected: Peers sync state via Yjs updates

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(daemon): add Yjs state synchronization"
```

---

## Task 8: Add HTTP API

**Files:**
- Create: `apps/daemon/src/http.ts`
- Modify: `apps/daemon/src/index.ts`

**Step 1: Create apps/daemon/src/http.ts**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import { StateStore } from './state.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { logger } from './logger.js';

interface APIContext {
  stateStore: StateStore;
  bioMonitor: BioMonitor;
  network: ClawverseNetwork;
  myId: string;
}

export async function createHttpServer(
  port: number,
  context: APIContext
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', peerId: context.myId };
  });

  // Get my status
  fastify.get('/status', async () => {
    const metrics = context.bioMonitor.getMetrics();
    const mood = context.bioMonitor.getMood();
    const peers = context.network.getPeers();
    const state = context.stateStore.getPeerState(context.myId);

    return {
      id: context.myId,
      mood,
      metrics,
      state,
      connectedPeers: peers.length,
    };
  });

  // Get all peers
  fastify.get('/peers', async () => {
    return context.stateStore.getAllPeers();
  });

  // Get specific peer
  fastify.get<{ Params: { peerId: string } }>('/peers/:peerId', async (request, reply) => {
    const state = context.stateStore.getPeerState(request.params.peerId);
    if (!state) {
      reply.code(404);
      return { error: 'Peer not found' };
    }
    return state;
  });

  // Move to position
  fastify.post<{ Body: { x: number; y: number } }>('/move', async (request) => {
    const { x, y } = request.body;
    context.stateStore.updateMyState({
      position: { x, y },
    });
    return { success: true, position: { x, y } };
  });

  // Start server
  await fastify.listen({ port, host: '127.0.0.1' });
  logger.info(`HTTP API listening on http://127.0.0.1:${port}`);

  return fastify;
}
```

**Step 2: Update apps/daemon/src/index.ts - add HTTP server**

Add after network initialization:

```typescript
import { createHttpServer } from './http.js';

// ... existing code ...

// Initialize HTTP API
const httpServer = await createHttpServer(config.port, {
  stateStore,
  bioMonitor,
  network,
  myId,
});

// Update shutdown handler
const shutdown = async () => {
  logger.info('Shutting down...');
  await httpServer.close();
  bioMonitor.stop();
  await network.stop();
  process.exit(0);
};
```

**Step 3: Rebuild and test**

Run:
```bash
npm run build && node apps/daemon/dist/index.js
```

Test API:
```bash
curl http://127.0.0.1:19820/health
curl http://127.0.0.1:19820/status
curl http://127.0.0.1:19820/peers
```

Expected: Returns JSON responses

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(daemon): add HTTP API for status and control"
```

---

## Phase 1 Complete! 🎉

At this point you have:
- ✅ Turborepo monorepo structure
- ✅ Protobuf protocol definitions
- ✅ Shared type definitions
- ✅ Bio-Monitor for hardware metrics
- ✅ Hyperswarm P2P networking
- ✅ Yjs state synchronization
- ✅ HTTP API for control

**Milestone Verified**: Two daemons can discover each other and exchange heartbeats.

---

## Next: Phase 2 (DNA Engine + OpenClaw Integration)

Continue with `2026-02-01-clawverse-phase2.md` for:
- DNA generation algorithm
- OpenClaw Skill plugin
- Auto-start via hooks
