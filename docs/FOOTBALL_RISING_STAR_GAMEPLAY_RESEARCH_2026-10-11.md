# Riset Gameplay Football Rising Star untuk Rekonstruksi Discord Bot

**Tanggal riset:** 11 Oktober 2026  
**Tujuan:** memahami gameplay Football Rising Star asli sebelum melanjutkan implementasi versi Discord bot.  
**Status:** pemetaan fitur dan urutan pengalaman berdasarkan deskripsi resmi, version history publik, dan walkthrough video. Dokumen ini tidak mengklaim mengetahui formula server internal.

## Kesimpulan utama

Football Rising Star adalah **career simulation berbasis waktu**, bukan game sepak bola yang dimainkan secara real-time. Pemain membuat seorang pesepak bola muda, meningkatkan skill, menjalani pertandingan yang disimulasikan, mengelola kondisi fisik dan cedera, memperoleh EXP, lalu mengalokasikan EXP tersebut ke skill detail. Perjalanan berlangsung melalui kompetisi berulang, transfer, kontrak, penghargaan, dan pada akhirnya retirement/rebirth.

Game aslinya memiliki dua career mode utama: **Player Mode** dan **Coach Mode**. Version history publik juga menunjukkan adanya **Versus/Battle Mode** sebagai mode kompetitif terpisah. Deskripsi resmi menekankan Player/Coach, sedangkan screenshot dan version history memperlihatkan Battle/Versus sebagai fitur tambahan yang berkembang belakangan.[1] [2] [3]

Karakteristik paling pentingnya adalah ritme singkat dan berbasis keputusan ringan: pengguna tidak mengendalikan pemain dengan joystick selama pertandingan. Pengguna menyiapkan pemain, menekan aksi progression atau `Next Week`, melihat simulasi, mengambil keputusan pada event tertentu, kemudian mengelola hasilnya.

## Player Mode: gameplay yang terlihat

### 1. Membuat pemain dan memulai karier

Player dimulai sebagai pemain muda berusia **15 tahun** yang bergabung dengan klub profesional. Deskripsi resmi menyebut karier berjalan melalui sekitar **20 tahun kompetisi**, training, dan transfer.[1] [2]

Walkthrough memperlihatkan onboarding yang lebih kaya daripada sekadar memilih posisi. Layar pembuatan karakter menampilkan pilihan seperti nama/nickname, birthplace, avatar, dan posisi. Beberapa rekaman memakai posisi striker atau ST; posisi lain juga tersedia dalam struktur permainan.[4] [5]

Setelah onboarding, pemain menerima klub awal dan kontrak. Walkthrough memperlihatkan konfirmasi seperti `Signed successfully`, informasi klub, serta tampilan awal karier.[4] [5]

**Makna untuk Discord:** onboarding sebaiknya terasa seperti proses menandatangani kontrak, bukan langsung membuat objek database. Discord dapat menggunakan select menu/modal untuk nama, posisi, asal, dan konfirmasi klub, lalu mengirim contract receipt dalam embed.

### 2. Player hub

Hub pemain menampilkan status karier dan menjadi pusat navigasi. Elemen yang terlihat atau disebut dalam materi publik meliputi:

- rating atau overall pemain;
- umur dan perkembangan karier;
- value atau nilai pemain;
- money;
- diamonds/premium currency;
- kondisi fisik dan energy/stamina;
- klub, kontrak, dan posisi;
- akses ke Ability, Training, Personal, Club, Match, dan Achievement.

Walkthrough menunjukkan tab atau area navigasi yang memisahkan status pemain, ability, training, personal, dan club.[4] [5]

**Makna untuk Discord:** Player Home sebaiknya menjadi embed utama dengan tombol tab. Tombol tidak perlu meniru tampilan mobile, tetapi harus mempertahankan urutan mental yang sama: status → peningkatan → aktivitas personal → klub → pertandingan.

### 3. Ability dan detailed skills

Permainan membedakan statistik makro dengan skill detail. Walkthrough dan analisis layar memperlihatkan skill detail berikut:

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

Selain skill detail, terdapat statistik makro seperti physical, speed, defence, technique, dan stamina pada beberapa tampilan atau versi.[4] [5]

Skill detail tidak hanya menjadi daftar dekoratif. Skill tersebut menerima EXP, memiliki level, menjadi syarat untuk membuka trick tertentu, dan berhubungan dengan performa pemain dalam simulasi.

### 4. Training biasa

