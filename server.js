const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const TURN_SECONDS = 60;
const BOT_THINK_MS = 1800;

const GAME_FILE = path.join(__dirname, 'Monopoli_Wijaya_Mabar_Online.html');

const rooms = new Map();
const clients = new Map();

const code = () => String(crypto.randomInt(1000, 10000));
const id = () => crypto.randomUUID();

const send = (ws, obj) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
};

function publicPerson(p) {
  return {
    id: p.id,
    name: p.name,
    ready: !!p.ready,
    host: !!p.host,
    connected: !!p.connected,
    isBot: !!p.isBot
  };
}

function snapshot(r) {
  return {
    code: r.code,
    started: r.started,
    humanTarget: r.humanTarget,
    botCount: r.players.filter(p => p.isBot).length,
    readyCount: r.players.filter(p => !p.isBot && p.ready && p.connected).length,
    players: r.players.map(publicPerson)
  };
}

function broadcast(r, msg) {
  for (const p of r.players) send(p.ws, msg);
}

function roomUpdate(r) {
  broadcast(r, {
    type: 'room_update',
    room: snapshot(r)
  });
}

function stopTimer(r) {
  if (r.timer) clearTimeout(r.timer);
  if (r.botTimer) clearTimeout(r.botTimer);
  r.timer = null;
  r.botTimer = null;
}

function currentPlayer(r) {
  return r.players.length
    ? r.players[r.turnIndex % r.players.length]
    : null;
}

function beginTurn(r) {
  stopTimer(r);

  if (!r.started || !r.players.length) return;

  const p = currentPlayer(r);
  r.turnDeadline = Date.now() + TURN_SECONDS * 1000;

  broadcast(r, {
    type: 'turn_timer',
    playerId: p.id,
    playerName: p.name,
    isBot: !!p.isBot,
    seconds: TURN_SECONDS
  });

  if (p.isBot) {
    broadcast(r, {
      type: 'bot_turn',
      playerId: p.id,
      playerName: p.name,
      message: p.name + ' sedang berpikir...'
    });

    r.botTimer = setTimeout(() => {
      if (!r.started || currentPlayer(r)?.id !== p.id) return;

      broadcast(r, {
        type: 'bot_turn_complete',
        playerId: p.id,
        message: p.name + ' menyelesaikan giliran otomatis.'
      });

      r.turnIndex = (r.turnIndex + 1) % r.players.length;
      beginTurn(r);
    }, BOT_THINK_MS);

    return;
  }

  r.timer = setTimeout(() => {
    if (!r.started || currentPlayer(r)?.id !== p.id) return;

    broadcast(r, {
      type: 'turn_timeout',
      playerId: p.id,
      playerName: p.name
    });

    r.turnIndex = (r.turnIndex + 1) % r.players.length;
    beginTurn(r);
  }, TURN_SECONDS * 1000);
}

function removeSocket(ws) {
  const c = clients.get(ws);
  if (!c) return;

  clients.delete(ws);

  const r = rooms.get(c.code);
  if (!r) return;

  const p = r.players.find(x => x.id === c.id);

  if (p) {
    p.ws = null;
    p.connected = false;
  }

  roomUpdate(r);

  if (!r.players.length) {
    stopTimer(r);
    rooms.delete(r.code);
  }
}

