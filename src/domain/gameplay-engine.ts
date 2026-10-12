import { GAME_BALANCE } from '../config/game-balance.js';
import { getRating, MathRandomSource, playMatch, type RandomSource } from './engine.js';
import { detailedTrainingExpFor } from './player-formulas.js';
import {
  DETAILED_SKILLS,
  DETAILED_SKILL_LABELS,
  TRAINER_CATALOG,
  TRICK_CATALOG,
  clampStat,
  createEmptyDetailedSkills,
  deriveMacroStats,
  normalizeDetailedSkills,
  type CultureSubject,
  type DetailedSkillId,
  type DetailedSkills,
  type ExpAllocationResult,
  type GameplayActionResult,
  type HonorRecord,
  type InjurySeverity,
  type PlayerEventChoice,
  type PlayerEventType,
  type PlayerProfile,
  type PlayerSponsorContract,
  type PlayerWeeklyEvent,
  type RetirementState,
  type TrainerState,
  type TreatmentResult,
  type TrainerTier,
  type WeekPreparationResult,
  type WeekResult,
  type WorldFootballerState
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
  profile.updatedAt = profile.updatedAt || iso(now);
  profile.lastActionAt = profile.lastActionAt || iso(now);
  return profile;
}

function nextSkillExp(level: number): number {
  return Math.max(50, level * 100);
}

function grantSkillExp(profile: PlayerProfile, skill: DetailedSkillId, amount: number): number {
  if (amount <= 0) return 0;
  const state = profile.detailedSkills![skill];
  state.exp += Math.floor(amount);
  let levels = 0;
  while (state.exp >= nextSkillExp(state.level)) {
    state.exp -= nextSkillExp(state.level);
    state.level += 1;
    levels += 1;
  }
  return levels;
}

function syncMacroStats(profile: PlayerProfile): void {
  profile.stats = deriveMacroStats(profile.detailedSkills!);
  profile.level = Math.max(profile.level, Math.floor(profile.totalExp / 100) + 1);
}

function touch(profile: PlayerProfile, now: Date): PlayerProfile {
  profile.updatedAt = iso(now);
  profile.lastActionAt = iso(now);
  return profile;
}

function requireActive(profile: PlayerProfile): void {
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun. Gunakan /rebirth untuk memulai karier baru.');
}

function requireSkill(skill: string): asserts skill is DetailedSkillId {
  if (!DETAILED_SKILLS.includes(skill as DetailedSkillId)) throw new Error(`Detailed skill tidak dikenal: ${skill}`);
}

export function trainDetailedSkill(profileInput: PlayerProfile, skill: DetailedSkillId, now = new Date(), rng: RandomSource = new MathRandomSource()): { profile: PlayerProfile; skill: DetailedSkillId; expGained: number; levelBefore: number; levelAfter: number; levelsGained: number } {
  const profile = ensureGameplayState(profileInput, now);
  requireActive(profile);
  if ((profile.injury?.weeksRemaining ?? 0) > 0) throw new Error('Pemain cedera dan harus memulihkan diri sebelum latihan skill.');
  if (profile.activeTraining) throw new Error(`Training ${DETAILED_SKILL_LABELS[profile.activeTraining.skill]} masih berjalan sampai week ${profile.activeTraining.completeAtWeek}.`);
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
    allocated += amount;
  }
  if (allocated > pending) throw new Error(`Alokasi EXP melebihi pool. Sisa EXP hanya ${pending}.`);
  for (const [skill, amount] of entries) levelsGained += grantSkillExp(profile, skill as DetailedSkillId, amount);
  profile.unassignedMatchExp = pending - allocated;
  if (profile.unassignedMatchExp === 0 && profile.weekStage === 'EXP_PENDING') profile.weekStage = (profile.seasonWeek ?? 1) === 1 ? 'SEASON_BREAK' : 'READY';
  syncMacroStats(profile);
  touch(profile, now);
  return { profile, allocated, remaining: profile.unassignedMatchExp, levelsGained };
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
  return { profile, message: `${trick.name} terbuka. ${trick.description}` };
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
  return { profile, message: `Trainer ${definition.tier} aktif dengan bonus rasio ${(definition.ratio * 100).toFixed(0)}% dan biaya mingguan ${definition.weeklyCost}.` };
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

