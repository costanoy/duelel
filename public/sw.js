/* Service worker do Duelel.
   Estratégia à prova de "atualização que não aparece":
   - HTML (abrir o app): SEMPRE rede primeiro. O index.html nunca fica preso no cache;
     ele só é usado do cache quando você está offline.
   - Ícones/manifesto: cache primeiro (mudam raramente), atualizando por baixo.
   - WebSocket não passa pelo service worker, então o modo online não é afetado.
   Sempre que mudar a estratégia deste arquivo, incremente o número de CACHE. */
const CACHE = 'duelel-v2';
const SHELL = [
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

  // HTML/navegações: rede primeiro; cache só como reserva offline.
  if (req.mode === 'navigate' || (url.origin === self.location.origin && url.pathname.endsWith('.html'))) {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put('/index.html', res.clone())).catch(() => {}); return res; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // fontes externas o navegador resolve

  // Estáticos (ícones, manifesto): cache primeiro, atualizando por baixo.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
