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
export type PlayerEventType = 'INTERVIEW' | 'SPONSOR_OFFER' | 'MEDICAL_INCIDENT' | 'LIFESTYLE' | 'FAN_WINDFALL' | 'WINTER_HOLIDAY';
export type CoachStatus = 'EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';
export type CoachAbilityId = 'formation' | 'tactics' | 'stateAdjustment' | 'trainingLevel' | 'lockerRoom' | 'charisma';
export type CoachTargetType = 'PROMOTION' | 'CHAMPIONSHIP' | 'AVOID_RELEGATION' | 'QCL' | 'TOP_HALF';
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

export interface TrickTrainingState {
  trickId: string;
  completeAtWeek: number;
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
  fansDelta?: number;
  /** EXP granted straight to one detailed skill (holiday lesson), not to the pending pool. */
  skillExp?: { skill: DetailedSkillId; amount: number };
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
  /** Board objective attached to the offer; legacy offers fall back to a recomputed target. */
  targetType?: CoachTargetType;
  requiredReputation?: number;
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
  /** Played-fixture count when the last job search ran; limits offer generation to one per round. */
  lastOfferRound?: number;
  lastOfferSeason?: number;
  lastSeasonResult?: ClubSeasonResult;
  dismissedAt?: string;
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
  redCards?: number;
  mvps?: number;
  championsGoals?: number;
}

export type MatchAbsenceReason = 'INJURED' | 'SUSPENDED' | 'CONDITION';

/** Individual output of the user's athlete in one fixture; team score lives on MatchRecord. */
export interface PersonalMatchPerformance {
  played: boolean;
  absence?: MatchAbsenceReason;
  goals: number;
  assists: number;
  rating: number;
  yellowCard: boolean;
  redCard: boolean;
  mvp: boolean;
  cleanSheet: boolean;
}

export interface PlayerSeasonStats {
  season: number;
  appearances: number;
  goals: number;
  assists: number;
  ratingSum: number;
  mvps: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number;
  championsGoals: number;
}

export interface PlayerDisciplineState {
  season: number;
  yellowCards: number;
  suspendedMatches: number;
}

export interface SeasonSummary {
  season: number;
  careerYear: number;
  age: number;
  club: string;
  leagueId?: number;
  leagueLabel: string;
  rank: number;
  points: number;
  played: number;
  averageRating: number;
  stats: PlayerSeasonStats;
  honors: string[];
  movement: ClubSeasonResult['movement'];
}

export interface CareerHistoryEntry {
  generation: number;
  position: Position;
  retiredAt: string;
  age: number;
  seasons: number;
  finalClub: string;
  finalRating: number;
  appearances: number;
  goals: number;
  assists: number;
  honors: number;
}

export interface PlayerTransferOffer {
  id: string;
  clubId: number;
  clubName: string;
  leagueId: number;
  weeklySalary: number;
  seasons: number;
  season: number;
  status: 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
}

export interface ClubSeasonResult {
  season: number;
  leagueId?: number;
  rank: number;
  points: number;
  movement: 'PROMOTED' | 'RELEGATED' | 'STAYED';
  nextLeagueId?: number;
  championsQualified: boolean;
}

export type MatchTimelineKind = 'GOAL' | 'CHANCE' | 'SAVE' | 'BLOCK' | 'YELLOW' | 'RED' | 'INJURY';

