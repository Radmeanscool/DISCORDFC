import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PlayerOverlay } from '../src/config/player-overlay.js';
import { RECOVERY_CLUBS } from '../src/config/recovery-data.js';
import { buildPlayerOverlay, parseCsv, type ClubImportResult, type ClubOverrides } from '../src/config/transfermarkt-import.js';

/**
 * Builds data/external/player-overlay.json from the CC0 transfermarkt-datasets dump.
 * Put players.csv(.gz) and clubs.csv(.gz) in the source folder first (see
 * data/external/README.md), then run: `pnpm data:import-players --snapshot 2026-07-06`.
 *
 * Options: --source <dir> --out <file> --report <file> --overrides <file>
 *          --as-of YYYY-MM-DD --snapshot <label> --min-season 2025 --min-squad 16 --max-squad 30 --dry-run
 */
function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

function readTable(dir: string, name: string): Record<string, string>[] {
  const gz = resolve(dir, `${name}.csv.gz`);
  const plain = resolve(dir, `${name}.csv`);
  if (existsSync(gz)) return parseCsv(gunzipSync(readFileSync(gz)).toString('utf8'));
  if (existsSync(plain)) return parseCsv(readFileSync(plain, 'utf8'));
  throw new Error(`${name}.csv(.gz) tidak ditemukan di ${dir}. Lihat data/external/README.md untuk cara mengunduh dataset.`);
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} harus bilangan bulat >= 0.`);
  return value;
}

/** One player per line keeps the committed overlay reviewable in diffs. */
function serialize(overlay: PlayerOverlay): string {
  const { clubs, players, ...meta } = overlay;
  const lines = (items: unknown[]) => items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  const header = Object.entries(meta).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n');
  return `{\n${header}\n  "clubs": [\n${lines(clubs)}\n  ],\n  "players": [\n${lines(players)}\n  ]\n}\n`;
}

function describe(result: ClubImportResult): string {
  const source = result.sourceClubName ? ` ← ${result.sourceClubName} (#${result.sourceClubId}${result.sourceLastSeason !== undefined ? `, season ${result.sourceLastSeason}` : ''})` : '';
  return `  [${result.league}] ${result.clubName}${source}${result.players !== undefined ? ` · ${result.players} pemain` : ''}`;
}

function main(): void {
  const sourceDir = resolve(option('source', 'data/external/transfermarkt'));
  const outFile = resolve(option('out', 'data/external/player-overlay.json'));
  const reportFile = resolve(option('report', 'data/external/player-import-report.json'));
  const overridesFile = resolve(option('overrides', 'data/external/club-map.json'));
  const asOf = new Date(`${option('as-of', '2026-07-01')}T00:00:00.000Z`);
  if (Number.isNaN(asOf.getTime())) throw new Error('--as-of harus berformat YYYY-MM-DD.');
  const overrides = existsSync(overridesFile) ? JSON.parse(readFileSync(overridesFile, 'utf8')) as ClubOverrides : {};

  const { overlay, report } = buildPlayerOverlay(RECOVERY_CLUBS, readTable(sourceDir, 'clubs'), readTable(sourceDir, 'players'), {
    asOf,
    minSeason: positiveInteger('min-season', 2025),
    minSquad: positiveInteger('min-squad', 16),
    maxSquad: positiveInteger('max-squad', 30),
    snapshot: option('snapshot', 'unspecified'),
    now: new Date(),
    overrides
  });

  const groups = new Map<string, ClubImportResult[]>();
  for (const result of report) groups.set(result.status, [...(groups.get(result.status) ?? []), result]);
  console.log(`Overlay: ${overlay.clubs.length} klub · ${overlay.players.length} pemain (snapshot ${overlay.snapshot}, usia per ${overlay.asOf}).`);
  // League ids ending in 1 are first divisions and the continental pools; the dataset only
  // scrapes first divisions, so lower tiers are summarised instead of listed.
  const expectedCoverage = (result: ClubImportResult) => result.league % 10 === 1;
  for (const status of ['imported', 'small-squad', 'stale', 'no-candidate', 'excluded', 'no-competition']) {
    const items = groups.get(status) ?? [];
    if (!items.length) continue;
    const shown = status === 'stale' || status === 'no-candidate' ? items.filter(expectedCoverage) : items;
    console.log(`\n${status} (${items.length})`);
    for (const item of shown) console.log(describe(item));
    if (shown.length < items.length) console.log(`  … ${items.length - shown.length} klub divisi 2–3 (di luar cakupan dataset; roster APK dipertahankan)`);
  }

  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, `${JSON.stringify({ generatedAt: overlay.generatedAt, snapshot: overlay.snapshot, clubs: report }, null, 2)}\n`);
  if (process.argv.includes('--dry-run')) console.log('\n--dry-run: overlay tidak ditulis.');
  else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, serialize(overlay));
    console.log(`\nOverlay ditulis ke ${outFile}; laporan di ${reportFile}.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
