# Panduan Lengkap Football Rising Star Discord Bot

**Status dokumen:** 13 Oktober 2026
**Mode utama:** `/play` → Buttons dan Select Menus
**Target:** Player, Coach, Versus, operator bot, dan administrator server

---

## 1. Status kesiapan game

### Kesimpulan

Game ini **siap untuk beta testing dan internal playtesting**. Seluruh loop utama sudah dapat dimainkan melalui Discord, state mingguan sudah diuji, dan menu button-first sudah memiliki test integrasi.

Game ini **belum dapat disebut replika 1:1** Football Rising Star asli karena formula server, live balance, matchmaking, payout, dan konfigurasi backend asli tidak tersedia secara publik. Implementasi saat ini adalah **Discord adaptation yang mengikuti loop dan permukaan gameplay yang terverifikasi**.

### Status verifikasi terakhir

- Build TypeScript: berhasil
- Test suite: **82 lulus, 0 gagal**
- Weekly UI integration test: lulus
- Player/Coach/Versus aggregate isolation: diuji
- Owner-bound button dan select menu: diuji
- Transfer club preview dan confirm: tersedia
- Match telemetry: possession, shots, shots on target, corners tersedia
- Repository GitHub: branch `main` sudah sinkron

### Yang sudah parity secara kuat

- Player career berbasis weekly cycle
- Training dan detailed skill progression
- Simulated match
- Assign EXP setelah match
- Injury dan recovery
- Event mingguan: interview, sponsor, medical incident, lifestyle
- Club Office, fixture, league table, squad, formation, tactic
- Transfer club dengan preview dan konfirmasi
- Contract, salary, market, achievements, honors
- Coach career dan club management
- Versus asynchronous competition
- Button-first Discord navigation

### Yang masih reconstructed/inferred

- Formula overall dan player rating
- Peluang gol dan hasil simulasi
- Biaya serta reward training
- Durasi dan peluang cedera
- Valuasi transfer dan negosiasi
- Sponsor payout dan matchmaking coefficient
- Formula ranking/reward season
- Detail retirement/rebirth yang tidak tersedia dari server asli

Nilai tersebut disimpan sebagai balance configurable dan tidak boleh dipromosikan sebagai formula resmi Football Rising Star asli.

---

## 2. Konsep navigasi Discord

### Command publik normal

```text
/play
```

Secara default hanya `/play` yang didaftarkan ke Discord. Setelah command ini digunakan, pemain berpindah melalui tombol dan select menu.

### Prinsip tombol

- Tombol hanya dapat digunakan oleh pemilik profile yang membuat menu.
- Tombol disabled berarti state saat ini belum mengizinkan aksi tersebut.
- Select Menu dipakai untuk pilihan posisi, skill, event response, formation, tactic, lineup, dan transfer.
- Setelah satu aksi selesai, bot mengembalikan pemain ke panel mode yang relevan.
- Jangan menekan tombol lama setelah state berubah; buka ulang `/play` jika pesan sudah kedaluwarsa.

### Game Home

Setelah `/play`, tersedia:

| Tombol | Fungsi |
|---|---|
| **Player Mode** | Membuka atau membuat Player career |
| **Coach Mode** | Membuka atau membuat Coach career |
| **Versus Mode** | Membuka Versus Home dan assignment system |

Tombol navigasi umum:

| Tombol | Fungsi |
|---|---|
| **Game Home** | Kembali ke menu utama |
| **Player Home / Weekly Hub** | Kembali ke panel Player |
| **Coach Mode** | Berpindah ke Coach menu |
| **Versus Mode** | Berpindah ke Versus Home |

---

## 3. Player Mode: panduan lengkap

### 3.1 Membuat pemain

1. Gunakan `/play`.
2. Tekan **Player Mode**.
3. Jika belum memiliki profile, pilih posisi dari Select Menu:
   - Goalkeeper (`GK`)
   - Defender (`DF`)
   - Midfielder (`MF`)
   - Forward (`FW`)
