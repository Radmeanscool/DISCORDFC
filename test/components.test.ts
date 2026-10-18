import assert from 'node:assert/strict';
import test from 'node:test';
import {
  championsControls,
  coachCareerControls,
  coachControls,
  coachExpControls,
  coachJobControls,
  coachMarketControls,
  coachStrategyControls,
  contractControls,
  CUSTOM_ID_LIMIT,
  detailedTrainingControls,
  honorsControls,
  mainMenuControls,
  officialClubControls,
  pendingExpControls,
  playerCareerControls,
  playerClubControls,
  playerCreationControls,
  playerCultureControls,
  playerInjuryControls,
  playerWeeklyControls,
  trainerControls,
  trainingControls,
  transferConfirmControls,
  transferOfferControls,
  trickControls,
  versusFinalizeControls,
  versusHomeControls,
  versusMarketControls,
  versusPositionControls,
  versusRankingControls,
  versusReleaseConfirmControls,
  versusScoutControls,
  versusSetupControls,
  versusSponsorControls,
  versusSquadControls
} from '../src/discord/components.js';
import { listOfficialClubs } from '../src/domain/official-club-engine.js';
import { createInitialProfile } from '../src/domain/engine.js';
import { abilityScore, createVersusClub, createVersusSeason, enrollVersus } from '../src/domain/versus-engine.js';
import { listingAbilityScore, minimumVersusBid } from '../src/domain/versus-economy.js';
import { TRICK_CATALOG } from '../src/domain/types.js';

type Rows = Array<{ toJSON(): { components: Array<{ custom_id?: string; disabled?: boolean; label?: string; options?: Array<{ value: string }>; min_values?: number; max_values?: number }> } }>;

function ids(rows: Rows): string[] {
  return rows.flatMap((row) => row.toJSON().components.map((component) => component.custom_id ?? ''));
}

const LONG_USER = '12345678901234567890';
const score = (player: Parameters<typeof abilityScore>[0]) => Math.round(abilityScore(player));

test('Player Weekly Hub exposes owner-bound actions including career and mode switches', () => {
  const all = ids(playerWeeklyControls('user-1', 'READY'));
  for (const action of ['daily-reward', 'injury', 'honors', 'contract', 'player-champions', 'player-career', 'menu-home', 'menu-coach', 'versus-home']) assert.ok(all.includes(`frs:user-1:${action}`), action);
  assert.equal(all.every((id) => id.startsWith('frs:user-1:')), true);
  const retired = playerWeeklyControls('user-1', 'READY', true).flatMap((row) => row.toJSON().components);
  assert.equal(retired.find((item) => item.custom_id === 'frs:user-1:next-week')?.disabled, true);
  assert.equal(retired.find((item) => item.custom_id === 'frs:user-1:player-career')?.label, 'Rebirth');
});

test('Versus lineup custom ids carry only round and roster version and stay under the Discord limit', () => {
  const profile = createVersusClub(createInitialProfile('user-4', 'Versus UI', 'MF'), new Date('2026-01-01T00:00:00.000Z'));
  const roster = profile.versus!.club.roster;
  const setup = ids(versusSetupControls(LONG_USER, 38, 9_999, '4-4-2', 'balanced'));
  assert.ok(setup.includes(`frs:${LONG_USER}:vl:fm:38:9999`));
  assert.ok(setup.includes(`frs:${LONG_USER}:vl:auto:38:9999`));
  const selected = { GK: [], DF: [], MF: [], FW: [] };
  const positions = versusPositionControls(LONG_USER, 38, 9_999, '4-4-2', roster, selected, score);
  assert.equal(positions.length, 5);
  const lineup = roster.slice(0, 11).map((player) => player.id);
  const final = versusFinalizeControls(LONG_USER, 38, 9_999, lineup, roster, score, lineup[0]);
  assert.equal(final.length, 3);
  const all = [...setup, ...ids(positions), ...ids(final), ...ids(versusHomeControls(LONG_USER, { round: 38, rosterVersion: 9_999 }))];
  assert.equal(all.every((id) => id.length <= CUSTOM_ID_LIMIT), true);
  assert.equal(all.every((id) => !id.includes('vseason')), true, 'battle ids never appear in custom ids');
});

