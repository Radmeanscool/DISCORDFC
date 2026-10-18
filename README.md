# Football Rising Star Discord Bot

Proyek ini mengembangkan Football Rising Star menjadi pengalaman game berbasis Discord dengan tiga mode terpisah: Player Mode, Coach Mode, dan Versus Mode. Player membangun karier solo; Coach mengelola club melalui season home-away; Versus menjalankan liga multi-club asynchronous dengan group, battle, standings, dan rewards.

> **UX utama:** registry Discord default hanya mendaftarkan **`/play`**. Setelah masuk Game Home, seluruh gameplay dilanjutkan melalui Buttons dan Select Menus. Daftar command detail di bawah adalah compatibility/operator fallback dan hanya didaftarkan jika `REGISTER_FALLBACK_COMMANDS=true`.

> Paket recovery yang tersedia adalah build Unity IL2CPP, bukan source C# dan backend asli. Karena itu, proyek ini membangun ulang loop game dan kontrak domain yang terlihat dari recovery. Formula yang belum dapat dibaca atau divalidasi dari binary diberi konfigurasi terpusat dan ditandai sebagai `RECOVERY_INFERRED`, bukan diklaim identik 1:1.

## Fitur yang tersedia

| Area | Fitur |
| --- | --- |
| Player Mode | Atlet 15 tahun di klub starter dengan kontrak awal. Weekly loop: Next Week (recovery, gaji, trainer, event) → Play Match (fixture liga klub, performa personal: gol/assist/rating/kartu/MVP) → Assign EXP (1 skill atau dibagi rata ke beberapa skill). Regular Training 1x/minggu, detailed training, culture, tricks yang menambah peluang gol/rating, cedera & skors, season penuh sesuai jumlah fixture liga, World Footballer & honors dari statistik season, kontrak per season + kenaikan gaji, transfer window + tawaran klub akhir season, pensiun & rebirth dengan riwayat karier |
| Coach Mode | Klub Coach terpisah dari atlet Player. Enam ability Coach berefek nyata di pertandingan (formasi, taktik, comeback, perkembangan, moral, approval board). Board target dari peringkat ekspektasi, pemecatan di tengah season, job offer berbasis reputasi, transfer market memakai assets klub, Season Settlement dengan ringkasan promosi/degradasi, Champions League terpisah, pensiun/rebirth |
| Versus Mode | Liga huruf S→A→B→C→D→E tanpa negara; klub baru mulai di Liga E, rank 1–2 promosi, 2 terbawah degradasi. Kekuatan NPC naik per tier. Lineup builder (formation, tactic, XI per posisi, captain, subs, Auto XI) dengan deadline per round; battle diproses otomatis. Attack/defence/control terpisah dengan matchup taktik, HP/cedera/skors berefek, gol/assist/clean sheet tercatat, pemain berkembang & menua. Market lelang coin (reservation, anti-snipe, kedalaman NPC dilindungi), Squad (lepas pemain), Scout, Sponsor, Rewards, Rankings. Next Season menerapkan promosi/degradasi lalu membuat season di liga tujuan. Semua notifikasi gameplay Versus dikirim via DM (bisa dimatikan) |
| Competition | Liga domestik recovered (England/Spain/Italy/Germany/France, divisi 1–3) dengan promosi/degradasi 3 klub, klasemen penuh, Champions League untuk 4 teratas divisi 1 (lawan kontinental, adu penalti, ronde tersebar di kalender liga) |
| Economy | Money & ledger atomik, gaji mingguan, kontrak, achievements, daily reward; Versus memakai money/coin sendiri |
| Production | Optimistic concurrency (JSON & PostgreSQL) — tidak ada lost update; batch save atomik untuk grup Versus; advisory lock per grup dengan batas koneksi; maintenance worker (recovery, round/season Versus, lelang); worker DM outbox dengan retry/backoff & idempotency; panel ephemeral diperbarui di tempat; rate limiter; per-user command queue; structured logging |

## Panduan penggunaan

