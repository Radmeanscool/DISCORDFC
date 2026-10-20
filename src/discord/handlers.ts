import { EmbedBuilder as Embed, MessageFlags, type ActionRowBuilder, type ButtonBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type EmbedBuilder, type StringSelectMenuBuilder, type StringSelectMenuInteraction } from 'discord.js';
import { getRating, trainPlayer } from '../domain/engine.js';
import { ensureClubState, isClubSeasonComplete, setClubFormation, setClubTactic } from '../domain/club-engine.js';
import { claimAchievement, playChampionsLeague, startChampionsLeague, syncAchievements, type ChampionsLeagueMode } from '../domain/competition-engine.js';
import { getContractStatus, renewContract, requestSalaryRaise } from '../domain/contract-engine.js';
import { acceptJobOffer, advanceCoachRound, assignCoachExp, createCoachCareer, declineJobOffer, generateJobOffer, rebirthCoach, resolveCoachEvent, retireCoach, settleCoachSeasonWithSummary } from '../domain/coach-career-engine.js';
import { formatMoney } from '../domain/format.js';
import { assignMatchExp, assignMatchExpEvenly, canRetire, createPlayerCareer, ensureGameplayState, formatDetailedSkills, skillDisplayLevel, skillDisplayLevelFor, accelerateTrickTraining, formatGameplayStatus, hireTrainer, listTrainerCatalog, playPreparedWeek, preparePlayerWeek, rebirthPlayer, releaseTrainer, resolvePlayerWeeklyEvent, retirePlayer, startCultureStudy, startTrickTraining, trainDetailedSkill, treatInjury } from '../domain/gameplay-engine.js';
import { acceptTransferOffer, declineTransferOffer, joinOfficialClub, listEligibleClubs, listOfficialClubs, officialClubMinimumRating, officialClubTransferFee, transferWindowOpen } from '../domain/official-club-engine.js';
import { claimDailyReward, COACH_MARKET_SELL_RATE, playerMarketValue, refreshCoachMarket, buyCoachPlayer, sellableCoachPlayers, sellCoachPlayer } from '../domain/progression-engine.js';
import { dmEnabled } from '../domain/notification-engine.js';
import { abilityScore, canPlay, versusLeagueCode, versusPlayerValue } from '../domain/versus-engine.js';
import { releasableVersusPlayers } from '../domain/versus-club-engine.js';
import { listingAbilityScore, minimumVersusBid } from '../domain/versus-economy.js';
import { ABILITY_LABELS, COACH_ABILITIES, COACH_ABILITY_LABELS, DETAILED_SKILLS, DETAILED_SKILL_LABELS, skillLabel, FORMATIONS, TACTICS, TRICK_CATALOG, type AbilityId, type CoachAbilityId, type CultureSubject, type DetailedSkillId, type FormationId, type PlayerProfile, type Position, type TacticId, type TrickDefinition, type VersusBattle, type VersusClub, type VersusPlayer, type VersusSeason, type VersusSponsorTier } from '../domain/types.js';
import { joinVersusGroup, leaveWaitingVersusGroup, openVersus, placeVersusBidFor, releaseVersusPlayerFor, scoutVersusPlayerFor, signVersusSponsorFor, startNextVersusSeason, submitVersusLineupFor, toggleVersusDm, withConflictRetry, type VersusView } from '../services/versus-service.js';
import type { MaintenanceLockStore, PlayerStore } from '../storage/json-store.js';
import { runMaintenance, runVersusMaintenance } from '../jobs/maintenance.js';
import { log } from '../observability/logger.js';
import { ratingSkillsFor } from '../domain/player-formulas.js';
import { PLAYER_OVERLAY_SUMMARY } from '../config/recovery-data.js';
import { BUILD_LABEL } from '../config/build-info.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import { isRegularTrainingFocus, NATIONALITIES, REGULAR_TRAINING, resolvePosition, trainRegular } from '../domain/engine.js';
import { leagueLabel } from '../domain/league-engine.js';
import { resolveModeCommand } from './commands.js';
import {
  championsControls,
  coachCareerControls,
  coachControls,
  coachEventControls,
  coachExpControls,
  coachJobControls,
  coachMarketControls,
  coachRetireConfirmControls,
  coachStrategyControls,
  contractControls,
  detailedTrainingControls,
  honorsControls,
  mainMenuControls,
  officialClubControls,
  pendingExpControls,
  playerCareerControls,
  playerClubControls,
  playerCreationControls,
  playerCultureControls,
  playerEventControls,
  playerInjuryControls,
  playerWeeklyControls,
  PLAYER_MENU,
  COACH_MENU,
  retireConfirmControls,
  trainerControls,
  trainingControls,
  transferConfirmControls,
  transferOfferControls,
  trickControls,
  versusFinalizeControls,
  versusHomeControls,
  versusMarketControls,
  versusPositionControls,
  versusRankingControls,
  versusReleaseConfirmControls,
  versusScoutControls,
  versusSetupControls,
  versusSponsorControls,
  versusSquadControls
} from './components.js';
import {
  BRAND_COLOR,
  clip,
  coachHomeEmbed,
  coachRoundEmbed,
  coachSeasonEmbed,
  contractEmbed,
  currentVersusBattle,
  gameHomeEmbed,
  honorsEmbed,
  leagueTableEmbed,
  LIVE_CHECKPOINTS,
  liveMatchEmbed,
  matchResultEmbed,
  ownSubmission,
  playerCareerEmbed,
  playerClubEmbed,
  playerEventEmbed,
  playerWeeklyEmbed,
  profileEmbed,
  squadEmbed,
  versusFinishedEmbed,
  versusGlobalRankingEmbed,
  versusHomeEmbed,
  versusLineupEmbed,
  versusMarketEmbed,
  versusRankingsEmbed,
  versusRegistrationEmbed,
  versusResultsEmbed,
  versusRewardsEmbed,
  versusScheduleEmbed,
  versusScoutEmbed,
  versusSponsorEmbed,
  versusSquadEmbed,
  versusStandingsEmbed,
  versusWaitingEmbed
} from './embeds.js';

const ADMIN_USER_IDS = new Set((process.env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean));

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;
type AnyRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

interface Panel {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: AnyRow[];
  /** Shown one after another before the panel itself (live match), without buttons. */
  frames?: EmbedBuilder[];
}

/** Delay between live-match frames; 0 shows the result immediately. */
function animationDelayMs(): number {
  const value = Number(process.env.MATCH_ANIMATION_MS ?? 1_500);
  return Number.isFinite(value) && value >= 0 ? value : 1_500;
}

/** Interaction-independent context: components and fallback commands share the same actions. */
interface Ctx {
  store: PlayerStore;
  userId: string;
  displayName: string;
  now: Date;
  values: string[];
}

function info(title: string, description: string): EmbedBuilder {
  return new Embed().setColor(BRAND_COLOR).setTitle(clip(title, 256)).setDescription(clip(description, 4_000));
}

