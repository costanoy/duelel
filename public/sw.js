/* Service worker do Duelel.
   - Abrir o app (navegação para / ou /en): a rede disputa contra um prazo de 3 s. Se a rede
     responder antes, vale a versão nova; se não (servidor gratuito acordando, rede ruim, offline),
     abre o index.html guardado e a resposta da rede, quando chegar, atualiza o cache em segundo plano.
     Assim o app nunca fica em tela branca esperando o servidor acordar, e a versão nova aparece
     no máximo uma visita depois.
   - Outras páginas (privacidade): rede primeiro, cache só offline.
   - Estáticos (ícones, manifesto, sons): cache primeiro, atualizando por baixo.
   - WebSocket não passa pelo service worker, então o modo online não é afetado.
   Sempre que mudar a estratégia deste arquivo, incremente o número de CACHE. */
const CACHE = 'duelel-v4';
const NAV_TIMEOUT_MS = 3000;
const PRECACHE = [
  '/',
  '/en',
  '/manifest.webmanifest',
  '/icons/icon-192.png?v=2',
  '/icons/icon-512.png?v=2',
  '/icons/apple-touch-icon.png?v=2',
  '/icons/favicon.png?v=2',
  '/icons/logo-mark.png',
  '/sounds/count.mp3',
  '/sounds/go.mp3',
  '/sounds/match.mp3',
  '/sounds/win.mp3'
];

self.addEventListener('install', (e) => {
  // um item que falhar não impede a instalação (os outros continuam valendo offline)
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// rotas do app guardadas no cache, uma por idioma; outras páginas não sobrescrevem o app
function appKey(pathname) {
  if (/^\/en\/?$/.test(pathname)) return '/en';
  if (pathname === '/' || pathname === '/index.html') return '/';
  return null;
}
const cacheable = (res) => res && res.ok && res.type === 'basic';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('.html'))) {
    const key = sameOrigin ? appKey(url.pathname) : null;
    const net = fetch(req);
    if (!key) {
      e.respondWith(net.catch(() => caches.match(req).then((r) => r || Response.error())));
      return;
    }
    // grava a cópia assim que a resposta chega (clone síncrono, antes de alguém ler o corpo)
    e.waitUntil(net.then((res) => {
      if (!cacheable(res)) return;
      const copy = res.clone();
      return caches.open(CACHE).then((c) => c.put(key, copy));
    }).catch(() => {}));
    e.respondWith((async () => {
      const cached = (await caches.match(key)) || (await caches.match('/'));
      if (!cached) return net.catch(() => Response.error());
      const res = await Promise.race([
        net.catch(() => null),
        new Promise((r) => setTimeout(() => r(null), NAV_TIMEOUT_MS))
      ]);
      return res && res.ok ? res : cached;
    })());
    return;
  }

  if (!sameOrigin) return; // fontes externas o navegador resolve

  // Estáticos: cache primeiro, atualizando por baixo.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
      if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
      return net.catch(() => Response.error());
    })
  );
});
