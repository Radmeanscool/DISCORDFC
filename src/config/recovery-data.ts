import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPlayerOverlay, readPlayerOverlay } from './player-overlay.js';

export interface RecoveryClubRecord {
  id: number;
  nameCn: string;
  nameEn: string;
  nameKr: string;
  iconId: number;
  league: number;
  country: number;
  type: number;
  captain: number;
  coach: number;
  salaryBase: number;
  coachSalaryBase: number;
  prestige: number;
  grade: number;
  formations: number[];
  tacticsId: number;
  provenance: string;
}

export interface RecoveryPlayerRecord {
  nameCn: string;
  nameEn: string;
  num: number;
  clubId: number;
  positionCode: number;
  price: number;
  initAge: number;
  normalValue: number;
  auctionValue: number;
  growType: number | null;
  payload: string;
  provenance: string;
  /** Rows imported from an external roster source (data/external) carry a source id and real data. */
  externalId?: string;
  marketValueEur?: number | null;
  dateOfBirth?: string;
  nationality?: string;
}

/** Position group of a cfg_player position code: 1–4 FW, 5–9 MF, 10–12 DF, 13 GK. */
export function recoveryPositionGroup(code: number): 'GK' | 'DF' | 'MF' | 'FW' {
  if (code === 13) return 'GK';
  if (code >= 10 && code <= 12) return 'DF';
  if (code >= 5 && code <= 9) return 'MF';
  return 'FW';
}

function readJson<T>(fileName: string, fallback: T): T {
  const root = process.env.RECOVERY_DATA_DIR ?? resolve(process.cwd(), 'data/recovery');
  const path = resolve(root, fileName);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'recovery_data_load_failed', path, error: error instanceof Error ? error.message : String(error) }));
    return fallback;
  }
}

const clubData = readJson<{ clubs: RecoveryClubRecord[] }>('club_202603.json', { clubs: [] });
const playerData = readJson<{ players: RecoveryPlayerRecord[] }>('player_202603_fixed_fields.json', { players: [] });

export const RECOVERY_CLUBS = clubData.clubs;
export const RECOVERY_CLUB_BY_ID = new Map(RECOVERY_CLUBS.map((club) => [club.id, club]));
const playerOverlay = readPlayerOverlay();
const appliedOverlay = applyPlayerOverlay(playerData.players, playerOverlay, new Set(RECOVERY_CLUB_BY_ID.keys()));
export const RECOVERY_PLAYERS = appliedOverlay.players;
/** The external roster overlay in use, if any (see data/external/README.md). */
export const PLAYER_OVERLAY_SUMMARY = playerOverlay && appliedOverlay.clubIds.size
  ? { source: playerOverlay.source, snapshot: playerOverlay.snapshot, clubs: appliedOverlay.clubIds.size, players: appliedOverlay.imported }
  : undefined;
export const RECOVERY_PLAYERS_BY_CLUB = new Map<number, RecoveryPlayerRecord[]>();
for (const player of RECOVERY_PLAYERS) {
  const list = RECOVERY_PLAYERS_BY_CLUB.get(player.clubId) ?? [];
  list.push(player);
  RECOVERY_PLAYERS_BY_CLUB.set(player.clubId, list);
}
