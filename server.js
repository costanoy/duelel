/* =========================================================================
   Duelel — servidor de produção
   - HTTP: serve os arquivos estáticos de /public (com ETag, gzip e headers básicos)
   - WebSocket (/ws): matchmaking, salas privadas, sincronização da corrida
   - Postgres (Supabase, via DATABASE_URL): ranking (melhor PPM por jogador)
   Rodar:  npm install && npm start   (porta via env PORT, padrão 8080)
   Tempos ajustáveis por env (úteis em teste): READY_TIMEOUT_MS, CROSS_PLATFORM_AFTER_MS,
   RACE_MAX_MS, GRACE_MS, PRESENCE_THROTTLE_MS.
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PLAUSIBLE_WPM = 220; // acima do recorde mundial sustentado — qualquer coisa maior é bot/script, não humano

// Lê um tempo (ms) do ambiente; sem valor válido, fica o padrão.
function envMs(name, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
}
const READY_TIMEOUT_MS = envMs('READY_TIMEOUT_MS', 20000);              // prazo para os dois confirmarem no "Prontos?"
const CROSS_PLATFORM_AFTER_MS = envMs('CROSS_PLATFORM_AFTER_MS', 15000); // espera para parear teclado × celular (0 desliga)
// Duração máxima da corrida. Sem override vale max(120 s, 4× o tempo mínimo do texto);
// com RACE_MAX_MS no ambiente vale exatamente o valor dado (para testes rápidos).
const RACE_MAX_OVERRIDE = envMs('RACE_MAX_MS', null);
const RACE_MAX_MIN_MS = 120000;
const GRACE_MS = envMs('GRACE_MS', 600);                       // janela para o 2º terminar depois do 1º
const PRESENCE_THROTTLE_MS = envMs('PRESENCE_THROTTLE_MS', 3000); // no máximo 1 'presence' a cada 3 s
const START_DELAY_MS = 3200;      // contagem 3-2-1 entre o race_start e a largada
const FINISH_TOLERANCE_MS = 1500; // folga de latência aceita no finishTime informado pelo cliente
const PROGRESS_SLACK_MS = 2000;   // folga do teto de plausibilidade do progresso (relógios com skew)

// Só aceita pastas chamadas "public": cair na raiz do repositório exporia server.js, package.json e .git.
function findPublicDir() {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(process.cwd(), 'public'),
    path.join(__dirname, 'public', 'public')
  ];
  for (const d of candidates) {
    try { if (fs.existsSync(path.join(d, 'index.html'))) return path.resolve(d); } catch (e) {}
  }
  return path.join(__dirname, 'public');
}
const PUBLIC_DIR = findPublicDir();

/* ---------------------------------------------------------------- Postgres (Supabase) */
// Ranking guardado no Postgres do Supabase em vez de SQLite local — sobrevive a
// qualquer deploy/restart sem precisar de disco persistente no host, e o driver
// `pg` é JS puro (sem compilação nativa, ao contrário do better-sqlite3).
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Com PG_CA_CERT (certificado do Supabase) o TLS é verificado de verdade; sem ele mantém o
    // comportamento antigo, para não derrubar o deploy atual por falta do certificado.
    ssl: process.env.PG_CA_CERT ? { ca: process.env.PG_CA_CERT } : { rejectUnauthorized: false }
  });
  pool.on('error', (e) => console.warn('[db] erro assíncrono no pool:', e.message));

  (async () => {
    try {
      // players: trava um player_id (dispositivo/navegador) ao PRIMEIRO nome que ele usar —
      // evita que a mesma pessoa crie várias entradas no ranking trocando de nome.
      await pool.query(`CREATE TABLE IF NOT EXISTS players(
        player_id TEXT PRIMARY KEY,
        name      TEXT,
        ts        BIGINT
      )`);
      // scores: uma linha por (nome, categoria) — "geral" (duelo/tempo/treino/bot) e "duelel_text"
      // (o texto fixo do Duelel) são rankings separados, então a mesma pessoa pode ter uma
      // entrada em cada categoria, mas nunca duas na mesma categoria nem em duas plataformas.
      await pool.query(`CREATE TABLE IF NOT EXISTS scores(
        name_key  TEXT,
        category  TEXT,
        name      TEXT,
        player_id TEXT,
        wpm       INTEGER,
        mode      TEXT,
        platform  TEXT,
        ts        BIGINT,
        PRIMARY KEY(name_key, category)
      )`);
      // índices: os quadros (top 25 e posição) filtram por plataforma+categoria ordenando por PPM,
      // e "você no ranking" procura pelo player_id
      await pool.query('CREATE INDEX IF NOT EXISTS scores_board_idx ON scores(platform, category, wpm DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS scores_player_idx ON scores(player_id)');
      console.log('[db] Postgres (Supabase) pronto');
    } catch (e) {
      console.warn('[db] falha ao preparar tabelas no Postgres:', e.message);
    }
  })();
} else {
  console.warn('[db] DATABASE_URL não configurada — ranking desativado');
}

// Modos aceitos via score_submit. 'duelo' fica de fora de propósito: só o próprio servidor grava duelo.
const SOLO_MODES = new Set(['tempo', 'treino', 'duelel_text', 'bot']);
const categoryOf = (mode) => (mode === 'duelel_text' ? 'duelel_text' : 'geral');
// quadros do ranking -> [plataforma, categoria]
const BOARDS = {
  desktop: ['desktop', 'geral'], mobile: ['mobile', 'geral'],
  desktopDuelel: ['desktop', 'duelel_text'], mobileDuelel: ['mobile', 'duelel_text']
};
const boardKeyOf = (platform, category) =>
  (platform === 'mobile' ? 'mobile' : 'desktop') + (category === 'duelel_text' ? 'Duelel' : '');
const LB_SIZE = 25;
const LB_CACHE_MS = 5000;

// Nome exibido: tira caracteres de controle e de formatação (NUL, que o Postgres recusa; bidi como
// U+202E, que inverte o texto na tela; zero-width, que cria nomes "iguais" com chaves diferentes),
// junta espaços repetidos e limita a 14 caracteres (contando emoji como 1, sem partir surrogates).
function cleanName(s) {
  if (typeof s !== 'string') return '';
  // espaços primeiro (tab e quebra de linha também são "controle", mas separam palavras)
  const t = s.normalize('NFC').replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/ {2,}/g, ' ').trim();
  return Array.from(t).slice(0, 14).join('').trim();
}
// chave do ranking: NFKC junta variantes visuais (letras de largura total, ligaduras) do mesmo nome
const nameKeyOf = (name) => name.normalize('NFKC').toLowerCase();

