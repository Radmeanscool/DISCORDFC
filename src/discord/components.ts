import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import type { RecoveryClubRecord } from '../config/recovery-data.js';
import { GAME_BALANCE } from '../config/game-balance.js';
import {
  COACH_ABILITIES,
  COACH_ABILITY_LABELS,
  DETAILED_SKILLS,
  DETAILED_SKILL_LABELS,
  FORMATIONS,
  POSITION_LABELS,
  TACTICS,
  TRAINER_CATALOG,
  type AchievementState,
  type ClubPlayer,
  type FormationId,
  type MarketListing,
  type PlayerTransferOffer,
  type PlayerWeeklyEvent,
  type Position,
  type TacticId,
  type TrickDefinition,
  type VersusMarketListing,
  type VersusPlayer,
  type VersusSponsorTier
} from '../domain/types.js';

/**
 * Every custom id is `frs:<ownerUserId>:<action>` and must stay within
 * Discord's 100-character limit, so Versus lineup steps carry only the round
 * and roster version (`vl:<step>:<round>:<rosterVersion>`), never battle ids.
 */
type Row = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

export const CUSTOM_ID_LIMIT = 100;

function customId(userId: string, action: string): string {
  const value = `frs:${userId}:${action}`;
  if (value.length > CUSTOM_ID_LIMIT) throw new Error(`Custom id terlalu panjang (${value.length}): ${action}`);
  return value;
}

function button(userId: string, action: string, label: string, style = ButtonStyle.Secondary, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId(userId, action)).setLabel(label.slice(0, 80)).setStyle(style).setDisabled(disabled);
}

function buttons(...items: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...items.slice(0, 5));
}

function option(value: string, label: string, description?: string, selected = false): StringSelectMenuOptionBuilder {
  const item = new StringSelectMenuOptionBuilder().setValue(value.slice(0, 100)).setLabel(label.slice(0, 100)).setDefault(selected);
  if (description) item.setDescription(description.slice(0, 100));
  return item;
}

function select(userId: string, action: string, placeholder: string, options: StringSelectMenuOptionBuilder[], min = 1, max = 1): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder().setCustomId(customId(userId, action)).setPlaceholder(placeholder.slice(0, 150));
  if (options.length === 0) {
    // Discord requires at least one option; an empty choice renders as a disabled menu.
    menu.addOptions(option('none', 'Tidak ada pilihan')).setDisabled(true).setMinValues(1).setMaxValues(1);
  } else {
    const limited = options.slice(0, 25);
    menu.addOptions(limited).setMinValues(Math.min(min, limited.length)).setMaxValues(Math.max(1, Math.min(max, limited.length)));
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function modeControls(userId: string): ActionRowBuilder<ButtonBuilder> {
  return buttons(
    button(userId, 'menu-home', 'Game Home'),
    button(userId, 'menu-coach', 'Coach Mode', ButtonStyle.Primary),
    button(userId, 'versus-home', 'Versus Mode', ButtonStyle.Success)
  );
}

export function mainMenuControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(
    button(userId, 'menu-player', 'Player Mode', ButtonStyle.Primary),
    button(userId, 'menu-coach', 'Coach Mode'),
    button(userId, 'menu-versus', 'Versus Mode', ButtonStyle.Success)
  )];
}

function positionOptions(current?: Position): StringSelectMenuOptionBuilder[] {
  return (['GK', 'DF', 'MF', 'FW'] as const).map((position) => option(position, POSITION_LABELS[position], undefined, position === current));
}

export function playerCreationControls(userId: string): Row[] {
  return [
    select(userId, 'player-create-select', 'Pilih posisi awal pemain', positionOptions()),
    buttons(button(userId, 'menu-home', 'Back to Game Home'))
  ];
}

// ---------------------------------------------------------------- Player Mode

export type PlayerWeeklyStage = 'READY' | 'MATCH_READY' | 'EXP_PENDING' | 'EVENT_PENDING' | 'SEASON_BREAK';

