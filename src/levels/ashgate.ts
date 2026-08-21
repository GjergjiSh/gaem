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
//      see, so every block on every roof is a thing you can stand on, wallrun
//      along, vault, slam onto or hide behind.
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
// Fall and you land in the street, not on a restart. killY only catches you off
// the edge of the map, because the recovery — pick a wall, climb back — is more
// interesting than a reload, and it is the reason the ground floor is a real
// floor with real furniture on it.

import type { Brush, Trigger } from './types';
import { orient, type Q } from './geom';
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
  return { yaw, climb, len, q, brush };
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

// --- roof furniture ----------------------------------------------------------
// Plant rooms and stair heads: solid blocks 3–7 m tall, so each is a wall to
// run, a lip to vault, and a thing to slam off. Positions are fractions of the
// space left AFTER a clear lane is reserved all the way round the roof, which
// is what keeps one from ever standing on a launch edge.

const EDGE_CLEAR = 9;
type Furn = readonly [number, number, number, number, number]; // fx, fz, w, d, h
const FURN_LAYOUTS: Furn[][] = [
  [[-0.55, 0.45, 9, 7, 4.5], [0.62, -0.5, 7, 9, 6.5]],
  [[0.5, 0.55, 11, 6, 3.5], [-0.6, -0.45, 6, 6, 7]],
  [[0, -0.65, 13, 5, 5], [-0.55, 0.6, 6, 8, 3.5]],
  [[-0.62, -0.5, 8, 8, 6], [0.5, 0.5, 7, 6, 4], [0.6, -0.55, 5, 5, 3]],
  [[0, 0, 10, 10, 5.5]],
];

function furnish(r: Roof, k: number) {
  for (const [fx, fz, bw, bd, bh] of FURN_LAYOUTS[k % FURN_LAYOUTS.length]) {
    const hx = r.w / 2 - EDGE_CLEAR - bw / 2;
    const hz = r.d / 2 - EDGE_CLEAR - bd / 2;
    if (hx <= 0 || hz <= 0) continue;
    box([r.cx + fx * hx, r.top + bh / 2, r.cz + fz * hz], [bw, bh, bd], FURN);
  }
}

/** A mast: a grapple anchor you can pick out from the far side of the map. */
function mast(r: Roof, k: number) {
  const h = 9 + (k % 4) * 3;
  const sx = k % 2 ? 1 : -1;
  const sz = (k >> 1) % 2 ? 1 : -1;
  box([r.cx + sx * (r.w / 2 - 4), r.top + h / 2, r.cz + sz * (r.d / 2 - 4)], [1.2, h, 1.2], MAST);
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
      furnish(r, k);
      mast(r, k);
    } else if (kind === 'step') {
      // Base to just over half height at the full footprint, then set back. The
      // ring left behind is a real ledge: a lap of the building at mid height,
      // and somewhere to land when you come up short of the roof.
      mass(C.c, R.c, C.size, R.size, Math.round(top * 0.55 * 2) / 2);
      const r = mass(C.c, R.c, C.size - SETBACK * 2, R.size - SETBACK * 2, top);
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
      furnish(r, k);
      furnish(w, k + 2);
      mast(r, k);
    }
  }
}

// --- the ground --------------------------------------------------------------
// A real floor under the whole district. A fall costs you the climb back, not
// the run, and the streets between the blocks are the only place on the map
// long enough to reach momentum.hardCap on foot.

const PAVE = 18;
box([0, -BASE / 2, 0],
  [EXTENT.x1 - EXTENT.x0 + PAVE * 2, BASE, EXTENT.z1 - EXTENT.z0 + PAVE * 2], STREET);

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
    box([
      along === 'x' ? x + i * step : x + ((i % 2) - 0.5) * 3,
      h / 2,
      along === 'z' ? z + i * step : z + ((i % 2) - 0.5) * 3,
    ], [w, h, d], CRATE);
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
mass(YARD_X - 6, YARD_Z - 19, 22, 12, 4.5);
ramp({ x: YARD_X - 24, y: 0, z: YARD_Z - 19 }, { x: YARD_X - 17, y: 4.5, z: YARD_Z - 19 },
  10, 1.2, TIER, 3);

