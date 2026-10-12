import { ButtonInteraction, ChatInputCommandInteraction, EmbedBuilder, StringSelectMenuInteraction, type ColorResolvable } from 'discord.js';
import { createInitialProfile, formatAbility, getRating, playMatch, recoverPlayer, trainPlayer } from '../domain/engine.js';
import { ensureClubState, finishSeason, formatClubStanding, getClubRating, getNextClubFixture, playClubMatch, setClubFormation, setClubTactic } from '../domain/club-engine.js';
import { buyMarketPlayer, claimDailyReward, formatMoney, refreshMarket, sellClubPlayer } from '../domain/progression-engine.js';
import { claimAchievement, formatAchievements, playChampionsLeague, startChampionsLeague, syncAchievements } from '../domain/competition-engine.js';
import { assignMatchExp, ensureGameplayState, formatDetailedSkills, formatGameplayStatus, hireTrainer, listTrainerCatalog, playPreparedWeek, preparePlayerWeek, rebirthPlayer, releaseTrainer, resolvePlayerWeeklyEvent, retirePlayer, startCultureStudy, startTrickTraining, trainDetailedSkill, treatInjury } from '../domain/gameplay-engine.js';
import { formatContract, getContractStatus, renewContract, signContract } from '../domain/contract-engine.js';
import { joinOfficialClub, listOfficialClubs, officialClubTransferFee } from '../domain/official-club-engine.js';
import { acceptJobOffer, advanceCoachRound, assignCoachExp, createCoachCareer, declineJobOffer, formatCoachProfile, generateJobOffer, rebirthCoach, resolveCoachEvent, retireCoach, settleCoachSeason } from '../domain/coach-career-engine.js';
import { assignVersusMatchmaking, createVersusSeason, formatVersusBattle, getVersusStandings, processVersusRound, queueVersusMatchmaking, settleVersusSeason, submitVersusLineup, syncVersusProfileWithSeason } from '../domain/versus-engine.js';
import { availableVersusCoin, createVersusMarket, placeVersusBid, settleExpiredVersusMarket } from '../domain/versus-economy.js';
import { ABILITY_LABELS, COACH_ABILITIES, COACH_ABILITY_LABELS, DETAILED_SKILL_LABELS, DETAILED_SKILLS, FORMATIONS, HONOR_CATEGORY_LABELS, POSITION_LABELS, TACTICS, TRAINER_CATALOG, TRICK_CATALOG, type AbilityId, type CoachAbilityId, type CultureSubject, type DetailedSkillId, type FormationId, type PlayerProfile, type Position, type TacticId, type VersusSeason } from '../domain/types.js';
import type { BatchPlayerStore, PlayerStore, VersusGroupLockStore } from '../storage/json-store.js';
import { careerControls, championsControls, coachControls, coachEventControls, coachExpControls, coachJobControls, coachStrategyControls, detailedTrainingControls, mainMenuControls, officialClubControls, pendingExpControls, playerClubControls, playerCreationControls, playerCultureControls, playerEventControls, playerInjuryControls, playerStrategyControls, playerWeeklyControls, trainingControls, transferConfirmControls, versusFinalizeControls, versusHomeControls, versusMarketControls, versusPositionControls, versusRankingControls, versusSetupControls, versusSponsorControls } from './components.js';
import { log } from '../observability/logger.js';
import { resolveModeCommand } from './commands.js';

const BRAND_COLOR: ColorResolvable = '#1f8b4c';
const ADMIN_USER_IDS = new Set((process.env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean));

type VersusPosition = 'GK' | 'DF' | 'MF' | 'FW';
type VersusDraft = {
  groupCode: string;
  battleId: string;
  rosterVersion: number;
  formation: FormationId;
  tactic: TacticId;
  selected: Record<VersusPosition, string[]>;
  captain?: string;
  substitutes: string[];
};
const versusDrafts = new Map<string, VersusDraft>();

function profileEmbed(profile: PlayerProfile): EmbedBuilder {
  const abilities = Object.entries(profile.abilities)
    .map(([id, state]) => `${ABILITY_LABELS[id as AbilityId]}: **${profile.stats[id as AbilityId]}** (Lv ${state.level}, ${state.exp} EXP)`)
    .join('\n');
  const detailed = profile.detailedSkills ? formatDetailedSkills(profile) : 'Jalankan `/skills` untuk menginisialisasi detailed skill state.';
  const gameplay = profile.detailedSkills ? formatGameplayStatus(profile) : 'Legacy profile; gameplay state akan dimigrasikan saat `/skills` atau `/next-week`.';
  const club = profile.clubState;
  const nextFixture = club?.fixtures.find((fixture) => !fixture.played);
  const fixtureText = nextFixture
    ? `MD ${nextFixture.matchday} · ${nextFixture.homeClub} vs ${nextFixture.awayClub}\n${nextFixture.playedAt?.slice(0, 10) ?? 'TBA'}`
    : 'Tidak ada fixture tersisa';
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${profile.displayName} — Football Rising Star`)
    .setDescription(`**${POSITION_LABELS[profile.position]}** · ${profile.club} · Player rating **${getRating(profile)}**`)
    .addFields(
      { name: 'Condition', value: `HP **${profile.hp}/${profile.maxHp}**\nEnergy **${profile.energy}/${profile.maxEnergy}**\nMoney **${formatMoney(profile.money)}**`, inline: true },
      { name: 'Career', value: `Level **${profile.level}**\nEXP **${profile.totalExp}**\nAge **${profile.age}**`, inline: true },
      { name: 'Club', value: club ? `Club rating **${getClubRating(profile)}**\nPrestige **${club.prestige}**\nAssets **${formatMoney(club.assets)}**\n${club.formation} · ${TACTICS[club.tactic].name}\nNext: ${fixtureText}` : 'Gunakan `/club` untuk membuat state klub.', inline: true },
      { name: 'Macro abilities', value: abilities || 'Belum ada ability.' },
      { name: 'Detailed skills', value: detailed },
      { name: 'Gameplay state', value: gameplay },
      { name: 'Career statistics', value: `Appearances **${profile.career.appearances}** · W-D-L **${profile.career.wins}-${profile.career.draws}-${profile.career.losses}**\nGoals **${profile.career.goals}** · Assists **${profile.career.assists}** · Clean sheets **${profile.career.cleanSheets}**` }
    )
    .setFooter({ text: 'Football Rising Star Discord · Formula pertandingan modular untuk kalibrasi internal.' });
}

function playerWeeklyEmbed(profileInput: PlayerProfile): EmbedBuilder {
  const profile = ensureGameplayState(profileInput);
  const stage = profile.weekStage ?? 'READY';
  const stageLabel: Record<NonNullable<PlayerProfile['weekStage']>, string> = {
    READY: 'Siap menyiapkan minggu berikutnya',
    MATCH_READY: 'Weekly update selesai · pertandingan siap dimainkan',
    EXP_PENDING: 'EXP pertandingan menunggu alokasi',
    EVENT_PENDING: 'Event mingguan menunggu keputusan',
    SEASON_BREAK: 'Season break · lihat hasil penghargaan'
  };
  const nextAction = stage === 'READY' || stage === 'SEASON_BREAK' ? 'Tekan **Next Week** untuk memproses recovery, training, dan weekly update.' : stage === 'MATCH_READY' ? 'Tekan **Play Match** untuk melihat simulasi pertandingan.' : stage === 'EVENT_PENDING' ? 'Tekan **Weekly Event Decision** untuk memilih respons sebelum pertandingan.' : 'Pilih **Assign EXP** pada panel hasil pertandingan sebelum memulai minggu berikutnya.';
  return profileEmbed(profile)
    .setTitle(`${profile.displayName} · Player Weekly Hub`)
    .setDescription(`Week **${profile.seasonWeek ?? 1}** · Stage **${stageLabel[stage]}**\n${nextAction}`)
    .addFields({ name: 'Weekly route', value: 'Status → Training/Personal → Next Week → Match → Assign EXP → League', inline: false });
}

function createPlayerProfile(userId: string, displayName: string, position: Position, now = new Date()): PlayerProfile {
  let profile = createInitialProfile(userId, displayName, position, now);
  profile = ensureClubState(profile, now);
  profile = refreshMarket(profile, now);
  return profile;
}

function gameHomeEmbed(profile?: PlayerProfile): EmbedBuilder {
  if (!profile) {
    return new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Football Rising Star · Game Home')
      .setDescription('Pilih mode untuk mulai. Player, Coach, dan Versus memiliki state yang terpisah; operasi berikutnya dilakukan melalui tombol dan menu.')
      .addFields(
        { name: 'Player Mode', value: 'Karier individu: weekly update, training, match, EXP, transfer, injury, dan honors.' },
        { name: 'Coach Mode', value: 'Manajemen klub: board target, job offer, roster, formation, tactic, fixture, decision, dan season.' },
        { name: 'Versus Mode', value: 'Kompetisi online asynchronous: system assignment, lineup, countdown, result, standings, Deal, dan rewards.' }
      );
  }
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${profile.displayName} · Game Home`)
    .setDescription('Pilih mode yang ingin dimainkan. Mode tidak berbagi progression secara otomatis.')
    .addFields(
      { name: 'Player Mode', value: `${profile.club} · rating ${getRating(profile)} · age ${profile.age}`, inline: true },
      { name: 'Coach Mode', value: profile.coach ? `${profile.coach.coachName} · ${profile.coach.status} · approval ${profile.coach.approval}/100` : 'Belum dimulai', inline: true },
      { name: 'Versus Mode', value: profile.versus ? `${profile.versus.club.name} · ${profile.versus.status}` : 'Belum ditugaskan', inline: true }
    )
    .setFooter({ text: 'Gunakan tombol mode; command /play hanya berfungsi sebagai pintu masuk.' });
}