const count = async (sql, params) => Number((await pool.query(sql, params)).rows[0].n);

// Grava a pontuação e manda ao próprio jogador um score_ack com a posição dele no quadro.
async function submitScore(ws, mode, wpm) {
  if (!pool) return;
  wpm = Math.round(wpm);
  if (!(wpm > 0) || wpm > MAX_PLAUSIBLE_WPM) return; // guarda contra valores absurdos (bot/script)
  const c = ws.c;
  const pid = c.playerId;
  if (!pid) return; // sem player_id não há como travar a identidade do nome
  let name = cleanName(c.name) || '—';
  const category = categoryOf(mode);
  const plat = (c.platform === 'mobile') ? 'mobile' : 'desktop';

  try {
    // trava a identidade: um player_id só pode ter UM nome no ranking pra sempre —
    // se já tiver nome estabelecido, ignora o que veio agora e usa o de sempre.
    const pl = await pool.query('SELECT name FROM players WHERE player_id = $1', [pid]);
    if (pl.rows[0] && pl.rows[0].name) name = pl.rows[0].name;
    else await pool.query(
      'INSERT INTO players(player_id, name, ts) VALUES($1, $2, $3) ON CONFLICT(player_id) DO NOTHING',
      [pid, name, Date.now()]
    );

    // o nome já pertence a outro player_id: este jogador ganha uma linha própria (mesmo nome
    // exibido, chave diferente) em vez de tomar a linha do outro ou perder a pontuação
    const rowOf = async (key) => (await pool.query(
      'SELECT player_id, wpm, platform FROM scores WHERE name_key = $1 AND category = $2', [key, category])).rows[0] || null;
    let nameKey = nameKeyOf(name).slice(0, 80);
    let prev = await rowOf(nameKey);
    if (prev && prev.player_id && prev.player_id !== pid) {
      nameKey = (nameKey + '#' + pid).slice(0, 120);
      prev = await rowOf(nameKey);
    }
    const prevRank = prev ? 1 + await count(
      'SELECT COUNT(*) AS n FROM scores WHERE platform = $1 AND category = $2 AND wpm > $3',
      [prev.platform, category, prev.wpm]) : null;

    // só atualiza quando melhora, e nunca por cima de uma linha de outro player_id
    await pool.query(
      `INSERT INTO scores(name_key, category, name, player_id, wpm, mode, platform, ts)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(name_key, category) DO UPDATE SET
         name = excluded.name, player_id = excluded.player_id, wpm = excluded.wpm,
         mode = excluded.mode, platform = excluded.platform, ts = excluded.ts
       WHERE excluded.wpm > scores.wpm
         AND (scores.player_id IS NULL OR scores.player_id = excluded.player_id)`,
      [nameKey, category, name, pid, wpm, mode, plat, Date.now()]
    );
    const cur = (await pool.query(
      'SELECT name, wpm, platform, player_id FROM scores WHERE name_key = $1 AND category = $2', [nameKey, category])).rows[0];
    if (!cur) return;
    // melhorou = a linha agora é deste jogador com exatamente este PPM, acima do anterior
    // (comparação explícita em vez de RETURNING, que varia entre bancos quando o WHERE do upsert é falso)
    const improved = cur.player_id === pid && cur.wpm === wpm && (!prev || wpm > prev.wpm);
    if (improved) invalidateLb();
    const best = cur.wpm;
    const rank = 1 + await count(
      'SELECT COUNT(*) AS n FROM scores WHERE platform = $1 AND category = $2 AND wpm > $3', [cur.platform, category, best]);
    const total = await count(
      'SELECT COUNT(*) AS n FROM scores WHERE platform = $1 AND category = $2', [cur.platform, category]);
    const nx = (await pool.query(
      'SELECT name, wpm FROM scores WHERE platform = $1 AND category = $2 AND wpm > $3 ORDER BY wpm ASC, ts ASC LIMIT 1',
      [cur.platform, category, best])).rows[0];
    send(ws, 'score_ack', {
      category, platform: cur.platform, best, improved, rank, total, prevRank,
      next: nx ? { name: nx.name, wpm: nx.wpm } : null, name: cur.name
    });
  } catch (e) { console.warn('[db] falha ao salvar pontuação:', e.message); }
}

// Cache curto do top 25 (evita 4 consultas por clique no ranking); zera quando alguma pontuação melhora.
let lbCache = null;          // { at, promise } — linhas com player_id, só para marcar "me" aqui no servidor
const youCache = new Map();  // player_id -> { at, promise }
function invalidateLb() { lbCache = null; youCache.clear(); }
function cachedPromise(get, set, load) {
  const now = Date.now();
  const hit = get();
  if (hit && now - hit.at < LB_CACHE_MS) return hit.promise;
  const entry = { at: now, promise: load() };
  set(entry);
  // falha não fica em cache: a próxima chamada tenta o banco de novo
  entry.promise.catch(() => { if (get() === entry) set(null); });
  return entry.promise;
}
function loadBoards() {
  return cachedPromise(() => lbCache, (e) => { lbCache = e; }, async () => {
    const out = {};
    await Promise.all(Object.entries(BOARDS).map(async ([key, [plat, cat]]) => {
      const { rows } = await pool.query(
        'SELECT name, wpm, mode, player_id FROM scores WHERE platform = $1 AND category = $2 ORDER BY wpm DESC, ts ASC LIMIT $3',
        [plat, cat, LB_SIZE]);
      out[key] = rows;
    }));
    return out;
  });
}
// posição real do jogador em cada quadro, mesmo fora do top 25
function loadYou(pid) {
  if (youCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of youCache) if (now - v.at >= LB_CACHE_MS) youCache.delete(k);
  }
  return cachedPromise(() => youCache.get(pid), (e) => { if (e) youCache.set(pid, e); else youCache.delete(pid); }, async () => {
    const you = { desktop: null, mobile: null, desktopDuelel: null, mobileDuelel: null };
    const { rows } = await pool.query(
      `SELECT s.category, s.platform, s.wpm, COUNT(t.name_key) AS above
         FROM scores s
         LEFT JOIN scores t ON t.platform = s.platform AND t.category = s.category AND t.wpm > s.wpm
        WHERE s.player_id = $1
        GROUP BY s.name_key, s.category, s.platform, s.wpm`, [pid]);
    for (const r of rows) {
      const k = boardKeyOf(r.platform, r.category);
      if (!you[k] || r.wpm > you[k].wpm) you[k] = { rank: Number(r.above) + 1, wpm: r.wpm };
    }
    return you;
  });
}
const emptyBoards = () => ({ desktop: [], mobile: [], desktopDuelel: [], mobileDuelel: [] });
async function leaderboardFor(c) {
  // sem banco: o cliente mostra "ranking indisponível" (não "vazio")
  if (!pool) return Object.assign(emptyBoards(), { you: {}, error: 'offline' });
  try {
    const pid = c.playerId;
    const [boards, you] = await Promise.all([
      loadBoards(),
      pid ? loadYou(pid) : Promise.resolve({ desktop: null, mobile: null, desktopDuelel: null, mobileDuelel: null })
    ]);
    const out = { you };
    // o player_id nunca sai do servidor: a linha só ganha me:true
    for (const k of Object.keys(BOARDS)) {
      out[k] = boards[k].map((r) => {
        const row = { name: r.name, wpm: r.wpm, mode: r.mode };
        if (pid && r.player_id === pid) row.me = true;
        return row;
      });
    }
    return out;
  } catch (e) {
    console.warn('[db] falha ao ler ranking:', e.message);
    return Object.assign(emptyBoards(), { you: {}, error: 'db' });
  }
}

