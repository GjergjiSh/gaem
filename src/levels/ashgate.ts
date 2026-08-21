// Ashgate — a district, not a track.
//
// The figure-8 is a road: one line, taken one way, and everything else is
// scenery beside it. This is the other thing a movement game needs — a PLACE,
// where the geometry is a city you can cross in any direction and the designed
// lap is one route through it rather than the only floor there is.
//
// Three rules hold the whole thing together.
//
//   1. Nothing floats. Every building is a solid mass standing on the street.
//      Roofs are the tops of buildings, ledges are setbacks, shafts are the
//      slots between two masses. That is what stops a level reading as
//      platforms scattered in the air: there is no surface anywhere on this map
//      that is not part of something that reaches the ground.
//
//   2. Everything is solid. No decoration — not one brush here is `d: true`. A
//      map where half the objects are ghosts teaches you to distrust what you
//      see, so every plant room, lamp, sign, pipe and handrail is a thing you
//      can stand on, wallrun along, vault, slam onto or hide behind. The
//      dressing is free anyway: a prop hung on a wall sits flush against a
//      collider that is already there, so the only thing it can change is what
//      the wall looks like.
//
//   3. Every distance comes from the tune. The gap tiers below are computed
//      from the shipped defaults, not chosen. Retune the jump and the level
//      still means what it meant — and `npm run verify:level` re-measures all
//      of it against the real solver and the real Rapier world.
//
// The street grid is the skeleton: six columns by five rows of blocks, split by
// two kinds of street, and the difference between them is the whole vocabulary.
//
//   alleys   8 m. A hop across: a run and a double jump carries 12.2 m, and
//                 9.6 m of it even when the far roof is 4 m up.
//   avenues  22 m. Past a bare slide jump, which is 22.3 m flat and only
//                 14.5 m onto a roof 4 m higher, so crossing one costs you the
//                 double jump as well. At street level they are the long
//                 straights: 394 m end to end with nothing in the way.
//
// Climbing happens in SHAFTS, which are a third width and a different thing
// entirely: 5.5 m, because that is as far as a wall jump really carries you
// sideways (see BOUNCE — the honest figure is about 70% of what the tuning
// numbers suggest, and the first draft of this level was built on the
// dishonest one). Every shaft has a landing every 5 m, because wall.maxChain
// bounces is all you get before the game makes you touch something.
//
// Roof heights step by 2–4 m between neighbours, never more, so the roofscape
// is continuously traversable in every direction — there is no roof here you
// cannot reach from the one beside it. All the real vertical lives in four
// named features instead, and each one is a different verb:
//
//   the Ladder    a 26 m walled corridor off the Yard. Run in, wallrun, bounce;
//                 each bounce is worth 2 m and three of them is the chain
//                 limit, so there is a landing at 5.3 and another at 10.7 and
//                 the 16 m roof arrives in three stages. Those landings are why
//                 this is a feature and not a gate: miss the timing and you
//                 land on one, not in the street.
//   the Overpass  300 m of elevated deck straight down the widest avenue,
//                 falling 20 m north to south, in six segments. The five gaps
//                 are one of each tier and southbound every one is downhill —
//                 this is where speed is kept, not found.
//   the Spire     76 m. Balconies one thruster tank apart on three faces, a
//                 shaft up the fourth — the full-depth gap between the tower
//                 and its service core — and masts on top for the grapple.
//                 Three ways up, none of which goes all the way on its own.
//   the Chute     ~142 m of 25° slide from the crown, straight across the city
//                 on pylons, landing back on the roof the Ladder tops out on —
//                 the lap closes exactly where it began. slide.slopeAccel (95)
//                 beats slide.friction (3) from about two degrees, so this pins
//                 you at momentum.hardCap the whole way and throws you off a
//                 16 m roof at ~46 u/s. That flight is the finish line.
//
// The look is ONE art pack — `assets/scifi`, measured into `scifi.ts` — used
// for everything you get close to, and flat-shaded brush for everything you
// read at distance. That division is the whole trick. A district looks like a
// pile of boxes when nothing shares a language; it looks like a place when the
// detail all comes from the same hand and the volumes behind it are quiet.
//
// Which is also why the older `assets/Platforms` kit appears nowhere in this
// file. It is untextured, and textured props standing next to untextured ones
// is not two styles, it is one mistake.
//
// So: masses are shaded volumes with a base course, service bands and a
// cornice — a box with a foot and a cap is a building, a bare box is a box.
// Everything at arm's length is kit: wall panels on the ground storey of the
// avenues, doors and lights and vents on the frontages, plant on every roof,
// rails on every catwalk, and paint on the decks. Scale comes from the small
// things; you cannot tell how big a 30 m mass is until there is a door on it.
//
// The theme follows the pack rather than fighting it. It is catwalks, coolers,
// cable runs, service doors and floor decals, so Ashgate is the back of house:
// a utility district where every roof is plant and the landmarks are
// infrastructure.
//
// Fall and you land in the street, not on a restart. killY only catches you off
// the edge of the map, because the recovery — pick a wall, climb back — is more
// interesting than a reload, and it is the reason the ground floor is a real
// floor with real furniture on it.

import type { Brush, Trigger } from './types';
import { axisAngle, orient, qmul, type Q } from './geom';
import { SCIFI, sciBox, sciBrush } from './scifi';
import { DEFAULTS as D } from '../core/tuning';

interface P3 { x: number; y: number; z: number }

// --- what the character can actually do --------------------------------------
// Read off the SHIPPED tune (DEFAULTS, not the live T): moving a slider must not
// silently resize the city under you.

const G_UP = D.world.gravityRise;
const G_DN = D.world.gravityFall;
const apex = (vy: number) => (vy * vy) / (2 * G_UP);

/**
 * Flat distance covered by a jump: horizontal speed `v`, one impulse per entry
 * in `vys`, landing `rise` metres ABOVE the launch. Returns 0 when the apex
 * never reaches the far lip, so an unmakeable jump reports as unmakeable rather
 * than as a short one — which is the failure mode that puts a gap in a level
 * that nothing can cross.
 */
function reach(v: number, vys: number[], rise = 0): number {
  let t = 0;
  let h = 0;
  for (const vy of vys) { t += vy / G_UP; h += apex(vy); }
  if (h <= rise) return 0;
  return v * (t + Math.sqrt((2 * (h - rise)) / G_DN));
}

const RUN = D.ground.maxSpeed;
const SLIDE = RUN * D.slide.capBonus;
const J1 = D.jump.speed;
const J2 = D.jump.doubleJumpSpeed;
const JS = J1 * D.jump.slideExitBonus;

/** The gap sizes this level uses, and the technique each one asks for. */
export const GAP = {
  /** Run and double jump. The alleys. */
  hop: reach(RUN, [J1, J2]),
  /** Slide jump. */
  span: reach(SLIDE, [JS]),
  /** Slide jump plus the double. The avenues and the wide Overpass gaps. */
  super: reach(SLIDE, [JS, J2]),
  /** Nothing on foot. Grapple, thruster, or the long way round. */
  void: reach(D.momentum.hardCap, [JS, J2]),
};

/** One thruster tank, in metres of climb. Sets the Spire's balcony spacing. */
const TANK = (D.thruster.fuelMax / D.thruster.burnRate) * D.thruster.maxRise;

/**
 * How far a wall jump ACTUALLY carries you sideways before you are back at the
 * height you left from.
 *
 * The tempting number is `wall.jumpOut` times the airtime, and it is wrong by
 * about a third: a wall jump keeps `wall.jumpKeepAlong` of the speed you had
 * along the wall, and `wall.stickAssist` has been pulling that velocity INTO
 * the wall for the whole run, so a good part of the outward kick is spent
 * cancelling it. Measured against the solver the real figure is close to 70%,
 * and a shaft sized off the ideal instead of this is a shaft you fall down.
 */
const BOUNCE = 0.7 * D.wall.jumpOut
  * (D.wall.jumpUp / G_UP + Math.sqrt((2 * apex(D.wall.jumpUp)) / G_DN));
/** Centre-to-face distance at which the solver's proximity probe finds a wall. */
const WALL_REACH = D.character.radius + D.wall.detectDist;
/** Height one bounce is worth. */
const BOUNCE_RISE = apex(D.wall.jumpUp);

// --- palette. Same language as the figure-8, so a surface means the same thing
// on both maps: amber is something to wallrun, violet is something to slide.
const MASS_LOW = 0x2b3446;
const MASS_MID = 0x333e54;
const MASS_HI = 0x3c4963;
const DECK = 0x4b5b78;
const TIER = 0x2f3a4e;
const FURN = 0x566277;
const MAST = 0x6b7280;
const GANTRY = 0x94a3b8;
const STREET = 0x1e2531;
const CRATE = 0x475569;
const WALLRUN = 0xd97706;   // amber: run along it
const CHUTE_C = 0x7c3aed;   // violet: slide down it
const PAD = 0x0ea5e9;       // cyan: a thruster step
const ROAD = 0x415068;
const TRIM = 0x59667f;      // bands and cornices: the line round a building
const PLINTH_C = 0x232b3a;  // the base course every mass stands on
const PROP_C = 0xffffff;    // never seen: a prop's model hides its brush

const HALF_PI = Math.PI / 2;

