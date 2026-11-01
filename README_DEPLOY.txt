MONOPOLI WIJAYA - REAL-TIME MULTIPLAYER v2.1

ISI PAKET
- server.js: WebSocket server, Room, state snapshot, turn validation, controller failover
- Monopoli_Wijaya_Mabar_Online.html: client game with controller handover
- package.json: dependency dan perintah start

CARA DEPLOY
1. Upload ketiga file ke folder/root aplikasi yang sama.
2. Pastikan Node.js tersedia.
3. Jalankan: npm install
4. Jalankan: npm start
5. Deploy/restart service di hosting.
6. Tes endpoint /health; status harus online.
7. Buka URL game, buat Room baru, lalu tes dengan dua perangkat/browser.

PERUBAHAN v2.1
- Jika pengendali/Host terputus saat permainan berlangsung, server memilih pemain manusia lain yang masih terhubung sebagai pengendali baru.
- Kursi pemain yang terputus diambil alih bot.
- Server menyimpan snapshot papan terbaru di memori dan mengirimkannya ke pengendali baru.
- Timer giliran tetap memakai deadline yang sama ketika pengendali berpindah; timer tidak di-reset oleh setiap pembaruan papan.
- Server tetap memvalidasi siapa yang boleh mengirim aksi dan memastikan aksi hanya diteruskan saat giliran pemain tersebut.
- Kode Room tetap 4 angka dan maksimal 4 kursi.

CATATAN ARSITEKTUR PENTING
Versi ini adalah tahap failover pengendali dengan snapshot kanonis di server. Logika penuh permainan (perhitungan dadu, gerakan, transaksi, kartu, musibah, dan AI) masih dijalankan di browser pengendali yang aktif, lalu snapshot dikirim ke server untuk dibagikan. Jadi ini BELUM sepenuhnya server-authoritative. Jika semua browser pemain terputus bersamaan atau proses server restart, Room aktif belum dapat dipulihkan. Tahap selanjutnya adalah memindahkan mesin aturan permainan dan AI ke Node.js, serta menambahkan penyimpanan persisten dan mekanisme reconnect bertoken.

PENTING
- Gunakan Room baru setelah deploy.
- Semua pemain harus menggunakan URL server WebSocket yang sama.
- Host/pengendali harus online selama ada aksi manusia; jika ia terputus, pemain lain yang online otomatis mengambil alih.
