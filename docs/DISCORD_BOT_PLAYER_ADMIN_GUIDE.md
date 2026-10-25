# Panduan Lengkap Football Rising Star Discord Bot

**Status dokumen:** 18 Oktober 2026
**Mode utama:** `/play` → Buttons dan Select Menus
**Target:** Player, Coach, Versus, operator bot, dan administrator server

---

## 1. Status kesiapan game

### Kesimpulan

Ketiga mode **dapat dimainkan penuh lewat tombol** dan sudah melewati audit parity + perbaikan (lihat [`AUDIT_FIX_REPORT_2026-10-18.md`](AUDIT_FIX_REPORT_2026-10-18.md)). Game cocok untuk **closed beta / internal playtest**.

Game ini **bukan replika 1:1** Football Rising Star asli: formula server, live balance, dan payout asli tidak tersedia. Nilai yang belum terverifikasi disimpan di `src/config/game-balance.ts` dengan label `RECOVERY_INFERRED`.

### Status verifikasi terakhir

- Build TypeScript: berhasil
- Test suite: **159 lulus, 0 gagal**
- Alur handler end-to-end (Player, Coach, Versus) dengan validasi batas Discord: lulus
- Migrasi save versi sebelumnya: diuji
- Outbox DM Versus (delivery, retry, idempotency): diuji
- `tools/targeted-audit.ts`: PASS · `tools/stress-simulation.ts`: PASS (determinisme + invariant ketiga mode)

### Yang sudah setara dengan loop game

- Player: weekly cycle mengikuti fixture liga klub (satu season = seluruh fixture liga), performa personal per posisi (gol/assist/rating/kartu/MVP), recovery real-time, kurva skill 1–99, World Footballer dari statistik season, kontrak per season dengan gaji mingguan, transfer window + tawaran akhir season, pensiun & rebirth
- Liga: klasemen penuh, promosi/degradasi 3 klub, kualifikasi Champions League
- Coach: ability berefek di pertandingan, board target realistis, pemecatan, job offer berbasis reputasi, transfer market, season settlement
- Versus: liga huruf S→E, NPC per tier, taktik & formasi berpengaruh, cedera/skors, market lelang, sponsor, scout, Next Season dengan promosi, notifikasi DM

### Yang masih reconstructed/inferred

- Rumus rating/overall, peluang gol, dan nilai reward
- Durasi cedera, biaya treatment, trainer, sponsor
- Valuasi transfer, gaji, syarat rating klub
- Ruleset Versus (taktik, sponsor, scout, harga lelang)
- Data roster recovered tidak lengkap (beberapa klub kekurangan pemain; diisi pemain sintetis sampai kedalaman minimum). Roster klub divisi satu dan kontinental bisa diganti skuad asli lewat overlay Transfermarkt (bagian 7.10)

---

## 2. Konsep navigasi Discord

### Command publik normal

```text
/play
```

Secara default hanya `/play` yang didaftarkan. Balasan `/play` publik; klik pertama dari pesan itu membuka **panel pribadi** (hanya terlihat oleh Anda). Klik berikutnya di panel pribadi **memperbarui panel yang sama** — tidak ada spam pesan baru.

### Prinsip tombol

- Tombol hanya dapat digunakan oleh pemilik panel.
- Tombol disabled berarti state saat ini belum mengizinkan aksi tersebut.
- Error ditampilkan sebagai pesan pribadi singkat; panel tetap seperti sebelumnya.
- Jika data berubah di proses lain (mis. worker), aksi diulang otomatis dengan data terbaru.

### Game Home

| Tombol | Fungsi |
|---|---|
| **Player Mode** | Membuka atau membuat karier atlet |
| **Coach Mode** | Membuka atau membuat karier Coach |
| **Versus Mode** | Membuka Versus Home; club dimasukkan otomatis ke public league |

---

## 3. Player Mode

### 3.1 Membuat pemain

