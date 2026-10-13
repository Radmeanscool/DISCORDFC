import assert from 'node:assert/strict';
import test from 'node:test';
import { careerControls, championsControls, coachControls, coachExpControls, coachJobControls, coachStrategyControls, detailedTrainingControls, mainMenuControls, officialClubControls, pendingExpControls, playerClubControls, playerCreationControls, playerCultureControls, playerInjuryControls, playerStrategyControls, playerWeeklyControls, trainingControls, transferConfirmControls, versusFinalizeControls, versusHomeControls, versusPositionControls, versusSetupControls } from '../src/discord/components.js';
import { listOfficialClubs } from '../src/domain/official-club-engine.js';
import { createInitialProfile } from '../src/domain/engine.js';
import { createVersusClub } from '../src/domain/versus-engine.js';

test('career components are owner-bound and actionable', () => {
  const rows = careerControls('user-1').map((row) => row.toJSON());
  const ids = rows.flatMap((row) => row.components.map((component) => component.custom_id));
  assert.ok(ids.includes('frs:user-1:daily-reward'));
  assert.ok(ids.includes('frs:user-1:injury'));
  assert.ok(ids.includes('frs:user-1:honors'));
  assert.ok(ids.includes('frs:user-1:contract'));
  assert.ok(ids.includes('frs:user-1:player-champions'));
  assert.ok(ids.includes('frs:user-1:menu-home'));
  assert.ok(ids.includes('frs:user-1:menu-coach'));
  assert.ok(ids.includes('frs:user-1:versus-home'));
  assert.equal(ids.every((id) => id.startsWith('frs:user-1:')), true);
});

test('Versus Home and lineup controls preserve owner, battle, and roster context', () => {
  const profile = createVersusClub(createInitialProfile('user-4', 'Versus UI', 'MF'), new Date('2026-01-01T00:00:00.000Z'));
  const roster = profile.versus!.club.roster;
  const setup = versusSetupControls('user-4', 'battle:1', 3, '4-4-2', 'balanced').flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(setup.every((id) => id?.startsWith('frs:user-4:')));
  assert.ok(setup.some((id) => id?.includes('battle%3A1')));
  const selected = { GK: [], DF: [], MF: [], FW: [] };
  const positions = versusPositionControls('user-4', 'battle:1', 3, '4-4-2', roster, selected);
  assert.equal(positions.length, 5);
  assert.equal(positions.slice(0, 4).every((row) => row.toJSON().components[0].custom_id?.includes('3')), true);
  const lineup = roster.filter((player) => ['GK', 'DF', 'MF', 'FW'].includes(player.position)).slice(0, 11).map((player) => player.id);
  const final = versusFinalizeControls('user-4', 'battle:1', 3, lineup, roster);
  assert.equal(final.length, 3);
  assert.equal(final.flatMap((row) => row.toJSON().components.map((component) => component.custom_id)).every((id) => id?.startsWith('frs:user-4:')), true);
  const home = versusHomeControls('user-4').flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.equal(home.every((id) => id?.startsWith('frs:user-4:')), true);
  for (const action of ['versus-registration', 'versus-market', 'versus-rewards', 'versus-schedule', 'versus-rankings', 'versus-global-ranking']) assert.ok(home.includes(`frs:user-4:${action}`));
});

test('main menu exposes the three gameplay modes and player creation is menu-driven', () => {
  const menuIds = mainMenuControls('user-menu').flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.deepEqual(menuIds, ['frs:user-menu:menu-player', 'frs:user-menu:menu-coach', 'frs:user-menu:menu-versus']);
  const creation = playerCreationControls('user-menu').flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.deepEqual(creation, ['frs:user-menu:player-create-select', 'frs:user-menu:menu-home']);
  const coach = coachControls('user-menu').flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(coach.includes('frs:user-menu:coach-round'));
  assert.ok(coach.includes('frs:user-menu:coach-event'));
  assert.ok(coach.includes('frs:user-menu:coach-exp'));
  assert.ok(coach.includes('frs:user-menu:coach-strategy'));
  assert.ok(coach.includes('frs:user-menu:coach-job'));
  assert.ok(coach.includes('frs:user-menu:coach-champions'));
  const pending = pendingExpControls('user-menu').flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.deepEqual(pending, ['frs:user-menu:pending-exp-select', 'frs:user-menu:menu-player', 'frs:user-menu:player-league', 'frs:user-menu:menu-home']);
});

