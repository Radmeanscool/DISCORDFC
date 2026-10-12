export interface GameBalance {
  training: {
    energyCost: number;
    expMin: number;
    expMaxExclusive: number;
  };
  detailedTraining: {
    energyCost: number;
    expMin: number;
    expMaxExclusive: number;
    durationWeeks: number;
    hpCost: number;
  };
  match: {
    energyCost: number;
    hpCost: number;
    maxGoals: number;
    rewardMoney: { win: number; draw: number; loss: number };
    rewardExp: { win: number; draw: number; loss: number };
    injuryChance: number;
  };
  recovery: {
    hpPerHour: number;
    energyPerHour: number;
  };
  weekly: {
    energyRecovery: number;
    hpRecovery: number;
    baseMatchExp: number;
    maxCareerYear: number;
    retirementAge: number;
    weeksPerSeason: number;
    playerEventChance: number;
    medicalEventChance: number;
    sponsorContractWeeks: number;
  };
  injury: {
    minWeeks: number;
    maxWeeks: number;
    basicTreatmentWeeks: number;
    expertTreatmentWeeks: number;
    expertTreatmentCost: number;
  };
  trainer: {
    maxWeeklyGain: number;
  };
  culture: {
    durationWeeks: number;
    charmGain: number;
    skillExpGain: number;
  };
  competition: {
    attemptsPerTeam: number;
    baseGoalChance: number;
    maxGoalChance: number;
  };
  coach: {
    initialAge: number;
    initialApproval: number;
    roundExp: { win: number; draw: number; loss: number };
    levelExpBonus: number;
    varianceMaxExclusive: number;
    eventChance: number;
    promotionRate: number;
    championshipRate: number;
    relegationRate: number;
  };
  versus: {
    defaultGroupCapacity: number;
    minimumLeagueClubs: number;
    maxGoals: number;
    roundDurationDays: number;
    winPoints: number;
    drawPoints: number;
    matchAttempts: number;
    baseGoalChance: number;
    maxGoalChance: number;
    homeAdvantage: number;
    lineupHpCost: number;
    injuryChance: number;
    cardChance: number;
    redCardChance: number;
    marketListingCount: number;
    marketAuctionDurationSeconds: number;
    marketOpeningBidDivisor: number;
    marketMinimumIncrement: number;
    matchmakingTicketTtlSeconds: number;
    matchmakingInitialRatingWindow: number;
    matchmakingWindowStep: number;
    matchmakingWindowEverySeconds: number;
    winReward: { money: number; coin: number; conditionRecovery: number };
    drawReward: { money: number; coin: number; conditionRecovery: number };
    lossReward: { money: number; coin: number; conditionRecovery: number };
  };
  version: string;
  source: 'RECOVERY_INFERRED' | 'OFFICIAL_CALIBRATED';
}

