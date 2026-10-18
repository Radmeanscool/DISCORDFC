import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { assignVersusMatchmaking, createVersusSeason, enrollVersus, getVersusStandings, processVersusRound, queueVersusMatchmaking, settleVersusSeason, submitVersusLineup, syncVersusProfileWithSeason, versusLeagueCode } from '../src/domain/versus-engine.js';
import type { PlayerProfile } from '../src/domain/types.js';

function makeMembers(): PlayerProfile[] {
  return [
    enrollVersus(createInitialProfile('versus-a', 'Versus A', 'FW'), 'GROUP-42', new Date('2026-01-01T00:00:00.000Z')),
    enrollVersus(createInitialProfile('versus-b', 'Versus B', 'MF'), 'GROUP-42', new Date('2026-01-01T00:00:00.000Z'))
  ];
}

test('Versus matchmaking queues and assigns a system-managed team without mode leakage', () => {
  const initial = createInitialProfile('versus-identity', 'Identity Player', 'MF');
  const queued = queueVersusMatchmaking(initial, 'public', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(queued.versus?.status, 'IDLE');
  assert.equal(queued.versus?.matchmaking?.status, 'QUEUED');
  assert.equal(queued.versus?.matchmaking?.queueKey, 'public');
  const matched = assignVersusMatchmaking(queued, 'MM-PUBLIC-20260101', new Date('2026-01-01T00:00:05.000Z'));
  assert.equal(matched.versus?.status, 'ENROLLED');
  assert.equal(matched.versus?.matchmaking?.status, 'MATCHED');
  assert.equal(matched.versus?.matchmaking?.groupCode, 'MM-PUBLIC-20260101');
  assert.equal(matched.clubState, undefined);
  assert.equal(matched.coach, undefined);
  assert.equal(initial.versus, undefined);
  assert.throws(() => queueVersusMatchmaking(createInitialProfile('bad-queue', 'Bad Queue', 'MF'), 'public queue'), /queue tidak valid/);
});

test('Versus creates an isolated multi-club home-away season', () => {
  const [first, second] = makeMembers();
  const season = createVersusSeason('GROUP-42', [first, second], new Date('2026-01-01T00:00:00.000Z'), 6);
  assert.equal(season.clubs.length, 6);
  assert.equal(season.battles.length, 6 * 5);
  assert.equal(season.battles.filter((battle) => battle.roundId === 1).length, 3);
  assert.equal(season.clubs.some((club) => club.id === first.versus!.clubId && club.id !== first.club), true);
  assert.equal(first.coach, undefined);
  assert.equal(first.clubState, undefined);
});

test('Versus displays letter leagues and marks champion and runner-up promotion targets', () => {
  assert.equal(versusLeagueCode(0), 'S');
  assert.equal(versusLeagueCode(1), 'A');
  assert.equal(versusLeagueCode(2), 'B');
  const [first, second] = makeMembers();
  let season = createVersusSeason('GROUP-42', [first, second], new Date('2026-01-01T00:00:00.000Z'), 4);
  const totalRounds = 2 * (season.clubs.length - 1);
  for (let round = 1; round <= totalRounds; round += 1) season = processVersusRound(season, round, new Date(`2026-01-${String(round + 1).padStart(2, '0')}T00:00:00.000Z`), new SeededRandom(round));
  const finished = settleVersusSeason(season, new Date('2026-02-01T00:00:00.000Z'));
  const topTwo = finished.rewards.filter((reward) => reward.rank <= 2);
  assert.equal(topTwo.length, 2);
  // New clubs start in the lowest tier (Liga E); rank 1–2 move up to Liga D and E has no relegation.
  assert.equal(season.grade, 5);
  assert.equal(topTwo.every((reward) => reward.promoted && reward.fromLeague === 'E' && reward.promotedToLeague === 'D'), true);
  assert.equal(finished.rewards.some((reward) => reward.relegated), false);
});

test('Versus round settles all scheduled battles with two-half stats and standings', () => {
  const [first, second] = makeMembers();
  const season = createVersusSeason('GROUP-42', [first, second], new Date('2026-01-01T00:00:00.000Z'), 4);
  const next = processVersusRound(season, 1, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(17));
  assert.equal(next.currentRound, 2);
  assert.equal(next.battles.filter((battle) => battle.roundId === 1 && battle.state === 'PUBLISHED').length, 2);
  const userBattle = next.battles.find((battle) => battle.roundId === 1 && (battle.homeClubId === first.versus!.clubId || battle.awayClubId === first.versus!.clubId));
  assert.ok(userBattle?.settlement);
  assert.equal(typeof userBattle!.settlement!.halftime.homeGoals, 'number');
  assert.equal(userBattle!.settlement!.rulesetVersion.startsWith('versus-recovery-inferred'), true);
  assert.equal(getVersusStandings(next).every((standing) => standing.played === 1), true);
  assert.throws(() => processVersusRound(next, 1, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(17)), /Round Versus berikutnya adalah 2/);
});

test('Versus submission locks a legal owner lineup and rejects stale/deadline writes', () => {
  const [first, second] = makeMembers();
  const start = new Date('2026-01-01T00:00:00.000Z');
  const season = createVersusSeason('GROUP-42', [first, second], start, 4);
  const club = season.clubs.find((item) => item.ownerId === first.userId)!;
  const battle = season.battles.find((item) => item.roundId === 1 && (item.homeClubId === club.id || item.awayClubId === club.id))!;
  const lineup = ['p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9', 'p10', 'p14', 'p15'].map((id) => `${club.id}:${id}`);
  const submitted = submitVersusLineup(season, battle.id, first.userId, lineup, [`${club.id}:p6`], lineup[0], '4-4-2', 'tiki-taka', club.rosterVersion, new Date('2026-01-01T12:00:00.000Z'));
  const submittedBattle = submitted.battles.find((item) => item.id === battle.id)!;
  const stored = submittedBattle.homeClubId === club.id ? submittedBattle.homeSubmission : submittedBattle.awaySubmission;
  assert.equal(stored?.ownerId, first.userId);
  assert.equal(stored?.lineup.length, 11);
  assert.equal(stored?.substitutes.length, 1);
  assert.equal(stored?.formation, '4-4-2');
  assert.equal(stored?.tactic, 'tiki-taka');
  assert.equal(season.battles.find((item) => item.id === battle.id)?.homeSubmission, undefined);
  assert.throws(() => submitVersusLineup(season, battle.id, second.userId, lineup, [], lineup[0], '4-4-2', 'balanced', club.rosterVersion, new Date('2026-01-01T12:00:00.000Z')), /bukan pemilik/);
  assert.throws(() => submitVersusLineup(season, battle.id, first.userId, lineup, [], lineup[0], '4-4-2', 'balanced', club.rosterVersion + 1, new Date('2026-01-01T12:00:00.000Z')), /roster berubah/);
  assert.throws(() => submitVersusLineup(season, battle.id, first.userId, lineup, [], lineup[0], '4-4-2', 'balanced', club.rosterVersion, new Date('2026-01-02T00:00:00.000Z')), /melewati deadline/);
});

test('Versus standings use a stable deterministic tie-breaker', () => {
  const [first, second] = makeMembers();
  const season = createVersusSeason('GROUP-42', [first, second], new Date('2026-01-01T00:00:00.000Z'), 4);
  for (const club of season.clubs) {
    club.wins = 1;
    club.draws = 0;
    club.losses = 1;
    club.goalsFor = 2;
    club.goalsAgainst = 1;
  }
  const expected = [...season.clubs].map((club) => club.id).sort();
  const standings = getVersusStandings(season);
  assert.deepEqual(standings.map((standing) => standing.clubId), expected);
  assert.deepEqual(getVersusStandings(season), standings);
});

test('Versus season rewards are isolated and sync is idempotent', () => {
  let members = makeMembers();
  let season = createVersusSeason('GROUP-42', members, new Date('2026-01-01T00:00:00.000Z'), 4);
  const totalRounds = 2 * (season.clubs.length - 1);
  for (let round = 1; round <= totalRounds; round += 1) season = processVersusRound(season, round, new Date(`2026-01-${String(round + 1).padStart(2, '0')}T00:00:00.000Z`), new SeededRandom(round));
  const finished = settleVersusSeason(season, new Date('2026-02-01T00:00:00.000Z'));
  members = members.map((profile) => syncVersusProfileWithSeason(profile, finished, new Date('2026-02-01T00:00:00.000Z')));
  assert.equal(finished.state, 'FINISHED');
  assert.equal(finished.rewards.length, 4);
  for (const member of members) {
    assert.equal(member.versus!.status, 'GAMEOVER');
    assert.equal(member.versus!.history.length, 1);
    const moneyAfterFirstSync = member.versus!.versusMoney;
    const again = syncVersusProfileWithSeason(member, finished, new Date('2026-02-01T00:00:00.000Z'));
    assert.equal(again.versus!.history.length, 1);
    assert.equal(again.versus!.versusMoney, moneyAfterFirstSync);
    assert.equal(again.money, member.money);
    assert.ok(member.versus!.ledger && member.versus!.ledger.length >= totalRounds * 2 + 2);
    assert.equal(new Set(member.versus!.ledger!.map((entry) => entry.id)).size, member.versus!.ledger!.length);
    assert.equal(again.versus!.ledger!.length, member.versus!.ledger!.length);
  }
});