Panduan lengkap untuk player, Coach, Versus, operator, administrator, deployment, fallback commands, troubleshooting, dan batas parity tersedia di [`docs/DISCORD_BOT_PLAYER_ADMIN_GUIDE.md`](docs/DISCORD_BOT_PLAYER_ADMIN_GUIDE.md).
Checklist pengujian sebelum closed beta/public release tersedia di [`docs/RELEASE_READINESS_TEST_PLAN.md`](docs/RELEASE_READINESS_TEST_PLAN.md).
Laporan audit & perbaikan parity terbaru: [`docs/AUDIT_FIX_REPORT_2026-10-18.md`](docs/AUDIT_FIX_REPORT_2026-10-18.md).

## Slash command fallback / operator

Registry default hanya `/play`. Command berikut hanya didaftarkan jika `REGISTER_FALLBACK_COMMANDS=true` dan dibalas secara ephemeral.

| Command | Fungsi |
| --- | --- |
| `/player career start position:FW` | Membuat profil atlet (klub starter + kontrak awal) |
| `/player career profile` · `next-week` · `match` · `league` | Weekly hub, weekly update, pertandingan, klasemen |
| `/player career injury` · `contract` · `champions` · `daily` · `retire` · `rebirth` | Recovery/treatment, kontrak (view/sign), Champions League, daily reward, pensiun, rebirth |
| `/player training train` · `skills` · `train-skill` · `assign-exp` · `trick` · `trainer` · `culture` | Regular/detailed training, alokasi EXP, trick, trainer, culture study |
| `/player club overview` · `list` · `join` · `squad` · `standings` | Club office atlet, daftar klub, transfer (dengan syarat rating & transfer window), roster |
| `/player honors list` · `world-footballer` · `achievements` · `claim` | Hall of Honor dan achievement |
| `/coach career` · `profile` · `round` · `event` · `exp` · `formation` · `tactic` · `job` · `retire` · `rebirth` · `champions` | Karier Coach |
| `/versus home` · `roster` · `standings` · `lineup` · `bid` · `join` | Versus Home, squad, klasemen, lineup manual, bid, private group |
| `/admin action:stats` · `action:run-maintenance` | Statistik operasi / jalankan maintenance sekarang (hanya `ADMIN_USER_IDS`) |
| `/help` | Panduan singkat |

Setelah `/play`, Game Home menyediakan tombol **Player Mode**, **Coach Mode**, dan **Versus Mode**. Klik pertama dari pesan `/play` membuka panel pribadi (ephemeral); klik berikutnya di panel itu memperbarui panel yang sama di tempat. Tombol dan select terikat pada user pemilik sehingga tidak bisa dipakai user lain. Player, Coach, dan Versus tidak berbagi progression.

## Button-driven gameplay

- **Player**: Player Status · Training · Personal · Club · Career / Next Week · Play Match · Assign EXP · Recovery / Weekly Event · Daily · Contract · Honors · Champions. Club panel berisi League Table, Squad, Transfer Offers, dan Change Club (aktif saat transfer window). Career panel berisi riwayat season/generasi, Retire (konfirmasi), dan Rebirth dengan pilihan posisi.
- **Coach**: Profile · Play Round · Club Office · Decision / Coach EXP · Formation/Tactic · Job Offers · Champions / Transfer Market · Season Settlement · Career.
- **Versus**: Home · Lineup · Results · Standings · Schedule / Market · Squad · Scout · Sponsor · Rankings / Rewards · Registration · Global Ranking · DM On/Off. Setelah season selesai: Next Season.

## Data client 2.8.0

Audit client terbaru berhasil memparse **332 official club record** dari `cfg_club_202603` dan **5.133 player record fixed-field** dari payload `cfg_player_202603`. Data ini tersimpan di `data/recovery/` dengan provenance dan dimuat oleh `src/config/recovery-data.ts`. Profile baru memulai karier di klub starter grade rendah yang dipilih deterministik dari league 1011; klub besar seperti Arsenal dibuka melalui jalur transfer Club Office. Roster klub memakai nama player client sesuai official club ID. Position code dipetakan runtime sebagai FW 1–4, MF 5–9, DF 10–12, GK 13.

