// Entry for hosts that run `node index.js` directly (e.g. Pella's "Main file"):
// compile the TypeScript sources, then start the bot from dist/.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let tsc;
try {
  tsc = require.resolve('typescript/bin/tsc');
} catch {
  tsc = undefined;
}
if (tsc) execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
else if (!existsSync('./dist/index.js')) throw new Error('TypeScript belum terpasang dan dist/ belum ada. Jalankan `npm install` (tanpa --omit=dev) lalu start ulang.');

await import('./dist/index.js');
