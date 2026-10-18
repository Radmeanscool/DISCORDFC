import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialProfile } from '../src/domain/engine.js';
import { GAME_BALANCE } from '../src/config/game-balance.js';
import { availableVersusCoin, closeVersusMarket, createVersusMarket, minimumVersusBid, placeVersusBid, settleExpiredVersusMarket, settleVersusMarketListing } from '../src/domain/versus-economy.js';
import { createVersusSeason, enrollVersus } from '../src/domain/versus-engine.js';
import type { PlayerProfile } from '../src/domain/types.js';

const START = new Date('2026-01-01T00:00:00.000Z');
const AUCTION_END = new Date(START.getTime() + GAME_BALANCE.versus.marketAuctionDurationSeconds * 1_000 + 60_000);

function members(): PlayerProfile[] {
  return [
    enrollVersus(createInitialProfile('economy-a', 'Economy A', 'FW'), 'ECONOMY-42', START),
    enrollVersus(createInitialProfile('economy-b', 'Economy B', 'MF'), 'ECONOMY-42', START)
  ];
}

test('Versus season creates versioned Deal listings from system roster snapshots', () => {
  const season = createVersusSeason('ECONOMY-42', members(), START, 4);
  assert.equal(season.market?.listings.length, 6);
  assert.equal(season.market?.listings.every((listing) => listing.status === 'OPEN'), true);
  assert.equal(season.market?.listings.every((listing) => listing.rulesetVersion.startsWith('versus-economy-inferred')), true);
  assert.equal(season.market?.listings.every((listing) => listing.endsAt > listing.startsAt), true);
});

test('Versus bid reserves coin, raises safely, and releases prior bidder reservation', () => {
  const profiles = members();
  const season = createVersusSeason('ECONOMY-42', profiles, START, 4);
  const listing = season.market!.listings[0];
  const first = placeVersusBid(profiles, season, 'economy-a', listing.id, listing.openingBid, new Date('2026-01-01T00:00:10.000Z'));
  assert.equal(first.listing.currentBidderId, 'economy-a');
  assert.equal(first.profiles[0].versus!.reservations?.[0].amount, listing.openingBid);
  assert.equal(availableVersusCoin(first.profiles[0]), 20 - listing.openingBid);

  const second = placeVersusBid(first.profiles, first.season, 'economy-b', listing.id, listing.openingBid + 1, new Date('2026-01-01T00:00:20.000Z'));
  assert.equal(second.listing.currentBidderId, 'economy-b');
  const outbidUser = second.profiles.find((profile) => profile.userId === 'economy-a')!;
  assert.equal(outbidUser.versus!.reservations?.length, 0);
  assert.equal(outbidUser.versus!.ledger?.some((entry) => entry.type === 'BID_RELEASED'), true);
  assert.equal(second.profiles.find((profile) => profile.userId === 'economy-b')!.versus!.reservations?.[0].amount, listing.openingBid + 1);
});

test('Versus auction settlement debits winner, moves player, and is idempotent', () => {
  const profiles = members();
  const season = createVersusSeason('ECONOMY-42', profiles, START, 4);
  const listing = season.market!.listings[0];
  const bid = placeVersusBid(profiles, season, 'economy-a', listing.id, listing.openingBid, new Date('2026-01-01T00:00:10.000Z'));
  assert.throws(() => settleVersusMarketListing(bid.profiles, bid.season, listing.id, new Date('2026-01-01T00:02:00.000Z')), /belum mencapai expiry/);
  const settled = settleVersusMarketListing(bid.profiles, bid.season, listing.id, AUCTION_END);
  const winner = settled.profiles.find((profile) => profile.userId === 'economy-a')!;
  assert.equal(winner.versus!.versusCoin, 20 - listing.openingBid);
  assert.equal(winner.versus!.reservations?.length, 0);
  assert.equal(winner.versus!.club.roster.some((player) => player.id === listing.player.id), true);
  assert.equal(settled.listing.status, 'SETTLED');
  assert.equal(winner.versus!.ledger?.some((entry) => entry.type === 'BID_SETTLED' && entry.amount === -listing.openingBid), true);

  const again = settleVersusMarketListing(settled.profiles, settled.season, listing.id, new Date(AUCTION_END.getTime() + 60_000));
  assert.equal(again.profiles.find((profile) => profile.userId === 'economy-a')!.versus!.versusCoin, winner.versus!.versusCoin);
});

