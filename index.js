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
let built = false;
if (tsc) {
  console.log('[launcher] Compiling TypeScript sources…');
  try {
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
    built = true;
  } catch {
    // Type packages missing (e.g. install without dev dependencies): fall back to the shipped build.
    console.warn('[launcher] Build TypeScript gagal; memakai dist/ yang sudah ada.');
  }
}
if (built) {
  // Fresh build from src/.
} else if (!existsSync('./dist/index.js')) {
  throw new Error('dist/ belum ada dan build TypeScript tidak tersedia. Jalankan `npm install` (tanpa --omit=dev) lalu start ulang.');
} else if (!tsc) {
  // Without TypeScript the bot would silently run whatever old build is in dist/.
  console.warn('[launcher] PERINGATAN: TypeScript tidak terpasang, menjalankan dist/ yang sudah ada (bisa versi lama). Jalankan `npm install` tanpa --omit=dev atau hapus folder dist/.');
}

await import('./dist/index.js');
