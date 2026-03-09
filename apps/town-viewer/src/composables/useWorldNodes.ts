import { onMounted, onUnmounted, ref } from 'vue';
import type { PeerState } from './usePeers';

export interface WorldNode {
  actorId: string;
  primarySessionId: string;
  sessionIds: string[];
  sessionCount: number;
  state: PeerState;
}

export interface RelationshipIdentity {
  peerId?: string;
  actorId?: string;
  sessionId?: string;
  peerIds?: string[];
}

interface WorldNodesResponse {
  topic?: string;
  nodes?: WorldNode[];
}

const POLL_MS = 5000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function actorIdOfPeer(peer: Pick<PeerState, 'id' | 'actorId' | 'dna'>): string {
  return peer.actorId ?? peer.dna.id ?? peer.id;
}

export function sessionIdOfPeer(peer: Pick<PeerState, 'id' | 'sessionId'>): string {
  return peer.sessionId ?? peer.id;
}

function lastUpdateMs(peer: Pick<PeerState, 'lastUpdate'>): number {
  const ts = Date.parse(String(peer.lastUpdate ?? ''));
  return Number.isFinite(ts) ? ts : 0;
}

function choosePrimary(left: PeerState, right: PeerState): PeerState {
  const leftTs = lastUpdateMs(left);
  const rightTs = lastUpdateMs(right);
  if (rightTs > leftTs) return right;
  if (rightTs < leftTs) return left;
  return sessionIdOfPeer(right).localeCompare(sessionIdOfPeer(left)) < 0 ? right : left;
}

function stableSort(nodes: WorldNode[]): WorldNode[] {
  return [...nodes].sort((left, right) => {
    const delta = lastUpdateMs(right.state) - lastUpdateMs(left.state);
    if (delta !== 0) return delta;
    return left.state.name.localeCompare(right.state.name);
  });
}

export function worldNodeSessionSet(node: WorldNode): Set<string> {
  return new Set<string>([
    node.primarySessionId,
    ...node.sessionIds,
    node.state.id,
    node.state.sessionId,
  ].filter(isNonEmptyString));
}

function normalizeNodeState(node: WorldNode): PeerState {
  const actorId = isNonEmptyString(node.actorId) ? node.actorId : actorIdOfPeer(node.state);
  const primarySessionId = isNonEmptyString(node.primarySessionId) ? node.primarySessionId : sessionIdOfPeer(node.state);
  return {
    ...node.state,
    actorId,
    sessionId: primarySessionId,
  };
}

function normalizeSessionIds(node: WorldNode): string[] {
  return Array.from(new Set<string>([
    ...(Array.isArray(node.sessionIds) ? node.sessionIds : []),
    node.primarySessionId,
    node.state.id,
    node.state.sessionId,
  ].filter(isNonEmptyString)));
}

export function normalizeWorldNodes(nodes: WorldNode[]): WorldNode[] {
  const byActor = new Map<string, { primary: PeerState; sessions: Set<string> }>();

  for (const rawNode of nodes) {
    if (!rawNode?.state) continue;
    const state = normalizeNodeState(rawNode);
    const actorId = actorIdOfPeer(state);
    const sessions = normalizeSessionIds({
      ...rawNode,
      actorId,
      primarySessionId: sessionIdOfPeer(state),
      state,
    });

    const existing = byActor.get(actorId);
    if (!existing) {
      byActor.set(actorId, {
        primary: state,
        sessions: new Set(sessions),
      });
      continue;
    }

    for (const sessionId of sessions) existing.sessions.add(sessionId);
    existing.primary = {
      ...choosePrimary(existing.primary, state),
      actorId,
    };
  }

  return stableSort(Array.from(byActor.entries()).map(([actorId, bucket]) => {
    const sessionIds = Array.from(bucket.sessions.values());
    const primarySessionId = sessionIdOfPeer(bucket.primary);
    return {
      actorId,
      primarySessionId,
      sessionIds,
      sessionCount: sessionIds.length,
      state: {
        ...bucket.primary,
        actorId,
        sessionId: primarySessionId,
      },
    };
  }));
}

export function dedupePeersAsWorldNodes(peers: Iterable<PeerState>): WorldNode[] {
  const byActor = new Map<string, { primary: PeerState; sessions: Set<string> }>();

  for (const peer of peers) {
    const actorId = actorIdOfPeer(peer);
    const sessionId = sessionIdOfPeer(peer);
    const existing = byActor.get(actorId);
    const sessionIds = [peer.id, sessionId].filter(isNonEmptyString);

    if (!existing) {
      byActor.set(actorId, {
        primary: {
          ...peer,
          actorId,
          sessionId,
        },
        sessions: new Set(sessionIds),
      });
      continue;
    }

    for (const id of sessionIds) existing.sessions.add(id);
    const primary = choosePrimary(existing.primary, peer);
    existing.primary = {
      ...primary,
      actorId,
      sessionId: sessionIdOfPeer(primary),
    };
  }

  return stableSort(Array.from(byActor.entries()).map(([actorId, bucket]) => {
    const sessionIds = Array.from(bucket.sessions.values());
    const primarySessionId = sessionIdOfPeer(bucket.primary);
    return {
      actorId,
      primarySessionId,
      sessionIds,
      sessionCount: sessionIds.length,
      state: {
        ...bucket.primary,
        actorId,
        sessionId: primarySessionId,
      },
    };
  }));
}

