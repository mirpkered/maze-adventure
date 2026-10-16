/** Keep the live maze, including its inline completion, intact while updating. */
export function canReloadForUpdate(screenId) {
  return screenId !== 'play';
}
