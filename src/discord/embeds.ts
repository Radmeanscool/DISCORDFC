import { EmbedBuilder, type ColorResolvable } from 'discord.js';
import { getRating, NATIONALITIES } from '../domain/engine.js';
import { formatClubStanding, getClubRating, isClubSeasonComplete } from '../domain/club-engine.js';
import { coachReputation, type CoachSeasonSummary } from '../domain/coach-career-engine.js';
import { formatContract, getContractStatus } from '../domain/contract-engine.js';
import { formatMoney } from '../domain/format.js';
import { canRetire, formatDetailedSkills, skillDisplayLevel, VOLUNTARY_RETIREMENT_AGE } from '../domain/gameplay-engine.js';
import { leagueLabel, resolveClubLeagueId, sortStandings } from '../domain/league-engine.js';
import { playerValue, ratingSkillsFor } from '../domain/player-formulas.js';
import { transferWindowOpen } from '../domain/official-club-engine.js';
import { dmEnabled } from '../domain/notification-engine.js';
import { abilityScore, formatVersusBattle, getVersusStandings, versusLeagueCode, versusTotalRounds } from '../domain/versus-engine.js';
import { availableVersusCoin, listingAbilityScore, minimumVersusBid } from '../domain/versus-economy.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import { BUILD_LABEL } from '../config/build-info.js';
import { formatGameDate, nextMatchDate, seasonLabel, seasonYear } from '../domain/season-calendar.js';
import {
  ABILITY_LABELS,
  COACH_ABILITIES,
  COACH_ABILITY_LABELS,
  DETAILED_SKILL_LABELS,
  skillLabel,
  HONOR_CATEGORY_LABELS,
  POSITION_LABELS,
  TACTICS,
  type AbilityId,
  type CoachRoundResult,
  type MatchRecord,
  type PlayerProfile,
  type PlayerWeeklyEvent,
  type VersusBattle,
  type VersusClub,
  type VersusPlayer,
  type VersusSeason,
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
      .setFooter({ text: BUILD_LABEL })
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
    .setFooter({ text: `Command /play hanya pintu masuk; navigasi lewat tombol. · ${BUILD_LABEL}` });
}

// ----------------------------------------------------------------- Player Mode

function seasonLine(profile: PlayerProfile): string {
  const stats = profile.seasonStats;
  if (!stats || !stats.appearances) return 'Belum bermain musim ini.';
  const average = (stats.ratingSum / stats.appearances).toFixed(1);
  return `${stats.appearances} main · ⚽ ${stats.goals} · 🅰️ ${stats.assists} · ⭐ ${average}${stats.mvps ? ` · MVP ${stats.mvps}` : ''}${profile.position === 'GK' || profile.position === 'DF' ? ` · 🧤 ${stats.cleanSheets}` : ''}`;
}

