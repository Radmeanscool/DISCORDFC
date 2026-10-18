import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRandom } from '../src/domain/engine.js';
import { advanceWeek, assignMatchExpEvenly, createPlayerCareer } from '../src/domain/gameplay-engine.js';
import { buildMatchTimeline, escapeMarkdown, withInjuryEvent, type TimelineInput } from '../src/domain/match-timeline.js';
import { ratingSkillsFor } from '../src/domain/player-formulas.js';
import type { MatchRecord, Position } from '../src/domain/types.js';

function checkConsistency(match: MatchRecord): void {
  const timeline = match.timeline!;
  const goals = timeline.filter((event) => event.kind === 'GOAL');
  assert.equal(goals.filter((event) => event.side === 'TEAM').length, match.playerGoals, 'team goals match the score');
  assert.equal(goals.filter((event) => event.side === 'OPPONENT').length, match.opponentGoals, 'opponent goals match the score');
  assert.equal(goals.filter((event) => event.side === 'TEAM' && event.minute <= 45).length, match.halftime!.team, 'half-time split');
  assert.equal(goals.filter((event) => event.user && event.text.includes('mencetak gol')).length, match.personal!.played ? match.personal!.goals : 0);
  assert.equal(goals.filter((event) => event.user && event.text.includes('Assist untukmu')).length, match.personal!.played ? match.personal!.assists : 0);
  const minutes = timeline.map((event) => event.minute);
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b), 'chronological');
  assert.ok(minutes.every((minute) => minute >= 1 && minute <= 90));
  if (!match.personal!.played) assert.ok(timeline.every((event) => !event.user), 'an absent athlete has no moments');
  const red = timeline.find((event) => event.kind === 'RED');
  if (red) assert.ok(timeline.filter((event) => event.user && event.kind !== 'RED').every((event) => event.minute <= red.minute), 'nothing after a sending-off');
}

for (const position of ['FW', 'MF', 'DF', 'GK'] as Position[]) {
  test(`${position}: every match timeline agrees with the score and personal output`, () => {
    const rng = new SeededRandom(position.charCodeAt(0) * 31);
    let profile = createPlayerCareer(`timeline-${position}`, 'Tes *Bintang*', position, new Date('2026-01-05T00:00:00.000Z'), new SeededRandom(3));
    let now = new Date('2026-01-05T00:00:00.000Z');
    let personalMoments = 0;
    for (let week = 0; week < 30; week += 1) {
      now = new Date(now.getTime() + 7 * 86_400_000);
      const result = advanceWeek(profile, now, rng);
      profile = result.profile;
      if ((profile.unassignedMatchExp ?? 0) > 0) profile = assignMatchExpEvenly(profile, ratingSkillsFor(profile.position), now).profile;
      if (!result.match?.timeline) continue;
      checkConsistency(result.match);
      personalMoments += result.match.timeline.filter((event) => event.user).length;
      assert.ok(result.match.timeline.every((event) => !event.text.includes('Tes *Bintang*')), 'display names are escaped');
    }
    if (position !== 'GK') assert.ok(personalMoments > 0, 'the athlete appears in the story');
  });
}

const BASE: TimelineInput = {
  seed: 'fixture-match',
  teamName: 'Leeds United',
  opponentName: 'Arsenal',
  teamGoals: 3,
  opponentGoals: 1,
  halftime: { team: 1, opponent: 1 },
  userName: 'Rookie',
  position: 'FW',
  personal: { played: true, goals: 2, assists: 1, rating: 8.4, yellowCard: true, redCard: true, mvp: true, cleanSheet: false },
  teammates: [{ name: 'Teammate A', position: 'FW' }, { name: 'Teammate B', position: 'MF' }],
  opponents: ['Opponent A'],
  shots: 12,
  opponentShots: 6,
  opponentShotsOnTarget: 3
};

test('a sending-off comes after the athlete scores and assists; the yellow before it', () => {
  const timeline = buildMatchTimeline(BASE);
  const red = timeline.find((event) => event.kind === 'RED')!;
  const yellow = timeline.find((event) => event.kind === 'YELLOW')!;
  assert.ok(yellow.minute < red.minute);
  assert.ok(timeline.filter((event) => event.user && event.kind !== 'RED').every((event) => event.minute <= red.minute));
  assert.deepEqual(buildMatchTimeline(BASE), timeline, 'same seed, same story');
});

test('keepers get saves, and an injury is placed after the athlete last action', () => {
  const keeper = buildMatchTimeline({ ...BASE, position: 'GK', personal: { ...BASE.personal, goals: 0, assists: 0, yellowCard: false, redCard: false }, opponentGoals: 0, halftime: { team: 1, opponent: 0 }, opponentShotsOnTarget: 4 });
  assert.ok(keeper.some((event) => event.kind === 'SAVE' && event.user));
  const injured = withInjuryEvent(keeper, 'Rookie', 'fixture-match');
  const injury = injured.find((event) => event.kind === 'INJURY')!;
  assert.ok(injured.filter((event) => event.user && event.kind !== 'INJURY').every((event) => event.minute <= injury.minute));
  assert.equal(escapeMarkdown('a*b_c'), 'a\\*b\\_c');
});