// --- brush plumbing ----------------------------------------------------------

const brushes: Brush[] = [];

const box = (p: [number, number, number], s: [number, number, number], c: number, q?: Q): Brush => {
  const b: Brush = q ? { p, s, q, c } : { p, s, c };
  brushes.push(b);
  return b;
};

/**
 * The same box wearing a kit model. The collider does not change — the model is
 * stretched onto it — so a skin can never alter how a surface plays. Only used
 * where the box is within a few times the model's own proportions: a 54 m roof
 * wearing a 3.9 m deck plate is a smear, so the big masses stay untextured and
 * the decking goes on the things that are actually deck-shaped.
 */
const skinned = (
  p: [number, number, number], s: [number, number, number], c: number, m: string, q?: Q,
): Brush => { const b = box(p, s, c, q); b.m = m; return b; };

// --- the kit, and the job each model does -------------------------------------
//
// One art pack, used for everything you get close to. That is the whole trick to
// a district looking like a place rather than a pile of boxes: the models share
// a material palette and a level of detail, so the more of the visible surface
// is kit geometry instead of flat-shaded brush, the more it reads as one world.
// Flat brush is for the masses, which you see at distance and in silhouette.
//
// Every prop here is SOLID and sized by `propBox` — the model's measured
// bounding box — so the renderer's stretch-to-fill comes out at exactly 1 on all
// three axes and a prop can only ever appear at the shape it was modelled in.
// Getting that wrong is what turned the loop course into a scrapyard: `Sign_1`
// is 0.06 units thick, and poured into a brush 3 m deep it is a billboard the
// size of a building.

/**
 * Rooftop plant housings. Volumes, not models — see the note above about what
 * gets flat brush and what gets kit. Each one is capped and vented from the
 * pack, which is what says "machinery" rather than "box".
 */
const HOUSING: readonly (readonly [number, number, number])[] = [
  [9, 5, 6], [7, 6.5, 7], [11, 4, 5], [6, 7, 6], [8, 4.5, 8], [10, 5.5, 6],
];
/** What crowds around plant: vents, fans, cabinets, drums. */
const UNITS = [
  'Prop_Fan_Small', 'Prop_Computer', 'Prop_Barrel_Large', 'Prop_Crate4',
  'Prop_Chest', 'Prop_ItemHolder', 'Prop_AccessPoint', 'Prop_Crate3',
];
/** Flat plates for a wall: a few millimetres deep, so they are free. */
const PLATES = ['Prop_Vent_Big', 'Prop_Vent_Wide', 'Prop_Vent_Small', 'Prop_AccessPoint'];
/** Floor markings. The pack's decals are flat plates that lie in the XZ plane. */
const MARKS = ['Decal_Logo', 'Decal_Logo_Small', 'Decal_Sign', 'Decal_XSign',
  'Decal_A', 'Decal_K', 'Decal_V', 'Decal_X', 'Decal_Z', 'Decal_Dashes'];
const DIGITS = ['Decal_0', 'Decal_1', 'Decal_2', 'Decal_3', 'Decal_4',
  'Decal_5', 'Decal_6', 'Decal_7', 'Decal_8', 'Decal_9'];
/** Cladding for a facade, and the trims that cap it. */
const CLAD = ['WallAstra_Straight_Flat', 'WallAstra_Straight_Flat_Window',
  'WallWindow_Straight', 'WallBand_Straight'];
/**
 * The models this level stretches ON PURPOSE — linear things where a longer one
 * is just a longer one. Everything else must come out at a uniform scale, which
 * `verify:level` checks brush by brush against the measured table.
 */
export const STRETCHED = new Set([
  'Prop_Rail_4', 'Prop_PipeHolder', 'Decal_Line_Straight', 'Decal_Dashes',
]);

/**
 * Stable scramble, so a given block always dresses itself the same way.
 *
 * Read the low bits with `>>>`, never `>>`. A hash is unsigned and half of them
 * are past 2^31, where JavaScript's signed shift turns the value NEGATIVE — so
 * `(hash(n) >> 5) % 25` is not 0..24, it is -24..24, and the pipes it placed
 * ended up thirty metres outside the block they were supposed to cross,
 * hanging over the edge of the district holding onto nothing.
 */
function hash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], n: number): T => arr[hash(n) % arr.length];

/** The measured table, re-exported so the verifier can price a prop. */
export const propBoxOf = (m: string) => SCIFI[m];

/**
 * A slab spanning two points, with its TOP SURFACE on the line between them —
 * so an endpoint means "the floor is here", which is the only way a ramp
 * reliably meets the thing it was aimed at.
 *
 * `over` lengthens it at the LOW end only, which buries it into the surface it
 * lands on. Extending both ends — the obvious thing, and what this did first —
 * pushes the high end out past the deck it starts from and stands it a foot
 * proud of it, which is a bump you catch a slide on at the top of every ramp on
 * the map.
 */
/**
 * Which brushes are ramps. Inferring it from the geometry does not work: most
 * rotated brushes on this map are level pipes and rails turned to lie along a
 * street, and the ones that ARE tilted include every vent tipped up to face out
 * of a wall. A ramp knows it is a ramp, so it says so.
 */
export const RAMP_BRUSHES: number[] = [];

function ramp(from: P3, to: P3, w: number, thick: number, c: number, over = 0, m?: string) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const climb = Math.atan2(dy, flat);
  const span = Math.hypot(flat, dy);
  const len = span + over;
  const q = orient(yaw, -climb, 0);
  // Push the centre half the extension toward whichever end is lower.
  const down = dy <= 0 ? 1 : -1;
  const ux = flat > 1e-6 ? dx / span : 0;
  const uy = span > 1e-6 ? dy / span : 0;
  const uz = flat > 1e-6 ? dz / span : 0;
  const p: [number, number, number] = [
    (from.x + to.x) / 2 + ux * (over / 2) * down,
    (from.y + to.y) / 2 + uy * (over / 2) * down - (thick / 2) * Math.cos(climb),
    (from.z + to.z) / 2 + uz * (over / 2) * down,
  ];
  const brush = m ? skinned(p, [w, thick, len], c, m, q) : box(p, [w, thick, len], c, q);
  RAMP_BRUSHES.push(brushes.length - 1);
  return { yaw, climb, len, q, brush };
}

/** A prop standing on `y`, at the model's own size. */
function prop(m: string, x: number, y: number, z: number, yaw = 0, scale = 1) {
  const s = sciBrush(m, scale);
  skinned([x, y + s[1] / 2, z], s, PROP_C, m, yaw ? axisAngle(0, 1, 0, yaw) : undefined);
  return s;
}

/**
 * A floor marking. The pack's decals are flat plates lying in the XZ plane, so
 * the brush is a few centimetres of nothing with the plate in the middle of it —
 * under `character.stepHeight`, which is what makes a solid-everything rule and
 * painted floors compatible.
 *
 * Markings are most of what separates a designed space from an empty one. A
 * numbered deck is somewhere; an unnumbered deck is a surface.
 */
function decal(m: string, x: number, y: number, z: number, yaw = 0, scale = 1) {
  const s = sciBrush(m, scale);
  skinned([x, y + s[1] / 2, z], s, PROP_C, m, yaw ? axisAngle(0, 1, 0, yaw) : undefined);
}

/**
 * A prop hung on a wall, back against the face.
 *
 * These are where the district gets its SCALE. A 30 m mass has no size at all
 * until there is a 2 m door on it; after that your eye reads the whole street
 * correctly, and the same box stops looking like a box. They are also free in
 * gameplay terms — the brush sits flush against a collider that is already
 * there, so the only thing it can change is what the wall looks like.
 *
 * `(nx, nz)` is the outward normal of the face. The model's own +Z is turned to
 * face along it, which is why a street lamp's head reaches out over the road
 * and a sign faces the person reading it.
 */
function wallProp(m: string, nx: number, nz: number, x: number, y: number, z: number, scale = 1) {
  const s = sciBrush(m, scale);
  const yaw = Math.atan2(nx, nz);
  // Which way is the model's FLAT side? A door is thin on Z and hangs on a wall
  // by turning about Y alone. A vent or a strip light is thin on Y — it is
  // modelled lying on a floor — and hanging one on a wall without tipping it
  // first leaves it sticking out edge-on, attached to the wall by a line. That
  // is what put thirty-nine vents in mid-air the first time round.
  const flatY = s[1] < s[2];
  const out = (flatY ? s[1] : s[2]) / 2;
  // Bite 0.06 into the wall. A prop whose back plane exactly touches the face
  // is a prop resting on a hairline, and it reads as unsupported to anything
  // measuring the level as well as to the eye.
  const d = Math.max(0, out - 0.06);
  // Tip the flat ones face-OUT. The X quarter-turn has to go the positive way:
  // the other sign is just as plausible to write and turns every vent to face
  // into the wall it is mounted on, which you cannot see and the verifier
  // cannot catch.
  const q = flatY
    ? qmul(axisAngle(0, 1, 0, yaw), axisAngle(1, 0, 0, HALF_PI))
    : axisAngle(0, 1, 0, yaw);
  const up = flatY ? s[2] / 2 : s[1] / 2;
  skinned([x + nx * d, y + up, z + nz * d], s, PROP_C, m, q);
}

