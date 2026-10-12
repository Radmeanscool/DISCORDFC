import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { commandDefinitions, menuFirstCommandDefinitions, resolveModeCommand } from '../src/discord/commands.js';

test('Discord registry groups Player, Coach, and Versus modes without technical matchmake command', () => {
  const roots = new Map(commandDefinitions.map((command) => [command.name, command]));
  assert.equal(roots.has('play'), true);
  assert.equal(roots.has('player'), true);
  assert.equal(roots.has('coach'), true);
  assert.equal(roots.has('versus'), true);
  assert.equal(roots.has('help'), true);

  const playerGroups = (roots.get('player')?.options ?? []).map((option) => option.name);
  assert.deepEqual(playerGroups, ['career', 'training', 'club', 'honors']);
  const careerGroup = (roots.get('player')?.options ?? []).find((option) => option.name === 'career');
  const careerCommands = (careerGroup?.options ?? []).map((option) => option.name);
  assert.equal(careerCommands.includes('event'), false);

  const coachCommands = (roots.get('coach')?.options ?? []).map((option) => option.name);
  assert.equal(coachCommands.includes('career'), true);
  assert.equal(coachCommands.includes('formation'), true);
  assert.equal(coachCommands.includes('tactic'), true);
  assert.equal(coachCommands.includes('event'), true);

  const versusCommands = (roots.get('versus')?.options ?? []).map((option) => option.name);
  assert.equal(versusCommands.includes('profile'), true);
  assert.equal(versusCommands.includes('bid'), true);
  assert.equal(versusCommands.includes('lineup'), true);

  const names = commandDefinitions.map((command) => command.name);
  assert.equal(names.includes('versus-matchmake'), false);
  assert.equal(names.includes('versus-club'), false);

  assert.equal(resolveModeCommand('play'), 'play');
  assert.equal(resolveModeCommand('player', 'start', 'career'), 'start');
  assert.equal(resolveModeCommand('player', 'train', 'training'), 'train');
  assert.equal(resolveModeCommand('player', 'overview', 'club'), 'club');
  assert.equal(resolveModeCommand('player', 'event', 'career'), 'player-event-disabled');
  assert.equal(resolveModeCommand('coach', 'formation'), 'formation');
  assert.equal(resolveModeCommand('versus', 'bid'), 'versus-bid');
});

test('menu-first registration exposes only the play entry command', () => {
  assert.deepEqual(menuFirstCommandDefinitions.map((command) => command.name), ['play']);
  assert.equal(menuFirstCommandDefinitions.length, 1);
  assert.equal(menuFirstCommandDefinitions.some((command) => command.name === 'player'), false);
  assert.equal(menuFirstCommandDefinitions.some((command) => command.name === 'coach'), false);
  assert.equal(menuFirstCommandDefinitions.some((command) => command.name === 'versus'), false);
});

test('Postgres schema contains canonical Versus projection tables and economy columns', async () => {
  const schema = await readFile(new URL('../src/storage/schema.sql', import.meta.url), 'utf8');
  for (const table of ['versus_queue_tickets', 'versus_matches', 'versus_market_listings', 'versus_wallet_reservations']) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  for (const column of ['mode', 'currency', 'season_id', 'battle_id', 'transaction_id']) assert.match(schema, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
});
