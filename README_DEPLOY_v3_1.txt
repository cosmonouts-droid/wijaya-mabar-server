MONOPOLI WIJAYA - FIX ALL CLIENTS ENTER GAME v3.1.0
====================================================

MASALAH YANG DIPERBAIKI
- Sebelumnya event game_started hanya menutup lobby dan membuat papan pada
  browser Host. Browser pemain lain hanya menampilkan pesan menunggu, sehingga
  tetap tertahan di lobby.
- Sekarang setiap perangkat menerima game_started, menutup modal lobby, dan
  menginisialisasi papan permainan dengan nomor kursi miliknya.
- Variabel lastRevision ditambahkan. Sebelumnya variabel ini dipakai untuk
  publishState/requestAction tetapi belum dideklarasikan, sehingga sinkronisasi
  awal dan aksi pemain lain dapat gagal.
- Penentuan pemain remote/local memakai kursi pemain pada perangkat tersebut.

CARA DEPLOY
1. Ganti server.js dan Monopoli_Wijaya_Mabar_Online.html di hosting.
2. Jalankan npm install jika dependensi belum terpasang.
3. Restart/redeploy service.
4. Buka /health dan pastikan protocolVersion = 3.1.0.
5. Tutup Room lama, buat Room baru.
6. Masuk dari dua perangkat/browser berbeda, siapkan pemain, lalu Host mulai.
7. Semua perangkat seharusnya masuk ke papan permainan dan melihat status giliran.

CATATAN
- Server tetap harus online.
- Versi ini masih memakai browser Host/pengendali untuk menghitung aturan papan.
  Ini bukan mesin permainan server-authoritative penuh.
