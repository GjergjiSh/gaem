// The figure-8. A slanted lemniscate roughly 260m across, built as one continuous
// banked road that crosses over itself twice — once 20m up, once 20m down — so a
// lap is a genuine climb and dive rather than a flat circuit.
//
// It exists to give every verb in the kit somewhere to be used, and each feature
// below is sized off the tune rather than eyeballed:
//
//   the road      a chain of SEPARATED platforms, not a ribbon. Every join is a
//                 jump and every platform end is a launch — a continuous road
//                 has no edges, and the edges are where the movement is
//   the chute     one long committed descent: 80m at 25deg. slide.slopeAccel
//                 beats slide.friction from about 2deg, so anything this steep
//                 pins you at the ceiling the whole way down and spits you onto
//                 the low deck at hardCap, aimed at the exit gap
//   no markings   nothing is ever built on a platform's surface. Even a 40mm
//                 inlaid plate is a thing to hit at 40 u/s in a slide, and the
//                 edge of a platform does not need labelling: it is an edge
//   the walls     every join is bridged by one. Full-height, arena-sized (13m
//                 tall), running from 12m before the gap to 12m past it, so
//                 there is always a surface carrying you across whether you
//                 jump it, wallrun it, or bail onto it halfway
//   the shafts    facing wall pairs a wall.jumpOut ejection apart, climbing out
//                 of the low crossing — the way back up after a fall
//   the gaps      two holes in the road with a gantry overhead. Grapple across,
//                 or gas across; the road will not carry you
//   the spiral    thruster pads ~11m apart, which is inside one tank
//                 (thruster.fuelMax / burnRate = 2.86s of hover, ~14m of climb),
//                 with ground between them to top up
//
// Everything is generated from the path, so the whole track is a handful of
// constants rather than a list of hand-placed boxes.

import type { Brush, Trigger } from './types';
import { axisAngle, clamp, orient, qapply, qmul, wrapAngle, type Q } from './geom';
import { propBox } from './kit';

// --- palette. Colour carries meaning here: amber is always a surface you can
// run on, violet is the slide.
const ROAD_A = 0x3c4a66;
const ROAD_B = 0x33405a;
const BANKWALL = 0xd97706;
const CHUTE_C = 0x7c3aed;
const PAD = 0x0ea5e9;
const GANTRY = 0x94a3b8;
const MAST = 0x6b7280;
const GATE = 0xf59e0b;
const DECK = 0x475569;

// --- the lemniscate. x sweeps +-A, z sweeps +-B/2, and the height is one sine
// over the loop: +H at the first crossing, -H at the second. That single term is
// what makes it "slanted" — the two lobes pass 2H apart at the middle.
const A = 110;
const B = 130;
const H = 20;
const ROAD_W = 22;
const ROAD_T = 1.4;

interface P3 { x: number; y: number; z: number }

const pathAt = (t: number): P3 => ({
  x: A * Math.cos(t),
  y: H * Math.sin(t),
  z: (B / 2) * Math.sin(2 * t),
});

const tangentAt = (t: number): P3 => ({
  x: -A * Math.sin(t),
  y: H * Math.cos(t),
  z: B * Math.cos(2 * t),
});