/** A linear model run along a wall — a pipe run, as long as you like. */
function wallRun(m: string, nx: number, nz: number, x: number, y: number, z: number, len: number) {
  const s = sciBrush(m);
  skinned([x + nx * (s[2] / 2), y + s[1] / 2, z + nz * (s[2] / 2)], [len, s[1], s[2]], PROP_C, m,
    axisAngle(0, 1, 0, Math.atan2(nx, nz)));
}

/**
 * A cladding panel, which needs a DIFFERENT quarter-turn from a prop.
 *
 * The pack is modular on a 4 m grid and a `_Straight` panel carries its
 * thickness on X and its 4 m length on Z — so a panel is turned to put its X
 * along the outward normal, where a vent or a sign is turned to put its Z
 * there. Getting the two mixed up gives you a wall panel standing edge-on to
 * the wall, which is a very quiet way to make a facade look wrong.
 */
function clad(m: string, nx: number, nz: number, x: number, y: number, z: number, scale = 1) {
  const s = sciBrush(m, scale);
  skinned([x + nx * (s[0] / 2), y + s[1] / 2, z + nz * (s[0] / 2)], s, PROP_C, m,
    axisAngle(0, 1, 0, Math.atan2(-nz, nx)));
}

/** A rail along an edge: same axes as a panel — thickness X, length Z. */
function railAlong(along: 'x' | 'z', x: number, y: number, z: number, len: number, q?: Q) {
  const s = sciBrush('Prop_Rail_4');
  skinned([x, y + s[1] / 2, z], [s[0], s[1], len], PROP_C, 'Prop_Rail_4',
    q ?? (along === 'z' ? undefined : axisAngle(0, 1, 0, HALF_PI)));
}

// --- the street grid ---------------------------------------------------------
// Block sizes first, streets between them, then the whole thing centred on the
// origin. Odd gaps are alleys, even ones avenues; the Overpass lives in the
// widest.

/**
 * The two street widths, taken off the budgets above rather than picked.
 *
 * An alley is two thirds of a hop, so crossing one at roof level is a jump you
 * make without thinking about it even when the far roof is 4 m up (9.6 m of
 * budget under the shipped tune, 9.9 m under `gaem`).
 *
 * An avenue is the full flat slide jump — which means it is NOT crossable by
 * one when there is any rise at all on the far side (14.5 m of budget at +4 m,
 * and under `gaem`, where the apex is lower, none), and every eastbound roof on
 * this map is 2–4 m up. So an avenue always costs you the double jump too. That
 * is the single most important number here: it is what separates the two kinds
 * of street into two different verbs.
 */
const ALLEY = Math.round(GAP.hop * 0.66);
const AVENUE = Math.round(GAP.span);
/** The Overpass avenue: the same crossing plus 2 m, so a 16 m deck running down
 *  the middle still leaves 4 m of daylight either side to fall through. */
const AVENUE_OP = AVENUE + 2;

const COL_W = [54, 52, 58, 54, 56, 50];
const COL_GAP = [ALLEY, AVENUE, ALLEY, AVENUE_OP, ALLEY];
const ROW_D = [54, 56, 52, 54, 52];
const ROW_GAP = [ALLEY, AVENUE, ALLEY, AVENUE];

interface Span { lo: number; hi: number; c: number; size: number }
function spans(sizes: number[], gaps: number[]): Span[] {
  const total = sizes.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const out: Span[] = [];
  let p = -total / 2;
  for (let i = 0; i < sizes.length; i++) {
    out.push({ lo: p, hi: p + sizes[i], c: p + sizes[i] / 2, size: sizes[i] });
    p += sizes[i] + (gaps[i] ?? 0);
  }
  return out;
}
export const COLS = spans(COL_W, COL_GAP);
export const ROWS = spans(ROW_D, ROW_GAP);
export const EXTENT = {
  x0: COLS[0].lo, x1: COLS[COLS.length - 1].hi,
  z0: ROWS[0].lo, z1: ROWS[ROWS.length - 1].hi,
};

// --- the plan ----------------------------------------------------------------
// Hand-authored, one entry per block. Read it as a map: west is left, north is
// up.

export type Kind = 'slab' | 'step' | 'twin' | 'wing' | 'yard' | 'plaza' | 'spire';

export const HEIGHT: number[][] = [
  //  c0  c1  c2  c3  c4  c5
  [   24, 28, 26, 30, 34, 30 ],  // r0  north edge
  [   20,  0, 30, 76, 36, 32 ],  // r1  the Spire row
  [    0, 16, 20, 22, 26, 28 ],  // r2  the spine: Yard, Ladder, the climb east
  [   14, 18,  0, 22, 26, 22 ],  // r3
  [   12, 16, 18, 20, 24, 18 ],  // r4  south edge
];

export const KIND: Kind[][] = [
  ['step', 'twin',  'slab',  'step',  'wing', 'twin' ],
  ['slab', 'plaza', 'twin',  'spire', 'step', 'wing' ],
  ['yard', 'slab',  'twin',  'wing',  'slab', 'step' ],
  ['wing', 'slab',  'plaza', 'twin',  'step', 'twin' ],
  ['twin', 'wing',  'step',  'slab',  'twin', 'slab' ],
];

/** How far a mass is sunk below the street, so no base ever floats. */
export const BASE = 4;
/** Roof deck thickness — the lighter cap on top of every mass. */
const DECK_T = 1.4;
/**
 * A shaft between two facing walls, and the single most sensitive number on the
 * map. You leave one wall standing about `character.radius` off its face and
 * have to arrive within `WALL_REACH` of the other, so a bounce has to cover
 * `SLOT - radius - WALL_REACH` — and it only has BOUNCE to spend. Floored to
 * the half metre with a fifth held back, because a shaft that works exactly at
 * the limit works for nobody.
 */
export const SLOT = Math.floor((BOUNCE * 0.8 + WALL_REACH + D.character.radius) * 2) / 2;
/**
 * Height between landings inside a shaft. `wall.maxChain` bounces are all you
 * get before the game insists you touch something, so a stage that asks for
 * more than that is a stage nobody finishes. Four fifths of the theoretical
 * maximum, so it is a climb rather than a perfect run.
 */
export const STAGE = Math.round(BOUNCE_RISE * D.wall.maxChain * 0.8 * 2) / 2;
/** How far a `step` building's upper mass is set back on every side. */
const SETBACK = 7;

/**
 * Landings inside a shaft: a full-width floor every STAGE metres, at ALTERNATING
 * ENDS. That alternation is the whole design, and it comes from a measurement
 * rather than a preference.
 *
 * Driving the real solver up a shaft, one chain of wall.maxChain bounces climbs
 * about 5 m — and spends about 25 m of forward travel doing it, because you
 * cannot bounce off a wall without also moving along it. A straight shaft
 * therefore delivers exactly one stage however tall you build it: you run out
 * of length long before you run out of height. Landings at alternating ends
 * turn that into a staircase — climb a flight, land, turn round, climb the next
 * one back the other way — so the shaft's LENGTH sets the stage height and its
 * height just sets how many flights there are.
 *
 * Landing on one also resets wall.maxChain, which is the other reason a shaft
 * taller than a single chain is climbable at all.
 *
 * `axis` is the direction you RUN; the walls face each other across the other.
 */
export interface Landing { x: number; y: number; z: number }
function shaftLedges(
  axis: 'x' | 'z', cx: number, cz: number, len: number, base: number, top: number,
): Landing[] {
  const n = Math.max(1, Math.round((top - base) / STAGE) - 1);
  const step = (top - base) / (n + 1);
  const deep = SLOT + 1.4;                      // wall centre to wall centre
  const run = Math.min(len * 0.35, 10);
  const out: Landing[] = [];
  for (let k = 1; k <= n; k++) {
    const y = base + step * k;
    const at = (k % 2 ? -1 : 1) * (len / 2 - run / 2 - 1);
    const p: [number, number, number] = axis === 'x'
      ? [cx + at, y - 0.5, cz]
      : [cx, y - 0.5, cz + at];
    const sz: [number, number, number] = axis === 'x' ? [run, 1, deep] : [deep, 1, run];
    box(p, sz, TIER);
    out.push({ x: p[0], y, z: p[2] });
  }
  return out;
}

export interface Roof { cx: number; cz: number; w: number; d: number; top: number }
/** Every walkable deck this file emits. The verifier walks this list. */
export const roofs: Roof[] = [];

/** One mass plus its deck. Everything solid and upright goes through here. */
function mass(cx: number, cz: number, w: number, d: number, top: number): Roof {
  const band = top >= 30 ? MASS_HI : top >= 20 ? MASS_MID : MASS_LOW;
  box([cx, (top - DECK_T - BASE) / 2, cz], [w, top - DECK_T + BASE, d], band);
  box([cx, top - DECK_T / 2, cz], [w, DECK_T, d], DECK);
  const r = { cx, cz, w, d, top };
  roofs.push(r);
  return r;
}

// --- roof machinery -----------------------------------------------------------
// Every roof on this map is the top of a working building, so it carries plant:
// a housing or two from the kit's platform set, with coolers and cabinets
// crowded against them. Crowded, not scattered — one object alone in the middle
// of an empty deck looks placed, a cluster jammed up against a plant house
// looks used, and it costs nothing extra to do the second thing.
//
// Positions are fractions of the space left AFTER a clear lane is reserved all
// the way round the roof, which is what keeps a prop from ever standing on a
// launch edge. Anything that will not fit inside that is simply not built.

