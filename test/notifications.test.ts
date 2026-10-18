import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialProfile } from '../src/domain/engine.js';
import { applyDeliveryOutcome, dueNotifications, enqueueNotification, NOTIFICATION_MAX_ATTEMPTS } from '../src/domain/notification-engine.js';
import type { NotificationRecord, PlayerProfile } from '../src/domain/types.js';
import { NotificationDispatcher, PermanentDeliveryError, type NotificationSender } from '../src/jobs/notification-dispatcher.js';
import { ConcurrentProfileUpdateError } from '../src/storage/errors.js';
import { JsonPlayerStore } from '../src/storage/json-store.js';

const NOW = new Date('2026-03-01T10:00:00.000Z');

function withNotification(userId: string, id = 'n-1'): PlayerProfile {
  const profile = createInitialProfile(userId, `User ${userId}`, 'MF', NOW);
  enqueueNotification(profile, { id, type: 'VERSUS_RESULT', title: 'Battle selesai', lines: ['A 2–1 B'] }, NOW);
  return profile;
}

class RecordingSender implements NotificationSender {
  readonly sent: Array<{ userId: string; id: string }> = [];
  failWith?: Error;
  async send(userId: string, notification: NotificationRecord): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ userId, id: notification.id });
  }
}

async function withStore<T>(run: (store: JsonPlayerStore) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'frs-notify-'));
  try {
    return await run(new JsonPlayerStore(join(directory, 'players.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('enqueue is idempotent per id and keeps pending items when history is evicted', () => {
  const profile = createInitialProfile('notify-idem', 'Idem', 'MF', NOW);
  assert.equal(enqueueNotification(profile, { id: 'same', type: 'VERSUS_RESULT', title: 't', lines: [] }, NOW), true);
  assert.equal(enqueueNotification(profile, { id: 'same', type: 'VERSUS_RESULT', title: 't', lines: [] }, NOW), false);
  assert.equal(profile.notifications!.length, 1);
  for (let index = 0; index < 120; index += 1) {
    enqueueNotification(profile, { id: `n-${index}`, type: 'VERSUS_RESULT', title: 't', lines: [] }, NOW);
    applyDeliveryOutcome(profile, `n-${index}`, { status: 'SENT' }, NOW);
  }
  enqueueNotification(profile, { id: 'pending-last', type: 'VERSUS_DEADLINE', title: 't', lines: [] }, NOW);
  assert.ok(profile.notifications!.length <= 50);
  assert.ok(profile.notifications!.some((item) => item.id === 'same' && item.status === 'PENDING'), 'pending items survive eviction');
  assert.ok(profile.notifications!.some((item) => item.id === 'pending-last'));
});

test('dispatcher delivers once, persists SENT, and never re-sends on the next tick', async () => {
  await withStore(async (store) => {
    await store.save(withNotification('notify-1'));
    const sender = new RecordingSender();
    const dispatcher = new NotificationDispatcher(store, sender);
    const first = await dispatcher.dispatch(NOW);
    assert.equal(first.sent, 1);
    const saved = await store.get('notify-1');
    assert.equal(saved!.notifications![0].status, 'SENT');
    assert.equal(saved!.notifications![0].attempts, 1);
    const second = await new NotificationDispatcher(store, sender).dispatch(new Date(NOW.getTime() + 3_600_000));
    assert.equal(second.sent, 0);
    assert.deepEqual(sender.sent, [{ userId: 'notify-1', id: 'n-1' }]);
  });
});

test('transient failures back off and give up after the attempt budget; permanent ones fail at once', async () => {
  await withStore(async (store) => {
    await store.saveBatch([withNotification('notify-retry'), withNotification('notify-closed')]);
    const sender = new RecordingSender();
    sender.failWith = new Error('Discord 500');
    const dispatcher = new NotificationDispatcher(store, sender);
    let summary = await dispatcher.dispatch(NOW);
    assert.equal(summary.retried, 2);
    let saved = await store.get('notify-retry');
    assert.equal(saved!.notifications![0].status, 'PENDING');
    assert.equal(saved!.notifications![0].nextAttemptAt, new Date(NOW.getTime() + 60_000).toISOString());
    assert.equal(dueNotifications(saved!, new Date(NOW.getTime() + 30_000)).length, 0, 'not due during back-off');

    let clock = NOW.getTime();
    for (let attempt = 2; attempt <= NOTIFICATION_MAX_ATTEMPTS; attempt += 1) {
      clock += 7 * 3_600_000;
      summary = await dispatcher.dispatch(new Date(clock));
    }
    saved = await store.get('notify-retry');
    assert.equal(saved!.notifications![0].status, 'FAILED');
    assert.equal(saved!.notifications![0].attempts, NOTIFICATION_MAX_ATTEMPTS);
    assert.match(saved!.notifications![0].lastError ?? '', /Discord 500/);

    await store.save(withNotification('notify-perm', 'p-1'));
    sender.failWith = new PermanentDeliveryError('Discord 50007: Cannot send messages to this user');
    await dispatcher.dispatch(new Date(clock + 1));
    const permanent = await store.get('notify-perm');
    assert.equal(permanent!.notifications![0].status, 'FAILED');
    assert.equal(permanent!.notifications![0].attempts, 1);
  });
});

test('disabled DM settings skip delivery without calling Discord', async () => {
  await withStore(async (store) => {
    const profile = withNotification('notify-off');
    profile.notificationSettings = { dm: false };
    await store.save(profile);
    const sender = new RecordingSender();
    const summary = await new NotificationDispatcher(store, sender).dispatch(NOW);
    assert.equal(summary.skipped, 1);
    assert.equal(sender.sent.length, 0);
    assert.equal((await store.get('notify-off'))!.notifications![0].status, 'SKIPPED');
  });
});

test('delivery outcome is merged into a profile the player saved meanwhile', async () => {
  await withStore(async (store) => {
    await store.save(withNotification('notify-race'));
    const sender: NotificationSender = {
      async send() {
        // The player acts while the DM is in flight.
        const fresh = await store.get('notify-race');
        fresh!.money = 7_777;
        await store.save(fresh!);
      }
    };
    await new NotificationDispatcher(store, sender).dispatch(NOW);
    const saved = await store.get('notify-race');
    assert.equal(saved!.money, 7_777, 'gameplay saved during delivery is kept');
    assert.equal(saved!.notifications![0].status, 'SENT');
  });
});

test('a sent notification whose status could not be persisted is not sent twice by the same process', async () => {
  await withStore(async (store) => {
    await store.save(withNotification('notify-persist'));
    const sender = new RecordingSender();
    const dispatcher = new NotificationDispatcher(store, sender);
    const realSave = store.save.bind(store);
    store.save = async () => { throw new ConcurrentProfileUpdateError('notify-persist'); };
    await dispatcher.dispatch(NOW);
    store.save = realSave;
    assert.equal((await store.get('notify-persist'))!.notifications![0].status, 'PENDING');
    await dispatcher.dispatch(new Date(NOW.getTime() + 60_000));
    assert.equal(sender.sent.length, 1, 'delivered exactly once');
    assert.equal((await store.get('notify-persist'))!.notifications![0].status, 'SENT');
  });
});
