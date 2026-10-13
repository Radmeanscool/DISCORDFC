# Football Rising Star Discord Bot

Proyek ini mengembangkan Football Rising Star menjadi pengalaman game berbasis Discord dengan tiga mode terpisah: Player Mode, Coach Mode, dan Versus Mode. Player membangun karier solo; Coach mengelola club melalui season home-away; Versus menjalankan liga multi-club asynchronous dengan group, battle, standings, dan rewards.

> **UX utama:** registry Discord default hanya mendaftarkan **`/play`**. Setelah masuk Game Home, seluruh gameplay dilanjutkan melalui Buttons dan Select Menus. Daftar command detail di bawah adalah compatibility/operator fallback dan hanya didaftarkan jika `REGISTER_FALLBACK_COMMANDS=true`.

> Paket recovery yang tersedia adalah build Unity IL2CPP, bukan source C# dan backend asli. Karena itu, proyek ini membangun ulang loop game dan kontrak domain yang terlihat dari recovery. Formula yang belum dapat dibaca atau divalidasi dari binary diberi konfigurasi terpusat dan ditandai sebagai `RECOVERY_INFERRED`, bukan diklaim identik 1:1.

## Fitur yang tersedia

| Area | Fitur |
| --- | --- |
| Player Mode | Profil GK/DF/MF/FW, six macro abilities, twelve detailed skills, weekly progression, training orders, HP/energy, match, manual EXP, injury, trainers, culture, tricks, awards, retirement/rebirth; conditional career incidents remain evidence-gated |
| Coach Mode | Enam Coach abilities, roster, seven formations, ten tactics, two-half match, halftime context, 38-round home-away season, full projected league standings, board targets, approval, classified management decisions, job offers, isolated Champions League aggregate, retirement/rebirth |
| Versus Mode | System-managed matchmaking/assignment, assigned roster/wallet terpisah, group-code registration fallback, competition sign-up state, pre-match setup interaktif, legal XI/substitute/captain/formation/tactic submission, roster-version/deadline checks, locked snapshots, fast two-half seeded settlement, result/history, standings, Market Deal/Scout surfaces, Sponsor tiers, Rewards, Schedule, Rankings, Global Ranking, lifecycle state, reward ledger |
| Club | Roster, squad rating, dynamic recovered-league fixtures, formation, tactics, assets, prestige |
| Competition | Fixture, matchday, standings, promotion/relegation thresholds, Player Champions League, dan Coach Champions League yang state/season/reward-nya terisolasi |
| Economy | Money, atomic economy ledger, salary, contract, market listing, buy/sell player |
| Progression | Daily reward streak, achievements, MVP, season scoring; unsupported Player daily-event choices are disabled |
| Production | PostgreSQL store dengan optimistic concurrency, atomic multi-profile batch save, advisory group lock untuk Versus, schema migration, JSON-to-PostgreSQL import, Docker image, Compose stack, rate limiter, per-user command queue, structured logging, admin stats |

## Panduan penggunaan

Panduan lengkap untuk player, Coach, Versus, operator, administrator, deployment, fallback commands, troubleshooting, dan batas parity tersedia di [`docs/DISCORD_BOT_PLAYER_ADMIN_GUIDE.md`](docs/DISCORD_BOT_PLAYER_ADMIN_GUIDE.md).
Checklist pengujian sebelum closed beta/public release tersedia di [`docs/RELEASE_READINESS_TEST_PLAN.md`](docs/RELEASE_READINESS_TEST_PLAN.md).

## Slash command fallback / operator

