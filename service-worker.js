const CACHE_PREFIX = 'mirpworks-maze-adventure-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v11`;
const APP_BASE = new URL('./', self.registration.scope);
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/game.js',
  './src/maze.js',
  './src/tracing.js',
  './src/trace-diagnostics.js',
  './src/coordinates.js',
  './src/pointer-samples.js',
  './src/preferences.js',
  './src/qa-mode.js',
  './src/pwa.js',
  './branding/maze-adventure-logo.svg',
  './branding/maze-adventure-emblem.svg',
  './icons/maze-adventure-icon-180.png',
  './icons/maze-adventure-icon-192.png',
  './icons/maze-adventure-icon-512.png',
].map(path => new URL(path, APP_BASE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== APP_BASE.origin || !url.pathname.startsWith(APP_BASE.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Network-first means a reload sees current deployed files; cached files
      // are used only when offline or the network fails.
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match(new URL('./', APP_BASE).href);
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
