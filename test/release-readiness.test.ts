import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureClubState } from '../src/domain/club-engine.js';
import { createInitialProfile, getRating, playMatch, SeededRandom } from '../src/domain/engine.js';
import { assignMatchExp, playPreparedWeek, preparePlayerWeek, resolvePlayerWeeklyEvent } from '../src/domain/gameplay-engine.js';
import { joinOfficialClub, listEligibleClubs, listOfficialClubs, officialClubMinimumRating, officialClubTransferFee } from '../src/domain/official-club-engine.js';
import { pendingExpControls, playerWeeklyControls } from '../src/discord/components.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

test('weekly state machine rejects duplicate or out-of-order actions', () => {
  const profile = createInitialProfile('release-weekly-1', 'Release Star', 'FW', NOW);
  assert.throws(() => playPreparedWeek(profile, NOW, new SeededRandom(1)), /Weekly Update terlebih dahulu/);

  const prepared = preparePlayerWeek(profile, NOW, new SeededRandom(5120));
  assert.equal(prepared.stage, 'MATCH_READY');
  assert.throws(() => preparePlayerWeek(prepared.profile, NOW, new SeededRandom(5120)), /Weekly update sudah selesai/);

  const played = playPreparedWeek(prepared.profile, NOW, new SeededRandom(9));
  assert.equal(played.stage, 'EXP_PENDING');
  assert.throws(() => preparePlayerWeek(played.profile, NOW, new SeededRandom(5120)), /Assign EXP sebelum memulai week berikutnya/);
  assert.throws(() => assignMatchExp(played.profile, { shots: (played.profile.unassignedMatchExp ?? 0) + 1 }), /melebihi pool/);
  assert.throws(() => assignMatchExp(played.profile, { shots: 0 }), /minimal satu alokasi/);
});

test('weekly event resolution is one-time and invalid choices do not mutate state', () => {
  const profile = createInitialProfile('release-event-1', 'Event Guard', 'FW', NOW);
  const rng = { values: [0, 0, 0], next() { return this.values.shift() ?? 0; } };
  const prepared = preparePlayerWeek(profile, NOW, rng);
  assert.equal(prepared.stage, 'EVENT_PENDING');
  const beforeMoney = prepared.profile.money;
  assert.throws(() => resolvePlayerWeeklyEvent(prepared.profile, 'invalid-choice', NOW), /Pilihan event tidak valid/);
  assert.equal(prepared.profile.money, beforeMoney);

  const resolved = resolvePlayerWeeklyEvent(prepared.profile, prepared.event!.choices[0].id, NOW);
  assert.equal(resolved.profile.weekStage, 'MATCH_READY');
  assert.throws(() => resolvePlayerWeeklyEvent(resolved.profile, prepared.event!.choices[0].id, NOW), /Tidak ada event mingguan/);
});

test('match telemetry remains within safe bounds and career mutation occurs once', () => {
  const profile = createInitialProfile('release-match-1', 'Telemetry Star', 'MF', NOW);
  const result = playMatch(profile, NOW, new SeededRandom(99));
  const stats = result.record.stats!;
  assert.equal(stats.possession >= 25 && stats.possession <= 75, true);
  assert.equal(stats.possession + stats.opponentPossession, 100);
  assert.equal(stats.shotsOnTarget >= 0 && stats.shotsOnTarget <= stats.shots, true);
  assert.equal(stats.opponentShotsOnTarget >= 0 && stats.opponentShotsOnTarget <= stats.opponentShots, true);
  assert.equal(stats.corners >= 0 && stats.corners <= 12, true);
  assert.equal(stats.opponentCorners >= 0 && stats.opponentCorners <= 12, true);
  assert.equal(result.profile.career.appearances, profile.career.appearances + 1);
  assert.equal(result.profile.lastMatch?.id, result.record.id);
  assert.ok(result.record.formulaVersion);
});

test('official club transfer enforces rating, insufficient-funds, window, and same-club guards', () => {
  const base = ensureClubState(createInitialProfile('release-transfer-1', 'Transfer Guard', 'DF', NOW), NOW);
  const elite = listOfficialClubs().find((club) => club.id !== base.clubState!.officialId && officialClubMinimumRating(club.id) > getRating(base))!;
  const rich = structuredClone(base);
  rich.money = 1_000_000;
  assert.throws(() => joinOfficialClub(rich, elite.id, NOW), /membutuhkan rating minimal/);

  const target = listEligibleClubs(base)[0];
  const fee = officialClubTransferFee(target.id);
  const poor = structuredClone(base);
  poor.money = fee - 1;
  assert.throws(() => joinOfficialClub(poor, target.id, NOW), /Money tidak cukup/);

  assert.throws(() => joinOfficialClub(base, base.clubState!.officialId!, NOW), /sudah berada di klub tersebut/);

  const midSeason = structuredClone(base);
  midSeason.money = fee;
  midSeason.clubState!.fixtures[0].played = true;
  assert.throws(() => joinOfficialClub(midSeason, target.id, NOW), /Transfer window tutup/);

  const exact = structuredClone(base);
  exact.money = fee;
  const transferred = joinOfficialClub(exact, target.id, NOW);
  assert.equal(transferred.money, 0);
  assert.equal(transferred.clubState?.officialId, target.id);
  assert.equal(transferred.contract?.type, 'TRANSFER');
  assert.equal(transferred.contract?.clubId, transferred.club);
  assert.equal(transferred.ledger?.[0]?.type, 'TRANSFER_FEE');
});

test('release UI exposes only owner-bound controls and correct locked states', () => {
  const userId = 'release-ui-1';
  const ready = playerWeeklyControls(userId, 'READY').flatMap((row) => row.toJSON().components);
  const readyIds = ready.map((item) => item.custom_id);
  assert.equal(readyIds.every((id) => id?.startsWith(`frs:${userId}:`)), true);
  assert.equal(ready.find((item) => item.custom_id === `frs:${userId}:next-week`)?.disabled, false);
  assert.equal(ready.find((item) => item.custom_id === `frs:${userId}:match`)?.disabled, true);

  const pending = pendingExpControls(userId).flatMap((row) => row.toJSON().components);
  assert.equal(pending.map((item) => item.custom_id).every((id) => id?.startsWith(`frs:${userId}:`)), true);
  assert.ok(pending.some((item) => item.custom_id === `frs:${userId}:pending-exp-select`));
  assert.ok(pending.some((item) => item.custom_id === `frs:${userId}:player-league`));
});
