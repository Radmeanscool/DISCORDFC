# Sintesis Analisis Visual Football Rising Star

**Tanggal:** 2026-10-16
**Repository:** `/home/ubuntu/DISCORDFC`
**Ruang lingkup:** sintesis lima paket analisis: Player Mode, Coach Mode, Versus Multiplayer, APK/recovery visual-assets, dan cross-mode UI/gameplay.

> **Kesimpulan eksekutif:** Football Rising Star paling aman dipahami sebagai tiga karier/aggregate yang berbeda: **Player** (karier satu atlet), **Coach** (karier manajemen klub single-player), dan **Versus** (mode manajemen klub multiplayer online yang berdiri sendiri dan coach-like). Source checkout sudah memisahkan state, roster, kompetisi, wallet, serta progression ketiga mode tersebut dan suite terfokus melaporkan 87 test lulus serta TypeScript lulus. Namun parity visual belum selesai. Khusus Versus, target arsitektur yang benar adalah **Coach Multiplayer mandiri**—dengan klub yang dibuat/diinisialisasi oleh user, online league, market, roster/lineup, scheduled battle, notification delivery, dan larangan perpindahan klub yang eksplisit—sedangkan checkout saat ini baru mewujudkan sebagian: klub masih dibuat otomatis sebagai `${displayName} FC`, market Deal sudah mutatif tetapi Scout/Sponsor masih preview, settlement terjadwal ada tetapi notification belum ada, dan larangan pindah group belum immutable di seluruh lifecycle.

---

## 1. Cara membaca laporan dan batas klaim

Analisis menggabungkan bukti dengan empat provenance utama:

- **`VIDEO_OBSERVED`** — perilaku yang tampak pada walkthrough/video. Ini membuktikan surface dan urutan visual, bukan formula server.
- **`PUBLIC_OFFICIAL`** — listing/store metadata atau materi resmi. Ini membuktikan keberadaan/positioning pada tingkat terbatas, bukan seluruh lifecycle.
- **`COMMUNITY`** — laporan komunitas/NamuWiki dan observasi non-resmi. Berguna untuk hipotesis edge case, tetapi bukan angka immutable.
- **`SOURCE_CODE_VERIFIED` / `TEST_VERIFIED`** — perilaku yang benar-benar ada di checkout dan diuji. Ini membuktikan implementasi DISCORDFC saat ini, bukan bahwa perilaku tersebut identik dengan APK asli.
- **`RECOVERY_INFERRED`** — desain rekonstruksi yang masuk akal dari signature, naming, atau gap evidence. Tidak boleh ditulis sebagai formula atau aturan Football Rising Star yang telah dipastikan.

Angka seperti peluang injury, durasi kontrak, season length, retirement age, match rating, reward, matchmaking window, harga market, dan coefficients ability tetap **versioned/configurable recovery decisions**, bukan formula asli yang terverifikasi. “Sudah ada” pada laporan ini berarti ada di checkout atau test, bukan berarti sudah parity dengan produk asli.

---

## 2. Model produk tiga mode

| Mode | Unit pengalaman | Kompetisi | State/roster utama | Sifat waktu | Kesimpulan arsitektur |
|---|---|---|---|---|---|
| **Player** | Satu atlet yang membangun karier | Fixture klub/nasional, liga, kompetisi cup/Champions-like | `PlayerProfile`, detailed skills, injury, contract, honors, career | Weekly/seasonal, match disimulasikan | Career athlete; klub Player dapat berubah melalui jalur official-club |
| **Coach** | Satu pelatih yang mengelola klub | Liga, promosi/relegasi, target board, QCL-like | Coach career + `coachClubState`, roster/staff/budget/formasi/taktik | Round/seasonal, simulasi dua babak | Club-management career single-player/AI; bukan multiplayer |
| **Versus** | User mengelola satu klub online | Group/league online, fixture home-away, scheduled battle | `VersusUserSave`, `VersusClub`, Versus roster, season, standings, wallet, ledger | Deadline dan time-driven settlement | **Coach Multiplayer mandiri**, bukan Player atau Coach yang diberi flag multiplayer |

Account Discord/infrastruktur boleh sama, tetapi mutable career state tidak boleh dicampur. Mode isolation adalah boundary bisnis, bukan hanya pilihan UI.

### 2.1 Koreksi istilah Versus

Istilah “Coach Multiplayer” dapat dipakai sebagai **label produk/arsitektur** untuk menjelaskan pengalaman mengelola klub secara online. Ia tidak boleh ditafsirkan sebagai:

1. Coach career biasa yang diberi matchmaking;
2. Player career yang memiliki tombol PvP;
3. klub Coach/Player yang dipindahkan ke league online;
4. bukti bahwa protokol asli real-time atau bahwa API/auth server sudah recovered.

