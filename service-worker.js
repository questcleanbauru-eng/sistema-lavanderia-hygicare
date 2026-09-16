const CACHE = 'lavanderia-cache-v434';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/auth.js',
  '/db.js',
  '/config.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  // Sem self.skipWaiting() — novo SW espera, banner decide a hora de ativar
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  if (url.includes('script.google.com')) return;
  if (url.includes('googleusercontent.com')) return;
  if (url.includes('googleapis.com')) return;
  if (url.includes('drive.google.com')) return;
  if (url.includes('/api/')) return;

  // Network-first para navegação (HTML) — garante que o app sempre carrega a versão mais nova
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            // clona ANTES de devolver res ao browser (senão o body já foi lido)
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate para assets (JS, CSS, imagens)
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.status === 200) cache.put(e.request, res.clone());
        return res;
      }).catch(() => null);
      return cached || fetchPromise || caches.match('/index.html');
    })
  );
});

// ============================================================
// NOTIFICAÇÕES PUSH — chegam mesmo com o app fechado
// ============================================================
// O payload é um JSON { title, body, data } mandado por /api/send-push.js.
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; }
  catch (err) { payload = { title: 'Hygicare Lavanderia', body: e.data ? e.data.text() : '' }; }

  const title = payload.title || 'Hygicare Lavanderia';
  const data  = payload.data || {};
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data,
    tag: data.tag || undefined,
    renotify: !!data.tag,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Ao tocar na notificação: foca uma aba já aberta (e manda os dados pra ela
// navegar até a tela certa) ou abre uma nova já apontando pra lá.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};

  const qs = new URLSearchParams();
  if (data.screen)   qs.set('pushScreen', data.screen);
  if (data.clientId) qs.set('pushClient', data.clientId);
  if (data.visitId)  qs.set('pushVisit', data.visitId);
  const targetUrl = '/' + (qs.toString() ? ('?' + qs.toString()) : '');

  e.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if ('focus' in c) {
        c.postMessage({ type: 'PUSH_NAVIGATE', data });
        return c.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
