import type { PlayerOverlay, PlayerOverlayClub } from './player-overlay.js';
import { recoveryPositionGroup, type RecoveryClubRecord, type RecoveryPlayerRecord } from './recovery-data.js';
import { abilityValue } from '../domain/league-engine.js';

/**
 * Import logic for the CC0 transfermarkt-datasets dump
 * (https://github.com/dcaribou/transfermarkt-datasets). Pure functions only: the
 * CLI in tools/import-player-data.ts reads the CSV files and writes the overlay.
 */
export const TRANSFERMARKT_SOURCE = 'transfermarkt-datasets (https://github.com/dcaribou/transfermarkt-datasets)';
export const TRANSFERMARKT_LICENSE = 'CC0-1.0';
export const EXTERNAL_PROVENANCE = 'EXTERNAL_TRANSFERMARKT_CC0';

/** Parses RFC 4180 CSV (quoted fields, doubled quotes, CRLF, embedded newlines) into header-keyed rows. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = false;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell.length > 0));
  if (!header) return [];
  const keys = header.map((key) => key.replace(/^﻿/, '').trim());
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ''])));
}

export interface TransfermarktClub {
  clubId: string;
  code: string;
  name: string;
  competitionId: string;
  lastSeason?: number;
}

export interface TransfermarktPlayer {
  playerId: string;
  name: string;
  clubId: string;
  position: string;
  subPosition: string;
  dateOfBirth?: string;
  marketValueEur: number | null;
  nationality: string;
  lastSeason?: number;
}

function integer(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function idOf(value: string | undefined): string {
  return String(integer(value) ?? (value ?? '').trim());
}

export function readTransfermarktClubs(rows: Record<string, string>[]): TransfermarktClub[] {
  return rows.filter((row) => row.club_id && row.name).map((row) => ({
    clubId: idOf(row.club_id),
    code: (row.club_code ?? '').trim(),
    name: row.name.trim(),
    competitionId: (row.domestic_competition_id ?? '').trim(),
    lastSeason: integer(row.last_season)
  }));
}

export function readTransfermarktPlayers(rows: Record<string, string>[]): TransfermarktPlayer[] {
  return rows.filter((row) => row.player_id && row.name && integer(row.current_club_id) !== undefined).map((row) => {
    const value = Number.parseFloat(row.market_value_in_eur ?? '');
    return {
      playerId: idOf(row.player_id),
      name: row.name.trim(),
      clubId: idOf(row.current_club_id),
      position: row.position ?? '',
      subPosition: row.sub_position ?? '',
      dateOfBirth: /^\d{4}-\d{2}-\d{2}/.exec(row.date_of_birth ?? '')?.[0],
      marketValueEur: Number.isFinite(value) && value > 0 ? Math.round(value) : null,
      nationality: (row.country_of_citizenship ?? '').trim(),
      lastSeason: integer(row.last_season)
    };
  });
}

// Legal forms and generic club words in the languages Transfermarkt uses for names and URL slugs.
const STOPWORDS = new Set([
  'fc', 'cf', 'afc', 'cfc', 'acf', 'sc', 'ac', 'as', 'ss', 'ssc', 'us', 'bc', 'sv', 'fsv', 'vfl', 'vfb', 'tsg', 'rc', 'ogc', 'sco', 'losc', 'aj', 'ud', 'cd', 'rcd', 'ca', 'sl', 'cp',
  'sk', 'fk', 'pfk', 'nk', 'bk', 'ff', 'kv', 'krc', 'rsc', 'sad', 'spa', 'sa', 'ag', 'ev', 'gmbh', 'kgaa', 'nv',
  'club', 'clube', 'football', 'futbol', 'futebol', 'fussball', 'fussballclub', 'fotbal', 'calcio', 'association', 'associazione',
  'societa', 'sportiva', 'sport', 'sportverein', 'verein', 'unione', 'deportivo', 'deportiu', 'koninklijke', 'voetbalvereniging', 'royal', 'royale',
  'de', 'del', 'la', 'le', 'les', 'el', 'do', 'da', 'di', 'du', 'des', 'von', 'und', 'and', 'the', 'of'
]);

// Exonyms in German slugs or English names folded onto one spelling.
const SYNONYMS: Record<string, string> = {
  mailand: 'milan', milano: 'milan', internazionale: 'inter', neapel: 'napoli', rom: 'roma', turin: 'torino', florenz: 'firenze', genua: 'genoa',
  nizza: 'nice', strassburg: 'strasbourg', lyonnais: 'lyon', munich: 'munchen', cologne: 'koln',
  lissabon: 'lisboa', lisbon: 'lisboa', moskau: 'moscow', moskva: 'moscow', zska: 'cska', vienna: 'wien',
  belgrad: 'beograd', belgrade: 'beograd', prag: 'praha', prague: 'praha', warschau: 'warszawa', warsaw: 'warszawa',
  bukarest: 'bucuresti', bucharest: 'bucuresti', athen: 'athens', bruges: 'brugge',
  st: 'saint', sankt: 'saint', peterburg: 'petersburg', rb: 'rasenballsport'
};

/** Distinctive name tokens: diacritics folded, legal forms and numbers dropped, exonyms unified. */
export function nameTokens(name: string): string[] {
  const folded = name.toLowerCase()
    .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ı/g, 'i')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const tokens = folded.split(/[^a-z0-9]+/).map((token) => SYNONYMS[token] ?? token)
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
  return [...new Set(tokens)];
}

