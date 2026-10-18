import { GAME_BALANCE } from '../config/game-balance.js';
import { RECOVERY_CLUBS, type RecoveryClubRecord } from '../config/recovery-data.js';
import type { RandomSource } from './engine.js';
import type { ClubSeasonResult, ClubState, CompetitionStanding } from './types.js';

/**
 * League structure recovered from cfg_club: league code `10CT` means country C
 * (1–5) and tier T (1–3). Leagues 1061–1091 and 9001 are continental pools
 * without a domestic pyramid. Strength, schedule, and movement rules below are
 * RECOVERY_INFERRED reconstructions, not decoded server formulas.
 */
export const LEAGUE_RULESET_VERSION = 'league-recovery-inferred-v2';

const COUNTRY_LABELS: Record<number, string> = { 101: 'England', 102: 'Spain', 103: 'Italy', 104: 'Germany', 105: 'France' };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stableHash(value: string): number {
  return [...value].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
}

export function isDomesticLeague(leagueId: number | undefined): leagueId is number {
  return typeof leagueId === 'number' && /^10[1-5][1-3]$/.test(String(leagueId));
}

export function leagueTier(leagueId: number | undefined): number | undefined {
  return isDomesticLeague(leagueId) ? leagueId % 10 : undefined;
}

function leagueCountry(leagueId: number): number {
  return Math.floor(leagueId / 10);
}

export function leagueLabel(leagueId: number | undefined): string {
  if (!isDomesticLeague(leagueId)) return leagueId ? `League ${leagueId}` : 'League';
  return `${COUNTRY_LABELS[leagueCountry(leagueId)] ?? 'Country'} Divisi ${leagueTier(leagueId)}`;
}

/** direction -1 = one tier up (promotion), +1 = one tier down (relegation). */
export function adjacentLeague(leagueId: number | undefined, direction: -1 | 1): number | undefined {
  if (!isDomesticLeague(leagueId)) return undefined;
  const target = leagueId + direction;
  return isDomesticLeague(target) && leagueCountry(target) === leagueCountry(leagueId) ? target : undefined;
}

export function officialClubsInLeague(leagueId: number): RecoveryClubRecord[] {
  return RECOVERY_CLUBS.filter((club) => club.league === leagueId);
}

/** Name lookup that prefers the record inside the expected league (names are not globally unique). */
export function officialClubByName(name: string, preferredLeague?: number): RecoveryClubRecord | undefined {
  const matches = RECOVERY_CLUBS.filter((club) => club.nameEn === name);
  return matches.find((club) => club.league === preferredLeague) ?? matches[0];
}

export function officialClubStrength(club: RecoveryClubRecord): number {
  const tier = leagueTier(club.league) ?? 1;
  const base = 50 + club.prestige * 20 + (5 - club.grade) * 1.5 - (tier - 1) * 1.5;
  const variance = (stableHash(club.nameEn) % 5) - 2;
  return clamp(Math.round(base + variance), 45, 92);
}

export function clubStrengthByName(name: string, preferredLeague?: number): number {
  const record = officialClubByName(name, preferredLeague);
  return record ? officialClubStrength(record) : 60 + (stableHash(name) % 7) - 3;
}

/** Highest overall a recovered player at this club can reach before growth. */
export function clubPlayerOverall(clubStrength: number, seedValue: number): number {
  return clamp(Math.round(clubStrength + (Math.abs(seedValue) % 13) - 6), 40, 94);
}

export function resolveClubLeagueId(club: Pick<ClubState, 'leagueId' | 'officialId' | 'name'>): number | undefined {
  if (club.leagueId !== undefined) return club.leagueId;
  const record = RECOVERY_CLUBS.find((item) => item.id === club.officialId) ?? officialClubByName(club.name);
  return record?.league;
}

export function clubParticipants(club: Pick<ClubState, 'participants' | 'standings'>): string[] {
  return club.participants?.length ? [...club.participants] : club.standings.map((standing) => standing.clubId);
}

