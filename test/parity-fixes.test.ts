import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureClubState } from '../src/domain/club-engine.js';
import { advanceCoachRound, createCoachCareer, resolveCoachEvent } from '../src/domain/coach-career-engine.js';
import { createInitialProfile, getRating, recoverPlayer, SeededRandom, trainPlayer } from '../src/domain/engine.js';
import { advanceWeek, assignMatchExpEvenly, createPlayerCareer, rebirthPlayer, retirePlayer } from '../src/domain/gameplay-engine.js';
import { ratingSkillsFor, skillLevelCost } from '../src/domain/player-formulas.js';
import { COACH_ABILITIES, DETAILED_SKILLS, type PlayerProfile, type Position } from '../src/domain/types.js';
import { abilityScore, createVersusSeason, enrollVersus, processVersusRound, rolloverVersusClub, settleVersusSeason, syncVersusProfileWithSeason, versusTierBase, versusTotalRounds } from '../src/domain/versus-engine.js';

const T0 = new Date('2026-01-05T00:00:00.000Z');
const WEEK = 7 * 86_400_000;

test('real-time recovery keeps fractional hours across frequent saves', () => {
  const profile = createInitialProfile('recovery-clock', 'Clock', 'MF', T0);
  profile.hp = 50;
  profile.energy = 10;
  let current = profile;
  // Four saves 15 minutes apart must credit the same hour as one save after 60 minutes.
  for (const minutes of [15, 30, 45, 60]) current = recoverPlayer(current, new Date(T0.getTime() + minutes * 60_000));
  const once = recoverPlayer(profile, new Date(T0.getTime() + 60 * 60_000));
  assert.equal(current.hp, once.hp);
  assert.equal(current.energy, once.energy);
  assert.equal(current.hp, 52);
  assert.equal(current.energy, 20);
});

test('skill cost grows with level and steepens in the elite band', () => {
  assert.ok(skillLevelCost(60) > skillLevelCost(30));
  const below = skillLevelCost(74) - skillLevelCost(73);
  const above = skillLevelCost(80) - skillLevelCost(79);
  assert.ok(above > below * 3, 'levels above 75 cost much more per step');
});

test('regular training is limited to one session per week', () => {
  const profile = createInitialProfile('train-week', 'Trainer', 'FW', T0);
  const first = trainPlayer(profile, 'atk', T0, new SeededRandom(1));
  assert.throws(() => trainPlayer(first.profile, 'def', T0, new SeededRandom(2)), /sudah dilakukan/);
  const nextWeek = { ...first.profile, careerWeek: (first.profile.careerWeek ?? 1) + 1 };
  assert.doesNotThrow(() => trainPlayer(nextWeek, 'def', T0, new SeededRandom(3)));
});

function playOneSeason(profileInput: PlayerProfile, seed: number): PlayerProfile {
  const rng = new SeededRandom(seed);
  let profile = profileInput;
  let now = T0;
  const season = profile.league.season;
  for (let week = 0; week < 70 && profile.league.season === season; week += 1) {
    now = new Date(now.getTime() + WEEK);
    profile = advanceWeek(profile, now, rng).profile;
    if ((profile.unassignedMatchExp ?? 0) > 0) profile = assignMatchExpEvenly(profile, ratingSkillsFor(profile.position), now).profile;
  }
  return profile;
}

function athlete(id: string, position: Position, level: number): PlayerProfile {
  const profile = createPlayerCareer(id, id, position, T0, new SeededRandom(7));
  for (const skill of DETAILED_SKILLS) profile.detailedSkills![skill].level = level;
  return profile;
}

test('personal output follows the position: forwards score, keepers do not', () => {
  const forward = playOneSeason(athlete('season-fw', 'FW', 80), 11);
  const keeper = playOneSeason(athlete('season-gk', 'GK', 80), 11);
  const fw = forward.seasonHistory![0].stats;
  const gk = keeper.seasonHistory![0].stats;
  assert.ok(fw.appearances > 20);
  assert.ok(fw.goals >= 8 && fw.goals <= 45, `forward goals ${fw.goals}`);
  assert.ok(gk.goals <= 1, `keeper goals ${gk.goals}`);
  assert.ok(gk.cleanSheets > 0);
  // The season covered every club fixture and produced a World Footballer verdict.
  assert.equal(forward.seasonHistory![0].played, forward.clubState!.participants!.length * 2 - 2);
  assert.equal(forward.worldFootballer?.season, 1);
});

test('rebirth starts the next generation above a fresh player instead of collapsing the rating', () => {
  const veteran = athlete('rebirth-fw', 'FW', 95);
  veteran.age = 34;
  veteran.careerYear = 19;
  const retired = retirePlayer(veteran, T0).profile;
  const reborn = rebirthPlayer(retired, T0, 'MF').profile;
  const fresh = createInitialProfile('fresh-mf', 'Fresh', 'MF', T0);
  assert.equal(reborn.age, 15);
  assert.equal(reborn.position, 'MF');
  assert.ok(getRating(reborn) > getRating(fresh), 'rebirth bonus lifts the new generation');
  assert.equal(reborn.contract?.state, 'ACTIVE');
  assert.equal(reborn.careerHistory?.length, 1);
});

