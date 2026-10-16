import { RECOVERY_CLUBS } from '../config/recovery-data.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import { FORMATIONS, TACTICS, type AbilityId, type FormationId, type MatchOutcome, type PlayerProfile, type TacticId, type VersusBattle, type VersusBattleStats, type VersusClub, type VersusPlayer, type VersusPlayerSnapshot, type VersusSeason, type VersusSeasonReward, type VersusSideReward, type VersusStanding, type VersusSubmission } from './types.js';
import { MathRandomSource, SeededRandom, type RandomSource } from './engine.js';
import { createVersusMarket } from './versus-economy.js';

const RULESET_VERSION = 'versus-recovery-inferred-v1';
const DEFAULT_GROUP_CAPACITY = GAME_BALANCE.versus.defaultGroupCapacity;
const MAX_GOALS = GAME_BALANCE.versus.maxGoals;
const ROUND_MS = GAME_BALANCE.versus.roundDurationDays * 86_400_000;
const VERSUS_PLAYER_NAMES = ['Alex', 'Bobby', 'Carlos', 'Dani', 'Evan', 'Felix', 'Gio', 'Hugo', 'Ivan', 'Jules', 'Kai', 'Leo', 'Mika', 'Noah', 'Owen', 'Pavel', 'Quinn', 'Rafi', 'Sam', 'Theo', 'Uma', 'Victor'];
const FORMATION_SLOTS: Record<FormationId, { GK: number; DF: number; MF: number; FW: number }> = {
  '4-4-2': { GK: 1, DF: 4, MF: 4, FW: 2 },
  '4-3-3': { GK: 1, DF: 4, MF: 3, FW: 3 },
  '3-5-2': { GK: 1, DF: 3, MF: 5, FW: 2 },
  '5-3-2': { GK: 1, DF: 5, MF: 3, FW: 2 },
  '4-1-3-2': { GK: 1, DF: 4, MF: 4, FW: 2 },
  '3-4-3': { GK: 1, DF: 3, MF: 4, FW: 3 },
  '4-2-3-1': { GK: 1, DF: 4, MF: 5, FW: 1 }
};
const POSITION_ORDER: Array<keyof VersusPlayer['abilities']> = ['atk', 'def', 'speed', 'power', 'strength', 'technique'];
const VERSUS_LEAGUE_CODES = ['S', 'A', 'B', 'C', 'D', 'E'] as const;

export function versusLeagueCode(grade: number): string {
  const index = clamp(Math.floor(grade), 0, VERSUS_LEAGUE_CODES.length - 1);
  return VERSUS_LEAGUE_CODES[index] ?? 'E';
}

export function versusPromotionLeagueCode(grade: number, promoted: boolean): string | undefined {
  if (!promoted) return undefined;
  return versusLeagueCode(Math.max(0, Math.floor(grade) - 1));
}

