import { PermissionFlagsBits, SlashCommandBuilder, SlashCommandSubcommandBuilder, SlashCommandStringOption } from 'discord.js';

const positions = (option: SlashCommandStringOption) => option
  .setName('position')
  .setDescription('Posisi awal pemain')
  .setRequired(true)
  .addChoices(
    { name: 'Goalkeeper', value: 'GK' },
    { name: 'Defender', value: 'DF' },
    { name: 'Midfielder', value: 'MF' },
    { name: 'Forward', value: 'FW' }
  );

const abilityChoices = [
  { name: 'Attack', value: 'atk' },
  { name: 'Defence', value: 'def' },
  { name: 'Speed', value: 'speed' },
  { name: 'Power', value: 'power' },
  { name: 'Strength', value: 'strength' },
  { name: 'Technique', value: 'technique' }
] as const;

const detailedSkillChoices = [
  { name: 'Shots', value: 'shots' }, { name: 'Penalty', value: 'penalty' }, { name: 'Header', value: 'header' },
  { name: 'Pass', value: 'pass' }, { name: 'Dribbling', value: 'dribbling' }, { name: 'Free Kick', value: 'freeKick' },
  { name: 'Off-ball Running', value: 'offBallRunning' }, { name: 'Hold Off Defenders', value: 'holdOffDefenders' },
  { name: 'Teamwork', value: 'teamwork' }, { name: 'Endurance', value: 'endurance' }, { name: 'Speed', value: 'speed' },
  { name: 'Willpower', value: 'willpower' }
] as const;

const coachAbilityChoices = [
  { name: 'Formation Understanding', value: 'formation' }, { name: 'Tactical Thinking', value: 'tactics' },
  { name: 'State Adjustment', value: 'stateAdjustment' }, { name: 'Training Level', value: 'trainingLevel' },
  { name: 'Locker Room Prestige', value: 'lockerRoom' }, { name: 'Personal Charisma', value: 'charisma' }
] as const;

const formations = [
  { name: '4-4-2 Balanced', value: '4-4-2' }, { name: '4-3-3 Attacking', value: '4-3-3' },
  { name: '3-5-2 Control', value: '3-5-2' }, { name: '5-3-2 Defensive', value: '5-3-2' },
  { name: '4-1-3-2 Flexible', value: '4-1-3-2' }, { name: '3-4-3 Aggressive', value: '3-4-3' },
  { name: '4-2-3-1 Possession', value: '4-2-3-1' }
] as const;

const tactics = [
  { name: 'Balanced', value: 'balanced' }, { name: 'Attacking', value: 'attacking' },
  { name: 'Defensive', value: 'defensive' }, { name: 'Counter Attack', value: 'counter' },
  { name: 'Down the Wings', value: 'down-wings' }, { name: 'Middle Thrust', value: 'middle-thrust' },
  { name: 'Tiki-Taka', value: 'tiki-taka' }, { name: 'Long Ball', value: 'long-ball' },
  { name: 'Offense Full', value: 'offense-full' }, { name: 'Defense Full', value: 'defense-full' }
] as const;

function addFormation(option: SlashCommandStringOption, required = true) {
  return option.setName('formation').setDescription('Formasi').setRequired(required).addChoices(...formations);
}

function addTactic(option: SlashCommandStringOption, required = true) {
  return option.setName('tactic').setDescription('Taktik').setRequired(required).addChoices(...tactics);
}

