import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPlayerOverlay, type PlayerOverlay } from '../src/config/player-overlay.js';
import { RECOVERY_CLUBS, recoveryPositionGroup, type RecoveryPlayerRecord } from '../src/config/recovery-data.js';
import { ageOn, buildPlayerOverlay, EXTERNAL_PROVENANCE, matchClubs, nameTokens, orderSquad, parseCsv, positionCodeFor, type TransfermarktClub } from '../src/config/transfermarkt-import.js';
import { clubPlayerOverallFromValue } from '../src/domain/league-engine.js';

// Fixture rows below imitate the transfermarkt-datasets layout; names and values are synthetic.

function clubId(name: string): number {
  const club = RECOVERY_CLUBS.find((item) => item.nameEn === name);
  assert.ok(club, `recovered club ${name}`);
  return club.id;
}

function tm(clubIdValue: string, code: string, name: string, competitionId: string, lastSeason = 2025): TransfermarktClub {
  return { clubId: clubIdValue, code, name, competitionId, lastSeason };
}

test('CSV parser handles quotes, doubled quotes, CRLF, embedded newlines and a BOM', () => {
  const rows = parseCsv('﻿id,name,note\r\n1,"Smith, John","said ""hi"""\r\n2,Plain,"two\nlines"\n\n');
  assert.deepEqual(rows, [
    { id: '1', name: 'Smith, John', note: 'said "hi"' },
    { id: '2', name: 'Plain', note: 'two\nlines' }
  ]);
});

test('name tokens fold diacritics, legal forms and German exonyms', () => {
  assert.deepEqual(nameTokens('1. FC Köln'), ['koln']);
  assert.deepEqual(nameTokens('Real Betis Balompié S.A.D.'), ['real', 'betis', 'balompie']);
  assert.deepEqual(nameTokens('inter-mailand'), ['inter', 'milan']);
  assert.deepEqual(nameTokens('Zenit St.Petersburg'), ['zenit', 'saint', 'petersburg']);
  assert.deepEqual(nameTokens('Brighton & Hove Albion'), ['brighton', 'hove', 'albion']);
});

test('clubs match one-to-one inside their own league, including look-alike names', () => {
  const sources = [
    tm('31', 'fc-liverpool', 'Liverpool Football Club', 'GB1'),
    tm('281', 'manchester-city', 'Manchester City Football Club', 'GB1'),
    tm('985', 'manchester-united', 'Manchester United Football Club', 'GB1'),
    tm('5', 'ac-mailand', 'Associazione Calcio Milan', 'IT1'),
    tm('46', 'inter-mailand', 'Football Club Internazionale Milano S.p.A.', 'IT1'),
    tm('506', 'juventus-turin', 'Juventus Football Club', 'IT1'),
    tm('416', 'fc-turin', 'Torino Calcio', 'IT1'),
    tm('583', 'fc-paris-saint-germain', 'Paris Saint-Germain Football Club', 'FR1'),
    tm('10004', 'paris-fc', 'Paris Football Club', 'FR1'),
    tm('290', 'aj-auxerre', 'Association de la Jeunesse Auxerroise', 'FR1'),
    tm('1041', 'olympique-lyon', 'Olympique Lyon', 'FR1'),
    tm('23826', 'rasenballsport-leipzig', 'RasenBallsport Leipzig', 'L1'),
    tm('33', 'fc-schalke-04', 'FC Schalke 04', 'L1', 2022),
    tm('336', 'sporting-lissabon', 'Sporting CP', 'PO1'),
    tm('2410', 'zska-moskau', 'PFK CSKA Moskva', 'RU1'),
    tm('301', 'fcsb', 'FCSB', 'RO1'),
    tm('159', 'roter-stern-belgrad', 'Red Star Belgrade', 'SER1'),
    // A Liverpool look-alike in another league must never be picked.
    tm('9999', 'liverpool-montevideo', 'Liverpool Fútbol Club', 'URU1')
  ];
  const expected: Record<string, string> = {
    Liverpool: '31', 'Manchester City': '281', 'Manchester United': '985', 'AC Milan': '5', Inter: '46', Juventus: '506', Torino: '416',
    'Paris Saint-Germain': '583', Paris: '10004', Auxerre: '290', 'Olympique Lyonnais': '1041', 'RB Leipzig': '23826',
    'Sporting Clube de Portugal': '336', 'CSKA Moscow': '2410', 'Steaua Bucharest': '301', 'Crvena Zvezda Beograd': '159'
  };
  const matches = matchClubs(RECOVERY_CLUBS, sources, 2025);
  const byName = new Map(matches.map((match) => [match.club.nameEn, match]));
  for (const [name, sourceId] of Object.entries(expected)) {
    const match = byName.get(name)!;
    assert.equal(match.source?.clubId, sourceId, `${name} matched ${match.source?.name ?? match.reason}`);
    assert.equal(match.reason, 'matched');
  }
  assert.equal(byName.get('Schalke 04')!.reason, 'stale', 'a club last scraped in 2022 is not current');
  assert.equal(byName.get('CSKA Sofia')!.reason, 'no-competition', 'Bulgaria is outside the dataset');
  assert.equal(byName.get('FC Kingdom')!.reason, 'no-competition', 'fictional clubs keep their roster');
  const used = matches.filter((match) => match.source).map((match) => match.source!.clubId);
  assert.equal(new Set(used).size, used.length, 'no source club is used twice');
  assert.ok(!used.includes('9999'));
});

