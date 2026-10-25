import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentType, MessageFlags, type APIActionRowComponent, type APIEmbed } from 'discord.js';
import { handleComponent } from '../src/discord/handlers.js';

// Live-match frames are still sent, just without the real-time pause.
process.env.MATCH_ANIMATION_MS = '1';
import { JsonPlayerStore } from '../src/storage/json-store.js';
import { createEarthCup } from '../src/domain/earth-cup.js';
import { SeededRandom } from '../src/domain/engine.js';

/** Minimal stand-in for a Discord component interaction; records every payload the handler sends. */
class FakeComponent {
  replied = false;
  deferred = false;
  readonly edits: Array<Record<string, unknown>> = [];
  readonly notices: string[] = [];
  readonly user: { id: string; username: string; globalName: string };
  readonly message: { flags: { has: (flag: number) => boolean } };

  constructor(readonly customId: string, userId: string, readonly values?: string[], ephemeral = true) {
    this.user = { id: userId, username: userId, globalName: `User ${userId}` };
    this.message = { flags: { has: (flag: number) => ephemeral && flag === MessageFlags.Ephemeral } };
  }

  isChatInputCommand(): boolean { return false; }
  isStringSelectMenu(): boolean { return this.values !== undefined; }
  isButton(): boolean { return this.values === undefined; }
  async deferReply(): Promise<void> { this.deferred = true; }
  async deferUpdate(): Promise<void> { this.deferred = true; }
  async editReply(payload: Record<string, unknown>): Promise<void> { this.edits.push(payload); }
  async followUp(payload: { content: string }): Promise<void> { this.notices.push(payload.content); }
  async reply(payload: { content: string }): Promise<void> { this.replied = true; this.notices.push(payload.content); }
}

type Row = APIActionRowComponent<{ type: number; custom_id?: string; options?: Array<{ value: string; default?: boolean }>; min_values?: number; max_values?: number; label?: string }>;

/** Validates a payload against Discord's message limits (builders validate their own fields in toJSON). */
function validatePayload(payload: Record<string, unknown>): { ids: string[]; embeds: APIEmbed[]; options: Map<string, string[]> } {
  const rows = ((payload.components as Array<{ toJSON(): Row }>) ?? []).map((row) => row.toJSON());
  assert.ok(rows.length <= 5, 'at most 5 action rows');
  const ids: string[] = [];
  const optionsById = new Map<string, string[]>();
  for (const row of rows) {
    assert.ok(row.components.length >= 1 && row.components.length <= 5);
    const selects = row.components.filter((component) => component.type === ComponentType.StringSelect);
    if (selects.length) assert.equal(row.components.length, 1, 'a select menu fills its row alone');
    for (const component of row.components) {
      assert.ok(component.custom_id && component.custom_id.length <= 100, `custom id length: ${component.custom_id}`);
      ids.push(component.custom_id!);
      if (component.type === ComponentType.StringSelect) {
        const options = component.options ?? [];
        optionsById.set(component.custom_id!, options.map((item) => item.value));
        assert.ok(options.length >= 1 && options.length <= 25);
        assert.equal(new Set(options.map((item) => item.value)).size, options.length, 'option values are unique');
        assert.ok((component.min_values ?? 1) <= (component.max_values ?? 1));
        assert.ok((component.max_values ?? 1) <= options.length);
        assert.ok(options.filter((item) => item.default).length <= (component.max_values ?? 1));
      }
    }
  }
  assert.equal(new Set(ids).size, ids.length, `custom ids are unique within a message: ${ids.join(', ')}`);
  const embeds = ((payload.embeds as Array<{ toJSON(): APIEmbed }>) ?? []).map((item) => item.toJSON());
  const total = embeds.reduce((sum, item) => sum + (item.title?.length ?? 0) + (item.description?.length ?? 0) + (item.footer?.text.length ?? 0) + (item.fields ?? []).reduce((inner, field) => inner + field.name.length + field.value.length, 0), 0);
  assert.ok(total <= 6_000, `embed total ${total}`);
  for (const item of embeds) {
    assert.ok((item.description?.length ?? 0) <= 4_096);
    assert.ok((item.fields ?? []).length <= 25);
    for (const field of item.fields ?? []) assert.ok(field.value.length >= 1 && field.value.length <= 1_024, `field ${field.name}`);
  }
  assert.ok(typeof payload.content !== 'string' || payload.content.length <= 2_000);
  assert.ok(embeds.length > 0 || (typeof payload.content === 'string' && payload.content.length > 0), 'never an empty message');
  return { ids, embeds, options: optionsById };
}

