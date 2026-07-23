/* Service worker do Duelel.
   Estratégia:
   - Navegações (abrir o app): network-first — pega a versão mais nova quando online,
     e cai pro cache quando offline (assim Sozinho e 30 segundos funcionam sem internet).
   - Ícones/manifesto e outros GET do próprio site: cache-first, atualizando em segundo plano.
   - WebSocket não passa pelo service worker, então o modo online não é afetado.
   Ao publicar uma nova versão, troque o número em CACHE para forçar a atualização. */
const CACHE = 'duelel-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navegações: rede primeiro, cache como reserva (offline)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { cachePut(req, res.clone()); return res; })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Só cuidamos de GET do mesmo domínio (fontes externas o navegador resolve)
  if (url.origin !== self.location.origin) return;

  // Estáticos do próprio site: cache primeiro, atualizando por baixo
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => { cachePut(req, res.clone()); return res; }).catch(() => cached);
      return cached || net;
    })
  );
});

function cachePut(req, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
}
