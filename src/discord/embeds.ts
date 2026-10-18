import { EmbedBuilder, type ColorResolvable } from 'discord.js';
import { getRating } from '../domain/engine.js';
import { formatClubStanding, getClubRating, isClubSeasonComplete } from '../domain/club-engine.js';
import { coachReputation, type CoachSeasonSummary } from '../domain/coach-career-engine.js';
import { formatContract, getContractStatus } from '../domain/contract-engine.js';
import { formatMoney } from '../domain/format.js';
import { canRetire, formatDetailedSkills, formatGameplayStatus, VOLUNTARY_RETIREMENT_AGE } from '../domain/gameplay-engine.js';
import { leagueLabel, resolveClubLeagueId } from '../domain/league-engine.js';
import { transferWindowOpen } from '../domain/official-club-engine.js';
import { dmEnabled } from '../domain/notification-engine.js';
import { abilityScore, formatVersusBattle, getVersusStandings, versusLeagueCode, versusTotalRounds } from '../domain/versus-engine.js';
import { availableVersusCoin, listingAbilityScore, minimumVersusBid } from '../domain/versus-economy.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import {
  ABILITY_LABELS,
  COACH_ABILITIES,
  COACH_ABILITY_LABELS,
  HONOR_CATEGORY_LABELS,
  POSITION_LABELS,
  TACTICS,
  type AbilityId,
  type CoachRoundResult,
  type PlayerProfile,
  type VersusBattle,
  type VersusClub,
  type VersusPlayer,
  type VersusSeason,
  type WeekPreparationResult,
  type WeekResult
} from '../domain/types.js';