// --- the Ladder --------------------------------------------------------------
// A walled corridor off the Yard, closed at its east end by the flank of the
// block behind it. Two facing walls SLOT apart and 26 m long — long enough that
// a wallrun has somewhere to go before the far end arrives.

const LADDER_LEN = 26;
const LADDER_TOP = HEIGHT[2][1];
export const LADDER_X = COLS[1].lo - LADDER_LEN / 2;
const ladderX = LADDER_X;
for (const s of [-1, 1]) {
  skinned([ladderX, (LADDER_TOP - BASE) / 2, YARD_Z + s * (SLOT / 2 + 0.7)],
    [LADDER_LEN, LADDER_TOP + BASE, 1.4], WALLRUN, 'Support_Long');
}
export const LADDER_LANDINGS = shaftLedges('x', ladderX, YARD_Z, LADDER_LEN, 0, LADDER_TOP);
export const LADDER_STAGES = LADDER_LANDINGS.length + 1;
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
  ramp({ x: OP_X, y: opY(z0), z: z0 }, { x: OP_X, y: opY(z1), z: z1 },
    OP_W, OP_T, ROAD, 0, 'Platform_4x4_Empty');
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
    { x: OP_X - OP_W / 2 - 1, y: opY(-74), z: -74 }, 10, 1.2, ROAD, 3, 'Platform_4x4_Empty');
  // Middle. This is the route's own on-ramp, so it is the long shallow one —
  // shallow enough that a slide carries up it instead of dying on it.
  ramp({ x: COLS[3].c, y: HEIGHT[2][3], z: 10 },
    { x: OP_X - OP_W / 2 - 1, y: opY(10), z: 10 }, 10, 1.2, ROAD, 3, 'Platform_4x4_Empty');
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

export const SPIRE_TOP = HEIGHT[1][3];
export const TERRACE = 30;
export const TOWER_W = 32, TOWER_D = 34;
// Shifted east off the block centre to leave a west strip wide enough for the
// service core and the shaft between the two.
export const TOWER_X = COLS[3].c + 3, TOWER_Z = ROWS[1].c;

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
  skinned([px, y - 0.7, pz], [sw, 1.4, sd], PAD, 'Platform_4x4_Empty');
  BALCONY_AT.push({ x: px, y, z: pz });
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

// --- the Chute ---------------------------------------------------------------
// The way down, and the reward for the climb. From the crown's south-west
// corner straight across the district on pylons, landing on the roof the Ladder
// tops out on. There is no holding back on it: you arrive at momentum.hardCap,
// cross the last roof and leave its west edge into the Yard.

export const CHUTE_FROM: P3 = {
  x: TOWER_X - TOWER_W / 2 + 4, y: SPIRE_TOP, z: TOWER_Z + TOWER_D / 2 - 4,
};
export const CHUTE_TO: P3 = { x: COLS[1].c + 9, y: HEIGHT[2][1], z: ROWS[2].c - 16 };
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
    box([
      mid.x + Math.cos(chute.yaw) * s * (CHUTE_W / 2 + 0.6),
      mid.y + 2.2,
      mid.z - Math.sin(chute.yaw) * s * (CHUTE_W / 2 + 0.6),
    ], [1.2, 5, len], WALLRUN, chute.q);
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
  { p: [COLS[1].c, HEIGHT[2][1] + 3, ROWS[2].c], r: 13, kind: 'checkpoint', name: 'ladder' },
  { p: [COLS[3].c, HEIGHT[2][3] + 3, ROWS[2].c], r: 13, kind: 'checkpoint', name: 'stacks' },
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
