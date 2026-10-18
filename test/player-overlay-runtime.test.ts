import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import type { RecoveryPlayerRecord } from '../src/config/recovery-data.js';

// recovery-data reads the overlay when it loads, so the fixture must exist before the
// game modules are imported. Names and values are synthetic.
const LIVERPOOL = 101106;
const ARSENAL = 101101;
const dir = mkdtempSync(join(tmpdir(), 'frs-overlay-'));
const file = join(dir, 'player-overlay.json');
const positions = [13, 12, 12, 10, 11, 9, 8, 8, 6, 3, 1, 13, 12, 5, 4, 12, 7, 1, 2, 11];
const players: RecoveryPlayerRecord[] = positions.map((positionCode, index) => ({
  nameCn: '',
  nameEn: `Fixture Red ${index + 1}`,
  num: index + 1,
  clubId: LIVERPOOL,
  positionCode,
  price: 0,
  initAge: index === 11 ? 41 : 20 + (index % 12),
  normalValue: 0,
  auctionValue: 0,
  growType: null,
  payload: '',
  provenance: 'EXTERNAL_TRANSFERMARKT_CC0',
  externalId: `tm:${9000 + index}`,
  marketValueEur: index === 10 ? 150_000_000 : index === 13 ? null : 20_000_000,
  dateOfBirth: '2000-01-01'
}));
writeFileSync(file, JSON.stringify({
  source: 'fixture', license: 'CC0-1.0', snapshot: 'fixture-snapshot', asOf: '2026-07-01', generatedAt: '2026-10-18T00:00:00.000Z',
  clubs: [{ clubId: LIVERPOOL, clubName: 'Liverpool', sourceClubId: '31', sourceClubName: 'Liverpool Football Club', players: players.length }],
  players
}));
process.env.PLAYER_OVERLAY_FILE = file;
after(() => rmSync(dir, { recursive: true, force: true }));

const { PLAYER_OVERLAY_SUMMARY, RECOVERY_PLAYERS_BY_CLUB } = await import('../src/config/recovery-data.js');
const { ensureClubState } = await import('../src/domain/club-engine.js');
const { createInitialProfile, SeededRandom } = await import('../src/domain/engine.js');

test('the overlay replaces the covered club roster and nothing else', () => {
  assert.deepEqual(PLAYER_OVERLAY_SUMMARY, { source: 'fixture', snapshot: 'fixture-snapshot', clubs: 1, players: 20 });
  const roster = RECOVERY_PLAYERS_BY_CLUB.get(LIVERPOOL)!;
  assert.deepEqual(roster.map((record) => record.nameEn), players.map((record) => record.nameEn));
  const arsenal = RECOVERY_PLAYERS_BY_CLUB.get(ARSENAL) ?? [];
  assert.ok(arsenal.length > 0 && arsenal.every((record) => !record.externalId), 'other clubs keep the APK rows');
});

test('a club built from the overlay fields the real squad with real ages and value-ranked overall', () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  const profile = ensureClubState(createInitialProfile('overlay-user', 'Overlay', 'MF', now), now, new SeededRandom(3), 'clubState', 'Liverpool');
  const imported = profile.clubState!.roster.filter((player) => player.name.startsWith('Fixture Red'));
  assert.equal(imported.length, 15, 'the first 15 overlay players join the club');
  assert.equal(profile.clubState!.roster.filter((player) => !player.isUserPlayer).length, 15, 'a balanced overlay squad needs no academy fillers');
  const byName = (name: string) => imported.find((player) => player.name === name)!;
  const regular = byName('Fixture Red 2');
  const star = byName('Fixture Red 11');
  const unknownValue = byName('Fixture Red 14');
  assert.equal(star.overall, Math.min(94, regular.overall + 6));
  assert.ok(regular.overall > unknownValue.overall);
  assert.equal(byName('Fixture Red 12').age, 41, 'veteran ages from birth dates are kept');
  assert.ok(imported.every((player) => player.id.startsWith(`recovery-${LIVERPOOL}-tm-`)));
});
