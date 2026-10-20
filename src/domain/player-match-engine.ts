import { GAME_BALANCE } from '../config/game-balance.js';
import { ensureClubState, finishSeason, isClubSeasonComplete, playClubMatch, syncUserClubPlayer, userClubPlayerId } from './club-engine.js';
import { advanceContractSeason } from './contract-engine.js';
import { getRating, SeededRandom, type RandomSource } from './engine.js';
import { formatMoney } from './format.js';
import { clubStrengthByName, leagueLabel, leagueTier, officialClubByName, resolveClubLeagueId, stableHash } from './league-engine.js';
import { buildMatchRatings, buildMatchTimeline } from './match-timeline.js';
import { RECOVERY_PLAYERS_BY_CLUB, recoveryPositionGroup, type RecoveryClubRecord } from '../config/recovery-data.js';
import { generateTransferOffers } from './official-club-engine.js';
import { personalMatchRewards, PLAYER_FORMULA_VERSION, simulatePersonalPerformance } from './player-formulas.js';
import { applyAgeDecline } from './skill-engine.js';
import {
  TRICK_CATALOG,
  type HonorRecord,
  type MatchAbsenceReason,
  type MatchRecord,
  type PersonalMatchPerformance,
  type PlayerProfile,
  type PlayerSeasonStats,
  type SeasonSummary,
  type WorldFootballerState
} from './types.js';

/**
 * Player Mode fixtures: the weekly match is the club's next league fixture, so
 * the League Table, season length, and career statistics share one source of
 * truth. Personal output (goals, assists, rating, cards) is derived from the
 * athlete's skills; the team score comes from the squad simulation.
 */

export function freshSeasonStats(season: number): PlayerSeasonStats {
  return { season, appearances: 0, goals: 0, assists: 0, ratingSum: 0, mvps: 0, yellowCards: 0, redCards: 0, cleanSheets: 0, championsGoals: 0 };
}

export function ensureSeasonTracking(profile: PlayerProfile): void {
  if (!profile.seasonStats || profile.seasonStats.season !== profile.league.season) profile.seasonStats = freshSeasonStats(profile.league.season);
  if (!profile.discipline) profile.discipline = { season: profile.league.season, yellowCards: 0, suspendedMatches: 0 };
  if (profile.discipline.season !== profile.league.season) profile.discipline = { season: profile.league.season, yellowCards: 0, suspendedMatches: profile.discipline.suspendedMatches };
}

export function trickBonus(profile: PlayerProfile): number {
  return (profile.unlockedTricks ?? []).reduce((sum, id) => sum + (TRICK_CATALOG[id]?.matchModifier ?? 0), 0);
}

export function playerAbsence(profile: PlayerProfile): MatchAbsenceReason | undefined {
  if ((profile.injury?.weeksRemaining ?? 0) > 0) return 'INJURED';
  if ((profile.discipline?.suspendedMatches ?? 0) > 0) return 'SUSPENDED';
  if (profile.energy < GAME_BALANCE.match.energyCost || profile.hp < GAME_BALANCE.match.hpCost) return 'CONDITION';
  return undefined;
}

const ABSENCE_LABELS: Record<MatchAbsenceReason, string> = {
  INJURED: 'cedera',
  SUSPENDED: 'menjalani skors',
  CONDITION: 'kondisi fisik belum cukup'
};

function absentPerformance(absence: MatchAbsenceReason): PersonalMatchPerformance {
  return { played: false, absence, goals: 0, assists: 0, rating: 0, yellowCard: false, redCard: false, mvp: false, cleanSheet: false };
}

export interface PlayerFixtureResult {
  profile: PlayerProfile;
  record: MatchRecord;
  narrative: string[];
  seasonComplete: boolean;
}

/** RECOVERY_INFERRED crowd: the original shows an audience count; scale by the home club's tier and prestige. */
function attendanceFor(home: RecoveryClubRecord | undefined, seed: string): number {
  const tier = leagueTier(home?.league) ?? 1;
  const base = tier === 1 ? 36_000 : tier === 2 ? 14_000 : 5_000;
  const rng = new SeededRandom(stableHash(`${seed}:crowd`));
  return Math.round((base * (0.6 + (home?.prestige ?? 0.8) * 0.5) * (0.85 + rng.next() * 0.3)) / 10) * 10;
}

