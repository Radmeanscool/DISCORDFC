import assert from 'node:assert/strict';
import test from 'node:test';
import { RECOVERY_CLUBS } from '../src/config/recovery-data.js';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { assignMatchExp, createPlayerCareer, ensureGameplayState, formatDetailedSkills, preparePlayerWeek, resolvePlayerWeeklyEvent, skillDisplayLevel, WINTER_HOLIDAY_SKILL_EXP } from '../src/domain/gameplay-engine.js';
import { winterBreakAfter } from '../src/domain/season-calendar.js';
import { DETAILED_SKILLS, skillLabel, visibleSkills } from '../src/domain/types.js';

const T0 = new Date('2026-10-20T00:00:00.000Z');

test('a new free player signs with a random third-tier club; nationality never picks the club', () => {
  const clubs = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1) {
    // Spread the seeds: xorshift32 returns near-zero first draws for small seeds.
    const profile = createPlayerCareer(`start-${seed}`, 'Start', 'FW', T0, new SeededRandom(Math.imul(seed, 2_654_435_761) >>> 0), 'IDN');
    const record = RECOVERY_CLUBS.find((club) => club.nameEn === profile.club)!;
    assert.match(String(record.league), /^10[1-5]3$/, `${profile.club} is third tier`);
    assert.equal(profile.clubState?.leagueId, record.league);
    assert.equal(profile.nationality, 'IDN');
    clubs.add(profile.club);
  }
  assert.ok(clubs.size >= 20, `starter clubs vary (${clubs.size})`);
  const countries = new Set([...clubs].map((name) => RECOVERY_CLUBS.find((club) => club.nameEn === name)!.country));
  assert.ok(countries.size >= 4, 'clubs come from several countries regardless of nationality');
});

test('skills start at Lv 1 and climb one level per point gained', () => {
  let profile = createPlayerCareer('levels', 'Levels', 'MF', T0, new SeededRandom(9));
  for (const skill of DETAILED_SKILLS) assert.equal(skillDisplayLevel(profile, skill), 1, skill);
  assert.match(formatDetailedSkills(profile), /Pass\s+Lv  1/);
  profile.unassignedMatchExp = 2_000;
  profile.weekStage = 'EXP_PENDING';
  const before = profile.detailedSkills!.pass.level;
  profile = assignMatchExp(profile, { pass: 2_000 }, T0).profile;
  const gained = profile.detailedSkills!.pass.level - before;
  assert.ok(gained > 3, 'a large EXP pool buys several levels');
  assert.equal(skillDisplayLevel(profile, 'pass'), 1 + gained);
});

test('saves from before skill levels count levels from the position preset', () => {
  const legacy = createInitialProfile('legacy-levels', 'Legacy', 'FW', T0);
  delete legacy.skillBase;
  legacy.detailedSkills!.shots.level += 11;
  const migrated = ensureGameplayState(legacy, T0);
  assert.equal(skillDisplayLevel(migrated, 'shots'), 12);
  assert.equal(skillDisplayLevel(migrated, 'header'), 1);
});

test('a summer-window move joins the new league at the same round, and windows follow the calendar', async () => {
  const { joinOfficialClub, listEligibleClubs, officialClubTransferFee, transferWindowOpen } = await import('../src/domain/official-club-engine.js');
  const { advanceWeek } = await import('../src/domain/gameplay-engine.js');
  const { formatGameDate, matchdayDate, transferWindowFor, winterBreakAfter } = await import('../src/domain/season-calendar.js');
  const rng = new SeededRandom(77);
  let profile = createPlayerCareer('window-move', 'Mover', 'FW', T0, new SeededRandom(2_654_435_761), 'ENG');
  let now = T0;
  for (let week = 0; week < 3; week += 1) {
    now = new Date(now.getTime() + 7 * 86_400_000);
    profile = advanceWeek(profile, now, rng).profile;
    if ((profile.unassignedMatchExp ?? 0) > 0) profile = assignMatchExp(profile, { shots: profile.unassignedMatchExp }, now).profile;
  }
  assert.ok(transferWindowOpen(profile), 'the summer window is still open after three rounds');
  const appearances = profile.seasonStats!.appearances;
  const target = listEligibleClubs(profile)[0];
  profile.money = officialClubTransferFee(target.id);
  const moved = joinOfficialClub(profile, target.id, now);
  assert.equal(moved.clubState!.fixtures.filter((fixture) => fixture.played).length, 3, 'the new club has played the same rounds');
  assert.equal(moved.league.matchday, 4);
  assert.equal(moved.seasonStats!.appearances, appearances, 'personal season stats carry over');

  const total = moved.clubState!.fixtures.length;
  const half = winterBreakAfter(total);
  const shut = structuredClone(moved);
  for (const fixture of shut.clubState!.fixtures.filter((item) => item.matchday <= 8)) fixture.played = true;
  assert.equal(transferWindowFor(shut.clubState!), undefined);
  for (const fixture of shut.clubState!.fixtures.filter((item) => item.matchday <= half)) fixture.played = true;
  assert.equal(transferWindowFor(shut.clubState!), 'WINTER');
  // Mid-December before the break, a January restart after it.
  assert.equal(matchdayDate(2026, half, total).getUTCMonth(), 11);
  assert.equal(matchdayDate(2026, half + 1, total).getUTCMonth(), 0);
  assert.match(formatGameDate(matchdayDate(2026, 1, total)), /Agu/);
});

