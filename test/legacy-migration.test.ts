import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureClubState } from '../src/domain/club-engine.js';
import { signContract } from '../src/domain/contract-engine.js';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { advanceWeek, ensureGameplayState } from '../src/domain/gameplay-engine.js';
import type { PlayerProfile, VersusClub } from '../src/domain/types.js';
import { createVersusClub, createVersusSeason, enrollVersus, processVersusRound, settleVersusSeason, syncVersusProfileWithSeason, versusTotalRounds } from '../src/domain/versus-engine.js';
import { openVersus, startNextVersusSeason } from '../src/services/versus-service.js';
import { JsonPlayerStore } from '../src/storage/json-store.js';

/**
 * Saves written by the previous release: no season stats or notifications, a
 * real-time contract, an old Player market, and Versus clubs on the old grade
 * scale (every club began in grade 1 = Liga A, without `tierVersion`).
 */
const NOW = new Date();
const DAY = 86_400_000;

function legacyClub(club: VersusClub): void {
  delete (club as Partial<VersusClub>).tierVersion;
  club.grade = 1;
  for (const player of club.roster) {
    for (const field of ['cleanSheets', 'ratingSum', 'ratedMatches', 'growth', 'seasonYellowCards'] as const) delete player[field];
  }
}

async function withStore(run: (store: JsonPlayerStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'frs-legacy-'));
  try {
    await run(new JsonPlayerStore(join(directory, 'players.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('a legacy Player save keeps playing: real-time contract, no season stats, old market data', () => {
  const start = new Date('2026-01-05T00:00:00.000Z');
  let profile = ensureClubState(createInitialProfile('legacy-player', 'Legacy', 'FW', start), start, new SeededRandom(1));
  profile = signContract(profile, start, 1);
  for (const field of ['seasonsRemaining', 'seasons', 'startSeason'] as const) delete profile.contract![field];
  profile.contract!.endTime = new Date(start.getTime() + 180 * DAY).toISOString();
  delete profile.seasonStats;
  delete profile.discipline;
  delete profile.clubState!.participants;
  delete profile.clubState!.leagueId;
  profile.market = [{ id: 'old-listing', sellerUserId: 'system', player: profile.clubState!.roster[1], price: 100, status: 'OPEN', createdAt: start.toISOString() }];
  const migrated = ensureGameplayState(profile, start);
  const week = advanceWeek(migrated, new Date(start.getTime() + DAY), new SeededRandom(2));
  assert.ok(week.match);
  assert.equal(week.profile.seasonStats?.season, week.profile.league.season);
  assert.ok(week.profile.clubState!.participants!.length >= 2, 'league participants are rebuilt');
  assert.ok(week.profile.money > profile.money, 'the legacy contract still pays the weekly salary');
});

test('an idle legacy Versus club is placed in Liga E, not in Liga A', async () => {
  await withStore(async (store) => {
    const profile = createVersusClub(createInitialProfile('legacy-idle', 'Legacy Idle', 'MF', NOW), NOW);
    legacyClub(profile.versus!.club);
    await store.save(profile);
    const view = await openVersus(store, 'legacy-idle', NOW);
    assert.equal(view.profile.versus!.club.grade, 5);
    assert.equal(view.profile.versus!.club.tierVersion, 2);
    assert.match(view.profile.versus!.groupCode!, /^PUB-E-/);
    assert.equal(view.season!.grade, 5);
  });
});

function finishedLegacySeason(userIds: string[], start: Date): { profiles: PlayerProfile[] } {
  let members = userIds.map((id) => enrollVersus(createInitialProfile(id, id, 'MF', start), 'MM-PUBLIC-20260101', start));
  for (const member of members) legacyClub(member.versus!.club);
  let season = createVersusSeason('MM-PUBLIC-20260101', members, start, 4);
  for (const club of season.clubs) legacyClub(club);
  season.grade = 1;
  for (let round = 1; round <= versusTotalRounds(season); round += 1) season = processVersusRound(season, round, new Date(season.roundDeadline), new SeededRandom(round));
  season = settleVersusSeason(season, new Date(season.roundDeadline));
  members = members.map((member) => syncVersusProfileWithSeason(member, season, new Date(season.roundDeadline)));
  return { profiles: members };
}

test('a legacy-scale season pays rewards but moves nobody; Next Season restarts the club in Liga E once', async () => {
  await withStore(async (store) => {
    const start = new Date(NOW.getTime() - 8 * DAY);
    const { profiles } = finishedLegacySeason(['legacy-a', 'legacy-b'], start);
    const season = profiles[0].versus!.season!;
    assert.equal(season.state, 'FINISHED');
    assert.equal(season.rewards.every((reward) => !reward.promoted && !reward.relegated && reward.legacyReset), true);
    assert.equal(profiles[0].versus!.history.length, 1, 'season rewards are still paid');
    await store.saveBatch(profiles);

    const finishedView = await openVersus(store, 'legacy-a', NOW);
    assert.equal(finishedView.season!.state, 'FINISHED', 'the finished legacy season stays visible until Next Season');
    const next = await startNextVersusSeason(store, 'legacy-a', NOW);
    assert.equal(next.profile.versus!.club.grade, 5);
    assert.match(next.profile.versus!.groupCode!, /^PUB-E-/);
    assert.equal(next.profile.versus!.club.roster.filter((player) => player.position === 'GK').length >= 2, true);
    const again = await openVersus(store, 'legacy-a', new Date(NOW.getTime() + 60_000));
    assert.equal(again.profile.versus!.club.grade, 5, 'rollover is not applied twice');
  });
});

test('an active legacy public group keeps playing and its members later join the new public league', async () => {
  await withStore(async (store) => {
    const start = new Date(NOW.getTime() - 2.5 * DAY);
    let members = ['legacy-live-a', 'legacy-live-b'].map((id) => enrollVersus(createInitialProfile(id, id, 'FW', start), 'MM-PUBLIC-20260102', start));
    let season = createVersusSeason('MM-PUBLIC-20260102', members, start, 4);
    for (const club of season.clubs) legacyClub(club);
    season = processVersusRound(season, 1, new Date(start.getTime() + DAY), new SeededRandom(5));
    season = processVersusRound(season, 2, new Date(start.getTime() + 2 * DAY), new SeededRandom(6));
    members = members.map((member) => syncVersusProfileWithSeason(member, season, new Date(start.getTime() + 2 * DAY)));
    await store.saveBatch(members);
    const view = await openVersus(store, 'legacy-live-a', NOW);
    assert.equal(view.profile.versus!.groupCode, 'MM-PUBLIC-20260102', 'the running legacy season continues');
    assert.equal(view.season!.state, 'ACTIVE');
    assert.equal(view.season!.currentRound, 3);
  });
});