Definisi target yang lebih presisi:

> **Versus adalah mode online, group-based, asynchronous/server-synchronized club management. User memiliki satu aggregate klub Versus sendiri; klub itu mengikuti online league/season, memakai roster, lineup, tactic, market, currency, schedule, battle settlement, standings, rewards, history, dan notifications yang terpisah dari Player dan Coach. Klub tidak dapat dipindahkan ke owner/group/club lain setelah dibuat/di-enroll, kecuali migration policy eksplisit di batas season yang diputuskan product owner.**

“Klub buatan user” di atas adalah **target UX/arsitektur yang perlu diwujudkan**, bukan klaim bahwa checkout sudah mendukung custom creation. Bukti visual memperlihatkan country/crest/name setup; source saat ini memakai system-managed `${displayName} FC`. Karena ownership semantics asli belum terbukti, implementation parity tidak boleh dikarang.

---

## 3. Flow visual Football Rising Star per mode

### 3.1 Player Mode — karier satu atlet

**Flow visual yang berulang:**

1. **Onboarding dan hub pemain** — identitas/posisi, usia awal sekitar 15, klub, tanggal, energy/health, status kondisi, dan fixture berikutnya.
2. **Preparation** — tab ability, training, personal, contract/club; user memilih Regular Training, Trick Training, Personal Training, trainer, rest/recovery, atau treatment.
3. **Weekly update/event** — event career/life muncul secara kondisional di timeline mingguan. Pilihan dapat memengaruhi EXP, energy/stamina, teamwork/willpower, fans/charm/fame, money, atau club impression.
4. **Next Week / Next Round** — aktivitas dan scheduled match diproses. Match bukan kontrol lapangan real-time; hasil disimulasikan.
5. **Match result** — score, rating kira-kira 0–10, goals/assists, event gol/kartu, injury/availability, dan konteks kompetisi. Video juga memperlihatkan MVP, cards, substitutions, dan richer match surface pada sebagian result.
6. **EXP allocation** — setelah match, EXP ditampilkan sebagai pending lalu dialokasikan manual ke detailed skills.
7. **League/career update** — standings, career log, season/competition progress, break, new season, Q League/Champions-like competition, Earth Cup/national call-up, dan penghargaan.
8. **Contract/transfer** — salary, role, competitiveness, duration, ask for pay, renew/negotiate, transfer/request leave, accept offer, dan perpindahan lintas klub/league.
9. **Late career** — retirement sekitar usia pertengahan 30-an terlihat/diinferensikan; rebirth mempertahankan sebagian state seperti money menurut evidence komunitas, tetapi detail inheritance/reset belum aman diklaim.

**Detail visual penting:** 12 detailed skills yang konsisten muncul adalah Shots, Penalty, Header, Pass, Dribbling, Free Kick, Off-ball Running, Hold Off Defenders, Teamwork, Endurance, Speed, dan Willpower. Macro labels dalam source (`atk/def/power/strength/technique`) tidak boleh disajikan sebagai formula asli untuk PHY/OFF/DEF/TEC/STA/SPD tanpa mapping authoritative.

**Perbedaan implementasi utama:** `preparePlayerWeek` dapat menghasilkan `EVENT_PENDING`, lalu `playPreparedWeek` membawa flow ke `EXP_PENDING`; test UI memverifikasi `READY → MATCH_READY → EXP_PENDING → READY` dan event memblokir match. Tetapi engine masih memiliki season/fixture simplification: `weeksPerSeason` inferred 10 dan reset league pada matchday >10, belum menjadi kalender August–May multi-competition yang divisualisasikan. Contract engine juga baru sign/renew terhadap `profile.club`, belum offer/negotiation/transfer lifecycle lengkap.

### 3.2 Coach Mode — karier manajemen klub single-player

**Flow visual yang berulang:**

1. **Coach onboarding** — identitas, nationality, age, coach abilities; video memperlihatkan pilihan beberapa klub, offer, salary/target, dan penerimaan pekerjaan.
2. **Club home/office** — roster, staff, budget, board target, league position, fixture, job security, EXP, honors, dan season context.
3. **Squad/market management** — video menampilkan List, Scout, Deal, scouting posisi/ability/budget/rating, signing dan selling pemain, offer/salary/contract.
4. **Tactical preparation** — formasi, delapan gaya taktik, lineup, lawan/opponent information. Match berlangsung melalui simulasi dua babak dan perubahan halftime.
5. **Decision/event layer** — morale, finance, discipline, media/press, locker room, youth/academy, medical/team doctor, budget, dan target-season decisions dapat memblokir atau mengubah hasil.
6. **Match/result** — half-time state, final score, commentary, MVP, table/standings, EXP, board checkpoint, promotion/relegation, dan QCL-like progression.
7. **Career lifecycle** — job offer, dismissal, klub baru, retirement, honors, dan rebirth.