test('original training categories, detailed positions, and fans', async () => {
  const { trainRegular, resolvePosition, REGULAR_TRAINING } = await import('../src/domain/engine.js');
  const { resolvePlayerWeeklyEvent } = await import('../src/domain/gameplay-engine.js');
  const profile = createPlayerCareer('training-cats', 'Cats', 'MF', T0, new SeededRandom(5));
  const trained = trainRegular(profile, 'stamina', T0, new SeededRandom(6));
  assert.deepEqual(Object.keys(trained.applied).sort(), Object.keys(REGULAR_TRAINING.stamina.weights).sort());
  assert.ok(trained.expGained > 0);
  assert.throws(() => trainRegular(trained.profile, 'pass', T0, new SeededRandom(7)), /sudah dilakukan/);
  assert.deepEqual(resolvePosition('CDM'), { group: 'MF', detail: 'CDM' });
  assert.deepEqual(resolvePosition('FW'), { group: 'FW' });
  assert.equal(resolvePosition('XX'), undefined);

  const pending = structuredClone(profile);
  pending.weekStage = 'EVENT_PENDING';
  pending.weeklyEvent = { id: 'windfall', type: 'FAN_WINDFALL', title: 'Viral', description: '', resolved: false, createdAt: T0.toISOString(), week: 1, choices: [{ id: 'engage', label: 'Balas', description: '', fansDelta: 100 }] };
  assert.equal(resolvePlayerWeeklyEvent(pending, 'engage', T0).profile.fans, 100, 'the windfall grants +100 Fans as in the recording');
});

test('goalkeepers see the original keeper skill names', () => {
  const keeper = createPlayerCareer('gk-labels', 'Keeper', 'GK', T0, new SeededRandom(11));
  const sheet = formatDetailedSkills(keeper);
  for (const label of ['Reaction', 'Hand Toss', 'GK Kick', 'Save Penalty', 'Hold Position', 'GK Pass Ball', 'Command Defense', 'Balance', 'Jump', 'Willpower']) assert.ok(sheet.includes(label), label);
  for (const label of ['Shots', 'Dribbling', 'Off-ball Running']) assert.ok(!sheet.includes(label), label);
  assert.equal(visibleSkills('GK').includes('offBallRunning'), false);
  assert.equal(skillLabel('GK', 'teamwork'), 'Command Defense');
  assert.equal(skillLabel('FW', 'teamwork'), 'Teamwork');
});

test('the winter break brings one holiday event per season with a +100 EXP lesson', () => {
  const profile = createPlayerCareer('winter-holiday', 'Holiday', 'FW', T0, new SeededRandom(21));
  const fixtures = profile.clubState!.fixtures;
  const half = winterBreakAfter(fixtures.length);
  for (const fixture of fixtures) if (fixture.matchday <= half) fixture.played = true;
  const prepared = preparePlayerWeek(profile, T0, new SeededRandom(3));
  assert.equal(prepared.event?.type, 'WINTER_HOLIDAY');
  assert.equal(prepared.profile.winterHolidaySeason, 1);
  const lesson = prepared.event!.choices.find((choice) => choice.id === 'legend')!;
  const skill = lesson.skillExp!.skill;
  const before = skillDisplayLevel(prepared.profile, skill);
  const resolved = resolvePlayerWeeklyEvent(prepared.profile, 'legend', T0);
  assert.equal(lesson.skillExp!.amount, WINTER_HOLIDAY_SKILL_EXP);
  assert.ok(skillDisplayLevel(resolved.profile, skill) > before);
  assert.match(resolved.note ?? '', /\+100 EXP/);
  assert.equal(resolved.profile.unassignedMatchExp ?? 0, 0);
  // Preparing the same break again (e.g. after a winter-window move) does not repeat the holiday.
  resolved.profile.weekStage = 'READY';
  for (let seed = 1; seed <= 20; seed += 1) {
    const again = preparePlayerWeek(structuredClone(resolved.profile), T0, new SeededRandom(seed));
    assert.notEqual(again.event?.type, 'WINTER_HOLIDAY');
  }
});