test('position selects never require more players than are fit', () => {
  const profile = createVersusClub(createInitialProfile('user-5', 'Thin Squad', 'MF'), new Date('2026-01-01T00:00:00.000Z'));
  const onlyOneForward = profile.versus!.club.roster.filter((player) => player.position !== 'FW' || player.id.endsWith(':p14'));
  const rows = versusPositionControls('user-5', 1, 1, '4-4-2', onlyOneForward, { GK: [], DF: [], MF: [], FW: [] }, score).map((row) => row.toJSON());
  const forwardMenu = rows[3].components[0];
  assert.equal(forwardMenu.min_values, 1);
  assert.equal(forwardMenu.max_values, 1);
  const noKeeper = profile.versus!.club.roster.filter((player) => player.position !== 'GK');
  const keeperMenu = versusPositionControls('user-5', 1, 1, '4-4-2', noKeeper, { GK: [], DF: [], MF: [], FW: [] }, score)[0].toJSON().components[0] as { disabled?: boolean; options?: unknown[] };
  assert.equal(keeperMenu.disabled, true);
  assert.equal(keeperMenu.options?.length, 1);
});

test('Versus Home adapts to active, finished, and waiting states', () => {
  const active = ids(versusHomeControls('user-6', { state: 'ACTIVE', round: 3, rosterVersion: 2, dm: true }));
  for (const action of ['versus-results', 'versus-standings', 'versus-schedule', 'versus-market', 'versus-squad', 'versus-scout', 'versus-sponsor', 'versus-rankings', 'versus-rewards', 'versus-registration', 'versus-global-ranking', 'versus-dm-toggle', 'vl:start:3:2']) assert.ok(active.includes(`frs:user-6:${action}`), action);
  const finished = ids(versusHomeControls('user-6', { state: 'FINISHED' }));
  assert.ok(finished.includes('frs:user-6:versus-next-season'));
  assert.equal(finished.some((id) => id.includes(':vl:')), false);
  const waiting = ids(versusHomeControls('user-6', { state: 'WAITING' }));
  assert.ok(waiting.includes('frs:user-6:versus-leave-private'));
});

test('Versus market, squad, scout, and sponsor panels expose working actions', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const member = enrollVersus(createInitialProfile('user-7', 'Market UI', 'FW'), 'UI-GROUP-1', start);
  const season = createVersusSeason('UI-GROUP-1', [member], start);
  const market = versusMarketControls('user-7', season.market!.listings, minimumVersusBid, listingAbilityScore);
  const bidMenu = market[0].toJSON().components[0];
  assert.equal(bidMenu.custom_id, 'frs:user-7:versus-bid-select');
  assert.equal(bidMenu.options?.length, season.market!.listings.length);
  const club = season.clubs.find((item) => item.ownerId === 'user-7')!;
  const squad = ids(versusSquadControls('user-7', club.rosterVersion, [{ index: 3, player: club.roster[3], refund: 10 }]));
  assert.ok(squad.includes(`frs:user-7:versus-release-select:${club.rosterVersion}`));
  assert.ok(ids(versusReleaseConfirmControls('user-7', 4, 3)).includes('frs:user-7:versus-release-confirm:4:3'));
  const scout = versusScoutControls('user-7', 0, false, false).flatMap((row) => row.toJSON().components);
  assert.equal(scout.find((item) => item.custom_id === 'frs:user-7:versus-scout-junior')?.disabled, true, 'not enough money');
  const sponsor = versusSponsorControls('user-7', 5).flatMap((row) => row.toJSON().components);
  assert.equal(sponsor.find((item) => item.custom_id === 'frs:user-7:versus-sponsor-junior')?.disabled, false);
  assert.equal(sponsor.find((item) => item.custom_id === 'frs:user-7:versus-sponsor-top')?.disabled, true, 'Top sponsor needs Liga A');
  assert.ok(ids(versusRankingControls('user-7')).includes('frs:user-7:versus-ranking-goalkeepers'));
});

test('main menu exposes the three gameplay modes and player creation is menu-driven', () => {
  assert.deepEqual(ids(mainMenuControls('user-menu')), ['frs:user-menu:menu-player', 'frs:user-menu:menu-coach', 'frs:user-menu:menu-versus']);
  assert.deepEqual(ids(playerCreationControls('user-menu')), ['frs:user-menu:player-create-select', 'frs:user-menu:menu-home']);
  const coach = ids(coachControls('user-menu'));
  for (const action of ['coach-round', 'coach-event', 'coach-exp', 'coach-strategy', 'coach-job', 'coach-champions', 'coach-market', 'coach-season-end', 'coach-career']) assert.ok(coach.includes(`frs:user-menu:${action}`), action);
  assert.deepEqual(ids(pendingExpControls('user-menu')), ['frs:user-menu:pending-exp-select', 'frs:user-menu:menu-player', 'frs:user-menu:player-league', 'frs:user-menu:menu-home']);
  const pendingMenu = pendingExpControls('user-menu')[0].toJSON().components[0];
  assert.equal(pendingMenu.max_values, 12, 'several skills can share the pool');
});

