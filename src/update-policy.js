/** Keep a live pencil attempt and its completion screen intact while updating. */
export function canReloadForUpdate(screenId) {
  return screenId !== 'play' && screenId !== 'complete';
}