export function versusRelegationLeagueCode(grade: number, relegated: boolean): string | undefined {
  if (!relegated) return undefined;
  return versusLeagueCode(Math.min(VERSUS_LEAGUE_CODES.length - 1, Math.floor(grade) + 1));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function abilityScore(player: VersusPlayer): number {
  return POSITION_ORDER.reduce((sum, key) => sum + player.abilities[key], 0) / POSITION_ORDER.length;
}

function positionFromIndex(index: number): VersusPlayer['position'] {
  if (index === 0) return 'GK';
  if (index <= 5) return 'DF';
  if (index <= 12) return 'MF';
  return 'FW';
}

function createVersusPlayer(id: string, name: string, index: number, clubId: string, base: number): VersusPlayer {
  const position = positionFromIndex(index);
  const abilities: Record<AbilityId, number> = {
    atk: clamp(base + (position === 'FW' ? 8 : position === 'MF' ? 3 : 0), 20, 99),
    def: clamp(base + (position === 'GK' || position === 'DF' ? 8 : 0), 20, 99),
    speed: clamp(base + (position === 'FW' || position === 'MF' ? 5 : 1), 20, 99),
    power: clamp(base + 2, 20, 99),
    strength: clamp(base + (position === 'DF' ? 5 : 1), 20, 99),
    technique: clamp(base + (position === 'MF' ? 7 : position === 'FW' ? 4 : 0), 20, 99)
  };
  return {
    id,
    name,
    age: 18 + (index % 15),
    initialAge: 18 + (index % 15),
    position,
    value: Math.round(base * 100 + index * 25),
    abilities,
    hp: 100,
    maxHp: 100,
    status: 'AVAILABLE',
    yellowCards: 0,
    redCardBan: 0,
    captain: index === 1,
    clubId,
    growthType: index % 3,
    goals: 0,
    assists: 0,
    appearances: 0
  };
}

function createRoster(clubId: string, base: number, seedNames?: string[]): VersusPlayer[] {
  return Array.from({ length: 18 }, (_, index) => createVersusPlayer(`${clubId}:p${index + 1}`, seedNames?.[index] ?? VERSUS_PLAYER_NAMES[index], index, clubId, base + (index % 4) * 2));
}

function profileRosterNames(profile: PlayerProfile): string[] {
  return [profile.displayName, ...VERSUS_PLAYER_NAMES.slice(0, 17)];
}

function ensureVersusClub(profile: PlayerProfile, now: Date): VersusClub {
  const existing = profile.versus?.club;
  if (existing) return clone(existing);
  const id = `vclub:${profile.userId}`;
  // Versus is a separate aggregate; its initial roster must not inherit Player progression.
  const base = 52;
  return {
    id,
    ownerId: profile.userId,
    name: `${profile.displayName} FC`,
    isNpc: false,
    grade: 1,
    country: 0,
    rosterVersion: 1,
    formation: '4-4-2',
    tactic: 'balanced',
    budget: 20_000,
    versusMoney: 2_000,
    versusCoin: 20,
    score: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    rank: 1,
    roster: createRoster(id, base, profileRosterNames(profile))
  };
}

function makeNpcClub(index: number, now: Date): VersusClub {
  const source = RECOVERY_CLUBS.filter((club) => club.league === 1011)[index % Math.max(1, RECOVERY_CLUBS.filter((club) => club.league === 1011).length)];
  const id = `vnpc:${source?.id ?? index + 1}`;
  const base = clamp(54 + (source?.grade ?? 1) * 3 + index, 50, 88);
  return {
    id,
    name: `${source?.nameEn ?? 'Rising Academy'} Versus`,
    isNpc: true,
    grade: source?.grade ?? 1,
    country: source?.country ?? 0,
    rosterVersion: 1,
    formation: '4-4-2',
    tactic: 'balanced',
    budget: 25_000,
    versusMoney: 2_000,
    versusCoin: 20,
    score: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    rank: index + 1,
    roster: createRoster(id, base)
  };
}

export function createVersusClub(profileInput: PlayerProfile, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  const club = ensureVersusClub(profile, now);
  if (!profile.versus) {
    profile.versus = {
      status: 'IDLE',
      clubId: club.id,
      enrolledAt: now.toISOString(),
      lastProcessedAt: now.toISOString(),
      versusMoney: club.versusMoney,
      versusCoin: club.versusCoin,
      club,
      history: []
    };
  } else {
    profile.versus.club = club;
    profile.versus.clubId = club.id;
    profile.versus.versusMoney = club.versusMoney;
    profile.versus.versusCoin = club.versusCoin;
  }
  profile.updatedAt = now.toISOString();
  return profile;
}

function normalizeQueueKey(value: string): string {
  const queueKey = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,23}$/.test(queueKey)) throw new Error('Versus matchmaking queue tidak valid.');
  return queueKey;
}

export function queueVersusMatchmaking(profileInput: PlayerProfile, queueKey = 'public', now = new Date()): PlayerProfile {
  const profile = createVersusClub(profileInput, now);
  const versus = profile.versus!;
  if ((versus.status === 'IN_GAME' && versus.groupCode && versus.season?.state === 'ACTIVE') || (versus.status === 'ENROLLED' && versus.groupCode)) return profile;
  const queue = normalizeQueueKey(queueKey);
  versus.status = 'IDLE';
  const ratingSnapshot = Math.round(versus.club.roster.reduce((sum, player) => sum + abilityScore(player), 0) / Math.max(1, versus.club.roster.length));
  versus.matchmaking = {
    ticketId: `vqueue:${profile.userId}:${now.getTime()}`,
    status: 'QUEUED',
    queueKey: queue,
    queuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GAME_BALANCE.versus.matchmakingTicketTtlSeconds * 1_000).toISOString(),
    ratingSnapshot,
    rosterVersion: versus.club.rosterVersion
  };
  profile.updatedAt = now.toISOString();
  return profile;
}

export function assignVersusMatchmaking(profileInput: PlayerProfile, groupCode: string, now = new Date()): PlayerProfile {
  const profile = enrollVersus(profileInput, groupCode, now);
  const versus = profile.versus!;
  if (versus.matchmaking) {
    versus.matchmaking.status = 'MATCHED';
    versus.matchmaking.matchedAt = now.toISOString();
    versus.matchmaking.groupCode = versus.groupCode;
    versus.matchmaking.assignmentId = `vassignment:${versus.groupCode}`;
  }
  profile.updatedAt = now.toISOString();
  return profile;
}