export function playPlayerFixture(profileInput: PlayerProfile, now: Date, rng: RandomSource): PlayerFixtureResult {
  let profile = ensureClubState(profileInput, now, rng);
  ensureSeasonTracking(profile);
  const absence = playerAbsence(profile);
  syncUserClubPlayer(profile);
  const userId = userClubPlayerId(profile);
  const match = playClubMatch(profile, now, rng, 'clubState', { excludePlayerIds: absence ? [userId] : [] });
  profile = match.profile;
  ensureSeasonTracking(profile);
  const club = profile.clubState!;
  const leagueId = resolveClubLeagueId(club);
  const teamGoals = match.clubIsHome ? match.homeGoals : match.awayGoals;
  const opponentGoals = match.clubIsHome ? match.awayGoals : match.homeGoals;
  const played = match.squadIds.includes(userId);
  const squad = club.roster.filter((player) => match.squadIds.includes(player.id));
  const squadAverage = squad.reduce((sum, player) => sum + player.overall, 0) / Math.max(1, squad.length);
  const opponentStrength = clubStrengthByName(match.opponentName, leagueId);
  const playerRating = getRating(profile);
  const performance = played
    ? simulatePersonalPerformance({ position: profile.position, skills: profile.detailedSkills!, playerRating, squadAverage, opponentStrength, teamGoals, opponentGoals, outcome: match.outcome, trickBonus: trickBonus(profile) }, rng)
    : absentPerformance(absence ?? 'CONDITION');
  const rewards = personalMatchRewards(match.outcome, performance);
  const narrative: string[] = [`${match.fixture.homeClub} ${match.homeGoals}-${match.awayGoals} ${match.fixture.awayClub} · matchday ${match.fixture.matchday}.`];
  const season = profile.seasonStats!;
  const discipline = profile.discipline!;
  if (played) {
    profile.energy = Math.max(0, profile.energy - GAME_BALANCE.match.energyCost);
    profile.hp = Math.max(0, profile.hp - GAME_BALANCE.match.hpCost);
    profile.career.appearances += 1;
    profile.career.goals += performance.goals;
    profile.career.assists += performance.assists;
    profile.career.cleanSheets += performance.cleanSheet ? 1 : 0;
    profile.career.yellowCards += performance.yellowCard ? 1 : 0;
    profile.career.redCards = (profile.career.redCards ?? 0) + (performance.redCard ? 1 : 0);
    profile.career.mvps = (profile.career.mvps ?? 0) + (performance.mvp ? 1 : 0);
    profile.career.seasonScore = Number((profile.career.seasonScore + performance.rating).toFixed(2));
    if (match.outcome === 'WIN') profile.career.wins += 1;
    else if (match.outcome === 'DRAW') profile.career.draws += 1;
    else profile.career.losses += 1;
    season.appearances += 1;
    season.goals += performance.goals;
    season.assists += performance.assists;
    season.ratingSum = Number((season.ratingSum + performance.rating).toFixed(1));
    season.mvps += performance.mvp ? 1 : 0;
    season.yellowCards += performance.yellowCard ? 1 : 0;
    season.redCards += performance.redCard ? 1 : 0;
    season.cleanSheets += performance.cleanSheet ? 1 : 0;
    if (performance.yellowCard) discipline.yellowCards += 1;
    narrative.push(`Rating ${performance.rating.toFixed(1)} · ${performance.goals} gol · ${performance.assists} assist${performance.mvp ? ' · **MVP**' : ''}.`);
    // RECOVERY_INFERRED fan growth: goals, MVP awards, and wins draw supporters.
    profile.fans = (profile.fans ?? 0) + performance.goals * 5 + (performance.mvp ? 25 : 0) + (match.outcome === 'WIN' ? 3 : 0);
    if (performance.redCard) {
      discipline.suspendedMatches += 1;
      narrative.push('Kartu merah langsung: skors 1 pertandingan berikutnya.');
    } else if (performance.yellowCard && discipline.yellowCards % GAME_BALANCE.personal.yellowSuspensionThreshold === 0) {
      discipline.suspendedMatches += 1;
      narrative.push(`Akumulasi ${discipline.yellowCards} kartu kuning musim ini: skors 1 pertandingan.`);
    } else if (performance.yellowCard) {
      narrative.push(`Kartu kuning (${discipline.yellowCards} musim ini).`);
    }
  } else {
    if (absence === 'SUSPENDED') discipline.suspendedMatches = Math.max(0, discipline.suspendedMatches - 1);
    narrative.push(`${profile.displayName} tidak bermain karena ${ABSENCE_LABELS[absence ?? 'CONDITION']}; klub tetap memainkan fixture.`);
  }
  if (rewards.money > 0) {
    profile.money += rewards.money;
    profile.ledger ??= [];
    profile.ledger.unshift({ id: `${profile.userId}-MATCH-${now.getTime()}-${profile.ledger.length}`, createdAt: now.toISOString(), type: 'MATCH_REWARD', amount: rewards.money, balanceAfter: profile.money, note: `Bonus match vs ${match.opponentName}` });
    profile.ledger = profile.ledger.slice(0, 100);
  }
  profile.totalExp += rewards.exp;
  profile.unassignedMatchExp = (profile.unassignedMatchExp ?? 0) + rewards.exp;
  const halftime = { team: match.clubIsHome ? match.halftime.homeGoals : match.halftime.awayGoals, opponent: match.clubIsHome ? match.halftime.awayGoals : match.halftime.homeGoals };
  const opponentOfficial = officialClubByName(match.opponentName, leagueId);
  // The opponent fields the first 18 official players (club-engine buildOpponentRoster).
  const opponentAttackers = opponentOfficial ? (RECOVERY_PLAYERS_BY_CLUB.get(opponentOfficial.id) ?? []).slice(0, 18).filter((record) => ['FW', 'MF'].includes(recoveryPositionGroup(record.positionCode))).map((record) => record.nameEn) : [];
  const matchId = `${profile.userId}-${now.getTime()}`;
  const ownShots = match.clubIsHome ? match.stats.homeShots : match.stats.awayShots;
  const opponentShots = match.clubIsHome ? match.stats.awayShots : match.stats.homeShots;
  const opponentShotsOnTarget = match.clubIsHome ? match.stats.awayShotsOnTarget : match.stats.homeShotsOnTarget;
  const teammates = squad.filter((player) => player.id !== userId && !player.isUserPlayer).map((player) => ({ name: player.name, position: player.position }));
  const timeline = buildMatchTimeline({
    seed: `${matchId}:${match.fixture.matchday}`,
    teamName: club.name,
    opponentName: match.opponentName,
    teamGoals,
    opponentGoals,
    halftime,
    userName: profile.displayName,
    position: profile.position,
    personal: performance,
    teammates,
    opponents: opponentAttackers,
    shots: ownShots,
    opponentShots,
    opponentShotsOnTarget
  });
  const ratings = buildMatchRatings({ seed: matchId, squad: teammates.slice(0, 10), userName: profile.displayName, position: profile.position, personal: performance, timeline, outcome: match.outcome, opponentGoals });
  const mvpName = performance.played && performance.mvp ? profile.displayName : ratings.find((item) => !item.user)?.name;
  const record: MatchRecord = {
    id: matchId,
    createdAt: now.toISOString(),
    opponent: match.opponentName,
    opponentRating: opponentStrength,
    playerRating,
    outcome: match.outcome,
    playerGoals: teamGoals,
    opponentGoals,
    playerScore: performance.rating,
    rewards,
    stats: {
      possession: match.clubIsHome ? match.stats.homePossession : match.stats.awayPossession,
      opponentPossession: match.clubIsHome ? match.stats.awayPossession : match.stats.homePossession,
      shots: match.clubIsHome ? match.stats.homeShots : match.stats.awayShots,
      opponentShots: match.clubIsHome ? match.stats.awayShots : match.stats.homeShots,
      shotsOnTarget: match.clubIsHome ? match.stats.homeShotsOnTarget : match.stats.awayShotsOnTarget,
      opponentShotsOnTarget: match.clubIsHome ? match.stats.awayShotsOnTarget : match.stats.homeShotsOnTarget,
      corners: match.clubIsHome ? match.stats.homeCorners : match.stats.awayCorners,
      opponentCorners: match.clubIsHome ? match.stats.awayCorners : match.stats.homeCorners
    },
    week: profile.careerWeek ?? match.fixture.matchday,
    formulaVersion: PLAYER_FORMULA_VERSION,
    personal: performance,
    competition: 'LEAGUE',
    matchday: match.fixture.matchday,
    home: match.clubIsHome,
    teamName: club.name,
    halftime,
    timeline,
    ratings,
    mvpName,
    attendance: attendanceFor(officialClubByName(match.fixture.homeClub, leagueId), matchId)
  };
  profile.lastMatch = record;
  profile.updatedAt = now.toISOString();
  return { profile, record, narrative, seasonComplete: isClubSeasonComplete(profile.clubState) };
}