function settleTrainer(profile: PlayerProfile): string | undefined {
  const trainer = profile.trainer;
  if (!trainer?.active) return undefined;
  if (profile.money < trainer.weeklyCost) {
    trainer.active = false;
    return 'Trainer berhenti karena biaya mingguan tidak cukup.';
  }
  profile.money -= trainer.weeklyCost;
  const gain = Math.min(GAME_BALANCE.trainer.maxWeeklyGain, Math.max(1, Math.round(50 * trainer.ratio)));
  const targets: DetailedSkillId[] = trainer.type === 'PHYSICAL' ? ['endurance', 'speed', 'holdOffDefenders'] : ['pass', 'dribbling', 'teamwork'];
  for (const skill of targets) {
    grantSkillExp(profile, skill, gain);
    profile.totalExp += gain;
  }
  return `Trainer memberi ${gain} EXP mingguan ke ${targets.map((skill) => DETAILED_SKILL_LABELS[skill]).join(', ')}.`;
}

function settleTraining(profile: PlayerProfile): string | undefined {
  const training = profile.activeTraining;
  if (!training || training.completeAtWeek > currentWeek(profile)) return undefined;
  const levelBefore = profile.detailedSkills![training.skill].level;
  profile.totalExp += training.expReward;
  const levelsGained = grantSkillExp(profile, training.skill, training.expReward);
  profile.activeTraining = undefined;
  return `Training ${DETAILED_SKILL_LABELS[training.skill]} selesai: +${training.expReward} EXP${levelsGained ? ` dan +${levelsGained} level` : ''} (Lv ${levelBefore} → ${profile.detailedSkills![training.skill].level}).`;
}

function settleCulture(profile: PlayerProfile): string | undefined {
  const study = profile.cultureStudy;
  if (!study || study.completeAtWeek > currentWeek(profile)) return undefined;
  profile.charm = (profile.charm ?? 0) + study.charmReward;
  profile.totalExp += study.skillExpReward;
  grantSkillExp(profile, study.skillReward, study.skillExpReward);
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

function resolveWorldFootballer(profile: PlayerProfile, now: Date): WorldFootballerState {
  const season = profile.league.season;
  const userScore = Math.round(profile.career.seasonScore + profile.career.goals * 3 + profile.career.assists * 2 + (profile.charm ?? 0));
  const candidates = [
    { name: 'Lewandowski', score: 76 },
    { name: 'De Bruyne', score: 74 },
    { name: 'Haaland', score: 78 }
  ];
  const winnerCandidate = candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best, candidates[0]);
  const userWon = userScore >= winnerCandidate.score;
  const winner = userWon ? profile.displayName : winnerCandidate.name;
  const award: WorldFootballerState = { season, winner, userScore, userWon, resolved: true, candidates: [...candidates, { name: profile.displayName, score: userScore }] };
  profile.worldFootballer = award;
  if (userWon) {
    const honor: HonorRecord = {
      id: `world-footballer-${season}`,
      category: 'PERSONAL',
      title: 'World Footballer',
      season,
      description: 'Annual player-of-the-year comparison.',
      source: 'WALKTHROUGH_OBSERVED',
      value: userScore,
      awardedAt: iso(now)
    };
    profile.honors ??= [];
    if (!profile.honors.some((item) => item.id === honor.id)) profile.honors.push(honor);
  }
  return award;
}