/** `▰▰▰▰▱▱` gauge for HP/energy. */
function gauge(value: number, max: number, width = 8): string {
  const filled = Math.round(Math.min(1, Math.max(0, max ? value / max : 0)) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

function calendarLine(profile: PlayerProfile): string {
  const next = nextMatchDate(profile);
  return `${next ? `${formatGameDate(next)} · ` : ''}Musim ${seasonLabel(seasonYear(profile))} · Minggu ${profile.careerWeek ?? 1}`;
}

function nextFixtureLine(profile: PlayerProfile): string {
  const club = profile.clubState;
  const fixture = club ? [...club.fixtures].sort((a, b) => a.matchday - b.matchday).find((item) => !item.played) : undefined;
  if (!club) return 'Dibuat saat minggu pertama.';
  if (!fixture) return 'Musim selesai · tekan Next Week untuk musim baru.';
  const home = fixture.homeClub === club.id;
  return `MD ${fixture.matchday} · vs **${home ? fixture.awayClub : fixture.homeClub}** (${home ? 'kandang' : 'tandang'})`;
}

function clubLine(profile: PlayerProfile): string {
  const club = profile.clubState;
  if (!club) return `🏟️ **${profile.club}**`;
  const table = sortStandings(club.standings);
  const rank = table.findIndex((standing) => standing.clubId === club.id) + 1;
  // Before the first matchday every row is level, so a rank would be arbitrary.
  const played = table.some((standing) => standing.played > 0);
  return `🏟️ **${profile.club}** · ${leagueLabel(resolveClubLeagueId(club))}${played && rank > 0 ? ` · #${rank} (${profile.league.points} pts)` : ''}`;
}

function statusAlerts(profile: PlayerProfile): string[] {
  const alerts: string[] = [];
  if (profile.injury) alerts.push(`🩹 Cedera ${profile.injury.severity.toLowerCase()} · ${profile.injury.weeksRemaining} minggu`);
  if ((profile.discipline?.suspendedMatches ?? 0) > 0) alerts.push(`🟥 Skors ${profile.discipline!.suspendedMatches} laga`);
  if ((profile.unassignedMatchExp ?? 0) > 0) alerts.push(`📈 ${profile.unassignedMatchExp} EXP menunggu dialokasikan`);
  if (profile.activeTraining) alerts.push(`🏋️ Latihan ${profile.activeTraining.skill} sampai minggu ${profile.activeTraining.completeAtWeek}`);
  if (profile.cultureStudy) alerts.push(`🎭 Studi ${profile.cultureStudy.subject} sampai minggu ${profile.cultureStudy.completeAtWeek}`);
  if (profile.trainer?.active) alerts.push(`🧑‍🏫 Trainer ${profile.trainer.tier}`);
  if (profile.sponsor) alerts.push(`🤝 Sponsor ${profile.sponsor.brand} · ${profile.sponsor.weeksRemaining} minggu`);
  return alerts;
}

function compactMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} rb`;
  return String(value);
}

/**
 * The original hexagon: OFF, DEF, SPD, STA, TEC, PHY. Five map onto the derived
 * macro stats; STA (stamina) is RECOVERY_INFERRED from endurance, willpower, and teamwork.
 */
function radar(profile: PlayerProfile): Array<[string, number]> {
  const skill = (id: keyof NonNullable<PlayerProfile['detailedSkills']>) => profile.detailedSkills?.[id]?.level ?? 1;
  const stamina = Math.round((skill('endurance') * 2 + skill('willpower') + skill('teamwork')) / 4);
  return [['OFF', profile.stats.atk], ['DEF', profile.stats.def], ['SPD', profile.stats.speed], ['STA', stamina], ['TEC', profile.stats.technique], ['PHY', profile.stats.strength]];
}

/** Full profile: everything about the athlete, opened from the Player menu. */
export function profileEmbed(profile: PlayerProfile): EmbedBuilder {
  const abilities = radar(profile).map(([label, value]) => `${label} **${value}**`).join(' · ');
  const alerts = statusAlerts(profile);
  return embed(`👤 ${profile.displayName} · ${profile.positionDetail ?? POSITION_LABELS[profile.position]}`, `${clubLine(profile)}\n⭐ Rating **${getRating(profile)}** · Usia **${profile.age}** · Tahun karier **${profile.careerYear ?? 1}** · Rebirth **${profile.rebirthCount ?? 0}**${profile.careerStatus === 'RETIRED' ? '\n**Karier sudah pensiun.** Buka Rebirth untuk generasi berikutnya.' : ''}`)
    .addFields(
      field('❤️ Kondisi', `HP ${gauge(profile.hp, profile.maxHp)} ${profile.hp}/${profile.maxHp}\nEnergi ${gauge(profile.energy, profile.maxEnergy)} ${profile.energy}/${profile.maxEnergy}\n💰 ${formatMoney(profile.money)} · Charm ${profile.charm ?? 0}`, true),
      field(`📊 Musim ${profile.league.season}`, `${seasonLine(profile)}\nKlub ${profile.league.wins}-${profile.league.draws}-${profile.league.losses}`, true),
      field('📈 Skill', profile.detailedSkills ? formatDetailedSkills(profile) : 'Akan dimigrasikan pada aksi berikutnya.'),
      field('Atribut (radar)', abilities),
      field('Status', alerts.length ? alerts.join('\n') : 'Sehat · tidak ada program aktif'),
      field('🏅 Total karier', `${profile.career.appearances} main · ${profile.career.wins}-${profile.career.draws}-${profile.career.losses}\n⚽ ${profile.career.goals} · 🅰️ ${profile.career.assists} · 🧤 ${profile.career.cleanSheets} · MVP ${profile.career.mvps ?? 0} · Tricks ${profile.unlockedTricks?.length ?? 0} · Honors ${profile.honors?.length ?? 0}`)
    )
    .setFooter({ text: 'Level skill dihitung sejak awal karier · formula pertandingan RECOVERY_INFERRED' });
}

const NEXT_STEP: Record<NonNullable<PlayerProfile['weekStage']>, string> = {
  READY: 'Tekan **▶ Next Week**: update mingguan, event (jika ada), lalu pertandingan dimainkan langsung.',
  SEASON_BREAK: 'Musim selesai. Tekan **▶ Next Week** untuk memulai musim baru (cek tawaran transfer di Klub).',
  EVENT_PENDING: 'Ada event minggu ini. Tekan **▶ Lanjut** untuk memilih respons, lalu pertandingan dimulai.',
  MATCH_READY: 'Pertandingan siap. Tekan **▶ Main Match**.',
  EXP_PENDING: 'Tekan **▶ Alokasikan EXP** untuk menyalurkan EXP pertandingan ke skill.'
};

/** Weekly hub: the essentials at a glance and one obvious next step. */
export function playerWeeklyEmbed(profile: PlayerProfile): EmbedBuilder {
  const stage = profile.weekStage ?? 'READY';
  const key = ratingSkillsFor(profile.position).slice(0, 4).map((skill) => `${skillLabel(profile.position, skill)} **Lv ${skillDisplayLevel(profile, skill)}**`).join(' · ');
  const alerts = statusAlerts(profile);
  const item = embed(`⚽ ${profile.displayName} · ${profile.positionDetail ?? POSITION_LABELS[profile.position]}`, [
    clubLine(profile),
    `📅 ${calendarLine(profile)}`,
    `🎂 Usia ${profile.age}${profile.nationality ? ` · ${NATIONALITIES.find((item) => item.code === profile.nationality)?.label ?? profile.nationality}` : ''}`,
    `⭐ Rating **${getRating(profile)}** · 💎 Value ${compactMoney(playerValue(getRating(profile), profile.age))}`,
    `💰 ${formatMoney(profile.money)} · 💠 ${profile.diamonds ?? 0} Diamonds · 👥 ${formatMoney(profile.fans ?? 0)} Fans`,
    '',
    profile.careerStatus === 'RETIRED' ? 'Karier sudah pensiun. Tekan **Rebirth** untuk generasi baru.' : `➡️ ${NEXT_STEP[stage]}`
  ].join('\n'))
    .addFields(
      field('❤️ Kondisi', `HP ${gauge(profile.hp, profile.maxHp)} ${profile.hp}\nEnergi ${gauge(profile.energy, profile.maxEnergy)} ${profile.energy}`, true),
      field('📆 Laga berikutnya', nextFixtureLine(profile), true),
      field('📊 Musim ini', seasonLine(profile), true),
      field('🎯 Skill utama', key || '-')
    );
  if (alerts.length) item.addFields(field('Status', alerts.join('\n')));
  return item;
}

/** Event step of the week, with the weekly update that came before it. */
export function playerEventEmbed(event: PlayerWeeklyEvent, weeklyNotes: string[] = []): EmbedBuilder {
  const notes = weeklyNotes.filter((line) => !line.startsWith('Weekly Update') && !line.startsWith('Event mingguan'));
  const item = embed(`📰 Event minggu ini · ${event.title}`, `${event.description}\n\nPilih responsmu di menu bawah. Setelah itu pertandingan langsung dimulai.`)
    .setColor(WARNING_COLOR);
  if (notes.length) item.addFields(field('Update mingguan', notes.map((line) => `• ${line}`).join('\n')));
  return item;
}

function scoreAt(record: MatchRecord, minute: number): { team: number; opponent: number } {
  const goals = (record.timeline ?? []).filter((event) => event.kind === 'GOAL' && event.minute <= minute);
  return { team: goals.filter((event) => event.side === 'TEAM').length, opponent: goals.filter((event) => event.side === 'OPPONENT').length };
}

function scoreboard(record: MatchRecord, score: { team: number; opponent: number }): string {
  const team = record.teamName ?? 'Tim kamu';
  return record.home === false ? `**${record.opponent}  ${score.opponent} – ${score.team}  ${team}**` : `**${team}  ${score.team} – ${score.opponent}  ${record.opponent}**`;
}

/** Round table as in the original's post-match screen: the top three and the rows around the athlete's club. */
function roundTable(profile: PlayerProfile): string | undefined {
  const club = profile.clubState;
  if (!club) return undefined;
  const table = sortStandings(club.standings);
  const own = table.findIndex((standing) => standing.clubId === club.id);
  const rows = new Set([0, 1, 2, own - 1, own, own + 1].filter((index) => index >= 0 && index < table.length));
  let previous = -1;
  const lines: string[] = [];
  for (const index of [...rows].sort((a, b) => a - b)) {
    if (previous >= 0 && index > previous + 1) lines.push('…');
    const standing = table[index];
    const name = standing.clubId === club.id ? `**${standing.clubName}**` : standing.clubName;
    lines.push(`\`${String(index + 1).padStart(2)}\` ${name} · ${standing.points} pts`);
    previous = index;
  }
  return lines.join('\n');
}

