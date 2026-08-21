// THE tuning schema. Every constant in the movement system lives here.
// If a number appears inline anywhere in core/, that is a bug (DESIGN.md rule 2).
//
// Units: metres, seconds, radians. The tuning panel is generated from this
// structure automatically, so adding a param here is all it takes to get a slider.

/** Bump when defaults change meaningfully — invalidates saved localStorage tunes. */
export const TUNING_VERSION = 12;

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
    auto: false,        // hold the trigger and it keeps firing every boltTime
  },

  railgun: {
    // Slot 3, and the only HITSCAN weapon: it lands the instant you click, with
    // no lead and no drop. That is the whole identity — the other two ask you to
    // read the fight, this one asks you to already be right. Slow to cycle, so a
    // miss costs you the exchange.
    chargeTime: 1.5,    // the gap between shots
    damage: 3,          // x the shared head/body damage — a clean body shot kills
    spread: 0,          // radians of cone half-angle; 0 = perfectly on the dot
    pierce: 3,          // targets one shot punches through before it stops
    beamTime: 0.12,     // seconds the tracer stays on screen
    beamWidth: 0.09,    // radius of the bright core, metres. A LINE is stuck at
                        // one pixel in WebGL, so the tracer is real geometry
    beamGlow: 3.2,      // halo radius, x the core — the shine around the shot
  },

  shotgun: {
    // Slot 2. A pump firing a cone of slow, heavy-dropping pellets: lethal in
    // the dais scrum, useless across the arena. damage is per PELLET, so the
    // kill takes a fraction of the cone — that fraction is the range falloff.
    pumpTime: 0.9,      // the gap between shells
    // Leave at 0 and this is an ordinary pump: one shell, then pumpTime.
    // Above 0 it becomes a double barrel — TWO shells pumpTime apart, and then
    // this long to break it open and reload. Fire one and walk away and the
    // second barrel stays loaded, which is the whole character of the weapon.
    secondPump: 0,
    pellets: 9,
    spread: 0.075,      // radians of cone half-angle — THE choke slider
    projSpeed: 55,
    projDrop: 30,
    projSize: 0.07,
    damage: 0.45,       // per pellet, x the shared head/body damage
  },

  enemy: {
    shoot: true,        // uncheck to disarm every dummy — they still take hits, just never fire
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
    swingTime: 0.42,    // visual swing + time between combo presses
    combo: 3,           // swings before cooldown
    cooldown: 1.5,      // restores all swings
    reflectReach: 4.5,  // projectile parry range — a bit longer than the blade
    reflectSpeed: 1.5,  // reflected shots return this much faster
    infinite: false,    // swings never run out — the combo bar stays full
    // --- the swing itself. The blade is a real object in the world (held in
    // first person, in the character's hand in third), and every press picks a
    // RANDOM slash direction, so a combo never plays the same animation twice.
    swingSweep: 3.0,    // radians the blade travels across the screen per swing
    windup: 0.3,        // fraction of swingTime spent cocking back before the cut
    lunge: 0.12,        // metres the hand punches forward at the strike
    scale: 0.85,        // viewmodel size in first person (1 = the world-scale blade)
    slashSize: 1.3,     // trail radius, x the blade length. 0 hides the trail.
    slashDist: 1.1,     // how far in front of the hand the trail sits
    // The blade is DRAWN for the swing and goes away again — a sword parked in
    // the corner of the screen forever is just clutter between fights.
    linger: 0.35,       // seconds it stays out after the swing finishes
    drawSpeed: 24,      // how fast it comes out and goes back. High = snappy.
  },

  getsuga: {
    // Mouse 5. The sword's ranged verb: the swing throws a crescent of energy
    // that flies flat and cuts through everything on the way — no drop, no lead,
    // no pierce limit, because a wave is an area, not a bullet. It is gated by
    // its own cooldown rather than the combo, so the blade and the wave are two
    // separate decisions in a fight (T.sword.infinite frees this one too).
    damage: 3,          // per target the wave passes through
    speed: 55,          // travel speed — fast, but slow enough to watch it land
    radius: 2.8,        // hit radius AND the crescent's arc radius at spawn
    growth: 0.03,       // radius added per metre travelled — the wave widens
    range: 80,          // metres before it dissipates
    cooldown: 2.2,      // seconds between waves
    thickness: 0.12,    // crescent thickness at its thickest, x radius — a BLADE
    span: 2.6,          // radians of arc the crescent covers — wide and long
    converge: 45,       // metres out where the wave's path crosses the crosshair
  },

  grapple: {
    // Middle mouse. A rope, not a rocket: the hook bites INSTANTLY (a raycast on
    // the press — a hook that flies out is a hook that arrives late, and this is
    // meant to be the fastest verb in the kit), and everything after that is the
    // constraint plus what you ask for on WASD.
    //
    // The whole feel comes from three rules:
    //   1. The rope cannot stretch. Velocity pointing away from the anchor is
    //      removed every tick, which is what turns a fall into an ARC.
    //   2. Forward reels in, back pays out. That is the only accel the rope adds.
    //   3. Air control keeps running underneath. A/D steer the swing because the
    //      constraint eats the radial half of whatever they add and leaves the
    //      tangential half — so the swing reuses the air tune already dialled in
    //      rather than inventing a second one.
    enabled: true,
    range: 65,          // how far the hooks can reach
    spread: 0.07,       // radians either side of the aim the two shots splay
    minLen: 2.2,        // arrive this close and the rope lets go
    maxLen: 90,         // rope snaps past this — pay-out has a limit
    eyeOffset: 0.6,     // metres above the capsule centre the hook is fired from
    // --- rope
    stiffness: 60,      // pull-back accel per metre of stretch. High = rigid rope
    slack: 0.05,        // metres of stretch tolerated before it pulls — 0 is twitchy
    swingDrag: 0.15,    // drag along the arc. Low: a swing should KEEP its speed
    // --- reeling, on the movement keys
    reelAccel: 95,      // accel along the rope while holding forward
    reelSpeed: 14,      // metres/sec the rope itself shortens while reeling
    reelCap: 42,        // speed ceiling the reel accelerates toward
    payOutSpeed: 11,    // metres/sec the rope lengthens while holding back
    // A reel that only pulls flat drags you into the wall below the anchor. This
    // adds lift while reeling, so a grapple onto a ledge arcs UP and over it.
    reelLift: 8,
    // --- letting go
    releaseBoost: 1.06, // speed multiplier on release — a swing should pay out
    releaseUp: 2.5,     // upward kick on release, so you leave the arc climbing
    keepTime: 1.4,      // seconds after release where overspeed doesn't bleed
    cooldown: 0.12,     // between shots. Just enough to stop a flicker-spam
    toggle: false,      // false = hold to hang, release to let go
    // A rope through a corner looks wrong, but detaching mid-swing FEELS worse —
    // and swinging around a pillar is the whole point. Off by default.
    breakOnBlocked: false,
    // --- hooking a DUMMY instead of the world. Doom's meathook: the hook bites
    // the body, and YOU are hauled to IT, arriving at sword range with the swing
    // already available. Aimed at the arena the same button does the opposite,
    // because the arena doesn't move. Handled engine-side (engine/hook.ts) — the
    // solver is not allowed to know enemies exist.
    pullTarget: false,  // flip it: true = the body flies to you instead
    hookSpeed: 46,      // top speed of the yank, whichever end of it moves
    hookAccel: 240,     // ramp. Very high: a meathook commits instantly
    hookStop: 3.0,      // the haul ends at this range — just inside sword reach
    hookBrake: 0.35,    // speed KEPT on arrival. Low, or you sail straight past
    hookTime: 2.5,      // safety: give up after this long
    pullLift: 1.1,      // pullTarget only: the arc a hauled body rides in on
    pullDamage: 0,      // on arrival. 0 = the hook sets up the kill, it isn't the kill
    pullStagger: 1.2,   // seconds a hooked target can't shoot
  },

  stamina: {
    max: 100,
    regen: 30,          // per second
    dashCost: 25,       // dashing is gated on this, not just charges
  },

  thruster: {
    // Hover jets on the jump button. Still not flight — the tank is short and
    // `maxRise` caps the climb — but responsive: the first pass felt like wading
    // because horizontal control was acceleration-only, and acceleration cannot
    // turn you when you are already at cap (§9). `hoverRedirect` is the fix, and
    // it is the first knob to reach for if the jets ever feel heavy again.
    enabled: true,
    // Hold jump once your jumps are spent (jump, double jump, then hold). With
    // this off the jets light on any held jump, which eats fuel on every hop.
    requireEmptyJumps: true,
    thrust: 62,         // upward accel while burning — snappy enough to kill a fall
    maxRise: 5,         // vertical speed ceiling under thrust — this is the knob
                        // that decides hover vs. flight, NOT the thrust value
    gravityScale: 0.2,  // gravity while burning — low, so the jets hold you up
    hoverAccel: 70,     // horizontal accel while hovering
    hoverCap: 13,       // horizontal ceiling while hovering
    hoverRedirect: 12,  // turns velocity without changing speed — THE responsiveness knob
    hoverDrag: 0.9,     // horizontal damping, so you drift instead of flying off
    // --- ODM: the jets while a cable is live. The hover model exists to HOLD a
    // position, and both halves of it fight a swing — the drag scrubs the arc
    // and the redirect steers velocity the cable is trying to own. On a cable
    // the jets stop hovering and just push, which is what gas is for.
    gasAccel: 70,       // accel along the stick (or the aim) while on a cable
    gasCap: 38,         // ceiling the gas alone reaches — swing for more than this
    // --- afterburner: hold the dash key WHILE the jets are lit. The hover is for
    // holding a position and shooting; this is for crossing the arena. It costs
    // multiples of the fuel, which is the only thing stopping it being the answer
    // to everything. Point and go: the stick if you're steering it, otherwise
    // wherever you're looking, pitch included.
    boost: true,
    boostAccel: 95,     // accel along the aim while the burner is lit
    boostCap: 34,       // horizontal ceiling under boost — THE ironman number
    boostRise: 13,      // vertical ceiling under boost (replaces maxRise while lit)
    boostAim: 1,        // how much camera pitch tilts the boost; 0 = flat only
    boostBurn: 2.4,     // fuel burn multiplier while boosting
    boostDrag: 0.12,    // near-zero damping — a burn keeps what it builds
    fuelMax: 120,
    burnRate: 42,       // fuel/sec while burning
    refuelRate: 40,     // fuel/sec once refuelling starts
    refuelDelay: 0.35,  // seconds after releasing before refuel starts
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

  light: {
    // The glTF kit's materials sit around 0.17 grey with no metalness, which is
    // a lot darker than the flat colours the placeholder boxes used. These are
    // here so the look can be dialled in live rather than guessed at in code.
    sky: 1.1,           // hemisphere fill from above
    sun: 1.6,           // the key light
    fill: 0.55,         // a second light facing the other way, so unlit faces
                        // are dim rather than black
  },

  meters: {
    // Four flat bars stacked in the top-right corner: fuel, stamina, sword,
    // getsuga. They used to be big arcs flanking the crosshair, which put them
    // in the one place you are always looking. A resource meter is a thing you
    // GLANCE at — it belongs in a corner, small and quiet, and readable by the
    // colour that moved rather than by the number.
    width: 132,         // px, bar length
    height: 6,          // px, bar thickness
    gap: 6,             // px between bars
    top: 16,            // px from the top edge
    right: 16,          // px from the right edge
    opacity: 0.6,       // the whole cluster. Low on purpose: never fight the reticle
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

  // Automatic mantle. Anything between a step and a chest-high ledge used to be
  // a full stop; this turns it into a hop that keeps your speed. Nothing is bound
  // to it — it fires off the ledge itself, because the moment you have to press a
  // button for it you have already lost the flow it exists to protect.
  vault: {
    enabled: true,
    maxHeight: 1.9,     // tallest ledge that vaults. Above this it is a wall
    reach: 0.5,         // how far past the capsule the ledge probe looks
    minSpeed: 2.5,      // ignore ledges you are merely leaning on
    clearance: 0.3,     // clear the lip by this much instead of scraping it
    push: 6,            // forward speed held through the hop, so you land ON it
    hold: 0.35,         // seconds that push is re-asserted while you rise
    cooldown: 0.2,      // no second vault until this expires
  },

  // C in the air: stop everything and go straight down. It is an escape and a
  // re-entry, not a damage move — the reward is the window afterwards, where a
  // dash comes out harder so you can leave the crater in the direction you like.
  slam: {
    enabled: true,
    speed: 62,          // downward speed the slam holds, m/s
    keepH: 0,           // fraction of horizontal speed kept. 0 = dead vertical
    minHeight: 2.5,     // metres of clear air needed under you before C will slam
    boostTime: 1.1,     // seconds after landing that dashes come out harder
    dashBoost: 1.3,     // x dash speed inside that window
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
  'vault/maxHeight': { min: 0.5, max: 4, step: 0.05, doc: 'Tallest ledge that hops. Above it, a wall.' },
  'vault/reach': { min: 0.1, max: 2, step: 0.05, doc: 'How far ahead of you the ledge probe looks.' },
  'vault/minSpeed': { min: 0, max: 12, step: 0.25, doc: 'Below this you are leaning, not vaulting.' },
  'vault/clearance': { min: 0, max: 1.5, step: 0.05, doc: 'Extra height over the lip.' },
  'vault/push': { min: 0, max: 20, step: 0.5, doc: 'Forward speed floor over the lip. Never slows you.' },
  'vault/hold': { min: 0.05, max: 1, step: 0.01 },
  'vault/cooldown': { min: 0, max: 1.5, step: 0.05 },
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
  'grapple/range': { min: 5, max: 200, step: 1, doc: 'How far the hooks reach.' },
  'grapple/spread': { min: 0, max: 0.4, step: 0.005, doc: 'How far apart the two anchors land. 0 = both on one point.' },
  'grapple/minLen': { min: 0.5, max: 12, step: 0.1, doc: 'Arrive this close and it lets go.' },
  'grapple/maxLen': { min: 10, max: 250, step: 5, doc: 'Rope snaps past this.' },
  'grapple/eyeOffset': { min: -1, max: 2, step: 0.05 },
  'grapple/stiffness': { min: 5, max: 300, step: 1, doc: 'Pull-back per metre of stretch. High = rigid.' },
  'grapple/slack': { min: 0, max: 1.5, step: 0.01, doc: 'Stretch tolerated before the rope pulls.' },
  'grapple/swingDrag': { min: 0, max: 4, step: 0.05, doc: 'Drag along the arc. 0 = a swing never slows.' },
  'grapple/reelAccel': { min: 0, max: 300, step: 5, doc: 'Accel along the rope on forward.' },
  'grapple/reelSpeed': { min: 0, max: 50, step: 0.5, doc: 'How fast the rope itself shortens.' },
  'grapple/reelCap': { min: 5, max: 60, step: 1, doc: 'Speed the reel accelerates toward.' },
  'grapple/payOutSpeed': { min: 0, max: 50, step: 0.5, doc: 'How fast holding back lengthens it.' },
  'grapple/reelLift': { min: 0, max: 40, step: 0.5, doc: 'Upward accel while reeling — clears ledges.' },
  'grapple/releaseBoost': { min: 1, max: 1.6, step: 0.01, doc: 'Speed multiplier when you let go.' },
  'grapple/releaseUp': { min: 0, max: 15, step: 0.5, doc: 'Upward kick on release.' },
  'grapple/keepTime': { min: 0, max: 5, step: 0.1, doc: 'Grace after release before overspeed bleeds.' },
  'grapple/cooldown': { min: 0, max: 3, step: 0.02 },
  'grapple/toggle': { doc: 'On = click to attach, click again to let go.' },
  'grapple/breakOnBlocked': { doc: 'On = the rope detaches when geometry comes between you and the anchor.' },
  'grapple/pullTarget': { doc: 'On = a hooked body flies to you. Off = you fly to it, Doom-style.' },
  'grapple/hookSpeed': { min: 5, max: 120, step: 1, doc: 'Top speed of the yank.' },
  'grapple/hookAccel': { min: 5, max: 500, step: 5, doc: 'Yank ramp. High = it commits instantly.' },
  'grapple/hookStop': { min: 1, max: 12, step: 0.1, doc: 'Where the haul ends. Keep it inside sword reach.' },
  'grapple/hookBrake': { min: 0, max: 1, step: 0.05, doc: 'Speed kept on arrival. High = you sail past.' },
  'grapple/pullLift': { min: 0, max: 6, step: 0.1, doc: 'pullTarget only: how high a hauled body rides.' },
  'grapple/hookTime': { min: 0.2, max: 8, step: 0.1, doc: 'Safety cutoff on a haul.' },
  'grapple/pullDamage': { min: 0, max: 10, step: 0.5, doc: 'Damage on arrival. 0 = the yank only sets up the kill.' },
  'grapple/pullStagger': { min: 0, max: 5, step: 0.1, doc: "Seconds a hauled target can't shoot." },
  'weapon/switchTime': { min: 0, max: 1.5, step: 0.01, doc: 'Raise time after a swap. 0 = instant.' },
  'rifle/boltTime': { min: 0.1, max: 2, step: 0.05 },
  'rifle/projSpeed': { min: 10, max: 300, step: 1, doc: 'Muzzle velocity.' },
  'rifle/projDrop': { min: 0, max: 80, step: 0.5, doc: 'Bullet drop. 0 = laser.' },
  'rifle/projSize': { min: 0.03, max: 0.6, step: 0.01 },
  'rifle/damage': { min: 0, max: 4, step: 0.05, doc: 'x the shared head/body damage.' },
  'rifle/spread': { min: 0, max: 0.2, step: 0.002, doc: 'Cone half-angle, radians.' },
  'shotgun/pumpTime': { min: 0.1, max: 3, step: 0.05, doc: 'Gap between shells. With a second barrel, between the two.' },
  'shotgun/secondPump': { min: 0, max: 4, step: 0.05, doc: '0 = single barrel. Above 0: two shells, then this long to reload.' },
  'shotgun/pellets': { min: 1, max: 24, step: 1 },
  'shotgun/spread': { min: 0, max: 0.35, step: 0.002, doc: 'THE choke. Cone half-angle, radians.' },
  'shotgun/projSpeed': { min: 10, max: 300, step: 1 },
  'shotgun/projDrop': { min: 0, max: 80, step: 0.5 },
  'shotgun/projSize': { min: 0.03, max: 0.6, step: 0.01 },
  'shotgun/damage': { min: 0, max: 2, step: 0.05, doc: 'Per pellet, x the shared head/body damage.' },
  'thruster/thrust': { min: 0, max: 150, step: 1, doc: 'Upward accel while burning.' },
  'thruster/maxRise': { min: 0, max: 25, step: 0.5, doc: 'Vertical ceiling under thrust.' },
  'thruster/gravityScale': { min: 0, max: 1, step: 0.01, doc: '0 = weightless hover, 1 = full gravity.' },
  'thruster/hoverAccel': { min: 0, max: 150, step: 1 },
  'thruster/hoverCap': { min: 0, max: 30, step: 0.5 },
  'thruster/hoverRedirect': { min: 0, max: 30, step: 0.5, doc: 'Turns velocity without changing speed. THE hover-feel knob.' },
  'thruster/boostAccel': { min: 0, max: 250, step: 1, doc: 'Accel along the aim while boosting.' },
  'thruster/boostCap': { min: 0, max: 70, step: 0.5, doc: 'Horizontal ceiling under boost.' },
  'thruster/boostRise': { min: 0, max: 40, step: 0.5, doc: 'Vertical ceiling under boost.' },
  'thruster/boostAim': { min: 0, max: 1.5, step: 0.01, doc: '1 = the burn goes exactly where you look.' },
  'thruster/boostBurn': { min: 1, max: 8, step: 0.1, doc: 'Fuel multiplier. This is the only cost.' },
  'thruster/boostDrag': { min: 0, max: 6, step: 0.02 },
  'thruster/hoverDrag': { min: 0, max: 12, step: 0.1, doc: 'Horizontal damping. 0 = you fly away.' },
  'thruster/gasAccel': { min: 0, max: 250, step: 5, doc: 'Jet accel while on a cable. The ODM burst.' },
  'thruster/gasCap': { min: 5, max: 60, step: 1, doc: 'Ceiling the gas alone reaches. Swing to beat it.' },
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
  'sword/infinite': { doc: 'Swings never run out, no cooldown — on the blade or the wave.' },
  'sword/swingSweep': { min: 0.5, max: 4, step: 0.05, doc: 'Radians the blade travels per swing.' },
  'sword/windup': { min: 0, max: 0.6, step: 0.01, doc: 'Fraction of the swing spent cocking back.' },
  'sword/lunge': { min: 0, max: 0.6, step: 0.01, doc: 'Forward punch of the hand at the strike.' },
  'sword/scale': { min: 0.2, max: 1.5, step: 0.01, doc: 'First-person viewmodel size.' },
  'sword/slashSize': { min: 0, max: 4, step: 0.05, doc: 'Trail radius, x blade length. 0 = no trail.' },
  'sword/slashDist': { min: 0, max: 4, step: 0.05, doc: 'How far ahead of the hand the trail sits.' },
  'sword/linger': { min: 0, max: 3, step: 0.05, doc: 'Seconds the blade stays out after a swing.' },
  'sword/drawSpeed': { min: 2, max: 60, step: 1, doc: 'Draw/sheathe rate. High = snappy.' },
  'sword/swingTime': { min: 0.08, max: 1.5, step: 0.01, doc: 'Length of the whole swing.' },
  'getsuga/damage': { min: 0, max: 10, step: 0.5, doc: 'Per target the wave cuts through.' },
  'getsuga/speed': { min: 5, max: 200, step: 1 },
  'getsuga/radius': { min: 0.3, max: 8, step: 0.1, doc: 'Hit radius and crescent size at spawn.' },
  'getsuga/growth': { min: 0, max: 0.4, step: 0.005, doc: 'Radius gained per metre flown.' },
  'getsuga/range': { min: 5, max: 250, step: 5 },
  'getsuga/cooldown': { min: 0, max: 10, step: 0.1, doc: 'Seconds between waves. 0 = spam it.' },
  'getsuga/thickness': { min: 0.05, max: 1, step: 0.01, doc: 'Crescent thickness, x radius.' },
  'getsuga/span': { min: 0.5, max: 3.14, step: 0.05, doc: 'Radians of arc the crescent covers.' },
  'getsuga/converge': { min: 5, max: 200, step: 5, doc: 'Range at which the wave crosses the crosshair.' },
  'crosshair/dotSize': { min: 0, max: 24, step: 1, doc: '0 = no centre dot.' },
  'crosshair/length': { min: 0, max: 48, step: 1, doc: 'Tick length. 0 = bare dot.' },
  'crosshair/thickness': { min: 1, max: 10, step: 1 },
  'crosshair/gap': { min: 0, max: 60, step: 1, doc: 'Centre to the inner end of each tick.' },
  'crosshair/opacity': { min: 0.1, max: 1, step: 0.05 },
  'light/sky': { min: 0, max: 4, step: 0.05 },
  'light/sun': { min: 0, max: 6, step: 0.05 },
  'light/fill': { min: 0, max: 4, step: 0.05, doc: 'Back light. 0 = unlit faces go black.' },
  'meters/width': { min: 40, max: 400, step: 2, doc: 'Bar length in px.' },
  'meters/height': { min: 2, max: 24, step: 1, doc: 'Bar thickness in px.' },
  'meters/gap': { min: 0, max: 30, step: 1, doc: 'Px between stacked bars.' },
  'meters/top': { min: 0, max: 300, step: 2, doc: 'Px from the top edge.' },
  'meters/right': { min: 0, max: 400, step: 2, doc: 'Px from the right edge.' },
  'meters/opacity': { min: 0.1, max: 1, step: 0.05, doc: 'Whole cluster. Keep it quiet.' },
  'railgun/chargeTime': { min: 0.1, max: 4, step: 0.05 },
  'railgun/damage': { min: 0, max: 8, step: 0.05, doc: 'x the shared head/body damage.' },
  'railgun/spread': { min: 0, max: 0.2, step: 0.002, doc: 'Cone half-angle. Hitscan, so this is pure accuracy.' },
  'railgun/pierce': { min: 0, max: 8, step: 1, doc: 'Targets one shot punches through. 0 = stops on the first.' },
  'railgun/beamTime': { min: 0.02, max: 1, step: 0.01, doc: 'How long the tracer lingers.' },
  'railgun/beamWidth': { min: 0.01, max: 0.5, step: 0.005, doc: 'Core radius in metres.' },
  'railgun/beamGlow': { min: 1, max: 8, step: 0.1, doc: 'Halo radius, x the core.' },
  'slam/speed': { min: 10, max: 140, step: 1, doc: 'Downward speed the slam holds.' },
  'slam/keepH': { min: 0, max: 1, step: 0.05, doc: '0 = straight down, 1 = keeps all your run.' },
  'slam/minHeight': { min: 0, max: 20, step: 0.5, doc: 'Clear air needed under you before C will slam.' },
  'slam/boostTime': { min: 0, max: 4, step: 0.05, doc: 'Seconds of stronger dashes after landing.' },
  'slam/dashBoost': { min: 1, max: 3, step: 0.05, doc: 'x dash speed inside that window.' },
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
