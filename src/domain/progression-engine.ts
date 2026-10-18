import { ensureClubState, MINIMUM_ROSTER_DEPTH, recoveredMarketPlayer } from './club-engine.js';
import { MathRandomSource, type RandomSource } from './engine.js';
import { formatMoney } from './format.js';
import { clubStrengthByName, isDomesticLeague, officialClubStrength } from './league-engine.js';
import { RECOVERY_CLUBS, RECOVERY_PLAYERS } from '../config/recovery-data.js';
import type { ClubPlayer, MarketListing, PlayerProfile } from './types.js';

export { formatMoney } from './format.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dayKey(date);
}

function ledger(profile: PlayerProfile, type: string, amount: number, note: string, now: Date): void {
  profile.ledger ??= [];
  profile.money += amount;
  profile.ledger.unshift({ id: `${profile.userId}-${now.getTime()}-${profile.ledger.length}`, createdAt: now.toISOString(), type, amount, balanceAfter: profile.money, note });
  profile.ledger = profile.ledger.slice(0, 100);
}

export function claimDailyReward(profileInput: PlayerProfile, now = new Date()): { profile: PlayerProfile; amount: number; exp: number; streak: number } {
  const profile = clone(profileInput);
  profile.daily ??= { streak: 0 };
  const today = dayKey(now);
  if (profile.daily.lastClaimDate === today) throw new Error('Daily reward hari ini sudah diambil.');
  const yesterday = addDays(today, -1);
  profile.daily.streak = profile.daily.lastClaimDate === yesterday ? profile.daily.streak + 1 : 1;
  profile.daily.lastClaimDate = today;
  const amount = 100 + Math.min(profile.daily.streak * 25, 250);
  const exp = 20 + profile.daily.streak * 5;
  ledger(profile, 'DAILY_REWARD', amount, `Daily reward streak ${profile.daily.streak}`, now);
  profile.totalExp += exp;
  profile.level = Math.max(profile.level, Math.floor(profile.totalExp / 100) + 1);
  profile.updatedAt = now.toISOString();
  return { profile, amount, exp, streak: profile.daily.streak };
}

/**
 * Player incidents are intentionally not generated here. The recovered/public
 * evidence supports conditional career activities and seasonal content, but it
 * does not validate a daily random choice table or Money costs. Legacy JSON
 * rows named `event` are ignored by the active Player lifecycle.
 */

/** Transfer value from ability and age (RECOVERY_INFERRED; the client price field decodes as a constant). */
export function playerMarketValue(player: Pick<ClubPlayer, 'overall' | 'age'>): number {
  return Math.round(player.overall * player.overall * 1.2 + Math.max(0, 28 - player.age) * 60);
}

export const COACH_MARKET_SELL_RATE = 0.65;
const COACH_ROSTER_LIMIT = 32;
const COACH_MARKET_SIZE = 10;

function coachRoundsPlayed(profile: PlayerProfile): number {
  return profile.coachClubState?.fixtures.filter((fixture) => fixture.played).length ?? 0;
}

/**
 * Coach Mode transfer list: recovered players from domestic clubs near the
 * Coach club's level. One refresh per played round keeps it from being re-rolled freely.
 */