export function playerWeeklyControls(userId: string, stage: PlayerWeeklyStage = 'READY', retired = false): ActionRowBuilder<ButtonBuilder>[] {
  const canAdvance = !retired && (stage === 'READY' || stage === 'SEASON_BREAK');
  const canMatch = !retired && stage === 'MATCH_READY';
  const pendingExp = stage === 'EXP_PENDING';
  return [
    buttons(
      button(userId, 'profile', 'Player Status', ButtonStyle.Primary),
      button(userId, 'train', 'Training', ButtonStyle.Secondary, retired),
      button(userId, 'player-culture', 'Personal', ButtonStyle.Secondary, retired),
      button(userId, 'club', 'Club'),
      button(userId, 'player-career', retired ? 'Rebirth' : 'Career', retired ? ButtonStyle.Success : ButtonStyle.Secondary)
    ),
    buttons(
      button(userId, 'next-week', canAdvance ? 'Next Week' : 'Weekly Update', ButtonStyle.Success, !canAdvance),
      button(userId, 'match', canMatch ? 'Play Match' : 'Match', ButtonStyle.Success, !canMatch),
      button(userId, 'skills', pendingExp ? 'Assign EXP' : 'Detailed Skills', ButtonStyle.Primary),
      button(userId, 'injury', 'Recovery')
    ),
    buttons(
      ...(stage === 'EVENT_PENDING' ? [button(userId, 'player-event', 'Weekly Event Decision', ButtonStyle.Primary)] : []),
      button(userId, 'daily-reward', 'Daily Reward'),
      button(userId, 'contract', 'Contract'),
      button(userId, 'honors', 'Honors'),
      button(userId, 'player-champions', 'Champions')
    ),
    modeControls(userId)
  ];
}

export function playerEventControls(userId: string, event: PlayerWeeklyEvent): Row[] {
  return [
    select(userId, 'player-event-select', 'Pilih respons untuk event mingguan', event.choices.map((choice) => option(choice.id, choice.label, choice.description))),
    buttons(button(userId, 'menu-player', 'Weekly Hub', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home'))
  ];
}

export function playerCareerControls(userId: string, retired: boolean, canRetire: boolean, position: Position): Row[] {
  if (retired) {
    return [
      select(userId, 'player-rebirth-select', 'Rebirth · pilih posisi generasi berikutnya', positionOptions(position)),
      buttons(button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home'))
    ];
  }
  return [buttons(
    button(userId, 'player-retire', 'Retire', ButtonStyle.Danger, !canRetire),
    button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary),
    button(userId, 'menu-home', 'Game Home')
  )];
}

export function retireConfirmControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(
    button(userId, 'player-retire-confirm', 'Ya, pensiun sekarang', ButtonStyle.Danger),
    button(userId, 'player-career', 'Batal')
  )];
}

export function detailedTrainingControls(userId: string): Row[] {
  return [
    select(userId, 'detailed-train-select', 'Pilih detailed skill untuk dilatih', DETAILED_SKILLS.map((skill) => option(skill, DETAILED_SKILL_LABELS[skill]))),
    buttons(button(userId, 'train', 'Back to Training'), button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary))
  ];
}

/** Multi-select: one skill takes the whole pool, several skills split it evenly. */
export function pendingExpControls(userId: string): Row[] {
  return [
    select(userId, 'pending-exp-select', 'Pilih 1 skill (semua EXP) atau beberapa skill (dibagi rata)', DETAILED_SKILLS.map((skill) => option(skill, DETAILED_SKILL_LABELS[skill])), 1, DETAILED_SKILLS.length),
    buttons(
      button(userId, 'menu-player', 'Weekly Hub', ButtonStyle.Primary),
      button(userId, 'player-league', 'League Table'),
      button(userId, 'menu-home', 'Game Home')
    )
  ];
}

export function trainingControls(userId: string): Row[] {
  const abilities: Array<[string, string]> = [['atk', 'Attack'], ['def', 'Defence'], ['speed', 'Speed'], ['power', 'Power'], ['strength', 'Strength'], ['technique', 'Technique']];
  return [
    select(userId, 'train-select', 'Regular Training (1x per minggu) · pilih ability', abilities.map(([value, label]) => option(value, label))),
    buttons(
      button(userId, 'detailed-train', 'Detailed Skills', ButtonStyle.Primary),
      button(userId, 'player-tricks', 'Tricks'),
      button(userId, 'player-trainer', 'Trainer'),
      button(userId, 'player-culture', 'Culture Study'),
      button(userId, 'menu-player', 'Player Home')
    )
  ];
}

export function trickControls(userId: string, unlockable: TrickDefinition[]): Row[] {
  const rows: Row[] = [];
  if (unlockable.length) rows.push(select(userId, 'trick-unlock-select', 'Unlock trick yang syaratnya terpenuhi', unlockable.map((trick) => option(trick.id, trick.name, `Energy ${trick.energyCost} · bonus +${Math.round(trick.matchModifier * 100)}%`))));
  rows.push(buttons(button(userId, 'train', 'Back to Training'), button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary)));
  return rows;
}

