import { existsSync, readFileSync } from 'node:fs';
import type { RingRuntimeConfig } from '@clawverse/types';
import { DEFAULT_CONFIG } from '@clawverse/types';
import { resolveProjectPath } from './paths.js';

interface RingConfigFile {
  topics?: string[];
  selfBaseUrl?: string;
  peerTtlMs?: number;
  mirrorPollMs?: number;
  mirrorSources?: Array<{
    topic?: string;
    baseUrl?: string;
  }>;
  mirrorPushMs?: number;
  mirrorTargets?: Array<{
    baseUrl?: string;
  }>;
}

function parseTopics(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseMirrorSourcesFromEnv(): RingRuntimeConfig['mirrorSources'] {
  return (process.env.CLAWVERSE_RING_MIRROR_SOURCES || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [topicValue, baseUrlValue] = entry.split('=');
      const parsedTopic = topicValue?.trim() || '';
      const parsedBaseUrl = baseUrlValue?.trim() || '';
      if (!parsedTopic || !parsedBaseUrl) return [];
      return [{ topic: parsedTopic, baseUrl: parsedBaseUrl.replace(/\/+$/, '') }];
    });
}

function parseMirrorTargetsFromEnv(): RingRuntimeConfig['mirrorTargets'] {
  return (process.env.CLAWVERSE_RING_MIRROR_TARGETS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((baseUrl) => ({ baseUrl: baseUrl.replace(/\/+$/, '') }));
}

function normalizeMirrorSources(values: RingConfigFile['mirrorSources']): RingRuntimeConfig['mirrorSources'] {
  return (values ?? [])
    .flatMap((entry) => {
      const topic = entry?.topic?.trim() || '';
      const baseUrl = entry?.baseUrl?.trim().replace(/\/+$/, '') || '';
      if (!topic || !baseUrl) return [];
      return [{ topic, baseUrl }];
    });
}

function normalizeMirrorTargets(values: RingConfigFile['mirrorTargets']): RingRuntimeConfig['mirrorTargets'] {
  return (values ?? [])
    .flatMap((entry) => {
      const baseUrl = entry?.baseUrl?.trim().replace(/\/+$/, '') || '';
      if (!baseUrl) return [];
      return [{ baseUrl }];
    });
}

function readRingConfigFile(): RingConfigFile | null {
  const filePath = process.env.CLAWVERSE_RING_CONFIG_PATH || 'data/ring/ring.json';
  const fullPath = resolveProjectPath(filePath);
  if (!existsSync(fullPath)) return null;
  try {
    return JSON.parse(readFileSync(fullPath, 'utf8')) as RingConfigFile;
  } catch {
    return null;
  }
}

export function loadRingConfig(currentTopic: string): RingRuntimeConfig {
  const defaults = DEFAULT_CONFIG.ring;
  const fromFile = readRingConfigFile();

  const envTopics = parseTopics((process.env.CLAWVERSE_RING_TOPICS || '').split(','));
  const fileTopics = parseTopics(fromFile?.topics);
  const topics = Array.from(new Set([
    ...(envTopics.length > 0 ? envTopics : fileTopics.length > 0 ? fileTopics : defaults.topics),
    currentTopic,
  ]));

  const envSources = parseMirrorSourcesFromEnv();
  const fileSources = normalizeMirrorSources(fromFile?.mirrorSources);
  const envTargets = parseMirrorTargetsFromEnv();
  const fileTargets = normalizeMirrorTargets(fromFile?.mirrorTargets);

  const mirrorPollMs = Number.parseInt(
    process.env.CLAWVERSE_RING_MIRROR_POLL_MS
      || String(
        typeof fromFile?.mirrorPollMs === 'number'
          ? fromFile.mirrorPollMs
          : defaults.mirrorPollMs,
      ),
    10,
  );
  const mirrorPushMs = Number.parseInt(
    process.env.CLAWVERSE_RING_MIRROR_PUSH_MS
      || String(
        typeof fromFile?.mirrorPushMs === 'number'
          ? fromFile.mirrorPushMs
          : defaults.mirrorPushMs,
      ),
    10,
  );
  const peerTtlMs = Number.parseInt(
    process.env.CLAWVERSE_RING_PEER_TTL_MS
      || String(
        typeof fromFile?.peerTtlMs === 'number'
          ? fromFile.peerTtlMs
          : defaults.peerTtlMs,
      ),
    10,
  );

  return {
    topics,
    selfBaseUrl: (process.env.CLAWVERSE_RING_SELF_URL || fromFile?.selfBaseUrl || '').trim() || null,
    peerTtlMs: Number.isFinite(peerTtlMs) ? peerTtlMs : defaults.peerTtlMs,
    mirrorPollMs: Number.isFinite(mirrorPollMs) ? mirrorPollMs : defaults.mirrorPollMs,
    mirrorSources: envSources.length > 0 ? envSources : fileSources,
    mirrorPushMs: Number.isFinite(mirrorPushMs) ? mirrorPushMs : defaults.mirrorPushMs,
    mirrorTargets: envTargets.length > 0 ? envTargets : fileTargets,
  };
}