// --- arc-length table. The parametrisation runs more than twice as fast at the
// crossings as it does at the lobe ends, so stepping `t` uniformly would give
// road segments of wildly different lengths. Everything below indexes by
// DISTANCE along the track instead, which also makes "a 30m gap" mean 30 metres.
const SAMPLES = 4000;
const arc: number[] = [0];
for (let k = 1; k <= SAMPLES; k++) {
  const a = pathAt(((k - 1) / SAMPLES) * Math.PI * 2);
  const b = pathAt((k / SAMPLES) * Math.PI * 2);
  arc.push(arc[k - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
}
export const TRACK_LENGTH = arc[SAMPLES];

/** `t` at a given distance along the track. */
function tAt(dist: number): number {
  const d = ((dist % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  let lo = 0, hi = SAMPLES;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= d) lo = mid; else hi = mid;
  }
  const span = arc[lo + 1] - arc[lo] || 1;
  return ((lo + (d - arc[lo]) / span) / SAMPLES) * Math.PI * 2;
}

const at = (dist: number) => pathAt(tAt(dist));
/** Compass heading of the track at a distance, in the game's yaw convention. */
const headingAt = (dist: number) => {
  const d = tangentAt(tAt(dist));
  return Math.atan2(d.x, d.z);
};
/** Climb angle of the track at a distance. */
const slopeAt = (dist: number) => {
  const d = tangentAt(tAt(dist));
  return Math.atan2(d.y, Math.hypot(d.x, d.z));
};
// Platforms are deliberately NOT banked. A banked landing slides you off the edge
// you just fought to reach, and every platform here is something you land on.
// Sloped surfaces to slide along come from the chute and from the road's own
// descents, which is where they belong.

/** Sideways unit vector of the track — offsets features off the road edge. */
const sideAt = (dist: number): P3 => {
  const h = headingAt(dist);
  return { x: Math.cos(h), y: 0, z: -Math.sin(h) };
};

const brushes: Brush[] = [];
const box = (p: [number, number, number], s: [number, number, number], c: number, q?: Q) =>
  brushes.push(q ? { p, s, q, c } : { p, s, c });

/**
 * The same box, wearing a model from the kit. The collider is unchanged — the
 * model is stretched to it — so dressing the track cannot alter how it plays.
 */
const modelled = (
  p: [number, number, number], s: [number, number, number], c: number, m: string, q?: Q,
) => { box(p, s, c, q); brushes[brushes.length - 1].m = m; };

/**
 * Scenery standing on the top face of `host`, positioned in the host's own
 * frame so it rides the road's yaw, slope and every future edit to it.
 *
 * Two things make this look like street furniture rather than debris. The box
 * is `propBox(m)` — the model's true size — so the stretch is exactly 1 and the
 * prop appears at its real shape; and its base is placed on the surface rather
 * than its centre at a guessed height, so it stands rather than hovers.
 *
 * `d: true` keeps all of it out of the physics world, which is the only reason
 * a track this dressed is still a track you can carry speed through: none of it
 * is a thing to hit.
 */
const deco = (host: Brush, lx: number, lz: number, m: string, yaw = 0) => {
  const s = propBox(m);
  const q = (host.q ?? [0, 0, 0, 1]) as Q;
  const o = qapply(q, [lx, host.s[1] / 2 + s[1] / 2, lz]);
  box([host.p[0] + o[0], host.p[1] + o[1], host.p[2] + o[2]], s, 0xffffff,
    qmul(q, axisAngle(0, 1, 0, yaw)));
  Object.assign(brushes[brushes.length - 1], { m, d: true });
};

const HALF_PI = Math.PI / 2;

// --- the two crossings, declared up here because the road has to know about
// them: where the track passes over a deck it is a plaza, not a ledge.
const HIGH = pathAt(Math.PI / 2);      // (0, +H, 0)
const LOW = pathAt(Math.PI * 1.5);     // (0, -H, 0)

// Deck tops sit FLUSH with the road surface (road centre + half its thickness).
// Half a metre out and the join becomes a lip taller than character.stepHeight,
// which reads as a wall and stops a run dead at the one place on the map every
// lap has to pass through.
const HIGH_DECK = { w: 46, d: 34, top: HIGH.y + ROAD_T / 2 };
// The low deck is the busiest square metre of the map: two branches of the road
// cross it, the chute lands on it and the shafts climb out of it. 54x40 left no
// clear floor for any of that to coexist, so it is bigger.
const LOW_DECK = { w: 66, d: 52, top: LOW.y + ROAD_T / 2 };

/** Is this point out over one of the crossing plazas? Margin included. */
const overDeck = (p: P3) =>
  (Math.abs(p.x - HIGH.x) < HIGH_DECK.w / 2 + 6 &&
   Math.abs(p.z - HIGH.z) < HIGH_DECK.d / 2 + 6 &&
   Math.abs(p.y - HIGH.y) < 14) ||
  (Math.abs(p.x - LOW.x) < LOW_DECK.w / 2 + 6 &&
   Math.abs(p.z - LOW.z) < LOW_DECK.d / 2 + 6 &&
   Math.abs(p.y - LOW.y) < 14);

/**
 * A slab spanning two points: length, pitch and yaw all derived from the
 * endpoints. Authoring ramps as centre + length + angle is how you end up with a
 * chute that is twenty metres short at both ends and floating above the thing it
 * was supposed to land on — this cannot miss what it is aimed at.
 */
function ramp(from: P3, to: P3, w: number, thick: number, c: number, over = 0) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const climb = Math.atan2(dy, flat);
  const len = Math.hypot(flat, dy) + over;
  const q = orient(yaw, -climb, 0);
  box([(from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2], [w, thick, len], c, q);
  return { yaw, climb, len, q };
}

// --- the road: islands, not a ribbon -----------------------------------------
// The loop course had this right and the first pass here had it wrong. A
// continuous banked ribbon is a road you drive; a chain of separated platforms
// is a road you *move* on, because every join becomes a jump and every platform
// end becomes a launch you can dash-slide-jump off.
//
// Gap size is not decorative. It is chosen against the tune and against the
// local slope, which are not the same constraint:
//
//   climbing    the far side is HIGHER by gap x sin(slope) and a jump only
//               clears 2.53m of rise, so the gap is capped at whatever keeps
//               that step under 2m. Steep climbs therefore get long platforms
//               and short hops — which is what a run-up wants anyway.
//   descending  the far side is LOWER, which lengthens every jump, so the
//               descents carry the big gaps, and the four steepest carry the
//               feature gaps (two gantries to grapple, two wall pairs to bounce).
//
// Platforms are pitched along the slope rather than stepped, so the height
// change happens ALONG a platform instead of at the join, and they are flat
// across: a banked landing slides you off the edge you just fought to reach.
const SLOTS = 16;
const SPAN = TRACK_LENGTH / SLOTS;
const GAP_BASE = 15;     // an ordinary hop: past a run jump, inside a slide jump
const GAP_BIG = 30;      // a feature gap: Super, grapple, gas, or wall-bounce
const GAP_MIN = 6;
const RISE_MAX = 2;      // jump apex is 2.53m; leave headroom for the landing

interface Platform { d0: number; d1: number; mid: P3; yaw: number; pitch: number }

// Pass 1: work out every gap, so the feature gaps can be handed to the steepest
// descents rather than dropped wherever the rhythm happened to land.
const slots = Array.from({ length: SLOTS }, (_, k) => {
  const end = (k + 1) * SPAN;
  const slope = slopeAt(end - GAP_BASE / 2);
  return { k, end, slope, gap: GAP_BASE, feature: 'none' as 'none' | 'gantry' | 'walls' };
});
// Steepest descents first, but never two feature gaps ADJACENT. Taken purely by
// steepness they come out consecutive — the descents on a lemniscate are next to
// each other — and four 30m gaps back to back, with only 16m of run-up between
// them, is a gauntlet rather than a rhythm. Alternating leaves a full 31m
// platform to rebuild speed on before each one.
const taken: number[] = [];
for (const cand of [...slots].sort((a, b) => a.slope - b.slope)) {
  if (taken.length >= 4) break;
  if (cand.slope > -0.02) continue;                    // descents only
  const near = taken.some((k) => {
    const d = Math.abs(k - cand.k);
    return Math.min(d, SLOTS - d) < 2;
  });
  if (near) continue;
  cand.feature = taken.length < 2 ? 'gantry' : 'walls';
  cand.gap = GAP_BIG;
  taken.push(cand.k);
}
for (const slot of slots) {
  // Climbing: cap the gap so the step up stays inside a jump. The slot's total
  // span is fixed either way — the platform grows into whatever the gap gives
  // back, so the chain still closes the loop exactly.
  if (slot.slope > 0.02) {
    slot.gap = Math.min(slot.gap, RISE_MAX / Math.sin(slot.slope));
  }
  slot.gap = clamp(slot.gap, GAP_MIN, SPAN - 12);
}

const platforms: Platform[] = [];
for (const slot of slots) {
  const d1 = slot.end - slot.gap;
  const d0 = slot.end - SPAN;
  const mid = (d0 + d1) / 2;
  platforms.push({ d0, d1, mid: at(mid), yaw: headingAt(mid), pitch: slopeAt(mid) });

  const len = d1 - d0;
  const c = at(mid);
  const q = orient(headingAt(mid), -slopeAt(mid), 0);
  modelled([c.x, c.y, c.z], [ROAD_W, ROAD_T, len],
    slot.k % 2 ? ROAD_A : ROAD_B, 'Platform_4x4_Empty', q);

  // Dressing, all of it decor, all of it in the road's own frame: local +Z runs
  // down the track and local X is across it, so everything below is placed by
  // "how far along" and "how far out", and tilts with the road for free.
  const road = brushes[brushes.length - 1];
  const halfW = ROAD_W / 2;

  // Railings down both edges. The models' long axis is their own X, so running
  // one along the track is a quarter turn; the last few metres at each end stay
  // open, because a rail across the lip of a jump reads as a wall.
  const rail = propBox('Rail_Long')[0];
  const runs = Math.max(0, Math.floor((len - 8) / (rail + 0.25)));
  for (const sgn of [1, -1]) {
    for (let k = 0; k < runs; k++) {
      deco(road, sgn * (halfW - 0.5), (k - (runs - 1) / 2) * (rail + 0.25),
        'Rail_Long', HALF_PI);
    }
  }

  // A light at each end so the platform reads as a place before you can make out
  // its edges. The lamp hangs toward the model's own +Z, so each post turns to
  // reach over the road instead of out into the dark.
  for (const sgn of [1, -1]) {
    deco(road, sgn * (halfW - 1.9), sgn * (len / 2 - 4), 'Light_Street_1', -sgn * HALF_PI);
  }

  // One tall silhouette per slot so no two platforms look alike at speed, one
  // low unit opposite it, and a sign turned back to face whoever is arriving.
  const tall = ['Computer_Large', 'TV_3', 'AC_Stacked', 'Antenna_2'][slot.k % 4];
  deco(road, -(halfW - 2.4), -len * 0.18, tall, HALF_PI);
  deco(road, halfW - 2.6, len * 0.1, ['AC', 'AC_Side', 'Computer', 'Support'][slot.k % 4], -HALF_PI);
  deco(road, -(halfW - 1.6), len * 0.34,
    ['Sign_4', 'Sign_1', 'Sign_2', 'Sign_3'][slot.k % 4], Math.PI);
}

// --- the walls: one per join -------------------------------------------------
// Every join in the road is bridged by a wall along its edge. That is the whole
// rule. A gap used to be a hole with nothing beside it unless it happened to be
// one of the four feature gaps, so missing a jump was simply a fall; now there
// is always a surface running past the hole, and clearing a join is a choice
// between jumping it, wallrunning across, or bailing onto the wall halfway and
// carrying on.
//
// Arena-sized, because anything smaller is scenery: 13m tall, reaching up to 12m
// back along the platform at each end so you can be ON the wall before the floor
// stops.
//
// Each one is three pieces: along the outgoing platform's edge, across the gap,
// along the incoming platform's edge. The pieces that run beside a platform are
// built from THAT platform's own axes, which is the only way a wall stays off
// the road. Following the curve instead looks equivalent and is not: a platform
// is a straight box tangent to the arc at its midpoint, so by its far end the
// arc has swung about two metres away from it, and a wall laid on the arc ends
// up two metres inside the carriageway — an invisible kerb exactly where you are
// carrying the most speed.
const WALL_H = 13;
const WALL_OVER = 12;                  // how far back along each platform, max
const WALL_OFF = ROAD_W / 2 + 0.6;     // inner face flush with the road edge

/** A point on a platform's outer edge line, `u` metres from its centre. */
function edgePoint(pf: Platform, sgn: number, u: number): P3 {
  const cp = Math.cos(pf.pitch), sp = Math.sin(pf.pitch);
  const f = { x: Math.sin(pf.yaw) * cp, y: sp, z: Math.cos(pf.yaw) * cp };
  const n = { x: Math.cos(pf.yaw), z: -Math.sin(pf.yaw) };
  return {
    x: pf.mid.x + f.x * u + n.x * sgn * WALL_OFF,
    y: pf.mid.y + f.y * u,
    z: pf.mid.z + f.z * u + n.z * sgn * WALL_OFF,
  };
}

/**
 * A wall slab spanning two points, sunk 1m so its base stays under the road.
 *
 * Nothing is built over a crossing plaza. The road runs across both decks, and
 * an edge wall carried over one cuts the plaza in half — straight through the
 * Super runway on the high deck and through the chute's landing run on the low
 * one. There is no gap to bridge there anyway: the deck IS the floor.
 */
function wallSpan(from: P3, to: P3) {
  // Midpoint, not either end: testing the ends throws away a whole 30m gap just
  // for reaching towards a deck, which leaves the one join that most needs a
  // wall without one.
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  if (overDeck(mid)) return;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  const len = Math.hypot(flat, dy);
  if (len < 0.5) return;
  modelled(
    [(from.x + to.x) / 2, (from.y + to.y) / 2 + WALL_H / 2 - 1, (from.z + to.z) / 2],
    [1.2, WALL_H, len],
    BANKWALL,
    'Support_Long',
    orient(Math.atan2(dx, dz), -Math.atan2(dy, flat), 0),
  );
}

for (const slot of slots) {
  const a = platforms[slot.k];
  const b = platforms[(slot.k + 1) % SLOTS];
  const ha = (a.d1 - a.d0) / 2, hb = (b.d1 - b.d0) / 2;
  // Never more than half a platform from either end, so the two joins sharing a
  // short platform meet in the middle instead of stacking on top of each other.
  const backA = Math.min(WALL_OVER, ha);
  const backB = Math.min(WALL_OVER, hb);
  // Outside of the turn, which is the side a wallrun wants: the one the heading
  // is turning away from. The four feature gaps get both sides — they are the
  // 30m ones, so they are the ones worth being able to take from either lane.
  const d = slot.end - slot.gap / 2;
  const turn = wrapAngle(headingAt(d + 12) - headingAt(d - 12));
  const out = turn > 0 ? -1 : 1;
  for (const sgn of slot.feature === 'none' ? [out] : [-1, 1]) {
    const a0 = edgePoint(a, sgn, ha - backA);
    const a1 = edgePoint(a, sgn, ha);
    const b0 = edgePoint(b, sgn, -hb);
    const b1 = edgePoint(b, sgn, -hb + backB);
    wallSpan(a0, a1);      // beside the platform you leave
    wallSpan(a1, b0);      // across the gap
    wallSpan(b0, b1);      // beside the platform you land on
  }
}

// --- the gantries ------------------------------------------------------------
// A beam over the two widest gaps, high enough that hooking it drops you into a
// swing rather than a climb, plus a mast beside it as a second anchor for a
// longer arc.
for (const slot of slots) {
  if (slot.feature !== 'gantry') continue;
  const gapMid = slot.end - slot.gap / 2;
  const c = at(gapMid);
  const h = headingAt(gapMid);
  const span = slot.gap + 26;
  const side = sideAt(gapMid);
  box([c.x, c.y + 15, c.z], [3, 1.6, span], GANTRY, axisAngle(0, 1, 0, h));
  // Legs OFF the road, clear of the wall that runs along its edge. A 2.2m pillar
  // planted in the middle of a 22m carriageway is a thing you hit at speed —
  // nothing that holds the scenery up belongs in the running line.
  const legOff = ROAD_W / 2 + 3.2;
  for (const end of [-1, 1]) {
    const e = at(gapMid + end * (span / 2 - 2));
    box([e.x + side.x * legOff, e.y + 7.5, e.z + side.z * legOff], [2.2, 15, 2.2], MAST);
  }
  box([c.x + side.x * 26, c.y + 12, c.z + side.z * 26], [2.4, 40, 2.4], MAST);
}

// --- the vertical loop -------------------------------------------------------
// One circuit of its own, chaining four mechanics in order and ending where it
// started:
//
//   high deck --Super--> tower --chute--> low deck --wall shafts--> high deck
//
// Every leg has a fallback (grapple, gas), so it reads as a skill line rather
// than a lock.
modelled([HIGH.x, HIGH_DECK.top - 0.8, HIGH.z], [HIGH_DECK.w, 1.6, HIGH_DECK.d],
  DECK, 'Platform_4x4_Empty');
const highDeck = brushes[brushes.length - 1];
modelled([LOW.x, LOW_DECK.top - 0.8, LOW.z], [LOW_DECK.w, 1.6, LOW_DECK.d],
  DECK, 'Platform_4x4_Empty');
const lowDeck = brushes[brushes.length - 1];

// The crossings are plazas the road runs over, so they get lit corners and
// nothing else — the middle of both is a landing zone and has to stay readable.
for (const deck of [highDeck, lowDeck]) {
  const hx = deck.s[0] / 2 - 3;
  const hz = deck.s[2] / 2 - 3;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      deco(deck, sx * hx, sz * hz, 'Light_Street_1', sz > 0 ? Math.PI : 0);
      deco(deck, sx * (hx - 3.4), sz * hz, 'AC_Stacked', 0);
    }
  }
}