export function trainerControls(userId: string, hasActiveTrainer: boolean): Row[] {
  const rows: Row[] = [];
  if (!hasActiveTrainer) rows.push(select(userId, 'trainer-hire-select', 'Hire personal trainer', Object.values(TRAINER_CATALOG).map((trainer) => option(trainer.id, `${trainer.tier} · ${trainer.type}`, `${trainer.weeklyCost}/minggu · ratio ${Math.round(trainer.ratio * 100)}%`))));
  rows.push(buttons(
    button(userId, 'trainer-release', 'Release Trainer', ButtonStyle.Danger, !hasActiveTrainer),
    button(userId, 'train', 'Back to Training'),
    button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary)
  ));
  return rows;
}

export function playerInjuryControls(userId: string): Row[] {
  return [
    select(userId, 'injury-treatment-select', 'Pilih recovery action', [option('view', 'Lihat status cedera'), option('basic-treatment', 'Basic treatment'), option('expert-treatment', 'Expert treatment')]),
    buttons(button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary))
  ];
}

export function playerCultureControls(userId: string): Row[] {
  return [
    select(userId, 'culture-select', 'Pilih subjek Culture Study', [option('science', 'Science'), option('arts', 'Arts'), option('history', 'History')]),
    buttons(button(userId, 'train', 'Back to Training'), button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary))
  ];
}

/** The athlete does not manage the club: no club match, market, or tactic controls here. */
export function playerClubControls(userId: string, openOffers = 0, transferWindow = true): ActionRowBuilder<ButtonBuilder>[] {
  return [
    buttons(
      button(userId, 'player-league', 'League Table'),
      button(userId, 'player-squad', 'Squad'),
      button(userId, 'player-offers', openOffers ? `Transfer Offers (${openOffers})` : 'Transfer Offers', openOffers ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(userId, 'player-clubs', 'Change Club', ButtonStyle.Primary, !transferWindow)
    ),
    buttons(button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home'))
  ];
}

export function officialClubControls(userId: string, clubs: RecoveryClubRecord[]): Row[] {
  return [
    select(userId, 'player-club-select', 'Pilih klub tujuan', clubs.map((club) => option(String(club.id), `${club.nameEn} · League ${club.league}`, `Grade ${club.grade} · Prestige ${club.prestige.toFixed(2)}`))),
    buttons(button(userId, 'club', 'Back to Club'), button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary))
  ];
}

export function transferConfirmControls(userId: string, clubId: number): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(
    button(userId, `player-club-confirm:${clubId}`, 'Confirm Transfer', ButtonStyle.Success),
    button(userId, 'player-clubs', 'Choose Another'),
    button(userId, 'club', 'Cancel', ButtonStyle.Danger)
  )];
}

export function transferOfferControls(userId: string, offers: PlayerTransferOffer[]): Row[] {
  const rows: Row[] = [];
  if (offers.length) {
    const options = (verb: string) => offers.map((offer) => option(offer.id, `${verb} ${offer.clubName}`, `${offer.weeklySalary}/minggu · ${offer.seasons} season · league ${offer.leagueId}`));
    rows.push(select(userId, 'player-offer-accept-select', 'Terima tawaran transfer', options('Terima')));
    rows.push(select(userId, 'player-offer-decline-select', 'Tolak tawaran transfer', options('Tolak')));
  }
  rows.push(buttons(button(userId, 'club', 'Back to Club'), button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary)));
  return rows;
}

export function contractControls(userId: string, canRenew: boolean, canRaise: boolean): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(
    button(userId, 'contract-renew', `Renew (${GAME_BALANCE.contract.defaultSeasons} season)`, ButtonStyle.Success, !canRenew),
    button(userId, 'contract-raise', 'Request Raise', ButtonStyle.Primary, !canRaise),
    button(userId, 'menu-player', 'Player Home')
  )];
}

export function honorsControls(userId: string, claimable: AchievementState[]): Row[] {
  const rows: Row[] = [];
  if (claimable.length) rows.push(select(userId, 'achievement-claim-select', 'Klaim achievement', claimable.map((item) => option(item.id, item.title, `${item.rewardMoney} money + ${item.rewardExp} EXP`))));
  rows.push(buttons(button(userId, 'menu-player', 'Player Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home')));
  return rows;
}