function maybeRetire(profile: PlayerProfile, now: Date): boolean {
  if (profile.age < GAME_BALANCE.weekly.retirementAge && currentCareerYear(profile) <= GAME_BALANCE.weekly.maxCareerYear) return false;
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
  profile.totalExp += choice.expDelta ?? 0;
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
  if ((profile.unassignedMatchExp ?? 0) > 0) throw new Error(`Assign EXP sebelum memulai week berikutnya. Sisa EXP: ${profile.unassignedMatchExp}.`);
  if (profile.weekStage === 'MATCH_READY') throw new Error('Weekly update sudah selesai. Lanjutkan ke Match Ready terlebih dahulu.');
  if (profile.weekStage === 'EXP_PENDING') throw new Error('Assign EXP hasil pertandingan terlebih dahulu.');
  if (profile.weekStage === 'EVENT_PENDING') throw new Error('Selesaikan event mingguan terlebih dahulu.');
  const week = currentWeek(profile);
  const narrative: string[] = [`Weekly Update · Week ${week} dimulai untuk ${profile.displayName}.`];
  if (profile.weekStage === 'SEASON_BREAK') narrative.push('Season break selesai; career memasuki weekly cycle berikutnya.');
  recoverWeekly(profile);
  const trainerMessage = settleTrainer(profile);
  if (trainerMessage) narrative.push(trainerMessage);
  const injuryMessage = settleInjury(profile);
  if (injuryMessage) narrative.push(injuryMessage);
  const sponsorMessage = settleSponsor(profile);
  if (sponsorMessage) narrative.push(sponsorMessage);
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
  let match;
  let injury;
  if (!profile.injury && profile.energy >= GAME_BALANCE.match.energyCost && profile.hp >= GAME_BALANCE.match.hpCost) {
    const matchResult = playMatch(profile, now, rng);
    profile = ensureGameplayState(matchResult.profile, now);
    match = matchResult.record;
    narrative.push(...matchResult.narrative);
    const injuryMessageAfterMatch = maybeInjure(profile, now, rng);
    if (injuryMessageAfterMatch) {
      injury = profile.injury;
      match.injury = injury;
      narrative.push(injuryMessageAfterMatch);
    }
  } else if (profile.injury) {
    narrative.push('Pertandingan dilewati karena pemain masih cedera.');
  } else {
    narrative.push('Pertandingan dilewati karena kondisi belum cukup; week ini menjadi recovery week.');
  }

  profile.careerWeek = week + 1;
  profile.seasonWeek = (profile.seasonWeek ?? 1) + 1;
  const trainingMessage = settleTraining(profile);
  if (trainingMessage) narrative.push(trainingMessage);
  const cultureMessage = settleCulture(profile);
  if (cultureMessage) narrative.push(cultureMessage);
  let award;
  if ((profile.seasonWeek ?? 1) > GAME_BALANCE.weekly.weeksPerSeason) {
    profile.seasonWeek = 1;
    profile.careerYear = currentCareerYear(profile) + 1;
    profile.age += 1;
    award = resolveWorldFootballer(profile, now);
    narrative.push(`World Footballer season ${award.season}: ${award.winner}${award.userWon ? ' — Anda menang.' : '.'}`);
    profile.career.seasonScore = 0;
  }
  const retired = maybeRetire(profile, now);
  if (retired) narrative.push(`Karier berakhir pada usia ${profile.age}. Gunakan /rebirth untuk memulai karier baru.`);
  profile.weekStage = profile.unassignedMatchExp! > 0 ? 'EXP_PENDING' : award ? 'SEASON_BREAK' : 'READY';
  syncMacroStats(profile);
  touch(profile, now);
  return { profile, week, season: profile.league.season, narrative, match, expAwaitingAssignment: profile.unassignedMatchExp ?? 0, injury, award, retired, stage: profile.weekStage };
}

/** Compatibility path retained for existing commands and stress tests. */
export function advanceWeek(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): WeekResult {
  const prepared = preparePlayerWeek(profileInput, now);
  const readyProfile = prepared.stage === 'EVENT_PENDING' && prepared.event ? resolvePlayerWeeklyEvent(prepared.profile, prepared.event.choices[0].id, now).profile : prepared.profile;
  const played = playPreparedWeek(readyProfile, now, rng);
  return { ...played, narrative: [...prepared.narrative, ...played.narrative] };
}

