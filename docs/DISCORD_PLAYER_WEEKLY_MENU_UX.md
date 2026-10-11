# Desain UI/UX Discord — Player Weekly Menu

## Tujuan

Menu ini menerjemahkan loop mingguan Football Rising Star ke Discord tanpa membuat pengguna mengetik command pada setiap langkah.

Alur utama:

```text
Player Weekly Hub
  → Training / Personal / Club / Recovery
  → Next Week
  → Weekly Update
  → Play Match
  → Match Result
  → Assign EXP
  → Player Weekly Hub
```

Slash command tetap tersedia sebagai fallback, tetapi tombol menjadi jalur utama.

## Entry point Slash Commands

| Command | Fungsi |
|---|---|
| `/play` | Membuka Game Home dan memilih Player Mode |
| `/player career start` | Fallback untuk membuat profil Player |
| `/player career profile` | Fallback membuka Player Weekly Hub |
| `/player career next-week` | Fallback memproses Weekly Update |
| `/player career match` | Fallback memainkan match yang sudah siap |
| `/player training assign-exp` | Fallback mengalokasikan EXP pertandingan |

## Player Weekly Hub

Embed utama diberi judul:

```text
{Name} · Player Weekly Hub
```

Isi utama:

- Week saat ini
- Stage mingguan
- HP dan Energy
- Money dan rating
- Club dan fixture berikutnya
- Ringkasan progression
- Petunjuk aksi berikutnya

Contoh petunjuk berdasarkan stage:

| Stage | Petunjuk pengguna | Aksi utama |
|---|---|---|
| `READY` | Siap menyiapkan minggu berikutnya | `Next Week` aktif |
| `MATCH_READY` | Weekly update selesai, pertandingan siap | `Play Match` aktif |
| `EXP_PENDING` | EXP pertandingan harus dialokasikan | Select menu Assign EXP |
| `SEASON_BREAK` | Season break dan award sedang tersedia | `Next Week` untuk melanjutkan |

## Susunan Buttons

### Row 1 — Player navigation

- `Player Status`
- `Training`
- `Personal`
- `Club`

### Row 2 — Weekly progression

- `Next Week`
- `Play Match`
- `Detailed Skills` atau `Assign EXP`
- `Recovery`

Tombol progression yang tidak valid pada stage saat ini dibuat disabled. Contohnya, `Play Match` disabled ketika stage masih `READY`.

### Row 3 — Long-term progression

- `Daily Reward`
- `Contract`
- `Honors`
- `Champions`

### Row 4 — Mode navigation

- `Game Home`
- `Coach Mode`
- `Versus Mode`

## Weekly Update screen

Setelah `Next Week`, bot menampilkan embed:

- `Weekly Update · Week {n}`
- narrative recovery/training/culture
- Stage: `MATCH_READY`
- HP dan Energy
- instruksi `Tekan Play Match`

Buttons yang aktif mengarahkan langsung ke `Play Match`. `Next Week` dinonaktifkan untuk mencegah pengguna melewati match.

## Match Result screen

Setelah `Play Match`, bot menampilkan:

- outcome: `VICTORY`, `DRAW`, atau `DEFEAT`
- skor pemain dan lawan
- player rating
- pending match EXP
- narrative pertandingan
- condition setelah match

Jika ada pending EXP, bot mengganti tombol progression dengan select menu:

```text
Pilih skill untuk menerima seluruh pending EXP
```

Select menu berisi 12 detailed skills. Setelah alokasi berhasil, pengguna kembali ke Weekly Hub dengan stage `READY` atau `SEASON_BREAK`.

## Prinsip UX

1. **Satu layar, satu keputusan utama.** Weekly Update tidak sekaligus menjalankan match.
2. **Stage selalu terlihat.** Pengguna tahu apakah harus maju minggu, memainkan match, atau mengalokasikan EXP.
3. **Aksi yang tidak valid dinonaktifkan.** Ini mengurangi error dibanding membiarkan semua tombol aktif.
4. **Semua panel punya jalan kembali.** Player Weekly Hub menjadi titik kembali untuk panel Player.
5. **Tombol owner-bound.** Custom ID mengandung Discord user ID sehingga interaksi pengguna lain ditolak.
6. **Command tetap tersedia sebagai fallback.** Pengguna yang lebih nyaman dengan slash commands tetap dapat bermain.
7. **Tidak ada formula baru pada lapisan UI.** Menu hanya mempresentasikan state domain yang sudah ada.

## Implementasi saat ini

- Komponen: `src/discord/components.ts`
- Handler: `src/discord/handlers.ts`
- Regression test: `test/components.test.ts`
- Factory utama: `playerWeeklyControls(userId, stage)`
- Embed utama: `playerWeeklyEmbed(profile)`

## Status

Desain dan wiring awal selesai. Build TypeScript dan test suite telah diverifikasi. Tahap berikutnya dapat menambahkan modal onboarding, event choice panel, dan match statistics yang lebih kaya tanpa mengubah urutan weekly state.