export function championsControls(userId: string, mode: 'PLAYER' | 'COACH'): ActionRowBuilder<ButtonBuilder>[] {
  const prefix = mode === 'PLAYER' ? 'player' : 'coach';
  return [buttons(
    button(userId, `${prefix}-champions-status`, 'Status'),
    button(userId, `${prefix}-champions-play`, 'Play Round', ButtonStyle.Success),
    button(userId, mode === 'PLAYER' ? 'menu-player' : 'menu-coach', `${mode === 'PLAYER' ? 'Player' : 'Coach'} Home`, ButtonStyle.Primary),
    button(userId, 'menu-home', 'Game Home')
  )];
}

// ----------------------------------------------------------------- Coach Mode

export interface CoachControlState {
  employed: boolean;
  seasonComplete: boolean;
  retired: boolean;
}

export function coachControls(userId: string, state: CoachControlState = { employed: true, seasonComplete: false, retired: false }): ActionRowBuilder<ButtonBuilder>[] {
  const active = state.employed && !state.retired;
  return [
    buttons(
      button(userId, 'coach-profile', 'Coach Profile', ButtonStyle.Primary),
      button(userId, 'coach-round', 'Play Round', ButtonStyle.Success, !active || state.seasonComplete),
      button(userId, 'coach-club', 'Club Office'),
      button(userId, 'coach-event', 'Decision')
    ),
    buttons(
      button(userId, 'coach-exp', 'Coach EXP'),
      button(userId, 'coach-strategy', 'Formation/Tactic', ButtonStyle.Secondary, !active),
      button(userId, 'coach-job', 'Job Offers'),
      button(userId, 'coach-champions', 'Champions', ButtonStyle.Secondary, !active)
    ),
    buttons(
      button(userId, 'coach-market', 'Transfer Market', ButtonStyle.Secondary, !active),
      button(userId, 'coach-season-end', 'Season Settlement', ButtonStyle.Success, !active || !state.seasonComplete),
      button(userId, 'coach-career', state.retired ? 'Rebirth' : 'Career'),
      button(userId, 'menu-home', 'Game Home'),
      button(userId, 'versus-home', 'Versus Mode', ButtonStyle.Success)
    )
  ];
}

export function coachEventControls(userId: string, choices: Array<{ id: string; label: string }>): Row[] {
  return [
    select(userId, 'coach-event-select', 'Pilih keputusan Coach event', choices.map((choice) => option(choice.id, choice.label))),
    buttons(button(userId, 'menu-coach', 'Coach Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home'))
  ];
}

export function coachExpControls(userId: string, remaining: number): Row[] {
  return [
    select(userId, 'coach-exp-select', `Pilih ability · pending ${remaining} EXP`, COACH_ABILITIES.map((ability) => option(ability, COACH_ABILITY_LABELS[ability], `Assign seluruh pending EXP (${remaining})`))),
    buttons(button(userId, 'menu-coach', 'Coach Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home'))
  ];
}

function strategySelects(userId: string, prefix: string, formation: FormationId, tactic: TacticId): Row[] {
  return [
    select(userId, `${prefix}-formation-select`, `Formation: ${formation}`, Object.values(FORMATIONS).map((item) => option(item.id, `${item.id} · ${item.name}`, `${item.slots.GK} GK · ${item.slots.DF} DF · ${item.slots.MF} MF · ${item.slots.FW} FW`, item.id === formation))),
    select(userId, `${prefix}-tactic-select`, `Tactic: ${TACTICS[tactic].name}`, Object.entries(TACTICS).map(([id, item]) => option(id, item.name, item.description, id === tactic)))
  ];
}

export function coachStrategyControls(userId: string, formation: FormationId, tactic: TacticId): Row[] {
  return [
    ...strategySelects(userId, 'coach', formation, tactic),
    buttons(button(userId, 'menu-coach', 'Coach Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home'))
  ];
}