function honor(profile: PlayerProfile, season: number, id: string, category: HonorRecord['category'], title: string, description: string, value: number, now: Date, source: HonorRecord['source'] = 'RECOVERY_INFERRED'): string | undefined {
  profile.honors ??= [];
  if (profile.honors.some((item) => item.id === id)) return undefined;
  profile.honors.push({ id, category, title, season, description, source, value, awardedAt: now.toISOString() });
  return title;
}

/**
 * Annual player-of-the-year vote based on the finished season only. Rival
 * scores are drawn per season, so winning needs an elite campaign.
 */
function resolveWorldFootballer(profile: PlayerProfile, stats: PlayerSeasonStats, fixtures: number, rank: number, tier: number, rng: RandomSource, now: Date, season: number): WorldFootballerState {
  const config = GAME_BALANCE.worldFootballer;
  const scale = 38 / Math.max(1, fixtures);
  const averageRating = stats.appearances ? stats.ratingSum / stats.appearances : 0;
  const defensive = profile.position === 'GK' || profile.position === 'DF' ? stats.cleanSheets * config.cleanSheetWeight * scale : 0;
  const teamBonus = tier === 1 ? (rank === 1 ? 8 : rank <= 4 ? 4 : 0) : rank === 1 ? 3 : 0;
  const continental = profile.championsLeague?.season === season ? (profile.championsLeague.status === 'CHAMPION' ? 10 : (profile.championsLeague.history?.length ?? 0) >= 3 ? 4 : 0) : 0;
  const eligible = stats.appearances >= fixtures * config.minAppearanceShare;
  const userScore = Math.round(averageRating * 10 + (stats.goals + stats.assists * 0.6) * scale + defensive + stats.mvps * 1.2 + teamBonus + continental);
  const candidates = ['Lewandowski', 'De Bruyne', 'Haaland'].map((name) => ({ name, score: Math.round(config.candidateBase + rng.next() * config.candidateSpread) }));
  const best = candidates.reduce((top, candidate) => candidate.score > top.score ? candidate : top, candidates[0]);
  const userWon = eligible && userScore > best.score;
  const award: WorldFootballerState = { season, winner: userWon ? profile.displayName : best.name, userScore, userWon, resolved: true, candidates: [...candidates, { name: profile.displayName, score: userScore }] };
  profile.worldFootballer = award;
  if (userWon) honor(profile, season, `world-footballer-${season}`, 'PERSONAL', 'World Footballer', 'Annual player-of-the-year vote based on season performance.', userScore, now, 'WALKTHROUGH_OBSERVED');
  return award;
}