// --- where the landmarks go ---------------------------------------------------
// Declared before anything is built, because the blocks have to know about
// them. The Chute lands on an ordinary roof and runs out across it at better
// than 40 u/s, and a plant house dropped in that lane — which is exactly what
// the first dressing pass did — is a full stop at the end of the best line on
// the map.

export const SPIRE_TOP = HEIGHT[1][3];
export const TERRACE = 30;
export const TOWER_W = 32, TOWER_D = 34;
/** Shifted east off the block centre, to leave a west strip wide enough for the
 *  service core and the shaft between the two. */
export const TOWER_X = COLS[3].c + 3, TOWER_Z = ROWS[1].c;
export const CHUTE_FROM: P3 = {
  x: TOWER_X - TOWER_W / 2 + 4, y: SPIRE_TOP, z: TOWER_Z + TOWER_D / 2 - 4,
};
export const CHUTE_TO: P3 = { x: COLS[1].c + 9, y: HEIGHT[2][1], z: ROWS[2].c - 16 };

/**
 * Lanes the route runs down. Nothing gets built inside one.
 *
 * A level that dresses itself has to be told where the game is, or it will
 * eventually put a cooling unit exactly where you needed the floor.
 */
interface Lane { x0: number; z0: number; x1: number; z1: number; half: number }
const LANES: Lane[] = [];
{
  const dx = CHUTE_TO.x - CHUTE_FROM.x;
  const dz = CHUTE_TO.z - CHUTE_FROM.z;
  const l = Math.hypot(dx, dz) || 1;
  // Touchdown, and the run out to the far edge of the roof beyond it.
  LANES.push({
    x0: CHUTE_TO.x - (dx / l) * 8, z0: CHUTE_TO.z - (dz / l) * 8,
    x1: CHUTE_TO.x + (dx / l) * 48, z1: CHUTE_TO.z + (dz / l) * 48,
    half: 10,
  });
  // The Overpass slip road off the spine roof.
  LANES.push({ x0: COLS[3].c - 6, z0: 10, x1: COLS[3].hi + 4, z1: 10, half: 8 });
}

/**
 * Where the rings go. Declared here rather than with the triggers at the bottom
 * because they are lanes too: a checkpoint you cannot stand in is a checkpoint
 * with a cooling unit in it, and a roof dresses itself long before the triggers
 * are written.
 */
