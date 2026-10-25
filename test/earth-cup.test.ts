import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceEarthCup, callUpRating, createEarthCup, EARTH_CUP_FINAL_STAGE, isEarthCupYear, nationalSquad, nationalStartingTeammates, nationalTeam, nextEarthCupYear, scheduleEarthCup, simulateEarthCupWithoutAthlete, summerAfterSeason, type EarthCupScore } from '../src/domain/earth-cup.js';
import { SeededRandom } from '../src/domain/engine.js';
import { advanceWeek, createPlayerCareer, preparePlayerWeek } from '../src/domain/gameplay-engine.js';
import { DETAILED_SKILLS } from '../src/domain/types.js';

const T0 = new Date('2026-10-20T00:00:00.000Z');
const WIN: EarthCupScore = { goalsFor: 2, goalsAgainst: 0, outcome: 'WIN', won: true };
const LOSS: EarthCupScore = { goalsFor: 0, goalsAgainst: 1, outcome: 'LOSS', won: false };

test('Earth Cup follows the four-year summer cycle after the league season', () => {
  const profile = createPlayerCareer('cup-cycle', 'Cycle', 'FW', T0, new SeededRandom(5), 'IDN');
  assert.equal(profile.calendarStartYear, 2026);
  assert.equal(summerAfterSeason(profile, 1), 2027);
  assert.equal(summerAfterSeason(profile, 4), 2030);
  assert.equal(nextEarthCupYear(profile, 1), 2030);
  assert.equal(nextEarthCupYear(profile, 5), 2034);
  assert.ok(isEarthCupYear(2030) && isEarthCupYear(2034) && !isEarthCupYear(2027));
  // Stronger nations and attacking roles set a higher bar.
  assert.ok(callUpRating('BRA', 'FW') > callUpRating('IDN', 'FW'));
  assert.ok(callUpRating('ENG', 'GK') < callUpRating('ENG', 'FW'));
});

test('the group has the nation plus one side from each other pot; top two reach the Round of 16', () => {
  const cup = createEarthCup('IDN', 2030, 4, true, new SeededRandom(9));
  assert.equal(cup.group.length, 4);
  assert.equal(cup.group[0].code, 'IDN');
  assert.equal(new Set(cup.group.map((row) => row.code)).size, 4);
  assert.equal(cup.opponent, cup.group[1].code);
  const rng = new SeededRandom(3);
  for (let match = 0; match < 3; match += 1) advanceEarthCup(cup, WIN, { goals: 1, assists: 0, rating: 7.5 }, rng);
  assert.equal(cup.group[0].points, 9);
  assert.equal(cup.stage, 3);
  assert.equal(cup.status, 'ACTIVE');
  assert.ok(cup.opponent && !cup.group.some((row) => row.code === cup.opponent), 'knockout rival comes from another group');
  // Win through the Final.
  while (cup.status === 'ACTIVE') advanceEarthCup(cup, WIN, undefined, rng);
  assert.equal(cup.status, 'CHAMPION');
  assert.equal(cup.history.at(-1)?.stage, EARTH_CUP_FINAL_STAGE);
  assert.equal(new Set(cup.history.slice(3).map((match) => match.opponent)).size, 4, 'a different rival every knockout round');
});

test('losing all group matches or a knockout ends the run', () => {
  const rng = new SeededRandom(4);
  const group = createEarthCup('ENG', 2030, 4, true, rng);
  for (let match = 0; match < 3; match += 1) advanceEarthCup(group, LOSS, undefined, rng);
  assert.equal(group.status, 'ELIMINATED');
  assert.equal(group.opponent, undefined);
  const knockout = createEarthCup('ENG', 2030, 4, true, rng);
  for (let match = 0; match < 3; match += 1) advanceEarthCup(knockout, WIN, undefined, rng);
  advanceEarthCup(knockout, LOSS, undefined, rng);
  assert.equal(knockout.status, 'ELIMINATED');
  assert.equal(knockout.history.length, 4);
});