**Yang benar secara arsitektur:** Coach adalah single-player/AI club-management career, bukan mode multiplayer yang terbukti. Ia memiliki `coach`, `coachClubState`, boardTarget, jobOffers, abilities, formation/tactic, dan season progression sendiri.

**Gap checkout:** `createCoachCareer` menggunakan `profile.club` yang sudah ada dan langsung membuat state; belum ada onboarding offer multi-klub/contract receipt. Coach match memilih squad otomatis dari formation; belum ada editor legal XI/substitution/halftime decision setara video. Market/Scout/Deal Player tidak menerima `coachClubState`. Event hanya lima template generik dan enum `YOUTH_SYSTEM` belum memiliki youth roster, academy progression, resolver, atau dedicated UI. Retirement Coach hanya menyimpan honor/status/retiredAt; summary/history visual belum lengkap.

### 3.3 Versus — online club-management multiplayer

**Flow visual yang terlihat:**

1. **Mode selector/setup** — selector Player/Coach/Versus; footage dedicated memperlihatkan country, crest/logo, dan club name setup. Ini adalah bukti surface setup, belum bukti ownership transfer atau bahwa custom identity sudah ada di source.
2. **Versus Home** — cash/coin/energy, registration/registered state, group allocation time, next match/countdown, latest result, record, club rank, standings, rewards, schedule, dan global/ranking tabs.
3. **Online league enrollment** — user masuk group/season dengan deadline. Interpretasi paling aman adalah asynchronous/server-synchronized, bukan live simultaneous PvP.
4. **Roster/lineup** — roster tersendiri, formation, tactic, XI per position, captain, substitutes, player condition/cards/injury/status, confirm submission, roster version, battle ID, dan deadline.
5. **Match Preview** — lawan, strength/attack/defence/star players, home/away, scheduled time; input dikunci melalui snapshot agar hasil dapat direproduksi.
6. **Scheduled battle** — setelah deadline, service menyelesaikan dua half/home-away settlement, score, player stats/condition, standings, rewards, dan history.
7. **Market/Deal/Scout** — Deal auction memiliki countdown, bid/minimum increment, coin reservation, outbid release, expiry, atomic settlement, roster transfer pemain, dan ledger. Scout masih preview pada checkout; cost/offer/status mutation belum aman.
8. **Sponsor/rewards/rankings** — sponsor tiers, rewards, club detail/fixtures, player/club ranking tabs. Sponsor di checkout baru preview dan belum payout/cooldown persistence.
9. **Notification requirement** — produk target harus mengirim registration/deadline, lineup lock, round settlement, result/reward, auction expiry/outbid, dan season state melalui persisted unread notifications + delivery adapter.

**Arsitektur target:** setiap user memiliki satu `VersusClub` yang tidak pernah dipindahkan melalui Player/Coach transfer path. Wallet `versusMoney`/`versusCoin`, roster, league, market, fixtures, standings, battle receipt, history, dan ledger adalah aggregate tersendiri. “Free market” dipakai di laporan ini sebagai **market/Deal player exchange**; detail harga, biaya Scout, premium/diamond shop, dan economics asli tetap recovery-inferred atau belum terimplementasi.

---

## 4. Temuan source aktual dan gap nyata

### 4.1 Yang sudah ada di checkout

**Player**

- `gameplay-engine.ts` memiliki preparation weekly, optional event blocking, match-ready state, match play, EXP pending/allocation, training/trick/trainer/culture, injury treatment, annual award, retirement, dan rebirth.
- Detailed Player fields dipisahkan dari Coach/Versus.
- Player dapat memiliki injury, treatment, contract, honors, retirement, serta league/club state.
- UI stage dan owner-bound components untuk weekly flow telah diuji.

**Coach**

- `coach-career-engine.ts` memiliki Coach abilities, EXP allocation, event blocking, boardTarget, jobOffers, season/round progression, Champions-like state, retirement, dan rebirth.
- `club-engine.ts` memiliki ClubState terpisah, roster, fixtures, standings, formation, tactic, halftime/final score, commentary, dan MVP.
- Command/component menyediakan Coach Profile, Play Round, Club Office, Decision, Coach EXP, Formation/Tactic, Job Offers, dan Champions.

**Versus**

