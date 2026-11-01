MONOPOLI WIJAYA - REAL-TIME MULTIPLAYER UPDATE

ISI PAKET
- server.js                         WebSocket room + relay state server
- Monopoli_Wijaya_Mabar_Online.html  Board and multiplayer client
- package.json                      Node.js start script and ws dependency

CARA DEPLOY
1. Upload all three files into the same folder/repository.
2. Make sure the hosting platform uses Node.js.
3. Install dependencies with: npm install
4. Set the start command to: npm start
   (or: node server.js)
5. Redeploy/restart the service.
6. Open the game page and use this WebSocket URL:
   wss://wijaya-mabar-server-0a541514.enzonic.dev

CARA BERMAIN ONLINE
1. Host opens Mabar and selects BUAT ROOM.
2. Host can add 1-3 bots. Bot seats are ready immediately.
3. Friends enter the four-digit room code and press SIAP.
4. Host presses MULAI PERMAINAN. Any empty seats are filled by bots.
5. All players open the same game URL. The host tab must stay open and connected;
   it runs the current browser game engine and relays authoritative snapshots.
6. Human players can roll, buy properties, upgrade, use free move, and end turns
   when it is their turn. Bot turns run on the host and snapshots update everyone.

IMPORTANT LIMITATIONS OF THIS BUILD
- The host browser is the game-state authority. If the host closes the tab or loses
  connection, the room cannot advance until a host-reconnect feature is added.
- Core turn actions are synchronized: dice/position, cash, properties, upgrades,
  turn changes, and bot turns. Some advanced local-only UI interactions such as
  special-card choice panels, debt asset selection, pause controls, and local save/load
  are not yet fully remote-action synchronized.
- The room/state is held in server memory; restarting the Node service clears rooms.
