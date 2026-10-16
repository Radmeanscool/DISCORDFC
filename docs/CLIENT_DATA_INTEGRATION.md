# Integrasi Client Data 2.8.0

## Sumber

Data berasal dari `FootballRisingStar_2.8.0_Client_Data_Audit.zip`, sebuah audit statis terhadap client build Football Rising Star 2.8.0. Audit menyatakan 207 payload TextAsset dengan total 11,904,528 byte. Repository hanya memasukkan hasil ekstraksi terstruktur; binary client mentah tidak disalin ke repository.

## Hasil parser

| Dataset | Hasil | Provenance |
| --- | ---: | --- |
| `cfg_club_202603` | 332 dari 332 record berhasil diparse | `RECOVERY_VERIFIED_BINARY_SCHEMA` |
| `cfg_player_202603` header | 9,395 record tercantum pada header | `RECOVERY_VERIFIED_CLIENT` |
| Player fixed-field extractor | 5,133 record valid dengan name CN/EN, club, position, price, age, dan value | `RECOVERY_VERIFIED_FIXED_FIELDS` |
| Club IDs yang dirujuk roster | 332 | Cocok dengan seluruh club payload |
| Position mapping | FW 1–5, MF 6–9, DF 10–12, GK 13 | Verified dari `PositionId` dump |

Club parser mengikuti urutan schema `ClubConfig`: ID, name multilingual, icon, league, country, type, captain, coach, salary base, coach salary base, prestige, grade, formations, dan tactics ID. Parser berhenti tepat pada akhir payload dan menghasilkan 332 record; tidak ada sisa byte yang tidak terjelaskan.

Player extractor menggunakan field yang dapat divalidasi dari `PlayerConfig`: name multilingual, Num, club, position, Price, InitAge, NormalValue, AuctionValue, dan GrowType. Ability dictionary belum dimasukkan sebagai stat resmi karena bagian variable-length binary membutuhkan parser dictionary lanjutan; overall pada runtime tetap diberi label inferred dari fixed numeric value, bukan dianggap formula original.

## Integrasi runtime

`src/config/recovery-data.ts` memuat `data/recovery/club_202603.json` dan `data/recovery/player_202603_fixed_fields.json`. `createInitialProfile` memilih klub starter grade rendah secara deterministik dari league 1011; klub besar seperti Arsenal tetap tersedia melalui transfer Club Office. `ensureClubState` memakai official club ID, grade, prestige, salary budget, dan roster names terverifikasi, lalu menggunakan fallback generic hanya jika record tidak tersedia. Docker image membawa folder `data/recovery`.

## Batasan provenance

Nama klub, metadata klub, nama pemain, posisi, umur awal, dan fixed numeric fields yang diparse langsung diberi label verified dari client. Nilai ability/stat yang dibentuk oleh adapter, formula overall, simulasi gol, event activation, live status, leaderboard, inventory, dan backend synchronization masih `RECOVERY_INFERRED` atau `BACKEND_REQUIRED`.

Firebase App/Analytics dependency terdeteksi dalam audit, tetapi audit tidak mengonfirmasi Remote Config aktif atau endpoint backend produksi dan tidak melakukan panggilan jaringan. Oleh sebab itu, bot tidak menghubungkan atau meniru endpoint backend berdasarkan tebakan.