4. Bot membuat pemain usia awal 15 tahun, klub awal, condition, money, abilities, detailed skills, dan weekly state.

### 3.2 Player Weekly Hub

Player Weekly Hub adalah pusat gameplay utama.

#### Baris status dan personal

| Tombol | Fungsi |
|---|---|
| **Player Status** | Melihat rating, condition, money, career statistics, club, macro abilities, detailed skills, dan weekly state |
| **Training** | Membuka menu macro training |
| **Personal** | Membuka Culture Study: Science, Arts, atau History |
| **Club** | Membuka Club Office |

#### Baris progression

| Tombol | Fungsi |
|---|---|
| **Next Week** | Menjalankan recovery, trainer settlement, sponsor payout, injury settlement, dan random weekly event |
| **Weekly Update** | Label pengganti ketika state belum mengizinkan maju; tombol disabled sampai state benar |
| **Play Match** | Menjalankan simulasi pertandingan ketika stage `MATCH_READY` |
| **Match** | Tombol disabled apabila weekly update, event, atau EXP belum selesai |
| **Detailed Skills** | Melihat 12 detailed skills |
| **Assign EXP** | Muncul ketika match menghasilkan pending EXP |
| **Recovery** | Melihat condition, cedera, dan treatment |

#### Baris career tambahan

| Tombol | Fungsi |
|---|---|
| **Weekly Event Decision** | Membuka pilihan event jika stage `EVENT_PENDING` |
| **Daily Reward** | Mengambil daily reward dan streak |
| **Contract** | Melihat atau memperbarui kontrak |
| **Honors** | Melihat Hall of Honor dan World Footballer |
| **Champions** | Melihat status atau memainkan Player Champions League |

### 3.3 Weekly cycle yang benar

```text
READY
→ Next Week
→ Weekly Update
→ [opsional] Weekly Event Decision
→ MATCH_READY
→ Play Match
→ Match Result
→ Assign EXP
→ League Table / Weekly Hub
→ READY
```

#### Stage `READY`

- **Next Week** aktif.
- **Match** disabled.
- Player dapat training atau melakukan personal activity sebelum maju.

#### Stage `EVENT_PENDING`

- Event mingguan harus diselesaikan.
- **Next Week** dan **Match** tidak dapat digunakan untuk melewati event.
- Tekan **Weekly Event Decision**, lalu pilih respons di Select Menu.

#### Stage `MATCH_READY`

- Weekly update selesai.
- **Play Match** aktif.
- Tekan tombol tersebut untuk simulasi pertandingan.

#### Stage `EXP_PENDING`

- Match sudah selesai.
- Pilih detailed skill dari Assign EXP Select Menu.
- Bot menyediakan tombol **League Table** untuk melihat klasemen setelah hasil pertandingan.
- Weekly cycle tidak boleh dilanjutkan sebelum pending EXP dialokasikan.

#### Stage `SEASON_BREAK`

- Season selesai dan annual award dapat ditampilkan.
- Tekan **Next Week** untuk melanjutkan career cycle berikutnya.

### 3.4 Training

Tekan **Training** dari Player Weekly Hub.

Macro abilities yang tersedia:

- Attack
- Defence
- Speed
- Power
- Strength
- Technique

Training mengurangi Energy dan memberikan EXP/peningkatan ability sesuai balance configuration.

#### Detailed Training

Tekan **Detailed Skills** atau masuk melalui panel training. Pilihan skill:

- Shots
- Penalty
- Header
- Pass
- Dribbling
- Free Kick
- Off-ball Running
- Hold Off Defenders
- Teamwork
- Endurance
- Speed
- Willpower

Setelah memilih skill, training order dapat memiliki completion week. Tekan **Next Week** untuk menyelesaikan order yang sudah waktunya.

### 3.5 Personal / Culture Study

Tekan **Personal** lalu pilih:

- Science
- Arts
- History

Culture Study berjalan sebagai aktivitas terjadwal dan dapat memberikan charm serta reward skill tertentu setelah settlement.

### 3.6 Weekly Events

Event bersifat blocking. Jenis yang tersedia:

| Event | Contoh dampak |
|---|---|
| **Interview** | Charm, EXP, money, atau energy |
| **Sponsor Offer** | Kontrak sponsor dengan pembayaran mingguan |
| **Medical Incident** | Recovery aman atau risiko injury |
| **Lifestyle** | Charm, money, atau recovery |

Default balance saat ini:

- Peluang event per weekly update: 32%
- Medical incident dari event sehat: 18% dari event roll
- Sponsor contract: 6 minggu
- Sponsor Local: 90 money/minggu
- Sponsor Regional: 160 money/minggu
- Sponsor Global: 280 money/minggu

Angka tersebut adalah **balance reconstructed**, bukan klaim angka resmi game asli.

### 3.7 Match Result

Setelah **Play Match**, bot menampilkan:

- skor akhir;
- lawan;
- player rating;
- possession;
- shots;
- shots on target;
- corners;
- HP dan Energy setelah match;
- pending EXP;
- narrative hasil pertandingan.

Contoh urutan setelah match:

```text
Match Result
→ Assign EXP
→ League Table
→ Weekly Hub
```

### 3.8 Assign EXP

1. Tekan **Assign EXP**.
2. Pilih satu detailed skill.
3. Seluruh atau sebagian pending EXP dialokasikan sesuai menu yang digunakan.
4. Setelah pending EXP menjadi 0, state kembali ke `READY`.

Tombol yang tersedia di panel Assign EXP:

- **Weekly Hub**
- **League Table**
- **Game Home**

### 3.9 Recovery dan injury

Tekan **Recovery** dari Weekly Hub.

Pilihan treatment yang tersedia:

- View injury status
- Basic treatment
- Expert treatment

Panel injury menampilkan severity, sisa minggu cedera, source, treatment status, HP, Energy, dan waktu recovery berikutnya jika tersedia.

### 3.10 Club Office

Tekan **Club**.

Tombol Club Office:

| Tombol | Fungsi |
|---|---|
| **Play Club Match** | Menjalankan fixture klub berikutnya |
| **League Table** | Melihat klasemen klub |
| **Squad** | Melihat roster, posisi, overall, HP, dan ID pemain |
| **Formation/Tactic** | Mengubah formasi dan taktik klub |
| **Market** | Membuka transfer market pemain |
| **Change Club** | Membuka official club transfer flow |
| **Player Home** | Kembali ke Player Hub |
| **Game Home** | Kembali ke Game Home |

### 3.11 Transfer club

Alur transfer dibuat button-first:

```text
Club Office
→ Change Club
→ Pilih official club
→ Transfer Preview
→ Confirm Transfer
```

Transfer Preview menampilkan:

- klub saat ini;
- klub tujuan;
- league;
- grade;
- prestige;
- transfer fee;
- saldo setelah transfer;
- dampak terhadap kontrak dan club state.

Tombol konfirmasi:

- **Confirm Transfer**
- **Choose Another**
- **Cancel**

Transfer fee, valuation, dan salary tetap dianggap reconstructed sampai data resmi tersedia.

### 3.12 Honors dan Champions

Panel **Honors** digunakan untuk melihat:

- Hall of Honor;
- World Footballer result;
- awards;
- achievement progress;
- achievement claim.

Panel **Champions** digunakan untuk:

- melihat qualification/status;
- memainkan ronde jika syarat terpenuhi;
- melihat reward dan progression terisolasi dari Coach aggregate.

---

## 4. Coach Mode

Coach Mode tidak menggunakan Player EXP. State Coach terpisah dari Player.

### Tombol Coach Home

