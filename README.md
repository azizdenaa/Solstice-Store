# Solstice Store — Full Design + Discord Backend

## Yang sudah ada
- Desain dark/silver/purple mengikuti referensi.
- Logo Solstice Store dari logo yang diberikan.
- Home, Store, About, FAQ.
- 16 paket Robux.
- Promo 500 Robux Rp65.000 (normal Rp80.000).
- Promo 1.000 Robux Rp130.000 (normal Rp160.000).
- Checkout username.
- Pembayaran transfer SeaBank:
  901004935916
  a.n. Muhammad Abdul Aziz
- Salin nomor rekening.
- Konfirmasi pembayaran.
- Backend `/api/order` untuk notifikasi Discord.

## Deploy Vercel
1. Upload/import folder ini ke Vercel.
2. Settings -> Environment Variables.
3. Tambahkan `DISCORD_WEBHOOK_URL` dengan webhook Discord yang kamu miliki.
4. Redeploy.

Jangan menaruh webhook Discord di frontend.
Webhook yang pernah dibagikan di chat sebaiknya di-rotate sebelum produksi.

## Pembayaran
Saat ini pembayaran adalah transfer bank manual. Tombol konfirmasi tidak membuktikan uang sudah diterima; order dikirim ke Discord sebagai MENUNGGU VERIFIKASI dan harus dicek di rekening sebelum fulfillment.

Jangan meminta password Roblox, cookie, PIN, atau OTP.
