export type Position = 'GK' | 'DF' | 'MF' | 'FW';
export type AbilityId = 'atk' | 'def' | 'speed' | 'power' | 'strength' | 'technique';
export type DetailedSkillId = 'shots' | 'penalty' | 'header' | 'pass' | 'dribbling' | 'freeKick' | 'offBallRunning' | 'holdOffDefenders' | 'teamwork' | 'endurance' | 'speed' | 'willpower';
export type MatchOutcome = 'WIN' | 'DRAW' | 'LOSS';
export type TacticId = 'balanced' | 'attacking' | 'defensive' | 'counter' | 'down-wings' | 'middle-thrust' | 'tiki-taka' | 'long-ball' | 'offense-full' | 'defense-full';
export type FormationId = '4-4-2' | '4-3-3' | '3-5-2' | '5-3-2' | '4-1-3-2' | '3-4-3' | '4-2-3-1';
export type ListingStatus = 'OPEN' | 'SOLD' | 'CANCELLED';
export type CareerMode = 'PLAYER' | 'COACH';
export type CareerStatus = 'ACTIVE' | 'RETIRED';
export type PlayerWeekStage = 'READY' | 'MATCH_READY' | 'EXP_PENDING' | 'EVENT_PENDING' | 'SEASON_BREAK';
export type PlayerEventType = 'INTERVIEW' | 'SPONSOR_OFFER' | 'MEDICAL_INCIDENT' | 'LIFESTYLE';
export type CoachStatus = 'EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';
export type CoachAbilityId = 'formation' | 'tactics' | 'stateAdjustment' | 'trainingLevel' | 'lockerRoom' | 'charisma';
export type CoachTargetType = 'PROMOTION' | 'CHAMPIONSHIP' | 'AVOID_RELEGATION' | 'QCL';
export type InjurySeverity = 'MINOR' | 'MODERATE' | 'MAJOR';
export type InjurySource = 'MATCH' | 'TRAINING' | 'EVENT';
export type HonorCategory = 'PERSONAL' | 'TEAM' | 'NATIONAL';
export type CultureSubject = 'science' | 'arts' | 'history';
export type TrainerTier = 'JUNIOR' | 'SENIOR' | 'EXPERT';

export interface AbilityState {
  level: number;
  exp: number;
}

export type DetailedSkillState = AbilityState;
export type DetailedSkills = Record<DetailedSkillId, DetailedSkillState>;

export interface PlayerStats {
  atk: number;
  def: number;
  speed: number;
  power: number;
  strength: number;
  technique: number;
}

export interface InjuryState {
  severity: InjurySeverity;
  weeksRemaining: number;
  source: InjurySource;
  treatmentUsed: boolean;
  diagnosedAt: string;
}

export interface ActiveTraining {
  skill: DetailedSkillId;
  completeAtWeek: number;
  expReward: number;
  hpCost: number;
}

export interface TrainerState {
  id: string;
  tier: TrainerTier;
  type: 'PHYSICAL' | 'TECHNICAL';
  ratio: number;
  weeklyCost: number;
  hiredAtWeek: number;
  active: boolean;
}

export interface CultureStudyState {
  subject: CultureSubject;
  completeAtWeek: number;
  charmReward: number;
  skillReward: DetailedSkillId;
  skillExpReward: number;
}
export interface PlayerSponsorContract {
  id: string;
  brand: string;
  tier: 'LOCAL' | 'REGIONAL' | 'GLOBAL';
  weeklyReward: number;
  weeksRemaining: number;
  signedAtWeek: number;
}
export interface PlayerEventChoice {
  id: string;
  label: string;
  description: string;
  moneyDelta?: number;
  expDelta?: number;
  charmDelta?: number;
  energyDelta?: number;
  hpDelta?: number;
  injuryWeeks?: number;
  sponsor?: PlayerSponsorContract;
}
export interface PlayerWeeklyEvent {
  id: string;
  type: PlayerEventType;
  title: string;
  description: string;
  choices: PlayerEventChoice[];
  resolved: boolean;
  createdAt: string;
  week: number;
  selectedChoiceId?: string;
}
export interface TrickDefinition {
  id: string;
  name: string;
  description: string;
  requires: Partial<Record<DetailedSkillId, number>>;
  energyCost: number;
  matchModifier: number;
  source: 'WALKTHROUGH_OBSERVED' | 'RECOVERY_VERIFIED' | 'RECOVERY_INFERRED';
}

