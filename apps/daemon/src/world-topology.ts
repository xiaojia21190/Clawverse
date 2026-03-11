import type { PeerState } from '@clawverse/types';
import { buildWorldNodes, type WorldNodeSnapshot } from './world-nodes.js';
import type { RingMirrorRecord } from './ring-registry.js';

export interface TopicWorldDistrictSnapshot {
  name: string;
  actorCount: number;
  branchCount: number;
  isLocal: boolean;
}

export interface TopicWorldBrainSnapshot {
  controller: 'openclaw';
  controlMode: 'local-brain';
  status: 'authoritative' | 'pending';
  actorId: string | null;
  sessionId: string | null;
  branchCount: number;
  district: string | null;
  authority: 'self-owned-role';
  executionGuarantee: 'none';
}

export interface TopicWorldGovernanceSnapshot {
  model: 'emergent-social';
  leadership: 'soft-influence';
  operatorScope: 'local-suggestion-only';
  mutationBoundary: 'worker-system-only';
}

export interface TopicWorldHierarchyLayerSnapshot {
  key: 'ring-world' | 'topic-world' | 'local-brain' | 'big-nodes' | 'small-nodes';
  label: string;
  value: string;
  count?: number;
}

export interface TopicWorldHierarchySnapshot {
  ringMode: 'single-topic' | 'configured-multi-topic';
  layers: TopicWorldHierarchyLayerSnapshot[];
}

export interface RingWorldShellSnapshot {
  topic: string;
  active: boolean;
  status: 'active' | 'configured' | 'mirrored';
  actorCount: number;
  branchCount: number;
  brainStatus: TopicWorldBrainSnapshot['status'] | 'inactive';
  source: 'live' | RingMirrorRecord['source'] | null;
  updatedAt: string | null;
}

export interface RingWorldSnapshot {
  mode: 'single-topic' | 'configured-multi-topic';
  topicCount: number;
  currentTopic: string;
  currentIndex: number;
  shells: RingWorldShellSnapshot[];
}

export interface RingWorldStateSnapshot {
  topic: string;
  ring: RingWorldSnapshot;
}

export interface TopicWorldSnapshot {
  id: string;
  topic: string;
  kind: 'topic-world';
  principle: 'same-topic-same-world';
  brain: TopicWorldBrainSnapshot;
  governance: TopicWorldGovernanceSnapshot;
  ring: RingWorldSnapshot;
  hierarchy: TopicWorldHierarchySnapshot;
  population: {
    actorCount: number;
    branchCount: number;
    districtCount: number;
  };
  districts: TopicWorldDistrictSnapshot[];
}

export interface TopicWorldStateSnapshot {
  topic: string;
  world: TopicWorldSnapshot;
  nodes: WorldNodeSnapshot[];
}

const DISTRICTS = ['Plaza', 'Market', 'Library', 'Workshop', 'Park', 'Tavern', 'Residential'] as const;

interface ResolvedTopicWorldState {
  nodes: WorldNodeSnapshot[];
  localPeer: PeerState | null;
  localActorId: string | null;
  localNode: WorldNodeSnapshot | null;
  localDistrict: TopicWorldDistrictSnapshot['name'] | null;
  districts: TopicWorldDistrictSnapshot[];
  branchCount: number;
  brainLabel: string;
}

function actorIdOf(peer: PeerState | null | undefined): string | null {
  if (!peer) return null;
  return peer.actorId ?? peer.dna.id ?? peer.id ?? null;
}

function sessionIdOf(peer: PeerState | null | undefined): string | null {
  if (!peer) return null;
  return peer.sessionId ?? peer.id ?? null;
}

function districtName(position: { x: number; y: number } | null | undefined): TopicWorldDistrictSnapshot['name'] | null {
  if (!position) return null;
  if (position.x < 10 && position.y < 10) return 'Plaza';
  if (position.x >= 10 && position.x < 20 && position.y < 10) return 'Market';
  if (position.x < 10 && position.y >= 10 && position.y < 20) return 'Library';
  if (position.x >= 10 && position.x < 20 && position.y >= 10 && position.y < 20) return 'Workshop';
  if (position.x < 10 && position.y >= 20) return 'Park';
  if (position.x >= 10 && position.x < 20 && position.y >= 20 && position.y < 30) return 'Tavern';
  return 'Residential';
}

function normalizeRingTopics(topic: string, trackedTopics: string[] | null | undefined): string[] {
  return Array.from(new Set([
    ...((trackedTopics ?? []).map((value) => value.trim()).filter(Boolean)),
    topic,
  ]));
}

function resolveTopicWorldState(
  peers: PeerState[],
  localPeerId?: string | null,
): ResolvedTopicWorldState {
  const nodes = buildWorldNodes(peers);
  const localPeer = peers.find((peer) => peer.id === localPeerId || peer.sessionId === localPeerId) ?? null;
  const localActorId = actorIdOf(localPeer);
  const localNode = localActorId
    ? nodes.find((node) => node.actorId === localActorId) ?? null
    : null;
  const localDistrict = districtName(localNode?.state.position ?? localPeer?.position);

  const districtBuckets = new Map<TopicWorldDistrictSnapshot['name'], TopicWorldDistrictSnapshot>(
    DISTRICTS.map((name) => [name, { name, actorCount: 0, branchCount: 0, isLocal: name === localDistrict }]),
  );

  for (const node of nodes) {
    const district = districtName(node.state.position) ?? 'Residential';
    const bucket = districtBuckets.get(district);
    if (!bucket) continue;
    bucket.actorCount += 1;
    bucket.branchCount += node.sessionCount;
  }

  return {
    nodes,
    localPeer,
    localActorId,
    localNode,
    localDistrict,
    districts: DISTRICTS.map((name) => {
      const bucket = districtBuckets.get(name);
      return bucket ?? { name, actorCount: 0, branchCount: 0, isLocal: name === localDistrict };
    }),
    branchCount: nodes.reduce((sum, node) => sum + node.sessionCount, 0),
    brainLabel: localNode?.state.name ?? localPeer?.name ?? 'pending',
  };
}