function coachSeasonPoints(level: number, seed: number): number {
  const rng = new SeededRandom(seed);
  let profile = createCoachCareer(ensureClubState(createInitialProfile(`coach-${level}-${seed}`, 'Coach', 'MF', T0), T0, new SeededRandom(seed)), 'Coach', T0, new SeededRandom(seed));
  for (const ability of COACH_ABILITIES) profile.coach!.abilities[ability].level = level;
  let now = T0;
  while (profile.coachClubState!.fixtures.some((fixture) => !fixture.played)) {
    now = new Date(now.getTime() + 86_400_000);
    profile.coach!.approval = 80;
    profile = advanceCoachRound(profile, now, rng).profile;
    const event = profile.coach!.event;
    if (event && !event.resolved) profile = resolveCoachEvent(profile, event.choices[0].id, now);
  }
  const club = profile.coachClubState!;
  assert.equal(club.roster.some((player) => player.isUserPlayer), false, 'the Player-mode athlete never plays for the Coach club');
  return club.standings.find((standing) => standing.clubId === club.id)!.points;
}

test('Coach abilities change results: a top-level staff out-performs a rookie with the same club', () => {
  const seeds = [3, 4, 5];
  const rookie = seeds.reduce((sum, seed) => sum + coachSeasonPoints(1, seed), 0);
  const elite = seeds.reduce((sum, seed) => sum + coachSeasonPoints(25, seed), 0);
  assert.ok(elite > rookie + 15, `elite ${elite} vs rookie ${rookie}`);
});

test('Versus NPC strength scales with the letter tier', () => {
  assert.ok(versusTierBase(0) > versusTierBase(5));
  const average = (grade: number) => {
    const member = enrollVersus(createInitialProfile(`tier-${grade}`, 'Tier', 'MF', T0), `TIER-${grade}X`, T0);
    member.versus!.club.grade = grade;
    const season = createVersusSeason(`TIER-${grade}X`, [member], T0);
    const npcs = season.clubs.filter((club) => club.isNpc).flatMap((club) => club.roster);
    return npcs.reduce((sum, player) => sum + abilityScore(player), 0) / npcs.length;
  };
  assert.ok(average(0) > average(5) + 15, 'Liga S NPCs are much stronger than Liga E');
});

test('Versus seasons produce injuries, attributed goals, keeper clean sheets, and survive emergency lineups', () => {
  const members = ['vx-a', 'vx-b'].map((id) => enrollVersus(createInitialProfile(id, id, 'MF', T0), 'ENGINE-1', T0));
  let season = createVersusSeason('ENGINE-1', members, T0);
  // Every forward of one club is injured: the club still fields a side.
  const crippled = season.clubs.find((club) => club.ownerId === 'vx-a')!;
  for (const player of crippled.roster.filter((item) => item.position === 'FW')) Object.assign(player, { status: 'INJURED', injuryEndsAt: new Date(T0.getTime() + 30 * 86_400_000).toISOString() });
  let injuries = 0;
  let emergencies = 0;
  for (let round = 1; round <= versusTotalRounds(season); round += 1) {
    const deadline = new Date(season.roundDeadline);
    season = processVersusRound(season, round, deadline, new SeededRandom(round * 13));
    for (const battle of season.battles.filter((item) => item.roundId === round)) {
      const settlement = battle.settlement!;
      assert.equal((settlement.scorers ?? []).length, settlement.homeGoals + settlement.awayGoals, 'every goal has a scorer');
      if (settlement.emergencyLineup) emergencies += 1;
    }
    injuries += season.clubs.flatMap((club) => club.roster).filter((player) => player.status === 'INJURED').length;
  }
  assert.ok(emergencies > 0);
  assert.ok(injuries > 0);
  const players = season.clubs.flatMap((club) => club.roster);
  assert.ok(players.some((player) => player.position === 'GK' && (player.cleanSheets ?? 0) > 0));
  assert.ok(players.filter((player) => player.position === 'FW').reduce((sum, player) => sum + player.goals, 0) > players.filter((player) => player.position === 'DF').reduce((sum, player) => sum + player.goals, 0));

  const finished = settleVersusSeason(season, new Date(season.roundDeadline));
  const synced = syncVersusProfileWithSeason(members[0], finished, new Date(season.roundDeadline));
  const rolled = rolloverVersusClub(synced, new Date(season.roundDeadline));
  const twice = rolloverVersusClub(rolled, new Date(season.roundDeadline));
  assert.equal(twice.versus!.club.grade, rolled.versus!.club.grade, 'rollover is applied once');
  assert.equal(rolled.versus!.club.roster.every((player) => player.status === 'AVAILABLE' && player.hp === player.maxHp), true);
  assert.ok(rolled.versus!.club.roster.filter((player) => player.position === 'GK').length >= 2);
});

test('an injury suffered alongside a suspension outlasts the ban', () => {
  const member = enrollVersus(createInitialProfile('ban-injury', 'Ban', 'MF', T0), 'BAN-INJURY', T0);
  let season = createVersusSeason('BAN-INJURY', [member], T0);
  const club = season.clubs.find((item) => item.ownerId === 'ban-injury')!;
  const player = club.roster.find((item) => item.position === 'MF')!;
  // Sent off and injured for ten days in the same match.
  Object.assign(player, { status: 'SUSPENDED', redCardBan: 1, injuryType: 'MODERATE', injuryEndsAt: new Date(T0.getTime() + 10 * 86_400_000).toISOString() });
  season = processVersusRound(season, 1, new Date(season.roundDeadline), new SeededRandom(1));
  const after = season.clubs.find((item) => item.id === club.id)!.roster.find((item) => item.id === player.id)!;
  assert.equal(after.redCardBan, 0, 'the ban was served');
  assert.equal(after.status, 'INJURED', 'the injury is still running');
  assert.equal(season.battles.filter((battle) => battle.roundId === 1).some((battle) => [...(battle.homeSubmission?.lineup ?? []), ...(battle.awaySubmission?.lineup ?? [])].includes(player.id)), false);
});
