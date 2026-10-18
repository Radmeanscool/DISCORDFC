import 'dotenv/config';
import { mkdir, readFile as readTextFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Client, DiscordAPIError, EmbedBuilder, Events, GatewayIntentBits } from 'discord.js';
import { Pool } from 'pg';
import { acknowledge, handleCommand, handleComponent, notice } from './discord/handlers.js';
import { registerCommands } from './discord/command-registration.js';
import { UserCommandQueue } from './discord/command-queue.js';
import { UserRateLimiter } from './discord/rate-limit.js';
import { runMaintenance, runVersusMaintenance } from './jobs/maintenance.js';
import { BackgroundWorker, createMaintenanceWorker } from './jobs/background-worker.js';
import { NotificationDispatcher, PermanentDeliveryError, type NotificationSender } from './jobs/notification-dispatcher.js';
import { log } from './observability/logger.js';
import { loadRuntimeConfig } from './config/runtime.js';
import { BUILD_LABEL } from './config/build-info.js';
import { JsonPlayerStore } from './storage/json-store.js';
import { PostgresPlayerStore } from './storage/postgres-store.js';
import type { MaintenanceLockStore, PlayerStore } from './storage/json-store.js';

const config = loadRuntimeConfig();
const token = config.discordToken;
const runtimeLockFile = process.env.RUNTIME_LOCK_FILE ?? './data/discord-bot.lock';
let releaseRuntimeLock: (() => Promise<void>) | undefined;

async function acquireRuntimeLock(): Promise<void> {
  await mkdir(dirname(runtimeLockFile), { recursive: true });
  try {
    await writeFile(runtimeLockFile, `${process.pid}\n`, { flag: 'wx' });
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const owner = Number.parseInt((await readTextFile(runtimeLockFile, 'utf8')).trim(), 10);
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        throw new Error(`Another DISCORDFC process is already running (pid ${owner}). Stop it before starting a second gateway instance.`);
      } catch (probeError) {
        if (probeError instanceof Error && probeError.message.includes('already running')) throw probeError;
      }
    }
    await rm(runtimeLockFile, { force: true });
    await writeFile(runtimeLockFile, `${process.pid}\n`, { flag: 'wx' });
  }
  releaseRuntimeLock = async () => {
    try {
      const owner = Number.parseInt((await readTextFile(runtimeLockFile, 'utf8')).trim(), 10);
      if (owner === process.pid) await rm(runtimeLockFile, { force: true });
    } catch {
      // Best-effort cleanup; a future process can reclaim a stale lock.
    }
  };
}

await acquireRuntimeLock();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, application_name: 'football-rising-star-discord' }) : undefined;
const store: PlayerStore = pool ? new PostgresPlayerStore(pool) : new JsonPlayerStore(config.dataFile);
const rateLimiter = new UserRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
const mutationRateLimiter = new UserRateLimiter(Math.max(3, Math.floor(config.rateLimitMax / 2)), Math.min(config.rateLimitWindowMs, 10_000));
const mutationCommands = new Set(['player', 'coach', 'versus', 'admin']);
const commandQueue = new UserCommandQueue();
const maintenanceWorker = createMaintenanceWorker(async () => {
  const run = async (): Promise<void> => {
    const now = new Date();
    const profiles = await runMaintenance(store, now);
    const versusSettled = await runVersusMaintenance(store, now);
    log('info', 'maintenance_completed', { profiles, versusSettled });
  };
  const lockStore = store as Partial<MaintenanceLockStore>;
  if (typeof lockStore.withMaintenanceLock === 'function') {
    await lockStore.withMaintenanceLock(run);
    return;
  }
  await run();
}, config.maintenanceIntervalMs);

