import { GAME_BALANCE } from '../config/game-balance.js';
import { payWeeklySalary, signContract } from './contract-engine.js';
import { ensureClubState } from './club-engine.js';
import { applyTimeRecovery, createInitialProfile, getRating, initialDetailedSkills, MathRandomSource, randomStarterClub, skillBaseFrom, type RandomSource } from './engine.js';
import { formatMoney } from './format.js';
import { ensureSeasonTracking, finishPlayerSeason, freshSeasonStats, playPlayerFixture } from './player-match-engine.js';
import { withInjuryEvent } from './match-timeline.js';
import { detailedTrainingExpFor, ratingSkillsFor, skillLevelCost } from './player-formulas.js';
import { grantSkillExp, isSkillMaxed } from './skill-engine.js';
import {
  DETAILED_SKILLS,
  DETAILED_SKILL_LABELS,
  TRAINER_CATALOG,
  TRICK_CATALOG,
  clampStat,
  deriveMacroStats,
  normalizeDetailedSkills,
  type CultureSubject,
  type DetailedSkillId,
  type DetailedSkills,
  type ExpAllocationResult,
  type GameplayActionResult,
  type InjurySeverity,
  type PlayerEventChoice,
  type PlayerEventType,
  type PlayerProfile,
  type PlayerSponsorContract,
  type PlayerWeeklyEvent,
  type Position,
  type RetirementState,
  type TrainerState,
  type TreatmentResult,
  type WeekPreparationResult,
  type WeekResult
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function iso(now: Date): string {
  return now.toISOString();
}

function currentWeek(profile: PlayerProfile): number {
  return Math.max(1, profile.careerWeek ?? 1);
}

function currentCareerYear(profile: PlayerProfile): number {
  return Math.max(1, profile.careerYear ?? profile.league.season ?? 1);
}

function legacyToDetailed(profile: PlayerProfile): DetailedSkills {
  const stats = profile.stats;
  const values: Record<DetailedSkillId, number> = {
    shots: stats.atk,
    penalty: stats.atk,
    header: stats.power,
    pass: stats.technique,
    dribbling: stats.technique,
    freeKick: stats.technique,
    offBallRunning: stats.speed,
    holdOffDefenders: stats.strength,
    teamwork: (stats.def + stats.technique) / 2,
    endurance: stats.strength,
    speed: stats.speed,
    willpower: stats.strength
  };
  return Object.fromEntries(Object.entries(values).map(([skill, level]) => [skill, { level: clampStat(level), exp: 0 }])) as DetailedSkills;
}

/** Migrates legacy saves and applies whole-hour real-time recovery before any action. */
export function ensureGameplayState(profileInput: PlayerProfile, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  profile.mode ??= 'PLAYER';
  profile.careerStatus ??= 'ACTIVE';
  profile.careerYear ??= Math.max(1, profile.league.season || 1);
  profile.careerWeek ??= 1;
  profile.seasonWeek ??= Math.max(1, profile.league.matchday || 1);
  profile.weekStage ??= 'READY';
  profile.rebirthCount ??= 0;
  profile.charm ??= 0;
  profile.unassignedMatchExp ??= 0;
  profile.unlockedTricks ??= [];
  profile.honors ??= [];
  profile.detailedSkills = normalizeDetailedSkills(profile.detailedSkills ?? legacyToDetailed(profile), 1);
  profile.skillBase ??= legacySkillBase(profile);
  profile.updatedAt = profile.updatedAt || iso(now);
  profile.lastActionAt = profile.lastActionAt || iso(now);
  applyTimeRecovery(profile, now);
  return profile;
}

/** Saves created before skill levels: the generation started at the position preset plus its rebirth bonus. */
function legacySkillBase(profile: PlayerProfile): Record<DetailedSkillId, number> {
  const bonus = Math.min(GAME_BALANCE.rebirth.maxSkillBonus, (profile.rebirthCount ?? 0) * GAME_BALANCE.rebirth.skillBonusPerRebirth);
  const preset = initialDetailedSkills(profile.position);
  return Object.fromEntries(DETAILED_SKILLS.map((skill) => [skill, Math.min(GAME_BALANCE.skillProgression.maxLevel, preset[skill].level + bonus)])) as Record<DetailedSkillId, number>;
}

/**
 * Displayed skill level: every point gained since this career generation began
 * is one level, so a new athlete starts at Lv 1 everywhere and climbs step by step
 * (recordings show Shots around Lv 12 after twenty matches). The underlying
 * 1–99 value still drives the match engine and rating, unchanged.
 */
export function skillDisplayLevel(profile: Pick<PlayerProfile, 'skillBase' | 'detailedSkills' | 'position' | 'rebirthCount'>, skill: DetailedSkillId): number {
  const value = profile.detailedSkills?.[skill]?.level ?? 1;
  const base = profile.skillBase?.[skill] ?? legacySkillBase(profile as PlayerProfile)[skill];
  return Math.max(1, value - base + 1);
}

/** Highest displayed level for a skill (its value reaches 99). */
export function skillMaxDisplayLevel(profile: Pick<PlayerProfile, 'skillBase' | 'detailedSkills' | 'position' | 'rebirthCount'>, skill: DetailedSkillId): number {
  const base = profile.skillBase?.[skill] ?? legacySkillBase(profile as PlayerProfile)[skill];
  return Math.max(1, GAME_BALANCE.skillProgression.maxLevel - base + 1);
}

function syncMacroStats(profile: PlayerProfile): void {
  profile.stats = deriveMacroStats(profile.detailedSkills!);
  profile.level = Math.max(profile.level, Math.floor(profile.totalExp / 100) + 1);
}

function touch(profile: PlayerProfile, now: Date): PlayerProfile {
  profile.updatedAt = iso(now);
  return profile;
}

function requireActive(profile: PlayerProfile): void {
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun. Pilih Rebirth untuk memulai karier baru.');
}

function requireSkill(skill: string): asserts skill is DetailedSkillId {
  if (!DETAILED_SKILLS.includes(skill as DetailedSkillId)) throw new Error(`Detailed skill tidak dikenal: ${skill}`);
}

export function trainDetailedSkill(profileInput: PlayerProfile, skill: DetailedSkillId, now = new Date(), rng: RandomSource = new MathRandomSource()): { profile: PlayerProfile; skill: DetailedSkillId; expGained: number; levelBefore: number; levelAfter: number; levelsGained: number } {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  requireSkill(skill);
  if ((profile.injury?.weeksRemaining ?? 0) > 0) throw new Error('Pemain cedera dan harus memulihkan diri sebelum latihan skill.');
  if (profile.activeTraining) throw new Error(`Training ${DETAILED_SKILL_LABELS[profile.activeTraining.skill]} masih berjalan sampai week ${profile.activeTraining.completeAtWeek}.`);
  if (isSkillMaxed(profile, skill)) throw new Error(`${DETAILED_SKILL_LABELS[skill]} sudah mencapai level maksimal.`);
  if (profile.energy < GAME_BALANCE.detailedTraining.energyCost) throw new Error('Energi tidak cukup untuk detailed skill training.');
  if (profile.hp < GAME_BALANCE.detailedTraining.hpCost) throw new Error('HP tidak cukup untuk detailed skill training.');
  const state = profile.detailedSkills![skill];
  const levelBefore = state.level;
  const expGained = detailedTrainingExpFor(rng);
  profile.energy -= GAME_BALANCE.detailedTraining.energyCost;
  profile.hp = Math.max(0, profile.hp - GAME_BALANCE.detailedTraining.hpCost);
  profile.activeTraining = {
    skill,
    completeAtWeek: currentWeek(profile) + GAME_BALANCE.detailedTraining.durationWeeks,
    expReward: expGained,
    hpCost: GAME_BALANCE.detailedTraining.hpCost
  };
  touch(profile, now);
  return { profile, skill, expGained, levelBefore, levelAfter: state.level, levelsGained: 0 };
}

export function assignMatchExp(profileInput: PlayerProfile, allocations: Partial<Record<DetailedSkillId, number>>, now = new Date()): ExpAllocationResult {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  const pending = Math.max(0, profile.unassignedMatchExp ?? 0);
  const entries = Object.entries(allocations).filter(([, amount]) => amount !== undefined && amount !== 0) as Array<[string, number]>;
  if (!entries.length) throw new Error('Masukkan minimal satu alokasi EXP.');
  let allocated = 0;
  let levelsGained = 0;
  for (const [skill, amount] of entries) {
    requireSkill(skill);
    if (!Number.isInteger(amount) || amount < 0) throw new Error('Jumlah EXP harus bilangan bulat non-negatif.');
    if (isSkillMaxed(profile, skill)) throw new Error(`${DETAILED_SKILL_LABELS[skill]} sudah level maksimal; pilih skill lain.`);
    allocated += amount;
  }
  if (allocated > pending) throw new Error(`Alokasi EXP melebihi pool. Sisa EXP hanya ${pending}.`);
  let used = 0;
  for (const [skill, amount] of entries) {
    const result = grantSkillExp(profile, skill as DetailedSkillId, amount);
    levelsGained += result.levels;
    used += result.applied;
  }
  // EXP beyond a skill's cap stays in the pool instead of disappearing.
  profile.unassignedMatchExp = pending - used;
  if (profile.unassignedMatchExp === 0 && profile.weekStage === 'EXP_PENDING') profile.weekStage = (profile.seasonWeek ?? 1) === 1 ? 'SEASON_BREAK' : 'READY';
  syncMacroStats(profile);
  touch(profile, now);
  return { profile, allocated: used, remaining: profile.unassignedMatchExp, levelsGained };
}

const EXP_SURPLUS_MONEY_RATE = 2;

/**
 * When every detailed skill is at the cap the pool can never be assigned, so it
 * is converted to money instead of blocking the weekly cycle forever.
 */
export function settleSurplusExp(profile: PlayerProfile, now: Date): string | undefined {
  const pending = Math.max(0, profile.unassignedMatchExp ?? 0);
  if (pending <= 0 || DETAILED_SKILLS.some((skill) => !isSkillMaxed(profile, skill))) return undefined;
  const money = pending * EXP_SURPLUS_MONEY_RATE;
  profile.unassignedMatchExp = 0;
  profile.money += money;
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-EXP_SURPLUS-${now.getTime()}-${profile.ledger.length}`, createdAt: iso(now), type: 'EXP_SURPLUS', amount: money, balanceAfter: profile.money, note: `${pending} EXP surplus (semua skill maksimal)` });
  profile.ledger = profile.ledger.slice(0, 100);
  if (profile.weekStage === 'EXP_PENDING') profile.weekStage = (profile.seasonWeek ?? 1) === 1 ? 'SEASON_BREAK' : 'READY';
  return `Semua skill sudah maksimal: ${pending} EXP dikonversi menjadi ${formatMoney(money)} money.`;
}

/**
 * Splits all pending EXP evenly across the position's rating skills (button
 * shortcut). EXP that would overflow a capped skill flows to the remaining
 * uncapped skills so the pool always empties.
 */
export function assignMatchExpEvenly(profileInput: PlayerProfile, skills: DetailedSkillId[], now = new Date()): ExpAllocationResult {
  let profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  const startPending = Math.max(0, profile.unassignedMatchExp ?? 0);
  if (startPending <= 0) throw new Error('Tidak ada EXP yang menunggu alokasi.');
  let allocated = 0;
  let levelsGained = 0;
  for (let pass = 0; pass < 24 && (profile.unassignedMatchExp ?? 0) > 0; pass += 1) {
    const preferred = skills.filter((skill) => !isSkillMaxed(profile, skill));
    const targets = preferred.length ? preferred : DETAILED_SKILLS.filter((skill) => !isSkillMaxed(profile, skill));
    if (!targets.length) break;
    const pending = profile.unassignedMatchExp ?? 0;
    const share = Math.floor(pending / targets.length);
    const allocations: Partial<Record<DetailedSkillId, number>> = {};
    targets.forEach((skill, index) => { allocations[skill] = index === 0 ? pending - share * (targets.length - 1) : share; });
    const result = assignMatchExp(profile, allocations, now);
    profile = result.profile;
    allocated += result.allocated;
    levelsGained += result.levelsGained;
  }
  settleSurplusExp(profile, now);
  return { profile, allocated, remaining: profile.unassignedMatchExp ?? 0, levelsGained };
}

export function startTrickTraining(profileInput: PlayerProfile, trickId: string, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  const trick = TRICK_CATALOG[trickId];
  if (!trick) throw new Error('Trick training tidak ditemukan.');
  if (profile.unlockedTricks!.includes(trickId)) throw new Error('Trick tersebut sudah terbuka.');
  for (const [skill, required] of Object.entries(trick.requires)) {
    if ((profile.detailedSkills![skill as DetailedSkillId]?.level ?? 0) < required) throw new Error(`${DETAILED_SKILL_LABELS[skill as DetailedSkillId]} harus mencapai level ${required}.`);
  }
  if (profile.energy < trick.energyCost) throw new Error('Energi tidak cukup untuk trick training.');
  profile.energy -= trick.energyCost;
  profile.unlockedTricks!.push(trickId);
  touch(profile, now);
  return { profile, message: `${trick.name} terbuka. ${trick.description} Bonus pertandingan +${Math.round(trick.matchModifier * 100)}%.` };
}

export function hireTrainer(profileInput: PlayerProfile, trainerId: string, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  const definition = TRAINER_CATALOG[trainerId];
  if (!definition) throw new Error('Personal trainer tidak ditemukan.');
  if (profile.trainer?.active) throw new Error('Sudah ada personal trainer aktif. Release trainer lama terlebih dahulu.');
  if (profile.money < definition.weeklyCost) throw new Error('Money tidak cukup untuk membayar minggu pertama trainer.');
  profile.money -= definition.weeklyCost;
  profile.trainer = { ...definition, hiredAtWeek: currentWeek(profile), active: true };
  touch(profile, now);
  return { profile, message: `Trainer ${definition.tier} aktif: +${trainerWeeklyGain(profile.trainer)} EXP/minggu ke 3 skill, biaya ${formatMoney(definition.weeklyCost)}/minggu.` };
}

export function releaseTrainer(profileInput: PlayerProfile, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  if (!profile.trainer?.active) throw new Error('Tidak ada personal trainer aktif.');
  profile.trainer.active = false;
  touch(profile, now);
  return { profile, message: 'Personal trainer dilepas.' };
}

export function startCultureStudy(profileInput: PlayerProfile, subject: CultureSubject, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  if (profile.cultureStudy) throw new Error('Culture study sedang berjalan.');
  const rewards: Record<CultureSubject, { skill: DetailedSkillId; charm: number }> = {
    science: { skill: 'pass', charm: GAME_BALANCE.culture.charmGain },
    arts: { skill: 'dribbling', charm: GAME_BALANCE.culture.charmGain + 1 },
    history: { skill: 'willpower', charm: GAME_BALANCE.culture.charmGain }
  };
  const reward = rewards[subject];
  if (!reward) throw new Error('Subject culture study tidak dikenal.');
  profile.cultureStudy = {
    subject,
    completeAtWeek: currentWeek(profile) + GAME_BALANCE.culture.durationWeeks,
    charmReward: reward.charm,
    skillReward: reward.skill,
    skillExpReward: GAME_BALANCE.culture.skillExpGain
  };
  touch(profile, now);
  return { profile, message: `Culture study ${subject} dimulai dan selesai pada week ${profile.cultureStudy.completeAtWeek}.` };
}

export function trainerWeeklyGain(trainer: Pick<TrainerState, 'ratio'>): number {
  return Math.min(GAME_BALANCE.trainer.maxWeeklyGain, Math.max(1, Math.round(GAME_BALANCE.trainer.gainPerRatio * trainer.ratio)));
}

function settleTrainer(profile: PlayerProfile): string | undefined {
  const trainer = profile.trainer;
  if (!trainer?.active) return undefined;
  if (profile.money < trainer.weeklyCost) {
    trainer.active = false;
    return 'Trainer berhenti karena biaya mingguan tidak cukup.';
  }
  profile.money -= trainer.weeklyCost;
  const gain = trainerWeeklyGain(trainer);
  const targets: DetailedSkillId[] = trainer.type === 'PHYSICAL' ? ['endurance', 'speed', 'holdOffDefenders'] : ['pass', 'dribbling', 'teamwork'];
  for (const skill of targets) profile.totalExp += grantSkillExp(profile, skill, gain).applied;
  return `Trainer memberi ${gain} EXP mingguan ke ${targets.map((skill) => DETAILED_SKILL_LABELS[skill]).join(', ')} (biaya ${formatMoney(trainer.weeklyCost)}).`;
}

function settleTraining(profile: PlayerProfile): string | undefined {
  const training = profile.activeTraining;
  if (!training || training.completeAtWeek > currentWeek(profile)) return undefined;
  const levelBefore = profile.detailedSkills![training.skill].level;
  const result = grantSkillExp(profile, training.skill, training.expReward);
  profile.totalExp += result.applied;
  profile.activeTraining = undefined;
  return `Training ${DETAILED_SKILL_LABELS[training.skill]} selesai: +${result.applied} EXP${result.levels ? ` dan +${result.levels} level` : ''} (Lv ${levelBefore} → ${profile.detailedSkills![training.skill].level}).`;
}

function settleCulture(profile: PlayerProfile): string | undefined {
  const study = profile.cultureStudy;
  if (!study || study.completeAtWeek > currentWeek(profile)) return undefined;
  profile.charm = (profile.charm ?? 0) + study.charmReward;
  profile.totalExp += grantSkillExp(profile, study.skillReward, study.skillExpReward).applied;
  profile.cultureStudy = undefined;
  return `Culture study ${study.subject} selesai: charm +${study.charmReward}, ${DETAILED_SKILL_LABELS[study.skillReward]} +${study.skillExpReward} EXP.`;
}

function recoverWeekly(profile: PlayerProfile): void {
  profile.energy = Math.min(profile.maxEnergy, profile.energy + GAME_BALANCE.weekly.energyRecovery);
  profile.hp = Math.min(profile.maxHp, profile.hp + GAME_BALANCE.weekly.hpRecovery);
}

function settleInjury(profile: PlayerProfile): string | undefined {
  const injury = profile.injury;
  if (!injury) return undefined;
  injury.weeksRemaining = Math.max(0, injury.weeksRemaining - 1);
  if (injury.weeksRemaining === 0) {
    profile.injury = undefined;
    return 'Cedera pulih sepenuhnya.';
  }
  return `Cedera tersisa ${injury.weeksRemaining} minggu.`;
}

function injurySeverity(weeks: number): InjurySeverity {
  if (weeks <= 2) return 'MINOR';
  if (weeks <= 4) return 'MODERATE';
  return 'MAJOR';
}

function maybeInjure(profile: PlayerProfile, now: Date, rng: RandomSource): string | undefined {
  if (profile.injury || rng.next() >= GAME_BALANCE.match.injuryChance) return undefined;
  const endurance = profile.detailedSkills?.endurance.level ?? 1;
  const willpower = profile.detailedSkills?.willpower.level ?? 1;
  const duration = Math.min(GAME_BALANCE.injury.maxWeeks, GAME_BALANCE.injury.minWeeks + Math.floor(rng.next() * (GAME_BALANCE.injury.maxWeeks - GAME_BALANCE.injury.minWeeks + 1)));
  const adjustedDuration = Math.max(GAME_BALANCE.injury.minWeeks, duration - Math.floor((endurance + willpower) / 50));
  profile.injury = {
    severity: injurySeverity(adjustedDuration),
    weeksRemaining: adjustedDuration,
    source: 'MATCH',
    treatmentUsed: false,
    diagnosedAt: iso(now)
  };
  profile.career.injuries += 1;
  return `Cedera ${profile.injury.severity.toLowerCase()} terjadi dan diperkirakan berlangsung ${adjustedDuration} minggu.`;
}

export function treatInjury(profileInput: PlayerProfile, treatment: 'BASIC' | 'EXPERT', now = new Date()): TreatmentResult {
  const profile = ensureGameplayState(profileInput, now);
  const injury = profile.injury;
  if (!injury) throw new Error('Tidak ada cedera aktif.');
  if (injury.treatmentUsed) throw new Error('Cedera ini sudah mendapatkan treatment.');
  const weeksRemoved = treatment === 'BASIC' ? GAME_BALANCE.injury.basicTreatmentWeeks : GAME_BALANCE.injury.expertTreatmentWeeks;
  const moneySpent = treatment === 'BASIC' ? 0 : GAME_BALANCE.injury.expertTreatmentCost;
  if (profile.money < moneySpent) throw new Error('Money tidak cukup untuk expert treatment.');
  profile.money -= moneySpent;
  injury.weeksRemaining = Math.max(0, injury.weeksRemaining - weeksRemoved);
  injury.treatmentUsed = true;
  if (injury.weeksRemaining === 0) profile.injury = undefined;
  touch(profile, now);
  return { profile, treatment, weeksRemoved, moneySpent };
}

function retire(profile: PlayerProfile, now: Date): void {
  profile.careerStatus = 'RETIRED';
  const retirement: RetirementState = {
    retiredAt: iso(now),
    age: profile.age,
    finalSeason: profile.league.season,
    finalRating: getRating(profile),
    finalGoals: profile.career.goals,
    finalHonors: profile.honors?.length ?? 0
  };
  profile.retirement = retirement;
  profile.careerHistory = [...(profile.careerHistory ?? []), {
    generation: (profile.rebirthCount ?? 0) + 1,
    position: profile.position,
    retiredAt: retirement.retiredAt,
    age: profile.age,
    seasons: Math.max(1, currentCareerYear(profile) - 1),
    finalClub: profile.club,
    finalRating: retirement.finalRating,
    appearances: profile.career.appearances,
    goals: profile.career.goals,
    assists: profile.career.assists,
    honors: retirement.finalHonors
  }];
  // A retired athlete cannot allocate EXP; the final match pool is closed with the career.
  profile.unassignedMatchExp = 0;
  profile.weekStage = 'READY';
  profile.activeTraining = undefined;
  profile.cultureStudy = undefined;
  if (profile.trainer) profile.trainer.active = false;
}

function maybeRetire(profile: PlayerProfile, now: Date): boolean {
  if (profile.age < GAME_BALANCE.weekly.retirementAge && currentCareerYear(profile) <= GAME_BALANCE.weekly.maxCareerYear) return false;
  retire(profile, now);
  return true;
}

function sponsorTier(rng: RandomSource): PlayerSponsorContract {
  const offers: Array<Omit<PlayerSponsorContract, 'signedAtWeek'>> = [
    { id: 'local-boots', brand: 'Kicks Local', tier: 'LOCAL', weeklyReward: 90, weeksRemaining: GAME_BALANCE.weekly.sponsorContractWeeks },
    { id: 'regional-drink', brand: 'Pulse Drink', tier: 'REGIONAL', weeklyReward: 160, weeksRemaining: GAME_BALANCE.weekly.sponsorContractWeeks },
    { id: 'global-tech', brand: 'Vertex Sports', tier: 'GLOBAL', weeklyReward: 280, weeksRemaining: GAME_BALANCE.weekly.sponsorContractWeeks }
  ];
  return { ...offers[Math.floor(rng.next() * offers.length)], signedAtWeek: 0 };
}

function createPlayerWeeklyEvent(profile: PlayerProfile, now: Date, rng: RandomSource): PlayerWeeklyEvent | undefined {
  if (rng.next() >= GAME_BALANCE.weekly.playerEventChance) return undefined;
  const eventId = `player-week-${currentWeek(profile)}-${Math.floor(rng.next() * 1_000_000)}`;
  const typeRoll = rng.next();
  let type: PlayerEventType;
  let title: string;
  let description: string;
  let choices: PlayerEventChoice[];
  if (!profile.injury && typeRoll < GAME_BALANCE.weekly.medicalEventChance) {
    type = 'MEDICAL_INCIDENT';
    title = 'Knock dalam latihan';
    description = 'Tim medis menemukan benturan ringan setelah sesi latihan. Kamu harus memilih cara menangani kondisi ini sebelum pertandingan.';
    choices = [
      { id: 'rest', label: 'Istirahat dan pulihkan diri', description: 'Lewatkan risiko dengan mengambil waktu recovery.', energyDelta: 12, hpDelta: 8 },
      { id: 'push-through', label: 'Tetap berlatih', description: 'Pertahankan momentum, tetapi ada risiko cedera.', energyDelta: -10, injuryWeeks: 2, expDelta: 22 }
    ];
  } else if (typeRoll < 0.62) {
    type = 'INTERVIEW';
    title = 'Wawancara setelah latihan';
    description = 'Media klub meminta komentar tentang performa dan target musim ini. Jawabanmu memengaruhi reputasi dan perkembangan karier.';
    choices = [
      { id: 'honest', label: 'Jawab jujur dan tenang', description: 'Reputasi naik secara konsisten.', charmDelta: 3, expDelta: 16 },
      { id: 'bold', label: 'Buat pernyataan berani', description: 'Mendapat perhatian besar dan bonus kecil.', charmDelta: 5, moneyDelta: 120 },
      { id: 'humble', label: 'Puji kerja tim', description: 'Menjaga hubungan dengan ruang ganti.', charmDelta: 2, energyDelta: 5, expDelta: 10 }
    ];
  } else if (!profile.sponsor) {
    type = 'SPONSOR_OFFER';
    const offer = sponsorTier(rng);
    title = `Tawaran sponsor · ${offer.brand}`;
    description = `Brand ${offer.brand} menawarkan kontrak ${offer.tier.toLowerCase()} selama ${offer.weeksRemaining} minggu dengan pembayaran mingguan.`;
    choices = [
      { id: 'sign', label: `Tanda tangani ${offer.brand}`, description: `Terima ${offer.weeklyReward} money setiap weekly update.`, sponsor: offer },
      { id: 'decline', label: 'Tolak dengan sopan', description: 'Menjaga kebebasan karier tanpa kontrak sponsor.', charmDelta: 1 }
    ];
  } else {
    type = 'LIFESTYLE';
    title = 'Undangan acara klub';
    description = 'Setelah latihan, kamu mendapat undangan acara yang bisa membantu reputasi atau kondisi fisik.';
    choices = [
      { id: 'attend', label: 'Hadiri acara', description: 'Bangun reputasi dan relasi baru.', charmDelta: 4, energyDelta: -8, moneyDelta: 80 },
      { id: 'recover', label: 'Pulang dan recovery', description: 'Prioritaskan tubuh untuk pertandingan.', hpDelta: 10, energyDelta: 8 }
    ];
  }
  return { id: eventId, type, title, description, choices, resolved: false, createdAt: iso(now), week: currentWeek(profile) };
}

function settleSponsor(profile: PlayerProfile): string | undefined {
  const sponsor = profile.sponsor;
  if (!sponsor) return undefined;
  profile.money += sponsor.weeklyReward;
  sponsor.weeksRemaining -= 1;
  if (sponsor.weeksRemaining <= 0) {
    profile.sponsorHistory ??= [];
    profile.sponsorHistory.push({ ...sponsor, weeksRemaining: 0 });
    profile.sponsor = undefined;
    return `Sponsor ${sponsor.brand} membayar ${sponsor.weeklyReward} money. Kontrak selesai.`;
  }
  return `Sponsor ${sponsor.brand} membayar ${sponsor.weeklyReward} money (${sponsor.weeksRemaining} minggu tersisa).`;
}

export function resolvePlayerWeeklyEvent(profileInput: PlayerProfile, choiceId: string, now = new Date()): { profile: PlayerProfile; event: PlayerWeeklyEvent; choice: PlayerEventChoice } {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  if (profile.weekStage !== 'EVENT_PENDING' || !profile.weeklyEvent || profile.weeklyEvent.resolved) throw new Error('Tidak ada event mingguan yang menunggu keputusan.');
  const event = profile.weeklyEvent;
  const choice = event.choices.find((item) => item.id === choiceId);
  if (!choice) throw new Error('Pilihan event tidak valid.');
  profile.money = Math.max(0, profile.money + (choice.moneyDelta ?? 0));
  // Event EXP joins the post-match "Exp left" pool so it reaches a detailed skill.
  const expDelta = Math.max(0, choice.expDelta ?? 0);
  profile.totalExp += expDelta;
  profile.unassignedMatchExp = (profile.unassignedMatchExp ?? 0) + expDelta;
  profile.charm = Math.max(0, (profile.charm ?? 0) + (choice.charmDelta ?? 0));
  profile.energy = Math.min(profile.maxEnergy, Math.max(0, profile.energy + (choice.energyDelta ?? 0)));
  profile.hp = Math.min(profile.maxHp, Math.max(0, profile.hp + (choice.hpDelta ?? 0)));
  if (choice.sponsor) {
    if (profile.sponsor) {
      profile.sponsorHistory ??= [];
      profile.sponsorHistory.push({ ...profile.sponsor, weeksRemaining: profile.sponsor.weeksRemaining });
    }
    profile.sponsor = { ...choice.sponsor, signedAtWeek: currentWeek(profile) };
  }
  if (choice.injuryWeeks && !profile.injury) {
    profile.injury = { severity: injurySeverity(choice.injuryWeeks), weeksRemaining: choice.injuryWeeks, source: 'EVENT', treatmentUsed: false, diagnosedAt: iso(now) };
    profile.career.injuries += 1;
  }
  event.resolved = true;
  event.selectedChoiceId = choice.id;
  profile.weekStage = 'MATCH_READY';
  syncMacroStats(profile);
  touch(profile, now);
  return { profile, event, choice };
}

export function preparePlayerWeek(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): WeekPreparationResult {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  const surplusMessage = settleSurplusExp(profile, now);
  if ((profile.unassignedMatchExp ?? 0) > 0) throw new Error(`Assign EXP sebelum memulai week berikutnya. Sisa EXP: ${profile.unassignedMatchExp}.`);
  if (profile.weekStage === 'MATCH_READY') throw new Error('Weekly update sudah selesai. Lanjutkan ke Match Ready terlebih dahulu.');
  if (profile.weekStage === 'EXP_PENDING') throw new Error('Assign EXP hasil pertandingan terlebih dahulu.');
  if (profile.weekStage === 'EVENT_PENDING') throw new Error('Selesaikan event mingguan terlebih dahulu.');
  ensureSeasonTracking(profile);
  const week = currentWeek(profile);
  const narrative: string[] = [`Weekly Update · Week ${week} dimulai untuk ${profile.displayName}.`];
  if (surplusMessage) narrative.push(surplusMessage);
  if (profile.weekStage === 'SEASON_BREAK') narrative.push('Season break selesai; career memasuki weekly cycle berikutnya.');
  recoverWeekly(profile);
  const salaryMessage = payWeeklySalary(profile, now);
  if (salaryMessage) narrative.push(salaryMessage);
  const trainerMessage = settleTrainer(profile);
  if (trainerMessage) narrative.push(trainerMessage);
  const injuryMessage = settleInjury(profile);
  if (injuryMessage) narrative.push(injuryMessage);
  const sponsorMessage = settleSponsor(profile);
  if (sponsorMessage) narrative.push(sponsorMessage);
  if ((profile.discipline?.suspendedMatches ?? 0) > 0) narrative.push(`Skors aktif: ${profile.discipline!.suspendedMatches} pertandingan.`);
  syncMacroStats(profile);
  const event = createPlayerWeeklyEvent(profile, now, rng);
  if (event) {
    profile.weeklyEvent = event;
    profile.weekStage = 'EVENT_PENDING';
    narrative.push(`Event mingguan: ${event.title}. Pilih respons sebelum pertandingan.`);
  } else {
    profile.weekStage = 'MATCH_READY';
  }
  touch(profile, now);
  return { profile, week, narrative, stage: profile.weekStage, event };
}

export function playPreparedWeek(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): WeekResult {
  let profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  if (profile.weekStage !== 'MATCH_READY') throw new Error('Jalankan Weekly Update terlebih dahulu sebelum memainkan match.');
  const week = currentWeek(profile);
  const narrative: string[] = [`Match Ready · Week ${week}.`];
  const fixture = playPlayerFixture(profile, now, rng);
  profile = fixture.profile;
  narrative.push(...fixture.narrative);
  const match = fixture.record;
  let injury;
  if (match.personal?.played) {
    const injuryMessage = maybeInjure(profile, now, rng);
    if (injuryMessage) {
      injury = profile.injury;
      match.injury = injury;
      if (match.timeline) match.timeline = withInjuryEvent(match.timeline, profile.displayName, match.id);
      narrative.push(injuryMessage);
    }
  }
  profile.careerWeek = week + 1;
  profile.seasonWeek = Math.max(1, profile.league.matchday);
  const trainingMessage = settleTraining(profile);
  if (trainingMessage) narrative.push(trainingMessage);
  const cultureMessage = settleCulture(profile);
  if (cultureMessage) narrative.push(cultureMessage);
  let award;
  if (fixture.seasonComplete) {
    const seasonEnd = finishPlayerSeason(profile, now, rng);
    profile = seasonEnd.profile;
    award = seasonEnd.award;
    narrative.push(...seasonEnd.narrative);
  }
  const surplusMessage = settleSurplusExp(profile, now);
  if (surplusMessage) narrative.push(surplusMessage);
  const retired = maybeRetire(profile, now);
  if (retired) narrative.push(`Karier berakhir pada usia ${profile.age}. Pilih Rebirth untuk memulai generasi karier berikutnya.`);
  profile.weekStage = retired ? 'READY' : (profile.unassignedMatchExp ?? 0) > 0 ? 'EXP_PENDING' : award ? 'SEASON_BREAK' : 'READY';
  syncMacroStats(profile);
  touch(profile, now);
  return { profile, week, season: profile.league.season, narrative, match, expAwaitingAssignment: profile.unassignedMatchExp ?? 0, injury, award, retired, stage: profile.weekStage };
}

/** Compatibility path retained for existing commands and stress tests. */
export function advanceWeek(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): WeekResult {
  // The weekly event draw uses the same source so seeded simulations are reproducible.
  const prepared = preparePlayerWeek(profileInput, now, rng);
  const readyProfile = prepared.stage === 'EVENT_PENDING' && prepared.event ? resolvePlayerWeeklyEvent(prepared.profile, prepared.event.choices[0].id, now).profile : prepared.profile;
  const played = playPreparedWeek(readyProfile, now, rng);
  return { ...played, narrative: [...prepared.narrative, ...played.narrative] };
}

/** A new athlete: 15 years old, signed by a random third-tier club, paid from week 1. Nationality never picks the club. */
export function createPlayerCareer(userId: string, displayName: string, position: Position, now = new Date(), rng: RandomSource = new MathRandomSource(), nationality?: string): PlayerProfile {
  const initial = createInitialProfile(userId, displayName, position, now);
  if (nationality) initial.nationality = nationality;
  initial.club = randomStarterClub(rng);
  const profile = ensureClubState(initial, now, rng);
  return signContract(profile, now, GAME_BALANCE.contract.defaultSeasons, 'INITIAL');
}

export const VOLUNTARY_RETIREMENT_AGE = 30;

export function canRetire(profile: PlayerProfile): boolean {
  return profile.careerStatus !== 'RETIRED' && (profile.age >= VOLUNTARY_RETIREMENT_AGE || currentCareerYear(profile) >= GAME_BALANCE.weekly.maxCareerYear);
}

export function retirePlayer(profileInput: PlayerProfile, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier sudah pensiun.');
  if (!canRetire(profile)) throw new Error(`Retirement sukarela tersedia mulai usia ${VOLUNTARY_RETIREMENT_AGE} atau setelah ${GAME_BALANCE.weekly.maxCareerYear} tahun karier.`);
  retire(profile, now);
  touch(profile, now);
  return { profile, message: `Karier ${profile.displayName} resmi pensiun pada usia ${profile.age}.` };
}

/**
 * Starts the next career generation: a 15-year-old at a random third-tier club with the
 * position preset plus a rebirth bonus, keeping money, honors, and career history.
 */
export function rebirthPlayer(profileInput: PlayerProfile, now = new Date(), position?: Position, rng: RandomSource = new MathRandomSource()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  if (profile.careerStatus !== 'RETIRED') throw new Error('Rebirth hanya tersedia setelah retirement.');
  const rebirthCount = (profile.rebirthCount ?? 0) + 1;
  const nextPosition = position ?? profile.position;
  const bonus = Math.min(GAME_BALANCE.rebirth.maxSkillBonus, rebirthCount * GAME_BALANCE.rebirth.skillBonusPerRebirth);
  const detailedSkills = initialDetailedSkills(nextPosition);
  for (const skill of DETAILED_SKILLS) detailedSkills[skill].level = Math.min(GAME_BALANCE.skillProgression.maxLevel, detailedSkills[skill].level + bonus);
  profile.position = nextPosition;
  profile.age = 15;
  profile.level = GAME_BALANCE.rebirth.startingLevel;
  profile.totalExp = 0;
  profile.detailedSkills = detailedSkills;
  profile.skillBase = skillBaseFrom(detailedSkills);
  profile.stats = deriveMacroStats(detailedSkills);
  profile.career = { appearances: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, steals: 0, cleanSheets: 0, yellowCards: 0, injuries: 0, seasonScore: 0, redCards: 0, mvps: 0, championsGoals: 0 };
  profile.league = { season: 1, matchday: 1, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  profile.club = randomStarterClub(rng);
  profile.clubState = undefined;
  profile.championsLeague = undefined;
  profile.transferOffers = [];
  profile.seasonStats = freshSeasonStats(1);
  profile.discipline = { season: 1, yellowCards: 0, suspendedMatches: 0 };
  profile.seasonHistory = [];
  profile.sponsor = undefined;
  profile.careerYear = 1;
  profile.careerWeek = 1;
  profile.seasonWeek = 1;
  profile.regularTrainingWeek = undefined;
  profile.rebirthCount = rebirthCount;
  profile.careerStatus = 'ACTIVE';
  profile.unassignedMatchExp = 0;
  profile.injury = undefined;
  profile.activeTraining = undefined;
  profile.cultureStudy = undefined;
  profile.worldFootballer = undefined;
  profile.retirement = undefined;
  profile.weeklyEvent = undefined;
  profile.unlockedTricks = [];
  profile.weekStage = 'READY';
  profile.trainer = undefined;
  profile.energy = profile.maxEnergy;
  profile.hp = profile.maxHp;
  profile.contract = undefined;
  const signed = signContract(profile, now, GAME_BALANCE.contract.defaultSeasons, 'INITIAL');
  touch(signed, now);
  return { profile: signed, message: `Rebirth #${rebirthCount} selesai: ${nextPosition} usia 15 di ${signed.club} dengan bonus +${bonus} ke semua skill. Money, Hall of Honor, dan riwayat karier dipertahankan.` };
}

/** Progress bar for monospace blocks, e.g. `███░░░░░`. */
export function progressBar(share: number, width = 8): string {
  const filled = Math.round(Math.min(1, Math.max(0, share)) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

/**
 * Skill values (1–99) with progress toward the next point, in a code block so
 * the columns line up. `*` marks the skills that drive the position's rating.
 */
export function formatDetailedSkills(profileInput: PlayerProfile): string {
  const profile = ensureGameplayState(profileInput);
  const key = new Set(ratingSkillsFor(profile.position));
  const lines = DETAILED_SKILLS.map((skill) => {
    const state = profile.detailedSkills![skill];
    const label = `${key.has(skill) ? '*' : ' '} ${DETAILED_SKILL_LABELS[skill]}`.padEnd(21);
    const level = `Lv ${String(skillDisplayLevel(profile, skill)).padStart(2)}`;
    if (state.level >= GAME_BALANCE.skillProgression.maxLevel) return `${label}${level} MAX`;
    return `${label}${level} ${progressBar(state.exp / skillLevelCost(state.level))}`;
  });
  return `\`\`\`\n${lines.join('\n')}\n\`\`\`\n\`*\` skill utama posisi · bar = EXP menuju level berikutnya`;
}

export function formatGameplayStatus(profileInput: PlayerProfile): string {
  const profile = ensureGameplayState(profileInput);
  const injury = profile.injury ? `${profile.injury.severity} · ${profile.injury.weeksRemaining} weeks` : 'Healthy';
  const trainer = profile.trainer?.active ? `${profile.trainer.tier} (${profile.trainer.weeklyCost}/week)` : 'None';
  const culture = profile.cultureStudy ? `${profile.cultureStudy.subject} until week ${profile.cultureStudy.completeAtWeek}` : 'None';
  const training = profile.activeTraining ? `${DETAILED_SKILL_LABELS[profile.activeTraining.skill]} until week ${profile.activeTraining.completeAtWeek}` : 'None';
  const regular = profile.regularTrainingWeek === currentWeek(profile) ? 'done this week' : 'available';
  const suspension = (profile.discipline?.suspendedMatches ?? 0) > 0 ? `${profile.discipline!.suspendedMatches} match` : 'None';
  return `Mode ${profile.mode}\nCareer ${profile.careerStatus} · Age ${profile.age} · Year ${currentCareerYear(profile)} · Week ${currentWeek(profile)}\nPending match EXP ${profile.unassignedMatchExp ?? 0}\nInjury ${injury} · Suspension ${suspension}\nDetailed training ${training} · Regular training ${regular}\nTrainer ${trainer}\nCulture ${culture}\nCharm ${profile.charm ?? 0} · Tricks ${profile.unlockedTricks?.length ?? 0} · Honors ${profile.honors?.length ?? 0}\nWeek stage ${profile.weekStage}`;
}

export function listTrainerCatalog(): Array<TrainerState & { hiredAtWeek: number }> {
  return Object.values(TRAINER_CATALOG).map((trainer) => ({ ...trainer, hiredAtWeek: 0 }));
}
