import { canReloadForUpdate } from './update-policy.js';

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  let registration;
  let updatePending = false;
  const notice = () => document.querySelector('#app-update-notice');
  const applyUpdate = () => { location.reload(); };
  const showUpdate = () => {
    updatePending = true;
    const banner = notice();
    if (banner) banner.hidden = false;
    if (canReloadForUpdate(document.body.dataset.screen)) applyUpdate();
  };
  const workerUrl = new URL('../service-worker.js', import.meta.url);
  const appScope = new URL('../', import.meta.url).pathname;
  navigator.serviceWorker.register(workerUrl, { scope: appScope, updateViaCache: 'none' })
    .then(value => { registration = value; return registration.update(); })
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', showUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (updatePending && canReloadForUpdate(document.body.dataset.screen)) applyUpdate();
    registration?.update().catch(() => {});
  });
  window.addEventListener('maze-adventure:safe-to-update', () => {
    if (updatePending) applyUpdate();
  });
  document.querySelector('#apply-app-update')?.addEventListener('click', applyUpdate);
}
