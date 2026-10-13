# Release Readiness Test Plan

**Tanggal:** 13 Oktober 2026
**Status automated suite:** 87 lulus, 0 gagal

## Automated tests yang sudah tersedia

File utama:

- `test/weekly-ui-integration.test.ts`
- `test/release-readiness.test.ts`
- `test/components.test.ts`
- `test/gameplay-expansion.test.ts`
- `test/versus-mode.test.ts`
- `test/versus-economy.test.ts`
- `test/storage-concurrency.test.ts`
- `test/mode-isolation.test.ts`

Cakupan tambahan release-readiness:

- weekly state machine menolak action out-of-order;
- duplicate weekly event resolution ditolak;
- invalid event choice tidak memutasi state;
- Assign EXP melebihi pool ditolak;
- Assign EXP kosong ditolak;
- match telemetry berada dalam batas aman;
- career mutation match terjadi satu kali;
- transfer dengan saldo kurang ditolak;
- transfer ke klub yang sama ditolak;
- transfer dengan saldo tepat sama dengan fee berhasil;
- contract lama dihapus saat transfer;
- transfer fee masuk ke ledger;
- tombol UI owner-bound;
- tombol Match terkunci pada stage yang salah;
- tombol League Table tersedia pada pending EXP.

## Cara menjalankan

```bash
pnpm build
pnpm test
```

Target minimum:

```text
Build berhasil
87 test lulus
0 test gagal
0 unhandled rejection
```

## Checklist manual wajib sebelum public release

Automated unit/integration test tidak menggantikan Discord test server. Lakukan smoke test manual berikut dengan minimal dua akun Discord test.

### Authorization

- [ ] User A membuka `/play` dan User B mencoba menekan tombol dari pesan User A.
- [ ] User B tidak dapat membaca atau memutasi Player User A.
- [ ] User tanpa Manage Guild mencoba `/admin`.
- [ ] User Manage Guild tetapi tidak terdaftar di `ADMIN_USER_IDS` mencoba `/admin`.

### Discord interaction

- [ ] `/play` pertama kali.
- [ ] Player creation melalui Select Menu.
- [ ] Coach creation melalui tombol.
- [ ] Versus Home melalui tombol.
- [ ] Klik tombol disabled.
- [ ] Klik tombol dari pesan lama.
- [ ] Select Menu invalid/expired.
- [ ] Error tidak menampilkan stack trace.

### Player weekly flow

- [ ] READY → Next Week.
- [ ] MATCH_READY → Play Match.
- [ ] EVENT_PENDING → pilih event.
- [ ] EXP_PENDING → Assign EXP.
- [ ] Pending EXP → League Table.
- [ ] Season Break → Next Week.
- [ ] Injury → Basic/Expert treatment.
- [ ] Sponsor payout hanya masuk satu kali.

### Player economy

- [ ] Transfer dengan saldo cukup.
- [ ] Transfer dengan saldo tidak cukup.
- [ ] Transfer ke klub yang sama.
- [ ] Confirm Transfer ditekan dua kali.
- [ ] Market refresh, buy, dan sell.
- [ ] Contract sign/renew.
- [ ] Daily reward double claim.

### Coach

- [ ] Play Round.
- [ ] Pending Decision memblokir round.
- [ ] Coach EXP.
- [ ] Formation/Tactic.
- [ ] Job offer generate/list/accept/decline.
- [ ] Coach Champions.
- [ ] Coach state tidak mengubah Player state.

### Versus

- [ ] System assignment.
- [ ] Registration.
- [ ] Lineup valid.
- [ ] Invalid XI/duplicate player/captain tidak valid.
- [ ] Stale roster version.
- [ ] Deadline lock.
- [ ] Results, standings, schedule.
- [ ] Market bid/outbid/expiry.
- [ ] Rewards hanya dikreditkan sekali.

### Persistence dan operasi

- [ ] Restart bot setelah membuat Player.
- [ ] Restart saat event pending.
- [ ] Restart saat pending EXP.
- [ ] Restart saat sponsor aktif.
- [ ] Restart saat Versus lineup sudah submit.
- [ ] PostgreSQL backup dan restore.
- [ ] JSON import ke PostgreSQL.
- [ ] Log tidak mencetak token atau database password.

## Acceptance criteria

Rilis **closed beta** dapat dilakukan jika:

- automated suite lulus seluruhnya;
- authorization manual lulus;
- Player weekly flow lulus pada Discord nyata;
- restart recovery lulus;
- admin access dan rate limit lulus;
- backup database tersedia;
- rollback procedure sudah dicoba.

Public open release sebaiknya ditunda sampai load test, multi-instance concurrency, monitoring, alerting, dan disaster recovery telah diverifikasi.
