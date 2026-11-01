'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const GAME_FILE = path.join(__dirname, 'Monopoli_Wijaya_Mabar_Online.html');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const TURN_MS = 60_000;
const MAX_PLAYERS = 4;
const MAX_BOTS = 3;
const rooms = new Map();
const sockets = new Map();
const uid = () => crypto.randomUUID();
const clone = x => JSON.parse(JSON.stringify(x));

const TILES = [
 ['MULAI','go'],['Jakarta','street',10000,'Cokelat'],['Dana Umum','chest'],['Bogor','street',12000,'Cokelat'],['Pajak Pendapatan','tax',10000],
 ['Stasiun Utara','rail',40000],['Bandung','street',14000,'Biru Muda'],['Kesempatan','chance'],['Garut','street',16000,'Biru Muda'],['Tasikmalaya','street',18000,'Biru Muda'],
 ['Penjara','jail'],['Yogyakarta','street',20000,'Merah Muda'],['Perusahaan Listrik','utility',30000],['Solo','street',22000,'Merah Muda'],['Semarang','street',24000,'Merah Muda'],
 ['Stasiun Selatan','rail',40000],['Surabaya','street',26000,'Oranye'],['Dana Umum','chest'],['Malang','street',28000,'Oranye'],['Banyuwangi','street',30000,'Oranye'],
 ['Parkir Bebas','free'],['Bali','street',32000,'Merah'],['Kesempatan','chance'],['Lombok','street',34000,'Merah'],['Sumbawa','street',36000,'Merah'],
 ['Stasiun Timur','rail',50000],['Medan','street',38000,'Kuning'],['Padang','street',40000,'Kuning'],['Perusahaan Air','utility',40000],['Palembang','street',42000,'Kuning'],
 ['Masuk Penjara','gotojail'],['Makassar','street',45000,'Hijau'],['Manado','street',48000,'Hijau'],['Dadu Istimewa','specialdie'],['Balikpapan','street',50000,'Hijau'],
 ['Stasiun Barat','rail',60000],['Dadu Istimewa','specialdie'],['Raja Ampat','street',80000,'Biru Tua'],['Pajak Mewah','tax',20000],['Jayapura','street',100000,'Biru Tua']
].map(([name,type,price,group])=>({name,type,price:price||0,group:group||null}));