| Command | Fungsi |
| --- | --- |
| `/start position:FW` | Membuat profil pemain dan klub awal |
| `/profile` | Melihat atribut, kondisi, contract, club rating, career stats, dan dashboard tombol interaktif |
| `/train ability:technique` | Melatih ability dan mengonsumsi energy |
| `/match` | Memainkan pertandingan karier pemain |
| `/club` | Melihat club office, resources, strategy, dan next fixture |
| `/clubs league:1011` | Melihat daftar official clubs, ID, grade, dan prestige |
| `/join-club club_id:101102` | Pindah ke official club dari client data |
| `/squad` | Melihat roster dan ID pemain |
| `/formation id:4-3-3` | Mengubah formasi klub |
| `/tactic id:attacking` | Mengubah taktik klub |
| `/club-match` | Memainkan fixture Player Club dan memperbarui standings |
| `/coach-career`, `/coach-profile` | Memulai atau melihat karier Coach |
| `/coach-round`, `/coach-exp`, `/coach-event` | Memainkan round Coach, alokasikan EXP, dan selesaikan classified management decision |
| `/coach-job`, `/coach-retire`, `/coach-rebirth` | Mengelola job offer, retirement, dan rebirth Coach |
| `/league` atau `/standings` | Melihat klasemen dan progres Player Club season |
| `/versus-join group_code:CODE` | Fallback untuk bergabung ke private Versus group dengan group code |
| `/versus-profile`, `/versus-standings` | Membuka Versus Home atau klasemen; assignment system-managed berjalan otomatis |
| `/versus-bid listing_id:<id> amount:<coin>` | Mengajukan bid Deal Versus dengan reservation dan settlement escrow-style |
| Versus Home → `Registration` | Melihat status registrasi, group code, competition, capacity, dan season state |
| Versus Home → `Market` / `Deal` / `Scout` | Membuka market listing Deal berbasis snapshot, bid countdown, reservation, dan tab Scout yang tetap transparan jika ruleset belum terverifikasi |
| Versus Home → `Sponsor` / `Rewards` | Menampilkan sponsor tiers, balance, reward state, dan ledger hasil season; Sponsor claim tetap preview-only sampai cost/effect terkalibrasi |
| Versus Home → `Schedule` / `Rankings` / `Global Ranking` | Membuka jadwal fixture, kategori ranking, dan season-wide ranking |
| Versus Home → `Lineup` / `Next Battle` | Membuka pre-match setup: pilih formation, tactic, XI per posisi, captain, substitutes, review, lalu confirm submission |
| `/versus-lineup battle_id:<id> lineup:<ids> captain:<id> formation:4-4-2 tactic:balanced roster_version:<n>` | Fallback command untuk mengunci submission XI, substitutes opsional, captain, formation, tactic, dan roster version sebelum deadline |
| `/versus-round`, `/versus-season` | Memproses round atau melihat/menutup season Versus |
| `tools/calibrate-player-formulas.ts` | Menghasilkan deterministic Player probe; probe bukan data asli dan tidak menaikkan status formula menjadi official |
| `/season-end` | Memulai season berikutnya setelah seluruh fixture selesai |
| `/contract action:sign` | Menandatangani atau memperpanjang kontrak |
| `/daily` | Mengambil daily reward dan menaikkan streak |
| `/market action:refresh` | Membuat daftar pemain market |
| `/buy-player listing:listing-market-1` | Membeli pemain dari market |
| `/sell-player player:npc-1` | Menjual pemain non-user dari roster |
| `/champions action:status mode:PLAYER|COACH` | Melihat status Champions League pada aggregate Player atau Coach |
| `/champions action:play mode:PLAYER|COACH` | Memainkan ronde Champions League pada mode yang dipilih |
| `/achievements` | Melihat progress achievement |
| `/claim-achievement achievement:appearances-10` | Mengklaim achievement yang siap |
| `/admin action:stats` | Statistik operasi, hanya untuk `ADMIN_USER_IDS` |
| `/admin action:refresh-markets` | Refresh market semua profil, hanya admin |
| `/help` | Melihat bantuan command |

Setelah `/play`, Game Home menyediakan tombol **Player Mode**, **Coach Mode**, dan **Versus Mode**. Seluruh operasi gameplay utama kemudian dilanjutkan melalui button dan select menu yang owner-bound: Player memiliki weekly update, match, EXP, training, recovery, club office, honors, contract, dan Champions; Coach memiliki round, management decision, EXP, formation/tactic, job offer, club office, dan Champions; Versus memiliki assignment, next battle, lineup builder, result, standings, market, rewards, schedule, rankings, dan sponsor surfaces. Command root tetap tersedia sebagai fallback operator, tetapi pengguna normal tidak perlu mengetik command untuk setiap aksi. Versus masuk melalui system matchmaking; `/versus-join` hanya menjadi fallback untuk private group code. Tombol serta select terikat pada Discord user pemilik profile sehingga tidak dapat dipakai user lain. Versus assignment tetap terpisah dari Player dan Coach aggregate.

