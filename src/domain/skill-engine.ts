import { GAME_BALANCE } from '../config/game-balance.js';
import { skillLevelCost } from './player-formulas.js';
import type { AbilityId, DetailedSkillId, PlayerProfile } from './types.js';

/** Detailed skills behind each macro ability, weighted like deriveMacroStats. */
export const MACRO_SKILL_WEIGHTS: Record<AbilityId, Partial<Record<DetailedSkillId, number>>> = {
  atk: { shots: 2, dribbling: 1, offBallRunning: 1 },
  def: { holdOffDefenders: 2, teamwork: 1, endurance: 1 },
  speed: { speed: 2, offBallRunning: 1, dribbling: 1 },
  power: { header: 1, holdOffDefenders: 1, endurance: 1, shots: 1 },
  strength: { holdOffDefenders: 2, endurance: 1, willpower: 1 },
  technique: { pass: 1, dribbling: 2, freeKick: 1 }
};

export function isSkillMaxed(profile: PlayerProfile, skill: DetailedSkillId): boolean {
  return (profile.detailedSkills?.[skill]?.level ?? 1) >= GAME_BALANCE.skillProgression.maxLevel;
}

/** Applies EXP up to the level cap. Returns levels gained and the EXP actually used. */
export function grantSkillExp(profile: PlayerProfile, skill: DetailedSkillId, amount: number): { levels: number; applied: number } {
  const state = profile.detailedSkills?.[skill];
  if (!state || amount <= 0) return { levels: 0, applied: 0 };
  const maxLevel = GAME_BALANCE.skillProgression.maxLevel;
  if (state.level >= maxLevel) {
    state.level = maxLevel;
    state.exp = 0;
    return { levels: 0, applied: 0 };
  }
  let remaining = Math.floor(amount);
  let applied = 0;
  let levels = 0;
  while (remaining > 0 && state.level < maxLevel) {
    const needed = skillLevelCost(state.level) - state.exp;
    if (remaining < needed) {
      state.exp += remaining;
      applied += remaining;
      remaining = 0;
      break;
    }
    remaining -= needed;
    applied += needed;
    state.level += 1;
    state.exp = 0;
    levels += 1;
  }
  if (state.level >= maxLevel) state.exp = 0;
  return { levels, applied };
}

/** Splits EXP across weighted skills, skipping maxed ones. Returns per-skill applied EXP. */
export function distributeSkillExp(profile: PlayerProfile, weights: Partial<Record<DetailedSkillId, number>>, amount: number): Partial<Record<DetailedSkillId, number>> {
  const eligible = (Object.entries(weights) as Array<[DetailedSkillId, number]>).filter(([skill, weight]) => weight > 0 && !isSkillMaxed(profile, skill));
  const result: Partial<Record<DetailedSkillId, number>> = {};
  const totalWeight = eligible.reduce((sum, [, weight]) => sum + weight, 0);
  if (!eligible.length || totalWeight <= 0 || amount <= 0) return result;
  let assigned = 0;
  eligible.forEach(([skill, weight], index) => {
    const share = index === eligible.length - 1 ? amount - assigned : Math.floor((amount * weight) / totalWeight);
    assigned += share;
    result[skill] = grantSkillExp(profile, skill, share).applied;
  });
  return result;
}

/** Late-career physical decline applied at each season end from age 31. */
export function applyAgeDecline(profile: PlayerProfile): string | undefined {
  if (!profile.detailedSkills || profile.age < 31) return undefined;
  const amount = profile.age >= 33 ? 3 : 2;
  const declined: DetailedSkillId[] = ['speed', 'endurance', 'offBallRunning'];
  for (const skill of declined) {
    const state = profile.detailedSkills[skill];
    state.level = Math.max(1, state.level - (skill === 'offBallRunning' ? amount - 1 : amount));
    state.exp = 0;
  }
  return `Usia ${profile.age}: kondisi fisik menurun (Speed, Endurance, Off-ball Running).`;
}
