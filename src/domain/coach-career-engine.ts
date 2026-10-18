import { RECOVERY_CLUBS, type RecoveryClubRecord } from '../config/recovery-data.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import { ensureClubState, finishSeason, isClubSeasonComplete, playClubMatch, selectPlayingSquad } from './club-engine.js';
import { MathRandomSource, type RandomSource } from './engine.js';
import { adjacentLeague, clubStrengthByName, isDomesticLeague, leagueLabel, leagueTier, officialClubStrength, resolveClubLeagueId, standingRank } from './league-engine.js';
import {
  COACH_ABILITIES,
  COACH_ABILITY_LABELS,
  type AbilityState,
  type CoachAbilityId,
  type CoachBoardTarget,
  type CoachCareerState,
  type CoachEvent,
  type CoachEventChoice,
  type CoachEventFamily,
  type CoachEventTrigger,
  type CoachExpAllocationResult,
  type CoachJobOffer,
  type CoachRoundResult,
  type CoachTargetType,
  type HonorRecord,
  type PlayerProfile
} from './types.js';

const WEEK_MS = 7 * 86_400_000;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nextAbilityExp(level: number): number {
  return Math.max(100, level * 100);
}

function defaultCoachAbilities(): Record<CoachAbilityId, AbilityState> {
  return Object.fromEntries(COACH_ABILITIES.map((id) => [id, { level: 1, exp: 0 }])) as Record<CoachAbilityId, AbilityState>;
}

function coachOrThrow(profile: PlayerProfile): CoachCareerState {
  if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home terlebih dahulu.');
  return profile.coach;
}

function ensureCoachClubState(profileInput: PlayerProfile, now: Date, rng?: RandomSource): PlayerProfile {
  return ensureClubState(profileInput, now, rng, 'coachClubState');
}

function coachClubName(profile: PlayerProfile): string {
  return profile.coachClubState?.name ?? profile.club;
}

function currentClubRecord(profile: PlayerProfile) {
  return RECOVERY_CLUBS.find((club) => club.nameEn === coachClubName(profile));
}

function playedRounds(profile: PlayerProfile): number {
  return profile.coachClubState?.fixtures.filter((fixture) => fixture.played).length ?? 0;
}

function currentRank(profile: PlayerProfile): number {
  const club = profile.coachClubState;
  if (!club) return 1;
  return standingRank(club.standings, club.id);
}

/** Squad strength of the Coach club on the same scale as recovered club strength. */
function coachClubStrength(profile: PlayerProfile): number {
  const club = profile.coachClubState;
  if (!club) return 60;
  const squad = selectPlayingSquad(club.roster, club.formation);
  return squad.reduce((sum, player) => sum + player.overall, 0) / Math.max(1, squad.length);
}

/** Expected finish from squad strength versus every other club in the league. */
export function expectedLeagueRank(profile: PlayerProfile): number {
  const club = profile.coachClubState;
  if (!club) return 10;
  const leagueId = resolveClubLeagueId(club);
  const own = coachClubStrength(profile);
  return 1 + club.standings.filter((standing) => standing.clubId !== club.id && clubStrengthByName(standing.clubName, leagueId) > own).length;
}

const TARGET_REWARDS: Record<CoachTargetType, { success: number; failure: number; money: number }> = {
  CHAMPIONSHIP: { success: 10, failure: -8, money: 5_000 },
  PROMOTION: { success: 10, failure: -6, money: 4_000 },
  QCL: { success: 8, failure: -8, money: 3_500 },
  TOP_HALF: { success: 6, failure: -6, money: 2_000 },
  AVOID_RELEGATION: { success: 6, failure: -10, money: 1_500 }
};

