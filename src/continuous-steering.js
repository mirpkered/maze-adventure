export const DEFAULT_STEERING_SETTINGS = Object.freeze({
  deadZonePixels: 10,
  maxDeflectionPixels: 76,
  // A gentle power curve keeps fine control near the origin while reserving
  // the larger speed increase for a deliberate, wider finger deflection.
  speedResponseExponent: 1.15,
  maxSpeedMazeUnitsPerSecond: 1.725,
  maxFrameSeconds: 0.05,
});

// The active maze difficulty selects exactly one cap. Keep this table as the
// single source of truth for player controls and QA reporting.
export const STEERING_SPEED_BY_DIFFICULTY = Object.freeze({
  easy: 1.725,
  medium: 2,
  hard: 2.5,
  expert: 3,
});

/** Provisional shaped-maze cap scaled by effective cell count, not a fake difficulty. */
export function getShapedMazeSpeedCap(activeCellCount) {
  if (!Number.isFinite(activeCellCount) || activeCellCount < 1) throw new RangeError('A shaped maze needs a positive active-cell count.');
  return Math.min(3, Math.max(1.725, 1.725 + 0.11 * (Math.sqrt(activeCellCount) - 7)));
}

export function steeringDeflectionForDisplacement(magnitude, settings = DEFAULT_STEERING_SETTINGS) {
  if (!Number.isFinite(magnitude) || magnitude <= settings.deadZonePixels) return 0;
  return Math.min(1, (magnitude - settings.deadZonePixels)
    / (settings.maxDeflectionPixels - settings.deadZonePixels));
}

/** Continuous, bounded speed response shared by the controller and QA tools. */
export function steeringSpeedForDisplacement(magnitude, settings = DEFAULT_STEERING_SETTINGS) {
  const strength = steeringDeflectionForDisplacement(magnitude, settings);
  if (strength === 0) return 0;
  return settings.maxSpeedMazeUnitsPerSecond * (strength ** settings.speedResponseExponent);
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

  let pointerId = null, origin = null, finger = null, lastTimestamp = null, difficulty = 'easy', speedProfile = 'easy';
  let frames = 0, activeFrames = 0, clampedFrames = 0;
  const copy = point => ({ x: point.x, y: point.y });
  const neutral = () => ({ x: 0, y: 0, speed: 0, active: false, frameSeconds: 0, clamped: false });

  return {
    get active() { return pointerId !== null; },
    get pointerId() { return pointerId; },
    get difficulty() { return difficulty; },
    get settings() { return { ...config }; },
    get snapshot() {
      const fingerDisplacementPixels = origin && finger ? Math.hypot(finger.x - origin.x, finger.y - origin.y) : 0;
      const normalizedDeflection = steeringDeflectionForDisplacement(fingerDisplacementPixels, config);
      return {
        active: pointerId !== null,
        origin: origin ? copy(origin) : null,
        finger: finger ? copy(finger) : null,
        difficulty,
        speedProfile,
        maxSpeedMazeUnitsPerSecond: config.maxSpeedMazeUnitsPerSecond,
        fingerDisplacementPixels,
        normalizedDeflection,
        speedDemand: normalizedDeflection ** config.speedResponseExponent,
        frames, activeFrames, clampedFrames,
      };
    },
    setDifficulty(value) {
      if (pointerId !== null) return false;
      if (!Object.hasOwn(STEERING_SPEED_BY_DIFFICULTY, value)) {
        throw new RangeError(`No production steering speed is configured for difficulty: ${value}`);
      }
      difficulty = value;
      speedProfile = value;
      config.maxSpeedMazeUnitsPerSecond = STEERING_SPEED_BY_DIFFICULTY[value];
      return true;
    },
    setSpeedProfile(profile, maxSpeedMazeUnitsPerSecond) {
      if (pointerId !== null) return false;
      if (typeof profile !== 'string' || !profile || !(maxSpeedMazeUnitsPerSecond > 0) || !Number.isFinite(maxSpeedMazeUnitsPerSecond)) {
        throw new RangeError('A named steering speed profile and positive cap are required.');
      }
      difficulty = null;
      speedProfile = profile;
      config.maxSpeedMazeUnitsPerSecond = maxSpeedMazeUnitsPerSecond;
      return true;
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
