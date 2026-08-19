// THE tuning schema. Every constant in the movement system lives here.
// If a number appears inline anywhere in core/, that is a bug (DESIGN.md rule 2).
//
// Units: metres, seconds, radians. The tuning panel is generated from this
// structure automatically, so adding a param here is all it takes to get a slider.

/** Bump when defaults change meaningfully — invalidates saved localStorage tunes. */
export const TUNING_VERSION = 11;

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

  sprint: {
    // Sprint shares the dash button (Shift): a kit is expected to enable one or
    // the other. A game with a dash (DMC) has no sprint; a game with sprint
    // (CoD, Titanfall) sets dash.enabled false.
    enabled: false,
    multiplier: 1.35,   // ground speed cap x this while sprinting
    minForward: 0.35,   // forward stick required - no sideways or backwards sprint
    fovAdd: 6,          // FOV push while sprinting; most of the "feels fast"
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
    coyoteTime: 0.12,
    bufferTime: 0.12,
    slideExitBonus: 1.28, // speed MULTIPLIER when jumping out of a slide
  },

  dash: {
    enabled: true,
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
    verticalAim: 0.35,    // how much camera pitch tilts an air dash (third person)
    verticalAimFP: 1.0,   // in first person you expect to dash exactly where you look
  },

  slide: {
    enabled: true,
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
    // Ghostrunner-style ledge boost: carrying a slide OFF a ledge flings you.
    // Fires once, at the moment the slide leaves the ground. Combined with
    // coyoteTime + slideExitBonus this is the "Super" (dash-slide-jump off a
    // ledge): boost on exit, then the coyote jump converts it. 0 = off.
    ledgeBoost: 0,      // flat speed added when a slide leaves a ledge
    ledgeDrop: 0,       // downward kick at the same moment — the fast GR drop
  },

  wall: {
    enabled: true,
    detectDist: 0.85,     // how far to probe sideways for a wall
    minSpeed: 5,          // below this you slide off instead of running
    maxAngle: 0.35,       // radians from vertical still counted as a runnable wall
    maxTime: 1.1,         // hard backstop; the gravity arc should end it first
    // Gravity ramps in over the run instead of being constant: you attach nearly
    // weightless, hang, then arc downward with increasing pull. That arc — not a
    // timer — is what should take you off the wall.
    gravityStart: 0.4,    // you start dropping immediately, never hang
    gravityEnd: 1.9,       // and end up falling harder than normal gravity
    gravityRamp: 0.5,     // seconds from start to end of the ramp
    upBoost: 2.2,         // instant vertical kick on attach
    entryVyMax: 2,        // clamp on inherited climb speed, so the arc starts
                          // the same way whether you crept or rocketed onto the wall
    runAccel: 85,         // auto-run acceleration along the wall (no input needed)
    capBonus: 1.5,        // wallruns get a raised speed ceiling too
    jumpOut: 13,          // wall-jump impulse along the wall normal — this is what
                          // throws you across a gap to the opposite wall
    jumpUp: 12,           // wall-jump vertical impulse
    jumpKeepAlong: 0.7,   // fraction of along-wall speed the jump carries through.
                          // out/up/keepAlong together define the ejection angle.
    maxChain: 3,          // consecutive wallruns allowed before you must touch ground
    coyoteTime: 0.16,     // grace after leaving a wall
    cooldown: 0.18,       // stops instantly re-attaching to the same wall
    refillJumps: true,
    refillDash: true,
    stickAssist: 14,      // pull toward the wall, keeps you glued through corners
  },

  bhop: {
    // Classic bunnyhop. Two halves: land-and-rehop must not scrub your speed, and
    // air-strafing must be able to ADD speed. The second half needs a deliberately
    // tiny wish-speed cap — you gain because the dot product of velocity and a
    // perpendicular stick direction is near zero, leaving headroom to accelerate into.
    airWishSpeed: 1.7,    // the small cap. Larger = easier but less skilful.
    airAccel: 105,
    window: 0.16,         // land within this of a queued jump and you keep everything
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

  weapon: {
    // Shared across every gun in the arsenal. Per-gun ballistics live in their
    // own groups below (rifle, shotgun), so a new gun is a new group plus one
    // entry in engine/weapon.ts — never a change to this block.
    // "Scoping" is deliberately NOT a scope overlay: it's a fast FOV pull
    // (MW-style canted-laser feel) so quickscoping stays part of the flow.
    range: 250,         // projectile despawns after travelling this far
    switchTime: 0.28,   // raise time after a swap — the cost of switching
    adsFov: -30,        // FOV delta at full zoom; negative = zoom in
    adsSpeed: 18,       // how fast the zoom snaps in/out. High = quickscope
    adsSensScale: 0.55, // look sensitivity multiplier while scoped
    enemyHp: 2,         // dummy hit points
    headDamage: 2,      // head = 1 tap
    bodyDamage: 1,      // body and limbs = 2 taps
  },

  rifle: {
    // Slot 1. Bolt-action, one heavy projectile with drop — lead your shots.
    boltTime: 0.65,     // full bolt cycle — the gap between shots
    projSpeed: 85,      // muzzle velocity
    projDrop: 20,       // downward accel on the bullet — THE drop slider
    projSize: 0.12,     // bullet radius (visual + hit)
    damage: 1,          // multiplier on the shared head/body damage
    spread: 0,          // radians of cone half-angle; 0 = dead centre
  },

  shotgun: {
    // Slot 2. A pump firing a cone of slow, heavy-dropping pellets: lethal in
    // the dais scrum, useless across the arena. damage is per PELLET, so the
    // kill takes a fraction of the cone — that fraction is the range falloff.
    pumpTime: 0.9,      // the gap between shells
    pellets: 9,
    spread: 0.075,      // radians of cone half-angle — THE choke slider
    projSpeed: 55,
    projDrop: 30,
    projSize: 0.07,
    damage: 0.45,       // per pellet, x the shared head/body damage
  },

  enemy: {
    scale: 1.6,         // dummy size multiplier — bigger = easier to hit
    range: 55,          // engagement distance; further than this they hold fire
    fireInterval: 1.8,  // seconds between shots per dummy
    projSpeed: 16,      // slow enough to dodge or reflect on reaction
    projSize: 0.3,
    projDrop: 0,        // their shots fly straight by default
    spawnJitter: 4,     // random +/- metres applied to each spawn point per respawn
  },

  sword: {
    // Mouse 4. Instant frontal arc: kills close dummies, reflects their
    // projectiles back at whoever fired them. Three swings, then a cooldown.
    reach: 3.5,
    arc: 2.6,           // radians of total frontal cone width
    damage: 2,          // one clean swing kills a default dummy
    swingTime: 0.26,    // visual swing + time between combo presses
    combo: 3,           // swings before cooldown
    cooldown: 1.5,      // restores all swings
    reflectReach: 4.5,  // projectile parry range — a bit longer than the blade
    reflectSpeed: 1.5,  // reflected shots return this much faster
    infinite: false,    // swings never run out — the combo bar stays full
  },

  stamina: {
    max: 100,
    regen: 30,          // per second
    dashCost: 25,       // dashing is gated on this, not just charges
  },

  thruster: {
    // Hover jets on the jump button. Deliberately NOT flight: the vertical
    // ceiling is low, horizontal drag is high, and fuel is short — enough to
    // hang over the dais and shoot, not enough to cross the arena in the air.
    enabled: true,
    // Hold jump once your jumps are spent (jump, double jump, then hold). With
    // this off the jets light on any held jump, which eats fuel on every hop.
    requireEmptyJumps: true,
    thrust: 30,         // upward accel while burning
    maxRise: 3,         // vertical speed ceiling under thrust — deliberately low,
                        // this is what separates "hover" from "fly"
    gravityScale: 0.35, // gravity while burning — this is what makes it a float
    hoverAccel: 26,     // horizontal accel while hovering
    hoverCap: 8,        // horizontal ceiling while hovering — kept below ground speed
    hoverDrag: 2.2,     // horizontal damping, so you drift instead of flying off
    fuelMax: 100,
    burnRate: 42,       // fuel/sec while burning
    refuelRate: 34,     // fuel/sec once refuelling starts
    refuelDelay: 0.5,   // seconds after releasing before refuel starts
    groundRefuel: 2.5,  // refuel multiplier while grounded — landing tops you up
    restartFuel: 20,    // fuel needed to re-ignite after running the tank dry
  },

  crosshair: {
    // The whole reticle is data: a centre dot plus four ticks. length 0 leaves
    // the bare dot (the original), dotSize 0 leaves a classic four-tick cross.
    dotSize: 5,         // px diameter of the centre dot; 0 hides it
    length: 7,          // px length of each tick; 0 hides them
    thickness: 2,       // px tick width
    gap: 7,             // px from centre to the inner end of each tick
    opacity: 0.9,
    outline: true,      // dark rim so it still reads against bright geometry
    color: '#ffffff',
    // Px of extra gap per radian of the equipped gun's spread, so the shotgun's
    // cone is visible in the reticle instead of being a surprise. 0 = fixed size.
    spreadScale: 260,
  },

  meters: {
    // The meters flanking the crosshair: movement resources (stamina, thruster
    // fuel) on the left, the sword combo on the right. They are outward-facing
    // half-circles parked far out toward the edges — a meter near your aim is a
    // meter you misread, so the default offset is deliberately way outside the
    // area you actually look at. Drop `offset` if you want them closer.
    radius: 34,         // arc radius in px
    offset: 360,        // px from screen centre to each arc's centre
    width: 6,           // arc stroke thickness
    sweep: 180,         // degrees each arc spans; 360 makes them full rings again
    spacing: 9,         // px between the outer arc and the inner one beneath it
  },

  camera: {
    // Flip live from the panel (or the V key). The movement solver is unaffected by
    // this — it only ever consumed yaw/pitch — so both modes share one tune.
    firstPerson: false,
    // --- first-person only
    eyeHeight: 0.72,      // above the capsule CENTRE, which sits 0.9 above the feet
    fpRollScale: 0.3,     // wall/slide roll is far more nauseating from the eyes
    bobAmount: 0,         // head bob height; 0 disables
    bobRate: 1.15,
    pitchMinFP: -1.45,    // you need to look near-straight up/down in first person
    pitchMaxFP: 1.45,
    // --- third-person only
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
    // A sideways or backward dash getting the full forward FOV punch reads as a
    // forward lunge. 1 = punch scales with how camera-forward the dash is
    // (sideways = none), 0 = old omnidirectional punch.
    fovDashAim: 1,
    fovSpeed: 18,         // added at hardCap, scaled by overspeed
    fovRate: 8,
    slideRoll: 0.09,
    wallRoll: 0.22,       // camera banks away from the wall during a wallrun
    slideHeight: 0.7,     // camera drops toward the ground during a slide
    // Devil-May-Cry style orbit: you swing the camera around the character, and
    // when you stop steering it, it drifts back behind your direction of travel.
    autoFollow: 6.0,      // how fast it swings back behind you
    followDelay: 0.12,    // seconds of untouched mouse before it takes over
    followMinSpeed: 2,    // and only once you're actually moving
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
  'wall/maxChain': { min: 1, max: 8, step: 1, doc: 'Wallruns before you must land. Stops endless wall travel.' },
  'wall/jumpKeepAlong': { min: 0, max: 1.5, step: 0.01 },
  'wall/jumpOut': { min: 0, max: 30, step: 0.5 },
  'wall/jumpUp': { min: 0, max: 30, step: 0.5 },
  'bhop/airWishSpeed': { min: 0, max: 8, step: 0.05, doc: 'THE bhop knob. 0 disables strafe gain.' },
  'bhop/window': { min: 0, max: 0.5, step: 0.005 },
  'camera/followDelay': { min: 0, max: 3, step: 0.05 },
  'camera/eyeHeight': { min: -0.5, max: 1.5, step: 0.01 },
  'camera/fpRollScale': { min: 0, max: 1, step: 0.01 },
  'camera/bobAmount': { min: 0, max: 0.25, step: 0.005 },
  'camera/pitchMinFP': { min: -1.55, max: 0, step: 0.01 },
  'camera/pitchMaxFP': { min: 0, max: 1.55, step: 0.01 },
  'dash/verticalAimFP': { min: 0, max: 1.5, step: 0.01 },
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
  'sprint/multiplier': { min: 1, max: 2, step: 0.01, doc: 'Ground cap x this while sprinting.' },
  'sprint/minForward': { min: 0, max: 1, step: 0.05 },
  'sprint/fovAdd': { min: 0, max: 30, step: 0.5 },
  'camera/fovDashAim': { min: 0, max: 1, step: 0.01, doc: '1 = FOV punch only on camera-forward dashes.' },
  'slide/ledgeBoost': { min: 0, max: 15, step: 0.5, doc: 'Speed added when a slide leaves a ledge. 0 = off.' },
  'slide/ledgeDrop': { min: 0, max: 15, step: 0.5, doc: 'Downward kick when a slide leaves a ledge.' },
  'weapon/projSpeed': { min: 10, max: 300, step: 1, doc: 'Muzzle velocity.' },
  'weapon/projDrop': { min: 0, max: 80, step: 0.5, doc: 'Bullet drop. 0 = laser.' },
  'weapon/projSize': { min: 0.03, max: 0.6, step: 0.01 },
  'enemy/scale': { min: 0.5, max: 4, step: 0.05, doc: 'Dummy size multiplier.' },
  'enemy/fireInterval': { min: 0.2, max: 6, step: 0.1 },
  'enemy/projSpeed': { min: 2, max: 80, step: 0.5 },
  'enemy/projSize': { min: 0.05, max: 1.5, step: 0.05 },
  'enemy/spawnJitter': { min: 0, max: 12, step: 0.5, doc: 'Random spawn offset per respawn.' },
  'sword/arc': { min: 0.3, max: 3.14, step: 0.02, doc: 'Frontal cone width, radians.' },
  'sword/combo': { min: 1, max: 6, step: 1 },
  'sword/reflectSpeed': { min: 0.5, max: 4, step: 0.05 },
  'stamina/dashCost': { min: 0, max: 100, step: 1, doc: '0 = dashing is free again.' },
  'weapon/switchTime': { min: 0, max: 1.5, step: 0.01, doc: 'Raise time after a swap. 0 = instant.' },
  'rifle/boltTime': { min: 0.1, max: 2, step: 0.05 },
  'rifle/projSpeed': { min: 10, max: 300, step: 1, doc: 'Muzzle velocity.' },
  'rifle/projDrop': { min: 0, max: 80, step: 0.5, doc: 'Bullet drop. 0 = laser.' },
  'rifle/projSize': { min: 0.03, max: 0.6, step: 0.01 },
  'rifle/damage': { min: 0, max: 4, step: 0.05, doc: 'x the shared head/body damage.' },
  'rifle/spread': { min: 0, max: 0.2, step: 0.002, doc: 'Cone half-angle, radians.' },
  'shotgun/pumpTime': { min: 0.1, max: 3, step: 0.05 },
  'shotgun/pellets': { min: 1, max: 24, step: 1 },
  'shotgun/spread': { min: 0, max: 0.35, step: 0.002, doc: 'THE choke. Cone half-angle, radians.' },
  'shotgun/projSpeed': { min: 10, max: 300, step: 1 },
  'shotgun/projDrop': { min: 0, max: 80, step: 0.5 },
  'shotgun/projSize': { min: 0.03, max: 0.6, step: 0.01 },
  'shotgun/damage': { min: 0, max: 2, step: 0.05, doc: 'Per pellet, x the shared head/body damage.' },
  'thruster/thrust': { min: 0, max: 90, step: 0.5, doc: 'Upward accel while burning.' },
  'thruster/maxRise': { min: 0, max: 25, step: 0.5, doc: 'Vertical ceiling under thrust.' },
  'thruster/gravityScale': { min: 0, max: 1, step: 0.01, doc: '0 = weightless hover, 1 = full gravity.' },
  'thruster/hoverAccel': { min: 0, max: 90, step: 0.5 },
  'thruster/hoverCap': { min: 0, max: 30, step: 0.5 },
  'thruster/hoverDrag': { min: 0, max: 12, step: 0.1, doc: 'Horizontal damping. 0 = you fly away.' },
  'thruster/fuelMax': { min: 10, max: 300, step: 5 },
  'thruster/burnRate': { min: 1, max: 150, step: 1, doc: 'Fuel/sec. fuelMax / this = hover seconds.' },
  'thruster/refuelRate': { min: 1, max: 150, step: 1 },
  'thruster/refuelDelay': { min: 0, max: 3, step: 0.05 },
  'thruster/groundRefuel': { min: 1, max: 6, step: 0.1, doc: 'Refuel multiplier while grounded.' },
  'thruster/restartFuel': { min: 0, max: 100, step: 1, doc: 'Fuel needed to re-ignite after running dry.' },
  'crosshair/spreadScale': { min: 0, max: 800, step: 10, doc: 'Px of bloom per radian of the equipped gun spread.' },
  'weapon/adsFov': { min: -60, max: 0, step: 1, doc: 'The whole scope: an FOV pull, no overlay.' },
  'weapon/adsSensScale': { min: 0.1, max: 1, step: 0.01 },
  'weapon/boltTime': { min: 0.1, max: 2, step: 0.05 },
  'weapon/enemyHp': { min: 1, max: 10, step: 1 },
  'weapon/headDamage': { min: 1, max: 10, step: 1 },
  'weapon/bodyDamage': { min: 1, max: 10, step: 1 },
  'sword/infinite': { doc: 'Swings never run out and the combo never goes on cooldown.' },
  'crosshair/dotSize': { min: 0, max: 24, step: 1, doc: '0 = no centre dot.' },
  'crosshair/length': { min: 0, max: 48, step: 1, doc: 'Tick length. 0 = bare dot.' },
  'crosshair/thickness': { min: 1, max: 10, step: 1 },
  'crosshair/gap': { min: 0, max: 60, step: 1, doc: 'Centre to the inner end of each tick.' },
  'crosshair/opacity': { min: 0.1, max: 1, step: 0.05 },
  'meters/radius': { min: 6, max: 90, step: 1, doc: 'Stamina / sword arc radius.' },
  'meters/offset': { min: 20, max: 700, step: 5, doc: 'How far the meters sit from the crosshair.' },
  'meters/width': { min: 1, max: 16, step: 0.5 },
  'meters/sweep': { min: 30, max: 360, step: 5, doc: 'Degrees per arc. 360 = full ring.' },
  'meters/spacing': { min: 0, max: 30, step: 1, doc: 'Gap between the stamina and fuel arcs.' },
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
