import type { Position } from '../domain/types.js';

type PositionTable = Record<Position, number>;

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
  skillProgression: {
    baseExp: number;
    perLevel: number;
    eliteThreshold: number;
    elitePerLevel: number;
    maxLevel: number;
  };
  rating: {
    weightedShare: number;
    averageShare: number;
  };
  match: {
    energyCost: number;
    hpCost: number;
    maxGoals: number;
    rewardMoney: { win: number; draw: number; loss: number };
    rewardExp: { win: number; draw: number; loss: number };
    injuryChance: number;
  };
  personal: {
    goalShare: PositionTable;
    goalShareCap: PositionTable;
    assistShare: PositionTable;
    yellowCardChance: PositionTable;
    redCardChance: number;
    yellowSuspensionThreshold: number;
    ratingBase: number;
    mvpRatingThreshold: number;
    ratingExpBonus: number;
    goalMoneyBonus: number;
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
    /** Fallback season length only used when a profile has no club fixture calendar. */
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
    gainPerRatio: number;
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
  league: {
    baseGoals: number;
    goalScale: number;
    maxGoals: number;
    promotionSlots: number;
    relegationSlots: number;
    championsSlots: number;
    championsMatchdayGap: number;
  };
  contract: {
    defaultSeasons: number;
    salaryDivisor: number;
    raiseThreshold: number;
  };
  transfer: {
    ratingMargin: number;
    offersPerSeason: number;
  };
  rebirth: {
    skillBonusPerRebirth: number;
    maxSkillBonus: number;
    startingLevel: number;
  };
  worldFootballer: {
    candidateBase: number;
    candidateSpread: number;
    minAppearanceShare: number;
    cleanSheetWeight: number;
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
    dismissalApproval: number;
    seasonDismissalApproval: number;
    maxOpenOffers: number;
    abilityEffects: {
      formationPerLevel: number;
      formationCap: number;
      tacticAmplifierPerLevel: number;
      tacticAmplifierCap: number;
      comebackPerLevel: number;
      comebackCap: number;
      trainingGrowthBase: number;
      trainingGrowthPerLevel: number;
      trainingGrowthCap: number;
    };
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
    roundRecovery: number;
    restRecovery: number;
    injuryChance: number;
    lowConditionInjuryChance: number;
    cardChance: number;
    redCardChance: number;
    yellowSuspensionThreshold: number;
    startingGrade: number;
    rosterLimit: number;
    marketListingCount: number;
    marketAuctionDurationSeconds: number;
    marketAntiSnipeSeconds: number;
    marketOpeningBidDivisor: number;
    marketMinimumIncrement: number;
    matchmakingTicketTtlSeconds: number;
    matchmakingInitialRatingWindow: number;
    matchmakingWindowStep: number;
    matchmakingWindowEverySeconds: number;
    deadlineReminderHours: number;
    winReward: { money: number; coin: number; conditionRecovery: number };
    drawReward: { money: number; coin: number; conditionRecovery: number };
    lossReward: { money: number; coin: number; conditionRecovery: number };
    sponsor: Record<'JUNIOR' | 'SENIOR' | 'TOP', { minimumGrade: number; winMoney: number; drawMoney: number; winCoin: number }>;
    scout: Record<'JUNIOR' | 'SENIOR', { cost: number; abilityBonusMin: number; abilityBonusMax: number }>;
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
  // Cost to gain one level = baseExp + level × perLevel (+ elitePerLevel above
  // eliteThreshold). Calibrated so a focused career peaks around age 27–30.
  skillProgression: { baseExp: 40, perLevel: 1.2, eliteThreshold: 75, elitePerLevel: 8, maxLevel: 99 },
  rating: { weightedShare: 0.78, averageShare: 0.22 },
  match: {
    energyCost: 20,
    hpCost: 8,
    maxGoals: 5,
    rewardMoney: { win: 220, draw: 140, loss: 90 },
    rewardExp: { win: 42, draw: 30, loss: 22 },
    injuryChance: 0.04
  },
  personal: {
    goalShare: { GK: 0.003, DF: 0.06, MF: 0.13, FW: 0.28 },
    goalShareCap: { GK: 0.02, DF: 0.12, MF: 0.25, FW: 0.42 },
    assistShare: { GK: 0.01, DF: 0.08, MF: 0.24, FW: 0.18 },
    yellowCardChance: { GK: 0.03, DF: 0.12, MF: 0.09, FW: 0.06 },
    redCardChance: 0.012,
    yellowSuspensionThreshold: 5,
    ratingBase: 6.0,
    mvpRatingThreshold: 7.8,
    ratingExpBonus: 4,
    goalMoneyBonus: 40
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
  trainer: { maxWeeklyGain: 15, gainPerRatio: 120 },
  culture: { durationWeeks: 2, charmGain: 2, skillExpGain: 18 },
  competition: { attemptsPerTeam: 5, baseGoalChance: 0.13, maxGoalChance: 0.32 },
  league: { baseGoals: 1.35, goalScale: 30, maxGoals: 7, promotionSlots: 3, relegationSlots: 3, championsSlots: 4, championsMatchdayGap: 8 },
  contract: { defaultSeasons: 2, salaryDivisor: 100, raiseThreshold: 1.1 },
  transfer: { ratingMargin: 14, offersPerSeason: 3 },
  rebirth: { skillBonusPerRebirth: 3, maxSkillBonus: 12, startingLevel: 10 },
  worldFootballer: { candidateBase: 108, candidateSpread: 16, minAppearanceShare: 0.5, cleanSheetWeight: 0.35 },
  coach: {
    initialAge: 34,
    initialApproval: 50,
    roundExp: { win: 90, draw: 60, loss: 35 },
    levelExpBonus: 5,
    varianceMaxExclusive: 16,
    eventChance: 0.28,
    promotionRate: 0.6,
    championshipRate: 0.5,
    relegationRate: 0.2,
    dismissalApproval: 10,
    seasonDismissalApproval: 20,
    maxOpenOffers: 3,
    abilityEffects: {
      formationPerLevel: 0.004,
      formationCap: 0.12,
      tacticAmplifierPerLevel: 0.03,
      tacticAmplifierCap: 0.6,
      comebackPerLevel: 0.006,
      comebackCap: 0.15,
      trainingGrowthBase: 0.02,
      trainingGrowthPerLevel: 0.006,
      trainingGrowthCap: 0.2
    }
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
    lineupHpCost: 14,
    roundRecovery: 8,
    restRecovery: 6,
    injuryChance: 0.015,
    lowConditionInjuryChance: 0.0015,
    cardChance: 0.12,
    redCardChance: 0.015,
    yellowSuspensionThreshold: 3,
    startingGrade: 5,
    rosterLimit: 25,
    marketListingCount: 6,
    marketAuctionDurationSeconds: 21_600,
    marketAntiSnipeSeconds: 300,
    marketOpeningBidDivisor: 1_000,
    marketMinimumIncrement: 1,
    matchmakingTicketTtlSeconds: 300,
    matchmakingInitialRatingWindow: 8,
    matchmakingWindowStep: 4,
    matchmakingWindowEverySeconds: 30,
    deadlineReminderHours: 3,
    winReward: { money: 500, coin: 3, conditionRecovery: 1 },
    drawReward: { money: 300, coin: 2, conditionRecovery: 1 },
    lossReward: { money: 180, coin: 1, conditionRecovery: 0 },
    sponsor: {
      JUNIOR: { minimumGrade: 5, winMoney: 120, drawMoney: 60, winCoin: 0 },
      SENIOR: { minimumGrade: 3, winMoney: 250, drawMoney: 120, winCoin: 1 },
      TOP: { minimumGrade: 1, winMoney: 450, drawMoney: 200, winCoin: 2 }
    },
    scout: {
      JUNIOR: { cost: 1_500, abilityBonusMin: 0, abilityBonusMax: 6 },
      SENIOR: { cost: 3_000, abilityBonusMin: 3, abilityBonusMax: 9 }
    }
  },
  version: 'gameplay-parity-recovery-inferred-2026-10',
  source: 'RECOVERY_INFERRED'
};

export function assertBalance(balance: GameBalance): void {
  if (balance.training.energyCost < 0 || balance.detailedTraining.energyCost < 0 || balance.detailedTraining.hpCost < 0 || balance.match.energyCost < 0 || balance.match.hpCost < 0) throw new Error('Balance costs cannot be negative.');
  if (balance.match.maxGoals < 1 || balance.competition.attemptsPerTeam < 1) throw new Error('Balance competition limits are invalid.');
  if (balance.competition.baseGoalChance <= 0 || balance.competition.maxGoalChance >= 1) throw new Error('Balance goal chance must be between 0 and 1.');
  if (balance.injury.minWeeks < 1 || balance.injury.maxWeeks < balance.injury.minWeeks) throw new Error('Injury week range is invalid.');
  if (balance.weekly.weeksPerSeason < 1 || balance.weekly.maxCareerYear < 1 || balance.detailedTraining.durationWeeks < 1 || balance.weekly.playerEventChance < 0 || balance.weekly.playerEventChance > 1 || balance.weekly.medicalEventChance < 0 || balance.weekly.medicalEventChance > 1 || balance.weekly.sponsorContractWeeks < 1) throw new Error('Weekly progression limits are invalid.');
  if (balance.culture.durationWeeks < 1 || balance.trainer.maxWeeklyGain < 1 || balance.trainer.gainPerRatio <= 0) throw new Error('Training progression limits are invalid.');
  if (balance.skillProgression.baseExp < 1 || balance.skillProgression.perLevel < 0 || balance.skillProgression.elitePerLevel < 0 || balance.skillProgression.maxLevel < 2 || balance.skillProgression.maxLevel > 99) throw new Error('Skill progression curve is invalid.');
  if (Math.abs(balance.rating.weightedShare + balance.rating.averageShare - 1) > 1e-9) throw new Error('Rating shares must sum to 1.');
  for (const table of [balance.personal.goalShare, balance.personal.goalShareCap, balance.personal.assistShare, balance.personal.yellowCardChance]) {
    if (Object.values(table).some((value) => value < 0 || value >= 1)) throw new Error('Personal match probabilities must be between 0 and 1.');
  }
  if (balance.personal.redCardChance < 0 || balance.personal.redCardChance >= 1 || balance.personal.yellowSuspensionThreshold < 1) throw new Error('Discipline limits are invalid.');
  if (balance.league.baseGoals <= 0 || balance.league.goalScale <= 0 || balance.league.maxGoals < 1 || balance.league.promotionSlots < 0 || balance.league.relegationSlots < 0 || balance.league.championsSlots < 0 || balance.league.championsMatchdayGap < 0) throw new Error('League limits are invalid.');
  if (balance.contract.defaultSeasons < 1 || balance.contract.salaryDivisor <= 0 || balance.contract.raiseThreshold < 1) throw new Error('Contract limits are invalid.');
  if (balance.transfer.ratingMargin < 0 || balance.transfer.offersPerSeason < 0) throw new Error('Transfer limits are invalid.');
  if (balance.rebirth.skillBonusPerRebirth < 0 || balance.rebirth.maxSkillBonus < 0 || balance.rebirth.startingLevel < 1) throw new Error('Rebirth limits are invalid.');
  if (balance.worldFootballer.candidateSpread < 0 || balance.worldFootballer.minAppearanceShare < 0 || balance.worldFootballer.minAppearanceShare > 1) throw new Error('World Footballer limits are invalid.');
  if (balance.coach.initialAge < 18 || balance.coach.initialApproval < 0 || balance.coach.initialApproval > 100 || balance.coach.eventChance < 0 || balance.coach.eventChance > 1) throw new Error('Coach balance limits are invalid.');
  if (balance.coach.dismissalApproval < 0 || balance.coach.seasonDismissalApproval < balance.coach.dismissalApproval || balance.coach.maxOpenOffers < 1) throw new Error('Coach employment limits are invalid.');
  if (balance.versus.defaultGroupCapacity < balance.versus.minimumLeagueClubs || balance.versus.minimumLeagueClubs < 2 || balance.versus.matchAttempts < 1 || balance.versus.maxGoalChance >= 1 || balance.versus.marketListingCount < 1 || balance.versus.marketAuctionDurationSeconds < 1 || balance.versus.marketOpeningBidDivisor < 1 || balance.versus.marketMinimumIncrement < 1 || balance.versus.matchmakingTicketTtlSeconds < 1 || balance.versus.matchmakingInitialRatingWindow < 0 || balance.versus.matchmakingWindowStep < 0 || balance.versus.matchmakingWindowEverySeconds < 1) throw new Error('Versus balance limits are invalid.');
  if (balance.versus.startingGrade < 0 || balance.versus.startingGrade > 5 || balance.versus.rosterLimit < 18 || balance.versus.yellowSuspensionThreshold < 1 || balance.versus.lineupHpCost < 0 || balance.versus.roundRecovery < 0 || balance.versus.restRecovery < 0) throw new Error('Versus lifecycle limits are invalid.');
}

assertBalance(GAME_BALANCE);