test('Coach controls lock Play Round after the last fixture and unlock Season Settlement', () => {
  const components = coachControls('coach-ui', { employed: true, seasonComplete: true, retired: false }).flatMap((row) => row.toJSON().components);
  assert.equal(components.find((item) => item.custom_id === 'frs:coach-ui:coach-round')?.disabled, true);
  assert.equal(components.find((item) => item.custom_id === 'frs:coach-ui:coach-season-end')?.disabled, false);
  const unemployed = coachControls('coach-ui', { employed: false, seasonComplete: false, retired: false }).flatMap((row) => row.toJSON().components);
  assert.equal(unemployed.find((item) => item.custom_id === 'frs:coach-ui:coach-round')?.disabled, true);
  assert.equal(unemployed.find((item) => item.custom_id === 'frs:coach-ui:coach-job')?.disabled, false);
});

test('Player and Coach submenus expose owner-bound button/select actions', () => {
  const menus = [
    playerClubControls('user-submenu', 2, true),
    playerInjuryControls('user-submenu'),
    playerCultureControls('user-submenu'),
    playerCareerControls('user-submenu', false, true, 'FW'),
    playerCareerControls('user-submenu', true, false, 'FW'),
    contractControls('user-submenu', true, true),
    honorsControls('user-submenu', [{ id: 'goals-10', title: 'Clinical', description: '', target: 10, progress: 10, claimed: false, rewardMoney: 1, rewardExp: 1 }]),
    trickControls('user-submenu', [TRICK_CATALOG['first-touch-turn']]),
    trainerControls('user-submenu', false),
    transferOfferControls('user-submenu', [{ id: 'offer-1-1', clubId: 1, clubName: 'Club', leagueId: 1012, weeklySalary: 100, seasons: 2, season: 1, status: 'OPEN' }]),
    coachExpControls('user-submenu', 20),
    coachStrategyControls('user-submenu', '4-4-2', 'balanced'),
    coachJobControls('user-submenu', [{ id: 'offer-1', clubName: 'Test Club' }]),
    coachMarketControls('user-submenu', [], [], () => 0),
    coachCareerControls('user-submenu', false),
    championsControls('user-submenu', 'PLAYER'),
    championsControls('user-submenu', 'COACH')
  ];
  const all = menus.flatMap((rows) => ids(rows as Rows));
  assert.equal(all.every((id) => id.startsWith('frs:user-submenu:')), true);
  for (const action of ['player-offers', 'player-clubs', 'injury-treatment-select', 'player-retire', 'player-rebirth-select', 'contract-renew', 'contract-raise', 'achievement-claim-select', 'trick-unlock-select', 'trainer-hire-select', 'player-offer-accept-select', 'player-offer-decline-select', 'coach-exp-select', 'coach-job-accept-select', 'coach-job-decline-select', 'coach-retire', 'player-champions-play', 'coach-champions-play']) assert.ok(all.includes(`frs:user-submenu:${action}`), action);
  assert.equal(all.includes('frs:user-submenu:player-club-match'), false, 'the athlete does not play club matches outside the weekly flow');
  assert.equal(all.some((id) => id.includes('player-market') || id.includes('player-formation')), false, 'Player Mode has no market or tactic controls');
});

test('club transfer flow exposes owner-bound club selection and confirmation', () => {
  const club = listOfficialClubs()[0];
  const selection = ids(officialClubControls('transfer-user', [club]));
  assert.ok(selection.includes('frs:transfer-user:player-club-select'));
  assert.ok(selection.every((id) => id.startsWith('frs:transfer-user:')));
  const confirmation = ids(transferConfirmControls('transfer-user', club.id));
  assert.ok(confirmation.includes(`frs:transfer-user:player-club-confirm:${club.id}`));
  assert.equal(playerClubControls('transfer-user').every((row) => row.toJSON().components.length <= 5), true);
  const closed = playerClubControls('transfer-user', 0, false).flatMap((row) => row.toJSON().components);
  assert.equal(closed.find((item) => item.custom_id === 'frs:transfer-user:player-clubs')?.disabled, true);
});

test('training component exposes all six abilities', () => {
  const select = trainingControls('user-2')[0].toJSON().components[0];
  assert.equal(select.custom_id, 'frs:user-2:train-select');
  assert.deepEqual(select.options?.map((option) => option.value), ['atk', 'def', 'speed', 'power', 'strength', 'technique']);
});

test('detailed training component exposes all twelve detailed skills', () => {
  const select = detailedTrainingControls('user-3')[0].toJSON().components[0];
  assert.equal(select.custom_id, 'frs:user-3:detailed-train-select');
  assert.equal(select.options?.length, 12);
  assert.equal(select.options?.some((option) => option.value === 'willpower'), true);
});