/* WEBSITE GAME */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  if (url.pathname === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8'
    });

    return res.end(JSON.stringify({
      service: 'Monopoli Wijaya Mabar',
      status: 'online',
      maxSeats: 4,
      turnSeconds: TURN_SECONDS
    }));
  }

  if (
    url.pathname === '/' ||
    url.pathname === '/Monopoli_Wijaya_Mabar_Online.html'
  ) {
    fs.readFile(GAME_FILE, (err, data) => {
      if (err) {
        res.writeHead(500, {
          'content-type': 'text/plain; charset=utf-8'
        });

        return res.end(
          'File game tidak ditemukan. Pastikan file HTML sudah ada di GitHub.'
        );
      }

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8'
  });

  res.end('Halaman tidak ditemukan.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m;

    try {
      m = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: 'error',
        message: 'Format pesan tidak valid.'
      });
    }

    const c = clients.get(ws);

    if (m.type === 'create_room') {
      if (c) return;

      const humanTarget = Number(m.humanTarget) === 2 ? 2 : 3;

      let roomCode;

      do {
        roomCode = code();
      } while (rooms.has(roomCode));

      const player = {
        id: id(),
        name: String(m.name || 'Host').slice(0, 18),
        ready: true,
        host: true,
        connected: true,
        ws,
        isBot: false
      };

      const r = {
        code: roomCode,
        hostId: player.id,
        humanTarget,
        players: [player],
        started: false,
        turnIndex: 0,
        timer: null,
        botTimer: null,
        turnDeadline: null
      };

      rooms.set(roomCode, r);

      clients.set(ws, {
        code: roomCode,
        id: player.id,
        role: 'player'
      });

      send(ws, {
        type: 'room',
        role: 'host',
        playerId: player.id,
        room: snapshot(r)
      });

      return;
    }

    if (m.type === 'join_room') {
      if (c) return;

      const roomCode = String(m.code || '').replace(/\D/g, '').slice(0, 4);
      const r = rooms.get(roomCode);

      if (!r) {
        return send(ws, {
          type: 'error',
          message: 'Room tidak ditemukan atau sudah ditutup.'
        });
      }

      const humanCount = r.players.filter(p => !p.isBot).length;

      if (r.started) {
        return send(ws, {
          type: 'error',
          message: 'Permainan sudah dimulai.'
        });
      }

      if (humanCount >= r.humanTarget) {
        return send(ws, {
          type: 'error',
          message: 'Slot pemain manusia sudah penuh.'
        });
      }

      const person = {
        id: id(),
        name: String(m.name || 'Pemain').slice(0, 18),
        ready: false,
        host: false,
        connected: true,
        ws,
        isBot: false
      };

      r.players.push(person);

      clients.set(ws, {
        code: roomCode,
        id: person.id,
        role: 'player'
      });

      send(ws, {
        type: 'room',
        role: 'player',
        playerId: person.id,
        room: snapshot(r)
      });

      roomUpdate(r);
      return;
    }

    if (!c) {
      return send(ws, {
        type: 'error',
        message: 'Buat atau gabung Room terlebih dahulu.'
      });
    }

    const r = rooms.get(c.code);

    if (!r) {
      return send(ws, {
        type: 'error',
        message: 'Room sudah tidak tersedia.'
      });
    }

    const p = r.players.find(x => x.id === c.id);

    if (m.type === 'set_ready') {
      if (r.started || !p) return;

      p.ready = !!m.ready;
      roomUpdate(r);
      return;
    }

    if (m.type === 'start_game') {
  if (c.id !== r.hostId) {
    return send(ws, {
      type: 'error',
      message: 'Hanya Host yang dapat memulai.'
    });
  }

  const allHumans = r.players.filter(x => !x.isBot && x.connected);
  const humans = allHumans.filter(x => x.ready);
  const host = allHumans.find(x => x.id === r.hostId);

  if (r.started || !host || !host.ready || humans.length < 2 || humans.length > 3) {
    return send(ws, {
      type: 'error',
      message: 'Permainan dapat dimulai jika Host dan minimal 1 pemain lain siap (total 2–3 pemain siap).'
    });
  }

  // Pemain yang belum siap dikeluarkan dari sesi; kursinya digantikan bot.
  for (const person of allHumans) {
    if (person.ready) continue;
    send(person.ws, {
      type: 'info',
      message: 'Permainan dimulai tanpa kamu karena belum menekan SIAP. Silakan gabung kembali di Room baru.'
    });
    if (person.ws) {
      clients.delete(person.ws);
      try { person.ws.close(); } catch {}
    }
  }
  r.players = humans.slice();

  // Isi kursi kosong sampai total tepat 4 pemain.
  const botCount = 4 - humans.length;

  for (let i = 0; i < botCount; i++) {
    r.players.push({
      id: 'bot-' + id(),
      name: 'Bot ' + (i + 1),
      ready: true,
      host: false,
      connected: false,
      ws: null,
      isBot: true
    });
  }

  // Mulai permainan
  r.started = true;
  r.turnIndex = 0;

  broadcast(r, {
    type: 'info',
    message:
      'PERMAINAN DIMULAI! ' +
      humans.length + ' pemain manusia dan ' +
      botCount + ' komputer. Total 4 pemain.'
  });

  roomUpdate(r);
  beginTurn(r);
  return;
}
    if (m.type === 'end_turn') {
      if (
        !r.started ||
        currentPlayer(r)?.id !== c.id
      ) {
        return send(ws, {
          type: 'error',
          message: 'Bukan giliran pemain ini.'
        });
      }

      r.turnIndex = (r.turnIndex + 1) % r.players.length;
      beginTurn(r);
      return;
    }

    if (m.type === 'game_event') {
      if (
        !r.started ||
        currentPlayer(r)?.id !== c.id
      ) {
        return send(ws, {
          type: 'error',
          message: 'Aksi hanya boleh dilakukan saat giliran sendiri.'
        });
      }

      broadcast(r, {
        type: 'game_event',
        playerId: c.id,
        event: m.event || {}
      });

      return;
    }

    send(ws, {
      type: 'error',
      message: 'Perintah tidak dikenal.'
    });
  });

  ws.on('close', () => removeSocket(ws));
  ws.on('error', () => removeSocket(ws));
});

server.listen(PORT, () => {
  console.log('Wijaya Mabar server berjalan pada port ' + PORT);
});