function boardObjective(leagueId: number | undefined, size: number, expected: number): { type: CoachTargetType; targetRank: number } {
  const tier = leagueTier(leagueId) ?? 1;
  const relegationLine = size - GAME_BALANCE.league.relegationSlots;
  const hasLowerLeague = adjacentLeague(leagueId, 1) !== undefined;
  const midTable = { type: 'TOP_HALF' as const, targetRank: Math.min(Math.ceil(size / 2), expected + 2) };
  if (tier === 1) {
    if (expected <= 2) return { type: 'CHAMPIONSHIP', targetRank: expected };
    if (expected <= 6) return { type: 'QCL', targetRank: GAME_BALANCE.league.championsSlots };
    if (expected >= size - 4 && hasLowerLeague) return { type: 'AVOID_RELEGATION', targetRank: relegationLine };
    return midTable;
  }
  if (expected <= 6) return { type: 'PROMOTION', targetRank: GAME_BALANCE.league.promotionSlots };
  if (expected >= size - 4 && hasLowerLeague) return { type: 'AVOID_RELEGATION', targetRank: relegationLine };
  return midTable;
}

function targetFor(profile: PlayerProfile, season = profile.coach?.season ?? profile.league.season, objective?: { type: CoachTargetType; targetRank: number }): CoachBoardTarget {
  const club = profile.coachClubState;
  const size = club?.standings.length ?? 20;
  const chosen = objective ?? boardObjective(club ? resolveClubLeagueId(club) : undefined, size, expectedLeagueRank(profile));
  const rewards = TARGET_REWARDS[chosen.type];
  return {
    type: chosen.type,
    season,
    targetRank: clamp(chosen.targetRank, 1, size),
    progressRank: currentRank(profile),
    approvalDeltaOnSuccess: rewards.success,
    approvalDeltaOnFailure: rewards.failure,
    rewardMoney: rewards.money,
    resolved: false
  };
}

/** Career reputation used by clubs when deciding who to approach. */
export function coachReputation(coach: CoachCareerState): number {
  return coach.level * 3 + Math.round(coach.approval / 5) + coach.honors.length * 4 + coach.careerYear;
}

function requiredReputation(club: RecoveryClubRecord): number {
  return Math.max(0, Math.round((officialClubStrength(club) - 55) * 1.2));
}

function coachExpFor(outcome: 'WIN' | 'DRAW' | 'LOSS', level: number, rng: RandomSource): number {
  const base = outcome === 'WIN' ? GAME_BALANCE.coach.roundExp.win : outcome === 'DRAW' ? GAME_BALANCE.coach.roundExp.draw : GAME_BALANCE.coach.roundExp.loss;
  return base + level * GAME_BALANCE.coach.levelExpBonus + Math.floor(rng.next() * GAME_BALANCE.coach.varianceMaxExclusive);
}

/** Per-round board mood, bounded to ±3 so no single ability guarantees approval. */
function approvalForRound(profile: PlayerProfile, outcome: 'WIN' | 'DRAW' | 'LOSS', target: CoachBoardTarget): number {
  const abilities = profile.coach?.abilities;
  let delta = outcome === 'WIN' ? 2 : outcome === 'DRAW' ? 0 : -2;
  if (outcome === 'LOSS' && (abilities?.stateAdjustment.level ?? 1) >= 8) delta += 1;
  if (outcome === 'DRAW' && (abilities?.charisma.level ?? 1) >= 10) delta += 1;
  if (playedRounds(profile) >= 6) {
    const rank = target.progressRank ?? currentRank(profile);
    if (rank <= target.targetRank) delta += 1;
    else if (rank > target.targetRank + 3) delta -= 1;
  }
  return clamp(delta, -3, 3);
}

