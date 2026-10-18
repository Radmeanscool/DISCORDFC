import { GAME_BALANCE } from '../config/game-balance.js';
import { RECOVERY_CLUBS, type RecoveryClubRecord } from '../config/recovery-data.js';
import { ensureClubState, getClubRating, syncUserClubPlayer } from './club-engine.js';
import { getRating, MathRandomSource, type RandomSource } from './engine.js';
import { expectedGoals, isDomesticLeague, leagueTier, officialClubStrength, poissonGoals } from './league-engine.js';
import { personalMatchRewards, simulatePersonalPerformance } from './player-formulas.js';
import { ensureSeasonTracking, playerAbsence, trickBonus } from './player-match-engine.js';
import type { AchievementState, ChampionsLeagueState, CareerMode, MatchOutcome, PlayerProfile } from './types.js';

/**
 * Continental cup reconstructed from the client club table: domestic tier-1
 * clubs plus the 1061–1091/9001 pools. Four knockout rounds, single match,
 * penalties on a draw. Draw bands and rewards are RECOVERY_INFERRED.
 */
const ROUND_NAMES = ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
const ROUND_BANDS: Array<[number, number]> = [[0.35, 0.75], [0.2, 0.5], [0.08, 0.3], [0, 0.12]];
const CHAMPIONS_ROUNDS = ROUND_NAMES.length;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type ChampionsLeagueMode = Extract<CareerMode, 'PLAYER' | 'COACH'>;

function competitionState(profile: PlayerProfile, mode: ChampionsLeagueMode): ChampionsLeagueState | undefined {
  return mode === 'COACH' ? profile.coach?.championsLeague : profile.championsLeague;
}

function setCompetitionState(profile: PlayerProfile, mode: ChampionsLeagueMode, state: ChampionsLeagueState): void {
  if (mode === 'COACH') {
    if (!profile.coach) throw new Error('Karier Coach belum dibuat.');
    profile.coach.championsLeague = state;
  } else {
    profile.championsLeague = state;
  }
}

function competitionSeason(profile: PlayerProfile, mode: ChampionsLeagueMode): number {
  if (mode === 'COACH') {
    if (!profile.coach) throw new Error('Karier Coach belum dibuat. Pilih Coach Mode dari Game Home terlebih dahulu.');
    return profile.coach.season;
  }
  return profile.league.season;
}

function competitionClub(profile: PlayerProfile, mode: ChampionsLeagueMode) {
  const club = mode === 'COACH' ? profile.coachClubState : profile.clubState;
  if (!club) throw new Error('State klub belum dibuat.');
  return club;
}

function continentalPool(excludeName: string): RecoveryClubRecord[] {
  return RECOVERY_CLUBS
    .filter((club) => club.nameEn !== excludeName && (leagueTier(club.league) === 1 || !isDomesticLeague(club.league)))
    .sort((a, b) => officialClubStrength(b) - officialClubStrength(a) || a.id - b.id);
}

function drawOpponent(excludeName: string, round: number, rng: RandomSource, avoid: string[] = []): RecoveryClubRecord | undefined {
  const pool = continentalPool(excludeName).filter((club) => !avoid.includes(club.nameEn));
  if (!pool.length) return undefined;
  const [from, to] = ROUND_BANDS[clamp(round, 1, CHAMPIONS_ROUNDS) - 1];
  const start = Math.floor(pool.length * from);
  const end = Math.max(start + 1, Math.floor(pool.length * to));
  const band = pool.slice(start, end);
  return band[Math.floor(rng.next() * band.length)] ?? pool[0];
}

export function championsRoundName(round: number): string {
  return ROUND_NAMES[clamp(round, 1, CHAMPIONS_ROUNDS) - 1];
}

/** League matchdays that must be played before a round opens (round 1 after matchday 8, …). */
export function championsRoundAvailableAfter(profile: PlayerProfile, mode: ChampionsLeagueMode, round: number): number {
  const club = competitionClub(profile, mode);
  return Math.min(club.fixtures.length, round * GAME_BALANCE.league.championsMatchdayGap);
}