export function enrollVersus(profileInput: PlayerProfile, groupCode: string, now = new Date()): PlayerProfile {
  const code = groupCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) throw new Error('Group code harus 4–24 karakter alfanumerik atau tanda hubung.');
  const profile = createVersusClub(profileInput, now);
  const versus = profile.versus!;
  if (versus.status === 'IN_GAME' && versus.groupCode !== code) throw new Error('Club Versus sudah terkunci di group lain sampai season berakhir.');
  if ((versus.status === 'IN_GAME' || versus.status === 'ENROLLED') && versus.groupCode === code) return profile;
  versus.status = 'ENROLLED';
  versus.groupCode = code;
  versus.enrolledAt = now.toISOString();
  versus.lastProcessedAt = now.toISOString();
  profile.updatedAt = now.toISOString();
  return profile;
}

function standingsFor(season: VersusSeason): VersusStanding[] {
  return season.clubs
    .map((club) => ({
      clubId: club.id,
      clubName: club.name,
      isNpc: club.isNpc,
      rank: club.rank,
      points: club.wins * GAME_BALANCE.versus.winPoints + club.draws * GAME_BALANCE.versus.drawPoints,
      played: club.wins + club.draws + club.losses,
      wins: club.wins,
      draws: club.draws,
      losses: club.losses,
      goalsFor: club.goalsFor,
      goalsAgainst: club.goalsAgainst,
      goalDifference: club.goalsFor - club.goalsAgainst
    }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.clubId.localeCompare(b.clubId))
    .map((standing, index) => ({ ...standing, rank: index + 1 }));
}

function buildRoundBattles(seasonId: string, clubs: VersusClub[], startAt: Date): VersusBattle[] {
  const battles: VersusBattle[] = [];
  const n = clubs.length;
  if (n < 2) return battles;
  const legRounds = n - 1;
  const rotation = [...clubs];
  for (let leg = 0; leg < 2; leg += 1) {
    const current = [...rotation];
    for (let roundIndex = 0; roundIndex < legRounds; roundIndex += 1) {
      const round = leg * legRounds + roundIndex + 1;
      for (let pair = 0; pair < n / 2; pair += 1) {
        const left = current[pair];
        const right = current[n - 1 - pair];
        const flip = (roundIndex + pair + leg) % 2 === 1;
        const home = flip ? right : left;
        const away = flip ? left : right;
        battles.push({
          id: `${seasonId}:r${round}:${pair + 1}`,
          seasonId,
          roundId: round,
          scheduledAt: new Date(startAt.getTime() + (round - 1) * 86_400_000).toISOString(),
          homeClubId: home.id,
          awayClubId: away.id,
          state: 'OPEN'
        });
      }
      const fixed = current[0];
      const tail = current.slice(1);
      current.splice(0, current.length, fixed, tail[tail.length - 1], ...tail.slice(0, -1));
    }
  }
  return battles;
}

function initialSeason(groupCode: string, profiles: PlayerProfile[], now: Date, capacity = DEFAULT_GROUP_CAPACITY): VersusSeason {
  const humanClubs = profiles.map((profile) => ensureVersusClub(profile, now));
  const clubs = [...humanClubs];
  for (let index = 0; clubs.length < Math.max(GAME_BALANCE.versus.minimumLeagueClubs, capacity); index += 1) clubs.push(makeNpcClub(index, now));
  const id = `vseason:${groupCode}:${dateKey(now)}`;
  const season: VersusSeason = {
    id,
    groupCode,
    leagueId: `vleague:${groupCode}`,
    grade: 1,
    capacity,
    rulesetVersion: RULESET_VERSION,
    state: 'ACTIVE',
    startAt: now.toISOString(),
    currentRound: 1,
    roundDeadline: new Date(now.getTime() + ROUND_MS).toISOString(),
    clubs,
    battles: [],
    standings: [],
    rewards: []
  };
  season.battles = buildRoundBattles(season.id, season.clubs, now);
  season.standings = standingsFor(season);
  season.market = createVersusMarket(season, now).market;
  return season;
}

export function createVersusSeason(groupCode: string, profiles: PlayerProfile[], now = new Date(), capacity = DEFAULT_GROUP_CAPACITY): VersusSeason {
  const normalized = profiles.filter((profile, index, list) => list.findIndex((item) => item.userId === profile.userId) === index);
  const code = groupCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) throw new Error('Group code Versus tidak valid.');
  if (normalized.length === 0) throw new Error('Versus season membutuhkan minimal satu user.');
  if (normalized.some((profile) => profile.versus?.groupCode !== code)) throw new Error('Semua profile season harus sudah terdaftar pada group Versus yang sama.');
  const seasonCapacity = Math.max(GAME_BALANCE.versus.minimumLeagueClubs, Math.floor(capacity));
  if (!Number.isFinite(seasonCapacity) || seasonCapacity < normalized.length) throw new Error('Jumlah anggota melebihi capacity season Versus.');
  if (seasonCapacity % 2 !== 0) throw new Error('Capacity season Versus harus genap agar setiap round memiliki pasangan home-away lengkap.');
  return initialSeason(code, normalized, now, seasonCapacity);
}

