# AI Handoff — Football Rising Star Discord Bot

**Tanggal:** 2026-10-16
**Repository:** `atsilahbusiness-design/DISCORDFC`
**Branch:** `main`
**Commit terakhir saat handoff:** `6b5e1c1`
**Bahasa kerja:** Indonesia
**Bot:** `DC-FC#0177`
**Runtime terakhir:** development, JSON persistence, maintenance worker aktif

---

## 0. Pembaruan 2026-10-18 — audit parity & perbaikan

Branch: `claude/dazzling-ritchie-rsmqre`. Detail temuan, perbaikan, audit ulang, dan angka verifikasi ada di [`AUDIT_FIX_REPORT_2026-10-18.md`](AUDIT_FIX_REPORT_2026-10-18.md). Status singkat roadmap P0 (bagian 10):

| P0 | Status |
|---|---|
| Persisted Versus notification + delivery DM | ✅ Outbox per profil (`notification-engine.ts`, `versus-notifications.ts`) + `NotificationDispatcher` + worker DM di `index.ts` |
| Idempotency key + retry | ✅ ID deterministik per event; backoff 1m→6h, maks 5 percobaan, error permanen 50007/10013; diuji di `test/notifications.test.ts` |
| Season rollover | ✅ `rolloverVersusClub` (idempoten via `lastRolloverSeasonId`) dipicu tombol **Next Season** |
| Juara & runner-up naik tier | ✅ Grade dipindahkan saat rollover, lalu season baru dibuat di liga tujuan (`startNextVersusSeason`); diuji di `test/versus-service.test.ts` |
| Ownership club/group terkunci | ✅ Club terkunci di group sampai season selesai; tidak ada transfer club Versus |
| Test concurrency settlement & DM queue | ✅ Catch-up paralel memproses round sekali; batch save all-or-nothing; outcome DM digabung ke profil terbaru |
| DM gagal tidak membatalkan settlement | ✅ Delivery terpisah dari settlement; kegagalan hanya menandai record notifikasi |

Perubahan besar lain: Player memakai fixture liga klub + performa personal + season penuh; recovery per jam penuh; Coach ability berefek + pemecatan + transfer market; Versus tier S→E dengan NPC per tier, taktik/formasi berpengaruh, cedera/skors, market terlindungi, assignment public league `PUB-<tier>-<YYMMDD>-<NN>`; optimistic concurrency pada JSON & PostgreSQL; panel ephemeral diperbarui di tempat; custom id lineup pendek (round + versi roster). Test: **126/126**.

Aturan pada bagian 11 tetap berlaku dan dipatuhi oleh perubahan ini.

### 0.1 Roster eksternal (Transfermarkt, CC0)

- `pnpm data:import-players` (`tools/import-player-data.ts`, logika di `src/config/transfermarkt-import.ts`) membangun `data/external/player-overlay.json` dari dataset CC0 transfermarkt-datasets (snapshot 6 Juli 2026, musim 2025/26).
- `src/config/recovery-data.ts` menerapkan overlay lewat `applyPlayerOverlay`: roster klub resmi yang cocok diganti skuad asli, klub lain tetap memakai roster APK. File APK di `data/recovery/` tidak diubah.
- Overall pemain impor = kekuatan klub ±6 menurut nilai pasar (`RECOVERY_INFERRED`, band sama dengan roster APK). Versus tidak memakai overlay.
- Status: overlay asli sudah dibuat (snapshot 2026-07-06): 120 klub divisi satu EN/ES/IT/DE/FR + PT/RU/NL/BE + 12 klub pool 9001, 3.587 pemain. Nilai pasar dikoreksi usia (`abilityValue`). Divisi 2–3 dan klub fiktif tetap roster APK. Panduan: `data/external/README.md`.

---

## 1. Tujuan Produk

Proyek ini adalah adaptasi **Football Rising Star** ke Discord menggunakan satu public slash command:

```text
/play
```

Setelah `/play`, seluruh gameplay utama dijalankan melalui **Discord Buttons, Select Menus, dan Embed**. Slash commands detail tetap ada sebagai fallback internal/opsional, tetapi tidak menjadi UX utama.

Produk memiliki tiga mode yang harus dipisahkan secara tegas:

