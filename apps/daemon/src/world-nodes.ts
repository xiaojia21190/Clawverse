import type { PeerState } from '@clawverse/types';

export interface WorldNodeSnapshot {
  actorId: string;
  primarySessionId: string;
  sessionIds: string[];
  sessionCount: number;
  state: PeerState;
}

function actorIdOf(peer: PeerState): string {
  return peer.actorId ?? peer.dna.id ?? peer.id;
}

function sessionIdOf(peer: PeerState): string {
  return peer.sessionId ?? peer.id;
}

function lastUpdateMs(peer: PeerState): number {
  const ts = Date.parse(String(peer.lastUpdate ?? ''));
  return Number.isFinite(ts) ? ts : 0;
}

function choosePrimary(left: PeerState, right: PeerState): PeerState {
  const leftTs = lastUpdateMs(left);
  const rightTs = lastUpdateMs(right);
  if (rightTs > leftTs) return right;
  if (rightTs < leftTs) return left;
  return sessionIdOf(right).localeCompare(sessionIdOf(left)) < 0 ? right : left;
}

export function buildWorldNodes(peers: PeerState[]): WorldNodeSnapshot[] {
  const byActor = new Map<string, { primary: PeerState; sessions: Set<string> }>();

  for (const peer of peers) {
    const actorId = actorIdOf(peer);
    const sessionIds = [peer.id, sessionIdOf(peer)].filter(
      (value, index, list): value is string =>
        typeof value === 'string' && value.length > 0 && list.indexOf(value) === index,
    );

    const existing = byActor.get(actorId);
    if (!existing) {
      byActor.set(actorId, {
        primary: {
          ...peer,
          actorId,
          sessionId: sessionIdOf(peer),
        },
        sessions: new Set(sessionIds),
      });
      continue;
    }

    for (const sessionId of sessionIds) existing.sessions.add(sessionId);
    const nextPrimary = choosePrimary(existing.primary, peer);
    existing.primary = {
      ...nextPrimary,
      actorId,
      sessionId: sessionIdOf(nextPrimary),
    };
  }

  return Array.from(byActor.entries())
    .map(([actorId, bucket]) => {
      const sessionIds = Array.from(bucket.sessions.values()).sort((left, right) => left.localeCompare(right));
      return {
        actorId,
        primarySessionId: sessionIdOf(bucket.primary),
        sessionIds,
        sessionCount: sessionIds.length,
        state: bucket.primary,
      };
    })
    .sort((left, right) => {
      const delta = lastUpdateMs(right.state) - lastUpdateMs(left.state);
      if (delta !== 0) return delta;
      return left.state.name.localeCompare(right.state.name);
    });
}

export function findPeerByIdentity(peers: PeerState[], id: string): PeerState | undefined {
  const candidates = peers.filter((peer) => {
    const actorId = actorIdOf(peer);
    const sessionId = sessionIdOf(peer);
    return peer.id === id || sessionId === id || actorId === id || peer.dna.id === id;
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((primary, peer) => choosePrimary(primary, peer));
}
