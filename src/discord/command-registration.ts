import { REST, Routes } from 'discord.js';
import type { RuntimeConfig } from '../config/runtime.js';
import { commandDefinitions, menuFirstCommandDefinitions } from './commands.js';

/**
 * Registers `/play` (plus the fallback commands when REGISTER_FALLBACK_COMMANDS=true)
 * for DISCORD_GUILD_ID, or globally when no guild is set. Shared by
 * `pnpm commands:register` and REGISTER_COMMANDS_ON_START.
 */
export async function registerCommands(config: Pick<RuntimeConfig, 'discordToken' | 'discordClientId' | 'discordGuildId'>, fallback = process.env.REGISTER_FALLBACK_COMMANDS === 'true'): Promise<{ count: number; scope: string }> {
  if (!config.discordClientId) throw new Error('DISCORD_CLIENT_ID wajib diatur untuk command registration.');
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const definitions = fallback ? commandDefinitions : menuFirstCommandDefinitions;
  const route = config.discordGuildId ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId) : Routes.applicationCommands(config.discordClientId);
  await rest.put(route, { body: definitions });
  return { count: definitions.length, scope: config.discordGuildId ? `guild ${config.discordGuildId}` : 'global' };
}