export const RINGS = {
  ladder: { x: COLS[1].c, z: ROWS[2].c, y: HEIGHT[2][1] },
  stacks: { x: COLS[3].c, z: ROWS[2].c, y: HEIGHT[2][3] },
};
for (const r of Object.values(RINGS)) {
  LANES.push({ x0: r.x, z0: r.z, x1: r.x, z1: r.z, half: 11 });
}
const laneDist = (n: Lane, x: number, z: number) => {
  const dx = n.x1 - n.x0;
  const dz = n.z1 - n.z0;
  const t = Math.max(0, Math.min(1,
    ((x - n.x0) * dx + (z - n.z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (n.x0 + dx * t), z - (n.z0 + dz * t));
};

/** Clear lane round the perimeter, so nothing ever stands on a launch edge. */
const EDGE_CLEAR = 9;
/**
 * And a clear disc in the MIDDLE, which matters just as much and is easier to
 * forget. The centre of a roof is where you come down from a grapple, a
 * thruster hop or a slam, and it is where a checkpoint ring goes — the first
 * pass built a plant house right on top of one.
 */
const CENTRE_CLEAR = 7;
/** Plant positions as angles round the deck, one entry per housing. */
const PLANT_SPOTS: readonly (readonly number[])[] = [
  [0.6, 3.5], [1.9, 4.8], [2.6], [0.3, 2.3, 4.4], [3.9], [1.2, 4.1],
];

/** Does a footprint of this size fit between the two exclusions? */
/** Clear of the launch lane round the edge. Never negotiable. */
const fitsEdge = (r: Roof, x: number, z: number, foot: number) =>
  Math.abs(x - r.cx) + foot / 2 <= r.w / 2 - EDGE_CLEAR
  && Math.abs(z - r.cz) + foot / 2 <= r.d / 2 - EDGE_CLEAR;
/** Clear of every lane the route runs down. Also never negotiable. */
const clearOfLanes = (x: number, z: number, foot: number) =>
  LANES.every((n) => laneDist(n, x, z) - foot / 2 >= n.half);
/** All three, including the preference for a clear middle. */
const fits = (r: Roof, x: number, z: number, foot: number) =>
  fitsEdge(r, x, z, foot) && clearOfLanes(x, z, foot)
  && Math.hypot(x - r.cx, z - r.cz) - foot / 2 >= CENTRE_CLEAR;

function furnish(r: Roof, k: number) {
  for (const [j, ang] of PLANT_SPOTS[hash(k) % PLANT_SPOTS.length].entries()) {
    // The biggest housing the deck has room for. Insisting on one size meant
    // only the full-width slabs got any plant at all and two thirds of the
    // roofscape stayed bare — a twin's half-block is 24 m across, and a 10 m
    // housing with a 9 m lane either side of it does not go on that.
    let hw = 0;
    let hh = 0;
    let hd = 0;
    let outX = 0;
    let outZ = 0;
    for (let t = 0; t < HOUSING.length; t++) {
      const [cw, ch, cd] = HOUSING[(hash(k * 7 + j) + t) % HOUSING.length];
      const cf = Math.max(cw, cd);
      const ox = r.w / 2 - EDGE_CLEAR - cf / 2;
      const oz = r.d / 2 - EDGE_CLEAR - cf / 2;
      if (ox >= 0 && oz >= 0) { hw = cw; hh = ch; hd = cd; outX = ox; outZ = oz; break; }
    }
    if (!hw) continue;
    const foot = Math.max(hw, hd);
    // Prefer to sit off-centre and leave the middle of the deck to land on, but
    // give that up before giving up the plant: on a narrow roof the clear
    // middle and the clear edge cannot both have their full width.
    const wantX = Math.min(CENTRE_CLEAR + foot / 2, outX);
    const wantZ = Math.min(CENTRE_CLEAR + foot / 2, outZ);
    const px = r.cx + Math.cos(ang) * (wantX + (outX - wantX) * 0.7);
    const pz = r.cz + Math.sin(ang) * (wantZ + (outZ - wantZ) * 0.7);
    if (!fitsEdge(r, px, pz, foot) || !clearOfLanes(px, pz, foot)) continue;

    // The housing itself is a volume. What makes it machinery is the cap: a
    // fan on the roof of it and a vent on the flank, both at true size, which
    // also tells your eye how big the housing is.
    box([px, r.top + hh / 2, pz], [hw, hh, hd], FURN);
    prop('Prop_Fan_Small', px, r.top + hh, pz);
    const sgn = hash(k + j) % 2 ? 1 : -1;
    wallProp(pick(PLATES, k + j), 0, sgn, px, r.top + hh * 0.45, pz + sgn * (hd / 2));

    // Units crowded against the housing, tangentially — a cluster jammed up
    // against a plant room looks used, where the same objects spaced out on an
    // empty deck look placed.
    const tx = -Math.sin(ang);
    const tz = Math.cos(ang);
    let along = foot / 2 + 0.6;
    for (let u = 0; u < 3; u++) {
      const um = pick(UNITS, k * 31 + j * 5 + u);
      const us = sciBox(um);
      const ux = px + tx * (along + us[0] / 2);
      const uz = pz + tz * (along + us[0] / 2);
      along += us[0] + 0.4;
      const uf = Math.max(us[0], us[2]);
      if (!fitsEdge(r, ux, uz, uf) || !clearOfLanes(ux, uz, uf)) continue;
      prop(um, ux, r.top, uz, (hash(k + u * 3) % 4) * HALF_PI);
    }
  }

  // A service line across the deck, off to one side of the clear middle, and a
  // number painted on it. A numbered deck is somewhere; an unnumbered deck is a
  // surface, and this map has fifty of them.
  const pl = Math.min(r.w, r.d) * 0.4;
  const off = r.w / 2 - EDGE_CLEAR - 2;
  const px = r.cx + (hash(k * 3) % 2 ? off : -off);
  if (pl > 6 && off > CENTRE_CLEAR && fits(r, px, r.cz, Math.max(pl, 2))) {
    const ps = sciBrush('Prop_PipeHolder');
    skinned([px, r.top + ps[1] / 2, r.cz], [pl, ps[1], ps[2]], PROP_C, 'Prop_PipeHolder',
      axisAngle(0, 1, 0, HALF_PI));
  }
  if (r.w > 26 && r.d > 26) {
    const n = pick(DIGITS, k);
    decal(n, r.cx, r.top, r.cz + r.d / 2 - 5, 0, 3);
    decal(pick(MARKS, k * 5), r.cx - 5, r.top, r.cz + r.d / 2 - 5, 0, 2);
  }
}

/**
 * A mast: the highest thing on a block, a grapple anchor you can pick out from
 * the far side of the district, and — with a beacon on it — the thing that
 * makes a skyline read as a skyline at night rather than as a row of stumps.
 */
function mast(r: Roof, k: number) {
  const sx = hash(k + 1) % 2 ? 1 : -1;
  const sz = hash(k + 2) % 2 ? 1 : -1;
  const x = r.cx + sx * (r.w / 2 - 3);
  const z = r.cz + sz * (r.d / 2 - 3);
  if (LANES.some((n) => laneDist(n, x, z) < n.half + 1)) return;
  // A 10 m stack at its modelled size, and a taller variant on some roofs by
  // scaling the whole thing rather than pulling one axis — which is the
  // difference between a bigger mast and a smeared one.
  const scale = 1 + (hash(k) % 3) * 0.35;
  prop('Column_Large_Straight', x, r.top, z, (hash(k * 3) % 2) * HALF_PI, scale);
  prop('Prop_Light_Floor', x - sx * 2.2, r.top, z, sx > 0 ? HALF_PI : -HALF_PI);
}

/**
 * Bands round a mass: a base course, service bands up the height, and a cornice
 * under the roof. This is the cheapest thing in the whole art pass and close to
 * the most effective — a box with a foot and a cap reads as a building, a bare
 * box reads as a box.
 *
 * One brush does all four faces at once. The part buried inside the mass is
 * redundant and harmless, where four separate strips per band would triple the
 * collider count of the district for exactly the same silhouette.
 */
const PLINTH = 5.5;
function facade(r: Roof, from = 0) {
  if (from === 0) box([r.cx, PLINTH / 2, r.cz], [r.w + 0.16, PLINTH, r.d + 0.16], PLINTH_C);
  for (let y = Math.max(from, PLINTH) + 8.5; y < r.top - 4.5; y += 8.5) {
    box([r.cx, y, r.cz], [r.w + 0.5, 1.1, r.d + 0.5], TRIM);
  }
  // Stops just under the deck. A lip that rose ABOVE the roof would be a thing
  // to catch a slide on at every launch edge on the map.
  const capTop = r.top - DECK_T - 0.05;
  if (capTop - from > 3) box([r.cx, capTop - 0.8, r.cz], [r.w + 0.7, 1.6, r.d + 0.7], TRIM);
}

// --- the blocks --------------------------------------------------------------

for (let ri = 0; ri < ROWS.length; ri++) {
  for (let ci = 0; ci < COLS.length; ci++) {
    const kind = KIND[ri][ci];
    if (kind === 'yard' || kind === 'plaza' || kind === 'spire') continue;
    const top = HEIGHT[ri][ci];
    const R = ROWS[ri], C = COLS[ci];
    const k = ri * COLS.length + ci;

    if (kind === 'slab') {
      const r = mass(C.c, R.c, C.size, R.size, top);
      facade(r);
      furnish(r, k);
      mast(r, k);
    } else if (kind === 'step') {
      // Base to just over half height at the full footprint, then set back. The
      // ring left behind is a real ledge: a lap of the building at mid height,
      // and somewhere to land when you come up short of the roof.
      const mid = Math.round(top * 0.55 * 2) / 2;
      facade(mass(C.c, R.c, C.size, R.size, mid));
      const r = mass(C.c, R.c, C.size - SETBACK * 2, R.size - SETBACK * 2, top);
      facade(r, mid);
      furnish(r, k);
      mast(r, k);
    } else if (kind === 'twin') {
      // Two masses with a shaft between them. The slot runs north–south on even
      // blocks and east–west on odd ones, so the city has climbable shafts
      // facing both ways rather than a grain.
      const ns = (ri + ci) % 2 === 0;
      const full = ns ? C.size : R.size;
      const half = (full - SLOT) / 2;
      for (const s of [-1, 1]) {
        const off = s * (SLOT / 2 + half / 2);
        const r = ns
          ? mass(C.c + off, R.c, half, R.size, top)
          : mass(C.c, R.c + off, C.size, half, top);
        facade(r);
        if (s > 0) { furnish(r, k); mast(r, k); }
      }
    } else {
      // A tall mass over most of the block with a low wing beside it: a landing
      // pad at half height for anyone who came up short of the roof, and a step
      // up onto it for anyone arriving from below.
      const east = (ri + ci) % 2 === 0;
      const wingW = Math.round(C.size * 0.34);
      const mainW = C.size - wingW;
      const r = mass(C.c + (east ? -wingW / 2 : wingW / 2), R.c, mainW, R.size, top);
      const w = mass(C.c + (east ? mainW / 2 : -mainW / 2), R.c, wingW, R.size,
        Math.round(top * 0.45 * 2) / 2);
      facade(r);
      facade(w);
      furnish(r, k);
      furnish(w, k + 2);
      mast(r, k);
    }
  }
}

// --- frontage -----------------------------------------------------------------
// Detail costs draw calls, so it goes where the eye goes: the two avenues the
// route runs down, at the height a person stands. Everything else gets its
// bands and its roof machinery and is read at distance — which is how a real
// district looks from ten storeys up anyway.

interface Face { x: number; z: number; nx: number; nz: number; along: 'x' | 'z'; len: number }

function frontage(f: Face, k: number) {
  // Clad the ground storey. The pack is modular on a 4 m grid, so the panels go
  // on as panels — at double size, which is a uniform scale and therefore not a
  // distortion, and which turns thirteen tiles a face into seven.
  const PANEL = 8;
  const tiles = Math.floor(f.len / PANEL);
  const pad = (f.len - tiles * PANEL) / 2;
  for (let i = 0; i < tiles; i++) {
    const t = -f.len / 2 + pad + PANEL * (i + 0.5);
    const cx = f.along === 'x' ? f.x + t : f.x;
    const cz = f.along === 'z' ? f.z + t : f.z;
    clad(pick(CLAD, k * 3 + i), f.nx, f.nz, cx, 0, cz, 2);
  }

  // Then the things that give it scale. A 30 m mass has no size at all until
  // there is a 4 m door on it; after that your eye reads the whole street.
  const n = Math.max(2, Math.round(f.len / 13));
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n - 0.5) * f.len;
    const ax = f.along === 'x' ? f.x + t : f.x;
    const az = f.along === 'z' ? f.z + t : f.z;
    switch (hash(k * 17 + i) % 4) {
      case 0: wallProp('Door_Frame_Square', f.nx, f.nz, ax, 0, az); break;
      case 1: wallProp('Prop_Light_Wide', f.nx, f.nz, ax, 4.4, az, 1.6); break;
      case 2: wallProp('Door_Metal', f.nx, f.nz, ax, 0, az); break;
      default: wallProp(pick(PLATES, k + i), f.nx, f.nz, ax, 3.6, az, 1.4); break;
    }
  }
  // One service run above the cladding. It reads as plumbing, and the ledge it
  // leaves is a metre of something to land on halfway up a blank wall.
  wallRun('Prop_PipeHolder', f.nx, f.nz, f.x, 6.6, f.z, f.len * 0.72);
}

/**
 * Does this block present an unbroken wall along the given axis?
 *
 * A twin's slot cuts clean through two of its four faces, and a lamp hung over
 * that gap is a lamp standing on nothing — which is the one thing this level
 * does not do.
 */
function solidFace(ri: number, ci: number, axis: 'x' | 'z') {
  const kind = KIND[ri][ci];
  if (kind === 'yard' || kind === 'plaza' || kind === 'spire') return false;
  if (kind !== 'twin') return true;
  return (ri + ci) % 2 === 0 ? axis === 'z' : axis === 'x';
}

for (let ci = 0; ci < COLS.length; ci++) {
  const C = COLS[ci];
  if (solidFace(1, ci, 'x')) {
    frontage({ x: C.c, z: ROWS[1].hi, nx: 0, nz: 1, along: 'x', len: C.size }, 100 + ci);
  }
  if (solidFace(2, ci, 'x')) {
    frontage({ x: C.c, z: ROWS[2].lo, nx: 0, nz: -1, along: 'x', len: C.size }, 200 + ci);
  }
}
for (let ri = 0; ri < ROWS.length; ri++) {
  const R = ROWS[ri];
  if (solidFace(ri, 1, 'z')) {
    frontage({ x: COLS[1].hi, z: R.c, nx: 1, nz: 0, along: 'z', len: R.size }, 300 + ri);
  }
  if (solidFace(ri, 2, 'z')) {
    frontage({ x: COLS[2].lo, z: R.c, nx: -1, nz: 0, along: 'z', len: R.size }, 400 + ri);
  }
}

// --- crossings ----------------------------------------------------------------
// Pipes and catwalks strung across the alleys. Two jobs at once: they tie the
// blocks to one another, which is most of what makes a set of buildings read as
// a district rather than as neighbours who have never met, and every one of
// them is another way across that is not a jump.

/** A pipe run bridging an alley, on its brackets. */
function pipeAcross(x: number, y: number, z: number, along: 'x' | 'z', len: number) {
  const ps = sciBrush('Prop_PipeHolder');
  skinned([x, y + ps[1] / 2, z], [len, ps[1], ps[2]], PROP_C, 'Prop_PipeHolder',
    along === 'x' ? undefined : axisAngle(0, 1, 0, HALF_PI));
}

/** A catwalk across an alley, with a rail down each side. */
function catwalk(x: number, y: number, z: number, along: 'x' | 'z', len: number) {
  const w = 3.6;
  // Size the deck along the world axis it spans. Swapping the size AND turning
  // the brush applies the rotation twice, which lays the catwalk across the
  // alley it was meant to bridge.
  box([x, y - 0.4, z], along === 'x' ? [len, 0.8, w] : [w, 0.8, len], ROAD);
  for (const sgn of [-1, 1]) {
    const ox = along === 'x' ? 0 : sgn * (w / 2 - 0.1);
    const oz = along === 'x' ? sgn * (w / 2 - 0.1) : 0;
    railAlong(along, x + ox, y, z + oz, len - 2);
  }
}

/**
 * The height at which a block's OUTER wall stops. Below it there is something
 * to land a bridge on; above it there may be only the air over a setback.
 */
function edgeTop(ri: number, ci: number): number {
  const kind = KIND[ri][ci];
  const top = HEIGHT[ri][ci];
  if (kind === 'slab' || kind === 'twin') return top;
  if (kind === 'step') return Math.round(top * 0.55 * 2) / 2;
  if (kind === 'wing') return Math.round(top * 0.45 * 2) / 2;
  return 0;
}

for (let ri = 0; ri < ROWS.length; ri++) {
  for (const ci of [0, 2, 4]) {
    const ea = edgeTop(ri, ci);
    const eb = edgeTop(ri, ci + 1);
    if (ea < 8 || eb < 8) continue;
    const x0 = COLS[ci].hi;
    const x1 = COLS[ci + 1].lo;
    const k = hash(ri * 31 + ci * 7);
    const z = ROWS[ri].c + ((k >>> 5) % 25) - 12;
    if (k % 3 === 0) catwalk((x0 + x1) / 2, Math.min(ea, eb), z, 'x', x1 - x0 + 2.5);
    else pipeAcross((x0 + x1) / 2, 5 + (k % 3) * 4.5, z, 'x', x1 - x0 + 2.5);
  }
}
for (let ci = 0; ci < COLS.length; ci++) {
  for (const ri of [0, 2]) {
    const ea = edgeTop(ri, ci);
    const eb = edgeTop(ri + 1, ci);
    if (ea < 8 || eb < 8) continue;
    const z0 = ROWS[ri].hi;
    const z1 = ROWS[ri + 1].lo;
    const k = hash(ci * 41 + ri * 11 + 5);
    const x = COLS[ci].c + ((k >>> 5) % 25) - 12;
    if (k % 3 === 0) catwalk(x, Math.min(ea, eb), (z0 + z1) / 2, 'z', z1 - z0 + 2.5);
    else pipeAcross(x, 5 + (k % 3) * 4.5, (z0 + z1) / 2, 'z', z1 - z0 + 2.5);
  }
}

// --- the ground --------------------------------------------------------------
// A real floor under the whole district. A fall costs you the climb back, not
// the run, and the streets between the blocks are the only place on the map
// long enough to reach momentum.hardCap on foot.

const PAVE = 18;
box([0, -BASE / 2, 0],
  [EXTENT.x1 - EXTENT.x0 + PAVE * 2, BASE, EXTENT.z1 - EXTENT.z0 + PAVE * 2], STREET);

// --- the edge of the world ----------------------------------------------------
// The district sits on a plate, and a plate has a rim.
//
// Without one the Chute throws you clean off the west side: you cross the last
// roof at 44 u/s, land in the Yard with the slide still under you, and 18 m of
// pavement is under half a second of that. The solver run went off the edge of
// the world every time. A rim also gives the outermost blocks a facing wall to
// come back off, and it is the thing that makes the district read as somewhere
// with a boundary rather than as geometry that stops.
const RIM_H = 8;
const rimX = (EXTENT.x1 - EXTENT.x0) / 2 + PAVE - 1;
const rimZ = (EXTENT.z1 - EXTENT.z0) / 2 + PAVE - 1;
for (const s of [-1, 1]) {
  box([s * rimX, (RIM_H - BASE) / 2, 0], [2, RIM_H + BASE, rimZ * 2 + 2], MASS_LOW);
  box([0, (RIM_H - BASE) / 2, s * rimZ], [rimX * 2 + 2, RIM_H + BASE, 2], MASS_LOW);
}

/**
 * Container stacks: knee-high ones to vault at speed, chest-high ones to jump,
 * and a few tall enough to run along. Laid in LINES down a street rather than
 * sprinkled, because a line is something you can read at 30 u/s and a sprinkle
 * is something you trip over.
 */
function crates(x: number, z: number, along: 'x' | 'z', n: number, step: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const t = (seed + i * 7) % 5;
    const h = [1.2, 1.8, 2.6, 1.2, 3.4][t];
    const w = [5, 4, 6, 7, 5][t];
    const d = [4, 5, 4, 4, 6][t];
    const px = along === 'x' ? x + i * step : x + ((i % 2) - 0.5) * 3;
    const pz = along === 'z' ? z + i * step : z + ((i % 2) - 0.5) * 3;
    box([px, h / 2, pz], [w, h, d], CRATE);
    // A drum or a crate at true size on top of each stack. The container is a
    // volume; the thing standing on it is what tells you how big the volume is.
    prop(pick(UNITS, seed * 13 + i), px + w * 0.2, h, pz, (hash(seed + i) % 4) * HALF_PI);
  }
}