function coachHomeEmbed(profile: PlayerProfile): EmbedBuilder {
  const coach = profile.coach;
  if (!coach) throw new Error('Karier Coach belum dibuat.');
  const club = profile.coachClubState;
  const nextFixture = club?.fixtures.find((fixture) => !fixture.played);
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${coach.coachName} · Coach Home`)
    .setDescription(`Kelola klub **${club?.name ?? profile.club}** melalui tombol di bawah. Board, job, squad, formation, tactic, match, dan management decision memiliki state terpisah.`)
    .addFields(
      { name: 'Career', value: `Age ${coach.age} · Year ${coach.careerYear} · Level ${coach.level}\nStatus ${coach.status} · Approval ${coach.approval}/100`, inline: true },
      { name: 'Board', value: `${coach.boardTarget.type}\nTarget rank ${coach.boardTarget.targetRank}\nCurrent rank ${coach.boardTarget.progressRank ?? '-'}`, inline: true },
      { name: 'Club', value: `${club?.name ?? '-'}\nFormation ${club?.formation ?? '-'}\nTactic ${club ? TACTICS[club.tactic].name : '-'}`, inline: true },
      { name: 'Next fixture', value: nextFixture ? `${nextFixture.homeClub} vs ${nextFixture.awayClub}\nMatchday ${nextFixture.matchday}` : 'Season selesai; buka season settlement.' },
      { name: 'Coach EXP', value: `${coach.unassignedExp} pending · salary ${formatMoney(coach.salary)}`, inline: true },
      { name: 'Honors', value: `${coach.honors.length}`, inline: true }
    );
}

async function requireProfile(interaction: ChatInputCommandInteraction, store: PlayerStore): Promise<PlayerProfile | undefined> {
  const profile = await store.get(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: 'Profil belum dibuat. Jalankan `/start position:<GK|DF|MF|FW>` terlebih dahulu.' });
    return undefined;
  }
  return profile;
}

async function versusMembers(store: PlayerStore, groupCode: string): Promise<PlayerProfile[]> {
  return (await store.all()).filter((profile) => profile.versus?.groupCode === groupCode);
}

function matchmakingGroupCode(queueKey: string, now: Date): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `MM-${queueKey.toUpperCase()}-${day}`.slice(0, 24);
}

async function versusSeasonFor(store: PlayerStore, groupCode: string, now: Date): Promise<{ season: import('../domain/types.js').VersusSeason; members: PlayerProfile[] }> {
  const members = await versusMembers(store, groupCode);
  if (members.length === 0) throw new Error('Belum ada anggota pada Versus group ini.');
  const existing = members.find((profile) => profile.versus?.season)?.versus?.season;
  return { season: existing ? structuredClone(existing) : createVersusSeason(groupCode, members, now), members };
}

async function persistVersusSeason(store: PlayerStore, season: import('../domain/types.js').VersusSeason, now: Date): Promise<void> {
  const members = await versusMembers(store, season.groupCode);
  const nextProfiles = members.map((member) => syncVersusProfileWithSeason(member, season, now));
  const batchStore = store as Partial<BatchPlayerStore>;
  if (typeof batchStore.saveBatch !== 'function') throw new Error('Versus persistence backend tidak menyediakan atomic batch save. Operasi dihentikan untuk mencegah partial season write.');
  await batchStore.saveBatch(nextProfiles);
}

async function persistVersusEconomy(store: PlayerStore, profiles: PlayerProfile[], season: VersusSeason, now: Date): Promise<PlayerProfile[]> {
  const nextProfiles = profiles.map((profile) => syncVersusProfileWithSeason(profile, season, now));
  const batchStore = store as Partial<BatchPlayerStore>;
  if (typeof batchStore.saveBatch !== 'function') throw new Error('Versus persistence backend tidak menyediakan atomic batch save. Operasi dihentikan untuk mencegah partial economy write.');
  await batchStore.saveBatch(nextProfiles);
  return nextProfiles;
}

async function prepareVersusMarket(store: PlayerStore, seasonInput: VersusSeason, now = new Date()): Promise<{ season: VersusSeason; profiles: PlayerProfile[] }> {
  const members = await versusMembers(store, seasonInput.groupCode);
  let season = structuredClone(seasonInput);
  let profiles = members.map((member) => structuredClone(member));
  let changed = false;
  if (!season.market) {
    season = createVersusMarket(season, now);
    changed = true;
  } else {
    const settled = settleExpiredVersusMarket(profiles, season, now);
    if (settled.length > 0) {
      const latest = settled[settled.length - 1];
      season = latest.season;
      profiles = latest.profiles;
      changed = true;
    }
    const currentMarket = season.market;
    if (!currentMarket) throw new Error('Versus market state hilang setelah expiry processing.');
    const hasLiveListing = currentMarket.listings.some((listing) => listing.status === 'OPEN' && new Date(listing.endsAt).getTime() > now.getTime());
    if (!hasLiveListing) {
      season = createVersusMarket(season, now);
      changed = true;
    }
  }
  if (changed) profiles = await persistVersusEconomy(store, profiles, season, now);
  return { season, profiles };
}

const versusGroupQueues = new Map<string, Promise<void>>();

function parseIdList(value: string | null): string[] {
  return [...new Set((value ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}

async function withVersusGroupLock<T>(store: PlayerStore, groupCode: string, operation: () => Promise<T>): Promise<T> {
  const lockStore = store as Partial<VersusGroupLockStore>;
  if (typeof lockStore.withVersusGroupLock === 'function') return lockStore.withVersusGroupLock(groupCode, operation);
  const previous = versusGroupQueues.get(groupCode) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  versusGroupQueues.set(groupCode, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (versusGroupQueues.get(groupCode) === queued) versusGroupQueues.delete(groupCode);
  }
}

async function ensurePublicVersusAssignment(store: PlayerStore, profileInput: PlayerProfile, now = new Date()): Promise<{ profile: PlayerProfile; season: VersusSeason }> {
  if (profileInput.versus?.groupCode) {
    const current = await versusSeasonFor(store, profileInput.versus.groupCode, now);
    return { profile: profileInput, season: current.season };
  }
  const groupCode = matchmakingGroupCode('public', now);
  return withVersusGroupLock(store, groupCode, async () => {
    const currentMembers = await versusMembers(store, groupCode);
    const existingMember = currentMembers.find((member) => member.userId === profileInput.userId);
    const existing = currentMembers.find((member) => member.versus?.season)?.versus?.season;
    if (existingMember?.versus?.season && existing) return { profile: existingMember, season: existing };
    if (existing && (existing.state !== 'ACTIVE' || existing.currentRound > 1 || existing.battles.some((battle) => battle.state !== 'OPEN'))) throw new Error('Versus sedang berjalan. Sistem akan menyiapkan assignment berikutnya pada queue berikutnya.');
    if (!existingMember && currentMembers.length >= 8) throw new Error('Assignment Versus sedang penuh. Coba buka Versus lagi untuk memperoleh queue berikutnya.');
    const queued = queueVersusMatchmaking(profileInput, 'public', now);
    const assigned = assignVersusMatchmaking(queued, groupCode, now);
    await store.save(assigned);
    const members = await versusMembers(store, groupCode);
    const season = createVersusSeason(groupCode, members, existing ? new Date(existing.startAt) : now);
    await persistVersusSeason(store, season, now);
    const saved = await store.get(profileInput.userId);
    return { profile: saved ?? assigned, season };
  });
}

function activeVersusBattle(season: VersusSeason | undefined, clubId: string): import('../domain/types.js').VersusBattle | undefined {
  if (!season || season.state !== 'ACTIVE') return undefined;
  return season.battles.find((battle) => battle.roundId === season.currentRound && (battle.homeClubId === clubId || battle.awayClubId === clubId));
}

function versusOpponentName(season: VersusSeason | undefined, battle: import('../domain/types.js').VersusBattle | undefined, clubId: string): string {
  if (!season || !battle) return '-';
  const opponentId = battle.homeClubId === clubId ? battle.awayClubId : battle.homeClubId;
  return season.clubs.find((club) => club.id === opponentId)?.name ?? opponentId;
}

function versusAverageRating(club: import('../domain/types.js').VersusClub): number {
  const players = club.roster;
  const total = players.reduce((sum, player) => sum + Object.values(player.abilities).reduce((inner, value) => inner + value, 0) / 6, 0);
  return Math.round(total / Math.max(1, players.length));
}

function versusAttackRating(club: import('../domain/types.js').VersusClub): number {
  const players = club.roster.filter((player) => player.position === 'FW' || player.position === 'MF');
  return Math.round(players.reduce((sum, player) => sum + player.abilities.atk, 0) / Math.max(1, players.length));
}

function versusDefenceRating(club: import('../domain/types.js').VersusClub): number {
  const players = club.roster.filter((player) => player.position === 'GK' || player.position === 'DF');
  return Math.round(players.reduce((sum, player) => sum + player.abilities.def, 0) / Math.max(1, players.length));
}

function versusHomeEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const versus = profile.versus!;
  const club = versus.club;
  const battle = activeVersusBattle(season, club.id);
  const standing = season ? getVersusStandings(season).find((item) => item.clubId === club.id) : undefined;
  const submission = battle ? battle.homeClubId === club.id ? battle.homeSubmission : battle.awaySubmission : undefined;
  const totalRounds = season ? 2 * (season.clubs.length - 1) : 0;
  const submissionLabel = submission ? `LOCKED · ${submission.formation} · ${TACTICS[submission.tactic].name}` : 'NOT SUBMITTED';
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${club.name} · Versus Home`)
    .setDescription(`Group **${versus.groupCode ?? '-'}** · Season **${season?.id ?? versus.season?.id ?? '-'}**\n${season ? `Round **${Math.min(season.currentRound, totalRounds)}/${totalRounds}**` : 'Season belum aktif'}`)
    .addFields(
      { name: 'Assigned team', value: `${club.name}\nSystem-managed roster`, inline: true },
      { name: 'Matchmaking', value: versus.matchmaking ? `${versus.matchmaking.status}\nQueue ${versus.matchmaking.queueKey}` : 'Legacy assignment', inline: true },
      { name: 'Record', value: `${club.wins}-${club.draws}-${club.losses} · ${club.goalsFor}-${club.goalsAgainst}`, inline: true },
      { name: 'Standing', value: standing ? `#${standing.rank} · ${standing.points} pts · GD ${standing.goalDifference}` : '-', inline: true },
      { name: 'Versus wallet', value: `${formatMoney(versus.versusMoney)} money · ${versus.versusCoin} coin`, inline: true },
      { name: 'Next battle', value: battle ? `**${battle.id}** vs **${versusOpponentName(season, battle, club.id)}**` : 'Tidak ada battle aktif', inline: true },
      { name: 'Deadline', value: season?.roundDeadline ?? '-', inline: true },
      { name: 'Submission', value: submissionLabel, inline: true }
    )
    .setFooter({ text: 'Pilih Lineup untuk setup XI seperti pre-match screen. Estimasi strength tetap RECOVERY_INFERRED.' });
}

function versusRegistrationEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const versus = profile.versus!;
  const club = versus.club;
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${club.name} · Versus Registration`)
    .setDescription(`Status **${versus.status}**\nMatchmaking **${versus.matchmaking?.status ?? 'LEGACY'}**\nGroup code **${versus.groupCode ?? '-'}**\n\nPada public queue, team dan competition ditetapkan oleh system matchmaking. Group code hanya digunakan untuk private-group fallback. Registrasi dan settlement tetap dikelola oleh server season.`)
    .addFields(
      { name: 'Competition', value: season ? `${season.leagueId} · Grade ${season.grade}` : '-', inline: true },
      { name: 'Capacity', value: season ? `${season.clubs.length}/${season.capacity} clubs` : '-', inline: true },
      { name: 'Season state', value: season?.state ?? '-', inline: true },
      { name: 'Club', value: club.name, inline: true },
      { name: 'Current round', value: season ? `${Math.min(season.currentRound, 2 * (season.clubs.length - 1))}/${2 * (season.clubs.length - 1)}` : '-', inline: true },
      { name: 'Next action', value: season?.state === 'ACTIVE' ? 'Open Next Battle or Lineup' : 'Wait for competition state', inline: true }
    )
    .setFooter({ text: 'Group-code registration is public evidence; exact original registration copy remains unverified.' });
}

function versusResultEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const battles = season?.battles.filter((battle) => battle.state === 'PUBLISHED' && (battle.homeClubId === clubId || battle.awayClubId === clubId)).slice(-3).reverse() ?? [];
  const description = battles.length ? battles.map((battle) => `**Round ${battle.roundId}** · ${formatVersusBattle(battle)}`).join('\n\n') : 'Belum ada hasil battle yang dipublikasikan.';
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus!.club.name} · Results`).setDescription(description).setFooter({ text: 'Hasil disusun dari settlement battle yang sudah published.' });
}

function versusStandingsEmbed(season: VersusSeason): EmbedBuilder {
  const lines = getVersusStandings(season).map((standing) => `${standing.rank}. **${standing.clubName}** · ${standing.points} pts · ${standing.wins}-${standing.draws}-${standing.losses} · GD ${standing.goalDifference}${standing.isNpc ? ' · NPC' : ''}`).join('\n');
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Versus Standings · ${season.groupCode}`).setDescription(lines).setFooter({ text: `Round ${season.currentRound}/${2 * (season.clubs.length - 1)} · points, GD, goals scored, stable club ID.` });
}

function versusMarketEmbed(profile: PlayerProfile, season: VersusSeason, tab: 'DEAL' | 'SCOUT' = 'DEAL'): EmbedBuilder {
  const listings = season.market?.listings ?? [];
  const now = Date.now();
  const dealLines = listings.map((listing) => {
    const seconds = Math.max(0, Math.ceil((new Date(listing.endsAt).getTime() - now) / 1_000));
    const bid = listing.currentBid ?? listing.openingBid;
    const score = Math.round(Object.values(listing.player.abilities).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.values(listing.player.abilities).length));
    return `**${listing.player.name}** · ${listing.player.position} · score ${score} · bid **${bid} coin** · ${listing.status === 'OPEN' ? `${seconds}s left` : listing.status}`;
  }).join('\n');
  const roster = profile.versus!.club.roster
    .slice()
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((player) => `**${player.name}** · ${player.position} · value ${player.value} · HP ${player.hp}/${player.maxHp}`)
    .join('\n');
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${profile.versus!.club.name} · Versus Market`)
    .setDescription(`**${tab === 'DEAL' ? 'Deal' : 'Scout'} tab**\n${tab === 'DEAL' ? dealLines || 'Belum ada listing.' : 'Candidate scout akan ditampilkan setelah ruleset Scout terverifikasi.'}\n\n${tab === 'DEAL' ? 'Gunakan `/versus-bid listing_id:<id> amount:<coin>` sebelum countdown berakhir.' : roster || 'Belum ada player.'}`)
    .addFields(
      { name: 'Available coin', value: `${availableVersusCoin(profile)} available · ${profile.versus!.versusCoin} total · reservations ${profile.versus!.reservations?.reduce((sum, item) => sum + item.amount, 0) ?? 0}`, inline: true },
      { name: 'Market state', value: `${listings.filter((listing) => listing.status === 'OPEN').length} open listing(s)`, inline: true },
      { name: 'Economy rule', value: 'Bid memakai reservation; coin baru didebit saat listing settled. Outbid melepaskan reservation secara atomic.' },
      { name: 'Evidence boundary', value: 'Listing, bid, countdown, dan market dapat diamati publik; exact increment, server timer, Scout effect, dan premium economics tetap versioned/inferred.' }
    )
    .setFooter({ text: 'Deal/Scout tabs observed in public Versus review · economy ruleset is versioned and auditable.' });
}

function versusSponsorEmbed(profile: PlayerProfile, selection?: 'Junior' | 'Senior' | 'Top'): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${profile.versus!.club.name} · Sponsor`)
    .setDescription(`${selection ? `Selected **${selection} Sponsor**.` : 'Choose a sponsor tier for the next reward cycle.'}\n\nJunior Sponsor · Senior Sponsor · Top Sponsor`)
    .addFields(
      { name: 'Available balance', value: `${formatMoney(profile.versus!.versusMoney)} money · ${profile.versus!.versusCoin} coin`, inline: true },
      { name: 'Current state', value: 'Preview only', inline: true },
      { name: 'Why no claim button?', value: 'The public footage shows sponsor tiers and reward visuals, but does not expose complete cost, cooldown, payout, or persistence rules. No balance mutation is performed.' }
    )
    .setFooter({ text: 'Sponsor tiers observed in the verified Versus walkthrough · mechanics remain RECOVERY_INFERRED.' });
}

function versusRewardsEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const reward = season?.rewards.find((item) => item.clubId === clubId);
  const ledger = (profile.versus!.ledger ?? []).filter((entry) => entry.seasonId === season?.id).slice(0, 6);
  const ledgerText = ledger.length ? ledger.map((entry) => `${entry.currency} +${entry.amount} · ${entry.note}`).join('\n') : 'Belum ada reward ledger pada season ini.';
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${profile.versus!.club.name} · Versus Rewards`)
    .setDescription(reward ? `Final rank **#${reward.rank}** · ${reward.promoted ? 'Promoted' : reward.relegated ? 'Relegated' : 'Stable'}\nMoney **+${reward.money}** · Coin **+${reward.coin}**` : 'Reward season akan ditampilkan setelah seluruh round diselesaikan dan season dipublikasikan.')
    .addFields({ name: 'Reward history', value: ledgerText }, { name: 'Reward state', value: season?.state === 'FINISHED' ? 'PUBLISHED' : 'PENDING' })
    .setFooter({ text: 'Rewards surface mengikuti hasil settlement; angka yang belum dipublikasikan tidak diproyeksikan.' });
}

function versusScheduleEmbed(profile: PlayerProfile, season?: VersusSeason): EmbedBuilder {
  const clubId = profile.versus!.clubId;
  const battles = season?.battles.filter((battle) => battle.homeClubId === clubId || battle.awayClubId === clubId).sort((a, b) => a.roundId - b.roundId || a.id.localeCompare(b.id)).slice(0, 12) ?? [];
  const lines = battles.length ? battles.map((battle) => {
    const opponentId = battle.homeClubId === clubId ? battle.awayClubId : battle.homeClubId;
    const opponent = season?.clubs.find((club) => club.id === opponentId)?.name ?? opponentId;
    const score = battle.settlement ? `${battle.settlement.homeGoals}-${battle.settlement.awayGoals}` : battle.state;
    return `**R${battle.roundId}** · ${battle.homeClubId === clubId ? 'HOME' : 'AWAY'} vs **${opponent}** · ${score}`;
  }).join('\n') : 'Belum ada schedule Versus.';
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus!.club.name} · My Schedule`).setDescription(lines).setFooter({ text: 'Schedule menampilkan fixture season yang tersimpan pada Versus aggregate.' });
}

function versusRankingsEmbed(season: VersusSeason | undefined, profile: PlayerProfile, category: 'CLUB' | 'MVP' | 'SCORERS' | 'ASSISTS' | 'GOALKEEPERS' = 'CLUB'): EmbedBuilder {
  const clubs = season?.clubs ?? [];
  const players = clubs.flatMap((club) => club.roster.map((player) => ({ ...player, clubName: club.name })));
  const standings = season ? getVersusStandings(season).slice(0, 8).map((standing) => `${standing.rank}. **${standing.clubName}** · ${standing.points} pts · ${standing.wins}-${standing.draws}-${standing.losses}`).join('\n') : '-';
  const sorted = category === 'ASSISTS' ? players.sort((a, b) => b.assists - a.assists || b.goals - a.goals) : category === 'MVP' ? players.sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists) || b.appearances - a.appearances) : players.sort((a, b) => b.goals - a.goals || b.appearances - a.appearances);
  const topPlayers = sorted.slice(0, 5);
  const playerText = topPlayers.length ? topPlayers.map((player, index) => `${index + 1}. **${player.name}** · ${category === 'ASSISTS' ? `${player.assists} assists` : category === 'MVP' ? `${player.goals + player.assists} G+A` : `${player.goals} goals`} · ${player.clubName}`).join('\n') : 'Belum ada player telemetry.';
  const title = category === 'CLUB' ? 'Club Ranking' : category === 'MVP' ? 'MVP Ranking' : category === 'SCORERS' ? 'Golden Boot · Top Scorers' : category === 'ASSISTS' ? 'Top Assists' : 'Goalkeeper Ranking';
  const description = category === 'CLUB' ? standings : category === 'GOALKEEPERS' ? 'Kategori Raja GK terlihat pada video Versus, tetapi saves/clean-sheet telemetry belum tersedia dalam recovered domain; angka tidak dibuat-buat.' : playerText;
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus!.club.name} · ${title}`).setDescription(description).addFields({ name: 'Observed tabs', value: 'Champion · MVP · Golden Boot · Top Assist · Raja GK' }, { name: 'Evidence boundary', value: category === 'CLUB' || category === 'SCORERS' || category === 'ASSISTS' || category === 'MVP' ? 'Recovered season/player telemetry rendered; exact original ranking tie-breakers remain RECOVERY_INFERRED.' : 'GK metrics are not recovered.' }).setFooter({ text: 'Ranking tabs mirror the verified Versus walkthrough without inventing unavailable metrics.' });
}