`/play` → **Player Mode** → pilih **negara asal** (tim nasional untuk turnamen antar negara; tidak memengaruhi klub) → pilih posisi seperti di game asli (GK, CB, LB, RB, CDM, CM, CAM, LM, RM, ST). Seperti di game asli, atlet mulai sebagai *Free Player* usia 15 lalu **Signed successfully** di klub **divisi 3 acak** (negara mana saja) dengan kontrak awal 2 musim (gaji dibayar tiap minggu). Klub lebih besar didapat lewat performa, tawaran, dan transfer.

### 3.2 Player Weekly Hub

Hub menampilkan klub dan peringkat, kondisi (HP/energi), laga berikutnya, statistik musim, dan skill utama posisi.

| Baris | Isi |
|---|---|
| 1 | **▶ Next Week** (label mengikuti tahap: *Lanjut: Event*, *Main Match*, *Alokasikan EXP*; **Rebirth** setelah pensiun) · tab game asli: **Ability** (level skill) · **Training** (Regular, Skill, Trick, Personal Coach) · **Personal** (Ask for pay, Negotiation, Transfer, Culture Study) · **Club** (League Table, Squad) |
| 2 | **Menu lainnya…**: Home/profil, Klasemen, Hall of Honor, Champions, Recovery & cedera, Daily reward, Karier, Game Home, Coach Mode, Versus Mode |

Hub menampilkan tanggal kalender game, musim (mis. 2026/27), rating, **Value**, money, **Diamonds** (mata uang premium, belum bisa didapat sampai top up aktif), dan **Fans**. Radar profil memakai label asli OFF/DEF/SPD/STA/TEC/PHY.

### 3.3 Weekly cycle

```text
▶ Next Week → update mingguan → [event: pilih respons] → match live → [alokasi EXP] → hub
```

- **Next Week**: recovery mingguan, gaji kontrak, trainer, sponsor, cedera/skors berkurang, lalu peluang event. Tanpa event, pertandingan langsung dimainkan pada klik yang sama.
- **Event**: jika muncul, pilih respons di menu; setelah memilih, pertandingan langsung dimulai. Event dan match boleh terjadi di minggu yang sama, bergantian.
- **Match live**: pesan diperbarui dari kick-off sampai peluit panjang (0′, 15′, 30′, HT, 60′, 75′, FT) dengan gol, peluang, penyelamatan, dan kartu; momen pemain Anda ditebalkan. Hasil sudah tersimpan sebelum animasi berjalan. Jeda antar-frame diatur `MATCH_ANIMATION_MS` (default 1500; `0` = langsung ke hasil). Fixture liga lain di round itu ikut disimulasikan sehingga klasemen selalu lengkap. Jika cedera, terskors, atau kondisi buruk, Anda menonton dari tribun tetapi klub tetap bermain.
- **Kalender** (`RECOVERY_INFERRED`, mengikuti rekaman): laga mingguan mulai Agustus; setelah ronde pertengahan (pertengahan Desember) muncul **Winter Break Begins!** dan liga lanjut Januari; musim selesai Mei.
- **Liburan Winter Break**: minggu pertama setelah winter break selalu membawa satu event liburan per musim. Pilih berlatih dengan **King of Soccer** (+100 EXP langsung ke skill utama terlemah, seperti di rekaman), liburan keluarga (energi/HP pulih, +2 charm), atau pulang kampung (+50 fans).
- **Transfer window**: musim panas (4 ronde pertama), Januari (3 ronde setelah winter break), dan season break. Klub mengirim tawaran di awal tiap window jika performamu bagus (lihat Personal → Transfer). Pindah di tengah musim melanjutkan liga klub baru dari ronde yang sama.
- **Hasil laga** menampilkan jumlah penonton, MVP, rating pemain, dan klasemen setelah ronde itu, seperti layar pasca-laga game asli.
- **Alokasi EXP**: pilih **satu** skill (semua EXP masuk ke sana), **beberapa** skill (dibagi rata), atau **⚡ Auto** (dibagi ke skill utama posisi). EXP yang melebihi nilai maksimal mengalir ke skill lain; jika semua skill sudah 99, EXP dikonversi ke money.
- **Level skill** dimulai dari **Lv 1** di awal karier dan naik satu level tiap bar EXP penuh, seperti di game asli (rekaman: Shots sekitar Lv 12 setelah ±20 laga; trick terbuka di level tertentu). Rating pemain adalah angka terpisah. Tanda `*` = skill utama posisi.
- Setelah matchday terakhir, season ditutup otomatis: peringkat akhir, promosi/degradasi klub, World Footballer, honors (juara liga, Golden Boot, Young Player), usia +1, sisa kontrak −1 season, dan tawaran transfer. Stage menjadi `SEASON_BREAK` (transfer window terbuka).

