const CACHE = 'lavanderia-cache-v254';
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
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
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
  // cdn.jsdelivr.net é cacheado normalmente (stale-while-revalidate)
  // para que Chart.js funcione offline após o primeiro carregamento

  // Stale-while-revalidate: responde do cache imediatamente e atualiza em background
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