export const BRAND_COLOR: ColorResolvable = '#1f8b4c';
const WARNING_COLOR: ColorResolvable = '#c27c0e';

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 2))}\n…`;
}

function embed(title: string, description?: string): EmbedBuilder {
  const item = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(clip(title, 256));
  if (description) item.setDescription(clip(description, 4_000));
  return item;
}

function field(name: string, value: string, inline = false): { name: string; value: string; inline: boolean } {
  return { name: clip(name, 256), value: clip(value || '-', 1_024), inline };
}

function discordTime(iso: string | undefined, style: 'f' | 'R' = 'f'): string {
  const time = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(time) ? `<t:${Math.floor(time / 1_000)}:${style}>` : '-';
}

// ------------------------------------------------------------------- Game home

export function gameHomeEmbed(profile?: PlayerProfile): EmbedBuilder {
  if (!profile) {
    return embed('Football Rising Star · Game Home', 'Pilih mode untuk mulai. Player, Coach, dan Versus memiliki state terpisah; semua aksi berikutnya lewat tombol dan menu.')
      .addFields(
        field('Player Mode', 'Karier atlet: weekly update, training, pertandingan liga, EXP, kontrak, transfer, honors, rebirth.'),
        field('Coach Mode', 'Manajemen klub: board target, ability coach, formation/tactic, transfer market, job offer, season settlement.'),
        field('Versus Mode', 'Liga online S→E: lineup sebelum deadline, battle otomatis, market lelang, sponsor, scout, promosi. Notifikasi via DM.')
      );
  }
  return embed(`${profile.displayName} · Game Home`, 'Pilih mode yang ingin dimainkan. Mode tidak berbagi progression.')
    .addFields(
      field('Player Mode', profile.careerStatus === 'RETIRED' ? 'Pensiun · siap Rebirth' : `${profile.club} · rating ${getRating(profile)} · usia ${profile.age}`, true),
      field('Coach Mode', profile.coach ? `${profile.coach.coachName} · ${profile.coach.status} · approval ${profile.coach.approval}/100` : 'Belum dimulai', true),
      field('Versus Mode', profile.versus ? `${profile.versus.club.name} · Liga ${versusLeagueCode(profile.versus.club.grade)} · ${profile.versus.status}` : 'Belum ditugaskan', true)
    )
    .setFooter({ text: 'Command /play hanya pintu masuk; navigasi lewat tombol.' });
}

// ----------------------------------------------------------------- Player Mode

function seasonLine(profile: PlayerProfile): string {
  const stats = profile.seasonStats;
  if (!stats) return 'Belum ada statistik season.';
  const average = stats.appearances ? (stats.ratingSum / stats.appearances).toFixed(2) : '-';
  return `Apps **${stats.appearances}** · Gol **${stats.goals}** · Assist **${stats.assists}** · Avg rating **${average}** · MVP **${stats.mvps}**${profile.position === 'GK' || profile.position === 'DF' ? ` · Clean sheet **${stats.cleanSheets}**` : ''}`;
}

export function profileEmbed(profile: PlayerProfile): EmbedBuilder {
  const abilities = (Object.keys(profile.stats) as AbilityId[]).map((id) => `${ABILITY_LABELS[id]} **${profile.stats[id]}**`).join(' · ');
  const club = profile.clubState;
  const nextFixture = club?.fixtures.find((fixture) => !fixture.played);
  const leagueId = club ? resolveClubLeagueId(club) : undefined;
  const fixtureText = nextFixture ? `MD ${nextFixture.matchday} · ${nextFixture.homeClub} vs ${nextFixture.awayClub}` : club ? 'Season selesai' : '-';
  return embed(`${profile.displayName} — Football Rising Star`, `**${POSITION_LABELS[profile.position]}** · ${profile.club} · Rating **${getRating(profile)}**${profile.careerStatus === 'RETIRED' ? '\n**Karier sudah pensiun.** Buka Rebirth untuk generasi berikutnya.' : ''}`)
    .addFields(
      field('Condition', `HP **${profile.hp}/${profile.maxHp}**\nEnergy **${profile.energy}/${profile.maxEnergy}**\nMoney **${formatMoney(profile.money)}**`, true),
      field('Career', `Usia **${profile.age}** · Tahun **${profile.careerYear ?? 1}**\nRebirth **${profile.rebirthCount ?? 0}**\nPending EXP **${profile.unassignedMatchExp ?? 0}**`, true),
      field('Club', club ? `${leagueLabel(leagueId)}\nClub rating **${getClubRating(profile)}**\nNext: ${fixtureText}` : 'Klub dibuat saat weekly update pertama.', true),
      field(`Season ${profile.league.season}`, `${seasonLine(profile)}\nKlub: **${profile.league.points} pts** · ${profile.league.wins}-${profile.league.draws}-${profile.league.losses}`),
      field('Macro abilities (dari detailed skill)', abilities),
      field('Detailed skills', profile.detailedSkills ? formatDetailedSkills(profile) : 'Akan dimigrasikan pada aksi berikutnya.'),
      field('Gameplay state', profile.detailedSkills ? formatGameplayStatus(profile) : '-'),
      field('Career totals', `Apps **${profile.career.appearances}** · W-D-L **${profile.career.wins}-${profile.career.draws}-${profile.career.losses}**\nGoals **${profile.career.goals}** · Assists **${profile.career.assists}** · Clean sheets **${profile.career.cleanSheets}** · MVP **${profile.career.mvps ?? 0}**`)
    )
    .setFooter({ text: 'Formula pertandingan & progres: RECOVERY_INFERRED, dikalibrasi lewat simulasi karier.' });
}

const STAGE_LABEL: Record<NonNullable<PlayerProfile['weekStage']>, string> = {
  READY: 'Siap memulai minggu berikutnya',
  MATCH_READY: 'Weekly update selesai · pertandingan siap',
  EXP_PENDING: 'EXP pertandingan menunggu alokasi',
  EVENT_PENDING: 'Event mingguan menunggu keputusan',
  SEASON_BREAK: 'Season break · transfer window terbuka'
};

export function playerWeeklyEmbed(profile: PlayerProfile): EmbedBuilder {
  const stage = profile.weekStage ?? 'READY';
  const nextAction = profile.careerStatus === 'RETIRED'
    ? 'Karier pensiun. Tekan **Rebirth** untuk memulai generasi baru.'
    : stage === 'READY' || stage === 'SEASON_BREAK' ? 'Tekan **Next Week** untuk recovery, gaji, trainer, dan event mingguan.'
      : stage === 'MATCH_READY' ? 'Tekan **Play Match** untuk memainkan fixture liga klub Anda.'
        : stage === 'EVENT_PENDING' ? 'Tekan **Weekly Event Decision** sebelum pertandingan.'
          : 'Tekan **Assign EXP** untuk mengalokasikan EXP pertandingan.';
  return profileEmbed(profile)
    .setTitle(`${profile.displayName} · Player Weekly Hub`)
    .setDescription(`Week **${profile.careerWeek ?? 1}** · Matchday **${profile.league.matchday}** · ${STAGE_LABEL[stage]}\n${nextAction}`);
}

export function weeklyUpdateEmbed(result: WeekPreparationResult): EmbedBuilder {
  return embed(`Weekly Update · Week ${result.week}`, result.narrative.join('\n'))
    .addFields(
      field('Stage', STAGE_LABEL[result.stage], true),
      field('Condition', `HP ${result.profile.hp}/${result.profile.maxHp}\nEnergy ${result.profile.energy}/${result.profile.maxEnergy}`, true),
      field('Next step', result.stage === 'EVENT_PENDING' ? 'Tekan Weekly Event Decision.' : 'Tekan Play Match.', true)
    );
}

export function matchResultEmbed(result: WeekResult): EmbedBuilder {
  const match = result.match;
  const personal = match?.personal;
  const outcome = match?.outcome === 'WIN' ? 'VICTORY' : match?.outcome === 'DRAW' ? 'DRAW' : match?.outcome === 'LOSS' ? 'DEFEAT' : 'NO MATCH';
  const score = match ? `**${match.teamName ?? result.profile.club} ${match.playerGoals}–${match.opponentGoals} ${match.opponent}**${match.home === false ? ' (away)' : ''}` : 'Tidak ada pertandingan.';
  const personalText = personal
    ? personal.played
      ? `Rating **${personal.rating.toFixed(1)}** · Gol **${personal.goals}** · Assist **${personal.assists}**${personal.mvp ? ' · **MVP**' : ''}${personal.cleanSheet ? ' · clean sheet' : ''}${personal.yellowCard ? ' · 🟨' : ''}${personal.redCard ? ' · 🟥' : ''}`
      : `Tidak bermain (${personal.absence ?? 'bench'}).`
    : '-';
  const stats = match?.stats;
  const item = embed(`${outcome} · Week ${result.week} · MD ${match?.matchday ?? '-'}`, `${score}\n\n${result.narrative.join('\n')}`)
    .addFields(
      field('Performa Anda', personalText, true),
      field('Statistik tim', stats ? `Possession ${stats.possession}%–${stats.opponentPossession}%\nShots ${stats.shots}–${stats.opponentShots} · SOT ${stats.shotsOnTarget}–${stats.opponentShotsOnTarget}\nCorners ${stats.corners}–${stats.opponentCorners}` : '-', true),
      field('Reward', match ? `${formatMoney(match.rewards.money)} money · ${match.rewards.exp} EXP\nPending EXP **${result.expAwaitingAssignment}**` : '-', true)
    );
  if (result.award) item.addFields(field('World Footballer', `Pemenang: **${result.award.winner}** · skor Anda ${result.award.userScore}${result.award.userWon ? ' · **ANDA MENANG!**' : ''}`));
  if (result.retired) item.setColor(WARNING_COLOR);
  return item;
}

export function playerCareerEmbed(profile: PlayerProfile): EmbedBuilder {
  const seasons = (profile.seasonHistory ?? []).slice(-6).reverse().map((season) => `S${season.season} · ${season.club} · ${season.leagueLabel} #${season.rank} · ${season.stats.appearances} apps, ${season.stats.goals} G, ${season.stats.assists} A · avg ${season.averageRating.toFixed(2)}${season.movement !== 'STAYED' ? ` · ${season.movement}` : ''}${season.honors.length ? ` · ${season.honors.join(', ')}` : ''}`).join('\n');
  const generations = (profile.careerHistory ?? []).slice(-5).reverse().map((entry) => `Gen ${entry.generation} · ${entry.position} · pensiun usia ${entry.age} di ${entry.finalClub} · ${entry.seasons} season · ${entry.goals} G / ${entry.assists} A · ${entry.honors} honor`).join('\n');
  const retireNote = profile.careerStatus === 'RETIRED'
    ? 'Karier sudah pensiun. Pilih posisi untuk **Rebirth** (usia 15, bonus skill, money & honors dipertahankan).'
    : canRetire(profile) ? 'Retirement sukarela tersedia.' : `Retirement sukarela terbuka mulai usia ${VOLUNTARY_RETIREMENT_AGE}.`;
  return embed(`${profile.displayName} · Career`, retireNote)
    .addFields(field('Season history', seasons || 'Belum ada season selesai.'), field('Generasi sebelumnya', generations || 'Belum ada.'));
}

