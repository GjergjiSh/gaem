// THE tuning schema. Every constant in the movement system lives here.
// If a number appears inline anywhere in core/, that is a bug (DESIGN.md rule 2).
//
// Units: metres, seconds, radians. The tuning panel is generated from this
// structure automatically, so adding a param here is all it takes to get a slider.

export const T = {
  world: {
    gravityRise: 30,      // downward accel while moving up
    gravityFall: 48,      // downward accel while falling — higher makes jumps feel snappier
    maxFallSpeed: 60,
    timeScale: 1,         // global hitstop / slow-mo hook, reserved for combat
  },

  ground: {
    maxSpeed: 9,          // base cap. NOT the ceiling — see momentum.*
    accel: 90,
    friction: 60,         // decel when no input held
    turnAssist: 1.6,      // extra accel multiplier when input opposes current velocity
  },

  air: {
    accel: 45,
    control: 0.75,        // 0 = no steering airborne, 1 = as responsive as ground
    friction: 0.5,
  },

  jump: {
    speed: 11,            // ~2.0m apex at gravityRise 30
    doubleJumpSpeed: 10,
    maxJumps: 2,
    cutMultiplier: 0.45,  // velY multiplier when jump released early (variable height)
    coyoteTime: 0.12,
    bufferTime: 0.12,
    slideExitBonus: 1.15, // speed kept when jumping straight out of a slide
  },

  dash: {
    speed: 26,
    duration: 0.18,       // → ~4.7m of travel
    cooldown: 1.1,
    maxCharges: 1,
    refillOnGround: true,
    refillOnWall: false,
    gravityScale: 0,      // 0 = fully floaty dash, 1 = gravity applies throughout
    exitSpeedKeep: 0.85,  // fraction of dash speed carried out the far side
    coyoteTime: 0.1,
    bufferTime: 0.15,
    refundJumpOnDash: true,
    verticalAim: 0.35,    // how much camera pitch tilts an air dash
  },

  slide: {
    boost: 4.5,           // one-shot speed added on entry (may exceed base cap)
    friction: 7,          // much lower than ground friction — that's the point
    minSpeed: 3.5,        // drop below this and the slide ends
    slopeAccel: 26,       // downhill acceleration
    slopeBrake: 12,       // uphill deceleration
    steerRate: 2.2,       // how hard you can curve a slide
    cooldown: 0.15,
    bufferTime: 0.12,
  },

  momentum: {
    // Soft cap: chained tech pushes you above ground.maxSpeed, then bleeds back down.
    // overspeedDecay=999 reproduces a strict hard cap; 0 reproduces Quake-style retention.
    overspeedDecay: 14,   // → ~0.8s from 20 u/s back to base cap
    hardCap: 42,          // absolute ceiling, safety net for level collision
    chainWindow: 0.6,     // consecutive tech inside this window compounds
    chainBonus: 1.08,     // multiplier per link in a chain
    maxChainBonus: 1.6,
  },

  camera: {
    distance: 5.2,
    height: 1.65,
    shoulder: 0.55,
    lagPos: 18,           // positional follow rate
    lagRot: 22,
    pitchMin: -0.9,
    pitchMax: 1.05,
    sensitivity: 0.0022,
    collisionRadius: 0.3,
    collisionPull: 30,    // how fast the arm shortens when geometry intrudes
    fovBase: 75,
    fovDash: 14,          // added during a dash
    fovSpeed: 18,         // added at hardCap, scaled by overspeed
    fovRate: 8,
    slideRoll: 0.09,
    slideHeight: 0.7,     // camera drops toward the ground during a slide
  },

  character: {
    radius: 0.4,
    height: 1.8,
    slideHeight: 0.9,
    turnRate: 15,         // facing catches up to movement direction at this rate
    maxSlopeAngle: 0.87,  // ~50deg, above this counts as a wall
    stepHeight: 0.35,
    snapToGround: 0.3,
  },
};

/** Range/step/doc overrides. Anything omitted falls back to inferRange() below. */
export const META: Record<string, { min?: number; max?: number; step?: number; doc?: string }> = {
  'world/timeScale': { min: 0.05, max: 2, step: 0.01, doc: 'Global slow-mo. Reserved for hitstop.' },
  'air/control': { min: 0, max: 1, step: 0.01 },
  'jump/maxJumps': { min: 1, max: 4, step: 1 },
  'jump/cutMultiplier': { min: 0, max: 1, step: 0.01, doc: 'Lower = more control over jump height.' },
  'dash/maxCharges': { min: 1, max: 5, step: 1 },
  'dash/gravityScale': { min: 0, max: 1, step: 0.01 },
  'dash/exitSpeedKeep': { min: 0, max: 1.5, step: 0.01 },
  'dash/verticalAim': { min: 0, max: 1, step: 0.01 },
  'momentum/overspeedDecay': { min: 0, max: 60, step: 0.5, doc: '0 = Quake retention, 60 = near-strict cap.' },
  'momentum/chainBonus': { min: 1, max: 1.5, step: 0.01 },
  'camera/pitchMin': { min: -1.5, max: 0, step: 0.01 },
  'camera/pitchMax': { min: 0, max: 1.5, step: 0.01 },
  'camera/sensitivity': { min: 0.0002, max: 0.008, step: 0.0001 },
  'character/maxSlopeAngle': { min: 0.2, max: 1.4, step: 0.01, doc: 'Radians. Above this is a wall.' },
};

/** Sensible default slider bounds for any param without an explicit META entry. */
export function inferRange(path: string, value: number) {
  const m = META[path] ?? {};
  const max = m.max ?? (value === 0 ? 1 : Math.abs(value) * 3);
  const min = m.min ?? (value >= 0 ? 0 : -max);
  const step = m.step ?? (max - min) / 200;
  return { min, max, step, doc: m.doc };
}

export type Tuning = typeof T;

/** Deep clone of current values — used for profile save and A/B compare. */
export function snapshot(): any {
  return JSON.parse(JSON.stringify(T));
}

/** Apply a saved profile in place, so live references to T stay valid. */
export function applyProfile(data: any, target: any = T) {
  for (const k of Object.keys(target)) {
    if (!(k in data)) continue;
    if (typeof target[k] === 'object' && target[k] !== null) applyProfile(data[k], target[k]);
    else target[k] = data[k];
  }
}
