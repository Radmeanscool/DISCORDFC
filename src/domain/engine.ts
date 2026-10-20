import { GAME_BALANCE } from '../config/game-balance.js';
import { RECOVERY_CLUBS } from '../config/recovery-data.js';
import { calculatePlayerRating, opponentRatingFor, personalMatchRewards, simulatePersonalPerformance, simulatePlayerGoals, trainingExpFor, PLAYER_FORMULA_VERSION } from './player-formulas.js';
import { distributeSkillExp, MACRO_SKILL_WEIGHTS } from './skill-engine.js';
import {
  ABILITY_LABELS,
  DETAILED_SKILLS,
  deriveMacroStats,
  normalizeDetailedSkills,
  type AbilityId,
  type AbilityState,
  type CareerStats,
  type DetailedSkills,
  type DetailedSkillId,
  type MatchOutcome,
  type MatchRecord,
  type MatchResult,
  type PlayerProfile,
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

const ABILITIES: AbilityId[] = ['atk', 'def', 'speed', 'power', 'strength', 'technique'];
const HOUR_MS = 3_600_000;

export function initialDetailedSkills(position: Position): DetailedSkills {
  const presets: Record<Position, Record<DetailedSkillId, number>> = {
    GK: { shots: 20, penalty: 25, header: 45, pass: 52, dribbling: 30, freeKick: 20, offBallRunning: 25, holdOffDefenders: 62, teamwork: 60, endurance: 58, speed: 35, willpower: 60 },
    DF: { shots: 32, penalty: 25, header: 62, pass: 45, dribbling: 38, freeKick: 20, offBallRunning: 35, holdOffDefenders: 66, teamwork: 60, endurance: 60, speed: 48, willpower: 55 },
    MF: { shots: 48, penalty: 35, header: 35, pass: 68, dribbling: 62, freeKick: 45, offBallRunning: 58, holdOffDefenders: 45, teamwork: 68, endurance: 52, speed: 57, willpower: 58 },
    FW: { shots: 70, penalty: 55, header: 75, pass: 55, dribbling: 60, freeKick: 50, offBallRunning: 70, holdOffDefenders: 50, teamwork: 50, endurance: 45, speed: 55, willpower: 60 }
  };
  return Object.fromEntries(Object.entries(presets[position]).map(([skill, level]) => [skill, { level, exp: 0 }])) as DetailedSkills;
}

const MATCH_ENERGY_COST = GAME_BALANCE.match.energyCost;
const MATCH_HP_COST = GAME_BALANCE.match.hpCost;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isoNow(now: Date): string {
  return now.toISOString();
}

function defaultAbilities(): Record<AbilityId, AbilityState> {
  return Object.fromEntries(ABILITIES.map((id) => [id, { level: 1, exp: 0 }])) as Record<AbilityId, AbilityState>;
}

/**
 * Birthplaces offered at creation. Recordings list China, Argentina, Brazil,
 * England, Spain, Italy, Germany, France, Malaysia, and Others; Indonesia is
 * added for this community. Nationality is for national-team tournaments only.
 */
export const NATIONALITIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'IDN', label: '🇮🇩 Indonesia' },
  { code: 'ENG', label: '🏴 Inggris' },
  { code: 'ESP', label: '🇪🇸 Spanyol' },
  { code: 'ITA', label: '🇮🇹 Italia' },
  { code: 'GER', label: '🇩🇪 Jerman' },
  { code: 'FRA', label: '🇫🇷 Prancis' },
  { code: 'BRA', label: '🇧🇷 Brasil' },
  { code: 'ARG', label: '🇦🇷 Argentina' },
  { code: 'CHN', label: '🇨🇳 China' },
  { code: 'MAS', label: '🇲🇾 Malaysia' },
  { code: 'OTH', label: '🌍 Lainnya' }
];

/**
 * Recordings show a 15-year-old free player signing with a third-tier club
 * (US Boulogne, or a side whose rivals are Sete, Béziers, and Evian — all in
 * recovered league 10x3). The club is drawn at random from every third tier.
 * Names that appear in two leagues are skipped so name lookups stay unambiguous.
 */
