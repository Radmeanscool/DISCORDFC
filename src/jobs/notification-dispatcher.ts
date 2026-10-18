import { applyDeliveryOutcome, dmEnabled, dueNotifications, type DeliveryOutcome } from '../domain/notification-engine.js';
import type { NotificationRecord } from '../domain/types.js';
import { log } from '../observability/logger.js';
import { isConcurrentProfileUpdate } from '../storage/errors.js';
import type { PlayerStore } from '../storage/json-store.js';

/** Delivers one notification to the user's DM. Throw PermanentDeliveryError when retrying cannot help. */
export interface NotificationSender {
  send(userId: string, notification: NotificationRecord): Promise<void>;
}

export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

export interface DispatchSummary {
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}

const PERSIST_ATTEMPTS = 5;
const SENT_MEMORY_MS = 24 * 3_600_000;

/**
 * Outbox dispatcher. Delivery is at-least-once across restarts and effectively
 * once within a process: an id that was sent but whose SENT status could not be
 * persisted is remembered and never re-sent. Outcomes are written by re-reading
 * the profile, so delivery never overwrites gameplay saved in the meantime.
 */
export class NotificationDispatcher {
  private readonly recentlySent = new Map<string, number>();

  constructor(private readonly store: PlayerStore, private readonly sender: NotificationSender, private readonly maxPerTick = 50) {}

  async dispatch(now = new Date()): Promise<DispatchSummary> {
    const summary: DispatchSummary = { sent: 0, skipped: 0, retried: 0, failed: 0 };
    this.forgetOld(now);
    let budget = this.maxPerTick;
    for (const profile of await this.store.all()) {
      if (budget <= 0) break;
      const due = dueNotifications(profile, now);
      if (due.length === 0) continue;
      const outcomes = new Map<string, DeliveryOutcome>();
      for (const notification of due) {
        if (budget <= 0) break;
        if (this.recentlySent.has(notification.id)) {
          outcomes.set(notification.id, { status: 'SENT' });
          continue;
        }
        if (!dmEnabled(profile)) {
          outcomes.set(notification.id, { status: 'SKIPPED', reason: 'DM notification dinonaktifkan oleh user.' });
          summary.skipped += 1;
          continue;
        }
        budget -= 1;
        try {
          await this.sender.send(profile.userId, notification);
          this.recentlySent.set(notification.id, now.getTime());
          outcomes.set(notification.id, { status: 'SENT' });
          summary.sent += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof PermanentDeliveryError) {
            outcomes.set(notification.id, { status: 'FAILED', error: message });
            summary.failed += 1;
          } else {
            outcomes.set(notification.id, { status: 'RETRY', error: message });
            summary.retried += 1;
          }
        }
      }
      await this.persist(profile.userId, outcomes, now);
    }
    return summary;
  }

  private async persist(userId: string, outcomes: Map<string, DeliveryOutcome>, now: Date): Promise<void> {
    for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt += 1) {
      const fresh = await this.store.get(userId);
      if (!fresh) return;
      for (const [id, outcome] of outcomes) applyDeliveryOutcome(fresh, id, outcome, now);
      try {
        await this.store.save(fresh);
        return;
      } catch (error) {
        if (!isConcurrentProfileUpdate(error)) throw error;
      }
    }
    log('warn', 'notification_outcome_not_persisted', { userId, notifications: [...outcomes.keys()] });
  }

  private forgetOld(now: Date): void {
    for (const [id, sentAt] of this.recentlySent) if (now.getTime() - sentAt > SENT_MEMORY_MS) this.recentlySent.delete(id);
  }
}

export async function dispatchNotifications(store: PlayerStore, sender: NotificationSender, now = new Date()): Promise<DispatchSummary> {
  return new NotificationDispatcher(store, sender).dispatch(now);
}