### 3.4 Training

- **Regular Training** dengan 7 kategori asli (Shoot, Dribbling, Speed, Stamina, Pass, Defense, Physical): sekali per minggu, memakai energi; EXP masuk ke skill terkait (pemetaan skill `RECOVERY_INFERRED`).
- **Detailed Skills**: pilih satu dari 12 skill; selesai pada Weekly Update berikutnya.
- **Trick Training**: mulai latihan trick jika syarat level skill terpenuhi; latihan butuh **3 minggu** dan bisa diselesaikan langsung dengan **Percepat (50 💠 Diamonds)**, seperti di rekaman (durasi `RECOVERY_INFERRED`). Hanya satu trick dilatih sekaligus; trick terbuka menambah peluang gol dan rating.
- **Kiper** melihat nama skill khusus kiper seperti di game asli: Reaction, Hand Toss, GK Kick, Save Penalty, Hold Position, GK Pass Ball, Command Defense, Balance, Jump, Willpower (Off-ball Running disembunyikan).
- **Trainer**: sewa trainer (biaya per minggu) untuk EXP mingguan otomatis; bisa dilepas kapan saja.
- **Culture Study** (tombol Personal): Science/Arts/History, memberi charm dan EXP skill.

Kurva skill: biaya per level naik bertahap dan jauh lebih mahal di atas level 75, sehingga puncak karier biasanya usia 27–30. Usia 31+ mengalami penurunan fisik ringan.

### 3.5 Recovery dan cedera

HP pulih **+2/jam** dan energy **+10/jam** secara real time (dihitung per jam penuh, tidak hilang walau sering membuka panel). Panel **Recovery** menampilkan cedera dan treatment Basic/Expert.

### 3.6 Club

| Tombol | Fungsi |
|---|---|
| **League Table** | Klasemen lengkap, posisi Anda ditebalkan |
| **Squad** | Roster klub (formasi/taktik diatur pelatih AI) |
| **Transfer Offers** | Terima/tolak tawaran yang datang di akhir season |
| **Change Club** | Daftar klub yang mau merekrut rating Anda → preview biaya → konfirmasi. Aktif hanya pra-musim atau season break |

Atlet tidak memainkan "club match" terpisah, tidak membeli pemain, dan tidak mengatur taktik — itu ada di Coach Mode.

### 3.7 Contract

Kontrak dihitung dalam **season**. Tombol **Renew** aktif pada season terakhir kontrak (atau setelah kontrak habis); **Request Raise** sekali per season, dinilai dari rating saat ini.

### 3.8 Honors dan Champions

- **Honors**: Hall of Honor (Personal/Team/National), World Footballer terakhir, dan klaim achievement yang siap.
- **Champions**: tersedia jika klub lolos (4 besar divisi 1). Ronde dibuka bertahap mengikuti matchday liga (ronde 1 setelah matchday 8, dst.); lawan klub kontinental; seri diakhiri adu penalti.

### 3.9 Earth Cup (turnamen antar negara)