| Tombol | Fungsi |
|---|---|
| **Coach Profile** | Melihat age, level, approval, salary, target, ability, dan EXP |
| **Play Round** | Menjalankan fixture Coach berikutnya |
| **Club Office** | Melihat club resources, roster, fixture, formation, dan tactic |
| **Decision** | Menyelesaikan management decision jika pending |
| **Coach EXP** | Mengalokasikan Coach EXP ke ability |
| **Formation/Tactic** | Mengubah strategi klub Coach |
| **Job Offers** | Generate, list, accept, atau decline tawaran klub |
| **Champions** | Membuka Coach Champions League |
| **Game Home** | Kembali ke Game Home |
| **Versus Mode** | Berpindah ke Versus |

### Coach abilities

- Formation Understanding
- Tactical Thinking
- State Adjustment
- Training Level
- Locker Room Prestige
- Personal Charisma

### Coach flow

```text
Coach Home
→ Play Round
→ Match Result
→ Coach EXP / Approval
→ Decision jika ada
→ Board Target / Club Season
```

### Job Offers

Panel Job Offers dapat digunakan untuk:

- Generate offer
- List offers
- Accept offer
- Decline offer

Offer dapat menampilkan club, league, salary, target rank, dan duration. Formula offer adalah reconstructed.

### Coach retirement/rebirth

Retirement dan rebirth Coach terpisah dari Player. Jangan menganggap retirement Coach menghapus Player career.

---

## 5. Versus Mode

Versus adalah mode asynchronous dengan aggregate, roster, wallet, assignment, dan season yang terpisah dari Player dan Coach.

### Versus Home

| Tombol | Fungsi |
|---|---|
| **Home** | Kembali ke Versus Home |
| **Next Battle** | Membuka battle berikutnya setelah siap/due |
| **Lineup** | Membuka lineup builder |
| **Results** | Melihat hasil battle |
| **Standings** | Melihat klasemen Versus |
| **Registration** | Melihat status assignment, group, capacity, dan competition |
| **Market** | Membuka Deal/auction market |
| **Rewards** | Melihat reward dan ledger |
| **Schedule** | Melihat fixture Versus |
| **Rankings** | Membuka kategori ranking |
| **Global Ranking** | Melihat season-wide ranking |
| **Sponsor** | Melihat sponsor tiers dan reward surface |

### Lineup builder

Alur lineup:

```text
Lineup
→ Formation
→ Tactic
→ Pilih XI berdasarkan posisi
→ Captain
→ Substitutes
→ Review
→ Confirm Submission
```

Validasi yang dilakukan:

- slot posisi legal;
- roster version masih sama;
- captain berasal dari lineup;
- substitute tidak melebihi batas;
- player yang cedera/blocked tidak dapat dipilih;
- submission harus sebelum deadline.

### Versus Market

Market mendukung:

- melihat listing Deal;
- melihat countdown;
- melakukan bid;
- reservation coin;
- outbid release;
- settlement idempotent;
- ledger transaksi.

Scout dan Sponsor tetap ditampilkan secara transparan apabila mechanic detail belum terkalibrasi.

### Versus ranking

Kategori yang tersedia:

- Club Ranking
- MVP
- Golden Boot / Top Scorers
- Top Assists
- Goalkeeper Ranking
- Global Ranking

Metric goalkeeper yang belum tersedia tidak boleh dianggap nol; panel akan menandainya sebagai unavailable bila telemetry belum ada.

---

## 6. Slash command fallback dan operator

Dalam mode default, command detail tidak didaftarkan. Untuk operator/testing, set:

```env
REGISTER_FALLBACK_COMMANDS=true
```

Lalu jalankan registrasi command kembali.

### Player fallback

