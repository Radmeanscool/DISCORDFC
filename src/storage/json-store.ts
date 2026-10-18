import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PlayerProfile } from '../domain/types.js';
import { ConcurrentProfileUpdateError } from './errors.js';

export interface PlayerStore {
  get(userId: string): Promise<PlayerProfile | undefined>;
  save(profile: PlayerProfile): Promise<void>;
  all(): Promise<PlayerProfile[]>;
}

export interface BatchPlayerStore extends PlayerStore {
  saveBatch(profiles: PlayerProfile[]): Promise<void>;
}

export interface VersusGroupLockStore extends PlayerStore {
  withVersusGroupLock<T>(groupCode: string, operation: () => Promise<T>): Promise<T>;
}

/** Optional targeted lookup so Versus group operations do not load every profile. */
export interface VersusQueryStore extends PlayerStore {
  /** Profiles whose Versus group code equals `groupCode`, or starts with `prefix` (empty prefix = any group). */
  versusMembers(filter: { groupCode?: string; prefix?: string }): Promise<PlayerProfile[]>;
}

export function matchesVersusFilter(profile: PlayerProfile, filter: { groupCode?: string; prefix?: string }): boolean {
  const code = profile.versus?.groupCode;
  if (!code) return false;
  if (filter.groupCode !== undefined) return code === filter.groupCode;
  return code.startsWith(filter.prefix ?? '');
}

export interface MaintenanceLockStore extends PlayerStore {
  withMaintenanceLock<T>(operation: () => Promise<T>): Promise<T | undefined>;
}

interface StoreFile {
  players: Record<string, PlayerProfile>;
}

export class JsonPlayerStore implements BatchPlayerStore, VersusGroupLockStore, MaintenanceLockStore, VersusQueryStore {
  private cache?: StoreFile;
  private writeTail: Promise<void> = Promise.resolve();
  private readonly groupQueues = new Map<string, Promise<void>>();
  private maintenanceLock: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async load(): Promise<StoreFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      this.cache = parsed.players ? parsed : { players: {} };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== 'ENOENT') throw error;
      this.cache = { players: {} };
    }
    return this.cache;
  }

  async get(userId: string): Promise<PlayerProfile | undefined> {
    const store = await this.load();
    const profile = store.players[userId];
    if (!profile) return undefined;
    profile.version ??= 0;
    return structuredClone(profile);
  }

  async save(profile: PlayerProfile): Promise<void> {
    await this.saveBatch([profile]);
  }

  /**
   * All-or-nothing batch write with optimistic concurrency: every profile must
   * still carry the version it was read with, otherwise nothing is written.
   */
  async saveBatch(profiles: PlayerProfile[]): Promise<void> {
    if (profiles.length === 0) return;
    const next = this.writeTail.catch(() => undefined).then(async () => {
      const store = await this.load();
      const seen = new Set<string>();
      for (const profile of profiles) {
        if (seen.has(profile.userId)) throw new Error(`Duplicate profile in batch: ${profile.userId}`);
        seen.add(profile.userId);
        const stored = store.players[profile.userId];
        if (stored && (stored.version ?? 0) !== (profile.version ?? 0)) throw new ConcurrentProfileUpdateError(profile.userId);
      }
      const players = { ...store.players };
      const versions = new Map<string, number>();
      for (const profile of profiles) {
        const version = (profile.version ?? 0) + 1;
        versions.set(profile.userId, version);
        players[profile.userId] = structuredClone({ ...profile, version });
      }
      await mkdir(dirname(this.path), { recursive: true });
      const tempPath = `${this.path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify({ players }, null, 2)}\n`, 'utf8');
      await rename(tempPath, this.path);
      this.cache = { players };
      for (const profile of profiles) profile.version = versions.get(profile.userId);
    });
    this.writeTail = next;
    await next;
  }

  async withMaintenanceLock<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const previous = this.maintenanceLock;
    let release!: () => void;
    this.maintenanceLock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async withVersusGroupLock<T>(groupCode: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.groupQueues.get(groupCode) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.groupQueues.set(groupCode, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.groupQueues.get(groupCode) === queued) this.groupQueues.delete(groupCode);
    }
  }

  async all(): Promise<PlayerProfile[]> {
    const store = await this.load();
    return Object.values(store.players).map((profile) => { profile.version ??= 0; return structuredClone(profile); });
  }

  async versusMembers(filter: { groupCode?: string; prefix?: string }): Promise<PlayerProfile[]> {
    const store = await this.load();
    return Object.values(store.players).filter((profile) => matchesVersusFilter(profile, filter)).map((profile) => { profile.version ??= 0; return structuredClone(profile); });
  }
}