| Mode | Definisi produk | Data utama |
|---|---|---|
| **Player Mode** | Karier satu atlet sepak bola | Player profile, skill, injury, contract, club career |
| **Coach Mode** | Karier pelatih dan manajemen klub single-player/AI | Coach career, coach club, roster, board, fixture |
| **Versus Multiplayer** | Mode online club-management multiplayer mandiri | Versus club, online league, roster, lineup, market, battle |

### Aturan paling penting

Versus **bukan** Player Career yang diberi PvP dan **bukan** Coach Career yang diberi matchmaking. Versus memiliki aggregate, roster, wallet, season, liga, market, fixture, battle, reward, dan progression sendiri.

---

## 2. Definisi Versus yang Benar

Versus adalah:

> Mode manajemen klub multiplayer online berbasis liga bertingkat huruf. User memiliki satu klub Versus sendiri, mengelola roster dan lineup, mengikuti season online, memainkan scheduled battle, berkompetisi dalam standings, menggunakan market, dan menerima hasil/notifikasi melalui DM Discord.

### Versus tidak memakai

- data Player club;
- Player money;
- Player skill progression;
- Player transfer contract;
- Coach club;
- Coach roster;
- Coach wallet;
- Player/Coach league table;
- perpindahan club Player;
- negara sebagai pilihan setup Versus.

### Struktur liga Versus

Liga Versus hanya memakai **huruf**, bukan negara dan bukan nama liga resmi negara:

```text
S → A → B → C → D → E
```

Aturan promosi:

- peringkat 1: naik satu kasta;
- peringkat 2: naik satu kasta;
- klub terbawah dapat turun kasta jika aturan degradasi diaktifkan;
- perpindahan dilakukan ketika season selesai dan season baru dibuat;
- klub tidak boleh dipindahkan ke club/owner/group lain sebagai operasi transfer.

Di source, `grade` masih dipertahankan sebagai nilai internal untuk kompatibilitas, tetapi UI sudah diarahkan menggunakan kode huruf melalui `versusLeagueCode()`.

Contoh:

```text
grade 0 → Liga S
grade 1 → Liga A
grade 2 → Liga B
grade 3 → Liga C
grade 4 → Liga D
grade 5 → Liga E
```

**Penting (diperbarui 2026-10-18):** rollover season dan perpindahan grade permanen sudah diimplementasikan; grade berpindah saat pemain menekan **Next Season**, lalu season baru dibuat di liga tujuan. Club dari skala grade lama dimulai ulang di Liga E tanpa promosi ganda.

### Notification Versus

Format notification yang diinginkan adalah **DM Discord langsung ke user**.

DM dapat dikirim untuk:

- klub berhasil masuk liga;
- lineup deadline akan segera berakhir;
- battle selesai;
- hasil pertandingan tersedia;
- reward battle diterima;
- season selesai;
- promosi ke kasta berikutnya;
- degradasi;
- bid auction dikalahkan;
- auction berhasil dimenangkan;
- auction expired;
- reward season tersedia;
- lineup atau roster ditolak karena stale version.

Jangan mengirim notifikasi gameplay Versus ke channel publik kecuali administrator secara eksplisit meminta audit channel.

---

## 3. Flow Game APK Asli — Player Mode

Riset visual menunjukkan Player Mode sebagai karier satu atlet yang menu-driven dan match-nya disimulasikan.

### Flow utama Player

```text
Player onboarding
    ↓
Player Home / status hub
    ↓
Lihat tanggal, age, club, league, energy, HP, fixture
    ↓
Training / Personal / Club / Contract
    ↓
Weekly event jika dipicu
    ↓
Next Week / Next Round
    ↓
Scheduled match disimulasikan
    ↓
Match result
    ↓
Pending EXP
    ↓
Assign EXP ke detailed skill
    ↓
League table, career log, award, next fixture
```

### Player visual surface yang teramati

- usia awal sekitar 15;
- posisi pemain;
- club dan league;
- fixture berikutnya;
- energy/stamina;
- HP dan injury status;
- ability dan detailed skills;
- regular training;
- trick training;
- personal training;
- trainer Junior/Senior/Expert;
- rest/recovery;
- injury treatment;
- match rating sekitar 0–10;
- score, goals, assists;
- kartu kuning/merah;
- suspension;
- MVP;
- season appearances/goals/assists;
- EXP hasil match;
- league table;
- Q League/Champions-like competition;
- Earth Cup/national call-up;
- awards;
- Hall of Honor;
- salary dan contract;
- ask for pay;
- renew/negotiate;
- transfer/request leave;
- retirement;
- rebirth.

