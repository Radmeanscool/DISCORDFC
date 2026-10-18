import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignMatchExp,
  playPreparedWeek,
  preparePlayerWeek,
  resolvePlayerWeeklyEvent
} from '../src/domain/gameplay-engine.js';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import {
  pendingExpControls,
  playerEventControls,
  playerWeeklyControls
} from '../src/discord/components.js';

type ComponentJson = { custom_id?: string; disabled?: boolean; label?: string };

function componentsOf(rows: Array<{ toJSON(): { components: ComponentJson[] } }>): ComponentJson[] {
  return rows.flatMap((row) => row.toJSON().components);
}

function component(rows: Array<{ toJSON(): { components: ComponentJson[] } }>, id: string): ComponentJson {
  const found = componentsOf(rows).find((item) => item.custom_id === id);
  assert.ok(found, `component ${id} should be present`);
  return found;
}

test('weekly UI controls follow READY → MATCH_READY → EXP_PENDING → READY', () => {
  const userId = 'weekly-ui-normal';
  let profile = createInitialProfile(userId, 'UI Star', 'FW', new Date('2026-01-01T00:00:00.000Z'));

  const ready = playerWeeklyControls(userId, 'READY');
  assert.equal(component(ready, `frs:${userId}:next-week`).disabled, false);
  assert.match(String(component(ready, `frs:${userId}:next-week`).label), /Next Week/);
  assert.equal(componentsOf(ready).some((item) => item.custom_id === `frs:${userId}:match`), false);
  assert.equal(componentsOf(ready).every((item) => item.custom_id?.startsWith(`frs:${userId}:`)), true);

  const weekly = preparePlayerWeek(profile, new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(5120));
  profile = weekly.profile;
  assert.equal(weekly.stage, 'MATCH_READY');
  // The same button continues the week from any stage.
  const matchReady = playerWeeklyControls(userId, 'MATCH_READY');
  assert.equal(component(matchReady, `frs:${userId}:next-week`).disabled, false);
  assert.match(String(component(matchReady, `frs:${userId}:next-week`).label), /Main Match/);

  const played = playPreparedWeek(profile, new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(9));
  profile = played.profile;
  assert.equal(played.stage, 'EXP_PENDING');
  assert.ok((profile.unassignedMatchExp ?? 0) > 0);
  assert.ok(profile.lastMatch?.stats);
  assert.equal(profile.lastMatch!.stats!.possession + profile.lastMatch!.stats!.opponentPossession, 100);

  const pending = pendingExpControls(userId, profile);
  assert.ok(component(pending, `frs:${userId}:pending-exp-select`));
  assert.ok(component(pending, `frs:${userId}:pending-exp-auto`));
  assert.ok(component(pending, `frs:${userId}:player-league`));
  assert.equal(componentsOf(pending).every((item) => item.custom_id?.startsWith(`frs:${userId}:`)), true);

  const allocation = assignMatchExp(profile, { shots: profile.unassignedMatchExp });
  profile = allocation.profile;
  assert.equal(allocation.remaining, 0);
  assert.equal(profile.unassignedMatchExp, 0);
  assert.equal(profile.weekStage, 'READY');
  assert.equal(component(playerWeeklyControls(userId, profile.weekStage), `frs:${userId}:next-week`).disabled, false);
});

test('weekly event UI blocks match until the event choice is resolved', () => {
  const userId = 'weekly-ui-event';
  const profile = createInitialProfile(userId, 'Event Star', 'FW', new Date('2026-01-01T00:00:00.000Z'));
  const eventRng = { values: [0, 0, 0], next() { return this.values.shift() ?? 0; } };
  const weekly = preparePlayerWeek(profile, new Date('2026-01-01T00:00:00.000Z'), eventRng);

  assert.equal(weekly.stage, 'EVENT_PENDING');
  assert.ok(weekly.event);
  assert.match(String(component(playerWeeklyControls(userId, 'EVENT_PENDING'), `frs:${userId}:next-week`).label), /Event/);
  const eventControls = playerEventControls(userId, weekly.event!);
  assert.ok(component(eventControls, `frs:${userId}:player-event-select`));
  assert.equal(componentsOf(eventControls).every((item) => item.custom_id?.startsWith(`frs:${userId}:`)), true);

  assert.throws(
    () => playPreparedWeek(weekly.profile, new Date('2026-01-01T00:00:00.000Z'), new SeededRandom(2)),
    /Weekly Update terlebih dahulu/
  );
  const resolved = resolvePlayerWeeklyEvent(weekly.profile, weekly.event!.choices[0].id, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(resolved.profile.weekStage, 'MATCH_READY');
  assert.equal(resolved.profile.weeklyEvent?.resolved, true);
  const afterEvent = playerWeeklyControls(userId, 'MATCH_READY');
  assert.equal(component(afterEvent, `frs:${userId}:next-week`).disabled, false);
});