export interface PlayerSeasonEnd {
  profile: PlayerProfile;
  narrative: string[];
  award: WorldFootballerState;
  summary: SeasonSummary;
}

export function finishPlayerSeason(profileInput: PlayerProfile, now: Date, rng: RandomSource): PlayerSeasonEnd {
  let profile = ensureClubState(profileInput, now, rng);
  ensureSeasonTracking(profile);
  const completedSeason = profile.league.season;
  const stats = structuredClone(profile.seasonStats!);
  const club = profile.clubState!;
  const fixtures = Math.max(1, club.fixtures.length);
  const leagueId = resolveClubLeagueId(club);
  const clubName = club.name;
  profile = finishSeason(profile, now, 'clubState', rng);
  const result = profile.clubState!.lastSeasonResult!;
  const tier = leagueTier(leagueId) ?? 1;
  const narrative: string[] = [`Season ${completedSeason} selesai: ${clubName} finis #${result.rank} di ${leagueLabel(leagueId)} dengan ${result.points} poin.`];
  const earned: string[] = [];
  if (result.rank === 1) {
    const title = honor(profile, completedSeason, `league-champion-${completedSeason}-${clubName}`, 'TEAM', `League Champion · ${leagueLabel(leagueId)}`, `${clubName} juara liga season ${completedSeason}.`, result.points, now);
    if (title) earned.push(title);
  }
  if (result.movement === 'PROMOTED') {
    narrative.push(`${clubName} promosi ke ${leagueLabel(result.nextLeagueId)}.`);
    const title = honor(profile, completedSeason, `promotion-${completedSeason}-${clubName}`, 'TEAM', `Promotion · ${leagueLabel(result.nextLeagueId)}`, `${clubName} naik kasta.`, result.rank, now);
    if (title) earned.push(title);
  } else if (result.movement === 'RELEGATED') {
    narrative.push(`${clubName} terdegradasi ke ${leagueLabel(result.nextLeagueId)}.`);
  }
  if (result.championsQualified) narrative.push('Klub lolos ke Champions League season berikutnya.');
  const award = resolveWorldFootballer(profile, stats, fixtures, result.rank, tier, rng, now, completedSeason);
  narrative.push(`World Footballer season ${completedSeason}: ${award.winner}${award.userWon ? ' — Anda menang!' : ` (skor Anda ${award.userScore}).`}`);
  if (award.userWon) earned.push('World Footballer');
  const averageRating = stats.appearances ? stats.ratingSum / stats.appearances : 0;
  const goldenBootLine = Math.round((tier === 1 ? 21 : tier === 2 ? 19 : 17) + rng.next() * 7);
  if (stats.goals >= goldenBootLine) {
    const title = honor(profile, completedSeason, `golden-boot-${completedSeason}`, 'PERSONAL', `Golden Boot · ${leagueLabel(leagueId)}`, `${stats.goals} gol liga (top skor pesaing ${goldenBootLine}).`, stats.goals, now);
    if (title) earned.push(title);
  }
  if (profile.age <= 21 && averageRating >= 7.2 && stats.appearances >= fixtures / 2) {
    const title = honor(profile, completedSeason, `young-player-${completedSeason}`, 'PERSONAL', 'Young Player of the Season', `Rata-rata rating ${averageRating.toFixed(2)} di usia ${profile.age}.`, Math.round(averageRating * 10), now);
    if (title) earned.push(title);
  }
  const summary: SeasonSummary = {
    season: completedSeason,
    careerYear: Math.max(1, profile.careerYear ?? 1),
    age: profile.age,
    club: clubName,
    leagueId,
    leagueLabel: leagueLabel(leagueId),
    rank: result.rank,
    points: result.points,
    played: fixtures,
    averageRating: Number(averageRating.toFixed(2)),
    stats,
    honors: earned,
    movement: result.movement
  };
  profile.seasonHistory = [...(profile.seasonHistory ?? []), summary].slice(-40);
  profile.careerYear = Math.max(1, profile.careerYear ?? 1) + 1;
  profile.age += 1;
  profile.career.seasonScore = 0;
  profile.seasonWeek = 1;
  const decline = applyAgeDecline(profile);
  if (decline) narrative.push(decline);
  const contractMessage = advanceContractSeason(profile);
  if (contractMessage) narrative.push(contractMessage);
  const offers = generateTransferOffers(profile, rng, averageRating, stats.appearances / fixtures);
  profile.transferOffers = [...(profile.transferOffers ?? []).map((offer) => offer.status === 'OPEN' ? { ...offer, status: 'EXPIRED' as const } : offer), ...offers].slice(-12);
  if (offers.length) narrative.push(`${offers.length} klub mengajukan tawaran transfer: ${offers.map((offer) => `${offer.clubName} (${formatMoney(offer.weeklySalary)}/minggu)`).join(', ')}.`);
  profile.seasonStats = freshSeasonStats(profile.league.season);
  profile.discipline = { season: profile.league.season, yellowCards: 0, suspendedMatches: profile.discipline?.suspendedMatches ?? 0 };
  profile.updatedAt = now.toISOString();
  return { profile, narrative, award, summary };
}