### 12 detailed skills yang terlihat dalam laporan visual

```text
Shots
Penalty
Header
Pass
Dribbling
Free Kick
Off-ball Running
Hold Off Defenders
Teamwork
Endurance
Speed
Willpower
```

### Event Player

Event muncul sebagai bagian dari weekly timeline, bukan command harian terpisah. Contoh event yang terlihat atau tercatat dalam laporan:

- interview/media;
- sponsor/commercial;
- culture study;
- teammates birthday;
- meal/movie/fishing;
- coach rebuke;
- formation discussion;
- club decoration;
- practice;
- fans/social media;
- dinner/rumor;
- injury/medical incident;
- lifestyle choice;
- windfall/treasure;
- King of Soccer.

Choice dapat memengaruhi:

- EXP;
- energy/stamina;
- teamwork;
- willpower;
- fans/charm/fame;
- money;
- club impression.

### Player yang sudah ada di repo

`src/domain/gameplay-engine.ts` memiliki:

- `preparePlayerWeek()`;
- `playPreparedWeek()`;
- `assignMatchExp()`;
- `trainDetailedSkill()`;
- `startTrickTraining()`;
- trainer;
- culture study;
- injury treatment;
- weekly event;
- sponsor event;
- retirement/rebirth;
- annual award.

State utama:

```text
READY
MATCH_READY
EVENT_PENDING
EXP_PENDING
SEASON_BREAK
```

Test UI memverifikasi flow:

```text
READY → MATCH_READY → EXP_PENDING → READY
```

### Gap Player

- full August–May calendar belum lengkap;
- multi-competition schedule masih simplified;
- contract lifecycle belum sepenuhnya seperti APK;
- negotiation/transfer offer belum lengkap;
- red-card suspension belum sepenuhnya dimodelkan;
- rich match receipt belum menyajikan seluruh MVP/cards/substitution context;
- award/Hall categories belum lengkap;
- retirement history belum append-only per career generation;
- exact formulas tidak boleh diklaim sama dengan APK.

---

## 4. Flow Game APK Asli — Coach Mode

Coach Mode adalah karier manajemen klub single-player/AI, bukan Versus Multiplayer.

### Flow utama Coach

```text
Coach onboarding
    ↓
Pilih/terima job offer klub
    ↓
Coach Home / Club Office
    ↓
Lihat board target, roster, budget, fixture, standing
    ↓
Atur formation dan tactic
    ↓
Kelola roster/staff/market
    ↓
Lihat opponent preview
    ↓
Simulasi babak pertama
    ↓
Keputusan halftime
    ↓
Simulasi babak kedua
    ↓
Match result dan MVP
    ↓
EXP Coach / board outcome
    ↓
Round berikutnya / season settlement
```

### Coach visual surface

- coach identity, nationality, age;
- coach abilities;
- job offers dari beberapa club;
- salary dan target;
- club office;
- roster;
- staff;
- budget;
- board target;
- job security;
- formation;
- delapan gaya tactic;
- lineup;
- opponent information;
- halftime decision;
- substitution;
- morale;
- finance;
- discipline;
- media/press;
- locker room;
- medical/team doctor;
- youth/academy;
- promotion/relegation;
- QCL/Champions-like competition;
- job offer baru;
- dismissal;
- retirement/rebirth.

### Coach yang sudah ada di repo

- Coach career aggregate;
- enam Coach abilities;
- Coach EXP;
- board target;
- Coach event blocking;
- fixture dan standings;
- club formation/tactic;
- job offers;
- Coach Champions League;
- Coach retirement/rebirth;
- mode isolation dari Player dan Versus.

### Gap Coach

- onboarding job offer belum sepenuhnya multi-club seperti APK;
- Coach List/Scout/Deal market belum lengkap;
- lineup/substitution/halftime editor masih simplified;
- academy/youth system belum menjadi aggregate nyata;
- event catalog masih lebih kecil dari laporan visual;
- board target dan promotion/relegation rules masih reconstructed.

---