function eventTemplate(templateId: CoachEvent['templateId']): { title: string; description: string; choices: CoachEventChoice[] } {
  const templates: Record<CoachEvent['templateId'], { title: string; description: string; choices: CoachEventChoice[] }> = {
    'press-criticism': {
      title: 'Press criticism',
      description: 'Media mempertanyakan keputusan taktik dan hasil terakhir tim.',
      choices: [
        { id: 'answer-confidently', label: 'Jawab dengan tegas', description: 'Menggunakan karisma untuk menjaga narasi publik.', approvalDelta: 2, moneyDelta: 0, expDelta: 20, ability: 'charisma' },
        { id: 'ignore-press', label: 'Abaikan media', description: 'Fokus pada latihan, tetapi tekanan publik meningkat.', approvalDelta: -2, moneyDelta: 0, expDelta: 8 }
      ]
    },
    'locker-room-speech': {
      title: 'Locker-room speech',
      description: 'Ruang ganti membutuhkan arahan sebelum round penting.',
      choices: [
        { id: 'rally-squad', label: 'Pidato motivasi', description: 'Menaikkan kepercayaan dan cohesion skuad.', approvalDelta: 3, moneyDelta: 0, expDelta: 22, ability: 'lockerRoom' },
        { id: 'keep-message-short', label: 'Pesan singkat dan disiplin', description: 'Stabil, tetapi tidak menghasilkan momentum besar.', approvalDelta: 1, moneyDelta: 0, expDelta: 12, ability: 'stateAdjustment' }
      ]
    },
    'team-building': {
      title: 'Team building',
      description: 'Pemain meminta kegiatan bersama untuk memperbaiki chemistry.',
      choices: [
        { id: 'fund-team-dinner', label: 'Biayai team dinner', description: 'Menggunakan aset klub untuk membangun chemistry.', approvalDelta: 3, moneyDelta: -120, expDelta: 25, ability: 'lockerRoom' },
        { id: 'skip-team-building', label: 'Lewati kegiatan', description: 'Menghemat aset tetapi menjaga jarak antar pemain.', approvalDelta: -1, moneyDelta: 0, expDelta: 5 }
      ]
    },
    'player-discipline': {
      title: 'Player discipline',
      description: 'Seorang pemain inti melanggar aturan internal menjelang pertandingan.',
      choices: [
        { id: 'issue-fine', label: 'Berikan denda', description: 'Menegakkan aturan secara terbuka.', approvalDelta: 1, moneyDelta: 80, expDelta: 18, ability: 'stateAdjustment' },
        { id: 'private-conversation', label: 'Bicara empat mata', description: 'Menjaga hubungan dan memberi kesempatan memperbaiki diri.', approvalDelta: 2, moneyDelta: 0, expDelta: 24, ability: 'charisma' }
      ]
    },
    'financial-crisis': {
      title: 'Financial crisis',
      description: 'Cash-flow klub menurun dan bonus pertandingan harus ditinjau ulang.',
      choices: [
        { id: 'cut-bonuses', label: 'Potong bonus sementara', description: 'Aset bertambah, tetapi moral ruang ganti berisiko turun.', approvalDelta: -3, moneyDelta: 300, expDelta: 16 },
        { id: 'invest-reserves', label: 'Gunakan cadangan klub', description: 'Membeli stabilitas jangka pendek dengan biaya aset.', approvalDelta: 4, moneyDelta: -300, expDelta: 24, ability: 'charisma' }
      ]
    }
  };
  return clone(templates[templateId]);
}

function classifyCoachEvent(templateId: CoachEvent['templateId']): { family: CoachEventFamily; trigger: CoachEventTrigger } {
  switch (templateId) {
    case 'press-criticism': return { family: 'PRESS_MEDIA', trigger: 'ROUND_SETTLEMENT' };
    case 'locker-room-speech':
    case 'player-discipline': return { family: 'LOCKER_ROOM', trigger: 'ROUND_SETTLEMENT' };
    case 'team-building': return { family: 'TEAM_BUILDING', trigger: 'ROUND_SETTLEMENT' };
    case 'financial-crisis': return { family: 'FINANCE', trigger: 'ROUND_SETTLEMENT' };
  }
}

function makeCoachEvent(profile: PlayerProfile, rng: RandomSource, now: Date): CoachEvent | undefined {
  if (profile.coach?.event && !profile.coach.event.resolved) return profile.coach.event;
  if (rng.next() >= GAME_BALANCE.coach.eventChance) return undefined;
  const ids: CoachEvent['templateId'][] = ['press-criticism', 'locker-room-speech', 'team-building', 'player-discipline', 'financial-crisis'];
  const templateId = ids[Math.floor(rng.next() * ids.length)];
  const template = eventTemplate(templateId);
  return {
    id: `coach-event-${profile.coach?.season ?? 1}-${profile.coachClubState?.fixtures.filter((fixture) => fixture.played).length ?? 0}-${templateId}`,
    templateId,
    ...classifyCoachEvent(templateId),
    blocking: true,
    title: template.title,
    description: template.description,
    choices: template.choices,
    resolved: false,
    createdAt: now.toISOString()
  };
}