export function honorsEmbed(profile: PlayerProfile): EmbedBuilder {
  const categories = (['PERSONAL', 'TEAM', 'NATIONAL'] as const).map((category) => {
    const honors = (profile.honors ?? []).filter((honor) => honor.category === category).slice(-8);
    return field(HONOR_CATEGORY_LABELS[category], honors.length ? honors.map((honor) => `${honor.title} · season ${honor.season}`).join('\n') : 'Belum ada honor.');
  });
  const achievements = (profile.achievements ?? []).map((item) => `${item.claimed ? '✅' : item.progress >= item.target ? '🎁' : '🔒'} ${item.title} — ${Math.min(item.progress, item.target)}/${item.target}`).join('\n');
  const award = profile.worldFootballer;
  return embed('Hall of Honor', award ? `World Footballer season ${award.season}: **${award.winner}**${award.userWon ? ' (Anda!)' : ` · skor Anda ${award.userScore}`}` : 'World Footballer diumumkan di akhir setiap season.')
    .addFields(...categories, field('Achievements', achievements || 'Belum ada achievement.'));
}

export function contractEmbed(profile: PlayerProfile): EmbedBuilder {
  const contract = getContractStatus(profile);
  const renewable = contract?.seasonsRemaining !== undefined ? contract.state !== 'ACTIVE' || (contract.seasonsRemaining ?? 0) <= 1 || contract.clubId !== profile.club : contract?.state !== 'ACTIVE';
  return embed('Player Contract', formatContract(contract))
    .addFields(field('Aturan', `Gaji dibayar setiap Weekly Update selama kontrak ACTIVE. Perpanjangan dibuka pada season terakhir kontrak (${renewable ? 'tersedia sekarang' : 'belum tersedia'}). Kenaikan gaji dapat diminta sekali per season dan dinilai dari rating saat ini.`));
}

