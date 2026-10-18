import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInitialProfile, SeededRandom, type RandomSource } from '../src/domain/engine.js';
import { ensureClubState, projectCoachLeagueStandings } from '../src/domain/club-engine.js';
import {
  advanceCoachRound,
  assignCoachExp,
  acceptJobOffer,
  createCoachCareer,
  generateJobOffer,
  resolveCoachEvent,
  settleCoachSeason
} from '../src/domain/coach-career-engine.js';
import {
  advanceWeek,
  assignMatchExp,
  ensureGameplayState,
  startCultureStudy,
  trainDetailedSkill,
  treatInjury
} from '../src/domain/gameplay-engine.js';
import {
  createVersusClub,
  enrollVersus,
  createVersusSeason,
  getVersusStandings,
  processVersusRound,
  settleVersusSeason,
  submitVersusLineup,
  syncVersusProfileWithSeason
} from '../src/domain/versus-engine.js';
import type { CoachAbilityId, PlayerProfile, Position, VersusSeason } from '../src/domain/types.js';

const TRIALS = Number(process.env.SIM_TRIALS ?? 300);
const PLAYER_WEEKS = Number(process.env.PLAYER_WEEKS ?? 60);
const COACH_SEASONS = Number(process.env.COACH_SEASONS ?? 2);
const VERSUS_CAPACITY = Number(process.env.VERSUS_CAPACITY ?? 8);
const BASE_DATE = Date.parse('2026-01-01T00:00:00.000Z');
const POSITIONS: Position[] = ['FW', 'MF', 'DF', 'GK'];
const SKILLS = ['shots', 'pass', 'dribbling', 'endurance'] as const;
const COACH_ABILITY: CoachAbilityId = 'formation';

type ModeName = 'PLAYER' | 'COACH' | 'VERSUS';

type ModeResult = {
  actions: number;
  metrics: Record<string, number>;
  invariants: number;
  errors: string[];
  signature: string;
};

type ModeReport = {
  mode: ModeName;
  trials: number;
  successfulTrials: number;
  failedTrials: number;
  actions: number;
  invariantChecks: number;
  invariantFailures: number;
  errors: Record<string, number>;
  metrics: Record<string, number>;
  sampleFailures: Array<{ trial: number; error: string }>;
  determinismChecks: number;
  determinismFailures: number;
};

type FullReport = {
  generatedAt: string;
  config: { trials: number; playerWeeks: number; coachSeasons: number; versusCapacity: number };
  modes: ModeReport[];
  totalActions: number;
  totalInvariantFailures: number;
  status: 'PASS' | 'FAIL';
};

function iso(ms: number): Date {
  return new Date(BASE_DATE + ms);
}

