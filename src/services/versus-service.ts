import { GAME_BALANCE } from '../config/game-balance.js';
import type { RandomSource } from '../domain/engine.js';
import { dmEnabled } from '../domain/notification-engine.js';
import type { PlayerProfile, VersusMarketListing, VersusPlayer, VersusSeason, VersusSponsorTier, FormationId, TacticId } from '../domain/types.js';
import { releaseVersusPlayer, scoutVersusPlayer, signVersusSponsor, type VersusScoutTier } from '../domain/versus-club-engine.js';
import { closeVersusMarket, createVersusMarket, minimumVersusBid, placeVersusBid, settleExpiredVersusMarket } from '../domain/versus-economy.js';
import { addHumanToVersusSeason, assignVersusMatchmaking, createVersusClub, createVersusSeason, enrollVersus, processVersusRound, queueVersusMatchmaking, rolloverVersusClub, settleVersusSeason, submitVersusLineup, syncVersusProfileWithSeason, versusLeagueCode, versusSeasonIsJoinable, versusTotalRounds } from '../domain/versus-engine.js';
import { notifyAssigned, notifyAuctionResult, notifyBattleResult, notifyDeadline, notifyOutbid, notifySeasonEnd } from '../domain/versus-notifications.js';
import { isConcurrentProfileUpdate } from '../storage/errors.js';
import { matchesVersusFilter, type BatchPlayerStore, type PlayerStore, type VersusGroupLockStore, type VersusQueryStore } from '../storage/json-store.js';

/**
 * Versus group application service. A group's season is replicated on every
 * member profile, so every write goes through the group lock and one atomic
 * batch save. Interactive views and the maintenance worker share
 * `advanceVersusGroup`, which processes due rounds, market expiry, season end,
 * and enqueues the DM notifications for all of it.
 */

const PUBLIC_PREFIX = 'PUB-';
/** Public groups created by the previous matchmaking handler (`MM-PUBLIC-YYYYMMDD`). */
const LEGACY_PUBLIC_PREFIX = 'MM-';
const CONFLICT_ATTEMPTS = 3;

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function isPublicVersusGroup(groupCode: string | undefined): boolean {
  return Boolean(groupCode?.startsWith(PUBLIC_PREFIX) || groupCode?.startsWith(LEGACY_PUBLIC_PREFIX));
}

/** Versus members by group code or code prefix, through the store's targeted query when it has one. */
export async function findVersusMembers(store: PlayerStore, filter: { groupCode?: string; prefix?: string }): Promise<PlayerProfile[]> {
  const query = store as Partial<VersusQueryStore>;
  if (typeof query.versusMembers === 'function') return query.versusMembers(filter);
  return (await store.all()).filter((profile) => matchesVersusFilter(profile, filter));
}

function batchStore(store: PlayerStore): BatchPlayerStore {
  if (typeof (store as Partial<BatchPlayerStore>).saveBatch !== 'function') throw new Error('Versus persistence backend tidak menyediakan atomic batch save. Operasi dihentikan untuk mencegah partial season write.');
  return store as BatchPlayerStore;
}

const fallbackQueues = new Map<string, Promise<void>>();

export async function withVersusGroupLock<T>(store: PlayerStore, groupCode: string, operation: () => Promise<T>): Promise<T> {
  const lockStore = store as Partial<VersusGroupLockStore>;
  if (typeof lockStore.withVersusGroupLock === 'function') return lockStore.withVersusGroupLock(groupCode, operation);
  const previous = fallbackQueues.get(groupCode) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  fallbackQueues.set(groupCode, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (fallbackQueues.get(groupCode) === queued) fallbackQueues.delete(groupCode);
  }
}

/** Re-runs an optimistic read-modify-write when another writer saved one of the profiles first. */
export async function withConflictRetry<T>(operation: () => Promise<T>, attempts = CONFLICT_ATTEMPTS): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isConcurrentProfileUpdate(error) || attempt >= attempts) throw error;
    }
  }
}

export interface VersusGroup {
  groupCode: string;
  season?: VersusSeason;
  /** Profiles whose club plays in `season`. */
  members: PlayerProfile[];
  /** Profiles enrolled under the code that are not part of `season`. */
  waiting: PlayerProfile[];
}

function progress(season: VersusSeason): number {
  return (season.state === 'FINISHED' ? 1_000_000 : 0) + season.currentRound * 1_000 + season.battles.filter((battle) => battle.settlement).length;
}

