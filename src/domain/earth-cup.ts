import { GAME_BALANCE } from '../config/game-balance.js';
import { RECOVERY_PLAYERS, recoveryPositionGroup } from '../config/recovery-data.js';
import { SEED_PLAYER_NAMES } from '../config/seed-data.js';
import { getRating, SeededRandom, type RandomSource } from './engine.js';
import { abilityValue, expectedGoals, poissonGoals, stableHash } from './league-engine.js';
import { calendarStartYear } from './season-calendar.js';
import type { EarthCupMatch, EarthCupStanding, EarthCupState, MatchOutcome, PlayerProfile, Position } from './types.js';

/**
 * RECOVERY_INFERRED Earth Cup: the national-team tournament that the athlete's
 * nationality is for. It is held every four years in the summer after the
 * league season (2030, 2034, … on the real cycle) with 32 nations: a group of
 * four, then Round of 16 → Final, one match per Next Week during the season
 * break. A call-up needs a regular first-team season and a rating that the
 * stronger nations set higher. Strengths use the club-strength scale.
 */
export interface NationalTeam {
  code: string;
  name: string;
  flag: string;
  strength: number;
  /** Nationality label in the Transfermarkt roster overlay, for real squad names. */
  dataset?: string;
}

export const NATIONAL_TEAMS: readonly NationalTeam[] = [
  { code: 'FRA', name: 'Prancis', flag: '🇫🇷', strength: 87, dataset: 'France' },
  { code: 'ESP', name: 'Spanyol', flag: '🇪🇸', strength: 87, dataset: 'Spain' },
  { code: 'ARG', name: 'Argentina', flag: '🇦🇷', strength: 87, dataset: 'Argentina' },
  { code: 'ENG', name: 'Inggris', flag: '🏴', strength: 86, dataset: 'England' },
  { code: 'BRA', name: 'Brasil', flag: '🇧🇷', strength: 86, dataset: 'Brazil' },
  { code: 'POR', name: 'Portugal', flag: '🇵🇹', strength: 85, dataset: 'Portugal' },
  { code: 'NED', name: 'Belanda', flag: '🇳🇱', strength: 84, dataset: 'Netherlands' },
  { code: 'GER', name: 'Jerman', flag: '🇩🇪', strength: 84, dataset: 'Germany' },
  { code: 'ITA', name: 'Italia', flag: '🇮🇹', strength: 83, dataset: 'Italy' },
  { code: 'BEL', name: 'Belgia', flag: '🇧🇪', strength: 82, dataset: 'Belgium' },
  { code: 'CRO', name: 'Kroasia', flag: '🇭🇷', strength: 81, dataset: 'Croatia' },
  { code: 'URU', name: 'Uruguay', flag: '🇺🇾', strength: 80, dataset: 'Uruguay' },
  { code: 'MAR', name: 'Maroko', flag: '🇲🇦', strength: 80, dataset: 'Morocco' },
  { code: 'COL', name: 'Kolombia', flag: '🇨🇴', strength: 79, dataset: 'Colombia' },
  { code: 'DEN', name: 'Denmark', flag: '🇩🇰', strength: 79, dataset: 'Denmark' },
  { code: 'JPN', name: 'Jepang', flag: '🇯🇵', strength: 78, dataset: 'Japan' },
  { code: 'SUI', name: 'Swiss', flag: '🇨🇭', strength: 78, dataset: 'Switzerland' },
  { code: 'SEN', name: 'Senegal', flag: '🇸🇳', strength: 78, dataset: 'Senegal' },
  { code: 'USA', name: 'Amerika Serikat', flag: '🇺🇸', strength: 77, dataset: 'United States' },
  { code: 'MEX', name: 'Meksiko', flag: '🇲🇽', strength: 77, dataset: 'Mexico' },
  { code: 'KOR', name: 'Korea Selatan', flag: '🇰🇷', strength: 76, dataset: 'Korea, South' },
  { code: 'SRB', name: 'Serbia', flag: '🇷🇸', strength: 76, dataset: 'Serbia' },
  { code: 'POL', name: 'Polandia', flag: '🇵🇱', strength: 76, dataset: 'Poland' },
  { code: 'NGA', name: 'Nigeria', flag: '🇳🇬', strength: 75, dataset: 'Nigeria' },
  { code: 'ECU', name: 'Ekuador', flag: '🇪🇨', strength: 75, dataset: 'Ecuador' },
  { code: 'SWE', name: 'Swedia', flag: '🇸🇪', strength: 75, dataset: 'Sweden' },
  { code: 'AUS', name: 'Australia', flag: '🇦🇺', strength: 74, dataset: 'Australia' },
  { code: 'CMR', name: 'Kamerun', flag: '🇨🇲', strength: 73, dataset: 'Cameroon' },
  { code: 'IRN', name: 'Iran', flag: '🇮🇷', strength: 73, dataset: 'Iran' },
  { code: 'KSA', name: 'Arab Saudi', flag: '🇸🇦', strength: 70, dataset: 'Saudi Arabia' },
  { code: 'CHN', name: 'China', flag: '🇨🇳', strength: 64, dataset: 'China' },
  { code: 'IDN', name: 'Indonesia', flag: '🇮🇩', strength: 62, dataset: 'Indonesia' },
  { code: 'MAS', name: 'Malaysia', flag: '🇲🇾', strength: 58, dataset: 'Malaysia' },
  // Players who picked "Lainnya" at creation still get a national team to play for.
  { code: 'OTH', name: 'Timnas Lainnya', flag: '🌍', strength: 70 }
];