test('overrides force or exclude a club', () => {
  const sources = [tm('31', 'fc-liverpool', 'Liverpool Football Club', 'GB1'), tm('11', 'fc-arsenal', 'Arsenal Football Club', 'GB1')];
  const matches = matchClubs(RECOVERY_CLUBS, sources, 2025, { [clubId('Liverpool')]: null, [clubId('Chelsea')]: 31 });
  const byName = new Map(matches.map((match) => [match.club.nameEn, match]));
  assert.equal(byName.get('Liverpool')!.reason, 'excluded');
  assert.equal(byName.get('Chelsea')!.source?.clubId, '31');
  assert.equal(byName.get('Chelsea')!.reason, 'override');
  assert.equal(byName.get('Arsenal')!.source?.clubId, '11');
});

test('positions, ages and squad order follow the game rules', () => {
  assert.equal(positionCodeFor('Attack', 'Centre-Forward'), 1);
  assert.equal(recoveryPositionGroup(positionCodeFor('Midfield', 'Attacking Midfield')!), 'MF');
  assert.equal(positionCodeFor('Defender', 'Left-Back'), 10);
  assert.equal(positionCodeFor('Goalkeeper', 'Goalkeeper'), 13);
  assert.equal(positionCodeFor('Midfield', ''), 8, 'falls back to the main position');
  assert.equal(positionCodeFor('Missing', ''), undefined);

  const asOf = new Date('2026-07-01T00:00:00.000Z');
  assert.equal(ageOn('2000-07-01', asOf), 26);
  assert.equal(ageOn('2000-07-02', asOf), 25);
  assert.equal(ageOn('1999-12-31 00:00:00', asOf), 26);

  // Ten valuable forwards must not crowd keepers and defenders out of the first 15.
  const record = (name: string, positionCode: number, value: number): RecoveryPlayerRecord => ({ nameCn: '', nameEn: name, num: 0, clubId: 1, positionCode, price: 0, initAge: 25, normalValue: 0, auctionValue: 0, growType: null, payload: '', provenance: EXTERNAL_PROVENANCE, externalId: `tm:${name}`, marketValueEur: value });
  const squad = [
    ...Array.from({ length: 10 }, (_, index) => record(`fw${index}`, 1, 90_000_000 - index)),
    ...Array.from({ length: 8 }, (_, index) => record(`mf${index}`, 8, 40_000_000 - index)),
    ...Array.from({ length: 8 }, (_, index) => record(`df${index}`, 12, 30_000_000 - index)),
    ...Array.from({ length: 3 }, (_, index) => record(`gk${index}`, 13, 5_000_000 - index))
  ];
  const ordered = orderSquad(squad, 30);
  const count = (size: number) => ordered.slice(0, size).reduce<Record<string, number>>((acc, item) => ({ ...acc, [recoveryPositionGroup(item.positionCode)]: (acc[recoveryPositionGroup(item.positionCode)] ?? 0) + 1 }), {});
  assert.deepEqual(count(11), { GK: 1, DF: 4, MF: 4, FW: 2 });
  assert.deepEqual(count(15), { GK: 2, DF: 5, MF: 5, FW: 3 });
  assert.deepEqual(count(18), { GK: 2, DF: 6, MF: 6, FW: 4 });
  assert.equal(ordered[0].nameEn, 'gk0', 'the most valuable keeper starts');
  assert.equal(ordered.find((item) => item.positionCode === 1)!.nameEn, 'fw0');
  assert.equal(ordered.length, 29);
  assert.equal(orderSquad(squad, 20).length, 20);
});

