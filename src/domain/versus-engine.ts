import { GAME_BALANCE } from '../config/game-balance.js';
import { FORMATIONS, TACTICS, type AbilityId, type FormationId, type MatchOutcome, type PlayerProfile, type Position, type TacticId, type VersusBattle, type VersusBattleStats, type VersusClub, type VersusGoalEvent, type VersusPlayer, type VersusPlayerSnapshot, type VersusSeason, type VersusSideReward, type VersusStanding, type VersusSubmission } from './types.js';
import { MathRandomSource, SeededRandom, type RandomSource } from './engine.js';
import { stableHash } from './league-engine.js';
import { createVersusMarket } from './versus-economy.js';

const RULESET_VERSION = 'versus-recovery-inferred-v2';
const DEFAULT_GROUP_CAPACITY = GAME_BALANCE.versus.defaultGroupCapacity;
const MAX_GOALS = GAME_BALANCE.versus.maxGoals;
const ROUND_MS = GAME_BALANCE.versus.roundDurationDays * 86_400_000;
const VERSUS_PLAYER_NAMES = ['Alex', 'Bobby', 'Carlos', 'Dani', 'Evan', 'Felix', 'Gio', 'Hugo', 'Ivan', 'Jules', 'Kai', 'Leo', 'Mika', 'Noah', 'Owen', 'Pavel', 'Quinn', 'Rafi', 'Sam', 'Theo', 'Uma', 'Victor'];
const NPC_CLUB_NAMES = ['Harbor Athletic', 'Northbridge United', 'Metro Stars', 'Royal County', 'Eastlake Rovers', 'Mountain Eleven', 'Capital Sporting', 'Golden Valley', 'Blue River', 'Iron Bay', 'Silver Coast', 'Red Hill Rangers', 'Lakeside Town', 'Westport City', 'Kingsford', 'Oakridge', 'Pine Valley', 'Crystal Lake', 'Stormhaven', 'Sunset Rovers', 'Highland Athletic', 'Riverside United', 'Thunder Eleven', 'Coral Bay'];
const NPC_STRENGTH_SPREAD = [-2, 0, 2, -1, 3, 1, -3, 4];
const NPC_STYLES: Array<[FormationId, TacticId]> = [['4-4-2', 'balanced'], ['4-3-3', 'attacking'], ['5-3-2', 'counter'], ['3-5-2', 'tiki-taka'], ['4-2-3-1', 'down-wings'], ['3-4-3', 'offense-full'], ['4-1-3-2', 'middle-thrust'], ['4-4-2', 'long-ball'], ['5-3-2', 'defensive']];
/** Base ability per letter tier: S, A, B, C, D, E. */
const TIER_BASE = [74, 69, 64, 59, 55, 51];
const VERSUS_LEAGUE_CODES = ['S', 'A', 'B', 'C', 'D', 'E'] as const;
const POSITION_ORDER: AbilityId[] = ['atk', 'def', 'speed', 'power', 'strength', 'technique'];
const MINIMUM_FIELDABLE: Record<Position, number> = { GK: 1, DF: 4, MF: 4, FW: 2 };

/** Tactic trade-offs as [attack, defence, control] modifiers (RECOVERY_INFERRED). */
const TACTIC_PROFILE: Record<TacticId, [number, number, number]> = {
  balanced: [0, 0, 0],
  attacking: [4, -3, 0],
  defensive: [-3, 4, -1],
  counter: [2, 1, -4],
  'down-wings': [2, 0, 1],
  'middle-thrust': [3, -1, 1],
  'tiki-taka': [0, 1, 5],
  'long-ball': [3, 0, -4],
  'offense-full': [7, -6, 0],
  'defense-full': [-6, 7, -2]
};

const FORMATION_PROFILE: Record<FormationId, [number, number, number]> = {
  '4-4-2': [0, 0, 0],
  '4-3-3': [2, -1, 1],
  '3-5-2': [1, -1, 3],
  '5-3-2': [-2, 3, -1],
  '4-1-3-2': [1, 0, 1],
  '3-4-3': [3, -2, 0],
  '4-2-3-1': [0, 1, 2]
};

/** Tactics that exploit specific opponent tactics (+3 attack or +3 defence). */
const TACTIC_MATCHUPS: Partial<Record<TacticId, { attack?: TacticId[]; defence?: TacticId[] }>> = {
  counter: { attack: ['attacking', 'offense-full', 'middle-thrust', 'tiki-taka'] },
  'tiki-taka': { attack: ['defensive', 'defense-full', 'long-ball'] },
  'long-ball': { attack: ['tiki-taka', 'defense-full', 'counter'] },
  'down-wings': { attack: ['defensive', 'middle-thrust', 'balanced'] },
  'middle-thrust': { attack: ['down-wings', 'counter'] },
  attacking: { attack: ['balanced', 'long-ball'] },
  defensive: { defence: ['offense-full', 'attacking', 'down-wings'] },
  'defense-full': { defence: ['offense-full', 'attacking', 'middle-thrust'] }
};

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

export function versusTierBase(grade: number): number {
  return TIER_BASE[clamp(Math.floor(grade), 0, TIER_BASE.length - 1)];
}