class Session {
  constructor(private readonly store: JsonPlayerStore, readonly userId: string) {}

  async click(action: string, values?: string[]): Promise<{ ids: string[]; embeds: APIEmbed[]; content: string; options: Map<string, string[]>; frames: APIEmbed[] }> {
    const interaction = new FakeComponent(`frs:${this.userId}:${action}`, this.userId, values);
    await handleComponent(interaction as never, this.store);
    assert.deepEqual(interaction.notices, [], `${action} should not fail: ${interaction.notices.join(' | ')}`);
    assert.ok(interaction.edits.length >= 1, `${action} edits the panel`);
    // Every edit before the last is a live-match frame: an embed and no buttons.
    const frames = interaction.edits.slice(0, -1).map((edit) => {
      const frame = validatePayload(edit);
      assert.deepEqual(frame.ids, [], 'live frames carry no components');
      return frame.embeds[0];
    });
    const final = interaction.edits.at(-1)!;
    const { ids, embeds, options } = validatePayload(final);
    return { ids, embeds, options, frames, content: String(final.content ?? '') };
  }

  async fail(action: string, values?: string[]): Promise<string> {
    const interaction = new FakeComponent(`frs:${this.userId}:${action}`, this.userId, values);
    await handleComponent(interaction as never, this.store);
    assert.equal(interaction.notices.length, 1, `${action} should report an error`);
    return interaction.notices[0];
  }
}

function action(ids: string[], prefix: string): string {
  const found = ids.find((id) => id.split(':').slice(2).join(':').startsWith(prefix));
  assert.ok(found, `component ${prefix} present in ${ids.join(', ')}`);
  return found.split(':').slice(2).join(':');
}