/** Every edit sets content, embeds, and components, so an in-place panel never keeps stale parts. */
async function respond(interaction: ChatInputCommandInteraction | ComponentInteraction, panel: Panel): Promise<void> {
  // The result is already saved; frames only replay it, so an interrupted animation loses nothing.
  const delay = animationDelayMs();
  if (delay > 0) {
    for (const frame of panel.frames ?? []) {
      await interaction.editReply({ content: '', embeds: [frame], components: [], allowedMentions: { parse: [] } });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  const embeds = panel.embeds ?? [];
  await interaction.editReply({ content: panel.content ?? (embeds.length ? '' : '​'), embeds, components: (panel.components ?? []) as never, allowedMentions: { parse: [] } });
}

function snapshot(profile: PlayerProfile): string {
  const { version: _version, ...rest } = profile;
  return JSON.stringify(rest);
}

async function saveIfChanged(store: PlayerStore, before: PlayerProfile, after: PlayerProfile): Promise<void> {
  if (snapshot(before) !== snapshot(after)) await store.save(after);
}

async function requireProfile(ctx: Ctx): Promise<PlayerProfile> {
  const profile = await ctx.store.get(ctx.userId);
  if (!profile) throw new Error('Profil belum dibuat. Buka Player Mode dari Game Home untuk membuat profil.');
  return profile;
}

function value(ctx: Ctx): string {
  const selected = ctx.values[0];
  if (!selected) throw new Error('Pilih salah satu opsi dari menu.');
  return selected;
}

// ---------------------------------------------------------------- Player Mode

function playerHome(profile: PlayerProfile, userId: string, content?: string): Panel {
  return { content, embeds: [playerWeeklyEmbed(profile)], components: playerWeeklyControls(userId, profile.weekStage ?? 'READY', profile.careerStatus === 'RETIRED') };
}

async function playerHomeAction(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await ctx.store.get(ctx.userId);
  if (!profile) return creationPanel(ctx.userId);
  const enriched = ensureGameplayState(profile, ctx.now);
  await saveIfChanged(ctx.store, profile, enriched);
  return playerHome(enriched, ctx.userId, content);
}

function creationPanel(userId: string, nationality = 'IDN'): Panel {
  const chosen = NATIONALITIES.find((item) => item.code === nationality)?.label ?? nationality;
  return {
    embeds: [info('⚽ Player Mode · Pemain Baru', `Kamu memulai sebagai **Free Player** berusia 15 tahun. Sebuah klub divisi 3 akan menawarimu kontrak pertama; dari sana kamu naik lewat performa dan transfer.\n\n**Negara asal:** ${chosen} · menentukan tim nasionalmu di turnamen antar negara (tidak memengaruhi klub).\nPilih negara, lalu posisi.`)],
    components: playerCreationControls(userId, nationality)
  };
}

async function createPlayer(ctx: Ctx, positionCode: string, nationality?: string): Promise<Panel> {
  const resolved = resolvePosition(positionCode);
  if (!resolved) throw new Error('Posisi Player tidak valid.');
  const position = resolved.group;
  const existing = await ctx.store.get(ctx.userId);
  if (existing) return playerHomeAction(ctx, 'Profil sudah ada.');
  const known = NATIONALITIES.some((item) => item.code === nationality) ? nationality : undefined;
  const profile = createPlayerCareer(ctx.userId, ctx.displayName, position, ctx.now, undefined, known);
  if (resolved.detail) profile.positionDetail = resolved.detail;
  await ctx.store.save(profile);
  const signed = info('✍️ Signed successfully!', `**${profile.club}** (${leagueLabel(profile.clubState?.leagueId)}) mengontrak **${profile.displayName}** selama ${profile.contract?.seasons ?? 2} musim · gaji ${formatMoney(profile.contract?.salary ?? 0)}/minggu.\nBuktikan dirimu di divisi bawah: tawaran klub lebih besar datang dari performa.`);
  const home = playerHome(profile, ctx.userId);
  return { ...home, embeds: [signed, ...(home.embeds ?? [])] };
}

function eventPanel(profile: PlayerProfile, userId: string, weeklyNotes: string[] = []): Panel {
  const event = profile.weeklyEvent!;
  return { embeds: [playerEventEmbed(event, weeklyNotes)], components: playerEventControls(userId, event) };
}

function expPanel(profile: PlayerProfile, userId: string, content?: string): Panel {
  return {
    content,
    embeds: [info(`📈 Alokasikan ${profile.unassignedMatchExp ?? 0} EXP`, `Pilih satu skill untuk menerima semua EXP, atau beberapa skill untuk membaginya rata. **⚡ Auto** membagi ke skill utama posisimu.\n\n${formatDetailedSkills(profile)}`)],
    components: pendingExpControls(userId, profile)
  };
}

/** Plays the prepared week, saves it, and replays the match as live frames. */
async function playMatch(ctx: Ctx, profile: PlayerProfile, weeklyNotes: string[]): Promise<Panel> {
  const result = playPreparedWeek(profile, ctx.now);
  await ctx.store.save(result.profile);
  const frames = result.match?.timeline ? LIVE_CHECKPOINTS.map((minute) => liveMatchEmbed(result.match!, minute)) : [];
  const components = result.expAwaitingAssignment > 0 ? pendingExpControls(ctx.userId, result.profile) : playerWeeklyControls(ctx.userId, result.profile.weekStage ?? 'READY', result.profile.careerStatus === 'RETIRED');
  return { embeds: [matchResultEmbed(result, weeklyNotes)], components, frames };
}

/**
 * The single weekly button: whatever stage the week is in, it moves to the next
 * step — weekly update, then the event (if any), then the match, then EXP.
 */
async function continueWeek(ctx: Ctx): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  if (profile.careerStatus === 'RETIRED') return playerHome(profile, ctx.userId, 'Karier sudah pensiun. Buka Karier untuk Rebirth.');
  switch (profile.weekStage ?? 'READY') {
    case 'EVENT_PENDING':
      if (profile.weeklyEvent && !profile.weeklyEvent.resolved) return eventPanel(profile, ctx.userId);
      break;
    case 'EXP_PENDING':
      return expPanel(profile, ctx.userId);
    case 'MATCH_READY':
      return playMatch(ctx, profile, []);
    default:
      break;
  }
  const prepared = preparePlayerWeek(profile, ctx.now);
  if (prepared.stage === 'EVENT_PENDING' && prepared.event) {
    await ctx.store.save(prepared.profile);
    return eventPanel(prepared.profile, ctx.userId, prepared.narrative);
  }
  return playMatch(ctx, prepared.profile, prepared.narrative);
}

async function skillsPanel(ctx: Ctx): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  if ((profile.unassignedMatchExp ?? 0) > 0) return expPanel(profile, ctx.userId);
  return { embeds: [info(`📈 ${profile.displayName} · Skill`, `Setiap skill mulai dari Lv 1 dan naik satu level tiap bar EXP penuh. EXP datang dari pertandingan, latihan, dan event.\n\n${formatDetailedSkills(profile)}`)], components: playerWeeklyControls(ctx.userId, profile.weekStage ?? 'READY', profile.careerStatus === 'RETIRED') };
}

async function autoAssignExp(ctx: Ctx): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const skills = ratingSkillsFor(profile.position);
  const pending = profile.unassignedMatchExp ?? 0;
  if (!pending) return playerHomeAction(ctx, 'Tidak ada EXP yang menunggu.');
  const result = assignMatchExpEvenly(profile, skills, ctx.now);
  await ctx.store.save(result.profile);
  return playerHome(result.profile, ctx.userId, `${result.allocated} EXP dibagi ke ${skills.map((skill) => skillLabel(profile.position, skill)).join(', ')}${result.levelsGained ? ` · naik ${result.levelsGained} level` : ''}.`);
}

async function assignPendingExp(ctx: Ctx): Promise<Panel> {
  const skills = ctx.values.filter((item): item is DetailedSkillId => DETAILED_SKILLS.includes(item as DetailedSkillId));
  if (!skills.length) throw new Error('Pilih minimal satu skill.');
  const profile = await requireProfile(ctx);
  const pending = profile.unassignedMatchExp ?? 0;
  const result = assignMatchExpEvenly(profile, skills, ctx.now);
  await ctx.store.save(result.profile);
  const target = skills.length === 1 ? skillLabel(profile.position, skills[0]) : `${skills.length} skill`;
  return playerHome(result.profile, ctx.userId, `${result.allocated} dari ${pending} EXP dialokasikan ke ${target}${result.levelsGained ? ` · naik ${result.levelsGained} level` : ''}.`);
}

async function trainingPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  const regularDone = profile.regularTrainingWeek === (profile.careerWeek ?? 1);
  return {
    content,
    embeds: [info('🏋️ Latihan', [
      `**Latihan rutin** · ${regularDone ? '✅ sudah dilakukan minggu ini' : '🟢 tersedia (1x per minggu)'} · Energi ${profile.energy}/${profile.maxEnergy}`,
      'Pilih fokus di menu; EXP-nya masuk ke skill yang terkait.',
      '',
      `**Latihan skill khusus** · ${profile.activeTraining ? `${skillLabel(profile.position, profile.activeTraining.skill)} selesai minggu ${profile.activeTraining.completeAtWeek}` : '🟢 tersedia'}`,
      `**Trainer** · ${profile.trainer?.active ? `${profile.trainer.tier} ${profile.trainer.type}` : 'belum ada'}`
    ].join('\n'))],
    components: trainingControls(ctx.userId, profile.position)
  };
}

async function regularTraining(ctx: Ctx, choice: string): Promise<Panel> {
  if (isRegularTrainingFocus(choice)) {
    const result = trainRegular(await requireProfile(ctx), choice, ctx.now);
    await ctx.store.save(result.profile);
    const gains = (Object.entries(result.applied) as Array<[DetailedSkillId, number]>).filter(([, exp]) => exp > 0).map(([skill, exp]) => `${skillLabel(result.profile.position, skill)} +${exp}`).join(', ');
    return playerHome(result.profile, ctx.userId, `Regular Training · ${REGULAR_TRAINING[choice].label}: ${gains} EXP.`);
  }
  // Panels sent before the original categories still carry macro ability ids.
  const ability = choice as AbilityId;
  const result = trainPlayer(await requireProfile(ctx), ability, ctx.now);
  await ctx.store.save(result.profile);
  return playerHome(result.profile, ctx.userId, `Latihan ${ABILITY_LABELS[ability] ?? ability}: +${result.expGained} EXP ke skill terkait.`);
}

async function detailedTraining(ctx: Ctx, skill: DetailedSkillId): Promise<Panel> {
  const result = trainDetailedSkill(await requireProfile(ctx), skill, ctx.now);
  await ctx.store.save(result.profile);
  return playerHome(result.profile, ctx.userId, `${skillLabel(result.profile.position, result.skill)} training dimulai: +${result.expGained} EXP pada week ${result.profile.activeTraining?.completeAtWeek}.`);
}

async function tricksPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  const tricks = Object.values(TRICK_CATALOG);
  const meets = (requires: Partial<Record<DetailedSkillId, number>>) => Object.entries(requires).every(([skill, level]) => (profile.detailedSkills![skill as DetailedSkillId]?.level ?? 0) >= (level ?? 0));
  // Requirements are stored as skill values; shown as the level the athlete must reach.
  const requirement = (skill: DetailedSkillId, value: number) => `${skillLabel(profile.position, skill)} Lv ${skillDisplayLevelFor(profile, skill, value)} (kamu Lv ${skillDisplayLevel(profile, skill)})`;
  const running = profile.trickTraining;
  const status = (trick: TrickDefinition) => profile.unlockedTricks!.includes(trick.id) ? '✅' : running?.trickId === trick.id ? '⏳' : meets(trick.requires) ? '🔓' : '🔒';
  const lines = tricks.map((trick) => `${status(trick)} **${trick.name}** · ${Object.entries(trick.requires).map(([skill, level]) => requirement(skill as DetailedSkillId, level ?? 0)).join(', ')} · energi ${trick.energyCost} · +${Math.round(trick.matchModifier * 100)}%`).join('\n');
  const unlockable = running ? [] : tricks.filter((trick) => !profile.unlockedTricks!.includes(trick.id) && meets(trick.requires));
  const progress = running
    ? `\n\n⏳ **Sedang berlatih ${TRICK_CATALOG[running.trickId]?.name ?? running.trickId}** · selesai minggu ${running.completeAtWeek} (sekarang minggu ${profile.careerWeek ?? 1}) · 💠 ${profile.diamonds ?? 0} Diamonds`
    : `\n\nLatihan trick butuh ${GAME_BALANCE.trickTraining.durationWeeks} minggu; bisa dipercepat dengan ${GAME_BALANCE.trickTraining.accelerateDiamonds} 💠 Diamonds.`;
  return { content, embeds: [info('✨ Trick Training', `${lines}${progress}\n\nTrick terbuka menambah peluang gol dan rating di pertandingan.`)], components: trickControls(ctx.userId, unlockable, running ? GAME_BALANCE.trickTraining.accelerateDiamonds : undefined) };
}

