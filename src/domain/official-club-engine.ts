import { GAME_BALANCE } from '../config/game-balance.js';
import { RECOVERY_CLUBS, type RecoveryClubRecord } from '../config/recovery-data.js';
import { ensureClubState, isClubSeasonComplete, playClubMatch, userClubPlayerId } from './club-engine.js';
import { signContract, weeklySalaryFor } from './contract-engine.js';
import { MathRandomSource, type RandomSource } from './engine.js';
import { clubStrengthByName, isDomesticLeague, officialClubStrength } from './league-engine.js';
import { calculatePlayerRating } from './player-formulas.js';
import type { PlayerProfile, PlayerTransferOffer } from './types.js';
import { playedMatchdays, transferWindowFor } from './season-calendar.js';

export function listOfficialClubs(league?: number): typeof RECOVERY_CLUBS {
  return RECOVERY_CLUBS.filter((club) => league === undefined || club.league === league);
}

export function officialClubTransferFee(officialClubId: number): number {
  const club = RECOVERY_CLUBS.find((item) => item.id === officialClubId);
  if (!club) throw new Error('Official club ID tidak ditemukan pada client data.');
  return Math.max(250, Math.round(club.salaryBase / 100));
}

/** Clubs only sign athletes within reach of their squad level (RECOVERY_INFERRED margin). */
export function officialClubMinimumRating(officialClubId: number): number {
  const club = RECOVERY_CLUBS.find((item) => item.id === officialClubId);
  if (!club) throw new Error('Official club ID tidak ditemukan pada client data.');
  return Math.max(30, officialClubStrength(club) - GAME_BALANCE.transfer.ratingMargin);
}

/** Transfers happen in pre-season (no fixture played yet) or during the season break. */
/** Season break, pre-season, the summer window, and the January window (season-calendar). */
export function transferWindowOpen(profile: PlayerProfile): boolean {
  const club = profile.clubState;
  if (!club) return true;
  if (profile.weekStage === 'SEASON_BREAK') return true;
  if (isClubSeasonComplete(club)) return true;
  return transferWindowFor(club) !== undefined;
}

export function listEligibleClubs(profile: PlayerProfile, limit = 25): RecoveryClubRecord[] {
  const rating = calculatePlayerRating(profile);
  return RECOVERY_CLUBS
    .filter((club) => isDomesticLeague(club.league) && club.id !== profile.clubState?.officialId && club.nameEn !== profile.club)
    .filter((club) => officialClubMinimumRating(club.id) <= rating)
    .sort((a, b) => officialClubStrength(b) - officialClubStrength(a) || a.id - b.id)
    .slice(0, limit);
}