/** The newest season wins; among copies of one season, the most advanced copy wins. */
function canonicalSeason(seasons: VersusSeason[]): VersusSeason | undefined {
  return [...seasons].sort((a, b) => b.startAt.localeCompare(a.startAt) || progress(b) - progress(a))[0];
}

export async function loadVersusGroup(store: PlayerStore, groupCode: string): Promise<VersusGroup> {
  const enrolled = await findVersusMembers(store, { groupCode });
  const season = canonicalSeason(enrolled.flatMap((profile) => (profile.versus?.season?.groupCode === groupCode ? [profile.versus.season] : [])));
  if (!season) return { groupCode, members: [], waiting: enrolled };
  const humanClubs = new Set(season.clubs.filter((club) => !club.isNpc).map((club) => club.id));
  const members: PlayerProfile[] = [];
  const waiting: PlayerProfile[] = [];
  for (const profile of enrolled) {
    const own = profile.versus!.season;
    const belongs = humanClubs.has(profile.versus!.clubId) && (own ? own.id === season.id : season.state === 'ACTIVE');
    (belongs ? members : waiting).push(profile);
  }
  return { groupCode, season: clone(season), members, waiting };
}

export interface VersusAdvanceResult {
  season: VersusSeason;
  profiles: PlayerProfile[];
  changed: boolean;
  settledBattles: number;
  settledListings: number;
  finished: boolean;
}

function clubBattle(season: VersusSeason, clubId: string, round: number) {
  return season.battles.find((battle) => battle.roundId === round && (battle.homeClubId === clubId || battle.awayClubId === clubId));
}

/**
 * Brings a group up to date: expired auctions, the due round, season end with
 * market close, and a fresh market cycle. Pure: callers persist `profiles`
 * when `changed` is set. Deadline reminders are enqueued while a round is open.
 */
export function advanceVersusGroup(seasonInput: VersusSeason, membersInput: PlayerProfile[], now: Date, rng?: RandomSource): VersusAdvanceResult {
  let season = clone(seasonInput);
  let profiles = membersInput.map(clone);
  // Members missing their copy (e.g. a crash between enrollment and season sync) are repaired by the sync below.
  let changed = profiles.some((profile) => profile.versus?.season?.id !== season.id);
  let settledBattles = 0;
  let settledListings = 0;
  let finished = false;
  const auctionResults: VersusMarketListing[] = [];
  const processedRounds: number[] = [];

  if (season.state === 'ACTIVE' && season.market) {
    const results = settleExpiredVersusMarket(profiles, season, now);
    if (results.length > 0) {
      const latest = results[results.length - 1];
      season = latest.season;
      profiles = latest.profiles;
      settledListings += results.length;
      auctionResults.push(...results.map((result) => result.listing).filter((listing) => listing.currentBidderId));
      changed = true;
    }
  }

  const totalRounds = versusTotalRounds(season);
  const deadline = new Date(season.roundDeadline).getTime();
  if (season.state === 'ACTIVE' && season.currentRound <= totalRounds && Number.isFinite(deadline) && now.getTime() >= deadline) {
    const round = season.currentRound;
    season = processVersusRound(season, round, now, rng);
    processedRounds.push(round);
    settledBattles += season.battles.filter((battle) => battle.roundId === round && battle.state === 'PUBLISHED').length;
    changed = true;
  }

  if (season.state === 'ACTIVE' && season.currentRound > totalRounds) {
    season = settleVersusSeason(season, now);
    const closed = closeVersusMarket(profiles, season, now);
    season = closed.season;
    profiles = closed.profiles;
    auctionResults.push(...closed.cancelled.filter((listing) => listing.currentBidderId));
    finished = true;
    changed = true;
  }

  if (season.state === 'ACTIVE' && !season.market?.listings.some((listing) => listing.status === 'OPEN' && new Date(listing.endsAt).getTime() > now.getTime())) {
    season = createVersusMarket(season, now);
    changed = true;
  }

  if (changed) profiles = profiles.map((profile) => syncVersusProfileWithSeason(profile, season, now));
  for (const profile of profiles) {
    const clubId = profile.versus!.clubId;
    for (const round of processedRounds) {
      const battle = clubBattle(season, clubId, round);
      if (battle) notifyBattleResult(profile, season, battle, now);
    }
    if (finished) notifySeasonEnd(profile, season, now);
    for (const listing of auctionResults) if (listing.currentBidderId === profile.userId) notifyAuctionResult(profile, listing, now);
  }

  if (season.state === 'ACTIVE') {
    const remaining = new Date(season.roundDeadline).getTime() - now.getTime();
    if (remaining > 0 && remaining <= GAME_BALANCE.versus.deadlineReminderHours * 3_600_000) {
      for (const profile of profiles) {
        const clubId = profile.versus!.clubId;
        const battle = clubBattle(season, clubId, season.currentRound);
        const submission = battle ? (battle.homeClubId === clubId ? battle.homeSubmission : battle.awaySubmission) : undefined;
        if (battle && !submission && notifyDeadline(profile, season, battle, now)) changed = true;
      }
    }
  }
  return { season, profiles, changed, settledBattles, settledListings, finished };
}