function buildOffer(coach: CoachCareerState, club: RecoveryClubRecord, round: number, sequence: number): CoachJobOffer {
  const size = RECOVERY_CLUBS.filter((item) => item.league === club.league).length || 20;
  const ownStrength = officialClubStrength(club);
  const expected = 1 + RECOVERY_CLUBS.filter((item) => item.league === club.league && item.id !== club.id && officialClubStrength(item) > ownStrength).length;
  const objective = boardObjective(club.league, size, expected);
  return {
    id: `coach-job-${club.id}-${coach.season}-${round}-${sequence}`,
    clubId: String(club.id),
    clubName: club.nameEn,
    league: club.league,
    salary: Math.max(500, Math.round(club.coachSalaryBase * (0.8 + coachReputation(coach) / 100))),
    targetRank: objective.targetRank,
    targetType: objective.type,
    requiredReputation: requiredReputation(club),
    durationYears: 1 + (sequence % 2),
    status: 'OPEN'
  };
}

/** Clubs within the coach's reputation reach, preferring the most ambitious fit. */
function offerCandidates(profile: PlayerProfile, coach: CoachCareerState, ceilingBonus = 6, floorOnly = false): RecoveryClubRecord[] {
  const reputation = coachReputation(coach);
  const current = coachClubName(profile);
  const open = new Set(coach.jobOffers.filter((offer) => offer.status === 'OPEN').map((offer) => offer.clubId));
  return RECOVERY_CLUBS
    .filter((club) => isDomesticLeague(club.league) && club.nameEn !== current && !open.has(String(club.id)))
    .filter((club) => floorOnly ? requiredReputation(club) <= reputation : requiredReputation(club) <= reputation + ceilingBonus)
    .sort((a, b) => Math.abs(requiredReputation(a) - reputation) - Math.abs(requiredReputation(b) - reputation) || a.id - b.id)
    .slice(0, 12);
}

function addOffers(profile: PlayerProfile, coach: CoachCareerState, count: number, rng: RandomSource, floorOnly = false): CoachJobOffer[] {
  const created: CoachJobOffer[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidates = offerCandidates(profile, coach, 6, floorOnly);
    if (!candidates.length) break;
    const club = candidates[Math.floor(rng.next() * candidates.length)];
    const offer = buildOffer(coach, club, playedRounds(profile), coach.jobOffers.length + 1);
    const open = coach.jobOffers.filter((item) => item.status === 'OPEN');
    if (open.length >= GAME_BALANCE.coach.maxOpenOffers) open[0].status = 'EXPIRED';
    coach.jobOffers = [...coach.jobOffers, offer].slice(-8);
    created.push(offer);
  }
  return created;
}

export function createCoachCareer(profileInput: PlayerProfile, coachName = profileInput.displayName, now = new Date(), rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = ensureCoachClubState(profileInput, now, rng);
  if (profile.coach) return profile;
  const club = currentClubRecord(profile);
  const coach: CoachCareerState = {
    coachName,
    age: GAME_BALANCE.coach.initialAge,
    level: 1,
    totalExp: 0,
    salary: club?.coachSalaryBase ?? 1_000,
    unassignedExp: 0,
    abilities: defaultCoachAbilities(),
    approval: GAME_BALANCE.coach.initialApproval,
    status: 'EMPLOYED',
    careerYear: 1,
    season: 1,
    boardTarget: targetFor(profile, 1),
    jobOffers: [],
    honors: []
  };
  // Onboarding: a few rookie-level clubs also approach the new coach.
  addOffers(profile, coach, 3, rng, true);
  profile.coach = coach;
  profile.updatedAt = now.toISOString();
  return profile;
}

