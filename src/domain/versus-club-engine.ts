import { GAME_BALANCE } from '../config/game-balance.js';
import { SeededRandom } from './engine.js';
import { stableHash } from './league-engine.js';
import { createVersusPlayer, minimumFieldable, versusLeagueCode, versusPlayerValue, versusTierBase } from './versus-engine.js';
import type { PlayerProfile, Position, VersusClub, VersusPlayer, VersusSeason, VersusSponsorTier } from './types.js';

/**
 * Club actions outside lineups. While enrolled, the season's club entry is the
 * canonical copy (it is synced to every member), so mutations are applied to the
 * season and mirrored on the profile. Sponsor and Scout rules are RECOVERY_INFERRED.
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ClubMutation<T> {
  profile: PlayerProfile;
  season?: VersusSeason;
  result: T;
}

function mutateVersusClub<T>(profileInput: PlayerProfile, seasonInput: VersusSeason | undefined, mutate: (club: VersusClub, season?: VersusSeason) => T): ClubMutation<T> {
  const profile = clone(profileInput);
  if (!profile.versus) throw new Error('Versus club belum dibuat.');
  const season = seasonInput && profile.versus.groupCode === seasonInput.groupCode ? clone(seasonInput) : undefined;
  const seasonClub = season?.clubs.find((club) => club.id === profile.versus!.clubId);
  const target = seasonClub ?? profile.versus.club;
  const result = mutate(target, season);
  profile.versus.club = clone(target);
  profile.versus.versusMoney = target.versusMoney;
  profile.versus.versusCoin = target.versusCoin;
  return { profile, season, result };
}

function lineupLocked(season: VersusSeason | undefined, clubId: string, playerId: string): boolean {
  if (!season || season.state !== 'ACTIVE') return false;
  return season.battles.some((battle) => battle.roundId === season.currentRound && battle.state === 'OPEN' && [battle.homeSubmission, battle.awaySubmission].some((submission) => submission?.clubId === clubId && [...submission.lineup, ...submission.substitutes].includes(playerId)));
}

export function releasableVersusPlayers(club: VersusClub, season?: VersusSeason): VersusPlayer[] {
  const minimum = minimumFieldable();
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const player of club.roster) counts[player.position] += 1;
  if (club.roster.length <= 16) return [];
  return club.roster.filter((player) => counts[player.position] > minimum[player.position] && !lineupLocked(season, club.id, player.id));
}

export function releaseVersusPlayer(profileInput: PlayerProfile, seasonInput: VersusSeason | undefined, playerId: string): ClubMutation<{ player: VersusPlayer; refund: number }> {
  return mutateVersusClub(profileInput, seasonInput, (club, season) => {
    if (!releasableVersusPlayers(club, season).some((player) => player.id === playerId)) throw new Error('Pemain tidak dapat dilepas: posisi di batas minimum, roster ≤ 16, atau pemain ada di lineup yang sudah disubmit.');
    const index = club.roster.findIndex((player) => player.id === playerId);
    const [player] = club.roster.splice(index, 1);
    const refund = Math.round(versusPlayerValue(player) / 10);
    club.versusMoney += refund;
    club.rosterVersion += 1;
    return { player, refund };
  });
}

export function signVersusSponsor(profileInput: PlayerProfile, seasonInput: VersusSeason | undefined, tier: VersusSponsorTier, now = new Date()): ClubMutation<{ tier: VersusSponsorTier }> {
  if (!seasonInput || seasonInput.state !== 'ACTIVE') throw new Error('Sponsor hanya dapat ditandatangani selama season Versus aktif.');
  return mutateVersusClub(profileInput, seasonInput, (club, season) => {
    if (!season) throw new Error('Club tidak terdaftar pada season ini.');
    const terms = GAME_BALANCE.versus.sponsor[tier];
    if (club.grade > terms.minimumGrade) throw new Error(`${tier} Sponsor membutuhkan Liga ${versusLeagueCode(terms.minimumGrade)} atau lebih tinggi.`);
    if (club.sponsor?.seasonId === season.id) throw new Error(`Club sudah terikat ${club.sponsor.tier} Sponsor untuk season ini.`);
    club.sponsor = { tier, seasonId: season.id, signedAt: now.toISOString() };
    return { tier };
  });
}

export type VersusScoutTier = 'JUNIOR' | 'SENIOR';

export function scoutVersusPlayer(profileInput: PlayerProfile, seasonInput: VersusSeason | undefined, tier: VersusScoutTier, now = new Date()): ClubMutation<{ player: VersusPlayer; cost: number }> {
  const key = seasonInput ? `${seasonInput.id}:${seasonInput.currentRound}` : `idle:${now.toISOString().slice(0, 10)}`;
  if (profileInput.versus?.lastScoutKey === key) throw new Error('Scout sudah dikirim untuk round ini. Coba lagi setelah round berikutnya diproses.');
  const mutation = mutateVersusClub(profileInput, seasonInput, (club) => {
    const terms = GAME_BALANCE.versus.scout[tier];
    if (club.roster.length >= GAME_BALANCE.versus.rosterLimit) throw new Error(`Roster Versus sudah penuh (${GAME_BALANCE.versus.rosterLimit}).`);
    if (club.versusMoney < terms.cost) throw new Error(`Versus money tidak cukup: butuh ${terms.cost}.`);
    const rng = new SeededRandom(stableHash(`${club.id}:${key}:${tier}`));
    const positions: Position[] = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW'];
    const position = positions[Math.floor(rng.next() * positions.length)];
    const bonus = terms.abilityBonusMin + Math.floor(rng.next() * (terms.abilityBonusMax - terms.abilityBonusMin + 1));
    const base = clamp(versusTierBase(club.grade) + bonus, 35, 92);
    const index = club.roster.length;
    const player = createVersusPlayer(`${club.id}:scout-${stableHash(key) % 100_000}-${index}`, `Prospect ${String.fromCharCode(65 + (index % 26))}${index}`, index, club.id, base, position, 17 + Math.floor(rng.next() * 4));
    player.captain = false;
    club.versusMoney -= terms.cost;
    club.roster.push(player);
    club.rosterVersion += 1;
    return { player, cost: terms.cost };
  });
  mutation.profile.versus!.lastScoutKey = key;
  return mutation;
}