/* ---------------------------------------------------------------- palavras */
const WORDS = ("tempo pessoa ano forma mundo vida dia parte casa olho homem coisa terra trabalho momento noite hora palavra fim lugar exemplo verdade grupo problema luz nome ideia corpo cidade amigo escola livro filho pai ponto campo governo festa cor comida rua carro porta janela mesa cadeira papel caneta computador telefone internet jogo filme teatro arte natureza animal planta flor rio mar montanha sol lua estrela chuva vento fogo calor frio tarde semana futuro passado presente minuto segundo meio inverno sonho medo alegria amor paz dinheiro valor conta banco loja mercado comprar vender pagar ganhar correr andar falar ouvir pensar saber querer poder fazer dizer viver aprender ensinar ler escrever cantar jogar brincar trabalhar estudar viajar comer beber dormir acordar sorrir amar gostar precisar tentar conseguir terminar mudar ficar voltar chegar sair entrar subir descer abrir fechar pegar deixar encontrar esperar ajudar cuidar criar construir consertar limpar cozinhar plantar devagar forte claro simples bonito azul verde vermelho amarelo branco preto cinza rosa laranja roxo grande pequeno alto baixo largo estreito pesado leve novo velho bom mau feliz triste cansado fraco doce salgado quente livre certo errado justo caro barato limpo sujo tio tia primo sobrinho neto marido esposa namorado jovem adulto idoso vizinho chefe cliente cama espelho travesseiro cobertor toalha sabonete escova pente cozinha sala quarto banheiro jardim garagem varanda telhado parede teto escada leite ovo queijo carne peixe arroz fruta legume sal manteiga suco cerveja vinho sapato camisa vestido casaco anel colar bolsa mochila trem bicicleta barco moto hospital igreja parque praia floresta deserto ilha ponte estrada professor advogado engenheiro artista escritor ator cantor jornalista policial bombeiro cozinheiro motorista letra frase texto poema desenho pintura esporte futebol basquete segunda quarta quinta sexta domingo janeiro fevereiro abril maio junho julho agosto setembro outubro novembro dezembro").split(" ");

const WORDS_EN = ("time person year shape world life day hand part house eye water man thing history land work moment night country hour word end month place head example truth number group problem light name idea body city friend school book child father mother strength point field government party music color food street car door window table chair paper pen computer phone internet game movie theater art science nature animal plant flower tree river sea mountain sky sun moon star rain wind fire heat cold morning afternoon week future past present minute second start middle summer winter dream fear joy love peace health money price value account bank store market buy sell pay earn run walk talk hear think know want can make say live learn teach read write sing dance play study travel eat drink sleep wake smile like need try manage begin finish change stay return arrive leave enter climb descend open close take meet wait help care create build fix clean cook quick slow strong clear simple pretty blue green red yellow white black gray pink orange purple big small tall short wide narrow heavy new old good bad happy sad tired weak sweet salty hot free right wrong fair easy hard expensive cheap dirty brother sister grandfather grandmother uncle aunt cousin nephew grandson husband wife girlfriend baby kid teen adult elder neighbor boss customer bed sofa closet mirror pillow blanket towel soap brush comb kitchen room bathroom garden garage balcony roof wall floor ceiling stairs bread milk egg cheese meat fish rice beans fruit vegetable sugar salt oil butter coffee tea juice beer wine shoe shirt pants dress coat hat glasses watch ring necklace bag backpack plane train bus bicycle boat truck motorcycle hospital church square park beach forest desert island bridge tunnel road teacher doctor lawyer engineer artist writer musician actor singer journalist police firefighter driver letter sentence text poem drawing painting sport soccer basketball swimming monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december").split(" ");

function genWords(n, lang) {
  const pool = (lang === 'en') ? WORDS_EN : WORDS;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(Math.random() * pool.length) | 0]);
  return out.join(' ');
}