export function versusTacticEdge(own: TacticId, opponent: TacticId): string | undefined {
  const matchup = TACTIC_MATCHUPS[own];
  if (matchup?.attack?.includes(opponent)) return `${TACTICS[own].name} unggul menyerang melawan ${TACTICS[opponent].name}`;
  if (matchup?.defence?.includes(opponent)) return `${TACTICS[own].name} unggul bertahan melawan ${TACTICS[opponent].name}`;
  return undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function abilityScore(player: VersusPlayer): number {
  return POSITION_ORDER.reduce((sum, key) => sum + player.abilities[key], 0) / POSITION_ORDER.length;
}

function positionFromIndex(index: number): VersusPlayer['position'] {
  if (index === 0 || index === 18) return 'GK';
  if (index <= 5) return 'DF';
  if (index <= 12) return 'MF';
  return 'FW';
}

function abilitiesFor(position: Position, base: number): Record<AbilityId, number> {
  return {
    atk: clamp(base + (position === 'FW' ? 8 : position === 'MF' ? 3 : 0), 20, 99),
    def: clamp(base + (position === 'GK' || position === 'DF' ? 8 : 0), 20, 99),
    speed: clamp(base + (position === 'FW' || position === 'MF' ? 5 : 1), 20, 99),
    power: clamp(base + 2, 20, 99),
    strength: clamp(base + (position === 'DF' ? 5 : 1), 20, 99),
    technique: clamp(base + (position === 'MF' ? 7 : position === 'FW' ? 4 : 0), 20, 99)
  };
}

export function versusPlayerValue(player: Pick<VersusPlayer, 'abilities' | 'age'>): number {
  const score = POSITION_ORDER.reduce((sum, key) => sum + player.abilities[key], 0) / POSITION_ORDER.length;
  return Math.round(score * 100 + Math.max(0, 26 - player.age) * 40);
}

export function createVersusPlayer(id: string, name: string, index: number, clubId: string, base: number, position = positionFromIndex(index), age = 18 + (index % 15)): VersusPlayer {
  const abilities = abilitiesFor(position, base);
  return {
    id,
    name,
    age,
    initialAge: age,
    position,
    value: versusPlayerValue({ abilities, age }),
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
    appearances: 0,
    cleanSheets: 0,
    ratingSum: 0,
    ratedMatches: 0,
    growth: 0,
    seasonYellowCards: 0
  };
}

/** 19 players: index 0–17 keep the legacy GK/DF/MF/FW layout, index 18 is the backup goalkeeper. */
function createRoster(clubId: string, base: number, seedNames?: string[]): VersusPlayer[] {
  return Array.from({ length: 19 }, (_, index) => createVersusPlayer(`${clubId}:p${index + 1}`, seedNames?.[index] ?? VERSUS_PLAYER_NAMES[index % VERSUS_PLAYER_NAMES.length], index, clubId, base + (index % 4) * 2));
}

function profileRosterNames(profile: PlayerProfile): string[] {
  return [profile.displayName, ...VERSUS_PLAYER_NAMES.slice(0, 18)];
}

/** Grade scale of the S→E letter tiers; clubs without it were created on the old scale where every club began in A. */
const TIER_VERSION = 2;

function ensureVersusClub(profile: PlayerProfile): VersusClub {
  const existing = profile.versus?.club;
  if (existing) {
    const club = clone(existing);
    // A legacy club outside an active season restarts in the entry tier instead of facing Liga A NPCs.
    if (club.tierVersion !== TIER_VERSION && profile.versus?.season?.state !== 'ACTIVE') {
      club.grade = GAME_BALANCE.versus.startingGrade;
      club.tierVersion = TIER_VERSION;
    }
    return club;
  }
  const id = `vclub:${profile.userId}`;
  // Versus is a separate aggregate; its initial roster must not inherit Player progression.
  const base = 52;
  return {
    id,
    ownerId: profile.userId,
    name: `${profile.displayName} FC`,
    isNpc: false,
    grade: GAME_BALANCE.versus.startingGrade,
    tierVersion: TIER_VERSION,
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

function makeNpcClub(index: number, grade: number, seed: number): VersusClub {
  const id = `vnpc:${index + 1}`;
  const name = NPC_CLUB_NAMES[(seed + index * 5) % NPC_CLUB_NAMES.length];
  const base = clamp(versusTierBase(grade) + NPC_STRENGTH_SPREAD[(seed + index) % NPC_STRENGTH_SPREAD.length], 40, 90);
  const [formation, tactic] = NPC_STYLES[(seed + index * 3) % NPC_STYLES.length];
  return {
    id,
    name,
    isNpc: true,
    grade,
    tierVersion: TIER_VERSION,
    country: 0,
    rosterVersion: 1,
    formation,
    tactic,
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
  const club = ensureVersusClub(profile);
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

function isLockedInSeason(profile: PlayerProfile): boolean {
  const versus = profile.versus;
  if (!versus?.groupCode) return false;
  if (versus.status !== 'ENROLLED' && versus.status !== 'IN_GAME') return false;
  return versus.season?.state !== 'FINISHED';
}

export function queueVersusMatchmaking(profileInput: PlayerProfile, queueKey = 'public', now = new Date()): PlayerProfile {
  const profile = createVersusClub(rolloverVersusClub(profileInput, now), now);
  const versus = profile.versus!;
  if (isLockedInSeason(profile)) return profile;
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

/**
 * Enrolls the user's club in a group. A club stays locked to its group until the
 * season finishes; moving on is only possible through the season rollover.
 */
export function enrollVersus(profileInput: PlayerProfile, groupCode: string, now = new Date()): PlayerProfile {
  const code = groupCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) throw new Error('Group code harus 4–24 karakter alfanumerik atau tanda hubung.');
  const profile = createVersusClub(rolloverVersusClub(profileInput, now), now);
  const versus = profile.versus!;
  if (versus.groupCode === code && (versus.status === 'IN_GAME' || versus.status === 'ENROLLED')) return profile;
  if (isLockedInSeason(profile)) throw new Error('Club Versus sudah terkunci di group lain sampai season berakhir.');
  versus.status = 'ENROLLED';
  versus.groupCode = code;
  versus.season = undefined;
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
          scheduledAt: new Date(startAt.getTime() + round * ROUND_MS).toISOString(),
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

/** Fresh per-season club record: identity, wallet, and roster carry over; results reset. */
function seasonClubEntry(club: VersusClub): VersusClub {
  return { ...clone(club), score: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, rank: 1 };
}

function seasonGrade(profiles: PlayerProfile[]): number {
  const grades = profiles.map((profile) => ensureVersusClub(profile).grade);
  return clamp(Math.round(grades.reduce((sum, grade) => sum + grade, 0) / Math.max(1, grades.length)), 0, 5);
}

function initialSeason(groupCode: string, profiles: PlayerProfile[], now: Date, capacity = DEFAULT_GROUP_CAPACITY): VersusSeason {
  const grade = seasonGrade(profiles);
  const humanClubs = profiles.map((profile) => seasonClubEntry(ensureVersusClub(profile)));
  const clubs = [...humanClubs];
  const seed = stableHash(groupCode);
  for (let index = 0; clubs.length < Math.max(GAME_BALANCE.versus.minimumLeagueClubs, capacity); index += 1) clubs.push(makeNpcClub(index, grade, seed));
  // Second-resolution timestamp: a reused group code (private groups, recycled public slots) never reuses a season id,
  // which is the idempotency root for battle, ledger, and notification ids.
  const id = `vseason:${groupCode}:${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}`;
  const season: VersusSeason = {
    id,
    groupCode,
    leagueId: `vleague:${groupCode}`,
    grade,
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

export function versusSeasonIsJoinable(season: VersusSeason, now = new Date()): boolean {
  return season.state === 'ACTIVE' && season.currentRound === 1 && season.battles.every((battle) => battle.state === 'OPEN') && new Date(season.roundDeadline).getTime() > now.getTime() && season.clubs.some((club) => club.isNpc);
}

/**
 * Adds a human club to a season that has not played round 1 by taking over an
 * NPC slot. Schedule and other members' submissions stay intact.
 */
export function addHumanToVersusSeason(seasonInput: VersusSeason, profile: PlayerProfile, now = new Date()): VersusSeason {
  const season = clone(seasonInput);
  const club = seasonClubEntry(ensureVersusClub(profile));
  if (season.clubs.some((item) => item.id === club.id)) return season;
  if (!versusSeasonIsJoinable(season, now)) throw new Error('Season Versus ini sudah berjalan atau penuh; tunggu assignment berikutnya.');
  const npcIndex = season.clubs.map((item) => item.isNpc).lastIndexOf(true);
  const npc = season.clubs[npcIndex];
  season.clubs[npcIndex] = club;
  for (const battle of season.battles) {
    if (battle.homeClubId === npc.id) battle.homeClubId = club.id;
    if (battle.awayClubId === npc.id) battle.awayClubId = club.id;
  }
  // Open listings keep their player snapshot, so existing bids stay valid after the NPC leaves.
  season.standings = standingsFor(season);
  return season;
}

function clubById(season: VersusSeason, id: string): VersusClub {
  const club = season.clubs.find((item) => item.id === id);
  if (!club) throw new Error(`Versus club ${id} tidak ditemukan.`);
  return club;
}

function condition(player: VersusPlayer): number {
  return 0.7 + 0.3 * (player.hp / Math.max(1, player.maxHp));
}

export function canPlay(player: VersusPlayer, now: Date): boolean {
  if (player.hp <= 0 || player.status === 'SUSPENDED' || player.redCardBan > 0) return false;
  if (player.status === 'INJURED') return Boolean(player.injuryEndsAt) && new Date(player.injuryEndsAt!).getTime() <= now.getTime();
  return true;
}

function recoverVersusRoster(roster: VersusPlayer[], now: Date): void {
  for (const player of roster) {
    player.hp = clamp(player.hp + GAME_BALANCE.versus.roundRecovery, 0, player.maxHp);
    if (player.status === 'INJURED' && player.injuryEndsAt && new Date(player.injuryEndsAt).getTime() <= now.getTime()) {
      player.status = 'AVAILABLE';
      player.injuryType = undefined;
      player.injuryEndsAt = undefined;
    }
  }
}

function selectionScore(player: VersusPlayer): number {
  return abilityScore(player) * condition(player);
}

/**
 * System lineup for NPCs, missing submissions, and stale submissions. Never
 * throws: thin positions are covered out of position, a defender goes in goal if
 * no keeper is fit, and a club fields fewer than eleven only as a last resort.
 */
function autoSubmission(battle: VersusBattle, club: VersusClub, now: Date): { submission: VersusSubmission; emergency: boolean } {
  const slots = FORMATIONS[club.formation].slots;
  const eligible = club.roster.filter((player) => canPlay(player, now)).sort((a, b) => selectionScore(b) - selectionScore(a));
  const selected: VersusPlayer[] = [];
  let emergency = false;
  for (const position of ['GK', 'DF', 'MF', 'FW'] as const) {
    const candidates = eligible.filter((player) => player.position === position && !selected.includes(player)).slice(0, slots[position]);
    if (candidates.length < slots[position]) emergency = true;
    selected.push(...candidates);
  }
  if (!selected.some((player) => player.position === 'GK')) {
    const cover = eligible.find((player) => player.position === 'DF' && !selected.includes(player)) ?? eligible.find((player) => !selected.includes(player));
    if (cover) selected.unshift(cover);
  }
  for (const player of eligible) {
    if (selected.length >= 11) break;
    if (!selected.includes(player)) selected.push(player);
  }
  if (selected.length < 11) emergency = true;
  const lineup = selected.slice(0, 11).map((player) => player.id);
  const substitutes = eligible.filter((player) => !lineup.includes(player.id)).slice(0, 5).map((player) => player.id);
  const captain = selected.find((player) => player.captain && lineup.includes(player.id))?.id ?? lineup[0] ?? '';
  return {
    emergency,
    submission: {
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
    }
  };
}

function snapshotSubmission(submission: VersusSubmission, club: VersusClub): VersusPlayerSnapshot[] {
  const ids = [...submission.lineup, ...submission.substitutes];
  return ids.flatMap((id) => {
    const player = club.roster.find((item) => item.id === id);
    if (!player) return [];
    return [{
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
    }];
  });
}

function validateSubmission(submission: VersusSubmission, club: VersusClub, battleId: string, now: Date, strictVersion = true): void {
  if (!FORMATIONS[submission.formation] || !TACTICS[submission.tactic]) throw new Error('Formation atau tactic Versus tidak dikenal.');
  if (submission.battleId !== battleId || submission.clubId !== club.id) throw new Error('Submission Versus tidak cocok dengan battle.');
  if (strictVersion && submission.rosterVersion !== club.rosterVersion) throw new Error('Versus roster berubah setelah submission; submit ulang lineup.');
  if (submission.lineup.length !== 11 || submission.substitutes.length > 5 || new Set([...submission.lineup, ...submission.substitutes]).size !== submission.lineup.length + submission.substitutes.length) throw new Error('Lineup/substitute Versus tidak valid atau berisi pemain duplikat.');
  if (!submission.lineup.includes(submission.captainId)) throw new Error('Captain harus berada di starting XI.');
  const slots = FORMATIONS[submission.formation].slots;
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const id of submission.lineup) {
    const player = club.roster.find((item) => item.id === id);
    if (!player || !canPlay(player, now)) throw new Error(`Pemain Versus ${id} tidak eligible untuk battle.`);
    counts[player.position] += 1;
  }
  for (const id of submission.substitutes) if (!club.roster.some((item) => item.id === id)) throw new Error(`Substitute Versus ${id} tidak ada pada roster.`);
  if (counts.GK !== slots.GK || counts.DF !== slots.DF || counts.MF !== slots.MF || counts.FW !== slots.FW) throw new Error(`Lineup tidak cocok dengan formation ${submission.formation}.`);
}

/** Stored user submissions are honoured at kickoff if still legal; otherwise the system lineup plays. */
function resolveSubmission(stored: VersusSubmission | undefined, battle: VersusBattle, club: VersusClub, now: Date): { submission: VersusSubmission; emergency: boolean; fallback: boolean } {
  if (stored) {
    try {
      validateSubmission(stored, club, battle.id, now, false);
      return { submission: clone(stored), emergency: false, fallback: false };
    } catch {
      const auto = autoSubmission(battle, club, now);
      return { ...auto, fallback: true };
    }
  }
  return { ...autoSubmission(battle, club, now), fallback: false };
}

interface SideRatings {
  attack: number;
  defence: number;
  control: number;
  players: VersusPlayer[];
}

function weightedMean(players: VersusPlayer[], weightOf: (player: VersusPlayer) => number, valueOf: (player: VersusPlayer) => number): number {
  let total = 0;
  let weights = 0;
  for (const player of players) {
    const weight = weightOf(player);
    total += valueOf(player) * weight;
    weights += weight;
  }
  return weights > 0 ? total / weights : 40;
}

function sideRatings(club: VersusClub, submission: VersusSubmission, opponentTactic: TacticId, isHome: boolean, emergency: boolean): SideRatings {
  const players = submission.lineup.map((id) => club.roster.find((player) => player.id === id)).filter((player): player is VersusPlayer => Boolean(player));
  const attackWeight: Record<Position, number> = { GK: 0, DF: 0.25, MF: 0.7, FW: 1 };
  const defenceWeight: Record<Position, number> = { GK: 1.2, DF: 1, MF: 0.6, FW: 0.15 };
  const controlWeight: Record<Position, number> = { GK: 0, DF: 0.4, MF: 1, FW: 0.4 };
  const attack = weightedMean(players, (player) => attackWeight[player.position], (player) => (player.abilities.atk * 0.5 + player.abilities.technique * 0.25 + player.abilities.speed * 0.25) * condition(player));
  const defence = weightedMean(players, (player) => defenceWeight[player.position], (player) => (player.abilities.def * 0.55 + player.abilities.strength * 0.25 + player.abilities.speed * 0.2) * condition(player));
  const control = weightedMean(players, (player) => controlWeight[player.position], (player) => (player.abilities.technique * 0.6 + player.abilities.speed * 0.4) * condition(player));
  const [tacticAttack, tacticDefence, tacticControl] = TACTIC_PROFILE[submission.tactic];
  const [formationAttack, formationDefence, formationControl] = FORMATION_PROFILE[submission.formation];
  const matchup = TACTIC_MATCHUPS[submission.tactic];
  const captain = players.some((player) => player.id === submission.captainId) ? 1 : 0;
  const shortHanded = (11 - Math.min(11, players.length)) * 3;
  const keeperPenalty = emergency && !players.some((player) => player.position === 'GK') ? 8 : 0;
  return {
    attack: attack + tacticAttack + formationAttack + captain + (isHome ? 1.5 : 0) + (matchup?.attack?.includes(opponentTactic) ? 3 : 0) - shortHanded,
    defence: defence + tacticDefence + formationDefence + captain + (matchup?.defence?.includes(opponentTactic) ? 3 : 0) - shortHanded - keeperPenalty,
    control: control + tacticControl + formationControl + captain - shortHanded,
    players
  };
}

function versusExpectedGoals(attack: number, defence: number, controlEdge: number): number {
  return clamp(1.3 * Math.exp((attack - defence) / 14 + controlEdge / 60), 0.15, 4);
}

function poisson(lambda: number, rng: RandomSource): number {
  const limit = Math.exp(-Math.max(0, lambda));
  let goals = 0;
  let product = rng.next();
  while (product > limit && goals < MAX_GOALS) {
    goals += 1;
    product *= rng.next();
  }
  return goals;
}

function pickWeighted<T>(items: T[], weightOf: (item: T) => number, rng: RandomSource): T | undefined {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  if (total <= 0) return items[0];
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function goalEvents(side: SideRatings, clubId: string, goals: number, half: 1 | 2, rng: RandomSource): VersusGoalEvent[] {
  const scoreWeight: Record<Position, number> = { GK: 0.02, DF: 0.6, MF: 2.2, FW: 5 };
  const assistWeight: Record<Position, number> = { GK: 0.1, DF: 1.2, MF: 4, FW: 2.5 };
  const events: VersusGoalEvent[] = [];
  for (let goal = 0; goal < goals; goal += 1) {
    const scorer = pickWeighted(side.players, (player) => scoreWeight[player.position] * (player.abilities.atk / 60) ** 2, rng);
    if (!scorer) continue;
    const helpers = side.players.filter((player) => player.id !== scorer.id);
    const assist = rng.next() < 0.75 ? pickWeighted(helpers, (player) => assistWeight[player.position] * (player.abilities.technique / 60) ** 2, rng) : undefined;
    events.push({ clubId, playerId: scorer.id, playerName: scorer.name, assistId: assist?.id, assistName: assist?.name, half });
  }
  return events;
}

function statsFor(side: SideRatings, other: SideRatings, possession: number, goals: number, yellowCards: number, redCards: number, rng: RandomSource): VersusBattleStats {
  const shots = clamp(Math.round(8 + (side.attack - other.defence) / 3 + goals * 1.5 + rng.next() * 5), Math.max(goals, 3), 30);
  const shotsOnTarget = clamp(Math.round(goals + (shots - goals) * (0.25 + rng.next() * 0.15)), goals, shots);
  return {
    ballControl: Math.round(possession),
    shots,
    shotsOnTarget,
    corners: clamp(Math.round(1 + shots / 4 + rng.next() * 3), 0, 14),
    yellowCards,
    redCards
  };
}

function sponsorBonus(club: VersusClub, outcome: MatchOutcome): { money: number; coin: number } {
  if (!club.sponsor || club.isNpc) return { money: 0, coin: 0 };
  const terms = GAME_BALANCE.versus.sponsor[club.sponsor.tier];
  if (outcome === 'WIN') return { money: terms.winMoney, coin: terms.winCoin };
  if (outcome === 'DRAW') return { money: terms.drawMoney, coin: 0 };
  return { money: 0, coin: 0 };
}

function sideReward(outcome: MatchOutcome, club: VersusClub): VersusSideReward {
  const base = outcome === 'WIN' ? GAME_BALANCE.versus.winReward : outcome === 'DRAW' ? GAME_BALANCE.versus.drawReward : GAME_BALANCE.versus.lossReward;
  const sponsor = sponsorBonus(club, outcome);
  return { ...base, money: base.money + sponsor.money, coin: base.coin + sponsor.coin, sponsorMoney: sponsor.money || undefined, sponsorCoin: sponsor.coin || undefined };
}

function outcome(homeGoals: number, awayGoals: number): MatchOutcome {
  return homeGoals > awayGoals ? 'WIN' : homeGoals < awayGoals ? 'LOSS' : 'DRAW';
}

function invert(result: MatchOutcome): MatchOutcome {
  return result === 'WIN' ? 'LOSS' : result === 'LOSS' ? 'WIN' : 'DRAW';
}

function playerRating(player: VersusPlayer, events: VersusGoalEvent[], result: MatchOutcome, conceded: number, rng: RandomSource): number {
  const goals = events.filter((event) => event.playerId === player.id).length;
  const assists = events.filter((event) => event.assistId === player.id).length;
  let rating = 6 + goals * 1 + assists * 0.6 + (result === 'WIN' ? 0.4 : result === 'LOSS' ? -0.3 : 0) + (abilityScore(player) - 60) / 40 + (rng.next() - 0.5);
  if (conceded === 0 && (player.position === 'GK' || player.position === 'DF')) rating += player.position === 'GK' ? 0.8 : 0.4;
  if (player.position === 'GK') rating -= Math.max(0, conceded - 1) * 0.2;
  return Number(clamp(rating, 3.5, 10).toFixed(1));
}

function developPlayer(player: VersusPlayer, rating: number): void {
  const pace = player.age <= 21 ? 0.35 : player.age <= 25 ? 0.25 : player.age <= 29 ? 0.12 : 0.04;
  player.growth = (player.growth ?? 0) + pace * clamp(rating / 6.5, 0.6, 1.5);
  while ((player.growth ?? 0) >= 1) {
    player.growth! -= 1;
    const keys: AbilityId[] = player.position === 'GK' || player.position === 'DF' ? ['def', 'strength'] : player.position === 'MF' ? ['technique', 'speed'] : ['atk', 'speed'];
    for (const key of keys) player.abilities[key] = clamp(player.abilities[key] + 1, 20, 99);
  }
  player.value = versusPlayerValue(player);
}

function applySideResult(club: VersusClub, side: SideRatings, goalsForValue: number, goalsAgainstValue: number, result: MatchOutcome, reward: VersusSideReward, events: VersusGoalEvent[], ratings: Map<string, number>, cards: { yellow: Set<string>; red?: string }, rng: RandomSource, now: Date): void {
  club.goalsFor += goalsForValue;
  club.goalsAgainst += goalsAgainstValue;
  club.versusMoney += reward.money;
  club.versusCoin += reward.coin;
  club.budget += reward.money;
  if (result === 'WIN') club.wins += 1;
  else if (result === 'DRAW') club.draws += 1;
  else club.losses += 1;
  club.score = club.wins * GAME_BALANCE.versus.winPoints + club.draws * GAME_BALANCE.versus.drawPoints;
  for (const player of side.players) {
    player.appearances += 1;
    player.goals += events.filter((event) => event.playerId === player.id).length;
    player.assists += events.filter((event) => event.assistId === player.id).length;
    if (player.position === 'GK' && goalsAgainstValue === 0) player.cleanSheets = (player.cleanSheets ?? 0) + 1;
    const rating = ratings.get(player.id) ?? 6;
    player.ratingSum = Number(((player.ratingSum ?? 0) + rating).toFixed(1));
    player.ratedMatches = (player.ratedMatches ?? 0) + 1;
    player.hp = clamp(player.hp - GAME_BALANCE.versus.lineupHpCost + reward.conditionRecovery * 2, 0, player.maxHp);
    const injuryChance = GAME_BALANCE.versus.injuryChance + Math.max(0, 70 - player.hp) * GAME_BALANCE.versus.lowConditionInjuryChance;
    if (rng.next() < injuryChance) {
      const rounds = 1 + Math.floor(rng.next() * 3);
      player.status = 'INJURED';
      player.injuryType = rounds >= 3 ? 'MODERATE' : 'MINOR';
      player.injuryEndsAt = new Date(now.getTime() + rounds * ROUND_MS).toISOString();
    }
    if (cards.yellow.has(player.id)) {
      player.yellowCards += 1;
      player.seasonYellowCards = (player.seasonYellowCards ?? 0) + 1;
      if (player.seasonYellowCards >= GAME_BALANCE.versus.yellowSuspensionThreshold) {
        player.seasonYellowCards = 0;
        player.redCardBan = Math.max(player.redCardBan, 1);
        player.status = 'SUSPENDED';
      }
    }
    if (cards.red === player.id) {
      player.redCardBan = Math.max(player.redCardBan, 1);
      player.status = 'SUSPENDED';
    }
    developPlayer(player, rating);
  }
}

function drawCards(side: SideRatings, rng: RandomSource): { yellow: Set<string>; red?: string } {
  const yellow = new Set(side.players.filter(() => rng.next() < GAME_BALANCE.versus.cardChance).map((player) => player.id));
  const red = rng.next() < GAME_BALANCE.versus.redCardChance ? side.players[Math.floor(rng.next() * side.players.length)]?.id : undefined;
  return { yellow, red };
}

function simulateBattle(battle: VersusBattle, home: VersusClub, away: VersusClub, now: Date, rng: RandomSource, simulationSeed: number): VersusBattle {
  const homeSelection = resolveSubmission(battle.homeSubmission, battle, home, now);
  const awaySelection = resolveSubmission(battle.awaySubmission, battle, away, now);
  const homeSubmission = homeSelection.submission;
  const awaySubmission = awaySelection.submission;
  homeSubmission.snapshot = snapshotSubmission(homeSubmission, home);
  awaySubmission.snapshot = snapshotSubmission(awaySubmission, away);
  homeSubmission.lockedAt = now.toISOString();
  awaySubmission.lockedAt = now.toISOString();
  const homeSide = sideRatings(home, homeSubmission, awaySubmission.tactic, true, homeSelection.emergency);
  const awaySide = sideRatings(away, awaySubmission, homeSubmission.tactic, false, awaySelection.emergency);
  const controlEdge = homeSide.control - awaySide.control;
  const homePossession = clamp(50 + controlEdge * 0.8, 30, 70);
  const homeLambda = versusExpectedGoals(homeSide.attack, awaySide.defence, controlEdge) / 2;
  const awayLambda = versusExpectedGoals(awaySide.attack, homeSide.defence, -controlEdge) / 2;
  const halftimeHomeGoals = poisson(homeLambda, rng);
  const halftimeAwayGoals = poisson(awayLambda, rng);
  const homeGoals = clamp(halftimeHomeGoals + poisson(homeLambda, rng), 0, MAX_GOALS);
  const awayGoals = clamp(halftimeAwayGoals + poisson(awayLambda, rng), 0, MAX_GOALS);
  const scorers = [
    ...goalEvents(homeSide, home.id, halftimeHomeGoals, 1, rng),
    ...goalEvents(awaySide, away.id, halftimeAwayGoals, 1, rng),
    ...goalEvents(homeSide, home.id, homeGoals - halftimeHomeGoals, 2, rng),
    ...goalEvents(awaySide, away.id, awayGoals - halftimeAwayGoals, 2, rng)
  ];
  const result = outcome(homeGoals, awayGoals);
  const ratings = new Map<string, number>();
  for (const player of homeSide.players) ratings.set(player.id, playerRating(player, scorers, result, awayGoals, rng));
  for (const player of awaySide.players) ratings.set(player.id, playerRating(player, scorers, invert(result), homeGoals, rng));
  const mvp = [...homeSide.players, ...awaySide.players].sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0) || abilityScore(b) - abilityScore(a))[0];
  const homeCards = drawCards(homeSide, rng);
  const awayCards = drawCards(awaySide, rng);
  const homeStats = statsFor(homeSide, awaySide, homePossession, homeGoals, homeCards.yellow.size, homeCards.red ? 1 : 0, rng);
  const awayStats = statsFor(awaySide, homeSide, 100 - homePossession, awayGoals, awayCards.yellow.size, awayCards.red ? 1 : 0, rng);
  const homeReward = sideReward(result, home);
  const awayReward = sideReward(invert(result), away);
  applySideResult(home, homeSide, homeGoals, awayGoals, result, homeReward, scorers, ratings, homeCards, rng, now);
  applySideResult(away, awaySide, awayGoals, homeGoals, invert(result), awayReward, scorers, ratings, awayCards, rng, now);
  homeSubmission.ownerId = home.ownerId;
  awaySubmission.ownerId = away.ownerId;
  const emergencyLineup: Array<'HOME' | 'AWAY'> = [];
  if (homeSelection.emergency) emergencyLineup.push('HOME');
  if (awaySelection.emergency) emergencyLineup.push('AWAY');
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
      mvpPlayerId: mvp?.id ?? '',
      mvpName: mvp?.name ?? '-',
      mvpClubId: mvp?.clubId,
      homeReward,
      awayReward,
      rulesetVersion: RULESET_VERSION,
      simulationSeed,
      settledAt: now.toISOString(),
      scorers,
      emergencyLineup: emergencyLineup.length ? emergencyLineup : undefined
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
  // Bans are served by sitting out this round; players banned now become available afterwards.
  const servingBan = new Set(season.clubs.flatMap((club) => club.roster.filter((player) => player.redCardBan > 0).map((player) => player.id)));
  for (const club of season.clubs) recoverVersusRoster(club.roster, now);
  const updatedBattles: VersusBattle[] = [];
  for (const battle of battles) {
    const home = clubById(season, battle.homeClubId);
    const away = clubById(season, battle.awayClubId);
    const processing = { ...battle, state: 'PROCESSING' as const };
    const simulationSeed = Math.floor(rng.next() * 2_147_483_647) || 1;
    updatedBattles.push(simulateBattle(processing, home, away, now, new SeededRandom(simulationSeed), simulationSeed));
  }
  const fielded = new Set(updatedBattles.flatMap((battle) => [...(battle.homeSubmission?.lineup ?? []), ...(battle.awaySubmission?.lineup ?? [])]));
  for (const club of season.clubs) {
    for (const player of club.roster) {
      if (!fielded.has(player.id)) player.hp = clamp(player.hp + GAME_BALANCE.versus.restRecovery, 0, player.maxHp);
      if (servingBan.has(player.id) && !fielded.has(player.id)) {
        player.redCardBan = Math.max(0, player.redCardBan - 1);
        if (player.redCardBan === 0 && player.status === 'SUSPENDED') {
          // A ban served while still injured must not clear the injury.
          const injured = Boolean(player.injuryEndsAt) && new Date(player.injuryEndsAt!).getTime() > now.getTime();
          player.status = injured ? 'INJURED' : 'AVAILABLE';
          if (!injured) {
            player.injuryType = undefined;
            player.injuryEndsAt = undefined;
          }
        }
      }
    }
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

export function versusTotalRounds(season: VersusSeason): number {
  return Math.max(1, 2 * (season.clubs.length - 1));
}

export function settleVersusSeason(seasonInput: VersusSeason, now = new Date()): VersusSeason {
  const season = clone(seasonInput);
  if (season.state === 'FINISHED') return season;
  const totalRounds = versusTotalRounds(season);
  if (season.battles.some((battle) => battle.roundId <= totalRounds && battle.state !== 'PUBLISHED' && battle.state !== 'SETTLED')) throw new Error('Versus season belum selesai. Proses semua round terlebih dahulu.');
  season.standings = standingsFor(season);
  season.state = 'FINISHED';
  season.endAt = now.toISOString();
  const relegationLine = Math.max(4, season.clubs.length - 2);
  // Seasons that started on the old grade scale pay rewards but move nobody; rollover resets those clubs to the entry tier.
  const legacyScale = season.clubs.some((club) => club.tierVersion !== TIER_VERSION);
  season.rewards = season.standings.map((standing) => {
    const promoted = !legacyScale && standing.rank <= 2 && season.grade > 0;
    const relegated = !legacyScale && standing.rank > relegationLine && season.grade < VERSUS_LEAGUE_CODES.length - 1;
    return {
      clubId: standing.clubId,
      rank: standing.rank,
      money: Math.max(250, 2_000 - (standing.rank - 1) * 150),
      coin: Math.max(1, 20 - Math.floor((standing.rank - 1) / 2)),
      promoted,
      relegated,
      promotedToLeague: versusPromotionLeagueCode(season.grade, promoted),
      relegatedToLeague: versusRelegationLeagueCode(season.grade, relegated),
      fromLeague: legacyScale ? undefined : versusLeagueCode(season.grade),
      legacyReset: legacyScale || undefined
    };
  });
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
    const sponsorNote = battleReward.sponsorMoney || battleReward.sponsorCoin ? ` (sponsor +${battleReward.sponsorMoney ?? 0}/${battleReward.sponsorCoin ?? 0})` : '';
    if (!profile.versus.ledger.some((entry) => entry.id === battleMoneyId)) profile.versus.ledger.push({ id: battleMoneyId, createdAt: battle.settlement!.settledAt, seasonId: season.id, battleId: battle.id, currency: 'MONEY', amount: battleReward.money, balanceAfter: moneyBalance, note: `Versus battle reward · ${battle.id}${sponsorNote}` });
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

function backupGoalkeeper(club: VersusClub): VersusPlayer {
  const index = club.roster.length;
  const base = Math.round(club.roster.reduce((sum, player) => sum + abilityScore(player), 0) / Math.max(1, club.roster.length)) - 4;
  return createVersusPlayer(`${club.id}:p${index + 1}`, `Youth GK ${index + 1}`, index, club.id, base, 'GK', 19);
}

/**
 * Applies the finished season to the club exactly once: promotion/relegation,
 * aging and decline, a backup keeper for legacy one-GK rosters, and fresh
 * season counters. The club keeps its id, owner, wallet, and players.
 */
export function rolloverVersusClub(profileInput: PlayerProfile, now = new Date()): PlayerProfile {
  const profile = clone(profileInput);
  const versus = profile.versus;
  const season = versus?.season;
  if (!versus || !season || season.state !== 'FINISHED' || versus.lastRolloverSeasonId === season.id) return profile;
  const reward = season.rewards.find((item) => item.clubId === versus.clubId);
  const club = versus.club;
  if (club.tierVersion !== TIER_VERSION) {
    // The finished season used the old scale, so its result does not move the club a second time.
    club.grade = GAME_BALANCE.versus.startingGrade;
    club.tierVersion = TIER_VERSION;
  } else if (reward?.promoted) club.grade = clamp(club.grade - 1, 0, 5);
  else if (reward?.relegated) club.grade = clamp(club.grade + 1, 0, 5);
  Object.assign(club, { score: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, rank: 1, sponsor: undefined });
  for (const player of club.roster) {
    player.age += 1;
    if (player.age >= 31) {
      const decline = player.age >= 34 ? 2 : 1;
      for (const key of ['speed', 'strength'] as AbilityId[]) player.abilities[key] = clamp(player.abilities[key] - decline, 20, 99);
    }
    player.hp = player.maxHp;
    player.status = 'AVAILABLE';
    player.injuryType = undefined;
    player.injuryEndsAt = undefined;
    player.redCardBan = 0;
    player.seasonYellowCards = 0;
    player.value = versusPlayerValue(player);
  }
  if (club.roster.filter((player) => player.position === 'GK').length < 2) club.roster.push(backupGoalkeeper(club));
  club.rosterVersion += 1;
  versus.lastRolloverSeasonId = season.id;
  versus.status = 'IDLE';
  versus.groupCode = undefined;
  versus.season = undefined;
  versus.matchmaking = undefined;
  versus.reservations = [];
  versus.lastScoutKey = undefined;
  profile.updatedAt = now.toISOString();
  return profile;
}

export function minimumFieldable(): Record<Position, number> {
  return { ...MINIMUM_FIELDABLE };
}

export function formatVersusProfile(profile: PlayerProfile): string {
  if (!profile.versus) throw new Error('Versus club belum dibuat.');
  const versus = profile.versus;
  const club = versus.club;
  const season = versus.season;
  return `**${club.name}** · Liga ${versusLeagueCode(club.grade)} · ${versus.status} · group **${versus.groupCode ?? '-'}**\nVersus money **${club.versusMoney}** · coin **${club.versusCoin}** · roster v${club.rosterVersion}\nFormation **${club.formation}** · tactic **${TACTICS[club.tactic].name}**\nRecord **${club.wins}-${club.draws}-${club.losses}** · GF/GA **${club.goalsFor}/${club.goalsAgainst}** · rank **${club.rank}**\nSeason **${season?.id ?? '-'}** · round **${season?.currentRound ?? '-'}/${season ? versusTotalRounds(season) : '-'}**`;
}

export function formatVersusBattle(battle: VersusBattle, season?: VersusSeason): string {
  if (!battle.settlement) return `Battle **${battle.id}** · state **${battle.state}**`;
  const result = battle.settlement;
  const nameOf = (id: string) => season?.clubs.find((club) => club.id === id)?.name ?? id;
  const scorers = (result.scorers ?? []).map((event) => `${event.playerName}${event.assistName ? ` (${event.assistName})` : ''}`).join(', ');
  return `**${nameOf(battle.homeClubId)} ${result.homeGoals}-${result.awayGoals} ${nameOf(battle.awayClubId)}** (HT ${result.halftime.homeGoals}-${result.halftime.awayGoals})\nPossession ${result.homeStats.ballControl}-${result.awayStats.ballControl}% · shots ${result.homeStats.shots}/${result.awayStats.shots} · SOT ${result.homeStats.shotsOnTarget}/${result.awayStats.shotsOnTarget}\nCorners ${result.homeStats.corners}/${result.awayStats.corners} · kartu ${result.homeStats.yellowCards + result.homeStats.redCards}/${result.awayStats.yellowCards + result.awayStats.redCards} · MVP **${result.mvpName}**${scorers ? `\nGol: ${scorers}` : ''}`;
}
