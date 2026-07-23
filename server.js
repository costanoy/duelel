/* =========================================================================
   Duelel — servidor de produção
   - HTTP: serve os arquivos estáticos de /public
   - WebSocket (/ws): matchmaking, salas privadas, sincronização da corrida
   - SQLite (arquivo duelel.db): ranking (melhor PPM por jogador)
   Rodar:  npm install && npm start   (porta via env PORT, padrão 8080)
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

function findPublicDir() {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(process.cwd(), 'public'),
    path.join(__dirname, 'public', 'public'),
    __dirname,
    process.cwd()
  ];
  for (const d of candidates) {
    try { if (fs.existsSync(path.join(d, 'index.html'))) return d; } catch (e) {}
  }
  return path.join(__dirname, 'public');
}
const PUBLIC_DIR = findPublicDir();

/* ---------------------------------------------------------------- SQLite */
let db = null;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, 'duelel.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS scores(
    player_id TEXT PRIMARY KEY,
    name      TEXT,
    wpm       INTEGER,
    mode      TEXT,
    ts        INTEGER
  );`);
  console.log('[db] SQLite pronto');
} catch (e) {
  console.warn('[db] better-sqlite3 indisponível — ranking desativado:', e.message);
}

const upsertScore = db && db.prepare(`
  INSERT INTO scores(player_id, name, wpm, mode, ts)
  VALUES(@player_id, @name, @wpm, @mode, @ts)
  ON CONFLICT(player_id) DO UPDATE SET
    name = excluded.name, wpm = excluded.wpm, mode = excluded.mode, ts = excluded.ts
  WHERE excluded.wpm > scores.wpm