| Command | Fungsi |
|---|---|
| `/player career start position:FW` | Membuat Player profile |
| `/player career profile` | Melihat profile |
| `/player career next-week` | Memproses weekly update |
| `/player career match` | Simulasi match |
| `/player career league` | Klasemen |
| `/player career injury action:view\|basic-treatment\|expert-treatment` | Injury/recovery |
| `/player career contract action:view\|sign` | Contract |
| `/player career daily` | Daily reward |
| `/player career champions action:status\|play` | Champions |
| `/player training train ability:technique` | Macro training |
| `/player training skills` | Detailed skills |
| `/player training train-skill skill:shots` | Detailed training |
| `/player training assign-exp skill:shots amount:10` | Assign EXP |
| `/player training trick action:list\|train` | Trick |
| `/player training trainer action:list\|hire\|release` | Trainer |
| `/player training culture subject:science` | Culture Study |
| `/player club overview` | Club Office |
| `/player club list league:1011` | Official clubs |
| `/player club join club_id:101102` | Pindah club |
| `/player club squad` | Squad |
| `/player club formation id:4-3-3` | Formasi |
| `/player club tactic id:attacking` | Taktik |
| `/player club match` | Club fixture |
| `/player club standings` | Klasemen |
| `/player club market action:list\|refresh` | Market |
| `/player club buy listing:listing-market-1` | Beli pemain |
| `/player club sell player:npc-1` | Jual pemain |
| `/player honors list` | Honors |
| `/player honors achievements` | Achievement |
| `/player honors claim achievement:appearances-10` | Claim achievement |

### Coach fallback

```text
/coach career action:start|status
/coach profile
/coach round
/coach exp ability:formation amount:10
/coach event choice:<id>
/coach formation id:4-3-3
/coach tactic id:balanced
/coach job action:generate|list|accept|decline offer_id:<id>
/coach champions action:status|play
/coach retire
/coach rebirth
```

### Versus fallback

```text
/versus home
/versus profile
/versus roster
/versus standings
/versus round
/versus season action:status|settle
/versus join group_code:<CODE>
/versus bid listing_id:<id> amount:<coin>
```

Lineup fallback membutuhkan battle ID, lineup player IDs, captain, formation, tactic, dan roster version. Button Lineup lebih aman karena membantu validasi context tersebut.

---

## 7. Panduan administrator

### 7.1 Environment minimum

Salin environment file:

```bash
cp .env.example .env
```

Isi minimal:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
ADMIN_USER_IDS=discord_user_id_admin
REGISTER_FALLBACK_COMMANDS=false
```

`DISCORD_GUILD_ID` direkomendasikan saat development karena command guild diperbarui lebih cepat daripada global command.

### 7.2 Development mode JSON

```bash
pnpm install
pnpm build
pnpm commands:register
pnpm dev
```

Tanpa `DATABASE_URL`, bot memakai JSON store pada `DATA_FILE`.

Jangan memakai JSON store sebagai persistence utama untuk deployment multi-instance.

### 7.3 Production PostgreSQL

Isi:

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/database
```

Jalankan:

```bash
pnpm db:migrate
pnpm build
pnpm start
```

Atau memakai Compose:

```bash
docker compose up -d --build
```

Untuk production, sediakan:

- PostgreSQL backup;
- secret manager untuk token dan database password;
- restart policy;
- monitoring dan alerting;
- TLS untuk database managed;
- log retention;
- audit log command admin.

### 7.4 Registrasi command

Default button-first:

```bash
REGISTER_FALLBACK_COMMANDS=false pnpm commands:register
```

Fallback/operator commands:

```bash
REGISTER_FALLBACK_COMMANDS=true pnpm commands:register
```

Jika perubahan command belum muncul, pastikan command didaftarkan ke guild yang benar dan `DISCORD_GUILD_ID` tidak salah.

### 7.5 Admin permission

`/admin` membutuhkan:

1. Discord permission `Manage Guild`;
2. user ID yang terdaftar pada `ADMIN_USER_IDS`.

Command admin:

| Command | Fungsi |
|---|---|
| `/admin action:stats` | Melihat statistik operasi |
| `/admin action:refresh-markets` | Refresh market seluruh profile |

