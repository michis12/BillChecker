/* Offline-Cache: App-Dateien + Texterkennung */
const V = "ausgaben-v1";
const SHELL = ["./", "index.html", "receipt.js", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // App-Dateien: erst Netz (Updates), sonst Cache (offline)
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(V).then(ca => ca.put(req, c)); return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    // Bibliotheken & Schriften: Cache zuerst
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(V).then(ca => ca.put(req, c)); } return r; })));
  }
});