/** Other names Transfermarkt may use for a recovered club, keyed by club id. */
const CLUB_ALIASES: Record<number, string[]> = {
  102105: ['Real Betis'],
  103112: ['Verona'],
  106103: ['Sporting CP'],
  107101: ['Zenit'],
  108101: ['Ajax'],
  108102: ['PSV'],
  108103: ['Feyenoord'],
  110003: ['LASK'],
  110004: ['Crvena Zvezda', 'Red Star Belgrade', 'Roter Stern Belgrad'],
  110005: ['FCSB', 'Steaua'],
  110014: ['Grasshopper']
};

// Transfermarkt competition ids for each recovered league pool.
const DOMESTIC_COMPETITION: Record<number, string> = { 101: 'GB1', 102: 'ES1', 103: 'IT1', 104: 'L1', 105: 'FR1' };
const POOL_COMPETITION: Record<number, string> = { 1061: 'PO1', 1071: 'RU1', 1081: 'NL1', 1091: 'BE1' };
// Real clubs of the 9001 pool. CSKA Sofia and Lokomotiv Plovdiv play in a league the
// dataset does not cover, and the remaining six 9001 clubs are fictional.
const CONTINENTAL_CLUB_COMPETITION: Record<number, string> = {
  110001: 'A1', 110002: 'A1', 110003: 'A1', 110004: 'SER1', 110005: 'RO1', 110006: 'SC1', 110007: 'GR1',
  110008: 'SE1', 110009: 'PL1', 110010: 'TS1', 110012: 'C1', 110014: 'C1'
};

/** The Transfermarkt league a recovered club is looked up in. */
export function expectedCompetition(club: RecoveryClubRecord): string | undefined {
  return CONTINENTAL_CLUB_COMPETITION[club.id] ?? POOL_COMPETITION[club.league] ?? DOMESTIC_COMPETITION[club.country];
}

// Every token of our name must appear; each extra token on their side costs a little,
// so "Paris" prefers Paris FC over Paris Saint-Germain.
function similarity(ours: string[], theirs: string[]): number {
  if (!ours.length || !theirs.length) return 0;
  const available = new Set(theirs);
  if (!ours.every((token) => available.has(token))) return 0;
  return 1 - 0.02 * (theirs.length - ours.length);
}

export type ClubMatchReason = 'matched' | 'override' | 'excluded' | 'stale' | 'no-competition' | 'no-candidate';

export interface ClubMatch {
  club: RecoveryClubRecord;
  source?: TransfermarktClub;
  score: number;
  reason: ClubMatchReason;
}

/** Manual corrections: recovered club id → Transfermarkt club id, or null to keep the APK roster. */
export type ClubOverrides = Record<string, string | number | null>;

/**
 * One-to-one club matching inside each expected competition, best scores first.
 * A Transfermarkt club whose last season is older than minSeason matches as `stale`
 * (relegated or no longer scraped) and is not imported.
 */
