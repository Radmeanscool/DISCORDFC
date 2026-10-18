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
if (tsc) {
  console.log('[launcher] Compiling TypeScript sources…');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
} else if (existsSync('./dist/index.js')) {
  // Without TypeScript the bot would silently run whatever old build is in dist/.
  console.warn('[launcher] PERINGATAN: TypeScript tidak terpasang, menjalankan dist/ yang sudah ada (bisa versi lama). Jalankan `npm install` tanpa --omit=dev atau hapus folder dist/.');
} else {
  throw new Error('TypeScript belum terpasang dan dist/ belum ada. Jalankan `npm install` (tanpa --omit=dev) lalu start ulang.');
}

await import('./dist/index.js');