- `versus-engine.ts` membuat `vclub:<userId>` dengan `ownerId`, roster baru 18 pemain, formation/tactic, budget, wallet, season/group, fixtures, standings, rewards, schedule, history, dan sync.
- Versus membuat home/away round-robin, legal lineup validation, captain/substitutes, roster-version/deadline guards, deterministic two-half settlement, condition/cards/injury update, rewards, dan idempotent season sync.
- `versus-economy.ts` memiliki Deal market snapshot NPC, coin reservation, minimum increment, outbid release, expiry, atomic settlement, roster move, dan ledger idempotency.
- `versus-matchmaking.ts` memiliki queue ticket/TTL, rating snapshot/window widening, dan deterministic assignment; ruleset-nya inferred.
- Public menu/components/handlers sudah mencakup Home, registration, market, rewards, schedule, rankings, global ranking, sponsor, results, standings, pre-match preview, formation/tactic, lineup, captain, substitutes, dan confirmation.
- `maintenance.ts` dapat memproses due rounds dan expired listings secara background; ini settlement/maintenance, bukan notification delivery.
- `mode-isolation.test.ts` membuktikan perubahan Player/Coach tidak mengubah Versus wallet/roster/league/formation. Test Versus dan economy membuktikan assignment, battle, standings, rewards, reservation, settlement, dan idempotency.

**Cross-mode/operational**

- `/play` dan Game Home menjadi default entry yang menampilkan tiga mode; fallback slash commands tetap tersedia bila dikonfigurasi.
- Storage memiliki `player_profiles.payload` JSONB compatibility store dan sebagian projection Versus (`versus_queue_tickets`, `versus_matches`, `versus_market_listings`, `versus_wallet_reservations`, economy ledger columns).
- Background worker/maintenance tersedia untuk pekerjaan terjadwal; persistence concurrency dan mode isolation sudah memiliki test.
- Laporan analis mencatat **87 test lulus** dan `tsc --noEmit` lulus pada inspeksi. Checkout aktual juga memiliki perubahan existing yang tidak dibuat oleh analisis: `README.md`, `docs/CLIENT_DATA_INTEGRATION.md`, `src/domain/engine.ts`, dan `test/club-progression.test.ts`.

### 4.2 Gap yang benar-benar ada

| Area | Gap checkout | Dampak |
|---|---|---|
| Player calendar | Season 10-week/reset simplification; fixture/competition/national calendar belum terpisah dan configurable penuh | Weekly loop tidak parity August–May, QCL/Earth Cup/national schedule, full table |
| Player events | Catalog generic `INTERVIEW`, `SPONSOR_OFFER`, `MEDICAL_INCIDENT`, `LIFESTYLE`; belum provenance-tagged observed catalog dan trigger/context lengkap | Tidak boleh mengklaim event parity; risk daily/random reversion |
| Player contract | Sign/renew terhadap club aktif, formula salary dan 180-day term; belum offer snapshot, ask-pay, accept/reject, request, history, atomic eligibility | Transfer/contract screens video belum tersettle |
| Player match/result | Yellow counter/injury ada; red-card suspension explicit, lineup/MVP/substitution/richer receipt belum lengkap | Availability dan visible result surface tidak lengkap |
| Player honors | Annual World Footballer + generic honors ada; MVP, Golden Boot, UEFA/European, team/national trophies, season records, append-only Hall belum penuh | Hall/award lifecycle tidak parity |
| Retirement/rebirth | Reset career/stat/league; money/honors dipertahankan, tetapi linked generation/final snapshot tidak ada | Historical career preservation dan inheritance tidak auditable |
| Coach onboarding | Langsung memakai `profile.club`, belum offer multi-klub/target/salary receipt; initial ability tidak selalu video parity | Career start/contract flow dangkal |
| Coach management | Belum Coach-specific List/Scout/Deal, buy/sell/contract/interest/roster transaction | Visual market Coach tidak terwujud |
| Coach match | Squad auto-selected; belum lineup editor, opponent detail, halftime substitution/tactic UI | Match loop tidak parity |
| Coach event/academy | Lima template generik; Youth System hanya enum, tanpa academy/youth roster/progression | Event context dan youth flow hilang |
| Versus identity | Auto `${displayName} FC`, country 0; belum custom name/crest/country onboarding | “Klub buatan user” belum nyata di checkout |
| Versus club mobility | Group berbeda ditolak terutama saat `IN_GAME`; status `ENROLLED`/post-`GAMEOVER` belum mengunci permanen | Larangan pindah klub belum invariant lifecycle penuh |
| Versus assignment | Public helper berbasis group/date berbeda dari queue matcher; canonical assignment/ticket ownership belum satu jalur | Risiko assignment inkonsisten dan audit sulit |
| Versus notifications | Maintenance settle state tetapi tidak ada inbox/unread/push/DM/reminder | User dapat melewatkan deadline, result, reward, outbid |
| Versus market | Deal mutatif ada; Scout/Sponsor preview; premium shop, costs, status improvement, payouts belum authoritative | Jangan mengaktifkan mutasi/economy tanpa ruleset |
| Versus persistence | Banyak state nested dalam profile JSONB; canonical shared season/battle/settlement repository belum penuh | Multi-instance repair, lease, audit, dan scale belum production-grade |
| Versus telemetry/ranking | Global ranking, saves/tackles/GK telemetry, promotion/relegation, exact cadence/MMR belum terverifikasi | Ranking/analytics tidak boleh ditulis sebagai parity |
| Asset/recovery | Raw screenshot/assets tidak ada untuk pixel-level mapping; generic event art tidak membuktikan mode/trigger | Asset-to-data correlation masih terbatas |