export function refreshCoachMarket(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource(), force = false): PlayerProfile {
  const profile = ensureClubState(profileInput, now, rng, 'coachClubState');
  const club = profile.coachClubState!;
  const round = coachRoundsPlayed(profile);
  const season = profile.coach?.season ?? profile.league.season;
  if (!force && profile.coachMarket && profile.coachMarket.season === season && profile.coachMarket.refreshedAtRound === round) {
    throw new Error('Transfer list sudah diperbarui untuk round ini. Mainkan round berikutnya untuk daftar baru.');
  }
  const ownStrength = clubStrengthByName(club.name, club.leagueId);
  const owned = new Set(club.roster.map((player) => player.id));
  const nearbyClubs = new Set(RECOVERY_CLUBS.filter((item) => isDomesticLeague(item.league) && item.nameEn !== club.name && Math.abs(officialClubStrength(item) - ownStrength) <= 8).map((item) => item.id));
  const pool = RECOVERY_PLAYERS.filter((record) => nearbyClubs.has(record.clubId));
  const picks: MarketListing[] = [];
  const used = new Set<string>();
  for (let attempt = 0; attempt < 200 && picks.length < COACH_MARKET_SIZE && pool.length; attempt += 1) {
    const record = pool[Math.floor(rng.next() * pool.length)];
    const player = recoveredMarketPlayer(record, now);
    if (owned.has(player.id) || used.has(player.id)) continue;
    used.add(player.id);
    picks.push({ id: `coach-listing-${season}-${round}-${picks.length + 1}`, sellerUserId: 'system-market', player, price: playerMarketValue(player), status: 'OPEN', createdAt: now.toISOString() });
  }
  profile.coachMarket = { listings: picks, refreshedAt: now.toISOString(), refreshedAtRound: round, season };
  profile.updatedAt = now.toISOString();
  return profile;
}

export function buyCoachPlayer(profileInput: PlayerProfile, listingId: string, now = new Date(), rng: RandomSource = new MathRandomSource()): { profile: PlayerProfile; listing: MarketListing } {
  const profile = ensureClubState(profileInput, now, rng, 'coachClubState');
  if (!profile.coach || profile.coach.status !== 'EMPLOYED') throw new Error('Coach harus terikat kontrak dengan club untuk membeli pemain.');
  const club = profile.coachClubState!;
  const listing = profile.coachMarket?.listings.find((item) => item.id === listingId && item.status === 'OPEN');
  if (!listing) throw new Error('Listing tidak ditemukan atau sudah tidak tersedia.');
  if (club.roster.some((player) => player.id === listing.player.id)) throw new Error('Pemain tersebut sudah berada di roster club.');
  if (club.roster.length >= COACH_ROSTER_LIMIT) throw new Error(`Roster sudah penuh (${COACH_ROSTER_LIMIT}). Jual pemain sebelum membeli.`);
  if (club.assets < listing.price) throw new Error(`Aset club tidak cukup: butuh ${formatMoney(listing.price)}, tersedia ${formatMoney(club.assets)}.`);
  club.assets -= listing.price;
  listing.status = 'SOLD';
  listing.buyerUserId = profile.userId;
  club.roster.push({ ...clone(listing.player), isUserPlayer: false, morale: 80 });
  profile.updatedAt = now.toISOString();
  return { profile, listing };
}

export function sellableCoachPlayers(profile: PlayerProfile): ClubPlayer[] {
  const roster = profile.coachClubState?.roster ?? [];
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const player of roster) counts[player.position] += 1;
  return roster.filter((player) => !player.isUserPlayer && counts[player.position] > MINIMUM_ROSTER_DEPTH[player.position]);
}

export function sellCoachPlayer(profileInput: PlayerProfile, playerId: string, now = new Date(), rng: RandomSource = new MathRandomSource()): { profile: PlayerProfile; price: number; player: ClubPlayer } {
  const profile = ensureClubState(profileInput, now, rng, 'coachClubState');
  if (!profile.coach || profile.coach.status !== 'EMPLOYED') throw new Error('Coach harus terikat kontrak dengan club untuk menjual pemain.');
  const club = profile.coachClubState!;
  if (!sellableCoachPlayers(profile).some((player) => player.id === playerId)) throw new Error('Pemain tidak ditemukan atau posisinya sudah di batas minimum roster.');
  const index = club.roster.findIndex((player) => player.id === playerId);
  const [player] = club.roster.splice(index, 1);
  const price = Math.round(playerMarketValue(player) * COACH_MARKET_SELL_RATE);
  club.assets += price;
  profile.updatedAt = now.toISOString();
  return { profile, price, player };
}
