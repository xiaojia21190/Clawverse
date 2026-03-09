import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EconomySystem } from '../src/economy.js';
import { EventEngine } from '../src/events.js';
import { FactionSystem } from '../src/faction.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-faction-'));
  const dbPath = join(root, 'clawverse.db');
  return {
    dbPath,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // SQLite file can stay briefly locked on Windows.
      }
    },
  };
}

function createSocialStub() {
  return {
    getAllRelationships: () => [
      { tier: 'ally', sentiment: 0.8 },
      { tier: 'ally', sentiment: 0.7 },
      { tier: 'ally', sentiment: 0.9 },
    ],
    getRelationship: (peerId: string) => {
      if (peerId === 'peer-a2') return { tier: 'friend', sentiment: 0.5 };
      if (peerId === 'peer-b') return { tier: 'nemesis', sentiment: -0.8 };
      return undefined;
    },
  };
}


test('createFaction populates strategic state and deterministic agenda', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const created = faction.createFaction('Market League', 'founder-1', 'Trade routes forever');
    assert.ok(created);
    assert.equal(created?.strategic.agenda, 'trade');
    assert.ok(created!.strategic.prosperity >= 0 && created!.strategic.prosperity <= 100);
    assert.ok(created!.strategic.influence >= 0 && created!.strategic.influence <= 100);
    assert.ok(['fragile', 'rising', 'dominant', 'splintering'].includes(created!.strategic.stage));

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('war and peace refresh faction pressure and stage', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Grow beyond the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);

    faction.checkWarConditions();
    const war = faction.getActiveWars()[0];
    assert.ok(war);

    const pressureDuringWar = faction.getFaction(alpha!.id)?.strategic.pressure ?? 0;
    assert.ok(pressureDuringWar > 0);

    economy.award('reputation', 20);
    assert.equal(faction.declarePeace(war.id, 'founder-a'), true);

    const pressureAfterPeace = faction.getFaction(alpha!.id)?.strategic.pressure ?? 0;
    assert.ok(pressureAfterPeace < pressureDuringWar);
    assert.equal(faction.getActiveWars().length, 0);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('refreshStrategicState emits faction_ascendant when a faction becomes dominant', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const created = faction.createFaction('Market League', 'founder-1', 'Trade routes forever');
    assert.ok(created);
    assert.equal(faction.joinFaction(created!.id, 'peer-a2'), true);

    const before = faction.getFaction(created!.id);
    assert.equal(before?.strategic.stage, 'rising');

    economy.award('reputation', 40);
    faction.refreshStrategicState();

    const after = faction.getFaction(created!.id);
    assert.equal(after?.strategic.stage, 'dominant');

    const eventTypes = events.getPending().map((event) => event.type);
    assert.ok(eventTypes.includes('faction_ascendant'));

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('refreshStrategicState emits faction_splintering when pressure overwhelms a faction', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const social = {
      getAllRelationships: () => [
        { tier: 'ally', sentiment: 0.8 },
        { tier: 'ally', sentiment: 0.7 },
        { tier: 'ally', sentiment: 0.9 },
      ],
      getRelationship: (peerId: string) => {
        if (peerId === 'peer-a2') return { tier: 'friend', sentiment: 0.5 };
        if (peerId === 'peer-b' || peerId === 'peer-c') return { tier: 'nemesis', sentiment: -0.8 };
        return undefined;
      },
    };
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(social as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Frontier', 'founder-a', 'Expand beyond the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    const gamma = faction.createFaction('Gamma Bastion', 'peer-c', 'Resist the storm');
    assert.ok(alpha);
    assert.ok(beta);
    assert.ok(gamma);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);

    const before = faction.getFaction(alpha!.id);
    assert.equal(before?.strategic.stage, 'rising');

    assert.equal(economy.consume('compute', 80), true);
    assert.equal(economy.consume('storage', 20), true);
    faction.checkWarConditions();
    faction.refreshStrategicState();

    const after = faction.getFaction(alpha!.id);
    assert.equal(after?.strategic.stage, 'splintering');

    const eventTypes = events.getPending().map((event) => event.type);
    assert.ok(eventTypes.includes('faction_splintering'));

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('formAlliance creates alliance and emits faction_alliance', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);

    economy.award('reputation', 12);
    const alliance = faction.formAlliance(beta!.id, 'founder-a');

    assert.ok(alliance);
    assert.equal(alliance?.status, 'active');
    assert.ok(alliance?.expiresAt);
    assert.equal(alliance?.lastRenewedAt, alliance?.formedAt ?? null);
    assert.equal(faction.getActiveAlliances().length, 1);
    assert.ok(events.getPending().some((event) => event.type === 'faction_alliance'));

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('renewAlliance extends expiry and emits renewed faction_alliance', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);

    economy.award('reputation', 24);
    const alliance = faction.formAlliance(beta!.id, 'founder-a');
    assert.ok(alliance);

    alliance!.expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const renewed = faction.renewAlliance(alliance!.id, 'founder-a');

    assert.ok(renewed);
    assert.ok(Date.parse(renewed!.expiresAt) > Date.now() + 5 * 60 * 60 * 1000);
    assert.ok(renewed!.lastRenewedAt);

    const renewedEvent = events.getPending().find((event) => event.type === 'faction_alliance' && event.payload.renewed === true);
    assert.ok(renewedEvent);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('checkWarConditions does not declare war between allied factions', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);

    economy.award('reputation', 12);
    assert.ok(faction.formAlliance(beta!.id, 'founder-a'));

    faction.checkWarConditions();
    assert.equal(faction.getActiveWars().length, 0);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('reviewAlliances ends expired alliances', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);

    economy.award('reputation', 12);
    const alliance = faction.formAlliance(beta!.id, 'founder-a');
    assert.ok(alliance);

    alliance!.expiresAt = new Date(Date.now() - 60_000).toISOString();
    const ended = faction.reviewAlliances();
    assert.equal(ended, 1);
    assert.equal(faction.getActiveAlliances().length, 0);

    const betrayal = events.getPending().find((event) => event.type === 'betrayal');
    assert.equal(betrayal?.payload.reason, 'expired');

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('reviewAlliances ends unstable treaties and emits betrayal', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Frontier', 'founder-a', 'Expand beyond the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);

    economy.award('reputation', 12);
    const alliance = faction.formAlliance(beta!.id, 'founder-a');
    assert.ok(alliance);

    const alphaState = faction.getFaction(alpha!.id);
    assert.ok(alphaState);
    alphaState!.strategic = {
      ...alphaState!.strategic,
      stage: 'splintering',
      pressure: 82,
      cohesion: 28,
    };

    const ended = faction.reviewAlliances();
    assert.equal(ended, 1);
    assert.equal(faction.getActiveAlliances().length, 0);

    const eventTypes = events.getPending().map((event) => event.type);
    assert.ok(eventTypes.includes('betrayal'));

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('breakAlliance ends an active treaty and records the initiator', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);

    economy.award('reputation', 12);
    const alliance = faction.formAlliance(beta!.id, 'founder-a');
    assert.ok(alliance);

    const broken = faction.breakAlliance(alliance!.id, 'founder-a');
    assert.ok(broken);
    assert.equal(broken?.status, 'ended');
    assert.equal(faction.getActiveAlliances().length, 0);

    const betrayal = events.getPending().find((event) => event.type === 'betrayal' && event.payload.reason === 'strategic_withdrawal');
    assert.equal(betrayal?.payload.initiatorFactionId, alpha?.id);
    assert.equal(betrayal?.payload.initiatorFaction, alpha?.name);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('vassalizeFaction creates vassalage and emits faction_vassalage', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a3'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a4'), true);

    economy.award('reputation', 6);
    faction.refreshStrategicState();

    const vassalage = faction.vassalizeFaction(beta!.id, 'founder-a');
    assert.ok(vassalage);
    assert.equal(vassalage?.status, 'active');
    assert.equal(vassalage?.overlordId, alpha!.id);
    assert.equal(vassalage?.vassalId, beta!.id);
    assert.equal(faction.getActiveVassalages().length, 1);

    const overlord = faction.getFaction(alpha!.id);
    const vassal = faction.getFaction(beta!.id);
    assert.ok(overlord);
    assert.ok(vassal);
    assert.ok((overlord?.strategic.influence ?? 0) > (vassal?.strategic.influence ?? 0));
    assert.notEqual(vassal?.strategic.stage, 'dominant');

    const vassalEvent = events.getPending().find((event) => event.type === 'faction_vassalage');
    assert.equal(vassalEvent?.payload.overlordId, alpha!.id);
    assert.equal(vassalEvent?.payload.vassalId, beta!.id);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('checkWarConditions does not declare war between overlord and vassal', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a3'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a4'), true);

    economy.award('reputation', 6);
    faction.refreshStrategicState();

    assert.ok(faction.vassalizeFaction(beta!.id, 'founder-a'));

    faction.checkWarConditions();
    assert.equal(faction.getActiveWars().length, 0);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('reviewVassalages ends ascendant vassalage and emits betrayal', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a3'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a4'), true);

    economy.award('reputation', 6);
    faction.refreshStrategicState();

    const vassalage = faction.vassalizeFaction(beta!.id, 'founder-a');
    assert.ok(vassalage);

    const betaState = faction.getFaction(beta!.id);
    assert.ok(betaState);
    betaState!.strategic = {
      ...betaState!.strategic,
      stage: 'dominant',
      influence: 80,
      pressure: 18,
      cohesion: 74,
    };

    const ended = faction.reviewVassalages();
    assert.equal(ended, 1);
    assert.equal(faction.getActiveVassalages().length, 0);

    const betrayal = events.getPending().find((event) => event.type === 'betrayal' && event.payload.relation === 'vassalage');
    assert.equal(betrayal?.payload.reason, 'vassal_ascendant');
    assert.equal(betrayal?.payload.vassalageId, vassalage?.id);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});
