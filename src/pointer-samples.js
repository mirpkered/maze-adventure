/** Return coalesced movement in order, including the dispatched event endpoint. */
export function pointerMovementSamples(event) {
  let coalesced = [];
  try { coalesced = event.getCoalescedEvents?.() ?? []; }
  catch { /* Some embedded browsers expose this API without implementing it. */ }

  const samples = [...coalesced].filter(sample => Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY));
  const last = samples.at(-1);
  if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY) samples.push(event);
  return samples;
}

/** pointerup carries one last position; cancellation must not invent movement. */
export function finalPointerMovement(session, pointerId, event, point) {
  return event.type === 'pointerup' ? session.move(pointerId, point) : null;
}