## 5. Flow Game APK Asli — Versus Multiplayer

Versus visual berbeda dari Player dan Coach. Ia menampilkan club-management online dengan waktu, registration, scheduled battle, roster, lineup, market, sponsor, rewards, dan rankings.

### Flow target Versus

```text
Versus Home
    ↓
Klub Versus milik user
    ↓
Liga huruf dan season aktif
    ↓
Group/competition registration
    ↓
Roster management
    ↓
Lineup / formation / tactic
    ↓
Pre-match preview
    ↓
Submit lineup sebelum deadline
    ↓
Scheduled battle diproses server/worker
    ↓
Hasil battle dan match statistics
    ↓
Standings dan reward
    ↓
DM notification
    ↓
Season end
    ↓
Promosi juara dan runner-up
    ↓
Season baru pada kasta berikutnya
```

### Versus visual surface

Laporan visual Versus menunjukkan:

- Versus dashboard;
- next match/countdown;
- latest result;
- club ranking;
- lineup;
- match preview lawan;
- attack/defence/strength comparison;
- star players;
- Deal market;
- Scout tab;
- Sponsor tier;
- rewards;
- Top Scorers;
- Saves;
- Tackles;
- club detail;
- fixtures;
- My Schedule;
- Global Ranking.

### Hal yang tidak boleh diasumsikan

- tidak ada pemilihan negara dalam desain produk yang telah dikoreksi;
- liga bukan liga negara, tetapi tier huruf;
- Versus bukan transfer club;
- user tidak memindahkan club Versus ke club lain;
- real-time PvP belum terbukti; model paling aman adalah asynchronous/server-synchronized;
- formula matchmaking, reward, market, Scout, Sponsor, dan battle tetap configurable sampai bukti authoritative tersedia.

### Versus yang sudah ada di repo

`src/domain/versus-engine.ts` menyediakan:

- VersusClub;
- ownerId;
- roster 18 pemain;
- Versus wallet;
- Versus coin;
- queue;
- group enrollment;
- season;
- group-scoped competition;
- home-away battle;
- standings;
- lineup validation;
- formation/tactic;
- captain;
- substitutes;
- roster version;
- deadline;
- two-half settlement;
- rewards;
- history;
- sync idempotency.

`src/domain/versus-economy.ts` menyediakan:

- Deal listing;
- bid;
- reservation;
- minimum increment;
- outbid release;
- auction expiry;
- settlement;
- Versus coin ledger;
- roster snapshot transfer.

`src/domain/versus-matchmaking.ts` menyediakan:

- queue ticket;
- TTL;
- rating snapshot;
- rating window;
- deterministic assignment.

### Versus state isolation

Mode isolation test membuktikan bahwa:

```text
Player club change ≠ Coach club change ≠ Versus club change
Player wallet ≠ Coach wallet ≠ Versus wallet
Player roster ≠ Coach roster ≠ Versus roster
Player league ≠ Coach league ≠ Versus league
```

### Gap Versus

- custom club creation flow masih belum lengkap;
- source masih membuat `${displayName} FC` otomatis;
- country selector harus tidak dibuat;
- tier letter UI baru dipetakan dari internal grade;
- actual season rollover belum otomatis mengubah league;
- DM notification belum diimplementasikan;
- Scout masih preview;
- Sponsor masih preview;
- notification retry/DM failure handling belum ada;
- canonical shared repository belum lengkap;
- full promotion/relegation lifecycle belum selesai;
- public assignment dan queue matcher perlu disatukan;
- immutable club/group ownership perlu diperkuat di semua lifecycle.

---

## 6. Discord UX

### Public entry

Default public registration hanya:

```text
/play
```

`REGISTER_FALLBACK_COMMANDS=true` dapat dipakai operator untuk mendaftarkan slash fallback detail ketika debugging atau migration.

### Game Home

Game Home menampilkan tiga slot mode:

```text
Player
Coach
Versus Multiplayer
```

Semua button harus owner-bound, contohnya:

```text
frs:<discord_user_id>:<action>
```

Button milik user lain harus ditolak.

### Player menu

Primary buttons mengikuti stage:

- Weekly Update;
- Training;
- Skills;
- Match;
- Assign EXP;
- League;
- Club;
- Events;
- Injury;
- Contract;
- Retirement/Rebirth.