function addPlayerCareerGroup(command: SlashCommandBuilder) {
  command.addSubcommandGroup((group) => group.setName('career').setDescription('Karier individu pemain').addSubcommand((sub) => sub.setName('start').setDescription('Buat profil karier').addStringOption(positions)).addSubcommand((sub) => sub.setName('profile').setDescription('Lihat profil pemain')).addSubcommand((sub) => sub.setName('match').setDescription('Simulasikan pertandingan karier')).addSubcommand((sub) => sub.setName('next-week').setDescription('Majukan satu minggu karier')).addSubcommand((sub) => sub.setName('league').setDescription('Lihat progres musim dan klasemen')).addSubcommand((sub) => sub.setName('injury').setDescription('Lihat atau tangani cedera').addStringOption((option) => option.setName('action').setDescription('Aksi cedera').setRequired(false).addChoices({ name: 'View', value: 'view' }, { name: 'Basic treatment', value: 'basic-treatment' }, { name: 'Expert treatment', value: 'expert-treatment' }))).addSubcommand((sub) => sub.setName('retire').setDescription('Pensiun dari karier')).addSubcommand((sub) => sub.setName('rebirth').setDescription('Mulai ulang setelah retirement')).addSubcommand((sub) => sub.setName('daily').setDescription('Ambil daily reward dan streak')).addSubcommand((sub) => sub.setName('contract').setDescription('Lihat atau perbarui kontrak').addStringOption((option) => option.setName('action').setDescription('Aksi kontrak').setRequired(false).addChoices({ name: 'View', value: 'view' }, { name: 'Sign or renew', value: 'sign' }))).addSubcommand((sub) => sub.setName('champions').setDescription('Champions League Player').addStringOption((option) => option.setName('action').setDescription('Aksi').setRequired(false).addChoices({ name: 'Status', value: 'status' }, { name: 'Play', value: 'play' }))));
}

function addPlayerTrainingGroup(command: SlashCommandBuilder) {
  command.addSubcommandGroup((group) => group.setName('training').setDescription('Training dan pengembangan pemain').addSubcommand((sub) => sub.setName('train').setDescription('Latih satu ability').addStringOption((option) => option.setName('ability').setDescription('Ability').setRequired(true).addChoices(...abilityChoices))).addSubcommand((sub) => sub.setName('skills').setDescription('Lihat detailed skills dan status')).addSubcommand((sub) => sub.setName('train-skill').setDescription('Latih detailed skill').addStringOption((option) => option.setName('skill').setDescription('Detailed skill').setRequired(true).addChoices(...detailedSkillChoices))).addSubcommand((sub) => sub.setName('assign-exp').setDescription('Alokasikan EXP pertandingan').addStringOption((option) => option.setName('skill').setDescription('Skill tujuan').setRequired(true).addChoices(...detailedSkillChoices)).addIntegerOption((option) => option.setName('amount').setDescription('Jumlah EXP').setRequired(true).setMinValue(1))).addSubcommand((sub) => sub.setName('trick').setDescription('Lihat atau unlock trick').addStringOption((option) => option.setName('action').setDescription('Aksi trick').setRequired(false).addChoices({ name: 'List', value: 'list' }, { name: 'Train', value: 'train' })).addStringOption((option) => option.setName('trick_id').setDescription('ID trick').setRequired(false))).addSubcommand((sub) => sub.setName('trainer').setDescription('Lihat atau kelola trainer').addStringOption((option) => option.setName('action').setDescription('Aksi trainer').setRequired(false).addChoices({ name: 'List', value: 'list' }, { name: 'Hire', value: 'hire' }, { name: 'Release', value: 'release' })).addStringOption((option) => option.setName('trainer_id').setDescription('ID trainer').setRequired(false))).addSubcommand((sub) => sub.setName('culture').setDescription('Mulai culture study').addStringOption((option) => option.setName('subject').setDescription('Subject').setRequired(true).addChoices({ name: 'Science', value: 'science' }, { name: 'Arts', value: 'arts' }, { name: 'History', value: 'history' }))));
}

function addPlayerClubGroup(command: SlashCommandBuilder) {
  command.addSubcommandGroup((group) => group.setName('club').setDescription('Klub, roster, liga, dan market').addSubcommand((sub) => sub.setName('overview').setDescription('Lihat kondisi klub')).addSubcommand((sub) => sub.setName('list').setDescription('Lihat official clubs').addIntegerOption((option) => option.setName('league').setDescription('League code').setRequired(false))).addSubcommand((sub) => sub.setName('join').setDescription('Pindah ke official club').addIntegerOption((option) => option.setName('club_id').setDescription('Official club ID').setRequired(true).setMinValue(100000).setMaxValue(999999))).addSubcommand((sub) => sub.setName('squad').setDescription('Lihat roster klub')).addSubcommand((sub) => sub.setName('standings').setDescription('Lihat klasemen liga klub')));
}