function clubById(season: VersusSeason, id: string): VersusClub {
  const club = season.clubs.find((item) => item.id === id);
  if (!club) throw new Error(`Versus club ${id} tidak ditemukan.`);
  return club;
}

function recoverVersusRoster(roster: VersusPlayer[], now: Date): void {
  // Condition/card/injury recovery cadence is RECOVERY_INFERRED for this Discord adaptation.
  for (const player of roster) {
    player.hp = clamp(player.hp + GAME_BALANCE.versus.lineupHpCost, 0, player.maxHp);
    if (player.redCardBan > 0) player.redCardBan -= 1;
    if (player.status === 'INJURED' && player.injuryEndsAt && new Date(player.injuryEndsAt).getTime() <= now.getTime()) {
      player.status = 'AVAILABLE';
      player.injuryType = undefined;
      player.injuryEndsAt = undefined;
    }
    if (player.status === 'SUSPENDED' && player.redCardBan === 0) player.status = 'AVAILABLE';
  }
}

function canPlay(player: VersusPlayer, now: Date): boolean {
  if (player.hp <= 0 || player.status === 'SUSPENDED' || player.redCardBan > 0) return false;
  if (player.status === 'INJURED') return Boolean(player.injuryEndsAt) && new Date(player.injuryEndsAt!).getTime() <= now.getTime();
  return true;
}

function formationSlots(formation: FormationId): number[] {
  const slots = FORMATION_SLOTS[formation];
  return [slots.GK, slots.DF, slots.MF, slots.FW];
}

function defaultSubmission(battle: VersusBattle, club: VersusClub, now: Date): VersusSubmission {
  const slots = FORMATION_SLOTS[club.formation];
  const selected: VersusPlayer[] = [];
  for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
    const candidates = club.roster.filter((player) => player.position === position && canPlay(player, now));
    selected.push(...candidates.slice(0, slots[position]));
  }
  if (selected.length !== 11) throw new Error(`Versus club ${club.name} tidak memiliki lineup legal untuk ${club.formation}.`);
  const lineup = selected.map((player) => player.id);
  const substitutes = club.roster.filter((player) => !lineup.includes(player.id) && canPlay(player, now)).slice(0, 5).map((player) => player.id);
  const captain = selected.find((player) => player.captain)?.id ?? selected[0].id;
  return {
    battleId: battle.id,
    clubId: club.id,
    ownerId: club.ownerId,
    lineup,
    substitutes,
    captainId: captain,
    formation: club.formation,
    tactic: club.tactic,
    rosterVersion: club.rosterVersion,
    submittedAt: now.toISOString()
  };
}

function snapshotSubmission(submission: VersusSubmission, club: VersusClub, now: Date): VersusPlayerSnapshot[] {
  const ids = [...submission.lineup, ...submission.substitutes];
  return ids.map((id) => {
    const player = club.roster.find((item) => item.id === id);
    if (!player) throw new Error(`Versus player ${id} tidak ditemukan pada roster snapshot.`);
    return {
      id: player.id,
      name: player.name,
      position: player.position,
      abilityScore: abilityScore(player),
      hp: player.hp,
      status: player.status,
      injuryType: player.injuryType,
      yellowCards: player.yellowCards,
      redCardBan: player.redCardBan,
      clubId: player.clubId
    };
  });
}

function validateSubmission(submission: VersusSubmission, club: VersusClub, battleId: string, now: Date): void {
  if (!FORMATIONS[submission.formation] || !TACTICS[submission.tactic]) throw new Error('Formation atau tactic Versus tidak dikenal.');
  if (submission.battleId !== battleId || submission.clubId !== club.id) throw new Error('Submission Versus tidak cocok dengan battle.');
  if (submission.rosterVersion !== club.rosterVersion) throw new Error('Versus roster berubah setelah submission; submit ulang lineup.');
  if (submission.lineup.length !== 11 || submission.substitutes.length > 5 || new Set([...submission.lineup, ...submission.substitutes]).size !== submission.lineup.length + submission.substitutes.length) throw new Error('Lineup/substitute Versus tidak valid atau berisi pemain duplikat.');
  if (!submission.lineup.includes(submission.captainId)) throw new Error('Captain harus berada di starting XI.');
  const slots = FORMATION_SLOTS[submission.formation];
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const id of submission.lineup) {
    const player = club.roster.find((item) => item.id === id);
    if (!player || !canPlay(player, now)) throw new Error(`Pemain Versus ${id} tidak eligible untuk battle.`);
    counts[player.position] += 1;
  }
  if (counts.GK !== slots.GK || counts.DF !== slots.DF || counts.MF !== slots.MF || counts.FW !== slots.FW) throw new Error(`Lineup tidak cocok dengan formation ${submission.formation}.`);
}

