const CACHE = 'lavanderia-cache-v100';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/auth.js',
  '/db.js',
  '/config.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
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

  // Deixa o browser lidar diretamente com APIs externas (GAS, Google, CDN)
  const url = e.request.url;
  if (url.includes('script.google.com')) return;
  if (url.includes('googleusercontent.com')) return;
  if (url.includes('googleapis.com')) return;
  if (url.includes('cdn.jsdelivr.net')) return;

  e.respondWith(
    caches.match(e.request)
      .then(response => response || fetch(e.request))
      .catch(() => caches.match('/index.html'))
  );
});