// --- the Yard ----------------------------------------------------------------
// Where you start: ground level, 54 × 52, open to two streets, with the Ladder
// standing in its east end. The run-up matters — the lane down the middle is
// left clear so you arrive at the corridor mouth above wall.minSpeed (5) with a
// slide already under you.

const YARD_X = COLS[0].c;
const YARD_Z = ROWS[2].c;

crates(YARD_X - 20, YARD_Z + 17, 'x', 4, 9, 1);
crates(YARD_X - 22, YARD_Z - 17, 'x', 3, 10, 3);
// A low deck at the north side with a ramp onto it: the first thing to slide off.
const yardDeck = mass(YARD_X - 6, YARD_Z - 19, 22, 12, 4.5);
ramp({ x: YARD_X - 24, y: 0, z: YARD_Z - 19 }, { x: YARD_X - 17, y: 4.5, z: YARD_Z - 19 },
  10, 1.2, TIER, 3);

// This is the first place the player ever stands, and the only place they see
// the district from the ground before the roofs take over — so it carries more
// of the kit than anywhere else on the map. Lamps down both sides, a rail along
// the low deck, and a stack of units in the corner.
for (let i = 0; i < 4; i++) {
  const x = YARD_X - 22 + i * 13;
  prop('Column_Round', x, 0, YARD_Z + 24);
  prop('Prop_Light_Floor', x + 1.2, 0, YARD_Z + 24, HALF_PI);
  // The north row skips where the low deck is. A 5 m column planted inside a
  // 4.5 m platform does not stand beside it — it comes up through the floor.
  if (Math.abs(x - yardDeck.cx) > yardDeck.w / 2 + 1.5) {
    prop('Column_Round', x, 0, YARD_Z - 24);
    prop('Prop_Light_Floor', x + 1.2, 0, YARD_Z - 24, HALF_PI);
  }
}
{
  railAlong('x', yardDeck.cx, yardDeck.top, yardDeck.cz - yardDeck.d / 2 + 1.6,
    yardDeck.w - 8);
  prop('Prop_Computer', yardDeck.cx + 7, yardDeck.top, yardDeck.cz + 2);
  prop('Prop_Barrel_Large', yardDeck.cx + 4.5, yardDeck.top, yardDeck.cz + 2);
  prop('Prop_Crate4', yardDeck.cx - 8, yardDeck.top, yardDeck.cz);
}
// The finish line, painted where the run actually ends.
decal('Decal_Logo', YARD_X + 8, 0, YARD_Z + 12, 0, 5);
decal('Decal_Line_Straight', YARD_X - 4, 0, YARD_Z + 12, HALF_PI, 4);

// --- the Ladder --------------------------------------------------------------
// A walled corridor off the Yard, closed at its east end by the flank of the
// block behind it. Two facing walls SLOT apart and 26 m long — long enough that
// a wallrun has somewhere to go before the far end arrives.

const LADDER_LEN = 26;
const LADDER_TOP = HEIGHT[2][1];
export const LADDER_X = COLS[1].lo - LADDER_LEN / 2;
const ladderX = LADDER_X;
// Left as flat amber, on purpose. Amber means "run along this" on both maps in
// this game, and a texture over the top of a colour that carries a rule is a
// texture that costs you the rule.
for (const s of [-1, 1]) {
  box([ladderX, (LADDER_TOP - BASE) / 2, YARD_Z + s * (SLOT / 2 + 0.7)],
    [LADDER_LEN, LADDER_TOP + BASE, 1.4], WALLRUN);
}
export const LADDER_LANDINGS = shaftLedges('x', ladderX, YARD_Z, LADDER_LEN, 0, LADDER_TOP);
export const LADDER_STAGES = LADDER_LANDINGS.length + 1;
// A lamp on every landing. A shaft you climb in the dark is a shaft you climb
// once; lighting the flights is what tells you there is another one above.
for (const l of LADDER_LANDINGS) {
  prop('Prop_Light_Floor', l.x, l.y, YARD_Z + (SLOT / 2 - 0.8) * (l.x > ladderX ? 1 : -1));
}
// Signed just inside the mouth, so it reads as a way up rather than an alley.
// On the INNER faces: the end of a wall is a 1.4 m strip of nothing to hang a
// sign on, and a sign hung there is a sign standing in mid-air.
wallProp('Prop_AccessPoint', 0, -1, ladderX - LADDER_LEN / 2 + 4, 3.2, YARD_Z + SLOT / 2, 1.6);
wallProp('Prop_Light_Wide', 0, 1, ladderX - LADDER_LEN / 2 + 9, 4.4, YARD_Z - SLOT / 2, 1.6);
// A lintel over the mouth: something to grapple, and it stops the corridor
// reading as a dead end from the far side of the Yard.
box([ladderX - LADDER_LEN / 2 + 0.6, LADDER_TOP + 1.2, YARD_Z], [1.2, 2.4, SLOT + 4], GANTRY);

