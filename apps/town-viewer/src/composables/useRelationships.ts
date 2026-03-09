import { ref, onMounted, onUnmounted } from 'vue';

export type RelationshipTier = 'nemesis' | 'rival' | 'stranger' | 'acquaintance' | 'friend' | 'ally';

export interface RelationshipInfo {
  peerId: string;
  actorId?: string;
  sessionId?: string;
  peerIds?: string[];
  tier: RelationshipTier;
  sentiment: number;
  interactionCount: number;
  notableEvents: string[];
}

export function useRelationships() {
  const relationships = ref<RelationshipInfo[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/life/relationships');
      if (res.ok) {
        const data = await res.json();
        relationships.value = (data.relationships ?? data ?? []).map((r: any) => ({
          peerId: r.peerId,
          actorId: r.actorId,
          sessionId: r.sessionId,
          peerIds: Array.isArray(r.peerIds) ? r.peerIds : [],
          tier: r.tier ?? 'stranger',
          sentiment: r.sentiment ?? 0,
          interactionCount: r.interactionCount ?? 0,
          notableEvents: Array.isArray(r.notableEvents) ? r.notableEvents : [],
        }));
      }
    } catch { /* ignore */ }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 10000);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { relationships, refresh };
}