Field ability dictionary variable-length belum dipaksakan menjadi overall resmi. Overall runtime masih diberi label `RECOVERY_INFERRED`, sedangkan name, club ID, league, position, age, salary, prestige, grade, formations, dan tactics yang diparse langsung diberi label `RECOVERY_VERIFIED`. Endpoint backend dan Remote Config tidak diaktifkan karena audit hanya mengonfirmasi dependency Firebase, bukan endpoint produksi.

## Arsitektur

- `src/domain/` — engine murni tanpa Discord. `engine.ts` (profil, recovery real-time per jam penuh, regular training), `gameplay-engine.ts` (weekly loop, EXP, trainer, event, cedera, pensiun/rebirth, `createPlayerCareer`), `player-match-engine.ts` (fixture atlet, performa personal, akhir season, World Footballer), `skill-engine.ts`, `player-formulas.ts`, `league-engine.ts` (kekuatan klub, jadwal circle-method, simulasi round lain, promosi/degradasi), `club-engine.ts`, `coach-career-engine.ts`, `competition-engine.ts` (Champions League, achievements), `contract-engine.ts`, `official-club-engine.ts`, `progression-engine.ts` (daily reward, Coach transfer market), `versus-engine.ts`, `versus-economy.ts`, `versus-club-engine.ts` (release/sponsor/scout), `notification-engine.ts` + `versus-notifications.ts` (outbox DM).
- `src/services/versus-service.ts` — application service grup Versus: lock grup, pemilihan season kanonik, assignment public league per tier (`PUB-<tier>-<YYMMDD>-<NN>`), private group, catch-up (round jatuh tempo, akhir season, lelang, siklus market baru, pengingat deadline) yang dipakai bersama oleh panel Discord dan worker.
- `src/jobs/` — `maintenance.ts` (recovery/achievement/kontrak lama + catch-up semua grup Versus aktif), `notification-dispatcher.ts` (kirim DM, backoff 1m→6h, maks 5 percobaan, error permanen 50007/10013), `background-worker.ts` (single-flight).
- `src/discord/` — `components.ts` (custom id pendek `frs:<user>:<aksi>`, lineup `vl:<langkah>:<round>:<versi roster>`), `embeds.ts`, `handlers.ts` (router aksi bersama untuk tombol & fallback command, retry otomatis saat konflik versi).
- `src/storage/` — `JsonPlayerStore` (development) dan `PostgresPlayerStore` dengan optimistic concurrency (`ConcurrentProfileUpdateError`), `saveBatch` atomik, `versusMembers` (query grup terindeks), advisory lock per grup.

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

```bash
pnpm build
pnpm test
```

Test suite saat ini berisi **126 test lulus dan 0 gagal**, termasuk alur handler end-to-end dengan interaksi Discord tiruan (validasi batas Discord: custom id ≤ 100, ≤ 5 baris, ≤ 25 opsi, id unik, ukuran embed), migrasi save versi lama, service grup Versus (assignment, lineup, outbid DM, round & season, Next Season), outbox DM (delivery, retry/backoff, error permanen, idempotency), konkurensi storage (stale write ditolak, batch all-or-nothing, batas koneksi lock grup), serta regresi parity (recovery per jam, kurva skill, output gol per posisi, rebirth, efek ability Coach, kekuatan tier Versus, cedera/skors).

Alat verifikasi tambahan:

```bash
pnpm exec tsx tools/targeted-audit.ts      # temuan parity dengan angka terukur
SIM_TRIALS=50 pnpm exec tsx tools/stress-simulation.ts   # invariant + determinisme ketiga mode
```

Nilai gameplay yang masih bersifat sementara berada di `src/config/game-balance.ts` dengan provenance `RECOVERY_INFERRED`. Saat formula internal sudah tervalidasi, ubah `source` menjadi `OFFICIAL_CALIBRATED`, tambahkan golden tests, dan catat sumber kalibrasi di `docs/PORTING_MAP.md`.

