import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialProfile } from '../src/domain/engine.js';
import { FORMATIONS, type PlayerProfile, type Position, type VersusClub } from '../src/domain/types.js';
import { canPlay, versusLeagueCode, versusTotalRounds } from '../src/domain/versus-engine.js';
import { catchUpVersusGroup, joinVersusGroup, openVersus, placeVersusBidFor, startNextVersusSeason, submitVersusLineupFor } from '../src/services/versus-service.js';
import { JsonPlayerStore } from '../src/storage/json-store.js';

const T0 = new Date('2026-04-01T08:00:00.000Z');
const HOUR = 3_600_000;

async function withStore<T>(users: string[], run: (store: JsonPlayerStore) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'frs-versus-service-'));
  try {
    const store = new JsonPlayerStore(join(directory, 'players.json'));
    await store.saveBatch(users.map((id) => createInitialProfile(id, `Club ${id}`, 'MF', T0)));
    return await run(store);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function notificationTypes(profile: PlayerProfile | undefined): string[] {
  return (profile?.notifications ?? []).map((item) => item.type);
}

function legalLineup(club: VersusClub, now: Date): string[] {
  const slots = FORMATIONS[club.formation].slots;
  return (['GK', 'DF', 'MF', 'FW'] as Position[]).flatMap((position) => club.roster.filter((player) => player.position === position && canPlay(player, now)).slice(0, slots[position]).map((player) => player.id));
}

test('public league assignment takes NPC slots before round 1, then opens a new tier group', async () => {
  await withStore(['vs-a', 'vs-b', 'vs-c'], async (store) => {
    const a = await openVersus(store, 'vs-a', T0);
    assert.equal(a.profile.versus!.groupCode, 'PUB-E-260401-01');
    assert.equal(a.season!.clubs.length, 8);
    assert.equal(a.season!.clubs.filter((club) => !club.isNpc).length, 1);
    assert.ok(notificationTypes(await store.get('vs-a')).includes('VERSUS_ASSIGNED'));

    const b = await openVersus(store, 'vs-b', new Date(T0.getTime() + HOUR));
    assert.equal(b.profile.versus!.groupCode, 'PUB-E-260401-01');
    assert.equal(b.season!.clubs.filter((club) => !club.isNpc).length, 2);
    assert.equal(b.season!.clubs.length, 8, 'the newcomer replaced an NPC instead of growing the league');
    const aSaved = await store.get('vs-a');
    assert.equal(aSaved!.versus!.season!.clubs.filter((club) => !club.isNpc).length, 2, 'existing members see the newcomer');
    for (let round = 1; round <= versusTotalRounds(b.season!); round += 1) {
      const clubsThisRound = b.season!.battles.filter((battle) => battle.roundId === round).flatMap((battle) => [battle.homeClubId, battle.awayClubId]);
      assert.equal(new Set(clubsThisRound).size, 8, `round ${round} pairs every club exactly once`);
    }

    // After the round-1 deadline the group is locked; the next club opens a new group.
    const c = await openVersus(store, 'vs-c', new Date(T0.getTime() + 25 * HOUR));
    assert.notEqual(c.profile.versus!.groupCode, 'PUB-E-260401-01');
    assert.match(c.profile.versus!.groupCode!, /^PUB-E-260402-\d{2}$/);
    assert.equal(c.profile.clubState, undefined, 'Versus never creates Player-mode club state');
    assert.equal(c.profile.coach, undefined);
  });
});

test('lineup, deadline reminder, outbid DM, round settlement, and idempotent catch-up', async () => {
  await withStore(['vs-a', 'vs-b'], async (store) => {
    await openVersus(store, 'vs-a', T0);
    const b = await openVersus(store, 'vs-b', T0);
    const groupCode = b.profile.versus!.groupCode!;
    const season = b.season!;
    const clubA = season.clubs.find((club) => club.ownerId === 'vs-a')!;
    const battleA = season.battles.find((battle) => battle.roundId === 1 && (battle.homeClubId === clubA.id || battle.awayClubId === clubA.id))!;
    const lineup = legalLineup(clubA, T0);
    const submitted = await submitVersusLineupFor(store, 'vs-a', { battleId: battleA.id, lineup, substitutes: [], captainId: lineup[0], formation: clubA.formation, tactic: 'counter', rosterVersion: clubA.rosterVersion }, new Date(T0.getTime() + HOUR));
    const stored = submitted.season.battles.find((battle) => battle.id === battleA.id)!;
    assert.equal((stored.homeClubId === clubA.id ? stored.homeSubmission : stored.awaySubmission)?.tactic, 'counter');

    // Outbid: B overbids A on the same lot; A gets a DM and the reservation back.
    const listing = season.market!.listings[0];
    await placeVersusBidFor(store, 'vs-a', listing.id, undefined, new Date(T0.getTime() + HOUR));
    assert.equal((await store.get('vs-a'))!.versus!.reservations!.length, 1);
    await placeVersusBidFor(store, 'vs-b', listing.id, undefined, new Date(T0.getTime() + HOUR));
    const outbid = await store.get('vs-a');
    assert.equal(outbid!.versus!.reservations!.length, 0);
    assert.ok(notificationTypes(outbid).includes('VERSUS_OUTBID'));

    // Reminder only for the club that has not submitted.
    const deadline = new Date(season.roundDeadline).getTime();
    await catchUpVersusGroup(store, groupCode, new Date(deadline - 2 * HOUR));
    assert.ok(notificationTypes(await store.get('vs-b')).includes('VERSUS_DEADLINE'));
    assert.equal(notificationTypes(await store.get('vs-a')).includes('VERSUS_DEADLINE'), false);

    // Two concurrent catch-ups after the deadline settle the round exactly once.
    const after = new Date(deadline + 60_000);
    await Promise.all([catchUpVersusGroup(store, groupCode, after), catchUpVersusGroup(store, groupCode, after)]);
    const a = await store.get('vs-a');
    assert.equal(a!.versus!.season!.currentRound, 2);
    assert.equal(a!.versus!.season!.battles.filter((battle) => battle.roundId === 1).every((battle) => battle.state === 'PUBLISHED'), true);
    assert.equal(notificationTypes(a).filter((type) => type === 'VERSUS_RESULT').length, 1);
    const again = await catchUpVersusGroup(store, groupCode, after);
    assert.equal(again.result?.changed, false);
    assert.equal(notificationTypes(await store.get('vs-a')).filter((type) => type === 'VERSUS_RESULT').length, 1);
    assert.equal(notificationTypes(await store.get('vs-b')).filter((type) => type === 'VERSUS_RESULT').length, 1);
  });
});

test('a full season ends with season DMs and Next Season applies promotion by creating the next-tier season', async () => {
  await withStore(['vs-a', 'vs-b'], async (store) => {
    await openVersus(store, 'vs-a', T0);
    const b = await openVersus(store, 'vs-b', T0);
    const groupCode = b.profile.versus!.groupCode!;
    let guard = 0;
    for (;;) {
      const profile = (await store.get('vs-a'))!;
      const season = profile.versus!.season!;
      if (season.state === 'FINISHED') break;
      assert.ok(guard++ < 20, 'season must finish');
      await catchUpVersusGroup(store, groupCode, new Date(new Date(season.roundDeadline).getTime() + 1_000));
    }
    for (const userId of ['vs-a', 'vs-b']) {
      const profile = (await store.get(userId))!;
      const season = profile.versus!.season!;
      assert.equal(season.state, 'FINISHED');
      assert.equal(season.market!.listings.some((listing) => listing.status === 'OPEN'), false, 'market closed');
      assert.equal((profile.versus!.reservations ?? []).length, 0);
      assert.ok(notificationTypes(profile).includes('VERSUS_SEASON_END'));
      assert.equal(profile.versus!.club.grade, 5, 'promotion is not applied before the next season exists');

      const reward = season.rewards.find((item) => item.clubId === profile.versus!.clubId)!;
      const end = new Date(season.endAt!);
      const next = await startNextVersusSeason(store, userId, new Date(end.getTime() + HOUR));
      const expectedGrade = reward.promoted ? 4 : 5;
      assert.equal(next.profile.versus!.club.grade, expectedGrade);
      assert.equal(next.season!.state, 'ACTIVE');
      assert.ok(next.profile.versus!.groupCode!.startsWith(`PUB-${versusLeagueCode(expectedGrade)}-`));
      assert.equal(next.profile.versus!.history.length, 1);
      // Rollover is idempotent: opening Versus again does not move the grade twice.
      const reopened = await openVersus(store, userId, new Date(end.getTime() + 2 * HOUR));
      assert.equal(reopened.profile.versus!.club.grade, expectedGrade);
    }
  });
});

test('private groups: join before round 1, wait while a season runs, restart together afterwards', async () => {
  await withStore(['pv-a', 'pv-b', 'pv-c'], async (store) => {
    const a = await joinVersusGroup(store, 'pv-a', 'friends-1', T0);
    assert.equal(a.profile.versus!.groupCode, 'FRIENDS-1');
    const b = await joinVersusGroup(store, 'pv-b', 'FRIENDS-1', new Date(T0.getTime() + HOUR));
    assert.equal(b.season!.clubs.filter((club) => !club.isNpc).length, 2);
    await catchUpVersusGroup(store, 'FRIENDS-1', new Date(new Date(b.season!.roundDeadline).getTime() + 1_000));
    const c = await joinVersusGroup(store, 'pv-c', 'FRIENDS-1', new Date(T0.getTime() + 26 * HOUR));
    assert.equal(c.waiting, true);
    const view = await openVersus(store, 'pv-c', new Date(T0.getTime() + 27 * HOUR));
    assert.equal(view.waiting, true);
    await assert.rejects(joinVersusGroup(store, 'pv-a', 'OTHER-GROUP', new Date(T0.getTime() + 27 * HOUR)), /terkunci/);
  });
});