export function startChampionsLeague(profileInput: PlayerProfile, now = new Date(), mode: ChampionsLeagueMode = 'PLAYER', rng: RandomSource = new MathRandomSource()): PlayerProfile {
  const profile = ensureClubState(profileInput, now, rng, mode === 'COACH' ? 'coachClubState' : 'clubState');
  if (mode === 'COACH' && profile.coach?.status !== 'EMPLOYED') throw new Error('Coach harus employed untuk mengikuti Champions League.');
  const club = competitionClub(profile, mode);
  if (!club.championsLeagueQualified) throw new Error('Klub belum lolos Champions League. Finis di zona Champions pada liga kasta teratas terlebih dahulu.');
  const season = competitionSeason(profile, mode);
  const current = competitionState(profile, mode);
  if (current?.season === season) {
    if (current.status === 'ACTIVE') return profile;
    throw new Error('Champions League season ini sudah selesai. Tunggu season berikutnya untuk mencoba lagi.');
  }
  const opponent = drawOpponent(club.name, 1, rng);
  setCompetitionState(profile, mode, {
    season,
    round: 1,
    opponent: opponent?.nameEn ?? 'Continental Club 1',
    opponentId: opponent?.id,
    homeGoals: 0,
    awayGoals: 0,
    aggregate: 0,
    status: 'ACTIVE',
    history: []
  });
  profile.updatedAt = now.toISOString();
  return profile;
}

function result(forGoals: number, againstGoals: number): MatchOutcome {
  if (forGoals > againstGoals) return 'WIN';
  if (forGoals < againstGoals) return 'LOSS';
  return 'DRAW';
}