export async function catchUpVersusGroup(store: PlayerStore, groupCode: string, now = new Date(), rng?: RandomSource): Promise<{ group: VersusGroup; result?: VersusAdvanceResult }> {
  const writer = batchStore(store);
  return withVersusGroupLock(store, groupCode, () => withConflictRetry(async () => {
    const group = await loadVersusGroup(store, groupCode);
    if (!group.season || group.members.length === 0) return { group };
    const result = advanceVersusGroup(group.season, group.members, now, rng);
    if (!result.changed) return { group, result };
    await writer.saveBatch(result.profiles);
    return { group: { ...group, season: result.season, members: result.profiles }, result };
  }));
}

interface GroupMutation<T> {
  season: VersusSeason;
  /** Profiles changed by the mutation; the rest of the members are synced as-is. */
  profiles?: PlayerProfile[];
  result: T;
  /** Runs on the synced profiles right before the save, e.g. to enqueue notifications. */
  beforeSave?: (profiles: PlayerProfile[]) => void;
}

async function mutateActiveGroup<T>(store: PlayerStore, groupCode: string, now: Date, mutate: (season: VersusSeason, members: PlayerProfile[]) => GroupMutation<T>): Promise<{ season: VersusSeason; profiles: PlayerProfile[]; result: T }> {
  const writer = batchStore(store);
  return withVersusGroupLock(store, groupCode, () => withConflictRetry(async () => {
    const group = await loadVersusGroup(store, groupCode);
    if (!group.season || group.members.length === 0) throw new Error('Season Versus untuk group ini tidak ditemukan. Buka ulang Versus Home.');
    const advanced = advanceVersusGroup(group.season, group.members, now);
    let outcome: GroupMutation<T>;
    try {
      if (advanced.season.state !== 'ACTIVE') throw new Error('Season Versus sudah selesai. Tekan Next Season untuk melanjutkan.');
      outcome = mutate(advanced.season, advanced.profiles);
    } catch (error) {
      // Keep the catch-up even when the requested action is rejected.
      if (advanced.changed) await writer.saveBatch(advanced.profiles);
      throw error;
    }
    const byUser = new Map(advanced.profiles.map((profile) => [profile.userId, profile]));
    for (const profile of outcome.profiles ?? []) byUser.set(profile.userId, profile);
    const profiles = [...byUser.values()].map((profile) => syncVersusProfileWithSeason(profile, outcome.season, now));
    outcome.beforeSave?.(profiles);
    await writer.saveBatch(profiles);
    return { season: outcome.season, profiles, result: outcome.result };
  }));
}

export interface VersusView {
  profile: PlayerProfile;
  season?: VersusSeason;
  /** Enrolled in a private group whose current season already started. */
  waiting?: boolean;
}

function humanCount(season: VersusSeason): number {
  return season.clubs.filter((club) => !club.isNpc).length;
}

/** Creates the club, applies a finished season once, and drops an enrollment that never received a season. */
function prepareForAssignment(profile: PlayerProfile, now: Date): PlayerProfile {
  // Rollover first: it must see the club as it finished the season (legacy scale included).
  const next = createVersusClub(rolloverVersusClub(profile, now), now);
  const versus = next.versus!;
  if (versus.groupCode && !versus.season) {
    versus.groupCode = undefined;
    versus.status = 'IDLE';
    versus.matchmaking = undefined;
  }
  return next;
}