`);
const selectTop = db && db.prepare(
  `SELECT name, wpm, mode FROM scores ORDER BY wpm DESC LIMIT ?`
);

function submitScore(playerId, name, wpm, mode) {
  if (!db || !playerId) return;
  wpm = Math.round(Number(wpm) || 0);
  if (wpm <= 0 || wpm > 400) return; // guarda simples contra valores absurdos
  try {
    upsertScore.run({
      player_id: String(playerId).slice(0, 64),
      name: String(name || '—').slice(0, 14),
      wpm, mode: String(mode || 'duelo').slice(0, 12), ts: Date.now()
    });
  } catch (e) { /* ignora */ }
}
function topScores(n = 15) {
  if (!db) return [];
  try { return selectTop.all(n); } catch (e) { return []; }
}

/* ---------------------------------------------------------------- palavras */
const WORDS = ("tempo pessoa ano forma mundo vida dia mão parte casa olho água homem coisa história terra trabalho momento noite país hora palavra fim mês lugar cabeça exemplo verdade número grupo problema luz nome ideia corpo cidade amigo escola livro filho pai mãe força ponto campo governo festa música cor comida rua carro porta janela mesa cadeira papel caneta computador telefone internet jogo filme teatro arte ciência natureza animal planta flor árvore rio mar montanha céu sol lua estrela chuva vento fogo calor frio manhã tarde semana futuro passado presente minuto segundo começo meio verão inverno sonho medo alegria amor paz saúde dinheiro preço valor conta banco loja mercado comprar vender pagar ganhar correr andar falar ouvir pensar saber querer poder fazer dizer viver aprender ensinar ler escrever cantar dançar jogar brincar trabalhar estudar viajar comer beber dormir acordar sorrir amar gostar precisar tentar conseguir começar terminar mudar ficar voltar chegar sair entrar subir descer abrir fechar pegar deixar encontrar esperar ajudar cuidar criar construir consertar limpar cozinhar plantar rápido devagar forte claro simples bonito").split(" ");

function stripAccents(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function genWords(n, accents) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[(Math.random() * WORDS.length) | 0]);
  let t = out.join(' ');
  if (!accents) t = stripAccents(t);
  return t;
}

/* ---------------------------------------------------------------- HTTP */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(url).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem"><h1>404</h1><p>Arquivo não encontrado no servidor.</p></body>');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------------------------------------------------------------- WebSocket */
const wss = new WebSocketServer({ server, path: '/ws' });

const queues = new Map();  // bucket "plataforma|acentos" -> [ws]
const rooms = new Map();   // código -> { host, guest }

const rid = () => crypto.randomUUID ? crypto.randomUUID() : 'r' + Math.random().toString(36).slice(2);
const roomCode = () => Array.from({ length: 5 }, () =>
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0]).join('');

function send(ws, type, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ type }, payload || {})));
}
function bucketOf(c) { return `${c.platform}|${c.accents ? 'a' : 'na'}`; }

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.c = { id: rid(), playerId: null, name: '—', platform: 'desktop', accents: true,
           state: 'idle', race: null, opp: null, roomCode: null, bucket: null,
           lastWpm: 0, lastAcc: 100 };
  send(ws, 'welcome', { id: ws.c.id });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    handle(ws, m);
  });
  ws.on('close', () => cleanup(ws));
  ws.on('error', () => {});
});

function applyProfile(c, m) {
  if (typeof m.name === 'string') c.name = m.name.slice(0, 14) || '—';
  if (m.platform === 'mobile' || m.platform === 'desktop') c.platform = m.platform;
  if (typeof m.accents === 'boolean') c.accents = m.accents;
  if (typeof m.playerId === 'string') c.playerId = m.playerId.slice(0, 64);
}

function handle(ws, m) {
  const c = ws.c;
  switch (m.type) {
    case 'hello':
      applyProfile(c, m);
      break;

    case 'quick_join': {
      applyProfile(c, m);
      leaveQueue(ws);
      const bucket = bucketOf(c);
      const q = queues.get(bucket) || [];
      // procura um oponente compatível já esperando
      let opp = null;
      while (q.length) {
        const cand = q.shift();
        if (cand.readyState === 1 && cand.c.state === 'queue') { opp = cand; break; }
      }
      if (opp) {
        queues.set(bucket, q);
        startRace(opp, ws, c.accents, null);
      } else {
        q.push(ws); queues.set(bucket, q);
        c.state = 'queue'; c.bucket = bucket;
        send(ws, 'waiting', { mode: 'quick' });
      }
      break;
    }

    case 'quick_cancel':
      leaveQueue(ws); c.state = 'idle';
      break;

    case 'room_create': {
      applyProfile(c, m);
      let code; do { code = roomCode(); } while (rooms.has(code));
      rooms.set(code, { host: ws, guest: null });
      c.state = 'room'; c.roomCode = code;
      send(ws, 'room_created', { code });
      break;
    }

    case 'room_join': {
      applyProfile(c, m);
      const code = String(m.code || '').toUpperCase().slice(0, 5);
      const r = rooms.get(code);
      if (!r) { send(ws, 'error', { msg: 'Sala não encontrada ou já encerrada.' }); break; }
      if (r.guest || r.host === ws) { send(ws, 'error', { msg: 'Essa sala já está cheia.' }); break; }
      r.guest = ws; c.roomCode = code;
      startRace(r.host, ws, r.host.c.accents, code);
      break;
    }

    case 'progress': {
      const opp = c.opp;
      if (opp) send(opp, 'opp_progress', { idx: m.idx | 0, wpm: m.wpm | 0 });
      c.lastWpm = m.wpm | 0;
      break;
    }

    case 'finished': {
      const race = c.race;
      if (!race || race.over) break;
      race.fin.set(ws, {
        finishTime: Math.max(0, Number(m.finishTime) || 0),
        wpm: m.wpm | 0, acc: (m.acc == null ? 100 : m.acc | 0)
      });
      c.lastWpm = m.wpm | 0; c.lastAcc = (m.acc == null ? 100 : m.acc | 0);
      if (race.fin.size >= 2) decide(race);
      else if (!race.graceTimer) race.graceTimer = setTimeout(() => decide(race), 600);
      break;
    }

    case 'score_submit':
      applyProfile(c, m);
      submitScore(c.playerId, c.name, m.wpm, m.mode || 'treino');
      break;

    case 'leaderboard_get':
      send(ws, 'leaderboard', { rows: topScores(15) });
      break;

    case 'rematch': {
      const other = c.rematchWith;
      if (!other || other.readyState !== 1 || other.c.rematchWith !== ws) {
        // oponente saiu — não dá pra revanche
        c.rematchWith = null; c.rematchWant = false;
        send(ws, 'opp_left', {});
        break;
      }
      c.rematchWant = true;
      if (other.c.rematchWant) {
        // os dois toparam → nova corrida no mesmo par
        const code = c.rematchCode || other.c.rematchCode || null;
        c.rematchWith = null; other.c.rematchWith = null;
        c.rematchWant = false; other.c.rematchWant = false;
        startRace(other, ws, c.accents, code);
      } else {
        send(ws, 'waiting', { mode: 'rematch' });
        send(other, 'rematch_offer', {});
      }
      break;
    }

    case 'leave':
      abandon(ws); leaveQueue(ws);
      // desfaz revanche pendente, avisando o par
      if (c.rematchWith && c.rematchWith.readyState === 1 && c.rematchWith.c.rematchWith === ws) {
        const p = c.rematchWith;
        p.c.rematchWith = null; if (p.c.rematchWant) send(p, 'opp_left', {});
      }
      c.rematchWith = null; c.rematchWant = false;
      if (c.roomCode) closeRoom(c.roomCode, ws);
      c.state = 'idle';
      break;
  }
}

function leaveQueue(ws) {
  const b = ws.c.bucket; if (!b) return;
  const q = queues.get(b);
  if (q) { const i = q.indexOf(ws); if (i >= 0) q.splice(i, 1); }
  ws.c.bucket = null;
}
function closeRoom(code, ws) {
  const r = rooms.get(code); if (!r) return;
  if (r.host === ws || r.guest === ws) rooms.delete(code);
  ws.c.roomCode = null;
}

function startRace(a, b, accents, code) {
  const race = {
    id: rid(), a, b, text: genWords(28, accents),
    startAt: Date.now() + 3500, fin: new Map(), over: false, graceTimer: null, code
  };
  for (const [x, y] of [[a, b], [b, a]]) {
    x.c.state = 'racing'; x.c.race = race; x.c.opp = y;
    x.c.roomCode = code || null; x.c.bucket = null;
  }
  const now = Date.now();
  send(a, 'match_found', { text: race.text, startAt: race.startAt, serverNow: now, room: code,
    opp: { name: b.c.name, platform: b.c.platform } });
  send(b, 'match_found', { text: race.text, startAt: race.startAt, serverNow: now, room: code,
    opp: { name: a.c.name, platform: a.c.platform } });
}

function decide(race) {
  if (race.over) return;
  race.over = true;
  if (race.graceTimer) clearTimeout(race.graceTimer);
  const { a, b } = race;
  const fa = race.fin.get(a), fb = race.fin.get(b);
  let winner;
  if (fa && fb) winner = (fa.finishTime <= fb.finishTime) ? a : b;
  else winner = fa ? a : b;
  report(race, winner);
}

function statOf(race, ws) {
  const f = race.fin.get(ws);
  return { name: ws.c.name,
           wpm: f ? f.wpm : (ws.c.lastWpm || 0),
           acc: f ? f.acc : (ws.c.lastAcc == null ? 100 : ws.c.lastAcc),
           finishTime: f ? f.finishTime : null, finished: !!f };
}
function report(race, winner) {
  const { a, b } = race;
  const sa = statOf(race, a), sb = statOf(race, b);
  submitScore(a.c.playerId, a.c.name, sa.wpm, 'duelo');
  submitScore(b.c.playerId, b.c.name, sb.wpm, 'duelo');
  send(a, 'race_over', { youWon: winner === a, you: sa, opp: sb });
  send(b, 'race_over', { youWon: winner === b, you: sb, opp: sa });
  for (const x of [a, b]) { x.c.state = 'idle'; x.c.race = null; x.c.opp = null; }
  if (race.code) {
    // guarda o par para permitir revanche sem novo link
    a.c.rematchWith = b; b.c.rematchWith = a;
    a.c.rematchWant = false; b.c.rematchWant = false;
    a.c.rematchCode = race.code; b.c.rematchCode = race.code;
    rooms.delete(race.code); // o link antigo já não serve; a revanche usa a conexão direta
  } else {
    a.c.rematchWith = null; b.c.rematchWith = null;
  }
}

/* saída no meio da corrida: o oponente ganha por W.O. */
function abandon(ws) {
  const race = ws.c.race;
  if (!race || race.over) return;
  race.over = true;
  if (race.graceTimer) clearTimeout(race.graceTimer);
  const opp = ws.c.opp;
  if (opp && opp.readyState === 1) {
    submitScore(opp.c.playerId, opp.c.name, opp.c.lastWpm || 0, 'duelo');
    send(opp, 'opp_left', {});
    opp.c.state = 'idle'; opp.c.race = null; opp.c.opp = null;
    opp.c.rematchWith = null; opp.c.rematchWant = false;
  }
  if (race.code) rooms.delete(race.code);
}

function cleanup(ws) {
  abandon(ws);
  leaveQueue(ws);
  if (ws.c.roomCode) closeRoom(ws.c.roomCode, ws);
  // se havia um par aguardando revanche, avisa e desfaz
  const peer = ws.c.rematchWith;
  if (peer && peer.readyState === 1 && peer.c.rematchWith === ws) {
    const wasWaiting = peer.c.rematchWant;
    peer.c.rematchWith = null; peer.c.rematchWant = false;
    if (wasWaiting) send(peer, 'opp_left', {});
  }
}

/* heartbeat: derruba conexões mortas */
const ping = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);
wss.on('close', () => clearInterval(ping));

function listDir(d) {
  try { return fs.readdirSync(d).join(', ') || '(vazia)'; }
  catch (e) { return '(não existe: ' + e.code + ')'; }
}
server.listen(PORT, () => {
  console.log(`[duelel] ouvindo na porta ${PORT}`);
  console.log('[diag] __dirname   =', __dirname);
  console.log('[diag] cwd         =', process.cwd());
  console.log('[diag] PUBLIC_DIR  =', PUBLIC_DIR);
  console.log('[diag] conteúdo de __dirname:', listDir(__dirname));
  console.log('[diag] conteúdo de PUBLIC_DIR:', listDir(PUBLIC_DIR));
  if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
    console.log('[duelel] index.html encontrado — OK');
  } else {
    console.warn('[AVISO] index.html NÃO encontrado. Veja a lista acima: o arquivo pode estar noutra pasta ou com outro nome (atenção a maiúsculas — o Linux diferencia Index.html de index.html).');
  }
});