/** Discord errors that retrying cannot fix: DMs closed (50007) or the user no longer exists (10013). */
const PERMANENT_DM_ERRORS = new Set([50007, 10013]);
const dmSender: NotificationSender = {
  async send(userId, notification) {
    try {
      const user = await client.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setColor('#1f8b4c')
        .setTitle(notification.title.slice(0, 256))
        .setDescription(notification.lines.join('\n').slice(0, 4_000))
        .setFooter({ text: 'Football Rising Star · Versus · DM dapat dimatikan dari Versus Home' })
        .setTimestamp(new Date(notification.createdAt));
      await user.send({ embeds: [embed] });
    } catch (error) {
      if (error instanceof DiscordAPIError && PERMANENT_DM_ERRORS.has(Number(error.code))) throw new PermanentDeliveryError(`Discord ${error.code}: ${error.message}`);
      throw error;
    }
  }
};
const dispatcher = new NotificationDispatcher(store, dmSender);
const notificationWorker = new BackgroundWorker({
  name: 'notifications',
  intervalMs: config.notificationIntervalMs,
  task: async () => {
    const run = async (): Promise<void> => {
      const summary = await dispatcher.dispatch(new Date());
      if (summary.sent || summary.failed || summary.retried) log('info', 'notifications_dispatched', { ...summary });
    };
    const lockStore = store as Partial<MaintenanceLockStore>;
    // Same cross-instance lock as maintenance, so two gateway instances never DM the same outbox.
    if (typeof lockStore.withMaintenanceLock === 'function') await lockStore.withMaintenanceLock(run);
    else await run();
  }
});

client.once(Events.ClientReady, (readyClient) => {
  log('info', 'bot_ready', { build: BUILD_LABEL, user: readyClient.user.tag, persistence: pool ? 'postgresql' : 'json', environment: config.nodeEnv, maintenanceIntervalMs: config.maintenanceIntervalMs, notificationIntervalMs: config.notificationIntervalMs });
  // Panel hosts often cannot run `pnpm commands:register` separately; opt in to registering here.
  if (process.env.REGISTER_COMMANDS_ON_START === 'true') {
    registerCommands({ ...config, discordClientId: config.discordClientId ?? readyClient.application.id })
      .then((result) => log('info', 'commands_registered', result))
      .catch((error) => log('error', 'commands_register_failed', { error }));
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.user?.bot) return;
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const scope = interaction.isChatInputCommand() ? interaction.commandName : interaction.customId.split(':', 1)[0];
  const receivedAt = Date.now();
  const interactionAgeMs = receivedAt - interaction.createdTimestamp;
  const ackStartedAt = receivedAt;
  log('info', 'interaction_received', { scope, userId: interaction.user.id, interactionAgeMs });
  try {
    await acknowledge(interaction);
    log('info', 'interaction_acknowledged', { scope, userId: interaction.user.id, interactionAgeMs, ackLatencyMs: Date.now() - ackStartedAt });
  } catch (error) {
    log('error', 'interaction_ack_failed', { scope, userId: interaction.user.id, interactionAgeMs, ackLatencyMs: Date.now() - ackStartedAt, error });
    return;
  }
  if (!rateLimiter.consume(interaction.user.id, Date.now(), 'global') || (interaction.isChatInputCommand() && mutationCommands.has(interaction.commandName) && !mutationRateLimiter.consume(interaction.user.id, Date.now(), 'mutation'))) {
    log('warn', 'interaction_rate_limited', { userId: interaction.user.id, scope });
    await notice(interaction, 'Terlalu banyak aksi dalam waktu singkat. Coba lagi sebentar.').catch((error) => log('error', 'rate_limit_notice_failed', { error }));
    return;
  }
  if (interaction.isChatInputCommand()) {
    await commandQueue.run(interaction.user.id, () => handleCommand(interaction, store));
  } else {
    await commandQueue.run(interaction.user.id, () => handleComponent(interaction, store));
  }
});

client.on(Events.Error, (error) => log('error', 'discord_client_error', { error }));

let shuttingDown = false;
const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutdown_requested', { signal, exitCode });
  maintenanceWorker.stop();
  notificationWorker.stop();
  client.destroy();
  if (pool) await pool.end();
  if (releaseRuntimeLock) await releaseRuntimeLock();
  process.exitCode = exitCode;
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log('error', 'unhandled_rejection', { reason }));
process.on('uncaughtException', (error) => {
  log('error', 'uncaught_exception', { error });
  void shutdown('uncaughtException', 1);
});

await client.login(token);
maintenanceWorker.start();
notificationWorker.start();
