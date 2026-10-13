import { GAME_BALANCE } from '../config/game-balance.js';
import { RECOVERY_CLUBS } from '../config/recovery-data.js';
import { calculatePlayerRating, opponentRatingFor, playerMatchRewardFor, playerMatchScoreFor, simulatePlayerGoals, trainingExpFor, PLAYER_FORMULA_VERSION } from './player-formulas.js';
import {
  ABILITY_LABELS,
  type AbilityId,
  type AbilityState,
  type CareerStats,
  type DetailedSkills,
  type DetailedSkillId,
  type MatchOutcome,
  type MatchRecord,
  type MatchResult,
  type PlayerProfile,
  type PlayerStats,
  type Position,
  type TrainResult
} from './types.js';

export interface RandomSource {
  next(): number;
}

export class MathRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }
}

export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }
}

const DEFAULT_STATS: Record<Position, PlayerStats> = {
  GK: { atk: 25, def: 62, speed: 35, power: 48, strength: 55, technique: 46 },
  DF: { atk: 36, def: 62, speed: 48, power: 54, strength: 58, technique: 43 },
  MF: { atk: 51, def: 51, speed: 57, power: 46, strength: 45, technique: 61 },
  FW: { atk: 65, def: 31, speed: 60, power: 62, strength: 50, technique: 57 }
};

const ABILITIES: AbilityId[] = ['atk', 'def', 'speed', 'power', 'strength', 'technique'];

function initialDetailedSkills(position: Position): DetailedSkills {
  const presets: Record<Position, Record<DetailedSkillId, number>> = {
    GK: { shots: 20, penalty: 25, header: 45, pass: 52, dribbling: 30, freeKick: 20, offBallRunning: 25, holdOffDefenders: 62, teamwork: 60, endurance: 58, speed: 35, willpower: 60 },
    DF: { shots: 32, penalty: 25, header: 62, pass: 45, dribbling: 38, freeKick: 20, offBallRunning: 35, holdOffDefenders: 66, teamwork: 60, endurance: 60, speed: 48, willpower: 55 },
    MF: { shots: 48, penalty: 35, header: 35, pass: 68, dribbling: 62, freeKick: 45, offBallRunning: 58, holdOffDefenders: 45, teamwork: 68, endurance: 52, speed: 57, willpower: 58 },
    FW: { shots: 70, penalty: 55, header: 75, pass: 55, dribbling: 60, freeKick: 50, offBallRunning: 70, holdOffDefenders: 50, teamwork: 50, endurance: 45, speed: 55, willpower: 60 }
  };
  return Object.fromEntries(Object.entries(presets[position]).map(([skill, level]) => [skill, { level, exp: 0 }])) as DetailedSkills;
}

const TRAINING_COST = GAME_BALANCE.training.energyCost;
const MATCH_ENERGY_COST = GAME_BALANCE.match.energyCost;
const MATCH_HP_COST = GAME_BALANCE.match.hpCost;
const MAX_MATCH_GOALS = GAME_BALANCE.match.maxGoals;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isoNow(now: Date): string {
  return now.toISOString();
}

function nextAbilityExp(level: number): number {
  return Math.max(50, level * 100);
}

function defaultAbilities(): Record<AbilityId, AbilityState> {
  return Object.fromEntries(ABILITIES.map((id) => [id, { level: 1, exp: 0 }])) as Record<AbilityId, AbilityState>;
}

function cloneProfile(profile: PlayerProfile): PlayerProfile {
  return structuredClone(profile);
}

function recover(profile: PlayerProfile, now: Date): void {
  const elapsedMs = Math.max(0, now.getTime() - new Date(profile.lastActionAt).getTime());
  const elapsedHours = Math.floor(elapsedMs / 3_600_000);
  if (elapsedHours <= 0) return;
  profile.hp = clamp(profile.hp + elapsedHours * GAME_BALANCE.recovery.hpPerHour, 0, profile.maxHp);
  profile.energy = clamp(profile.energy + elapsedHours * GAME_BALANCE.recovery.energyPerHour, 0, profile.maxEnergy);
}

function calculateRating(profile: PlayerProfile): number {
  return calculatePlayerRating(profile);
}

function outcomeFromScore(forGoals: number, againstGoals: number): MatchOutcome {
  if (forGoals > againstGoals) return 'WIN';
  if (forGoals < againstGoals) return 'LOSS';
  return 'DRAW';
}

