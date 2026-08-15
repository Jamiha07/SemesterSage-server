// Minimal service worker -- just enough for the browser to consider this installable.
// No offline caching yet; every request still goes straight to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {});
