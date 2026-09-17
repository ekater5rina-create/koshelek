const CACHE = 'koshelek-v20';
const ASSETS = ['./', './index.html', './styles.css?v=20', './storage.js?v=20', './data.js?v=20', './history.js?v=20', './goals.js?v=20', './plans.js?v=20', './planner.js?v=20', './nlp.js?v=20', './vendor-jsqr.js?v=20', './receipt.js?v=20', './app.js?v=20', './manifest.webmanifest', './icon-180.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      // cache: 'no-cache' — обязательно. Иначе хостинг просит браузер держать файлы
      // в кэше десять минут, и запрос из воркера возвращает старую версию,
      // из-за чего обновление приложения не доезжает до телефона.
      const res = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      // Нет сети — отдаём из кэша, а для переходов по страницам сам экран приложения.
      const hit = await caches.match(e.request);
      if (hit) return hit;
      if (e.request.mode === 'navigate') {
        const index = await caches.match('./index.html');
        if (index) return index;
      }
      return Response.error();
    }
  })());
});