## Button-driven gameplay

Flow yang direkomendasikan adalah `/play` → pilih mode → pilih aksi pada menu konteks mode → kembali ke home setelah setiap aksi. Player tidak lagi memiliki daily event menu; daily reward, injury/recovery, training, weekly update, match, dan pending EXP memiliki panel masing-masing. Coach `Decision` hanya menampilkan keputusan manajemen ketika event Coach memang pending. Versus tidak membuat pengguna mengetik technical matchmaking command; sistem menyiapkan assignment dan menu **Next Battle/Lineup** menjadi entry pre-match.

## Data client 2.8.0

Audit client terbaru berhasil memparse **332 official club record** dari `cfg_club_202603` dan **5.133 player record fixed-field** dari payload `cfg_player_202603`. Data ini tersimpan di `data/recovery/` dengan provenance dan dimuat oleh `src/config/recovery-data.ts`. Profile baru memulai karier di Arsenal jika data recovery tersedia; roster klub memakai nama player client seperti David Raya, Timber, Saliba, dan Gabriel. Position code mengikuti dump: FW 1–5, MF 6–9, DF 10–12, GK 13.

Field ability dictionary variable-length belum dipaksakan menjadi overall resmi. Overall runtime masih diberi label `RECOVERY_INFERRED`, sedangkan name, club ID, league, position, age, salary, prestige, grade, formations, dan tactics yang diparse langsung diberi label `RECOVERY_VERIFIED`. Endpoint backend dan Remote Config tidak diaktifkan karena audit hanya mengonfirmasi dependency Firebase, bukan endpoint produksi.

## Arsitektur

Engine domain berada di `src/domain/` dan tidak bergantung pada Discord. `engine.ts` menangani Player career dan match; `gameplay-engine.ts` menangani detailed progression; `club-engine.ts` menangani Club state dan club match; `coach-career-engine.ts` menangani Coach career/board/job/event; `versus-engine.ts` menangani Versus aggregates, schedule, settlement, standings, dan rewards; subsistem lain menangani competition, progression, contract, dan official transfer. `src/discord/components.ts` menyediakan Versus Home dan pre-match builder; `src/discord/handlers.ts` menjadi adapter interaction Discord.

Persistence memiliki dua mode. Tanpa `DATABASE_URL`, bot memakai `JsonPlayerStore` untuk development lokal. Dengan `DATABASE_URL`, bot memakai `PostgresPlayerStore`. Keduanya kini memiliki kontrak `saveBatch` untuk menyimpan seluruh projection profile Versus secara atomic dalam satu operasi backend. PostgreSQL juga menyediakan advisory lock per group code; JSON fallback memakai serialized group queue dalam satu process. Schema disediakan pada `src/storage/schema.sql`; script migration dan import JSON berada pada `src/storage/migrate.ts` dan `src/storage/import-json.ts`. PostgreSQL kini memiliki projection tables untuk queue, match, market, reservation, dan ledger; profile JSONB tetap menjadi compatibility projection sementara canonical worker/settlement service multi-replica masih merupakan roadmap.

## Menjalankan secara lokal

Pastikan Node.js 22 atau versi yang lebih baru tersedia. Instal dependency dan buat environment file:

```bash
pnpm install
cp .env.example .env
```

Isi sekurang-kurangnya `DISCORD_TOKEN` dan `DISCORD_CLIENT_ID`. Untuk pengujian cepat pada satu server, isi `DISCORD_GUILD_ID`. Isi `ADMIN_USER_IDS` dengan Discord user ID admin yang dipisahkan koma apabila command admin akan digunakan.

Mode JSON development:

```bash
# kosongkan DATABASE_URL pada .env
pnpm commands:register
pnpm dev
```

Build production:

```bash
pnpm build
pnpm start
```

## Menjalankan dengan PostgreSQL dan Docker

