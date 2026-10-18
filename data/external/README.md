# Data eksternal: roster pemain asli

Roster hasil decode APK (`data/recovery/player_202603_fixed_fields.json`) tidak lengkap: klub divisi satu rata-rata hanya punya 7–14 pemain, harga selalu 37, dan usia 12–60. Folder ini menyimpan **overlay** roster asli yang menggantikan roster klub yang berhasil dicocokkan, tanpa mengubah file APK.

| | |
|---|---|
| Sumber | [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (data Transfermarkt, dikurasi David Cariboo) |
| Lisensi | CC0 1.0 (public domain) — atribusi tidak wajib, tapi tetap dicantumkan |
| Status | **Sudah diimpor** (snapshot 2026-07-06): 120 klub · 3.587 pemain. Laporan per klub di `player-import-report.json`. |
| Kesegaran | Pembaruan otomatis dataset berhenti; data terakhir per **6 Juli 2026** (skuad 2025/26, musim yang sama dengan club list APK 202603). Skuad 2026/27 tidak tercakup. |
| Cakupan | Liga divisi satu (termasuk EN, ES, IT, DE, FR, PT, RU, NL, BE, AT, CH, SCO, GR, SE, PL, CZ, SRB, RO), piala Eropa, ~50.000 pemain |

## 1. Unduh dataset

Unduh dua tabel ke `data/external/transfermarkt/` (folder ini di-ignore git):

```bash
mkdir -p data/external/transfermarkt
curl -fL -o data/external/transfermarkt/players.csv.gz https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz
curl -fL -o data/external/transfermarkt/clubs.csv.gz https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/clubs.csv.gz
```

Alternatif: unduh `players.csv` dan `clubs.csv` dari [Kaggle davidcariboo/player-scores](https://www.kaggle.com/datasets/davidcariboo/player-scores) ke folder yang sama (importer menerima `.csv` maupun `.csv.gz`).

## 2. Jalankan importer

```bash
pnpm data:import-players --snapshot 2026-07-06
```

| Opsi | Default | Arti |
|---|---|---|
| `--source` | `data/external/transfermarkt` | Folder `players.csv(.gz)` dan `clubs.csv(.gz)` |
| `--snapshot` | `unspecified` | Label tanggal data (ditampilkan di `/admin action:stats`) |
| `--as-of` | `2026-07-01` | Tanggal acuan usia dari tanggal lahir |
| `--min-season` | `2025` | Musim Transfermarkt tertua yang dianggap skuad terkini |
| `--min-squad` | `16` | Klub dengan pemain valid lebih sedikit tetap memakai roster APK |
| `--max-squad` | `30` | Batas pemain per klub |
| `--overrides` | `data/external/club-map.json` | Koreksi pencocokan manual |
| `--dry-run` | — | Hanya laporan, overlay tidak ditulis |

Hasil: `player-overlay.json` (dimuat bot saat start) dan `player-import-report.json` (status tiap klub). Periksa laporan, lalu commit kedua file. Restart bot agar overlay terbaca.

## 3. Apa yang diganti

- Klub dicocokkan **di liga yang sama** (EPL ↔ `GB1`, LaLiga ↔ `ES1`, Serie A ↔ `IT1`, Bundesliga ↔ `L1`, Ligue 1 ↔ `FR1`, Portugal ↔ `PO1`, Rusia ↔ `RU1`, Belanda ↔ `NL1`, Belgia ↔ `BE1`, klub pool 9001 ke liga negaranya) dengan normalisasi nama (diakritik, bentuk hukum seperti FC/SSC/S.A.D., nama kota Jerman seperti *Mailand*, *Neapel*).
- Hanya klub yang skuadnya terkini (`last_season` ≥ `--min-season`) dan punya ≥ `--min-squad` pemain yang diganti. Divisi 2–3, CSKA Sofia, Lokomotiv Plovdiv, enam klub fiktif, dan klub APK yang di dunia nyata tidak berada di divisi satu 2025/26 (mis. Kaiserslautern, Schalke 04, Bastia, Montpellier) tetap memakai roster APK.
- Per pemain: nama, posisi (`sub_position` → position code), usia dari tanggal lahir, kewarganegaraan, nilai pasar. Dataset tidak punya nomor punggung; `num` adalah urutan skuad.
- Urutan skuad dibuat seimbang: 11 pertama membentuk 4-4-2, 15 pertama memenuhi kedalaman minimum roster, 18 pertama satu skuad matchday — paling bernilai lebih dulu.
- Nilai pasar dikoreksi usia sebelum dipakai: prospek ≤ 23 tahun diturunkan (harga mereka memuat potensi), veteran ≥ 29 dinaikkan (harga turun cepat walau kemampuannya masih tinggi). Tanpa koreksi ini Salah (34, €22m) kalah dari pemain 17 tahun €30m.
- Overall pemain impor = kekuatan klub ± 6 menurut rasio nilai terkoreksi terhadap median 18 pemain matchday (`RECOVERY_INFERRED`). Band ini sama dengan roster APK, jadi kekuatan antar-klub tidak berubah; yang berubah adalah siapa bintangnya. Hasil import 2026-07-06: rata-rata offset XI +1,0 (APK +1,4).

## 4. Koreksi manual

Jika laporan menunjukkan klub yang salah cocok atau tidak tercocokkan, buat `data/external/club-map.json`:

```json
{
  "101106": 31,
  "110011": null
}
```

Kunci = ID klub APK, nilai = `club_id` Transfermarkt, atau `null` untuk memaksa roster APK.

## 5. Kembali ke roster APK

Hapus `player-overlay.json` atau set `PLAYER_OVERLAY_FILE=off`, lalu restart bot.

Roster klub milik user yang sudah tersimpan di save tidak diubah. Lawan (dibangun ulang tiap pertandingan), roster klub yang baru dibuat, dan transfer list Coach memakai overlay begitu bot di-restart.

## Catatan

Lisensi CC0 berlaku untuk kompilasi data ini. Nama dan citra pemain nyata dapat tunduk pada hak personalitas atau lisensi pemain (mis. lewat FIFPRO) bila bot dipakai secara komersial.