export function coachJobControls(userId: string, offers: Array<{ id: string; clubName: string; salary?: number; targetRank?: number }>, canGenerate = true): Row[] {
  const rows: Row[] = [];
  if (offers.length > 0) {
    const describe = (offer: { salary?: number; targetRank?: number }) => offer.salary !== undefined ? `Salary ${offer.salary} · target rank ${offer.targetRank ?? '-'}` : undefined;
    rows.push(select(userId, 'coach-job-accept-select', 'Terima job offer', offers.map((offer) => option(offer.id, `Terima ${offer.clubName}`, describe(offer)))));
    rows.push(select(userId, 'coach-job-decline-select', 'Tolak job offer', offers.map((offer) => option(offer.id, `Tolak ${offer.clubName}`, describe(offer)))));
  }
  rows.push(buttons(
    button(userId, 'coach-job-generate', 'Cari Tawaran', ButtonStyle.Success, !canGenerate),
    button(userId, 'menu-coach', 'Coach Home', ButtonStyle.Primary),
    button(userId, 'menu-home', 'Game Home')
  ));
  return rows;
}

export function coachMarketControls(userId: string, listings: MarketListing[], sellable: ClubPlayer[], sellPrice: (player: ClubPlayer) => number): Row[] {
  const rows: Row[] = [];
  const open = listings.filter((listing) => listing.status === 'OPEN');
  if (open.length) rows.push(select(userId, 'coach-buy-select', 'Beli pemain (dibayar dari assets club)', open.map((listing) => option(listing.id, `${listing.player.name} · ${listing.player.position} · OVR ${listing.player.overall}`, `Harga ${listing.price} · usia ${listing.player.age}`))));
  if (sellable.length) rows.push(select(userId, 'coach-sell-select', 'Jual pemain (kedalaman minimum dijaga)', sellable.map((player) => option(player.id, `${player.name} · ${player.position} · OVR ${player.overall}`, `Harga jual ${sellPrice(player)} · usia ${player.age}`))));
  rows.push(buttons(button(userId, 'menu-coach', 'Coach Home', ButtonStyle.Primary), button(userId, 'menu-home', 'Game Home')));
  return rows;
}

export function coachCareerControls(userId: string, retired: boolean): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(
    retired ? button(userId, 'coach-rebirth', 'Rebirth Coach', ButtonStyle.Success) : button(userId, 'coach-retire', 'Retire Coach', ButtonStyle.Danger),
    button(userId, 'menu-coach', 'Coach Home', ButtonStyle.Primary),
    button(userId, 'menu-home', 'Game Home')
  )];
}

export function coachRetireConfirmControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(button(userId, 'coach-retire-confirm', 'Ya, pensiun', ButtonStyle.Danger), button(userId, 'coach-career', 'Batal'))];
}

// ---------------------------------------------------------------- Versus Mode

export type VersusPanelState = 'ACTIVE' | 'FINISHED' | 'WAITING';

export interface VersusHomeOptions {
  state?: VersusPanelState;
  round?: number;
  rosterVersion?: number;
  submitted?: boolean;
  dm?: boolean;
}

export function lineupAction(step: string, round: number, rosterVersion: number): string {
  return `vl:${step}:${round}:${rosterVersion}`;
}

export function versusHomeControls(userId: string, options: VersusHomeOptions = {}): ActionRowBuilder<ButtonBuilder>[] {
  const state = options.state ?? 'ACTIVE';
  const dmButton = button(userId, 'versus-dm-toggle', options.dm === false ? 'DM: Off' : 'DM: On', options.dm === false ? ButtonStyle.Secondary : ButtonStyle.Success);
  if (state === 'FINISHED') {
    return [
      buttons(
        button(userId, 'versus-next-season', 'Next Season', ButtonStyle.Success),
        button(userId, 'versus-results', 'Results'),
        button(userId, 'versus-standings', 'Standings'),
        button(userId, 'versus-rewards', 'Rewards'),
        button(userId, 'versus-rankings', 'Rankings')
      ),
      buttons(button(userId, 'versus-global-ranking', 'Global Ranking'), dmButton, button(userId, 'menu-home', 'Game Home'))
    ];
  }
  if (state === 'WAITING') {
    return [buttons(
      button(userId, 'versus-home', 'Refresh', ButtonStyle.Primary),
      button(userId, 'versus-leave-private', 'Pindah ke Public League', ButtonStyle.Success),
      button(userId, 'versus-squad', 'Squad'),
      dmButton,
      button(userId, 'menu-home', 'Game Home')
    )];
  }
  const lineup = options.round !== undefined && options.rosterVersion !== undefined
    ? button(userId, lineupAction('start', options.round, options.rosterVersion), options.submitted ? 'Edit Lineup' : 'Lineup', ButtonStyle.Success)
    : button(userId, 'versus-lineup-start', 'Lineup', ButtonStyle.Success, true);
  return [
    buttons(button(userId, 'versus-home', 'Home', ButtonStyle.Primary), lineup, button(userId, 'versus-results', 'Results'), button(userId, 'versus-standings', 'Standings'), button(userId, 'versus-schedule', 'Schedule')),
    buttons(button(userId, 'versus-market', 'Market'), button(userId, 'versus-squad', 'Squad'), button(userId, 'versus-scout', 'Scout'), button(userId, 'versus-sponsor', 'Sponsor'), button(userId, 'versus-rankings', 'Rankings')),
    buttons(button(userId, 'versus-rewards', 'Rewards'), button(userId, 'versus-registration', 'Registration'), button(userId, 'versus-global-ranking', 'Global Ranking'), dmButton, button(userId, 'menu-home', 'Game Home'))
  ];
}

