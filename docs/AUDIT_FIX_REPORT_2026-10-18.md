# Audit & Perbaikan Parity — 18 Oktober 2026

**Branch:** `claude/dazzling-ritchie-rsmqre` · **Basis:** `883edf7` · **Status:** build ✅ · test **126/126** ✅ · `tools/targeted-audit.ts` PASS · `tools/stress-simulation.ts` PASS

Dokumen ini mencatat (1) defect yang ditemukan saat analisis "apakah bot sudah bekerja seideal game utama", (2) perbaikan yang dibuat, (3) audit mendalam atas perbaikan itu beserta perbaikan lanjutan, dan (4) bukti verifikasi. Semua nilai yang belum terverifikasi dari APK tetap berlabel `RECOVERY_INFERRED` di `src/config/game-balance.ts`.

---

## 1. Defect yang ditemukan pada analisis awal

Setiap angka "sebelum" diukur dengan simulasi terhadap kode `883edf7`.

| Mode | Defect | Sebelum |
|---|---|---|
| Player | Gol personal = gol tim; posisi tidak berpengaruh | GK mencetak 116 gol dalam satu karier |
| Player | World Footballer hampir otomatis | Menang 19/19 season, termasuk saat usia 15 di klub terlemah |
| Player | Rebirth mengembalikan rating ke dasar | Rating 99 → 24 setelah rebirth |
| Player | Recovery real-time hilang jika profil sering disimpan | 0 HP pulih setelah 4 jam dengan tick maintenance 15 menit |
| Player | Season 10 minggu terlepas dari fixture liga klub; match karier dan club match dua jalur berbeda | Klasemen tidak konsisten dengan hasil atlet |
| Player | Kontrak berbasis hari nyata, transfer tanpa syarat rating/window | Pindah ke Arsenal di minggu pertama |
| Coach | Ability Coach tidak memengaruhi pertandingan | Klub terlemah (Leeds) juara 33 dari 40 season simulasi |
| Coach | Klub Coach memakai atlet Player sebagai pemain | Mode tidak terisolasi |
| Versus | Semua klub mulai Liga A, NPC tidak mengikuti tier | Win rate klub baru 16% |
| Versus | HP/cedera/skors tidak berefek | 0 cedera sepanjang season |
| Versus | Market menjual pemain NPC sampai klub NPC tidak bisa menurunkan XI | Round crash ("lineup tidak lengkap") |
| Versus | Reservation coin bocor saat bidder keluar/season selesai | Coin terkunci permanen |
| Versus | Custom id lineup berisi battle id panjang | > 100 karakter mulai round 10 → Discord menolak panel |
| Versus | Promosi hanya dicatat, tidak pernah diterapkan; tidak ada rollover season | Klub tidak pernah pindah tier |
| Versus | Notifikasi DM belum ada | — |
| Platform | JSON store tanpa cek versi | Lost update saat dua aksi bersamaan |
| Platform | Setiap klik membuat pesan ephemeral baru | Spam panel, state lama tetap terlihat |

## 2. Perbaikan utama

### Player
- Weekly match = fixture liga klub berikutnya; round lain disimulasikan (circle method) sehingga klasemen lengkap; season berakhir setelah seluruh fixture (`player-match-engine.ts`, `league-engine.ts`).
- Performa personal per posisi: share gol/assist dengan batas per posisi, rating, kartu & skors, MVP, clean sheet (`simulatePersonalPerformance`).
- World Footballer dari statistik season (gol, assist, rating, MVP, clean sheet, prestasi tim) melawan kandidat dengan batas kelayakan penampilan.
- Recovery real-time memakai jam penuh: jam pecahan tidak hilang (`applyTimeRecovery`).
- Kurva skill 1–99 dengan band elite di atas 75, macro stat diturunkan dari detailed skill, Regular Training 1x/minggu, penurunan fisik usia 31+.
- Kontrak per season + gaji mingguan + perpanjangan/kenaikan gaji; transfer hanya saat window dengan rating minimal klub; tawaran klub di akhir season.
- Pensiun (sukarela ≥ 30, otomatis 34) dan rebirth dengan bonus skill, pilihan posisi, riwayat karier, money & honors dipertahankan.
- EXP yang tidak bisa dialokasikan (semua skill 99) dikonversi ke money agar loop tidak macet.

### Coach
- Enam ability berefek di match engine; board target dari peringkat ekspektasi; pemecatan di tengah season; job offer berbasis reputasi; transfer market memakai assets klub dengan kedalaman minimum; Season Settlement dengan ringkasan; Champions League dengan lawan kontinental dan gating matchday.
- Klub Coach tidak pernah memakai atlet Player.