function buildRingWorldFromResolved(
  topic: string,
  resolved: ResolvedTopicWorldState,
  trackedTopics?: string[] | null,
  mirrors?: RingMirrorRecord[] | null,
): RingWorldStateSnapshot {
  const ringTopics = normalizeRingTopics(topic, trackedTopics);
  const mode: RingWorldSnapshot['mode'] = ringTopics.length > 1 ? 'configured-multi-topic' : 'single-topic';
  const mirrorMap = new Map((mirrors ?? []).map((entry) => [entry.topic, entry]));

  return {
    topic,
    ring: {
      mode,
      topicCount: ringTopics.length,
      currentTopic: topic,
      currentIndex: ringTopics.indexOf(topic),
      shells: ringTopics.map((ringTopic) => {
        if (ringTopic === topic) {
          const activeBrainStatus: RingWorldShellSnapshot['brainStatus'] = resolved.localNode ? 'authoritative' : 'pending';
          return {
            topic: ringTopic,
            active: true,
            status: 'active' as const,
            actorCount: resolved.nodes.length,
            branchCount: resolved.branchCount,
            brainStatus: activeBrainStatus,
            source: 'live',
            updatedAt: resolved.localNode?.state.lastUpdate instanceof Date
              ? resolved.localNode.state.lastUpdate.toISOString()
              : resolved.localPeer?.lastUpdate instanceof Date
                ? resolved.localPeer.lastUpdate.toISOString()
                : null,
          };
        }

        const mirror = mirrorMap.get(ringTopic);
        if (mirror) {
          return {
            topic: ringTopic,
            active: false,
            status: 'mirrored' as const,
            actorCount: mirror.actorCount,
            branchCount: mirror.branchCount,
            brainStatus: mirror.brainStatus,
            source: mirror.source,
            updatedAt: mirror.updatedAt,
          };
        }

        return {
          topic: ringTopic,
          active: false,
          status: 'configured' as const,
          actorCount: 0,
          branchCount: 0,
          brainStatus: 'inactive' as const,
          source: null,
          updatedAt: null,
        };
      }),
    },
  };
}

export function buildRingWorld(
  topic: string,
  peers: PeerState[],
  localPeerId?: string | null,
  trackedTopics?: string[] | null,
  mirrors?: RingMirrorRecord[] | null,
): RingWorldStateSnapshot {
  return buildRingWorldFromResolved(topic, resolveTopicWorldState(peers, localPeerId), trackedTopics, mirrors);
}

export function buildTopicWorld(
  topic: string,
  peers: PeerState[],
  localPeerId?: string | null,
  trackedTopics?: string[] | null,
  mirrors?: RingMirrorRecord[] | null,
): TopicWorldStateSnapshot {
  const resolved = resolveTopicWorldState(peers, localPeerId);
  const ring = buildRingWorldFromResolved(topic, resolved, trackedTopics, mirrors).ring;
  const ringWorldLabel = ring.mode === 'configured-multi-topic'
    ? `configured ring (${ring.topicCount} topics)`
    : 'single-topic shell';

  return {
    topic,
    world: {
      id: topic,
      topic,
      kind: 'topic-world',
      principle: 'same-topic-same-world',
      brain: {
        controller: 'openclaw',
        controlMode: 'local-brain',
        status: resolved.localNode ? 'authoritative' : 'pending',
        actorId: resolved.localNode?.actorId ?? resolved.localActorId,
        sessionId: resolved.localNode?.primarySessionId ?? sessionIdOf(resolved.localPeer),
        branchCount: resolved.localNode?.sessionCount ?? (resolved.localPeer ? 1 : 0),
        district: resolved.localDistrict,
        authority: 'self-owned-role',
        executionGuarantee: 'none',
      },
      governance: {
        model: 'emergent-social',
        leadership: 'soft-influence',
        operatorScope: 'local-suggestion-only',
        mutationBoundary: 'worker-system-only',
      },
      ring,
      hierarchy: {
        ringMode: ring.mode,
        layers: [
          { key: 'ring-world', label: 'Ring World', value: ringWorldLabel, count: ring.topicCount },
          { key: 'topic-world', label: 'Topic World', value: topic },
          { key: 'local-brain', label: 'Local Actor Brain', value: resolved.brainLabel },
          { key: 'big-nodes', label: 'Big Nodes', value: String(resolved.nodes.length), count: resolved.nodes.length },
          { key: 'small-nodes', label: 'Small Nodes', value: String(resolved.branchCount), count: resolved.branchCount },
        ],
      },
      population: {
        actorCount: resolved.nodes.length,
        branchCount: resolved.branchCount,
        districtCount: resolved.districts.filter((district) => district.actorCount > 0).length,
      },
      districts: resolved.districts,
    },
    nodes: resolved.nodes,
  };
}