---

## 5. Matriks evidence dan provenance

| Klaim/fitur | Provenance terbaik | Status pada checkout | Cara menuliskan dengan aman |
|---|---|---|---|
| Player memiliki hub, tanggal, energy/health, fixture, Next Week | `VIDEO_OBSERVED` | **Sebagian ada** pada handlers/gameplay state | “Video memperlihatkan; source mengimplementasikan sebagian stage” |
| Player weekly state machine memblokir match saat event | `SOURCE_CODE_VERIFIED`, `TEST_VERIFIED` | **Ada dan diuji** | “Behavior checkout verified; bukan bukti formula APK” |
| 12 detailed skills dan training/trick | `VIDEO_OBSERVED` + source field | **Ada sebagian** | “Nama surface observed; mapping macro tidak authoritative” |
| Player injury/treatment | `VIDEO_OBSERVED` + source/test | **Ada** | “Treatment/injury block tersedia; pricing/video ads bukan parity rule” |
| Player transfer/negotiation | `VIDEO_OBSERVED` | **Gap**; contract engine hanya sebagian | “Visible in video; lifecycle belum implemented end-to-end” |
| Player awards/Hall/retirement/rebirth | `VIDEO_OBSERVED`, `COMMUNITY`, partial source | **Parsial** | “Annual/generic state ada; categories/history/inheritance unresolved” |
| Coach adalah single-player club management | `VIDEO_OBSERVED`, `SOURCE_CODE_VERIFIED` | **Ada pada boundary** | “Tidak ada evidence Coach sendiri multiplayer” |
| Coach List/Scout/Deal | `VIDEO_OBSERVED` | **Gap** | “Visual behavior observed, Coach API belum tersedia” |
| Coach six abilities/board/job/retirement | `SOURCE_CODE_VERIFIED` + video | **Ada parsial** | “State/engine ada; onboarding/summary belum parity” |
| Versus adalah online/group scheduled competition | `VIDEO_OBSERVED`, recovery signatures, source/test | **Ada parsial** | “Online/asynchronous is safest interpretation; real-time not proven” |
| Versus aggregate terpisah dari Player/Coach | `SOURCE_CODE_VERIFIED`, `TEST_VERIFIED` | **Ada dan diuji** | “Roster, wallet, league, market boundary terisolasi” |
| User creates custom Versus club name/crest/country | `VIDEO_OBSERVED` only | **Belum ada di source** | “Target/product evidence; implementation currently system-managed” |
| Versus has roster/lineup/tactic/preview | `VIDEO_OBSERVED`, source/test | **Ada parsial** | “Lineup snapshot/guards exist; visual telemetry may be incomplete” |
| Versus Deal auction/free-market behavior | source/test + visual Deal | **Deal ada** | “Implementasi inferred; Scout/Sponsor remain preview” |
| Versus scheduled battle/settlement | source/test/maintenance | **Ada** | “Settlement is implemented; delivery notification absent” |
| Versus notifications | target requirement/inferred product need | **Belum ada** | “Required capability, not current implementation” |
| Klub Versus tidak boleh pindah | design recommendation + partial source | **Belum enforce penuh** | “Active in-game guard exists; immutable lifecycle policy not implemented” |
| Exact formulas, match rating, rewards, MMR, prices | `RECOVERY_INFERRED` or backend-required | **Tidak terverifikasi** | “Configurable reconstruction; never claim original” |
| Public listing: Player/Coach/Versus exist | `PUBLIC_OFFICIAL` | **Supports mode existence** | “Official metadata supports existence only” |
| Community retirement around 34 / multi-league | `COMMUNITY` | **Hypothesis/config** | “Community-reported/inferred, not immutable” |
| 87 tests + TypeScript pass | `TEST_VERIFIED` | **Reported pass** | “Verifies checkout behavior, not APK parity” |

### 5.1 Aturan provenance untuk dokumen dan UI

1. Simpan provenance pada field/fixture/event/award, bukan hanya di laporan global.
2. Bedakan `VIDEO_OBSERVED` dari `SOURCE_CODE_VERIFIED`; keduanya dapat sama-sama benar tetapi mengukur objek berbeda.
3. Semua formula recovery memakai version key, misalnya `recovery-inferred-v1`, agar dapat diganti tanpa migrasi seolah-olah formula asli.
4. Jika UI memerlukan fitur yang belum ada, tampilkan **unavailable/coming-soon/evidence-boundary state**, bukan angka palsu.
5. Jangan mengkalibrasi coefficient dari satu video atau satu rating visual.