function versusGlobalRankingEmbed(season: VersusSeason | undefined, profile: PlayerProfile): EmbedBuilder {
  const standings = season ? getVersusStandings(season).slice(0, 8).map((standing) => `${standing.rank}. **${standing.clubName}** · ${standing.points} pts · ${standing.wins}-${standing.draws}-${standing.losses}`).join('\n') : 'Belum ada global ranking.';
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus!.club.name} · Global Ranking`).setDescription(standings).setFooter({ text: 'Current implementation exposes the season-wide ranking; cross-season/global server aggregation requires a canonical shared ranking store.' });
}

function parseVersusComponentContext(action: string): { action: string; battleId: string; rosterVersion: number } | undefined {
  const [name, encodedBattleId, versionText] = action.split(':');
  if (!encodedBattleId || !versionText) return undefined;
  const rosterVersion = Number(versionText);
  if (!Number.isInteger(rosterVersion) || rosterVersion < 1) throw new Error('Versus component memiliki roster version yang tidak valid. Buka ulang Versus Home.');
  return { action: name, battleId: decodeURIComponent(encodedBattleId), rosterVersion };
}

function draftLineup(draft: VersusDraft): string[] {
  return (['GK', 'DF', 'MF', 'FW'] as VersusPosition[]).flatMap((position) => draft.selected[position]);
}

function draftSummary(draft: VersusDraft, club: import('../domain/types.js').VersusClub): string {
  const names = new Map(club.roster.map((player) => [player.id, player.name]));
  const lineup = draftLineup(draft).map((id) => names.get(id) ?? id).join(', ') || 'Belum lengkap';
  const bench = draft.substitutes.map((id) => names.get(id) ?? id).join(', ') || 'Tidak ada';
  return `Formation **${draft.formation}** · Tactic **${TACTICS[draft.tactic].name}**\nXI: ${lineup}\nCaptain: ${names.get(draft.captain ?? '') ?? 'Belum dipilih'}\nSubs: ${bench}`;
}

export async function handleCommand(interaction: ChatInputCommandInteraction, store: PlayerStore): Promise<void> {
  const rootCommand = interaction.commandName;
  const command = resolveModeCommand(rootCommand, interaction.options.getSubcommand(false) ?? undefined, interaction.options.getSubcommandGroup(false) ?? undefined);
  try {
    if (!interaction.replied && !interaction.deferred) await interaction.deferReply();
    if (command === 'play') {
      const profile = await store.get(interaction.user.id);
      await interaction.editReply({ embeds: [gameHomeEmbed(profile ?? undefined)], components: mainMenuControls(interaction.user.id) });
      return;
    }
    if (command === 'start') {
      const existing = await store.get(interaction.user.id);
      if (existing) {
        await interaction.editReply({ content: 'Profil Anda sudah ada. Gunakan `/profile` untuk melihatnya.' });
        return;
      }
      const position = interaction.options.getString('position', true) as Position;
      const profile = createPlayerProfile(interaction.user.id, interaction.user.globalName ?? interaction.user.username, position);
      await store.save(profile);
      await interaction.editReply({ embeds: [playerWeeklyEmbed(profile)], components: playerWeeklyControls(interaction.user.id, profile.weekStage ?? 'READY') });
      return;
    }

    if (command === 'profile') {
      const profile = await requireProfile(interaction, store);
      if (profile) {
        const enriched = ensureClubState(recoverPlayer(profile));
        await store.save(enriched);
        await interaction.editReply({ embeds: [playerWeeklyEmbed(enriched)], components: playerWeeklyControls(interaction.user.id, enriched.weekStage ?? 'READY') });
      }
      return;
    }

    if (command === 'train') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const ability = interaction.options.getString('ability', true) as AbilityId;
      const result = trainPlayer(profile, ability);
      await store.save(result.profile);
      const levelText = result.levelUp ? '\n**Level ability naik.**' : '';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Training selesai').setDescription(`**${formatAbility(result.ability)}** bertambah dari **${result.statBefore}** menjadi **${result.statAfter}**. EXP diperoleh: **${result.expGained}**.${levelText}`).addFields({ name: 'Sisa energi', value: `${result.profile.energy}/${result.profile.maxEnergy}`, inline: true }, { name: 'Player rating', value: `${getRating(result.profile)}`, inline: true }, { name: 'Next step', value: 'Lanjutkan training lain atau tekan **Next Week** pada Weekly Hub.', inline: false })], components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'READY') });
      return;
    }

    if (command === 'skills') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = ensureGameplayState(profile);
      await store.save(enriched);
      const tricks = Object.values(TRICK_CATALOG).map((trick) => `${enriched.unlockedTricks?.includes(trick.id) ? 'UNLOCKED' : 'LOCKED'} · **${trick.name}** · requires ${Object.entries(trick.requires).map(([skill, level]) => `${DETAILED_SKILL_LABELS[skill as DetailedSkillId]} ${level}`).join(', ')}`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.displayName} · Detailed Skills`).setDescription(formatDetailedSkills(enriched)).addFields({ name: 'Gameplay state', value: formatGameplayStatus(enriched) }, { name: 'Tricks', value: tricks || 'Belum ada trick catalog.' })], components: playerWeeklyControls(interaction.user.id, enriched.weekStage ?? 'READY') });
      return;
    }

    if (command === 'train-skill') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const skill = interaction.options.getString('skill', true) as DetailedSkillId;
      const result = trainDetailedSkill(profile, skill);
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Detailed training dimulai').setDescription(`**${DETAILED_SKILL_LABELS[result.skill]}**: Lv ${result.levelBefore} · reward **+${result.expGained} EXP** pada week ${result.profile.activeTraining?.completeAtWeek}.`).addFields({ name: 'Condition', value: `Energy ${result.profile.energy}/${result.profile.maxEnergy}`, inline: true }, { name: 'Macro rating', value: `${getRating(result.profile)}`, inline: true }).setFooter({ text: 'Gunakan tombol **Next Week** untuk menyelesaikan training order.' })], components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'READY') });
      return;
    }

    if (command === 'assign-exp') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const skill = interaction.options.getString('skill', true) as DetailedSkillId;
      const amount = interaction.options.getInteger('amount', true);
      const result = assignMatchExp(profile, { [skill]: amount });
      await store.save(result.profile);
      await interaction.editReply({ content: `EXP dialokasikan ke **${DETAILED_SKILL_LABELS[skill]}**: **${result.allocated}**. Sisa pending EXP: **${result.remaining}**.`, components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'READY') });
      return;
    }

    if (command === 'next-week') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = preparePlayerWeek(profile);
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Weekly Update · Week ${result.week}`).setDescription(result.narrative.join('\n')).addFields({ name: 'Stage', value: result.stage, inline: true }, { name: 'Condition', value: `HP ${result.profile.hp}/${result.profile.maxHp}\nEnergy ${result.profile.energy}/${result.profile.maxEnergy}`, inline: true }, { name: 'Next step', value: 'Tekan Play Match untuk melanjutkan ke hasil pertandingan.', inline: false })], components: playerWeeklyControls(interaction.user.id, result.stage) });
      return;
    }

    if (command === 'injury') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'view';
      if (action === 'view') {
        const enriched = ensureGameplayState(profile);
        await store.save(enriched);
        await interaction.editReply(enriched.injury ? `Cedera **${enriched.injury.severity}** · tersisa **${enriched.injury.weeksRemaining} minggu** · source ${enriched.injury.source}. Treatment used: ${enriched.injury.treatmentUsed ? 'yes' : 'no'}.` : 'Pemain sedang sehat.');
      } else {
        const treatment = action === 'expert-treatment' ? 'EXPERT' : 'BASIC';
        const result = treatInjury(profile, treatment);
        await store.save(result.profile);
        await interaction.editReply(`Treatment **${result.treatment}** selesai. Durasi dikurangi **${result.weeksRemoved} minggu**; biaya **${formatMoney(result.moneySpent)}**. ${result.profile.injury ? `Sisa cedera: ${result.profile.injury.weeksRemaining} minggu.` : 'Cedera sudah pulih.'}`);
      }
      return;
    }

    if (command === 'trick') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'list';
      if (action === 'train') {
        const trickId = interaction.options.getString('trick_id');
        if (!trickId) throw new Error('Masukkan trick_id, contoh `bicycle-kick`.');
        const result = startTrickTraining(profile, trickId);
        await store.save(result.profile);
        await interaction.editReply(result.message);
      } else {
        const enriched = ensureGameplayState(profile);
        await store.save(enriched);
        const list = Object.values(TRICK_CATALOG).map((trick) => `${enriched.unlockedTricks?.includes(trick.id) ? 'UNLOCKED' : 'LOCKED'} · **${trick.id}** — ${trick.name}; requires ${Object.entries(trick.requires).map(([skill, level]) => `${DETAILED_SKILL_LABELS[skill as DetailedSkillId]} ${level}`).join(', ')}`).join('\n');
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Trick Training').setDescription(list)] });
      }
      return;
    }

    if (command === 'trainer') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'list';
      if (action === 'hire') {
        const trainerId = interaction.options.getString('trainer_id');
        if (!trainerId) throw new Error('Masukkan trainer_id, contoh `junior-physical`.');
        const result = hireTrainer(profile, trainerId);
        await store.save(result.profile);
        await interaction.editReply(result.message);
      } else if (action === 'release') {
        const result = releaseTrainer(profile);
        await store.save(result.profile);
        await interaction.editReply(result.message);
      } else {
        const enriched = ensureGameplayState(profile);
        await store.save(enriched);
        const list = listTrainerCatalog().map((trainer) => `${enriched.trainer?.id === trainer.id && enriched.trainer.active ? 'ACTIVE' : 'AVAILABLE'} · **${trainer.id}** · ${trainer.tier} · ${trainer.type} · ratio ${(trainer.ratio * 100).toFixed(0)}% · ${formatMoney(trainer.weeklyCost)}/week`).join('\n');
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Personal Trainers').setDescription(list)] });
      }
      return;
    }

    if (command === 'culture') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const subject = interaction.options.getString('subject', true) as CultureSubject;
      const result = startCultureStudy(profile, subject);
      await store.save(result.profile);
      await interaction.editReply(result.message);
      return;
    }

    if (command === 'honors') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = ensureGameplayState(profile);
      await store.save(enriched);
      const categories = (['PERSONAL', 'TEAM', 'NATIONAL'] as const).map((category) => {
        const honors = enriched.honors!.filter((honor) => honor.category === category);
        return `**${HONOR_CATEGORY_LABELS[category]}**\n${honors.length ? honors.map((honor) => `${honor.title} · season ${honor.season}`).join('\n') : 'Belum ada honor.'}`;
      }).join('\n\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Hall of Honor').setDescription(categories)] });
      return;
    }

    if (command === 'world-footballer') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = ensureGameplayState(profile);
      await store.save(enriched);
      const award = enriched.worldFootballer;
      await interaction.editReply(award ? `World Footballer season **${award.season}**: **${award.winner}**. User score: **${award.userScore}**. Result: **${award.userWon ? 'WIN' : 'candidate'}**.` : 'Belum ada hasil World Footballer. Selesaikan satu season melalui /next-week.');
      return;
    }

    if (command === 'retire') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = retirePlayer(profile);
      await store.save(result.profile);
      await interaction.editReply(result.message);
      return;
    }

    if (command === 'rebirth') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = rebirthPlayer(profile);
      await store.save(result.profile);
      await interaction.editReply(result.message);
      return;
    }

    if (command === 'match') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = playPreparedWeek(profile);
      await store.save(result.profile);
      const outcomeLabel = result.match?.outcome === 'WIN' ? 'VICTORY' : result.match?.outcome === 'DRAW' ? 'DRAW' : result.match?.outcome === 'LOSS' ? 'DEFEAT' : 'NO MATCH';
      const matchText = result.match ? `${result.profile.club} ${result.match.playerGoals}–${result.match.opponentGoals} ${result.match.opponent}` : 'Tidak ada match karena kondisi atau cedera.';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${outcomeLabel} · Week ${result.week}`).setDescription(`${matchText}\n\n${result.narrative.join('\n')}`).addFields({ name: 'Player rating', value: result.match ? `${result.match.playerRating}` : '-', inline: true }, { name: 'Pending EXP', value: `${result.expAwaitingAssignment}`, inline: true }, { name: 'Condition', value: `HP ${result.profile.hp}/${result.profile.maxHp}\nEnergy ${result.profile.energy}/${result.profile.maxEnergy}`, inline: true }).setFooter({ text: result.expAwaitingAssignment > 0 ? 'Pilih Assign EXP sebelum melanjutkan.' : 'Kembali ke Weekly Hub untuk cycle berikutnya.' })], components: result.expAwaitingAssignment > 0 ? pendingExpControls(interaction.user.id) : playerWeeklyControls(interaction.user.id, result.stage) });
      return;
    }

    if (command === 'league' || command === 'standings') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = ensureClubState(recoverPlayer(profile));
      await store.save(enriched);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.club} · Season ${enriched.league.season}`).setDescription(formatClubStanding(enriched)).addFields({ name: 'Progress', value: `Matchday **${enriched.league.matchday}**\nPoints **${enriched.league.points}**\nRecord **${enriched.league.wins}-${enriched.league.draws}-${enriched.league.losses}**\nGoals **${enriched.league.goalsFor}–${enriched.league.goalsAgainst}**` })] });
      return;
    }

    if (command === 'club') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = ensureClubState(profile);
      await store.save(enriched);
      const club = enriched.clubState!;
      const fixture = getNextClubFixture(enriched);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${club.name} · Club Office`).setDescription(`Club rating **${getClubRating(enriched)}** · Level **${club.level}**`).addFields({ name: 'Resources', value: `Prestige **${club.prestige}**\nAssets **${formatMoney(club.assets)}**\nSalary budget **${formatMoney(club.salaryBudget)}**`, inline: true }, { name: 'Strategy', value: `Formation **${club.formation}**\nTactic **${TACTICS[club.tactic].name}**\n${TACTICS[club.tactic].description}`, inline: true }, { name: 'Next fixture', value: fixture ? `Matchday ${fixture.matchday}: ${fixture.homeClub} vs ${fixture.awayClub}\n${fixture.playedAt}` : 'Tidak ada fixture tersisa.' })] });
      return;
    }

    if (command === 'clubs') {
      const league = interaction.options.getInteger('league') ?? undefined;
      const clubs = listOfficialClubs(league).slice(0, 40);
      const description = clubs.map((club) => `**${club.id}** · ${club.nameEn} · league ${club.league} · grade ${club.grade} · prestige ${club.prestige.toFixed(2)}`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Official Clubs${league ? ` · League ${league}` : ''}`).setDescription(description || 'Tidak ada club untuk filter ini.').setFooter({ text: 'Gunakan /join-club club_id:<id> untuk pindah klub.' })] });
      return;
    }

    if (command === 'join-club') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const clubId = interaction.options.getInteger('club_id', true);
      const updated = joinOfficialClub(profile, clubId);
      await store.save(updated);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Transfer · ${updated.club}`).setDescription(`Anda bergabung dengan **${updated.club}**.\nOfficial club ID: **${updated.clubState?.officialId}**\nProvenance: **${updated.clubState?.provenance}**\nSaldo: **${formatMoney(updated.money)}**`)] });
      return;
    }

    if (command === 'squad') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = ensureClubState(profile);
      await store.save(enriched);
      const roster = enriched.clubState!.roster.map((player) => `${player.id} · ${player.name} · ${player.position} · OVR ${player.overall} · HP ${player.hp}/${player.maxHp}${player.isUserPlayer ? ' · **YOU**' : ''}`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.club} · Squad`).setDescription(roster.slice(0, 3900)).addFields({ name: 'Tip', value: 'Gunakan ID pemain pada `/sell-player` untuk melepas pemain non-user.' })] });
      return;
    }

    if (command === 'formation') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const formation = interaction.options.getString('id', true) as keyof typeof FORMATIONS;
      const mode = interaction.options.getString('mode') ?? (rootCommand === 'coach' ? 'COACH' : 'PLAYER');
      if (mode === 'COACH' && !profile.coach) throw new Error('Karier Coach belum dibuat. Jalankan `/coach-career action:start`.');
      const updated = setClubFormation(profile, formation, new Date(), mode === 'COACH' ? 'coachClubState' : 'clubState');
      await store.save(updated);
      await interaction.editReply(`Formasi **${mode}** diubah menjadi **${FORMATIONS[formation].name}**.`);
      return;
    }

    if (command === 'tactic') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const tactic = interaction.options.getString('id', true) as keyof typeof TACTICS;
      const mode = interaction.options.getString('mode') ?? (rootCommand === 'coach' ? 'COACH' : 'PLAYER');
      if (mode === 'COACH' && !profile.coach) throw new Error('Karier Coach belum dibuat. Jalankan `/coach-career action:start`.');
      const updated = setClubTactic(profile, tactic, new Date(), mode === 'COACH' ? 'coachClubState' : 'clubState');
      await store.save(updated);
      await interaction.editReply(`Taktik **${mode}** diubah menjadi **${TACTICS[tactic].name}** — ${TACTICS[tactic].description}`);
      return;
    }

    if (command === 'club-match') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = playClubMatch(profile);
      await store.save(result.profile);
      const label = result.outcome === 'WIN' ? 'VICTORY' : result.outcome === 'DRAW' ? 'DRAW' : 'DEFEAT';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${label} · ${result.homeGoals}–${result.awayGoals}`).setDescription(result.commentary.join('\n')).addFields({ name: 'Fixture', value: `${result.fixture.homeClub} vs ${result.fixture.awayClub}`, inline: true }, { name: 'Halftime', value: `${result.halftime.homeGoals}–${result.halftime.awayGoals}`, inline: true }, { name: 'MVP', value: `${result.mvp.name} · OVR ${result.mvp.overall}`, inline: true }, { name: 'Club resources', value: `${formatMoney(result.profile.clubState!.assets)} assets\n${result.profile.clubState!.prestige} prestige`, inline: true })] });
      return;
    }

    if (command === 'coach-career') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'status';
      const updated = action === 'start' ? createCoachCareer(profile, interaction.user.globalName ?? interaction.user.username) : profile;
      if (!updated.coach) throw new Error('Karier Coach belum dibuat. Pilih action `start` terlebih dahulu.');
      await store.save(updated);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${updated.coach.coachName} · Coach Career`).setDescription(formatCoachProfile(updated)).setFooter({ text: 'Coach Mode terpisah dari Player career; gunakan /coach-round untuk memainkan fixture.' })] });
      return;
    }

    if (command === 'coach-profile') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.coach) throw new Error('Karier Coach belum dibuat. Jalankan `/coach-career action:start`.');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.coach.coachName} · Coach Profile`).setDescription(formatCoachProfile(profile)).addFields({ name: 'Club', value: `${profile.coachClubState?.name ?? profile.club} · tier ${profile.coachClubState?.leagueTier ?? 1}`, inline: true }, { name: 'Round', value: `${profile.coachClubState?.fixtures.filter((fixture) => fixture.played).length ?? 0}/${profile.coachClubState?.fixtures.length ?? 0}`, inline: true }, { name: 'Honors', value: `${profile.coach.honors.length}`, inline: true })] });
      return;
    }

    if (command === 'coach-event') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.coach) throw new Error('Karier Coach belum dibuat. Jalankan `/coach-career action:start`.');
      const event = profile.coach.event;
      const choiceId = interaction.options.getString('choice');
      if (!event || event.resolved) {
        await interaction.editReply('Tidak ada Coach event yang menunggu keputusan. Event baru muncul secara berkala setelah `/coach-round`.');
        return;
      }
      if (choiceId) {
        const updated = resolveCoachEvent(profile, choiceId);
        await store.save(updated);
        await interaction.editReply(`Coach event **${event.title}** diselesaikan. Approval sekarang **${updated.coach!.approval}/100**; unassigned Coach EXP **${updated.coach!.unassignedExp}**.`);
      } else {
        const choices = event.choices.map((choice) => `**${choice.id}** — ${choice.label}: ${choice.description}`).join('\n');
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Coach Event · ${event.title}`).setDescription(`${event.description}\n\n${choices}`).setFooter({ text: 'Gunakan /coach-event choice:<id> untuk memilih.' })] });
      }
      return;
    }

    if (command === 'coach-round') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = advanceCoachRound(profile);
      await store.save(result.profile);
      const eventText = result.event ? `\nCoach event baru: **${result.event.title}** — gunakan /coach-event untuk mengambil keputusan.` : '';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Coach Round · ${result.match.outcome}`).setDescription(result.match.commentary.join('\n') + eventText).addFields({ name: 'Score', value: `${result.match.homeGoals}–${result.match.awayGoals} (HT ${result.match.halftime.homeGoals}–${result.match.halftime.awayGoals})`, inline: true }, { name: 'Coach EXP', value: `+${result.coachExp} · pending ${result.profile.coach!.unassignedExp}`, inline: true }, { name: 'Approval', value: `${result.profile.coach!.approval}/100 (${result.approvalDelta >= 0 ? '+' : ''}${result.approvalDelta})`, inline: true }, { name: 'Board target', value: `${result.boardTarget.type} · rank ${result.boardTarget.progressRank ?? '-'}/${result.boardTarget.targetRank}`, inline: true })] });
      return;
    }

    if (command === 'coach-exp') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const ability = interaction.options.getString('ability', true) as CoachAbilityId;
      const amount = interaction.options.getInteger('amount', true);
      const result = assignCoachExp(profile, { [ability]: amount });
      await store.save(result.profile);
      await interaction.editReply(`Coach EXP **${amount}** dialokasikan ke **${COACH_ABILITY_LABELS[ability]}**. Sisa EXP **${result.remaining}**; level naik **${result.levelsGained}**.`);
      return;
    }

    if (command === 'coach-job') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'list';
      const offerId = interaction.options.getString('offer_id');
      if (action === 'generate') {
        const result = generateJobOffer(profile);
        await store.save(result.profile);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Coach job offer').setDescription(`**${result.offer.clubName}** membuka kontrak Coach.`).addFields({ name: 'Offer ID', value: result.offer.id }, { name: 'Salary', value: `${formatMoney(result.offer.salary)}`, inline: true }, { name: 'Target', value: `rank ${result.offer.targetRank}`, inline: true }, { name: 'Duration', value: `${result.offer.durationYears} season`, inline: true })] });
      } else if (action === 'accept') {
        if (!offerId) throw new Error('Masukkan offer_id dari `/coach-job action:list`.');
        const updated = acceptJobOffer(profile, offerId);
        await store.save(updated);
        await interaction.editReply(`Job offer diterima. Coach sekarang memimpin **${updated.coachClubState?.name ?? updated.club}** dengan target **${updated.coach!.boardTarget.type}**.`);
      } else if (action === 'decline') {
        if (!offerId) throw new Error('Masukkan offer_id dari `/coach-job action:list`.');
        const updated = declineJobOffer(profile, offerId);
        await store.save(updated);
        await interaction.editReply(`Job offer **${offerId}** ditolak.`);
      } else {
        if (!profile.coach) throw new Error('Karier Coach belum dibuat. Jalankan `/coach-career action:start`.');
        const offers = profile.coach.jobOffers.filter((offer) => offer.status === 'OPEN');
        await interaction.editReply(offers.length ? offers.map((offer) => `**${offer.id}** · ${offer.clubName} · salary ${formatMoney(offer.salary)} · target rank ${offer.targetRank}`).join('\n') : 'Belum ada job offer terbuka. Gunakan `/coach-job action:generate`.');
      }
      return;
    }

    if (command === 'coach-retire') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const updated = retireCoach(profile);
      await store.save(updated);
      await interaction.editReply(`Coach **${updated.coach!.coachName}** resmi pensiun. Legacy honor disimpan; gunakan /coach-rebirth untuk memulai ulang.`);
      return;
    }

    if (command === 'coach-rebirth') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const updated = rebirthCoach(profile);
      await store.save(updated);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Coach rebirth complete').setDescription(formatCoachProfile(updated)).setFooter({ text: 'Bonus rebirth berasal dari honor legacy dan diberi label RECOVERY_INFERRED.' })] });
      return;
    }

    if (command === 'season-end') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = profile.coach?.status === 'EMPLOYED' ? ensureClubState(profile, new Date(), undefined, 'coachClubState') : ensureClubState(profile);
      const clubState = enriched.coach?.status === 'EMPLOYED' ? enriched.coachClubState : enriched.clubState;
      if (clubState?.fixtures.some((fixture) => !fixture.played)) throw new Error('Belum semua fixture selesai. Selesaikan seluruh pertandingan sebelum menutup musim.');
      const updated = enriched.coach?.status === 'EMPLOYED' ? settleCoachSeason(enriched) : finishSeason(enriched);
      await store.save(updated);
      const coachText = updated.coach ? ` Coach board: **${updated.coach.boardTarget.type}**, approval **${updated.coach.approval}/100**, status **${updated.coach.status}**.` : '';
      const seasonClub = updated.coachClubState ?? updated.clubState;
      const completedSeason = updated.coach ? updated.coach.season - 1 : updated.league.season - 1;
      const activeSeason = updated.coach ? updated.coach.season : updated.league.season;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Season ${completedSeason} selesai`).setDescription(`Season baru **${activeSeason}** dimulai. Champions League: **${seasonClub?.championsLeagueQualified ? 'qualified' : 'not qualified'}**.${coachText}`)] });
      return;
    }

    if (command === 'versus-bid') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      if (!profile.versus?.groupCode) throw new Error('Versus belum aktif. Buka `/versus-profile` terlebih dahulu.');
      const listingId = interaction.options.getString('listing_id', true).trim();
      const amount = interaction.options.getInteger('amount', true);
      const result = await withVersusGroupLock(store, profile.versus.groupCode, async () => {
        const current = await versusSeasonFor(store, profile.versus!.groupCode!, new Date());
        const prepared = await prepareVersusMarket(store, current.season, new Date());
        const members = prepared.profiles.length > 0 ? prepared.profiles : current.members;
        const bid = placeVersusBid(members, prepared.season, profile.userId, listingId, amount, new Date());
        const saved = await persistVersusEconomy(store, bid.profiles, bid.season, new Date());
        return { listing: bid.listing, profile: saved.find((item) => item.userId === profile.userId) ?? profile };
      });
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Versus Deal bid reserved').setDescription(`Bid untuk **${result.listing.player.name}** tercatat sebesar **${result.listing.currentBid} coin**.`).addFields({ name: 'Listing', value: result.listing.id }, { name: 'Status', value: result.listing.status, inline: true }, { name: 'Expires', value: result.listing.endsAt, inline: true }, { name: 'Wallet', value: `${result.profile.versus!.versusCoin} coin total · reservation aktif`, inline: true }).setFooter({ text: 'Coin baru didebit saat listing settled; reservation dilepas jika Anda di-outbid.' })] });
      return;
    }

    if (command === 'versus-join') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const groupCode = interaction.options.getString('group_code', true).trim().toUpperCase();
      const joined = await withVersusGroupLock(store, groupCode, async () => {
        const currentMembers = await versusMembers(store, groupCode);
        const existing = currentMembers.find((member) => member.versus?.season)?.versus?.season;
        if (existing && existing.state === 'ACTIVE' && (existing.currentRound > 1 || existing.battles.some((battle) => battle.state !== 'OPEN'))) throw new Error('Group Versus sudah mengunci season aktif; join baru berlaku pada season berikutnya.');
        if (!currentMembers.some((member) => member.userId === profile.userId) && currentMembers.length >= 8) throw new Error('Group Versus sudah penuh (maksimal 8 user; NPC mengisi slot tersisa).');
        const enrolled = assignVersusMatchmaking(profile, groupCode, new Date());
        await store.save(enrolled);
        const members = await versusMembers(store, groupCode);
        const season = createVersusSeason(groupCode, members);
        await persistVersusSeason(store, season, new Date());
        return { enrolled, season };
      });
      const joinedHome = versusHomeEmbed(joined.enrolled, joined.season);
      await interaction.editReply({ embeds: [joinedHome.setTitle('Versus assignment joined').setDescription(`Assigned team **${joined.enrolled.versus!.club.name}** masuk ke private group **${groupCode}**.\n\n${joinedHome.data.description ?? ''}`)], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (command === 'versus-profile') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const assigned = await ensurePublicVersusAssignment(store, profile, new Date());
      await interaction.editReply({ embeds: [versusHomeEmbed(assigned.profile, assigned.season)], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (command === 'versus-roster') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.versus?.groupCode) throw new Error('Versus assignment belum masuk competition. Jalankan `/versus-profile` atau gunakan `/versus-join group_code:<code>`.');
      const versus = profile.versus;
      const season = versus.season;
      const club = versus.club;
      const activeBattle = season?.battles.find((battle) => battle.roundId === season.currentRound && (battle.homeClubId === club.id || battle.awayClubId === club.id));
      const opponentId = activeBattle ? activeBattle.homeClubId === club.id ? activeBattle.awayClubId : activeBattle.homeClubId : undefined;
      const opponent = opponentId ? season?.clubs.find((item) => item.id === opponentId)?.name ?? opponentId : '-';
      const rosterLines = club.roster.map((player) => {
        const eligible = player.hp > 0 && player.status === 'AVAILABLE' && player.redCardBan === 0;
        return `**${player.id}** · ${player.position} · ${player.name} · HP ${player.hp}/${player.maxHp} · ${eligible ? 'ELIGIBLE' : `BLOCKED/${player.status}`}`;
      }).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${club.name} · Versus Roster`).setDescription(rosterLines).addFields({ name: 'Roster version', value: `${club.rosterVersion}`, inline: true }, { name: 'Battle ID', value: activeBattle?.id ?? '-', inline: true }, { name: 'Opponent', value: opponent, inline: true }, { name: 'Deadline', value: season?.roundDeadline ?? '-', inline: true }).setFooter({ text: 'Gunakan Lineup pada Versus Home untuk interactive setup. Command `/versus-lineup` tetap tersedia sebagai fallback.' })], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (command === 'versus-standings') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.versus?.groupCode) throw new Error('Versus assignment belum masuk competition. Jalankan `/versus-profile` atau gunakan `/versus-join group_code:<code>`.');
      const { season } = await versusSeasonFor(store, profile.versus.groupCode, new Date());
      await interaction.editReply({ embeds: [versusStandingsEmbed(season)], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (command === 'versus-lineup') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.versus?.groupCode) throw new Error('Versus assignment belum masuk competition. Jalankan `/versus-profile` atau gunakan `/versus-join group_code:<code>`.');
      const groupCode = profile.versus.groupCode;
      const battleId = interaction.options.getString('battle_id', true).trim();
      const lineup = parseIdList(interaction.options.getString('lineup', true));
      const substitutes = parseIdList(interaction.options.getString('substitutes'));
      const captainId = interaction.options.getString('captain', true).trim();
      const formation = interaction.options.getString('formation', true) as import('../domain/types.js').FormationId;
      const tactic = interaction.options.getString('tactic', true) as import('../domain/types.js').TacticId;
      const rosterVersion = interaction.options.getInteger('roster_version', true);
      const season = await withVersusGroupLock(store, groupCode, async () => {
        const current = await versusSeasonFor(store, groupCode, new Date());
        const next = submitVersusLineup(current.season, battleId, profile.userId, lineup, substitutes, captainId, formation, tactic, rosterVersion, new Date());
        await persistVersusSeason(store, next, new Date());
        return next;
      });
      const battle = season.battles.find((item) => item.id === battleId)!;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Versus lineup submitted').setDescription(`Battle **${battleId}** tersimpan untuk round **${season.currentRound}**. XI **${lineup.length}** · substitutes **${substitutes.length}** · formation **${formation}** · tactic **${tactic}**.`).addFields({ name: 'Roster version', value: `${rosterVersion}`, inline: true }, { name: 'Deadline', value: season.roundDeadline, inline: true }, { name: 'Battle state', value: battle.state, inline: true }).setFooter({ text: 'Submission dapat diperbarui sebelum deadline; roster version harus cocok.' })] });
      return;
    }

    if (command === 'versus-round') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.versus?.groupCode) throw new Error('Versus assignment belum masuk competition. Jalankan `/versus-profile` atau gunakan `/versus-join group_code:<code>`.');
      const groupCode = profile.versus.groupCode;
      const season = await withVersusGroupLock(store, groupCode, async () => {
        const current = await versusSeasonFor(store, groupCode, new Date());
        if (current.season.state !== 'ACTIVE') throw new Error('Season Versus sudah selesai. Gunakan `/versus-profile` untuk mendapatkan assignment berikutnya.');
        const next = processVersusRound(current.season, current.season.currentRound, new Date());
        await persistVersusSeason(store, next, new Date());
        return next;
      });
      const userClubId = profile.versus.clubId;
      const roundId = season.currentRound - 1;
      const battles = season.battles.filter((battle) => battle.roundId === roundId && (battle.homeClubId === userClubId || battle.awayClubId === userClubId));
      const output = battles.map(formatVersusBattle).join('\n\n') || 'Round diproses, tetapi battle user tidak ditemukan.';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Versus Round ${roundId} settled`).setDescription(output).setFooter({ text: 'Settlement asynchronous, seeded, dan duplicate-guarded per battle ID.' })], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (command === 'versus-season') {
      const profile = await requireProfile(interaction, store);
      if (!profile?.versus?.groupCode) throw new Error('Versus assignment belum masuk competition. Jalankan `/versus-profile` atau gunakan `/versus-join group_code:<code>`.');
      const action = interaction.options.getString('action') ?? 'status';
      const groupCode = profile.versus.groupCode;
      const season = await withVersusGroupLock(store, groupCode, async () => {
        const current = await versusSeasonFor(store, groupCode, new Date());
        if (action === 'settle') {
          if (current.season.state === 'FINISHED') return current.season;
          const settled = settleVersusSeason(current.season);
          await persistVersusSeason(store, settled, new Date());
          return settled;
        }
        return current.season;
      });
      const standing = getVersusStandings(season).find((item) => item.clubId === profile.versus!.clubId);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Versus Season · ${season.state}`).setDescription(`Season **${season.id}** · group **${season.groupCode}**\nRound **${Math.min(season.currentRound, 2 * (season.clubs.length - 1) + 1)}/${2 * (season.clubs.length - 1)}** · deadline **${season.roundDeadline}**`).addFields({ name: 'Your standing', value: standing ? `rank ${standing.rank} · ${standing.points} points · ${standing.wins}-${standing.draws}-${standing.losses}` : '-', inline: true }, { name: 'Rewards', value: season.state === 'FINISHED' ? `${season.rewards.find((item) => item.clubId === profile.versus!.clubId)?.money ?? 0} money · ${season.rewards.find((item) => item.clubId === profile.versus!.clubId)?.coin ?? 0} coin` : 'Belum dibagikan', inline: true })], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (command === 'daily') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const result = claimDailyReward(profile);
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Daily reward claimed').setDescription(`Anda menerima **${formatMoney(result.amount)} money** dan **${result.exp} EXP**.`).addFields({ name: 'Streak', value: `${result.streak} hari`, inline: true }, { name: 'Balance', value: formatMoney(result.profile.money), inline: true })] });
      return;
    }

    if (command === 'player-event-disabled') {
      await interaction.editReply('Player Event harian tidak digunakan. Event Player sekarang muncul secara acak pada **Weekly Update** dan diselesaikan melalui tombol **Weekly Event Decision**.');
      return;
    }

    if (command === 'market') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'list';
      const enriched = action === 'refresh' || !profile.market?.length ? refreshMarket(profile) : profile;
      await store.save(enriched);
      const listings = enriched.market!.filter((item) => item.status === 'OPEN').map((item) => `**${item.id}** · ${item.player.name} · ${item.player.position} · OVR ${item.player.overall} · **${formatMoney(item.price)}**`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Transfer Market').setDescription(listings || 'Market kosong. Gunakan action refresh.') .setFooter({ text: 'Gunakan /buy-player listing:<id> untuk membeli.' })] });
      return;
    }

    if (command === 'buy-player') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const listingId = interaction.options.getString('listing', true);
      const result = buyMarketPlayer(profile, listingId);
      await store.save(result.profile);
      await interaction.editReply(`Transfer berhasil: **${result.listing.player.name}** bergabung dengan klub untuk **${formatMoney(result.listing.price)}**.`);
      return;
    }

    if (command === 'sell-player') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const playerId = interaction.options.getString('player', true);
      const result = sellClubPlayer(profile, playerId);
      await store.save(result.profile);
      await interaction.editReply(`**${result.player.name}** dijual dengan harga **${formatMoney(result.price)}**.`);
      return;
    }

    if (command === 'contract') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'view';
      const current = getContractStatus(profile);
      if (action === 'sign') {
        if (current?.state === 'ACTIVE') throw new Error('Kontrak masih aktif.');
        const updated = current?.state === 'EXPIRED' ? renewContract(profile) : signContract(profile);
        await store.save(updated);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Contract updated').setDescription(formatContract(updated.contract))] });
      } else {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player contract').setDescription(formatContract(current))] });
      }
      return;
    }

    if (command === 'champions') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const action = interaction.options.getString('action') ?? 'status';
      const mode = (interaction.options.getString('mode') ?? (rootCommand === 'coach' ? 'COACH' : 'PLAYER')) as import('../domain/competition-engine.js').ChampionsLeagueMode;
      const modeLabel = mode === 'COACH' ? 'Coach Mode' : 'Player Mode';
      if (action === 'play') {
        const result = playChampionsLeague(profile, new Date(), undefined, mode);
        await store.save(result.profile);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Champions League · ${modeLabel} · ${result.status}`).setDescription(result.commentary.join('\n')).addFields({ name: 'Reward state', value: result.status === 'CHAMPION' ? 'Club assets and prestige increased in the selected mode.' : 'Continue the competition from the next round.', inline: true })] });
      } else {
        const enriched = startChampionsLeague(profile, new Date(), mode);
        await store.save(enriched);
        const state = mode === 'COACH' ? enriched.coach?.championsLeague : enriched.championsLeague;
        if (!state) throw new Error('Champions League state tidak tersedia.');
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Champions League · ${modeLabel} · Status`).setDescription(`Status **${state.status}**\nSeason **${state.season}**\nRound **${state.round}**\nOpponent **${state.opponent}**\nAggregate **${state.aggregate}**`).setFooter({ text: `Gunakan /champions action:play mode:${mode} untuk memainkan ronde.` })] });
      }
      return;
    }

    if (command === 'achievements') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const enriched = syncAchievements(profile);
      await store.save(enriched);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Achievements').setDescription(formatAchievements(enriched))] });
      return;
    }

    if (command === 'claim-achievement') {
      const profile = await requireProfile(interaction, store);
      if (!profile) return;
      const achievementId = interaction.options.getString('achievement', true);
      const result = claimAchievement(profile, achievementId);
      await store.save(result.profile);
      await interaction.editReply(`Achievement **${result.achievement.title}** diklaim: **${formatMoney(result.achievement.rewardMoney)} money** dan **${result.achievement.rewardExp} EXP**.`);
      return;
    }

    if (command === 'admin') {
      if (!ADMIN_USER_IDS.has(interaction.user.id)) throw new Error('Anda tidak memiliki akses admin.');
      const action = interaction.options.getString('action', true);
      const profiles = await store.all();
      if (action === 'stats') {
        const averageLevel = profiles.length ? profiles.reduce((sum, profile) => sum + profile.level, 0) / profiles.length : 0;
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Bot Operations').setDescription(`Profiles **${profiles.length}**\nAverage player level **${averageLevel.toFixed(2)}**\nPersistence **${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON'}**\nNode environment **${process.env.NODE_ENV ?? 'development'}**`)] });
      } else if (action === 'refresh-markets') {
        for (const profile of profiles) await store.save(refreshMarket(profile, new Date(), true));
        await interaction.editReply(`Market refreshed untuk **${profiles.length}** profile(s).`);
      }
      return;
    }

    if (command === 'help') {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Football Rising Star — Mode Select').setDescription('Pilih mode utama terlebih dahulu. Semua state Player, Coach, dan Versus tetap terisolasi. Formula yang belum memiliki evidence primer tetap diberi label RECOVERY_INFERRED.').addFields({ name: 'PLAYER · karier individu', value: '`/player career start`, `/player career profile`, `/player career match`, `/player training train`, `/player training skills`, `/player club overview`, `/player honors list`' }, { name: 'COACH · manajemen klub', value: '`/coach career`, `/coach profile`, `/coach round`, `/coach event`, `/coach job`, `/coach formation`, `/coach tactic`, `/coach champions`' }, { name: 'VERSUS · multiplayer otomatis', value: '`/versus home`, `/versus profile`, `/versus roster`, `/versus lineup`, `/versus bid`, `/versus standings`, `/versus round`, `/versus season`' }, { name: 'Cara mulai', value: 'Player: `/player career start` lalu pilih position. Coach: `/coach career action:Start`. Versus: `/versus home`; assignment dan matchmaking dikelola sistem.' }, { name: 'Command layout', value: 'Registry guild sekarang memakai root command berbasis mode. Command datar lama tidak lagi didaftarkan agar menu Discord tetap rapi.' })] });
      return;
    }

    await interaction.editReply({ content: 'Command belum dikenali.' });
  } catch (error) {
    log('error', 'command_failed', { command, userId: interaction.user.id, error });
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan internal.';
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.editReply({ content: message });
  }
}


function componentOwner(customId: string, userId: string): string {
  const [namespace, ownerId, ...parts] = customId.split(':');
  const action = parts.join(':');
  if (namespace !== 'frs' || ownerId !== userId || !action) throw new Error('Komponen ini bukan milik profile Anda. Jalankan command dari profile Anda sendiri.');
  return action;
}

export async function handleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction, store: PlayerStore): Promise<void> {
  try {
    const action = componentOwner(interaction.customId, interaction.user.id);
    if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ ephemeral: true });
    let profile = await store.get(interaction.user.id);

    if (action === 'menu-home') {
      await interaction.editReply({ embeds: [gameHomeEmbed(profile ?? undefined)], components: mainMenuControls(interaction.user.id) });
      return;
    }

    if (action === 'menu-player') {
      if (!profile) {
        await interaction.editReply({ embeds: [gameHomeEmbed().setTitle('Player Mode · Create Player').setDescription('Player Mode dimulai dari pemain muda. Pilih posisi untuk membuat profil tanpa mengetik command.')], components: playerCreationControls(interaction.user.id) });
      } else {
        const enriched = ensureGameplayState(profile);
        await store.save(enriched);
        await interaction.editReply({ embeds: [playerWeeklyEmbed(enriched)], components: playerWeeklyControls(interaction.user.id, enriched.weekStage ?? 'READY') });
      }
      return;
    }

    if (action === 'menu-coach') {
      if (!profile) {
        await interaction.editReply({ embeds: [gameHomeEmbed().setTitle('Coach Mode · Account Setup').setDescription('Coach Mode memakai account profile yang sama, tetapi career dan club state tetap terisolasi. Buat Player profile terlebih dahulu melalui menu posisi.')], components: playerCreationControls(interaction.user.id) });
        return;
      }
      const updated = profile.coach ? profile : createCoachCareer(profile, interaction.user.globalName ?? interaction.user.username);
      await store.save(updated);
      await interaction.editReply({ embeds: [coachHomeEmbed(updated)], components: coachControls(interaction.user.id) });
      return;
    }

    if (action === 'menu-versus') {
      if (!profile) {
        await interaction.editReply({ embeds: [gameHomeEmbed().setTitle('Versus Mode · Account Setup').setDescription('Versus memakai aggregate multiplayer yang terpisah. Buat account profile melalui menu posisi; assignment team dan competition akan dikelola sistem.')], components: playerCreationControls(interaction.user.id) });
        return;
      }
      const assigned = await ensurePublicVersusAssignment(store, profile, new Date());
      profile = assigned.profile;
      await interaction.editReply({ embeds: [versusHomeEmbed(profile, assigned.season)], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (action === 'player-create-select') {
      if (!interaction.isStringSelectMenu()) throw new Error('Pilih posisi Player melalui menu yang tersedia.');
      if (profile) {
        const enriched = ensureGameplayState(profile);
        await store.save(enriched);
        await interaction.editReply({ embeds: [playerWeeklyEmbed(enriched)], components: playerWeeklyControls(interaction.user.id, enriched.weekStage ?? 'READY') });
        return;
      }
      const position = interaction.values[0] as Position;
      if (!['GK', 'DF', 'MF', 'FW'].includes(position)) throw new Error('Posisi Player tidak valid.');
      profile = createPlayerProfile(interaction.user.id, interaction.user.globalName ?? interaction.user.username, position, new Date());
      await store.save(profile);
      await interaction.editReply({ embeds: [playerWeeklyEmbed(profile)], components: playerWeeklyControls(interaction.user.id, profile.weekStage ?? 'READY') });
      return;
    }

    if (action === 'coach-event-select') {
      if (!profile?.coach || !interaction.isStringSelectMenu()) throw new Error('Coach event tidak valid atau sudah kedaluwarsa.');
      const event = profile.coach.event;
      if (!event || event.resolved) throw new Error('Tidak ada Coach event yang menunggu keputusan.');
      const updated = resolveCoachEvent(profile, interaction.values[0]);
      await store.save(updated);
      await interaction.editReply({ embeds: [coachHomeEmbed(updated).setTitle(`Coach Event Resolved · ${event.title}`)], components: coachControls(interaction.user.id) });
      return;
    }

    if (!profile) throw new Error('Profil belum dibuat. Pilih Player Mode dari Game Home untuk membuat profil.');

    if (action === 'coach-profile') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home.');
      await interaction.editReply({ embeds: [coachHomeEmbed(profile)], components: coachControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-round') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home.');
      const result = advanceCoachRound(profile);
      await store.save(result.profile);
      const eventText = result.event ? ` Coach event baru: **${result.event.title}**.` : '';
      await interaction.editReply({ embeds: [coachHomeEmbed(result.profile).setTitle(`Coach Round · ${result.match.outcome}`).setDescription(`${result.match.commentary.join('\n')}${eventText}`).addFields({ name: 'Score', value: `${result.match.homeGoals}–${result.match.awayGoals} (HT ${result.match.halftime.homeGoals}–${result.match.halftime.awayGoals})`, inline: true }, { name: 'Coach EXP', value: `+${result.coachExp} · pending ${result.profile.coach!.unassignedExp}`, inline: true }, { name: 'Approval', value: `${result.profile.coach!.approval}/100`, inline: true })], components: coachControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-club') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home.');
      const club = ensureClubState(profile, new Date(), undefined, 'coachClubState').coachClubState!;
      const fixture = club.fixtures.find((item) => !item.played);
      await store.save({ ...profile, coachClubState: club });
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${club.name} · Coach Club Office`).setDescription(`Club rating **${getClubRating({ ...profile, coachClubState: club })}** · Level **${club.level}**`).addFields({ name: 'Resources', value: `Prestige **${club.prestige}**\nAssets **${formatMoney(club.assets)}**\nSalary budget **${formatMoney(club.salaryBudget)}**`, inline: true }, { name: 'Strategy', value: `Formation **${club.formation}**\nTactic **${TACTICS[club.tactic].name}**`, inline: true }, { name: 'Next fixture', value: fixture ? `${fixture.homeClub} vs ${fixture.awayClub}\nMatchday ${fixture.matchday}` : 'Season selesai.' })], components: coachControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-event') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home.');
      const event = profile.coach.event;
      if (!event || event.resolved) {
        await interaction.editReply({ embeds: [coachHomeEmbed(profile).setTitle('Coach Board · No Pending Decision').setDescription('Belum ada management decision yang menunggu. Keputusan baru dapat muncul sebagai bagian dari timeline Coach setelah round.')], components: coachControls(interaction.user.id) });
      } else {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Coach Decision · ${event.family ?? 'MANAGEMENT'} · ${event.title}`).setDescription(`${event.description}\n\nTrigger: ${event.trigger ?? 'LEGACY'} · Blocking: ${event.blocking === false ? 'no' : 'yes'}`).addFields({ name: 'Choices', value: event.choices.map((choice) => `**${choice.label}** — ${choice.description}`).join('\n') })], components: coachEventControls(interaction.user.id, event.choices) });
      }
      return;
    }

    if (action === 'versus-profile' || action === 'versus-home' || action === 'versus-next' || action === 'versus-results' || action === 'versus-standings' || action === 'versus-registration' || action === 'versus-market' || action === 'versus-market-deal' || action === 'versus-market-scout' || action === 'versus-rewards' || action === 'versus-schedule' || action === 'versus-rankings' || action === 'versus-ranking-club' || action === 'versus-ranking-mvp' || action === 'versus-ranking-scorers' || action === 'versus-ranking-assists' || action === 'versus-ranking-goalkeepers' || action === 'versus-global-ranking' || action === 'versus-sponsor' || action === 'versus-sponsor-junior' || action === 'versus-sponsor-senior' || action === 'versus-sponsor-top') {
      let season: VersusSeason;
      if (!profile.versus?.groupCode) {
        const assigned = await ensurePublicVersusAssignment(store, profile, new Date());
        profile = assigned.profile;
        season = assigned.season;
      } else {
        season = (await versusSeasonFor(store, profile.versus.groupCode, new Date())).season;
      }
      if (action === 'versus-market' || action === 'versus-market-deal' || action === 'versus-market-scout') {
        const prepared = await withVersusGroupLock(store, season.groupCode, async () => prepareVersusMarket(store, season, new Date()));
        season = prepared.season;
        profile = prepared.profiles.find((item) => item.userId === interaction.user.id) ?? profile;
      }
      const rankingCategory = action === 'versus-ranking-mvp' ? 'MVP' : action === 'versus-ranking-scorers' ? 'SCORERS' : action === 'versus-ranking-assists' ? 'ASSISTS' : action === 'versus-ranking-goalkeepers' ? 'GOALKEEPERS' : 'CLUB';
      const marketTab = action === 'versus-market-scout' ? 'SCOUT' : 'DEAL';
      const sponsorSelection = action === 'versus-sponsor-junior' ? 'Junior' : action === 'versus-sponsor-senior' ? 'Senior' : action === 'versus-sponsor-top' ? 'Top' : undefined;
      const embed = action === 'versus-results' ? versusResultEmbed(profile, season) : action === 'versus-standings' ? versusStandingsEmbed(season) : action === 'versus-registration' ? versusRegistrationEmbed(profile, season) : action === 'versus-market' || action === 'versus-market-deal' || action === 'versus-market-scout' ? versusMarketEmbed(profile, season, marketTab) : action === 'versus-rewards' ? versusRewardsEmbed(profile, season) : action === 'versus-schedule' ? versusScheduleEmbed(profile, season) : action === 'versus-rankings' || action.startsWith('versus-ranking-') ? versusRankingsEmbed(season, profile, rankingCategory) : action === 'versus-sponsor' || action.startsWith('versus-sponsor-') ? versusSponsorEmbed(profile, sponsorSelection) : action === 'versus-global-ranking' ? versusGlobalRankingEmbed(season, profile) : versusHomeEmbed(profile, season);
      const controls = action === 'versus-market' || action === 'versus-market-deal' || action === 'versus-market-scout' ? versusMarketControls(interaction.user.id, marketTab) : action === 'versus-rankings' || action.startsWith('versus-ranking-') ? versusRankingControls(interaction.user.id) : action === 'versus-sponsor' || action.startsWith('versus-sponsor-') ? versusSponsorControls(interaction.user.id) : versusHomeControls(interaction.user.id);
      await interaction.editReply({ embeds: [embed], components: controls });
      return;
    }

    if (action === 'versus-next' || action === 'versus-lineup-start' || action.startsWith('versus-lineup-start:')) {
      if (!profile.versus?.groupCode) throw new Error('Belum ada Versus assignment. Buka kembali Versus Mode agar sistem menyiapkan pertandingan.');
      const context = action === 'versus-lineup-start' ? undefined : parseVersusComponentContext(action);
      const { season } = await versusSeasonFor(store, profile.versus.groupCode, new Date());
      const club = season.clubs.find((item) => item.ownerId === profile.userId) ?? season.clubs.find((item) => item.id === profile.versus!.clubId);
      if (!club) throw new Error('Club Versus tidak ditemukan pada season aktif.');
      const battle = context ? season.battles.find((item) => item.id === context.battleId) : activeVersusBattle(season, club.id);
      if (!battle) throw new Error('Tidak ada battle aktif untuk disusun.');
      if (context && context.rosterVersion !== club.rosterVersion) throw new Error('Roster sudah berubah. Buka ulang Versus Home sebelum menyusun lineup.');
      const currentSubmission = battle.homeClubId === club.id ? battle.homeSubmission : battle.awaySubmission;
      if (action === 'versus-next' && currentSubmission) {
        const deadline = new Date(season.roundDeadline);
        if (new Date() < deadline) {
          await interaction.editReply({ embeds: [versusHomeEmbed(profile, season).setTitle(`${club.name} · Submission Locked`).setDescription(`Battle **${battle.id}** vs **${versusOpponentName(season, battle, club.id)}** sudah memiliki submission. Round akan diproses setelah deadline **${season.roundDeadline}**.`)], components: versusHomeControls(interaction.user.id, 'Waiting') });
          return;
        }
        const processed = await withVersusGroupLock(store, profile.versus.groupCode, async () => {
          const current = await versusSeasonFor(store, profile.versus!.groupCode!, new Date());
          const next = processVersusRound(current.season, current.season.currentRound, new Date());
          await persistVersusSeason(store, next, new Date());
          return next;
        });
        const roundId = processed.currentRound - 1;
        const resultBattles = processed.battles.filter((item) => item.roundId === roundId && (item.homeClubId === club.id || item.awayClubId === club.id));
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Versus Round ${roundId} · Results`).setDescription(resultBattles.map(formatVersusBattle).join('\n\n') || 'Round selesai, tetapi result belum tersedia.')], components: versusHomeControls(interaction.user.id) });
        return;
      }
      const existingDraft = versusDrafts.get(interaction.user.id);
      const draft = context && existingDraft?.battleId === battle.id && existingDraft.rosterVersion === club.rosterVersion ? existingDraft : { groupCode: profile.versus.groupCode, battleId: battle.id, rosterVersion: club.rosterVersion, formation: club.formation, tactic: club.tactic, selected: { GK: [], DF: [], MF: [], FW: [] }, substitutes: [] };
      versusDrafts.set(interaction.user.id, draft);
      const opponentId = battle.homeClubId === club.id ? battle.awayClubId : battle.homeClubId;
      const opponentClub = season.clubs.find((item) => item.id === opponentId);
      const preview = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${club.name} · Pre-match Preview`).setDescription(`**${club.name}** vs **${opponentClub?.name ?? versusOpponentName(season, battle, club.id)}**\nBattle **${battle.id}**\nDeadline **${season.roundDeadline}**\nRoster version **${club.rosterVersion}**\n\nPilih formation dan tactic sebelum memilih XI.`).addFields(
        { name: 'Club rating (est.)', value: `${versusAverageRating(club)}`, inline: true },
        { name: 'Opponent rating (est.)', value: `${opponentClub ? versusAverageRating(opponentClub) : '-'}`, inline: true },
        { name: 'Attack / Defence', value: `${versusAttackRating(club)} / ${versusDefenceRating(club)}`, inline: true },
        { name: 'Opponent A / D', value: opponentClub ? `${versusAttackRating(opponentClub)} / ${versusDefenceRating(opponentClub)}` : '-', inline: true },
        { name: 'Next step', value: 'Formation → tactic → XI → captain/substitutes → confirm', inline: false }
      ).setFooter({ text: 'Rating preview is RECOVERY_INFERRED and is not an official server formula.' });
      await interaction.editReply({ embeds: [preview], components: versusSetupControls(interaction.user.id, draft.battleId, draft.rosterVersion, draft.formation, draft.tactic) });
      return;
    }

    if (action.startsWith('versus-pick-formation:') || action.startsWith('versus-pick-tactic:')) {
      if (!profile.versus?.groupCode || !interaction.isStringSelectMenu()) throw new Error('Setup Versus tidak valid. Buka ulang Versus Home.');
      const context = parseVersusComponentContext(action);
      if (!context) throw new Error('Setup Versus kedaluwarsa. Buka ulang Versus Home.');
      const draft = versusDrafts.get(interaction.user.id);
      if (!draft || draft.battleId !== context.battleId || draft.rosterVersion !== context.rosterVersion) throw new Error('Draft lineup tidak ditemukan atau sudah kedaluwarsa. Buka ulang Versus Home.');
      if (context.action === 'versus-pick-formation') {
        draft.formation = interaction.values[0] as FormationId;
        draft.selected = { GK: [], DF: [], MF: [], FW: [] };
        draft.captain = undefined;
        draft.substitutes = [];
      } else {
        draft.tactic = interaction.values[0] as TacticId;
      }
      const club = profile.versus.club;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Versus Setup').setDescription(draftSummary(draft, club))], components: versusSetupControls(interaction.user.id, draft.battleId, draft.rosterVersion, draft.formation, draft.tactic) });
      return;
    }

    if (action.startsWith('versus-lineup-squad:')) {
      if (!profile.versus || !profile.versus.groupCode) throw new Error('Belum ada Versus assignment. Buka kembali Versus Mode agar sistem menyiapkan pertandingan.');
      const context = parseVersusComponentContext(action);
      if (!context) throw new Error('Lineup draft kedaluwarsa. Buka ulang Versus Home.');
      const draft = versusDrafts.get(interaction.user.id);
      if (!draft || draft.battleId !== context.battleId || draft.rosterVersion !== context.rosterVersion) throw new Error('Draft lineup tidak ditemukan. Buka ulang Versus Home.');
      const club = profile.versus.club;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${club.name} · Choose Starting XI`).setDescription(`Formation **${draft.formation}** membutuhkan ${Object.entries(FORMATIONS[draft.formation].slots).map(([position, count]) => `${count} ${position}`).join(', ')}.\n\n${draftSummary(draft, club)}`)], components: versusPositionControls(interaction.user.id, draft.battleId, draft.rosterVersion, draft.formation, club.roster, draft.selected) });
      return;
    }

    if (action.startsWith('versus-pick-gk:') || action.startsWith('versus-pick-df:') || action.startsWith('versus-pick-mf:') || action.startsWith('versus-pick-fw:')) {
      if (!profile.versus || !interaction.isStringSelectMenu()) throw new Error('Lineup selection tidak valid. Buka ulang Versus Home.');
      const context = parseVersusComponentContext(action);
      if (!context) throw new Error('Lineup selection kedaluwarsa. Buka ulang Versus Home.');
      const draft = versusDrafts.get(interaction.user.id);
      if (!draft || draft.battleId !== context.battleId || draft.rosterVersion !== context.rosterVersion) throw new Error('Draft lineup tidak ditemukan atau roster sudah berubah.');
      const position = context.action.replace('versus-pick-', '').toUpperCase() as VersusPosition;
      if (!['GK', 'DF', 'MF', 'FW'].includes(position)) throw new Error('Posisi lineup tidak valid.');
      draft.selected[position] = [...interaction.values];
      draft.captain = undefined;
      draft.substitutes = [];
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus.club.name} · Starting XI`).setDescription(draftSummary(draft, profile.versus.club))], components: versusPositionControls(interaction.user.id, draft.battleId, draft.rosterVersion, draft.formation, profile.versus.club.roster, draft.selected) });
      return;
    }

    if (action.startsWith('versus-lineup-final:')) {
      if (!profile.versus) throw new Error('Belum ada Versus assignment. Buka kembali Versus Mode agar sistem menyiapkan pertandingan.');
      const context = parseVersusComponentContext(action);
      if (!context) throw new Error('Lineup review kedaluwarsa. Buka ulang Versus Home.');
      const draft = versusDrafts.get(interaction.user.id);
      if (!draft || draft.battleId !== context.battleId || draft.rosterVersion !== context.rosterVersion) throw new Error('Draft lineup tidak ditemukan atau roster sudah berubah.');
      const required = FORMATIONS[draft.formation].slots;
      if ((['GK', 'DF', 'MF', 'FW'] as VersusPosition[]).some((position) => draft.selected[position].length !== required[position])) {
        await interaction.editReply({ content: `Lineup belum lengkap untuk formation **${draft.formation}**. Pilih jumlah pemain sesuai slot di setiap menu.`, components: versusPositionControls(interaction.user.id, draft.battleId, draft.rosterVersion, draft.formation, profile.versus.club.roster, draft.selected) });
        return;
      }
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus.club.name} · Review Submission`).setDescription(`${draftSummary(draft, profile.versus.club)}\n\n**Roster version:** ${draft.rosterVersion}\n**Battle:** ${draft.battleId}\n\nPilih captain dan substitutes, lalu konfirmasi submission.`)], components: versusFinalizeControls(interaction.user.id, draft.battleId, draft.rosterVersion, draftLineup(draft), profile.versus.club.roster, draft.captain, draft.substitutes) });
      return;
    }

    if (action.startsWith('versus-pick-captain:') || action.startsWith('versus-pick-substitutes:')) {
      if (!profile.versus || !interaction.isStringSelectMenu()) throw new Error('Finalisasi lineup tidak valid.');
      const context = parseVersusComponentContext(action);
      if (!context) throw new Error('Finalisasi lineup kedaluwarsa.');
      const draft = versusDrafts.get(interaction.user.id);
      if (!draft || draft.battleId !== context.battleId || draft.rosterVersion !== context.rosterVersion) throw new Error('Draft lineup tidak ditemukan atau roster sudah berubah.');
      if (context.action === 'versus-pick-captain') draft.captain = interaction.values[0];
      else draft.substitutes = [...interaction.values];
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${profile.versus.club.name} · Review Submission`).setDescription(draftSummary(draft, profile.versus.club))], components: versusFinalizeControls(interaction.user.id, draft.battleId, draft.rosterVersion, draftLineup(draft), profile.versus.club.roster, draft.captain, draft.substitutes) });
      return;
    }

    if (action.startsWith('versus-lineup-confirm:')) {
      if (!profile.versus?.groupCode) throw new Error('Belum ada Versus assignment. Buka kembali Versus Mode agar sistem menyiapkan pertandingan.');
      const context = parseVersusComponentContext(action);
      if (!context) throw new Error('Submission kedaluwarsa. Buka ulang Versus Home.');
      const draft = versusDrafts.get(interaction.user.id);
      if (!draft || draft.battleId !== context.battleId || draft.rosterVersion !== context.rosterVersion || !draft.captain) throw new Error('Submission belum lengkap. Pilih captain sebelum konfirmasi.');
      const next = await withVersusGroupLock(store, profile.versus.groupCode, async () => {
        const current = await versusSeasonFor(store, profile.versus!.groupCode!, new Date());
        const submitted = submitVersusLineup(current.season, draft.battleId, profile.userId, draftLineup(draft), draft.substitutes, draft.captain!, draft.formation, draft.tactic, draft.rosterVersion, new Date());
        await persistVersusSeason(store, submitted, new Date());
        return submitted;
      });
      versusDrafts.delete(interaction.user.id);
      const saved = await store.get(interaction.user.id);
      if (!saved?.versus) throw new Error('Submission tersimpan tetapi profile Versus tidak dapat dibaca ulang.');
      await interaction.editReply({ embeds: [versusHomeEmbed(saved, next).setTitle(`${saved.versus.club.name} · Submission Locked`)], components: versusHomeControls(interaction.user.id) });
      return;
    }

    if (action === 'daily-reward') {
      const result = claimDailyReward(profile);
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Daily Reward').setDescription(`Anda menerima **${formatMoney(result.amount)} money** dan **${result.exp} EXP**.`).addFields({ name: 'Streak', value: `${result.streak} hari`, inline: true }, { name: 'Balance', value: formatMoney(result.profile.money), inline: true })], components: careerControls(interaction.user.id) });
      return;
    }

    if (action === 'injury') {
      const enriched = ensureGameplayState(profile);
      await store.save(enriched);
      const injuryText = enriched.injury ? `Cedera **${enriched.injury.severity}** · tersisa **${enriched.injury.weeksRemaining} minggu**\nSource: ${enriched.injury.source}\nTreatment used: ${enriched.injury.treatmentUsed ? 'yes' : 'no'}` : 'Pemain sedang sehat. Recovery tetap diproses oleh timeline maintenance.';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player · Injury & Recovery').setDescription(injuryText).addFields({ name: 'Condition', value: `HP ${enriched.hp}/${enriched.maxHp}\nEnergy ${enriched.energy}/${enriched.maxEnergy}` })], components: playerInjuryControls(interaction.user.id) });
      return;
    }

    if (action === 'injury-treatment-select' && interaction.isStringSelectMenu()) {
      const selected = interaction.values[0];
      if (selected === 'view') {
        const enriched = ensureGameplayState(profile);
        await store.save(enriched);
        await interaction.editReply({ content: enriched.injury ? `Cedera **${enriched.injury.severity}** tersisa **${enriched.injury.weeksRemaining} minggu**.` : 'Pemain sedang sehat.', components: playerInjuryControls(interaction.user.id) });
      } else {
        const result = treatInjury(profile, selected === 'expert-treatment' ? 'EXPERT' : 'BASIC');
        await store.save(result.profile);
        await interaction.editReply({ content: `Treatment **${result.treatment}** selesai. Durasi dikurangi **${result.weeksRemoved} minggu**; biaya **${formatMoney(result.moneySpent)}**. ${result.profile.injury ? `Sisa cedera: ${result.profile.injury.weeksRemaining} minggu.` : 'Cedera sudah pulih.'}`, components: careerControls(interaction.user.id) });
      }
      return;
    }

    if (action === 'honors') {
      const enriched = syncAchievements(ensureGameplayState(profile));
      await store.save(enriched);
      const categories = (['PERSONAL', 'TEAM', 'NATIONAL'] as const).map((category) => {
        const honors = enriched.honors!.filter((honor) => honor.category === category);
        return `**${HONOR_CATEGORY_LABELS[category]}**\n${honors.length ? honors.map((honor) => `${honor.title} · season ${honor.season}`).join('\n') : 'Belum ada honor.'}`;
      }).join('\n\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Hall of Honor').setDescription(categories)], components: careerControls(interaction.user.id) });
      return;
    }

    if (action === 'contract') {
      const current = getContractStatus(profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player Contract').setDescription(formatContract(current))], components: careerControls(interaction.user.id) });
      return;
    }

    if (action === 'player-champions' || action === 'player-champions-status') {
      const enriched = startChampionsLeague(profile, new Date(), 'PLAYER');
      await store.save(enriched);
      const state = enriched.championsLeague;
      if (!state) throw new Error('Player Champions League state tidak tersedia.');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Champions League · Player · Status').setDescription(`Status **${state.status}**\nSeason **${state.season}**\nRound **${state.round}**\nOpponent **${state.opponent}**\nAggregate **${state.aggregate}**`)], components: championsControls(interaction.user.id, 'PLAYER') });
      return;
    }

    if (action === 'player-champions-play') {
      const result = playChampionsLeague(profile, new Date(), undefined, 'PLAYER');
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Champions League · Player · ${result.status}`).setDescription(result.commentary.join('\n'))], components: championsControls(interaction.user.id, 'PLAYER') });
      return;
    }

    if (action === 'player-clubs') {
      const clubs = listOfficialClubs().filter((club) => club.id !== profile.clubState?.officialId).slice(0, 25);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Transfer · Choose Official Club').setDescription('Pilih klub tujuan untuk melihat preview transfer. Biaya dan perubahan kontrak akan ditampilkan sebelum konfirmasi.').addFields({ name: 'Current club', value: profile.club ?? 'Belum terdaftar', inline: true }, { name: 'Available clubs', value: `${clubs.length}`, inline: true })], components: officialClubControls(interaction.user.id, clubs) });
      return;
    }
    if (action === 'player-club-select' && interaction.isStringSelectMenu()) {
      const clubId = Number(interaction.values[0]);
      const club = listOfficialClubs().find((item) => item.id === clubId);
      if (!club) throw new Error('Official club tujuan tidak ditemukan.');
      const fee = officialClubTransferFee(clubId);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Transfer Preview').setDescription(`Pindah dari **${profile.club ?? 'Free Player'}** ke **${club.nameEn}**?`).addFields({ name: 'League / grade', value: `${club.league} · ${club.grade}`, inline: true }, { name: 'Prestige', value: club.prestige.toFixed(2), inline: true }, { name: 'Transfer fee', value: formatMoney(fee), inline: true }, { name: 'Balance after transfer', value: formatMoney(profile.money - fee), inline: true }, { name: 'Important', value: 'Contract lama akan ditutup dan club state akan dibuat ulang setelah transfer.', inline: false })], components: transferConfirmControls(interaction.user.id, clubId) });
      return;
    }
    if (action.startsWith('player-club-confirm:')) {
      const clubId = Number(action.split(':')[1]);
      const updated = joinOfficialClub(profile, clubId);
      await store.save(updated);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Transfer Complete · ${updated.club}`).setDescription(`Anda sekarang bermain untuk **${updated.club}**.`).addFields({ name: 'Official club ID', value: `${updated.clubState?.officialId}`, inline: true }, { name: 'Transfer fee', value: formatMoney(officialClubTransferFee(clubId)), inline: true }, { name: 'Balance', value: formatMoney(updated.money), inline: true }, { name: 'Next', value: 'Lihat Squad, League Table, atau mainkan fixture club berikutnya.', inline: false })], components: playerClubControls(interaction.user.id) });
      return;
    }
    if (action === 'player-club-match') {
      const result = playClubMatch(profile);
      await store.save(result.profile);
      const label = result.outcome === 'WIN' ? 'VICTORY' : result.outcome === 'DRAW' ? 'DRAW' : 'DEFEAT';
      const nextFixture = result.profile.clubState?.fixtures.find((fixture) => !fixture.played);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Club Match · ${label}`).setDescription(result.commentary.join('\n')).addFields({ name: 'Score', value: `${result.homeGoals}–${result.awayGoals} (HT ${result.halftime.homeGoals}–${result.halftime.awayGoals})`, inline: true }, { name: 'Fixture', value: `${result.fixture.homeClub} vs ${result.fixture.awayClub}`, inline: true }, { name: 'MVP', value: result.mvp.name, inline: true }, { name: 'Next fixture', value: nextFixture ? `MD ${nextFixture.matchday} · ${nextFixture.homeClub} vs ${nextFixture.awayClub}\n${nextFixture.playedAt?.slice(0, 10) ?? 'TBA'}` : 'Season selesai', inline: false })], components: playerClubControls(interaction.user.id) });
      return;
    }

    if (action === 'player-league') {
      const enriched = ensureClubState(recoverPlayer(profile));
      await store.save(enriched);
      const nextFixture = getNextClubFixture(enriched);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.club} · League Table`).setDescription(formatClubStanding(enriched)).addFields({ name: 'Progress', value: `Matchday ${enriched.league.matchday}\nPoints ${enriched.league.points}\nRecord ${enriched.league.wins}-${enriched.league.draws}-${enriched.league.losses}`, inline: true }, { name: 'Next fixture', value: nextFixture ? `MD ${nextFixture.matchday}\n${nextFixture.homeClub} vs ${nextFixture.awayClub}\n${nextFixture.playedAt?.slice(0, 10) ?? 'TBA'}` : 'Season selesai', inline: true })], components: playerClubControls(interaction.user.id) });
      return;
    }

    if (action === 'player-squad') {
      const enriched = ensureClubState(profile);
      await store.save(enriched);
      const roster = enriched.clubState!.roster.map((player) => `${player.name} · ${player.position} · OVR ${player.overall} · HP ${player.hp}/${player.maxHp}${player.isUserPlayer ? ' · YOU' : ''}`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.club} · Squad`).setDescription(roster.slice(0, 3900))], components: playerClubControls(interaction.user.id) });
      return;
    }

    if (action === 'player-market') {
      const enriched = profile.market?.length ? profile : refreshMarket(profile);
      await store.save(enriched);
      const listings = enriched.market!.filter((listing) => listing.status === 'OPEN').map((listing) => `${listing.player.name} · ${listing.player.position} · OVR ${listing.player.overall} · ${formatMoney(listing.price)}`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player Transfer Market').setDescription(listings || 'Market kosong.')], components: playerClubControls(interaction.user.id) });
      return;
    }

    if (action === 'player-strategy') {
      const enriched = ensureClubState(profile);
      await store.save(enriched);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player Club · Formation & Tactic').setDescription(`Formation **${enriched.clubState!.formation}**\nTactic **${TACTICS[enriched.clubState!.tactic].name}**\n${TACTICS[enriched.clubState!.tactic].description}`)], components: playerStrategyControls(interaction.user.id, enriched.clubState!.formation, enriched.clubState!.tactic) });
      return;
    }

    if (action === 'player-formation-select' && interaction.isStringSelectMenu()) {
      const updated = setClubFormation(profile, interaction.values[0] as FormationId, new Date(), 'clubState');
      await store.save(updated);
      const club = updated.clubState!;
      await interaction.editReply({ content: `Formation Player Club diubah menjadi **${club.formation}**.`, components: playerStrategyControls(interaction.user.id, club.formation, club.tactic) });
      return;
    }

    if (action === 'player-tactic-select' && interaction.isStringSelectMenu()) {
      const updated = setClubTactic(profile, interaction.values[0] as TacticId, new Date(), 'clubState');
      await store.save(updated);
      const club = updated.clubState!;
      await interaction.editReply({ content: `Tactic Player Club diubah menjadi **${TACTICS[club.tactic].name}**.`, components: playerStrategyControls(interaction.user.id, club.formation, club.tactic) });
      return;
    }

    if (action === 'player-culture') {
      await interaction.editReply({ content: 'Culture Study adalah aktivitas terpisah dari daily reward dan career incident. Pilih subjek untuk memulai.', components: playerCultureControls(interaction.user.id) });
      return;
    }

    if (action === 'culture-select' && interaction.isStringSelectMenu()) {
      const result = startCultureStudy(profile, interaction.values[0] as CultureSubject);
      await store.save(result.profile);
      await interaction.editReply({ content: result.message, components: trainingControls(interaction.user.id) });
      return;
    }

    if (action === 'player-tricks') {
      const enriched = ensureGameplayState(profile);
      await store.save(enriched);
      const list = Object.values(TRICK_CATALOG).map((trick) => `${enriched.unlockedTricks?.includes(trick.id) ? 'UNLOCKED' : 'LOCKED'} · ${trick.name}`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player · Tricks').setDescription(list)], components: trainingControls(interaction.user.id) });
      return;
    }

    if (action === 'player-trainer') {
      const list = listTrainerCatalog().map((trainer) => `${trainer.id} · ${trainer.tier} ${trainer.type} · weekly cost ${formatMoney(trainer.weeklyCost)} · ratio ${Math.round(trainer.ratio * 100)}%`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Player · Trainer').setDescription(list)], components: trainingControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-exp') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home.');
      const remaining = profile.coach.unassignedExp;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Coach · EXP Allocation').setDescription(`Pending Coach EXP: **${remaining}**. Pilih satu ability untuk mengalokasikan seluruh pending EXP.`)], components: remaining > 0 ? coachExpControls(interaction.user.id, remaining) : coachControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-exp-select' && interaction.isStringSelectMenu()) {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const remaining = profile.coach.unassignedExp;
      if (remaining <= 0) throw new Error('Tidak ada Coach EXP yang menunggu.');
      const ability = interaction.values[0] as CoachAbilityId;
      const result = assignCoachExp(profile, { [ability]: remaining });
      await store.save(result.profile);
      await interaction.editReply({ embeds: [coachHomeEmbed(result.profile).setTitle('Coach EXP Allocated').setDescription(`${remaining} EXP dialokasikan ke **${COACH_ABILITY_LABELS[ability]}**.`)], components: coachControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-strategy') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const club = ensureClubState(profile, new Date(), undefined, 'coachClubState').coachClubState!;
      await store.save({ ...profile, coachClubState: club });
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Coach · Formation & Tactic').setDescription(`Formation **${club.formation}**\nTactic **${TACTICS[club.tactic].name}**\n${TACTICS[club.tactic].description}`)], components: coachStrategyControls(interaction.user.id, club.formation, club.tactic) });
      return;
    }

    if ((action === 'coach-formation-select' || action === 'coach-tactic-select') && interaction.isStringSelectMenu()) {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const club = ensureClubState(profile, new Date(), undefined, 'coachClubState').coachClubState!;
      const updated = action === 'coach-formation-select' ? setClubFormation({ ...profile, coachClubState: club }, interaction.values[0] as FormationId, new Date(), 'coachClubState') : setClubTactic({ ...profile, coachClubState: club }, interaction.values[0] as TacticId, new Date(), 'coachClubState');
      await store.save(updated);
      const nextClub = updated.coachClubState!;
      await interaction.editReply({ content: `Coach strategy diperbarui: formation **${nextClub.formation}**, tactic **${TACTICS[nextClub.tactic].name}**.`, components: coachStrategyControls(interaction.user.id, nextClub.formation, nextClub.tactic) });
      return;
    }

    if (action === 'coach-job') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const offers = profile.coach.jobOffers.filter((offer) => offer.status === 'OPEN');
      const text = offers.length ? offers.map((offer) => `${offer.clubName} · salary ${formatMoney(offer.salary)} · target rank ${offer.targetRank}`).join('\n') : 'Belum ada job offer terbuka. Gunakan Generate Offer untuk meminta tawaran baru.';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Coach · Job Offers').setDescription(text)], components: coachJobControls(interaction.user.id, offers) });
      return;
    }

    if (action === 'coach-job-generate') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const result = generateJobOffer(profile);
      await store.save(result.profile);
      const offers = result.profile.coach!.jobOffers.filter((offer) => offer.status === 'OPEN');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Coach · New Job Offer').setDescription(`${result.offer.clubName} membuka kontrak Coach.`).addFields({ name: 'Salary', value: formatMoney(result.offer.salary), inline: true }, { name: 'Target', value: `Rank ${result.offer.targetRank}`, inline: true }, { name: 'Duration', value: `${result.offer.durationYears} season`, inline: true })], components: coachJobControls(interaction.user.id, offers) });
      return;
    }

    if (action === 'coach-job-accept-select' && interaction.isStringSelectMenu()) {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const updated = acceptJobOffer(profile, interaction.values[0]);
      await store.save(updated);
      await interaction.editReply({ embeds: [coachHomeEmbed(updated).setTitle('Coach · Job Accepted').setDescription(`Coach sekarang memimpin **${updated.coachClubState?.name ?? updated.club}**.`)], components: coachControls(interaction.user.id) });
      return;
    }

    if (action === 'coach-champions' || action === 'coach-champions-status') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const enriched = startChampionsLeague(profile, new Date(), 'COACH');
      await store.save(enriched);
      const state = enriched.coach?.championsLeague;
      if (!state) throw new Error('Coach Champions League state tidak tersedia.');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Champions League · Coach · Status').setDescription(`Status **${state.status}**\nSeason **${state.season}**\nRound **${state.round}**\nOpponent **${state.opponent}**\nAggregate **${state.aggregate}**`)], components: championsControls(interaction.user.id, 'COACH') });
      return;
    }

    if (action === 'coach-champions-play') {
      if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
      const result = playChampionsLeague(profile, new Date(), undefined, 'COACH');
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Champions League · Coach · ${result.status}`).setDescription(result.commentary.join('\n'))], components: championsControls(interaction.user.id, 'COACH') });
      return;
    }

    if (action === 'profile') {
      const enriched = ensureClubState(recoverPlayer(profile));
      await store.save(enriched);
      await interaction.editReply({ embeds: [playerWeeklyEmbed(enriched)], components: playerWeeklyControls(interaction.user.id, enriched.weekStage ?? 'READY') });
      return;
    }

    if (action === 'skills') {
      const enriched = ensureGameplayState(profile);
      await store.save(enriched);
      if (enriched.weekStage === 'EXP_PENDING') {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.displayName} · Assign Match EXP`).setDescription(`Pending EXP: **${enriched.unassignedMatchExp ?? 0}**. Pilih satu detailed skill untuk melanjutkan weekly cycle.`)], components: pendingExpControls(interaction.user.id) });
      } else {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${enriched.displayName} · Detailed Skills`).setDescription(formatDetailedSkills(enriched)).addFields({ name: 'Gameplay state', value: formatGameplayStatus(enriched) })], components: playerWeeklyControls(interaction.user.id, enriched.weekStage ?? 'READY') });
      }
      return;
    }

    if (action === 'player-event') {
      const enriched = ensureGameplayState(profile);
      const event = enriched.weeklyEvent;
      if (enriched.weekStage !== 'EVENT_PENDING' || !event || event.resolved) throw new Error('Tidak ada event mingguan yang menunggu keputusan.');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Weekly Event · ${event.title}`).setDescription(event.description).addFields({ name: 'Week', value: `${event.week}`, inline: true }, { name: 'Type', value: event.type, inline: true })], components: playerEventControls(interaction.user.id, event) });
      return;
    }
    if (action === 'player-event-select' && interaction.isStringSelectMenu()) {
      const result = resolvePlayerWeeklyEvent(profile, interaction.values[0]);
      await store.save(result.profile);
      const effects = [
        result.choice.moneyDelta ? `Money ${result.choice.moneyDelta > 0 ? '+' : ''}${result.choice.moneyDelta}` : '',
        result.choice.expDelta ? `EXP +${result.choice.expDelta}` : '',
        result.choice.charmDelta ? `Charm ${result.choice.charmDelta > 0 ? '+' : ''}${result.choice.charmDelta}` : '',
        result.choice.injuryWeeks ? `Cedera ${result.choice.injuryWeeks} minggu` : '',
        result.choice.sponsor ? `Sponsor ${result.choice.sponsor.brand} aktif` : ''
      ].filter(Boolean).join(' · ') || 'Tidak ada perubahan statistik.';
      await interaction.editReply({ embeds: [playerWeeklyEmbed(result.profile).setTitle(`Event Resolved · ${result.event.title}`).setDescription(`Pilihan: **${result.choice.label}**\n${result.choice.description}\n\n${effects}\n\nPertandingan berikutnya sudah siap.`)], components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'MATCH_READY') });
      return;
    }
    if (action === 'next-week') {
      const result = preparePlayerWeek(profile);
      await store.save(result.profile);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Weekly Update · Week ${result.week}`).setDescription(result.narrative.join('\n')).addFields({ name: 'Stage', value: result.stage, inline: true }, { name: 'Condition', value: `HP ${result.profile.hp}/${result.profile.maxHp}\nEnergy ${result.profile.energy}/${result.profile.maxEnergy}`, inline: true }, { name: 'Next step', value: result.stage === 'EVENT_PENDING' ? 'Tekan Weekly Event Decision untuk memilih respons.' : 'Tekan Play Match untuk melanjutkan.', inline: false })], components: playerWeeklyControls(interaction.user.id, result.stage) });
      return;
    }

    if (action === 'train') {
      await interaction.editReply({ content: 'Pilih macro ability atau gunakan detailed skill selector.', components: trainingControls(interaction.user.id) });
      return;
    }

    if (action === 'detailed-train') {
      await interaction.editReply({ content: 'Pilih detailed skill yang ingin dilatih.', components: detailedTrainingControls(interaction.user.id) });
      return;
    }

    if (action === 'train-select' && interaction.isStringSelectMenu()) {
      const ability = interaction.values[0] as AbilityId;
      const result = trainPlayer(profile, ability);
      await store.save(result.profile);
      await interaction.editReply({ content: `**${formatAbility(result.ability)}** naik dari **${result.statBefore}** menjadi **${result.statAfter}**. EXP: **${result.expGained}**.\n\nLanjutkan dengan training lain atau tekan **Next Week** dari Weekly Hub.`, components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'READY') });
      return;
    }

    if (action === 'detailed-train-select' && interaction.isStringSelectMenu()) {
      const skill = interaction.values[0] as DetailedSkillId;
      const result = trainDetailedSkill(profile, skill);
      await store.save(result.profile);
      await interaction.editReply({ content: `**${DETAILED_SKILL_LABELS[result.skill]}** training dimulai. Reward **+${result.expGained} EXP** akan diproses pada week ${result.profile.activeTraining?.completeAtWeek}.`, components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'READY') });
      return;
    }

    if (action === 'pending-exp-select' && interaction.isStringSelectMenu()) {
      const skill = interaction.values[0] as DetailedSkillId;
      const pending = profile.unassignedMatchExp ?? 0;
      const result = assignMatchExp(profile, { [skill]: pending });
      await store.save(result.profile);
      await interaction.editReply({ embeds: [playerWeeklyEmbed(result.profile).setTitle(`EXP Allocated · ${DETAILED_SKILL_LABELS[skill]}`).setDescription(`Seluruh pending match EXP (**${pending}**) dialokasikan ke **${DETAILED_SKILL_LABELS[skill]}**.\n\nWeekly cycle siap dilanjutkan.`)], components: playerWeeklyControls(interaction.user.id, result.profile.weekStage ?? 'READY') });
      return;
    }

    if (action === 'match') {
      const result = playPreparedWeek(profile);
      await store.save(result.profile);
      const outcomeLabel = result.match?.outcome === 'WIN' ? 'VICTORY' : result.match?.outcome === 'DRAW' ? 'DRAW' : result.match?.outcome === 'LOSS' ? 'DEFEAT' : 'NO MATCH';
      const matchText = result.match ? `${result.profile.club} ${result.match.playerGoals}–${result.match.opponentGoals} ${result.match.opponent}` : 'Tidak ada match karena kondisi atau cedera.';
      const components = result.expAwaitingAssignment > 0 ? pendingExpControls(interaction.user.id) : playerWeeklyControls(interaction.user.id, result.stage);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${outcomeLabel} · Week ${result.week}`).setDescription(`${matchText}\n\n${result.narrative.join('\n')}`).addFields({ name: 'Player rating', value: result.match ? `${result.match.playerRating}` : '-', inline: true }, { name: 'Pending EXP', value: `${result.expAwaitingAssignment}`, inline: true }, { name: 'Next step', value: result.expAwaitingAssignment > 0 ? 'Pilih skill untuk mengalokasikan EXP.' : 'Kembali ke Weekly Update untuk cycle berikutnya.', inline: false })], components });
      return;
    }

    if (action === 'club') {
      const enriched = ensureClubState(profile);
      await store.save(enriched);
      const club = enriched.clubState!;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${club.name} · Club Office`).setDescription(`Club rating **${getClubRating(enriched)}** · Level **${club.level}**`).addFields({ name: 'Resources', value: `Prestige **${club.prestige}**\nAssets **${formatMoney(club.assets)}**\nSalary budget **${formatMoney(club.salaryBudget)}`, inline: true }, { name: 'Strategy', value: `Formation **${club.formation}**\nTactic **${TACTICS[club.tactic].name}`, inline: true })], components: playerClubControls(interaction.user.id) });
      return;
    }

    throw new Error('Aksi komponen tidak dikenali.');
  } catch (error) {
    log('error', 'component_failed', { component: interaction.customId, userId: interaction.user.id, error });
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan internal.';
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.reply({ content: message, ephemeral: true });
  }
}
