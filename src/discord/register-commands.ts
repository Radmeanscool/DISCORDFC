import { REST, Routes } from 'discord.js';
import { commandDefinitions, menuFirstCommandDefinitions } from './commands.js';
import { loadRuntimeConfig } from '../config/runtime.js';

const config = loadRuntimeConfig();
const clientId = config.discordClientId;
if (!clientId) throw new Error('DISCORD_CLIENT_ID wajib diatur untuk command registration.');

const rest = new REST({ version: '10' }).setToken(config.discordToken);
const route = config.discordGuildId ? Routes.applicationGuildCommands(clientId, config.discordGuildId) : Routes.applicationCommands(clientId);
const definitions = process.env.REGISTER_FALLBACK_COMMANDS === 'true' ? commandDefinitions : menuFirstCommandDefinitions;
await rest.put(route, { body: definitions });
console.log(config.discordGuildId ? `Registered ${definitions.length} command(s) untuk guild ${config.discordGuildId}.` : `Registered ${definitions.length} global command(s).`);
console.log(process.env.REGISTER_FALLBACK_COMMANDS === 'true' ? 'Fallback slash commands aktif; gameplay tetap button-first.' : 'Mode button-first aktif; detail slash commands tidak didaftarkan.');