Regular Training digunakan untuk meningkatkan kemampuan tertentu. Rekaman memperlihatkan kategori seperti shooting/short, dribbling, speed, stamina, passing, defence, dan physical.[4]

Training mengonsumsi resource seperti energy dan menghasilkan EXP atau peningkatan skill. Angka konsumsi, durasi, dan koefisien peningkatan dapat berbeda antarversi dan tidak terlihat lengkap dari sumber publik. Karena itu, yang aman untuk direkonstruksi adalah **aksi, resource gate, receipt, dan hasil peningkatan**, bukan angka asli yang tidak terverifikasi.

### 5. Trick atau special skill training

Ada sistem trick/special skill. Contoh yang terlihat adalah **Bicycle Kick** dan **Jumping Kick**. Trick dibuka setelah skill tertentu mencapai threshold. Salah satu walkthrough juga memperlihatkan opsi percepatan dengan diamond.[4]

Yang dapat dipastikan dari walkthrough:

1. trick mempunyai requirement;
2. trick memiliki status locked/unlocked;
3. trick merupakan lapisan progression berbeda dari training skill biasa;
4. premium currency dapat muncul pada jalur percepatan tertentu.

Yang belum dapat dipastikan adalah biaya universal, durasi, dan efek numerik setiap trick. Discord bot sebaiknya menampilkan requirement dan statusnya terlebih dahulu, lalu menjadikan akselerasi sebagai fitur terpisah yang ruleset-nya configurable.

### 6. Personal trainer

Personal training memperkenalkan trainer bertingkat, termasuk Junior, Senior, dan tier tertinggi yang dalam materi berbeda disebut Master atau Expert. Trainer memberikan efek pasif atau peningkatan terhadap training/recovery.[4]

Keberadaan sistem trainer cukup kuat dari rekaman, tetapi nama tier, harga, durasi, dan rasio efek tidak selalu konsisten di sumber publik. Untuk versi Discord, trainer dapat dibuat sebagai pilihan pasif mingguan dengan receipt yang menjelaskan bahwa angka masih reconstructed.

### 7. Culture Study

Culture Study adalah aktivitas personal yang tidak lazim untuk game sepak bola. Rekaman memperlihatkan pilihan seperti **Science, Arts, dan History**. Aktivitas tersebut berhubungan dengan charm dan peningkatan skill/atribut tertentu.[4]

Fitur ini penting karena membuat Player Mode tidak hanya berisi training dan match. Di Discord, Culture Study cocok sebagai select menu dengan waktu selesai dan hasil yang dikirim sebagai event receipt.

### 8. Alur mingguan

Loop Player yang paling jelas dari walkthrough adalah:

1. melihat status atau event yang sedang aktif;
2. melakukan training, personal activity, atau pengelolaan kondisi;
3. memilih `Next Week` atau aksi untuk maju;
4. menerima hasil perkembangan minggu tersebut;
5. membuka atau menjalani pertandingan;
6. melihat simulasi dan hasil pertandingan;
7. menerima pool `Assign Exp`;
8. mengalokasikan EXP ke skill detail;
9. melihat klasemen atau progres klub;
10. mengulang siklus.

Analisis walkthrough secara eksplisit merangkum urutan `Main Status Screen → Training/Personal Management → Next Week → Match Simulation → Exp Allocation → League Standings Update`.[4]

Ini adalah **inti gameplay** yang harus diprioritaskan untuk bot Discord. Versi bot tidak boleh memadatkan semua langkah menjadi satu command jika ingin terasa seperti game aslinya.

### 9. Match simulation

Pertandingan disimulasikan. Pemain tidak mengendalikan aksi per detik. Layar hasil memperlihatkan skor, line-up, rating pemain, dan statistik pertandingan. Materi video menunjukkan metrik seperti possession, shots, shots on target, corners, serta player rating.[5]

Dalam Player Mode, hasil pertandingan diikuti layar `Assign Exp`. EXP tidak otomatis seluruhnya masuk ke satu skill. Pengguna perlu memilih skill detail sebagai tujuan alokasi.[4] [5]

Pertandingan juga dapat mengubah:

- record menang/seri/kalah;
- goals dan statistik karier;
- energy/condition;
- risiko cedera;
- reward atau money;
- posisi klub pada klasemen.

Formula peluang gol, rating, cedera, dan reward tidak dipublikasikan. Formula tersebut harus tetap versioned dan configurable dalam bot.