// --- leg 1: the Super gap ----------------------------------------------------
// A runway west off the high deck, then 30m of nothing with the landing 8m down. Measured against the tune: a run jump carries 10m and a plain
// slide jump 25m, but a slide converted by a coyote jump (slideExitBonus 1.28)
// carries 32m. Exactly one of the three makes it, which is the point.
const SUPER_GAP = 30;
const SUPER_DROP = 8;
const RUN_LEN = 18;
const deckEdgeX = HIGH.x - HIGH_DECK.w / 2;
const lipX = deckEdgeX - RUN_LEN;
box([deckEdgeX - RUN_LEN / 2, HIGH_DECK.top - 0.8, HIGH.z], [RUN_LEN, 1.6, 16], DECK);

// --- leg 2: the tower, which is also where the Super lands -------------------
const TOWER_W = 26;
const TOWER_TOP = HIGH_DECK.top - SUPER_DROP;
const towerX = lipX - SUPER_GAP - TOWER_W / 2;
box([towerX, (TOWER_TOP - 40) / 2, HIGH.z], [TOWER_W, TOWER_TOP + 40, TOWER_W], DECK);

// --- leg 3: the chute --------------------------------------------------------
// The long slide: ~74m at 24 degrees. slide.slopeAccel beats slide.friction from
// about 2 degrees, so anything this steep pins you at the ceiling for the whole
// length — you arrive on the low deck at terminal speed and carry it straight at
// the exit gap. Walled both sides: a slide that can fall out of the chute is a
// slide you stop committing to.
const CHUTE_FROM: P3 = { x: towerX + TOWER_W / 2, y: TOWER_TOP, z: HIGH.z + 6 };
// Aimed at the clear quarter of the low deck. Two branches of the road cross
// this deck, and the old landing put the last ten metres of the chute straight
// through one of them — the ramp rose out of the road surface as a slab you
// could not see coming. This one touches down 7m clear of both.
const CHUTE_TO: P3 = { x: LOW.x - 25, y: LOW_DECK.top, z: LOW.z - 9 };
const chute = ramp(CHUTE_FROM, CHUTE_TO, 18, 1.4, CHUTE_C, 4);
// The rails stop 12m short of the bottom. A branch of the road crosses the low
// deck right where the chute lands, and a rail carried all the way down stands
// on that platform as a 2.7m slab across the running line — the chute's own exit
// wall would have been the thing that stopped the lap.
const RAIL_TRIM = 0;
{
  const dir = {
    x: Math.sin(chute.yaw) * Math.cos(chute.climb),
    y: Math.sin(chute.climb),
    z: Math.cos(chute.yaw) * Math.cos(chute.climb),
  };
  const len = chute.len - RAIL_TRIM;
  for (const side of [-1, 1]) {
    const nx = Math.cos(chute.yaw) * side * 9.4;
    const nz = -Math.sin(chute.yaw) * side * 9.4;
    box(
      [
        (CHUTE_FROM.x + CHUTE_TO.x) / 2 + nx - dir.x * RAIL_TRIM / 2,
        (CHUTE_FROM.y + CHUTE_TO.y) / 2 + 2.4 - dir.y * RAIL_TRIM / 2,
        (CHUTE_FROM.z + CHUTE_TO.z) / 2 + nz - dir.z * RAIL_TRIM / 2,
      ],
      [1.2, 5, len],
      BANKWALL,
      chute.q,
    );
  }
}