export function playerClubEmbed(profile: PlayerProfile): EmbedBuilder {
  const club = profile.clubState;
  if (!club) return embed(`${profile.club} · Club`, 'Klub dibuat saat weekly update pertama.');
  const leagueId = resolveClubLeagueId(club);
  const played = club.fixtures.filter((fixture) => fixture.played).length;
  const next = club.fixtures.find((fixture) => !fixture.played);
  const offers = (profile.transferOffers ?? []).filter((offer) => offer.status === 'OPEN');
  return embed(`${club.name} · Club`, `${leagueLabel(leagueId)} · Season ${profile.league.season} · matchday ${played}/${club.fixtures.length}`)
    .addFields(
      field('Club', `Rating **${getClubRating(profile)}** · Prestige **${club.prestige}**\n${club.formation} · ${TACTICS[club.tactic].name} (diatur pelatih AI)`, true),
      field('Next fixture', next ? `MD ${next.matchday}: ${next.homeClub} vs ${next.awayClub}` : 'Season selesai.', true),
      field('Transfer window', transferWindowOpen(profile) ? `Terbuka · ${offers.length} tawaran aktif` : 'Tutup (buka saat pra-musim / season break)', true),
      field('Last season', club.lastSeasonResult ? `Season ${club.lastSeasonResult.season}: #${club.lastSeasonResult.rank} · ${club.lastSeasonResult.points} pts · ${club.lastSeasonResult.movement}${club.lastSeasonResult.championsQualified ? ' · lolos Champions League' : ''}` : '-')
    );
}

export function leagueTableEmbed(profile: PlayerProfile): EmbedBuilder {
  const club = profile.clubState;
  return embed(`${profile.club} · League Table`, formatClubStanding(profile) || 'Klasemen belum tersedia.')
    .addFields(field('Progress', `Matchday ${profile.league.matchday} · ${profile.league.points} pts · ${profile.league.wins}-${profile.league.draws}-${profile.league.losses}\n${club ? leagueLabel(resolveClubLeagueId(club)) : ''}`))
    .setFooter({ text: '3 teratas promosi, 3 terbawah degradasi; 4 teratas kasta 1 lolos Champions League (RECOVERY_INFERRED).' });
}

export function squadEmbed(title: string, roster: Array<{ name: string; position: string; overall: number; age: number; hp: number; maxHp: number; isUserPlayer?: boolean; goals?: number }>): EmbedBuilder {
  const lines = [...roster].sort((a, b) => 'GKDFMFFW'.indexOf(a.position) - 'GKDFMFFW'.indexOf(b.position) || b.overall - a.overall).map((player) => `${player.position} · ${player.name} · OVR ${player.overall} · usia ${player.age} · HP ${player.hp}/${player.maxHp}${player.goals ? ` · ${player.goals} G` : ''}${player.isUserPlayer ? ' · **YOU**' : ''}`);
  return embed(title, lines.join('\n') || 'Roster kosong.');
}

// ------------------------------------------------------------------ Coach Mode

export function coachHomeEmbed(profile: PlayerProfile): EmbedBuilder {
  const coach = profile.coach;
  if (!coach) throw new Error('Karier Coach belum dibuat.');
  const club = profile.coachClubState;
  const nextFixture = club?.fixtures.find((fixture) => !fixture.played);
  const played = club?.fixtures.filter((fixture) => fixture.played).length ?? 0;
  const abilities = COACH_ABILITIES.map((id) => `${COACH_ABILITY_LABELS[id]} Lv ${coach.abilities[id].level}`).join(' · ');
  const status = coach.status === 'RETIRED' ? 'Coach sudah pensiun. Buka Career untuk Rebirth.' : coach.status === 'UNEMPLOYED' ? 'Tanpa klub. Buka **Job Offers** untuk menerima tawaran.' : isClubSeasonComplete(club) ? 'Season selesai. Tekan **Season Settlement**.' : `Kelola **${club?.name ?? profile.club}**.`;
  return embed(`${coach.coachName} · Coach Home`, status)
    .addFields(
      field('Career', `Usia ${coach.age} · Tahun ${coach.careerYear} · Season ${coach.season}\nStatus **${coach.status}** · Approval **${coach.approval}/100**\nReputasi **${coachReputation(coach)}**`, true),
      field('Board target', `${coach.boardTarget.type} · target #${coach.boardTarget.targetRank}\nPosisi sekarang #${coach.boardTarget.progressRank ?? '-'}`, true),
      field('Club', club ? `${club.name}\n${leagueLabel(resolveClubLeagueId(club))}\n${club.formation} · ${TACTICS[club.tactic].name}\nAssets ${formatMoney(club.assets)}` : '-', true),
      field('Fixture', nextFixture ? `MD ${nextFixture.matchday}/${club?.fixtures.length ?? 0}: ${nextFixture.homeClub} vs ${nextFixture.awayClub}` : `${played} pertandingan dimainkan.`),
      field('Abilities', `${abilities}\nPending EXP **${coach.unassignedExp}**`)
    );
}

