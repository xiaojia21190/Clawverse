import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHardwareHash,
  generateDNA,
  generateDNAFromHashes,
  dnaToName,
} from '../src/dna.js';

const METRICS = {
  hostname: 'test-host',
  cpuModel: 'Test CPU @ 3.0GHz',
  cpuCores: 8,
  totalMemMB: 16384,
  cpuUsage: 25,
  memUsage: 50,
  diskUsage: 30,
  uptime: 3600,
};

test('computeHardwareHash returns stable hex string', () => {
  const h1 = computeHardwareHash(METRICS);
  const h2 = computeHardwareHash(METRICS);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('computeHardwareHash changes with different input', () => {
  const h1 = computeHardwareHash(METRICS);
  const h2 = computeHardwareHash({ ...METRICS, hostname: 'other-host' });
  assert.notEqual(h1, h2);
});

test('generateDNA produces correct archetype for 8 cores', () => {
  const dna = generateDNA(METRICS);
  assert.equal(dna.archetype, 'Artisan'); // 8 cores → Artisan
});

test('generateDNA archetype mapping by core count', () => {
  assert.equal(generateDNA({ ...METRICS, cpuCores: 16 }).archetype, 'Warrior');
  assert.equal(generateDNA({ ...METRICS, cpuCores: 8 }).archetype, 'Artisan');
  assert.equal(generateDNA({ ...METRICS, cpuCores: 4 }).archetype, 'Scholar');
  assert.equal(generateDNA({ ...METRICS, cpuCores: 2 }).archetype, 'Ranger');
});

test('generateDNA returns valid DNA structure', () => {
  const dna = generateDNA(METRICS);
  assert.ok(dna.id);
  assert.ok(dna.archetype);
  assert.ok(dna.persona);
  assert.ok(dna.appearance);
  assert.ok(dna.appearance.form);
  assert.match(dna.appearance.primaryColor, /^#[0-9a-f]{6}$/);
  assert.match(dna.appearance.secondaryColor, /^#[0-9a-f]{6}$/);
});

test('generateDNA form matches archetype', () => {
  assert.equal(generateDNA({ ...METRICS, cpuCores: 16 }).appearance.form, 'crab');
  assert.equal(generateDNA({ ...METRICS, cpuCores: 8 }).appearance.form, 'shrimp');
  assert.equal(generateDNA({ ...METRICS, cpuCores: 4 }).appearance.form, 'octopus');
  assert.equal(generateDNA({ ...METRICS, cpuCores: 2 }).appearance.form, 'squid');
});

test('generateDNAFromHashes with soul data', () => {
  const hwHash = computeHardwareHash(METRICS);
  const dna = generateDNAFromHashes(hwHash, METRICS, 'abc123', {
    modelTrait: 'Polymath',
    badges: ['has-soul', '3-skills'],
  });
  assert.equal(dna.modelTrait, 'Polymath');
  assert.deepEqual(dna.badges, ['has-soul', '3-skills']);
});

test('generateDNAFromHashes with different soul hashes produce different IDs', () => {
  const hwHash = computeHardwareHash(METRICS);
  const dna1 = generateDNAFromHashes(hwHash, METRICS, 'soul-A');
  const dna2 = generateDNAFromHashes(hwHash, METRICS, 'soul-B');
  assert.notEqual(dna1.id, dna2.id);
});

test('dnaToName returns a two-word name', () => {
  const dna = generateDNA(METRICS);
  const name = dnaToName(dna);
  const parts = name.split(' ');
  assert.equal(parts.length, 2);
  assert.ok(parts[0].length > 0);
  assert.ok(parts[1].length > 0);
});

test('dnaToName is deterministic', () => {
  const dna = generateDNA(METRICS);
  assert.equal(dnaToName(dna), dnaToName(dna));
});