function addPlayerHonorsGroup(command: SlashCommandBuilder) {
  command.addSubcommandGroup((group) => group.setName('honors').setDescription('Honor, achievement, dan history').addSubcommand((sub) => sub.setName('list').setDescription('Lihat Hall of Honor')).addSubcommand((sub) => sub.setName('world-footballer').setDescription('Lihat hasil World Footballer')).addSubcommand((sub) => sub.setName('achievements').setDescription('Lihat achievement')).addSubcommand((sub) => sub.setName('claim').setDescription('Klaim achievement').addStringOption((option) => option.setName('achievement').setDescription('ID achievement').setRequired(true))));
}

const player = new SlashCommandBuilder().setName('player').setDescription('Player Mode — karier sebagai pemain sepak bola');
addPlayerCareerGroup(player);
addPlayerTrainingGroup(player);
addPlayerClubGroup(player);
addPlayerHonorsGroup(player);

const coach = new SlashCommandBuilder().setName('coach').setDescription('Coach Mode — kelola klub dan karier pelatih').addSubcommand((sub) => sub.setName('career').setDescription('Mulai atau lihat karier Coach').addStringOption((option) => option.setName('action').setDescription('Aksi').setRequired(false).addChoices({ name: 'Start', value: 'start' }, { name: 'Status', value: 'status' }))).addSubcommand((sub) => sub.setName('profile').setDescription('Lihat profil Coach')).addSubcommand((sub) => sub.setName('event').setDescription('Lihat atau selesaikan Coach event').addStringOption((option) => option.setName('choice').setDescription('ID pilihan').setRequired(false))).addSubcommand((sub) => sub.setName('round').setDescription('Mainkan round Coach berikutnya')).addSubcommand((sub) => sub.setName('exp').setDescription('Alokasikan Coach EXP').addStringOption((option) => option.setName('ability').setDescription('Coach ability').setRequired(true).addChoices(...coachAbilityChoices)).addIntegerOption((option) => option.setName('amount').setDescription('Jumlah EXP').setRequired(true).setMinValue(1))).addSubcommand((sub) => sub.setName('formation').setDescription('Ubah formasi Coach Club').addStringOption((option) => option.setName('id').setDescription('Formasi').setRequired(true).addChoices(...formations))).addSubcommand((sub) => sub.setName('tactic').setDescription('Ubah taktik Coach Club').addStringOption((option) => option.setName('id').setDescription('Taktik').setRequired(true).addChoices(...tactics))).addSubcommand((sub) => sub.setName('job').setDescription('Lihat atau kelola job offer').addStringOption((option) => option.setName('action').setDescription('Aksi job').setRequired(false).addChoices({ name: 'Generate offer', value: 'generate' }, { name: 'List offers', value: 'list' }, { name: 'Accept offer', value: 'accept' }, { name: 'Decline offer', value: 'decline' })).addStringOption((option) => option.setName('offer_id').setDescription('ID offer').setRequired(false))).addSubcommand((sub) => sub.setName('retire').setDescription('Pensiun Coach')).addSubcommand((sub) => sub.setName('rebirth').setDescription('Mulai ulang Coach')).addSubcommand((sub) => sub.setName('champions').setDescription('Champions League Coach').addStringOption((option) => option.setName('action').setDescription('Aksi').setRequired(false).addChoices({ name: 'Status', value: 'status' }, { name: 'Play', value: 'play' })));

