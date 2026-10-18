import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_BALANCE, assertBalance } from '../src/config/game-balance.js';
import { claimAchievement, formatAchievements, playChampionsLeague, startChampionsLeague, syncAchievements } from '../src/domain/competition-engine.js';
import { advanceContractSeason, getContractStatus, payWeeklySalary, renewContract, signContract } from '../src/domain/contract-engine.js';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { UserRateLimiter } from '../src/discord/rate-limit.js';

test('balance configuration is valid and explicit about provenance', () => {
  assertBalance(GAME_BALANCE);
  assert.equal(GAME_BALANCE.source, 'RECOVERY_INFERRED');
});

test('contracts run in game seasons, renew in the last season, and pay weekly salary', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const profile = createInitialProfile('contract-1', 'Contract', 'FW', now);
  const signed = signContract(profile, now, 2);
  assert.equal(signed.contract?.state, 'ACTIVE');
  assert.equal(signed.contract?.seasonsRemaining, 2);
  // Real time alone never expires a game-time contract.
  assert.equal(getContractStatus(signed, new Date('2030-01-01T00:00:00.000Z'))?.state, 'ACTIVE');
  assert.throws(() => renewContract(signed, now), /masih berlaku 2 season/);

  const paid = structuredClone(signed);
  assert.match(payWeeklySalary(paid, now) ?? '', /Gaji mingguan/);
  assert.equal(paid.money, signed.money + signed.contract!.salary);

  const lastSeason = structuredClone(signed);
  assert.match(advanceContractSeason(lastSeason) ?? '', /tersisa 1 season/);
  const renewed = renewContract(lastSeason, now);
  assert.equal(renewed.contract?.type, 'RENEWAL');
  assert.equal(renewed.contract?.seasonsRemaining, 2);

  const expired = structuredClone(lastSeason);
  assert.match(advanceContractSeason(expired) ?? '', /berakhir/);
  assert.equal(expired.contract?.state, 'EXPIRED');
  assert.equal(payWeeklySalary(expired, now), undefined);

  // Legacy real-time contracts (no season term) keep their old time-based expiry.
  const legacy = structuredClone(signed);
  delete legacy.contract!.seasonsRemaining;
  legacy.contract!.endTime = '2026-01-05T00:00:00.000Z';
  assert.equal(getContractStatus(legacy, new Date('2026-01-06T00:00:00.000Z'))?.state, 'EXPIRED');
});

test('champions league starts only after qualification and can be played', () => {
  let profile = createInitialProfile('champions-1', 'Champion', 'FW');
  assert.throws(() => startChampionsLeague(profile), /belum lolos/);
  profile = profile;
  profile.clubState = {
    id: profile.club,
    name: profile.club,
    level: 2,
    prestige: 180,
    assets: 30_000,
    salaryBudget: 7_000,
    formation: '4-4-2',
    tactic: 'balanced',
    roster: [],
    fixtures: [],
    standings: [],
    nextFixtureAt: new Date().toISOString(),
    championsLeagueQualified: true,
    championsLeagueRound: 1
  };
  const started = startChampionsLeague(profile);
  const result = playChampionsLeague(started, new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(11));
  assert.equal(['ACTIVE', 'ELIMINATED', 'CHAMPION'].includes(result.status), true);
  assert.equal(result.commentary.length, 3);
});

test('achievement sync exposes ready achievement and claim pays reward', () => {
  let profile = createInitialProfile('achievement-1', 'Achiever', 'MF');
  profile.career.appearances = 10;
  profile = syncAchievements(profile);
  assert.match(formatAchievements(profile), /READY/);
  const result = claimAchievement(profile, 'appearances-10');
  assert.equal(result.achievement.claimed, true);
  assert.equal(result.profile.money > profile.money, true);
});

test('rate limiter blocks after configured request count', () => {
  const limiter = new UserRateLimiter(2, 1_000);
  assert.equal(limiter.consume('u', 100), true);
  assert.equal(limiter.consume('u', 200), true);
  assert.equal(limiter.consume('u', 300), false);
  assert.equal(limiter.consume('u', 1_101), true);
});

test('rate limiter isolates operation scopes', () => {
  const limiter = new UserRateLimiter(1, 1_000);
  assert.equal(limiter.consume('u', 100, 'read'), true);
  assert.equal(limiter.consume('u', 200, 'read'), false);
  assert.equal(limiter.consume('u', 200, 'mutation'), true);
  assert.equal(limiter.consume('other', 200, 'read'), true);
});
