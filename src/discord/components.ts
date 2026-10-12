import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import { COACH_ABILITIES, COACH_ABILITY_LABELS, DETAILED_SKILLS, DETAILED_SKILL_LABELS, FORMATIONS, TACTICS, type FormationId, type PlayerWeeklyEvent, type TacticId, type VersusPlayer } from '../domain/types.js';

function modeControls(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`frs:${userId}:menu-coach`).setLabel('Coach Mode').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Versus Mode').setStyle(ButtonStyle.Success)
  );
}

export function mainMenuControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Mode').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-coach`).setLabel('Coach Mode').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-versus`).setLabel('Versus Mode').setStyle(ButtonStyle.Success)
    )
  ];
}

export function playerCreationControls(userId: string): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const positionSelect = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:player-create-select`)
    .setPlaceholder('Pilih posisi awal pemain')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('GK').setLabel('Goalkeeper'),
      new StringSelectMenuOptionBuilder().setValue('DF').setLabel('Defender'),
      new StringSelectMenuOptionBuilder().setValue('MF').setLabel('Midfielder'),
      new StringSelectMenuOptionBuilder().setValue('FW').setLabel('Forward')
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(positionSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Back to Game Home').setStyle(ButtonStyle.Secondary))
  ];
}

export function coachControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-profile`).setLabel('Coach Profile').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-round`).setLabel('Play Round').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-club`).setLabel('Club Office').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-event`).setLabel('Decision').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-exp`).setLabel('Coach EXP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-strategy`).setLabel('Formation/Tactic').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-job`).setLabel('Job Offers').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:coach-champions`).setLabel('Champions').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Versus Mode').setStyle(ButtonStyle.Success)
    )
  ];
}

export function coachEventControls(userId: string, choices: Array<{ id: string; label: string }>): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const selector = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:coach-event-select`)
    .setPlaceholder('Pilih keputusan Coach event')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(choices.map((choice) => new StringSelectMenuOptionBuilder().setValue(choice.id).setLabel(choice.label.slice(0, 100))));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selector),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary))
  ];
}

export function careerControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:profile`).setLabel('Profile').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:train`).setLabel('Train').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:next-week`).setLabel('Weekly Update').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:match`).setLabel('Play match').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:club`).setLabel('Club Office').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:daily-reward`).setLabel('Daily Reward').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:injury`).setLabel('Injury/Recovery').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:honors`).setLabel('Honors').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:contract`).setLabel('Contract').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-champions`).setLabel('Champions').setStyle(ButtonStyle.Secondary)
    ),
    modeControls(userId)
  ];
}

export type PlayerWeeklyStage = 'READY' | 'MATCH_READY' | 'EXP_PENDING' | 'EVENT_PENDING' | 'SEASON_BREAK';
export function playerWeeklyControls(userId: string, stage: PlayerWeeklyStage = 'READY'): ActionRowBuilder<ButtonBuilder>[] {
  const canAdvance = stage === 'READY' || stage === 'SEASON_BREAK';
  const canMatch = stage === 'MATCH_READY';
  const pendingExp = stage === 'EXP_PENDING';
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:profile`).setLabel('Player Status').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:train`).setLabel('Training').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-culture`).setLabel('Personal').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:club`).setLabel('Club').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:next-week`).setLabel(canAdvance ? 'Next Week' : 'Weekly Update').setStyle(ButtonStyle.Success).setDisabled(!canAdvance),
      new ButtonBuilder().setCustomId(`frs:${userId}:match`).setLabel(canMatch ? 'Play Match' : 'Match').setStyle(ButtonStyle.Success).setDisabled(!canMatch),
      new ButtonBuilder().setCustomId(`frs:${userId}:skills`).setLabel(pendingExp ? 'Assign EXP' : 'Detailed Skills').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:injury`).setLabel('Recovery').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...(stage === 'EVENT_PENDING' ? [new ButtonBuilder().setCustomId(`frs:${userId}:player-event`).setLabel('Weekly Event Decision').setStyle(ButtonStyle.Primary)] : []),
      new ButtonBuilder().setCustomId(`frs:${userId}:daily-reward`).setLabel('Daily Reward').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:contract`).setLabel('Contract').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:honors`).setLabel('Honors').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-champions`).setLabel('Champions').setStyle(ButtonStyle.Secondary)
    ),
    modeControls(userId)
  ];
}