Negara asal yang dipilih saat membuat pemain dipakai di sini, bukan untuk memilih klub. Semua aturan di bawah `RECOVERY_INFERRED`.

- Diadakan **tiap 4 tahun** di musim panas setelah musim liga (2030, 2034, …). Karier yang mulai 2026 mendapat Earth Cup pertama setelah musim 2029/30.
- **Panggilan timnas** saat musim ditutup: usia 17+, main minimal 30% laga liga musim itu, dan rating minimal sesuai kekuatan negara dan posisi (negara kuat dan penyerang butuh rating lebih tinggi; kiper dan bek lebih rendah). Syarat dan rating kamu tampil di menu **🌍 Earth Cup**.
- **Format**: 32 negara, grup berisi 4 tim dari pot berbeda (3 laga, 2 teratas lolos), lalu Round of 16 → Quarter-final → Semi-final → Final. Laga gugur yang seri diakhiri adu penalti.
- Tiap laga dimainkan dengan **▶ Next Week** selama season break, lengkap dengan match live, rating, MVP, dan klasemen grup. Rekan dan lawan memakai nama pemain asli dari roster overlay jika datanya ada. Saat Earth Cup berjalan, musim baru belum bisa dimulai.
- Hadiah: EXP dan bonus laga seperti biasa, fans lebih banyak, caps/gol timnas di profil, dan honor **National** "Earth Cup <tahun>" jika juara.
- Jika tidak dipanggil, negaramu tetap bermain dan hasil akhirnya dilaporkan.

### 3.10 Career, pensiun, rebirth

Panel **Career** menampilkan riwayat season dan generasi sebelumnya. Pensiun sukarela tersedia mulai usia 30 (konfirmasi dua langkah); pensiun otomatis usia 34 atau setelah 20 tahun karier. **Rebirth** memulai generasi baru (usia 15, posisi bisa diganti, bonus skill per rebirth) dengan money, honors, dan riwayat dipertahankan.

---

## 4. Coach Mode

Klub Coach adalah aggregate terpisah: atlet Player Anda tidak pernah bermain untuk klub Coach.

| Baris | Tombol |
|---|---|
| 1 | **Coach Profile** · **Play Round** · **Club Office** · **Decision** |
| 2 | **Coach EXP** · **Formation/Tactic** · **Job Offers** · **Champions** |
| 3 | **Transfer Market** · **Season Settlement** · **Career** · **Game Home** · **Versus Mode** |

- **Ability Coach berefek nyata**: Formation (kekuatan formasi), Tactics (efek taktik), State Adjustment (comeback saat tertinggal), Training (perkembangan pemain), Locker Room (moral), Charisma (approval board).
- **Board target** berasal dari peringkat yang wajar untuk kekuatan klub (bertahan, papan tengah, Eropa, juara, promosi).
- **Approval** terlalu rendah → **dipecat di tengah season**; pilih klub baru di Job Offers.
- **Job Offers**: klub menawarkan kontrak sesuai reputasi Coach; cari tawaran sekali per round; terima atau tolak.
- **Transfer Market**: daftar pemain diperbarui tiap round, dibeli/dijual dengan **assets klub**; kedalaman minimum per posisi dijaga.
- **Season Settlement**: aktif setelah fixture terakhir; menampilkan peringkat, promosi/degradasi, hasil target board, dan kualifikasi Champions League.
- **Career**: pensiun (konfirmasi) dan rebirth Coach dengan bonus dari honor.

---

## 5. Versus Mode

Versus memakai club, roster, dan wallet sendiri (tidak terhubung ke Player/Coach) dan **tidak memakai negara**.

### 5.1 Liga dan season

