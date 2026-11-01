const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 8080);
const GAME_FILE = path.join(__dirname, 'Monopoli_Wijaya_Mabar_Online.html');
const rooms = new Map();
const clients = new Map();
const id = () => crypto.randomUUID();

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
      multiplayerMode: 'shared-state-controller-failover',
      protocolVersion: '3.0.0',
      features: ['add_bot', 'room_update', 'game_state', 'player_action', 'controller_failover'],
      maxSeats: 4,
      maxBots: 3,
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
const TURN_SECONDS = 60;

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function publicPerson(p) {
  return { id:p.id, name:p.name, ready:!!p.ready, host:!!p.host,
    connected:!!p.connected, isBot:!!p.isBot, seatIndex:p.seatIndex };
}
function snapshot(r) {
  return { code:r.code, started:r.started, players:r.players.slice().sort((a,b)=>a.seatIndex-b.seatIndex).map(publicPerson),
    spectators:r.spectators.map(s=>({id:s.id,name:s.name,kind:'Penonton'})), botCount:r.players.filter(p=>p.isBot).length,
    maxSeats:4, current:r.gameState?.current ?? 0 };
}
function broadcast(r,msg) {
  for (const p of r.players) send(p.ws,msg);
  for (const s of r.spectators) send(s.ws,msg);
}
function roomUpdate(r) { broadcast(r,{type:'room_update',room:snapshot(r)}); }
function playerById(r,id) { return r.players.find(p=>p.id===id); }
function currentSeat(r) { return Number(r.gameState?.current ?? 0); }
function controllerPlayer(r) { return playerById(r,r.controllerId); }
function hostPlayer(r) { return playerById(r,r.hostId); }
function electController(r) {
  const old = r.controllerId;
  const next = r.players.find(x => !x.isBot && x.connected && x.ws && x.ws.readyState === WebSocket.OPEN);
  r.controllerId = next ? next.id : null;
  if (r.started && r.controllerId && r.controllerId !== old) {
    send(next.ws, { type:'controller_changed', playerId:next.id, seatIndex:next.seatIndex, state:r.gameState, revision:r.revision, message:'Pengendali sebelumnya terputus. Kamu sekarang mengendalikan permainan.' });
    broadcast(r, { type:'controller_status', playerId:next.id, playerName:next.name });
    armTurnTimer(r);
  } else if (r.started && !r.controllerId) {
    if (r.turnTimer) clearTimeout(r.turnTimer); r.turnTimer = null;
    broadcast(r, { type:'controller_status', playerId:null, message:'Menunggu pemain manusia tersambung untuk melanjutkan permainan.' });
  }
  return next;
}
function armTurnTimer(r) {
  if (r.turnTimer) clearTimeout(r.turnTimer);
  r.turnTimer = null;
  if (!r.started || !r.controllerId || !r.gameState) return;
  const seat = currentSeat(r);
  if (r.turnSeat !== seat || !r.turnDeadline) {
    r.turnSeat = seat;
    r.turnDeadline = Date.now() + TURN_SECONDS * 1000;
  }
  const remaining = Math.max(0, r.turnDeadline - Date.now());
  r.turnTimer = setTimeout(() => {
    if (!r.started || currentSeat(r) !== seat) return;
    const controller = controllerPlayer(r);
    if (controller?.ws) send(controller.ws, { type:'host_turn_timeout', seatIndex:seat, revision:r.revision });
  }, remaining);
}
function error(ws,message) { send(ws,{type:'error',message}); }
function removeSocket(ws) {
  const c=clients.get(ws); if(!c)return; clients.delete(ws);
  const r=rooms.get(c.code); if(!r)return;
  if(c.role==='spectator') { r.spectators=r.spectators.filter(x=>x.id!==c.id); }
  else {
    const p=playerById(r,c.id);
    if(p){
      p.ws=null; p.connected=false;
      if(r.started && !p.isBot) {
        p.isBot=true; p.ready=true; p.host=false; p.name='Bot '+(p.seatIndex+1);
        if(r.gameState && Array.isArray(r.gameState.players) && r.gameState.players[p.seatIndex]) {
          const gp=r.gameState.players[p.seatIndex]; gp.name=p.name; gp.isBot=true; gp.isRemoteHuman=false;
          r.revision++;
        }
      }
    }
  }
  if(r.started && r.controllerId===c.id) electController(r);
  else if(r.started && r.gameState) {
    const controller=controllerPlayer(r);
    if(controller?.ws) send(controller.ws,{type:'controller_state',state:r.gameState,revision:r.revision,message:'Pemain terputus dan kursinya diambil alih bot.'});
    broadcast(r,{type:'game_state',state:r.gameState,revision:r.revision,controllerId:r.controllerId});
  }
  roomUpdate(r);
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m=JSON.parse(raw.toString()); } catch { return error(ws,'Format pesan tidak valid.'); }
    const c=clients.get(ws);

    if(m.type==='create_room') {
      if(c)return;
      let roomCode; do { roomCode=String(crypto.randomInt(0,10000)).padStart(4,'0'); } while(rooms.has(roomCode));
      const host={id:id(),name:String(m.name||'Host').slice(0,18),ready:true,host:true,connected:true,ws,isBot:false,seatIndex:0};
      const r={code:roomCode,hostId:host.id,controllerId:host.id,players:[host],spectators:[],started:false,gameState:null,revision:0,turnTimer:null,turnSeat:null,turnDeadline:null};
      rooms.set(roomCode,r); clients.set(ws,{code:roomCode,id:host.id,role:'player'});
      send(ws,{type:'room',role:'host',playerId:host.id,seatIndex:0,room:snapshot(r)}); return;
    }

    if(m.type==='join_room') {
      if(c)return;
      const roomCode=String(m.code||'').replace(/\D/g,'').slice(0,4); const r=rooms.get(roomCode);
      if(!r)return error(ws,'Room tidak ditemukan atau sudah ditutup.');
      if(r.started)return error(ws,'Permainan sudah dimulai.');
      if(r.players.filter(x=>!x.isBot).length>=4)return error(ws,'Slot pemain manusia sudah penuh.');
      const used=new Set(r.players.map(x=>x.seatIndex)); let seatIndex=0; while(used.has(seatIndex)&&seatIndex<4)seatIndex++;
      if(seatIndex>=4)return error(ws,'Room sudah penuh.');
      const person={id:id(),name:String(m.name||'Pemain').slice(0,18),ready:false,host:false,connected:true,ws,isBot:false,seatIndex};
      r.players.push(person); clients.set(ws,{code:roomCode,id:person.id,role:'player'});
      send(ws,{type:'room',role:'player',playerId:person.id,seatIndex,room:snapshot(r)}); roomUpdate(r); return;
    }

    if(m.type==='spectate_room') {
      if(c)return; const roomCode=String(m.code||'').replace(/\D/g,'').slice(0,4); const r=rooms.get(roomCode);
      if(!r)return error(ws,'Room tidak ditemukan.');
      const sp={id:id(),name:String(m.name||'Penonton').slice(0,18),ws}; r.spectators.push(sp);
      clients.set(ws,{code:roomCode,id:sp.id,role:'spectator'});
      send(ws,{type:'room',role:'spectator',playerId:sp.id,room:snapshot(r)});
      if(r.gameState)send(ws,{type:'game_state',state:r.gameState,revision:r.revision}); return;
    }

    if(!c)return error(ws,'Buat atau gabung Room terlebih dahulu.');
    const r=rooms.get(c.code); if(!r)return error(ws,'Room sudah tidak tersedia.');
    const p=playerById(r,c.id);

    if(m.type==='set_ready') {
      if(r.started||!p||p.isBot)return;
      p.ready=!!m.ready; roomUpdate(r); return;
    }
    if(m.type==='add_bot') {
      if(c.id!==r.hostId)return error(ws,'Hanya Host yang dapat menambahkan bot.');
      if(r.started)return error(ws,'Permainan sudah dimulai.');
      if(r.players.filter(x=>x.isBot).length>=3||r.players.length>=4)return error(ws,'Maksimal 3 bot dan 4 peserta.');
      const used=new Set(r.players.map(x=>x.seatIndex)); let seatIndex=0; while(used.has(seatIndex)&&seatIndex<4)seatIndex++;
      if(seatIndex>=4)return error(ws,'Room sudah penuh.');
      const n=r.players.filter(x=>x.isBot).length+1;
      r.players.push({id:'bot-'+id(),name:'Bot '+n,ready:true,host:false,connected:false,ws:null,isBot:true,seatIndex});
      roomUpdate(r);
      send(ws,{type:'bot_added',message:'Bot '+n+' berhasil ditambahkan dan langsung siap.',botCount:r.players.filter(x=>x.isBot).length});
      return;
    }
    if(m.type==='start_game') {
      if(c.id!==r.hostId)return error(ws,'Hanya Host yang dapat memulai.');
      if(r.started)return error(ws,'Permainan sudah dimulai.');
      const humans=r.players.filter(x=>!x.isBot&&x.ready);
      const botsBefore=r.players.filter(x=>x.isBot).length;
      if(!humans.length||(humans.length<2&&botsBefore<1))return error(ws,'Siapkan minimal 2 pemain manusia atau 1 pemain manusia dan 1 bot.');
      const unready=r.players.filter(x=>!x.isBot&&!x.ready);
      unready.forEach(x=>{if(x.ws){error(x.ws,'Host memulai permainan sebelum kamu siap; kamu dikeluarkan dari Room.');clients.delete(x.ws);}});
      r.players=r.players.filter(x=>x.isBot||x.ready);
      const used=new Set(r.players.map(x=>x.seatIndex));
      while(r.players.length<4) {
        let seatIndex=0; while(used.has(seatIndex)&&seatIndex<4)seatIndex++;
        if(seatIndex>=4)break; used.add(seatIndex);
        const n=r.players.filter(x=>x.isBot).length+1;
        r.players.push({id:'bot-'+id(),name:'Bot '+n,ready:true,host:false,connected:false,ws:null,isBot:true,seatIndex});
      }
      r.players.sort((a,b)=>a.seatIndex-b.seatIndex); r.started=true; r.revision=0; r.controllerId=r.hostId;
      const payload={type:'game_started',players:r.players.map(publicPerson),hostId:r.hostId,controllerId:r.controllerId,roomCode:r.code};
      broadcast(r,payload); roomUpdate(r); return;
    }

    if(m.type==='game_state') {
      if(c.id!==r.controllerId)return error(ws,'Hanya pengendali Room yang dapat menyinkronkan papan.');
      if(!r.started||!m.state||!Array.isArray(m.state.players)||m.state.players.length!==4)return;
      if(Number.isInteger(m.baseRevision) && m.baseRevision!==r.revision)return error(ws,'Pembaruan papan sudah kedaluwarsa. Sinkronkan ulang.');
      r.gameState=m.state; r.revision++;
      const seat=currentSeat(r); const cp=r.gameState.players[seat]||{};
      armTurnTimer(r);
      broadcast(r,{type:'game_state',state:r.gameState,revision:r.revision,controllerId:r.controllerId,turn:{seatIndex:seat,playerName:cp.name||'',isBot:!!cp.isBot,seconds:TURN_SECONDS}});
      return;
    }

    if(m.type==='player_action') {
      if(!r.started||c.role!=='player'||!p||p.isBot)return error(ws,'Aksi pemain tidak valid.');
      const seat=currentSeat(r);
      if(p.seatIndex!==seat)return error(ws,'Belum giliran kamu.');
      const allowed=new Set(['roll','buy','upgrade','end_turn','free_move']);
      if(!allowed.has(m.action))return error(ws,'Aksi permainan tidak dikenal.');
      const controller=controllerPlayer(r); if(!controller?.ws)return error(ws,'Pengendali permainan sedang terputus. Menunggu pemain lain mengambil alih.');
      if(Number.isInteger(m.revision) && m.revision!==r.revision)return error(ws,'Papan belum tersinkron. Coba lagi setelah pembaruan diterima.');
      send(controller.ws,{type:'host_action',action:m.action,playerId:p.id,seatIndex:p.seatIndex,selected:Number.isInteger(m.selected)?m.selected:null,revision:r.revision}); return;
    }
    if(m.type==='game_event') {
      if(!r.started)return; broadcast(r,{type:'game_event',playerId:c.id,event:m.event||{}}); return;
    }
    if (m.type === 'add_bot' || m.type === 'bot_add') {
      return error(ws,'Server belum mendukung fitur tambah bot. Deploy server.js versi 3.0.0 lalu restart service.');
    }
    error(ws,'Perintah tidak dikenal.');
  });
  ws.on('close',()=>removeSocket(ws)); ws.on('error',()=>removeSocket(ws));
});

server.listen(PORT,()=>console.log('Wijaya Mabar real-time server berjalan pada port '+PORT));