### Coach menu

- Coach Home;
- Club Office;
- Play Round;
- Formation;
- Tactic;
- Coach EXP;
- Decisions;
- Job Offers;
- Champions;
- Honors.

### Versus menu

- Versus Home;
- Registration;
- Queue/Join;
- Roster;
- Lineup;
- Formation;
- Tactic;
- Match Preview;
- Schedule;
- Results;
- Standings;
- Rankings;
- Market;
- Deal;
- Scout;
- Sponsor;
- Rewards.

### DM notification UX

DM harus berbentuk embed atau pesan ringkas yang jelas:

```text
[Versus] Battle selesai
Liga: A
Season: 2026-S1
DC-FC 2–1 Rival FC
Posisi klasemen: #2
Reward: 250 money + 2 coin
Next battle: 16 Oktober 20:00
```

Untuk promosi:

```text
Selamat! Klub Anda finis di posisi #1.
Promosi: Liga A → Liga S
Promosi berlaku pada season berikutnya.
```

Jika DM gagal:

- state gameplay tetap tersimpan;
- error dicatat melalui logger;
- notifikasi harus memiliki idempotency key;
- worker dapat mencoba ulang tanpa menggandakan DM.

---

## 7. Provenance dan Aturan Riset

Setiap klaim harus diberi kategori:

| Label | Arti |
|---|---|
| `VIDEO_OBSERVED` | Terlihat pada video/screenshot walkthrough |
| `PUBLIC_OFFICIAL` | Listing atau materi resmi |
| `COMMUNITY` | Wiki atau laporan komunitas |
| `SOURCE_CODE_VERIFIED` | Ada di source repo |
| `TEST_VERIFIED` | Dibuktikan automated test |
| `RECOVERY_INFERRED` | Rekonstruksi yang belum pasti |

Jangan mengubah `RECOVERY_INFERRED` menjadi fakta APK.

Hal yang tidak boleh diklaim identik dengan APK tanpa bukti tambahan:

- formula rating;
- formula goal chance;
- EXP coefficient;
- injury chance/duration;
- match reward;
- market pricing;
- Scout cost/effect;
- Sponsor payout;
- matchmaking rating window;
- promotion/relegation exact rule;
- retirement inheritance;
- rebirth bonus;
- backend API/auth;
- anti-cheat;
- real-time networking.

---

## 8. File Penting di Repository

### Source domain

```text
src/domain/types.ts
src/domain/engine.ts
src/domain/gameplay-engine.ts
src/domain/contract-engine.ts
src/domain/club-engine.ts
src/domain/official-club-engine.ts
src/domain/coach-career-engine.ts
src/domain/versus-engine.ts
src/domain/versus-economy.ts
src/domain/versus-matchmaking.ts
```

### Discord

```text
src/discord/commands.ts
src/discord/components.ts
src/discord/handlers.ts
src/discord/register-commands.ts
src/index.ts
```

### Worker dan storage

```text
src/jobs/maintenance.ts
src/jobs/background-worker.ts
src/storage/json-store.ts
src/storage/postgres-store.ts
src/storage/schema.sql
```

### Test penting

```text
test/mode-isolation.test.ts
test/versus-mode.test.ts
test/versus-economy.test.ts
test/versus-matchmaking.test.ts
test/weekly-ui-integration.test.ts
test/release-readiness.test.ts
test/components.test.ts
test/registry-and-schema.test.ts
```

### Dokumen riset

```text
docs/FOOTBALL_RISING_STAR_GAMEPLAY_RESEARCH_2026-10-11.md
docs/FOOTBALL_RISING_STAR_VISUAL_ANALYSIS_SYNTHESIS_2026-10-16.md
docs/PLAYER_WEEKLY_EVENTS.md
docs/DISCORD_PLAYER_WEEKLY_MENU_UX.md
docs/DISCORD_COMMAND_LAYOUT.md
docs/VERSUS_ONLY_VIDEO_RESEARCH_2026-08-22.md
docs/VERSUS_MODE_RECOVERY_RESEARCH.md
docs/VERSUS_TRUTH_MATRIX.md
docs/VERSUS_MATCH_FLOW_CORRECTION.md
docs/VERSUS_MODE_CONCEPT_SPEC.md
docs/COACH_MODE_VIDEO_RESEARCH.md
docs/COACH_MULTIPLAYER_RECOVERY_FINDINGS.md
docs/TECHNICAL_GAMEPLAY_STATE_MATRIX_2026-08-26.md
```