async function trainerPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  const list = listTrainerCatalog().map((trainer) => `${profile.trainer?.active && profile.trainer.id === trainer.id ? '✅' : '•'} **${trainer.tier} ${trainer.type}** · ${formatMoney(trainer.weeklyCost)}/minggu · ratio ${Math.round(trainer.ratio * 100)}%`).join('\n');
  return { content, embeds: [info('Personal Trainer', `${list}\n\nTrainer aktif memberi EXP mingguan ke skill sesuai tipenya, dibayar setiap Weekly Update.`)], components: trainerControls(ctx.userId, Boolean(profile.trainer?.active)) };
}

async function gameplayAction(ctx: Ctx, run: (profile: PlayerProfile) => { profile: PlayerProfile; message: string }, back: (ctx: Ctx, content: string) => Promise<Panel>): Promise<Panel> {
  const result = run(await requireProfile(ctx));
  await ctx.store.save(result.profile);
  return back(ctx, result.message);
}

async function injuryPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  const injury = profile.injury ? `Cedera **${profile.injury.severity}** · tersisa **${profile.injury.weeksRemaining} minggu**\nSumber: ${profile.injury.source} · treatment ${profile.injury.treatmentUsed ? 'sudah' : 'belum'} dipakai` : 'Pemain sehat.';
  return { content, embeds: [info('Injury & Recovery', `${injury}\n\nHP ${profile.hp}/${profile.maxHp} · Energy ${profile.energy}/${profile.maxEnergy}\nRecovery real-time: +2 HP dan +10 energy per jam.`)], components: playerInjuryControls(ctx.userId) };
}

async function treatment(ctx: Ctx, selected: string): Promise<Panel> {
  if (selected === 'view') return injuryPanel(ctx);
  const result = treatInjury(await requireProfile(ctx), selected === 'expert-treatment' ? 'EXPERT' : 'BASIC', ctx.now);
  await ctx.store.save(result.profile);
  return injuryPanel(ctx, `Treatment ${result.treatment}: -${result.weeksRemoved} minggu, biaya ${formatMoney(result.moneySpent)}.`);
}

async function playerClubPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const enriched = ensureClubState(ensureGameplayState(profile, ctx.now), ctx.now);
  await saveIfChanged(ctx.store, profile, enriched);
  return { content, embeds: [playerClubEmbed(enriched)], components: playerClubControls(ctx.userId) };
}

async function leaguePanel(ctx: Ctx): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const enriched = ensureClubState(profile, ctx.now);
  await saveIfChanged(ctx.store, profile, enriched);
  return { embeds: [leagueTableEmbed(enriched)], components: playerClubControls(ctx.userId) };
}

async function playerSquadPanel(ctx: Ctx): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const enriched = ensureClubState(profile, ctx.now);
  await saveIfChanged(ctx.store, profile, enriched);
  return { embeds: [squadEmbed(`${enriched.club} · Squad`, enriched.clubState!.roster)], components: playerClubControls(ctx.userId) };
}

async function offersPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const offers = (profile.transferOffers ?? []).filter((offer) => offer.status === 'OPEN');
  const lines = offers.map((offer) => `**${offer.clubName}** · ${leagueLabel(offer.leagueId)} · ${formatMoney(offer.weeklySalary)}/minggu · ${offer.seasons} musim`).join('\n');
  return { content, embeds: [info('🔁 Transfer', `${lines || 'Belum ada tawaran. Klub mengirim tawaran di akhir musim kalau performamu bagus.'}\n\nTransfer window: ${transferWindowOpen(profile) ? '🟢 terbuka' : '🔴 tutup'}.`)], components: transferOfferControls(ctx.userId, offers, transferWindowOpen(profile)) };
}

async function eligibleClubsPanel(ctx: Ctx): Promise<Panel> {
  const profile = await requireProfile(ctx);
  if (!transferWindowOpen(profile)) throw new Error('Transfer window tutup. Pindah klub hanya saat pra-musim atau season break.');
  const clubs = listEligibleClubs(profile, 25);
  return { embeds: [info('Change Club', clubs.length ? `Klub yang mau merekrut pemain dengan rating **${getRating(profile)}**. Pilih untuk melihat biaya.` : `Belum ada klub lain yang mau merekrut rating ${getRating(profile)}. Tingkatkan skill terlebih dahulu.`)], components: officialClubControls(ctx.userId, clubs) };
}

async function transferPreview(ctx: Ctx, clubId: number): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const club = listOfficialClubs().find((item) => item.id === clubId);
  if (!club) throw new Error('Klub tujuan tidak ditemukan.');
  const fee = officialClubTransferFee(clubId);
  return { embeds: [info('Transfer Preview', `Pindah dari **${profile.club}** ke **${club.nameEn}**?`).addFields(
    { name: 'League / grade', value: `${club.league} · ${club.grade}`, inline: true },
    { name: 'Rating minimal', value: `${officialClubMinimumRating(clubId)} (Anda ${getRating(profile)})`, inline: true },
    { name: 'Biaya', value: `${formatMoney(fee)} · sisa ${formatMoney(profile.money - fee)}`, inline: true },
    { name: 'Kontrak', value: 'Kontrak lama ditutup; kontrak baru dengan klub tujuan ditandatangani.' }
  )], components: transferConfirmControls(ctx.userId, clubId) };
}

async function contractPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const contract = getContractStatus(profile, ctx.now);
  const canRenew = !contract || contract.state !== 'ACTIVE' || contract.clubId !== profile.club || (contract.seasonsRemaining !== undefined && contract.seasonsRemaining <= 1);
  const canRaise = contract?.state === 'ACTIVE' && contract.lastRaiseSeason !== profile.league.season;
  return { content, embeds: [contractEmbed(profile)], components: contractControls(ctx.userId, canRenew && profile.careerStatus !== 'RETIRED', Boolean(canRaise) && profile.careerStatus !== 'RETIRED') };
}

async function honorsPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireProfile(ctx);
  const enriched = syncAchievements(ensureGameplayState(profile, ctx.now));
  await saveIfChanged(ctx.store, profile, enriched);
  const claimable = (enriched.achievements ?? []).filter((item) => !item.claimed && item.progress >= item.target);
  return { content, embeds: [honorsEmbed(enriched)], components: honorsControls(ctx.userId, claimable) };
}

async function careerPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
  return { content, embeds: [playerCareerEmbed(profile)], components: playerCareerControls(ctx.userId, profile.careerStatus === 'RETIRED', canRetire(profile), profile.position, profile.positionDetail) };
}

async function championsStatus(ctx: Ctx, mode: ChampionsLeagueMode): Promise<Panel> {
  const profile = await requireProfile(ctx);
  if (mode === 'COACH' && !profile.coach) throw new Error('Karier Coach belum dibuat.');
  const enriched = startChampionsLeague(profile, ctx.now, mode);
  await saveIfChanged(ctx.store, profile, enriched);
  const state = mode === 'COACH' ? enriched.coach?.championsLeague : enriched.championsLeague;
  if (!state) throw new Error('Champions League state tidak tersedia.');
  const history = (state.history ?? []).map((item) => `R${item.round} vs ${item.opponent}: ${item.goalsFor}-${item.goalsAgainst}${item.penalties ? ` (pen ${item.penalties.for}-${item.penalties.against})` : ''}`).join('\n');
  return { embeds: [info(`Champions League · ${mode === 'COACH' ? 'Coach' : 'Player'}`, `Status **${state.status}** · season ${state.season}\nRound ${state.round} vs **${state.opponent}**\n\n${history || 'Belum ada pertandingan.'}`)], components: championsControls(ctx.userId, mode) };
}

async function championsPlay(ctx: Ctx, mode: ChampionsLeagueMode): Promise<Panel> {
  const profile = await requireProfile(ctx);
  if (mode === 'COACH' && !profile.coach) throw new Error('Karier Coach belum dibuat.');
  const result = playChampionsLeague(profile, ctx.now, undefined, mode);
  await ctx.store.save(result.profile);
  const pending = mode === 'PLAYER' && (result.profile.unassignedMatchExp ?? 0) > 0;
  return { embeds: [info(`Champions League · ${result.status}`, result.commentary.join('\n'))], components: pending ? pendingExpControls(ctx.userId) : championsControls(ctx.userId, mode) };
}

// ------------------------------------------------------------------ Coach Mode

function coachState(profile: PlayerProfile) {
  return { employed: profile.coach?.status === 'EMPLOYED', seasonComplete: isClubSeasonComplete(profile.coachClubState), retired: profile.coach?.status === 'RETIRED', eventPending: Boolean(profile.coach?.event && !profile.coach.event.resolved), expPending: profile.coach?.unassignedExp ?? 0 };
}

function coachHome(profile: PlayerProfile, userId: string, content?: string): Panel {
  return { content, embeds: [coachHomeEmbed(profile)], components: coachControls(userId, coachState(profile)) };
}

async function coachHomeAction(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await ctx.store.get(ctx.userId);
  if (!profile) return { embeds: [gameHomeEmbed().setTitle('Coach Mode · Account Setup').setDescription('Coach Mode memakai akun yang sama dengan state terpisah. Buat profil terlebih dahulu dengan memilih posisi.')], components: playerCreationControls(ctx.userId) };
  const updated = profile.coach ? profile : createCoachCareer(profile, ctx.displayName, ctx.now);
  await saveIfChanged(ctx.store, profile, updated);
  return coachHome(updated, ctx.userId, content ?? (profile.coach ? undefined : 'Karier Coach dimulai. Beberapa klub juga mengirim tawaran — cek Job Offers.'));
}

async function requireCoach(ctx: Ctx): Promise<PlayerProfile> {
  const profile = await requireProfile(ctx);
  if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home.');
  return profile;
}

async function coachAction(ctx: Ctx, run: (profile: PlayerProfile) => PlayerProfile, content: (profile: PlayerProfile) => string): Promise<Panel> {
  const updated = run(await requireCoach(ctx));
  await ctx.store.save(updated);
  return coachHome(updated, ctx.userId, content(updated));
}