function emptyStanding(name: string): CompetitionStanding {
  return { clubId: name, clubName: name, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

export function freshStandings(participants: string[]): CompetitionStanding[] {
  return participants.map(emptyStanding);
}

export function recordResult(standing: CompetitionStanding, goalsFor: number, goalsAgainst: number): void {
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) { standing.wins += 1; standing.points += 3; }
  else if (goalsFor === goalsAgainst) { standing.draws += 1; standing.points += 1; }
  else standing.losses += 1;
}

export function sortStandings(standings: CompetitionStanding[]): CompetitionStanding[] {
  return [...standings].sort((a, b) => (b.points - a.points) || ((b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)) || (b.goalsFor - a.goalsFor) || a.clubId.localeCompare(b.clubId));
}

export function standingRank(standings: CompetitionStanding[], clubId: string): number {
  return Math.max(1, sortStandings(standings).findIndex((standing) => standing.clubId === clubId) + 1);
}

export function poissonGoals(lambda: number, rng: RandomSource, cap = GAME_BALANCE.league.maxGoals): number {
  const limit = Math.exp(-Math.max(0, lambda));
  let goals = 0;
  let product = rng.next();
  while (product > limit && goals < cap) {
    goals += 1;
    product *= rng.next();
  }
  return goals;
}

export function expectedGoals(attack: number, defence: number): number {
  return clamp(GAME_BALANCE.league.baseGoals * Math.exp((attack - defence) / GAME_BALANCE.league.goalScale), 0.12, 4.5);
}

export function simulateQuickMatch(homeRating: number, awayRating: number, rng: RandomSource): { homeGoals: number; awayGoals: number } {
  return {
    homeGoals: poissonGoals(expectedGoals(homeRating * 1.04, awayRating), rng),
    awayGoals: poissonGoals(expectedGoals(awayRating, homeRating), rng)
  };
}

/**
 * Recovers the circle-method order from the user's fixture list: matchday r+1
 * (and m+r+1 in the second leg) is played against order[r]. Returns undefined
 * for legacy or malformed calendars so callers fall back to season-end completion.
 */
export function firstLegOpponents(club: ClubState): string[] | undefined {
  const participants = clubParticipants(club);
  const legLength = participants.length - 1;
  const fixtures = [...club.fixtures].sort((a, b) => a.matchday - b.matchday);
  if (legLength < 1 || fixtures.length !== legLength * 2) return undefined;
  const opponentOf = (index: number): string => {
    const fixture = fixtures[index];
    return fixture.homeClub === club.id ? fixture.awayClub : fixture.homeClub;
  };
  const order = Array.from({ length: legLength }, (_, index) => opponentOf(index));
  if (new Set(order).size !== legLength) return undefined;
  for (let index = 0; index < legLength; index += 1) if (opponentOf(legLength + index) !== order[index]) return undefined;
  return order;
}

/** Non-user pairings for one matchday; empty when the calendar cannot be reconstructed. */
export function roundPairings(club: ClubState, matchday: number): Array<{ home: string; away: string }> {
  const order = firstLegOpponents(club);
  if (!order) return [];
  const legLength = order.length;
  if (legLength % 2 === 0) return [];
  const secondLeg = matchday > legLength;
  const roundIndex = (matchday - 1) % legLength;
  const pairs: Array<{ home: string; away: string }> = [];
  for (let offset = 1; offset <= (legLength - 1) / 2; offset += 1) {
    const first = order[(roundIndex + offset) % legLength];
    const second = order[(roundIndex - offset + legLength) % legLength];
    const firstAtHome = ((offset + roundIndex) % 2 === 0) !== secondLeg;
    pairs.push(firstAtHome ? { home: first, away: second } : { home: second, away: first });
  }
  return pairs;
}

export function simulateLeagueRound(club: ClubState, matchday: number, rng: RandomSource): number {
  const leagueId = resolveClubLeagueId(club);
  let simulated = 0;
  for (const pair of roundPairings(club, matchday)) {
    const home = club.standings.find((standing) => standing.clubId === pair.home);
    const away = club.standings.find((standing) => standing.clubId === pair.away);
    if (!home || !away) continue;
    const result = simulateQuickMatch(clubStrengthByName(pair.home, leagueId), clubStrengthByName(pair.away, leagueId), rng);
    recordResult(home, result.homeGoals, result.awayGoals);
    recordResult(away, result.awayGoals, result.homeGoals);
    simulated += 1;
  }
  return simulated;
}

/**
 * Deterministic completion for rounds the calendar could not simulate (legacy
 * saves and odd-sized leagues). Strength is relative to the league average so
 * stronger clubs (grade 1, high prestige) finish higher.
 */
export function completeLeagueStandings(club: ClubState): void {
  const leagueId = resolveClubLeagueId(club);
  const target = Math.max(club.fixtures.length, ...club.standings.map((standing) => standing.played));
  const strengths = new Map(club.standings.map((standing) => [standing.clubId, clubStrengthByName(standing.clubName, leagueId)]));
  const average = [...strengths.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, strengths.size);
  for (const standing of club.standings) {
    const remaining = Math.max(0, target - standing.played);
    if (remaining === 0 || standing.clubId === club.id) continue;
    const strength = strengths.get(standing.clubId) ?? average;
    const edge = (strength - average) / 20;
    const winRate = clamp(0.37 + edge * 0.55, 0.08, 0.78);
    const drawRate = clamp(0.26 - Math.abs(edge) * 0.08, 0.14, 0.3);
    const wins = Math.min(remaining, Math.round(remaining * winRate));
    const draws = Math.min(remaining - wins, Math.round(remaining * drawRate));
    const losses = remaining - wins - draws;
    standing.played += remaining;
    standing.wins += wins;
    standing.draws += draws;
    standing.losses += losses;
    standing.goalsFor += Math.round(remaining * expectedGoals(strength, average));
    standing.goalsAgainst += Math.round(remaining * expectedGoals(average, strength));
    standing.points += wins * 3 + draws;
  }
}

function strongestFirst(names: string[], leagueId?: number): string[] {
  return [...names].sort((a, b) => clubStrengthByName(b, leagueId) - clubStrengthByName(a, leagueId) || a.localeCompare(b));
}

/** Target league after clubs arrive: drop the clubs that move the other way, keep the size stable. */
function leagueAfterArrivals(targetLeague: number, arrivals: string[], arrivalsComeFromBelow: boolean): string[] {
  const official = officialClubsInLeague(targetLeague).map((club) => club.nameEn);
  const size = official.length || arrivals.length;
  const base = [...new Set(official.filter((name) => !arrivals.includes(name)))];
  const overflow = Math.max(0, base.length + arrivals.length - size);
  const ordered = strongestFirst(base, targetLeague);
  // Promoted arrivals push out the weakest clubs; relegated arrivals replace the strongest (who went up).
  const kept = arrivalsComeFromBelow ? ordered.slice(0, ordered.length - overflow) : ordered.slice(overflow);
  return [...new Set([...arrivals, ...kept])];
}

export interface LeagueMovement {
  movement: ClubSeasonResult['movement'];
  nextLeagueId?: number;
  nextParticipants: string[];
  promoted: string[];
  relegated: string[];
}

export function resolveLeagueMovement(club: ClubState, table: CompetitionStanding[]): LeagueMovement {
  const leagueId = resolveClubLeagueId(club);
  const participants = clubParticipants(club);
  if (!isDomesticLeague(leagueId)) return { movement: 'STAYED', nextLeagueId: leagueId, nextParticipants: participants, promoted: [], relegated: [] };
  const sorted = sortStandings(table).map((standing) => standing.clubId);
  const upper = adjacentLeague(leagueId, -1);
  const lower = adjacentLeague(leagueId, 1);
  const promoted = upper ? sorted.slice(0, GAME_BALANCE.league.promotionSlots) : [];
  const relegated = lower ? sorted.slice(Math.max(promoted.length, sorted.length - GAME_BALANCE.league.relegationSlots)) : [];
  if (upper && promoted.includes(club.id)) return { movement: 'PROMOTED', nextLeagueId: upper, nextParticipants: leagueAfterArrivals(upper, promoted, true), promoted, relegated };
  if (lower && relegated.includes(club.id)) return { movement: 'RELEGATED', nextLeagueId: lower, nextParticipants: leagueAfterArrivals(lower, relegated, false), promoted, relegated };
  const staying = participants.filter((name) => !promoted.includes(name) && !relegated.includes(name));
  const fromAbove = upper ? strongestFirst(officialClubsInLeague(upper).map((item) => item.nameEn).filter((name) => !participants.includes(name)), upper).slice(-promoted.length || undefined) : [];
  const fromBelow = lower ? strongestFirst(officialClubsInLeague(lower).map((item) => item.nameEn).filter((name) => !participants.includes(name)), lower).slice(0, relegated.length) : [];
  const next = [...new Set([...staying, ...(promoted.length ? fromAbove : []), ...fromBelow])];
  return { movement: 'STAYED', nextLeagueId: leagueId, nextParticipants: next.length >= 2 ? next : participants, promoted, relegated };
}
