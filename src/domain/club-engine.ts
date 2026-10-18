import { getRating, MathRandomSource, type RandomSource } from './engine.js';
import { FORMATIONS, TACTICS, type ClubFixture, type ClubMatchResult, type ClubMatchStats, type ClubPlayer, type ClubState, type CoachCareerState, type FormationId, type MatchOutcome, type PlayerProfile, type Position, type TacticId } from './types.js';
import { SEED_CLUB_NAMES, SEED_PLAYER_NAMES, SEED_ROSTER_POSITIONS } from '../config/seed-data.js';
import { RECOVERY_CLUB_BY_ID, RECOVERY_CLUBS, RECOVERY_PLAYERS_BY_CLUB, recoveryPositionGroup, type RecoveryPlayerRecord } from '../config/recovery-data.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import {
  clubParticipants,
  clubPlayerOverall,
  abilityValue,
  clubPlayerOverallFromValue,
  clubStrengthByName,
  completeLeagueStandings,
  expectedGoals,
  freshStandings,
  isDomesticLeague,
  leagueTier,
  officialClubByName,
  officialClubStrength,
  officialClubsInLeague,
  poissonGoals,
  recordResult,
  resolveClubLeagueId,
  resolveLeagueMovement,
  simulateLeagueRound,
  sortStandings,
  stableHash
} from './league-engine.js';

const RECOVERY_PRIMARY_CLUB_NAMES = RECOVERY_CLUBS.filter((club) => club.league === 1011).map((club) => club.nameEn);
const CLUB_NAMES = RECOVERY_PRIMARY_CLUB_NAMES.length >= 10 ? RECOVERY_PRIMARY_CLUB_NAMES : SEED_CLUB_NAMES;
const POSITIONS: Position[] = SEED_ROSTER_POSITIONS;
const PLAYER_NAMES = SEED_PLAYER_NAMES;
export type ClubStateField = 'clubState' | 'coachClubState';

