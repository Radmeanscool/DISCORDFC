import { GAME_BALANCE } from '../config/game-balance.js';
import { formatMoney } from './format.js';
import { officialClubByName } from './league-engine.js';
import { calculatePlayerRating } from './player-formulas.js';
import type { ContractState, PlayerProfile } from './types.js';

/**
 * Player contracts run on game time: a term is counted in seasons and the
 * salary is paid on every Weekly Update. Salary scale is RECOVERY_INFERRED from
 * the club's recovered salaryBase. Contracts without `seasonsRemaining` are legacy
 * real-time contracts and keep their old endTime-based expiry.
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function weeklySalaryFor(profile: PlayerProfile, clubName = profile.club): number {
  const salaryBase = officialClubByName(clubName, profile.clubState?.leagueId)?.salaryBase ?? 5_000;
  const rating = calculatePlayerRating(profile);
  return Math.max(25, Math.round((salaryBase / GAME_BALANCE.contract.salaryDivisor) * clamp((rating - 40) / 40, 0.3, 2)));
}

function isGameTimeContract(contract: ContractState): boolean {
  return contract.seasonsRemaining !== undefined;
}

export function getContractStatus(profileInput: PlayerProfile, now = new Date()): ContractState | undefined {
  const profile = clone(profileInput);
  const contract = profile.contract;
  if (!contract) return undefined;
  if (contract.state !== 'ACTIVE') return contract;
  if (isGameTimeContract(contract)) {
    if ((contract.seasonsRemaining ?? 0) <= 0) contract.state = 'EXPIRED';
  } else if (new Date(contract.endTime).getTime() <= now.getTime()) {
    contract.state = 'EXPIRED';
  }
  return contract;
}

export function signContract(profileInput: PlayerProfile, now = new Date(), termSeasons: number = GAME_BALANCE.contract.defaultSeasons, type?: ContractState['type']): PlayerProfile {
  const profile = clone(profileInput);
  const seasons = Math.max(1, Math.floor(termSeasons));
  const previous = profile.contract;
  profile.contract = {
    id: `contract-${profile.userId}-${now.getTime()}`,
    clubId: profile.club,
    salary: weeklySalaryFor(profile),
    beginTime: now.toISOString(),
    endTime: new Date(now.getTime() + seasons * 365 * 86_400_000).toISOString(),
    state: 'ACTIVE',
    type: type ?? (previous && previous.clubId === profile.club ? 'RENEWAL' : previous ? 'TRANSFER' : 'INITIAL'),
    startSeason: profile.league.season,
    seasons,
    seasonsRemaining: seasons
  };
  profile.updatedAt = now.toISOString();
  return profile;
}

export function renewContract(profileInput: PlayerProfile, now = new Date(), termSeasons: number = GAME_BALANCE.contract.defaultSeasons): PlayerProfile {
  const current = getContractStatus(profileInput, now);
  if (current?.state === 'ACTIVE' && current.clubId === profileInput.club && (!isGameTimeContract(current) || (current.seasonsRemaining ?? 0) > 1)) {
    throw new Error(isGameTimeContract(current) ? `Kontrak masih berlaku ${current.seasonsRemaining} season. Perpanjangan dibuka pada season terakhir.` : 'Kontrak masih aktif.');
  }
  return signContract(profileInput, now, termSeasons, current && current.clubId === profileInput.club ? 'RENEWAL' : undefined);
}

export function requestSalaryRaise(profileInput: PlayerProfile, now = new Date()): { profile: PlayerProfile; accepted: boolean; message: string } {
  const profile = clone(profileInput);
  const contract = getContractStatus(profile, now);
  if (!contract || contract.state !== 'ACTIVE') throw new Error('Tidak ada kontrak aktif. Perpanjang kontrak terlebih dahulu.');
  if (contract.lastRaiseSeason === profile.league.season) throw new Error('Permintaan kenaikan gaji hanya dapat diajukan sekali per season.');
  const offered = weeklySalaryFor(profile);
  contract.lastRaiseSeason = profile.league.season;
  profile.contract = contract;
  profile.updatedAt = now.toISOString();
  if (offered < Math.round(contract.salary * GAME_BALANCE.contract.raiseThreshold)) {
    return { profile, accepted: false, message: `Klub menolak. Performa saat ini setara gaji ${formatMoney(offered)}/minggu (gaji sekarang ${formatMoney(contract.salary)}).` };
  }
  const previous = contract.salary;
  contract.salary = offered;
  return { profile, accepted: true, message: `Klub menyetujui kenaikan gaji: ${formatMoney(previous)} → ${formatMoney(offered)} per minggu.` };
}

/** Called once per completed season; expires the contract when the term runs out. */
export function advanceContractSeason(profile: PlayerProfile): string | undefined {
  const contract = profile.contract;
  if (!contract || contract.state !== 'ACTIVE' || !isGameTimeContract(contract)) return undefined;
  contract.seasonsRemaining = Math.max(0, (contract.seasonsRemaining ?? 0) - 1);
  if (contract.seasonsRemaining > 0) return `Kontrak tersisa ${contract.seasonsRemaining} season.`;
  contract.state = 'EXPIRED';
  return 'Kontrak berakhir. Perpanjang kontrak dari panel Contract agar gaji mingguan kembali dibayar.';
}

export function payWeeklySalary(profile: PlayerProfile, now: Date): string | undefined {
  const contract = profile.contract;
  if (!contract || contract.state !== 'ACTIVE' || contract.clubId !== profile.club) return undefined;
  if (!isGameTimeContract(contract) && new Date(contract.endTime).getTime() <= now.getTime()) {
    contract.state = 'EXPIRED';
    return 'Kontrak lama berakhir; gaji tidak dibayar sampai kontrak diperpanjang.';
  }
  profile.money += contract.salary;
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-SALARY-${profile.careerWeek ?? 0}-${now.getTime()}`, createdAt: now.toISOString(), type: 'SALARY', amount: contract.salary, balanceAfter: profile.money, note: `Gaji mingguan ${contract.clubId}` });
  profile.ledger = profile.ledger.slice(0, 100);
  return `Gaji mingguan ${formatMoney(contract.salary)} diterima dari ${contract.clubId}.`;
}

export function formatContract(contract: ContractState | undefined, now = new Date()): string {
  if (!contract) return 'Belum ada kontrak.';
  if (isGameTimeContract(contract)) {
    return `Club **${contract.clubId}**\nGaji **${formatMoney(contract.salary)}/minggu**\nStatus **${contract.state}**\nSisa **${contract.seasonsRemaining ?? 0} season** dari ${contract.seasons ?? '-'}`;
  }
  const remainingDays = Math.max(0, Math.ceil((new Date(contract.endTime).getTime() - now.getTime()) / 86_400_000));
  return `Club **${contract.clubId}**\nSalary **${formatMoney(contract.salary)}**\nStatus **${contract.state}**\nSisa **${remainingDays} hari** (kontrak lama)`;
}