function tacticModifier(tactic: TacticId): number {
  return { balanced: 0, attacking: 4, defensive: -2, counter: 2, 'down-wings': 3, 'middle-thrust': 3, 'tiki-taka': 2, 'long-ball': 1, 'offense-full': 6, 'defense-full': -4 }[tactic];
}

function formationModifier(formation: FormationId): number {
  return { '4-4-2': 0, '4-3-3': 2, '3-5-2': 2, '5-3-2': -1, '4-1-3-2': 1, '3-4-3': 3, '4-2-3-1': 2 }[formation];
}

function sideStrength(club: VersusClub, submission: VersusSubmission): number {
  const players = submission.lineup.map((id) => club.roster.find((player) => player.id === id)!).filter(Boolean);
  const average = players.reduce((sum, player) => sum + abilityScore(player) * (0.65 + player.hp / player.maxHp * 0.35), 0) / Math.max(1, players.length);
  const captain = players.find((player) => player.id === submission.captainId);
  return average + formationModifier(submission.formation) + tacticModifier(submission.tactic) + (captain ? 2 : 0);
}

function goalsFor(attack: number, defence: number, rng: RandomSource): number {
  const chance = clamp(GAME_BALANCE.versus.baseGoalChance + (attack - defence) / 300, 0.04, GAME_BALANCE.versus.maxGoalChance);
  let goals = 0;
  for (let attempt = 0; attempt < GAME_BALANCE.versus.matchAttempts; attempt += 1) if (rng.next() < chance + attempt * 0.006) goals += 1;
  return clamp(goals, 0, MAX_GOALS);
}

function statsFor(attack: number, defence: number, possession: number, rng: RandomSource): VersusBattleStats {
  const shots = clamp(Math.round(8 + attack / 7 + rng.next() * 5), 3, 30);
  const shotsOnTarget = clamp(Math.round(shots * clamp(0.32 + (attack - defence) / 250, 0.2, 0.7)), 1, shots);
  return {
    ballControl: Math.round(possession),
    shots,
    shotsOnTarget,
    corners: clamp(Math.round(2 + attack / 25 + rng.next() * 3), 0, 12),
    yellowCards: rng.next() < 0.24 ? 1 : 0,
    redCards: rng.next() < GAME_BALANCE.versus.redCardChance ? 1 : 0
  };
}

function sideReward(outcome: MatchOutcome): VersusSideReward {
  const reward = outcome === 'WIN' ? GAME_BALANCE.versus.winReward : outcome === 'DRAW' ? GAME_BALANCE.versus.drawReward : GAME_BALANCE.versus.lossReward;
  return { ...reward };
}

function outcome(homeGoals: number, awayGoals: number): MatchOutcome {
  return homeGoals > awayGoals ? 'WIN' : homeGoals < awayGoals ? 'LOSS' : 'DRAW';
}

function applySideResult(club: VersusClub, goalsForValue: number, goalsAgainstValue: number, result: MatchOutcome, reward: VersusSideReward, submission: VersusSubmission, rng: RandomSource, now: Date): void {
  club.goalsFor += goalsForValue;
  club.goalsAgainst += goalsAgainstValue;
  club.versusMoney += reward.money;
  club.versusCoin += reward.coin;
  club.budget += reward.money;
  if (result === 'WIN') club.wins += 1;
  else if (result === 'DRAW') club.draws += 1;
  else club.losses += 1;
  for (const playerId of submission.lineup) {
    const player = club.roster.find((item) => item.id === playerId);
    if (!player) continue;
    player.appearances += 1;
    player.hp = clamp(player.hp - GAME_BALANCE.versus.lineupHpCost + reward.conditionRecovery * 2, 0, player.maxHp);
    if (rng.next() < GAME_BALANCE.versus.injuryChance && player.hp < 45) {
      player.status = 'INJURED';
      player.injuryType = 'MINOR';
      player.injuryEndsAt = new Date(now.getTime() + 2 * 86_400_000).toISOString();
    }
    if (rng.next() < GAME_BALANCE.versus.cardChance) player.yellowCards += 1;
    if (player.yellowCards >= 5) {
      player.status = 'SUSPENDED';
      player.redCardBan = Math.max(player.redCardBan, 1);
    }
  }
}