export function matchClubs(ours: RecoveryClubRecord[], theirs: TransfermarktClub[], minSeason: number, overrides: ClubOverrides = {}): ClubMatch[] {
  const byId = new Map(theirs.map((club) => [club.clubId, club]));
  const isStale = (club: TransfermarktClub) => club.lastSeason !== undefined && club.lastSeason < minSeason;
  const results = new Map<number, ClubMatch>();
  const taken = new Set<string>();
  for (const club of ours) {
    const key = String(club.id);
    if (!(key in overrides)) continue;
    const target = overrides[key];
    const source = target === null ? undefined : byId.get(String(target));
    if (target === null) results.set(club.id, { club, score: 0, reason: 'excluded' });
    else if (!source) results.set(club.id, { club, score: 0, reason: 'no-candidate' });
    else {
      results.set(club.id, { club, source, score: 1, reason: isStale(source) ? 'stale' : 'override' });
      taken.add(source.clubId);
    }
  }
  const sourceTokens = new Map(theirs.map((club) => [club.clubId, [nameTokens(club.name), nameTokens(club.code.replace(/-/g, ' '))]]));
  const pairs: { club: RecoveryClubRecord; source: TransfermarktClub; score: number }[] = [];
  for (const club of ours) {
    if (results.has(club.id)) continue;
    const competition = expectedCompetition(club);
    if (!competition) { results.set(club.id, { club, score: 0, reason: 'no-competition' }); continue; }
    const variants = [club.nameEn, ...(CLUB_ALIASES[club.id] ?? [])].map(nameTokens);
    for (const source of theirs) {
      if (source.competitionId !== competition || taken.has(source.clubId)) continue;
      const score = Math.max(...variants.flatMap((mine) => sourceTokens.get(source.clubId)!.map((tokens) => similarity(mine, tokens))));
      if (score > 0) pairs.push({ club, source, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.club.id - b.club.id || a.source.clubId.localeCompare(b.source.clubId));
  for (const pair of pairs) {
    if (results.has(pair.club.id) || taken.has(pair.source.clubId)) continue;
    results.set(pair.club.id, { club: pair.club, source: pair.source, score: pair.score, reason: isStale(pair.source) ? 'stale' : 'matched' });
    taken.add(pair.source.clubId);
  }
  return ours.map((club) => results.get(club.id) ?? { club, score: 0, reason: 'no-candidate' });
}

// Codes follow recoveryPositionGroup: 1–4 FW, 5–9 MF, 10–12 DF, 13 GK.
const SUB_POSITION_CODES: Record<string, number> = {
  centreforward: 1, secondstriker: 2, leftwinger: 3, rightwinger: 4,
  attackingmidfield: 5, leftmidfield: 6, rightmidfield: 7, centralmidfield: 8, defensivemidfield: 9,
  leftback: 10, rightback: 11, centreback: 12, goalkeeper: 13
};
const POSITION_CODES: Record<string, number> = { attack: 1, midfield: 8, defender: 12, goalkeeper: 13 };

export function positionCodeFor(position: string, subPosition: string): number | undefined {
  const key = (value: string) => value.toLowerCase().replace(/center/g, 'centre').replace(/[^a-z]/g, '');
  return SUB_POSITION_CODES[key(subPosition)] ?? POSITION_CODES[key(position)];
}

export function ageOn(dateOfBirth: string, asOf: Date): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const beforeBirthday = asOf.getUTCMonth() + 1 < month || (asOf.getUTCMonth() + 1 === month && asOf.getUTCDate() < day);
  return asOf.getUTCFullYear() - year - (beforeBirthday ? 1 : 0);
}

// The first 11 form a 4-4-2, the first 15 cover MINIMUM_ROSTER_DEPTH (club-engine
// takes 15 for the user's club), and the first 18 a matchday squad (opponents take 18).
const SQUAD_TEMPLATE = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'MF', 'GK', 'DF', 'MF', 'FW', 'DF', 'MF', 'FW'] as const;

/** Orders a squad so every prefix the game slices is balanced, strongest (age-adjusted value) first. */
export function orderSquad(records: RecoveryPlayerRecord[], max: number): RecoveryPlayerRecord[] {
  const value = (record: RecoveryPlayerRecord) => abilityValue(record.marketValueEur, record.initAge);
  const remaining = [...records].sort((a, b) => value(b) - value(a) || a.nameEn.localeCompare(b.nameEn));
  const ordered: RecoveryPlayerRecord[] = [];
  for (const group of SQUAD_TEMPLATE) {
    const index = remaining.findIndex((record) => recoveryPositionGroup(record.positionCode) === group);
    if (index >= 0) ordered.push(...remaining.splice(index, 1));
  }
  return [...ordered, ...remaining].slice(0, max);
}

function toRecord(player: TransfermarktPlayer, clubId: number, asOf: Date): RecoveryPlayerRecord | undefined {
  const positionCode = positionCodeFor(player.position, player.subPosition);
  const age = player.dateOfBirth ? ageOn(player.dateOfBirth, asOf) : undefined;
  if (positionCode === undefined || age === undefined || age < 15 || age > 45) return undefined;
  return {
    nameCn: '',
    nameEn: player.name,
    num: 0,
    clubId,
    positionCode,
    price: 0,
    initAge: age,
    normalValue: 0,
    auctionValue: 0,
    growType: null,
    payload: '',
    provenance: EXTERNAL_PROVENANCE,
    externalId: `tm:${player.playerId}`,
    marketValueEur: player.marketValueEur,
    dateOfBirth: player.dateOfBirth,
    ...(player.nationality ? { nationality: player.nationality } : {})
  };
}

export interface PlayerImportOptions {
  /** Date the imported ages are computed at. */
  asOf: Date;
  /** Oldest Transfermarkt season (start year) whose squads count as current. */
  minSeason: number;
  /** Clubs with fewer usable players keep their APK roster. */
  minSquad: number;
  maxSquad: number;
  snapshot: string;
  now: Date;
  overrides?: ClubOverrides;
}

export interface ClubImportResult {
  clubId: number;
  clubName: string;
  league: number;
  status: 'imported' | 'small-squad' | Exclude<ClubMatchReason, 'matched' | 'override'>;
  sourceClubId?: string;
  sourceClubName?: string;
  sourceLastSeason?: number;
  score?: number;
  players?: number;
}

export function buildPlayerOverlay(ours: RecoveryClubRecord[], clubRows: Record<string, string>[], playerRows: Record<string, string>[], options: PlayerImportOptions): { overlay: PlayerOverlay; report: ClubImportResult[] } {
  const squads = new Map<string, TransfermarktPlayer[]>();
  for (const player of readTransfermarktPlayers(playerRows)) {
    if (player.lastSeason !== undefined && player.lastSeason < options.minSeason) continue;
    const squad = squads.get(player.clubId) ?? [];
    squad.push(player);
    squads.set(player.clubId, squad);
  }
  const clubs: PlayerOverlayClub[] = [];
  const players: RecoveryPlayerRecord[] = [];
  const report: ClubImportResult[] = [];
  for (const match of matchClubs(ours, readTransfermarktClubs(clubRows), options.minSeason, options.overrides)) {
    const base = { clubId: match.club.id, clubName: match.club.nameEn, league: match.club.league };
    const source = match.source ? { sourceClubId: match.source.clubId, sourceClubName: match.source.name, sourceLastSeason: match.source.lastSeason, score: Number(match.score.toFixed(2)) } : {};
    if (!match.source || (match.reason !== 'matched' && match.reason !== 'override')) {
      report.push({ ...base, ...source, status: match.reason as ClubImportResult['status'] });
      continue;
    }
    const records = (squads.get(match.source.clubId) ?? []).map((player) => toRecord(player, match.club.id, options.asOf)).filter((record): record is RecoveryPlayerRecord => record !== undefined);
    if (records.length < options.minSquad) {
      report.push({ ...base, ...source, status: 'small-squad', players: records.length });
      continue;
    }
    const squad = orderSquad(records, options.maxSquad).map((record, index) => ({ ...record, num: index + 1 }));
    players.push(...squad);
    clubs.push({ clubId: match.club.id, clubName: match.club.nameEn, sourceClubId: match.source.clubId, sourceClubName: match.source.name, players: squad.length });
    report.push({ ...base, ...source, status: 'imported', players: squad.length });
  }
  const overlay: PlayerOverlay = {
    source: TRANSFERMARKT_SOURCE,
    license: TRANSFERMARKT_LICENSE,
    snapshot: options.snapshot,
    asOf: options.asOf.toISOString().slice(0, 10),
    generatedAt: options.now.toISOString(),
    clubs,
    players
  };
  return { overlay, report };
}