export interface ClubMatchOptions {
  /** Squad members that cannot be selected this fixture (injury, suspension, condition). */
  excludePlayerIds?: string[];
  /** Coach abilities applied to the coached side (Coach Mode only). */
  coach?: CoachCareerState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function statsForOverall(overall: number, position: Position): ClubPlayer['stats'] {
  return {
    atk: clamp(overall + (position === 'FW' ? 8 : position === 'MF' ? 2 : -4), 20, 99),
    def: clamp(overall + (position === 'DF' || position === 'GK' ? 8 : position === 'MF' ? 0 : -6), 20, 99),
    speed: clamp(overall + (position === 'FW' || position === 'MF' ? 4 : 0), 20, 99),
    power: clamp(overall + 1, 20, 99),
    strength: clamp(overall + (position === 'DF' ? 5 : 0), 20, 99),
    technique: clamp(overall + (position === 'MF' ? 6 : position === 'FW' ? 3 : -2), 20, 99)
  };
}

export function userClubPlayerId(profile: Pick<PlayerProfile, 'userId'>): string {
  return `user-${profile.userId}`;
}

function userAsClubPlayer(profile: PlayerProfile, now: Date): ClubPlayer {
  return {
    id: userClubPlayerId(profile),
    name: profile.displayName,
    position: profile.position,
    age: profile.age,
    overall: getRating(profile),
    stats: structuredClone(profile.stats),
    morale: 85,
    hp: profile.hp,
    maxHp: profile.maxHp,
    salary: 0,
    contractUntil: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
    isUserPlayer: true,
    goals: profile.career.goals,
    assists: profile.career.assists,
    appearances: profile.career.appearances
  };
}

/** Keeps the athlete's squad entry in step with Player progression before a fixture. */
export function syncUserClubPlayer(profile: PlayerProfile): void {
  const club = profile.clubState;
  if (!club) return;
  const id = userClubPlayerId(profile);
  let entry = club.roster.find((player) => player.isUserPlayer || player.id === id);
  if (!entry) {
    entry = userAsClubPlayer(profile, new Date(profile.updatedAt || Date.now()));
    club.roster.unshift(entry);
  }
  entry.id = id;
  entry.isUserPlayer = true;
  entry.name = profile.displayName;
  entry.position = profile.position;
  entry.age = profile.age;
  entry.overall = getRating(profile);
  entry.stats = structuredClone(profile.stats);
  entry.hp = profile.hp;
  entry.maxHp = profile.maxHp;
  entry.goals = profile.career.goals;
  entry.assists = profile.career.assists;
  entry.appearances = profile.career.appearances;
}

/** Official players an opponent fields; imported squads are ordered so this prefix is balanced. */
const OPPONENT_SQUAD_SIZE = 18;
const clubMedianValues = new Map<number, number>();

// Median age-adjusted market value of the matchday squad, so the players who actually play are
// centred on club strength like the APK rows and reserves fall below it.
function clubMedianValue(clubId: number): number {
  let median = clubMedianValues.get(clubId);
  if (median === undefined) {
    const values = (RECOVERY_PLAYERS_BY_CLUB.get(clubId) ?? []).slice(0, OPPONENT_SQUAD_SIZE).map((record) => abilityValue(record.marketValueEur, record.initAge)).filter((value) => value > 0).sort((a, b) => a - b);
    median = values.length ? values[Math.floor(values.length / 2)] : 0;
    clubMedianValues.set(clubId, median);
  }
  return median;
}

// The fixed-field decode of cfg_player is partial: price is 37 for every row and
// initAge spans 12–60. Overall is therefore anchored to the club's recovered
// grade/prestige, with normalValue only used as a stable per-player offset.
// Rows from the external roster overlay rank by market value inside the same band.
function recoveryOverall(record: RecoveryPlayerRecord): number {
  const club = RECOVERY_CLUB_BY_ID.get(record.clubId);
  const strength = club ? officialClubStrength(club) : 60;
  if (record.externalId) return clubPlayerOverallFromValue(strength, abilityValue(record.marketValueEur, record.initAge), clubMedianValue(record.clubId));
  return clubPlayerOverall(strength, record.normalValue);
}

function recoveryAge(record: RecoveryPlayerRecord): number {
  // External rows derive initAge from a real birth date, so veterans past 38 are kept.
  if (record.externalId && record.initAge >= 15 && record.initAge <= 45) return record.initAge;
  if (record.initAge >= 16 && record.initAge <= 38) return record.initAge;
  return 18 + (stableHash(`${record.nameEn}:${record.num}:${record.clubId}`) % 17);
}

function recoveryPlayerId(record: RecoveryPlayerRecord): string {
  if (record.externalId) return `recovery-${record.clubId}-${record.externalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return `recovery-${record.clubId}-${record.num}-${record.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function recoveryClubPlayer(record: RecoveryPlayerRecord, now: Date): ClubPlayer {
  const overall = recoveryOverall(record);
  const position = recoveryPositionGroup(record.positionCode);
  return {
    id: recoveryPlayerId(record),
    name: record.nameEn,
    position,
    age: recoveryAge(record),
    overall,
    stats: statsForOverall(overall, position),
    morale: 75,
    hp: 100,
    maxHp: 100,
    salary: Math.round(overall * 1.5),
    contractUntil: new Date(now.getTime() + 180 * 86_400_000).toISOString(),
    isUserPlayer: false,
    goals: 0,
    assists: 0,
    appearances: 0
  };
}

/** Market-facing copy of a recovered player with a market-unique id. */
export function recoveredMarketPlayer(record: RecoveryPlayerRecord, now: Date): ClubPlayer {
  return recoveryClubPlayer(record, now);
}

/** Academy filler for positions the partial client roster does not cover. */
function npcPlayer(index: number, base: number, rng: RandomSource, now: Date, position = POSITIONS[index % POSITIONS.length]): ClubPlayer {
  const overall = clamp(Math.round(base - 6 + Math.floor(rng.next() * 9)), 35, 90);
  return {
    id: `npc-${index + 1}`,
    name: PLAYER_NAMES[index % PLAYER_NAMES.length],
    position,
    age: 18 + Math.floor(rng.next() * 15),
    overall,
    stats: statsForOverall(overall, position),
    morale: 65 + Math.floor(rng.next() * 30),
    hp: 100,
    maxHp: 100,
    salary: 50 + Math.round(overall * 0.8),
    contractUntil: new Date(now.getTime() + 180 * 86_400_000).toISOString(),
    isUserPlayer: false,
    goals: 0,
    assists: 0,
    appearances: 0
  };
}

function recoveredFormation(officialClub: typeof RECOVERY_CLUBS[number] | undefined): FormationId {
  const formationIds: FormationId[] = ['4-4-2', '4-3-3', '3-5-2', '5-3-2', '4-1-3-2', '3-4-3', '4-2-3-1'];
  const source = officialClub?.formations?.[0] ?? 0;
  return formationIds[Math.abs(source) % formationIds.length];
}

function recoveredTactic(officialClub: typeof RECOVERY_CLUBS[number] | undefined): TacticId {
  const tacticIds: TacticId[] = ['balanced', 'attacking', 'defensive', 'counter', 'down-wings', 'middle-thrust', 'tiki-taka', 'long-ball', 'offense-full', 'defense-full'];
  return tacticIds[Math.abs(officialClub?.tacticsId ?? 0) % tacticIds.length];
}

export const MINIMUM_ROSTER_DEPTH: Record<Position, number> = { GK: 1, DF: 5, MF: 5, FW: 3 };

function ensureRosterDepth(rosterInput: ClubPlayer[], base: number, rng: RandomSource, now: Date): ClubPlayer[] {
  const roster = [...rosterInput];
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const player of roster) counts[player.position] += 1;
  const usedIds = new Set(roster.map((player) => player.id));
  let fallbackIndex = 1_000;
  for (const position of Object.keys(MINIMUM_ROSTER_DEPTH) as Position[]) {
    while (counts[position] < MINIMUM_ROSTER_DEPTH[position]) {
      const positionIndex = Math.max(0, POSITIONS.indexOf(position));
      const player = npcPlayer(fallbackIndex + positionIndex, base, rng, now, position);
      while (usedIds.has(player.id)) {
        fallbackIndex += POSITIONS.length;
        player.id = `npc-${fallbackIndex + positionIndex + 1}`;
      }
      usedIds.add(player.id);
      roster.push(player);
      counts[position] += 1;
      fallbackIndex += POSITIONS.length;
    }
  }
  return roster;
}

function buildOpponentRoster(officialClub: typeof RECOVERY_CLUBS[number] | undefined, strength: number, rng: RandomSource, now: Date): ClubPlayer[] {
  const officialPlayers = officialClub ? (RECOVERY_PLAYERS_BY_CLUB.get(officialClub.id) ?? []).slice(0, OPPONENT_SQUAD_SIZE).map((record) => recoveryClubPlayer(record, now)) : [];
  return ensureRosterDepth(officialPlayers, strength, rng, now);
}

function leagueClubNames(officialClub: typeof RECOVERY_CLUBS[number] | undefined): string[] {
  const names = officialClub ? officialClubsInLeague(officialClub.league).map((club) => club.nameEn) : [];
  return names.length >= 2 ? [...new Set(names)] : CLUB_NAMES;
}

/**
 * Double round-robin calendar. Both legs use the same opponent order (rotated per
 * season) so league-engine can rebuild every other pairing with the circle method.
 */
function buildFixtures(clubId: string, season: number, now: Date, participants: string[] = CLUB_NAMES): ClubFixture[] {
  const opponents = participants.filter((name) => name !== clubId);
  const rotation = opponents.length ? season % opponents.length : 0;
  const ordered = [...opponents.slice(rotation), ...opponents.slice(0, rotation)];
  const fixtures: ClubFixture[] = [];
  for (const leg of [0, 1]) {
    for (const [index, opponent] of ordered.entries()) {
      const matchday = leg * ordered.length + index + 1;
      const userIsHome = leg === 0 ? index % 2 === 0 : index % 2 !== 0;
      fixtures.push({
        id: `${season}-${matchday}-${clubId}`,
        season,
        matchday,
        homeClub: userIsHome ? clubId : opponent,
        awayClub: userIsHome ? opponent : clubId,
        played: false,
        playedAt: new Date(now.getTime() + matchday * 86_400_000).toISOString()
      });
    }
  }
  return fixtures;
}

/** Lazy migration for saves created before league tracking and Coach roster isolation. */
function normalizeClubState(profile: PlayerProfile, stateField: ClubStateField, rng: RandomSource, now: Date): void {
  const club = profile[stateField];
  if (!club) return;
  const official = RECOVERY_CLUBS.find((item) => item.id === club.officialId) ?? officialClubByName(club.name);
  if (club.leagueId === undefined && official) club.leagueId = official.league;
  if (!club.participants?.length) club.participants = club.standings.map((standing) => standing.clubId);
  if (stateField === 'coachClubState' && club.roster.some((player) => player.isUserPlayer)) {
    // Coach Mode never fields the user's Player-mode athlete.
    club.roster = ensureRosterDepth(club.roster.filter((player) => !player.isUserPlayer), clubStrengthByName(club.name, club.leagueId), rng, now);
  }
}

export function ensureClubState(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource(), stateField: ClubStateField = 'clubState', clubNameOverride?: string): PlayerProfile {
  const profile = structuredClone(profileInput);
  if (profile[stateField]) {
    normalizeClubState(profile, stateField, rng, now);
    return profile;
  }
  const requestedClub = clubNameOverride ?? profile.club;
  const officialClub = officialClubByName(requestedClub) ?? RECOVERY_CLUBS.find((club) => club.league === 1011);
  const clubName = officialClub?.nameEn ?? requestedClub;
  if (stateField === 'clubState' && profile.club === 'Rising City FC') profile.club = clubName;
  const participants = leagueClubNames(officialClub);
  const strength = officialClub ? officialClubStrength(officialClub) : 60;
  const officialPlayers = officialClub ? (RECOVERY_PLAYERS_BY_CLUB.get(officialClub.id) ?? []).slice(0, 15).map((record) => recoveryClubPlayer(record, now)) : [];
  const fallbackPlayers = Array.from({ length: Math.max(0, 15 - officialPlayers.length) }, (_, index) => npcPlayer(index, strength, rng, now));
  const baseRoster = stateField === 'clubState' ? [userAsClubPlayer(profile, now), ...officialPlayers, ...fallbackPlayers] : [...officialPlayers, ...fallbackPlayers];
  const roster = ensureRosterDepth(baseRoster, strength, rng, now);
  profile[stateField] = {
    id: clubName,
    officialId: officialClub?.id,
    name: clubName,
    level: 1,
    leagueTier: leagueTier(officialClub?.league) ?? 1,
    officialGrade: officialClub?.grade,
    provenance: officialClub ? 'RECOVERY_VERIFIED' : 'SEED_FALLBACK',
    prestige: officialClub ? Math.round(officialClub.prestige * 100) : 100,
    assets: officialClub?.salaryBase ?? 25_000,
    salaryBudget: officialClub?.coachSalaryBase ?? 5_000,
    formation: '4-4-2',
    tactic: 'balanced',
    roster,
    fixtures: buildFixtures(clubName, profile.league.season, now, participants),
    standings: freshStandings(participants),
    nextFixtureAt: new Date(now.getTime() + 86_400_000).toISOString(),
    championsLeagueQualified: false,
    championsLeagueRound: 0,
    leagueId: officialClub?.league,
    participants
  };
  return profile;
}

export function selectPlayingSquad(roster: ClubPlayer[], formationId: FormationId, excluded: ReadonlySet<string> = new Set()): ClubPlayer[] {
  const slots = FORMATIONS[formationId].slots;
  const available = roster.filter((player) => player.hp > 0 && !excluded.has(player.id));
  const selected: ClubPlayer[] = [];
  const score = (player: ClubPlayer) => (Number(player.isUserPlayer) * 1_000) + player.overall * (0.7 + player.hp / player.maxHp * 0.3) + player.morale / 10;
  for (const position of Object.keys(slots) as Position[]) {
    const players = available.filter((player) => player.position === position).sort((a, b) => score(b) - score(a));
    selected.push(...players.slice(0, slots[position]));
  }
  // Out-of-position cover keeps eleven on the pitch when a position is thin.
  if (selected.length < 11) {
    const chosen = new Set(selected.map((player) => player.id));
    const cover = available.filter((player) => !chosen.has(player.id) && player.position !== 'GK').sort((a, b) => score(b) - score(a));
    selected.push(...cover.slice(0, 11 - selected.length));
  }
  return selected;
}

export function getClubRating(profile: PlayerProfile, stateField: ClubStateField = 'clubState'): number {
  const club = profile[stateField];
  if (!club) return getRating(profile);
  const selected = selectPlayingSquad(club.roster, club.formation);
  const average = selected.reduce((sum, player) => sum + player.overall, 0) / Math.max(1, selected.length);
  const formation = FORMATIONS[club.formation];
  const tactic = TACTICS[club.tactic];
  return Math.round(average * (formation.controlMultiplier * tactic.controlMultiplier) + club.level * 2 + club.prestige / 50);
}

export function setClubFormation(profileInput: PlayerProfile, formation: FormationId, now = new Date(), stateField: ClubStateField = 'clubState', rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = ensureClubState(profileInput, now, rng, stateField);
  if (!FORMATIONS[formation]) throw new Error('Formasi tidak dikenal.');
  profile[stateField]!.formation = formation;
  profile.updatedAt = now.toISOString();
  return profile;
}

export function setClubTactic(profileInput: PlayerProfile, tactic: TacticId, now = new Date(), stateField: ClubStateField = 'clubState', rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = ensureClubState(profileInput, now, rng, stateField);
  if (!TACTICS[tactic]) throw new Error('Taktik tidak dikenal.');
  profile[stateField]!.tactic = tactic;
  profile.updatedAt = now.toISOString();
  return profile;
}

function recoverClubRoster(roster: ClubPlayer[]): void {
  // ClubPlayer condition recovery between scheduled fixtures is RECOVERY_INFERRED;
  // without it, a 38-round Coach season can permanently exhaust the only GK.
  for (const player of roster) player.hp = clamp(player.hp + 5, 0, player.maxHp);
}

interface SideStrength { attack: number; defence: number; control: number }

function coachModifiers(coach: CoachCareerState | undefined): { formation: number; tacticAmplifier: number; comeback: number } {
  const effects = GAME_BALANCE.coach.abilityEffects;
  if (!coach) return { formation: 1, tacticAmplifier: 1, comeback: 0 };
  return {
    formation: 1 + Math.min(effects.formationCap, Math.max(0, coach.abilities.formation.level - 1) * effects.formationPerLevel),
    tacticAmplifier: 1 + Math.min(effects.tacticAmplifierCap, Math.max(0, coach.abilities.tactics.level - 1) * effects.tacticAmplifierPerLevel),
    comeback: Math.min(effects.comebackCap, Math.max(0, coach.abilities.stateAdjustment.level - 1) * effects.comebackPerLevel)
  };
}

function sideStrength(squad: ClubPlayer[], formationId: FormationId, tacticId: TacticId, isHome: boolean, coach?: CoachCareerState): SideStrength {
  const count = Math.max(1, squad.length);
  const shortHanded = Math.min(1, squad.length / 11);
  const averageAttack = squad.reduce((sum, player) => sum + player.stats.atk * 0.45 + player.stats.speed * 0.15 + player.stats.power * 0.2 + player.stats.technique * 0.2, 0) / count;
  const averageDefence = squad.reduce((sum, player) => sum + player.stats.def * 0.5 + player.stats.strength * 0.2 + player.stats.speed * 0.1 + player.stats.technique * 0.2, 0) / count;
  const averageControl = squad.reduce((sum, player) => sum + player.stats.technique * 0.6 + player.stats.speed * 0.4, 0) / count;
  const morale = squad.reduce((sum, player) => sum + player.morale, 0) / count;
  const moraleFactor = 0.94 + morale / 850;
  const formation = FORMATIONS[formationId];
  const tactic = TACTICS[tacticId];
  const modifiers = coachModifiers(coach);
  const amplify = (multiplier: number) => 1 + (multiplier - 1) * modifiers.tacticAmplifier;
  const homeAdvantage = isHome ? 1.04 : 1;
  const factor = moraleFactor * modifiers.formation * shortHanded;
  return {
    attack: averageAttack * formation.attackMultiplier * amplify(tactic.attackMultiplier) * homeAdvantage * factor,
    defence: averageDefence * formation.defenceMultiplier * amplify(tactic.defenceMultiplier) * factor,
    control: averageControl * formation.controlMultiplier * amplify(tactic.controlMultiplier) * factor
  };
}

function outcome(homeGoals: number, awayGoals: number): MatchOutcome {
  if (homeGoals === awayGoals) return 'DRAW';
  return homeGoals > awayGoals ? 'WIN' : 'LOSS';
}

function matchStats(home: SideStrength, away: SideStrength, homeGoals: number, awayGoals: number, rng: RandomSource): ClubMatchStats {
  const possession = clamp(Math.round(50 + (home.control - away.control) * 0.8 + (rng.next() - 0.5) * 8), 28, 72);
  const shots = (side: SideStrength, other: SideStrength, goals: number) => clamp(Math.round(7 + (side.attack - other.defence) / 4 + goals * 1.5 + rng.next() * 5), Math.max(goals, 2), 30);
  const homeShots = shots(home, away, homeGoals);
  const awayShots = shots(away, home, awayGoals);
  const onTarget = (total: number, goals: number) => clamp(Math.round(goals + (total - goals) * (0.22 + rng.next() * 0.16)), goals, total);
  return {
    homePossession: possession,
    awayPossession: 100 - possession,
    homeShots,
    awayShots,
    homeShotsOnTarget: onTarget(homeShots, homeGoals),
    awayShotsOnTarget: onTarget(awayShots, awayGoals),
    homeCorners: clamp(Math.round(1 + homeShots / 4 + rng.next() * 3), 0, 14),
    awayCorners: clamp(Math.round(1 + awayShots / 4 + rng.next() * 3), 0, 14)
  };
}

function applyTrainingGrowth(roster: ClubPlayer[], coach: CoachCareerState | undefined, rng: RandomSource): void {
  if (!coach) return;
  const effects = GAME_BALANCE.coach.abilityEffects;
  const chance = Math.min(effects.trainingGrowthCap, effects.trainingGrowthBase + Math.max(0, coach.abilities.trainingLevel.level - 1) * effects.trainingGrowthPerLevel);
  for (const player of roster) {
    if (player.isUserPlayer || player.age > 30) continue;
    const ceiling = player.age <= 23 ? 92 : player.age <= 27 ? 90 : 88;
    if (player.overall >= ceiling || rng.next() >= chance) continue;
    player.overall += 1;
    player.stats = statsForOverall(player.overall, player.position);
  }
}

export function playClubMatch(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource(), stateField: ClubStateField = 'clubState', options: ClubMatchOptions = {}): ClubMatchResult {
  const profile = ensureClubState(profileInput, now, rng, stateField);
  const club = profile[stateField]!;
  const fixture = [...club.fixtures].sort((a, b) => a.matchday - b.matchday).find((item) => !item.played);
  if (!fixture) throw new Error('Musim klub telah selesai. Tutup season melalui Season Settlement untuk memulai musim baru.');
  const leagueId = resolveClubLeagueId(club);
  const userClubIsHome = fixture.homeClub === club.id;
  const opponentName = userClubIsHome ? fixture.awayClub : fixture.homeClub;
  const opponentOfficial = officialClubByName(opponentName, leagueId);
  const opponentStrength = clubStrengthByName(opponentName, leagueId);
  const opponentRoster = buildOpponentRoster(opponentOfficial, opponentStrength, rng, now);
  const opponentFormation = recoveredFormation(opponentOfficial);
  const opponentTactic = recoveredTactic(opponentOfficial);
  recoverClubRoster(club.roster);
  const excluded = new Set(options.excludePlayerIds ?? []);
  const clubSquad = selectPlayingSquad(club.roster, club.formation, excluded);
  const opponentSquad = selectPlayingSquad(opponentRoster, opponentFormation);
  if (clubSquad.length < 7 || opponentSquad.length < 7) throw new Error('Salah satu club tidak memiliki pemain yang cukup sehat untuk pertandingan.');
  const coach = stateField === 'coachClubState' ? options.coach : undefined;
  const clubSide = sideStrength(clubSquad, club.formation, club.tactic, userClubIsHome, coach);
  const opponentSide = sideStrength(opponentSquad, opponentFormation, opponentTactic, !userClubIsHome);
  const homeSide = userClubIsHome ? clubSide : opponentSide;
  const awaySide = userClubIsHome ? opponentSide : clubSide;
  const halftimeHomeGoals = poissonGoals(expectedGoals(homeSide.attack, awaySide.defence) / 2, rng);
  const halftimeAwayGoals = poissonGoals(expectedGoals(awaySide.attack, homeSide.defence) / 2, rng);
  // State Adjustment: a coached side that trails at halftime pushes harder after the break.
  const clubTrails = userClubIsHome ? halftimeHomeGoals < halftimeAwayGoals : halftimeAwayGoals < halftimeHomeGoals;
  const comeback = clubTrails ? 1 + coachModifiers(coach).comeback : 1;
  const secondHomeAttack = homeSide.attack * (userClubIsHome ? comeback : 1);
  const secondAwayAttack = awaySide.attack * (userClubIsHome ? 1 : comeback);
  const homeGoals = clamp(halftimeHomeGoals + poissonGoals(expectedGoals(secondHomeAttack, awaySide.defence) / 2, rng), 0, GAME_BALANCE.league.maxGoals);
  const awayGoals = clamp(halftimeAwayGoals + poissonGoals(expectedGoals(secondAwayAttack, homeSide.defence) / 2, rng), 0, GAME_BALANCE.league.maxGoals);
  const stats = matchStats(homeSide, awaySide, homeGoals, awayGoals, rng);
  const clubGoals = userClubIsHome ? homeGoals : awayGoals;
  const opponentGoals = userClubIsHome ? awayGoals : homeGoals;
  const result = outcome(clubGoals, opponentGoals);
  const mvp = [...clubSquad].sort((a, b) => (b.overall + b.morale / 10) - (a.overall + a.morale / 10))[0];
  fixture.played = true;
  fixture.homeGoals = homeGoals;
  fixture.awayGoals = awayGoals;
  fixture.playedAt = now.toISOString();
  const currentStanding = club.standings.find((standing) => standing.clubId === club.id);
  const opponentStanding = club.standings.find((standing) => standing.clubId === opponentName);
  if (!currentStanding) throw new Error('Klasemen club tidak memiliki baris untuk club pengguna.');
  recordResult(currentStanding, clubGoals, opponentGoals);
  if (opponentStanding) recordResult(opponentStanding, opponentGoals, clubGoals);
  simulateLeagueRound(club, fixture.matchday, rng);
  club.assets += result === 'WIN' ? 900 : result === 'DRAW' ? 550 : 300;
  club.prestige = clamp(club.prestige + (result === 'WIN' ? 3 : result === 'DRAW' ? 1 : -1), 0, 1_000);
  club.nextFixtureAt = club.fixtures.find((item) => !item.played)?.playedAt ?? new Date(now.getTime() + 365 * 86_400_000).toISOString();
  const lockerRoom = coach?.abilities.lockerRoom.level ?? 1;
  const lossMorale = -3 + Math.min(2, Math.floor(lockerRoom / 8));
  for (const player of clubSquad) {
    player.appearances += 1;
    player.hp = clamp(player.hp - 5, 0, player.maxHp);
    player.morale = clamp(player.morale + (result === 'WIN' ? 3 : result === 'LOSS' ? lossMorale : 1), 0, 100);
  }
  applyTrainingGrowth(club.roster, coach, rng);
  if (stateField === 'clubState') {
    profile.league.points = currentStanding.points;
    profile.league.matchday = fixture.matchday + 1;
    profile.league.wins = currentStanding.wins;
    profile.league.draws = currentStanding.draws;
    profile.league.losses = currentStanding.losses;
    profile.league.goalsFor = currentStanding.goalsFor;
    profile.league.goalsAgainst = currentStanding.goalsAgainst;
  }
  profile.updatedAt = now.toISOString();
  return {
    profile,
    fixture,
    homeGoals,
    awayGoals,
    halftime: { homeGoals: halftimeHomeGoals, awayGoals: halftimeAwayGoals },
    outcome: result,
    mvp,
    stats,
    squadIds: clubSquad.map((player) => player.id),
    opponentName,
    clubIsHome: userClubIsHome,
    commentary: [
      `${fixture.homeClub} menghadapi ${fixture.awayClub} pada matchday ${fixture.matchday}.`,
      `Babak pertama berakhir ${halftimeHomeGoals}-${halftimeAwayGoals}; formasi ${userClubIsHome ? club.formation : opponentFormation} vs ${userClubIsHome ? opponentFormation : club.formation}.`,
      `Taktik: ${TACTICS[userClubIsHome ? club.tactic : opponentTactic].name} vs ${TACTICS[userClubIsHome ? opponentTactic : club.tactic].name}.`,
      `Skor akhir ${homeGoals}-${awayGoals}; ${mvp.name} menjadi MVP dengan overall ${mvp.overall}.`
    ]
  };
}

export function getNextClubFixture(profileInput: PlayerProfile, now = new Date(), stateField: ClubStateField = 'clubState', rng: RandomSource = new MathRandomSource()): ClubFixture | undefined {
  const profile = ensureClubState(profileInput, now, rng, stateField);
  return [...(profile[stateField]?.fixtures ?? [])].sort((a, b) => a.matchday - b.matchday).find((fixture) => !fixture.played);
}

export function isClubSeasonComplete(club: ClubState | undefined): boolean {
  return Boolean(club && club.fixtures.length > 0 && club.fixtures.every((fixture) => fixture.played));
}

/** Kept for tools and tests: completes non-user rows the calendar could not simulate. */
export function projectCoachLeagueStandings(club: ClubState): void {
  completeLeagueStandings(club);
}

export function finishSeason(profileInput: PlayerProfile, now = new Date(), stateField: ClubStateField = 'clubState', rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = ensureClubState(profileInput, now, rng, stateField);
  const club = profile[stateField]!;
  completeLeagueStandings(club);
  const table = sortStandings(club.standings);
  const rank = Math.max(1, table.findIndex((standing) => standing.clubId === club.id) + 1);
  const standing = table[rank - 1];
  const leagueId = resolveClubLeagueId(club);
  const movement = resolveLeagueMovement(club, table);
  const finishedInTopTier = leagueTier(leagueId) === 1 || !isDomesticLeague(leagueId);
  const championsQualified = finishedInTopTier && movement.movement !== 'RELEGATED' && rank <= GAME_BALANCE.league.championsSlots;
  club.lastSeasonResult = { season: profile.league.season, leagueId, rank, points: standing?.points ?? 0, movement: movement.movement, nextLeagueId: movement.nextLeagueId, championsQualified };
  profile.league.season += 1;
  profile.league.matchday = 1;
  profile.league.points = 0;
  profile.league.wins = 0;
  profile.league.draws = 0;
  profile.league.losses = 0;
  profile.league.goalsFor = 0;
  profile.league.goalsAgainst = 0;
  club.leagueId = movement.nextLeagueId ?? leagueId;
  club.leagueTier = leagueTier(club.leagueId) ?? club.leagueTier ?? 1;
  club.participants = movement.nextParticipants.includes(club.id) ? movement.nextParticipants : [club.id, ...movement.nextParticipants.slice(0, Math.max(1, movement.nextParticipants.length - 1))];
  club.fixtures = buildFixtures(club.id, profile.league.season, now, club.participants);
  club.standings = freshStandings(club.participants);
  club.level = clamp(club.level + (movement.movement === 'PROMOTED' ? 1 : 0), 1, 10);
  club.championsLeagueQualified = championsQualified;
  club.championsLeagueRound = championsQualified ? 1 : 0;
  club.nextFixtureAt = club.fixtures[0]?.playedAt ?? now.toISOString();
  club.prestige = clamp(club.prestige + (rank === 1 ? 15 : 0) + (movement.movement === 'PROMOTED' ? 10 : movement.movement === 'RELEGATED' ? -6 : 2), 0, 1_000);
  for (const player of club.roster) {
    player.hp = player.maxHp;
    player.morale = clamp(player.morale, 55, 100);
  }
  profile.updatedAt = now.toISOString();
  return profile;
}

export function formatClubStanding(profileInput: PlayerProfile, now = new Date(), stateField: ClubStateField = 'clubState', rng: RandomSource = new MathRandomSource()): string {
  const profile = ensureClubState(profileInput, now, rng, stateField);
  const club = profile[stateField];
  return sortStandings(club?.standings ?? [])
    .map((standing, index) => {
      const label = `${index + 1}. ${standing.clubName} — ${standing.points} pts (${standing.wins}-${standing.draws}-${standing.losses})`;
      return standing.clubId === club?.id ? `**${label}**` : label;
    })
    .join('\n');
}

export function clubParticipantNames(club: ClubState): string[] {
  return clubParticipants(club);
}
