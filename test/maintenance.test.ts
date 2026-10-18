import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialProfile } from '../src/domain/engine.js';
import { signContract } from '../src/domain/contract-engine.js';
import { runMaintenance, runVersusMaintenance } from '../src/jobs/maintenance.js';
import { enrollVersus, createVersusSeason, syncVersusProfileWithSeason } from '../src/domain/versus-engine.js';
import { JsonPlayerStore } from '../src/storage/json-store.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('maintenance applies recovery and legacy contract expiry but leaves game-time contracts alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-maintenance-'));
  const file = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(file);
    let profile = createInitialProfile('maintenance-1', 'Maintenance', 'MF', new Date('2026-01-01T00:00:00.000Z'));
    profile = signContract(profile, new Date('2026-01-01T00:00:00.000Z'), 1);
    profile.hp = 40;
    profile.energy = 20;
    profile.lastActionAt = '2026-01-01T00:00:00.000Z';
    let legacy = createInitialProfile('maintenance-legacy', 'Legacy', 'DF', new Date('2026-01-01T00:00:00.000Z'));
    legacy = signContract(legacy, new Date('2026-01-01T00:00:00.000Z'), 1);
    delete legacy.contract!.seasonsRemaining;
    legacy.contract!.endTime = '2026-01-02T00:00:00.000Z';
    await store.saveBatch([profile, legacy]);
    const count = await runMaintenance(store, new Date('2026-01-03T00:00:00.000Z'));
    const updated = await store.get(profile.userId);
    assert.equal(count, 2);
    assert.equal(updated!.hp > 40, true);
    assert.equal(updated!.energy > 20, true);
    assert.equal(Object.hasOwn(updated ?? {}, 'event'), false);
    assert.equal(updated?.contract?.state, 'ACTIVE');
    assert.equal((await store.get(legacy.userId))?.contract?.state, 'EXPIRED');
    assert.equal((await readFile(file, 'utf8')).length > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('maintenance skips just-saved profiles and never overwrites a concurrent player save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-maintenance-race-'));
  const file = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(file);
    const now = new Date('2026-01-03T00:00:00.000Z');
    const recent = createInitialProfile('maintenance-recent', 'Recent', 'MF', new Date('2026-01-01T00:00:00.000Z'));
    recent.hp = 10;
    recent.lastActionAt = '2026-01-01T00:00:00.000Z';
    recent.updatedAt = new Date(now.getTime() - 30_000).toISOString();
    await store.save(recent);
    await runMaintenance(store, now);
    assert.equal((await store.get(recent.userId))?.hp, 10, 'a profile saved 30s ago is left for the next tick');

    const racing = createInitialProfile('maintenance-race', 'Race', 'FW', new Date('2026-01-01T00:00:00.000Z'));
    racing.hp = 10;
    racing.lastActionAt = '2026-01-01T00:00:00.000Z';
    await store.save(racing);
    // The player saves between maintenance's read and write.
    const realAll = store.all.bind(store);
    store.all = async () => {
      const snapshot = await realAll();
      const fresh = await store.get(racing.userId);
      fresh!.money = 4_242;
      await store.save(fresh!);
      return snapshot;
    };
    await runMaintenance(store, now);
    store.all = realAll;
    assert.equal((await store.get(racing.userId))?.money, 4_242, 'the player save wins over the stale maintenance copy');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Versus maintenance settles a due round without user interaction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-versus-round-maintenance-'));
  const file = join(directory, 'players.json');
  try {
    const started = new Date('2026-01-01T00:00:00.000Z');
    const members = [
      enrollVersus(createInitialProfile('maintenance-round-a', 'Round A', 'FW'), 'ROUND-MAINT-42', started),
      enrollVersus(createInitialProfile('maintenance-round-b', 'Round B', 'MF'), 'ROUND-MAINT-42', started)
    ];
    const season = createVersusSeason('ROUND-MAINT-42', members, started, 4);
    const profiles = members.map((profile) => syncVersusProfileWithSeason(profile, season, started));
    const store = new JsonPlayerStore(file);
    await store.saveBatch(profiles);
    const settled = await runVersusMaintenance(store, new Date('2026-01-02T00:00:00.000Z'));
    const updated = await store.all();
    assert.ok(settled >= 2);
    assert.equal(updated.every((profile) => profile.versus?.season?.currentRound === 2), true);
    assert.equal(updated.every((profile) => profile.versus?.season?.battles.filter((battle) => battle.roundId === 1).every((battle) => battle.state === 'PUBLISHED')), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Versus maintenance settles expired listings without user interaction and opens a fresh cycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-versus-maintenance-'));
  const file = join(directory, 'players.json');
  try {
    const started = new Date('2026-01-01T00:00:00.000Z');
    const members = [
      enrollVersus(createInitialProfile('maintenance-v-a', 'Versus A', 'FW'), 'MAINTENANCE-42', started),
      enrollVersus(createInitialProfile('maintenance-v-b', 'Versus B', 'MF'), 'MAINTENANCE-42', started)
    ];
    const season = createVersusSeason('MAINTENANCE-42', members, started, 4);
    const original = season.market!.listings.map((listing) => listing.id);
    const profiles = members.map((profile) => syncVersusProfileWithSeason(profile, season, started));
    const store = new JsonPlayerStore(file);
    await store.saveBatch(profiles);
    const beforeExpiry = await runVersusMaintenance(store, new Date('2026-01-01T05:59:00.000Z'));
    assert.equal(beforeExpiry, 0);
    const settled = await runVersusMaintenance(store, new Date('2026-01-01T06:01:00.000Z'));
    const updated = await store.all();
    assert.equal(settled, original.length);
    for (const profile of updated) {
      const listings = profile.versus!.season!.market!.listings;
      assert.equal(listings.filter((listing) => original.includes(listing.id)).every((listing) => listing.status === 'EXPIRED'), true);
      assert.ok(listings.some((listing) => listing.status === 'OPEN' && !original.includes(listing.id)), 'a new auction cycle is opened');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
