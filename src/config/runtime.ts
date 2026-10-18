import 'dotenv/config';

export type RuntimeConfig = {
  discordToken: string;
  discordClientId?: string;
  discordGuildId?: string;
  databaseUrl?: string;
  dataFile: string;
  nodeEnv: string;
  adminUserIds: Set<string>;
  maintenanceIntervalMs: number;
  /** How often the DM outbox is drained. */
  notificationIntervalMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib diatur.`);
  return value;
}

function positiveInteger(name: string, fallback: number, minimum: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} harus integer >= ${minimum}.`);
  return value;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const discordToken = env.DISCORD_TOKEN?.trim();
  if (!discordToken) throw new Error('DISCORD_TOKEN belum diatur.');
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL wajib diatur pada NODE_ENV=production; JSON fallback hanya untuk development.');
  }
  const dataFile = env.DATA_FILE?.trim() || './data/players.json';
  const adminUserIds = new Set((env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  const intervalRaw = env.MAINTENANCE_INTERVAL_MS;
  const maintenanceIntervalMs = intervalRaw === undefined || intervalRaw.trim() === '' ? 15 * 60_000 : Number(intervalRaw);
  if (!Number.isInteger(maintenanceIntervalMs) || maintenanceIntervalMs < 1_000) throw new Error('MAINTENANCE_INTERVAL_MS harus integer >= 1000.');
  // Button-driven panels need several clicks per action (a lineup is ~10), so the default allows 30 per window.
  const rateLimitMax = env.RATE_LIMIT_MAX === undefined || env.RATE_LIMIT_MAX.trim() === '' ? 30 : Number(env.RATE_LIMIT_MAX);
  const rateLimitWindowMs = env.RATE_LIMIT_WINDOW_MS === undefined || env.RATE_LIMIT_WINDOW_MS.trim() === '' ? 60_000 : Number(env.RATE_LIMIT_WINDOW_MS);
  if (!Number.isInteger(rateLimitMax) || rateLimitMax < 1) throw new Error('RATE_LIMIT_MAX harus integer >= 1.');
  if (!Number.isInteger(rateLimitWindowMs) || rateLimitWindowMs < 1_000) throw new Error('RATE_LIMIT_WINDOW_MS harus integer >= 1000.');
  const notificationIntervalMs = positiveInteger('NOTIFICATION_INTERVAL_MS', 60_000, 5_000, env);
  return { discordToken, discordClientId: env.DISCORD_CLIENT_ID?.trim() || undefined, discordGuildId: env.DISCORD_GUILD_ID?.trim() || undefined, databaseUrl, dataFile, nodeEnv, adminUserIds, maintenanceIntervalMs, notificationIntervalMs, rateLimitMax, rateLimitWindowMs };
}

export function parsePositiveInteger(name: string, fallback: number, minimum: number, env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(name, fallback, minimum, env);
}
