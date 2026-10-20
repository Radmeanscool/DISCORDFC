import { GAME_BALANCE } from '../config/game-balance.js';
import type { RandomSource } from './engine.js';
import type { AbilityId, DetailedSkillId, DetailedSkills, MatchOutcome, PersonalMatchPerformance, PlayerProfile, Position } from './types.js';

/**
 * This is a calibrated/inferred ruleset until controlled observations from the
 * original client are available. Historical match records must keep this id.
 */
export const PLAYER_FORMULA_VERSION = 'player-formula-inferred-2026-10';

const RATING_WEIGHTS: Record<PlayerProfile['position'], Array<[DetailedSkillId, number]>> = {
  GK: [['willpower', 0.25], ['teamwork', 0.2], ['pass', 0.2], ['endurance', 0.2], ['header', 0.15]],
  DF: [['holdOffDefenders', 0.3], ['teamwork', 0.2], ['endurance', 0.2], ['header', 0.15], ['pass', 0.15]],
  MF: [['pass', 0.28], ['dribbling', 0.22], ['teamwork', 0.2], ['offBallRunning', 0.15], ['endurance', 0.15]],
  FW: [['shots', 0.25], ['offBallRunning', 0.2], ['dribbling', 0.18], ['header', 0.14], ['holdOffDefenders', 0.13], ['speed', 0.1]]
};