export function playChampionsLeague(profileInput: PlayerProfile, now = new Date(), rng: RandomSource = new MathRandomSource(), mode: ChampionsLeagueMode = 'PLAYER'): { profile: PlayerProfile; homeGoals: number; awayGoals: number; status: ChampionsLeagueState['status']; commentary: string[] } {
  const profile = startChampionsLeague(profileInput, now, mode, rng);
  const club = competitionClub(profile, mode);
  const state = competitionState(profile, mode)!;
  const playedFixtures = club.fixtures.filter((fixture) => fixture.played).length;
  const required = championsRoundAvailableAfter(profile, mode, state.round);
  if (playedFixtures < required) throw new Error(`${championsRoundName(state.round)} dibuka setelah matchday liga ${required} (sekarang ${playedFixtures}).`);
  if (mode === 'PLAYER') {
    if (profile.careerStatus === 'RETIRED') throw new Error('Karier ini sudah pensiun.');
    if ((profile.weekStage ?? 'READY') !== 'READY') throw new Error('Selesaikan weekly cycle (event, match, atau alokasi EXP) sebelum laga Champions League.');
    ensureSeasonTracking(profile);
    syncUserClubPlayer(profile);
  }
  const coachBonus = mode === 'COACH' ? 1 + Math.min(0.06, Math.max(0, (profile.coach?.abilities.tactics.level ?? 1) - 1) * 0.002) : 1;
  const clubRating = getClubRating(profile, mode === 'COACH' ? 'coachClubState' : 'clubState') * coachBonus;
  const opponentRecord = RECOVERY_CLUBS.find((item) => item.id === state.opponentId) ?? RECOVERY_CLUBS.find((item) => item.nameEn === state.opponent);
  const opponentRating = opponentRecord ? officialClubStrength(opponentRecord) : 60 + state.round * 4;
  const homeGoals = poissonGoals(expectedGoals(clubRating * 1.02, opponentRating), rng);
  const awayGoals = poissonGoals(expectedGoals(opponentRating, clubRating), rng);
  let outcome = result(homeGoals, awayGoals);
  let penalties: { for: number; against: number } | undefined;
  if (outcome === 'DRAW') {
    const penaltySkill = mode === 'PLAYER' ? ((profile.detailedSkills?.penalty.level ?? 50) - 50) / 400 : 0;
    const winChance = clamp(0.5 + (clubRating - opponentRating) / 80 + penaltySkill, 0.2, 0.8);
    const winnerScore = 3 + Math.floor(rng.next() * 3);
    const loserScore = Math.max(1, winnerScore - 1 - Math.floor(rng.next() * 2));
    const won = rng.next() < winChance;
    penalties = won ? { for: winnerScore, against: loserScore } : { for: loserScore, against: winnerScore };
    outcome = won ? 'WIN' : 'LOSS';
  }
  const playedRound = state.round;
  let personalLine = '';
  if (mode === 'PLAYER' && !playerAbsence(profile)) {
    const performance = simulatePersonalPerformance({ position: profile.position, skills: profile.detailedSkills!, playerRating: getRating(profile), squadAverage: clubRating, opponentStrength: opponentRating, teamGoals: homeGoals, opponentGoals: awayGoals, outcome: result(homeGoals, awayGoals), trickBonus: trickBonus(profile) }, rng);
    const rewards = personalMatchRewards(outcome, performance);
    profile.energy = Math.max(0, profile.energy - GAME_BALANCE.match.energyCost);
    profile.hp = Math.max(0, profile.hp - GAME_BALANCE.match.hpCost);
    profile.career.appearances += 1;
    profile.career.goals += performance.goals;
    profile.career.assists += performance.assists;
    profile.career.championsGoals = (profile.career.championsGoals ?? 0) + performance.goals;
    profile.seasonStats!.championsGoals += performance.goals;
    profile.money += rewards.money;
    profile.totalExp += rewards.exp;
    profile.unassignedMatchExp = (profile.unassignedMatchExp ?? 0) + rewards.exp;
    if (rewards.exp > 0) profile.weekStage = 'EXP_PENDING';
    personalLine = ` · rating ${performance.rating.toFixed(1)}, ${performance.goals} gol, ${performance.assists} assist`;
  }
  state.homeGoals += homeGoals;
  state.awayGoals += awayGoals;
  state.aggregate = state.homeGoals - state.awayGoals;
  state.history = [...(state.history ?? []), { round: playedRound, opponent: state.opponent, goalsFor: homeGoals, goalsAgainst: awayGoals, penalties, won: outcome === 'WIN' }];
  let status: ChampionsLeagueState['status'] = state.status;
  if (outcome === 'LOSS') {
    status = 'ELIMINATED';
  } else if (state.round >= CHAMPIONS_ROUNDS) {
    status = 'CHAMPION';
    club.assets += 5_000;
    club.prestige = clamp(club.prestige + 25, 0, 1_000);
    const honor = { id: `champions-${mode.toLowerCase()}-${state.season}`, category: 'TEAM' as const, title: `Champions League · ${club.name}`, season: state.season, description: `${club.name} juara Champions League.`, source: 'RECOVERY_INFERRED' as const, value: CHAMPIONS_ROUNDS, awardedAt: now.toISOString() };
    if (mode === 'COACH' && profile.coach && !profile.coach.honors.some((item) => item.id === honor.id)) profile.coach.honors = [...profile.coach.honors, honor];
    if (mode === 'PLAYER' && !(profile.honors ?? []).some((item) => item.id === honor.id)) profile.honors = [...(profile.honors ?? []), honor];
  } else {
    club.assets += 1_500;
    club.prestige = clamp(club.prestige + 5, 0, 1_000);
    state.round += 1;
    const next = drawOpponent(club.name, state.round, rng, (state.history ?? []).map((item) => item.opponent));
    state.opponent = next?.nameEn ?? `Continental Club ${state.round}`;
    state.opponentId = next?.id;
  }
  state.status = status;
  profile.updatedAt = now.toISOString();
  const opponentName = state.history[state.history.length - 1]?.opponent ?? state.opponent;
  return {
    profile,
    homeGoals,
    awayGoals,
    status,
    commentary: [
      `Champions League ${championsRoundName(playedRound)}: ${club.name} vs ${opponentName}.`,
      `Skor ${homeGoals}–${awayGoals}${penalties ? ` (penalti ${penalties.for}–${penalties.against})` : ''}${personalLine}.`,
      status === 'CHAMPION' ? 'Klub menjadi juara Champions League!' : status === 'ELIMINATED' ? 'Klub tersingkir dari Champions League.' : `Klub melaju ke ${championsRoundName(state.round)} melawan ${state.opponent}.`
    ]
  };
}