// --- the Overpass ------------------------------------------------------------
// 300 m of elevated deck straight down the widest avenue, falling 20 m from
// north to south. Six segments; the five gaps are one of each tier, smallest at
// the north end. Southbound every one is downhill, which is what makes this the
// fast lane — you never have to rebuild the speed you arrived with.

const OP_X = (COLS[3].hi + COLS[4].lo) / 2;
const OP_W = 16;
const OP_T = 1.6;
/** Deck height at a given z. */
export const opY = (z: number) => 30 - (z / 140) * 10;

/**
 * Six segments, five gaps, one of each tier and smallest at the north end. The
 * sizes are the budgets, not round numbers — which is why the widest one has a
 * gantry over it: at 95% of a full slide-jump-plus-double it is inside the
 * budget southbound, where it is downhill, and outside it coming back the other
 * way up the slope. That asymmetry is the point of building the road on a tilt.
 */
const OP_GAPS = [
  Math.round(GAP.hop * 0.8),    // a hop
  Math.round(GAP.hop),          // a hop with nothing to spare
  Math.round(GAP.span),         // a slide jump
  Math.round(GAP.hop),
  Math.round(GAP.super * 0.95), // grapple it, gas it, or arrive very fast
];
export const OP_SEGS: [number, number][] = (() => {
  const lens = [34, 36, 28, 34, 32, 48];
  const out: [number, number][] = [];
  let z = -150;
  for (let i = 0; i < lens.length; i++) {
    out.push([z, z + lens[i]]);
    z += lens[i] + (OP_GAPS[i] ?? 0);
  }
  return out;
})();

for (const [z0, z1] of OP_SEGS) {
  const seg = ramp({ x: OP_X, y: opY(z0), z: z0 }, { x: OP_X, y: opY(z1), z: z1 },
    OP_W, OP_T, ROAD, 0);
  // Railings down both edges, stopped 6 m short of each end. A rail across the
  // lip of a jump reads as a wall, and every one of these ends is a jump.
  {
    const rl = seg.len - 12;
    // The rail's length is its own Z, and the segment already runs along Z —
    // so unlike a catwalk this one needs no quarter turn, only the ramp's own
    // pitch. Composing a turn it does not need is how you get a handrail lying
    // across the road instead of down it.
    if (rl > 8) {
      for (const sgn of [-1, 1]) {
        railAlong('z', OP_X + sgn * (OP_W / 2 - 0.4), (opY(z0) + opY(z1)) / 2,
          (z0 + z1) / 2, rl, seg.q);
      }
    }
    // Centre line, so 300 m of deck reads as a road. It takes the segment's own
    // rotation: laid flat at the midpoint height instead, a marking on a road
    // that falls 3 m over its length is buried at one end and a metre in the
    // air at the other.
    {
      const ds = sciBrush('Decal_Line_Straight');
      skinned([OP_X, (opY(z0) + opY(z1)) / 2 + 0.05, (z0 + z1) / 2],
        [ds[0], ds[1], seg.len - 4], PROP_C, 'Decal_Line_Straight', seg.q);
    }
  }
  // Pylons, into the avenue floor. The deck runs down the middle of a 24 m
  // street, so nothing holding it up is ever in a running lane.
  for (const f of [0.25, 0.75]) {
    const z = z0 + (z1 - z0) * f;
    const top = opY(z) - OP_T;
    box([OP_X, (top - BASE) / 2, z], [4.5, top + BASE, 4.5], MAST);
  }
}

// Gantries over the two widest gaps: a beam high enough that hooking it drops
// you into a swing rather than a climb, with a leg either side of the deck.
for (const [z0, z1] of [
  [OP_SEGS[2][1], OP_SEGS[3][0]],
  [OP_SEGS[4][1], OP_SEGS[5][0]],
] as const) {
  const zc = (z0 + z1) / 2;
  const y = opY(zc);
  const legOff = OP_W / 2 + 3.4;
  // Cross-arm first: without it the beam hangs between its legs touching
  // neither, which is exactly the floating-scenery look this level is trying
  // not to have.
  box([OP_X, y + 15, zc], [legOff * 2 + 2.4, 1.4, 2.4], GANTRY);
  box([OP_X, y + 15, zc], [3, 1.6, z1 - z0 + 26], GANTRY);
  for (const s of [-1, 1]) {
    box([OP_X + s * legOff, (y + 15 - BASE) / 2, zc], [2.4, y + 15 + BASE, 2.4], MAST);
  }
}

// Slip roads. An elevated road with no on-ramps is a road you can only fall
// off, so it is tied into the roofscape at three points down its length.
{
  // North, up from the Spire's terrace.
  ramp({ x: COLS[3].hi - 9, y: 30, z: -74 },
    { x: OP_X - OP_W / 2 - 1, y: opY(-74), z: -74 }, 10, 1.2, ROAD, 3);
  // Middle. This is the route's own on-ramp, so it is the long shallow one —
  // shallow enough that a slide carries up it instead of dying on it.
  ramp({ x: COLS[3].c, y: HEIGHT[2][3], z: 10 },
    { x: OP_X - OP_W / 2 - 1, y: opY(10), z: 10 }, 10, 1.2, ROAD, 3);
  // South: the deck has fallen to roof height by here, so it is only a bridge.
  const z = 138;
  box([(COLS[3].hi + OP_X - OP_W / 2) / 2, opY(z) - OP_T / 2, z],
    [OP_X - OP_W / 2 - COLS[3].hi + 2, OP_T, 12], ROAD);
}

// --- the Spire ---------------------------------------------------------------
// The landmark, and the only place on the map where the height is not
// negotiable. Base to 30 so the surrounding roofs and the Overpass all meet its
// terrace, tower to 76, and three separate ways up — a single-solution climb in
// a movement game is a lock, not a challenge.

mass(COLS[3].c, ROWS[1].c, COLS[3].size, ROWS[1].size, TERRACE);
mass(TOWER_X, TOWER_Z, TOWER_W, TOWER_D, SPIRE_TOP);

// Route 1 — the balconies. One thruster tank is TANK metres of climb, so the
// steps are 65% of that: enough slack to arrive, land, and refuel before the
// next. They spiral a quarter turn each, so the climb reads as a route round
// the building rather than a ladder up one face.
const STEP = Math.round(TANK * 0.65 * 2) / 2;
export const BALCONIES = Math.max(2, Math.floor((SPIRE_TOP - TERRACE - 6) / STEP));
// East, south, north — never west. The west face is the shaft's, and a balcony
// hung across it would put a floor in the middle of the climb.
const BALCONY_FACES = [0, 1, 3];
/** Where each one actually ended up, so the climb can be measured not assumed. */
export const BALCONY_AT: { x: number; y: number; z: number }[] = [];
for (let i = 0; i < BALCONIES; i++) {
  const y = TERRACE + STEP * (i + 1);
  const face = BALCONY_FACES[i % BALCONY_FACES.length];
  const out = 6.5;
  const along = (((i * 0.37) % 1) - 0.5) * 0.5;
  const ew = face === 0 || face === 2;
  const sign = face === 0 || face === 1 ? 1 : -1;
  const px = ew ? TOWER_X + sign * (TOWER_W / 2 + out / 2) : TOWER_X + along * TOWER_W;
  const pz = ew ? TOWER_Z + along * TOWER_D : TOWER_Z + sign * (TOWER_D / 2 + out / 2);
  const sw = ew ? out + 5 : 11;
  const sd = ew ? 11 : out + 5;
  box([px, y - 0.7, pz], [sw, 1.4, sd], PAD);
  BALCONY_AT.push({ x: px, y, z: pz });
  // A lamp and a cabinet on each: something to aim at on the way up, and the
  // reason the tower reads as serviced rather than sculpted.
  prop('Prop_Light_Floor', px + (ew ? 0 : sign * 3.5), y, pz + (ew ? sign * 3.5 : 0),
    ew ? 0 : HALF_PI);
  prop('Prop_AccessPoint', px - (ew ? sign * 1.4 : 0), y, pz - (ew ? 0 : sign * 1.4));
  decal(pick(DIGITS, i + 1), px, y, pz, 0, 1.6);
  // A corbel under the inner half, overlapping the tower, so a balcony is held
  // up by the building rather than by nothing.
  box([px - (ew ? sign * out * 0.3 : 0), y - 3.6, pz - (ew ? 0 : sign * out * 0.3)],
    [sw * 0.62, 4.4, sd * 0.62], TIER);
}