/** Minute checkpoints shown while the match "plays". */
export const LIVE_CHECKPOINTS = [0, 15, 30, 45, 60, 75, 90] as const;

/** One live frame: scoreboard at `minute` plus the latest moments. */
export function liveMatchEmbed(record: MatchRecord, minute: number): EmbedBuilder {
  const events = (record.timeline ?? []).filter((event) => event.minute <= minute);
  const clock = minute === 0 ? 'Kick-off!' : minute === 45 ? 'Turun minum (HT)' : minute >= 90 ? 'Peluit panjang (FT)' : `${minute}'`;
  const feed = events.slice(-6).map((event) => `\`${String(event.minute).padStart(2)}'\` ${event.text}`);
  const personal = record.personal;
  const lines = [
    scoreboard(record, scoreAt(record, minute)),
    `⏱️ ${clock}  ${'▰'.repeat(Math.round(minute / 15))}${'▱'.repeat(6 - Math.round(minute / 15))}`,
    '',
    ...(feed.length ? feed : ['Kedua tim saling menjajaki…']),
    ...(personal && !personal.played ? ['', `Kamu tidak bermain (${personal.absence === 'INJURED' ? 'cedera' : personal.absence === 'SUSPENDED' ? 'skors' : 'kondisi fisik'}) dan menonton dari tribun.`] : [])
  ];
  if (minute === 0 && record.attendance) lines.splice(2, 0, `👥 ${record.attendance.toLocaleString('id-ID')} penonton`);
  return embed(`🔴 LIVE · Matchday ${record.matchday ?? '-'}${record.date ? ` · ${formatGameDate(new Date(record.date))}` : ''}`, lines.join('\n'));
}

