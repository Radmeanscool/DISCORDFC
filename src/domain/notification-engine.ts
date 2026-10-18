import type { NotificationRecord, NotificationType, PlayerProfile } from './types.js';

/**
 * Persisted notification outbox. Producers enqueue with a deterministic id
 * (the idempotency key), so re-running settlement never duplicates a message.
 * Delivery happens later and never rolls back gameplay state.
 */
export const NOTIFICATION_LIMIT = 50;
export const NOTIFICATION_MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];

export interface NotificationInput {
  id: string;
  type: NotificationType;
  title: string;
  lines: string[];
}

export function enqueueNotification(profile: PlayerProfile, input: NotificationInput, now: Date): boolean {
  profile.notifications ??= [];
  if (profile.notifications.some((item) => item.id === input.id)) return false;
  profile.notifications.push({ ...input, mode: 'VERSUS', createdAt: now.toISOString(), status: 'PENDING', attempts: 0, nextAttemptAt: now.toISOString() });
  // Evict delivered history first; pending messages are only dropped past a hard safety cap.
  while (profile.notifications.length > NOTIFICATION_LIMIT) {
    const index = profile.notifications.findIndex((item) => item.status !== 'PENDING');
    if (index === -1) break;
    profile.notifications.splice(index, 1);
  }
  if (profile.notifications.length > NOTIFICATION_LIMIT * 2) profile.notifications = profile.notifications.slice(-NOTIFICATION_LIMIT * 2);
  return true;
}

export function dueNotifications(profile: PlayerProfile, now: Date): NotificationRecord[] {
  return (profile.notifications ?? []).filter((item) => item.status === 'PENDING' && new Date(item.nextAttemptAt ?? item.createdAt).getTime() <= now.getTime());
}

export type DeliveryOutcome = { status: 'SENT' } | { status: 'SKIPPED'; reason: string } | { status: 'RETRY'; error: string } | { status: 'FAILED'; error: string };

export function applyDeliveryOutcome(profile: PlayerProfile, id: string, outcome: DeliveryOutcome, now: Date): void {
  const record = profile.notifications?.find((item) => item.id === id);
  if (!record || record.status !== 'PENDING') return;
  record.attempts += 1;
  if (outcome.status === 'SENT') {
    record.status = 'SENT';
    record.sentAt = now.toISOString();
    record.lastError = undefined;
    record.nextAttemptAt = undefined;
  } else if (outcome.status === 'SKIPPED') {
    record.status = 'SKIPPED';
    record.lastError = outcome.reason;
    record.nextAttemptAt = undefined;
  } else if (outcome.status === 'FAILED' || record.attempts >= NOTIFICATION_MAX_ATTEMPTS) {
    record.status = 'FAILED';
    record.lastError = outcome.error;
    record.nextAttemptAt = undefined;
  } else {
    record.lastError = outcome.error;
    record.nextAttemptAt = new Date(now.getTime() + RETRY_DELAYS_MS[Math.min(RETRY_DELAYS_MS.length - 1, record.attempts - 1)]).toISOString();
  }
}

export function dmEnabled(profile: PlayerProfile): boolean {
  return profile.notificationSettings?.dm !== false;
}
