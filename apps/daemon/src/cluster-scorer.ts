import type { Faction, ResourceState } from '@clawverse/types';
import type { WorldNodeSnapshot } from './world-nodes.js';

export interface TopicClusterSnapshot {
  id: string;
  topic: string;
  label: string;
  district: string;
  center: { x: number; y: number };
  actorIds: string[];
  actorCount: number;
  branchCount: number;
  local: boolean;
  dominantFactionId: string | null;
  dominantFactionName: string | null;
  dominantFactionRatio: number;
  leaderActorId: string | null;
  leaderName: string | null;
  leaderScore: number;
  cohesion: number;
  safety: number;
  resourcePressure: number;
  stability: number;
  status: 'forming' | 'stable' | 'strained' | 'fracturing' | 'collapsing';
  reasons: string[];
  updatedAt: string;
}

interface ClusterScorerInput {
  topic: string;
  nodes: WorldNodeSnapshot[];
  localActorId?: string | null;
  factions?: Faction[];
  resources?: Pick<ResourceState, 'compute' | 'storage' | 'bandwidth'>;
  raidRisk?: number;
  activeWarCount?: number;
  now?: string;
}

interface RawCluster {
  actorIds: string[];
  nodes: WorldNodeSnapshot[];
}

const PROXIMITY_TILES = 10;
const FACTION_PROXIMITY_TILES = 14;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function districtName(position: { x: number; y: number }): string {
  if (position.x < 10 && position.y < 10) return 'Plaza';
  if (position.x >= 10 && position.x < 20 && position.y < 10) return 'Market';
  if (position.x < 10 && position.y >= 10 && position.y < 20) return 'Library';
  if (position.x >= 10 && position.x < 20 && position.y >= 10 && position.y < 20) return 'Workshop';
  if (position.x < 10 && position.y >= 20) return 'Park';
  if (position.x >= 10 && position.x < 20 && position.y >= 20 && position.y < 30) return 'Tavern';
  return 'Residential';
}