function simulateBattle(battle: VersusBattle, home: VersusClub, away: VersusClub, now: Date, rng: RandomSource, simulationSeed: number): VersusBattle {
  const homeSubmission = battle.homeSubmission ?? defaultSubmission(battle, home, now);
  const awaySubmission = battle.awaySubmission ?? defaultSubmission(battle, away, now);
  validateSubmission(homeSubmission, home, battle.id, now);
  validateSubmission(awaySubmission, away, battle.id, now);
  homeSubmission.snapshot = snapshotSubmission(homeSubmission, home, now);
  awaySubmission.snapshot = snapshotSubmission(awaySubmission, away, now);
  homeSubmission.lockedAt = now.toISOString();
  awaySubmission.lockedAt = now.toISOString();
  const homeStrength = sideStrength(home, homeSubmission) + GAME_BALANCE.versus.homeAdvantage;
  const awayStrength = sideStrength(away, awaySubmission);
  const homePossession = clamp(50 + (homeStrength - awayStrength) * 0.6, 35, 65);
  const halftimeHomeGoals = goalsFor(homeStrength, awayStrength, rng);
  const halftimeAwayGoals = goalsFor(awayStrength, homeStrength, rng);
  const secondHomeGoals = goalsFor(homeStrength, awayStrength, rng);
  const secondAwayGoals = goalsFor(awayStrength, homeStrength, rng);
  const homeGoals = clamp(halftimeHomeGoals + secondHomeGoals, 0, MAX_GOALS);
  const awayGoals = clamp(halftimeAwayGoals + secondAwayGoals, 0, MAX_GOALS);
  const homeStats = statsFor(homeStrength, awayStrength, homePossession, rng);
  const awayStats = statsFor(awayStrength, homeStrength, 100 - homePossession, rng);
  const result = outcome(homeGoals, awayGoals);
  const homePlayers = homeSubmission.lineup.map((id) => home.roster.find((player) => player.id === id)!).filter(Boolean);
  const awayPlayers = awaySubmission.lineup.map((id) => away.roster.find((player) => player.id === id)!).filter(Boolean);
  const mvp = [...homePlayers, ...awayPlayers].sort((a, b) => abilityScore(b) - abilityScore(a))[0];
  const homeReward = sideReward(result);
  const awayReward = sideReward(result === 'WIN' ? 'LOSS' : result === 'LOSS' ? 'WIN' : 'DRAW');
  applySideResult(home, homeGoals, awayGoals, result, homeReward, homeSubmission, rng, now);
  applySideResult(away, awayGoals, homeGoals, result === 'WIN' ? 'LOSS' : result === 'LOSS' ? 'WIN' : 'DRAW', awayReward, awaySubmission, rng, now);
  homeSubmission.ownerId = home.ownerId;
  awaySubmission.ownerId = away.ownerId;
  return {
    ...clone(battle),
    state: 'PUBLISHED',
    homeSubmission,
    awaySubmission,
    settlement: {
      battleId: battle.id,
      roundId: battle.roundId,
      homeGoals,
      awayGoals,
      halftime: { homeGoals: halftimeHomeGoals, awayGoals: halftimeAwayGoals },
      homeStats,
      awayStats,
      mvpPlayerId: mvp.id,
      mvpName: mvp.name,
      homeReward,
      awayReward,
      rulesetVersion: RULESET_VERSION,
      simulationSeed,
      settledAt: now.toISOString()
    }
  };
}

export function submitVersusLineup(seasonInput: VersusSeason, battleId: string, ownerId: string, lineup: string[], substitutes: string[], captainId: string, formation: FormationId, tactic: TacticId, rosterVersion: number, now = new Date()): VersusSeason {
  const season = clone(seasonInput);
  if (season.state !== 'ACTIVE') throw new Error('Versus season tidak aktif.');
  const battle = season.battles.find((item) => item.id === battleId);
  if (!battle) throw new Error('Battle Versus tidak ditemukan pada season ini.');
  if (battle.roundId !== season.currentRound) throw new Error(`Battle Versus berada pada round ${season.currentRound}, bukan round aktif.`);
  if (battle.state !== 'OPEN') throw new Error('Battle Versus sudah dikunci atau diselesaikan.');
  const deadline = new Date(season.roundDeadline).getTime();
  if (!Number.isFinite(deadline) || now.getTime() >= deadline) throw new Error(`Submission Versus sudah melewati deadline: ${season.roundDeadline}.`);
  const home = clubById(season, battle.homeClubId);
  const away = clubById(season, battle.awayClubId);
  const club = home.ownerId === ownerId ? home : away.ownerId === ownerId ? away : undefined;
  if (!club || club.isNpc) throw new Error('User bukan pemilik club pada battle Versus tersebut.');
  const submission: VersusSubmission = {
    battleId,
    clubId: club.id,
    ownerId,
    lineup: lineup.map((id) => id.trim()).filter(Boolean),
    substitutes: substitutes.map((id) => id.trim()).filter(Boolean),
    captainId: captainId.trim(),
    formation,
    tactic,
    rosterVersion,
    submittedAt: now.toISOString()
  };
  validateSubmission(submission, club, battleId, now);
  if (battle.homeClubId === club.id) battle.homeSubmission = submission;
  else battle.awaySubmission = submission;
  return season;
}

