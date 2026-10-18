import assert from 'node:assert/strict';
import { createInitialProfile, getRating, recoverPlayer, SeededRandom } from '../src/domain/engine.js';
import { ensureClubState, playClubMatch, projectCoachLeagueStandings } from '../src/domain/club-engine.js';
import { advanceCoachRound, createCoachCareer, resolveCoachEvent, retireCoach } from '../src/domain/coach-career-engine.js';
import { playChampionsLeague, startChampionsLeague } from '../src/domain/competition-engine.js';
import { advanceWeek, assignMatchExpEvenly, createPlayerCareer, rebirthPlayer, retirePlayer } from '../src/domain/gameplay-engine.js';
import { ratingSkillsFor } from '../src/domain/player-formulas.js';
import { abilityScore, createVersusClub, createVersusSeason, enrollVersus, processVersusRound, settleVersusSeason, syncVersusProfileWithSeason, versusTotalRounds } from '../src/domain/versus-engine.js';
import { lineupAction, versusHomeControls, versusPositionControls, versusSetupControls } from '../src/discord/components.js';
import { COACH_ABILITIES, DETAILED_SKILLS, type PlayerProfile, type Position } from '../src/domain/types.js';

/**
 * Targeted parity audit: each finding re-checks a defect class found in the
 * 2026-10 gameplay audit and prints the measured value, so regressions show up
 * as FAIL with numbers instead of silently drifting. Run: `tsx tools/targeted-audit.ts`.
 */
const start = new Date('2026-01-05T00:00:00.000Z');
const DAY = 86_400_000;
type Finding = { id: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; status: 'PASS' | 'FAIL'; details: string };
const report: Finding[] = [];
function finding(id: string, severity: Finding['severity'], fn: () => string): void {
  try { report.push({ id, severity, status: 'PASS', details: fn() }); }
  catch (error) { report.push({ id, severity, status: 'FAIL', details: error instanceof Error ? error.message : String(error) }); }
}

function athlete(id: string, position: Position, level: number): PlayerProfile {
  const profile = createPlayerCareer(id, id, position, start, new SeededRandom(7));
  for (const skill of DETAILED_SKILLS) profile.detailedSkills![skill].level = level;
  return profile;
}

function playSeason(profileInput: PlayerProfile, seed: number): PlayerProfile {
  const rng = new SeededRandom(seed);
  let profile = profileInput;
  let now = start;
  const season = profile.league.season;
  for (let week = 0; week < 70 && profile.league.season === season; week += 1) {
    now = new Date(now.getTime() + 7 * DAY);
    profile = advanceWeek(profile, now, rng).profile;
    if ((profile.unassignedMatchExp ?? 0) > 0) profile = assignMatchExpEvenly(profile, ratingSkillsFor(profile.position), now).profile;
  }
  return profile;
}

finding('PLAYER-RECOVERY-CLOCK', 'HIGH', () => {
  const profile = createInitialProfile('audit-recovery', 'Audit', 'MF', start);
  profile.hp = 40;
  let ticked = profile;
  for (let minute = 15; minute <= 240; minute += 15) ticked = recoverPlayer(ticked, new Date(start.getTime() + minute * 60_000));
  const once = recoverPlayer(profile, new Date(start.getTime() + 240 * 60_000));
  assert.equal(ticked.hp, once.hp);
  assert.ok(ticked.hp > 40);
  return `16 quarter-hour ticks recover ${ticked.hp - 40} HP, same as one 4h tick`;
});

finding('PLAYER-POSITION-OUTPUT', 'HIGH', () => {
  const rows = (['FW', 'MF', 'DF', 'GK'] as Position[]).map((position) => {
    const stats = playSeason(athlete(`audit-${position}`, position, 80), 21).seasonHistory![0].stats;
    return { position, goals: stats.goals, assists: stats.assists, apps: stats.appearances };
  });
  const goals = Object.fromEntries(rows.map((row) => [row.position, row.goals]));
  assert.ok(goals.FW > goals.DF && goals.MF > goals.GK && goals.GK <= 1);
  assert.ok(goals.FW <= 45, 'a forward season stays within a realistic range');
  return rows.map((row) => `${row.position} ${row.goals}G/${row.assists}A in ${row.apps}`).join(' · ');
});

finding('PLAYER-REBIRTH-RATING', 'HIGH', () => {
  const veteran = athlete('audit-rebirth', 'FW', 95);
  veteran.age = 34;
  const reborn = rebirthPlayer(retirePlayer(veteran, start).profile, start, 'FW').profile;
  const fresh = createInitialProfile('audit-fresh', 'Fresh', 'FW', start);
  assert.ok(getRating(reborn) > getRating(fresh));
  return `rebirth rating ${getRating(reborn)} vs fresh ${getRating(fresh)} (veteran ${getRating(veteran)})`;
});