// Route 2 — the shaft, which is the gap between the tower and its service core.
//
// The first version of this was a pair of fins projecting 9 m off the west
// face, and it did not work: a wallrun needs somewhere to RUN, and 9 m of
// travel is over before you have attached. Standing a second building beside
// the first turns the same idea through ninety degrees — now the shaft runs the
// full 34 m depth of the face, which is a run, and both of its walls are the
// side of something that reaches the ground.
//
// The core stops at 58, two thirds of the way up. That is deliberate: the shaft
// hands you off to the balconies or the grapple for the last stretch instead of
// being a single solution that carries you all the way.
export const CORE_TOP = 58;
const coreX0 = COLS[3].lo;
const coreX1 = TOWER_X - TOWER_W / 2 - SLOT;
const core = mass((coreX0 + coreX1) / 2, TOWER_Z, coreX1 - coreX0, TOWER_D, CORE_TOP);
furnish(core, 3);
export const SHAFT_X = (coreX1 + TOWER_X - TOWER_W / 2) / 2;
export const SPIRE_LANDINGS =
  shaftLedges('z', SHAFT_X, TOWER_Z, TOWER_D, TERRACE, CORE_TOP);
export const SPIRE_SHAFT_STAGES = SPIRE_LANDINGS.length + 1;

// Route 3 is the grapple, and it needs nothing built for it but something to
// aim at: four masts on the crown, the highest things on the map.
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    box([TOWER_X + sx * (TOWER_W / 2 - 3), SPIRE_TOP + 11, TOWER_Z + sz * (TOWER_D / 2 - 3)],
      [1.4, 22, 1.4], MAST);
  }
}
box([TOWER_X, SPIRE_TOP + 4, TOWER_Z], [7, 8, 7], GANTRY);
prop('Column_Pipes', TOWER_X, SPIRE_TOP + 8, TOWER_Z);
for (const sx of [-1, 1]) prop('Prop_Light_Floor', TOWER_X + sx * 5, SPIRE_TOP, TOWER_Z);
// The top of the map, marked as the top of the map.
decal('Decal_Logo', TOWER_X, SPIRE_TOP, TOWER_Z + 11, 0, 6);

// --- the Chute ---------------------------------------------------------------
// The way down, and the reward for the climb. From the crown's south-west
// corner straight across the district on pylons, landing on the roof the Ladder
// tops out on. There is no holding back on it: you arrive at momentum.hardCap,
// cross the last roof and leave its west edge into the Yard.

const CHUTE_W = 16;
const chute = ramp(CHUTE_FROM, CHUTE_TO, CHUTE_W, 1.6, CHUTE_C, 12);

// Rails, so a slide that drifts does not simply leave. Trimmed at both ends: one
// across the entry is a wall you hit at the top, and one carried all the way
// down stands on the landing roof as a slab across the running line.
{
  const dir = {
    x: Math.sin(chute.yaw) * Math.cos(chute.climb),
    y: Math.sin(chute.climb),
    z: Math.cos(chute.yaw) * Math.cos(chute.climb),
  };
  const TRIM_TOP = 8, TRIM_END = 30;
  const len = chute.len - TRIM_TOP - TRIM_END;
  const shift = (TRIM_TOP - TRIM_END) / 2;
  const mid = {
    x: (CHUTE_FROM.x + CHUTE_TO.x) / 2 - dir.x * shift,
    y: (CHUTE_FROM.y + CHUTE_TO.y) / 2 - dir.y * shift,
    z: (CHUTE_FROM.z + CHUTE_TO.z) / 2 - dir.z * shift,
  };
  for (const s of [-1, 1]) {
    const wx = mid.x + Math.cos(chute.yaw) * s * (CHUTE_W / 2 + 0.6);
    const wz = mid.z - Math.sin(chute.yaw) * s * (CHUTE_W / 2 + 0.6);
    box([wx, mid.y + 2.2, wz], [1.2, 5, len], WALLRUN, chute.q);
    // A handrail along the top of each wall — the one piece of kit that makes
    // 145 m of violet slab read as a structure somebody built. The chute runs
    // along its own local Z, same as a rail does, so it takes the ramp's
    // rotation unchanged.
    railAlong('z', wx, mid.y + 4.7, wz, len, chute.q);
  }
}

// Pylons, dropped to the street. The line is over avenues and alleys the whole
// way by construction, so none of them lands on a roof or in a running lane —
// which the verifier checks rather than trusts.
export const CHUTE_PYLONS = [0.16, 0.36, 0.56, 0.74];
for (const f of CHUTE_PYLONS) {
  const x = CHUTE_FROM.x + (CHUTE_TO.x - CHUTE_FROM.x) * f;
  const y = CHUTE_FROM.y + (CHUTE_TO.y - CHUTE_FROM.y) * f;
  const z = CHUTE_FROM.z + (CHUTE_TO.z - CHUTE_FROM.z) * f;
  box([x, (y - 2 - BASE) / 2, z], [4.5, y - 2 + BASE, 4.5], MAST);
}

// --- the plazas --------------------------------------------------------------
// Two blocks left as open ground, so street level is not one continuous
// corridor. Each gets a pavilion — a low roof on columns, which is a thing to
// run over, a thing to run under, and four pillars to swing round — and a
// facing pair of walls, which is a way out of a plaza that is not the street.

for (let ri = 0; ri < ROWS.length; ri++) {
  for (let ci = 0; ci < COLS.length; ci++) {
    if (KIND[ri][ci] !== 'plaza') continue;
    const C = COLS[ci], R = ROWS[ri];
    const k = ri * COLS.length + ci;
    const pw = 26, pd = 22, ph = 8;
    box([C.c, ph - DECK_T / 2, R.c], [pw, DECK_T, pd], DECK);
    roofs.push({ cx: C.c, cz: R.c, w: pw, d: pd, top: ph });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box([C.c + sx * (pw / 2 - 2), (ph - DECK_T - BASE) / 2, R.c + sz * (pd / 2 - 2)],
          [2.4, ph - DECK_T + BASE, 2.4], TIER);
      }
    }
    for (const s of [-1, 1]) {
      box([C.c + (k % 2 ? 1 : -1) * (C.size / 2 - 12), (16 - BASE) / 2,
        R.c + R.size * 0.28 + s * (SLOT / 2 + 0.7)], [14, 16 + BASE, 1.4], WALLRUN);
    }
    crates(C.c - 18, R.c - R.size * 0.3, 'x', 4, 9, k);
    for (const sx of [-1, 1]) {
      prop('Column_Hollow', C.c + sx * (pw / 2 + 5), 0, R.c);
      prop('Prop_Light_Floor', C.c + sx * (pw / 2 + 5) - sx * 1.3, 0, R.c,
        sx > 0 ? HALF_PI : -HALF_PI);
    }
    prop('Prop_Computer', C.c + 4, ph, R.c);
    prop('Prop_Barrel_Large', C.c + 1.5, ph, R.c);
    decal(pick(MARKS, k), C.c, 0, R.c + R.size * 0.34, 0, 4);
  }
}

// --- street lines ------------------------------------------------------------
// Three of them, and no more. The avenues are the run-up for every roof on the
// map, so they earn their emptiness.

crates(COLS[1].c - 14, (ROWS[3].hi + ROWS[4].lo) / 2, 'x', 5, 11, 2);
crates(COLS[4].c - 20, (ROWS[0].hi + ROWS[1].lo) / 2, 'x', 5, 10, 4);
crates((COLS[1].hi + COLS[2].lo) / 2, ROWS[3].c - 20, 'z', 4, 12, 6);

export { brushes };

// --- the lap -----------------------------------------------------------------
// Checkpoints sit on the surface you arrive at, never over a gap: one you have
// to stop to collect is one that costs you the run.

export const triggers: Trigger[] = [
  { p: [RINGS.ladder.x, RINGS.ladder.y + 3, RINGS.ladder.z], r: 13, kind: 'checkpoint', name: 'ladder' },
  { p: [RINGS.stacks.x, RINGS.stacks.y + 3, RINGS.stacks.z], r: 13, kind: 'checkpoint', name: 'stacks' },
  { p: [OP_X, opY(-74) + 3, -74], r: 11, kind: 'checkpoint', name: 'overpass' },
  { p: [TOWER_X, SPIRE_TOP + 3, TOWER_Z + TOWER_D / 2 - 7], r: 12, kind: 'checkpoint', name: 'crown' },
  // Placed where the descent actually PUTS you, not where the Yard looks tidy.
  // Coming off the last roof at speed you cross the Yard diagonally and touch
  // down around here on both tunes; a finish line you have to walk back to is
  // not a finish line.
  { p: [YARD_X + 8, 3.5, YARD_Z + 12], r: 13, kind: 'goal', name: 'yard' },
];

/** No dummies yet — this is a place to move through first. */
export const enemies: [number, number, number][] = [];

export const spawn = { x: YARD_X - 20, y: 2.4, z: YARD_Z };
/** Facing east, straight down the Yard at the mouth of the Ladder. */
export const spawnYaw = Math.atan2(1, 0) + Math.PI;
/** Below the street, so only leaving the district entirely counts as a fall. */
export const killY = -30;