- Tier liga: **S → A → B → C → D → E**. Club baru mulai di **Liga E**.
- Public league dibuat otomatis per tier: `PUB-<tier>-<YYMMDD>-<NN>`, 8 club. Club manusia mengambil slot NPC sebelum round 1; setelah itu group baru dibuka.
- Satu round per hari (deadline terlihat di Home). Battle diproses otomatis saat deadline; tanpa submission, sistem memakai lineup otomatis terbaik.
- **Rank 1–2 promosi, 2 terbawah degradasi** (Liga E tidak punya degradasi).
- Setelah round terakhir, season selesai: reward dibagikan, market ditutup (bid dibatalkan, coin dilepas). Tekan **Next Season** — saat itulah grade club dipindahkan dan season baru dibuat di liga tujuan.

### 5.2 Versus Home

| Baris | Tombol |
|---|---|
| 1 | **Home** · **Lineup / Edit Lineup** · **Results** · **Standings** · **Schedule** |
| 2 | **Market** · **Squad** · **Scout** · **Sponsor** · **Rankings** |
| 3 | **Rewards** · **Registration** · **Global Ranking** · **DM: On/Off** · **Game Home** |

### 5.3 Lineup builder

```text
Lineup → Formation + Tactic → [Auto XI] atau Choose XI per posisi → Review → Captain + Substitutes → Confirm
```

- Hanya pemain yang bisa bermain (tidak cedera/skors) yang muncul di pilihan.
- **Auto XI** memilih XI terbaik berdasarkan kemampuan dan kondisi untuk formasi terpilih.
- Submission bisa diubah sampai deadline; jika round sudah berganti, panel meminta Anda membuka ulang.
- Taktik punya trade-off attack/defence/control dan matchup terhadap taktik lawan (mis. Counter unggul melawan Attacking).

### 5.4 Market, Squad, Scout, Sponsor

- **Market**: 6 listing per siklus (pemain NPC + free agent), lelang 6 jam, bid me-*reserve* coin (didebit saat menang), bid di 5 menit terakhir memperpanjang lelang, roster maksimal 25 termasuk bid aktif. Siklus baru dibuat otomatis.
- **Squad**: lepas pemain (refund 10% nilai); posisi di batas minimum dan pemain dalam lineup yang sudah disubmit tidak bisa dilepas.
- **Scout**: Junior/Senior, sekali per round, merekrut prospek 17–20 tahun ke roster.
- **Sponsor**: satu per season; Junior (semua liga), Senior (Liga C+), Top (Liga A+); bonus per menang/seri.

### 5.5 Notifikasi DM

Semua notifikasi gameplay Versus dikirim via **DM**: klub masuk liga, pengingat deadline (3 jam sebelum, jika belum submit), hasil battle, bid dikalahkan, hasil lelang, dan akhir season. Matikan/aktifkan dengan tombol **DM: On/Off**. Bot hanya bisa DM jika Anda berada di server yang sama dan tidak menutup DM dari anggota server.

---

## 6. Slash command fallback dan operator

Dalam mode default, command detail tidak didaftarkan. Untuk operator/testing set `REGISTER_FALLBACK_COMMANDS=true` lalu registrasi ulang. Balasan fallback bersifat ephemeral.

### Player fallback

| Command | Fungsi |
|---|---|
| `/player career start position:FW` | Membuat profil |
| `/player career profile` · `next-week` · `match` · `league` | Hub, weekly update, match, klasemen |
| `/player career injury action:view\|basic-treatment\|expert-treatment` | Recovery |
| `/player career contract action:view\|sign` | Kontrak |
| `/player career daily` · `champions action:status\|play` · `retire` · `rebirth` | Daily, Champions, pensiun, rebirth |
| `/player training train ability:technique` | Regular Training |
| `/player training skills` · `train-skill skill:shots` · `assign-exp skill:shots amount:10` | Detailed skill & EXP |
| `/player training trick action:list\|train trick_id:<id>` · `trainer action:list\|hire\|release` · `culture subject:science` | Trick, trainer, culture |
| `/player club overview` · `list league:1011` · `join club_id:<id>` · `squad` · `standings` | Club atlet & transfer |
| `/player honors list` · `world-footballer` · `achievements` · `claim achievement:<id>` | Honors |