---

## 6. Keputusan arsitektur Versus yang direkomendasikan

### 6.1 Aggregate dan ownership

`VersusClub` harus menjadi aggregate root yang stabil dan owner-bound:

- `clubId` immutable sejak creation/assignment;
- `ownerId` tidak berubah melalui Player/Coach transfer;
- custom `name`, `country`, `crest` disimpan sebagai identity state bila product owner mengesahkan UX setup;
- satu user tidak mendapat migrasi klub diam-diam saat menjalankan official Player transfer;
- satu Versus club tidak boleh masuk ke group/league lain setelah enrolled, minimal sampai season selesai, dan target produk yang lebih kuat mengunci ownership/group assignment secara permanen;
- perpindahan atau reset harus menjadi command/migration yang eksplisit, audited, versioned, dan bukan efek samping `enrollVersus`.

### 6.2 Online league dan scheduled battle

Season canonical menyimpan season/group/league, club membership, round deadline, battle home/away, locked lineup snapshot, settlement receipt, standings delta, reward receipt, dan idempotency key. Client/Discord handlers hanya mengirim command; worker/transaction boundary menjadi sumber kebenaran untuk due round dan auction expiry. Real-time transport tidak diasumsikan.

### 6.3 Roster, lineup, dan market

Roster Versus tidak mewarisi Player progression. Lineup dikunci terhadap `rosterVersion` dan `battleId`. Market dipisah menjadi:

- **Deal/auction:** dapat mutatif setelah reservation/settlement ledger yang atomik;
- **Scout:** tetap read-only sampai cost, offer generation, refresh, status improvement, dan persistence dibuktikan/diputuskan;
- **Sponsor:** tetap preview sampai tier, payout, cooldown, claim, dan ledger ditentukan;
- **premium shop/diamond:** tidak diaktifkan sebagai gameplay tanpa evidence dan ekonomi yang disepakati.

“Free market” bukan alasan untuk mengarang harga/interest formula.

### 6.4 Notification dan observability

Settlement tidak selesai secara produk sampai outcome dapat disampaikan. Tambahkan `Notification` append-only/idempotent dengan `type`, `recipient`, `mode`, `entityId`, `dedupeKey`, `createdAt`, `readAt`, `deliveryStatus`, dan payload yang aman. Event minimal:

- registration accepted/group assigned;
- lineup deadline reminder dan lineup locked;
- battle completed/result published;
- rewards/standings changed;
- Deal outbid/expired/settled;
- season start/end dan reward claim;
- failure/retry/maintenance alert internal.

Delivery adapter dapat DM Discord atau channel sesuai konfigurasi; state notification harus tetap ada bila delivery gagal.

---

## 7. Roadmap tanpa klaim formula asli

### P0 — integrity, boundary, dan user-visible correctness

1. **Enforce mode isolation sebagai regression contract.** Tambah tests bahwa Player/Coach club, wallet, roster, market, contract, formation, dan official-club transfer tidak pernah menyentuh Versus.
2. **Putuskan dan enforce club immobility.** Tambah invariant `clubId`/`ownerId` stabil dan group assignment tidak berubah saat `ENROLLED`, `IN_GAME`, maupun post-season sesuai policy. Jika post-season migration diizinkan, modelkan sebagai transition eksplisit; jangan diam-diam menerima group code baru.
3. **Satukan assignment path.** Public helper dan queue matcher harus menghasilkan persisted `assignmentId`, ticket status, season/group ownership, TTL, dan audit trail yang sama; private group fallback diberi label berbeda.
4. **Bangun notification/outcome model.** Persisted unread notification + delivery adapter + dedupe/idempotency untuk deadline, result, reward, outbid, expiry, dan registration.
5. **Pisahkan state Player weekly dari presentation.** Primary UX harus tetap Weekly Update → Match Ready → Result → Assign EXP → League; jangan expose primitive compressed `advanceWeek` sebagai shortcut yang menghilangkan state.
6. **Tambahkan Versus target onboarding tanpa mengarang parity.** Sediakan name/country/crest hanya sebagai product state jika keputusan ownership sudah disetujui; bila belum, copy UI harus jujur: “assigned/system-managed club”.
7. **Selaraskan docs dengan source/test terbaru.** Bedakan gap lama (misalnya settlement yang sudah tersedia) dari gap aktif (notification, canonical storage, group lock).

**Exit criteria P0:** seluruh mode-isolation dan lifecycle lock tests lulus; setiap due battle/auction menghasilkan satu receipt dan satu notification record; user dapat melihat pending action/deadline/result dari Home; tidak ada cross-mode wallet/roster mutation.

### P1 — visual parity dan complete lifecycle