Compose menyediakan service PostgreSQL lokal dan bot. Isi `POSTGRES_PASSWORD` yang kuat di `.env`; bot akan menjalankan migration schema secara otomatis sebelum gateway Discord dinyalakan. Setelah `.env` berisi token Discord:

```bash
docker compose up -d --build
```

Untuk database managed, gunakan `DATABASE_URL` provider tersebut dan jalankan migration dari environment yang dapat mengakses database. Import data JSON lama dapat dilakukan dengan `pnpm db:import-json` setelah `DATABASE_URL` dan `DATA_FILE` diatur.

## Testing dan balance

Perintah berikut menjalankan build dan test:

```bash
pnpm build
pnpm test
```

Test suite saat ini berisi **87 test lulus dan 0 gagal**, termasuk release-readiness invalid transition, economy boundary, match telemetry bounds, weekly UI/state integration, Player/Coach/Versus career, Coach full-league projection, mode isolation, Player/Coach Champions isolation, multi-club fixture, Versus Home/custom-ID ownership, legal Versus lineup submission, two-half settlement, standings, reward ledger idempotency, daily streak, weekly events, market cooldown/transfer guard, contract, achievements, rate limiter, command/group queue, interactive components, atomic JSON batch persistence, dan konfigurasi balance.

Advanced scout dan player-status improvement disebut oleh changelog publik battle mode, tetapi belum diaktifkan sebagai mechanic baru karena harga, offer generation, persistence, dan effect formula tidak tersedia dari bukti publik. Menampilkan UI palsu untuk dua mechanic tersebut akan lebih berisiko daripada menunggu ruleset yang dapat diaudit.

Nilai gameplay yang masih bersifat sementara berada di `src/config/game-balance.ts`. Config menyimpan biaya training/match, recovery, reward, peluang gol, versi balance, dan provenance. Saat formula internal sudah tervalidasi, ubah `source` menjadi `OFFICIAL_CALIBRATED`, tambahkan golden tests, dan catat sumber kalibrasi di `docs/PORTING_MAP.md`.

## Deployment dan operasi

Bot Discord membutuhkan proses yang berjalan terus-menerus. Komputer kantor/server yang sudah tersedia cocok untuk internal testing. Hosting Node.js managed atau VPS lebih cocok untuk operasi publik karena dapat menjalankan restart policy, database terpisah, monitoring, backup, dan secret management. Minimal production hardening yang masih direkomendasikan adalah backup PostgreSQL, TLS pada database managed, structured logging, error alerting, command audit log, dan pemisahan admin user ID dari source code.

Command `/admin` dibatasi oleh native Discord `Manage Guild` permission dan `ADMIN_USER_IDS`. Rate limiter default membatasi satu user sampai 12 interaction per 60 detik pada satu proses. Command mutation user yang sama diserialisasi oleh per-user queue dan PostgreSQL menggunakan optimistic concurrency. Untuk deployment multi-instance, rate limiter dan queue perlu dipindahkan ke Redis atau database agar konsisten antar-instance.

## Batasan parity dengan game asli

Recovery memperlihatkan nama type, field, signature method, RVA, asset, dan binary. Recovery tidak menyediakan source C# identik, body method yang mudah dibaca, server data, secret backend, atau seluruh konfigurasi live. Oleh sebab itu, fitur yang sudah dibuat adalah rebuild fungsional yang mendekati loop game, sedangkan kesamaan formula, nilai balance, roster resmi, nama klub resmi, dan sinkronisasi backend memerlukan data perusahaan yang berwenang.

Fase kalibrasi berikutnya sebaiknya memakai source/config/backend internal yang disetujui untuk mengganti balance inferred, memasukkan roster/club data resmi, memvalidasi standings dan reward, serta menambahkan golden tests dari output game asli.

## Referensi

[1]: https://github.com/atsilahbusiness-design/DISCORDFC "Repository DISCORDFC"
[2]: https://docs.discord.com/developers/topics/oauth2 "Discord Developer Documentation — OAuth2"

Riset dan roadmap internal: `docs/RESEARCH_NOTES.md`, `docs/PROFESSIONAL_ROADMAP.md`, dan `docs/BALANCE_SNAPSHOT.md`.