/* ---------------------------------------------------------------- HTTP */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.ogg': 'audio/ogg'
};
// /en serve o mesmo index.html com o <head> em inglês (prévias de link e buscadores leem o HTML sem rodar JS)
const SITE = 'https://duelel.cyberhat.com.br';
const EN_TITLE = 'Duelel — 1v1 online typing race';
const EN_SHARE = 'Duel another player in real time, invite a friend to a private room or practice solo.';
const EN_HEAD = [
  ['<html lang="pt-BR">', '<html lang="en">'],
  [/<title>[^<]*<\/title>/, `<title>${EN_TITLE}</title>`],
  [/(<meta name="description" content=")[^"]*/, '$1Real-time typing race. Duel another player online, invite a friend to a private room or practice solo and climb the WPM leaderboard.'],
  [`<link rel="canonical" href="${SITE}/">`, `<link rel="canonical" href="${SITE}/en">`],
  [`<meta property="og:url" content="${SITE}/">`, `<meta property="og:url" content="${SITE}/en">`],
  ['<meta property="og:locale" content="pt_BR">', '<meta property="og:locale" content="en_US">'],
  ['<meta property="og:locale:alternate" content="en_US">', '<meta property="og:locale:alternate" content="pt_BR">'],
  [/(<meta (?:property="og|name="twitter):title" content=")[^"]*/g, `$1${EN_TITLE}`],
  [/(<meta (?:property="og|name="twitter):description" content=")[^"]*/g, `$1${EN_SHARE}`],
  [/(<meta property="og:image:alt" content=")[^"]*/, '$1Duelel — real-time typing race']
];
const toEnglishHead = (html) => EN_HEAD.reduce((h, [from, to]) => h.replace(from, to), html);

// tipos de texto que valem gzip (imagens e mp3 já vêm comprimidos)
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);
// nosniff impede o navegador de "adivinhar" um tipo executável; o Referrer-Policy não vaza o caminho completo para outros sites
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
const NOT_FOUND_HTML = '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem"><h1>404</h1><p>Arquivo não encontrado no servidor.</p></body>';
const MAX_CACHED_BYTES = 2 * 1024 * 1024;
// Arquivos em memória com ETag (e gzip pronto), revalidados pelo mtime: um 304 economiza os 80 KB do index.html.
const fileCache = new Map(); // caminho (+ '#en' para a variante /en) -> { mtimeMs, size, body, gz, etag }

async function loadFile(filePath, isEn) {
  const st = await fs.promises.stat(filePath);
  if (!st.isFile()) return null;
  const key = isEn ? filePath + '#en' : filePath;
  const hit = fileCache.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  let body = await fs.promises.readFile(filePath);
  if (isEn) body = Buffer.from(toEnglishHead(body.toString('utf8')), 'utf8');
  const etag = 'W/"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 27) + '"';
  const entry = { mtimeMs: st.mtimeMs, size: st.size, body, gz: null, etag };
  if (st.size <= MAX_CACHED_BYTES) fileCache.set(key, entry);
  return entry;
}
function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  const weak = (t) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || weak(t) === weak(etag));
}
const acceptsGzip = (h) => typeof h === 'string' && /\bgzip\b/i.test(h) && !/\bgzip\s*;\s*q\s*=\s*0(?:\.0*)?\s*(?:,|$)/i.test(h);
function sendPlain(res, status, body, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, BASE_HEADERS, extra));
  res.end(body);
}

async function handleHttp(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendPlain(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
  const rawPath = String(req.url || '/').split('?')[0];
  if (rawPath === '/health') return sendPlain(res, 200, 'ok');
  // URL malformada (/%) ou com byte nulo (/%00) é erro do cliente, não motivo para derrubar o processo
  let url;
  try { url = decodeURIComponent(rawPath); } catch (e) { return sendPlain(res, 400, 'bad request'); }
  if (url.includes('\0')) return sendPlain(res, 400, 'bad request');
  const isEn = (url === '/en' || url === '/en/');
  if (url === '/' || isEn) url = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(url).replace(/^(\.\.[\/\\])+/, ''));
  // exige o separador: "/public-velho/x" não pode passar por estar "dentro" de "/public"
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendPlain(res, 403, 'forbidden');
  let f = null;
  try { f = await loadFile(filePath, isEn); } catch (e) { f = null; }
  if (!f) {
    res.writeHead(404, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, BASE_HEADERS));
    return res.end(NOT_FOUND_HTML);
  }
  const ext = path.extname(filePath).toLowerCase();
  const revalidate = (ext === '.html' || ext === '.js' || ext === '.webmanifest');
  const headers = Object.assign({}, BASE_HEADERS, {
    'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=86400',
    ETag: f.etag
  });
  const compressible = COMPRESSIBLE.has(ext);
  if (compressible) headers.Vary = 'Accept-Encoding';
  if (etagMatches(req.headers['if-none-match'], f.etag)) { res.writeHead(304, headers); return res.end(); }
  headers['Content-Type'] = MIME[ext] || 'application/octet-stream';
  let body = f.body;
  if (compressible && body.length >= 512 && acceptsGzip(req.headers['accept-encoding'])) {
    if (!f.gz) f.gz = zlib.gzipSync(f.body, { level: 9 });
    body = f.gz;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  // nenhuma exceção do handler pode escapar: uma requisição ruim não derruba todas as corridas
  handleHttp(req, res).catch((e) => {
    console.warn('[http] erro ao atender', req.url, '-', e && e.message);
    if (res.headersSent) res.destroy();
    else sendPlain(res, 500, 'internal error');
  });
});

/* ---------------------------------------------------------------- WebSocket */
// mensagens legítimas têm poucos KB (o maior é o 'finished' com keyDeltas); 64 KB dá folga sem abrir espaço para estourar a memória
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

const queues = new Map();  // bucket "plataforma|idioma" -> [ws]
const rooms = new Map();   // código -> { host, guest }

const rid = () => crypto.randomUUID ? crypto.randomUUID() : 'r' + Math.random().toString(36).slice(2);
const roomCode = () => Array.from({ length: 5 }, () =>
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('');

function send(ws, type, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ type }, payload || {})));
}
function bucketOf(c) { return `${c.platform}|${c.lang || 'pt'}`; }
// número vindo do cliente sem nunca chamar toString/valueOf de objeto (um {valueOf:1} lança TypeError)
const num = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN));
const intIn = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : def);
const minMsOf = (text) => Math.ceil((text.length / 5) / MAX_PLAUSIBLE_WPM * 60000);

/* Limite de mensagens por conexão (token bucket). O cliente legítimo manda 'progress' a cada ~90 ms
   e um tick a cada 400 ms (≈11/s no pior caso), então os tetos ficam bem acima disso. Mensagem
   excedente é ignorada; só um flood que não para (strikes acumulados) fecha a conexão. */