### Versus
- Tier huruf S→E (klub baru di E), kekuatan NPC per tier, promosi rank 1–2, degradasi 2 terbawah.
- Attack/defence/control terpisah, trade-off taktik & formasi, matchup taktik, HP/cedera/skors berefek, gol/assist/clean sheet/rating tercatat, perkembangan & penuaan pemain.
- Lineup otomatis/darurat tidak pernah melempar error; submission tetap dihormati jika masih legal.
- Market: kedalaman NPC dilindungi, free agent, lelang 6 jam, anti-snipe, batas roster termasuk bid aktif, CANCELLED alih-alih error, market ditutup di akhir season dan semua reservation dilepas.
- Squad (lepas pemain), Scout, Sponsor (RECOVERY_INFERRED, configurable).
- `src/services/versus-service.ts`: lock grup, season kanonik, assignment public league `PUB-<tier>-<YYMMDD>-<NN>` (ambil slot NPC sebelum round 1), private group, catch-up bersama untuk panel & worker, rollover idempoten lewat **Next Season** — promosi baru diterapkan saat season baru dibuat di liga tujuan.
- Outbox DM per profil dengan id idempoten + dispatcher dengan retry/backoff dan error permanen.

### Platform & UX
- Optimistic concurrency di JSON dan PostgreSQL (`ConcurrentProfileUpdateError`), batch all-or-nothing, retry otomatis di handler dan service.
- Panel ephemeral diperbarui di tempat (`deferUpdate`), setiap edit menetapkan content/embeds/components.
- Custom id pendek: `frs:<user>:vl:<langkah>:<round>:<versi roster>` (maks 46/100).
- Semua fitur yang sebelumnya hanya bisa lewat command kini punya tombol: assign EXP multi-skill, trick, trainer, transfer offers, kontrak, klaim achievement, pensiun/rebirth Player & Coach, Coach market & settlement, Versus squad/scout/sponsor/bid/Next Season/DM toggle.
- Rate limit default 30/menit (lineup ±10 klik).

## 3. Audit mendalam atas perbaikan & perbaikan lanjutan

Audit dilakukan dengan membaca ulang diff secara adversarial, menjalankan stress simulation, membuat save dengan kode lama (`883edf7`) lalu memainkannya dengan kode baru, dan mengklik seluruh alur lewat interaksi Discord tiruan yang memvalidasi batas Discord.

| # | Temuan | Dampak | Perbaikan |
|---|---|---|---|
| A1 | `advanceWeek` tidak meneruskan RNG ber-seed ke event mingguan | Simulasi ber-seed tidak deterministik (stress tool gagal determinisme) | RNG diteruskan ke `preparePlayerWeek` |
| A2 | Klub Versus dari skala grade lama (semua mulai A, tanpa `tierVersion`) | Klub lama IDLE masuk Liga A melawan NPC terkuat; klub dari season lama yang promosi bergerak dua kali | Klub lama dinormalisasi ke Liga E di luar season aktif; season skala lama membayar reward tanpa perpindahan (`legacyReset`); rollover dijalankan sebelum normalisasi |
| A3 | Grup publik lama `MM-PUBLIC-*` dianggap private | Next Season akan bergabung ulang ke kode lama | `MM-` diperlakukan sebagai public league |
| A4 | Cedera tertimpa status skors | Setelah skors selesai pemain yang masih cedera bisa bermain | Status kembali `INJURED` bila cedera belum selesai |
| A5 | Tombol Lineup nonaktif memakai custom id `versus-home` (duplikat dengan Home) | Discord menolak pesan dengan id duplikat | Id tersendiri `versus-lineup-start` |
| A6 | PostgreSQL: pemegang lock grup menahan koneksi pool sambil butuh koneksi lain | Lonjakan aksi Versus bisa menghabiskan pool (10) dan macet | Semaphore: maks 4 lock grup bersamaan |
| A7 | PostgreSQL: setiap aksi Versus memuat seluruh tabel profil | Lambat saat user banyak | `versusMembers` (query per grup/prefix) + index `idx_player_profiles_versus_group` |
| A8 | PostgreSQL: insert pertama tetap versi 0; versi caller berubah sebelum COMMIT | Dua pembuat profil bersamaan bisa saling timpa; batch yang di-rollback meninggalkan versi salah di memori | Insert menaikkan versi; versi diterapkan setelah COMMIT |
| A9 | PostgreSQL: proyeksi battle/listing ditulis ulang untuk setiap anggota | ±8× query per simpan grup | Proyeksi sekali per season per batch |
| A10 | Season id hanya memakai tanggal | Kode grup yang dipakai ulang di hari sama → id battle/ledger/notifikasi bentrok (idempotency salah) | Season id memakai timestamp detik |
| A11 | `/admin refresh-markets` merujuk Player market yang sudah dihapus; subcommand Player club market/buy/sell/tactic/match masih terdaftar | Command menyesatkan | Diganti `run-maintenance` (memakai lock maintenance); subcommand usang dihapus dari registry fallback |
| A12 | Nilai posisi rebirth dari select tidak divalidasi | Posisi tidak sah bila payload dimanipulasi | Divalidasi |
| A13 | Stress tool: tidak menangani pemecatan Coach di tengah season; path output absolut mesin lain | Tool gagal | Ambil tawaran saat dipecat; path relatif repo |
| A14 | `tools/targeted-audit.ts` mengimpor fungsi yang sudah tidak ada (sejak sebelum perubahan ini) | Tool tidak bisa dijalankan | Ditulis ulang dengan temuan terukur |

