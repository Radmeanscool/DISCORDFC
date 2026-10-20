import assert from 'node:assert/strict';
import test from 'node:test';
import { RECOVERY_CLUBS } from '../src/config/recovery-data.js';
import { createInitialProfile, SeededRandom } from '../src/domain/engine.js';
import { assignMatchExp, createPlayerCareer, ensureGameplayState, formatDetailedSkills, skillDisplayLevel } from '../src/domain/gameplay-engine.js';
import { DETAILED_SKILLS } from '../src/domain/types.js';

const T0 = new Date('2026-10-20T00:00:00.000Z');

test('a new free player signs with a random third-tier club; nationality never picks the club', () => {
  const clubs = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1) {
    // Spread the seeds: xorshift32 returns near-zero first draws for small seeds.
    const profile = createPlayerCareer(`start-${seed}`, 'Start', 'FW', T0, new SeededRandom(Math.imul(seed, 2_654_435_761) >>> 0), 'IDN');
    const record = RECOVERY_CLUBS.find((club) => club.nameEn === profile.club)!;
    assert.match(String(record.league), /^10[1-5]3$/, `${profile.club} is third tier`);
    assert.equal(profile.clubState?.leagueId, record.league);
    assert.equal(profile.nationality, 'IDN');
    clubs.add(profile.club);
  }
  assert.ok(clubs.size >= 20, `starter clubs vary (${clubs.size})`);
  const countries = new Set([...clubs].map((name) => RECOVERY_CLUBS.find((club) => club.nameEn === name)!.country));
  assert.ok(countries.size >= 4, 'clubs come from several countries regardless of nationality');
});

test('skills start at Lv 1 and climb one level per point gained', () => {
  let profile = createPlayerCareer('levels', 'Levels', 'MF', T0, new SeededRandom(9));
  for (const skill of DETAILED_SKILLS) assert.equal(skillDisplayLevel(profile, skill), 1, skill);
  assert.match(formatDetailedSkills(profile), /Pass\s+Lv  1/);
  profile.unassignedMatchExp = 2_000;
  profile.weekStage = 'EXP_PENDING';
  const before = profile.detailedSkills!.pass.level;
  profile = assignMatchExp(profile, { pass: 2_000 }, T0).profile;
  const gained = profile.detailedSkills!.pass.level - before;
  assert.ok(gained > 3, 'a large EXP pool buys several levels');
  assert.equal(skillDisplayLevel(profile, 'pass'), 1 + gained);
});

test('saves from before skill levels count levels from the position preset', () => {
  const legacy = createInitialProfile('legacy-levels', 'Legacy', 'FW', T0);
  delete legacy.skillBase;
  legacy.detailedSkills!.shots.level += 11;
  const migrated = ensureGameplayState(legacy, T0);
  assert.equal(skillDisplayLevel(migrated, 'shots'), 12);
  assert.equal(skillDisplayLevel(migrated, 'header'), 1);
});
