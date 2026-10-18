import { recoverPlayer } from '../domain/engine.js';
import { syncAchievements } from '../domain/competition-engine.js';
import { getContractStatus } from '../domain/contract-engine.js';
import type { PlayerProfile } from '../domain/types.js';
import { log } from '../observability/logger.js';
import { catchUpVersusGroup, findVersusMembers } from '../services/versus-service.js';
import { isConcurrentProfileUpdate } from '../storage/errors.js';
import type { BatchPlayerStore, PlayerStore } from '../storage/json-store.js';

/** Profiles saved by an interaction this recently are left for the next tick instead of racing the player's own write. */
const RECENT_ACTIVITY_MS = 120_000;

function maintenanceDirty(before: PlayerProfile, after: PlayerProfile): boolean {
  return before.hp !== after.hp
    || before.energy !== after.energy
    || before.contract?.state !== after.contract?.state
    || JSON.stringify(before.achievements ?? null) !== JSON.stringify(after.achievements ?? null);
}

/** Real-time recovery, achievement progress, and legacy contract expiry. Only changed profiles are written. */
export async function runMaintenance(store: PlayerStore, now = new Date()): Promise<number> {
  const profiles = await store.all();
  for (const profile of profiles) {
    const age = now.getTime() - new Date(profile.updatedAt).getTime();
    if (age >= 0 && age < RECENT_ACTIVITY_MS) continue;
    const updated = syncAchievements(recoverPlayer(profile, now));
    const contract = getContractStatus(updated, now);
    if (contract) updated.contract = contract;
    if (!maintenanceDirty(profile, updated)) continue;
    try {
      await store.save(updated);
    } catch (error) {
      // The player acted between our read and write; their save wins and the next tick retries.
      if (!isConcurrentProfileUpdate(error)) throw error;
    }
  }
  return profiles.length;
}

/**
 * Advances every active Versus group: due rounds, season end, market expiry and
 * refresh, and the DM notifications for each. Groups are isolated: one failing
 * group is logged and the rest still run. Returns settled battles + listings.
 */
export async function runVersusMaintenance(store: PlayerStore, now = new Date()): Promise<number> {
  if (typeof (store as Partial<BatchPlayerStore>).saveBatch !== 'function') return 0;
  const groupCodes = new Set<string>();
  for (const profile of await findVersusMembers(store, { prefix: '' })) {
    const versus = profile.versus;
    if (versus?.groupCode && versus.season?.state === 'ACTIVE') groupCodes.add(versus.groupCode);
  }
  let settled = 0;
  for (const groupCode of groupCodes) {
    try {
      const { result } = await catchUpVersusGroup(store, groupCode, now);
      if (result?.changed) settled += result.settledBattles + result.settledListings;
    } catch (error) {
      log('error', 'versus_group_maintenance_failed', { groupCode, error });
    }
  }
  return settled;
}