export const GAME_BALANCE: GameBalance = {
  training: { energyCost: 15, expMin: 18, expMaxExclusive: 31 },
  // SkillTrainConfig exposes trainTime and hpSpend. The exact client values
  // are not recoverable here, so the Discord order uses a one-week settlement
  // and an explicit zero HP spend until the payload is decoded.
  detailedTraining: { energyCost: 12, expMin: 18, expMaxExclusive: 31, durationWeeks: 1, hpCost: 0 },
  match: {
    energyCost: 20,
    hpCost: 8,
    maxGoals: 5,
    rewardMoney: { win: 220, draw: 140, loss: 90 },
    rewardExp: { win: 42, draw: 30, loss: 22 },
    injuryChance: 0.08
  },
  recovery: { hpPerHour: 2, energyPerHour: 10 },
  weekly: {
    energyRecovery: 35,
    hpRecovery: 18,
    baseMatchExp: 30,
    maxCareerYear: 20,
    retirementAge: 34,
    weeksPerSeason: 10,
    playerEventChance: 0.32,
    medicalEventChance: 0.18,
    sponsorContractWeeks: 6
  },
  injury: {
    minWeeks: 1,
    maxWeeks: 6,
    basicTreatmentWeeks: 1,
    expertTreatmentWeeks: 3,
    expertTreatmentCost: 450
  },
  trainer: { maxWeeklyGain: 6 },
  culture: { durationWeeks: 2, charmGain: 2, skillExpGain: 18 },
  competition: { attemptsPerTeam: 5, baseGoalChance: 0.13, maxGoalChance: 0.32 },
  coach: {
    initialAge: 34,
    initialApproval: 50,
    roundExp: { win: 90, draw: 60, loss: 35 },
    levelExpBonus: 5,
    varianceMaxExclusive: 16,
    eventChance: 0.28,
    promotionRate: 0.6,
    championshipRate: 0.5,
    relegationRate: 0.2
  },
  versus: {
    defaultGroupCapacity: 8,
    minimumLeagueClubs: 4,
    maxGoals: 6,
    roundDurationDays: 1,
    winPoints: 3,
    drawPoints: 1,
    matchAttempts: 8,
    baseGoalChance: 0.08,
    maxGoalChance: 0.25,
    homeAdvantage: 2,
    lineupHpCost: 5,
    injuryChance: 0.025,
    cardChance: 0.15,
    redCardChance: 0.025,
    marketListingCount: 6,
    marketAuctionDurationSeconds: 60,
    marketOpeningBidDivisor: 1_000,
    marketMinimumIncrement: 1,
    matchmakingTicketTtlSeconds: 300,
    matchmakingInitialRatingWindow: 8,
    matchmakingWindowStep: 4,
    matchmakingWindowEverySeconds: 30,
    winReward: { money: 500, coin: 3, conditionRecovery: 1 },
    drawReward: { money: 300, coin: 2, conditionRecovery: 1 },
    lossReward: { money: 180, coin: 1, conditionRecovery: 0 }
  },
  version: 'gameplay-expansion-recovery-inferred-2026-08',
  source: 'RECOVERY_INFERRED'
};

export function assertBalance(balance: GameBalance): void {
  if (balance.training.energyCost < 0 || balance.detailedTraining.energyCost < 0 || balance.detailedTraining.hpCost < 0 || balance.match.energyCost < 0 || balance.match.hpCost < 0) throw new Error('Balance costs cannot be negative.');
  if (balance.match.maxGoals < 1 || balance.competition.attemptsPerTeam < 1) throw new Error('Balance competition limits are invalid.');
  if (balance.competition.baseGoalChance <= 0 || balance.competition.maxGoalChance >= 1) throw new Error('Balance goal chance must be between 0 and 1.');
  if (balance.injury.minWeeks < 1 || balance.injury.maxWeeks < balance.injury.minWeeks) throw new Error('Injury week range is invalid.');
  if (balance.weekly.weeksPerSeason < 1 || balance.weekly.maxCareerYear < 1 || balance.detailedTraining.durationWeeks < 1 || balance.weekly.playerEventChance < 0 || balance.weekly.playerEventChance > 1 || balance.weekly.medicalEventChance < 0 || balance.weekly.medicalEventChance > 1 || balance.weekly.sponsorContractWeeks < 1) throw new Error('Weekly progression limits are invalid.');
  if (balance.culture.durationWeeks < 1 || balance.trainer.maxWeeklyGain < 1) throw new Error('Training progression limits are invalid.');
  if (balance.coach.initialAge < 18 || balance.coach.initialApproval < 0 || balance.coach.initialApproval > 100 || balance.coach.eventChance < 0 || balance.coach.eventChance > 1) throw new Error('Coach balance limits are invalid.');
  if (balance.versus.defaultGroupCapacity < balance.versus.minimumLeagueClubs || balance.versus.minimumLeagueClubs < 2 || balance.versus.matchAttempts < 1 || balance.versus.maxGoalChance >= 1 || balance.versus.marketListingCount < 1 || balance.versus.marketAuctionDurationSeconds < 1 || balance.versus.marketOpeningBidDivisor < 1 || balance.versus.marketMinimumIncrement < 1 || balance.versus.matchmakingTicketTtlSeconds < 1 || balance.versus.matchmakingInitialRatingWindow < 0 || balance.versus.matchmakingWindowStep < 0 || balance.versus.matchmakingWindowEverySeconds < 1) throw new Error('Versus balance limits are invalid.');
}

assertBalance(GAME_BALANCE);
