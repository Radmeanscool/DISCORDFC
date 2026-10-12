import { ensureClubState } from './club-engine.js';
import { RECOVERY_CLUBS } from '../config/recovery-data.js';
import type { PlayerProfile } from './types.js';

export function listOfficialClubs(league?: number): typeof RECOVERY_CLUBS {
  return RECOVERY_CLUBS.filter((club) => league === undefined || club.league === league);
}

export function officialClubTransferFee(officialClubId: number): number {
  const club = RECOVERY_CLUBS.find((item) => item.id === officialClubId);
  if (!club) throw new Error('Official club ID tidak ditemukan pada client data.');
  return Math.max(250, Math.round(club.salaryBase / 100));
}

export function joinOfficialClub(profileInput: PlayerProfile, officialClubId: number, now = new Date()): PlayerProfile {
  const profile = structuredClone(profileInput);
  const club = RECOVERY_CLUBS.find((item) => item.id === officialClubId);
  if (!club) throw new Error('Official club ID tidak ditemukan pada client data.');
  const transferFee = officialClubTransferFee(officialClubId);
  if (profile.clubState && profile.clubState.officialId === club.id) throw new Error('Pemain sudah berada di klub tersebut.');
  if (profile.money < transferFee) throw new Error(`Money tidak cukup. Biaya perpindahan: ${transferFee}.`);
  profile.money -= transferFee;
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-TRANSFER_FEE-${now.getTime()}-${profile.ledger.length}`, createdAt: now.toISOString(), type: 'TRANSFER_FEE', amount: -transferFee, balanceAfter: profile.money, note: `Pindah ke ${club.nameEn}` });
  profile.ledger = profile.ledger.slice(0, 100);
  profile.club = club.nameEn;
  profile.contract = undefined;
  profile.clubState = undefined;
  const updated = ensureClubState(profile, now);
  updated.updatedAt = now.toISOString();
  return updated;
}