const RATE = {
  _all:            { cap: 60, perSec: 30 },
  progress:        { cap: 30, perSec: 20 },
  ready:           { cap: 10, perSec: 2 },
  hello:           { cap: 5,  perSec: 1 },
  rematch:         { cap: 5,  perSec: 0.5 },
  quick_join:      { cap: 5,  perSec: 0.5 },
  room_create:     { cap: 5,  perSec: 1 / 3 },
  room_join:       { cap: 10, perSec: 1 / 6 },  // ~10/min: força bruta no código da sala fica inviável
  score_submit:    { cap: 3,  perSec: 1 / 3 },
  leaderboard_get: { cap: 4,  perSec: 0.5 }
};
const STRIKE_DECAY_PER_SEC = 20;
const FLOOD_CLOSE_STRIKES = 400;
function takeToken(c, key, now) {
  const lim = Object.prototype.hasOwnProperty.call(RATE, key) ? RATE[key] : null;
  if (!lim) return true;
  let b = c.buckets.get(key);
  if (!b) { b = { tokens: lim.cap, at: now }; c.buckets.set(key, b); }
  b.tokens = Math.min(lim.cap, b.tokens + (now - b.at) / 1000 * lim.perSec);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
function strike(ws, now) {
  const c = ws.c;
  c.strikes = Math.max(0, c.strikes - (now - c.strikeAt) / 1000 * STRIKE_DECAY_PER_SEC) + 1;
  c.strikeAt = now;
  if (c.strikes > FLOOD_CLOSE_STRIKES) ws.close(1008, 'flood');
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.c = { id: rid(), playerId: null, name: '—', platform: 'desktop', lang: 'pt',
           state: 'idle', race: null, opp: null, roomCode: null, bucket: null, queuedAt: 0,
           lastIdx: 0, lastWpm: 0, lastAcc: 100,
           rematchWith: null, rematchWant: false, rematchCode: null, rematchLang: null,
           buckets: new Map(), strikes: 0, strikeAt: 0 };
  send(ws, 'welcome', { id: ws.c.id });
  send(ws, 'presence', presenceSnapshot());
  presenceChanged();

  ws.on('message', (raw, isBinary) => {
    if (ws.readyState !== 1) return;
    const now = Date.now();
    if (!takeToken(ws.c, '_all', now)) return strike(ws, now);
    if (isBinary) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    // JSON válido mas sem formato de mensagem ('null', '[]', '123') é ignorado
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return;
    if (!takeToken(ws.c, m.type, now)) return strike(ws, now);
    handle(ws, m)
      .catch((e) => console.warn('[ws] erro ao tratar', m.type, '-', e && e.message))
      .finally(presenceChanged);
  });
  ws.on('close', () => { cleanup(ws); presenceChanged(); });
  ws.on('error', () => {});
});

function applyProfile(c, m) {
  if (typeof m.name === 'string') c.name = cleanName(m.name) || '—';
  if (m.platform === 'mobile' || m.platform === 'desktop') c.platform = m.platform;
  if (m.lang === 'pt' || m.lang === 'en') c.lang = m.lang;
  if (typeof m.playerId === 'string' && m.playerId) c.playerId = m.playerId.slice(0, 64);
}
// corrida ainda valendo para esta conexão (protege contra mensagens de quem já saiu dela)
function activeRace(c) {
  const r = c.race;
  return (r && !r.over && c.opp && c.opp.c.race === r) ? r : null;
}
const busy = (c) => !!activeRace(c);

async function handle(ws, m) {
  const c = ws.c;
  switch (m.type) {
    case 'hello':
      applyProfile(c, m);
      break;

    case 'quick_join': {
      if (busy(c)) break; // já está numa partida: ignora em vez de deixar o estado pela metade
      applyProfile(c, m);
      clearRematch(ws);
      if (c.roomCode) closeRoom(c.roomCode, ws);
      leaveQueue(ws);
      enqueue(ws);
      break;
    }

    case 'quick_cancel':
      leaveQueue(ws);
      if (c.state === 'queue') c.state = 'idle';
      break;

    case 'room_create': {
      if (busy(c)) break;
      applyProfile(c, m);
      // uma sala por conexão: a anterior é fechada (sem isso, repetir room_create vaza salas e deixa links-fantasma)
      leaveQueue(ws);
      clearRematch(ws);
      if (c.roomCode) closeRoom(c.roomCode, ws);
      let code; do { code = roomCode(); } while (rooms.has(code));
      rooms.set(code, { host: ws, guest: null });
      c.state = 'room'; c.roomCode = code;
      send(ws, 'room_created', { code });
      break;
    }

    case 'room_join': {
      if (busy(c)) break;
      applyProfile(c, m);
      const code = (typeof m.code === 'string') ? m.code.toUpperCase().slice(0, 5) : '';
      const r = rooms.get(code);
      if (!r) { send(ws, 'error', { code: 'room_not_found' }); break; }
      if (r.guest || r.host === ws) { send(ws, 'error', { code: 'room_full' }); break; }
      const host = r.host;
      // o host precisa estar de fato esperando NESTA sala; senão o link antigo o puxaria do meio de outra corrida
      if (host.readyState !== 1 || host.c.state !== 'room' || host.c.roomCode !== code) {
        rooms.delete(code);
        send(ws, 'error', { code: 'room_not_found' });
        break;
      }
      leaveQueue(ws);
      clearRematch(ws);
      if (c.roomCode) closeRoom(c.roomCode, ws);
      r.guest = ws;
      // sala é convite direto entre amigos: o texto sai no idioma de quem criou a sala
      startRace(host, ws, code, host.c.lang);
      break;
    }

    case 'ready': {
      const race = activeRace(c);
      if (!race || race.startAt) break;   // sem corrida pendente, ou já começou
      const want = !!m.ready;
      if (ws === race.a) race.readyA = want;
      else race.readyB = want;
      send(c.opp, 'opp_ready', { ready: want });
      if (race.readyA && race.readyB) beginRace(race);
      break;
    }

    case 'progress': {
      const race = activeRace(c);
      const now = Date.now();
      // só vale com a corrida já largada no relógio do servidor, e congela depois do 'finished'
      if (!race || !race.startAt || now < race.startAt || race.fin.has(ws)) break;
      const raw = num(m.idx);
      if (!Number.isFinite(raw)) break;
      // teto de plausibilidade pelo tempo (com folga para o skew dos relógios): aplica clamp, não rejeita
      const cap = Math.min(race.text.length,
        Math.ceil((now - race.startAt + PROGRESS_SLACK_MS) / 60000 * MAX_PLAUSIBLE_WPM * 5));
      c.lastIdx = intIn(raw, 0, cap, 0);
      c.lastWpm = intIn(num(m.wpm), 0, 300, 0);
      if (m.acc != null) c.lastAcc = intIn(num(m.acc), 0, 100, c.lastAcc);
      send(c.opp, 'opp_progress', { idx: c.lastIdx, wpm: c.lastWpm });
      break;
    }

    case 'finished': {
      const race = activeRace(c);
      const now = Date.now();
      if (!race || !race.startAt || now < race.startAt || race.fin.has(ws)) break;
      // o relógio do servidor manda: ninguém termina antes do mínimo humano (220 PPM) nem sem ter
      // chegado ao fim do texto (o cliente manda 'progress' com o idx final logo antes)
      const serverElapsed = now - race.startAt;
      if (serverElapsed < race.minMs || c.lastIdx < race.text.length) break;
      // o tempo do cliente só vale dentro de uma janela de latência abaixo do tempo do servidor
      let ft = num(m.finishTime);
      if (!Number.isFinite(ft) || ft <= 0) ft = serverElapsed;
      ft = Math.min(serverElapsed, Math.max(serverElapsed - FINISH_TOLERANCE_MS, ft));
      const finishTime = Math.round(Math.max(race.minMs, ft));
      const acc = (m.acc == null) ? 100 : intIn(num(m.acc), 0, 100, 100);
      const botLike = looksLikeBot(Array.isArray(m.keyDeltas) ? m.keyDeltas.slice(0, 600) : null, acc);
      race.fin.set(ws, { finishTime, acc, botLike, at: now });
      c.lastAcc = acc;
      if (race.fin.size >= 2) decide(race, 'finish');
      else if (!race.graceTimer) race.graceTimer = setTimeout(() => graceOver(race), GRACE_MS);
      break;
    }

    case 'score_submit': {
      if (!SOLO_MODES.has(m.mode)) break; // whitelist: 'duelo' e textos arbitrários nunca entram por aqui
      applyProfile(c, m);
      const wpm = soloWpm(m);
      if (wpm != null) await submitScore(ws, m.mode, wpm);
      break;
    }

    case 'leaderboard_get':
      send(ws, 'leaderboard', await leaderboardFor(c));
      break;

    case 'rematch': {
      if (busy(c)) break;
      const other = c.rematchWith;
      if (!other || other.readyState !== 1 || other.c.rematchWith !== ws) {
        // oponente saiu — não dá pra revanche
        c.rematchWith = null; c.rematchWant = false;
        send(ws, 'opp_left', {});
        break;
      }
      c.rematchWant = true;
      if (other.c.rematchWant) {
        // os dois toparam → nova corrida no mesmo par, no idioma da corrida original
        const code = c.rematchCode || other.c.rematchCode || null;
        const lang = c.rematchLang || other.c.rematchLang || c.lang;
        resetRematch(c); resetRematch(other.c);
        startRace(other, ws, code, lang);
      } else {
        send(ws, 'waiting', { mode: 'rematch' });
        send(other, 'rematch_offer', {});
      }
      break;
    }

    case 'leave':
      abandon(ws);
      leaveQueue(ws);
      clearRematch(ws); // desfaz revanche pendente, avisando o par
      if (c.roomCode) closeRoom(c.roomCode, ws);
      c.state = 'idle';
      break;
  }
}