export function advanceCoachRound(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): CoachRoundResult {
  const prepared = ensureCoachClubState(profileInput, now, rng);
  const coach = coachOrThrow(prepared);
  if (coach.status !== 'EMPLOYED') throw new Error('Coach tidak sedang terikat kontrak dengan club. Terima job offer terlebih dahulu.');
  if (isClubSeasonComplete(prepared.coachClubState)) throw new Error('Season Coach sudah selesai. Buka Season Settlement untuk menutup season dan memulai season berikutnya.');
  if (coach.event && !coach.event.resolved && coach.event.blocking !== false) throw new Error('Selesaikan Coach management decision terlebih dahulu dari Coach Home.');
  const match = playClubMatch(prepared, now, rng, 'coachClubState', { coach });
  const profile = match.profile;
  const updatedCoach = clone(coachOrThrow(profile));
  const exp = coachExpFor(match.outcome, updatedCoach.level, rng);
  updatedCoach.totalExp += exp;
  updatedCoach.unassignedExp += exp;
  const target = clone(updatedCoach.boardTarget);
  target.progressRank = currentRank(profile);
  const approvalDelta = approvalForRound({ ...profile, coach: updatedCoach }, match.outcome, target);
  updatedCoach.approval = clamp(updatedCoach.approval + approvalDelta, 0, 100);
  updatedCoach.boardTarget = target;
  let event: CoachEvent | undefined;
  if (updatedCoach.approval <= GAME_BALANCE.coach.dismissalApproval) {
    updatedCoach.status = 'UNEMPLOYED';
    updatedCoach.dismissedAt = now.toISOString();
    updatedCoach.event = undefined;
    addOffers(profile, updatedCoach, 2, rng, true);
  } else {
    event = makeCoachEvent({ ...profile, coach: updatedCoach }, rng, now);
    if (event) updatedCoach.event = event;
  }
  profile.coach = updatedCoach;
  profile.updatedAt = now.toISOString();
  return {
    profile,
    match,
    coachExp: exp,
    approvalDelta,
    boardTarget: clone(target),
    seasonComplete: isClubSeasonComplete(profile.coachClubState),
    event: event ? clone(event) : undefined
  };
}