1. **Player calendar-driven season.** Modelkan season, matchday, competition, national call-up, QCL/Earth Cup, break, dan season settlement sebagai state terpisah; `weeksPerSeason` menjadi versioned config, bukan reset hard-coded.
2. **Player contract/transfer lifecycle.** Implementasikan offer snapshot (club/league/rank/role/salary/duration), ask-pay/negotiation, accept/reject/request, contract history, atomic club+contract+fixture eligibility, dan retry/concurrency tests.
3. **Player result/discipline receipt.** Tambahkan red-card, explicit suspension, availability, lineup, goals/assists/defensive contributions, cards, injury weeks, rating, MVP, EXP, league delta; field nullable jika evidence belum lengkap.
4. **Evidence-safe Player event catalog.** Catalog observed names/context/trigger, choice ledger, resolved-once semantics, provenance tags, dan disable switch. Tidak ada always-daily random conversion.
5. **Coach onboarding dan market.** Coach-specific club offers, target, salary/contract receipt, List/Scout/Deal, buy/sell, roster capacity, interest, atomic settlement. Jika formula belum diketahui, gunakan ruleset configurable dan label inferred.
6. **Coach tactical flow.** Opponent preview, legal lineup editor, halftime tactic/substitution, match-result statistics, board checkpoint, season summary.
7. **Coach event/youth layer.** Implementasikan trigger/context families (media, morale, finance, discipline, medical, youth/academy) hanya sampai tingkat yang dapat didukung evidence; placeholder unavailable lebih baik daripada formula rekaan.
8. **Versus canonical repository.** Pindahkan season, club, roster snapshot, battle, settlement, standings, reward, market, dan ledger ke transaction boundary/queryable projections; profile JSONB dipertahankan sebagai read projection/compatibility.
9. **Versus visual surface.** Home countdown, read-only Match Preview, lineup lock receipt, Deal countdown/outbid/settlement, standings/rewards, result stats, ranking tabs.

**Exit criteria P1:** tiap visible transition memiliki persisted state/receipt; contract dan battle settlement atomic/idempotent; Coach/Player/Versus visual stages dapat diulang tanpa state compression; Scout/Sponsor tetap disabled atau read-only sampai rule contract selesai.

### P2 — scale, recovery confidence, dan enriched parity

1. PostgreSQL integration tests untuk worker lease, multi-instance settlement, stale component, concurrent bid, retry, rollback, dan repair.
2. Cross-season/global ranking projection dan telemetry saves/tackles/GK hanya bila source data tersedia.
3. Append-only Player honors, season records, Hall of Honor categories, retirement final snapshot, linked rebirth generation, dan configurable inheritance.
4. Full Coach academy/youth progression dan historical job/retirement summaries.
5. Notification delivery preferences, retry/dead-letter observability, localization, and user-facing notification inbox.
6. Controlled APK capture/authoritative documentation untuk endpoint, auth, server authority, exact market, MMR, promotion/relegation, real-time transport, dan asset-to-event mappings.
7. Review every inferred coefficient; maintain a versioned “recovery inferred” changelog rather than silently presenting it as original gameplay.

**Exit criteria P2:** production-grade audit/repairability, explicit provenance at data and UI level, and no unsupported claim in product copy or documentation.

---

## 8. Checkout readiness: sudah ada vs belum ada

### Sudah ada

- Tiga mode tampil sebagai first-class entry pada Game Home.
- Player weekly state machine, match simulation, EXP allocation, training, injury/treatment, contract basics, awards/retirement/rebirth basics.
- Coach career aggregate, abilities, board/job/season progression, club match simulation, formation/tactic, event blocking, retirement/rebirth basics.
- Versus aggregate terpisah: `VersusUserSave`, `VersusClub`, roster 18 pemain, ownerId, wallet, group/season, home-away fixtures, lineup/formation/tactic, deadline, battle settlement, standings, rewards, history, Deal auction, reservations, ledger, queue matcher, maintenance sync.
- Owner-bound Discord components, stale/deadline/rosterVersion validation, deterministic settlement, idempotent economy settlement, dan mode-isolation tests.
- Background processing untuk due Versus rounds/expired listings, meskipun belum ada delivery notification.
- Laporan verifikasi menyebut 87 test lulus dan TypeScript check lulus.

### Belum ada atau belum aman diklaim