const UPGRADE_RATES = [0.25,0.40,0.55,0.70,0.85,1.00];
function freshPlayer(meta) {
  return { id:meta.id, name:meta.name, networkId:meta.id, isBot:!!meta.isBot,
    isRemoteHuman:!meta.isBot, seatIndex:meta.seatIndex, cash:500000, pos:0, owned:[],
    jail:0, jailAttempts:0, bankDebt:0, bankrupt:false, freeMove:false,
    specialCards:0, specialCardUsesLeft:3, connected:!!meta.connected };
}
function initialState(players) {
  return { players:players.map(p=>freshPlayer(p)), current:0, rolled:false, gameOver:false,
    landedIndex:null, selected:null, upgradeUsedThisTurn:false, specialUsedThisTurn:false,
    availableSpecialCards:0, disasterCounts:{storm:0,earthquake:0},
    disasterUnlocked:{storm:false,earthquake:false}, gamePaused:false, aiDifficulty:'medium',
    tiles:TILES.map(()=>({stars:0})), diceText:'🎲 Lempar dadu', logEntries:['Permainan dimulai.'],
    pendingSpecialPayment:null, pendingDebtPayment:null, special3Mode:'', special5Mode:'', availableSpecialCards:3, specialUsedThisTurn:false, disasterResolving:false };
}
function ownerOf(g, tile) { return g.players.findIndex(p=>p.owned.includes(tile)); }
function maxStars(tile) { return tile.type==='utility'?3:(tile.type==='street'?6:0); }
function upgradeCost(g, i) { return Math.round(TILES[i].price * (UPGRADE_RATES[g.tiles[i]?.stars||0] ?? 1)); }
function rentFor(g, i, diceTotal=7) {
  const t=TILES[i], owner=ownerOf(g,i); if(owner<0)return 0;
  const p=g.players[owner], stars=g.tiles[i]?.stars||0;
  if(t.type==='street') {
    let amount=t.price*(0.5+stars*0.5);
    const group=TILES.map((x,j)=>({x,j})).filter(x=>x.x.type==='street'&&x.x.group===t.group);
    const owned=group.filter(x=>p.owned.includes(x.j)).length;
    if(owned>=2)amount*=2;
    if(group.length&&owned===group.length)amount*=1.5;
    return Math.round(amount);
  }
  if(t.type==='rail') {
    const count=p.owned.filter(j=>TILES[j].type==='rail').length;
    return Math.round(t.price*([0,2,4,6,6][Math.min(count,4)]||2));
  }
  if(t.type==='utility')return Math.round(t.price*(0.5+stars*0.5));
  return 0;
}
function addLog(g, text) {
  g.logEntries.unshift(String(text));
  g.logEntries=g.logEntries.slice(0,100);
}
function saleValue(g, i) {
  const t=TILES[i], stars=Math.min(g.tiles[i]?.stars||0,6);
  if(!t.price)return 0;
  let total=t.price;
  for(let s=0;s<stars;s++)total+=Math.round(t.price*UPGRADE_RATES[s]);
  return total;
}
function declareBankruptcy(g, seat) {
  const p=g.players[seat];if(!p||p.bankrupt)return;
  p.bankrupt=true;
  g.availableSpecialCards=Math.min(3,(g.availableSpecialCards||0)+(p.specialCards||0));
  p.specialCards=0;p.specialCardUsesLeft=3;p.jail=0;p.freeMove=false;
  for(const i of p.owned)g.tiles[i].stars=0;
  p.owned=[];
  const survivors=g.players.filter(x=>!x.bankrupt);
  if(survivors.length===3||survivors.length===2) {
    const ranked=survivors.slice().sort((a,b)=>b.cash-a.cash);
    ranked.forEach((x,i)=>{const bonus=survivors.length===3?(i===0?500000:1000000):(i===0?1000000:2000000);x.cash+=bonus;});
    addLog(g,`🏦 Bonus bank dibagikan kepada ${survivors.length} pemain tersisa.`);
  }
  addLog(g,`💥 ${p.name} BANGKRUT karena utang mencapai Rp5.000.000. Properti dan kartu dikembalikan ke bank.`);
}
function pay(g, from, to, amount) {
  amount=Math.max(0,Math.round(amount));
  const p=g.players[from];if(!p||p.bankrupt)return false;
  if(p.cash<amount) {
    // The local game asks humans to choose assets; in multiplayer the server
    // liquidates the lowest-value assets deterministically so no browser can stall a turn.
    while(p.cash<amount&&p.owned.length) {
      const chosen=p.owned.map(i=>({i,value:saleValue(g,i)})).sort((a,b)=>a.value-b.value||a.i-b.i)[0];
      if(!chosen)break;
      p.owned=p.owned.filter(i=>i!==chosen.i);g.tiles[chosen.i].stars=0;p.cash+=chosen.value;
      addLog(g,`🏦 ${p.name} menjual ${TILES[chosen.i].name} otomatis seharga Rp${chosen.value.toLocaleString('id-ID')} untuk membayar tagihan.`);
    }
  }
  if(p.cash<amount) {
    const needed=amount-p.cash,available=Math.max(0,2000000-(p.bankDebt||0));
    const loan=Math.min(needed,available);
    if(loan){p.cash+=loan;p.bankDebt=(p.bankDebt||0)+loan;addLog(g,`🏦 ${p.name} meminjam Rp${loan.toLocaleString('id-ID')} dari bank.`);}
  }
  if(p.cash<amount) {
    const shortage=amount-p.cash;
    p.cash=0;p.bankDebt=(p.bankDebt||0)+shortage;
    if(p.bankDebt>=5000000)declareBankruptcy(g,from);
    else addLog(g,`⚠️ ${p.name} belum mampu membayar. Utang bank Rp${p.bankDebt.toLocaleString('id-ID')} / Rp5.000.000.`);
    if(to!==null&&to!==undefined&&g.players[to]&&!g.players[to].bankrupt)g.players[to].cash+=amount;
    checkVictory(g);return false;
  }
  p.cash-=amount;
  if(to!==null&&to!==undefined&&g.players[to]&&!g.players[to].bankrupt)g.players[to].cash+=amount;
  addLog(g,`${p.name} membayar Rp${amount.toLocaleString('id-ID')}.`);
  checkVictory(g);return true;
}
function checkVictory(g) {
  const active=g.players.filter(p=>!p.bankrupt);
  if(active.some(p=>p.cash>=10_000_000)||active.length<=1) {
    g.gameOver=true;
    const winner=active.find(p=>p.cash>=10_000_000)||active[0];
    addLog(g,winner?`🏆 ${winner.name} MENANG!`:'Permainan berakhir. Semua pemain bangkrut.');
  }
}
function nextSeat(g) {
  disasterCheck(g);
  let tries=0;
  do { g.current=(g.current+1)%g.players.length; tries++; }
  while(g.players[g.current].bankrupt&&tries<g.players.length);
  g.rolled=false; g.selected=null; g.landedIndex=null; g.upgradeUsedThisTurn=false; g.specialUsedThisTurn=false;
  checkVictory(g);
}
function useSpecialCard(g, seat, reason) {
  const p=g.players[seat];
  if(!p||p.bankrupt||(p.specialCards||0)<=0||g.specialUsedThisTurn)return false;
  if(!Number.isInteger(p.specialCardUsesLeft)||p.specialCardUsesLeft<1)p.specialCardUsesLeft=3;
  p.specialCardUsesLeft--;g.specialUsedThisTurn=true;
  if(p.specialCardUsesLeft<=0){p.specialCards--;g.availableSpecialCards=Math.min(3,(g.availableSpecialCards||0)+1);p.specialCardUsesLeft=3;}
  addLog(g,`🎴 ${p.name} menggunakan Kartu Spesial untuk ${reason}.`);
  return true;
}
function drawSpecialCard(g, seat) {
  const p=g.players[seat];
  if((g.availableSpecialCards||0)>0){g.availableSpecialCards--;p.specialCards=(p.specialCards||0)+1;p.specialCardUsesLeft=3;addLog(g,`🎴 ${p.name} mendapatkan Kartu Spesial. Persediaan tersisa ${g.availableSpecialCards}/3.`);}
  else addLog(g,'Persediaan Kartu Spesial sedang kosong.');
}
function disasterCheck(g) {
  if(g.disasterResolving||g.gameOver)return;
  const active=g.players.filter(p=>!p.bankrupt),allAssets=active.flatMap(p=>p.owned.map(i=>({p,i})));
  const sixStars=allAssets.filter(x=>(g.tiles[x.i]?.stars||0)===6).length;
  const starred=allAssets.filter(x=>(g.tiles[x.i]?.stars||0)>0);
  if(!g.disasterUnlocked.storm&&sixStars>=10)g.disasterUnlocked.storm=true;
  if(!g.disasterUnlocked.earthquake&&allAssets.length>=20)g.disasterUnlocked.earthquake=true;
  if(starred.length&&g.disasterUnlocked.storm&&(g.disasterCounts.storm||0)<1&&crypto.randomInt(0,100)<10) {
    const chosen=starred.slice().sort(()=>Math.random()-.5).slice(0,5);
    chosen.forEach(x=>{g.tiles[x.i].stars=crypto.randomInt(0,6);});
    g.disasterCounts.storm=1;addLog(g,'🌪️ BADAI HUJAN PETIR! Hingga 5 properti acak kehilangan sebagian bintang.');
  }
  if(allAssets.length&&g.disasterUnlocked.earthquake&&(g.disasterCounts.earthquake||0)<1&&crypto.randomInt(0,100)<10) {
    const chosen=allAssets.slice().sort(()=>Math.random()-.5).slice(0,5);
    chosen.forEach(x=>{x.p.owned=x.p.owned.filter(i=>i!==x.i);g.tiles[x.i].stars=0;});
    g.disasterCounts.earthquake=1;addLog(g,'🌎 GEMPA BUMI BESAR! Hingga 5 properti acak kembali menjadi milik bank.');
  }
}
function loseRandomAssets(g, p, count) {
  const picks=p.owned.slice().sort(()=>Math.random()-.5).slice(0,count);
  for(const i of picks){p.owned=p.owned.filter(x=>x!==i);g.tiles[i].stars=0;}
  if(picks.length)addLog(g,`💥 ${p.name} kehilangan ${picks.length} aset akibat Dadu Istimewa.`);
}
function specialDie(g, seat) {
  const p=g.players[seat],v=crypto.randomInt(1,7);
  addLog(g,`🎲 Dadu Istimewa ${p.name}: angka ${v}.`);
  if(v===1){p.cash+=500000;addLog(g,`${p.name} menerima hadiah Rp500.000.`);}
  else if(v===2)pay(g,seat,null,500000);
  else if(v===3) {
    if(!p.isBot){g.special3Mode='menu';addLog(g,`${p.name} mendapat pilihan Dadu Istimewa 3.`);return;}
    const owned=g.players.flatMap((x,owner)=>x.owned.filter(i=>owner!==seat).map(i=>({owner,i})));
    const empty=TILES.map((t,i)=>({t,i})).filter(x=>['street','rail','utility'].includes(x.t.type)&&ownerOf(g,x.i)===-1);
    if(owned.length&&crypto.randomInt(0,2)===0) {
      const target=owned[crypto.randomInt(owned.length)],cost=saleValue(g,target.i);
      if(p.cash>=cost){g.players[target.owner].owned=g.players[target.owner].owned.filter(i=>i!==target.i);g.tiles[target.i].stars=0;p.cash-=cost;p.owned.push(target.i);addLog(g,`${p.name} membeli paksa ${TILES[target.i].name} dari ${g.players[target.owner].name} seharga Rp${cost.toLocaleString('id-ID')}.`);}
      else addLog(g,`${p.name} tidak cukup uang untuk membeli paksa properti.`);
    } else if(empty.length) {
      const target=empty[crypto.randomInt(empty.length)],cost=Math.ceil(target.t.price*.5);
      if(p.cash>=cost){p.cash-=cost;p.owned.push(target.i);addLog(g,`${p.name} membeli ${target.t.name} dengan diskon 50%.`);}
      else addLog(g,`${p.name} tidak cukup uang untuk pembelian diskon Dadu Istimewa.`);
    } else addLog(g,'Tidak ada properti yang memenuhi pilihan Dadu Istimewa 3.');
  } else if(v===4)drawSpecialCard(g,seat);
  else if(v===5) {
    if(!p.isBot){g.special5Mode='target';addLog(g,`${p.name} harus memilih pemain sasaran Dadu Istimewa 5.`);return;}
    const active=g.players.map((x,i)=>({x,i})).filter(x=>!x.x.bankrupt);
    const target=active.filter(x=>x.i!==seat).sort((a,b)=>b.x.owned.length-a.x.owned.length)[0];
    if(target)loseRandomAssets(g,target.x,2);
    active.filter(x=>x.i!==seat&&x.i!==target?.i).forEach(x=>loseRandomAssets(g,x.x,1));
    addLog(g,'Efek Dadu Istimewa 5 telah diterapkan kepada pemain aktif.');
  } else {p.pos=10;p.jail=3;p.jailAttempts=0;g.selected=10;g.landedIndex=10;addLog(g,`${p.name} masuk penjara selama 3 giliran.`);}
}
function moveAndLand(g, seat, steps, fromFree=false) {
  const p=g.players[seat];
  for(let n=0;n<steps;n++) {
    p.pos=(p.pos+1)%40;
    if(p.pos===0){p.cash+=50000;addLog(g,`${p.name} melewati MULAI dan menerima Rp50.000.`);}
  }
  const i=p.pos,t=TILES[i];
  g.selected=i;g.landedIndex=i;
  addLog(g,`${p.name} berhenti di ${t.name}.`);
  if(['street','rail','utility'].includes(t.type)) {
    const owner=ownerOf(g,i);
    if(owner===-1) {
      addLog(g,`${t.name} belum dimiliki. Harga beli Rp${t.price.toLocaleString('id-ID')}.`);
      if(p.isBot) { /* Pembelian bot diputuskan oleh botPlay sesuai tingkat kesulitan. */
        p.cash-=t.price;p.owned.push(i);addLog(g,`${p.name} membeli ${t.name}.`);
      }
    } else if(owner!==seat) {
      const amount=rentFor(g,i,steps||7);
      if((p.specialCards||0)>0&&!g.specialUsedThisTurn) {
        const reason=`sewa kepada ${g.players[owner].name}`;
        if(p.isBot&&Math.random()<0.55){useSpecialCard(g,seat,reason);addLog(g,`${p.name} terhindar dari pembayaran sewa.`);}
        else if(!p.isBot){g.pendingSpecialPayment={playerIndex:seat,reason,amount,to:owner};addLog(g,`${p.name} harus memilih Kartu Spesial atau membayar sewa.`);}
        else pay(g,seat,owner,amount);
      } else pay(g,seat,owner,amount);
    } else addLog(g,`${p.name} berada di properti miliknya sendiri.`);
  } else if(t.type==='tax') {
    if((p.specialCards||0)>0&&!g.specialUsedThisTurn) {
      if(p.isBot&&Math.random()<0.55){useSpecialCard(g,seat,'membayar pajak');addLog(g,`${p.name} terhindar dari pajak.`);}
      else if(!p.isBot){g.pendingSpecialPayment={playerIndex:seat,reason:'pajak',amount:t.price,to:null};addLog(g,`${p.name} harus memilih Kartu Spesial atau membayar pajak.`);}
      else pay(g,seat,null,t.price);
    } else pay(g,seat,null,t.price);
  } else if(t.type==='chest'||t.type==='chance') {
    const events=t.type==='chest'?
      [['menerima hadiah Dana Umum',20000],['mendapat bonus',10000],['membayar biaya rumah',-15000],['mendapat hadiah',25000],['membayar denda',-10000]]:
      [['membayar biaya perjalanan',-20000],['menerima hadiah lomba',30000],['membayar biaya sekolah',-15000],['mendapat bonus keberuntungan',15000],['membayar biaya perbaikan',-10000]];
    const e=events[crypto.randomInt(events.length)];p.cash+=e[1];
    addLog(g,`${p.name} ${e[0]} Rp${Math.abs(e[1]).toLocaleString('id-ID')}.`);
  } else if(t.type==='gotojail') {
    p.pos=10;p.jail=3;p.jailAttempts=0;g.selected=10;g.landedIndex=10;
    addLog(g,`${p.name} masuk penjara selama 3 giliran.`);
  } else if(t.type==='free'&&!fromFree) {
    p.freeMove=true;addLog(g,`${p.name} mendapat kesempatan pindah gratis.`);
  } else if(t.type==='specialdie') {
    specialDie(g,seat);
  }
  checkVictory(g);
}
function broadcast(r, msg) {
  for(const p of r.players) if(p.ws&&p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify(msg));
  for(const s of r.spectators||[])if(s.ws&&s.ws.readyState===WebSocket.OPEN)s.ws.send(JSON.stringify(msg));
}
function publicPlayer(p) {
  return {id:p.id,name:p.name,ready:!!p.ready,host:!!p.host,connected:!!p.connected,isBot:!!p.isBot,seatIndex:p.seatIndex};
}
function roomSnapshot(r) {
  return {code:r.code,started:r.started,aiDifficulty:r.aiDifficulty||'medium',players:r.players.slice().sort((a,b)=>a.seatIndex-b.seatIndex).map(publicPlayer),
    spectators:(r.spectators||[]).map(s=>({id:s.id,name:s.name,kind:'Penonton'})),
    botCount:r.players.filter(p=>p.isBot).length,maxSeats:4,current:r.gameState?.current??0};
}
function send(ws,obj) { if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj)); }
function saveAll() {
  try {
    fs.mkdirSync(DATA_DIR,{recursive:true});
    const serial=[...rooms.values()].map(r=>({
      code:r.code,hostId:r.hostId,players:r.players.map(p=>({id:p.id,name:p.name,ready:p.ready,host:p.host,
        connected:false,isBot:p.isBot,seatIndex:p.seatIndex,resumeToken:p.resumeToken,wasHumanName:p.wasHumanName||null})),
      started:r.started,gameState:r.gameState,revision:r.revision,createdAt:r.createdAt
    }));
    const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(serial));fs.renameSync(tmp,DATA_FILE);
  } catch(e) { console.error('Gagal menyimpan Room:',e.message); }
}
function loadAll() {
  try {
    if(!fs.existsSync(DATA_FILE))return;
    const data=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
    for(const saved of data) {
      const r={...saved,spectators:[],turnTimer:null,players:saved.players.map(p=>({...p,ws:null,connected:false}))};
      if(r.started)r.players.forEach(p=>{if(!p.isBot){p.wasHumanName=p.name;p.isBot=true;p.name='Bot '+(p.seatIndex+1);if(r.gameState?.players?.[p.seatIndex]){r.gameState.players[p.seatIndex].name=p.name;r.gameState.players[p.seatIndex].isBot=true;r.gameState.players[p.seatIndex].isRemoteHuman=false;}}});if(r.started&&r.gameState&&r.gameState.players[r.gameState.current]?.isBot)resolveBotPending(r.gameState,r.gameState.current);
      rooms.set(r.code,r);
    }
    console.log('Memulihkan',rooms.size,'Room tersimpan.');
  } catch(e) { console.error('Gagal memuat Room tersimpan:',e.message); }
}
function stateMessage(r) {
  if(!r.gameState)return null;
  return {type:'game_state',state:r.gameState,revision:r.revision,turn:{
    seatIndex:r.gameState.current,playerName:r.gameState.players[r.gameState.current]?.name||'',
    isBot:!!r.gameState.players[r.gameState.current]?.isBot,seconds:60
  }};
}
function emitState(r) {
  r.revision++;
  saveAll();
  const m=stateMessage(r);
  if(m)broadcast(r,m);
  scheduleTurn(r);
}
function scheduleTurn(r) {
  if(r.turnTimer)clearTimeout(r.turnTimer);
  r.turnTimer=null;
  if(!r.started||!r.gameState||r.gameState.gameOver)return;
  const g=r.gameState,p=g.players[g.current];
  if(!p)return;
  if(p.isBot) {
    r.turnTimer=setTimeout(()=>botPlay(r),900);
  } else {
    r.turnTimer=setTimeout(()=>{
      if(!r.started||r.gameState.current!==g.current)return;
      addLog(r.gameState,`${p.name} melewati batas waktu.`);
      resolveBotPending(r.gameState,g.current);
      nextSeat(r.gameState);emitState(r);
    },TURN_MS);
  }
}
function resolveBotPending(g, seat) {
  const p=g.players[seat];
  if(g.pendingSpecialPayment&&g.pendingSpecialPayment.playerIndex===seat) {
    const pending=g.pendingSpecialPayment;g.pendingSpecialPayment=null;
    if((p.specialCards||0)>0&&!g.specialUsedThisTurn&&Math.random()<0.55) {
      useSpecialCard(g,seat,pending.reason);
      addLog(g,`${p.name} menggunakan Kartu Spesial secara otomatis.`);
    } else pay(g,seat,pending.to,pending.amount);
  }
  if(g.special3Mode==='menu') {
    g.special3Mode='';
    const owned=g.players.flatMap((x,owner)=>x.owned.filter(i=>owner!==seat&&p.cash>=saleValue(g,i)).map(i=>({owner,i,value:saleValue(g,i)})));
    const empty=TILES.map((t,i)=>({t,i})).filter(x=>['street','rail','utility'].includes(x.t.type)&&ownerOf(g,x.i)===-1&&p.cash>=Math.ceil(x.t.price*.5));
    if(owned.length&&Math.random()<0.5) {
      const x=owned.sort((a,b)=>b.value-a.value)[0];
      g.players[x.owner].owned=g.players[x.owner].owned.filter(i=>i!==x.i);
      g.players[x.owner].cash+=x.value;p.cash-=x.value;p.owned.push(x.i);g.tiles[x.i].stars=0;
      addLog(g,`${p.name} (Bot) membeli paksa ${TILES[x.i].name}.`);
    } else if(empty.length) {
      const x=empty.sort((a,b)=>b.t.price-a.t.price)[0];
      p.cash-=Math.ceil(x.t.price*.5);p.owned.push(x.i);
      addLog(g,`${p.name} (Bot) membeli ${x.t.name} diskon 50%.`);
    }
  }
  if(g.special5Mode==='target') {
    g.special5Mode='';
    const active=g.players.map((x,i)=>({x,i})).filter(x=>!x.x.bankrupt&&x.x.owned.length);
    const target=active.filter(x=>x.i!==seat).sort((a,b)=>b.x.owned.length-a.x.owned.length)[0]||active[0];
    if(target) {
      loseRandomAssets(g,target.x,2);
      active.filter(x=>x.i!==target.i).forEach(x=>loseRandomAssets(g,x.x,1));
    }
  }
}
function botFinishTurn(r) {
  const g=r.gameState,seat=g.current,p=g.players[seat];
  resolveBotPending(g,seat);
  if(!g.gameOver&&g.landedIndex!==null) {
    const i=g.landedIndex,t=TILES[i];
    if(['street','rail','utility'].includes(t.type)&&ownerOf(g,i)===-1&&p.cash>t.price+80000) {
      p.cash-=t.price;p.owned.push(i);addLog(g,`${p.name} membeli ${t.name}.`);
    }
    const own=p.owned.find(x=>['street','utility'].includes(TILES[x].type)&&(g.tiles[x].stars||0)<maxStars(TILES[x]));
    if(own!==undefined&&p.cash>upgradeCost(g,own)+100000&&Math.random()<0.3) {
      const cost=upgradeCost(g,own);p.cash-=cost;g.tiles[own].stars++;g.upgradeUsedThisTurn=true;
      addLog(g,`${p.name} meningkatkan ${TILES[own].name} menjadi ${g.tiles[own].stars} bintang.`);
    }
  }
  if(!g.gameOver){nextSeat(g);}
  emitState(r);
}
function botPlay(r) {
  const g=r.gameState;if(!g||g.gameOver)return;
  const difficulty=g.aiDifficulty||r.aiDifficulty||'medium';
  const ai={easy:{buy:0.35,upgrade:0.12,reserve:180000},medium:{buy:0.7,upgrade:0.3,reserve:90000},hard:{buy:0.92,upgrade:0.65,reserve:35000},veryhard:{buy:1,upgrade:0.92,reserve:10000}}[difficulty]||{buy:0.7,upgrade:0.3,reserve:90000};
  const p=g.players[g.current];if(!p||!p.isBot)return;
  if(g.rolled) { botFinishTurn(r); return; }
  if(!g.rolled) {
    const a=crypto.randomInt(1,7),b=crypto.randomInt(1,7),total=a+b;
    g.diceText=`🎲 ${a} + ${b} = ${total}`;
    if(p.jail>0) {
      if(a===b){p.jail=0;p.jailAttempts=0;addLog(g,`${p.name} mendapat double dan bebas dari penjara.`);moveAndLand(g,g.current,total);}
      else {p.jailAttempts++;if(p.jailAttempts>=3){p.jail=0;p.jailAttempts=0;addLog(g,`${p.name} bebas setelah 3 percobaan.`);}else addLog(g,`${p.name} gagal mendapat double di penjara.`);nextSeat(g);}
    } else {g.rolled=true;moveAndLand(g,g.current,total);}
    if(!g.gameOver&&g.rolled) {
      const i=g.landedIndex,t=TILES[i];
      if(['street','rail','utility'].includes(t.type)&&ownerOf(g,i)===-1&&p.cash>t.price+ai.reserve&&Math.random()<ai.buy) {
        p.cash-=t.price;p.owned.push(i);addLog(g,`${p.name} membeli ${t.name}.`);
      }
      const own=p.owned.find(x=>['street','utility'].includes(TILES[x].type)&&(g.tiles[x].stars||0)<maxStars(TILES[x]));
      if(own!==undefined&&p.cash>upgradeCost(g,own)+ai.reserve&&Math.random()<ai.upgrade) {
        const cost=upgradeCost(g,own);p.cash-=cost;g.tiles[own].stars++;g.upgradeUsedThisTurn=true;
        addLog(g,`${p.name} meningkatkan ${TILES[own].name} menjadi ${g.tiles[own].stars} bintang.`);
      }
    }
    checkVictory(g);
    if(!g.gameOver) {
      if(g.rolled) { nextSeat(g); }
      emitState(r);
    } else emitState(r);
  }
}
function makeRoom(code,host) {
  const r={code,hostId:host.id,players:[host],spectators:[],started:false,gameState:null,revision:0,createdAt:Date.now(),turnTimer:null,aiDifficulty:'medium'};
  rooms.set(code,r);return r;
}
function bindPlayer(ws,r,p,role) {
  if(p.ws&&p.ws!==ws) { try{p.ws.close(4001,'Session dibuka di perangkat lain');}catch{} }
  p.ws=ws;p.connected=true;sockets.set(ws,{code:r.code,id:p.id,role});
}
function cleanSocket(ws) {
  const c=sockets.get(ws);if(!c)return;sockets.delete(ws);
  const r=rooms.get(c.code);if(!r)return;
  if(c.role==='spectator'){r.spectators=(r.spectators||[]).filter(s=>s.id!==c.id);return;}
  const p=r.players.find(x=>x.id===c.id);
  if(p&&p.ws===ws){p.ws=null;p.connected=false;
    if(r.started&&!p.isBot){p.wasHumanName=p.name;p.isBot=true;p.name='Bot '+(p.seatIndex+1);if(r.gameState){const gp=r.gameState.players[p.seatIndex];gp.name=p.name;gp.isBot=true;gp.isRemoteHuman=false;addLog(r.gameState,`${p.wasHumanName} terputus; bot mengambil alih kursinya.`);}}
    if(r.started){
      const humansStillHere=r.players.some(x=>!x.isBot&&x.connected);
      if(!humansStillHere&&!r.gameState.gameOver){
        r.gameState.gameOver=true;
        addLog(r.gameState,'🏁 Semua pemain manusia telah meninggalkan permainan. Permainan berakhir; buat Room baru untuk bermain kembali.');
      }
      emitState(r);
    } else broadcast(r,{type:'room_update',room:roomSnapshot(r)});
    saveAll();
  }
}
function actionError(ws,msg){send(ws,{type:'error',message:msg});}
function startGame(r) {
  const humans=r.players.filter(p=>!p.isBot&&p.ready);
  if(!humans.length)return 'Minimal Host harus siap.';
  const keep=new Set(humans.map(p=>p.id));
  r.players=r.players.filter(p=>p.isBot||keep.has(p.id));
  const used=new Set(r.players.map(p=>p.seatIndex));
  while(r.players.length<MAX_PLAYERS) {
    let seat=0;while(used.has(seat)&&seat<4)seat++;
    if(seat>=4)break;used.add(seat);
    const n=r.players.filter(p=>p.isBot).length+1;
    r.players.push({id:'bot-'+uid(),name:'Bot '+n,ready:true,host:false,connected:false,ws:null,isBot:true,seatIndex:seat,resumeToken:null});
  }
  r.players.sort((a,b)=>a.seatIndex-b.seatIndex);
  r.players.forEach(p=>{p.ready=true;});
  r.started=true;r.revision=0;
  r.gameState=initialState(r.players.map((p,index)=>({id:p.id,name:p.name,isBot:p.isBot,seatIndex:index,connected:p.connected})));
  // Pastikan indeks array state dan nomor kursi pemain selalu sama.
  r.players.forEach((p,index)=>{p.seatIndex=index;});
  r.gameState.aiDifficulty=r.aiDifficulty||'medium';
  addLog(r.gameState,`Tingkat kesulitan Bot: ${String(r.gameState.aiDifficulty).toUpperCase()}.`);
  addLog(r.gameState,'Server menjadi pengendali utama permainan.');
  return null;
}