export function processVersusRound(seasonInput: VersusSeason, roundId = seasonInput.currentRound, now = new Date(), rng: RandomSource = new MathRandomSource()): VersusSeason {
  const season = clone(seasonInput);
  if (season.state !== 'ACTIVE') throw new Error('Versus season tidak aktif.');
  if (roundId !== season.currentRound) throw new Error(`Round Versus berikutnya adalah ${season.currentRound}.`);
  const deadline = new Date(season.roundDeadline).getTime();
  if (!Number.isFinite(deadline) || now.getTime() < deadline) throw new Error(`Round Versus belum mencapai deadline: ${season.roundDeadline}.`);
  const battles = season.battles.filter((battle) => battle.roundId === roundId);
  if (battles.length === 0) throw new Error('Tidak ada battle pada round Versus tersebut.');
  if (battles.some((battle) => battle.state === 'SETTLED' || battle.state === 'PUBLISHED')) throw new Error('Round Versus sudah diselesaikan; duplicate settlement ditolak.');
  for (const club of season.clubs) recoverVersusRoster(club.roster, now);
  const updatedBattles: VersusBattle[] = [];
  for (const battle of battles) {
    const home = clubById(season, battle.homeClubId);
    const away = clubById(season, battle.awayClubId);
    const processing = { ...battle, state: 'PROCESSING' as const };
    const simulationSeed = Math.floor(rng.next() * 2_147_483_647) || 1;
    updatedBattles.push(simulateBattle(processing, home, away, now, new SeededRandom(simulationSeed), simulationSeed));
  }
  season.battles = season.battles.map((battle) => updatedBattles.find((updated) => updated.id === battle.id) ?? battle);
  season.standings = standingsFor(season);
  season.currentRound += 1;
  season.roundDeadline = new Date(now.getTime() + ROUND_MS).toISOString();
  for (const standing of season.standings) clubById(season, standing.clubId).rank = standing.rank;
  return season;
}

export function getVersusStandings(seasonInput: VersusSeason): VersusStanding[] {
  const season = clone(seasonInput);
  season.standings = standingsFor(season);
  return clone(season.standings);
}

export function settleVersusSeason(seasonInput: VersusSeason, now = new Date()): VersusSeason {
  const season = clone(seasonInput);
  if (season.state === 'FINISHED') return season;
  const totalRounds = Math.max(1, 2 * (season.clubs.length - 1));
  if (season.battles.some((battle) => battle.roundId <= totalRounds && battle.state !== 'PUBLISHED' && battle.state !== 'SETTLED')) throw new Error('Versus season belum selesai. Proses semua round terlebih dahulu.');
  season.standings = standingsFor(season);
  season.state = 'FINISHED';
  season.endAt = now.toISOString();
  season.rewards = season.standings.map((standing) => ({
    clubId: standing.clubId,
    rank: standing.rank,
    money: Math.max(250, 2_000 - (standing.rank - 1) * 150),
    coin: Math.max(1, 20 - Math.floor((standing.rank - 1) / 2)),
    promoted: standing.rank <= 2,
    relegated: standing.rank > Math.max(4, season.clubs.length - 2),
    promotedToLeague: versusPromotionLeagueCode(season.grade, standing.rank <= 2),
    relegatedToLeague: versusRelegationLeagueCode(season.grade, standing.rank > Math.max(4, season.clubs.length - 2))
  }));
  return season;
}