const CLUBS_CSV = [
  'club_id,club_code,name,domestic_competition_id,total_market_value,squad_size,last_season',
  '31,fc-liverpool,Liverpool Football Club,GB1,,28,2025',
  '11,fc-arsenal,Arsenal Football Club,GB1,,26,2025',
  '1003,leicester-city,Leicester City Football Club,GB1,,25,2024'
].join('\n');

function playersCsv(): string {
  const header = 'player_id,name,current_club_id,date_of_birth,position,sub_position,market_value_in_eur,country_of_citizenship,last_season';
  const rows: string[] = [];
  const positions = [['Goalkeeper', 'Goalkeeper'], ['Defender', 'Centre-Back'], ['Defender', 'Left-Back'], ['Midfield', 'Central Midfield'], ['Midfield', 'Defensive Midfield'], ['Attack', 'Centre-Forward'], ['Attack', 'Right Winger']];
  for (let index = 0; index < 20; index += 1) {
    const [position, sub] = positions[index % positions.length];
    rows.push(`${1000 + index},Fixture Red ${index},31,${1990 + (index % 12)}-03-15 00:00:00,${position},${sub},${(index + 1) * 1_000_000}.0,"Korea, South",2025`);
  }
  // Left the club before the current season: dropped.
  rows.push('2000,Fixture Former,31,1995-01-01,Attack,Centre-Forward,5000000,England,2023');
  // No birth date or position: dropped.
  rows.push('2001,Fixture Unknown,31,,Missing,,,England,2025');
  // Arsenal has too few usable players and keeps the APK roster.
  for (let index = 0; index < 5; index += 1) rows.push(`${3000 + index},Fixture Gunner ${index},11,1998-05-05,Midfield,Central Midfield,1000000,England,2025`);
  return [header, ...rows].join('\n');
}

test('buildPlayerOverlay imports current squads only and reports every club', () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  const { overlay, report } = buildPlayerOverlay(RECOVERY_CLUBS, parseCsv(CLUBS_CSV), parseCsv(playersCsv()), { asOf: new Date('2026-07-01T00:00:00.000Z'), minSeason: 2025, minSquad: 16, maxSquad: 30, snapshot: '2026-07-06', now });
  const liverpool = clubId('Liverpool');
  assert.deepEqual(overlay.clubs, [{ clubId: liverpool, clubName: 'Liverpool', sourceClubId: '31', sourceClubName: 'Liverpool Football Club', players: 20 }]);
  assert.equal(overlay.players.length, 20);
  assert.equal(overlay.snapshot, '2026-07-06');
  assert.equal(overlay.license, 'CC0-1.0');
  assert.ok(overlay.players.every((player) => player.clubId === liverpool && player.provenance === EXTERNAL_PROVENANCE && player.externalId?.startsWith('tm:')));
  assert.deepEqual(overlay.players.map((player) => player.num), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.ok(!overlay.players.some((player) => player.nameEn === 'Fixture Former' || player.nameEn === 'Fixture Unknown'));
  const sample = overlay.players.find((player) => player.nameEn === 'Fixture Red 0')!;
  assert.equal(sample.initAge, 36);
  assert.equal(sample.dateOfBirth, '1990-03-15');
  assert.equal(sample.positionCode, 13);
  assert.equal(sample.nationality, 'Korea, South');
  assert.equal(sample.marketValueEur, 1_000_000);

  const status = new Map(report.map((item) => [item.clubName, item]));
  assert.equal(status.get('Liverpool')!.status, 'imported');
  assert.equal(status.get('Arsenal')!.status, 'small-squad');
  assert.equal(status.get('Arsenal')!.players, 5);
  assert.equal(status.get('Leicester City')!.status, 'stale', 'relegated before the snapshot season');
  assert.equal(status.get('Leicester City')!.sourceLastSeason, 2024);
  assert.equal(report.length, RECOVERY_CLUBS.length);
});