export function withLocalFallback(nodes: WorldNode[], localState: PeerState | null): WorldNode[] {
  if (!localState) return nodes;
  const actorId = actorIdOfPeer(localState);
  if (nodes.some((node) => node.actorId === actorId)) return nodes;
  const primarySessionId = sessionIdOfPeer(localState);
  return stableSort([
    ...nodes,
    {
      actorId,
      primarySessionId,
      sessionIds: Array.from(new Set<string>([localState.id, primarySessionId].filter(isNonEmptyString))),
      sessionCount: 1,
      state: {
        ...localState,
        actorId,
        sessionId: primarySessionId,
      },
    },
  ]);
}

export function mergeWorldNodes(
  nodes: WorldNode[] | null | undefined,
  peers: Map<string, PeerState> | Iterable<PeerState>,
  localState: PeerState | null,
): WorldNode[] {
  const normalized = normalizeWorldNodes(Array.isArray(nodes) ? nodes : []);
  if (normalized.length > 0) return withLocalFallback(normalized, localState);
  const peerList = peers instanceof Map ? peers.values() : peers;
  return withLocalFallback(dedupePeersAsWorldNodes(peerList), localState);
}

function identityScore(node: WorldNode, identity: string): number {
  if (!isNonEmptyString(identity)) return 0;
  if (node.actorId === identity) return 6;
  if (node.primarySessionId === identity) return 5;
  if (node.state.id === identity) return 4;
  if (node.state.dna?.id === identity) return 3;
  if (worldNodeSessionSet(node).has(identity)) return 2;
  return 0;
}

export function worldNodeMatchesIdentity(node: WorldNode, identity: string | null | undefined): boolean {
  if (!isNonEmptyString(identity)) return false;
  return identityScore(node, identity) > 0;
}

export function findWorldNodeByIdentity(nodes: WorldNode[], identity: string | null | undefined): WorldNode | null {
  if (!isNonEmptyString(identity)) return null;
  let bestNode: WorldNode | null = null;
  let bestScore = 0;

  for (const node of nodes) {
    const score = identityScore(node, identity);
    if (score === 0) continue;
    if (!bestNode || score > bestScore) {
      bestNode = node;
      bestScore = score;
      continue;
    }
    if (score === bestScore && lastUpdateMs(node.state) > lastUpdateMs(bestNode.state)) {
      bestNode = node;
    }
  }

  return bestNode;
}

function relationshipScore(relationship: RelationshipIdentity, node: WorldNode): number {
  let score = 0;

  if (isNonEmptyString(relationship.actorId) && relationship.actorId === node.actorId) {
    score = Math.max(score, 6);
  }

  const sessions = worldNodeSessionSet(node);
  if (isNonEmptyString(relationship.sessionId)) {
    if (relationship.sessionId === node.primarySessionId) score = Math.max(score, 5);
    else if (sessions.has(relationship.sessionId)) score = Math.max(score, 3);
  }

  if (isNonEmptyString(relationship.peerId)) {
    if (relationship.peerId === node.primarySessionId) score = Math.max(score, 5);
    else if (sessions.has(relationship.peerId)) score = Math.max(score, 4);
  }

  if (Array.isArray(relationship.peerIds) && relationship.peerIds.some((peerId) => sessions.has(peerId))) {
    score = Math.max(score, 3);
  }

  return score;
}

export function relationshipMatchesWorldNode(relationship: RelationshipIdentity, node: WorldNode): boolean {
  return relationshipScore(relationship, node) > 0;
}

export function findWorldNodeForRelationship(nodes: WorldNode[], relationship: RelationshipIdentity): WorldNode | null {
  let bestNode: WorldNode | null = null;
  let bestScore = 0;

  for (const node of nodes) {
    const score = relationshipScore(relationship, node);
    if (score === 0) continue;
    if (!bestNode || score > bestScore) {
      bestNode = node;
      bestScore = score;
      continue;
    }
    if (score === bestScore && lastUpdateMs(node.state) > lastUpdateMs(bestNode.state)) {
      bestNode = node;
    }
  }

  return bestNode;
}

export function useWorldNodes() {
  const worldNodes = ref<WorldNode[]>([]);
  const worldTopic = ref<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      const res = await fetch('/world/nodes');
      if (!res.ok) return;
      const payload = await res.json() as WorldNodesResponse;
      worldNodes.value = Array.isArray(payload.nodes) ? payload.nodes : [];
      worldTopic.value = typeof payload.topic === 'string' ? payload.topic : null;
    } catch {
      // ignore transient fetch errors
    }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    worldNodes,
    worldTopic,
    refresh,
  };
}
