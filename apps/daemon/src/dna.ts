import crypto from 'node:crypto';
import { DNA, Archetype, ModelTrait, HardwareMetrics } from '@clawverse/types';

const ADJECTIVES = [
  'Swift', 'Ancient', 'Bright', 'Deep', 'Fierce', 'Gentle', 'Hidden', 'Iron',
  'Jade', 'Keen', 'Lone', 'Misty', 'Noble', 'Odd', 'Proud', 'Quiet',
];

const NOUNS = [
  'Tide', 'Stone', 'Wave', 'Claw', 'Shell', 'Reef', 'Depth', 'Current',
  'Drift', 'Echo', 'Foam', 'Gale', 'Haven', 'Isle', 'Kelp', 'Lure',
];

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function archetypeFromCores(cores: number): Archetype {
  if (cores >= 16) return 'Warrior';
  if (cores >= 8) return 'Artisan';
  if (cores >= 4) return 'Scholar';
  return 'Ranger';
}

function formFromArchetype(archetype: Archetype): string {
  const map: Record<Archetype, string> = {
    Warrior: 'crab',
    Artisan: 'shrimp',
    Scholar: 'octopus',
    Ranger: 'squid',
  };
  return map[archetype];
}

function nameFromHash(hash: string): string {
  const ai = parseInt(hash[0], 16) % ADJECTIVES.length;
  const ni = parseInt(hash[1], 16) % NOUNS.length;
  return `${ADJECTIVES[ai]} ${NOUNS[ni]}`;
}

// Compute stable hardware fingerprint — exported so daemon can cache it
export function computeHardwareHash(metrics: HardwareMetrics): string {
  return sha256hex(`${metrics.hostname}:${metrics.cpuModel}:${metrics.cpuCores}`);
}

// Build DNA from pre-computed hashes; call this both at startup and on soul update
export function generateDNAFromHashes(
  hardwareHash: string,
  metrics: HardwareMetrics,
  soulHash: string,
  soulMeta?: { modelTrait?: ModelTrait; badges?: string[] }
): DNA {
  const dnaHash = sha256hex(hardwareHash + soulHash).slice(0, 16);
  const archetype = archetypeFromCores(metrics.cpuCores);

  return {
    id: dnaHash,
    archetype,
    modelTrait: soulMeta?.modelTrait ?? 'Unknown',
    badges: soulMeta?.badges ?? [],
    persona: `${archetype} from ${metrics.hostname}`,
    appearance: {
      form: formFromArchetype(archetype),
      primaryColor: `#${dnaHash.slice(0, 6)}`,
      secondaryColor: `#${dnaHash.slice(6, 12)}`,
      accessories: [],
    },
  };
}

// Convenience wrapper for initial startup (no soul data yet)
export function generateDNA(metrics: HardwareMetrics): DNA {
  const hwHash = computeHardwareHash(metrics);
  return generateDNAFromHashes(hwHash, metrics, '00000000');
}

export function dnaToName(dna: DNA): string {
  return nameFromHash(dna.id);
}