export function coachRoundEmbed(result: CoachRoundResult): EmbedBuilder {
  const match = result.match;
  const coach = result.profile.coach!;
  const item = embed(`Coach Round · ${match.outcome}`, `**${match.fixture.homeClub} ${match.homeGoals}–${match.awayGoals} ${match.fixture.awayClub}** (HT ${match.halftime.homeGoals}–${match.halftime.awayGoals})\n${match.commentary.join('\n')}`)
    .addFields(
      field('Coach EXP', `+${result.coachExp} · pending ${coach.unassignedExp}`, true),
      field('Approval', `${coach.approval}/100 (${result.approvalDelta >= 0 ? '+' : ''}${result.approvalDelta})`, true),
      field('Board', `${result.boardTarget.type} · #${result.boardTarget.progressRank ?? '-'} / target #${result.boardTarget.targetRank}`, true),
      field('MVP', `${match.mvp.name} · OVR ${match.mvp.overall}`, true)
    );
  if (coach.status === 'UNEMPLOYED') item.setColor(WARNING_COLOR).addFields(field('Dipecat', 'Approval terlalu rendah; board memberhentikan Anda. Buka Job Offers untuk klub baru.'));
  if (result.event) item.addFields(field('Management decision', `${result.event.title} — buka **Decision**.`));
  if (result.seasonComplete) item.addFields(field('Season selesai', 'Tekan **Season Settlement** untuk menutup season.'));
  return item;
}

export function coachSeasonEmbed(profile: PlayerProfile, summary: CoachSeasonSummary): EmbedBuilder {
  const coach = profile.coach!;
  return embed(`Season ${coach.season - 1} selesai · #${summary.rank}`, `${summary.leagueLabel}: finis **#${summary.rank}** dengan **${summary.points} pts** · ${summary.movement === 'PROMOTED' ? `**Promosi** ke ${summary.nextLeagueLabel}` : summary.movement === 'RELEGATED' ? `**Degradasi** ke ${summary.nextLeagueLabel}` : `Tetap di ${summary.nextLeagueLabel}`}`)
    .setColor(summary.dismissed ? WARNING_COLOR : BRAND_COLOR)
    .addFields(
      field('Board target', `${summary.targetType} (#${summary.targetRank}) · ${summary.success ? 'TERCAPAI' : 'GAGAL'} · approval ${summary.approvalDelta >= 0 ? '+' : ''}${summary.approvalDelta} → ${coach.approval}/100`),
      field('Champions League', summary.championsQualified ? 'Lolos untuk season berikutnya.' : 'Tidak lolos.', true),
      field('Status', summary.dismissed ? 'Dipecat board · pilih job offer baru.' : `Lanjut season ${coach.season} · target ${coach.boardTarget.type} #${coach.boardTarget.targetRank}`, true)
    );
}

// ----------------------------------------------------------------- Versus Mode

function opponentName(season: VersusSeason, battle: VersusBattle, clubId: string): string {
  const opponentId = battle.homeClubId === clubId ? battle.awayClubId : battle.homeClubId;
  return season.clubs.find((club) => club.id === opponentId)?.name ?? opponentId;
}

export function currentVersusBattle(season: VersusSeason | undefined, clubId: string): VersusBattle | undefined {
  if (!season || season.state !== 'ACTIVE') return undefined;
  return season.battles.find((battle) => battle.roundId === season.currentRound && (battle.homeClubId === clubId || battle.awayClubId === clubId));
}

export function ownSubmission(battle: VersusBattle | undefined, clubId: string) {
  if (!battle) return undefined;
  return battle.homeClubId === clubId ? battle.homeSubmission : battle.awaySubmission;
}

export function clubStrength(club: VersusClub): number {
  const top = [...club.roster].sort((a, b) => abilityScore(b) - abilityScore(a)).slice(0, 11);
  return Math.round(top.reduce((sum, player) => sum + abilityScore(player), 0) / Math.max(1, top.length));
}

export function versusHomeEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const versus = profile.versus!;
  const club = season?.clubs.find((item) => item.id === versus.clubId) ?? versus.club;
  const battle = currentVersusBattle(season, club.id);
  const submission = ownSubmission(battle, club.id);
  const standing = season ? getVersusStandings(season).find((item) => item.clubId === club.id) : undefined;
  const totalRounds = season ? versusTotalRounds(season) : 0;
  const reservations = (versus.reservations ?? []).reduce((sum, item) => sum + item.amount, 0);
  const opponent = battle && season ? season.clubs.find((item) => item.id === (battle.homeClubId === club.id ? battle.awayClubId : battle.homeClubId)) : undefined;
  return embed(`${club.name} · Versus Home`, `Liga **${versusLeagueCode(club.grade)}** · ${versus.groupCode ?? '-'} · Round **${season ? Math.min(season.currentRound, totalRounds) : '-'}/${totalRounds || '-'}**\nRank 1–2 promosi, 2 terbawah degradasi. Tanpa negara; club Versus terpisah dari Player/Coach.`)
    .addFields(
      field('Next battle', battle && season ? `Round ${battle.roundId} · ${battle.homeClubId === club.id ? 'HOME' : 'AWAY'} vs **${opponentName(season, battle, club.id)}**${opponent ? ` (kekuatan ~${clubStrength(opponent)})` : ''}` : 'Tidak ada battle aktif.', true),
      field('Deadline', season ? `${discordTime(season.roundDeadline)} (${discordTime(season.roundDeadline, 'R')})` : '-', true),
      field('Lineup', submission ? `✅ ${submission.formation} · ${TACTICS[submission.tactic].name}` : '⚠️ Belum submit (sistem memakai lineup otomatis)', true),
      field('Standing', standing ? `#${standing.rank} · ${standing.points} pts · ${standing.wins}-${standing.draws}-${standing.losses} · GD ${standing.goalDifference}` : '-', true),
      field('Wallet', `${formatMoney(club.versusMoney)} money · ${club.versusCoin} coin${reservations ? ` (${reservations} di-reserve)` : ''}`, true),
      field('Club', `Kekuatan ~${clubStrength(club)} · roster ${club.roster.length}/${GAME_BALANCE.versus.rosterLimit}${club.sponsor?.seasonId === season?.id && club.sponsor ? ` · ${club.sponsor.tier} sponsor` : ''}`, true)
    )
    .setFooter({ text: `Notifikasi hasil, deadline, dan lelang dikirim via DM (${dmEnabled(profile) ? 'aktif' : 'nonaktif'}). Ruleset RECOVERY_INFERRED.` });
}

