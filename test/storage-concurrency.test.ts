import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createInitialProfile } from '../src/domain/engine.js';
import { JsonPlayerStore } from '../src/storage/json-store.js';
import { isConcurrentProfileUpdate } from '../src/storage/errors.js';
import { PostgresPlayerStore } from '../src/storage/postgres-store.js';

test('JSON batch save persists all profiles atomically and increments versions together', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-batch-store-'));
  const path = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(path);
    const first = createInitialProfile('batch-1', 'Batch One', 'GK');
    const second = createInitialProfile('batch-2', 'Batch Two', 'FW');
    await store.saveBatch([first, second]);
    assert.equal(first.version, 1);
    assert.equal(second.version, 1);
    assert.equal((await store.get(first.userId))?.version, 1);
    assert.equal((await store.get(second.userId))?.version, 1);

    const before = await readFile(path, 'utf8');
    await assert.rejects(store.saveBatch([first, first]), /Duplicate profile in batch/);
    assert.equal(await readFile(path, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON Versus group lock serializes same-group operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-group-lock-'));
  const path = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(path);
    const events: string[] = [];
    await Promise.all([
      store.withVersusGroupLock('LOCK-GROUP', async () => {
        events.push('first-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push('first-end');
      }),
      store.withVersusGroupLock('LOCK-GROUP', async () => {
        events.push('second-start');
        events.push('second-end');
      })
    ]);
    assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON store rejects a stale write instead of silently losing the newer update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-stale-'));
  const path = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(path);
    await store.save(createInitialProfile('stale-1', 'Stale', 'MF'));
    const first = (await store.get('stale-1'))!;
    const second = (await store.get('stale-1'))!;
    first.money = 111;
    await store.save(first);
    second.money = 222;
    await assert.rejects(store.save(second), (error: unknown) => isConcurrentProfileUpdate(error));
    assert.equal((await store.get('stale-1'))!.money, 111);
    // A fresh store over the same file sees the committed state.
    assert.equal((await new JsonPlayerStore(path).get('stale-1'))!.money, 111);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a batch containing one stale profile writes nothing at all', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frs-stale-batch-'));
  const path = join(directory, 'players.json');
  try {
    const store = new JsonPlayerStore(path);
    await store.saveBatch([createInitialProfile('batch-a', 'A', 'MF'), createInitialProfile('batch-b', 'B', 'FW')]);
    const a = (await store.get('batch-a'))!;
    const b = (await store.get('batch-b'))!;
    const concurrentB = (await store.get('batch-b'))!;
    concurrentB.money = 5;
    await store.save(concurrentB);
    a.money = 999;
    b.money = 999;
    const before = await readFile(path, 'utf8');
    await assert.rejects(store.saveBatch([a, b]), (error: unknown) => isConcurrentProfileUpdate(error));
    assert.equal(await readFile(path, 'utf8'), before);
    assert.equal((await store.get('batch-a'))!.money, 1_000);
    assert.equal(a.version, 1, 'caller copies keep their version after a rejected batch');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Postgres Versus group locks pin at most the configured number of pool clients', async () => {
  let connected = 0;
  let maxConnected = 0;
  const pool = {
    async connect() {
      connected += 1;
      maxConnected = Math.max(maxConnected, connected);
      return { async query() { return { rows: [], rowCount: 0 }; }, release() { connected -= 1; } };
    }
  };
  const store = new PostgresPlayerStore(pool as never, 2);
  let running = 0;
  let maxRunning = 0;
  const order: number[] = [];
  await Promise.all(Array.from({ length: 6 }, (_, index) => store.withVersusGroupLock(`GROUP-${index}`, async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(index);
    running -= 1;
  })));
  assert.equal(maxRunning, 2);
  assert.equal(maxConnected, 2);
  assert.equal(connected, 0, 'every client is released');
  assert.equal(order.length, 6);
  await assert.rejects(store.withVersusGroupLock('GROUP-ERR', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(connected, 0, 'a failing operation still releases its client and slot');
  await store.withVersusGroupLock('GROUP-AFTER', async () => undefined);
});
