import { enqueueNotification } from './notification-engine.js';
import { getVersusStandings, versusLeagueCode, versusTotalRounds } from './versus-engine.js';
import type { PlayerProfile, VersusBattle, VersusMarketListing, VersusSeason } from './types.js';

/** Notification producers for Versus. Ids are idempotency keys: re-running a tick never duplicates a DM. */

function clubName(season: VersusSeason, clubId: string): string {
  return season.clubs.find((club) => club.id === clubId)?.name ?? clubId;
}

function nextBattleLine(season: VersusSeason, clubId: string): string {
  if (season.state !== 'ACTIVE') return 'Season selesai.';
  const next = season.battles.find((battle) => battle.roundId === season.currentRound && (battle.homeClubId === clubId || battle.awayClubId === clubId));
  if (!next) return 'Tidak ada battle berikutnya.';
  const opponent = next.homeClubId === clubId ? next.awayClubId : next.homeClubId;
  return `Next battle: Round ${next.roundId} vs ${clubName(season, opponent)} · deadline <t:${Math.floor(new Date(season.roundDeadline).getTime() / 1000)}:f>`;
}

export function notifyBattleResult(profile: PlayerProfile, season: VersusSeason, battle: VersusBattle, now: Date): boolean {
  const clubId = profile.versus?.clubId;
  const settlement = battle.settlement;
  if (!clubId || !settlement || (battle.homeClubId !== clubId && battle.awayClubId !== clubId)) return false;
  const isHome = battle.homeClubId === clubId;
  const reward = isHome ? settlement.homeReward : settlement.awayReward;
  const standing = getVersusStandings(season).find((item) => item.clubId === clubId);
  return enqueueNotification(profile, {
    id: `versus-result:${battle.id}:${profile.userId}`,
    type: 'VERSUS_RESULT',
    title: `[Versus] Battle selesai · Round ${battle.roundId}`,
    lines: [
      `Liga ${versusLeagueCode(season.grade)} · ${season.groupCode}`,
      `${clubName(season, battle.homeClubId)} ${settlement.homeGoals}–${settlement.awayGoals} ${clubName(season, battle.awayClubId)}`,
      standing ? `Posisi klasemen: #${standing.rank} · ${standing.points} pts` : '',
      `Reward: ${reward.money} money + ${reward.coin} coin`,
      nextBattleLine(season, clubId)
    ].filter(Boolean)
  }, now);
}

export function notifySeasonEnd(profile: PlayerProfile, season: VersusSeason, now: Date): boolean {
  const clubId = profile.versus?.clubId;
  const reward = season.rewards.find((item) => item.clubId === clubId);
  if (!clubId || !reward) return false;
  const movement = reward.legacyReset ? 'Season ini masih memakai skala liga lama; club memulai sistem liga S–E dari Liga E pada season berikutnya.' : reward.promoted ? `Promosi: Liga ${reward.fromLeague} → Liga ${reward.promotedToLeague} (berlaku season berikutnya).` : reward.relegated ? `Degradasi: Liga ${reward.fromLeague} → Liga ${reward.relegatedToLeague} (berlaku season berikutnya).` : `Tetap di Liga ${reward.fromLeague ?? versusLeagueCode(season.grade)}.`;
  return enqueueNotification(profile, {
    id: `versus-season:${season.id}:${profile.userId}`,
    type: 'VERSUS_SEASON_END',
    title: reward.rank === 1 ? '[Versus] Selamat, juara season!' : '[Versus] Season selesai',
    lines: [`Klub Anda finis di posisi #${reward.rank}.`, movement, `Reward season: ${reward.money} money + ${reward.coin} coin.`, 'Buka Versus dan pilih Season Berikutnya untuk lanjut.']
  }, now);
}

export function notifyDeadline(profile: PlayerProfile, season: VersusSeason, battle: VersusBattle, now: Date): boolean {
  const clubId = profile.versus?.clubId;
  if (!clubId) return false;
  const opponent = battle.homeClubId === clubId ? battle.awayClubId : battle.homeClubId;
  return enqueueNotification(profile, {
    id: `versus-deadline:${battle.id}:${profile.userId}`,
    type: 'VERSUS_DEADLINE',
    title: '[Versus] Deadline lineup segera berakhir',
    lines: [`Round ${battle.roundId}/${versusTotalRounds(season)} vs ${clubName(season, opponent)}.`, `Deadline <t:${Math.floor(new Date(season.roundDeadline).getTime() / 1000)}:R>. Tanpa submission, sistem memakai lineup otomatis.`]
  }, now);
}

export function notifyOutbid(profile: PlayerProfile, listing: VersusMarketListing, amount: number, now: Date): boolean {
  return enqueueNotification(profile, {
    id: `versus-outbid:${listing.id}:${profile.userId}:${amount}`,
    type: 'VERSUS_OUTBID',
    title: '[Versus] Bid Anda dikalahkan',
    lines: [`${listing.player.name} (${listing.player.position}) sekarang ${amount} coin.`, `Reservation coin Anda sudah dilepas. Lelang berakhir <t:${Math.floor(new Date(listing.endsAt).getTime() / 1000)}:R>.`]
  }, now);
}

export function notifyAuctionResult(profile: PlayerProfile, listing: VersusMarketListing, now: Date): boolean {
  const won = listing.status === 'SETTLED';
  return enqueueNotification(profile, {
    id: `versus-auction:${listing.id}:${profile.userId}`,
    type: won ? 'VERSUS_AUCTION_WON' : 'VERSUS_AUCTION_LOST',
    title: won ? '[Versus] Lelang dimenangkan' : '[Versus] Lelang dibatalkan',
    lines: won ? [`${listing.player.name} (${listing.player.position}) bergabung dengan klub Anda seharga ${listing.currentBid} coin.`] : [`Lelang ${listing.player.name} ditutup tanpa transfer; reservation coin dilepas.`]
  }, now);
}

export function notifyAssigned(profile: PlayerProfile, season: VersusSeason, now: Date): boolean {
  const clubId = profile.versus?.clubId;
  if (!clubId) return false;
  return enqueueNotification(profile, {
    id: `versus-assigned:${season.id}:${profile.userId}`,
    type: 'VERSUS_ASSIGNED',
    title: '[Versus] Klub masuk liga',
    lines: [`${clubName(season, clubId)} terdaftar di Liga ${versusLeagueCode(season.grade)} · ${season.groupCode}.`, nextBattleLine(season, clubId)]
  }, now);
}
