// Opens the app at once from the saved copy, then checks for a newer one in the background.
// Never touches Google (orders, prices, photos): those requests are not same-origin and are skipped.
const CACHE = "fruitslot-v6";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
async function tellPages(){ (await self.clients.matchAll()).forEach(c => c.postMessage({ type: "fs-updated" })); }
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), hit = await cache.match(e.request), old = hit ? hit.clone() : null;   // clone now: the page starts reading `hit` straight away
    const fresh = fetch(e.request, { cache: "no-cache" }).then(async r => {
      if (!r.ok) return r;
      const html = (r.headers.get("content-type") || "").includes("text/html");
      const before = old && html ? await old.text().catch(() => null) : null;
      const after = html ? await r.clone().text().catch(() => null) : null;
      await cache.put(e.request, r.clone());
      if (before !== null && after !== null && before !== after) await tellPages();   // a new version is saved; the page can reload when it is safe
      return r;
    }).catch(() => hit || Response.error());
    if (hit){ e.waitUntil(fresh); return hit; }
    return fresh;
  })());
});
