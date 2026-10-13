import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialProfile, getRating, playMatch, recoverPlayer, SeededRandom, trainPlayer } from '../src/domain/engine.js';
import { JsonPlayerStore } from '../src/storage/json-store.js';

test('creates a position-aware initial profile', () => {
  const profile = createInitialProfile('user-1', 'Rising Star', 'FW', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(profile.position, 'FW');
  assert.equal(profile.stats.atk, 65);
  assert.equal(profile.money, 1_000);
  assert.equal(getRating(profile) > 0, true);
});

test('training consumes energy and increases ability experience', () => {
  const profile = createInitialProfile('user-2', 'Trainer', 'MF');
  const result = trainPlayer(profile, 'technique', new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(7));
  assert.equal(result.profile.energy, 85);
  assert.equal(result.profile.abilities.technique.exp > 0, true);
  assert.equal(result.statAfter >= result.statBefore, true);
});

test('time recovery restores hp and energy without exceeding caps', () => {
  const profile = createInitialProfile('user-3', 'Recovering', 'DF', new Date('2026-01-01T00:00:00.000Z'));
  profile.hp = 40;
  profile.energy = 20;
  profile.lastActionAt = '2025-12-31T22:00:00.000Z';
  const recovered = recoverPlayer(profile, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(recovered.hp, 44);
  assert.equal(recovered.energy, 40);
});

test('match simulation produces a record, rewards, and league progress', () => {
  const profile = createInitialProfile('user-4', 'Matchday', 'FW');
  const result = playMatch(profile, new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(99));
  assert.equal(result.record.playerRating, getRating(profile));
  assert.equal(result.record.outcome, result.record.playerGoals > result.record.opponentGoals ? 'WIN' : result.record.playerGoals < result.record.opponentGoals ? 'LOSS' : 'DRAW');
  assert.equal(result.profile.energy, 80);
  assert.equal(result.profile.hp, 92);
  assert.equal(result.profile.career.appearances, 1);
  assert.equal(result.profile.league.matchday, 2);
  assert.equal(result.profile.money > profile.money, true);
  assert.equal(result.narrative.length >= 3, true);
  assert.ok(result.record.stats);
  assert.equal(result.record.stats!.possession + result.record.stats!.opponentPossession, 100);
  assert.equal(result.record.stats!.shotsOnTarget <= result.record.stats!.shots, true);
  assert.equal(result.record.stats!.opponentShotsOnTarget <= result.record.stats!.opponentShots, true);
});

test('json store persists profiles atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-discord-'));
  const path = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(path);
    const profile = createInitialProfile('user-5', 'Stored', 'GK');
    await store.save(profile);
    const loaded = await store.get('user-5');
    assert.deepEqual(loaded, profile);
    const raw = await readFile(path, 'utf8');
    assert.match(raw, /user-5/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