export function assignCoachExp(profileInput: PlayerProfile, allocations: Partial<Record<CoachAbilityId, number>>, now = new Date()): CoachExpAllocationResult {
  const profile = clone(profileInput);
  const coach = coachOrThrow(profile);
  if (coach.status === 'RETIRED') throw new Error('Coach yang sudah pensiun tidak dapat menerima EXP. Pilih Rebirth untuk memulai ulang.');
  const total = Object.values(allocations).reduce((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isInteger(total) || total <= 0) throw new Error('Alokasi EXP Coach harus bilangan bulat lebih besar dari 0.');
  if (total > coach.unassignedExp) throw new Error(`EXP Coach tidak cukup. Tersedia ${coach.unassignedExp}.`);
  let levelsGained = 0;
  for (const [id, amount] of Object.entries(allocations) as Array<[CoachAbilityId, number | undefined]>) {
    if (amount === undefined || amount === 0) continue;
    if (!COACH_ABILITIES.includes(id)) throw new Error(`Coach ability tidak dikenal: ${id}.`);
    if (!Number.isInteger(amount) || amount < 0) throw new Error('Alokasi EXP tidak boleh pecahan atau negatif.');
    const state = coach.abilities[id];
    state.exp += amount;
    while (state.exp >= nextAbilityExp(state.level)) {
      state.exp -= nextAbilityExp(state.level);
      state.level += 1;
      levelsGained += 1;
    }
  }
  coach.unassignedExp -= total;
  coach.level = Math.max(...COACH_ABILITIES.map((id) => coach.abilities[id].level));
  profile.updatedAt = now.toISOString();
  return { profile, allocated: total, remaining: coach.unassignedExp, levelsGained };
}

export function generateJobOffer(profileInput: PlayerProfile, rng: RandomSource = new MathRandomSource(), now = new Date()): { profile: PlayerProfile; offer: CoachJobOffer } {
  const profile = clone(profileInput);
  const coach = coachOrThrow(profile);
  if (coach.status === 'RETIRED') throw new Error('Coach yang sudah pensiun tidak dapat mencari job baru.');
  const round = playedRounds(profile);
  if (coach.status === 'EMPLOYED' && coach.lastOfferSeason === coach.season && coach.lastOfferRound === round) throw new Error('Agen sudah mencari tawaran pada round ini. Mainkan round berikutnya untuk tawaran baru.');
  const [offer] = addOffers(profile, coach, 1, rng);
  if (!offer) throw new Error('Belum ada club lain yang membuka lowongan untuk reputasi Coach saat ini.');
  coach.lastOfferRound = round;
  coach.lastOfferSeason = coach.season;
  profile.updatedAt = now.toISOString();
  return { profile, offer: clone(offer) };
}

export function declineJobOffer(profileInput: PlayerProfile, offerId: string, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  const coach = coachOrThrow(profile);
  const offer = coach.jobOffers.find((item) => item.id === offerId && item.status === 'OPEN');
  if (!offer) throw new Error('Job offer tidak ditemukan atau sudah ditutup.');
  offer.status = 'DECLINED';
  profile.updatedAt = now.toISOString();
  return profile;
}

export function acceptJobOffer(profileInput: PlayerProfile, offerId: string, now = new Date(), rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = clone(profileInput);
  const coach = coachOrThrow(profile);
  if (coach.status === 'RETIRED') throw new Error('Coach yang sudah pensiun tidak dapat menerima job offer. Pilih Rebirth untuk memulai ulang.');
  const offer = coach.jobOffers.find((item) => item.id === offerId && item.status === 'OPEN');
  if (!offer) throw new Error('Job offer tidak ditemukan atau sudah ditutup.');
  offer.status = 'ACCEPTED';
  // Leaving before the first round keeps the season number; leaving mid-season abandons it.
  const seasonStarted = playedRounds(profile) > 0;
  const nextCoachSeason = seasonStarted ? coach.season + 1 : coach.season;
  delete profile.coachClubState;
  const seed = { ...profile, club: offer.clubName, league: { ...profile.league, season: nextCoachSeason, matchday: 1, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 } };
  const rebuiltState = ensureClubState(seed, now, rng, 'coachClubState');
  profile.coachClubState = rebuiltState.coachClubState;
  profile.coachMarket = undefined;
  const updatedCoach = coachOrThrow(profile);
  updatedCoach.status = 'EMPLOYED';
  updatedCoach.salary = offer.salary;
  if (seasonStarted) updatedCoach.careerYear += 1;
  updatedCoach.season = nextCoachSeason;
  updatedCoach.boardTarget = targetFor(profile, updatedCoach.season, offer.targetType ? { type: offer.targetType, targetRank: offer.targetRank } : undefined);
  updatedCoach.event = undefined;
  updatedCoach.dismissedAt = undefined;
  updatedCoach.championsLeague = undefined;
  for (const other of updatedCoach.jobOffers) if (other.status === 'OPEN') other.status = 'EXPIRED';
  profile.updatedAt = now.toISOString();
  return profile;
}

export function resolveCoachEvent(profileInput: PlayerProfile, choiceId: string, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  const coach = coachOrThrow(profile);
  if (coach.status !== 'EMPLOYED') throw new Error('Coach tidak sedang employed sehingga event tidak dapat diselesaikan.');
  const event = coach.event;
  if (!event || event.resolved) throw new Error('Tidak ada Coach event yang menunggu keputusan.');
  const choice = event.choices.find((item) => item.id === choiceId);
  if (!choice) throw new Error('Pilihan event Coach tidak ditemukan.');
  coach.approval = clamp(coach.approval + choice.approvalDelta, 0, 100);
  if (profile.coachClubState) profile.coachClubState.assets = Math.max(0, profile.coachClubState.assets + choice.moneyDelta);
  coach.totalExp += choice.expDelta;
  coach.unassignedExp += choice.expDelta;
  if (choice.ability) {
    const state = coach.abilities[choice.ability];
    state.exp += Math.max(0, Math.floor(choice.expDelta / 2));
    while (state.exp >= nextAbilityExp(state.level)) {
      state.exp -= nextAbilityExp(state.level);
      state.level += 1;
    }
    coach.level = Math.max(coach.level, ...COACH_ABILITIES.map((id) => coach.abilities[id].level));
  }
  event.resolved = true;
  profile.updatedAt = now.toISOString();
  return profile;
}

export interface CoachSeasonSummary {
  rank: number;
  points: number;
  leagueLabel: string;
  nextLeagueLabel: string;
  movement: 'PROMOTED' | 'RELEGATED' | 'STAYED';
  targetType: CoachTargetType;
  targetRank: number;
  success: boolean;
  approvalDelta: number;
  championsQualified: boolean;
  dismissed: boolean;
}

export function settleCoachSeason(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): PlayerProfile {
  return settleCoachSeasonWithSummary(profileInput, now, rng).profile;
}

export function settleCoachSeasonWithSummary(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): { profile: PlayerProfile; summary: CoachSeasonSummary } {
  const snapshot = ensureCoachClubState(profileInput, now, rng);
  const coach = coachOrThrow(snapshot);
  if (coach.status !== 'EMPLOYED') throw new Error('Coach tidak sedang employed sehingga season tidak dapat diselesaikan.');
  if (snapshot.coachClubState?.fixtures.some((fixture) => !fixture.played)) throw new Error('Belum semua fixture Coach selesai.');
  const leagueId = snapshot.coachClubState ? resolveClubLeagueId(snapshot.coachClubState) : undefined;
  const clubName = coachClubName(snapshot);
  const playerLeague = clone(snapshot.league);
  const coachSeasonInput = { ...snapshot, league: { ...snapshot.league, season: coach.season } };
  const updated = finishSeason(coachSeasonInput, now, 'coachClubState', rng);
  updated.league = playerLeague;
  const result = updated.coachClubState!.lastSeasonResult!;
  const target = clone(coach.boardTarget);
  target.progressRank = result.rank;
  target.resolved = true;
  const success = result.rank <= target.targetRank || (target.type === 'PROMOTION' && result.movement === 'PROMOTED');
  const nextCoach = coachOrThrow(updated);
  const approvalDelta = success ? target.approvalDeltaOnSuccess : target.approvalDeltaOnFailure;
  nextCoach.approval = clamp(nextCoach.approval + approvalDelta, 0, 100);
  const honors: HonorRecord[] = [];
  if (success && updated.coachClubState) updated.coachClubState.assets += target.rewardMoney;
  if (result.rank === 1) honors.push({ id: `coach-champion-${updated.userId}-${coach.season}-${clubName}`, category: 'TEAM', title: `League Champion · ${clubName}`, season: coach.season, description: `Juara ${leagueLabel(leagueId)} dengan ${result.points} poin.`, source: 'RECOVERY_INFERRED', value: result.points, awardedAt: now.toISOString() });
  if (result.movement === 'PROMOTED') honors.push({ id: `coach-promotion-${updated.userId}-${coach.season}-${clubName}`, category: 'TEAM', title: `Promotion · ${clubName}`, season: coach.season, description: `Promosi ke ${leagueLabel(result.nextLeagueId)}.`, source: 'RECOVERY_INFERRED', value: result.rank, awardedAt: now.toISOString() });
  nextCoach.honors = [...nextCoach.honors, ...honors.filter((item) => !nextCoach.honors.some((existing) => existing.id === item.id))];
  nextCoach.careerYear += 1;
  nextCoach.age += 1;
  nextCoach.season = coach.season + 1;
  const dismissed = nextCoach.approval < GAME_BALANCE.coach.seasonDismissalApproval;
  nextCoach.status = dismissed ? 'UNEMPLOYED' : 'EMPLOYED';
  if (dismissed) nextCoach.dismissedAt = now.toISOString();
  nextCoach.boardTarget = targetFor(updated, nextCoach.season);
  nextCoach.championsLeague = undefined;
  nextCoach.event = undefined;
  nextCoach.lastSeasonResult = result;
  // Season end is when the market moves: dismissed coaches get fallback offers, successful ones get interest.
  addOffers(updated, nextCoach, dismissed ? 2 : success ? 1 : 0, rng, dismissed);
  updated.coachMarket = undefined;
  updated.updatedAt = now.toISOString();
  return {
    profile: updated,
    summary: {
      rank: result.rank,
      points: result.points,
      leagueLabel: leagueLabel(leagueId),
      nextLeagueLabel: leagueLabel(result.nextLeagueId),
      movement: result.movement,
      targetType: target.type,
      targetRank: target.targetRank,
      success,
      approvalDelta,
      championsQualified: result.championsQualified,
      dismissed
    }
  };
}

export function retireCoach(profileInput: PlayerProfile, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  const coach = coachOrThrow(profile);
  if (coach.status === 'RETIRED') throw new Error('Coach sudah pensiun.');
  const honor: HonorRecord = {
    id: `coach-retirement-${profile.userId}-${coach.careerYear}`,
    category: 'PERSONAL',
    title: `${coach.coachName} — Coach Legacy`,
    season: coach.season,
    description: `Pensiun setelah ${coach.careerYear} tahun karier dengan approval ${coach.approval}.`,
    source: 'RECOVERY_INFERRED',
    value: coach.level,
    awardedAt: now.toISOString()
  };
  coach.honors = [...coach.honors, honor];
  coach.status = 'RETIRED';
  coach.retiredAt = now.toISOString();
  coach.event = undefined;
  for (const offer of coach.jobOffers) if (offer.status === 'OPEN') offer.status = 'EXPIRED';
  profile.updatedAt = now.toISOString();
  return profile;
}

export function rebirthCoach(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = clone(profileInput);
  const oldCoach = coachOrThrow(profile);
  if (oldCoach.status !== 'RETIRED') throw new Error('Coach harus pensiun sebelum rebirth.');
  const honors = clone(oldCoach.honors);
  const bonusLevels = Math.min(3, Math.floor(honors.length / 2));
  const previousCoachClub = coachClubName(profile);
  delete profile.coachClubState;
  const seed = { ...profile, club: previousCoachClub };
  const rebuiltState = ensureClubState(seed, now, rng, 'coachClubState');
  profile.coachClubState = rebuiltState.coachClubState;
  profile.coachMarket = undefined;
  const abilities = defaultCoachAbilities();
  for (const id of COACH_ABILITIES) abilities[id].level += bonusLevels;
  profile.coach = {
    coachName: oldCoach.coachName,
    age: GAME_BALANCE.coach.initialAge,
    level: 1 + bonusLevels,
    salary: currentClubRecord(profile)?.coachSalaryBase ?? 1_000,
    totalExp: 0,
    unassignedExp: 0,
    abilities,
    approval: GAME_BALANCE.coach.initialApproval,
    status: 'EMPLOYED',
    careerYear: 1,
    season: oldCoach.season + 1,
    boardTarget: targetFor(profile, oldCoach.season + 1),
    jobOffers: [],
    honors
  };
  profile.updatedAt = now.toISOString();
  return profile;
}

export function formatCoachProfile(profileInput: PlayerProfile): string {
  const coach = coachOrThrow(profileInput);
  const abilities = COACH_ABILITIES.map((id) => `${COACH_ABILITY_LABELS[id]} Lv ${coach.abilities[id].level} (${coach.abilities[id].exp} EXP)`).join('\n');
  const target = coach.boardTarget;
  return `**${coach.coachName}** · age ${coach.age} · level ${coach.level} · reputation ${coachReputation(coach)}\nStatus **${coach.status}** · approval **${coach.approval}/100** · salary **${coach.salary}**\nUnassigned Coach EXP **${coach.unassignedExp}**\n\n${abilities}\n\nBoard target **${target.type}** · target rank **${target.targetRank}** · current rank **${target.progressRank ?? '-'}**`;
}

export function getCoachNextRoundAt(profileInput: PlayerProfile, now = new Date()): Date | undefined {
  const coach = coachOrThrow(profileInput);
  if (coach.status !== 'EMPLOYED') return undefined;
  const fixture = profileInput.coachClubState?.fixtures.find((item) => !item.played);
  return fixture?.playedAt ? new Date(fixture.playedAt) : new Date(now.getTime() + WEEK_MS);
}