test('leaveFaction ends vassalage when a faction disappears', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a3'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a4'), true);

    economy.award('reputation', 6);
    faction.refreshStrategicState();

    const vassalage = faction.vassalizeFaction(beta!.id, 'founder-a');
    assert.ok(vassalage);
    assert.equal(faction.getActiveVassalages().length, 1);

    assert.equal(faction.leaveFaction('peer-b'), true);
    assert.equal(faction.getFaction(beta!.id), undefined);
    assert.equal(faction.getActiveVassalages().length, 0);

    const ended = faction.getVassalages().find((entry) => entry.id === vassalage!.id);
    assert.equal(ended?.status, 'ended');
    assert.equal(typeof ended?.endedAt, 'string');

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});


test('refreshStrategicState collects tribute for an active vassalage', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a3'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a4'), true);

    economy.award('reputation', 6);
    faction.refreshStrategicState();
    assert.ok(faction.vassalizeFaction(beta!.id, 'founder-a'));
    assert.equal(faction.getTributes().length, 0);

    faction.refreshStrategicState();
    const tributes = faction.getTributes();
    assert.equal(tributes.length, 1);
    assert.equal(tributes[0]?.overlordId, alpha!.id);
    assert.equal(tributes[0]?.vassalId, beta!.id);
    assert.ok((tributes[0]?.amount ?? 0) > 0);

    const tributeEvent = events.getPending().find((event) => event.type === 'faction_tribute');
    assert.equal(tributeEvent?.payload.overlordId, alpha!.id);
    assert.equal(tributeEvent?.payload.vassalId, beta!.id);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});

test('refreshStrategicState does not duplicate tribute before the levy interval', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const economy = new EconomySystem({ dbPath });
    const events = new EventEngine({ dbPath });
    const faction = new FactionSystem(createSocialStub() as any, economy, events, { dbPath });

    const alpha = faction.createFaction('Alpha Front', 'founder-a', 'Expand the frontier');
    const beta = faction.createFaction('Beta Hold', 'peer-b', 'Hold the line');
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a2'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a3'), true);
    assert.equal(faction.joinFaction(alpha!.id, 'peer-a4'), true);

    economy.award('reputation', 6);
    faction.refreshStrategicState();
    assert.ok(faction.vassalizeFaction(beta!.id, 'founder-a'));

    faction.refreshStrategicState();
    assert.equal(faction.getTributes().length, 1);

    faction.refreshStrategicState();
    assert.equal(faction.getTributes().length, 1);

    await faction.destroy();
    await events.destroy();
    await economy.destroy();
  } finally {
    cleanup();
  }
});