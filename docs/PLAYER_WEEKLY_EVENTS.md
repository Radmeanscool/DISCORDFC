# Player Weekly Events

## Alur button-first

```text
Player Weekly Hub
→ Next Week
→ Recovery, trainer, sponsor payout
→ Random Weekly Event (opsional)
→ Weekly Event Decision
→ Match Ready
→ Play Match
→ Assign EXP
→ Weekly Hub
```

Event yang muncul bersifat **blocking** terhadap pertandingan. Pemain harus memilih satu respons melalui String Select Menu sebelum stage berubah dari `EVENT_PENDING` menjadi `MATCH_READY`.

## Event types

| Type | Contoh | Dampak |
|---|---|---|
| `INTERVIEW` | Wawancara setelah latihan | Charm, EXP, money, atau energy |
| `SPONSOR_OFFER` | Tawaran brand lokal/regional/global | Kontrak sponsor dengan pembayaran mingguan |
| `MEDICAL_INCIDENT` | Knock dalam latihan | Recovery aman atau risiko cedera dari event |
| `LIFESTYLE` | Undangan acara klub | Charm/money atau recovery |

## Balance default

- Peluang event Player per weekly update: `32%`
- Porsi event medis jika Player sehat: `18%` dari roll event
- Durasi kontrak sponsor: `6 minggu`
- Sponsor lokal: `90 money/minggu`
- Sponsor regional: `160 money/minggu`
- Sponsor global: `280 money/minggu`

Parameter berada di `src/config/game-balance.ts`.

## State persistence

Field baru di `PlayerProfile`:

- `weeklyEvent`: event aktif/terakhir beserta pilihan dan pilihan yang dipilih.
- `sponsor`: kontrak sponsor aktif.
- `sponsorHistory`: kontrak yang pernah selesai atau digantikan.
- `weekStage: EVENT_PENDING`: stage yang mengunci match sampai keputusan dibuat.

JSON store dan projection profile yang sudah ada menyimpan field ini bersama profile tanpa migrasi tabel tambahan.

## Domain API

- `preparePlayerWeek(profile, now, rng)` memproses recovery, sponsor payout, dan membuat event deterministik.
- `resolvePlayerWeeklyEvent(profile, choiceId, now)` menerapkan efek pilihan dan mengaktifkan `MATCH_READY`.
- `playPreparedWeek(...)` tetap menjadi simulator pertandingan yang sama; formula match tidak diubah.

Random source dapat diganti `SeededRandom` dalam test sehingga event dan hasilnya reproducible.