const TEAMS_BY_CODE = new Map(NATIONAL_TEAMS.map((team) => [team.code, team]));

export const EARTH_CUP_TEAMS = 32;
export const EARTH_CUP_GROUP_MATCHES = 3;
export const EARTH_CUP_FINAL_STAGE = 6;
export const EARTH_CUP_MIN_AGE = 17;
/** Share of the league season the athlete must have played to be considered. */
export const EARTH_CUP_MIN_APPEARANCE_SHARE = 0.3;
const STAGE_NAMES = ['Grup · Laga 1', 'Grup · Laga 2', 'Grup · Laga 3', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
// Knockout rivals come from bands of the strength-ranked field (excluding the group): later rounds face stronger sides.
const KNOCKOUT_BANDS: Record<number, [number, number]> = { 3: [4, 27], 4: [0, 15], 5: [0, 9], 6: [0, 5] };
// Group schedule for [nation, a, b, c]: the nation's match first, then the other pairing of that matchday.
const GROUP_SCHEDULE: Array<[[number, number], [number, number]]> = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

export function nationalTeam(code: string | undefined): NationalTeam {
  return TEAMS_BY_CODE.get(code ?? 'OTH') ?? TEAMS_BY_CODE.get('OTH')!;
}

export function nationLabel(code: string): string {
  const team = nationalTeam(code);
  return `${team.flag} ${team.name}`;
}

export function earthCupStageName(stage: number): string {
  return STAGE_NAMES[Math.min(stage, STAGE_NAMES.length - 1)];
}

export function isEarthCupYear(year: number): boolean {
  return year % 4 === 2;
}

/** Summer that follows league season `season` (the season runs from August of one year to May of the next). */
export function summerAfterSeason(profile: Pick<PlayerProfile, 'calendarStartYear' | 'createdAt'>, season: number): number {
  return calendarStartYear(profile) + Math.max(1, season);
}

/** Next summer with an Earth Cup on or after the end of the given season. */
export function nextEarthCupYear(profile: Pick<PlayerProfile, 'calendarStartYear' | 'createdAt'>, season: number): number {
  let year = summerAfterSeason(profile, season);
  while (!isEarthCupYear(year)) year += 1;
  return year;
}

// Same-age athletes rate lower at the back (simulated: FW ~71, MF ~69, DF ~65, GK ~61 at 19), so the bar follows the position.
const CALL_UP_POSITION_OFFSET: Record<Position, number> = { FW: 0, MF: -2, DF: -6, GK: -10 };

/** Rating the national coach expects; stronger nations have deeper squads. */
export function callUpRating(code: string, position: Position = 'FW'): number {
  return Math.min(80, Math.max(45, nationalTeam(code).strength - 10 + CALL_UP_POSITION_OFFSET[position]));
}

/** A national team leans on its star: the athlete moves the side's rating six times more than one squad slot would. */
export function nationalTeamRating(code: string, athleteRating: number | undefined): number {
  const strength = nationalTeam(code).strength;
  return athleteRating === undefined ? strength : strength + (athleteRating - strength) / 6;
}

export function earthCupActive(profile: Pick<PlayerProfile, 'earthCup'>): boolean {
  return profile.earthCup?.status === 'ACTIVE';
}

/** The 32 nations of this edition: the athlete's nation plus the strongest others. */
function participants(nation: string): NationalTeam[] {
  const others = NATIONAL_TEAMS.filter((team) => team.code !== nation && team.code !== 'OTH').sort((a, b) => b.strength - a.strength || a.code.localeCompare(b.code));
  return [nationalTeam(nation), ...others.slice(0, EARTH_CUP_TEAMS - 1)];
}

function standing(code: string): EarthCupStanding {
  return { code, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

/** Four pots by strength; the nation's group takes one side from each of the other pots. */
function drawGroup(nation: string, rng: RandomSource): EarthCupStanding[] {
  const field = participants(nation).sort((a, b) => b.strength - a.strength || a.code.localeCompare(b.code));
  const pots = [0, 1, 2, 3].map((pot) => field.slice(pot * 8, pot * 8 + 8));
  const ownPot = pots.findIndex((pot) => pot.some((team) => team.code === nation));
  const rivals = pots.filter((_, index) => index !== ownPot).map((pot) => {
    const options = pot.filter((team) => team.code !== nation);
    return options[Math.floor(rng.next() * options.length)].code;
  });
  return [standing(nation), ...rivals.map(standing)];
}

export function sortGroup(group: EarthCupStanding[]): EarthCupStanding[] {
  return [...group].sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || nationalTeam(b.code).strength - nationalTeam(a.code).strength);
}

function record(row: EarthCupStanding, goalsFor: number, goalsAgainst: number): void {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) { row.won += 1; row.points += 3; }
  else if (goalsFor === goalsAgainst) { row.drawn += 1; row.points += 1; }
  else row.lost += 1;
}

function drawKnockoutOpponent(state: EarthCupState, stage: number, rng: RandomSource): string {
  const excluded = new Set([...state.group.map((row) => row.code), ...state.history.map((match) => match.opponent)]);
  const field = participants(state.nation).filter((team) => !excluded.has(team.code)).sort((a, b) => b.strength - a.strength || a.code.localeCompare(b.code));
  const [low, high] = KNOCKOUT_BANDS[stage] ?? [0, field.length - 1];
  const band = field.slice(low, Math.min(field.length, high + 1));
  const pool = band.length ? band : field;
  return pool[Math.floor(rng.next() * pool.length)].code;
}

/** Opens an edition: group drawn, first opponent set. */
export function createEarthCup(nation: string, year: number, season: number, calledUp: boolean, rng: RandomSource): EarthCupState {
  const group = drawGroup(nation, rng);
  return { year, season, nation, calledUp, status: 'ACTIVE', stage: 0, group, opponent: group[1].code, history: [] };
}

export interface EarthCupScore {
  goalsFor: number;
  goalsAgainst: number;
  /** Regulation-time result (feeds the personal match model). */
  outcome: MatchOutcome;
  penalties?: { for: number; against: number };
  /** True when the nation goes through (knockouts) or the match was not lost (groups). */
  won: boolean;
}

/** Neutral-venue score; knockout draws go to penalties, where the athlete's penalty skill helps a little. */
export function simulateEarthCupScore(ownRating: number, opponentRating: number, knockout: boolean, rng: RandomSource, penaltyEdge = 0): EarthCupScore {
  const goalsFor = poissonGoals(expectedGoals(ownRating, opponentRating), rng);
  const goalsAgainst = poissonGoals(expectedGoals(opponentRating, ownRating), rng);
  const outcome: MatchOutcome = goalsFor > goalsAgainst ? 'WIN' : goalsFor < goalsAgainst ? 'LOSS' : 'DRAW';
  if (!knockout || outcome !== 'DRAW') return { goalsFor, goalsAgainst, outcome, won: outcome !== 'LOSS' };
  const winChance = Math.min(0.8, Math.max(0.2, 0.5 + (ownRating - opponentRating) / 80 + penaltyEdge));
  const winnerScore = 3 + Math.floor(rng.next() * 3);
  const loserScore = Math.max(1, winnerScore - 1 - Math.floor(rng.next() * 2));
  const won = rng.next() < winChance;
  return { goalsFor, goalsAgainst, outcome, won, penalties: won ? { for: winnerScore, against: loserScore } : { for: loserScore, against: winnerScore } };
}

/**
 * Records the nation's match and moves the edition on: the other group pairing is
 * played alongside, the top two go through after three matches, a knockout loss
 * ends the run, and winning the Final makes the nation champion.
 */
export function advanceEarthCup(state: EarthCupState, score: EarthCupScore, personal: EarthCupMatch['personal'], rng: RandomSource): string[] {
  const stage = state.stage;
  const opponent = state.opponent!;
  state.history.push({ stage, opponent, goalsFor: score.goalsFor, goalsAgainst: score.goalsAgainst, penalties: score.penalties, personal });
  const notes: string[] = [];
  if (stage < EARTH_CUP_GROUP_MATCHES) {
    const [[own, rival], [left, right]] = GROUP_SCHEDULE[stage];
    record(state.group[own], score.goalsFor, score.goalsAgainst);
    record(state.group[rival], score.goalsAgainst, score.goalsFor);
    const other = simulateEarthCupScore(nationalTeam(state.group[left].code).strength, nationalTeam(state.group[right].code).strength, false, rng);
    record(state.group[left], other.goalsFor, other.goalsAgainst);
    record(state.group[right], other.goalsAgainst, other.goalsFor);
    notes.push(`Laga lain grup: ${nationLabel(state.group[left].code)} ${other.goalsFor}–${other.goalsAgainst} ${nationLabel(state.group[right].code)}.`);
    if (stage + 1 < EARTH_CUP_GROUP_MATCHES) {
      state.stage = stage + 1;
      state.opponent = state.group[GROUP_SCHEDULE[stage + 1][0][1]].code;
      return notes;
    }
    const position = sortGroup(state.group).findIndex((row) => row.code === state.nation) + 1;
    if (position > 2) {
      state.status = 'ELIMINATED';
      state.opponent = undefined;
      notes.push(`${nationLabel(state.nation)} finis #${position} di grup dan tersingkir dari Earth Cup ${state.year}.`);
      return notes;
    }
    state.stage = 3;
    state.opponent = drawKnockoutOpponent(state, 3, rng);
    notes.push(`${nationLabel(state.nation)} lolos sebagai #${position} grup. Round of 16 melawan ${nationLabel(state.opponent)}.`);
    return notes;
  }
  if (!score.won) {
    state.status = 'ELIMINATED';
    state.opponent = undefined;
    notes.push(`${nationLabel(state.nation)} tersingkir di ${earthCupStageName(stage)} Earth Cup ${state.year}.`);
    return notes;
  }
  if (stage >= EARTH_CUP_FINAL_STAGE) {
    state.status = 'CHAMPION';
    state.opponent = undefined;
    notes.push(`🏆 ${nationLabel(state.nation)} JUARA EARTH CUP ${state.year}!`);
    return notes;
  }
  state.stage = stage + 1;
  state.opponent = drawKnockoutOpponent(state, state.stage, rng);
  notes.push(`${nationLabel(state.nation)} melaju ke ${earthCupStageName(state.stage)} melawan ${nationLabel(state.opponent)}.`);
  return notes;
}

/** Plays a whole edition without the athlete (not called up): only the nation's result matters. */
export function simulateEarthCupWithoutAthlete(state: EarthCupState, rng: RandomSource): string[] {
  const notes: string[] = [];
  while (state.status === 'ACTIVE') {
    const score = simulateEarthCupScore(nationalTeam(state.nation).strength, nationalTeam(state.opponent!).strength, state.stage >= EARTH_CUP_GROUP_MATCHES, rng);
    notes.push(...advanceEarthCup(state, score, undefined, rng).filter((line) => !line.startsWith('Laga lain grup')));
  }
  return notes;
}

/** Match date: the tournament opens in mid-June, four days between rounds. */
export function earthCupMatchDate(year: number, stage: number): Date {
  return new Date(Date.UTC(year, 5, 11 + stage * 4));
}

export interface NationalSquadPlayer {
  name: string;
  position: Position;
}

function ageIn(dateOfBirth: string | undefined, year: number): number {
  const born = dateOfBirth ? Number(dateOfBirth.slice(0, 4)) : NaN;
  return Number.isFinite(born) ? year - born : 27;
}

// A 23-man tournament squad by position group.
const SQUAD_QUOTA: Record<Position, number> = { GK: 3, DF: 8, MF: 6, FW: 6 };

/**
 * Squad names: the nation's best players in the roster overlay per position
 * (market value adjusted for age in the tournament year), topped up with seed
 * names where the overlay barely covers the nation.
 */
export function nationalSquad(code: string, year: number): NationalSquadPlayer[] {
  const team = nationalTeam(code);
  const pool = team.dataset
    ? RECOVERY_PLAYERS.filter((player) => player.nationality === team.dataset && ageIn(player.dateOfBirth, year) <= 36)
      .map((player) => ({ name: player.nameEn, position: recoveryPositionGroup(player.positionCode), value: abilityValue(player.marketValueEur, ageIn(player.dateOfBirth, year)) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    : [];
  const rng = new SeededRandom(stableHash(`national:${code}`));
  const names = [...SEED_PLAYER_NAMES];
  for (let index = names.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.next() * (index + 1));
    [names[index], names[swap]] = [names[swap], names[index]];
  }
  let filler = 0;
  const squad: NationalSquadPlayer[] = [];
  for (const position of ['GK', 'DF', 'MF', 'FW'] as Position[]) {
    const picked = pool.filter((player) => player.position === position).slice(0, SQUAD_QUOTA[position]).map(({ name }) => ({ name, position }));
    squad.push(...picked);
    // Seed names fill a starting XI's worth of each line (1 GK, 4 DF, 3 MF, 3 FW).
    const minimum = position === 'GK' ? 1 : position === 'DF' ? 4 : 3;
    for (let count = picked.length; count < minimum; count += 1) squad.push({ name: names[filler++ % names.length], position });
  }
  return squad;
}

/** Starting XI around the athlete: one keeper, four defenders, three midfielders, three forwards, minus the athlete's slot. */
export function nationalStartingTeammates(squad: NationalSquadPlayer[], athletePosition: Position): NationalSquadPlayer[] {
  const slots: Record<Position, number> = { GK: 1, DF: 4, MF: 3, FW: 3 };
  slots[athletePosition] -= 1;
  const chosen: NationalSquadPlayer[] = [];
  for (const position of ['GK', 'DF', 'MF', 'FW'] as Position[]) chosen.push(...squad.filter((player) => player.position === position).slice(0, slots[position]));
  return chosen;
}

/**
 * Season-end call-up for an Earth Cup summer. Called up: the edition opens and
 * is played with Next Week. Left out: the nation plays without the athlete and
 * only its result is reported.
 */
export function scheduleEarthCup(profile: PlayerProfile, completedSeason: number, appearances: number, fixtures: number, rng: RandomSource): string[] {
  const year = summerAfterSeason(profile, completedSeason);
  if (!isEarthCupYear(year) || profile.careerStatus === 'RETIRED' || profile.earthCup?.year === year) return [];
  // An athlete who retires at this season end is not called up for the summer.
  if (profile.age >= GAME_BALANCE.weekly.retirementAge) return [];
  const nation = profile.nationality ?? 'OTH';
  const rating = getRating(profile);
  const neededRating = callUpRating(nation, profile.position);
  const neededApps = Math.ceil(fixtures * EARTH_CUP_MIN_APPEARANCE_SHARE);
  const missing: string[] = [];
  if (profile.age < EARTH_CUP_MIN_AGE) missing.push(`usia ${EARTH_CUP_MIN_AGE}+`);
  if (rating < neededRating) missing.push(`rating ${neededRating}+ (kamu ${rating})`);
  if (appearances < neededApps) missing.push(`main reguler ${neededApps}+ laga liga (kamu ${appearances})`);
  const state = createEarthCup(nation, year, completedSeason, missing.length === 0, rng);
  profile.earthCup = state;
  if (missing.length) {
    const notes = simulateEarthCupWithoutAthlete(state, rng);
    return [`🌍 Earth Cup ${year}: ${nationLabel(nation)} tidak memanggilmu (butuh ${missing.join(', ')}).`, ...notes.slice(-1)];
  }
  return [`🌍 **Dipanggil timnas!** ${nationLabel(nation)} membawamu ke Earth Cup ${year}. Grup: ${state.group.slice(1).map((row) => nationLabel(row.code)).join(', ')}. Tekan Next Week untuk laga pertama.`];
}