function updateLeague(profile: PlayerProfile, outcome: MatchOutcome, goalsFor: number, goalsAgainst: number): void {
  profile.league.matchday += 1;
  profile.league.goalsFor += goalsFor;
  profile.league.goalsAgainst += goalsAgainst;
  if (outcome === 'WIN') {
    profile.league.wins += 1;
    profile.league.points += 3;
  } else if (outcome === 'DRAW') {
    profile.league.draws += 1;
    profile.league.points += 1;
  } else {
    profile.league.losses += 1;
  }
  if (profile.league.matchday > 10) {
    profile.league.season += 1;
    profile.league.matchday = 1;
    profile.league.points = 0;
    profile.league.wins = 0;
    profile.league.draws = 0;
    profile.league.losses = 0;
    profile.league.goalsFor = 0;
    profile.league.goalsAgainst = 0;
  }
}

export function createInitialProfile(userId: string, displayName: string, position: Position, now = new Date()): PlayerProfile {
  const timestamp = isoNow(now);
  const stats = structuredClone(DEFAULT_STATS[position]);
  return {
    version: 0,
    userId,
    displayName,
    createdAt: timestamp,
    updatedAt: timestamp,
    age: 15,
    position,
    club: RECOVERY_CLUBS.find((club) => club.league === 1011)?.nameEn ?? 'Rising City FC',
    money: 1_000,
    hp: 100,
    maxHp: 100,
    energy: 100,
    maxEnergy: 100,
    level: 1,
    totalExp: 0,
    stats,
    abilities: defaultAbilities(),
    career: {
      appearances: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals: 0,
      assists: 0,
      steals: 0,
      cleanSheets: 0,
      yellowCards: 0,
      injuries: 0,
      seasonScore: 0
    } satisfies CareerStats,
    league: {
      season: 1,
      matchday: 1,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0
    },
    lastActionAt: timestamp,
    mode: 'PLAYER',
    careerStatus: 'ACTIVE',
    careerYear: 1,
    careerWeek: 1,
    seasonWeek: 1,
    weekStage: 'READY',
    rebirthCount: 0,
    detailedSkills: initialDetailedSkills(position),
    unassignedMatchExp: 0,
    charm: 0,
    unlockedTricks: [],
    honors: []
  };
}

export function getRating(profile: PlayerProfile): number {
  return calculateRating(profile);
}

export function trainPlayer(profileInput: PlayerProfile, ability: AbilityId, now = new Date(), rng: RandomSource = new MathRandomSource()): TrainResult {
  const profile = cloneProfile(profileInput);
  recover(profile, now);
  if (!ABILITIES.includes(ability)) throw new Error(`Unknown ability: ${ability}`);
  if (profile.energy < TRAINING_COST) throw new Error('Energi tidak cukup. Tunggu pemulihan atau gunakan perintah /rest pada fase berikutnya.');

  const state = profile.abilities[ability];
  const statBefore = profile.stats[ability];
  const expGained = GAME_BALANCE.training.expMin + Math.floor(rng.next() * (GAME_BALANCE.training.expMaxExclusive - GAME_BALANCE.training.expMin));
  profile.energy -= TRAINING_COST;
  state.exp += expGained;
  profile.totalExp += expGained;
  let levelUp = false;
  while (state.exp >= nextAbilityExp(state.level)) {
    state.exp -= nextAbilityExp(state.level);
    state.level += 1;
    profile.stats[ability] = clamp(profile.stats[ability] + 1, 1, 99);
    profile.level = Math.max(profile.level, Math.floor(profile.totalExp / 100) + 1);
    levelUp = true;
  }
  profile.updatedAt = isoNow(now);
  profile.lastActionAt = isoNow(now);
  return {
    profile,
    ability,
    expGained,
    levelUp,
    statBefore,
    statAfter: profile.stats[ability]
  };
}