// --- leg 3b: the chute's exit, a second Super at speed -----------------------
// You leave the chute at terminal speed heading east across the low deck, so
// this one is cleared by ARRIVING fast rather than by the bonus. A shelf 12m
// under the gap means missing it costs time, not the run.
const EXIT_GAP = 26;
const exitEdgeX = LOW.x + LOW_DECK.w / 2;
box([exitEdgeX + EXIT_GAP + 11, LOW_DECK.top - 0.8, LOW.z], [22, 1.6, 26], PAD);
box([exitEdgeX + EXIT_GAP / 2, LOW_DECK.top - 12.8, LOW.z], [EXIT_GAP + 10, 1.6, 22], DECK);

// --- leg 4: the wall shafts --------------------------------------------------
// Facing pairs climbing out of the low crossing, back up to high-deck height.
// The gap and the length are coupled: at ~13 u/s out and ~13 u/s along, crossing
// 6.5m takes about half a second, so the walls have to be a good deal longer
// than the gap or you sail out the open end before you arrive.
const SHAFT_GAP = 6.5;
// Placed by search, not by eye. Two branches of the road cross this deck at
// different headings and the chute now lands on it as well, so the free floor is
// a handful of wedges — these two spots are the best available, clear of every road,
// rail and pad, and both north of the line the chute throws you along. A 40m tower parked in a corridor is a tower
// you run into at 40 u/s.
for (const [ox, oz, yaw] of [[28, 23, 2.44], [14, 23, 2.44]] as const) {
  for (const side of [-1, 1]) {
    box(
      [
        LOW.x + ox + Math.cos(yaw) * side * (SHAFT_GAP / 2),
        LOW.y + 16,
        LOW.z + oz - Math.sin(yaw) * side * (SHAFT_GAP / 2),
      ],
      [24, 40, 1.2],
      BANKWALL,
      axisAngle(0, 1, 0, yaw + Math.PI / 2),
    );
  }
}