export function randomStarterClub(rng: RandomSource): string {
  const counts = new Map<string, number>();
  for (const club of RECOVERY_CLUBS) counts.set(club.nameEn, (counts.get(club.nameEn) ?? 0) + 1);
  const pool = RECOVERY_CLUBS.filter((club) => /^10[1-5]3$/.test(String(club.league)) && counts.get(club.nameEn) === 1);
  return pool.length ? pool[Math.floor(rng.next() * pool.length)].nameEn : starterClubName();
}

/** Skill values at the start of a career generation, the reference for displayed levels. */
export function skillBaseFrom(detailedSkills: DetailedSkills): Record<DetailedSkillId, number> {
  return Object.fromEntries(DETAILED_SKILLS.map((skill) => [skill, detailedSkills[skill].level])) as Record<DetailedSkillId, number>;
}

export function starterClubName(): string {
  const starter = RECOVERY_CLUBS
    .filter((club) => club.league === 1011)
    .sort((a, b) => b.grade - a.grade || a.prestige - b.prestige || a.id - b.id)[0];
  return starter?.nameEn ?? 'Rising City FC';
}

function cloneProfile(profile: PlayerProfile): PlayerProfile {
  return structuredClone(profile);
}

/**
 * Real-time recovery. `lastActionAt` is the recovery clock: it only advances by
 * the whole hours that were credited, so frequent saves or maintenance ticks
 * shorter than an hour no longer discard the fractional time.
 */
export function applyTimeRecovery(profile: PlayerProfile, now: Date): boolean {
  const last = new Date(profile.lastActionAt).getTime();
  if (!Number.isFinite(last)) {
    profile.lastActionAt = isoNow(now);
    return true;
  }
  const elapsedHours = Math.floor(Math.max(0, now.getTime() - last) / HOUR_MS);
  if (elapsedHours <= 0) return false;
  const hpBefore = profile.hp;
  const energyBefore = profile.energy;
  profile.hp = clamp(profile.hp + elapsedHours * GAME_BALANCE.recovery.hpPerHour, 0, profile.maxHp);
  profile.energy = clamp(profile.energy + elapsedHours * GAME_BALANCE.recovery.energyPerHour, 0, profile.maxEnergy);
  profile.lastActionAt = new Date(last + elapsedHours * HOUR_MS).toISOString();
  return profile.hp !== hpBefore || profile.energy !== energyBefore;
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
}

export function createInitialProfile(userId: string, displayName: string, position: Position, now = new Date()): PlayerProfile {
  const timestamp = isoNow(now);
  const detailedSkills = initialDetailedSkills(position);
  return {
    version: 0,
    userId,
    displayName,
    createdAt: timestamp,
    updatedAt: timestamp,
    age: 15,
    position,
    club: starterClubName(),
    money: 1_000,
    hp: 100,
    maxHp: 100,
    energy: 100,
    maxEnergy: 100,
    level: 1,
    totalExp: 0,
    stats: deriveMacroStats(detailedSkills),
    skillBase: skillBaseFrom(detailedSkills),
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
      seasonScore: 0,
      redCards: 0,
      mvps: 0,
      championsGoals: 0
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
    detailedSkills,
    unassignedMatchExp: 0,
    charm: 0,
    unlockedTricks: [],
    honors: []
  };
}

export function getRating(profile: PlayerProfile): number {
  return calculateRating(profile);
}

/**
 * Regular Training: the selected macro ability is trained through its detailed
 * skills, so the gain persists after macro stats are re-derived. One session per week.
 */