async function joinablePublicGroups(store: PlayerStore, letter: string, now: Date): Promise<string[]> {
  const prefix = `${PUBLIC_PREFIX}${letter}-`;
  const seasons = new Map<string, VersusSeason>();
  for (const profile of await findVersusMembers(store, { prefix })) {
    const code = profile.versus!.groupCode!;
    const season = profile.versus?.season;
    if (!season || season.groupCode !== code) continue;
    const known = seasons.get(code);
    if (!known || canonicalSeason([known, season]) === season) seasons.set(code, season);
  }
  return [...seasons.entries()]
    .filter(([, season]) => versusSeasonIsJoinable(season, now))
    .sort(([a, left], [b, right]) => humanCount(right) - humanCount(left) || a.localeCompare(b))
    .map(([code]) => code);
}

async function nextPublicGroupCode(store: PlayerStore, letter: string, now: Date): Promise<string> {
  const prefix = `${PUBLIC_PREFIX}${letter}-${now.toISOString().slice(2, 10).replace(/-/g, '')}-`;
  const used = new Set((await findVersusMembers(store, { prefix })).map((profile) => profile.versus!.groupCode!));
  for (let index = 1; index < 1_000; index += 1) {
    const code = `${prefix}${String(index).padStart(2, '0')}`;
    if (!used.has(code)) return code;
  }
  throw new Error('Kapasitas public league hari ini penuh.');
}

/**
 * Public league assignment: the club joins an open group of its own letter tier
 * (taking over an NPC slot before round 1) or opens a new one. No country, no
 * Player/Coach data: the Versus club is its own aggregate.
 */
export async function ensurePublicVersusAssignment(store: PlayerStore, userId: string, now = new Date()): Promise<VersusView> {
  const writer = batchStore(store);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const profile = await store.get(userId);
    if (!profile) throw new Error('Profil belum dibuat. Buat profil dari Game Home terlebih dahulu.');
    const letter = versusLeagueCode(prepareForAssignment(profile, now).versus!.club.grade);
    const groupCode = (await joinablePublicGroups(store, letter, now))[0] ?? await nextPublicGroupCode(store, letter, now);
    const view = await withVersusGroupLock(store, groupCode, () => withConflictRetry(async (): Promise<VersusView | undefined> => {
      const fresh = await store.get(userId);
      if (!fresh) throw new Error('Profil belum dibuat.');
      if (fresh.versus?.groupCode && fresh.versus.season?.state === 'ACTIVE') return { profile: fresh, season: fresh.versus.season };
      const base = prepareForAssignment(fresh, now);
      if (versusLeagueCode(base.versus!.club.grade) !== letter) return undefined;
      const group = await loadVersusGroup(store, groupCode);
      if (group.season && !versusSeasonIsJoinable(group.season, now)) return undefined;
      const assigned = assignVersusMatchmaking(queueVersusMatchmaking(base, 'public', now), groupCode, now);
      const season = group.season ? addHumanToVersusSeason(group.season, assigned, now) : createVersusSeason(groupCode, [assigned], now);
      const profiles = [...group.members, assigned].map((member) => syncVersusProfileWithSeason(member, season, now));
      const self = profiles.find((member) => member.userId === userId)!;
      notifyAssigned(self, season, now);
      await writer.saveBatch(profiles);
      return { profile: self, season };
    }));
    if (view) return view;
  }
  throw new Error('Assignment Versus sedang sibuk. Coba buka Versus lagi sebentar.');
}

