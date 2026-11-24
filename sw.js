// Service Worker do Contas da Casa: permite instalar o app e abrir sem internet.
// Sempre tenta a versão mais nova; sem rede, usa a cópia guardada.
const CACHE = 'contas-v28';
const BASE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmo = url.origin === self.location.origin;
  const fb = url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/');
  if (!mesmo && !fb) return; // Firestore/Auth/Gemini vão direto para a rede
  e.respondWith(
    fetch(req, mesmo && req.mode === 'navigate' ? { cache: 'no-store' } : undefined)
      .then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