function moveToClub(profileInput: PlayerProfile, club: RecoveryClubRecord, now: Date, salary?: number, seasons?: number, rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = structuredClone(profileInput);
  // A mid-season move joins the new league at the same round (the original's September
  // move to Sandhausen continues at matchday 6), so earlier rounds are simulated without the athlete.
  const midSeason = profileInput.clubState && profileInput.weekStage !== 'SEASON_BREAK' && !isClubSeasonComplete(profileInput.clubState) ? playedMatchdays(profileInput.clubState) : 0;
  profile.club = club.nameEn;
  profile.clubState = undefined;
  profile.league = { ...profile.league, matchday: 1, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  profile.championsLeague = undefined;
  let updated = ensureClubState(profile, now, rng);
  for (let round = 0; round < midSeason && !isClubSeasonComplete(updated.clubState); round += 1) {
    updated = playClubMatch(updated, now, rng, 'clubState', { excludePlayerIds: [userClubPlayerId(updated)] }).profile;
  }
  updated = signContract(updated, now, seasons ?? GAME_BALANCE.contract.defaultSeasons, 'TRANSFER');
  if (salary !== undefined && updated.contract) updated.contract.salary = salary;
  updated.seasonWeek = 1;
  updated.updatedAt = now.toISOString();
  return updated;
}

function assertTransferAllowed(profile: PlayerProfile, club: RecoveryClubRecord): void {
  if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun.');
  if ((profile.clubState && profile.clubState.officialId === club.id) || profile.club === club.nameEn) throw new Error('Pemain sudah berada di klub tersebut.');
  if (!isDomesticLeague(club.league)) throw new Error('Klub ini hanya tampil di kompetisi Eropa dan tidak membuka kontrak liga domestik.');
  if (!transferWindowOpen(profile)) throw new Error('Transfer window tutup. Pindah klub hanya di awal musim (Agustus), Januari, atau saat season break.');
  if (['EVENT_PENDING', 'EXP_PENDING'].includes(profile.weekStage ?? 'READY')) throw new Error('Selesaikan event atau alokasi EXP terlebih dahulu.');
}

export function joinOfficialClub(profileInput: PlayerProfile, officialClubId: number, now = new Date()): PlayerProfile {
  const club = RECOVERY_CLUBS.find((item) => item.id === officialClubId);
  if (!club) throw new Error('Official club ID tidak ditemukan pada client data.');
  assertTransferAllowed(profileInput, club);
  const minimum = officialClubMinimumRating(club.id);
  const rating = calculatePlayerRating(profileInput);
  if (rating < minimum) throw new Error(`${club.nameEn} membutuhkan rating minimal ${minimum}. Rating Anda ${rating}.`);
  const transferFee = officialClubTransferFee(officialClubId);
  if (profileInput.money < transferFee) throw new Error(`Money tidak cukup. Biaya perpindahan: ${transferFee}.`);
  const profile = structuredClone(profileInput);
  profile.money -= transferFee;
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-TRANSFER_FEE-${now.getTime()}-${profile.ledger.length}`, createdAt: now.toISOString(), type: 'TRANSFER_FEE', amount: -transferFee, balanceAfter: profile.money, note: `Pindah ke ${club.nameEn}` });
  profile.ledger = profile.ledger.slice(0, 100);
  profile.transferOffers = (profile.transferOffers ?? []).map((offer) => offer.status === 'OPEN' ? { ...offer, status: 'EXPIRED' as const } : offer);
  return moveToClub(profile, club, now);
}

/** Season-end interest from clubs at or above the current level, based on rating and form. */
export function generateTransferOffers(profileInput: PlayerProfile, rng: RandomSource, averageRating: number, appearanceShare: number, window = 'END'): PlayerTransferOffer[] {
  const rating = calculatePlayerRating(profileInput);
  const currentStrength = clubStrengthByName(profileInput.club, profileInput.clubState?.leagueId);
  const inForm = averageRating >= 6.6 && appearanceShare >= 0.4;
  if (!inForm && rating < currentStrength + 2) return [];
  const pool = listEligibleClubs(profileInput, 60).filter((club) => officialClubStrength(club) >= currentStrength - 2).slice(0, 10);
  const offers: PlayerTransferOffer[] = [];
  const picks = [...pool];
  while (picks.length && offers.length < GAME_BALANCE.transfer.offersPerSeason) {
    const [club] = picks.splice(Math.floor(rng.next() * picks.length), 1);
    offers.push({
      id: `offer-${profileInput.league.season}-${window.toLowerCase()}-${club.id}`,
      clubId: club.id,
      clubName: club.nameEn,
      leagueId: club.league,
      weeklySalary: Math.round(weeklySalaryFor(profileInput, club.nameEn) * 1.1),
      seasons: 2 + Math.floor(rng.next() * 2),
      season: profileInput.league.season,
      status: 'OPEN'
    });
  }
  return offers;
}

export function acceptTransferOffer(profileInput: PlayerProfile, offerId: string, now = new Date(), rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const offer = profileInput.transferOffers?.find((item) => item.id === offerId && item.status === 'OPEN');
  if (!offer) throw new Error('Tawaran transfer tidak ditemukan atau sudah ditutup.');
  const club = RECOVERY_CLUBS.find((item) => item.id === offer.clubId);
  if (!club) throw new Error('Klub tawaran tidak ditemukan pada client data.');
  assertTransferAllowed(profileInput, club);
  const profile = structuredClone(profileInput);
  profile.transferOffers = (profile.transferOffers ?? []).map((item) => item.id === offerId ? { ...item, status: 'ACCEPTED' as const } : item.status === 'OPEN' ? { ...item, status: 'EXPIRED' as const } : item);
  return moveToClub(profile, club, now, offer.weeklySalary, offer.seasons, rng);
}

export function declineTransferOffer(profileInput: PlayerProfile, offerId: string, now = new Date()): PlayerProfile {
  const profile = structuredClone(profileInput);
  const offer = profile.transferOffers?.find((item) => item.id === offerId && item.status === 'OPEN');
  if (!offer) throw new Error('Tawaran transfer tidak ditemukan atau sudah ditutup.');
  offer.status = 'DECLINED';
  profile.updatedAt = now.toISOString();
  return profile;
}