async function coachClubPanel(ctx: Ctx): Promise<Panel> {
  const profile = await requireCoach(ctx);
  const enriched = ensureClubState(profile, ctx.now, undefined, 'coachClubState');
  await saveIfChanged(ctx.store, profile, enriched);
  const club = enriched.coachClubState!;
  const roster = [...club.roster].sort((a, b) => b.overall - a.overall).slice(0, 18).map((player) => `${player.position} · ${player.name} · OVR ${player.overall} · usia ${player.age}`).join('\n');
  return { embeds: [info(`${club.name} · Club Office`, `Assets **${formatMoney(club.assets)}** · Prestige **${club.prestige}** · ${club.formation} · ${TACTICS[club.tactic].name}\n\n${roster}`)], components: coachControls(ctx.userId, coachState(enriched)) };
}

async function coachEventPanel(ctx: Ctx): Promise<Panel> {
  const profile = await requireCoach(ctx);
  const event = profile.coach!.event;
  if (!event || event.resolved) return coachHome(profile, ctx.userId, 'Tidak ada management decision yang menunggu.');
  return { embeds: [info(`Coach Decision · ${event.title}`, `${event.description}\n\n${event.choices.map((choice) => `**${choice.label}** — ${choice.description}`).join('\n')}`)], components: coachEventControls(ctx.userId, event.choices) };
}

async function coachExpPanel(ctx: Ctx): Promise<Panel> {
  const profile = await requireCoach(ctx);
  const coach = profile.coach!;
  const abilities = COACH_ABILITIES.map((id) => `${COACH_ABILITY_LABELS[id]} Lv ${coach.abilities[id].level} (${coach.abilities[id].exp} EXP)`).join('\n');
  return { embeds: [info('Coach EXP', `Pending **${coach.unassignedExp}** EXP.\n\n${abilities}\n\nFormation → kekuatan formasi · Tactics → efek taktik · State Adjustment → comeback · Training → perkembangan pemain · Locker Room → moral · Charisma → approval board.`)], components: coach.unassignedExp > 0 ? coachExpControls(ctx.userId, coach.unassignedExp) : coachControls(ctx.userId, coachState(profile)) };
}

async function coachStrategyPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireCoach(ctx);
  const enriched = ensureClubState(profile, ctx.now, undefined, 'coachClubState');
  await saveIfChanged(ctx.store, profile, enriched);
  const club = enriched.coachClubState!;
  return { content, embeds: [info('Formation & Tactic', `Formation **${club.formation}** · Tactic **${TACTICS[club.tactic].name}**\n${TACTICS[club.tactic].description}`)], components: coachStrategyControls(ctx.userId, club.formation, club.tactic) };
}

async function coachJobPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireCoach(ctx);
  const offers = profile.coach!.jobOffers.filter((offer) => offer.status === 'OPEN');
  const lines = offers.map((offer) => `**${offer.clubName}** · league ${offer.league} · salary ${formatMoney(offer.salary)} · target ${offer.targetType ?? 'RANK'} #${offer.targetRank}`).join('\n');
  return { content, embeds: [info('Job Offers', lines || 'Belum ada tawaran terbuka. Cari tawaran (1x per round) atau tunggu akhir season.')], components: coachJobControls(ctx.userId, offers, profile.coach!.status !== 'RETIRED') };
}

async function coachMarketPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireCoach(ctx);
  if (profile.coach!.status !== 'EMPLOYED') throw new Error('Coach harus terikat kontrak dengan club untuk membuka transfer market.');
  const round = profile.coachClubState?.fixtures.filter((fixture) => fixture.played).length ?? 0;
  const market = profile.coachMarket;
  const stale = !market || market.season !== profile.coach!.season || market.refreshedAtRound !== round;
  const enriched = stale ? refreshCoachMarket(profile, ctx.now) : profile;
  await saveIfChanged(ctx.store, profile, enriched);
  const listings = enriched.coachMarket?.listings ?? [];
  const club = enriched.coachClubState!;
  const lines = listings.filter((listing) => listing.status === 'OPEN').map((listing) => `${listing.player.position} · **${listing.player.name}** · OVR ${listing.player.overall} · usia ${listing.player.age} · ${formatMoney(listing.price)}`).join('\n');
  const sellPrice = (player: { overall: number; age: number }) => Math.round(playerMarketValue(player) * COACH_MARKET_SELL_RATE);
  return { content, embeds: [info(`${club.name} · Transfer Market`, `Assets **${formatMoney(club.assets)}** · roster ${club.roster.length}\nDaftar diperbarui setiap round.\n\n${lines || 'Tidak ada listing.'}`)], components: coachMarketControls(ctx.userId, listings, sellableCoachPlayers(enriched), sellPrice) };
}

async function coachCareerPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const profile = await requireCoach(ctx);
  const coach = profile.coach!;
  const honors = coach.honors.slice(-8).map((honor) => `${honor.title} · season ${honor.season}`).join('\n');
  return { content, embeds: [info(`${coach.coachName} · Coach Career`, `${coach.status === 'RETIRED' ? 'Coach pensiun. Rebirth memulai karier baru dengan bonus dari honor.' : `Tahun ${coach.careerYear} · season ${coach.season} · usia ${coach.age}`}\n\n**Honors**\n${honors || 'Belum ada.'}`)], components: coachCareerControls(ctx.userId, coach.status === 'RETIRED') };
}

// ----------------------------------------------------------------- Versus Mode

function versusPanel(view: VersusView, userId: string, content?: string): Panel {
  const dm = dmEnabled(view.profile);
  if (view.waiting || !view.season) return { content, embeds: [versusWaitingEmbed(view.profile)], components: versusHomeControls(userId, { state: 'WAITING', dm }) };
  if (view.season.state === 'FINISHED') return { content, embeds: [versusFinishedEmbed(view.profile, view.season)], components: versusHomeControls(userId, { state: 'FINISHED', dm }) };
  const clubId = view.profile.versus!.clubId;
  const club = view.season.clubs.find((item) => item.id === clubId) ?? view.profile.versus!.club;
  const battle = currentVersusBattle(view.season, clubId);
  return { content, embeds: [versusHomeEmbed(view.profile, view.season)], components: versusHomeControls(userId, { state: 'ACTIVE', round: view.season.currentRound, rosterVersion: club.rosterVersion, submitted: Boolean(ownSubmission(battle, clubId)), dm }) };
}

async function versusHome(ctx: Ctx, content?: string): Promise<Panel> {
  const existing = await ctx.store.get(ctx.userId);
  if (!existing) return { embeds: [gameHomeEmbed().setTitle('Versus Mode · Account Setup').setDescription('Buat profil terlebih dahulu dengan memilih posisi. Club Versus dibuat terpisah dan tidak memakai data Player/Coach.')], components: playerCreationControls(ctx.userId) };
  return versusPanel(await openVersus(ctx.store, ctx.userId, ctx.now), ctx.userId, content);
}

/** Read-only Versus sub-views use the member's synced season copy; Home performs the catch-up. */
async function versusSeasonView(ctx: Ctx): Promise<{ profile: PlayerProfile; season?: VersusSeason }> {
  const profile = await requireProfile(ctx);
  if (!profile.versus) throw new Error('Club Versus belum dibuat. Buka Versus Home terlebih dahulu.');
  return { profile, season: profile.versus.season };
}

function viewControls(userId: string, profile: PlayerProfile, season?: VersusSeason): AnyRow[] {
  return versusPanel({ profile, season, waiting: !season }, userId).components ?? [];
}

async function versusInfoPanel(ctx: Ctx, build: (profile: PlayerProfile, season?: VersusSeason) => EmbedBuilder, requireSeason = true): Promise<Panel> {
  const { profile, season } = await versusSeasonView(ctx);
  if (requireSeason && !season) return versusHome(ctx);
  return { embeds: [build(profile, season)], components: viewControls(ctx.userId, profile, season) };
}

async function versusMarketPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const { profile, season } = await versusSeasonView(ctx);
  if (!season || season.state !== 'ACTIVE') return versusHome(ctx, 'Market hanya dibuka selama season Versus aktif.');
  return { content, embeds: [versusMarketEmbed(profile, season)], components: versusMarketControls(ctx.userId, season.market?.listings ?? [], minimumVersusBid, listingAbilityScore) };
}

function versusClubOf(profile: PlayerProfile): VersusClub {
  const versus = profile.versus!;
  return versus.season?.clubs.find((club) => club.id === versus.clubId) ?? versus.club;
}

async function versusSquadPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const { profile, season } = await versusSeasonView(ctx);
  const club = versusClubOf(profile);
  const releasable = season?.state === 'FINISHED' ? [] : releasableVersusPlayers(club, season).map((player) => ({ index: club.roster.indexOf(player), player, refund: Math.round(versusPlayerValue(player) / 10) }));
  return { content, embeds: [versusSquadEmbed(club)], components: versusSquadControls(ctx.userId, club.rosterVersion, releasable) };
}

function releaseTarget(club: VersusClub, rosterVersion: number, index: number): VersusPlayer {
  if (club.rosterVersion !== rosterVersion) throw new Error('Roster sudah berubah. Buka ulang Squad.');
  const player = club.roster[index];
  if (!player) throw new Error('Pemain tidak ditemukan. Buka ulang Squad.');
  return player;
}

async function versusScoutPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const { profile, season } = await versusSeasonView(ctx);
  const club = versusClubOf(profile);
  const key = season ? `${season.id}:${season.currentRound}` : `idle:${ctx.now.toISOString().slice(0, 10)}`;
  return { content, embeds: [versusScoutEmbed(club)], components: versusScoutControls(ctx.userId, club.versusMoney, club.roster.length >= 25, profile.versus!.lastScoutKey === key || season?.state === 'FINISHED') };
}

async function versusSponsorPanel(ctx: Ctx, content?: string): Promise<Panel> {
  const { profile, season } = await versusSeasonView(ctx);
  const club = versusClubOf(profile);
  const signed = club.sponsor && club.sponsor.seasonId === season?.id ? club.sponsor.tier : undefined;
  return { content, embeds: [versusSponsorEmbed(club, season)], components: versusSponsorControls(ctx.userId, club.grade, signed, season?.state === 'ACTIVE') };
}

// Lineup builder ----------------------------------------------------------

interface VersusDraft {
  seasonId: string;
  round: number;
  rosterVersion: number;
  formation: FormationId;
  tactic: TacticId;
  selected: Record<Position, string[]>;
  captain?: string;
  substitutes: string[];
}