export function playerEventControls(userId: string, event: PlayerWeeklyEvent): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const selector = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:player-event-select`)
    .setPlaceholder('Pilih respons untuk event mingguan')
    .addOptions(event.choices.map((choice) => new StringSelectMenuOptionBuilder().setValue(choice.id).setLabel(choice.label).setDescription(choice.description.slice(0, 100))));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selector),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Weekly Hub').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function gameplayControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:profile`).setLabel('Profile').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:skills`).setLabel('Detailed skills').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:next-week`).setLabel('Next week').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:match`).setLabel('Play match').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:club`).setLabel('Club office').setStyle(ButtonStyle.Secondary)
    ),
    modeControls(userId)
  ];
}

export function detailedTrainingControls(userId: string): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const options = DETAILED_SKILLS.map((skill) => new StringSelectMenuOptionBuilder().setValue(skill).setLabel(DETAILED_SKILL_LABELS[skill]));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`frs:${userId}:detailed-train-select`).setPlaceholder('Pilih detailed skill untuk dilatih').addOptions(options)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:train`).setLabel('Back to Training').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Home').setStyle(ButtonStyle.Primary)
    )
  ];
}

export function pendingExpControls(userId: string): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const options = DETAILED_SKILLS.map((skill) => new StringSelectMenuOptionBuilder().setValue(skill).setLabel(`Assign ke ${DETAILED_SKILL_LABELS[skill]}`));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`frs:${userId}:pending-exp-select`).setPlaceholder('Pilih skill untuk menerima seluruh pending EXP').addOptions(options)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Weekly Hub').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function versusHomeControls(userId: string, nextLabel = 'Next Battle'): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Home').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-next`).setLabel(nextLabel).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-lineup-start`).setLabel('Lineup').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-results`).setLabel('Results').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-standings`).setLabel('Standings').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-registration`).setLabel('Registration').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-market`).setLabel('Market').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-rewards`).setLabel('Rewards').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-schedule`).setLabel('Schedule').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-rankings`).setLabel('Rankings').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-global-ranking`).setLabel('Global Ranking').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-sponsor`).setLabel('Sponsor').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function versusToken(value: string | number): string {
  return encodeURIComponent(String(value));
}

function versusContext(userId: string, action: string, battleId: string, rosterVersion: number): string {
  return `frs:${userId}:${action}:${versusToken(battleId)}:${rosterVersion}`;
}

function playerOption(player: VersusPlayer, selected = false): StringSelectMenuOptionBuilder {
  const eligible = player.hp > 0 && player.status === 'AVAILABLE' && player.redCardBan === 0;
  return new StringSelectMenuOptionBuilder()
    .setValue(player.id)
    .setLabel(`${player.name} · ${player.id.split(':').pop() ?? player.id}`.slice(0, 100))
    .setDescription(`HP ${player.hp}/${player.maxHp} · ${player.position} · ${eligible ? 'Eligible' : 'Blocked'}`.slice(0, 100))
    .setDefault(selected);
}