/** Private group: join before round 1, wait for the next season, or start a new season for everyone waiting. */
export async function joinVersusGroup(store: PlayerStore, userId: string, groupCodeInput: string, now = new Date()): Promise<VersusView> {
  const groupCode = groupCodeInput.trim().toUpperCase();
  if (isPublicVersusGroup(groupCode)) throw new Error('Kode PUB- dikelola sistem. Buka Versus Home untuk public league.');
  const writer = batchStore(store);
  return withVersusGroupLock(store, groupCode, () => withConflictRetry(async () => {
    const fresh = await store.get(userId);
    if (!fresh) throw new Error('Profil belum dibuat. Buat profil dari Game Home terlebih dahulu.');
    const group = await loadVersusGroup(store, groupCode);
    const member = group.members.find((profile) => profile.userId === userId);
    if (member && group.season?.state === 'ACTIVE') return { profile: member, season: group.season };
    const enrolled = enrollVersus(fresh, groupCode, now);
    const current = group.season;
    if (current?.state === 'ACTIVE') {
      if (!versusSeasonIsJoinable(current, now)) {
        await writer.saveBatch([enrolled]);
        return { profile: enrolled, waiting: true };
      }
      const season = addHumanToVersusSeason(current, enrolled, now);
      const profiles = [...group.members, enrolled].map((profile) => syncVersusProfileWithSeason(profile, season, now));
      const self = profiles.find((profile) => profile.userId === userId)!;
      notifyAssigned(self, season, now);
      await writer.saveBatch(profiles);
      return { profile: self, season };
    }
    const participants = [...group.waiting.filter((profile) => profile.userId !== userId && !profile.versus?.season), enrolled];
    if (participants.length > GAME_BALANCE.versus.defaultGroupCapacity) throw new Error(`Group Versus penuh (maksimal ${GAME_BALANCE.versus.defaultGroupCapacity} club).`);
    const season = createVersusSeason(groupCode, participants, now);
    const profiles = participants.map((profile) => syncVersusProfileWithSeason(profile, season, now));
    for (const profile of profiles) notifyAssigned(profile, season, now);
    await writer.saveBatch(profiles);
    return { profile: profiles.find((profile) => profile.userId === userId)!, season };
  }));
}

/** Versus Home: catches the group up, then returns the user's season (finished seasons stay visible until Next Season). */
export async function openVersus(store: PlayerStore, userId: string, now = new Date()): Promise<VersusView> {
  const current = await store.get(userId);
  if (!current) throw new Error('Profil belum dibuat. Buat profil dari Game Home terlebih dahulu.');
  const groupCode = current.versus?.groupCode;
  if (groupCode && current.versus) {
    if (current.versus.season?.state === 'FINISHED') return { profile: current, season: current.versus.season };
    const { group } = await catchUpVersusGroup(store, groupCode, now);
    const member = group.members.find((profile) => profile.userId === userId);
    if (member) return { profile: member, season: member.versus?.season ?? group.season };
    if (!isPublicVersusGroup(groupCode)) {
      if (group.season?.state === 'ACTIVE' && !versusSeasonIsJoinable(group.season, now)) {
        const waiting = group.waiting.find((profile) => profile.userId === userId) ?? current;
        return { profile: waiting, waiting: true };
      }
      return joinVersusGroup(store, userId, groupCode, now);
    }
  }
  return ensurePublicVersusAssignment(store, userId, now);
}

export async function startNextVersusSeason(store: PlayerStore, userId: string, now = new Date()): Promise<VersusView> {
  const profile = await store.get(userId);
  const season = profile?.versus?.season;
  if (!profile || !season || season.state !== 'FINISHED') throw new Error('Season Versus Anda belum selesai.');
  if (!isPublicVersusGroup(season.groupCode)) return joinVersusGroup(store, userId, season.groupCode, now);
  return ensurePublicVersusAssignment(store, userId, now);
}

/** Leaves a private group that is still waiting for its next season and moves to the public league. */
export async function leaveWaitingVersusGroup(store: PlayerStore, userId: string, now = new Date()): Promise<VersusView> {
  const profile = await store.get(userId);
  if (profile?.versus?.season?.state === 'ACTIVE') throw new Error('Club sedang bermain di season aktif; group baru dapat dipilih setelah season selesai.');
  return ensurePublicVersusAssignment(store, userId, now);
}

async function requireActiveGroup(store: PlayerStore, userId: string): Promise<string> {
  const profile = await store.get(userId);
  const versus = profile?.versus;
  if (!versus?.groupCode || !versus.season) throw new Error('Club belum masuk season Versus. Buka Versus Home terlebih dahulu.');
  if (versus.season.state === 'FINISHED') throw new Error('Season Versus sudah selesai. Tekan Next Season untuk melanjutkan.');
  return versus.groupCode;
}

export interface LineupInput {
  battleId: string;
  lineup: string[];
  substitutes: string[];
  captainId: string;
  formation: FormationId;
  tactic: TacticId;
  rosterVersion: number;
}

export async function submitVersusLineupFor(store: PlayerStore, userId: string, input: LineupInput, now = new Date()): Promise<{ season: VersusSeason; profile: PlayerProfile }> {
  const groupCode = await requireActiveGroup(store, userId);
  const { season, profiles } = await mutateActiveGroup(store, groupCode, now, (current) => ({
    season: submitVersusLineup(current, input.battleId, userId, input.lineup, input.substitutes, input.captainId, input.formation, input.tactic, input.rosterVersion, now),
    result: undefined
  }));
  return { season, profile: profiles.find((profile) => profile.userId === userId)! };
}