test('Expired unbid listing closes without changing wallet', () => {
  const profiles = members();
  const season = createVersusMarket(createVersusSeason('ECONOMY-42', profiles, START, 4), START);
  const listing = season.market!.listings[0];
  assert.equal(settleExpiredVersusMarket(profiles, season, new Date('2026-01-01T00:02:00.000Z')).length, 0);
  const results = settleExpiredVersusMarket(profiles, season, AUCTION_END);
  assert.equal(results.length, season.market!.listings.length);
  assert.equal(results[0].listing.status, 'EXPIRED');
  assert.equal(results[0].profiles.every((profile) => profile.versus!.versusCoin === 20), true);
});

test('A late bid extends the countdown (anti-snipe) and the minimum bid rises by the increment', () => {
  const profiles = members();
  const season = createVersusSeason('ECONOMY-42', profiles, START, 4);
  const listing = season.market!.listings[0];
  const late = new Date(new Date(listing.endsAt).getTime() - 30_000);
  const bid = placeVersusBid(profiles, season, 'economy-a', listing.id, listing.openingBid, late);
  assert.equal(new Date(bid.listing.endsAt).getTime(), late.getTime() + GAME_BALANCE.versus.marketAntiSnipeSeconds * 1_000);
  assert.equal(minimumVersusBid(bid.listing), listing.openingBid + listing.minimumIncrement);
  assert.throws(() => placeVersusBid(bid.profiles, bid.season, 'economy-b', listing.id, listing.openingBid, late), /Bid minimal/);
  assert.throws(() => placeVersusBid(bid.profiles, bid.season, 'economy-a', listing.id, listing.openingBid + 1, late), /sudah memegang bid tertinggi/);
});

test('NPC clubs keep a fieldable depth when their players are listed', () => {
  const season = createVersusSeason('ECONOMY-42', members(), START, 8);
  for (const listing of season.market!.listings.filter((item) => item.sourceClubId !== 'free-agent')) {
    const club = season.clubs.find((item) => item.id === listing.sourceClubId)!;
    const remaining = club.roster.filter((player) => player.id !== listing.player.id && player.position === listing.player.position).length;
    assert.ok(remaining >= { GK: 2, DF: 5, MF: 5, FW: 3 }[listing.player.position], `${club.name} keeps ${listing.player.position} depth`);
  }
});

test('Bids respect the roster limit including pending wins', () => {
  const profiles = members();
  const season = createVersusSeason('ECONOMY-42', profiles, START, 4);
  const club = season.clubs.find((item) => item.ownerId === 'economy-a')!;
  while (club.roster.length < GAME_BALANCE.versus.rosterLimit) club.roster.push({ ...club.roster[1], id: `${club.id}:filler-${club.roster.length}` });
  const listing = season.market!.listings[0];
  assert.throws(() => placeVersusBid(profiles, season, 'economy-a', listing.id, listing.openingBid, new Date('2026-01-01T00:00:10.000Z')), /Roster Versus maksimal/);
});

test('Season end closes the market: open lots are cancelled and every reservation is released', () => {
  const profiles = members();
  const season = createVersusSeason('ECONOMY-42', profiles, START, 4);
  const listing = season.market!.listings[0];
  const bid = placeVersusBid(profiles, season, 'economy-a', listing.id, listing.openingBid, new Date('2026-01-01T00:00:10.000Z'));
  const closed = closeVersusMarket(bid.profiles, bid.season, new Date('2026-01-01T01:00:00.000Z'));
  assert.equal(closed.season.market!.listings.every((item) => item.status !== 'OPEN'), true);
  assert.ok(closed.cancelled.some((item) => item.id === listing.id && item.currentBidderId === 'economy-a'));
  assert.equal(closed.profiles.every((profile) => (profile.versus!.reservations ?? []).length === 0), true);
  assert.equal(closed.profiles.find((profile) => profile.userId === 'economy-a')!.versus!.versusCoin, 20);
});
