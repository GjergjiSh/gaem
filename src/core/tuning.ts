// THE tuning schema. Every constant in the movement system lives here.
// If a number appears inline anywhere in core/, that is a bug (DESIGN.md rule 2).
//
// Units: metres, seconds, radians. The tuning panel is generated from this
// structure automatically, so adding a param here is all it takes to get a slider.

/** Bump when defaults change meaningfully — invalidates saved localStorage tunes. */
export const TUNING_VERSION = 5;

export const T = {
  world: {
    gravityRise: 36,      // downward accel while moving up
    gravityFall: 62,      // downward accel while falling — higher makes jumps feel snappier
    maxFallSpeed: 60,
    timeScale: 1,         // global hitstop / slow-mo hook, reserved for combat
  },

  ground: {
    maxSpeed: 11,         // base cap. NOT the ceiling — see momentum.*
    accel: 160,
    friction: 34,         // decel when no input held
    turnAssist: 2.2,      // extra accel multiplier when input opposes current velocity
    redirect: 14,         // see air.redirect — this is the ground equivalent
  },

  air: {
    accel: 110,
    control: 1,           // 0 = no steering airborne, 1 = as responsive as ground
    friction: 0.2,
    // Redirect rotates existing velocity toward the stick WITHOUT changing its
    // magnitude. Acceleration alone can't turn you sharply at cap (there's no
    // headroom left to add), which is what made air control feel sloppy.
    // This is the single most important knob for "ninja" air control.
    redirect: 11,
  },

  jump: {
    speed: 13.5,          // ~2.5m apex at gravityRise 36
    doubleJumpSpeed: 12.5,
    maxJumps: 2,
    cutMultiplier: 0.45,  // velY multiplier when jump released early (variable height)
    coyoteTime: 0.12,
    bufferTime: 0.12,
    slideExitBonus: 1.28, // speed MULTIPLIER when jumping out of a slide
  },

  dash: {
    speed: 32,
    duration: 0.16,       // → ~5.1m of travel
    cooldown: 0.85,
    maxCharges: 1,
    refillOnGround: true,
    refillOnWall: false,
    gravityScale: 0,      // 0 = fully floaty dash, 1 = gravity applies throughout
    exitSpeedKeep: 0.85,  // fraction of dash speed carried out the far side
    // A dash must never COST you speed, or it can't be a link in a chain.
    // With this on, a dash entered at 34 u/s exits at 34, not at 32*0.85.
    preserveEntrySpeed: true,
    coyoteTime: 0.1,
    bufferTime: 0.15,
    refundJumpOnDash: true,
    verticalAim: 0.35,    // how much camera pitch tilts an air dash
  },

  slide: {
    boost: 7,             // one-shot speed added on entry (may exceed base cap)
    friction: 3,          // much lower than ground friction — that's the point
    minSpeed: 2,          // drop below this and the slide ends
    slopeAccel: 95,       // downhill acceleration (scaled by slope steepness)
    slopeBrake: 14,       // uphill deceleration
    steerRate: 3.4,       // how hard you can curve a slide
    cooldown: 0.1,
    bufferTime: 0.12,
    capBonus: 2.4,        // slides get their own, much higher speed ceiling
    minTime: 0.25,        // can't be dropped instantly — stops slide-stutter
    // Grace window after sliding off a ledge in which a jump still counts as a
    // SLIDE jump (keeps the speed multiplier). This is the heart of the
    // dash-slide-jump ledge tech — widen it to make the trick more forgiving.
    coyoteTime: 0.16,
  },

  wall: {
    detectDist: 0.85,     // how far to probe sideways for a wall
    minSpeed: 5,          // below this you slide off instead of running
    maxAngle: 0.35,       // radians from vertical still counted as a runnable wall
    maxTime: 2.5,         // hard backstop; the gravity arc should end it first
    // Gravity ramps in over the run instead of being constant: you attach nearly
    // weightless, hang, then arc downward with increasing pull. That arc — not a
    // timer — is what should take you off the wall.
    gravityStart: 0.0,
    gravityEnd: 1.0,
    gravityRamp: 1.15,    // seconds from start to end of the ramp
    upBoost: 2.5,         // instant vertical kick on attach
    entryVyMax: 2,        // clamp on inherited climb speed, so the arc starts
                          // the same way whether you crept or rocketed onto the wall
    runAccel: 70,         // acceleration along the wall
    capBonus: 1.5,        // wallruns get a raised speed ceiling too
    jumpOut: 9,           // wall-jump impulse along the wall normal
    jumpUp: 11.5,         // wall-jump vertical impulse
    coyoteTime: 0.16,     // grace after leaving a wall
    cooldown: 0.18,       // stops instantly re-attaching to the same wall
    refillJumps: true,
    refillDash: true,
    stickAssist: 14,      // pull toward the wall, keeps you glued through corners
  },

  momentum: {
    // Soft cap: chained tech pushes you above ground.maxSpeed, then bleeds back down.
    // overspeedDecay=999 reproduces a strict hard cap; 0 reproduces Quake-style retention.
    overspeedDecay: 9,    // → ~1.2s from 20 u/s back to base cap
    hardCap: 46,          // absolute ceiling, safety net for level collision
    chainWindow: 1.1,     // consecutive tech inside this window compounds
    // Overspeed bleeds far more slowly in the air. Without this, a launch off a
    // ledge loses most of its earned speed before landing and the tech is
    // pointless. 0 = airborne speed is fully preserved.
    airDecayScale: 0.2,
    chainBonus: 1.1,      // multiplier per link in a chain
    maxChainBonus: 1.8,
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
    wallRoll: 0.22,       // camera banks away from the wall during a wallrun
    slideHeight: 0.7,     // camera drops toward the ground during a slide
    // Devil-May-Cry style orbit: you swing the camera around the character, and
    // when you stop steering it, it drifts back behind your direction of travel.
    autoFollow: 2.4,      // how fast it drifts back
    followDelay: 0.55,    // seconds of untouched mouse before drift starts
    followMinSpeed: 4,    // and only once you're actually moving
    pitchRest: 0.10,      // pitch it settles toward
    pitchFollow: 1.1,
    speedDistance: 3.0,   // extra arm length at hard cap — wider view when fast
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
  'air/redirect': { min: 0, max: 30, step: 0.1, doc: 'Turns velocity without changing speed. THE air-control knob.' },
  'ground/redirect': { min: 0, max: 30, step: 0.1 },
  'slide/capBonus': { min: 1, max: 4, step: 0.05, doc: 'Slide speed ceiling = ground.maxSpeed x this.' },
  'slide/friction': { min: 0, max: 20, step: 0.1 },
  'slide/slopeAccel': { min: 0, max: 200, step: 1 },
  'wall/gravityStart': { min: 0, max: 1, step: 0.01, doc: '0 = weightless on attach.' },
  'wall/gravityEnd': { min: 0, max: 2, step: 0.01 },
  'wall/gravityRamp': { min: 0.1, max: 4, step: 0.05, doc: 'Shorter = you arc off the wall sooner.' },
  'camera/autoFollow': { min: 0, max: 10, step: 0.1, doc: '0 disables the drift-behind entirely.' },
  'camera/followDelay': { min: 0, max: 3, step: 0.05 },
  'wall/maxAngle': { min: 0, max: 0.8, step: 0.01 },
  'wall/capBonus': { min: 1, max: 3, step: 0.05 },
  'wall/detectDist': { min: 0.4, max: 2, step: 0.05 },
  'jump/slideExitBonus': { min: 1, max: 2, step: 0.01, doc: 'Speed multiplier on a slide jump.' },
  'slide/coyoteTime': { min: 0, max: 0.5, step: 0.005, doc: 'Ledge-tech window. Wider = more forgiving.' },
  'momentum/airDecayScale': { min: 0, max: 1, step: 0.01, doc: '0 = airborne speed never bleeds.' },
  'camera/pitchMin': { min: -1.5, max: 0, step: 0.01 },
  'camera/pitchMax': { min: 0, max: 1.5, step: 0.01 },
  'camera/sensitivity': { min: 0.0002, max: 0.008, step: 0.0001 },
  'character/maxSlopeAngle': { min: 0.2, max: 1.4, step: 0.01, doc: 'Radians. Above this is a wall.' },
};

/**
 * The built-in defaults, captured before any saved profile is applied. Without this
 * there is no way back to the values in this file once localStorage holds a tune —
 * TUNING_VERSION only guards schema changes, not changed defaults.
 */
export const DEFAULTS: any = JSON.parse(JSON.stringify(T));

/** Sensible default slider bounds for any param without an explicit META entry. */
export function inferRange(path: string, value: number) {
  const m = META[path] ?? {};
  const max = m.max ?? (value === 0 ? 1 : Math.abs(value) * 3);
  const min = m.min ?? (value >= 0 ? 0 : -max);
  return { min, max, step: m.step, doc: m.doc };
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