/** Bids `amount` coin, or the current minimum bid when no amount is given. */
export async function placeVersusBidFor(store: PlayerStore, userId: string, listingId: string, amount: number | undefined, now = new Date()): Promise<{ season: VersusSeason; profile: PlayerProfile; listing: VersusMarketListing }> {
  const groupCode = await requireActiveGroup(store, userId);
  const { season, profiles, result } = await mutateActiveGroup(store, groupCode, now, (current, members) => {
    const listing = current.market?.listings.find((item) => item.id === listingId);
    if (!listing) throw new Error('Market listing tidak ditemukan; market mungkin sudah diperbarui. Buka ulang Market.');
    const bid = placeVersusBid(members, current, userId, listingId, amount ?? minimumVersusBid(listing), now);
    return {
      season: bid.season,
      profiles: bid.profiles,
      result: bid.listing,
      beforeSave: (synced) => {
        const outbid = synced.find((profile) => profile.userId === bid.outbidUserId);
        if (outbid) notifyOutbid(outbid, bid.listing, bid.listing.currentBid ?? 0, now);
      }
    };
  });
  return { season, profile: profiles.find((profile) => profile.userId === userId)!, listing: result };
}

async function mutateClub<T>(store: PlayerStore, userId: string, now: Date, apply: (profile: PlayerProfile, season?: VersusSeason) => { profile: PlayerProfile; season?: VersusSeason; result: T }): Promise<{ profile: PlayerProfile; season?: VersusSeason; result: T }> {
  const profile = await store.get(userId);
  const versus = profile?.versus;
  if (!profile || !versus) throw new Error('Club Versus belum dibuat. Buka Versus Mode terlebih dahulu.');
  if (versus.season?.state === 'FINISHED') throw new Error('Season Versus sudah selesai. Tekan Next Season sebelum mengubah club.');
  if (versus.groupCode && versus.season) {
    const { season, profiles, result } = await mutateActiveGroup(store, versus.groupCode, now, (current, members) => {
      const self = members.find((member) => member.userId === userId);
      if (!self) throw new Error('Club Anda tidak terdaftar pada season ini.');
      const mutation = apply(self, current);
      return { season: mutation.season ?? current, profiles: [mutation.profile], result: mutation.result };
    });
    return { profile: profiles.find((member) => member.userId === userId)!, season, result };
  }
  return withConflictRetry(async () => {
    const fresh = await store.get(userId);
    if (!fresh?.versus) throw new Error('Club Versus belum dibuat.');
    const mutation = apply(fresh, undefined);
    mutation.profile.updatedAt = now.toISOString();
    await store.save(mutation.profile);
    return { profile: mutation.profile, result: mutation.result };
  });
}

export async function releaseVersusPlayerFor(store: PlayerStore, userId: string, playerId: string, now = new Date()): Promise<{ profile: PlayerProfile; player: VersusPlayer; refund: number }> {
  const { profile, result } = await mutateClub(store, userId, now, (self, season) => releaseVersusPlayer(self, season, playerId));
  return { profile, ...result };
}

export async function scoutVersusPlayerFor(store: PlayerStore, userId: string, tier: VersusScoutTier, now = new Date()): Promise<{ profile: PlayerProfile; player: VersusPlayer; cost: number }> {
  const { profile, result } = await mutateClub(store, userId, now, (self, season) => scoutVersusPlayer(self, season, tier, now));
  return { profile, ...result };
}

export async function signVersusSponsorFor(store: PlayerStore, userId: string, tier: VersusSponsorTier, now = new Date()): Promise<{ profile: PlayerProfile; season?: VersusSeason }> {
  const { profile, season } = await mutateClub(store, userId, now, (self, current) => signVersusSponsor(self, current, tier, now));
  return { profile, season };
}

export async function toggleVersusDm(store: PlayerStore, userId: string, now = new Date()): Promise<PlayerProfile> {
  return withConflictRetry(async () => {
    const profile = await store.get(userId);
    if (!profile) throw new Error('Profil belum dibuat.');
    profile.notificationSettings = { dm: !dmEnabled(profile) };
    profile.updatedAt = now.toISOString();
    await store.save(profile);
    return profile;
  });
}