export function trainPlayer(profileInput: PlayerProfile, ability: AbilityId, now = new Date(), rng: RandomSource = new MathRandomSource()): TrainResult {
  const profile = cloneProfile(profileInput);
  applyTimeRecovery(profile, now);
  if (!ABILITIES.includes(ability)) throw new Error(`Unknown ability: ${ability}`);
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun. Pilih Rebirth untuk memulai karier baru.');
  if ((profile.injury?.weeksRemaining ?? 0) > 0) throw new Error('Pemain cedera dan harus memulihkan diri sebelum latihan.');
  const week = Math.max(1, profile.careerWeek ?? 1);
  if (profile.regularTrainingWeek === week) throw new Error('Regular Training minggu ini sudah dilakukan. Lanjutkan dengan Next Week.');
  if (profile.energy < GAME_BALANCE.training.energyCost) throw new Error('Energi tidak cukup. Tunggu pemulihan atau lanjutkan ke Weekly Update berikutnya.');
  profile.detailedSkills = normalizeDetailedSkills(profile.detailedSkills, 1);
  const state = profile.abilities[ability];
  const statBefore = deriveMacroStats(profile.detailedSkills)[ability];
  const expGained = trainingExpFor(rng);
  const applied = distributeSkillExp(profile, MACRO_SKILL_WEIGHTS[ability], expGained);
  const totalApplied = Object.values(applied).reduce((sum, value) => sum + (value ?? 0), 0);
  if (totalApplied <= 0) throw new Error('Semua skill pada latihan ini sudah mencapai level maksimal.');
  profile.energy -= GAME_BALANCE.training.energyCost;
  profile.regularTrainingWeek = week;
  state.exp += totalApplied;
  profile.totalExp += totalApplied;
  profile.stats = deriveMacroStats(profile.detailedSkills);
  const statAfter = profile.stats[ability];
  const levelUp = statAfter > statBefore;
  if (levelUp) state.level += statAfter - statBefore;
  profile.level = Math.max(profile.level, Math.floor(profile.totalExp / 100) + 1);
  profile.updatedAt = isoNow(now);
  return { profile, ability, expGained: totalApplied, levelUp, statBefore, statAfter };
}

/**
 * Standalone friendly/probe match used by calibration tools. Career mode plays
 * club fixtures through player-match-engine; this path never touches club tables.
 */