function versusPlayerOption(player: VersusPlayer, score: number, selected = false): StringSelectMenuOptionBuilder {
  const status = player.status === 'AVAILABLE' ? '' : ` · ${player.status}`;
  return option(player.id, `${player.name} · ${player.position} · ${score}`, `HP ${player.hp}/${player.maxHp} · usia ${player.age}${status}`, selected);
}

export function versusSetupControls(userId: string, round: number, rosterVersion: number, formation: FormationId, tactic: TacticId, fieldable?: ReadonlySet<FormationId>): Row[] {
  const formations = Object.values(FORMATIONS).map((item) => option(item.id, `${item.id} · ${item.name}`, `${item.slots.GK} GK · ${item.slots.DF} DF · ${item.slots.MF} MF · ${item.slots.FW} FW${fieldable && !fieldable.has(item.id) ? ' · pemain fit kurang' : ''}`, item.id === formation));
  const tactics = Object.entries(TACTICS).map(([id, item]) => option(id, item.name, item.description, id === tactic));
  return [
    select(userId, lineupAction('fm', round, rosterVersion), `Formation: ${formation}`, formations),
    select(userId, lineupAction('tc', round, rosterVersion), `Tactic: ${TACTICS[tactic].name}`, tactics),
    buttons(
      button(userId, lineupAction('xi', round, rosterVersion), 'Choose XI', ButtonStyle.Success),
      button(userId, lineupAction('auto', round, rosterVersion), 'Auto XI', ButtonStyle.Primary),
      button(userId, 'versus-home', 'Cancel')
    )
  ];
}

/** One select per position; only players who can play this round are offered. */
export function versusPositionControls(userId: string, round: number, rosterVersion: number, formation: FormationId, eligible: VersusPlayer[], selected: Record<Position, string[]>, scoreOf: (player: VersusPlayer) => number): Row[] {
  const slots = FORMATIONS[formation].slots;
  const rows: Row[] = (['GK', 'DF', 'MF', 'FW'] as const).map((position) => {
    const players = eligible.filter((player) => player.position === position);
    const placeholder = players.length < slots[position] ? `${position} · butuh ${slots[position]}, hanya ${players.length} fit` : `${position} · pilih ${slots[position]} pemain`;
    return select(userId, lineupAction(position.toLowerCase(), round, rosterVersion), placeholder, players.map((player) => versusPlayerOption(player, scoreOf(player), selected[position].includes(player.id))), slots[position], slots[position]);
  });
  rows.push(buttons(
    button(userId, lineupAction('rev', round, rosterVersion), 'Review Lineup', ButtonStyle.Success),
    button(userId, lineupAction('start', round, rosterVersion), 'Back'),
    button(userId, 'versus-home', 'Cancel')
  ));
  return rows;
}

export function versusFinalizeControls(userId: string, round: number, rosterVersion: number, lineup: string[], eligible: VersusPlayer[], scoreOf: (player: VersusPlayer) => number, captain?: string, substitutes: string[] = []): Row[] {
  const starters = eligible.filter((player) => lineup.includes(player.id));
  const bench = eligible.filter((player) => !lineup.includes(player.id));
  return [
    select(userId, lineupAction('cap', round, rosterVersion), captain ? 'Captain dipilih' : 'Pilih captain', starters.map((player) => versusPlayerOption(player, scoreOf(player), captain === player.id))),
    select(userId, lineupAction('sub', round, rosterVersion), 'Substitutes · opsional, maksimal 5', bench.map((player) => versusPlayerOption(player, scoreOf(player), substitutes.includes(player.id))), 0, 5),
    buttons(
      button(userId, lineupAction('ok', round, rosterVersion), 'Confirm Submission', ButtonStyle.Success, !captain),
      button(userId, lineupAction('xi', round, rosterVersion), 'Edit XI', ButtonStyle.Primary),
      button(userId, 'versus-home', 'Cancel')
    )
  ];
}