export function playMatch(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): MatchResult {
  const profile = cloneProfile(profileInput);
  recover(profile, now);
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun. Gunakan /rebirth untuk memulai karier baru.');
  if ((profile.injury?.weeksRemaining ?? 0) > 0) throw new Error(`Pemain sedang cedera selama ${profile.injury!.weeksRemaining} minggu lagi.`);
  if (profile.energy < MATCH_ENERGY_COST) throw new Error('Energi tidak cukup untuk pertandingan.');
  if (profile.hp < MATCH_HP_COST) throw new Error('HP pemain terlalu rendah untuk pertandingan.');

  const playerRating = calculateRating(profile);
  const opponentPool = RECOVERY_CLUBS.filter((club) => club.nameEn !== profile.club && club.league === 1011);
  const opponentClub = opponentPool[(profile.league.matchday - 1) % Math.max(1, opponentPool.length)];
  // Official club identity is recovered; opponent strength remains
  // RECOVERY_INFERRED because the authoritative server formula is unavailable.
  const opponent = opponentClub?.nameEn ?? `League opponent ${profile.league.matchday}`;
  const opponentRating = opponentRatingFor(opponentClub?.grade, opponentClub?.prestige, rng);
  const playerGoals = simulatePlayerGoals(playerRating + 8, opponentRating, rng);
  const opponentGoals = simulatePlayerGoals(opponentRating, playerRating + 2, rng);
  const outcome = outcomeFromScore(playerGoals, opponentGoals);
  const playerScore = playerMatchScoreFor(playerGoals, opponentGoals, rng);
  const possession = clamp(Math.round(50 + (playerRating - opponentRating) / 3 + (rng.next() - 0.5) * 10), 25, 75);
  const opponentPossession = 100 - possession;
  const shots = clamp(Math.round(6 + playerRating / 12 + rng.next() * 5), 3, 30);
  const opponentShots = clamp(Math.round(6 + opponentRating / 12 + rng.next() * 5), 3, 30);
  const shotsOnTarget = clamp(Math.round(shots * clamp(0.28 + (playerRating - opponentRating) / 300, 0.18, 0.68)), 1, shots);
  const opponentShotsOnTarget = clamp(Math.round(opponentShots * clamp(0.28 + (opponentRating - playerRating) / 300, 0.18, 0.68)), 1, opponentShots);
  const corners = clamp(Math.round(1 + shots / 5 + rng.next() * 3), 0, 12);
  const opponentCorners = clamp(Math.round(1 + opponentShots / 5 + rng.next() * 3), 0, 12);
  const reward = playerMatchRewardFor(outcome);
  const exp = reward.exp;
  const money = reward.money;
  const record: MatchRecord = {
    id: `${profile.userId}-${now.getTime()}`,
    createdAt: isoNow(now),
    opponent,
    opponentRating,
    playerRating,
    outcome,
    playerGoals,
    opponentGoals,
    playerScore,
    rewards: { money, exp },
    stats: { possession, opponentPossession, shots, opponentShots, shotsOnTarget, opponentShotsOnTarget, corners, opponentCorners },
    week: profile.careerWeek ?? profile.league.matchday,
    formulaVersion: PLAYER_FORMULA_VERSION
  };

  profile.energy -= MATCH_ENERGY_COST;
  profile.hp = clamp(profile.hp - MATCH_HP_COST, 0, profile.maxHp);
  profile.money += money;
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-MATCH-${now.getTime()}-${profile.ledger.length}`, createdAt: isoNow(now), type: 'MATCH_REWARD', amount: money, balanceAfter: profile.money, note: `Match reward vs ${opponent}` });
  profile.ledger = profile.ledger.slice(0, 100);
  // Career EXP is earned at the match result; the detailed skill destination
  // remains pending until the user assigns the observed "Exp left" pool.
  profile.totalExp += exp;
  profile.unassignedMatchExp = (profile.unassignedMatchExp ?? 0) + exp;
  profile.career.appearances += 1;
  profile.career.goals += playerGoals;
  profile.career.assists += playerGoals > 0 && rng.next() < 0.45 ? 1 : 0;
  profile.career.steals += profile.position === 'DF' || profile.position === 'MF' ? Math.floor(rng.next() * 2) : 0;
  profile.career.yellowCards += rng.next() < 0.08 ? 1 : 0;
  profile.career.cleanSheets += opponentGoals === 0 ? 1 : 0;
  profile.career.seasonScore = Number((profile.career.seasonScore + playerScore).toFixed(2));
  if (outcome === 'WIN') profile.career.wins += 1;
  if (outcome === 'DRAW') profile.career.draws += 1;
  if (outcome === 'LOSS') profile.career.losses += 1;
  updateLeague(profile, outcome, playerGoals, opponentGoals);
  profile.updatedAt = isoNow(now);
  profile.lastActionAt = isoNow(now);
  profile.lastMatch = record;

  const narrative = [
    `${profile.displayName} tampil untuk ${profile.club}.`,
    `Penguasaan pertandingan dipengaruhi rating tim ${playerRating} melawan ${opponentRating}.`,
    playerGoals > 0 ? `Kontribusi serangan menghasilkan ${playerGoals} gol.` : 'Belum ada gol yang tercipta dari sisi pemain.',
    `Skor penampilan pemain: ${playerScore.toFixed(2)}.`
  ];

  return { record, profile, narrative };
}

export function formatAbility(ability: AbilityId): string {
  return ABILITY_LABELS[ability];
}

export function recoverPlayer(profileInput: PlayerProfile, now = new Date()): PlayerProfile {
  const profile = cloneProfile(profileInput);
  recover(profile, now);
  profile.updatedAt = isoNow(now);
  profile.lastActionAt = isoNow(now);
  return profile;
}