const DEFAULT_ACHIEVEMENTS: AchievementState[] = [
  { id: 'appearances-10', title: 'Regular Starter', description: 'Mainkan 10 pertandingan.', target: 10, progress: 0, claimed: false, rewardMoney: 500, rewardExp: 100 },
  { id: 'goals-10', title: 'Clinical Finisher', description: 'Cetak 10 gol.', target: 10, progress: 0, claimed: false, rewardMoney: 750, rewardExp: 150 },
  { id: 'wins-10', title: 'Winning Mentality', description: 'Menangkan 10 pertandingan.', target: 10, progress: 0, claimed: false, rewardMoney: 1_000, rewardExp: 200 },
  { id: 'streak-7', title: 'Daily Commitment', description: 'Capai daily streak 7 hari.', target: 7, progress: 0, claimed: false, rewardMoney: 600, rewardExp: 120 }
];

export function syncAchievements(profileInput: PlayerProfile): PlayerProfile {
  const profile = clone(profileInput);
  const current = profile.achievements ?? clone(DEFAULT_ACHIEVEMENTS);
  for (const achievement of current) {
    if (achievement.id === 'appearances-10') achievement.progress = profile.career.appearances;
    if (achievement.id === 'goals-10') achievement.progress = profile.career.goals;
    if (achievement.id === 'wins-10') achievement.progress = profile.career.wins;
    if (achievement.id === 'streak-7') achievement.progress = profile.daily?.streak ?? 0;
  }
  profile.achievements = current;
  return profile;
}

export function claimAchievement(profileInput: PlayerProfile, achievementId: string, now = new Date()): { profile: PlayerProfile; achievement: AchievementState } {
  const profile = syncAchievements(profileInput);
  const achievement = profile.achievements!.find((item) => item.id === achievementId);
  if (!achievement) throw new Error('Achievement tidak ditemukan.');
  if (achievement.claimed) throw new Error('Achievement sudah diklaim.');
  if (achievement.progress < achievement.target) throw new Error(`Progress belum cukup: ${achievement.progress}/${achievement.target}.`);
  achievement.claimed = true;
  profile.money += achievement.rewardMoney;
  profile.totalExp += achievement.rewardExp;
  profile.level = Math.max(profile.level, Math.floor(profile.totalExp / 100) + 1);
  profile.ledger ??= [];
  profile.ledger.unshift({ id: `${profile.userId}-ACHIEVEMENT-${achievement.id}-${now.getTime()}-${profile.ledger.length}`, createdAt: now.toISOString(), type: 'ACHIEVEMENT_REWARD', amount: achievement.rewardMoney, balanceAfter: profile.money, note: `Achievement ${achievement.title}` });
  profile.ledger = profile.ledger.slice(0, 100);
  profile.updatedAt = now.toISOString();
  return { profile, achievement };
}

export function formatAchievements(profileInput: PlayerProfile): string {
  const profile = syncAchievements(profileInput);
  return profile.achievements!.map((item) => `${item.claimed ? 'CLAIMED' : item.progress >= item.target ? 'READY' : 'LOCKED'} · **${item.id}** · ${item.title} — ${item.progress}/${item.target}`).join('\n');
}