## Deployment dan operasi

Bot Discord membutuhkan proses yang berjalan terus-menerus. Komputer kantor/server yang sudah tersedia cocok untuk internal testing. Hosting Node.js managed atau VPS lebih cocok untuk operasi publik karena dapat menjalankan restart policy, database terpisah, monitoring, backup, dan secret management. Minimal production hardening yang masih direkomendasikan adalah backup PostgreSQL, TLS pada database managed, structured logging, error alerting, command audit log, dan pemisahan admin user ID dari source code.

Command `/admin` dibatasi oleh native Discord `Manage Guild` permission dan `ADMIN_USER_IDS`. Rate limiter default membatasi satu user sampai 30 interaction per 60 detik pada satu proses (panel tombol butuh beberapa klik per aksi). Worker DM berjalan tiap `NOTIFICATION_INTERVAL_MS` (default 60 detik) di bawah lock maintenance yang sama sehingga dua instance tidak mengirim DM ganda; bot hanya bisa DM user yang berada di server yang sama dan tidak menutup DM. Command mutation user yang sama diserialisasi oleh per-user queue dan PostgreSQL menggunakan optimistic concurrency. Untuk deployment multi-instance, rate limiter dan queue perlu dipindahkan ke Redis atau database agar konsisten antar-instance.

### Update roster dari database online (Transfermarkt, CC0)

Decode `cfg_player` tidak lengkap: klub divisi satu rata-rata hanya punya 7–14 pemain (Liverpool 13 pemain, tanpa Salah atau Szoboszlai), harga selalu 37, dan usia 12–60. Roster bisa diperbarui dari dataset [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (lisensi CC0, data terakhir per 6 Juli 2026 = skuad akhir musim 2025/26, sama dengan musim club list APK):

```bash
# unduh players.csv.gz + clubs.csv.gz ke data/external/transfermarkt/ (lihat data/external/README.md)
pnpm data:import-players --snapshot 2026-07-06
```

Importer mencocokkan klub per liga (divisi satu EN/ES/IT/DE/FR, Portugal, Rusia, Belanda, Belgia, dan klub kontinental yang liganya tercakup), lalu menulis `data/external/player-overlay.json`. Loader mengganti roster klub yang tercocokkan dengan skuad asli (nama, posisi, usia dari tanggal lahir, nilai pasar); klub lain (divisi 2–3, klub fiktif) tetap memakai roster APK. Overall pemain impor diurutkan menurut nilai pasar di dalam band ±6 kekuatan klub yang sama dengan roster APK (`RECOVERY_INFERRED`), jadi balance antar-klub tidak berubah. Hapus file overlay atau set `PLAYER_OVERLAY_FILE=off` untuk kembali ke roster APK.

## Batasan parity dengan game asli

Recovery memperlihatkan nama type, field, signature method, RVA, asset, dan binary. Recovery tidak menyediakan source C# identik, body method yang mudah dibaca, server data, secret backend, atau seluruh konfigurasi live. Oleh sebab itu, fitur yang sudah dibuat adalah rebuild fungsional yang mendekati loop game, sedangkan kesamaan formula, nilai balance, roster resmi, nama klub resmi, dan sinkronisasi backend memerlukan data perusahaan yang berwenang.

Fase kalibrasi berikutnya sebaiknya memakai source/config/backend internal yang disetujui untuk mengganti balance inferred, memasukkan roster/club data resmi, memvalidasi standings dan reward, serta menambahkan golden tests dari output game asli.

## Referensi

[1]: https://github.com/atsilahbusiness-design/DISCORDFC "Repository DISCORDFC"
[2]: https://docs.discord.com/developers/topics/oauth2 "Discord Developer Documentation — OAuth2"

Riset dan roadmap internal: `docs/RESEARCH_NOTES.md`, `docs/PROFESSIONAL_ROADMAP.md`, dan `docs/BALANCE_SNAPSHOT.md`.
