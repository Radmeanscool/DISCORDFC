import assert from 'node:assert/strict';
import test from 'node:test';
import { registerCommands } from '../src/discord/command-registration.js';

test('command registration needs the application id before calling Discord', async () => {
  await assert.rejects(registerCommands({ discordToken: 'unused', discordClientId: undefined, discordGuildId: undefined }), /DISCORD_CLIENT_ID/);
});