// Pontuação do treino/bot: recalcula o PPM a partir de chars/ms e recusa o que não bate.
function soloWpm(m) {
  const sent = num(m.wpm);
  const chars = num(m.chars), ms = num(m.ms);
  if (!Number.isFinite(chars) || !Number.isFinite(ms)) {
    // cliente antigo (em cache) não manda chars/ms: aceita o PPM só com o teto, como antes
    return Number.isFinite(sent) ? sent : null;
  }
  if (ms < 3000 || chars <= 0) return null;
  const calc = wpmCalc(chars, ms);
  // tolerância: 15% ou 10 ppm, o que for maior (arredondamentos do cliente não derrubam o score)
  if (Number.isFinite(sent) && Math.abs(calc - sent) > Math.max(10, calc * 0.15)) return null;
  const acc = (m.acc == null) ? 100 : intIn(num(m.acc), 0, 100, 100);
  if (looksLikeBot(Array.isArray(m.keyDeltas) ? m.keyDeltas.slice(0, 600) : null, acc)) return null;
  return calc;
}

/* ---------------------------------------------------------------- fila, salas e revanche */
function enqueue(ws) {
  const c = ws.c;
  const bucket = bucketOf(c);
  const q = queues.get(bucket) || [];
  // procura um oponente compatível já esperando (mesma plataforma e idioma)
  let opp = null;
  while (q.length) {
    const cand = q.shift();
    if (cand !== ws && cand.readyState === 1 && cand.c.state === 'queue' && cand.c.bucket === bucket) { opp = cand; break; }
  }
  queues.set(bucket, q);
  if (opp) { opp.c.bucket = null; startRace(opp, ws, null, c.lang); return; }
  q.push(ws);
  c.state = 'queue'; c.bucket = bucket; c.queuedAt = Date.now();
  send(ws, 'waiting', { mode: 'quick' });
}
function leaveQueue(ws) {
  const b = ws.c.bucket; if (!b) return;
  const q = queues.get(b);
  if (q) { const i = q.indexOf(ws); if (i >= 0) q.splice(i, 1); }
  ws.c.bucket = null;
}
function closeRoom(code, ws) {
  const r = rooms.get(code);
  if (r && (r.host === ws || r.guest === ws)) rooms.delete(code);
  if (ws.c.roomCode === code) ws.c.roomCode = null;
}
// apaga a sala da corrida só se ela ainda for deste par (o código pode ter sido reaproveitado)
function closeRaceRoom(race) {
  if (!race.code) return;
  const r = rooms.get(race.code);
  if (r && (r.host === race.a || r.host === race.b)) rooms.delete(race.code);
}
function reopenRoom(ws, code) {
  if (!code || rooms.has(code)) { do { code = roomCode(); } while (rooms.has(code)); }
  rooms.set(code, { host: ws, guest: null });
  ws.c.state = 'room'; ws.c.roomCode = code;
  send(ws, 'requeued', { mode: 'room', code });
}
function resetRematch(c) {
  c.rematchWith = null; c.rematchWant = false; c.rematchCode = null; c.rematchLang = null;
}
// sai da tela de resultado (fila, sala, leave, aba fechada): o par, se esperava a revanche, recebe opp_left
function clearRematch(ws) {
  const p = ws.c.rematchWith;
  if (p && p.c.rematchWith === ws) {
    const wasWaiting = p.c.rematchWant;
    resetRematch(p.c);
    if (wasWaiting) send(p, 'opp_left', {});
  }
  resetRematch(ws.c);
}

