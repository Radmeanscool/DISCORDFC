import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { acceptJobOffer, advanceCoachRound, assignCoachExp, createCoachCareer, generateJobOffer, getCoachNextRoundAt, rebirthCoach, retireCoach } from '../src/domain/coach-career-engine.js';
import { ensureClubState, playClubMatch, projectCoachLeagueStandings } from '../src/domain/club-engine.js';
import { playChampionsLeague, startChampionsLeague } from '../src/domain/competition-engine.js';

test('Coach career has six abilities, round settlement, and manual EXP', () => {
  let profile = ensureClubState(createInitialProfile('coach-1', 'Coach One', 'MF'), new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(1));
  profile = createCoachCareer(profile, 'Coach One', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(Object.keys(profile.coach!.abilities).length, 6);
  assert.equal(profile.coach!.approval, 50);
  assert.ok(profile.coachClubState);
  const playerSeasonBefore = profile.league.season;
  const round = advanceCoachRound(profile, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(8));
  assert.equal(typeof round.match.halftime.homeGoals, 'number');
  assert.equal(round.profile.coach!.totalExp, round.coachExp);
  assert.equal(round.profile.league.season, playerSeasonBefore);
  assert.equal(round.profile.coachClubState!.fixtures.filter((fixture) => fixture.played).length, 1);
  const allocationTime = new Date('2026-01-03T00:00:00.000Z');
  const allocated = assignCoachExp(round.profile, { formation: Math.min(50, round.profile.coach!.unassignedExp) }, allocationTime);
  assert.equal(allocated.profile.coach!.unassignedExp, round.profile.coach!.unassignedExp - allocated.allocated);
  assert.equal(allocated.profile.updatedAt, allocationTime.toISOString());
});

test('Coach decisions are classified and block the next round until resolved', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const profile = createCoachCareer(ensureClubState(createInitialProfile('coach-event-classification', 'Coach Event', 'MF'), start, new SeededRandom(1)), 'Coach Event', start);
  let eventRound;
  for (let seed = 1; seed <= 100 && !eventRound; seed += 1) {
    const candidate = advanceCoachRound(profile, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(seed));
    if (candidate.event) eventRound = candidate;
  }
  assert.ok(eventRound?.event);
  assert.ok(eventRound.event.family);
  assert.equal(eventRound.event.trigger, 'ROUND_SETTLEMENT');
  assert.equal(eventRound.event.blocking, true);
  assert.throws(() => advanceCoachRound(eventRound.profile, new Date('2026-01-03T00:00:00.000Z'), new SeededRandom(101)), /management decision/);
});

test('Coach next-round fallback is deterministic from the supplied reference time', () => {
  const profile = createCoachCareer(ensureClubState(createInitialProfile('coach-clock', 'Coach Clock', 'MF'), new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(2)), 'Coach Clock', new Date('2026-01-01T00:00:00.000Z'));
  profile.coachClubState!.fixtures = [];
  const reference = new Date('2026-04-01T12:00:00.000Z');
  assert.equal(getCoachNextRoundAt(profile, reference)?.toISOString(), '2026-04-08T12:00:00.000Z');
});

test('Coach league projection completes non-user standings after the user schedule', () => {
  let profile = createCoachCareer(ensureClubState(createInitialProfile('coach-league', 'Coach League', 'DF')), 'Coach League');
  const fixtureCount = profile.coachClubState!.fixtures.length;
  let cursor = profile;
  let index = 0;
  while (cursor.coachClubState!.fixtures.some((fixture) => !fixture.played)) {
    cursor = playClubMatch(cursor, new Date(2026, 0, 2 + index), new SeededRandom(100 + index), 'coachClubState').profile;
    index += 1;
  }
  projectCoachLeagueStandings(cursor.coachClubState!);
  assert.ok(cursor.coachClubState!.standings.every((standing) => standing.played === fixtureCount));
  assert.ok(cursor.coachClubState!.standings.every((standing) => standing.wins + standing.draws + standing.losses === fixtureCount));
});