const versus = new SlashCommandBuilder().setName('versus').setDescription('Versus Mode — multiplayer matchmaking dan league').addSubcommand((sub) => sub.setName('home').setDescription('Buka Versus Home dan assigned team')).addSubcommand((sub) => sub.setName('profile').setDescription('Lihat assigned team dan season')).addSubcommand((sub) => sub.setName('roster').setDescription('Lihat roster dan eligibility')).addSubcommand((sub) => sub.setName('lineup').setDescription('Submit lineup battle').addStringOption((option) => option.setName('battle_id').setDescription('Battle ID').setRequired(true)).addStringOption((option) => option.setName('lineup').setDescription('11 player ID dipisahkan koma').setRequired(true)).addStringOption((option) => option.setName('captain').setDescription('Captain ID').setRequired(true)).addStringOption((option) => addFormation(option)).addStringOption((option) => addTactic(option)).addIntegerOption((option) => option.setName('roster_version').setDescription('Roster version').setRequired(true).setMinValue(1)).addStringOption((option) => option.setName('substitutes').setDescription('Maksimal 5 player ID').setRequired(false))).addSubcommand((sub) => sub.setName('bid').setDescription('Bid coin pada Deal listing').addStringOption((option) => option.setName('listing_id').setDescription('ID listing').setRequired(true)).addIntegerOption((option) => option.setName('amount').setDescription('Jumlah coin').setRequired(true).setMinValue(1))).addSubcommand((sub) => sub.setName('standings').setDescription('Lihat klasemen Versus')).addSubcommand((sub) => sub.setName('round').setDescription('Proses round Versus')).addSubcommand((sub) => sub.setName('season').setDescription('Lihat atau tutup season').addStringOption((option) => option.setName('action').setDescription('Aksi season').setRequired(false).addChoices({ name: 'Status', value: 'status' }, { name: 'Settle', value: 'settle' }))).addSubcommand((sub) => sub.setName('join').setDescription('Fallback private group join').addStringOption((option) => option.setName('group_code').setDescription('Kode private group').setRequired(true)));

const play = new SlashCommandBuilder().setName('play').setDescription('Buka Game Home Football Rising Star');
const help = new SlashCommandBuilder().setName('help').setDescription('Lihat panduan mode dan command Football Rising Star');
const admin = new SlashCommandBuilder().setName('admin').setDescription('Admin maintenance command').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addStringOption((option) => option.setName('action').setDescription('Aksi admin').setRequired(true).addChoices({ name: 'Stats', value: 'stats' }, { name: 'Run maintenance now', value: 'run-maintenance' }));

export const commandDefinitions = [play, player, coach, versus, help, admin].map((command) => command.toJSON());
/** Default public surface: one gameplay entry point; all navigation uses buttons/selects. */
export const menuFirstCommandDefinitions = [play].map((command) => command.toJSON());

export const modeCommandMap: Record<string, string> = {
  'player.career.start': 'start', 'player.career.profile': 'profile', 'player.career.match': 'match', 'player.career.next-week': 'next-week', 'player.career.league': 'league', 'player.career.injury': 'injury', 'player.career.retire': 'retire', 'player.career.rebirth': 'rebirth', 'player.career.daily': 'daily', 'player.career.event': 'player-event-disabled', 'player.career.contract': 'contract', 'player.career.champions': 'champions',
  'player.training.train': 'train', 'player.training.skills': 'skills', 'player.training.train-skill': 'train-skill', 'player.training.assign-exp': 'assign-exp', 'player.training.trick': 'trick', 'player.training.trainer': 'trainer', 'player.training.culture': 'culture',
  // The athlete does not manage the club: no tactic, market, or manual club-match subcommands in Player Mode.
  'player.club.overview': 'club', 'player.club.list': 'clubs', 'player.club.join': 'join-club', 'player.club.squad': 'squad', 'player.club.standings': 'standings',
  'player.honors.list': 'honors', 'player.honors.world-footballer': 'world-footballer', 'player.honors.achievements': 'achievements', 'player.honors.claim': 'claim-achievement',
  'coach.career': 'coach-career', 'coach.profile': 'coach-profile', 'coach.event': 'coach-event', 'coach.round': 'coach-round', 'coach.exp': 'coach-exp', 'coach.formation': 'formation', 'coach.tactic': 'tactic', 'coach.job': 'coach-job', 'coach.retire': 'coach-retire', 'coach.rebirth': 'coach-rebirth', 'coach.champions': 'champions',
  'versus.home': 'versus-profile', 'versus.profile': 'versus-profile', 'versus.roster': 'versus-roster', 'versus.lineup': 'versus-lineup', 'versus.bid': 'versus-bid', 'versus.standings': 'versus-standings', 'versus.round': 'versus-round', 'versus.season': 'versus-season', 'versus.join': 'versus-join'
};

export function resolveModeCommand(commandName: string, subcommand?: string, subcommandGroup?: string): string {
  if (commandName === 'play') return 'play';
  if (commandName === 'player' || commandName === 'coach' || commandName === 'versus') {
    const key = [commandName, subcommandGroup, subcommand].filter(Boolean).join('.');
    return modeCommandMap[key] ?? commandName;
  }
  return commandName;
}