async function withStore(run: (store: JsonPlayerStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'frs-handlers-'));
  try {
    await run(new JsonPlayerStore(join(directory, 'players.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('Player Mode is fully playable through buttons and selects', async () => {
  await withStore(async (store) => {
    const player = new Session(store, '100000000000000001');
    const creation = await player.click('menu-player');
    assert.ok(creation.ids.some((id) => id.endsWith('player-country-select')));
    const brazil = await player.click('player-country-select', ['BRA']);
    assert.ok(brazil.ids.some((id) => id.endsWith('player-create-select:BRA')), 'the position step carries the nationality');
    const home = await player.click('player-create-select:BRA', ['FW']);
    assert.match(home.embeds[0].title ?? '', /Signed successfully/);
    const profile = (await store.get(player.userId))!;
    assert.equal(profile.contract?.state, 'ACTIVE');
    assert.equal(profile.nationality, 'BRA');
    assert.match(String(profile.clubState?.leagueId), /^10[1-5]3$/, 'a free player signs with a third-tier club');

    // One button plays the week: event (if any) → live match → EXP.
    let week = await player.click('next-week');
    if (week.ids.some((id) => id.endsWith('player-event-select'))) {
      assert.equal(week.frames.length, 0, 'the event comes before the match');
      const current = (await store.get(player.userId))!;
      week = await player.click('player-event-select', [current.weeklyEvent!.choices[0].id]);
    }
    assert.equal(week.frames.length, 7, 'kick-off to full-time frames');
    assert.match(week.frames[0].title ?? '', /LIVE/);
    assert.match(week.embeds[0].title ?? '', /MENANG|SERI|KALAH/);
    const afterMatch1 = (await store.get(player.userId))!;
    assert.ok(afterMatch1.lastMatch?.timeline, 'the match has a timeline');
    if (week.ids.some((id) => id.endsWith('pending-exp-select'))) {
      const assigned = await player.click('pending-exp-select', ['shots', 'dribbling', 'offBallRunning']);
      assert.match(assigned.content, /EXP dialokasikan/);
    }
    assert.ok(!week.ids.some((id) => id.endsWith(':match')), 'no separate match button');
    const menu = await player.click('menu-player');
    assert.ok(menu.ids.some((id) => id.endsWith('player-menu-select')));
    assert.ok(menu.ids.length <= 6, `hub stays small: ${menu.ids.join(', ')}`);
    await player.click('player-personal');
    await player.click('player-menu-select', ['player-profile']);
    await player.click('player-menu-select', ['honors']);
    // The match rolls injuries with real randomness; an injured player cannot train, so heal first.
    const afterMatch = (await store.get(player.userId))!;
    if ((afterMatch.injury?.weeksRemaining ?? 0) > 0) await store.save({ ...afterMatch, injury: undefined });
    await player.click('train');
    await player.click('train-select', ['atk']);
    assert.match(await player.fail('train-select', ['def']), /sudah dilakukan/);
    for (const view of ['profile', 'skills', 'contract', 'honors', 'club', 'player-league', 'player-squad', 'player-offers', 'player-career', 'injury', 'player-tricks', 'player-trainer', 'player-culture', 'detailed-train']) await player.click(view);
    await player.click('injury-treatment-select', ['view']);
    await player.click('daily-reward');
    await player.click('trainer-hire-select', ['junior-physical']);
    await player.click('trainer-release');
    await player.click('detailed-train-select', ['pass']);
    await player.click('culture-select', ['arts']);
    const contract = await player.click('contract-raise');
    assert.match(contract.content, /Klub (menolak|menyetujui)/);
    assert.match(await player.fail('player-champions'), /belum lolos/);
    assert.match(await player.fail('player-retire'), /belum tersedia/);

    // Second week, using the automatic EXP split.
    let second = await player.click('next-week');
    if (second.ids.some((id) => id.endsWith('player-event-select'))) {
      const current = (await store.get(player.userId))!;
      second = await player.click('player-event-select', [current.weeklyEvent!.choices[0].id]);
    }
    if (second.ids.some((id) => id.endsWith('pending-exp-auto'))) assert.match((await player.click('pending-exp-auto')).content, /EXP dibagi/);
    assert.equal((await store.get(player.userId))!.unassignedMatchExp ?? 0, 0);
  });
});

test('Coach Mode panels, round, market, and job flow work through components', async () => {
  await withStore(async (store) => {
    const coach = new Session(store, '100000000000000002');
    await coach.click('player-create-select', ['MF']);
    const home = await coach.click('menu-coach');
    assert.ok(home.ids.some((id) => id.endsWith('coach-round')));
    const round = await coach.click('coach-round');
    assert.ok(round.embeds[0].title?.startsWith('Coach Round'));
    const profile = (await store.get(coach.userId))!;
    if (profile.coach!.event && !profile.coach!.event.resolved) await coach.click('coach-event-select', [profile.coach!.event.choices[0].id]);
    const market = await coach.click('coach-market');
    assert.ok(market.ids.some((id) => id.endsWith('coach-sell-select')));
    for (const view of ['coach-club', 'coach-job', 'coach-exp', 'coach-strategy', 'coach-career', 'coach-profile']) await coach.click(view);
    await coach.click('coach-formation-select', ['4-3-3']);
    assert.equal((await store.get(coach.userId))!.coachClubState!.formation, '4-3-3');
    assert.equal((await store.get(coach.userId))!.clubState?.formation ?? '4-4-2', '4-4-2', 'Player club untouched');
    const pending = (await store.get(coach.userId))!.coach!.unassignedExp;
    if (pending > 0) await coach.click('coach-exp-select', ['tactics']);
    assert.match(await coach.fail('coach-season-end'), /Belum semua fixture/);
  });
});

test('Versus Mode: assignment, lineup builder, market, squad, scout, sponsor, and views', async () => {
  await withStore(async (store) => {
    const versus = new Session(store, '100000000000000003');
    await versus.click('player-create-select', ['GK']);
    const home = await versus.click('menu-versus');
    assert.match(home.embeds[0].description ?? '', /Liga \*\*E\*\*/);
    const lineupStart = action(home.ids, 'vl:start:');
    const setup = await versus.click(lineupStart);
    const auto = await versus.click(action(setup.ids, 'vl:auto:'));
    const confirmed = await versus.click(action(auto.ids, 'vl:ok:'));
    assert.match(confirmed.content, /Lineup Round 1 tersimpan/);
    assert.ok(confirmed.ids.some((id) => id.includes(':vl:start:')), 'Edit Lineup stays available until the deadline');

    // Manual path: formation → XI per position → review → captain → confirm.
    const edit = await versus.click(action(confirmed.ids, 'vl:start:'));
    await versus.click(action(edit.ids, 'vl:fm:'), ['5-3-2']);
    const picker = await versus.click(action(edit.ids, 'vl:xi:'));
    const profile = (await store.get(versus.userId))!;
    const club = profile.versus!.season!.clubs.find((item) => item.id === profile.versus!.clubId)!;
    const pick = (position: string, count: number) => club.roster.filter((player) => player.position === position && player.status === 'AVAILABLE').slice(0, count).map((player) => player.id);
    for (const [position, count] of [['gk', 1], ['df', 5], ['mf', 3], ['fw', 2]] as const) await versus.click(action(picker.ids, `vl:${position}:`), pick(position.toUpperCase(), count));
    const review = await versus.click(action(picker.ids, 'vl:rev:'));
    await versus.click(action(review.ids, 'vl:cap:'), [pick('DF', 1)[0]]);
    const manual = await versus.click(action(review.ids, 'vl:ok:'));
    assert.match(manual.content, /5-3-2/);

    const market = await versus.click('versus-market');
    const listings = (await store.get(versus.userId))!.versus!.season!.market!.listings.filter((listing) => listing.status === 'OPEN');
    const bid = await versus.click('versus-bid-select', [listings[0].id]);
    assert.match(bid.content, /tercatat/);
    assert.ok(market.ids.includes(`frs:${versus.userId}:versus-bid-select`));

    const squad = await versus.click('versus-squad');
    assert.ok(squad.ids.some((id) => id.includes('versus-release-select:')));
    const scouted = await versus.click('versus-scout-junior');
    assert.match(scouted.content, /Scout menemukan/);
    assert.match(await versus.fail('versus-scout-senior'), /sudah dikirim/);
    const releaseSelect = action(scouted.ids, 'versus-release-select:');
    // Only releasable players are offered: submitted starters and minimum-depth positions are excluded.
    const releasable = scouted.options.get(`frs:${versus.userId}:${releaseSelect}`)!;
    const lineupIds = new Set((await store.get(versus.userId))!.versus!.season!.battles.flatMap((battle) => [...(battle.homeSubmission?.lineup ?? []), ...(battle.awaySubmission?.lineup ?? [])]));
    const roster = (await store.get(versus.userId))!.versus!.club.roster;
    assert.equal(releasable.some((index) => lineupIds.has(roster[Number(index)].id)), false);
    const confirm = await versus.click(releaseSelect, [releasable[0]]);
    const released = await versus.click(action(confirm.ids, 'versus-release-confirm:'));
    assert.match(released.content, /dilepas/);
    await versus.click('versus-sponsor');
    await versus.click('versus-sponsor-junior');
    assert.match(await versus.fail('versus-sponsor-senior'), /Liga C|sudah terikat/);

    for (const view of ['versus-home', 'versus-results', 'versus-standings', 'versus-schedule', 'versus-rankings', 'versus-ranking-mvp', 'versus-ranking-goalkeepers', 'versus-global-ranking', 'versus-rewards', 'versus-registration', 'versus-scout']) await versus.click(view);
    const toggled = await versus.click('versus-dm-toggle');
    assert.match(toggled.content, /dinonaktifkan/);
    assert.equal((await store.get(versus.userId))!.notificationSettings?.dm, false);
  });
});

test('components refuse other users and stale lineup rounds', async () => {
  await withStore(async (store) => {
    const owner = new Session(store, '100000000000000004');
    await owner.click('player-create-select', ['DF']);
    const home = await owner.click('menu-versus');
    const intruder = new FakeComponent(`frs:${owner.userId}:profile`, '100000000000000099');
    await handleComponent(intruder as never, store);
    assert.match(intruder.notices[0] ?? '', /bukan milik Anda/);
    const stale = action(home.ids, 'vl:start:').replace(/vl:start:\d+:/, 'vl:start:9:');
    assert.match(await owner.fail(stale), /Round sudah berganti/);
  });
});

test('Earth Cup matches play live from Next Week and the national panel shows the run', async () => {
  await withStore(async (store) => {
    const player = new Session(store, '100000000000000077');
    await player.click('menu-player');
    await player.click('player-country-select', ['IDN']);
    await player.click('player-create-select:IDN', ['ST']);
    const profile = (await store.get(player.userId))!;
    profile.earthCup = createEarthCup('IDN', 2030, 4, true, new SeededRandom(12));
    profile.weekStage = 'SEASON_BREAK';
    profile.unassignedMatchExp = 0;
    await store.save(profile);
    const home = await player.click('menu-player');
    assert.match(JSON.stringify(home.embeds), /Earth Cup/);
    const match = await player.click('next-week');
    assert.equal(match.frames.length, 7, 'kick-off to full-time frames');
    assert.match(match.frames[0].title ?? '', /LIVE · Earth Cup · Grup · Laga 1/);
    assert.match(match.embeds[0].title ?? '', /Earth Cup · Grup · Laga 1/);
    assert.ok(match.embeds[0].fields?.some((field) => field.name.includes('Klasemen grup')));
    const saved = (await store.get(player.userId))!;
    assert.equal(saved.earthCup?.history.length, 1);
    const panel = await player.click('player-earth-cup');
    assert.match(panel.embeds[0].title ?? '', /Earth Cup/);
    assert.match(JSON.stringify(panel.embeds[0]), /Indonesia/);
  });
});