Jangan menambahkan user ID admin ke source code. Gunakan environment/secret configuration.

### 7.6 Maintenance dan worker

Parameter penting:

```env
MAINTENANCE_INTERVAL_MS=900000
RATE_LIMIT_MAX=12
RATE_LIMIT_WINDOW_MS=60000
RUNTIME_LOCK_FILE=./data/discord-bot.lock
```

Maintenance menangani state time-based seperti:

- recovery;
- injury settlement;
- sponsor payout;
- Versus market expiry;
- Versus round maintenance sesuai worker yang aktif.

Pada deployment multi-instance, rate limiter dan queue sebaiknya dipindahkan dari process-local ke Redis atau database.

### 7.7 Import data JSON lama

Jika berpindah dari JSON ke PostgreSQL:

1. backup file JSON;
2. isi `DATABASE_URL`;
3. set `DATA_FILE` ke file sumber;
4. jalankan migration;
5. jalankan import;
6. jalankan test smoke melalui `/play`.

```bash
pnpm db:migrate
pnpm db:import-json
```

### 7.8 Test dan release checklist

Sebelum release:

```bash
pnpm build
pnpm test
```

Pastikan:

- seluruh test lulus;
- tidak ada perubahan tidak ter-commit;
- database backup berhasil;
- `DISCORD_TOKEN` tidak masuk git;
- `ADMIN_USER_IDS` benar;
- command registry sesuai mode button-first/fallback;
- satu user dapat membuat Player, Coach, dan Versus tanpa state leak;
- weekly cycle dapat melewati event, match, dan EXP allocation;
- transfer club menampilkan preview sebelum konfirmasi;
- market dan ledger tidak menghasilkan double settlement.

### 7.9 Troubleshooting

| Masalah | Pemeriksaan |
|---|---|
| `/play` tidak muncul | Jalankan `pnpm commands:register`, cek token/client ID/guild ID |
| Tombol tidak merespons | Pastikan bot process hidup; buka `/play` baru; jangan pakai pesan lama |
| User lain tidak dapat memakai tombol | Ini normal; komponen owner-bound |
| Match tidak dapat dimainkan | Cek stage, event pending, injury, HP, dan Energy |
| EXP tidak dapat lanjut | Pending EXP harus dialokasikan dahulu |
| `/admin` ditolak | Cek Manage Guild dan `ADMIN_USER_IDS` |
| Data hilang setelah restart | Gunakan PostgreSQL atau pastikan `DATA_FILE` writable dan ter-backup |
| Global command terlambat muncul | Gunakan guild registration saat testing |
| Transfer gagal | Cek official club ID, saldo money, dan apakah pemain sudah berada di klub tersebut |

---

## 8. Aturan fairness dan batas desain

- Jangan mengklaim balance reconstructed sebagai data resmi game asli.
- Jangan mengaktifkan mechanic yang hanya memiliki nama UI tetapi belum memiliki effect/persistence yang terkalibrasi.
- Jangan mencampur Player, Coach, dan Versus aggregate.
- Jangan menghapus data player tanpa backup dan prosedur migrasi.
- Jangan memberi akses admin hanya berdasarkan nama Discord; gunakan Discord user ID.
- Jangan membuat tombol yang melewati state penting secara diam-diam.

---

## 9. Referensi proyek

- `README.md` — overview proyek dan operasi lokal
- `docs/DISCORD_COMMAND_LAYOUT.md` — kontrak button-first
- `docs/PLAYER_WEEKLY_EVENTS.md` — event Player mingguan
- `docs/TECHNICAL_GAMEPLAY_STATE_MATRIX_2026-08-26.md` — parity matrix dan batas evidence
- `docs/FOOTBALL_RISING_STAR_GAMEPLAY_RESEARCH_2026-10-11.md` — riset gameplay game asli
- `test/weekly-ui-integration.test.ts` — simulasi weekly UI/state flow