export function versusMarketControls(userId: string, listings: VersusMarketListing[], minimumBid: (listing: VersusMarketListing) => number, scoreOf: (listing: VersusMarketListing) => number): Row[] {
  const rows: Row[] = [];
  const open = listings.filter((listing) => listing.status === 'OPEN');
  if (open.length) rows.push(select(userId, 'versus-bid-select', 'Bid minimum pada listing', open.map((listing) => option(listing.id, `${listing.player.name} · ${listing.player.position} · ${scoreOf(listing)}`, `Bid ${minimumBid(listing)} coin${listing.currentBidderId === userId ? ' · Anda tertinggi' : ''}`))));
  rows.push(buttons(button(userId, 'versus-market', 'Refresh', ButtonStyle.Primary), button(userId, 'versus-squad', 'Squad'), button(userId, 'versus-home', 'Home')));
  return rows;
}

export function versusSquadControls(userId: string, rosterVersion: number, releasable: Array<{ index: number; player: VersusPlayer; refund: number }>): Row[] {
  const rows: Row[] = [];
  if (releasable.length) rows.push(select(userId, `versus-release-select:${rosterVersion}`, 'Lepas pemain (refund 10% value)', releasable.map(({ index, player, refund }) => option(String(index), `${player.name} · ${player.position} · usia ${player.age}`, `Refund ${refund} money`))));
  rows.push(buttons(button(userId, 'versus-scout', 'Scout'), button(userId, 'versus-market', 'Market'), button(userId, 'versus-home', 'Home', ButtonStyle.Primary)));
  return rows;
}

export function versusReleaseConfirmControls(userId: string, rosterVersion: number, index: number): ActionRowBuilder<ButtonBuilder>[] {
  return [buttons(button(userId, `versus-release-confirm:${rosterVersion}:${index}`, 'Ya, lepas pemain', ButtonStyle.Danger), button(userId, 'versus-squad', 'Batal'))];
}

export function versusScoutControls(userId: string, versusMoney: number, rosterFull: boolean, scoutedThisRound: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const junior = GAME_BALANCE.versus.scout.JUNIOR;
  const senior = GAME_BALANCE.versus.scout.SENIOR;
  const blocked = rosterFull || scoutedThisRound;
  return [buttons(
    button(userId, 'versus-scout-junior', `Junior Scout · ${junior.cost}`, ButtonStyle.Primary, blocked || versusMoney < junior.cost),
    button(userId, 'versus-scout-senior', `Senior Scout · ${senior.cost}`, ButtonStyle.Success, blocked || versusMoney < senior.cost),
    button(userId, 'versus-squad', 'Squad'),
    button(userId, 'versus-home', 'Home')
  )];
}

export function versusSponsorControls(userId: string, grade = GAME_BALANCE.versus.startingGrade, signed?: VersusSponsorTier, seasonActive = true): ActionRowBuilder<ButtonBuilder>[] {
  const tiers: Array<[VersusSponsorTier, string]> = [['JUNIOR', 'Junior Sponsor'], ['SENIOR', 'Senior Sponsor'], ['TOP', 'Top Sponsor']];
  return [buttons(
    ...tiers.map(([tier, label]) => button(userId, `versus-sponsor-${tier.toLowerCase()}`, signed === tier ? `${label} ✓` : label, signed === tier ? ButtonStyle.Success : ButtonStyle.Secondary, !seasonActive || Boolean(signed) || grade > GAME_BALANCE.versus.sponsor[tier].minimumGrade)),
    button(userId, 'versus-home', 'Home', ButtonStyle.Primary)
  )];
}

export function versusRankingControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    buttons(
      button(userId, 'versus-ranking-club', 'Club', ButtonStyle.Primary),
      button(userId, 'versus-ranking-mvp', 'MVP'),
      button(userId, 'versus-ranking-scorers', 'Top Scorers'),
      button(userId, 'versus-ranking-assists', 'Top Assists'),
      button(userId, 'versus-ranking-goalkeepers', 'Goalkeepers')
    ),
    buttons(button(userId, 'versus-home', 'Home'))
  ];
}