/** Match recap shown after the live frames, with rewards and what happened this week. */
export function matchResultEmbed(result: WeekResult, weeklyNotes: string[] = []): EmbedBuilder {
  const match = result.match;
  if (!match) return embed(`Minggu ${result.week}`, result.narrative.join('\n') || 'Tidak ada pertandingan minggu ini.');
  const title = match.outcome === 'WIN' ? '🏆 MENANG' : match.outcome === 'DRAW' ? '🤝 SERI' : '💔 KALAH';
  const personal = match.personal;
  const goals = (match.timeline ?? []).filter((event) => event.kind === 'GOAL').map((event) => `\`${event.minute}'\` ${event.side === 'TEAM' ? '⚽' : '🥅'} ${event.text.replace(/^⚽ (GOL! )?/, '')}`);
  const performance = personal?.played
    ? `⭐ Rating **${personal.rating.toFixed(1)}** · ⚽ ${personal.goals} · 🅰️ ${personal.assists}${personal.mvp ? ' · 🏅 **MVP**' : ''}${personal.cleanSheet ? ' · 🧤 clean sheet' : ''}${personal.yellowCard ? ' · 🟨' : ''}${personal.redCard ? ' · 🟥' : ''}`
    : `Tidak bermain (${personal?.absence === 'INJURED' ? 'cedera' : personal?.absence === 'SUSPENDED' ? 'skors' : 'kondisi fisik'}).`;
  // The first narrative lines repeat the score and personal line shown above.
  const afterMatch = result.narrative.filter((line) => !line.startsWith('Match Ready') && !/^\S.* \d+-\d+ .* · matchday \d+\.$/.test(line) && !line.startsWith('Rating '));
  const notes = [...weeklyNotes.filter((line) => !line.startsWith('Weekly Update') && !line.startsWith('Event mingguan')), ...afterMatch];
  const halftime = match.halftime ? ` (HT ${match.home === false ? `${match.halftime.opponent}–${match.halftime.team}` : `${match.halftime.team}–${match.halftime.opponent}`})` : '';
  const crowd = [match.attendance ? `👥 ${match.attendance.toLocaleString('id-ID')} penonton` : '', match.mvpName ? `🏅 MVP: **${match.mvpName}**` : ''].filter(Boolean).join(' · ');
  const item = embed(`${title} · Matchday ${match.matchday ?? '-'}${match.date ? ` · ${formatGameDate(new Date(match.date))}` : ''}`, [
    `${scoreboard(match, { team: match.playerGoals, opponent: match.opponentGoals })}${halftime}`,
    '',
    ...(goals.length ? goals : ['Tanpa gol.']),
    '',
    `**Performa kamu:** ${performance}`,
    ...(crowd ? ['', crowd] : [])
  ].join('\n'))
    .setColor(match.outcome === 'LOSS' || result.retired ? WARNING_COLOR : BRAND_COLOR)
    .addFields(
      field('📊 Statistik', match.stats ? `Penguasaan ${match.stats.possession}%–${match.stats.opponentPossession}%\nTembakan ${match.stats.shots}–${match.stats.opponentShots} (on target ${match.stats.shotsOnTarget}–${match.stats.opponentShotsOnTarget})` : '-', true),
      field('🎁 Hadiah', `💰 +${formatMoney(match.rewards.money)}\n📈 +${match.rewards.exp} EXP${result.expAwaitingAssignment ? ` · **${result.expAwaitingAssignment}** siap dialokasikan` : ''}`, true)
    );
  if (match.ratings?.length) {
    const top = match.ratings.slice(0, 5);
    const own = match.ratings.find((item) => item.user);
    const rows = [...top, ...(own && !top.includes(own) ? [own] : [])].map((item) => `\`${item.rating.toFixed(1)}\` ${item.user ? `**${item.name}**` : item.name} · ${item.position}`);
    item.addFields(field('⭐ Rating pemain', rows.join('\n'), true));
  }
  const table = roundTable(result.profile);
  if (table) item.addFields(field(`📊 Klasemen setelah MD ${match.matchday ?? '-'}`, table, true));
  if (notes.length) item.addFields(field('Minggu ini', notes.map((line) => `• ${line}`).join('\n')));
  if (result.award) item.addFields(field('🌍 World Footballer', `Pemenang: **${result.award.winner}** · skor kamu ${result.award.userScore}${result.award.userWon ? ' · **KAMU MENANG!**' : ''}`));
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