/** One moment of a simulated Player-mode match, shown minute by minute in the live view. */
export interface MatchTimelineEvent {
  minute: number;
  side: 'TEAM' | 'OPPONENT';
  kind: MatchTimelineKind;
  /** Display text without the minute. */
  text: string;
  /** The user's athlete is the actor. */
  user?: boolean;
  /** Scorer (or acting player) and assist provider, for ratings and recaps. */
  actor?: string;
  assist?: string;
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
  /** playerGoals/opponentGoals stay the team score; this block is the athlete's own output. */
  personal?: PersonalMatchPerformance;
  competition?: 'LEAGUE' | 'CHAMPIONS' | 'EARTH_CUP';
  /** Round label for cup matches (e.g. "Earth Cup · Quarter-final"); league matches show the matchday. */
  stageLabel?: string;
  matchday?: number;
  home?: boolean;
  teamName?: string;
  /** Team-perspective half-time score. */
  halftime?: { team: number; opponent: number };
  /** Presentation timeline consistent with the score and the athlete's personal output. */
  timeline?: MatchTimelineEvent[];
  /** Game-calendar date of the match (ISO). */
  date?: string;
  attendance?: number;
  mvpName?: string;
  /** Match ratings of the athlete's side, highest first. */
  ratings?: Array<{ name: string; position: Position; rating: number; user?: boolean }>;
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
  /** Weekly salary paid on each Weekly Update while the contract is ACTIVE. */
  salary: number;
  beginTime: string;
  endTime: string;
  state: 'ACTIVE' | 'EXPIRED' | 'REJECTED';
  type: 'INITIAL' | 'RENEWAL' | 'TRANSFER';
  /** Game-time term. Contracts without these fields are legacy real-time contracts. */
  startSeason?: number;
  seasons?: number;
  seasonsRemaining?: number;
  lastRaiseSeason?: number;
}

export interface ChampionsMatchSummary {
  round: number;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  penalties?: { for: number; against: number };
  won: boolean;
}

export interface ChampionsLeagueState {
  season: number;
  round: number;
  opponent: string;
  opponentId?: number;
  homeGoals: number;
  awayGoals: number;
  aggregate: number;
  status: 'QUALIFIED' | 'ACTIVE' | 'ELIMINATED' | 'CHAMPION';
  history?: ChampionsMatchSummary[];
}