test('Player Weekly Hub changes primary actions by weekly stage', () => {
  const ready = playerWeeklyControls('weekly-1', 'READY').flatMap((row) => row.toJSON().components);
  const matchReady = playerWeeklyControls('weekly-1', 'MATCH_READY').flatMap((row) => row.toJSON().components);
  const pending = playerWeeklyControls('weekly-1', 'EXP_PENDING').flatMap((row) => row.toJSON().components);
  const find = (components: any[], id: string) => components.find((component) => component.custom_id === `frs:weekly-1:${id}`);
  assert.equal(find(ready, 'next-week').disabled, false);
  assert.equal(find(ready, 'match').disabled, true);
  assert.equal(find(matchReady, 'next-week').disabled, true);
  assert.equal(find(matchReady, 'match').disabled, false);
  assert.equal(find(pending, 'skills').label, 'Assign EXP');
  assert.equal(find(pending, 'match').disabled, true);
});

test('Player and Coach submenus expose owner-bound button/select actions', () => {
  const menus = [
    playerClubControls('user-submenu'),
    playerInjuryControls('user-submenu'),
    playerStrategyControls('user-submenu', '4-4-2', 'balanced'),
    playerCultureControls('user-submenu'),
    coachExpControls('user-submenu', 20),
    coachStrategyControls('user-submenu', '4-4-2', 'balanced'),
    coachJobControls('user-submenu', [{ id: 'offer-1', clubName: 'Test Club' }]),
    championsControls('user-submenu', 'PLAYER'),
    championsControls('user-submenu', 'COACH')
  ];
  const ids = menus.flatMap((rows) => rows.flatMap((row) => row.toJSON().components.map((component) => component.custom_id)));
  assert.equal(ids.every((id) => id?.startsWith('frs:user-submenu:')), true);
  assert.ok(ids.includes('frs:user-submenu:player-club-match'));
  assert.ok(ids.includes('frs:user-submenu:injury-treatment-select'));
  assert.ok(ids.includes('frs:user-submenu:coach-exp-select'));
  assert.ok(ids.includes('frs:user-submenu:coach-job-accept-select'));
  assert.ok(ids.includes('frs:user-submenu:player-champions-play'));
  assert.ok(ids.includes('frs:user-submenu:coach-champions-play'));
});

test('club transfer flow exposes owner-bound club selection and confirmation', () => {
  const club = listOfficialClubs()[0];
  const selection = officialClubControls('transfer-user', [club]).flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(selection.includes('frs:transfer-user:player-club-select'));
  assert.ok(selection.every((id) => id?.startsWith('frs:transfer-user:')));
  const confirmation = transferConfirmControls('transfer-user', club.id).flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(confirmation.includes(`frs:transfer-user:player-club-confirm:${club.id}`));
  assert.equal(playerClubControls('transfer-user').every((row) => row.toJSON().components.length <= 5), true);
});

test('training component exposes all six abilities', () => {
  const rows = trainingControls('user-2').map((row) => row.toJSON());
  const select = rows[0].components[0];
  assert.equal(select.custom_id, 'frs:user-2:train-select');
  assert.deepEqual(select.options?.map((option) => option.value), ['atk', 'def', 'speed', 'power', 'strength', 'technique']);
});

test('detailed training component exposes all twelve detailed skills', () => {
  const rows = detailedTrainingControls('user-3').map((row) => row.toJSON());
  const select = rows[0].components[0];
  assert.equal(select.custom_id, 'frs:user-3:detailed-train-select');
  assert.equal(select.options?.length, 12);
  assert.equal(select.options?.some((option) => option.value === 'willpower'), true);
});
