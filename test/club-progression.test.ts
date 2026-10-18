import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { ensureClubState, formatClubStanding, getClubRating, MINIMUM_ROSTER_DEPTH, playClubMatch, setClubFormation, setClubTactic } from '../src/domain/club-engine.js';
import type { ClubPlayer } from '../src/domain/types.js';

/** Recovered rosters are incomplete, so clubs are topped up to a fieldable depth per position. */
function assertFieldableRoster(roster: ClubPlayer[] | undefined): void {
  assert.ok(roster && roster.length >= 16);
  for (const [position, minimum] of Object.entries(MINIMUM_ROSTER_DEPTH)) assert.ok(roster!.filter((player) => player.position === position).length >= minimum, `${position} depth`);
  assert.equal(roster!.filter((player) => player.isUserPlayer).length, 1);
}
import { createCoachCareer } from '../src/domain/coach-career-engine.js';
import { joinOfficialClub, listEligibleClubs, listOfficialClubs, officialClubMinimumRating } from '../src/domain/official-club-engine.js';
import { buyCoachPlayer, claimDailyReward, refreshCoachMarket, sellableCoachPlayers, sellCoachPlayer } from '../src/domain/progression-engine.js';

test('official club data exposes league 1011 and transfers only to clubs that accept the rating', () => {
  const clubs = listOfficialClubs(1011);
  assert.equal(clubs.length >= 10, true);
  let profile = ensureClubState(createInitialProfile('transfer-1', 'Transfer', 'FW'));
  profile.money = 20_000;
  const elite = [...clubs].sort((a, b) => officialClubMinimumRating(b.id) - officialClubMinimumRating(a.id))[0];
  assert.throws(() => joinOfficialClub(profile, elite.id, new Date('2026-01-01T00:00:00.000Z')), /membutuhkan rating minimal/);
  const target = listEligibleClubs(profile)[0];
  assert.ok(target, 'a 15-year-old should have at least one eligible club');
  profile = joinOfficialClub(profile, target.id, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(profile.clubState?.officialId, target.id);
  assert.equal(profile.clubState?.provenance, 'RECOVERY_VERIFIED');
  assert.equal(profile.contract?.type, 'TRANSFER');
  assert.equal(profile.ledger?.some((entry) => entry.type === 'TRANSFER_FEE' && entry.amount === -Math.max(250, Math.round(target.salaryBase / 100))), true);
});

test('recovery data seeds an official club and roster names', () => {
  const profile = ensureClubState(createInitialProfile('recovery-1', 'Recovery', 'FW'), new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(5));
  const starter = listOfficialClubs(1011).find((club) => club.nameEn === profile.club)!;
  assert.equal(starter.grade >= 3, true);
  assert.equal(profile.clubState?.provenance, 'RECOVERY_VERIFIED');
  assertFieldableRoster(profile.clubState?.roster);
});

test('club state creates a roster and can change formation and tactic', () => {
  const profile = createInitialProfile('club-1', 'Club Owner', 'MF');
  let enriched = ensureClubState(profile, new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(5));
  assertFieldableRoster(enriched.clubState?.roster);
  enriched = setClubFormation(enriched, '4-3-3');
  enriched = setClubTactic(enriched, 'attacking');
  assert.equal(enriched.clubState?.formation, '4-3-3');
  assert.equal(enriched.clubState?.tactic, 'attacking');
  assert.equal(getClubRating(enriched) > 0, true);
});

test('club strategy mutations preserve seeded initialization determinism', () => {
  const input = createInitialProfile('seeded-strategy', 'Seeded Strategy', 'MF');
  const now = new Date('2026-01-01T00:00:00.000Z');
  const formationProfile = setClubFormation(input, '4-3-3', now, 'coachClubState', new SeededRandom(17));
  const tacticProfile = setClubTactic(input, 'attacking', now, 'coachClubState', new SeededRandom(17));
  assert.deepEqual(formationProfile.coachClubState?.roster, tacticProfile.coachClubState?.roster);
  assert.deepEqual(formationProfile.coachClubState?.fixtures, tacticProfile.coachClubState?.fixtures);
  assert.equal(formationProfile.coachClubState?.formation, '4-3-3');
  assert.equal(tacticProfile.coachClubState?.tactic, 'attacking');
});

test('formatted club standings use a stable tie-breaker', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const profile = ensureClubState(createInitialProfile('standing-order', 'Standing Order', 'MF'), now, new SeededRandom(19));
  for (const standing of profile.clubState!.standings) {
    standing.points = 10;
    standing.wins = 3;
    standing.draws = 1;
    standing.losses = 0;
    standing.goalsFor = 4;
    standing.goalsAgainst = 2;
  }
  const expected = [...profile.clubState!.standings].map((standing) => standing.clubId).sort();
  const names = formatClubStanding(profile, now).split('\n').map((line) => line.split('. ')[1]!.split(' — ')[0]);
  assert.deepEqual(names, expected);
});

test('club match updates fixture and standings', () => {
  const profile = ensureClubState(createInitialProfile('club-2', 'Match Coach', 'FW'), new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(8));
  const result = playClubMatch(profile, new Date('2026-01-02T00:00:00.000Z'), new SeededRandom(9));
  assert.equal(result.fixture.played, true);
  assert.equal(result.profile.clubState?.standings.find((standing) => standing.clubId === result.profile.club)?.played, 1);
  assert.equal(result.mvp.name.length > 0, true);
});

test('daily reward enforces one claim per day and streaks on consecutive days', () => {
  const profile = createInitialProfile('daily-1', 'Daily', 'GK');
  const first = claimDailyReward(profile, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(first.streak, 1);
  assert.throws(() => claimDailyReward(first.profile, new Date('2026-01-01T12:00:00.000Z')), /sudah diambil/);
  const second = claimDailyReward(first.profile, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(second.streak, 2);
  assert.equal(second.amount > first.amount, true);
});

test('Player profile does not create an unsupported daily event state', () => {
  const profile = ensureClubState(createInitialProfile('event-1', 'Event', 'DF'), new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(3));
  assert.equal(Object.hasOwn(profile, 'event'), false);
});

test('Coach transfer market refreshes once per round and trades with club assets', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  let profile = createCoachCareer(createInitialProfile('market-1', 'Market', 'DF', now), 'Market Coach', now, new SeededRandom(4));
  profile = refreshCoachMarket(profile, now, new SeededRandom(5));
  assert.throws(() => refreshCoachMarket(profile, now, new SeededRandom(6)), /round ini/);
  const listing = profile.coachMarket!.listings[0];
  profile.coachClubState!.assets = listing.price + 1;
  const bought = buyCoachPlayer(profile, listing.id, now);
  assert.equal(bought.profile.coachClubState?.roster.some((player) => player.id === listing.player.id), true);
  assert.equal(bought.profile.coachClubState?.assets, 1);
  // Player Mode club and money are untouched by Coach trading.
  assert.equal(bought.profile.money, profile.money);
  assert.equal(bought.profile.clubState?.roster.some((player) => player.id === listing.player.id) ?? false, false);
  const sellable = sellableCoachPlayers(bought.profile);
  assert.ok(sellable.length > 0);
  const sold = sellCoachPlayer(bought.profile, sellable[0].id, now);
  assert.equal(sold.price > 0, true);
  assert.equal(sold.profile.coachClubState!.assets, 1 + sold.price);
});