- Player full August–May calendar/multi-competition/national schedule.
- Player full offer/negotiation/transfer/contract history and eligibility atomicity.
- Player red-card suspension, complete result receipt, all awards/Hall categories, immutable retirement snapshot/linked rebirth history.
- Coach multi-club onboarding offers, Coach List/Scout/Deal, buy/sell/contract market, manual lineup/substitution/halftime, full event/youth/academy layer.
- Versus custom club identity (name/crest/country) in source; current public path auto-creates `${displayName} FC`.
- Versus immutable no-club-transfer invariant across `ENROLLED`, `IN_GAME`, and `GAMEOVER`; current guard is partial.
- Versus canonical assignment service and canonical shared season/battle repository at multi-replica scale.
- Versus notification inbox/DM/push/reminder/result delivery.
- Versus Scout mutation, Sponsor payout/cooldown/claim, premium shop, exact pricing, MMR, promotion/relegation, global cross-season ranking, and verified original formulas.
- Pixel-level asset parity and authoritative endpoint/auth/server protocol.

---

## 9. Final decisions dan unresolved questions

### Decisions yang dapat diambil sekarang

1. **Terminologi:** gunakan “Versus Multiplayer mandiri / Coach-like Online League”, bukan “Coach Mode dengan PvP”.
2. **Boundary:** Player, Coach, Versus tidak berbagi mutable career state, wallet, roster, league, contract, atau market.
3. **Scheduling:** perlakukan Versus sebagai scheduled/asynchronous/server-synchronized sampai ada bukti real-time.
4. **Ownership:** targetkan satu stable Versus club per user; jangan sediakan club-transfer command.
5. **Evidence:** semua formula/economy/matchmaking/reward diberi label `RECOVERY_INFERRED` dan versioned.
6. **UX honesty:** fitur yang belum ada ditampilkan unavailable/preview-only, bukan disimulasikan dengan angka yang tampak authoritative.

### Pertanyaan yang masih memerlukan keputusan/product evidence

- Apakah custom country/crest/name harus benar-benar menjadi first-time setup, atau produk memilih system-managed identity seperti checkout sekarang?
- Apakah “tidak dapat pindah klub” berarti immutable selamanya, atau hanya tidak dapat pindah selama satu season? Jika ada reset/migration, apa receipt dan historical identity-nya?
- Apa definisi “free market”: auction Deal saja, transfer market terbuka, atau juga Scout/player-status improvement? Ruleset dan currency harus dipisahkan.
- Apakah notification hanya Discord DM/channel atau perlu inbox persisted di dalam Game Home?
- Apakah promosi/relegasi, global ranking lintas season, dan real-time battle memang requirement produk atau sekadar interpretasi visual?
- Sumber authoritative apa yang akan dipakai untuk memvalidasi formula, endpoint, auth, anti-cheat, dan server authority?

> **Putusan akhir:** checkout sudah memiliki fondasi kuat untuk tiga aggregate dan Versus scheduled multiplayer, tetapi belum layak disebut parity final. Prioritas harus bergerak dari “menambah formula” ke **integritas boundary, club immobility, canonical settlement, notification delivery, dan state-visible UX**. Dengan itu, arsitektur Versus dapat dikoreksi menjadi Coach Multiplayer mandiri tanpa mengklaim bahwa setiap detail APK asli telah ditemukan.

---

## Lampiran A — Sumber utama yang disintesis

- `docs/video_analysis/player/01_UTpBYprcDgM.md` sampai `20_DzJRgqe0Jnk.md`
- `docs/PLAYER_MODE_VIDEO_RESEARCH.md`
- `docs/COACH_MODE_VIDEO_RESEARCH.md`
- `docs/COACH_MULTIPLAYER_RECOVERY_FINDINGS.md`
- `docs/VERSUS_ONLY_VIDEO_RESEARCH_2026-08-22.md`
- `docs/VERSUS_MODE_RECOVERY_RESEARCH.md`
- `docs/VERSUS_UX_EVIDENCE_MAP_2026-08-22.md`
- `docs/VERSUS_TRUTH_MATRIX.md`
- `docs/MULTI_MODE_GAMEPLAY_SPEC.md`
- `docs/EVENT_SYSTEM_CORRECTION_2026-08-26.md`
- `docs/TECHNICAL_GAMEPLAY_STATE_MATRIX_2026-08-26.md`
- `docs/walkthrough_analysis.txt`
- `src/domain/types.ts`
- `src/domain/gameplay-engine.ts`
- `src/domain/coach-career-engine.ts`
- `src/domain/contract-engine.ts`
- `src/domain/club-engine.ts`
- `src/domain/official-club-engine.ts`
- `src/domain/versus-engine.ts`
- `src/domain/versus-economy.ts`
- `src/domain/versus-matchmaking.ts`
- `src/discord/commands.ts`, `components.ts`, `handlers.ts`
- `src/jobs/maintenance.ts`, `background-worker.ts`
- `src/storage/schema.sql`
- `test/weekly-ui-integration.test.ts`
- `test/mode-isolation.test.ts`
- `test/versus-mode.test.ts`
- `test/versus-economy.test.ts`
- `test/versus-matchmaking.test.ts`
- `test/coach-career.test.ts`
- `test/components.test.ts`
- `test/registry-and-schema.test.ts`