// Fila entre plataformas: depois de CROSS_PLATFORM_AFTER_MS esperando, teclado e celular do MESMO
// idioma se enfrentam (o texto depende do idioma, então ele nunca cruza).
function oldestWaiting(bucket, now) {
  const q = queues.get(bucket);
  if (!q) return null;
  for (const ws of q) {
    if (ws.readyState === 1 && ws.c.state === 'queue' && now - ws.c.queuedAt >= CROSS_PLATFORM_AFTER_MS) return ws;
  }
  return null;
}
function crossSweep() {
  const now = Date.now();
  for (const lang of ['pt', 'en']) {
    for (;;) {
      const d = oldestWaiting(`desktop|${lang}`, now), mo = oldestWaiting(`mobile|${lang}`, now);
      if (!d || !mo) break;
      leaveQueue(d); leaveQueue(mo);
      // quem espera há mais tempo fica como "a" (desempate a favor dele)
      if (d.c.queuedAt <= mo.c.queuedAt) startRace(d, mo, null, lang);
      else startRace(mo, d, null, lang);
    }
  }
}
const sweepTimer = CROSS_PLATFORM_AFTER_MS > 0
  ? setInterval(() => { crossSweep(); presenceChanged(); }, Math.max(100, Math.min(1000, CROSS_PLATFORM_AFTER_MS / 4)))
  : null;

/* ---------------------------------------------------------------- corrida */
function startRace(a, b, code, lang) {
  const text = genWords(28, lang);
  const race = {
    id: rid(), a, b, text, lang, code: code || null, minMs: minMsOf(text),
    cross: a.c.platform !== b.c.platform,
    startAt: null, fin: new Map(), over: false, readyA: false, readyB: false,
    graceTimer: null, readyTimer: null, maxTimer: null
  };
  for (const [x, y] of [[a, b], [b, a]]) {
    // fecha a sala antiga e sai da fila: ninguém fica em dois lugares ao mesmo tempo
    if (x.c.roomCode && x.c.roomCode !== race.code) closeRoom(x.c.roomCode, x);
    leaveQueue(x);
    resetRematch(x.c);
    Object.assign(x.c, { state: 'ready', race, opp: y, roomCode: race.code,
                         lastIdx: 0, lastWpm: 0, lastAcc: 100 }); // nada herdado da corrida anterior
  }
  race.readyTimer = setTimeout(() => readyTimeout(race), READY_TIMEOUT_MS);
  for (const [x, y] of [[a, b], [b, a]]) {
    send(x, 'match_found', { room: race.code, opp: { name: y.c.name, platform: y.c.platform },
                             cross: race.cross, lang, readyTimeoutMs: READY_TIMEOUT_MS });
  }
}
function raceLimitMs(race) {
  return RACE_MAX_OVERRIDE != null ? RACE_MAX_OVERRIDE : Math.max(RACE_MAX_MIN_MS, race.minMs * 4);
}
function beginRace(race) {
  clearTimeout(race.readyTimer); race.readyTimer = null;
  race.a.c.state = 'racing'; race.b.c.state = 'racing';
  const now = Date.now();
  race.startAt = now + START_DELAY_MS;
  send(race.a, 'race_start', { text: race.text, startAt: race.startAt, serverNow: now });
  send(race.b, 'race_start', { text: race.text, startAt: race.startAt, serverNow: now });
  // ninguém terminou a tempo (AFK, aba esquecida): decide por quem foi mais longe
  race.maxTimer = setTimeout(() => { decide(race, 'timeout'); presenceChanged(); }, START_DELAY_MS + raceLimitMs(race));
}
function stopTimers(race) {
  race.over = true;
  race.endAt = Date.now();
  for (const k of ['graceTimer', 'readyTimer', 'maxTimer']) { if (race[k]) clearTimeout(race[k]); race[k] = null; }
}

// Ninguém confirmou o "Prontos?" a tempo: quem confirmou volta para a fila (ou reabre a sala),
// quem não confirmou leva error 'afk' e volta para a home.
function readyTimeout(race) {
  if (race.over || race.startAt) return;
  stopTimers(race);
  closeRaceRoom(race);
  for (const [x, ready] of [[race.a, race.readyA], [race.b, race.readyB]]) {
    if (x.c.race !== race) continue;
    Object.assign(x.c, { race: null, opp: null, state: 'idle', roomCode: null });
    if (x.readyState !== 1) continue;
    if (!ready) send(x, 'error', { code: 'afk' });
    else if (race.code) reopenRoom(x, race.code);
    else { send(x, 'requeued', { mode: 'quick' }); enqueue(x); }
  }
  presenceChanged();
}

function graceOver(race) {
  if (race.over) return;
  race.graceTimer = null;
  // se o único que terminou tem digitação de robô, não leva a vitória automática: espera o outro (ou o limite)
  const [only] = race.fin.values();
  if (race.fin.size === 1 && only.botLike) return;
  decide(race, 'finish');
  presenceChanged();
}

function decide(race, reason) {
  if (race.over) return;
  stopTimers(race);
  const { a, b } = race;
  const fa = race.fin.get(a), fb = race.fin.get(b);
  let winner = null;
  if (fa && fb) {
    // se só um dos dois tem digitação com cara de bot, o outro vence — não importa quem "terminou primeiro"
    if (fa.botLike && !fb.botLike) winner = b;
    else if (fb.botLike && !fa.botLike) winner = a;
    // tempos iguais (ex.: os dois no piso de 220 PPM) desempatam por quem chegou primeiro ao servidor
    else if (fa.finishTime !== fb.finishTime) winner = (fa.finishTime < fb.finishTime) ? a : b;
    else winner = (fa.at <= fb.at) ? a : b;
  } else if (fa || fb) {
    const fin = fa ? a : b;
    winner = (fa || fb).botLike ? (fin === a ? b : a) : fin;
  } else {
    // limite de tempo sem ninguém terminar: vence quem foi mais longe; empate = ninguém vence
    const ia = a.c.lastIdx || 0, ib = b.c.lastIdx || 0;
    winner = ia > ib ? a : ib > ia ? b : null;
  }
  report(race, winner, reason);
}