export function versusFinishedEmbed(profile: PlayerProfile, season: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const reward = season.rewards.find((item) => item.clubId === clubId);
  const table = getVersusStandings(season).map((standing) => `${standing.rank}. ${standing.clubId === clubId ? `**${standing.clubName}**` : standing.clubName} · ${standing.points} pts${standing.isNpc ? ' · NPC' : ''}`).join('\n');
  const movement = reward?.legacyReset ? 'Season skala lama: club memulai liga S–E dari **Liga E**' : reward?.promoted ? `**Promosi** ke Liga ${reward.promotedToLeague}` : reward?.relegated ? `**Degradasi** ke Liga ${reward.relegatedToLeague}` : `Tetap di Liga ${reward?.fromLeague ?? versusLeagueCode(season.grade)}`;
  return embed(`Season selesai · Liga ${versusLeagueCode(season.grade)}`, `Finis **#${reward?.rank ?? '-'}** · ${movement}.\nReward: **${reward?.money ?? 0} money + ${reward?.coin ?? 0} coin**.\n\nTekan **Next Season**: grade club dipindahkan dan season baru dibuat di liga tujuan.`)
    .addFields(field('Klasemen akhir', table));
}

export function versusWaitingEmbed(profile: PlayerProfile): EmbedBuilder {
  return embed(`${profile.versus!.club.name} · Menunggu season`, `Terdaftar di private group **${profile.versus!.groupCode}**, tetapi season-nya sudah berjalan. Club otomatis masuk saat season berikutnya dimulai, atau pindah ke public league sekarang.`);
}

export function versusRegistrationEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const versus = profile.versus!;
  return embed(`${versus.club.name} · Registration`, `Status **${versus.status}** · group **${versus.groupCode ?? '-'}**\nPublic league ditentukan otomatis per tier huruf (PUB-<tier>-<tanggal>-<no>). Club manusia mengambil slot NPC sebelum round 1. Private group lewat \`/versus join\`.`)
    .addFields(
      field('Liga', season ? `Liga ${versusLeagueCode(season.grade)}` : '-', true),
      field('Club', season ? `${season.clubs.filter((club) => !club.isNpc).length} manusia · ${season.clubs.filter((club) => club.isNpc).length} NPC` : '-', true),
      field('Season', season ? `${season.state} · ${season.id}` : '-', true)
    );
}

export function versusResultsEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const battles = season?.battles.filter((battle) => battle.settlement && (battle.homeClubId === clubId || battle.awayClubId === clubId)).sort((a, b) => b.roundId - a.roundId).slice(0, 3) ?? [];
  return embed(`${profile.versus!.club.name} · Results`, battles.length ? battles.map((battle) => `**Round ${battle.roundId}** · ${formatVersusBattle(battle, season)}`).join('\n\n') : 'Belum ada hasil battle.');
}

export function versusStandingsEmbed(season: VersusSeason, clubId?: string): EmbedBuilder {
  const lines = getVersusStandings(season).map((standing) => `${standing.rank}. ${standing.clubId === clubId ? `**${standing.clubName}**` : standing.clubName} · ${standing.points} pts · ${standing.wins}-${standing.draws}-${standing.losses} · GD ${standing.goalDifference}${standing.isNpc ? ' · NPC' : ''}`).join('\n');
  return embed(`Liga ${versusLeagueCode(season.grade)} · ${season.groupCode}`, lines).setFooter({ text: `Round ${Math.min(season.currentRound, versusTotalRounds(season))}/${versusTotalRounds(season)} · poin, selisih gol, gol.` });
}