### 10. Energy, stamina, dan injury

Energy atau stamina adalah gate penting. Training dan pertandingan menguranginya. Saat energy rendah, pemain harus beristirahat atau memakai mekanisme pemulihan.[4]

Cedera dapat muncul setelah pertandingan atau aktivitas. Walkthrough memperlihatkan opsi `Basic Treat` dan `Expert Surgery`; materi review publik juga berulang kali membahas energy dan injury sebagai resource yang membatasi seberapa sering pengguna dapat bermain.[2] [4] [6]

Untuk Discord, status cedera harus jelas dan dapat dibaca langsung:

- severity;
- sisa durasi;
- source cedera;
- apakah treatment telah digunakan;
- kondisi HP/energy;
- waktu pemulihan berikutnya.

Bot sebaiknya tidak meniru tekanan iklan atau memaksa pembayaran premium. Discord version dapat memakai cooldown atau pilihan gratis yang transparan agar gameplay tetap nyaman.

### 11. Event dan pilihan naratif

Di antara pertandingan, event naratif dapat muncul. Contoh dari walkthrough meliputi:

- menemukan uang dan memilih mengambil atau melapor;
- diskusi tentang formasi eksperimental pelatih;
- event liburan atau interaksi dengan pemain legendaris;
- pilihan yang memberi EXP, charm, atau efek skill tertentu.

Event membuat pengguna tidak hanya menekan `Next Week`. Event sebaiknya menjadi state yang menghentikan progres sampai pilihan dibuat, lalu mengirimkan receipt berisi pilihan dan dampaknya.

Namun, katalog event dan reward yang tepat belum dapat dianggap universal. Hasil yang terlihat dalam satu walkthrough tidak cukup untuk menetapkan semua payout sebagai aturan resmi.

### 12. Club, transfer, dan contract

Player dapat melihat klub, roster, klasemen, fixture, kontrak, dan posisi di dalam skuad. Rekaman memperlihatkan jalur personal seperti `Ask for pay`, transfer, dan negotiation. Offer dapat menampilkan klub tujuan, rank klub, persaingan posisi, dan weekly salary.[4]

Transfer dan contract bukan sekadar kosmetik. Keduanya menjadi cara pemain berpindah ke lingkungan yang lebih baik, memperoleh salary berbeda, dan melanjutkan karier.

Versi Discord sebaiknya memiliki:

- current contract receipt;
- salary dan masa berlaku;
- squad position atau ranking;
- daftar offer;
- tombol accept/decline;
- konfirmasi transfer;
- history kontrak.

Harga transfer, peluang offer, dan formula negosiasi tidak boleh dipastikan dari satu video.

### 13. League, awards, retirement, dan rebirth

Setiap siklus pertandingan memperbarui klasemen. Layar league table memperlihatkan played, wins, draws, losses, goal difference, dan points.[4] [5]

Materi walkthrough juga memperlihatkan Winter Break, kandidat World Footballer/World Player of the Year, award ceremony, trophy, dan Hall of Honor. Achievement system dan trophy collection merupakan bagian dari progression jangka panjang.[4] [5]

Version history publik mencatat penambahan Earth Cup, achievement system, player rebirth, medal mall, special skills training, dan ranking pada update 1.7.1. Update 2.0.0 kemudian menambahkan Versus Mode. Update 2.0.25 menyebut diamond reward saat memenangkan trophy di Player Mode.[3]

Retirement dan rebirth sebaiknya dipahami sebagai **siklus karier**, bukan reset biasa. Sebagian progression legacy seperti uang, honor, atau bonus dapat dibawa ke karier baru, tetapi detail persisnya tidak tersedia di sumber resmi yang terbuka.

## Coach Mode

Coach Mode memulai pengguna sebagai mantan pemain yang sudah memiliki banyak penghargaan dan memulai karier kepelatihan.[1] [2]

Fokus Coach bukan menaikkan skill pribadi sebagai pemain. Fokusnya adalah:

- memilih dan mengelola klub;
- mengatur roster;
- memilih formasi;
- memilih taktik;
- menjalani pertandingan sebagai simulasi;
- mengejar target board;
- memperoleh approval, trophies, dan achievements;
- menerima atau menolak tawaran klub.

Walkthrough memperlihatkan roster, formasi seperti 4-4-2, rating pemain, stamina, morale, fixture, match result, dan klasemen.[5]

