import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { PlayerProfile } from '../domain/types.js';
import type { BatchPlayerStore, MaintenanceLockStore, PlayerStore, VersusGroupLockStore, VersusQueryStore } from './json-store.js';
import { ConcurrentProfileUpdateError } from './errors.js';

/** FIFO counting semaphore. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      // Hand the slot straight to the next waiter; otherwise free it.
      if (next) next();
      else this.active -= 1;
    };
  }
}

export class PostgresPlayerStore implements BatchPlayerStore, VersusGroupLockStore, MaintenanceLockStore, VersusQueryStore {
  /**
   * A group lock pins one pool client for its whole read-modify-write while the
   * work itself needs other clients, so lock holders are capped below the pool
   * size; otherwise a burst of Versus actions could exhaust the pool and stall.
   */
  private readonly groupLockSlots: Semaphore;

  constructor(private readonly pool: Pool, maxConcurrentGroupLocks = 4) {
    this.groupLockSlots = new Semaphore(Math.max(1, maxConcurrentGroupLocks));
  }

  async get(userId: string): Promise<PlayerProfile | undefined> {
    const result = await this.pool.query<{ payload: PlayerProfile; version: number }>('SELECT payload, version FROM player_profiles WHERE user_id = $1', [userId]);
    const row = result.rows[0];
    if (!row?.payload) return undefined;
    const profile = structuredClone(row.payload);
    profile.version = row.version ?? profile.version ?? 0;
    return profile;
  }

  async save(profile: PlayerProfile): Promise<void> {
    await this.saveBatch([profile]);
  }

  private async syncVersusProjection(client: PoolClient, profile: PlayerProfile, projectedSeasons: Set<string>): Promise<void> {
    const versus = profile.versus;
    if (!versus) return;

    if (versus.matchmaking) {
      await client.query(
        `UPDATE versus_queue_tickets
         SET status = 'EXPIRED', updated_at = NOW()
         WHERE user_id = $1 AND queue_key = $2 AND status IN ('QUEUED', 'MATCHED') AND ticket_id <> $3`,
        [profile.userId, versus.matchmaking.queueKey, versus.matchmaking.ticketId]
      );
      await client.query(
        `INSERT INTO versus_queue_tickets (ticket_id, user_id, queue_key, status, queued_at, matched_at, group_code, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, NOW())
         ON CONFLICT (ticket_id) DO UPDATE SET status = EXCLUDED.status, matched_at = EXCLUDED.matched_at, group_code = EXCLUDED.group_code, updated_at = NOW()`,
        [versus.matchmaking.ticketId, profile.userId, versus.matchmaking.queueKey, versus.matchmaking.status, versus.matchmaking.queuedAt, versus.matchmaking.matchedAt ?? null, versus.matchmaking.groupCode ?? null]
      );
    }

    const season = versus.season;
    // Every member carries the same season copy; project its battles and listings once per batch.
    if (season && !projectedSeasons.has(season.id)) {
      projectedSeasons.add(season.id);
      for (const battle of season.battles) {
        await client.query(
          `INSERT INTO versus_matches (match_id, season_id, group_code, round_id, scheduled_at, home_club_id, away_club_id, state, ruleset_version, updated_at)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, NOW())
           ON CONFLICT (match_id) DO UPDATE SET state = EXCLUDED.state, ruleset_version = EXCLUDED.ruleset_version, updated_at = NOW()`,
          [battle.id, season.id, season.groupCode, battle.roundId, battle.scheduledAt, battle.homeClubId, battle.awayClubId, battle.state, season.rulesetVersion]
        );
      }
      for (const listing of season.market?.listings ?? []) {
        await client.query(
          `INSERT INTO versus_market_listings (listing_id, season_id, source_club_id, player_snapshot, opening_bid, minimum_increment, current_bid, current_bidder_id, starts_at, ends_at, status, ruleset_version, settled_at, winner_club_id, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13::timestamptz, $14, NOW())
           ON CONFLICT (listing_id) DO UPDATE SET current_bid = EXCLUDED.current_bid, current_bidder_id = EXCLUDED.current_bidder_id, status = EXCLUDED.status, settled_at = EXCLUDED.settled_at, winner_club_id = EXCLUDED.winner_club_id, updated_at = NOW()`,
          [listing.id, season.id, listing.sourceClubId, JSON.stringify(listing.player), listing.openingBid, listing.minimumIncrement, listing.currentBid ?? null, listing.currentBidderId ?? null, listing.startsAt, listing.endsAt, listing.status, listing.rulesetVersion, listing.settledAt ?? null, listing.winnerClubId ?? null]
        );
      }
    }

    await client.query('DELETE FROM versus_wallet_reservations WHERE user_id = $1', [profile.userId]);
    if (versus.reservations?.length) {
      await client.query(
        `INSERT INTO versus_wallet_reservations (reservation_id, listing_id, user_id, currency, amount, created_at)
         SELECT x.id, x.listing_id, $1, x.currency, x.amount, x.created_at::timestamptz
         FROM jsonb_to_recordset($2::jsonb) AS x(id text, listing_id text, currency text, amount bigint, created_at text)
         ON CONFLICT (reservation_id) DO UPDATE SET amount = EXCLUDED.amount, created_at = EXCLUDED.created_at`,
        [profile.userId, JSON.stringify(versus.reservations)]
      );
    }
  }

  async saveBatch(profiles: PlayerProfile[]): Promise<void> {
    if (profiles.length === 0) return;
    const seen = new Set<string>();
    for (const profile of profiles) {
      if (seen.has(profile.userId)) throw new Error(`Duplicate profile in batch: ${profile.userId}`);
      seen.add(profile.userId);
    }
    const client = await this.pool.connect();
    const projectedSeasons = new Set<string>();
    const versions = new Map<PlayerProfile, number>();
    try {
      await client.query('BEGIN');
      for (const profile of profiles) {
        const expectedVersion = profile.version ?? 0;
        const result = await client.query<{ version: number }>(
          // A first insert also bumps the version, so two concurrent creators of one profile conflict instead of overwriting.
          `INSERT INTO player_profiles (user_id, payload, updated_at, version)
           VALUES ($1, $2::jsonb, $3::timestamptz, $4::integer + 1)
           ON CONFLICT (user_id) DO UPDATE
           SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at, version = player_profiles.version + 1
           WHERE player_profiles.version = $4::integer
           RETURNING version`,
          [profile.userId, JSON.stringify(profile), profile.updatedAt, expectedVersion]
        );
        if (result.rowCount !== 1) throw new ConcurrentProfileUpdateError(profile.userId);
        versions.set(profile, result.rows[0].version);
        await client.query('DELETE FROM economy_ledger WHERE user_id = $1', [profile.userId]);
        if (profile.ledger?.length) {
          await client.query(
            `INSERT INTO economy_ledger (id, user_id, created_at, entry_type, amount, balance_after, note, mode, currency, transaction_id)
             SELECT x.id, $1, x.created_at::timestamptz, x.entry_type, x.amount, x.balance_after, x.note, 'PLAYER', 'MONEY', x.transaction_id
             FROM jsonb_to_recordset($2::jsonb) AS x(id text, created_at text, entry_type text, amount bigint, balance_after bigint, note text, transaction_id text)
             ON CONFLICT (id) DO NOTHING`,
            [profile.userId, JSON.stringify(profile.ledger)]
          );
        }
        if (profile.versus?.ledger?.length) {
          await client.query(
            `INSERT INTO economy_ledger (id, user_id, created_at, entry_type, amount, balance_after, note, mode, currency, season_id, battle_id, transaction_id)
             SELECT x.id, $1, x.created_at::timestamptz, COALESCE(x.type, 'VERSUS_LEDGER'), x.amount, x.balance_after, x.note, 'VERSUS', x.currency, x.season_id, x.battle_id, x.transaction_id
             FROM jsonb_to_recordset($2::jsonb) AS x(id text, created_at text, type text, amount bigint, balance_after bigint, note text, currency text, season_id text, battle_id text, transaction_id text)
             ON CONFLICT (id) DO NOTHING`,
            [profile.userId, JSON.stringify(profile.versus.ledger)]
          );
        }
        await this.syncVersusProjection(client, profile, projectedSeasons);
      }
      await client.query('COMMIT');
      // Versions change only after COMMIT, so a rolled-back batch leaves callers' copies untouched.
      for (const [profile, version] of versions) profile.version = version;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withMaintenanceLock<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", ['football-rising-star-maintenance']);
      if (!lock.rows[0]?.locked) return undefined;
      try { return await operation(); } finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['football-rising-star-maintenance']); }
    } finally { client.release(); }
  }

  async withVersusGroupLock<T>(groupCode: string, operation: () => Promise<T>): Promise<T> {
    const releaseSlot = await this.groupLockSlots.acquire();
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [groupCode]);
        return await operation();
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [groupCode]);
        } finally {
          client.release();
        }
      }
    } finally {
      releaseSlot();
    }
  }

  async all(): Promise<PlayerProfile[]> {
    const result = await this.pool.query<{ payload: PlayerProfile; version: number }>('SELECT payload, version FROM player_profiles ORDER BY updated_at DESC');
    return result.rows.map((row) => {
      const profile = structuredClone(row.payload);
      profile.version = row.version ?? profile.version ?? 0;
      return profile;
    });
  }

  async versusMembers(filter: { groupCode?: string; prefix?: string }): Promise<PlayerProfile[]> {
    // Equality uses idx_player_profiles_versus_group; left() keeps prefix matching free of LIKE wildcards.
    const result = filter.groupCode !== undefined
      ? await this.pool.query<{ payload: PlayerProfile; version: number }>("SELECT payload, version FROM player_profiles WHERE payload->'versus'->>'groupCode' = $1", [filter.groupCode])
      : await this.pool.query<{ payload: PlayerProfile; version: number }>("SELECT payload, version FROM player_profiles WHERE payload->'versus'->>'groupCode' IS NOT NULL AND left(payload->'versus'->>'groupCode', char_length($1)) = $1", [filter.prefix ?? '']);
    return result.rows.map((row) => {
      const profile = structuredClone(row.payload);
      profile.version = row.version ?? profile.version ?? 0;
      return profile;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