const MACRO_WEIGHTS: Record<PlayerProfile['position'], AbilityId[]> = {
  GK: ['def', 'strength', 'technique', 'power'],
  DF: ['def', 'strength', 'speed', 'technique'],
  MF: ['technique', 'speed', 'atk', 'def'],
  FW: ['atk', 'technique', 'speed', 'power']
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ratingSkillsFor(position: Position): DetailedSkillId[] {
  return RATING_WEIGHTS[position].map(([skill]) => skill);
}

/** Rating is driven by detailed skills only; career level is a display stat, not a rating input. */
export function calculatePlayerRating(profile: Pick<PlayerProfile, 'position' | 'detailedSkills' | 'stats' | 'level'>): number {
  const shares = GAME_BALANCE.rating;
  if (profile.detailedSkills) {
    const weighted = RATING_WEIGHTS[profile.position].reduce(
      (sum, [skill, weight]) => sum + (profile.detailedSkills?.[skill]?.level ?? 1) * weight,
      0
    );
    const average = Object.values(profile.detailedSkills).reduce((sum, state) => sum + state.level, 0) / Math.max(1, Object.keys(profile.detailedSkills).length);
    return Math.round(clamp(weighted * shares.weightedShare + average * shares.averageShare, 1, 99));
  }

  const primary = MACRO_WEIGHTS[profile.position];
  const weighted = primary.reduce((sum, key, index) => sum + profile.stats[key] * (4 - index), 0) / 10;
  const secondary = Object.values(profile.stats).reduce((sum, value) => sum + value, 0) / 6;
  return Math.round(clamp(weighted * shares.weightedShare + secondary * shares.averageShare, 1, 99));
}

/** EXP needed to go from `level` to `level + 1`; steeper above the elite threshold. */
export function skillLevelCost(level: number): number {
  const curve = GAME_BALANCE.skillProgression;
  return Math.max(1, Math.round(curve.baseExp + level * curve.perLevel + Math.max(0, level - curve.eliteThreshold) * curve.elitePerLevel));
}

export function trainingExpFor(rng: RandomSource): number {
  return GAME_BALANCE.training.expMin + Math.floor(rng.next() * (GAME_BALANCE.training.expMaxExclusive - GAME_BALANCE.training.expMin));
}

export function detailedTrainingExpFor(rng: RandomSource): number {
  return GAME_BALANCE.detailedTraining.expMin + Math.floor(rng.next() * (GAME_BALANCE.detailedTraining.expMaxExclusive - GAME_BALANCE.detailedTraining.expMin));
}

export function simulatePlayerGoals(attack: number, defence: number, rng: RandomSource): number {
  const pressure = clamp(0.65 + (attack - defence) / 90, 0.2, 1.5);
  let goals = 0;
  for (let attempt = 0; attempt < GAME_BALANCE.competition.attemptsPerTeam; attempt += 1) {
    const chance = clamp(GAME_BALANCE.competition.baseGoalChance * pressure + attempt * 0.015, 0.04, GAME_BALANCE.competition.maxGoalChance);
    if (rng.next() < chance) goals += 1;
  }
  return Math.min(GAME_BALANCE.match.maxGoals, goals);
}

export function opponentRatingFor(officialGrade: number | undefined, prestige: number | undefined, rng: RandomSource): number {
  // Grade 1 is the strongest client grade; prestige rises with club stature.
  return clamp(Math.round(50 + (prestige ?? 0.8) * 18 + (5 - (officialGrade ?? 4)) * 1.5 + rng.next() * 8 - 4), 45, 92);
}

export function playerMatchScoreFor(playerGoals: number, opponentGoals: number, rng: RandomSource): number {
  return Number(clamp(5.5 + (playerGoals - opponentGoals) * 0.45 + rng.next() * 1.1, 4, 9.8).toFixed(2));
}

export function playerMatchRewardFor(outcome: MatchOutcome): { money: number; exp: number } {
  return {
    money: outcome === 'WIN' ? GAME_BALANCE.match.rewardMoney.win : outcome === 'DRAW' ? GAME_BALANCE.match.rewardMoney.draw : GAME_BALANCE.match.rewardMoney.loss,
    exp: outcome === 'WIN' ? GAME_BALANCE.match.rewardExp.win : outcome === 'DRAW' ? GAME_BALANCE.match.rewardExp.draw : GAME_BALANCE.match.rewardExp.loss
  };
}

export interface PersonalPerformanceInput {
  position: Position;
  skills: DetailedSkills;
  playerRating: number;
  squadAverage: number;
  opponentStrength: number;
  teamGoals: number;
  opponentGoals: number;
  outcome: MatchOutcome;
  trickBonus: number;
}

function skill(skills: DetailedSkills, id: DetailedSkillId): number {
  return skills[id]?.level ?? 1;
}

/**
 * Splits the team's goals into the athlete's own goals/assists and derives a
 * 0–10 match rating. A goalkeeper therefore no longer inherits every team goal.
 */
export function simulatePersonalPerformance(input: PersonalPerformanceInput, rng: RandomSource): PersonalMatchPerformance {
  const personal = GAME_BALANCE.personal;
  const finishing = input.position === 'DF' ? (skill(input.skills, 'header') + skill(input.skills, 'shots')) / 2 : (skill(input.skills, 'shots') + skill(input.skills, 'offBallRunning')) / 2;
  const creativity = (skill(input.skills, 'pass') + skill(input.skills, 'dribbling')) / 2;
  const quality = clamp(1 + (input.playerRating - input.squadAverage) / 50, 0.75, 1.35);
  const goalChance = clamp(personal.goalShare[input.position] * clamp(finishing / 70, 0.7, 1.3) * quality * (1 + input.trickBonus), 0, personal.goalShareCap[input.position]);
  const assistChance = clamp(personal.assistShare[input.position] * clamp(creativity / 70, 0.7, 1.3) * quality * (1 + input.trickBonus), 0, 0.4);
  let goals = 0;
  let assists = 0;
  for (let goal = 0; goal < input.teamGoals; goal += 1) {
    if (rng.next() < goalChance) goals += 1;
    else if (rng.next() < assistChance) assists += 1;
  }
  const cleanSheet = input.opponentGoals === 0 && (input.position === 'GK' || input.position === 'DF');
  const yellowCard = rng.next() < personal.yellowCardChance[input.position];
  const redCard = rng.next() < personal.redCardChance;
  let rating = personal.ratingBase
    + (input.outcome === 'WIN' ? 0.45 : input.outcome === 'DRAW' ? 0.05 : -0.35)
    + goals * 0.9
    + assists * 0.55
    + (input.playerRating - input.opponentStrength) / 30
    + input.trickBonus * 4
    + (rng.next() - 0.5) * 1.2;
  if (input.position === 'GK') rating += cleanSheet ? 0.9 : -0.2 * Math.max(0, input.opponentGoals - 1);
  if (input.position === 'DF') rating += cleanSheet ? 0.45 : -0.12 * Math.max(0, input.opponentGoals - 1);
  if (redCard) rating -= 1.5;
  rating = Number(clamp(rating, 3.5, 10).toFixed(1));
  const mvp = rating >= personal.mvpRatingThreshold && (input.outcome !== 'LOSS' || rating >= 9);
  return { played: true, goals, assists, rating, yellowCard, redCard, mvp, cleanSheet };
}

export function personalMatchRewards(outcome: MatchOutcome, performance: PersonalMatchPerformance): { money: number; exp: number } {
  const base = playerMatchRewardFor(outcome);
  if (!performance.played) return { money: 0, exp: 0 };
  const personal = GAME_BALANCE.personal;
  return {
    money: base.money + performance.goals * personal.goalMoneyBonus,
    exp: base.exp + Math.max(0, Math.round((performance.rating - 6.5) * personal.ratingExpBonus * 2)) + performance.goals * 3
  };
}

export interface PlayerFormulaObservation {
  position: PlayerProfile['position'];
  level: number;
  rating: number;
  playerGoals: number;
  opponentGoals: number;
  score: number;
  outcome: MatchOutcome;
  rewardMoney: number;
  rewardExp: number;
  formulaVersion: string;
}

export function makeFormulaObservation(profile: Pick<PlayerProfile, 'position' | 'detailedSkills' | 'stats' | 'level'>, input: Omit<PlayerFormulaObservation, 'rating' | 'formulaVersion'>): PlayerFormulaObservation {
  return {
    ...input,
    rating: calculatePlayerRating(profile),
    formulaVersion: PLAYER_FORMULA_VERSION
  };
}

/**
 * RECOVERY_INFERRED: the original hub shows a player Value. It grows steeply with
 * rating, carries a premium for youth, and falls after 28.
 */
export function playerValue(rating: number, age: number): number {
  const youth = age <= 21 ? 1 + (22 - age) * 0.12 : 1;
  const decline = age > 28 ? Math.pow(0.85, age - 28) : 1;
  return Math.round((10_000 * Math.pow(1.17, rating - 50) * youth * decline) / 1_000) * 1_000;
}