test('Coach Champions League uses an isolated Coach aggregate and season', () => {
  let profile = createCoachCareer(ensureClubState(createInitialProfile('coach-cl', 'Coach CL', 'MF')), 'Coach CL');
  profile.coachClubState!.championsLeagueQualified = true;
  profile.clubState!.championsLeagueQualified = true;
  const playerLeagueSeason = profile.league.season;
  const playerStarted = startChampionsLeague(profile, new Date('2026-01-01T00:00:00.000Z'), 'PLAYER');
  const coachStarted = startChampionsLeague(playerStarted, new Date('2026-01-01T00:00:00.000Z'), 'COACH');
  assert.equal(coachStarted.championsLeague!.season, playerLeagueSeason);
  assert.equal(coachStarted.coach!.championsLeague!.season, coachStarted.coach!.season);
  assert.notEqual(coachStarted.championsLeague, coachStarted.coach!.championsLeague);
  const playerAssets = coachStarted.clubState!.assets;
  const playerStats = coachStarted.stats;
  // Rounds are spread over the league calendar: the first one opens after league matchday 8.
  assert.throws(() => playChampionsLeague(coachStarted, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(17), 'COACH'), /dibuka setelah matchday liga 8/);
  for (const fixture of coachStarted.coachClubState!.fixtures.slice(0, 8)) fixture.played = true;
  const played = playChampionsLeague(coachStarted, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(17), 'COACH');
  assert.ok(played.profile.coach!.championsLeague);
  assert.equal(played.profile.league.season, playerLeagueSeason);
  assert.deepEqual(played.profile.stats, playerStats);
  assert.equal(played.profile.clubState!.assets, playerAssets);
  assert.equal(played.profile.coach!.championsLeague!.status, played.status);
  assert.ok(played.profile.coachClubState!.assets >= coachStarted.coachClubState!.assets);
});

test('Coach job acceptance is deterministic with the same seeded RNG', () => {
  const base = createCoachCareer(ensureClubState(createInitialProfile('coach-deterministic', 'Coach Deterministic', 'MF'), new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(21)), 'Coach Deterministic', new Date('2026-01-01T00:00:00.000Z'));
  const generated = generateJobOffer(base, new SeededRandom(22));
  const now = new Date('2026-02-01T00:00:00.000Z');
  const first = acceptJobOffer(generated.profile, generated.offer.id, now, new SeededRandom(23));
  const second = acceptJobOffer(generated.profile, generated.offer.id, now, new SeededRandom(23));
  assert.deepEqual(first, second);
});

test('Coach rebirth preserves seeded rebuilt-club determinism', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  let profile = createCoachCareer(createInitialProfile('coach-rebirth-seeded', 'Seeded Rebirth', 'FW'), 'Seeded Rebirth', start, new SeededRandom(4));
  profile = retireCoach(profile, new Date('2026-02-01T00:00:00.000Z'));
  const first = rebirthCoach(profile, new Date('2026-02-02T00:00:00.000Z'), new SeededRandom(31));
  const second = rebirthCoach(profile, new Date('2026-02-02T00:00:00.000Z'), new SeededRandom(31));
  assert.deepEqual(first.coachClubState?.roster, second.coachClubState?.roster);
  assert.deepEqual(first.coachClubState?.fixtures, second.coachClubState?.fixtures);
});

test('Coach job, retirement, and rebirth preserve Player state while changing Coach state', () => {
  let profile = createCoachCareer(ensureClubState(createInitialProfile('coach-2', 'Coach Two', 'FW')), 'Coach Two');
  const playerClub = profile.club;
  const playerLeagueSeason = profile.league.season;
  const generated = generateJobOffer(profile, new SeededRandom(12));
  const accepted = acceptJobOffer(generated.profile, generated.offer.id, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(accepted.club, playerClub);
  assert.equal(accepted.coachClubState!.name, generated.offer.clubName);
  assert.equal(accepted.league.season, playerLeagueSeason);
  // Switching clubs before the first round keeps the season; leaving mid-season starts the next one.
  assert.equal(accepted.coach!.season, 1);
  const midSeason = advanceCoachRound(accepted, new Date('2026-02-02T00:00:00.000Z'), new SeededRandom(13)).profile;
  const secondOffer = generateJobOffer(midSeason, new SeededRandom(14), new Date('2026-02-03T00:00:00.000Z'));
  const moved = acceptJobOffer(secondOffer.profile, secondOffer.offer.id, new Date('2026-02-03T00:00:00.000Z'));
  assert.equal(moved.coach!.season, 2);
  assert.equal(moved.coachClubState!.fixtures.every((fixture) => !fixture.played), true);
  const retired = retireCoach(accepted, new Date('2026-03-01T00:00:00.000Z'));
  assert.equal(retired.coach!.status, 'RETIRED');
  const reborn = rebirthCoach(retired, new Date('2026-03-02T00:00:00.000Z'));
  assert.equal(reborn.coach!.status, 'EMPLOYED');
  assert.equal(reborn.coach!.season, 2);
  assert.equal(reborn.club, playerClub);
  assert.equal(reborn.league.season, playerLeagueSeason);
  assert.equal(reborn.coachClubState!.name, generated.offer.clubName);
});