Coach Mode harus tetap dipisahkan dari Player Mode. Player mengembangkan satu individu, sedangkan Coach mengelola keseluruhan klub. Keduanya berbagi konteks sepak bola, tetapi tidak boleh berbagi EXP atau progression secara otomatis.

## Versus/Battle Mode

Versus adalah mode kompetitif asynchronous yang muncul pada sejarah versi publik. Version 2.0.0 menambahkan Versus Mode dengan premis mengambil alih klub yang menurun dan bersaing dengan pemain lain.[3]

Walkthrough menunjukkan beberapa permukaan utama:

- countdown menuju pertandingan berikutnya;
- hasil pertandingan terakhir;
- online league standings;
- match preview yang membandingkan kekuatan, attack, defence, dan pemain inti;
- roster, formasi, stamina, morale;
- market dan Deal auction;
- Scout;
- Sponsor dengan tier Junior, Senior, dan Top;
- rewards berdasarkan posisi liga;
- ranking dan global ranking.

Version history juga mencatat group code, advanced scout, player-status improvement, gold coin exchange, dan ranking optimization pada versi-versi tertentu.[3] Namun version history hanya membuktikan keberadaan fitur, bukan biaya, cooldown, matchmaking coefficient, payout, atau efek status.

Untuk Discord, Versus harus memakai aggregate state terpisah dari Player dan Coach. Sistem assignment/matchmaking juga sebaiknya tidak dipresentasikan sebagai salinan formula asli karena protokol server publiknya tidak tersedia.

## Hal yang benar-benar perlu ditiru untuk Discord

Prioritas parity yang paling kuat bukan menyalin semua angka. Yang perlu ditiru adalah **ritme dan urutan keputusan**:

1. masuk ke Player Home;
2. membaca status kondisi, klub, contract, money, dan progression;
3. memilih Training, Personal, Club, atau Recovery;
4. menekan Next Week;
5. melihat hasil weekly update;
6. membuka simulasi match;
7. membaca skor, rating, dan statistik;
8. mengalokasikan EXP;
9. kembali ke klasemen dan fixture;
10. mengulang atau memproses event yang menunggu.

Discord-native implementation yang sesuai:

- slash command hanya sebagai entry point dan fallback;
- button untuk perpindahan antar panel;
- select menu untuk skill, posisi, tactic, treatment, dan pilihan event;
- modal untuk nickname atau input offer;
- embed untuk player hub, match result, contract receipt, injury, award, dan league table;
- owner-bound custom ID agar tombol tidak dapat dipakai oleh pengguna lain;
- state transition eksplisit agar satu klik tidak diam-diam melewati beberapa layar penting.

## Batas parity dan keputusan desain

Sumber publik cukup kuat untuk menyatakan bahwa game memiliki Player Mode, Coach Mode, simulated match, training, transfer, league, trophies, achievements, injury/energy, dan career progression. Walkthrough cukup kuat untuk menyatakan urutan visual Player: training/personal → next week → match → assign EXP → standings.

Sumber yang sama belum cukup untuk menentukan secara otoritatif:

- formula overall dan rating;
- peluang gol;
- biaya dan durasi training;
- peluang serta durasi injury;
- payout event;
- transfer valuation dan negotiation chance;
- matchmaking/MMR Versus;
- biaya Scout dan Sponsor;
- formula reward musim;
- aturan detail retirement/rebirth;
- apakah seluruh fitur konsisten di semua versi region.

Kesimpulannya, implementasi Discord harus mengejar **fidelity pada state, layar, urutan, dan keputusan pengguna**, sementara angka tersembunyi harus dibuat modular, diberi versi, dan tidak dipasarkan sebagai formula Football Rising Star asli.

## Referensi

[1]: https://play.google.com/store/apps/details?id=com.babuyo.footy.tc.android&hl=en_US "Football Rising Star — Official Google Play listing"
[2]: https://apps.apple.com/us/app/football-rising-star/id1585604439 "Football Rising Star — Official Apple App Store listing"
[3]: https://apptopia.com/ios/app/1585604439/about "Football Rising Star — public App Store metadata and version history"
[4]: https://www.youtube.com/watch?v=sS5T8E43LQI "Football Rising Star — Gameplay Walkthrough (Android) Part 1"
[5]: https://www.youtube.com/watch?v=YruDaaeriNM "Football Rising Star Gameplay — Become a legend mobile version"
[6]: https://apps.apple.com/us/app/1585604439?see-all=reviews&platform=iphone "Football Rising Star — public App Store reviews"
