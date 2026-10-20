export const QA_INPUT_MODE_KEY = 'maze-adventure-qa-input-mode-v1';
export const QA_INPUT_MODES = Object.freeze({
  DIRECT_TOUCH: 'direct-touch',
  CONTINUOUS_STEERING: 'continuous-steering',
});

export const DEFAULT_STEERING_SETTINGS = Object.freeze({
  deadZonePixels: 10,
  maxDeflectionPixels: 76,
  // A gentle power curve keeps fine control near the origin while reserving
  // the larger speed increase for a deliberate, wider finger deflection.
  speedResponseExponent: 1.15,
  maxSpeedMazeUnitsPerSecond: 1.5,
  maxFrameSeconds: 0.05,
});

/** Continuous, bounded speed response shared by the controller and QA tools. */
export function steeringSpeedForDisplacement(magnitude, settings = DEFAULT_STEERING_SETTINGS) {
  if (!Number.isFinite(magnitude) || magnitude <= settings.deadZonePixels) return 0;
  const strength = Math.min(1, (magnitude - settings.deadZonePixels)
    / (settings.maxDeflectionPixels - settings.deadZonePixels));
  return settings.maxSpeedMazeUnitsPerSecond * (strength ** settings.speedResponseExponent);
}

export function readQaInputMode(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(QA_INPUT_MODE_KEY) === QA_INPUT_MODES.CONTINUOUS_STEERING
      ? QA_INPUT_MODES.CONTINUOUS_STEERING
      : QA_INPUT_MODES.DIRECT_TOUCH;
  } catch { return QA_INPUT_MODES.DIRECT_TOUCH; }
}

export function writeQaInputMode(mode, storage = globalThis.localStorage) {
  const safeMode = mode === QA_INPUT_MODES.CONTINUOUS_STEERING
    ? QA_INPUT_MODES.CONTINUOUS_STEERING : QA_INPUT_MODES.DIRECT_TOUCH;
  try { storage?.setItem(QA_INPUT_MODE_KEY, safeMode); } catch { /* QA mode remains available for this session. */ }
  return safeMode;
}

/**
 * Owns the selected experimental mode and the mode that gameplay may use.
 * A stored Steering preference is honored only while QA is enabled.
 */
export function createQaInputModeState({ qaEnabled = false, storage = globalThis.localStorage } = {}) {
  let enabled = Boolean(qaEnabled);
  let preferenceLoaded = enabled;
  let selected = enabled ? readQaInputMode(storage) : QA_INPUT_MODES.DIRECT_TOUCH;

  return {
    get qaEnabled() { return enabled; },
    get selected() { return selected; },
    get active() {
      return enabled ? selected : QA_INPUT_MODES.DIRECT_TOUCH;
    },
    setQaEnabled(value) {
      const next = Boolean(value);
      if (next && !enabled && !preferenceLoaded) {
        selected = readQaInputMode(storage);
        preferenceLoaded = true;
      }
      enabled = next;
      return this.active;
    },
    select(mode) {
      if (!enabled) return this.active;
      selected = writeQaInputMode(mode, storage);
      preferenceLoaded = true;
      return this.active;
    },
  };
}

/** Screen-space joystick input; it never reads camera or maze coordinates. */
export function createSteeringController(settings = {}) {
  const config = { ...DEFAULT_STEERING_SETTINGS, ...settings };
  if (!(config.deadZonePixels >= 0)
    || !(config.maxDeflectionPixels > config.deadZonePixels)
    || !(config.speedResponseExponent > 0)
    || !(config.maxSpeedMazeUnitsPerSecond > 0)
    || !(config.maxFrameSeconds > 0)) {
    throw new RangeError('Steering settings must have a nonnegative dead zone and positive limits.');
  }

  let pointerId = null, origin = null, finger = null, lastTimestamp = null;
  let frames = 0, activeFrames = 0, clampedFrames = 0;
  const copy = point => ({ x: point.x, y: point.y });
  const neutral = () => ({ x: 0, y: 0, speed: 0, active: false, frameSeconds: 0, clamped: false });

  return {
    get active() { return pointerId !== null; },
    get pointerId() { return pointerId; },
    get settings() { return { ...config }; },
    get snapshot() {
      return {
        active: pointerId !== null,
        origin: origin ? copy(origin) : null,
        finger: finger ? copy(finger) : null,
        frames, activeFrames, clampedFrames,
      };
    },
    begin(id, point) {
      if (pointerId !== null || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
      pointerId = id;
      origin = copy(point);
      finger = copy(point);
      lastTimestamp = null;
      frames = 0; activeFrames = 0; clampedFrames = 0;
      return true;
    },
    update(id, point) {
      if (id !== pointerId || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
      finger = copy(point);
      return true;
    },
    advance(id, timestamp) {
      if (id !== pointerId || !Number.isFinite(timestamp)) return neutral();
      frames++;
      if (lastTimestamp === null) { lastTimestamp = timestamp; return neutral(); }
      const elapsed = Math.max(0, (timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;
      const frameSeconds = Math.min(elapsed, config.maxFrameSeconds);
      const clamped = elapsed > config.maxFrameSeconds;
      if (clamped) clampedFrames++;
      if (frameSeconds === 0) return { ...neutral(), clamped };

      const dx = finger.x - origin.x, dy = finger.y - origin.y;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude <= config.deadZonePixels) return { ...neutral(), frameSeconds, clamped };
      const speed = steeringSpeedForDisplacement(magnitude, config);
      const scale = speed * frameSeconds / magnitude;
      activeFrames++;
      return { x: dx * scale, y: dy * scale, speed, active: true, frameSeconds, clamped };
    },
    end(id) {
      if (id !== pointerId) return false;
      pointerId = null; origin = null; finger = null; lastTimestamp = null;
      return true;
    },
    cancel(id) { return this.end(id); },
  };
}