export function versusScheduleEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const battles = season?.battles.filter((battle) => battle.homeClubId === clubId || battle.awayClubId === clubId).sort((a, b) => a.roundId - b.roundId) ?? [];
  const lines = battles.map((battle) => `R${battle.roundId} · ${battle.homeClubId === clubId ? 'HOME' : 'AWAY'} vs ${opponentName(season!, battle, clubId)} · ${battle.settlement ? `${battle.settlement.homeGoals}-${battle.settlement.awayGoals}` : battle.roundId === season!.currentRound ? 'NEXT' : '-'}`).join('\n');
  return embed(`${profile.versus!.club.name} · Schedule`, lines || 'Belum ada jadwal.');
}

export function versusMarketEmbed(profile: PlayerProfile, season: VersusSeason): EmbedBuilder {
  const open = season.market?.listings.filter((listing) => listing.status === 'OPEN') ?? [];
  const lines = open.map((listing) => `**${listing.player.name}** · ${listing.player.position} · skor ${listingAbilityScore(listing)} · usia ${listing.player.age} · ${listing.sourceClubId === 'free-agent' ? 'free agent' : 'NPC'}\nBid ${listing.currentBid ?? '-'} (min ${minimumVersusBid(listing)}) · berakhir ${discordTime(listing.endsAt, 'R')}${listing.currentBidderId === profile.userId ? ' · **Anda tertinggi**' : ''}`).join('\n');
  return embed(`${profile.versus!.club.name} · Market`, lines || 'Tidak ada listing terbuka; siklus baru dibuat otomatis.')
    .addFields(
      field('Coin', `${availableVersusCoin(profile)} tersedia · ${profile.versus!.versusCoin} total`, true),
      field('Aturan', `Bid me-reserve coin; debit saat lelang selesai. Bid di ${GAME_BALANCE.versus.marketAntiSnipeSeconds / 60} menit terakhir memperpanjang lelang. Roster maks ${GAME_BALANCE.versus.rosterLimit}.`, true)
    );
}

export function versusSquadEmbed(club: VersusClub): EmbedBuilder {
  const order: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
  const lines = [...club.roster].sort((a, b) => order[a.position] - order[b.position] || abilityScore(b) - abilityScore(a)).map((player) => {
    const status = player.status === 'INJURED' ? ` · 🤕 s/d ${discordTime(player.injuryEndsAt, 'R')}` : player.status === 'SUSPENDED' || player.redCardBan > 0 ? ' · 🟥 skors' : '';
    return `${player.position} · ${player.name} · ${Math.round(abilityScore(player))} · usia ${player.age} · HP ${player.hp}${status} · ${player.goals}G/${player.assists}A${player.position === 'GK' ? `/${player.cleanSheets ?? 0}CS` : ''}`;
  });
  return embed(`${club.name} · Squad (${club.roster.length}/${GAME_BALANCE.versus.rosterLimit})`, lines.join('\n'));
}

export function versusScoutEmbed(club: VersusClub): EmbedBuilder {
  const junior = GAME_BALANCE.versus.scout.JUNIOR;
  const senior = GAME_BALANCE.versus.scout.SENIOR;
  return embed(`${club.name} · Scout`, `Kirim scout untuk merekrut prospek muda (17–20 tahun) langsung ke roster. Satu pencarian per round.\nJunior: ${junior.cost} money · +${junior.abilityBonusMin}–${junior.abilityBonusMax} dari tier liga\nSenior: ${senior.cost} money · +${senior.abilityBonusMin}–${senior.abilityBonusMax} dari tier liga`)
    .addFields(field('Versus money', formatMoney(club.versusMoney), true), field('Roster', `${club.roster.length}/${GAME_BALANCE.versus.rosterLimit}`, true))
    .setFooter({ text: 'Scout rules RECOVERY_INFERRED.' });
}

export function versusSponsorEmbed(club: VersusClub, season?: VersusSeason): EmbedBuilder {
  const terms = GAME_BALANCE.versus.sponsor;
  const signed = club.sponsor && club.sponsor.seasonId === season?.id ? club.sponsor.tier : undefined;
  const line = (tier: keyof typeof terms, label: string) => `**${label}** (Liga ${versusLeagueCode(terms[tier].minimumGrade)}+): menang +${terms[tier].winMoney} money${terms[tier].winCoin ? ` +${terms[tier].winCoin} coin` : ''}, seri +${terms[tier].drawMoney}`;
  return embed(`${club.name} · Sponsor`, `${signed ? `Kontrak aktif: **${signed} Sponsor** untuk season ini.` : 'Pilih satu sponsor per season. Bonus dibayar per battle.'}\n\n${line('JUNIOR', 'Junior')}\n${line('SENIOR', 'Senior')}\n${line('TOP', 'Top')}`)
    .setFooter({ text: 'Sponsor rules RECOVERY_INFERRED.' });
}