function coachRank(level: number, seed: number): number {
  const rng = new SeededRandom(seed);
  let profile = createCoachCareer(ensureClubState(createInitialProfile(`audit-coach-${level}-${seed}`, 'Coach', 'MF', start), start, new SeededRandom(seed)), 'Coach', start, new SeededRandom(seed));
  for (const ability of COACH_ABILITIES) profile.coach!.abilities[ability].level = level;
  let now = start;
  while (profile.coachClubState!.fixtures.some((fixture) => !fixture.played)) {
    now = new Date(now.getTime() + DAY);
    profile.coach!.approval = 80;
    profile = advanceCoachRound(profile, now, rng).profile;
    const event = profile.coach!.event;
    if (event && !event.resolved) profile = resolveCoachEvent(profile, event.choices[0].id, now);
  }
  const club = profile.coachClubState!;
  assert.equal(club.roster.some((player) => player.isUserPlayer), false);
  projectCoachLeagueStandings(club);
  const table = [...club.standings].sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst));
  return table.findIndex((standing) => standing.clubId === club.id) + 1;
}

finding('COACH-ABILITY-EFFECT', 'HIGH', () => {
  const seeds = [3, 4, 5, 6];
  const rookie = seeds.map((seed) => coachRank(1, seed));
  const elite = seeds.map((seed) => coachRank(25, seed));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(mean(elite) + 3 < mean(rookie));
  return `average rank Lv1 ${mean(rookie).toFixed(1)} vs Lv25 ${mean(elite).toFixed(1)} (same club, same seeds)`;
});

finding('COACH-CHAMPIONS-ISOLATION', 'HIGH', () => {
  let profile = createCoachCareer(ensureClubState(createInitialProfile('audit-coach-cl', 'Audit Coach CL', 'MF', start), start), 'Audit Coach CL', start);
  profile.clubState!.championsLeagueQualified = true;
  profile.coachClubState!.championsLeagueQualified = true;
  profile = startChampionsLeague(profile, start, 'PLAYER');
  profile = startChampionsLeague(profile, start, 'COACH');
  for (const fixture of profile.coachClubState!.fixtures.slice(0, 8)) fixture.played = true;
  const playerState = profile.championsLeague;
  const coachPlayed = playChampionsLeague(profile, new Date(start.getTime() + DAY), new SeededRandom(2_001), 'COACH');
  assert.deepEqual(coachPlayed.profile.championsLeague, playerState);
  assert.equal(coachPlayed.profile.coach!.championsLeague!.status, coachPlayed.status);
  return `Player and Coach Champions League states stay separate (${coachPlayed.status})`;
});

finding('COACH-FULL-STANDINGS-PROJECTION', 'MEDIUM', () => {
  let profile = createCoachCareer(createInitialProfile('audit-coach-table', 'Audit Coach Table', 'DF', start), 'Audit Coach Table', start);
  const fixtureCount = profile.coachClubState!.fixtures.length;
  let round = 0;
  while (profile.coachClubState!.fixtures.some((fixture) => !fixture.played)) {
    profile = playClubMatch(profile, new Date(start.getTime() + (round + 1) * DAY), new SeededRandom(1_500 + round), 'coachClubState').profile;
    round += 1;
  }
  projectCoachLeagueStandings(profile.coachClubState!);
  assert.ok(profile.coachClubState!.standings.every((standing) => standing.played === fixtureCount));
  const goals = profile.coachClubState!.standings.reduce((sum, standing) => sum + standing.goalsFor, 0);
  const matches = profile.coachClubState!.standings.length * fixtureCount / 2;
  return `${profile.coachClubState!.standings.length} clubs × ${fixtureCount} matches · ${(goals / matches).toFixed(2)} goals/match`;
});

finding('VERSUS-TIER-STRENGTH', 'HIGH', () => {
  const average = (grade: number) => {
    const member = enrollVersus(createInitialProfile(`audit-tier-${grade}`, 'Tier', 'MF', start), `AUDIT-TIER-${grade}`, start);
    member.versus!.club.grade = grade;
    const npcs = createVersusSeason(`AUDIT-TIER-${grade}`, [member], start).clubs.filter((club) => club.isNpc).flatMap((club) => club.roster);
    return npcs.reduce((sum, player) => sum + abilityScore(player), 0) / npcs.length;
  };
  const values = [0, 1, 2, 3, 4, 5].map(average);
  assert.ok(values.every((value, index) => index === 0 || value < values[index - 1]));
  return `NPC ability S→E: ${values.map((value) => value.toFixed(1)).join(' > ')}`;
});

