import type { ClubState, PlayerProfile } from './types.js';

/**
 * RECOVERY_INFERRED season calendar shaped by the recordings: weekly league
 * matches from August, "Winter Break Begins!" after the mid-December round,
 * play resumes in January, the season ends in May. Players move in the summer
 * window (first weeks of the season, e.g. the September move to Sandhausen) and
 * in the January window, as well as during the season break.
 */
const WINTER_GAP_DAYS = 28;
/** The summer window stays open through this many played matchdays. */
export const SUMMER_WINDOW_MATCHDAYS = 4;
/** The January window covers this many matchdays after the winter break. */
export const WINTER_WINDOW_MATCHDAYS = 3;

export type TransferWindow = 'SUMMER' | 'WINTER';

/** Calendar year in which season 1 of this career started. */
export function calendarStartYear(profile: Pick<PlayerProfile, 'calendarStartYear' | 'createdAt'>): number {
  if (profile.calendarStartYear) return profile.calendarStartYear;
  const created = new Date(profile.createdAt);
  return Number.isNaN(created.getTime()) ? 2026 : created.getUTCFullYear();
}

export function seasonYear(profile: Pick<PlayerProfile, 'calendarStartYear' | 'createdAt' | 'league'>): number {
  return calendarStartYear(profile) + Math.max(1, profile.league.season) - 1;
}

export function seasonLabel(year: number): string {
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

/** Last matchday played before the winter break. */
export function winterBreakAfter(totalMatchdays: number): number {
  return Math.floor(totalMatchdays / 2);
}

/** Matchday date: Saturdays from the first weekend on or after 8 August, with a January restart. */
export function matchdayDate(year: number, matchday: number, totalMatchdays: number): Date {
  const start = new Date(Date.UTC(year, 7, 8));
  start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7));
  const gap = matchday > winterBreakAfter(totalMatchdays) ? WINTER_GAP_DAYS : 0;
  return new Date(start.getTime() + ((Math.max(1, matchday) - 1) * 7 + gap) * 86_400_000);
}

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatGameDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

export function playedMatchdays(club: Pick<ClubState, 'fixtures'>): number {
  return club.fixtures.filter((fixture) => fixture.played).length;
}

/** The window open before the next matchday, if any (season break is handled by the caller). */
export function transferWindowFor(club: Pick<ClubState, 'fixtures'>): TransferWindow | undefined {
  const played = playedMatchdays(club);
  const half = winterBreakAfter(club.fixtures.length);
  if (played <= SUMMER_WINDOW_MATCHDAYS) return 'SUMMER';
  if (played >= half && played < half + WINTER_WINDOW_MATCHDAYS) return 'WINTER';
  return undefined;
}

/** Date of the athlete's next league match, or undefined once the season is over. */
export function nextMatchDate(profile: PlayerProfile): Date | undefined {
  const club = profile.clubState;
  const fixture = club ? [...club.fixtures].sort((a, b) => a.matchday - b.matchday).find((item) => !item.played) : undefined;
  return club && fixture ? matchdayDate(seasonYear(profile), fixture.matchday, club.fixtures.length) : undefined;
}
