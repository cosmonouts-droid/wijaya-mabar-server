const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 8080);
const TURN_SECONDS = 60, BOT_THINK_MS = 1800;
const rooms = new Map(), clients = new Map();
const code = () => 'WIJAYA-' + crypto.randomInt(1000, 10000);
const id = () => crypto.randomUUID();
const send = (ws,obj) => { if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
function publicPerson(p){return {id:p.id,name:p.name,ready:!!p.ready,host:!!p.host,connected:!!p.connected,isBot:!!p.isBot};}
function snapshot(r){return {code:r.code,started:r.started,humanTarget:r.humanTarget,botCount:r.players.filter(p=>p.isBot).length,players:r.players.map(publicPerson)};}
function broadcast(r,msg){for(const p of r.players)send(p.ws,msg);}
function roomUpdate(r){broadcast(r,{type:'room_update',room:snapshot(r)});}
function stopTimer(r){if(r.timer)clearTimeout(r.timer);if(r.botTimer)clearTimeout(r.botTimer);r.timer=null;r.botTimer=null;}
function currentPlayer(r){return r.players.length?r.players[r.turnIndex%r.players.length]:null;}
function beginTurn(r){
 stopTimer(r);if(!r.started||!r.players.length)return;
 const p=currentPlayer(r);r.turnDeadline=Date.now()+TURN_SECONDS*1000;
 broadcast(r,{type:'turn_timer',playerId:p.id,playerName:p.name,isBot:!!p.isBot,seconds:TURN_SECONDS});
 if(p.isBot){
  broadcast(r,{type:'bot_turn',playerId:p.id,playerName:p.name,message:p.name+' sedang berpikir...'});
  r.botTimer=setTimeout(()=>{if(!r.started||currentPlayer(r)?.id!==p.id)return;broadcast(r,{type:'bot_turn_complete',playerId:p.id,message:p.name+' menyelesaikan giliran otomatis.'});r.turnIndex=(r.turnIndex+1)%r.players.length;beginTurn(r);},BOT_THINK_MS);
  return;
 }
 r.timer=setTimeout(()=>{if(!r.started||currentPlayer(r)?.id!==p.id)return;broadcast(r,{type:'turn_timeout',playerId:p.id,playerName:p.name});r.turnIndex=(r.turnIndex+1)%r.players.length;beginTurn(r);},TURN_SECONDS*1000);
}
function removeSocket(ws){const c=clients.get(ws);if(!c)return;clients.delete(ws);const r=rooms.get(c.code);if(!r)return;const p=r.players.find(x=>x.id===c.id);if(p){p.ws=null;p.connected=false;}roomUpdate(r);if(!r.players.length){stopTimer(r);rooms.delete(r.code);}}
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({service:'Monopoli Wijaya Mabar',status:'online',maxSeats:4,humanChoices:[2,3],turnSeconds:TURN_SECONDS,note:'Room process-memory; production persistence still required'}));});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw.toString());}catch{return send(ws,{type:'error',message:'Format pesan tidak valid.'});}
  const c=clients.get(ws);
  if(m.type==='create_room'){
   if(c)return;const humanTarget=Number(m.humanTarget)===2?2:3;let roomCode;do{roomCode=code();}while(rooms.has(roomCode));
   const player={id:id(),name:String(m.name||'Host').slice(0,18),ready:true,host:true,connected:true,ws,isBot:false};
   const r={code:roomCode,hostId:player.id,humanTarget,players:[player],started:false,turnIndex:0,timer:null,botTimer:null,turnDeadline:null};rooms.set(roomCode,r);clients.set(ws,{code:roomCode,id:player.id,role:'player'});send(ws,{type:'room',role:'host',room:snapshot(r)});return;
  }
  if(m.type==='join_room'){
   if(c)return;const roomCode=String(m.code||'').trim().toUpperCase(),r=rooms.get(roomCode);if(!r)return send(ws,{type:'error',message:'Room tidak ditemukan atau sudah ditutup.'});
   const humanCount=r.players.filter(p=>!p.isBot).length;
   if(r.started)return send(ws,{type:'error',message:'Permainan sudah dimulai. Mode penonton tidak tersedia.'});
   if(humanCount>=r.humanTarget)return send(ws,{type:'error',message:'Slot pemain manusia sudah penuh sesuai pilihan Host.'});
   const person={id:id(),name:String(m.name||'Pemain').slice(0,18),connected:true,ws,isBot:false};
   person.ready=false;person.host=false;r.players.push(person);
   clients.set(ws,{code:roomCode,id:person.id,role:'player'});send(ws,{type:'room',role:'player',room:snapshot(r)});roomUpdate(r);return;
  }
  if(!c)return send(ws,{type:'error',message:'Buat atau gabung Room terlebih dahulu.'});
  const r=rooms.get(c.code);if(!r)return send(ws,{type:'error',message:'Room sudah tidak tersedia.'});
  const p=r.players.find(x=>x.id===c.id);
  if(m.type==='set_ready'){if(c.role!=='player'||r.started||!p)return;p.ready=!!m.ready;roomUpdate(r);return;}
  if(m.type==='start_game'){
   if(c.id!==r.hostId)return send(ws,{type:'error',message:'Hanya Host yang dapat memulai.'});
   const humans=r.players.filter(x=>!x.isBot);
   if(r.started||humans.length!==r.humanTarget||!humans.every(x=>x.ready))return send(ws,{type:'error',message:'Jumlah pemain manusia harus '+r.humanTarget+' dan semua harus siap.'});
   const botCount=4-humans.length;for(let i=0;i<botCount;i++)r.players.push({id:'bot-'+id(),name:'Komputer '+(i+1),ready:true,host:false,connected:false,ws:null,isBot:true});
   r.started=true;r.turnIndex=0;broadcast(r,{type:'info',message:'Permainan dimulai! 4 kursi: '+humans.length+' manusia + '+botCount+' komputer. Batas giliran 60 detik.'});roomUpdate(r);beginTurn(r);return;
  }
  if(m.type==='end_turn'){if(c.role!=='player'||!r.started||currentPlayer(r)?.id!==c.id)return send(ws,{type:'error',message:'Bukan giliran pemain ini.'});r.turnIndex=(r.turnIndex+1)%r.players.length;beginTurn(r);return;}
  if(m.type==='game_event'){if(c.role!=='player'||!r.started||currentPlayer(r)?.id!==c.id)return send(ws,{type:'error',message:'Aksi permainan hanya boleh dari pemain yang sedang mendapat giliran.'});broadcast(r,{type:'game_event',playerId:c.id,event:m.event||{}});return;}
  send(ws,{type:'error',message:'Perintah tidak dikenal.'});
 });
 ws.on('close',()=>removeSocket(ws));ws.on('error',()=>removeSocket(ws));
});
server.listen(PORT,()=>console.log(`Wijaya Mabar server listening on ${PORT}`));
