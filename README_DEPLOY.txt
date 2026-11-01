MONOPOLI WIJAYA MABAR - PATCH v3.0.0
=====================================

PERBAIKAN DARI SCREENSHOT
- Browser membuka halaman pada domain wijaya-mabar-server.enzonic.dev,
  tetapi kolom WebSocket masih menunjuk ke domain lama
  wijaya-mabar-server-0a541514.enzonic.dev.
- HTML sekarang otomatis mengisi WebSocket dengan domain halaman yang sedang
  dibuka (wss:// untuk HTTPS). Ini mencegah tombol TAMBAH BOT mengirim perintah
  ke backend lama.
- Server v3 mendukung pesan WebSocket add_bot dan mengirim room_update serta
  konfirmasi bot_added.
- Maksimal 3 bot dan 4 kursi total. Bot langsung ready.
- Endpoint /health menunjukkan protocolVersion dan fitur add_bot.

ISI PAKET
- server.js
- Monopoli_Wijaya_Mabar_Online.html
- package.json

CARA DEPLOY
1. Upload ketiga file ke direktori aplikasi yang sama.
2. Pastikan nama file HTML tepat: Monopoli_Wijaya_Mabar_Online.html
3. Jalankan npm install.
4. Jalankan npm start (atau perintah start yang disediakan hosting).
5. Restart/redeploy service.
6. Buka https://wijaya-mabar-server.enzonic.dev/health
   Pastikan protocolVersion bernilai 3.0.0 dan features mencakup add_bot.
7. Buka halaman utama, buat Room baru, lalu tekan TAMBAH BOT.
8. Pastikan daftar Room menampilkan Bot 1 • Siap.

PENTING
- Jangan hanya mengganti HTML. server.js juga wajib diperbarui karena perintah
  add_bot diproses di server.
- Setelah deploy, gunakan domain halaman yang sama untuk WebSocket.
- Room lama tidak dipakai lagi; buat Room baru.
- Versi ini masih memakai browser pengendali untuk menjalankan mesin aturan
  permainan. Ini bukan server-authoritative penuh.