const DRAFT_LIMIT = 5_000;
const versusDrafts = new Map<string, VersusDraft>();
const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];

function rememberDraft(userId: string, draft: VersusDraft): void {
  versusDrafts.delete(userId);
  versusDrafts.set(userId, draft);
  if (versusDrafts.size > DRAFT_LIMIT) versusDrafts.delete(versusDrafts.keys().next().value!);
}

function selectionScore(player: VersusPlayer): number {
  return abilityScore(player) * (0.7 + 0.3 * (player.hp / Math.max(1, player.maxHp)));
}

function emptySelection(): Record<Position, string[]> {
  return { GK: [], DF: [], MF: [], FW: [] };
}

function autoFill(draft: VersusDraft, eligible: VersusPlayer[]): void {
  const slots = FORMATIONS[draft.formation].slots;
  draft.selected = emptySelection();
  for (const position of POSITIONS) draft.selected[position] = eligible.filter((player) => player.position === position).sort((a, b) => selectionScore(b) - selectionScore(a)).slice(0, slots[position]).map((player) => player.id);
  const lineup = draftLineup(draft);
  const starters = eligible.filter((player) => lineup.includes(player.id));
  draft.captain = (starters.find((player) => player.captain) ?? [...starters].sort((a, b) => abilityScore(b) - abilityScore(a))[0])?.id;
  draft.substitutes = eligible.filter((player) => !lineup.includes(player.id)).sort((a, b) => selectionScore(b) - selectionScore(a)).slice(0, 5).map((player) => player.id);
}

function draftLineup(draft: VersusDraft): string[] {
  return POSITIONS.flatMap((position) => draft.selected[position]);
}

function draftSummary(draft: VersusDraft, club: VersusClub): string {
  const names = new Map(club.roster.map((player) => [player.id, player.name]));
  const slots = FORMATIONS[draft.formation].slots;
  const lines = POSITIONS.map((position) => `${position} (${draft.selected[position].length}/${slots[position]}): ${draft.selected[position].map((id) => names.get(id) ?? id).join(', ') || '-'}`);
  return `Formation **${draft.formation}** · Tactic **${TACTICS[draft.tactic].name}**\n${lines.join('\n')}\nCaptain: ${names.get(draft.captain ?? '') ?? '-'} · Subs: ${draft.substitutes.map((id) => names.get(id) ?? id).join(', ') || '-'}`;
}

interface LineupContext {
  profile: PlayerProfile;
  season: VersusSeason;
  club: VersusClub;
  battle: VersusBattle;
  draft: VersusDraft;
  eligible: VersusPlayer[];
}

async function lineupContext(ctx: Ctx, round: number, rosterVersion: number): Promise<LineupContext> {
  const profile = await requireProfile(ctx);
  const season = profile.versus?.season;
  const clubId = profile.versus?.clubId;
  if (!season || season.state !== 'ACTIVE' || !clubId) throw new Error('Tidak ada season Versus aktif. Buka Versus Home.');
  if (season.currentRound !== round) throw new Error(`Round sudah berganti ke ${season.currentRound}. Buka ulang Lineup dari Versus Home.`);
  if (ctx.now.getTime() >= new Date(season.roundDeadline).getTime()) throw new Error('Deadline round ini sudah lewat; buka Versus Home untuk melihat hasilnya.');
  const club = season.clubs.find((item) => item.id === clubId);
  const battle = currentVersusBattle(season, clubId);
  if (!club || !battle) throw new Error('Battle Versus aktif tidak ditemukan.');
  if (club.rosterVersion !== rosterVersion) throw new Error('Roster berubah (pemain baru atau dilepas). Buka ulang Lineup.');
  const eligible = club.roster.filter((player) => canPlay(player, ctx.now));
  let draft = versusDrafts.get(ctx.userId);
  if (!draft || draft.seasonId !== season.id || draft.round !== round || draft.rosterVersion !== rosterVersion) {
    const submitted = ownSubmission(battle, clubId);
    draft = { seasonId: season.id, round, rosterVersion, formation: submitted?.formation ?? club.formation, tactic: submitted?.tactic ?? club.tactic, selected: emptySelection(), substitutes: [] };
    if (submitted) {
      const eligibleIds = new Set(eligible.map((player) => player.id));
      for (const id of submitted.lineup) {
        const player = club.roster.find((item) => item.id === id);
        if (player && eligibleIds.has(id)) draft.selected[player.position].push(id);
      }
      draft.captain = eligibleIds.has(submitted.captainId) ? submitted.captainId : undefined;
      draft.substitutes = submitted.substitutes.filter((id) => eligibleIds.has(id));
    }
    rememberDraft(ctx.userId, draft);
  }
  return { profile, season, club, battle, draft, eligible };
}

function fieldableFormations(eligible: VersusPlayer[]): Set<FormationId> {
  const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const player of eligible) counts[player.position] += 1;
  return new Set(Object.values(FORMATIONS).filter((formation) => POSITIONS.every((position) => counts[position] >= formation.slots[position])).map((formation) => formation.id));
}

function lineupSetupPanel(ctx: Ctx, lineup: LineupContext, content?: string): Panel {
  const { season, club, battle, draft, eligible } = lineup;
  return { content, embeds: [versusLineupEmbed(club, season, battle, draftSummary(draft, club))], components: versusSetupControls(ctx.userId, draft.round, draft.rosterVersion, draft.formation, draft.tactic, fieldableFormations(eligible)) };
}

function lineupPositionsPanel(ctx: Ctx, lineup: LineupContext, content?: string): Panel {
  const { season, club, battle, draft, eligible } = lineup;
  return { content, embeds: [versusLineupEmbed(club, season, battle, draftSummary(draft, club))], components: versusPositionControls(ctx.userId, draft.round, draft.rosterVersion, draft.formation, eligible, draft.selected, (player) => Math.round(abilityScore(player))) };
}

function lineupFinalPanel(ctx: Ctx, lineup: LineupContext, content?: string): Panel {
  const { season, club, battle, draft, eligible } = lineup;
  return { content, embeds: [versusLineupEmbed(club, season, battle, draftSummary(draft, club))], components: versusFinalizeControls(ctx.userId, draft.round, draft.rosterVersion, draftLineup(draft), eligible, (player) => Math.round(abilityScore(player)), draft.captain, draft.substitutes) };
}

async function lineupStep(ctx: Ctx, step: string, round: number, rosterVersion: number): Promise<Panel> {
  const lineup = await lineupContext(ctx, round, rosterVersion);
  const { draft, eligible } = lineup;
  const slots = FORMATIONS[draft.formation].slots;
  switch (step) {
    case 'start':
      return lineupSetupPanel(ctx, lineup);
    case 'fm': {
      const formation = value(ctx) as FormationId;
      if (!FORMATIONS[formation]) throw new Error('Formation tidak dikenal.');
      draft.formation = formation;
      draft.selected = emptySelection();
      draft.captain = undefined;
      draft.substitutes = [];
      return lineupSetupPanel(ctx, lineup);
    }
    case 'tc': {
      const tactic = value(ctx) as TacticId;
      if (!TACTICS[tactic]) throw new Error('Tactic tidak dikenal.');
      draft.tactic = tactic;
      return lineupSetupPanel(ctx, lineup);
    }
    case 'auto':
      autoFill(draft, eligible);
      return lineupFinalPanel(ctx, lineup, POSITIONS.every((position) => draft.selected[position].length === slots[position]) ? 'XI terbaik dipilih otomatis berdasarkan kemampuan dan kondisi.' : 'Pemain fit tidak cukup untuk formation ini; pilih formation lain.');
    case 'xi':
      return lineupPositionsPanel(ctx, lineup);
    case 'gk':
    case 'df':
    case 'mf':
    case 'fw': {
      const position = step.toUpperCase() as Position;
      const allowed = new Set(eligible.filter((player) => player.position === position).map((player) => player.id));
      draft.selected[position] = ctx.values.filter((id) => allowed.has(id)).slice(0, slots[position]);
      const lineupIds = draftLineup(draft);
      if (draft.captain && !lineupIds.includes(draft.captain)) draft.captain = undefined;
      draft.substitutes = draft.substitutes.filter((id) => !lineupIds.includes(id));
      return lineupPositionsPanel(ctx, lineup);
    }
    case 'rev': {
      const missing = POSITIONS.filter((position) => draft.selected[position].length !== slots[position]);
      if (missing.length) return lineupPositionsPanel(ctx, lineup, `Lineup belum lengkap untuk ${draft.formation}: ${missing.map((position) => `${position} ${draft.selected[position].length}/${slots[position]}`).join(', ')}.`);
      return lineupFinalPanel(ctx, lineup);
    }
    case 'cap': {
      const captain = value(ctx);
      if (!draftLineup(draft).includes(captain)) throw new Error('Captain harus berada di starting XI.');
      draft.captain = captain;
      return lineupFinalPanel(ctx, lineup);
    }
    case 'sub': {
      const lineupIds = new Set(draftLineup(draft));
      const allowed = new Set(eligible.map((player) => player.id));
      draft.substitutes = ctx.values.filter((id) => allowed.has(id) && !lineupIds.has(id)).slice(0, 5);
      return lineupFinalPanel(ctx, lineup);
    }
    case 'ok': {
      if (!draft.captain) throw new Error('Pilih captain sebelum konfirmasi.');
      const result = await submitVersusLineupFor(ctx.store, ctx.userId, { battleId: lineup.battle.id, lineup: draftLineup(draft), substitutes: draft.substitutes, captainId: draft.captain, formation: draft.formation, tactic: draft.tactic, rosterVersion: draft.rosterVersion }, ctx.now);
      versusDrafts.delete(ctx.userId);
      return versusPanel({ profile: result.profile, season: result.season }, ctx.userId, `Lineup Round ${round} tersimpan (${draft.formation} · ${TACTICS[draft.tactic].name}). Bisa diubah sampai deadline.`);
    }
    default:
      throw new Error('Langkah lineup tidak dikenal. Buka ulang Versus Home.');
  }
}

// ------------------------------------------------------------- Component router