### Coach fallback

```text
/coach career action:start|status
/coach profile | round | event choice:<id> | exp ability:<id> amount:<n>
/coach formation id:4-3-3 | tactic id:balanced
/coach job action:generate|list|accept|decline offer_id:<id>
/coach champions action:status|play
/coach retire | rebirth
```

### Versus fallback

```text
/versus home | profile | roster | standings
/versus join group_code:<CODE>          (private group)
/versus bid listing_id:<id> [amount:<coin>]
/versus lineup battle_id:<id> lineup:<ids> captain:<id> formation:<f> tactic:<t> roster_version:<n> [substitutes:<ids>]
```

`/versus round` dan `/versus season` hanya menampilkan status: round dan season diproses otomatis saat deadline.

---

## 7. Panduan administrator

### 7.1 Environment minimum

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
ADMIN_USER_IDS=discord_user_id_admin
REGISTER_FALLBACK_COMMANDS=false
```

Jangan pernah commit `.env` atau mencetak token ke log.

### 7.2 Development mode JSON

```bash
pnpm install
pnpm build
pnpm commands:register
pnpm dev
```

Tanpa `DATABASE_URL`, bot memakai JSON store pada `DATA_FILE`. JSON store hanya untuk satu proses (runtime lock file mencegah dua proses).

### 7.3 Production PostgreSQL

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/database
```

```bash
pnpm db:migrate     # termasuk index baru idx_player_profiles_versus_group
pnpm build
pnpm start
```

Atau `docker compose up -d --build`. Sediakan backup, secret manager, restart policy, monitoring, TLS untuk database managed, dan log retention.

### 7.4 Registrasi command

```bash
REGISTER_FALLBACK_COMMANDS=false pnpm commands:register   # hanya /play
REGISTER_FALLBACK_COMMANDS=true pnpm commands:register    # + command operator
```

Di hosting panel tanpa terminal (mis. Pella), set `REGISTER_COMMANDS_ON_START=true`: bot mendaftarkan `/play` setiap kali start (global jika `DISCORD_GUILD_ID` kosong, bisa butuh beberapa menit sebelum muncul). `npm start` otomatis menjalankan build TypeScript lebih dulu (`prestart`), jadi startup command cukup `npm start` setelah `npm install`. Untuk host yang meminta *Main file* (menjalankan `node <file>`), isi `index.js`: launcher di root ini meng-compile TypeScript lalu menjalankan `dist/index.js`.

### 7.5 Admin permission

`/admin` membutuhkan permission Discord `Manage Guild` **dan** user ID di `ADMIN_USER_IDS`.

| Command | Fungsi |
|---|---|
| `/admin action:stats` | Jumlah profil, Coach, club Versus, DM pending, mode persistence, sumber data roster |
| `/admin action:run-maintenance` | Menjalankan maintenance sekarang (memakai lock yang sama dengan worker) |

### 7.6 Worker dan parameter

```env
MAINTENANCE_INTERVAL_MS=900000     # recovery, achievement, round/season Versus, lelang
NOTIFICATION_INTERVAL_MS=60000     # pengiriman DM outbox
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
RUNTIME_LOCK_FILE=./data/discord-bot.lock
```

- **Maintenance** melewati profil yang baru disimpan (< 2 menit) dan tidak pernah menimpa simpanan pemain (optimistic concurrency).
- **Versus** juga diproses seketika saat ada pemain membuka panel setelah deadline, jadi hasil tidak menunggu tick worker.
- **DM**: retry dengan backoff 1m → 5m → 30m → 2j → 6j, maksimal 5 percobaan; error permanen Discord (50007 DM ditutup, 10013 user tidak ada) langsung ditandai gagal. Worker DM dan maintenance berbagi lock sehingga instance ganda tidak mengirim DM dobel.
- Pada PostgreSQL, maksimal 4 operasi grup Versus memegang lock bersamaan agar pool koneksi tidak habis.