export function syncVersusProfileWithSeason(profileInput: PlayerProfile, season: VersusSeason, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  if (!profile.versus || profile.versus.groupCode !== season.groupCode) throw new Error('Profile tidak terdaftar pada Versus group season ini.');
  const sourceClub = season.clubs.find((item) => item.id === profile.versus!.clubId);
  if (!sourceClub) throw new Error('Versus club user tidak ada pada season.');
  const club = clone(sourceClub);
  const reward = season.state === 'FINISHED' ? season.rewards.find((item) => item.clubId === club.id) : undefined;
  const historyEntry = reward ? profile.versus.history.find((item) => item.seasonId === season.id) : undefined;
  const appliedSeasonReward = reward ? historyEntry?.rewards ?? reward : undefined;

  if (reward && !historyEntry) {
    club.versusMoney += reward.money;
    club.versusCoin += reward.coin;
    club.budget += reward.money;
    profile.versus.history.push({ seasonId: season.id, rank: reward.rank, points: season.standings.find((item) => item.clubId === club.id)?.points ?? 0, rewards: clone(reward) });
  } else if (appliedSeasonReward) {
    club.versusMoney += appliedSeasonReward.money;
    club.versusCoin += appliedSeasonReward.coin;
    club.budget += appliedSeasonReward.money;
  }

  profile.versus.ledger ??= [];
  const battleRewards = season.battles
    .filter((battle) => battle.settlement && (battle.homeClubId === club.id || battle.awayClubId === club.id))
    .sort((a, b) => a.roundId - b.roundId || a.id.localeCompare(b.id))
    .map((battle) => ({
      battle,
      reward: battle.homeClubId === club.id ? battle.settlement!.homeReward : battle.settlement!.awayReward
    }));
  let moneyBalance = club.versusMoney - battleRewards.reduce((sum, item) => sum + item.reward.money, 0) - (appliedSeasonReward?.money ?? 0);
  let coinBalance = club.versusCoin - battleRewards.reduce((sum, item) => sum + item.reward.coin, 0) - (appliedSeasonReward?.coin ?? 0);
  for (const { battle, reward: battleReward } of battleRewards) {
    moneyBalance += battleReward.money;
    coinBalance += battleReward.coin;
    const battleMoneyId = `versus:${season.id}:${battle.id}:${club.id}:MONEY`;
    const battleCoinId = `versus:${season.id}:${battle.id}:${club.id}:COIN`;
    if (!profile.versus.ledger.some((entry) => entry.id === battleMoneyId)) profile.versus.ledger.push({ id: battleMoneyId, createdAt: battle.settlement!.settledAt, seasonId: season.id, battleId: battle.id, currency: 'MONEY', amount: battleReward.money, balanceAfter: moneyBalance, note: `Versus battle reward · ${battle.id}` });
    if (!profile.versus.ledger.some((entry) => entry.id === battleCoinId)) profile.versus.ledger.push({ id: battleCoinId, createdAt: battle.settlement!.settledAt, seasonId: season.id, battleId: battle.id, currency: 'COIN', amount: battleReward.coin, balanceAfter: coinBalance, note: `Versus battle reward · ${battle.id}` });
  }
  if (appliedSeasonReward) {
    moneyBalance += appliedSeasonReward.money;
    coinBalance += appliedSeasonReward.coin;
    const seasonMoneyId = `versus:${season.id}:season:${club.id}:MONEY`;
    const seasonCoinId = `versus:${season.id}:season:${club.id}:COIN`;
    if (!profile.versus.ledger.some((entry) => entry.id === seasonMoneyId)) profile.versus.ledger.push({ id: seasonMoneyId, createdAt: season.endAt ?? now.toISOString(), seasonId: season.id, currency: 'MONEY', amount: appliedSeasonReward.money, balanceAfter: moneyBalance, note: `Versus season reward · rank ${reward?.rank ?? historyEntry?.rank ?? '-'}` });
    if (!profile.versus.ledger.some((entry) => entry.id === seasonCoinId)) profile.versus.ledger.push({ id: seasonCoinId, createdAt: season.endAt ?? now.toISOString(), seasonId: season.id, currency: 'COIN', amount: appliedSeasonReward.coin, balanceAfter: coinBalance, note: `Versus season reward · rank ${reward?.rank ?? historyEntry?.rank ?? '-'}` });
  }
  profile.versus.ledger.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  profile.versus.ledger = profile.versus.ledger.slice(0, 500);
  profile.versus.club = club;
  profile.versus.season = clone(season);
  profile.versus.status = season.state === 'FINISHED' ? 'GAMEOVER' : 'IN_GAME';
  profile.versus.lastProcessedAt = now.toISOString();
  profile.versus.versusMoney = club.versusMoney;
  profile.versus.versusCoin = club.versusCoin;
  profile.updatedAt = now.toISOString();
  return profile;
}

export function formatVersusProfile(profile: PlayerProfile): string {
  if (!profile.versus) throw new Error('Versus club belum dibuat.');
  const versus = profile.versus;
  const club = versus.club;
  const season = versus.season;
  return `**${club.name}** · ${versus.status} · group **${versus.groupCode ?? '-'}**\nVersus money **${club.versusMoney}** · coin **${club.versusCoin}** · roster v${club.rosterVersion}\nFormation **${club.formation}** · tactic **${TACTICS[club.tactic].name}**\nRecord **${club.wins}-${club.draws}-${club.losses}** · GF/GA **${club.goalsFor}/${club.goalsAgainst}** · rank **${club.rank}\nSeason **${season?.id ?? '-'}** · round **${season?.currentRound ?? '-'}/${season ? 2 * (season.clubs.length - 1) : '-'}**`;
}

export function formatVersusBattle(battle: VersusBattle): string {
  if (!battle.settlement) return `Battle **${battle.id}** · state **${battle.state}**`;
  const result = battle.settlement;
  return `**${battle.id}** · ${result.homeGoals}-${result.awayGoals} (HT ${result.halftime.homeGoals}-${result.halftime.awayGoals})\nPossession ${result.homeStats.ballControl}-${result.awayStats.ballControl}% · shots ${result.homeStats.shots}/${result.awayStats.shots} · SOT ${result.homeStats.shotsOnTarget}/${result.awayStats.shotsOnTarget}\nCorners ${result.homeStats.corners}/${result.awayStats.corners} · yellow ${result.homeStats.yellowCards}/${result.awayStats.yellowCards} · MVP **${result.mvpName}**`;
}