// detecta digitação robótica: humanos variam o intervalo entre teclas, um script simples não.
// exige uma amostra mínima (senão qualquer coincidência vira falso positivo) e olha o
// coeficiente de variação (desvio padrão / média) — bem baixo = ritmo mecânico demais.
function looksLikeBot(deltas, acc) {
  if (!Array.isArray(deltas) || deltas.length < 15) return false; // amostra pequena demais pra confiar
  if (acc == null || acc < 98) return false;                       // erro real é sinal de humano
  const clean = deltas.filter((d) => typeof d === 'number' && d >= 0 && d < 3000);
  if (clean.length < 15) return false;
  const mean = clean.reduce((s, d) => s + d, 0) / clean.length;
  if (mean <= 0) return false;
  const variance = clean.reduce((s, d) => s + (d - mean) ** 2, 0) / clean.length;
  const cv = Math.sqrt(variance) / mean;   // coeficiente de variação
  return cv < 0.15;                        // humano típico fica bem acima disso
}
function wpmCalc(chars, ms) {
  const min = ms / 60000;
  return min <= 0 ? 0 : Math.max(0, Math.round((chars / 5) / min));
}
function statOf(race, ws) {
  const f = race.fin.get(ws);
  // quem terminou: texto inteiro no tempo dele. quem não terminou: caracteres corretos
  // dividido pelo tempo REAL até o fim da corrida (assim ficar parado derruba o PPM).
  const chars = f ? race.text.length : (ws.c.lastIdx || 0);
  const elapsed = f ? f.finishTime : Math.max(1, (race.endAt || Date.now()) - race.startAt);
  return { name: ws.c.name,
           wpm: race.startAt ? wpmCalc(chars, elapsed) : 0,
           acc: f ? f.acc : (ws.c.lastAcc == null ? 100 : ws.c.lastAcc),
           finishTime: f ? f.finishTime : null, finished: !!f, botLike: !!(f && f.botLike),
           chars, total: race.text.length };
}
function report(race, winner, reason) {
  const { a, b } = race;
  const sa = statOf(race, a), sb = statOf(race, b);
  send(a, 'race_over', { youWon: winner === a, you: sa, opp: sb, reason });
  send(b, 'race_over', { youWon: winner === b, you: sb, opp: sa, reason });
  closeRaceRoom(race); // o link antigo já não serve; a revanche usa a conexão direta
  for (const [x, y] of [[a, b], [b, a]]) {
    Object.assign(x.c, { state: 'idle', race: null, opp: null, roomCode: null });
    // guarda o par para a revanche (sala E partida rápida), no idioma desta corrida
    if (x.readyState === 1 && y.readyState === 1) {
      Object.assign(x.c, { rematchWith: y, rematchWant: false, rematchCode: race.code, rematchLang: race.lang });
    } else resetRematch(x.c);
  }
  // só grava quem digitou algo e não tem cara de bot
  if (!sa.botLike && sa.chars > 0) submitScore(a, 'duelo', sa.wpm);
  if (!sb.botLike && sb.chars > 0) submitScore(b, 'duelo', sb.wpm);
}

/* saída no meio da corrida: o oponente ganha por W.O. */
function abandon(ws) {
  const race = ws.c.race;
  ws.c.race = null; ws.c.opp = null; // quem saiu não fala mais com o ex-oponente
  if (!race || race.over) return;
  // quem já tinha terminado e caiu na janela de graça não perde por W.O.: decide normalmente
  if (race.fin.has(ws)) { decide(race, 'finish'); return; }
  stopTimers(race);
  closeRaceRoom(race);
  const opp = (race.a === ws) ? race.b : race.a;
  if (opp.readyState === 1 && opp.c.race === race) {
    if (race.startAt && race.endAt >= race.startAt) {
      const so = statOf(race, opp);
      if (!so.botLike && so.chars > 0) submitScore(opp, 'duelo', so.wpm);
    }
    send(opp, 'opp_left', {});
    Object.assign(opp.c, { state: 'idle', race: null, opp: null, roomCode: null });
    resetRematch(opp.c);
  }
}

function cleanup(ws) {
  abandon(ws);
  leaveQueue(ws);
  if (ws.c.roomCode) closeRoom(ws.c.roomCode, ws);
  clearRematch(ws); // se havia um par aguardando revanche, avisa e desfaz
}

/* ---------------------------------------------------------------- presença */
// {online, racing, queue}: queue é um mapa "plataforma|idioma" -> pessoas na fila (o cliente lê o próprio balde)
function presenceSnapshot() {
  let online = 0, racing = 0;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.c) continue;
    online++;
    if (ws.c.state === 'ready' || ws.c.state === 'racing') racing++;
  }
  const queue = { 'desktop|pt': 0, 'desktop|en': 0, 'mobile|pt': 0, 'mobile|en': 0 };
  for (const [b, q] of queues) {
    queue[b] = q.filter((x) => x.readyState === 1 && x.c.state === 'queue').length;
  }
  return { online, racing, queue };
}
// broadcast com throttle: no máximo 1 a cada PRESENCE_THROTTLE_MS, e só quando algo mudou
let presenceTimer = null, presenceAt = 0, presenceLast = '';
function presenceChanged() {
  if (presenceTimer || shuttingDown) return;
  presenceTimer = setTimeout(flushPresence, Math.max(0, presenceAt + PRESENCE_THROTTLE_MS - Date.now()));
}
function flushPresence() {
  presenceTimer = null;
  const json = JSON.stringify(Object.assign({ type: 'presence' }, presenceSnapshot()));
  if (json === presenceLast) return;
  presenceLast = json; presenceAt = Date.now();
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(json);
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

// rede de segurança: só registra (as entradas já são validadas; isso não deve acontecer)
process.on('unhandledRejection', (e) => console.error('[processo] promessa rejeitada sem tratamento:', e));

// Deploy/restart no Render manda SIGTERM: avisa os clientes (1001) e fecha banco e HTTP antes de sair.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[duelel] ${signal} recebido — encerrando`);
  clearInterval(ping);
  if (sweepTimer) clearInterval(sweepTimer);
  if (presenceTimer) clearTimeout(presenceTimer);
  setTimeout(() => process.exit(0), 5000).unref(); // não fica pendurado se algo travar
  for (const ws of wss.clients) { try { ws.close(1001, 'server_restart'); } catch (e) {} }
  wss.close();
  server.close(() => {
    Promise.resolve(pool && pool.end()).catch(() => {}).then(() => process.exit(0));
  });
  if (server.closeIdleConnections) server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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
    console.warn('[AVISO] index.html NÃO encontrado em nenhuma pasta "public". Veja a lista acima: o arquivo pode estar noutra pasta ou com outro nome (atenção a maiúsculas — o Linux diferencia Index.html de index.html).');
  }
});