### 7.7 Import data JSON lama

```bash
pnpm db:migrate
pnpm db:import-json
```

Save versi sebelumnya dimigrasikan otomatis saat dipakai: kontrak lama berbasis waktu tetap berlaku; statistik season dibuat; club Versus pada skala grade lama dimulai ulang di Liga E (season lama yang sedang berjalan tetap diselesaikan, tanpa promosi ganda).

### 7.8 Test dan release checklist

```bash
pnpm build
pnpm test
pnpm exec tsx tools/targeted-audit.ts
SIM_TRIALS=50 pnpm exec tsx tools/stress-simulation.ts
```

Pastikan seluruh test lulus, audit PASS, backup database berhasil, `.env` tidak masuk git, dan `ADMIN_USER_IDS` benar.

### 7.9 Troubleshooting

| Masalah | Pemeriksaan |
|---|---|
| `/play` tidak muncul | Jalankan `pnpm commands:register`, cek token/client ID/guild ID |
| Tombol tidak merespons | Pastikan proses bot hidup; buka `/play` baru |
| User lain tidak dapat memakai tombol | Normal; komponen terikat pemilik |
| "Round sudah berganti" saat lineup | Round sudah diproses; buka ulang Lineup dari Versus Home |
| Tidak menerima DM Versus | Cek tombol DM: On, pengaturan privasi DM server, dan `/admin action:stats` (DM pending) |
| "Data berubah di proses lain" | Aksi bertabrakan dengan worker 3x berturut-turut; ulangi aksi |
| Match tidak dapat dimainkan | Cek stage (event/EXP pending), cedera, skors |
| Transfer gagal | Cek transfer window, rating minimal klub, dan saldo |

### 7.10 Update roster pemain (Transfermarkt CC0)

Roster APK untuk klub divisi satu hanya berisi rata-rata 7–14 pemain. Skuad asli bisa dimuat dari dataset CC0 [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (data per 6 Juli 2026, musim 2025/26):

```bash
mkdir -p data/external/transfermarkt
curl -fL -o data/external/transfermarkt/players.csv.gz https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz
curl -fL -o data/external/transfermarkt/clubs.csv.gz https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/clubs.csv.gz
pnpm data:import-players --snapshot 2026-07-06
```

Periksa `data/external/player-import-report.json`, commit `player-overlay.json`, lalu restart bot. `/admin action:stats` menampilkan jumlah klub dan pemain dari overlay. Koreksi pencocokan klub ada di `data/external/club-map.json`; `PLAYER_OVERLAY_FILE=off` mengembalikan roster APK. Overlay hanya menyentuh roster klub resmi Player/Coach; Versus tetap memakai roster NPC-nya sendiri. Detail: [`data/external/README.md`](../data/external/README.md).

---

## 8. Aturan fairness dan batas desain

- Jangan mengklaim balance reconstructed sebagai data resmi game asli; gunakan label `RECOVERY_INFERRED`.
- Jangan mencampur Player, Coach, dan Versus aggregate; Versus tidak memakai wallet/roster Player/Coach dan tidak punya transfer club atau pemilih negara.
- Semua notifikasi gameplay Versus lewat DM user.
- Promosi Versus baru dianggap selesai setelah Next Season membuat season baru di liga tujuan.
- Jangan menghapus data player tanpa backup dan prosedur migrasi.

---

## 9. Referensi proyek

- `README.md` — overview proyek dan operasi lokal
- `docs/AUDIT_FIX_REPORT_2026-10-18.md` — temuan audit, perbaikan, dan verifikasi
- `docs/AI_HANDOFF_FOOTBALL_RISING_STAR_DISCORD_2026-10-16.md` — handoff (lihat bagian pembaruan 2026-10-18)
- `docs/DISCORD_COMMAND_LAYOUT.md` — kontrak button-first
- `test/handlers-flow.test.ts` — alur tombol end-to-end ketiga mode