---

## 9. Test dan Runtime Terakhir

> Status terbaru ada di bagian 0 (126/126 test). Catatan di bawah adalah snapshot 2026-10-16.

Validasi terakhir setelah perubahan tier huruf:

```text
pnpm build       ✅
pnpm test        ✅ 88/88
 git diff --check ✅
```

Bot terakhir:

```text
DC-FC#0177       ✅ READY
Persistence      JSON
Environment      development
Maintenance      aktif
```

Command registration:

```text
Registered 1 global command(s).
Mode button-first aktif.
```

Repository:

```text
main...origin/main ✅
Commit: 6b5e1c1
```

---

## 10. Roadmap Implementasi Berikutnya

### P0 — wajib sebelum public release

1. Implementasikan persisted Versus notification job dengan delivery DM.
2. Tambahkan notification idempotency key dan retry.
3. Implementasikan season rollover.
4. Pindahkan juara dan runner-up ke tier huruf berikutnya.
5. Kunci club/group ownership agar tidak dapat berpindah.
6. Tambahkan test concurrency untuk settlement dan DM queue.
7. Pastikan DM gagal tidak membatalkan settlement gameplay.

### P1 — parity gameplay

1. Versus full standings dan season result receipt.
2. Scout mutation dengan ruleset configurable.
3. Sponsor contract/payout/cooldown.
4. Next battle countdown.
5. Match preview lengkap.
6. Result statistics.
7. Ranking Top Scorer, Saves, Tackles.
8. Coach academy/youth layer.
9. Player contract/transfer lifecycle.
10. Player discipline/suspension.

### P2 — scale dan operasional

1. Canonical PostgreSQL Versus repository.
2. Worker lease untuk multi-instance.
3. Settlement audit record.
4. Repair/replay job.
5. DM delivery metrics.
6. Rate limit dan anti-abuse market.
7. Admin dashboard untuk season/league/notification.

---

## 11. Instruksi untuk AI Berikutnya

Sebelum mengubah source:

1. Baca dokumen ini.
2. Baca `docs/FOOTBALL_RISING_STAR_VISUAL_ANALYSIS_SYNTHESIS_2026-10-16.md`.
3. Jalankan `git status --short --branch`.
4. Jangan menganggap perubahan user yang belum di-commit sebagai bug.
5. Jalankan `pnpm build && pnpm test` setelah perubahan.
6. Jangan menghapus attachment atau `.env` user.
7. Jangan mencetak token Discord.
8. Jangan menambahkan country selector ke Versus.
9. Jangan menghubungkan Versus ke Player/Coach wallet atau roster.
10. Jangan membuat Versus club transfer.
11. Gunakan label `RECOVERY_INFERRED` untuk ruleset yang belum terverifikasi.
12. Semua notification gameplay Versus harus diarahkan ke DM user.
13. Jangan menyebut promotion selesai sebelum season baru benar-benar dibuat dan league grade dipindahkan.
14. Jangan menyebut DM notification selesai sebelum ada test delivery, retry, dan idempotency.
15. Pertahankan `/play` sebagai satu public entry command.

---

## 12. Ringkasan Satu Paragraf

DISCORDFC sudah memiliki fondasi Player, Coach, dan Versus yang terpisah. Player adalah karier satu atlet dengan weekly training/match/EXP/event; Coach adalah karier manajemen klub single-player dengan roster, board, formation, tactic, dan season; Versus adalah multiplayer club-management mandiri dengan roster, lineup, scheduled battle, online league, standings, wallet, market, dan reward. Versus tidak menggunakan negara, menggunakan tier liga huruf, juara dan runner-up harus naik kasta, klub tidak boleh pindah club/owner/group, dan hasil gameplay harus dikirim melalui DM Discord. Per 2026-10-18 season rollover, permanent promotion, ownership terkunci, DM notification dengan retry/idempotency, serta mutasi Scout/Sponsor sudah tersedia dan teruji; canonical PostgreSQL repository untuk Versus (bukan replikasi season di tiap profil) tetap menjadi pekerjaan skala berikutnya.
