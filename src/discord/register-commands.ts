import { loadRuntimeConfig } from '../config/runtime.js';
import { registerCommands } from './command-registration.js';

const fallback = process.env.REGISTER_FALLBACK_COMMANDS === 'true';
const { count, scope } = await registerCommands(loadRuntimeConfig(), fallback);
console.log(scope === 'global' ? `Registered ${count} global command(s).` : `Registered ${count} command(s) untuk ${scope}.`);
console.log(fallback ? 'Fallback slash commands aktif; gameplay tetap button-first.' : 'Mode button-first aktif; detail slash commands tidak didaftarkan.');