export interface HonorRecord {
  id: string;
  category: HonorCategory;
  title: string;
  season: number;
  description: string;
  source: 'RECOVERY_VERIFIED' | 'WALKTHROUGH_OBSERVED' | 'RECOVERY_INFERRED';
  value: number;
  awardedAt: string;
}

export interface WorldFootballerState {
  season: number;
  winner: string;
  userScore: number;
  userWon: boolean;
  resolved: boolean;
  candidates: Array<{ name: string; score: number }>;
}

export interface RetirementState {
  retiredAt: string;
  age: number;
  finalSeason: number;
  finalRating: number;
  finalGoals: number;
  finalHonors: number;
}

export interface CoachBoardTarget {
  type: CoachTargetType;
  season: number;
  targetRank: number;
  progressRank?: number;
  approvalDeltaOnSuccess: number;
  approvalDeltaOnFailure: number;
  rewardMoney: number;
  resolved: boolean;
}

export interface CoachJobOffer {
  id: string;
  clubId: string;
  clubName: string;
  league: number;
  salary: number;
  targetRank: number;
  durationYears: number;
  status: 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
}

export interface CoachEventChoice {
  id: string;
  label: string;
  description: string;
  approvalDelta: number;
  moneyDelta: number;
  expDelta: number;
  ability?: CoachAbilityId;
}

export type CoachEventFamily = 'PRESS_MEDIA' | 'LOCKER_ROOM' | 'TEAM_BUILDING' | 'YOUTH_SYSTEM' | 'FINANCE' | 'MEDICAL' | 'SEASON_TARGET';
export type CoachEventTrigger = 'ROUND_SETTLEMENT' | 'SEASON_START' | 'SEASON_END' | 'BOARD_TARGET';

export interface CoachEvent {
  id: string;
  templateId: 'press-criticism' | 'locker-room-speech' | 'team-building' | 'player-discipline' | 'financial-crisis';
  family?: CoachEventFamily;
  trigger?: CoachEventTrigger;
  /** True when the next Coach round must wait for this decision. */
  blocking?: boolean;
  title: string;
  description: string;
  choices: CoachEventChoice[];
  resolved: boolean;
  createdAt: string;
}

export interface CoachCareerState {
  coachName: string;
  age: number;
  level: number;
  totalExp: number;
  salary: number;
  unassignedExp: number;
  abilities: Record<CoachAbilityId, AbilityState>;
  approval: number;
  status: CoachStatus;
  careerYear: number;
  season: number;
  boardTarget: CoachBoardTarget;
  jobOffers: CoachJobOffer[];
  event?: CoachEvent;
  staff?: TrainerState;
  honors: HonorRecord[];
  /** Coach-only competition state; intentionally separate from PlayerProfile.championsLeague. */
  championsLeague?: ChampionsLeagueState;
  retiredAt?: string;
}

export interface CareerStats {
  appearances: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  assists: number;
  steals: number;
  cleanSheets: number;
  yellowCards: number;
  injuries: number;
  seasonScore: number;
}

export interface MatchRecord {
  id: string;
  createdAt: string;
  opponent: string;
  opponentRating: number;
  playerRating: number;
  outcome: MatchOutcome;
  playerGoals: number;
  opponentGoals: number;
  playerScore: number;
  rewards: {
    money: number;
    exp: number;
  };
  stats?: {
    possession: number;
    opponentPossession: number;
    shots: number;
    opponentShots: number;
    shotsOnTarget: number;
    opponentShotsOnTarget: number;
    corners: number;
    opponentCorners: number;
  };
  week?: number;
  injury?: InjuryState;
  formulaVersion?: string;
}