finding('VERSUS-WIN-RATE-AND-ATTRIBUTION', 'HIGH', () => {
  let wins = 0;
  let games = 0;
  let goals = 0;
  let attributed = 0;
  let injuries = 0;
  for (let trial = 0; trial < 6; trial += 1) {
    const member = enrollVersus(createInitialProfile(`audit-wr-${trial}`, 'WR', 'MF', start), `AUDIT-WR-${trial}`, start);
    let season = createVersusSeason(`AUDIT-WR-${trial}`, [member], start);
    const clubId = member.versus!.clubId;
    for (let round = 1; round <= versusTotalRounds(season); round += 1) {
      season = processVersusRound(season, round, new Date(season.roundDeadline), new SeededRandom(trial * 100 + round));
      injuries += season.clubs.flatMap((club) => club.roster).filter((player) => player.status === 'INJURED').length;
      for (const battle of season.battles.filter((item) => item.roundId === round)) {
        const settlement = battle.settlement!;
        goals += settlement.homeGoals + settlement.awayGoals;
        attributed += settlement.scorers?.length ?? 0;
        if (battle.homeClubId !== clubId && battle.awayClubId !== clubId) continue;
        games += 1;
        const own = battle.homeClubId === clubId ? settlement.homeGoals : settlement.awayGoals;
        const other = battle.homeClubId === clubId ? settlement.awayGoals : settlement.homeGoals;
        if (own > other) wins += 1;
      }
    }
  }
  assert.equal(attributed, goals);
  assert.ok(injuries > 0);
  const rate = wins / games;
  assert.ok(rate >= 0.25 && rate <= 0.65, 'a new club is competitive in Liga E');
  return `new club win rate vs Liga E NPCs ${(rate * 100).toFixed(0)}% over ${games} battles · every goal attributed · ${injuries} injured-player rounds`;
});

finding('VERSUS-SYNC-REWARD-IMMUTABILITY', 'HIGH', () => {
  const members = [0, 1, 2, 3].map((index) => enrollVersus(createVersusClub(createInitialProfile(`audit-versus-${index}`, `Audit Versus ${index}`, (['FW', 'MF', 'DF', 'GK'] as Position[])[index], start), start), 'AUDIT-GROUP', start));
  let season = createVersusSeason('AUDIT-GROUP', members, start, 4);
  for (let round = 1; round <= versusTotalRounds(season); round += 1) season = processVersusRound(season, round, new Date(season.roundDeadline), new SeededRandom(900 + round));
  const finished = settleVersusSeason(season, new Date(season.roundDeadline));
  const original = JSON.stringify(finished);
  let synced = syncVersusProfileWithSeason(members[0], finished, new Date(season.roundDeadline));
  const money = synced.versus!.versusMoney;
  synced = syncVersusProfileWithSeason(synced, JSON.parse(original), new Date(season.roundDeadline));
  assert.equal(synced.versus!.versusMoney, money);
  assert.equal(JSON.stringify(finished), original);
  return `repeated sync keeps wallet=${money} and ledger=${synced.versus!.ledger!.length}`;
});

finding('DISCORD-CUSTOM-ID-LIMIT', 'HIGH', () => {
  const userId = '12345678901234567890';
  const profile = createVersusClub(createInitialProfile('audit-ids', 'Ids', 'MF', start), start);
  const rows = [
    ...versusSetupControls(userId, 38, 99_999, '4-4-2', 'balanced'),
    ...versusPositionControls(userId, 38, 99_999, '4-4-2', profile.versus!.club.roster, { GK: [], DF: [], MF: [], FW: [] }, (player) => Math.round(abilityScore(player))),
    ...versusHomeControls(userId, { round: 38, rosterVersion: 99_999 })
  ];
  const ids = rows.flatMap((row) => row.toJSON().components.map((component) => ('custom_id' in component ? component.custom_id : '') ?? ''));
  const longest = Math.max(...ids.map((id) => id.length));
  assert.ok(longest <= 100);
  return `longest custom id ${longest}/100 (${lineupAction('start', 38, 99_999)})`;
});

finding('CLUB-NON1011-LEAGUE', 'MEDIUM', () => {
  const profile = createInitialProfile('audit-league', 'Audit League', 'FW', start);
  profile.club = 'Blackburn Rovers';
  const enriched = ensureClubState(profile, start, new SeededRandom(77));
  assert.equal(enriched.clubState!.name, 'Blackburn Rovers');
  assert.equal(enriched.clubState!.standings.some((standing) => standing.clubName === 'Blackburn Rovers'), true);
  return `league ${enriched.clubState!.standings.length} clubs, fixtures=${enriched.clubState!.fixtures.length}`;
});

finding('COACH-RETIREMENT-ISOLATION', 'MEDIUM', () => {
  let profile = createCoachCareer(createInitialProfile('audit-coach-honor', 'Audit Coach', 'GK', start), 'Audit Coach', start);
  profile.honors = [{ id: 'player-honor', category: 'PERSONAL', title: 'Player Honor', season: 1, description: 'player', source: 'WALKTHROUGH_OBSERVED', value: 1, awardedAt: start.toISOString() }];
  profile = retireCoach(profile, new Date(start.getTime() + DAY));
  assert.equal(profile.honors.length, 1);
  assert.equal(profile.coach!.status, 'RETIRED');
  return 'Coach retirement keeps Player honors untouched';
});

console.log(JSON.stringify({ status: report.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL', findings: report }, null, 2));
if (report.some((item) => item.status === 'FAIL')) process.exitCode = 1;