export function versusRewardsEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const reward = season?.rewards.find((item) => item.clubId === clubId);
  const ledger = (profile.versus!.ledger ?? []).filter((entry) => entry.seasonId === season?.id && entry.amount !== 0).slice(0, 8).map((entry) => `${entry.currency} ${entry.amount > 0 ? '+' : ''}${entry.amount} · ${entry.note}`).join('\n');
  const history = profile.versus!.history.slice(-5).reverse().map((item) => `${item.seasonId.split(':').slice(1).join(':')} · #${item.rank} · ${item.points} pts${item.rewards.promoted ? ' · promosi' : item.rewards.relegated ? ' · degradasi' : ''}`).join('\n');
  return embed(`${profile.versus!.club.name} · Rewards`, reward ? `Season: rank **#${reward.rank}** · +${reward.money} money · +${reward.coin} coin` : 'Reward season dibagikan setelah round terakhir.')
    .addFields(field('Ledger season ini', ledger || '-'), field('Riwayat season', history || '-'));
}

type RankingCategory = 'CLUB' | 'MVP' | 'SCORERS' | 'ASSISTS' | 'GOALKEEPERS';

export function versusRankingsEmbed(profile: PlayerProfile, season: VersusSeason | undefined, category: RankingCategory): EmbedBuilder {
  const players = (season?.clubs ?? []).flatMap((club) => club.roster.map((player) => ({ player, club: club.name })));
  const average = (player: VersusPlayer) => (player.ratedMatches ? (player.ratingSum ?? 0) / player.ratedMatches : 0);
  let lines: string[];
  if (category === 'CLUB') {
    lines = season ? getVersusStandings(season).slice(0, 10).map((standing) => `${standing.rank}. ${standing.clubName} · ${standing.points} pts`) : [];
  } else if (category === 'MVP') {
    lines = players.filter(({ player }) => (player.ratedMatches ?? 0) >= 2).sort((a, b) => average(b.player) - average(a.player)).slice(0, 10).map(({ player, club }, index) => `${index + 1}. ${player.name} (${club}) · avg ${average(player).toFixed(2)} · ${player.ratedMatches} apps`);
  } else if (category === 'SCORERS') {
    lines = players.filter(({ player }) => player.goals > 0).sort((a, b) => b.player.goals - a.player.goals || a.player.appearances - b.player.appearances).slice(0, 10).map(({ player, club }, index) => `${index + 1}. ${player.name} (${club}) · ${player.goals} gol`);
  } else if (category === 'ASSISTS') {
    lines = players.filter(({ player }) => player.assists > 0).sort((a, b) => b.player.assists - a.player.assists || b.player.goals - a.player.goals).slice(0, 10).map(({ player, club }, index) => `${index + 1}. ${player.name} (${club}) · ${player.assists} assist`);
  } else {
    lines = players.filter(({ player }) => player.position === 'GK' && player.appearances > 0).sort((a, b) => (b.player.cleanSheets ?? 0) - (a.player.cleanSheets ?? 0) || average(b.player) - average(a.player)).slice(0, 10).map(({ player, club }, index) => `${index + 1}. ${player.name} (${club}) · ${player.cleanSheets ?? 0} clean sheet · avg ${average(player).toFixed(2)}`);
  }
  const titles: Record<RankingCategory, string> = { CLUB: 'Club Ranking', MVP: 'MVP (rata-rata rating)', SCORERS: 'Golden Boot', ASSISTS: 'Top Assist', GOALKEEPERS: 'Raja GK (clean sheet)' };
  return embed(`${profile.versus!.club.name} · ${titles[category]}`, lines.join('\n') || 'Belum ada data.');
}

export function versusGlobalRankingEmbed(profiles: PlayerProfile[]): EmbedBuilder {
  const clubs = profiles.flatMap((profile) => (profile.versus ? [{ name: profile.versus.club.name, grade: profile.versus.club.grade, titles: profile.versus.history.filter((item) => item.rank === 1).length, seasons: profile.versus.history.length }] : []));
  const lines = clubs.sort((a, b) => a.grade - b.grade || b.titles - a.titles || b.seasons - a.seasons || a.name.localeCompare(b.name)).slice(0, 15).map((club, index) => `${index + 1}. ${club.name} · Liga ${versusLeagueCode(club.grade)} · ${club.titles} gelar · ${club.seasons} season`);
  return embed('Versus Global Ranking', lines.join('\n') || 'Belum ada club Versus.').setFooter({ text: 'Urutan: tier liga, gelar juara, jumlah season.' });
}

export function versusLineupEmbed(club: VersusClub, season: VersusSeason, battle: VersusBattle, summary: string): EmbedBuilder {
  const opponentId = battle.homeClubId === club.id ? battle.awayClubId : battle.homeClubId;
  const opponent = season.clubs.find((item) => item.id === opponentId);
  return embed(`${club.name} · Lineup Round ${battle.roundId}`, `vs **${opponent?.name ?? opponentId}** (${battle.homeClubId === club.id ? 'HOME' : 'AWAY'}) · deadline ${discordTime(season.roundDeadline, 'R')}\n\n${summary}`)
    .addFields(
      field('Kekuatan', `Anda ~${clubStrength(club)} · lawan ~${opponent ? clubStrength(opponent) : '-'}`, true),
      field('Lawan', opponent ? `${opponent.formation} · ${TACTICS[opponent.tactic].name}` : '-', true)
    )
    .setFooter({ text: 'Pemain cedera/skors tidak bisa dipilih. Submission bisa diubah sampai deadline.' });
}
