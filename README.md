# Monopoli Indonesia Wijaya — Mabar Online

- Tepat 4 kursi permainan.
- Host memilih 2 manusia + 2 komputer atau 3 manusia + 1 komputer.
- Mode penonton dihapus; hanya pemain yang dapat bergabung.
- Host terputus tidak mengakhiri Room selama server tetap hidup.
- Timer giliran manusia 60 detik.

## Menjalankan
1. Node.js 18+.
2. `npm install`
3. `npm start` (port 8080).
4. Deploy game dan server pada domain yang sama dengan WebSocket + TLS. Game akan mengisi alamat `wss://domain-anda` otomatis. Jika memakai domain server terpisah, tambahkan `?server=wss://alamat-server-anda` pada URL game. Saat dibuka sebagai file lokal, nilai otomatis `ws://localhost:8080` hanya untuk pengujian di perangkat yang menjalankan server.

## Batas saat ini
Komputer server saat ini hanya mengisi kursi dan melewati giliran secara otomatis. Belum menjalankan strategi AI di papan. `game_event` masih relay, bukan mesin aturan authoritative; dadu, transaksi, sewa, kartu, pinjaman, musibah, kebangkrutan, dan saldo belum tersinkronisasi penuh. Room masih disimpan di memori dan hilang saat server restart. Perlu integrasi mesin aturan dan database sebelum Mabar penuh siap dipakai.