export function retirePlayer(profileInput: PlayerProfile, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier sudah pensiun.');
  if (profile.age < GAME_BALANCE.weekly.retirementAge && currentCareerYear(profile) < GAME_BALANCE.weekly.maxCareerYear) throw new Error(`Retirement tersedia pada usia ${GAME_BALANCE.weekly.retirementAge} atau setelah ${GAME_BALANCE.weekly.maxCareerYear} tahun karier.`);
  maybeRetire(profile, now);
  touch(profile, now);
  return { profile, message: `Karier ${profile.displayName} resmi pensiun pada usia ${profile.age}.` };
}

export function rebirthPlayer(profileInput: PlayerProfile, now = new Date()): GameplayActionResult {
  const profile = ensureGameplayState(profileInput, now);
  if (profile.careerStatus !== 'RETIRED') throw new Error('Rebirth hanya tersedia setelah retirement.');
  const money = profile.money;
  const honors = profile.honors ?? [];
  const rebirthCount = (profile.rebirthCount ?? 0) + 1;
  const detailedSkills = createEmptyDetailedSkills(10);
  profile.age = 15;
  profile.level = 10;
  profile.totalExp = 0;
  profile.stats = deriveMacroStats(detailedSkills);
  profile.detailedSkills = detailedSkills;
  profile.career = { appearances: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, steals: 0, cleanSheets: 0, yellowCards: 0, injuries: 0, seasonScore: 0 };
  profile.league = { season: 1, matchday: 1, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  profile.careerYear = 1;
  profile.careerWeek = 1;
  profile.seasonWeek = 1;
  profile.rebirthCount = rebirthCount;
  profile.careerStatus = 'ACTIVE';
  profile.money = money;
  profile.honors = honors;
  profile.unassignedMatchExp = 0;
  profile.injury = undefined;
  profile.activeTraining = undefined;
  profile.cultureStudy = undefined;
  profile.worldFootballer = undefined;
  profile.retirement = undefined;
  profile.unlockedTricks = [];
  profile.weekStage = 'READY';
  profile.trainer = undefined;
  profile.energy = profile.maxEnergy;
  profile.hp = profile.maxHp;
  touch(profile, now);
  return { profile, message: `Rebirth #${rebirthCount} selesai. Money dan Hall of Honor dipertahankan; career dimulai dari level 10.` };
}

export function formatDetailedSkills(profileInput: PlayerProfile): string {
  const profile = ensureGameplayState(profileInput);
  return DETAILED_SKILLS.map((skill) => {
    const state = profile.detailedSkills![skill];
    return `${DETAILED_SKILL_LABELS[skill]}: Lv ${state.level} (${state.exp}/${nextSkillExp(state.level)} EXP)`;
  }).join('\n');
}

export function formatGameplayStatus(profileInput: PlayerProfile): string {
  const profile = ensureGameplayState(profileInput);
  const injury = profile.injury ? `${profile.injury.severity} · ${profile.injury.weeksRemaining} weeks` : 'Healthy';
  const trainer = profile.trainer?.active ? `${profile.trainer.tier} (${profile.trainer.weeklyCost}/week)` : 'None';
  const culture = profile.cultureStudy ? `${profile.cultureStudy.subject} until week ${profile.cultureStudy.completeAtWeek}` : 'None';
  const training = profile.activeTraining ? `${DETAILED_SKILL_LABELS[profile.activeTraining.skill]} until week ${profile.activeTraining.completeAtWeek}` : 'None';
  return `Mode ${profile.mode}\nCareer ${profile.careerStatus} · Age ${profile.age} · Year ${currentCareerYear(profile)} · Week ${currentWeek(profile)}\nPending match EXP ${profile.unassignedMatchExp ?? 0}\nInjury ${injury}\nTraining ${training}\nTrainer ${trainer}\nCulture ${culture}\nCharm ${profile.charm ?? 0}\n  Tricks ${profile.unlockedTricks?.length ?? 0}\nHonors ${profile.honors?.length ?? 0}\nWeek stage ${profile.weekStage}`;
}

export function listTrainerCatalog(): Array<TrainerState & { hiredAtWeek: number }> {
  return Object.values(TRAINER_CATALOG).map((trainer) => ({ ...trainer, hiredAtWeek: 0 }));
}