export function versusMarketControls(userId: string, tab: 'DEAL' | 'SCOUT' = 'DEAL'): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-market-deal`).setLabel('Deal').setStyle(tab === 'DEAL' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-market-scout`).setLabel('Scout').setStyle(tab === 'SCOUT' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function versusRankingControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-ranking-club`).setLabel('Club').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-ranking-mvp`).setLabel('MVP').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-ranking-scorers`).setLabel('Top Scorers').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-ranking-assists`).setLabel('Top Assists').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-ranking-goalkeepers`).setLabel('Goalkeepers').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Home').setStyle(ButtonStyle.Secondary))
  ];
}

export function versusSponsorControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-sponsor-junior`).setLabel('Junior Sponsor').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-sponsor-senior`).setLabel('Senior Sponsor').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-sponsor-top`).setLabel('Top Sponsor').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function versusSetupControls(userId: string, battleId: string, rosterVersion: number, formation: FormationId, tactic: TacticId): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const formationSelect = new StringSelectMenuBuilder().setCustomId(versusContext(userId, 'versus-pick-formation', battleId, rosterVersion)).setPlaceholder(`Formation: ${formation}`).setMinValues(1).setMaxValues(1).addOptions(Object.values(FORMATIONS).map((item) => new StringSelectMenuOptionBuilder().setValue(item.id).setLabel(`${item.id} · ${item.name}`).setDescription(`${item.slots.GK} GK · ${item.slots.DF} DF · ${item.slots.MF} MF · ${item.slots.FW} FW`).setDefault(item.id === formation)));
  const tacticSelect = new StringSelectMenuBuilder().setCustomId(versusContext(userId, 'versus-pick-tactic', battleId, rosterVersion)).setPlaceholder(`Tactic: ${TACTICS[tactic].name}`).setMinValues(1).setMaxValues(1).addOptions(Object.entries(TACTICS).map(([id, item]) => new StringSelectMenuOptionBuilder().setValue(id).setLabel(item.name).setDescription(item.description).setDefault(id === tactic)));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(formationSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tacticSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(versusContext(userId, 'versus-lineup-squad', battleId, rosterVersion)).setLabel('Choose XI').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function versusPositionControls(userId: string, battleId: string, rosterVersion: number, formation: FormationId, roster: VersusPlayer[], selected: Record<string, string[]>): ActionRowBuilder<any>[] {
  const slots = FORMATIONS[formation].slots;
  const positions = ['GK', 'DF', 'MF', 'FW'] as const;
  const rows: ActionRowBuilder<any>[] = positions.map((position) => {
    const options = roster.filter((player) => player.position === position).map((player) => playerOption(player, selected[position]?.includes(player.id)));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(versusContext(userId, `versus-pick-${position.toLowerCase()}`, battleId, rosterVersion)).setPlaceholder(`${position} · pilih ${slots[position]} pemain`).setMinValues(slots[position]).setMaxValues(slots[position]).addOptions(options));
  });
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(versusContext(userId, 'versus-lineup-final', battleId, rosterVersion)).setLabel('Review Lineup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(versusContext(userId, 'versus-lineup-start', battleId, rosterVersion)).setLabel('Back').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  ));
  return rows;
}

export function versusFinalizeControls(userId: string, battleId: string, rosterVersion: number, lineup: string[], roster: VersusPlayer[], captain?: string, substitutes: string[] = []): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const selectedPlayers = roster.filter((player) => lineup.includes(player.id));
  const benchPlayers = roster.filter((player) => !lineup.includes(player.id));
  const captainSelect = new StringSelectMenuBuilder().setCustomId(versusContext(userId, 'versus-pick-captain', battleId, rosterVersion)).setPlaceholder(`Captain: ${captain ?? 'choose'}`).setMinValues(1).setMaxValues(1).addOptions(selectedPlayers.map((player) => playerOption(player, captain === player.id)));
  const substituteSelect = new StringSelectMenuBuilder().setCustomId(versusContext(userId, 'versus-pick-substitutes', battleId, rosterVersion)).setPlaceholder('Substitutes · optional, max 5').setMinValues(0).setMaxValues(Math.min(5, benchPlayers.length)).addOptions(benchPlayers.map((player) => playerOption(player, substitutes.includes(player.id))));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(captainSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(substituteSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(versusContext(userId, 'versus-lineup-confirm', battleId, rosterVersion)).setLabel('Confirm Submission').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(versusContext(userId, 'versus-lineup-squad', battleId, rosterVersion)).setLabel('Edit XI').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:versus-home`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function trainingControls(userId: string): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const options = [
    ['atk', 'Attack'],
    ['def', 'Defence'],
    ['speed', 'Speed'],
    ['power', 'Power'],
    ['strength', 'Strength'],
    ['technique', 'Technique']
  ].map(([value, label]) => new StringSelectMenuOptionBuilder().setValue(value).setLabel(label));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`frs:${userId}:train-select`)
        .setPlaceholder('Pilih ability untuk dilatih')
        .addOptions(options)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:detailed-train`).setLabel('Detailed Skills').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-tricks`).setLabel('Tricks').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-trainer`).setLabel('Trainer').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-culture`).setLabel('Culture Study').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function playerInjuryControls(userId: string): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const selector = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:injury-treatment-select`)
    .setPlaceholder('Pilih recovery action')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('view').setLabel('Lihat status cedera'),
      new StringSelectMenuOptionBuilder().setValue('basic-treatment').setLabel('Basic treatment'),
      new StringSelectMenuOptionBuilder().setValue('expert-treatment').setLabel('Expert treatment')
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selector),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Home').setStyle(ButtonStyle.Primary)
    )
  ];
}