const VERSUS_RANKINGS: Record<string, 'CLUB' | 'MVP' | 'SCORERS' | 'ASSISTS' | 'GOALKEEPERS'> = {
  'versus-rankings': 'CLUB',
  'versus-ranking-club': 'CLUB',
  'versus-ranking-mvp': 'MVP',
  'versus-ranking-scorers': 'SCORERS',
  'versus-ranking-assists': 'ASSISTS',
  'versus-ranking-goalkeepers': 'GOALKEEPERS'
};

const SPONSOR_ACTIONS: Record<string, VersusSponsorTier> = { 'versus-sponsor-junior': 'JUNIOR', 'versus-sponsor-senior': 'SENIOR', 'versus-sponsor-top': 'TOP' };

async function routeComponent(ctx: Ctx, action: string): Promise<Panel> {
  if (action.startsWith('vl:')) {
    const [, step, roundText, versionText] = action.split(':');
    const round = Number(roundText);
    const rosterVersion = Number(versionText);
    if (!Number.isInteger(round) || !Number.isInteger(rosterVersion)) throw new Error('Komponen lineup tidak valid. Buka ulang Versus Home.');
    return lineupStep(ctx, step, round, rosterVersion);
  }
  if (action.startsWith('player-create-select:')) return createPlayer(ctx, value(ctx), action.split(':')[1]);
  if (action.startsWith('player-club-confirm:')) {
    const clubId = Number(action.split(':')[1]);
    const updated = joinOfficialClub(await requireProfile(ctx), clubId, ctx.now);
    await ctx.store.save(updated);
    return playerClubPanel(ctx, `Transfer selesai: Anda sekarang bermain untuk ${updated.club}.`);
  }
  if (action.startsWith('versus-release-select:')) {
    const rosterVersion = Number(action.split(':')[1]);
    const index = Number(value(ctx));
    const { profile } = await versusSeasonView(ctx);
    const player = releaseTarget(versusClubOf(profile), rosterVersion, index);
    return { embeds: [info('Lepas pemain?', `**${player.name}** (${player.position}, usia ${player.age}, skor ${Math.round(abilityScore(player))}) akan dilepas permanen. Refund ${Math.round(versusPlayerValue(player) / 10)} money.`)], components: versusReleaseConfirmControls(ctx.userId, rosterVersion, index) };
  }
  if (action.startsWith('versus-release-confirm:')) {
    const [, versionText, indexText] = action.split(':');
    const { profile } = await versusSeasonView(ctx);
    const player = releaseTarget(versusClubOf(profile), Number(versionText), Number(indexText));
    const result = await releaseVersusPlayerFor(ctx.store, ctx.userId, player.id, ctx.now);
    return versusSquadPanel(ctx, `${result.player.name} dilepas · refund ${result.refund} money.`);
  }
  if (VERSUS_RANKINGS[action]) return { ...(await versusInfoPanel(ctx, (profile, season) => versusRankingsEmbed(profile, season, VERSUS_RANKINGS[action]))), components: versusRankingControls(ctx.userId) };
  if (SPONSOR_ACTIONS[action]) {
    await signVersusSponsorFor(ctx.store, ctx.userId, SPONSOR_ACTIONS[action], ctx.now);
    return versusSponsorPanel(ctx, `${SPONSOR_ACTIONS[action]} Sponsor ditandatangani untuk season ini.`);
  }

  switch (action) {
    // Navigation
    case 'menu-home':
      return { embeds: [gameHomeEmbed(await ctx.store.get(ctx.userId))], components: mainMenuControls(ctx.userId) };
    case 'menu-player':
    case 'profile':
      return playerHomeAction(ctx);
    case 'menu-coach':
    case 'coach-profile':
      return coachHomeAction(ctx);
    case 'menu-versus':
    case 'versus-home':
    case 'versus-lineup-start':
      return versusHome(ctx);

    // Player Mode
    case 'player-create-select':
      return createPlayer(ctx, value(ctx));
    case 'player-country-select':
      return creationPanel(ctx.userId, value(ctx));
    // `match` and `player-event` are kept for panels sent before the single weekly button.
    case 'next-week':
    case 'match':
    case 'player-event':
      return continueWeek(ctx);
    case 'skills':
      return skillsPanel(ctx);
    case 'pending-exp-select':
      return assignPendingExp(ctx);
    case 'pending-exp-auto':
      return autoAssignExp(ctx);
    case 'player-event-select': {
      const result = resolvePlayerWeeklyEvent(await requireProfile(ctx), value(ctx), ctx.now);
      return playMatch(ctx, result.profile, [`${result.event.title}: kamu memilih "${result.choice.label}".`, ...(result.note ? [result.note] : [])]);
    }
    case 'coach-menu-select': {
      const target = value(ctx);
      if (!COACH_MENU.some(([action]) => action === target)) throw new Error('Menu tidak dikenali.');
      return routeComponent({ ...ctx, values: [] }, target);
    }
    case 'player-menu-select': {
      const target = value(ctx);
      if (!PLAYER_MENU.some(([action]) => action === target)) throw new Error('Menu tidak dikenali.');
      return routeComponent({ ...ctx, values: [] }, target);
    }
    case 'player-profile': {
      const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
      return { embeds: [profileEmbed(profile)], components: playerWeeklyControls(ctx.userId, profile.weekStage ?? 'READY', profile.careerStatus === 'RETIRED') };
    }
    case 'train':
      return trainingPanel(ctx);
    case 'train-select':
      return regularTraining(ctx, value(ctx));
    case 'detailed-train': {
      const profile = ensureGameplayState(await requireProfile(ctx), ctx.now);
      return { embeds: [info('🎯 Latihan skill khusus', `Pilih satu skill. Latihannya selesai di minggu berikutnya dan EXP-nya langsung masuk ke skill itu.\n\n${formatDetailedSkills(profile)}`)], components: detailedTrainingControls(ctx.userId, profile) };
    }
    case 'detailed-train-select':
      return detailedTraining(ctx, value(ctx) as DetailedSkillId);
    case 'player-tricks':
      return tricksPanel(ctx);
    case 'trick-unlock-select':
      return gameplayAction(ctx, (profile) => startTrickTraining(profile, value(ctx), ctx.now), tricksPanel);
    case 'trick-accelerate':
      return gameplayAction(ctx, (profile) => accelerateTrickTraining(profile, ctx.now), tricksPanel);
    case 'player-trainer':
      return trainerPanel(ctx);
    case 'trainer-hire-select':
      return gameplayAction(ctx, (profile) => hireTrainer(profile, value(ctx), ctx.now), trainerPanel);
    case 'trainer-release':
      return gameplayAction(ctx, (profile) => releaseTrainer(profile, ctx.now), trainerPanel);
    case 'player-culture':
      return { embeds: [info('Culture Study', 'Studi berjalan beberapa minggu dan memberi charm serta EXP skill.')], components: playerCultureControls(ctx.userId) };
    case 'culture-select':
      return gameplayAction(ctx, (profile) => startCultureStudy(profile, value(ctx) as CultureSubject, ctx.now), trainingPanel);
    case 'injury':
      return injuryPanel(ctx);
    case 'injury-treatment-select':
      return treatment(ctx, value(ctx));
    case 'club':
      return playerClubPanel(ctx);
    case 'player-league':
      return leaguePanel(ctx);
    case 'player-squad':
      return playerSquadPanel(ctx);
    case 'player-offers':
      return offersPanel(ctx);
    case 'player-offer-accept-select': {
      const updated = acceptTransferOffer(await requireProfile(ctx), value(ctx), ctx.now);
      await ctx.store.save(updated);
      return playerClubPanel(ctx, `Tawaran diterima: Anda bergabung dengan ${updated.club}.`);
    }
    case 'player-offer-decline-select': {
      const updated = declineTransferOffer(await requireProfile(ctx), value(ctx), ctx.now);
      await ctx.store.save(updated);
      return offersPanel(ctx, 'Tawaran ditolak.');
    }
    case 'player-clubs':
      return eligibleClubsPanel(ctx);
    case 'player-club-select':
      return transferPreview(ctx, Number(value(ctx)));
    case 'contract':
    case 'player-personal':
      return contractPanel(ctx);
    case 'contract-renew': {
      const updated = renewContract(await requireProfile(ctx), ctx.now);
      await ctx.store.save(updated);
      return contractPanel(ctx, 'Kontrak diperbarui.');
    }
    case 'contract-raise': {
      const result = requestSalaryRaise(await requireProfile(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return contractPanel(ctx, result.message);
    }
    case 'honors':
      return honorsPanel(ctx);
    case 'achievement-claim-select': {
      const result = claimAchievement(await requireProfile(ctx), value(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return honorsPanel(ctx, `${result.achievement.title} diklaim: +${formatMoney(result.achievement.rewardMoney)} money, +${result.achievement.rewardExp} EXP.`);
    }
    case 'daily-reward': {
      const result = claimDailyReward(await requireProfile(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return playerHome(result.profile, ctx.userId, `Daily reward: +${formatMoney(result.amount)} money, +${result.exp} EXP · streak ${result.streak} hari.`);
    }
    case 'player-champions':
    case 'player-champions-status':
      return championsStatus(ctx, 'PLAYER');
    case 'player-champions-play':
      return championsPlay(ctx, 'PLAYER');
    case 'player-career':
      return careerPanel(ctx);
    case 'player-retire': {
      const profile = await requireProfile(ctx);
      if (!canRetire(profile)) throw new Error('Retirement sukarela belum tersedia.');
      return { embeds: [info('Pensiun?', `Karier ${profile.displayName} (usia ${profile.age}) akan berakhir. Money, Hall of Honor, dan riwayat karier tetap tersimpan, lalu Anda dapat Rebirth.`)], components: retireConfirmControls(ctx.userId) };
    }
    case 'player-retire-confirm':
      return gameplayAction(ctx, (profile) => retirePlayer(profile, ctx.now), careerPanel);
    case 'player-rebirth-select': {
      const resolved = resolvePosition(value(ctx));
      if (!resolved) throw new Error('Posisi rebirth tidak valid.');
      const result = rebirthPlayer(await requireProfile(ctx), ctx.now, resolved.group);
      result.profile.positionDetail = resolved.detail;
      await ctx.store.save(result.profile);
      return playerHome(result.profile, ctx.userId, result.message);
    }

    // Coach Mode
    case 'coach-round': {
      const result = advanceCoachRound(await requireCoach(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return { embeds: [coachRoundEmbed(result)], components: coachControls(ctx.userId, coachState(result.profile)) };
    }
    case 'coach-club':
      return coachClubPanel(ctx);
    case 'coach-event':
      return coachEventPanel(ctx);
    case 'coach-event-select':
      return coachAction(ctx, (profile) => resolveCoachEvent(profile, value(ctx), ctx.now), (profile) => `Keputusan diambil. Approval ${profile.coach!.approval}/100.`);
    case 'coach-exp':
      return coachExpPanel(ctx);
    case 'coach-exp-select': {
      const profile = await requireCoach(ctx);
      const ability = value(ctx) as CoachAbilityId;
      const amount = profile.coach!.unassignedExp;
      if (amount <= 0) throw new Error('Tidak ada Coach EXP yang menunggu.');
      const result = assignCoachExp(profile, { [ability]: amount }, ctx.now);
      await ctx.store.save(result.profile);
      return coachHome(result.profile, ctx.userId, `${amount} EXP ke ${COACH_ABILITY_LABELS[ability]}${result.levelsGained ? ` · naik ${result.levelsGained} level` : ''}.`);
    }
    case 'coach-strategy':
      return coachStrategyPanel(ctx);
    case 'coach-formation-select':
    case 'coach-tactic-select': {
      const profile = await requireCoach(ctx);
      const updated = action === 'coach-formation-select' ? setClubFormation(profile, value(ctx) as FormationId, ctx.now, 'coachClubState') : setClubTactic(profile, value(ctx) as TacticId, ctx.now, 'coachClubState');
      await ctx.store.save(updated);
      return coachStrategyPanel(ctx, 'Strategi diperbarui.');
    }
    case 'coach-job':
      return coachJobPanel(ctx);
    case 'coach-job-generate': {
      const result = generateJobOffer(await requireCoach(ctx), undefined, ctx.now);
      await ctx.store.save(result.profile);
      return coachJobPanel(ctx, `${result.offer.clubName} tertarik merekrut Anda.`);
    }
    case 'coach-job-accept-select':
      return coachAction(ctx, (profile) => acceptJobOffer(profile, value(ctx), ctx.now), (profile) => `Anda sekarang melatih ${profile.coachClubState?.name ?? profile.club}. Target board: ${profile.coach!.boardTarget.type} #${profile.coach!.boardTarget.targetRank}.`);
    case 'coach-job-decline-select': {
      const updated = declineJobOffer(await requireCoach(ctx), value(ctx), ctx.now);
      await ctx.store.save(updated);
      return coachJobPanel(ctx, 'Tawaran ditolak.');
    }
    case 'coach-champions':
    case 'coach-champions-status':
      return championsStatus(ctx, 'COACH');
    case 'coach-champions-play':
      return championsPlay(ctx, 'COACH');
    case 'coach-market':
      return coachMarketPanel(ctx);
    case 'coach-buy-select': {
      const result = buyCoachPlayer(await requireCoach(ctx), value(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return coachMarketPanel(ctx, `${result.listing.player.name} bergabung seharga ${formatMoney(result.listing.price)}.`);
    }
    case 'coach-sell-select': {
      const result = sellCoachPlayer(await requireCoach(ctx), value(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return coachMarketPanel(ctx, `${result.player.name} dijual seharga ${formatMoney(result.price)}.`);
    }
    case 'coach-season-end': {
      const result = settleCoachSeasonWithSummary(await requireCoach(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return { embeds: [coachSeasonEmbed(result.profile, result.summary)], components: coachControls(ctx.userId, coachState(result.profile)) };
    }
    case 'coach-career':
      return coachCareerPanel(ctx);
    case 'coach-retire':
      return { embeds: [info('Pensiun sebagai Coach?', 'Karier Coach berakhir dan honor legacy dicatat. Rebirth memulai karier Coach baru dengan bonus level dari honor.')], components: coachRetireConfirmControls(ctx.userId) };
    case 'coach-retire-confirm':
      return coachAction(ctx, (profile) => retireCoach(profile, ctx.now), () => 'Coach resmi pensiun. Buka Career untuk Rebirth.');
    case 'coach-rebirth':
      return coachAction(ctx, (profile) => rebirthCoach(profile, ctx.now), (profile) => `Coach rebirth selesai: level awal ${profile.coach!.level}.`);

    // Versus Mode
    case 'versus-results':
      return versusInfoPanel(ctx, versusResultsEmbed);
    case 'versus-standings':
      return versusInfoPanel(ctx, (profile, season) => versusStandingsEmbed(season!, profile.versus!.clubId));
    case 'versus-schedule':
      return versusInfoPanel(ctx, versusScheduleEmbed);
    case 'versus-registration':
      return versusInfoPanel(ctx, versusRegistrationEmbed, false);
    case 'versus-rewards':
      return versusInfoPanel(ctx, versusRewardsEmbed, false);
    case 'versus-global-ranking': {
      const { profile, season } = await versusSeasonView(ctx);
      return { embeds: [versusGlobalRankingEmbed(await ctx.store.all())], components: viewControls(ctx.userId, profile, season) };
    }
    case 'versus-market':
      return versusMarketPanel(ctx);
    case 'versus-bid-select': {
      const result = await placeVersusBidFor(ctx.store, ctx.userId, value(ctx), undefined, ctx.now);
      return versusMarketPanel(ctx, `Bid ${result.listing.currentBid} coin untuk ${result.listing.player.name} tercatat (coin di-reserve).`);
    }
    case 'versus-squad':
      return versusSquadPanel(ctx);
    case 'versus-scout':
      return versusScoutPanel(ctx);
    case 'versus-scout-junior':
    case 'versus-scout-senior': {
      const result = await scoutVersusPlayerFor(ctx.store, ctx.userId, action === 'versus-scout-junior' ? 'JUNIOR' : 'SENIOR', ctx.now);
      return versusSquadPanel(ctx, `Scout menemukan ${result.player.name} (${result.player.position}, usia ${result.player.age}, skor ${Math.round(abilityScore(result.player))}) · biaya ${result.cost}.`);
    }
    case 'versus-sponsor':
      return versusSponsorPanel(ctx);
    case 'versus-next-season': {
      const view = await startNextVersusSeason(ctx.store, ctx.userId, ctx.now);
      const grade = view.profile.versus?.club.grade;
      return versusPanel(view, ctx.userId, view.waiting ? 'Menunggu season berikutnya di private group.' : `Season baru dimulai di Liga ${grade === undefined ? '-' : versusLeagueCode(grade)}.`);
    }
    case 'versus-leave-private':
      return versusPanel(await leaveWaitingVersusGroup(ctx.store, ctx.userId, ctx.now), ctx.userId, 'Club dipindahkan ke public league.');
    case 'versus-dm-toggle': {
      const profile = await toggleVersusDm(ctx.store, ctx.userId, ctx.now);
      return versusHome(ctx, `Notifikasi DM Versus ${dmEnabled(profile) ? 'diaktifkan' : 'dinonaktifkan'}.`);
    }
    default:
      throw new Error('Aksi komponen tidak dikenali. Buka ulang menu dari /play.');
  }
}

function componentOwner(customId: string, userId: string): string {
  const [namespace, ownerId, ...parts] = customId.split(':');
  const action = parts.join(':');
  if (namespace !== 'frs' || ownerId !== userId || !action) throw new Error('Komponen ini bukan milik Anda. Jalankan /play untuk membuka menu Anda sendiri.');
  return action;
}

const deferredByUpdate = new WeakSet<object>();

/**
 * Acknowledges within Discord's 3-second window. A click inside an ephemeral
 * panel edits that panel in place; a click on a public message (the /play
 * entry) opens a private panel; /play itself replies publicly.
 */
export async function acknowledge(interaction: ChatInputCommandInteraction | ComponentInteraction): Promise<void> {
  if (interaction.replied || interaction.deferred) return;
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply(interaction.commandName === 'play' ? {} : { flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
    await interaction.deferUpdate();
    deferredByUpdate.add(interaction);
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

/** Short private notice (errors, rate limits) that never overwrites an in-place panel. */
export async function notice(interaction: ChatInputCommandInteraction | ComponentInteraction, message: string): Promise<void> {
  const content = clip(message, 1_900);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } else if (interaction.replied || deferredByUpdate.has(interaction)) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.editReply({ content, embeds: [], components: [] });
  }
}

async function reportError(interaction: ChatInputCommandInteraction | ComponentInteraction, error: unknown, event: string): Promise<void> {
  log('error', event, { userId: interaction.user.id, id: interaction.isChatInputCommand() ? interaction.commandName : interaction.customId, error });
  try {
    await notice(interaction, error instanceof Error ? error.message : 'Terjadi kesalahan internal.');
  } catch (replyError) {
    log('error', 'interaction_error_reply_failed', { userId: interaction.user.id, error: replyError });
  }
}

export async function handleComponent(interaction: ComponentInteraction, store: PlayerStore): Promise<void> {
  try {
    await acknowledge(interaction);
    const action = componentOwner(interaction.customId, interaction.user.id);
    const ctx: Ctx = { store, userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username, now: new Date(), values: interaction.isStringSelectMenu() ? [...interaction.values] : [] };
    // A save that lost an optimistic-concurrency race is recomputed from fresh state.
    const panel = await withConflictRetry(() => routeComponent({ ...ctx, now: new Date() }, action));
    await respond(interaction, panel);
  } catch (error) {
    await reportError(interaction, error, 'component_failed');
  }
}

// --------------------------------------------------------- Fallback commands

async function routeCommand(interaction: ChatInputCommandInteraction, ctx: Ctx, command: string, root: string): Promise<Panel> {
  const option = (name: string) => interaction.options.getString(name);
  const required = (name: string) => interaction.options.getString(name, true);
  const integer = (name: string) => interaction.options.getInteger(name);
  const withValues = (values: string[]): Ctx => ({ ...ctx, values });
  switch (command) {
    case 'play':
      return { embeds: [gameHomeEmbed(await ctx.store.get(ctx.userId))], components: mainMenuControls(ctx.userId) };
    case 'start':
      return createPlayer(ctx, required('position') as Position);
    case 'profile':
      return playerHomeAction(ctx);
    case 'next-week':
    case 'match':
      return continueWeek(ctx);
    case 'league':
    case 'standings':
      return leaguePanel(ctx);
    case 'injury': {
      const action = option('action') ?? 'view';
      return treatment(ctx, action);
    }
    case 'retire':
      return gameplayAction(ctx, (profile) => retirePlayer(profile, ctx.now), careerPanel);
    case 'rebirth': {
      const result = rebirthPlayer(await requireProfile(ctx), ctx.now);
      await ctx.store.save(result.profile);
      return playerHome(result.profile, ctx.userId, result.message);
    }
    case 'daily':
      return routeComponent(ctx, 'daily-reward');
    case 'player-event-disabled':
      return { embeds: [info('Weekly Event', 'Event Player muncul acak saat Weekly Update dan diselesaikan lewat tombol Weekly Event Decision.')] };
    case 'contract':
      return (option('action') ?? 'view') === 'sign' ? routeComponent(ctx, 'contract-renew') : contractPanel(ctx);
    case 'champions': {
      const mode: ChampionsLeagueMode = root === 'coach' ? 'COACH' : 'PLAYER';
      return (option('action') ?? 'status') === 'play' ? championsPlay(ctx, mode) : championsStatus(ctx, mode);
    }
    case 'train':
      return regularTraining(ctx, required('ability') as AbilityId);
    case 'skills':
      return skillsPanel(ctx);
    case 'train-skill':
      return detailedTraining(ctx, required('skill') as DetailedSkillId);
    case 'assign-exp': {
      const skill = required('skill') as DetailedSkillId;
      const amount = integer('amount') ?? 0;
      const result = assignMatchExp(await requireProfile(ctx), { [skill]: amount }, ctx.now);
      await ctx.store.save(result.profile);
      return playerHome(result.profile, ctx.userId, `${result.allocated} EXP ke ${DETAILED_SKILL_LABELS[skill]} · sisa ${result.remaining}.`);
    }
    case 'trick':
      return (option('action') ?? 'list') === 'train' ? routeComponent(withValues([required('trick_id')]), 'trick-unlock-select') : tricksPanel(ctx);
    case 'trainer': {
      const action = option('action') ?? 'list';
      if (action === 'hire') return routeComponent(withValues([required('trainer_id')]), 'trainer-hire-select');
      if (action === 'release') return routeComponent(ctx, 'trainer-release');
      return trainerPanel(ctx);
    }
    case 'culture':
      return routeComponent(withValues([required('subject')]), 'culture-select');
    case 'club':
      return playerClubPanel(ctx);
    case 'clubs': {
      const league = integer('league') ?? undefined;
      const clubs = listOfficialClubs(league).slice(0, 40);
      return { embeds: [info(`Official Clubs${league ? ` · League ${league}` : ''}`, clubs.map((club) => `**${club.id}** · ${club.nameEn} · league ${club.league} · grade ${club.grade}`).join('\n') || 'Tidak ada klub.')] };
    }
    case 'join-club':
      return routeComponent(ctx, `player-club-confirm:${integer('club_id')}`);
    case 'squad':
      return playerSquadPanel(ctx);
    case 'formation':
    case 'tactic':
      // Only /coach exposes these; Player Mode clubs are run by the AI coach.
      return routeComponent(withValues([required('id')]), command === 'formation' ? 'coach-formation-select' : 'coach-tactic-select');
    case 'honors':
    case 'achievements':
    case 'world-footballer':
      return honorsPanel(ctx);
    case 'claim-achievement':
      return routeComponent(withValues([required('achievement')]), 'achievement-claim-select');
    case 'coach-career': {
      if ((option('action') ?? 'status') === 'start') return coachHomeAction(ctx);
      return coachHome(await requireCoach(ctx), ctx.userId);
    }
    case 'coach-profile':
      return coachHome(await requireCoach(ctx), ctx.userId);
    case 'coach-event': {
      const choice = option('choice');
      return choice ? routeComponent(withValues([choice]), 'coach-event-select') : coachEventPanel(ctx);
    }
    case 'coach-round':
      return routeComponent(ctx, 'coach-round');
    case 'coach-exp': {
      const ability = required('ability') as CoachAbilityId;
      const result = assignCoachExp(await requireCoach(ctx), { [ability]: integer('amount') ?? 0 }, ctx.now);
      await ctx.store.save(result.profile);
      return coachHome(result.profile, ctx.userId, `EXP dialokasikan ke ${COACH_ABILITY_LABELS[ability]} · sisa ${result.remaining}.`);
    }
    case 'coach-job': {
      const action = option('action') ?? 'list';
      if (action === 'generate') return routeComponent(ctx, 'coach-job-generate');
      if (action === 'accept') return routeComponent(withValues([required('offer_id')]), 'coach-job-accept-select');
      if (action === 'decline') return routeComponent(withValues([required('offer_id')]), 'coach-job-decline-select');
      return coachJobPanel(ctx);
    }
    case 'coach-retire':
      return routeComponent(ctx, 'coach-retire-confirm');
    case 'coach-rebirth':
      return routeComponent(ctx, 'coach-rebirth');
    case 'versus-profile':
      return versusHome(ctx);
    case 'versus-roster':
      return versusSquadPanel(ctx);
    case 'versus-standings':
      return routeComponent(ctx, 'versus-standings');
    case 'versus-round':
    case 'versus-season':
      return versusHome(ctx, 'Round dan season Versus diproses otomatis saat deadline; hasil dikirim via DM.');
    case 'versus-join': {
      const view = await joinVersusGroup(ctx.store, ctx.userId, required('group_code'), ctx.now);
      return versusPanel(view, ctx.userId, view.waiting ? 'Terdaftar; season group ini sudah berjalan, club masuk di season berikutnya.' : `Bergabung dengan group ${view.profile.versus?.groupCode}.`);
    }
    case 'versus-bid': {
      const result = await placeVersusBidFor(ctx.store, ctx.userId, required('listing_id').trim(), integer('amount') ?? undefined, ctx.now);
      return versusMarketPanel(ctx, `Bid ${result.listing.currentBid} coin untuk ${result.listing.player.name} tercatat.`);
    }
    case 'versus-lineup': {
      const ids = (name: string) => [...new Set((option(name) ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
      const result = await submitVersusLineupFor(ctx.store, ctx.userId, { battleId: required('battle_id').trim(), lineup: ids('lineup'), substitutes: ids('substitutes'), captainId: required('captain').trim(), formation: required('formation') as FormationId, tactic: required('tactic') as TacticId, rosterVersion: integer('roster_version') ?? 0 }, ctx.now);
      return versusPanel({ profile: result.profile, season: result.season }, ctx.userId, 'Lineup tersimpan.');
    }
    case 'admin': {
      if (!ADMIN_USER_IDS.has(ctx.userId)) throw new Error('Anda tidak memiliki akses admin.');
      if (option('action') === 'run-maintenance') {
        const run = async () => ({ profiles: await runMaintenance(ctx.store, ctx.now), versus: await runVersusMaintenance(ctx.store, ctx.now) });
        const lockStore = ctx.store as Partial<MaintenanceLockStore>;
        const outcome = typeof lockStore.withMaintenanceLock === 'function' ? await lockStore.withMaintenanceLock(run) : await run();
        return { embeds: [info('Maintenance', outcome ? `Selesai: ${outcome.profiles} profil diperiksa · ${outcome.versus} battle/listing Versus diproses.` : 'Maintenance sedang berjalan di instance lain; coba lagi sebentar.')] };
      }
      const profiles = await ctx.store.all();
      const versusClubs = profiles.filter((profile) => profile.versus).length;
      const pending = profiles.reduce((sum, profile) => sum + (profile.notifications ?? []).filter((item) => item.status === 'PENDING').length, 0);
      const rosterData = PLAYER_OVERLAY_SUMMARY ? `APK + overlay Transfermarkt (${PLAYER_OVERLAY_SUMMARY.clubs} klub · ${PLAYER_OVERLAY_SUMMARY.players} pemain · snapshot ${PLAYER_OVERLAY_SUMMARY.snapshot})` : 'APK recovery saja';
      return { embeds: [info('Bot Operations', `Profiles **${profiles.length}** · Coach **${profiles.filter((profile) => profile.coach).length}** · Versus clubs **${versusClubs}**\nPending DM **${pending}**\nPersistence **${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON'}** · ${process.env.NODE_ENV ?? 'development'}\nData roster: ${rosterData}\nBuild **${BUILD_LABEL}**`)] };
    }
    case 'help':
      return { embeds: [info('Football Rising Star — Panduan', 'Mulai dengan `/play`, lalu semua aksi lewat tombol.').addFields(
        { name: 'Player', value: 'Next Week → (Event) → Play Match → Assign EXP. Training 1x/minggu, kontrak & gaji per minggu, transfer saat season break, pensiun & rebirth.' },
        { name: 'Coach', value: 'Play Round, ability Coach mempengaruhi pertandingan, transfer market memakai assets club, Season Settlement menutup season.' },
        { name: 'Versus', value: 'Liga S→E tanpa negara. Submit lineup sebelum deadline; battle diproses otomatis. Market lelang, sponsor, scout. Hasil & pengingat via DM.' }
      )] };
    default:
      return { embeds: [info('Command', 'Command belum dikenali. Gunakan /play.')] };
  }
}

export async function handleCommand(interaction: ChatInputCommandInteraction, store: PlayerStore): Promise<void> {
  const root = interaction.commandName;
  const command = resolveModeCommand(root, interaction.options.getSubcommand(false) ?? undefined, interaction.options.getSubcommandGroup(false) ?? undefined);
  try {
    await acknowledge(interaction);
    const ctx: Ctx = { store, userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username, now: new Date(), values: [] };
    const panel = await withConflictRetry(() => routeCommand(interaction, { ...ctx, now: new Date() }, command, root));
    await respond(interaction, panel);
  } catch (error) {
    await reportError(interaction, error, 'command_failed');
  }
}