loadAll();

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/health'){
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
    return res.end(JSON.stringify({service:'Monopoli Wijaya',status:'online',protocolVersion:'4.2.0',
      authority:'server',persistentRooms:true,hostIndependent:true,botsContinueWithoutHumans:true,features:['server_dice','server_movement','server_economy','server_bot_ai','room_persistence','reconnect','turn_timer','orphan_bot_autoplay','special_cards','special_dice','disasters','debt_liquidation']}));
  }
  if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/Monopoli_Wijaya_Mabar_Online.html')){
    return fs.readFile(GAME_FILE,(e,b)=>{if(e){res.writeHead(500);return res.end('HTML game tidak ditemukan.');}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(b);});
  }
  if(req.method==='GET'&&u.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  res.writeHead(404);res.end('Tidak ditemukan.');
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw.toString());}catch{return actionError(ws,'Pesan tidak valid.');}
    const c=sockets.get(ws);
    if(m.type==='create_room') {
      if(c)return;
      let code;do{code=String(crypto.randomInt(0,10000)).padStart(4,'0');}while(rooms.has(code));
      const host={id:uid(),name:String(m.name||'Host').slice(0,18),ready:true,host:true,connected:true,ws,isBot:false,seatIndex:0,resumeToken:crypto.randomBytes(24).toString('hex')};
      const r=makeRoom(code,host);bindPlayer(ws,r,host,'player');
      send(ws,{type:'room',role:'host',playerId:host.id,resumeToken:host.resumeToken,seatIndex:0,room:roomSnapshot(r)});saveAll();return;
    }
    if(m.type==='join_room') {
      if(c)return;
      const code=String(m.code||'').replace(/\D/g,'').slice(0,4),r=rooms.get(code);
      if(!r)return actionError(ws,'Room tidak ditemukan.');
      let p=m.resumeToken?r.players.find(x=>x.resumeToken===m.resumeToken):null;
      if(p) {
        if(p.isBot&&p.wasHumanName){p.name=p.wasHumanName;p.wasHumanName=null;p.isBot=false;if(r.gameState?.players?.[p.seatIndex]){r.gameState.players[p.seatIndex].name=p.name;r.gameState.players[p.seatIndex].isBot=false;r.gameState.players[p.seatIndex].isRemoteHuman=true;addLog(r.gameState,`${p.name} tersambung kembali.`);}}
        bindPlayer(ws,r,p,'player');
        send(ws,{type:'room',role:p.host?'host':'player',playerId:p.id,resumeToken:p.resumeToken,seatIndex:p.seatIndex,room:roomSnapshot(r)});
        if(r.started)send(ws,stateMessage(r));else broadcast(r,{type:'room_update',room:roomSnapshot(r)});
        saveAll();return;
      }
      if(r.started)return actionError(ws,r.gameState?.gameOver?'Permainan telah berakhir. Silakan buat Room baru.':'Permainan sudah dimulai. Gunakan perangkat yang pernah bergabung untuk masuk kembali.');
      const humans=r.players.filter(x=>!x.isBot).length;if(humans>=4)return actionError(ws,'Slot pemain manusia penuh.');
      const used=new Set(r.players.map(x=>x.seatIndex));let seat=0;while(used.has(seat)&&seat<4)seat++;
      if(seat>=4)return actionError(ws,'Room penuh.');
      p={id:uid(),name:String(m.name||'Pemain').slice(0,18),ready:false,host:false,connected:true,ws,isBot:false,seatIndex:seat,resumeToken:crypto.randomBytes(24).toString('hex')};
      r.players.push(p);bindPlayer(ws,r,p,'player');
      send(ws,{type:'room',role:'player',playerId:p.id,resumeToken:p.resumeToken,seatIndex:seat,room:roomSnapshot(r)});
      broadcast(r,{type:'room_update',room:roomSnapshot(r)});saveAll();return;
    }
    if(m.type==='spectate_room') {
      if(c)return;const r=rooms.get(String(m.code||'').replace(/\D/g,'').slice(0,4));if(!r)return actionError(ws,'Room tidak ditemukan.');
      const s={id:uid(),name:String(m.name||'Penonton').slice(0,18),ws};r.spectators.push(s);sockets.set(ws,{code:r.code,id:s.id,role:'spectator'});
      send(ws,{type:'room',role:'spectator',playerId:s.id,room:roomSnapshot(r)});if(r.started)send(ws,stateMessage(r));return;
    }
    if(!c)return actionError(ws,'Buat atau gabung Room terlebih dahulu.');
    const r=rooms.get(c.code);if(!r)return actionError(ws,'Room tidak tersedia.');
    const p=r.players.find(x=>x.id===c.id);
    if(m.type==='set_ready') {if(r.started||!p||p.isBot)return;p.ready=!!m.ready;broadcast(r,{type:'room_update',room:roomSnapshot(r)});saveAll();return;}
    if(m.type==='add_bot') {
      if(c.id!==r.hostId)return actionError(ws,'Hanya Host dapat menambahkan bot.');
      if(r.started)return actionError(ws,'Permainan sudah dimulai.');
      if(r.players.filter(x=>x.isBot).length>=MAX_BOTS||r.players.length>=4)return actionError(ws,'Maksimal 3 bot dan 4 peserta.');
      const used=new Set(r.players.map(x=>x.seatIndex));let seat=0;while(used.has(seat)&&seat<4)seat++;
      const n=r.players.filter(x=>x.isBot).length+1;
      const difficulty=['easy','medium','hard','veryhard'].includes(m.difficulty)?m.difficulty:'medium';
      r.aiDifficulty=difficulty;
      r.players.push({id:'bot-'+uid(),name:'Bot '+n,ready:true,host:false,connected:false,ws:null,isBot:true,seatIndex:seat,resumeToken:null});
      broadcast(r,{type:'room_update',room:roomSnapshot(r)});send(ws,{type:'bot_added',message:`Bot ${n} ditambahkan dan langsung siap.`});saveAll();return;
    }
    if(m.type==='start_game') {
      if(c.id!==r.hostId)return actionError(ws,'Hanya Host dapat memulai.');
      if(r.started)return actionError(ws,'Permainan sudah dimulai.');
      const err=startGame(r);if(err)return actionError(ws,err);
      broadcast(r,{type:'game_started',players:r.players.map(publicPlayer),roomCode:r.code});
      broadcast(r,stateMessage(r));broadcast(r,{type:'room_update',room:roomSnapshot(r)});saveAll();scheduleTurn(r);return;
    }
    if(m.type==='player_action') {
      if(!r.started||!p||p.isBot)return actionError(ws,'Pemain tidak aktif.');
      const g=r.gameState,seat=p.seatIndex;
      const seated=g.players[seat];
      if(!seated||seated.id!==p.id)return actionError(ws,'Identitas kursi pemain tidak cocok. Keluar lalu gabung kembali ke Room.');
      if(g.current!==seat){
        send(ws,{type:'error',message:'Belum giliran kamu. Giliran sekarang: '+(g.players[g.current]?.name||'Pemain')+'.'});
        send(ws,stateMessage(r));
        return;
      }
      if(g.gameOver)return actionError(ws,'Permainan sudah berakhir.');
      const a=m.action;
      if(a==='roll') {
        if(g.rolled&&g.players[seat].jail<=0)return actionError(ws,'Dadu sudah dilempar pada giliran ini.');
        const a1=crypto.randomInt(1,7),b1=crypto.randomInt(1,7),total=a1+b1,me=g.players[seat];
        g.diceText=`🎲 ${a1} + ${b1} = ${total}`;
        if(me.jail>0) {
          if(a1===b1){me.jail=0;me.jailAttempts=0;addLog(g,`${me.name} mendapat double dan bebas dari penjara.`);g.rolled=true;moveAndLand(g,seat,total);}
          else {me.jailAttempts++;if(me.jailAttempts>=3){me.jail=0;me.jailAttempts=0;addLog(g,`${me.name} bebas setelah percobaan ketiga.`);}else addLog(g,`${me.name} gagal mendapat double di penjara.`);nextSeat(g);}
        } else {g.rolled=true;moveAndLand(g,seat,total);}
        emitState(r);return;
      }
      if(a==='buy') {
        if(!g.rolled||g.landedIndex===null||g.landedIndex!==g.players[seat].pos)return actionError(ws,'Tidak ada properti untuk dibeli.');
        const i=g.landedIndex,t=TILES[i];
        if(!['street','rail','utility'].includes(t.type)||ownerOf(g,i)!==-1)return actionError(ws,'Properti tidak tersedia.');
        if(g.players[seat].cash<t.price)return actionError(ws,'Uang tidak cukup.');
        g.players[seat].cash-=t.price;g.players[seat].owned.push(i);addLog(g,`${p.name} membeli ${t.name} seharga Rp${t.price.toLocaleString('id-ID')}.`);emitState(r);return;
      }
      if(a==='upgrade') {
        const i=Number.isInteger(m.selected)?m.selected:g.selected,t=TILES[i];
        if(!g.rolled||!t||ownerOf(g,i)!==seat||!['street','utility'].includes(t.type)||g.upgradeUsedThisTurn)return actionError(ws,'Properti tidak dapat di-upgrade.');
        const cost=upgradeCost(g,i);if(g.players[seat].cash<cost)return actionError(ws,'Uang tidak cukup.');
        g.players[seat].cash-=cost;g.tiles[i].stars++;g.selected=i;g.upgradeUsedThisTurn=true;
        addLog(g,`${p.name} meningkatkan ${t.name} menjadi ${g.tiles[i].stars} bintang.`);emitState(r);return;
      }
      if(a==='free_move') {
        const i=Number.isInteger(m.selected)?m.selected:null;
        if(!g.rolled||!g.players[seat].freeMove||i===null||i<0||i>=40)return actionError(ws,'Pilih petak tujuan pindah gratis.');
        g.players[seat].freeMove=false;g.players[seat].pos=i;moveLandAt(g,seat,i);emitState(r);return;
      }
      if(a==='end_turn') {
        if(g.pendingSpecialPayment||g.special3Mode||g.special5Mode)return actionError(ws,'Selesaikan pilihan khusus terlebih dahulu.');
        if(!g.rolled)return actionError(ws,'Lempar dadu terlebih dahulu.');
        nextSeat(g);emitState(r);return;
      }
      if(a==='use_special_card') {
        const pending=g.pendingSpecialPayment;
        if(!pending||pending.playerIndex!==seat||!useSpecialCard(g,seat,pending.reason))return actionError(ws,'Tidak ada pembayaran yang dapat dibatalkan dengan Kartu Spesial.');
        g.pendingSpecialPayment=null;addLog(g,`${p.name} tidak perlu membayar ${pending.reason}.`);emitState(r);return;
      }
      if(a==='sell_special_card') {
        const me=g.players[seat],uses=me.specialCardUsesLeft||3;
        if((me.specialCards||0)<=0)return actionError(ws,'Tidak memiliki Kartu Spesial.');
        const price=uses>=3?1000000:uses===2?750000:500000;
        me.specialCards--;me.specialCardUsesLeft=3;me.cash+=price;g.availableSpecialCards=Math.min(3,(g.availableSpecialCards||0)+1);
        addLog(g,`${me.name} menjual Kartu Spesial seharga Rp${price.toLocaleString('id-ID')}.`);emitState(r);return;
      }
      if(a==='cancel_choice') {g.special3Mode='';g.special5Mode='';addLog(g,`${p.name} membatalkan pilihan Dadu Istimewa.`);emitState(r);return;}
      if(a==='special5_target') {
        const targetSeat=Number(m.target),target=g.players[targetSeat];
        if(g.special5Mode!=='target'||!g.rolled||!target||target.bankrupt||!target.owned.length)return actionError(ws,'Target Dadu Istimewa tidak valid.');
        loseRandomAssets(g,target,2);
        g.players.forEach((other,i)=>{if(i!==seat&&i!==targetSeat&&!other.bankrupt)loseRandomAssets(g,other,1);});
        g.special5Mode='';emitState(r);return;
      }
      if(a==='pay_pending') {
        const pending=g.pendingSpecialPayment;
        if(!pending||pending.playerIndex!==seat)return actionError(ws,'Tidak ada tagihan tertunda.');
        g.pendingSpecialPayment=null;pay(g,seat,pending.to,pending.amount);emitState(r);return;
      }
      if(a==='special3_owned'||a==='special3_empty') {
        const i=Number(m.selected);
        if(g.special3Mode!=='menu')return actionError(ws,'Tidak ada pilihan Dadu Istimewa 3 yang tertunda.');
        if(!g.rolled||!Number.isInteger(i)||i<0||i>=40)return actionError(ws,'Petak pilihan tidak valid.');
        const t=TILES[i],owner=ownerOf(g,i);
        if(a==='special3_owned'&&owner>=0&&owner!==seat) {
          const cost=saleValue(g,i);if(g.players[seat].cash<cost)return actionError(ws,'Uang tidak cukup untuk membeli paksa.');
          g.players[owner].owned=g.players[owner].owned.filter(x=>x!==i);g.players[owner].cash+=cost;g.players[seat].cash-=cost;g.players[seat].owned.push(i);g.tiles[i].stars=0;
          addLog(g,`${p.name} membeli paksa ${t.name} seharga Rp${cost.toLocaleString('id-ID')}.`);
        } else if(a==='special3_empty'&&['street','rail','utility'].includes(t.type)&&owner===-1) {
          const cost=Math.ceil(t.price*.5);if(g.players[seat].cash<cost)return actionError(ws,'Uang tidak cukup.');
          g.players[seat].cash-=cost;g.players[seat].owned.push(i);addLog(g,`${p.name} membeli ${t.name} dengan diskon 50%.`);
        } else return actionError(ws,'Petak tidak memenuhi syarat pilihan.');
        g.special3Mode='';emitState(r);return;
      }
      return actionError(ws,'Aksi tidak dikenal pada server authoritative.');
    }
    return actionError(ws,'Perintah tidak dikenal.');
  });
  ws.on('close',()=>cleanSocket(ws));ws.on('error',()=>cleanSocket(ws));
});
function moveLandAt(g,seat,i) {
  const p=g.players[seat],t=TILES[i];g.selected=i;g.landedIndex=i;
  addLog(g,`${p.name} berpindah gratis ke ${t.name}.`);
  if(['street','rail','utility'].includes(t.type)) {
    const o=ownerOf(g,i);
    if(o===-1) addLog(g,`${t.name} kosong dan dapat dibeli seharga Rp${t.price.toLocaleString('id-ID')}.`);
    else if(o!==seat) {
      const amount=rentFor(g,i,7);
      if((p.specialCards||0)>0&&!g.specialUsedThisTurn) {
        if(p.isBot&&Math.random()<0.55){useSpecialCard(g,seat,`membayar sewa kepada ${g.players[o].name}`);addLog(g,`${p.name} terhindar dari pembayaran sewa.`);}
        else if(!p.isBot)g.pendingSpecialPayment={playerIndex:seat,reason:`sewa kepada ${g.players[o].name}`,amount,to:o};
        else pay(g,seat,o,amount);
      } else pay(g,seat,o,amount);
    }
  } else if(t.type==='tax') {
    if((p.specialCards||0)>0&&!g.specialUsedThisTurn) {
      if(p.isBot&&Math.random()<0.55)useSpecialCard(g,seat,'membayar pajak');
      else if(!p.isBot)g.pendingSpecialPayment={playerIndex:seat,reason:'pajak',amount:t.price,to:null};
      else pay(g,seat,null,t.price);
    } else pay(g,seat,null,t.price);
  } else if(t.type==='chest'||t.type==='chance') {
    const events=t.type==='chest'?
      [['menerima hadiah Dana Umum',20000],['mendapat bonus',10000],['membayar biaya rumah',-15000],['mendapat hadiah',25000],['membayar denda',-10000]]:
      [['membayar biaya perjalanan',-20000],['menerima hadiah lomba',30000],['membayar biaya sekolah',-15000],['mendapat bonus keberuntungan',15000],['membayar biaya perbaikan',-10000]];
    const e=events[crypto.randomInt(events.length)];
    if(e[1]<0)pay(g,seat,null,-e[1]);else p.cash+=e[1];
    addLog(g,`${p.name} ${e[0]} Rp${Math.abs(e[1]).toLocaleString('id-ID')}.`);
  } else if(t.type==='gotojail') {
    p.pos=10;p.jail=3;p.jailAttempts=0;g.selected=10;g.landedIndex=10;
    addLog(g,`${p.name} masuk penjara selama 3 giliran.`);
  } else if(t.type==='specialdie') specialDie(g,seat);
  else if(t.type==='free')p.freeMove=true;
  checkVictory(g);
}
server.listen(PORT,()=>{console.log(`Monopoli Wijaya server-authoritative v4.2.0 aktif di port ${PORT}`);for(const r of rooms.values())if(r.started)scheduleTurn(r);});