## 4. Verifikasi

### Test (126 lulus)
Selain test lama yang diperbarui untuk perilaku baru (kontrak per season, lelang 6 jam, gating Champions League, tier E), ditambahkan:
- `test/handlers-flow.test.ts` — klik end-to-end Player/Coach/Versus lewat interaksi tiruan; setiap panel divalidasi (custom id ≤ 100 & unik, ≤ 5 baris, select sendiri di barisnya, 1–25 opsi unik, min ≤ max, embed ≤ 6000, field ≤ 1024, tidak pernah pesan kosong); penolakan user lain dan round basi.
- `test/versus-service.test.ts` — assignment public league & slot NPC, grup baru setelah round 1, lineup, outbid DM, pengingat deadline, catch-up paralel memproses round sekali, season penuh → DM akhir season → Next Season memindahkan grade sekali, private group.
- `test/notifications.test.ts` — idempotency, delivery sekali, backoff & batas percobaan, error permanen, DM dimatikan, merge outcome ke profil terbaru, tidak kirim ulang saat status gagal disimpan.
- `test/legacy-migration.test.ts` — save versi lama: kontrak waktu, tanpa season stats, Player market lama, klub Versus skala lama (IDLE, season selesai, season berjalan).
- `test/parity-fixes.test.ts` — recovery per jam, kurva skill, Regular Training mingguan, output per posisi, rebirth, efek ability Coach, kekuatan tier, cedera/skors/gol/clean sheet/lineup darurat, cedera vs skors.
- `test/storage-concurrency.test.ts` — stale write ditolak, batch all-or-nothing, batas lock grup PostgreSQL.

### Simulasi (kode saat ini)
| Ukuran | Hasil |
|---|---|
| Karier penuh (3 seed/posisi, latihan & EXP terarah, terima setiap tawaran) | 19 season, pensiun usia 34 |
| FW | Puncak 39–43 gol/season (usia 28–33), 490–543 gol karier, World Footballer 8–12× |
| MF / DF / GK | WF 2–4× / 0× / 0×; GK 0–2 gol karier |
| Coach, klub sama, seed sama | Rata-rata peringkat Lv1 **19.8** vs Lv25 **7.3** |
| Liga | 20 klub × 38 match, ±3.2 gol/match, semua klub bermain 38 |
| Versus | NPC S→E 80.2 > 75.7 > 69.7 > 65.6 > 61.3 > 57.0; win rate klub baru vs NPC Liga E 32%; semua gol punya pencetak; cedera terjadi |
| Discord | Custom id terpanjang 46/100 (round 38, versi roster 99999) |
| Stress (trial ber-seed) | Player/Coach/Versus: 0 trial gagal, 0 pelanggaran invariant, 0 kegagalan determinisme |
| Migrasi | Save buatan `883edf7` (Player, Coach, grup `MM-PUBLIC` aktif dengan lelang lama, season selesai) dimainkan lewat handler baru tanpa error |

## 5. Batasan yang tersisa

- Formula dan angka balance tetap `RECOVERY_INFERRED` (rating, peluang gol, reward, cedera, sponsor/scout/taktik Versus, harga lelang).
- Data roster recovered tidak lengkap; klub diisi pemain sintetis sampai kedalaman minimum.
- Season Versus masih direplikasi di setiap profil anggota (8 klub maks). Repository kanonik PostgreSQL untuk Versus adalah langkah skala berikutnya.
- Rate limiter dan per-user queue bersifat per-proses; multi-instance memerlukan Redis/DB.
- World Footballer untuk FW yang dioptimalkan maksimal cukup sering (8–12×/19 season); atur `GAME_BALANCE.worldFootballer` bila ingin lebih langka.

## 6. Kepatuhan aturan handoff

- `/play` tetap satu-satunya command publik default.
- Versus tanpa pemilih negara, tidak terhubung ke wallet/roster Player/Coach, tidak ada transfer klub Versus.
- Semua notifikasi gameplay Versus lewat DM; ada test delivery, retry, dan idempotency.
- Promosi baru diterapkan saat Next Season membuat season baru di liga tujuan.
- Ruleset yang belum terverifikasi berlabel `RECOVERY_INFERRED`.
- `.env` user dan attachment tidak disentuh; token tidak dicetak.