export function playMatch(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): MatchResult {
  const profile = cloneProfile(profileInput);
  applyTimeRecovery(profile, now);
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun. Pilih Rebirth untuk memulai karier baru.');
  if ((profile.injury?.weeksRemaining ?? 0) > 0) throw new Error(`Pemain sedang cedera selama ${profile.injury!.weeksRemaining} minggu lagi.`);
  if (profile.energy < MATCH_ENERGY_COST) throw new Error('Energi tidak cukup untuk pertandingan.');
  if (profile.hp < MATCH_HP_COST) throw new Error('HP pemain terlalu rendah untuk pertandingan.');
  profile.detailedSkills = normalizeDetailedSkills(profile.detailedSkills, 1);

  const playerRating = calculateRating(profile);
  const ownClub = RECOVERY_CLUBS.find((club) => club.nameEn === profile.club);
  const poolLeague = ownClub?.league ?? 1011;
  const opponentPool = RECOVERY_CLUBS.filter((club) => club.nameEn !== profile.club && club.league === poolLeague);
  const opponentClub = opponentPool[(profile.league.matchday - 1) % Math.max(1, opponentPool.length)];
  const opponent = opponentClub?.nameEn ?? `League opponent ${profile.league.matchday}`;
  const opponentRating = opponentRatingFor(opponentClub?.grade, opponentClub?.prestige, rng);
  const teamRating = ownClub ? opponentRatingFor(ownClub.grade, ownClub.prestige, rng) : playerRating;
  const playerGoals = simulatePlayerGoals(teamRating + 4, opponentRating, rng);
  const opponentGoals = simulatePlayerGoals(opponentRating, teamRating, rng);
  const outcome = outcomeFromScore(playerGoals, opponentGoals);
  const personal = simulatePersonalPerformance({ position: profile.position, skills: profile.detailedSkills, playerRating, squadAverage: teamRating, opponentStrength: opponentRating, teamGoals: playerGoals, opponentGoals, outcome, trickBonus: 0 }, rng);
  const possession = clamp(Math.round(50 + (teamRating - opponentRating) / 3 + (rng.next() - 0.5) * 10), 25, 75);
  const opponentPossession = 100 - possession;
  const shots = clamp(Math.max(playerGoals, Math.round(6 + teamRating / 12 + rng.next() * 5)), 3, 30);
  const opponentShots = clamp(Math.max(opponentGoals, Math.round(6 + opponentRating / 12 + rng.next() * 5)), 3, 30);
  const shotsOnTarget = clamp(Math.max(playerGoals, Math.round(shots * clamp(0.28 + (teamRating - opponentRating) / 300, 0.18, 0.68))), 0, shots);
  const opponentShotsOnTarget = clamp(Math.max(opponentGoals, Math.round(opponentShots * clamp(0.28 + (opponentRating - teamRating) / 300, 0.18, 0.68))), 0, opponentShots);
  const corners = clamp(Math.round(1 + shots / 5 + rng.next() * 3), 0, 12);
  const opponentCorners = clamp(Math.round(1 + opponentShots / 5 + rng.next() * 3), 0, 12);
  const reward = personalMatchRewards(outcome, personal);
  const record: MatchRecord = {
    id: `${profile.userId}-${now.getTime()}`,
    createdAt: isoNow(now),
    opponent,
    opponentRating,
    playerRating,
    outcome,
    playerGoals,
    opponentGoals,
    playerScore: personal.rating,
    rewards: reward,
    stats: { possession, opponentPossession, shots, opponentShots, shotsOnTarget, opponentShotsOnTarget, corners, opponentCorners },
    week: profile.careerWeek ?? profile.league.matchday,
    formulaVersion: PLAYER_FORMULA_VERSION,
    personal,
    competition: 'LEAGUE',
    teamName: profile.club
  };

  profile.energy -= MATCH_ENERGY_COST;
  profile.hp = clamp(profile.hp - MATCH_HP_COST, 0, profile.maxHp);
  profile.money += reward.money;
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-MATCH-${now.getTime()}-${profile.ledger.length}`, createdAt: isoNow(now), type: 'MATCH_REWARD', amount: reward.money, balanceAfter: profile.money, note: `Match reward vs ${opponent}` });
  profile.ledger = profile.ledger.slice(0, 100);
  // Career EXP is earned at the match result; the detailed skill destination
  // remains pending until the user assigns the observed "Exp left" pool.
  profile.totalExp += reward.exp;
  profile.unassignedMatchExp = (profile.unassignedMatchExp ?? 0) + reward.exp;
  profile.career.appearances += 1;
  profile.career.goals += personal.goals;
  profile.career.assists += personal.assists;
  profile.career.yellowCards += personal.yellowCard ? 1 : 0;
  profile.career.redCards = (profile.career.redCards ?? 0) + (personal.redCard ? 1 : 0);
  profile.career.mvps = (profile.career.mvps ?? 0) + (personal.mvp ? 1 : 0);
  profile.career.cleanSheets += personal.cleanSheet ? 1 : 0;
  profile.career.seasonScore = Number((profile.career.seasonScore + personal.rating).toFixed(2));
  if (outcome === 'WIN') profile.career.wins += 1;
  if (outcome === 'DRAW') profile.career.draws += 1;
  if (outcome === 'LOSS') profile.career.losses += 1;
  updateLeague(profile, outcome, playerGoals, opponentGoals);
  profile.updatedAt = isoNow(now);
  profile.lastMatch = record;

  const narrative = [
    `${profile.displayName} tampil untuk ${profile.club} melawan ${opponent}.`,
    `Skor akhir ${playerGoals}-${opponentGoals}; kekuatan tim ${teamRating} melawan ${opponentRating}.`,
    personal.goals || personal.assists ? `Kontribusi pribadi: ${personal.goals} gol, ${personal.assists} assist.` : 'Belum ada gol atau assist pribadi.',
    `Rating pertandingan: ${personal.rating.toFixed(1)}.`
  ];

  return { record, profile, narrative };
}

export function formatAbility(ability: AbilityId): string {
  return ABILITY_LABELS[ability];
}

export function recoverPlayer(profileInput: PlayerProfile, now = new Date()): PlayerProfile {
  const profile = cloneProfile(profileInput);
  if (applyTimeRecovery(profile, now)) profile.updatedAt = isoNow(now);
  return profile;
}