test('applyPlayerOverlay swaps covered rosters and leaves every other club alone', () => {
  const base: RecoveryPlayerRecord[] = [1, 2, 3].flatMap((club) => [0, 1].map((index) => ({ nameCn: '', nameEn: `apk-${club}-${index}`, num: index, clubId: club, positionCode: 8, price: 37, initAge: 25, normalValue: 1, auctionValue: 1, growType: null, payload: '', provenance: 'RECOVERY_VERIFIED_FIXED_FIELDS' })));
  const imported = (club: number, name: string, positionCode = 8): RecoveryPlayerRecord => ({ ...base[0], nameEn: name, clubId: club, positionCode, provenance: EXTERNAL_PROVENANCE, externalId: `tm:${name}` });
  const overlay: PlayerOverlay = {
    source: 'fixture', license: 'CC0-1.0', snapshot: 'fixture', asOf: '2026-07-01', generatedAt: '2026-10-18T00:00:00.000Z',
    clubs: [{ clubId: 1, clubName: 'one', sourceClubId: 'a', sourceClubName: 'A', players: 1 }, { clubId: 2, clubName: 'two', sourceClubId: 'b', sourceClubName: 'B', players: 1 }, { clubId: 99, clubName: 'unknown', sourceClubId: 'z', sourceClubName: 'Z', players: 1 }],
    players: [imported(1, 'real-1'), imported(2, 'broken', 0), imported(99, 'ghost')]
  };
  const applied = applyPlayerOverlay(base, overlay, new Set([1, 2, 3]));
  assert.deepEqual([...applied.clubIds], [1]);
  assert.equal(applied.imported, 1);
  assert.deepEqual(applied.players.filter((player) => player.clubId === 1).map((player) => player.nameEn), ['real-1']);
  assert.deepEqual(applied.players.filter((player) => player.clubId === 2).map((player) => player.nameEn), ['apk-2-0', 'apk-2-1'], 'a club without a valid imported row keeps the APK roster');
  assert.equal(applied.players.filter((player) => player.clubId === 3).length, 2);
  assert.ok(!applied.players.some((player) => player.clubId === 99));
  assert.equal(applyPlayerOverlay(base, undefined, new Set([1, 2, 3])).players, base);
});

test('market value only orders players inside the club strength band', () => {
  const strength = 80;
  const star = clubPlayerOverallFromValue(strength, 160_000_000, 20_000_000);
  const regular = clubPlayerOverallFromValue(strength, 20_000_000, 20_000_000);
  const fringe = clubPlayerOverallFromValue(strength, 2_000_000, 20_000_000);
  const unknown = clubPlayerOverallFromValue(strength, null, 20_000_000);
  assert.equal(regular, strength);
  assert.ok(star > regular && regular > fringe);
  assert.equal(star, strength + 6);
  assert.equal(fringe, strength - 6);
  assert.ok(unknown < regular && unknown >= strength - 6);
  assert.equal(clubPlayerOverallFromValue(92, 500_000_000, 1), 94, 'never above the global cap');
  assert.equal(clubPlayerOverallFromValue(strength, 5_000_000, 0), strength, 'a club without values keeps its strength');
});