export interface EarthCupStanding {
  code: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface EarthCupMatch {
  stage: number;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  penalties?: { for: number; against: number };
  /** The athlete's own line; absent when the nation played without them. */
  personal?: { goals: number; assists: number; rating: number };
}

/** One Earth Cup edition for the athlete's nation (RECOVERY_INFERRED tournament, see earth-cup.ts). */
export interface EarthCupState {
  year: number;
  /** League season the tournament follows. */
  season: number;
  nation: string;
  calledUp: boolean;
  status: 'ACTIVE' | 'ELIMINATED' | 'CHAMPION';
  /** Next stage: 0–2 group matchdays, 3 Round of 16, 4 Quarter-final, 5 Semi-final, 6 Final. */
  stage: number;
  /** Group order: the nation first, then the three drawn rivals. */
  group: EarthCupStanding[];
  opponent?: string;
  history: EarthCupMatch[];
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
  /** Domestic league the club currently plays in; can differ from client data after promotion/relegation. */
  leagueId?: number;
  /** Club names in the current league season (stable across promotion/relegation swaps). */
  participants?: string[];
  lastSeasonResult?: ClubSeasonResult;
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
  cleanSheets?: number;
  ratingSum?: number;
  ratedMatches?: number;
  /** Fractional development progress; every full point raises two position abilities. */
  growth?: number;
  /** Yellow cards since the last suspension; resets when a ban is triggered. */
  seasonYellowCards?: number;
}

export interface VersusClub {
  id: string;
  ownerId?: string;
  name: string;
  isNpc: boolean;
  grade: number;
  /** 2 = letter-tier lifecycle (new clubs start in Liga E). Missing = legacy club created before tiers. */
  tierVersion?: number;
  /** Season-bound sponsor; payouts are added to battle rewards during settlement. */
  sponsor?: VersusSponsorContract;
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
  /** Sponsor payout included in money/coin, kept separately for the ledger. */
  sponsorMoney?: number;
  sponsorCoin?: number;
}

export interface VersusGoalEvent {
  clubId: string;
  playerId: string;
  playerName: string;
  assistId?: string;
  assistName?: string;
  half: 1 | 2;
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
  scorers?: VersusGoalEvent[];
  mvpClubId?: string;
  /** Set when a side could not field a legal XI and the system used an emergency lineup. */
  emergencyLineup?: Array<'HOME' | 'AWAY'>;
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
  promotedToLeague?: string;
  relegatedToLeague?: string;
  fromLeague?: string;
  /** Season played on the pre-letter-tier grade scale: no movement; the club restarts in the entry tier. */
  legacyReset?: boolean;
}

export type VersusSponsorTier = 'JUNIOR' | 'SENIOR' | 'TOP';

export interface VersusSponsorContract {
  tier: VersusSponsorTier;
  seasonId: string;
  signedAt: string;
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
  /** Season whose promotion/relegation has already been applied to club.grade (idempotency key). */
  lastRolloverSeasonId?: string;
  /** `${seasonId}:${round}` of the last Scout search; one search per round. */
  lastScoutKey?: string;
}

export type NotificationType = 'VERSUS_ASSIGNED' | 'VERSUS_DEADLINE' | 'VERSUS_RESULT' | 'VERSUS_SEASON_END' | 'VERSUS_OUTBID' | 'VERSUS_AUCTION_WON' | 'VERSUS_AUCTION_LOST';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/** Append-only outbox entry; `id` is the idempotency key so producers can safely re-run. */
export interface NotificationRecord {
  id: string;
  type: NotificationType;
  mode: 'VERSUS';
  title: string;
  lines: string[];
  createdAt: string;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt?: string;
  sentAt?: string;
  lastError?: string;
}

export interface NotificationSettings {
  dm: boolean;
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
  /** Skill values when this career generation began; the UI counts levels from here (Lv 1, 2, 3…). */
  skillBase?: Partial<Record<DetailedSkillId, number>>;
  /** Birth country picked at creation; it decides the national team for international tournaments, not the club. */
  nationality?: string;
  /** Detailed position chosen at creation (ST, CB, CDM…); `position` keeps the GK/DF/MF/FW group. */
  positionDetail?: string;
  /** Calendar year in which season 1 of this generation started (dates shown in the game calendar). */
  calendarStartYear?: number;
  /** Season whose winter-break holiday event was already offered. */
  winterHolidaySeason?: number;
  /** `${season}-${window}` of the last window that already produced in-season offers. */
  transferWindowKey?: string;
  /** Fans, as shown on the original hub; raised by events, goals, and MVP awards (RECOVERY_INFERRED). */
  fans?: number;
  /** Premium currency shown on the original hub; earned only through top-up (not yet enabled). */
  diamonds?: number;
  detailedSkills?: DetailedSkills;
  unassignedMatchExp?: number;
  injury?: InjuryState;
  activeTraining?: ActiveTraining;
  /** careerWeek of the last Regular Training session (one session per week). */
  regularTrainingWeek?: number;
  trainer?: TrainerState;
  cultureStudy?: CultureStudyState;
  weeklyEvent?: PlayerWeeklyEvent;
  sponsor?: PlayerSponsorContract;
  sponsorHistory?: PlayerSponsorContract[];
  charm?: number;
  unlockedTricks?: string[];
  /** Current or most recent Earth Cup for the athlete's nation. */
  earthCup?: EarthCupState;
  /** International caps and goals across every Earth Cup of this generation. */
  nationalCaps?: number;
  nationalGoals?: number;
  /** Trick currently being learned; it unlocks when the week arrives or when accelerated with Diamonds. */
  trickTraining?: TrickTrainingState;
  honors?: HonorRecord[];
  worldFootballer?: WorldFootballerState;
  retirement?: RetirementState;
  coach?: CoachCareerState;
  versus?: VersusUserSave;
  seasonStats?: PlayerSeasonStats;
  discipline?: PlayerDisciplineState;
  /** Append-only per-season summaries for the current career generation. */
  seasonHistory?: SeasonSummary[];
  /** Append-only final snapshot of every retired career generation. */
  careerHistory?: CareerHistoryEntry[];
  transferOffers?: PlayerTransferOffer[];
  /** Coach-club transfer market; Player Mode athletes never buy teammates. */
  coachMarket?: { listings: MarketListing[]; refreshedAt: string; refreshedAtRound: number; season: number };
  notifications?: NotificationRecord[];
  notificationSettings?: NotificationSettings;
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

export interface ClubMatchStats {
  homePossession: number;
  awayPossession: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
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
  stats: ClubMatchStats;
  /** Club-side players who took the field (used for personal performance and appearances). */
  squadIds: string[];
  opponentName: string;
  clubIsHome: boolean;
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

/**
 * Goalkeepers in the original assign EXP to their own skills: Strike, Reaction,
 * Hand Toss, GK Kick, Save Penalty, Hold Position, GK Pass Ball, Command Defense,
 * plus Balance, Jump, and Willpower. They reuse the twelve skill slots; the slots
 * that drive the keeper rating carry Reaction, Command Defense, GK Pass Ball,
 * Jump, and Willpower, so balance is unchanged. Off-ball Running has no keeper
 * counterpart and is hidden for keepers.
 */
export const GOALKEEPER_SKILL_LABELS: Partial<Record<DetailedSkillId, string>> = {
  freeKick: 'Strike',
  endurance: 'Reaction',
  dribbling: 'Hand Toss',
  shots: 'GK Kick',
  penalty: 'Save Penalty',
  holdOffDefenders: 'Hold Position',
  pass: 'GK Pass Ball',
  teamwork: 'Command Defense',
  speed: 'Balance',
  header: 'Jump',
  willpower: 'Willpower'
};

export function skillLabel(position: Position, skill: DetailedSkillId): string {
  return position === 'GK' ? GOALKEEPER_SKILL_LABELS[skill] ?? DETAILED_SKILL_LABELS[skill] : DETAILED_SKILL_LABELS[skill];
}

/** Skills shown for a position (keepers see their eleven). */
export function visibleSkills(position: Position): DetailedSkillId[] {
  return position === 'GK' ? DETAILED_SKILLS.filter((skill) => GOALKEEPER_SKILL_LABELS[skill]) : [...DETAILED_SKILLS];
}

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

// Requirements use the same 1–99 scale as detailed skills. matchModifier feeds the
// personal match model (goal share and rating); thresholds are RECOVERY_INFERRED.
export const TRICK_CATALOG: Record<string, TrickDefinition> = {
  'bicycle-kick': {
    id: 'bicycle-kick',
    name: 'Bicycle Kick',
    description: 'Teknik akrobatik dengan bonus finishing situasional.',
    requires: { shots: 70, header: 70, dribbling: 60 },
    energyCost: 24,
    matchModifier: 0.06,
    source: 'WALKTHROUGH_OBSERVED'
  },
  'first-touch-turn': {
    id: 'first-touch-turn',
    name: 'First-touch Turn',
    description: 'Kontrol sentuhan pertama untuk mempercepat progresi bola.',
    requires: { dribbling: 62, pass: 60 },
    energyCost: 20,
    matchModifier: 0.04,
    source: 'RECOVERY_INFERRED'
  },
  'long-range-curler': {
    id: 'long-range-curler',
    name: 'Long-range Curler',
    description: 'Tendangan melengkung dari luar kotak penalti.',
    requires: { shots: 80, freeKick: 70 },
    energyCost: 26,
    matchModifier: 0.05,
    source: 'RECOVERY_INFERRED'
  },
  'last-ditch-tackle': {
    id: 'last-ditch-tackle',
    name: 'Last-ditch Tackle',
    description: 'Tekel penyelamat yang menaikkan rating bertahan.',
    requires: { holdOffDefenders: 75, willpower: 65 },
    energyCost: 22,
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