// --- the thruster spiral -----------------------------------------------------
// Pads climbing around the low crossing, each hop inside one tank — fuelMax /
// burnRate is 2.86s of hover and maxRise is 5 u/s, so a tank buys about 14m of
// climb and the steps are 10.5m. Solid ground at every one, because groundRefuel
// makes "land, top up, go again" the loop rather than hanging in the air waiting.
// Gates hang between them: fly through, or hook the crossbar and swing the corner.
const SPIRAL_R = 44;
const spiralAngle = (k: number) => (k / 6) * Math.PI * 1.7 + 2.4;
const spiralY = (k: number) => LOW.y + 7 + k * 10.5;
for (let k = 0; k < 6; k++) {
  const a = spiralAngle(k);
  box(
    [LOW.x + Math.sin(a) * SPIRAL_R, spiralY(k), LOW.z + Math.cos(a) * SPIRAL_R],
    [8, 1.2, 8],
    PAD,
    axisAngle(0, 1, 0, a),
  );
  if (k >= 5) continue;
  // A square hoop between this pad and the next: two posts and two crossbars.
  const ga = a + Math.PI / 12;
  const gy = spiralY(k) + 6;
  const gx = LOW.x + Math.sin(ga) * SPIRAL_R;
  const gz = LOW.z + Math.cos(ga) * SPIRAL_R;
  const q = axisAngle(0, 1, 0, ga);
  for (const side of [-1, 1]) {
    box([gx + Math.cos(ga) * side * 4, gy, gz - Math.sin(ga) * side * 4], [0.7, 9, 0.7], GATE, q);
  }
  box([gx, gy + 4.5, gz], [9, 0.7, 0.7], GATE, q);
  box([gx, gy - 4.5, gz], [9, 0.7, 0.7], GATE, q);
}

