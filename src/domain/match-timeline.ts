import { SeededRandom, type RandomSource } from './engine.js';
import { stableHash } from './league-engine.js';
import type { MatchTimelineEvent, PersonalMatchPerformance, Position } from './types.js';

/**
 * Presentation timeline for a Player-mode match. It never changes the result:
 * minutes, scorers, and chances are drawn from a seed derived from the match id,
 * so the gameplay random stream is untouched and every count matches the stored
 * score, half-time split, and the athlete's personal output.
 */
export interface TimelineInput {
  seed: string;
  teamName: string;
  opponentName: string;
  teamGoals: number;
  opponentGoals: number;
  halftime: { team: number; opponent: number };
  userName: string;
  position: Position;
  personal: PersonalMatchPerformance;
  teammates: Array<{ name: string; position: Position }>;
  /** Attacking players of the opponent, when the official roster is known. */
  opponents: string[];
  shots: number;
  opponentShots: number;
  opponentShotsOnTarget: number;
}

const SCORER_WEIGHT: Record<Position, number> = { FW: 6, MF: 3, DF: 1, GK: 0 };
const USER_CHANCE_SHARE: Record<Position, number> = { FW: 0.5, MF: 0.35, DF: 0.12, GK: 0 };
const MISS_OUTCOMES = ['melebar tipis', 'ditepis kiper', 'membentur mistar', 'diblok bek lawan', 'melambung di atas mistar'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Escapes Discord markdown so a display name cannot break the bold highlight. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_~`|>\\])/g, '\\$1');
}

function pick<T>(items: T[], rng: RandomSource): T | undefined {
  return items.length ? items[Math.floor(rng.next() * items.length)] : undefined;
}

function spreadMinutes(count: number, from: number, to: number, rng: RandomSource): number[] {
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    let minute = from + Math.floor(rng.next() * (to - from + 1));
    // Prefer distinct minutes while the half has room for them.
    for (let attempt = 0; attempt < 5 && result.includes(minute) && count <= to - from; attempt += 1) minute = from + Math.floor(rng.next() * (to - from + 1));
    result.push(minute);
  }
  return result.sort((a, b) => a - b);
}

function shuffled<T>(items: T[], rng: RandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.next() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function teammate(teammates: TimelineInput['teammates'], rng: RandomSource): string {
  const weighted = teammates.flatMap((player) => Array.from({ length: SCORER_WEIGHT[player.position] }, () => player.name));
  return escapeMarkdown(pick(weighted, rng) ?? pick(teammates, rng)?.name ?? 'Rekan setim');
}

export function buildMatchTimeline(input: TimelineInput): MatchTimelineEvent[] {
  const rng = new SeededRandom(stableHash(input.seed));
  const user = `**${escapeMarkdown(input.userName)}**`;
  const team = escapeMarkdown(input.teamName);
  const opponent = escapeMarkdown(input.opponentName);
  // Opponent names rotate so one attacker does not take every moment.
  const opponentPool = shuffled(input.opponents, rng);
  let opponentTurn = 0;
  const opponentPlayer = () => escapeMarkdown(opponentPool.length ? opponentPool[opponentTurn++ % opponentPool.length] : `Penyerang ${input.opponentName}`);
  const played = input.personal.played;
  const events: MatchTimelineEvent[] = [];

  const firstHalfTeam = clamp(input.halftime.team, 0, input.teamGoals);
  const teamMinutes = [...spreadMinutes(firstHalfTeam, 3, 45, rng), ...spreadMinutes(input.teamGoals - firstHalfTeam, 47, 90, rng)];
  const firstHalfOpponent = clamp(input.halftime.opponent, 0, input.opponentGoals);
  const opponentMinutes = [...spreadMinutes(firstHalfOpponent, 3, 45, rng), ...spreadMinutes(input.opponentGoals - firstHalfOpponent, 47, 90, rng)];

  const userGoals = played ? clamp(input.personal.goals, 0, input.teamGoals) : 0;
  const userAssists = played ? clamp(input.personal.assists, 0, input.teamGoals - userGoals) : 0;
  const roles = shuffled(teamMinutes.map((_, index) => index), rng);
  const userGoalSlots = new Set(roles.slice(0, userGoals));
  const userAssistSlots = new Set(roles.slice(userGoals, userGoals + userAssists));
  teamMinutes.forEach((minute, index) => {
    const userName = escapeMarkdown(input.userName);
    if (userGoalSlots.has(index)) {
      const helper = rng.next() < 0.55 && input.teammates.length ? teammate(input.teammates, rng) : undefined;
      events.push({ minute, side: 'TEAM', kind: 'GOAL', user: true, actor: userName, assist: helper, text: `⚽ GOL! ${user} mencetak gol untuk ${team}!${helper ? ` Assist: ${helper}.` : ''}` });
    } else if (userAssistSlots.has(index)) {
      const scorer = teammate(input.teammates, rng);
      events.push({ minute, side: 'TEAM', kind: 'GOAL', user: true, actor: scorer, assist: userName, text: `⚽ GOL! ${scorer} menuntaskan umpan ${user}. Assist untukmu!` });
    } else {
      const scorer = teammate(input.teammates, rng);
      events.push({ minute, side: 'TEAM', kind: 'GOAL', actor: scorer, text: `⚽ GOL! ${scorer} membobol gawang ${opponent}.` });
    }
  });
  for (const minute of opponentMinutes) {
    const scorer = opponentPlayer();
    events.push({ minute, side: 'OPPONENT', kind: 'GOAL', actor: scorer, text: `⚽ Gol untuk ${opponent}: ${scorer}.` });
  }

  // A sending-off ends the athlete's match, so it comes after their goals and assists.
  const lastUserMinute = Math.max(0, ...events.filter((event) => event.user).map((event) => event.minute));
  const redMinute = played && input.personal.redCard ? clamp(lastUserMinute + 1 + Math.floor(rng.next() * Math.max(1, 89 - lastUserMinute)), Math.max(15, lastUserMinute), 90) : undefined;
  const userActive = (minute: number) => played && (redMinute === undefined || minute < redMinute);

  // Chances avoid minutes that already hold a moment, so a goal and a miss never share one.
  const taken = new Set(events.map((event) => event.minute));
  const freeMinute = () => {
    let minute = 5 + Math.floor(rng.next() * 85);
    for (let attempt = 0; attempt < 8 && taken.has(minute); attempt += 1) minute = 5 + Math.floor(rng.next() * 85);
    taken.add(minute);
    return minute;
  };
  const chances = Math.min(3, Math.max(0, input.shots - input.teamGoals));
  for (let index = 0; index < chances; index += 1) {
    const minute = freeMinute();
    const outcome = pick(MISS_OUTCOMES, rng)!;
    if (userActive(minute) && rng.next() < USER_CHANCE_SHARE[input.position]) events.push({ minute, side: 'TEAM', kind: 'CHANCE', user: true, text: `🎯 ${user} melepaskan tembakan — ${outcome}.` });
    else events.push({ minute, side: 'TEAM', kind: 'CHANCE', text: `🎯 ${teammate(input.teammates, rng)} mencoba peruntungan — ${outcome}.` });
  }

  const saves = Math.max(0, input.opponentShotsOnTarget - input.opponentGoals);
  const threats = input.position === 'GK' ? Math.min(3, saves) : Math.min(2, Math.max(0, input.opponentShots - input.opponentGoals));
  for (let index = 0; index < threats; index += 1) {
    const minute = freeMinute();
    const attacker = opponentPlayer();
    if (input.position === 'GK' && userActive(minute)) events.push({ minute, side: 'OPPONENT', kind: 'SAVE', user: true, text: `🧤 Penyelamatan gemilang ${user} menggagalkan ${attacker}!` });
    else if (input.position === 'DF' && userActive(minute) && rng.next() < 0.6) events.push({ minute, side: 'OPPONENT', kind: 'BLOCK', user: true, text: `🛡️ ${user} memblok tembakan ${attacker}.` });
    else events.push({ minute, side: 'OPPONENT', kind: 'CHANCE', text: `⚠️ ${attacker} mengancam, tetapi bola melebar.` });
  }

  if (played && input.personal.yellowCard) {
    const latest = (redMinute ?? 90) - 1;
    events.push({ minute: clamp(12 + Math.floor(rng.next() * Math.max(1, latest - 12)), 1, latest), side: 'TEAM', kind: 'YELLOW', user: true, text: `🟨 ${user} menerima kartu kuning.` });
  }
  if (redMinute !== undefined) events.push({ minute: redMinute, side: 'TEAM', kind: 'RED', user: true, text: `🟥 ${user} diusir wasit! ${team} bermain dengan 10 orang.` });
  return events.map((event, order) => ({ event, order })).sort((a, b) => a.event.minute - b.event.minute || a.order - b.order).map(({ event }) => event);
}

/** Adds the athlete's injury after their last action (skipped after a sending-off). */
export function withInjuryEvent(timeline: MatchTimelineEvent[], userName: string, seed: string): MatchTimelineEvent[] {
  if (timeline.some((event) => event.kind === 'RED' && event.user)) return timeline;
  const rng = new SeededRandom(stableHash(`${seed}:injury`));
  const lastUserMinute = Math.max(55, ...timeline.filter((event) => event.user).map((event) => event.minute));
  const minute = clamp(lastUserMinute + 1 + Math.floor(rng.next() * 10), 1, 90);
  const injury: MatchTimelineEvent = { minute, side: 'TEAM', kind: 'INJURY', user: true, text: `🚑 **${escapeMarkdown(userName)}** cedera dan ditarik keluar.` };
  return [...timeline.filter((event) => event.minute <= minute), injury, ...timeline.filter((event) => event.minute > minute)];
}

export interface RatingInput {
  seed: string;
  squad: Array<{ name: string; position: Position }>;
  userName: string;
  position: Position;
  personal: PersonalMatchPerformance;
  timeline: MatchTimelineEvent[];
  outcome: 'WIN' | 'DRAW' | 'LOSS';
  opponentGoals: number;
}

/**
 * Match ratings for the athlete's side (the original shows a rating per player).
 * Teammates get 6.0–7.0 plus goals, assists, the result, and clean sheets; the
 * athlete keeps the engine's own rating, and the MVP flag decides who rates highest.
 */
export function buildMatchRatings(input: RatingInput): Array<{ name: string; position: Position; rating: number; user?: boolean }> {
  const rng = new SeededRandom(stableHash(`${input.seed}:ratings`));
  const goals = input.timeline.filter((event) => event.kind === 'GOAL' && event.side === 'TEAM');
  const result = input.outcome === 'WIN' ? 0.3 : input.outcome === 'LOSS' ? -0.3 : 0;
  const ratings: Array<{ name: string; position: Position; rating: number; user?: boolean }> = input.squad.map((player) => {
    const name = escapeMarkdown(player.name);
    const scored = goals.filter((event) => event.actor === name).length;
    const assisted = goals.filter((event) => event.assist === name).length;
    const cleanSheet = input.opponentGoals === 0 && (player.position === 'GK' || player.position === 'DF') ? 0.4 : 0;
    const keeper = player.position === 'GK' ? -0.2 * input.opponentGoals : 0;
    return { name, position: player.position, rating: clamp(6 + rng.next() + result + scored * 0.8 + assisted * 0.4 + cleanSheet + keeper, 4.5, 9.6) };
  });
  if (input.personal.played) {
    const userRating = input.personal.rating;
    const best = Math.max(0, ...ratings.map((item) => item.rating));
    if (input.personal.mvp) for (const item of ratings) item.rating = Math.min(item.rating, userRating - 0.1);
    else if (best <= userRating && ratings.length) ratings.reduce((top, item) => item.rating > top.rating ? item : top, ratings[0]).rating = Math.min(10, userRating + 0.1);
    ratings.push({ name: escapeMarkdown(input.userName), position: input.position, rating: userRating, user: true });
  }
  return ratings.map((item) => ({ ...item, rating: Math.round(item.rating * 10) / 10 })).sort((a, b) => b.rating - a.rating);
}