function distance(left: WorldNodeSnapshot, right: WorldNodeSnapshot): number {
  const dx = left.state.position.x - right.state.position.x;
  const dy = left.state.position.y - right.state.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function actorFactionMap(factions: Faction[]): Map<string, Faction> {
  const map = new Map<string, Faction>();
  for (const faction of factions) {
    for (const actorId of faction.memberActorIds ?? []) {
      if (typeof actorId === 'string' && actorId.trim().length > 0) map.set(actorId, faction);
    }
  }
  return map;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
}

function sameFaction(left: WorldNodeSnapshot, right: WorldNodeSnapshot, factions: Map<string, Faction>): boolean {
  const leftFaction = factions.get(left.actorId);
  const rightFaction = factions.get(right.actorId);
  return !!leftFaction && !!rightFaction && leftFaction.id === rightFaction.id;
}

function majorityDistrict(nodes: WorldNodeSnapshot[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const district = districtName(node.state.position);
    counts.set(district, (counts.get(district) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'Residential';
}

function clusterLabel(district: string, factionName: string | null, actorCount: number): string {
  if (factionName && actorCount >= 3) return `${factionName} ${district} hold`;
  if (actorCount >= 4) return `${district} settlement`;
  if (actorCount >= 2) return `${district} cluster`;
  return `${district} outpost`;
}

function shouldLink(left: WorldNodeSnapshot, right: WorldNodeSnapshot, factions: Map<string, Faction>): boolean {
  const dist = distance(left, right);
  if (dist <= PROXIMITY_TILES) return true;
  return dist <= FACTION_PROXIMITY_TILES && sameFaction(left, right, factions);
}

function buildRawClusters(nodes: WorldNodeSnapshot[], factions: Map<string, Faction>, localActorId: string | null): RawCluster[] {
  const visited = new Set<string>();
  const groups: RawCluster[] = [];

  for (const node of nodes) {
    if (visited.has(node.actorId)) continue;
    const queue = [node];
    const members: WorldNodeSnapshot[] = [];
    visited.add(node.actorId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      members.push(current);

      for (const candidate of nodes) {
        if (visited.has(candidate.actorId)) continue;
        if (!shouldLink(current, candidate, factions)) continue;
        visited.add(candidate.actorId);
        queue.push(candidate);
      }
    }

    groups.push({
      actorIds: members.map((member) => member.actorId).sort(),
      nodes: members.sort((left, right) => left.actorId.localeCompare(right.actorId)),
    });
  }

  const filtered = groups.filter((group) => group.nodes.length >= 2 || (localActorId ? group.actorIds.includes(localActorId) : false));
  return filtered.length > 0 ? filtered : groups.slice(0, 1);
}

function averageDistanceToCenter(nodes: WorldNodeSnapshot[], center: { x: number; y: number }): number {
  if (nodes.length <= 1) return 0;
  const total = nodes.reduce((sum, node) => {
    const dx = node.state.position.x - center.x;
    const dy = node.state.position.y - center.y;
    return sum + Math.sqrt(dx * dx + dy * dy);
  }, 0);
  return total / nodes.length;
}

function buildClusterReasons(input: {
  district: string;
  actorCount: number;
  dominantFactionName: string | null;
  dominantFactionRatio: number;
  leaderName: string | null;
  resourcePressure: number;
  safety: number;
}): string[] {
  const reasons: string[] = [];
  reasons.push(`${input.actorCount} actors are holding around ${input.district}.`);
  if (input.dominantFactionName && input.dominantFactionRatio >= 0.5) {
    reasons.push(`${input.dominantFactionName} currently anchors most of the cluster.`);
  }
  if (input.leaderName) {
    reasons.push(`${input.leaderName} currently has the strongest coordination footprint.`);
  }
  if (input.resourcePressure >= 65) {
    reasons.push('Resource pressure is high enough to threaten cluster stability.');
  }
  if (input.safety <= 35) {
    reasons.push('Safety has degraded and collapse risk is rising.');
  }
  return reasons.slice(0, 3);
}

function moodLeadershipBonus(mood: string): number {
  if (mood === 'working') return 8;
  if (mood === 'busy') return 6;
  if (mood === 'idle') return 3;
  if (mood === 'stressed') return -6;
  if (mood === 'distressed') return -12;
  return 0;
}

function chooseLeader(
  nodes: WorldNodeSnapshot[],
  dominantFactionId: string | null,
  factions: Map<string, Faction>,
  localActorId: string | null,
): { actorId: string | null; name: string | null; score: number } {
  const ranked = nodes.map((node) => {
    const faction = factions.get(node.actorId);
    const isDominantFaction = !!dominantFactionId && faction?.id === dominantFactionId;
    const isFounder = !!faction && faction.founderActorId === node.actorId;
    const score = clamp(Math.round(
      28
      + node.sessionCount * 7
      + moodLeadershipBonus(node.state.mood)
      + (isDominantFaction ? 14 : 0)
      + (isFounder ? 10 : 0)
      + (localActorId && node.actorId === localActorId ? 4 : 0),
    ));
    return {
      actorId: node.actorId,
      name: node.state.name,
      score,
    };
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  return ranked[0] ?? { actorId: null, name: null, score: 0 };
}

function statusFor(stability: number, resourcePressure: number, safety: number, actorCount: number): TopicClusterSnapshot['status'] {
  if (actorCount <= 1) return 'forming';
  if (resourcePressure >= 75 || safety <= 24) return 'collapsing';
  if (stability < 42) return 'fracturing';
  if (stability < 66) return 'strained';
  return 'stable';
}

export function scoreTopicClusters(input: ClusterScorerInput): TopicClusterSnapshot[] {
  const nodes = [...input.nodes];
  if (nodes.length === 0) return [];

  const now = input.now ?? new Date().toISOString();
  const factions = actorFactionMap(input.factions ?? []);
  const rawClusters = buildRawClusters(nodes, factions, input.localActorId ?? null);
  const compute = Number(input.resources?.compute ?? 80);
  const storage = Number(input.resources?.storage ?? 80);
  const bandwidth = Number(input.resources?.bandwidth ?? 60);
  const raidRisk = clamp(Math.round(Number(input.raidRisk ?? 0)));
  const activeWarCount = Math.max(0, Math.round(Number(input.activeWarCount ?? 0)));
  const baseResourcePressure = clamp(
    Math.round(
      Math.max(0, 42 - compute) * 1.15
      + Math.max(0, 35 - storage) * 0.95
      + Math.max(0, 40 - bandwidth) * 1.05,
    ),
  );

  return rawClusters.map((cluster) => {
    const actorCount = cluster.nodes.length;
    const branchCount = cluster.nodes.reduce((sum, node) => sum + node.sessionCount, 0);
    const center = {
      x: Number((cluster.nodes.reduce((sum, node) => sum + node.state.position.x, 0) / actorCount).toFixed(1)),
      y: Number((cluster.nodes.reduce((sum, node) => sum + node.state.position.y, 0) / actorCount).toFixed(1)),
    };
    const district = majorityDistrict(cluster.nodes);

    const factionCounts = new Map<string, { count: number; faction: Faction }>();
    for (const node of cluster.nodes) {
      const faction = factions.get(node.actorId);
      if (!faction) continue;
      const current = factionCounts.get(faction.id);
      if (current) current.count += 1;
      else factionCounts.set(faction.id, { count: 1, faction });
    }
    const dominantFactionEntry = [...factionCounts.values()]
      .sort((left, right) => right.count - left.count || left.faction.name.localeCompare(right.faction.name))[0] ?? null;
    const dominantFactionRatio = dominantFactionEntry ? dominantFactionEntry.count / actorCount : 0;
    const leader = chooseLeader(cluster.nodes, dominantFactionEntry?.faction.id ?? null, factions, input.localActorId ?? null);
    const density = averageDistanceToCenter(cluster.nodes, center);
    const densityScore = clamp(Math.round(100 - density * 12));
    const safety = clamp(Math.round(
      72
      + actorCount * 7
      + branchCount * 2
      + (dominantFactionRatio >= 0.6 ? 8 : dominantFactionRatio >= 0.4 ? 4 : 0)
      - raidRisk * 0.62
      - activeWarCount * 10,
    ));
    const resourcePressure = clamp(Math.round(baseResourcePressure - actorCount * 4 - branchCount * 1.5 + raidRisk * 0.12));
    const cohesion = clamp(Math.round(
      28
      + actorCount * 14
      + densityScore * 0.32
      + dominantFactionRatio * 20
      - activeWarCount * 8,
    ));
    const stability = clamp(Math.round(cohesion * 0.45 + safety * 0.35 + (100 - resourcePressure) * 0.2));
    const label = clusterLabel(district, dominantFactionEntry?.faction.name ?? null, actorCount);
    const id = `clu-${hashString(`${input.topic}:${cluster.actorIds.join('|')}`)}`;
    const reasons = buildClusterReasons({
      district,
      actorCount,
      dominantFactionName: dominantFactionEntry?.faction.name ?? null,
      dominantFactionRatio,
      leaderName: leader.name,
      resourcePressure,
      safety,
    });

    return {
      id,
      topic: input.topic,
      label,
      district,
      center,
      actorIds: cluster.actorIds,
      actorCount,
      branchCount,
      local: input.localActorId ? cluster.actorIds.includes(input.localActorId) : false,
      dominantFactionId: dominantFactionEntry?.faction.id ?? null,
      dominantFactionName: dominantFactionEntry?.faction.name ?? null,
      dominantFactionRatio: Number(dominantFactionRatio.toFixed(2)),
      leaderActorId: leader.actorId,
      leaderName: leader.name,
      leaderScore: leader.score,
      cohesion,
      safety,
      resourcePressure,
      stability,
      status: statusFor(stability, resourcePressure, safety, actorCount),
      reasons,
      updatedAt: now,
    } satisfies TopicClusterSnapshot;
  }).sort((left, right) =>
    Number(right.local) - Number(left.local)
    || right.stability - left.stability
    || right.actorCount - left.actorCount
    || left.label.localeCompare(right.label)
  );
}