test('a left-out athlete only hears how the nation did', () => {
  const profile = createPlayerCareer('cup-out', 'Bench', 'FW', T0, new SeededRandom(6), 'BRA');
  const notes = scheduleEarthCup(profile, 4, 0, 30, new SeededRandom(2));
  assert.match(notes[0], /tidak memanggilmu/);
  assert.equal(profile.earthCup?.calledUp, false);
  assert.notEqual(profile.earthCup?.status, 'ACTIVE');
  assert.deepEqual(scheduleEarthCup(profile, 4, 0, 30, new SeededRandom(2)), [], 'one edition per summer');
  assert.deepEqual(scheduleEarthCup(profile, 3, 30, 30, new SeededRandom(2)), [], 'no edition in 2029');
  const veteran = createPlayerCareer('cup-veteran', 'Veteran', 'FW', T0, new SeededRandom(6), 'BRA');
  veteran.age = 34;
  assert.deepEqual(scheduleEarthCup(veteran, 4, 30, 30, new SeededRandom(2)), [], 'no call-up in the retirement summer');
  const rerun = createEarthCup('BRA', 2030, 4, false, new SeededRandom(8));
  simulateEarthCupWithoutAthlete(rerun, new SeededRandom(8));
  assert.notEqual(rerun.status, 'ACTIVE');
});

test('a called-up athlete plays the Earth Cup with Next Week, then the new season starts', () => {
  const profile = createPlayerCareer('cup-star', 'Star', 'FW', T0, new SeededRandom(7), 'IDN');
  profile.age = 19;
  for (const skill of DETAILED_SKILLS) profile.detailedSkills![skill].level = 80;
  const notes = scheduleEarthCup(profile, 4, 30, 34, new SeededRandom(1));
  assert.match(notes[0], /Dipanggil timnas/);
  assert.equal(profile.earthCup?.status, 'ACTIVE');
  profile.weekStage = 'SEASON_BREAK';
  assert.throws(() => preparePlayerWeek(structuredClone(profile)), /Earth Cup sedang berlangsung/);

  let current = profile;
  let matches = 0;
  for (let week = 0; week < 10 && current.earthCup?.status === 'ACTIVE'; week += 1) {
    const result = advanceWeek(current, new Date(T0.getTime() + week * 86_400_000), new SeededRandom(100 + week));
    assert.equal(result.match?.competition, 'EARTH_CUP');
    assert.match(result.match?.stageLabel ?? '', /^Earth Cup · /);
    assert.equal(result.match?.teamName, 'Indonesia');
    assert.ok(result.match?.timeline?.length);
    const last = result.profile.earthCup!.history.at(-1)!;
    // A group draw stays a draw; a knockout decided on penalties is shown as the shoot-out result.
    if (last.stage < 3 && last.goalsFor === last.goalsAgainst) assert.equal(result.match?.outcome, 'DRAW');
    if (last.penalties) assert.equal(result.match?.outcome, last.penalties.for > last.penalties.against ? 'WIN' : 'LOSS');
    current = result.profile;
    current.unassignedMatchExp = 0;
    current.weekStage = 'SEASON_BREAK';
    matches += 1;
  }
  assert.ok(matches >= 3 && matches <= 7);
  assert.notEqual(current.earthCup?.status, 'ACTIVE');
  assert.ok((current.nationalCaps ?? 0) >= 1);
  if (current.earthCup?.status === 'CHAMPION') assert.ok(current.honors?.some((honor) => honor.category === 'NATIONAL'));
  const next = preparePlayerWeek(current, new Date(T0.getTime() + 30 * 86_400_000), new SeededRandom(3));
  assert.ok(next.narrative.some((line) => line.includes('Season break selesai')));
});

test('national squads use real overlay players where the data has them', () => {
  const england = nationalSquad('ENG', 2030);
  assert.ok(england.length >= 11);
  assert.ok(england.some((player) => player.position === 'GK'));
  const xi = nationalStartingTeammates(england, 'FW');
  assert.equal(xi.filter((player) => player.position === 'FW').length, 2, 'the athlete takes one forward slot');
  const indonesia = nationalSquad('IDN', 2030);
  assert.ok(indonesia.length >= 11, 'thin data is topped up');
  assert.equal(nationalTeam('XYZ').code, 'OTH');
});

test('a group-stage draw is recorded and rewarded as a draw', () => {
  let found = false;
  for (let seed = 1; seed <= 300 && !found; seed += 1) {
    const profile = createPlayerCareer('cup-draw', 'Draw', 'MF', T0, new SeededRandom(3), 'JPN');
    profile.earthCup = createEarthCup('JPN', 2030, 4, true, new SeededRandom(seed));
    profile.weekStage = 'SEASON_BREAK';
    const result = advanceWeek(profile, T0, new SeededRandom(seed));
    const played = result.profile.earthCup!.history[0];
    if (played.goalsFor !== played.goalsAgainst) continue;
    found = true;
    assert.equal(result.match?.outcome, 'DRAW');
    assert.equal(result.profile.earthCup!.group[0].points, 1);
  }
  assert.ok(found, 'some seed produces a group draw');
});