export { brushes };

// --- triggers. On platform centres, not at fractions of the path — a checkpoint
// floating in the middle of a gap is a checkpoint you have to stop to collect.
export const triggers: Trigger[] = [3, 7, 11, 15].map((k, i) => {
  const c = platforms[k % platforms.length].mid;
  return {
    p: [c.x, c.y + 3, c.z] as [number, number, number],
    r: 11,
    kind: 'checkpoint' as const,
    name: ['first', 'second', 'third', 'fourth'][i],
  };
});
{
  const c = platforms[0].mid;
  triggers.push({ p: [c.x, c.y + 3, c.z], r: 10, kind: 'goal', name: 'finish' });
}

// --- dummies: on platforms (never in a gap), on both decks, and a couple where
// the sensible answer is the meathook rather than a climb.
export const enemies: [number, number, number][] = [];
for (const k of [1, 4, 6, 9, 12, 14]) {
  const pf = platforms[k % platforms.length];
  const side = sideAt((pf.d0 + pf.d1) / 2);
  enemies.push([pf.mid.x + side.x * 6, pf.mid.y + 0.8, pf.mid.z + side.z * 6]);
}
enemies.push([HIGH.x + 12, HIGH_DECK.top + 0.1, HIGH.z + 8]);
enemies.push([LOW.x - 14, LOW_DECK.top + 0.1, LOW.z + 10]);
enemies.push([
  LOW.x + Math.sin(spiralAngle(4)) * SPIRAL_R,
  spiralY(4) + 1.2,
  LOW.z + Math.cos(spiralAngle(4)) * SPIRAL_R,
]);
enemies.push([towerX, TOWER_TOP + 1.4, HIGH.z - 8]);

const START = platforms[0].mid;
export const spawn = { x: START.x, y: START.y + 2.2, z: START.z };
// Face down the track: the camera looks along -(sin yaw, cos yaw), so aiming it
// at the tangent means turning it a half-circle from the heading.
export const spawnYaw = platforms[0].yaw + Math.PI;
export const killY = -70;
