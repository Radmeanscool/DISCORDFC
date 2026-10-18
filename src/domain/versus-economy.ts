import { GAME_BALANCE } from '../config/game-balance.js';
import { SeededRandom } from './engine.js';
import { stableHash } from './league-engine.js';
import type { PlayerProfile, Position, VersusClub, VersusLedgerEntry, VersusMarketListing, VersusPlayer, VersusSeason } from './types.js';

export const VERSUS_ECONOMY_RULESET_VERSION = 'versus-economy-inferred-v2';

type EconomyProfiles = PlayerProfile[];

export interface VersusEconomyResult {
  season: VersusSeason;
  profiles: EconomyProfiles;
  listing: VersusMarketListing;
  /** Bidder whose reservation was released by this bid (for outbid notifications). */
  outbidUserId?: string;
}

/** Positions an NPC must keep so it can always field the widest formation. */
const NPC_PROTECTED_DEPTH: Record<Position, number> = { GK: 2, DF: 5, MF: 5, FW: 3 };
const NPC_LISTING_SHARE = 3;
const TIER_BASE = [74, 69, 64, 59, 55, 51];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function iso(now: Date): string {
  return now.toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} harus bilangan bulat lebih besar dari 0.`);
}

function appendLedger(profile: PlayerProfile, entry: Omit<VersusLedgerEntry, 'id' | 'createdAt' | 'balanceAfter'> & { id: string; createdAt?: string }, now: Date): void {
  const versus = profile.versus;
  if (!versus) throw new Error('Versus state belum tersedia.');
  versus.ledger ??= [];
  if (versus.ledger.some((item) => item.id === entry.id)) return;
  versus.ledger.unshift({
    ...entry,
    createdAt: entry.createdAt ?? iso(now),
    balanceAfter: versus.versusCoin
  });
  versus.ledger = versus.ledger.slice(0, 500);
}

function reservationTotal(profile: PlayerProfile, excludeListingId?: string): number {
  return (profile.versus?.reservations ?? [])
    .filter((reservation) => reservation.listingId !== excludeListingId)
    .reduce((sum, reservation) => sum + reservation.amount, 0);
}

function findOwnerClub(season: VersusSeason, userId: string): VersusClub {
  const club = season.clubs.find((item) => item.ownerId === userId && !item.isNpc);
  if (!club) throw new Error('Assigned Versus team tidak ditemukan pada season.');
  return club;
}

function marketPlayerSnapshot(player: VersusPlayer): VersusPlayer {
  return clone({ ...player, captain: false });
}

function abilityAverage(player: VersusPlayer): number {
  return Object.values(player.abilities).reduce((sum, value) => sum + value, 0) / 6;
}

function playerValue(player: Pick<VersusPlayer, 'abilities' | 'age'>): number {
  return Math.round((Object.values(player.abilities).reduce((sum, value) => sum + value, 0) / 6) * 100 + Math.max(0, 26 - player.age) * 40);
}

/** NPC players that can leave without dropping the club below a fieldable squad. */
function listableNpcPlayers(club: VersusClub, reserved: Set<string>): VersusPlayer[] {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const player of club.roster) if (!reserved.has(player.id)) counts[player.position] += 1;
  const listable: VersusPlayer[] = [];
  for (const player of [...club.roster].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))) {
    if (reserved.has(player.id) || counts[player.position] <= NPC_PROTECTED_DEPTH[player.position]) continue;
    counts[player.position] -= 1;
    listable.push(player);
  }
  return listable;
}

function freeAgent(season: VersusSeason, cycleId: number, index: number): VersusPlayer {
  const rng = new SeededRandom(stableHash(`${season.id}:${cycleId}:${index}`));
  const positions: Position[] = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW'];
  const position = positions[Math.floor(rng.next() * positions.length)];
  const base = clamp(TIER_BASE[clamp(season.grade, 0, 5)] + Math.floor(rng.next() * 9) - 2, 35, 92);
  const age = 18 + Math.floor(rng.next() * 13);
  const abilities = {
    atk: clamp(base + (position === 'FW' ? 8 : position === 'MF' ? 3 : 0), 20, 99),
    def: clamp(base + (position === 'GK' || position === 'DF' ? 8 : 0), 20, 99),
    speed: clamp(base + (position === 'FW' || position === 'MF' ? 5 : 1), 20, 99),
    power: clamp(base + 2, 20, 99),
    strength: clamp(base + (position === 'DF' ? 5 : 1), 20, 99),
    technique: clamp(base + (position === 'MF' ? 7 : position === 'FW' ? 4 : 0), 20, 99)
  };
  return {
    id: `vfa:${season.id}:${cycleId}:${index}`,
    name: `Free Agent ${String.fromCharCode(65 + (index % 26))}${(cycleId % 97) + 1}`,
    age,
    initialAge: age,
    position,
    value: playerValue({ abilities, age }),
    abilities,
    hp: 100,
    maxHp: 100,
    status: 'AVAILABLE',
    yellowCards: 0,
    redCardBan: 0,
    captain: false,
    clubId: 'free-agent',
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

export function createVersusMarket(seasonInput: VersusSeason, now = new Date()): VersusSeason {
  const season = clone(seasonInput);
  const openPlayers = new Set((season.market?.listings ?? []).filter((listing) => listing.status === 'OPEN').map((listing) => listing.player.id));
  const npcPlayers = season.clubs
    .filter((club) => club.isNpc)
    .flatMap((club) => listableNpcPlayers(club, openPlayers).map((player) => ({ player, sourceClubId: club.id })))
    .sort((a, b) => b.player.value - a.player.value || a.player.id.localeCompare(b.player.id))
    .slice(0, Math.min(NPC_LISTING_SHARE, GAME_BALANCE.versus.marketListingCount));
  const historical = season.market?.listings.filter((listing) => listing.status !== 'OPEN') ?? [];
  const cycleId = now.getTime();
  const sources = [...npcPlayers];
  for (let index = 0; sources.length < GAME_BALANCE.versus.marketListingCount; index += 1) sources.push({ player: freeAgent(season, cycleId, index), sourceClubId: 'free-agent' });
  const listings: VersusMarketListing[] = sources.map(({ player, sourceClubId }, index) => {
    const openingBid = Math.max(GAME_BALANCE.versus.marketMinimumIncrement, Math.round(player.value / GAME_BALANCE.versus.marketOpeningBidDivisor));
    return {
      id: `market:${season.id}:${cycleId}:${index + 1}`,
      player: marketPlayerSnapshot(player),
      sourceClubId,
      currency: 'COIN',
      openingBid,
      minimumIncrement: GAME_BALANCE.versus.marketMinimumIncrement,
      startsAt: iso(now),
      endsAt: new Date(now.getTime() + GAME_BALANCE.versus.marketAuctionDurationSeconds * 1_000).toISOString(),
      status: 'OPEN',
      rulesetVersion: VERSUS_ECONOMY_RULESET_VERSION
    };
  });
  season.market = { generatedAt: iso(now), listings: [...historical.slice(-30), ...listings] };
  return season;
}

export function ensureVersusMarket(seasonInput: VersusSeason, now = new Date()): VersusSeason {
  const season = clone(seasonInput);
  const hasOpenListing = season.market?.listings.some((listing) => listing.status === 'OPEN' && new Date(listing.endsAt).getTime() > now.getTime());
  return season.market && hasOpenListing ? season : createVersusMarket(season, now);
}

export function minimumVersusBid(listing: VersusMarketListing): number {
  return Math.max(listing.openingBid, (listing.currentBid ?? 0) + listing.minimumIncrement);
}

export function placeVersusBid(profilesInput: EconomyProfiles, seasonInput: VersusSeason, bidderId: string, listingId: string, amount: number, now = new Date()): VersusEconomyResult {
  positiveInteger(amount, 'Bid');
  const profiles = profilesInput.map(clone);
  const season = clone(seasonInput);
  if (season.state !== 'ACTIVE') throw new Error('Market hanya dibuka selama season Versus aktif.');
  const listing = season.market?.listings.find((item) => item.id === listingId);
  if (!listing) throw new Error('Market listing tidak ditemukan.');
  if (listing.status !== 'OPEN') throw new Error('Market listing sudah tidak terbuka.');
  if (new Date(listing.endsAt).getTime() <= now.getTime()) throw new Error('Countdown listing sudah berakhir.');
  const bidder = profiles.find((profile) => profile.userId === bidderId);
  if (!bidder?.versus) throw new Error('Versus wallet bidder tidak ditemukan.');
  const bidderClub = findOwnerClub(season, bidderId);
  if (listing.currentBidderId === bidderId) throw new Error('Anda sudah memegang bid tertinggi untuk listing ini.');
  const pendingWins = (bidder.versus.reservations ?? []).filter((reservation) => reservation.listingId !== listingId).length;
  if (bidderClub.roster.length + pendingWins + 1 > GAME_BALANCE.versus.rosterLimit) throw new Error(`Roster Versus maksimal ${GAME_BALANCE.versus.rosterLimit} pemain (termasuk bid aktif). Lepas pemain terlebih dahulu.`);
  const minimum = minimumVersusBid(listing);
  if (amount < minimum) throw new Error(`Bid minimal ${minimum} coin.`);
  const available = bidder.versus.versusCoin - reservationTotal(bidder, listingId);
  const existingReservation = bidder.versus.reservations?.find((reservation) => reservation.listingId === listingId && reservation.userId === bidderId);
  const requiredAdditional = amount - (existingReservation?.amount ?? 0);
  if (available < requiredAdditional) throw new Error('Coin tersedia tidak cukup setelah reservation bid lain.');

  let outbidUserId: string | undefined;
  if (listing.currentBidderId && listing.currentBidderId !== bidderId) {
    const previousBidder = profiles.find((profile) => profile.userId === listing.currentBidderId);
    if (previousBidder?.versus) {
      previousBidder.versus.reservations = (previousBidder.versus.reservations ?? []).filter((reservation) => reservation.listingId !== listingId);
      appendLedger(previousBidder, { id: `release:${listingId}:${previousBidder.userId}:${amount}`, seasonId: season.id, currency: 'COIN', amount: 0, note: `Bid reservation released after outbid on ${listingId}`, type: 'BID_RELEASED', transactionId: `release:${listingId}:${previousBidder.userId}:${amount}` }, now);
      outbidUserId = previousBidder.userId;
    }
  }

  bidder.versus.reservations ??= [];
  bidder.versus.reservations = bidder.versus.reservations.filter((reservation) => reservation.listingId !== listingId);
  bidder.versus.reservations.push({
    id: `reservation:${listingId}:${bidderId}`,
    listingId,
    userId: bidderId,
    currency: 'COIN',
    amount,
    createdAt: iso(now)
  });
  listing.currentBid = amount;
  listing.currentBidderId = bidderId;
  // Anti-sniping: a bid in the closing window extends the countdown for everyone.
  const remainingMs = new Date(listing.endsAt).getTime() - now.getTime();
  const window = GAME_BALANCE.versus.marketAntiSnipeSeconds * 1_000;
  if (remainingMs < window) listing.endsAt = new Date(now.getTime() + window).toISOString();
  const transactionId = `bid:${listingId}:${bidderId}:${amount}`;
  appendLedger(bidder, { id: transactionId, seasonId: season.id, currency: 'COIN', amount: 0, note: `Coin reserved for ${listingId}: ${amount}`, type: 'BID_RESERVED', transactionId }, now);
  bidder.updatedAt = iso(now);
  return { season, profiles, listing: clone(listing), outbidUserId };
}

function releaseReservation(profile: PlayerProfile | undefined, listingId: string): void {
  if (!profile?.versus) return;
  profile.versus.reservations = (profile.versus.reservations ?? []).filter((reservation) => reservation.listingId !== listingId);
}

export function settleVersusMarketListing(profilesInput: EconomyProfiles, seasonInput: VersusSeason, listingId: string, now = new Date()): VersusEconomyResult {
  const profiles = profilesInput.map(clone);
  const season = clone(seasonInput);
  if (!season.market) throw new Error('Versus market belum dibuat.');
  const listing = season.market.listings.find((item) => item.id === listingId);
  if (!listing) throw new Error('Market listing tidak ditemukan.');
  if (listing.status === 'SETTLED' || listing.status === 'EXPIRED' || listing.status === 'CANCELLED') return { season, profiles, listing: clone(listing) };
  if (new Date(listing.endsAt).getTime() > now.getTime()) throw new Error('Listing belum mencapai expiry.');

  listing.settledAt = iso(now);
  const bid = listing.currentBid;
  const bidderId = listing.currentBidderId;
  if (!bid || !bidderId) {
    listing.status = 'EXPIRED';
    return { season, profiles, listing: clone(listing) };
  }

  const bidder = profiles.find((profile) => profile.userId === bidderId);
  const bidderClub = season.clubs.find((item) => item.ownerId === bidderId && !item.isNpc);
  // A bidder who left the group or can no longer pay never blocks the market: the lot closes unsold.
  if (!bidder?.versus || !bidderClub || bidderClub.versusCoin < bid || bidder.versus.versusCoin < bid || bidderClub.roster.length >= GAME_BALANCE.versus.rosterLimit) {
    listing.status = 'CANCELLED';
    releaseReservation(bidder, listingId);
    if (bidder?.versus) appendLedger(bidder, { id: `cancel:${listingId}:${bidderId}`, seasonId: season.id, currency: 'COIN', amount: 0, note: `Auction ${listingId} dibatalkan; reservation dilepas`, type: 'BID_CANCELLED', transactionId: `cancel:${listingId}:${bidderId}` }, now);
    return { season, profiles, listing: clone(listing) };
  }
  bidderClub.versusCoin -= bid;
  bidder.versus.versusCoin = bidderClub.versusCoin;
  releaseReservation(bidder, listingId);
  const transactionId = `settle:${listingId}:${bidderId}`;
  appendLedger(bidder, { id: transactionId, seasonId: season.id, currency: 'COIN', amount: -bid, note: `Auction settlement ${listingId}`, type: 'BID_SETTLED', transactionId }, now);

  const sourceClub = season.clubs.find((club) => club.id === listing.sourceClubId);
  if (sourceClub) sourceClub.roster = sourceClub.roster.filter((player) => player.id !== listing.player.id);
  const acquiredPlayer = marketPlayerSnapshot(listing.player);
  acquiredPlayer.clubId = bidderClub.id;
  bidderClub.roster = [...bidderClub.roster.filter((player) => player.id !== acquiredPlayer.id), acquiredPlayer];
  bidderClub.rosterVersion += 1;
  listing.status = 'SETTLED';
  listing.winnerClubId = bidderClub.id;
  bidder.versus.club = clone(bidderClub);
  bidder.updatedAt = iso(now);
  return { season, profiles, listing: clone(listing) };
}

export function settleExpiredVersusMarket(profilesInput: EconomyProfiles, seasonInput: VersusSeason, now = new Date()): VersusEconomyResult[] {
  let profiles = profilesInput.map(clone);
  let season = clone(seasonInput);
  const expired = season.market?.listings.filter((listing) => listing.status === 'OPEN' && new Date(listing.endsAt).getTime() <= now.getTime()) ?? [];
  const results: VersusEconomyResult[] = [];
  for (const listing of expired) {
    const result = settleVersusMarketListing(profiles, season, listing.id, now);
    profiles = result.profiles;
    season = result.season;
    results.push(result);
  }
  return results;
}

/** Season end closes the market: open lots are cancelled and every reservation is released. */
export function closeVersusMarket(profilesInput: EconomyProfiles, seasonInput: VersusSeason, now = new Date()): { season: VersusSeason; profiles: EconomyProfiles; cancelled: VersusMarketListing[] } {
  const profiles = profilesInput.map(clone);
  const season = clone(seasonInput);
  const cancelled: VersusMarketListing[] = [];
  for (const listing of season.market?.listings ?? []) {
    if (listing.status !== 'OPEN') continue;
    listing.status = 'CANCELLED';
    listing.settledAt = iso(now);
    cancelled.push(clone(listing));
    for (const profile of profiles) releaseReservation(profile, listing.id);
  }
  return { season, profiles, cancelled };
}

export function availableVersusCoin(profile: PlayerProfile): number {
  return Math.max(0, (profile.versus?.versusCoin ?? 0) - reservationTotal(profile));
}

export function listingAbilityScore(listing: VersusMarketListing): number {
  return Math.round(abilityAverage(listing.player));
}