function inc(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function invariant(condition: unknown, message: string, context: string): void {
  if (!condition) throw new Error(`INVARIANT:${context}:${message}`);
}

function finiteRange(value: number, min: number, max: number, label: string, context: string): void {
  invariant(Number.isFinite(value) && value >= min && value <= max, `${label}=${value} outside ${min}..${max}`, context);
}

function playerInvariant(profile: PlayerProfile, context: string): void {
  finiteRange(profile.hp, 0, profile.maxHp, 'hp', context);
  finiteRange(profile.energy, 0, profile.maxEnergy, 'energy', context);
  invariant(profile.money >= 0 && Number.isFinite(profile.money), `money=${profile.money}`, context);
  invariant((profile.unassignedMatchExp ?? 0) >= 0, `pendingExp=${profile.unassignedMatchExp}`, context);
  invariant(profile.mode === 'PLAYER', `mode=${profile.mode}`, context);
  invariant(profile.careerStatus === 'ACTIVE' || profile.careerStatus === 'RETIRED', `careerStatus=${profile.careerStatus}`, context);
  for (const [skill, state] of Object.entries(profile.detailedSkills ?? {})) {
    finiteRange(state.level, 1, 99, `${skill}.level`, context);
    invariant(state.exp >= 0 && Number.isFinite(state.exp), `${skill}.exp=${state.exp}`, context);
  }
}

function coachInvariant(profile: PlayerProfile, context: string): void {
  playerInvariant(profile, context);
  const coach = profile.coach;
  invariant(Boolean(coach), 'coach state missing', context);
  invariant(Boolean(profile.coachClubState), 'coachClubState missing', context);
  invariant(coach!.season >= 1 && coach!.careerYear >= 1, `coach season/year=${coach!.season}/${coach!.careerYear}`, context);
  invariant(coach!.unassignedExp >= 0 && coach!.approval >= 0 && coach!.approval <= 100, `coach exp/approval=${coach!.unassignedExp}/${coach!.approval}`, context);
  for (const [ability, state] of Object.entries(coach!.abilities)) {
    finiteRange(state.level, 1, 99, `coach.${ability}.level`, context);
    invariant(state.exp >= 0 && Number.isFinite(state.exp), `coach.${ability}.exp=${state.exp}`, context);
  }
  const club = profile.coachClubState!;
  invariant(club.assets >= 0 && club.prestige >= 0, `coach assets/prestige=${club.assets}/${club.prestige}`, context);
  invariant(club.fixtures.length >= 20, `coach fixtures=${club.fixtures.length}`, context);
}

function versusInvariant(season: VersusSeason, context: string): void {
  invariant(season.state === 'ACTIVE' || season.state === 'FINISHED', `season state=${season.state}`, context);
  invariant(season.clubs.length >= 4, `clubs=${season.clubs.length}`, context);
  invariant(season.battles.length === season.clubs.length * (season.clubs.length - 1), `battles=${season.battles.length}`, context);
  for (const club of season.clubs) {
    invariant(club.versusMoney >= 0 && club.versusCoin >= 0, `${club.id} negative versus economy`, context);
    invariant(club.wins >= 0 && club.draws >= 0 && club.losses >= 0, `${club.id} negative record`, context);
    for (const player of club.roster) {
      finiteRange(player.hp, 0, player.maxHp, `${club.id}.${player.id}.hp`, context);
      invariant(player.yellowCards >= 0 && player.redCardBan >= 0, `${club.id}.${player.id} invalid cards`, context);
    }
  }
  const standings = getVersusStandings(season);
  invariant(standings.length === season.clubs.length, `standings=${standings.length}`, context);
  invariant(new Set(standings.map((standing) => standing.rank)).size === standings.length, 'duplicate standings rank', context);
}

function addError(report: ModeReport, trial: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = message.replace(/trial=\d+/g, 'trial=*').slice(0, 220);
  inc(report.errors, key);
  if (report.sampleFailures.length < 12) report.sampleFailures.push({ trial, error: message });
}

function mergeMetrics(report: ModeReport, metrics: Record<string, number>): void {
  for (const [key, value] of Object.entries(metrics)) report.metrics[key] = (report.metrics[key] ?? 0) + value;
}

function runPlayerTrial(trial: number): ModeResult {
  let profile = createInitialProfile(`stress-player-${trial}`, `Stress Player ${trial}`, POSITIONS[trial % POSITIONS.length], iso(trial * 1_000));
  profile = ensureGameplayState(profile, iso(trial * 1_000));
  const rng = new SeededRandom(100_000 + trial);
  let actions = 0;
  let invariants = 0;
  const metrics: Record<string, number> = { wins: 0, draws: 0, losses: 0, matches: 0, injuries: 0, awards: 0, trainingOrders: 0, cultureStudies: 0, weeks: 0 };
  for (let week = 0; week < PLAYER_WEEKS; week += 1) {
    const now = iso(trial * 1_000 + (week + 1) * 86_400_000);
    if ((profile.unassignedMatchExp ?? 0) > 0) {
      const allocation = assignMatchExp(profile, { [SKILLS[week % SKILLS.length]]: profile.unassignedMatchExp }, now);
      profile = allocation.profile;
      actions += 1;
    }
    if (profile.careerStatus === 'ACTIVE' && !profile.injury && !profile.activeTraining && profile.energy >= 12) {
      const training = trainDetailedSkill(profile, SKILLS[week % SKILLS.length], now, rng);
      profile = training.profile;
      metrics.trainingOrders += 1;
      actions += 1;
    }
    if (profile.careerStatus === 'ACTIVE' && !profile.cultureStudy && week % 17 === 0) {
      const study = startCultureStudy(profile, week % 2 === 0 ? 'science' : 'arts', now);
      profile = study.profile;
      metrics.cultureStudies += 1;
      actions += 1;
    }
    const result = advanceWeek(profile, now, rng);
    profile = result.profile;
    metrics.weeks += 1;
    actions += 1;
    if (result.match) {
      metrics.matches += 1;
      inc(metrics, result.match.outcome.toLowerCase());
    }
    if (result.injury) {
      metrics.injuries += 1;
      const treatment = treatInjury(profile, 'BASIC', iso(now.getTime() + 1_000));
      profile = treatment.profile;
      actions += 1;
    }
    if (result.award) metrics.awards += 1;
    playerInvariant(profile, `trial=${trial},week=${week}`);
    invariants += 1;
    if ((profile.unassignedMatchExp ?? 0) > 0) {
      const allocation = assignMatchExp(profile, { [SKILLS[(week + 1) % SKILLS.length]]: profile.unassignedMatchExp }, now);
      profile = allocation.profile;
      actions += 1;
    }
  }
  playerInvariant(profile, `trial=${trial},final`);
  invariants += 1;
  const signature = JSON.stringify({ age: profile.age, week: profile.careerWeek, money: profile.money, totalExp: profile.totalExp, matches: profile.career.appearances, injuries: profile.career.injuries, honors: profile.honors?.length ?? 0 });
  return { actions, metrics, invariants, errors: [], signature };
}

function runCoachTrial(trial: number): ModeResult {
  const start = iso(trial * 1_000);
  const playerSeasonBefore = 1;
  let profile = ensureClubState(createInitialProfile(`stress-coach-${trial}`, `Stress Coach ${trial}`, POSITIONS[(trial + 1) % POSITIONS.length]), start, new SeededRandom(200_000 + trial));
  profile = createCoachCareer(profile, `Stress Coach ${trial}`, start, new SeededRandom(250_000 + trial));
  const playerSnapshot = JSON.stringify({ club: profile.club, league: profile.league, clubState: profile.clubState });
  const rng = new SeededRandom(300_000 + trial);
  let actions = 0;
  let invariants = 0;
  const metrics: Record<string, number> = { seasons: 0, rounds: 0, wins: 0, draws: 0, losses: 0, events: 0, offers: 0, boardSuccesses: 0, boardFailures: 0, halftimeChecks: 0, fullStandingsChecks: 0 };
  for (let seasonIndex = 0; seasonIndex < COACH_SEASONS; seasonIndex += 1) {
    let guard = 0;
    while (profile.coachClubState!.fixtures.some((fixture) => !fixture.played)) {
      if (++guard > 200) throw new Error(`Coach season loop exceeded guard at trial=${trial}`);
      if (profile.coach!.status !== 'EMPLOYED') {
        // Mid-season dismissal: take an open offer (or ask the agent for one) and continue at the new club.
        const now = iso(start.getTime() + (metrics.rounds + 1) * 86_400_000);
        let offer = profile.coach!.jobOffers.find((item) => item.status === 'OPEN');
        if (!offer) {
          const job = generateJobOffer(profile, rng, now);
          profile = job.profile;
          offer = job.offer;
        }
        profile = acceptJobOffer(profile, offer.id, now, rng);
        metrics.dismissals = (metrics.dismissals ?? 0) + 1;
        actions += 1;
        continue;
      }
      if (profile.coach!.event && !profile.coach!.event.resolved) {
        profile = resolveCoachEvent(profile, profile.coach.event.choices[0].id, iso(start.getTime() + (metrics.rounds + 1) * 86_400_000));
        actions += 1;
        metrics.events += 1;
      }
      const result = advanceCoachRound(profile, iso(start.getTime() + (metrics.rounds + 1) * 86_400_000), rng);
      profile = result.profile;
      actions += 1;
      metrics.rounds += 1;
      inc(metrics, result.match.outcome.toLowerCase());
      metrics.halftimeChecks += Number(Number.isFinite(result.match.halftime.homeGoals) && Number.isFinite(result.match.halftime.awayGoals));
      if (result.event) metrics.events += 1;
      if (profile.coach!.unassignedExp > 0) {
        const allocated = assignCoachExp(profile, { [COACH_ABILITY]: profile.coach!.unassignedExp }, iso(start.getTime() + (metrics.rounds + 1) * 86_400_000));
        profile = allocated.profile;
        actions += 1;
      }
      coachInvariant(profile, `trial=${trial},round=${metrics.rounds}`);
      invariants += 1;
    }
    if (profile.coach!.event && !profile.coach!.event.resolved) {
      profile = resolveCoachEvent(profile, profile.coach.event.choices[0].id, iso(start.getTime() + (metrics.rounds + 1) * 86_400_000));
      actions += 1;
      metrics.events += 1;
    }
    projectCoachLeagueStandings(profile.coachClubState!);
    invariant(profile.coachClubState!.standings.every((standing) => standing.played === profile.coachClubState!.fixtures.length), 'Coach full standings projection incomplete', `trial=${trial},season=${seasonIndex}`);
    metrics.fullStandingsChecks += 1;
    const beforeHonors = profile.coach!.honors.length;
    const beforeTarget = profile.coach!.boardTarget;
    profile = settleCoachSeason(profile, iso(start.getTime() + (metrics.rounds + 2) * 86_400_000), rng);
    actions += 1;
    metrics.seasons += 1;
    if (profile.coach!.honors.length > beforeHonors) metrics.boardSuccesses += 1;
    if (profile.coach!.boardTarget.type !== beforeTarget.type || profile.coach!.boardTarget.season !== beforeTarget.season) metrics.boardFailures += 0;
    if (profile.coach!.status === 'UNEMPLOYED') {
      const job = generateJobOffer(profile, rng);
      profile = job.profile;
      actions += 1;
      metrics.offers += 1;
      profile = acceptJobOffer(profile, job.offer.id, iso(start.getTime() + (metrics.rounds + 3) * 86_400_000), rng);
      actions += 1;
    }
    coachInvariant(profile, `trial=${trial},season=${seasonIndex}`);
    invariants += 1;
  }
  invariant(profile.league.season === playerSeasonBefore, `Player season changed to ${profile.league.season}`, `trial=${trial}`);
  invariant(JSON.stringify({ club: profile.club, league: profile.league, clubState: profile.clubState }) === playerSnapshot, 'Player state changed during Coach simulation', `trial=${trial}`);
  const signature = JSON.stringify({ coachSeason: profile.coach!.season, careerYear: profile.coach!.careerYear, rounds: metrics.rounds, wins: metrics.wins, draws: metrics.draws, losses: metrics.losses, honors: profile.coach!.honors.length, playerSeason: profile.league.season });
  return { actions, metrics, invariants, errors: [], signature };
}

function createVersusProfiles(trial: number, now: Date): PlayerProfile[] {
  return Array.from({ length: 4 }, (_, index) => {
    let profile = ensureClubState(createInitialProfile(`stress-versus-${trial}-${index}`, `Stress Versus ${trial}-${index}`, POSITIONS[index]), now, new SeededRandom(400_000 + trial * 10 + index));
    profile = createCoachCareer(profile, `Coach ${trial}-${index}`, now);
    profile = createVersusClub(profile, now);
    return enrollVersus(profile, `STRESS-${trial}`, now);
  });
}

function runVersusSeason(trial: number, seed: number): { season: VersusSeason; profiles: PlayerProfile[]; metrics: Record<string, number>; actions: number; invariants: number; signature: string } {
  const now = iso(trial * 1_000);
  const profiles = createVersusProfiles(trial, now);
  const playerCoachSnapshots = profiles.map((profile) => JSON.stringify({ club: profile.club, league: profile.league, clubState: profile.clubState, coachClubState: profile.coachClubState, coach: profile.coach }));
  let season = createVersusSeason(`STRESS-${trial}`, profiles, now, VERSUS_CAPACITY);
  const rng = new SeededRandom(seed);
  let actions = 1;
  let invariants = 0;
  const metrics: Record<string, number> = { rounds: 0, battles: 0, publishedBattles: 0, halftimeChecks: 0, standingsChecks: 0, submissions: 0, ledgerChecks: 0, rewards: 0 };
  versusInvariant(season, `trial=${trial},initial`);
  invariants += 1;
  const totalRounds = 2 * (season.clubs.length - 1);
  for (let round = 1; round <= totalRounds; round += 1) {
    if (round === 1) {
      for (const profile of profiles) {
        const club = season.clubs.find((item) => item.ownerId === profile.userId)!;
        const battle = season.battles.find((item) => item.roundId === round && (item.homeClubId === club.id || item.awayClubId === club.id))!;
        const slots = { GK: 1, DF: 4, MF: 4, FW: 2 };
        const lineup = (['GK', 'DF', 'MF', 'FW'] as const).flatMap((position) => club.roster.filter((player) => player.position === position && player.hp > 0 && player.status === 'AVAILABLE' && player.redCardBan === 0).slice(0, slots[position])).map((player) => player.id);
        invariant(lineup.length === 11, 'Stress fixture could not build legal Versus lineup', `trial=${trial},club=${club.id}`);
        season = submitVersusLineup(season, battle.id, profile.userId, lineup, club.roster.filter((player) => !lineup.includes(player.id)).slice(0, 5).map((player) => player.id), lineup[0], '4-4-2', 'tiki-taka', club.rosterVersion, new Date(now.getTime() + 12 * 60 * 60 * 1_000));
        actions += 1;
        metrics.submissions += 1;
      }
    }
    season = processVersusRound(season, round, new Date(now.getTime() + round * 86_400_000), rng);
    actions += 1;
    metrics.rounds += 1;
    const roundBattles = season.battles.filter((battle) => battle.roundId === round);
    metrics.battles += roundBattles.length;
    metrics.publishedBattles += roundBattles.filter((battle) => battle.state === 'PUBLISHED').length;
    metrics.halftimeChecks += roundBattles.filter((battle) => Boolean(battle.settlement?.halftime)).length;
    invariant(roundBattles.every((battle) => battle.state === 'PUBLISHED'), 'unpublished battle after settlement', `trial=${trial},round=${round}`);
    versusInvariant(season, `trial=${trial},round=${round}`);
    invariants += 1;
    metrics.standingsChecks += 1;
  }
  season = settleVersusSeason(season, new Date(now.getTime() + (totalRounds + 1) * 86_400_000));
  actions += 1;
  metrics.rewards = season.rewards.length;
  versusInvariant(season, `trial=${trial},finished`);
  invariants += 1;
  invariant(season.rewards.length === season.clubs.length, `rewards=${season.rewards.length}`, `trial=${trial}`);
  for (let index = 0; index < profiles.length; index += 1) {
    const beforeMoney = profiles[index].money;
    const synced = syncVersusProfileWithSeason(profiles[index], season, new Date(now.getTime() + (totalRounds + 2) * 86_400_000));
    const historyLength = synced.versus!.history.length;
    const syncedAgain = syncVersusProfileWithSeason(synced, season, new Date(now.getTime() + (totalRounds + 3) * 86_400_000));
    invariant(synced.money === beforeMoney && syncedAgain.money === beforeMoney, 'Versus reward leaked into Player money', `trial=${trial},profile=${index}`);
    invariant(syncedAgain.versus!.history.length === historyLength, 'duplicate Versus reward history entry', `trial=${trial},profile=${index}`);
    invariant(JSON.stringify({ club: synced.club, league: synced.league, clubState: synced.clubState, coachClubState: synced.coachClubState, coach: synced.coach }) === playerCoachSnapshots[index], 'Versus sync mutated Player/Coach state', `trial=${trial},profile=${index}`);
    invariant((syncedAgain.versus!.ledger?.length ?? 0) >= totalRounds * 2 + 2, 'Versus reward ledger incomplete', `trial=${trial},profile=${index}`);
    invariant(new Set(syncedAgain.versus!.ledger!.map((entry) => entry.id)).size === syncedAgain.versus!.ledger!.length, 'Versus reward ledger contains duplicate IDs', `trial=${trial},profile=${index}`);
    profiles[index] = syncedAgain;
    actions += 2;
    metrics.ledgerChecks += 1;
    invariants += 5;
  }
  const standings = getVersusStandings(season);
  const signature = JSON.stringify({ rounds: totalRounds, battles: season.battles.length, published: season.battles.filter((battle) => battle.state === 'PUBLISHED').length, standings: standings.map((standing) => [standing.rank, standing.points, standing.goalsFor, standing.goalsAgainst]), rewards: season.rewards.map((reward) => [reward.rank, reward.money, reward.coin]) });
  return { season, profiles, metrics, actions, invariants, signature };
}

function emptyReport(mode: ModeName): ModeReport {
  return { mode, trials: TRIALS, successfulTrials: 0, failedTrials: 0, actions: 0, invariantChecks: 0, invariantFailures: 0, errors: {}, metrics: {}, sampleFailures: [], determinismChecks: 0, determinismFailures: 0 };
}

function runMode(mode: ModeName, runner: (trial: number) => ModeResult, determinismRunner?: (trial: number) => string): ModeReport {
  const report = emptyReport(mode);
  for (let trial = 0; trial < TRIALS; trial += 1) {
    try {
      const result = runner(trial);
      report.successfulTrials += 1;
      report.actions += result.actions;
      report.invariantChecks += result.invariants;
      report.invariantFailures += result.errors.filter((error) => error.startsWith('INVARIANT:')).length;
      mergeMetrics(report, result.metrics);
    } catch (error) {
      report.failedTrials += 1;
      addError(report, trial, error);
    }
    if (determinismRunner && trial < Math.min(25, TRIALS)) {
      report.determinismChecks += 1;
      try {
        const first = determinismRunner(trial * 2_000 + 1);
        const second = determinismRunner(trial * 2_000 + 1);
        if (first !== second) {
          report.determinismFailures += 1;
          addError(report, trial, new Error('DETERMINISM: same seed produced different signature'));
        }
      } catch (error) {
        report.determinismFailures += 1;
        addError(report, trial, error);
      }
    }
  }
  return report;
}

const playerReport = runMode('PLAYER', runPlayerTrial, (trial) => runPlayerTrial(trial).signature);
const coachReport = runMode('COACH', runCoachTrial, (trial) => runCoachTrial(trial).signature);
const versusReport = runMode('VERSUS', (trial) => {
  const result = runVersusSeason(trial, 500_000 + trial);
  return { actions: result.actions, metrics: result.metrics, invariants: result.invariants, errors: [], signature: result.signature };
}, (trial) => runVersusSeason(trial, 600_000 + trial).signature);

const report: FullReport = {
  generatedAt: new Date().toISOString(),
  config: { trials: TRIALS, playerWeeks: PLAYER_WEEKS, coachSeasons: COACH_SEASONS, versusCapacity: VERSUS_CAPACITY },
  modes: [playerReport, coachReport, versusReport],
  totalActions: playerReport.actions + coachReport.actions + versusReport.actions,
  totalInvariantFailures: playerReport.invariantFailures + coachReport.invariantFailures + versusReport.invariantFailures,
  status: [playerReport, coachReport, versusReport].every((mode) => mode.failedTrials === 0 && mode.invariantFailures === 0 && mode.determinismFailures === 0) ? 'PASS' : 'FAIL'
};

// Default to this checkout's docs folder instead of a machine-specific absolute path.
const jsonPath = process.env.SIM_JSON ?? fileURLToPath(new URL('../docs/STRESS_SIMULATION_RESULTS_LATEST.json', import.meta.url));
const mdPath = process.env.SIM_MD ?? fileURLToPath(new URL('../docs/STRESS_SIMULATION_REPORT_LATEST.md', import.meta.url));
writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
const lines = [
  '# DISCORDFC Stress Simulation Report',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `Result: **${report.status}**`,
  '',
  `The harness executed **${report.config.trials} trials per mode**, with ${report.config.playerWeeks} Player weeks per trial, ${report.config.coachSeasons} Coach seasons per trial, and Versus capacity ${report.config.versusCapacity}. Total domain actions: **${report.totalActions}**.`,
  '',
  '| Mode | Trials | Successful | Failed | Actions | Invariant checks | Invariant failures | Determinism checks | Determinism failures |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...report.modes.map((mode) => `| ${mode.mode} | ${mode.trials} | ${mode.successfulTrials} | ${mode.failedTrials} | ${mode.actions} | ${mode.invariantChecks} | ${mode.invariantFailures} | ${mode.determinismChecks} | ${mode.determinismFailures} |`),
  '',
  '## Aggregated metrics',
  '',
  ...report.modes.map((mode) => `### ${mode.mode}\n\n${Object.entries(mode.metrics).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `- **${key}:** ${value}`).join('\n') || 'No metrics recorded.'}\n`),
  '## Failure samples',
  '',
  ...report.modes.map((mode) => `### ${mode.mode}\n\n${mode.sampleFailures.length ? mode.sampleFailures.map((failure) => `- Trial ${failure.trial}: \`${failure.error}\``).join('\n') : 'No failure samples recorded.'}\n`),
  '## Interpretation',
  '',
  'The simulation checks domain invariants and deterministic replay of the current reconstructed ruleset. It does not prove 1:1 parity with the official Football Rising Star server because authoritative server formulas and live backend protocol are unavailable. Coefficients remain `RECOVERY_INFERRED` unless directly supported by recovery evidence.',
  '',
  'Raw machine-readable results are stored in `stress-simulation-results.json`.'
];
writeFileSync(mdPath, lines.join('\n') + '\n');
console.log(JSON.stringify({ status: report.status, totalActions: report.totalActions, totalInvariantFailures: report.totalInvariantFailures, modes: report.modes.map(({ mode, successfulTrials, failedTrials, invariantFailures, determinismFailures }) => ({ mode, successfulTrials, failedTrials, invariantFailures, determinismFailures })), jsonPath, mdPath }, null, 2));