export interface LeagueState {
  season: number;
  matchday: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface ClubPlayer {
  id: string;
  name: string;
  position: Position;
  age: number;
  originClubId?: number;
  overall: number;
  stats: PlayerStats;
  morale: number;
  hp: number;
  maxHp: number;
  salary: number;
  contractUntil: string;
  isUserPlayer: boolean;
  goals: number;
  assists: number;
  appearances: number;
  injuredUntil?: string;
}

export interface FormationConfig {
  id: FormationId;
  name: string;
  slots: Record<Position, number>;
  attackMultiplier: number;
  defenceMultiplier: number;
  controlMultiplier: number;
}

export interface ClubFixture {
  id: string;
  season: number;
  matchday: number;
  homeClub: string;
  awayClub: string;
  played: boolean;
  homeGoals?: number;
  awayGoals?: number;
  playedAt?: string;
}

export interface CompetitionStanding {
  clubId: string;
  clubName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface ContractState {
  id: string;
  clubId: string;
  salary: number;
  beginTime: string;
  endTime: string;
  state: 'ACTIVE' | 'EXPIRED' | 'REJECTED';
  type: 'INITIAL' | 'RENEWAL' | 'TRANSFER';
}

export interface ChampionsLeagueState {
  season: number;
  round: number;
  opponent: string;
  homeGoals: number;
  awayGoals: number;
  aggregate: number;
  status: 'QUALIFIED' | 'ACTIVE' | 'ELIMINATED' | 'CHAMPION';
}

export interface AchievementState {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  claimed: boolean;
  rewardMoney: number;
  rewardExp: number;
}

export interface ClubState {
  id: string;
  officialId?: number;
  name: string;
  level: number;
  leagueTier?: number;
  officialGrade?: number;
  provenance?: 'SEED_FALLBACK' | 'RECOVERY_VERIFIED';
  prestige: number;
  assets: number;
  salaryBudget: number;
  formation: FormationId;
  tactic: TacticId;
  roster: ClubPlayer[];
  fixtures: ClubFixture[];
  standings: CompetitionStanding[];
  nextFixtureAt: string;
  championsLeagueQualified: boolean;
  championsLeagueRound: number;
}

export interface MarketListing {
  id: string;
  sellerUserId: string;
  player: ClubPlayer;
  price: number;
  status: ListingStatus;
  createdAt: string;
  buyerUserId?: string;
}

export interface DailyState {
  lastClaimDate?: string;
  streak: number;
}

export type VersusUserStatus = 'IDLE' | 'ENROLLED' | 'IN_GAME' | 'GAMEOVER';
export type VersusMatchmakingStatus = 'QUEUED' | 'MATCHED';
export type VersusBattleState = 'OPEN' | 'LOCKED' | 'PROCESSING' | 'SETTLED' | 'PUBLISHED' | 'DISPUTED';
export type VersusSeasonState = 'DRAFT' | 'ACTIVE' | 'FINISHED';
export type VersusPlayerStatus = 'AVAILABLE' | 'INJURED' | 'SUSPENDED';

export interface VersusPlayer {
  id: string;
  name: string;
  age: number;
  initialAge: number;
  position: Position;
  value: number;
  abilities: Record<AbilityId, number>;
  hp: number;
  maxHp: number;
  status: VersusPlayerStatus;
  injuryType?: InjurySeverity;
  injuryEndsAt?: string;
  yellowCards: number;
  redCardBan: number;
  captain: boolean;
  clubId: string;
  growthType: number;
  goals: number;
  assists: number;
  appearances: number;
}

export interface VersusClub {
  id: string;
  ownerId?: string;
  name: string;
  isNpc: boolean;
  grade: number;
  country: number;
  rosterVersion: number;
  formation: FormationId;
  tactic: TacticId;
  budget: number;
  versusMoney: number;
  versusCoin: number;
  score: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  rank: number;
  roster: VersusPlayer[];
}

export interface VersusPlayerSnapshot {
  id: string;
  name: string;
  position: Position;
  abilityScore: number;
  hp: number;
  status: VersusPlayerStatus;
  injuryType?: InjurySeverity;
  yellowCards: number;
  redCardBan: number;
  clubId: string;
}

export interface VersusSubmission {
  battleId: string;
  clubId: string;
  ownerId?: string;
  lineup: string[];
  substitutes: string[];
  captainId: string;
  formation: FormationId;
  tactic: TacticId;
  rosterVersion: number;
  submittedAt: string;
  lockedAt?: string;
  snapshot?: VersusPlayerSnapshot[];
}

export interface VersusBattleStats {
  ballControl: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  yellowCards: number;
  redCards: number;
}

export interface VersusSideReward {
  money: number;
  coin: number;
  conditionRecovery: number;
}

export interface VersusSettlement {
  battleId: string;
  roundId: number;
  homeGoals: number;
  awayGoals: number;
  halftime: { homeGoals: number; awayGoals: number };
  homeStats: VersusBattleStats;
  awayStats: VersusBattleStats;
  mvpPlayerId: string;
  mvpName: string;
  homeReward: VersusSideReward;
  awayReward: VersusSideReward;
  rulesetVersion: string;
  simulationSeed: number;
  settledAt: string;
}

export interface VersusBattle {
  id: string;
  seasonId: string;
  roundId: number;
  scheduledAt: string;
  homeClubId: string;
  awayClubId: string;
  state: VersusBattleState;
  homeSubmission?: VersusSubmission;
  awaySubmission?: VersusSubmission;
  settlement?: VersusSettlement;
}

export interface VersusStanding {
  clubId: string;
  clubName: string;
  isNpc: boolean;
  rank: number;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface VersusSeasonReward {
  clubId: string;
  rank: number;
  money: number;
  coin: number;
  promoted: boolean;
  relegated: boolean;
}

export type VersusCurrency = 'MONEY' | 'COIN';
export type VersusMarketStatus = 'OPEN' | 'EXPIRED' | 'SETTLED' | 'CANCELLED';

export interface VersusMarketListing {
  id: string;
  player: VersusPlayer;
  sourceClubId: string;
  currency: 'COIN';
  openingBid: number;
  minimumIncrement: number;
  currentBid?: number;
  currentBidderId?: string;
  startsAt: string;
  endsAt: string;
  status: VersusMarketStatus;
  rulesetVersion: string;
  settledAt?: string;
  winnerClubId?: string;
}

export interface VersusMarketState {
  generatedAt: string;
  listings: VersusMarketListing[];
}

export interface VersusWalletReservation {
  id: string;
  listingId: string;
  userId: string;
  currency: 'COIN';
  amount: number;
  createdAt: string;
}

export interface VersusLedgerEntry {
  id: string;
  createdAt: string;
  seasonId: string;
  battleId?: string;
  currency: VersusCurrency;
  amount: number;
  balanceAfter: number;
  note: string;
  type?: string;
  transactionId?: string;
}

export interface VersusSeason {
  id: string;
  groupCode: string;
  leagueId: string;
  grade: number;
  capacity: number;
  rulesetVersion: string;
  state: VersusSeasonState;
  startAt: string;
  endAt?: string;
  currentRound: number;
  roundDeadline: string;
  clubs: VersusClub[];
  battles: VersusBattle[];
  standings: VersusStanding[];
  rewards: VersusSeasonReward[];
  market?: VersusMarketState;
}

export interface VersusMatchmakingTicket {
  ticketId: string;
  status: VersusMatchmakingStatus;
  queueKey: string;
  queuedAt: string;
  matchedAt?: string;
  groupCode?: string;
  assignmentId?: string;
  expiresAt?: string;
  ratingSnapshot?: number;
  rosterVersion?: number;
}

export interface VersusUserSave {
  status: VersusUserStatus;
  matchmaking?: VersusMatchmakingTicket;
  groupCode?: string;
  seasonId?: string;
  clubId: string;
  enrolledAt: string;
  lastProcessedAt: string;
  versusMoney: number;
  versusCoin: number;
  club: VersusClub;
  season?: VersusSeason;
  history: Array<{ seasonId: string; rank: number; points: number; rewards: VersusSeasonReward }>;
  ledger?: VersusLedgerEntry[];
  reservations?: VersusWalletReservation[];
}

export interface EconomyLedgerEntry {
  id: string;
  createdAt: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string;
  transactionId?: string;
}

export interface PlayerProfile {
  version?: number;
  userId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  age: number;
  position: Position;
  club: string;
  money: number;
  maxMoney?: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  level: number;
  totalExp: number;
  stats: PlayerStats;
  abilities: Record<AbilityId, AbilityState>;
  career: CareerStats;
  league: LeagueState;
  lastActionAt: string;
  lastMatch?: MatchRecord;
  clubState?: ClubState;
  coachClubState?: ClubState;
  daily?: DailyState;
  championsLeague?: ChampionsLeagueState;
  contract?: ContractState;
  achievements?: AchievementState[];
  market?: MarketListing[];
  marketUpdatedAt?: string;
  ledger?: EconomyLedgerEntry[];
  mode?: CareerMode;
  careerStatus?: CareerStatus;
  careerYear?: number;
  careerWeek?: number;
  seasonWeek?: number;
  weekStage?: PlayerWeekStage;
  rebirthCount?: number;
  detailedSkills?: DetailedSkills;
  unassignedMatchExp?: number;
  injury?: InjuryState;
  activeTraining?: ActiveTraining;
  trainer?: TrainerState;
  cultureStudy?: CultureStudyState;
  weeklyEvent?: PlayerWeeklyEvent;
  sponsor?: PlayerSponsorContract;
  sponsorHistory?: PlayerSponsorContract[];
  charm?: number;
  unlockedTricks?: string[];
  honors?: HonorRecord[];
  worldFootballer?: WorldFootballerState;
  retirement?: RetirementState;
  coach?: CoachCareerState;
  versus?: VersusUserSave;
}

export interface MatchResult {
  record: MatchRecord;
  profile: PlayerProfile;
  narrative: string[];
}

export interface TrainResult {
  profile: PlayerProfile;
  ability: AbilityId;
  expGained: number;
  levelUp: boolean;
  statBefore: number;
  statAfter: number;
}

export interface DetailedTrainResult {
  profile: PlayerProfile;
  skill: DetailedSkillId;
  expGained: number;
  levelUps: number;
  levelBefore: number;
  levelAfter: number;
  energySpent: number;
}

export interface ExpAllocationResult {
  profile: PlayerProfile;
  allocated: number;
  remaining: number;
  levelsGained: number;
}

export interface TreatmentResult {
  profile: PlayerProfile;
  treatment: 'BASIC' | 'EXPERT';
  weeksRemoved: number;
  moneySpent: number;
}

export interface GameplayActionResult {
  profile: PlayerProfile;
  message: string;
}

export interface WeekPreparationResult {
  profile: PlayerProfile;
  week: number;
  narrative: string[];
  stage: PlayerWeekStage;
  event?: PlayerWeeklyEvent;
}

export interface WeekResult {
  profile: PlayerProfile;
  week: number;
  season: number;
  narrative: string[];
  match?: MatchRecord;
  expAwaitingAssignment: number;
  injury?: InjuryState;
  award?: WorldFootballerState;
  retired: boolean;
  stage?: PlayerWeekStage;
}

export interface ClubMatchResult {
  profile: PlayerProfile;
  fixture: ClubFixture;
  homeGoals: number;
  awayGoals: number;
  halftime: { homeGoals: number; awayGoals: number };
  outcome: MatchOutcome;
  mvp: ClubPlayer;
  commentary: string[];
}

export interface CoachRoundResult {
  profile: PlayerProfile;
  match: ClubMatchResult;
  coachExp: number;
  approvalDelta: number;
  boardTarget: CoachBoardTarget;
  seasonComplete: boolean;
  event?: CoachEvent;
}

export interface CoachExpAllocationResult {
  profile: PlayerProfile;
  allocated: number;
  remaining: number;
  levelsGained: number;
}

export const ABILITIES: AbilityId[] = ['atk', 'def', 'speed', 'power', 'strength', 'technique'];
export const COACH_ABILITIES: CoachAbilityId[] = ['formation', 'tactics', 'stateAdjustment', 'trainingLevel', 'lockerRoom', 'charisma'];
export const COACH_ABILITY_LABELS: Record<CoachAbilityId, string> = {
  formation: 'Formation Understanding',
  tactics: 'Tactical Thinking',
  stateAdjustment: 'State Adjustment',
  trainingLevel: 'Training Level',
  lockerRoom: 'Locker Room Prestige',
  charisma: 'Personal Charisma'
};

export const DETAILED_SKILLS: DetailedSkillId[] = ['shots', 'penalty', 'header', 'pass', 'dribbling', 'freeKick', 'offBallRunning', 'holdOffDefenders', 'teamwork', 'endurance', 'speed', 'willpower'];

export const ABILITY_LABELS: Record<AbilityId, string> = {
  atk: 'Attack',
  def: 'Defence',
  speed: 'Speed',
  power: 'Power',
  strength: 'Strength',
  technique: 'Technique'
};

export const DETAILED_SKILL_LABELS: Record<DetailedSkillId, string> = {
  shots: 'Shots',
  penalty: 'Penalty',
  header: 'Header',
  pass: 'Pass',
  dribbling: 'Dribbling',
  freeKick: 'Free Kick',
  offBallRunning: 'Off-ball Running',
  holdOffDefenders: 'Hold Off Defenders',
  teamwork: 'Teamwork',
  endurance: 'Endurance',
  speed: 'Speed',
  willpower: 'Willpower'
};

export const POSITION_LABELS: Record<Position, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward'
};

export const FORMATIONS: Record<FormationId, FormationConfig> = {
  '4-4-2': { id: '4-4-2', name: 'Balanced 4-4-2', slots: { GK: 1, DF: 4, MF: 4, FW: 2 }, attackMultiplier: 1, defenceMultiplier: 1, controlMultiplier: 1 },
  '4-3-3': { id: '4-3-3', name: 'Attacking 4-3-3', slots: { GK: 1, DF: 4, MF: 3, FW: 3 }, attackMultiplier: 1.08, defenceMultiplier: 0.96, controlMultiplier: 1.02 },
  '3-5-2': { id: '3-5-2', name: 'Control 3-5-2', slots: { GK: 1, DF: 3, MF: 5, FW: 2 }, attackMultiplier: 1.02, defenceMultiplier: 0.98, controlMultiplier: 1.08 },
  '5-3-2': { id: '5-3-2', name: 'Defensive 5-3-2', slots: { GK: 1, DF: 5, MF: 3, FW: 2 }, attackMultiplier: 0.94, defenceMultiplier: 1.1, controlMultiplier: 0.96 },
  '4-1-3-2': { id: '4-1-3-2', name: 'Flexible 4-1-3-2', slots: { GK: 1, DF: 4, MF: 4, FW: 2 }, attackMultiplier: 1.03, defenceMultiplier: 1.01, controlMultiplier: 1.04 },
  '3-4-3': { id: '3-4-3', name: 'Aggressive 3-4-3', slots: { GK: 1, DF: 3, MF: 4, FW: 3 }, attackMultiplier: 1.1, defenceMultiplier: 0.92, controlMultiplier: 1.01 },
  '4-2-3-1': { id: '4-2-3-1', name: 'Possession 4-2-3-1', slots: { GK: 1, DF: 4, MF: 5, FW: 1 }, attackMultiplier: 1.02, defenceMultiplier: 1.0, controlMultiplier: 1.09 }
};

export const TACTICS: Record<TacticId, { name: string; attackMultiplier: number; defenceMultiplier: number; controlMultiplier: number; description: string }> = {
  balanced: { name: 'Balanced', attackMultiplier: 1, defenceMultiplier: 1, controlMultiplier: 1, description: 'Tidak memiliki kelemahan besar.' },
  attacking: { name: 'Attacking', attackMultiplier: 1.1, defenceMultiplier: 0.92, controlMultiplier: 0.98, description: 'Menambah tekanan serangan dengan risiko pertahanan.' },
  defensive: { name: 'Defensive', attackMultiplier: 0.9, defenceMultiplier: 1.1, controlMultiplier: 1.02, description: 'Mengurangi serangan dan memperkuat pertahanan.' },
  counter: { name: 'Counter Attack', attackMultiplier: 1.05, defenceMultiplier: 1.02, controlMultiplier: 0.95, description: 'Mengandalkan transisi cepat setelah bertahan.' },
  'down-wings': { name: 'Down the Wings', attackMultiplier: 1.04, defenceMultiplier: 0.98, controlMultiplier: 1.03, description: 'Membuka serangan melalui sisi lapangan.' },
  'middle-thrust': { name: 'Middle Thrust', attackMultiplier: 1.06, defenceMultiplier: 0.96, controlMultiplier: 1.01, description: 'Menyerang melalui pusat pertahanan lawan.' },
  'tiki-taka': { name: 'Tiki-Taka', attackMultiplier: 1.01, defenceMultiplier: 1, controlMultiplier: 1.1, description: 'Mengutamakan sirkulasi bola dan kontrol.' },
  'long-ball': { name: 'Long Ball', attackMultiplier: 1.07, defenceMultiplier: 1, controlMultiplier: 0.94, description: 'Mengirim bola cepat ke lini depan.' },
  'offense-full': { name: 'Offense Full', attackMultiplier: 1.15, defenceMultiplier: 0.88, controlMultiplier: 0.96, description: 'Tekanan serangan maksimum dengan risiko tinggi.' },
  'defense-full': { name: 'Defense Full', attackMultiplier: 0.86, defenceMultiplier: 1.14, controlMultiplier: 1.04, description: 'Blok pertahanan maksimum.' }
};

export const TRAINER_CATALOG: Record<string, Omit<TrainerState, 'hiredAtWeek'>> = {
  'junior-physical': { id: 'junior-physical', tier: 'JUNIOR', type: 'PHYSICAL', ratio: 0.04, weeklyCost: 90, active: true },
  'senior-technical': { id: 'senior-technical', tier: 'SENIOR', type: 'TECHNICAL', ratio: 0.07, weeklyCost: 180, active: true },
  'expert-complete': { id: 'expert-complete', tier: 'EXPERT', type: 'TECHNICAL', ratio: 0.11, weeklyCost: 320, active: true }
};

export const TRICK_CATALOG: Record<string, TrickDefinition> = {
  'bicycle-kick': {
    id: 'bicycle-kick',
    name: 'Bicycle Kick',
    description: 'Teknik akrobatik dengan bonus finishing situasional.',
    requires: { shots: 8, header: 6, dribbling: 6 },
    energyCost: 24,
    matchModifier: 0.06,
    source: 'WALKTHROUGH_OBSERVED'
  },
  'first-touch-turn': {
    id: 'first-touch-turn',
    name: 'First-touch Turn',
    description: 'Kontrol sentuhan pertama untuk mempercepat progresi bola.',
    requires: { dribbling: 7, pass: 6 },
    energyCost: 20,
    matchModifier: 0.04,
    source: 'RECOVERY_INFERRED'
  }
};

export const HONOR_CATEGORY_LABELS: Record<HonorCategory, string> = {
  PERSONAL: 'Personal',
  TEAM: 'Team',
  NATIONAL: 'National'
};

export function clampStat(value: number): number {
  return Math.min(99, Math.max(1, Math.round(value)));
}

export function createEmptyDetailedSkills(level = 1): DetailedSkills {
  return Object.fromEntries(DETAILED_SKILLS.map((skill) => [skill, { level, exp: 0 }])) as DetailedSkills;
}

export function deriveMacroStats(detailed: DetailedSkills): PlayerStats {
  const value = (skill: DetailedSkillId): number => detailed[skill]?.level ?? 1;
  return {
    atk: clampStat((value('shots') * 2 + value('dribbling') + value('offBallRunning')) / 4),
    def: clampStat((value('holdOffDefenders') * 2 + value('teamwork') + value('endurance')) / 4),
    speed: clampStat((value('speed') * 2 + value('offBallRunning') + value('dribbling')) / 4),
    power: clampStat((value('header') + value('holdOffDefenders') + value('endurance') + value('shots')) / 4),
    strength: clampStat((value('holdOffDefenders') * 2 + value('endurance') + value('willpower')) / 4),
    technique: clampStat((value('pass') + value('dribbling') * 2 + value('freeKick')) / 4)
  };
}

export function normalizeDetailedSkills(input: Partial<DetailedSkills> | undefined, fallbackLevel = 1): DetailedSkills {
  const defaults = createEmptyDetailedSkills(fallbackLevel);
  for (const skill of DETAILED_SKILLS) {
    const state = input?.[skill];
    if (!state) continue;
    defaults[skill] = { level: Math.max(1, Math.floor(state.level || fallbackLevel)), exp: Math.max(0, Math.floor(state.exp || 0)) };
  }
  return defaults;
}