export function playerClubControls(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:player-club-match`).setLabel('Play Club Match').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-league`).setLabel('League Table').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-squad`).setLabel('Squad').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-strategy`).setLabel('Formation/Tactic').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:player-market`).setLabel('Market').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Home').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function playerStrategyControls(userId: string, formation: FormationId, tactic: TacticId): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const formationSelect = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:player-formation-select`)
    .setPlaceholder(`Formation: ${formation}`)
    .addOptions(Object.values(FORMATIONS).map((item) => new StringSelectMenuOptionBuilder().setValue(item.id).setLabel(`${item.id} · ${item.name}`).setDescription(`${item.slots.GK} GK · ${item.slots.DF} DF · ${item.slots.MF} MF · ${item.slots.FW} FW`).setDefault(item.id === formation)));
  const tacticSelect = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:player-tactic-select`)
    .setPlaceholder(`Tactic: ${TACTICS[tactic].name}`)
    .addOptions(Object.entries(TACTICS).map(([id, item]) => new StringSelectMenuOptionBuilder().setValue(id).setLabel(item.name).setDescription(item.description).setDefault(id === tactic)));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(formationSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tacticSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:club`).setLabel('Back to Club Office').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Home').setStyle(ButtonStyle.Primary)
    )
  ];
}

export function playerCultureControls(userId: string): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const selector = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:culture-select`)
    .setPlaceholder('Pilih subjek Culture Study')
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('science').setLabel('Science'),
      new StringSelectMenuOptionBuilder().setValue('arts').setLabel('Arts'),
      new StringSelectMenuOptionBuilder().setValue('history').setLabel('History')
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selector),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:train`).setLabel('Back to Training').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-player`).setLabel('Player Home').setStyle(ButtonStyle.Primary)
    )
  ];
}

export function coachExpControls(userId: string, remaining: number): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const options = COACH_ABILITIES.map((ability) => new StringSelectMenuOptionBuilder().setValue(ability).setLabel(COACH_ABILITY_LABELS[ability]).setDescription(`Assign seluruh pending EXP (${remaining})`));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`frs:${userId}:coach-exp-select`).setPlaceholder(`Pilih ability · pending ${remaining} EXP`).addOptions(options)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-coach`).setLabel('Coach Home').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function coachStrategyControls(userId: string, formation: FormationId, tactic: TacticId): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const formationSelect = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:coach-formation-select`)
    .setPlaceholder(`Formation: ${formation}`)
    .addOptions(Object.values(FORMATIONS).map((item) => new StringSelectMenuOptionBuilder().setValue(item.id).setLabel(`${item.id} · ${item.name}`).setDescription(`${item.slots.GK} GK · ${item.slots.DF} DF · ${item.slots.MF} MF · ${item.slots.FW} FW`).setDefault(item.id === formation)));
  const tacticSelect = new StringSelectMenuBuilder()
    .setCustomId(`frs:${userId}:coach-tactic-select`)
    .setPlaceholder(`Tactic: ${TACTICS[tactic].name}`)
    .addOptions(Object.entries(TACTICS).map(([id, item]) => new StringSelectMenuOptionBuilder().setValue(id).setLabel(item.name).setDescription(item.description).setDefault(id === tactic)));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(formationSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tacticSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-coach`).setLabel('Coach Home').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function coachJobControls(userId: string, offers: Array<{ id: string; clubName: string }>): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
  if (offers.length > 0) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`frs:${userId}:coach-job-accept-select`).setPlaceholder('Pilih job offer untuk diterima').addOptions(offers.map((offer) => new StringSelectMenuOptionBuilder().setValue(offer.id).setLabel(`${offer.clubName} · ${offer.id}`.slice(0, 100))))
    ));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`frs:${userId}:coach-job-generate`).setLabel('Generate Offer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`frs:${userId}:menu-coach`).setLabel('Coach Home').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
  ));
  return rows;
}

export function championsControls(userId: string, mode: 'PLAYER' | 'COACH'): ActionRowBuilder<ButtonBuilder>[] {
  const prefix = mode === 'PLAYER' ? 'player' : 'coach';
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`frs:${userId}:${prefix}-champions-status`).setLabel('Status').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`frs:${userId}:${prefix}-champions-play`).setLabel('Play Round').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`frs:${userId}:${mode === 'PLAYER' ? 'menu-player' : 'menu-coach'}`).setLabel(`${mode === 'PLAYER' ? 'Player' : 'Coach'} Home`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`frs:${userId}:menu-home`).setLabel('Game Home').setStyle(ButtonStyle.Secondary)
    )
  ];
}
