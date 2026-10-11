if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const workerUrl = new URL('../service-worker.js', import.meta.url);
  const appScope = new URL('../', import.meta.url).pathname;
  navigator.serviceWorker.register(workerUrl, { scope: appScope, updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(() => {});
}
