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
//   the Line      ~1200 m of elevated deck over every wide avenue in the
//                 district — two legs north–south, two east–west, four
//                 junctions — falling from 38 m at the north-east end to 5 m at
//                 the south-west. Long runs at 2.5–3° keep the speed you
//                 arrive with; three pitches at 8, 12 and 17.5° are where it is
//                 found, and those are the marked ones. Every gap in it is a
//                 jump priced at one of the tiers.
//   the Spire     76 m. Balconies one thruster tank apart on three faces, a
//                 shaft up the fourth — the full-depth gap between the tower
//                 and its service core — and masts on top for the grapple.
//                 Three ways up, none of which goes all the way on its own.
//                 The Chute used to be the way down from the crown: 142 m of
//                 25° slab, one line, taken the same way every time. The Line's
//                 pitches do that job now and there are three of them, joined
//                 to everything else.
//
// The look is ONE art pack — `assets/scifi` for the environment and
// `assets/more-scifi` for the props, measured into `scifi.ts`, and the same
// trim sheets underneath both. It supplies three things, and the district needs
// all three:
//
//   the models     everything you get close to. Doors, lamps, rails, vents,
//                  crates, dishes, cladding panels, the paint on the floor.
//   the surfaces   what every brush is MADE of — see engine/surfaces.ts. Each
//                  volume names a material recipe cut from the same sheets, so
//                  a wall has a grain, a road has a grain, and the two are
//                  different grains at the same texel density.
//   the palette    a colour on a brush is a TINT over that grain rather than
//                  the finished pixel, which is why the numbers below are
//                  lighter than they look.
//
// The surfaces are the part that was missing for a long time, and their absence
// was not subtle: a district of nine hundred hand-placed volumes in flat fills
// still reads as nine hundred boxes, because a flat fill tells the eye nothing
// about how far away a wall is or how big it is. Detail on the props alone
// cannot fix that — it puts jewellery on a box.
//
// Which is also why the older `assets/Platforms` kit appears nowhere in this
// file. It is untextured, and textured props standing next to untextured ones
// is not two styles, it is one mistake. The `assets/factory` kit is out for the
// same reason from the other direction: it is a flat-shaded toy-factory set off
// a single colour map, which is a perfectly good look and not this one.
//
// So: masses are textured volumes with a base course, service bands, lit floors
// and a cornice — a box with a foot and a cap is a building, a bare box is a
// box. Everything at arm's length is kit: wall panels on the ground storey of
// the avenues, doors and lights and vents on the frontages, plant on every
// roof, rails on every catwalk, and paint on the decks and the roads. Scale
// comes from the small things; you cannot tell how big a 30 m mass is until
// there is a door on it.
//
// And it is dusk, which is a choice the level makes and the renderer serves: a
// low sun rakes a grid of streets so every wall has a lit face and a dark one,
// and everything the district builds itself out of — lit service bands, window
// slots, beacons, the amber of a wallrunnable wall — has something to be read
// against. Behind the rim there is a ring of masses that are not part of the
// map at all. They exist so that the edge of the world is a hazy city rather
// than an edge.
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

import type { Brush, Theme, Trigger } from './types';
import { axisAngle, orient, qmul, type Q } from './geom';
import { SCIFI, sciBox, sciBrush } from './scifi';
import { CITY, cityBox, cityBrush } from './city';
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

// --- palette ------------------------------------------------------------------
//
// Same language as the figure-8, so a surface means the same thing on both maps:
// amber is something to wallrun, violet is something to slide.
//
// Every value here is a good deal lighter than it was, and that is not a change
// of taste. A colour on a brush is now a TINT over a base map rather than the
// finished pixel: the map is a mid grey, the multiply costs about a quarter of
// the value, and the filmic curve takes some of what is left. The old palette —
// slates around 0x2b3446 — went through that and came out very close to black,
// which is a district you cannot see rather than a district that is dark.
const MASS_LOW = 0x6d7488;
const MASS_MID = 0x7b8298;
const MASS_HI = 0x8b93a8;
const DECK = 0x99a2b4;
const TIER = 0x767e94;
const FURN = 0x8d94a3;
const MAST = 0x9299a4;
const GANTRY = 0xb9c0cc;
// Multiplies a DARK crop rather than the walls' light one, so the number has to
// be a great deal lighter than the tarmac it is meant to produce.
const STREET = 0xa9b0bd;
const CRATE = 0x8a94a3;
const WALLRUN = 0xd97706;   // amber: run along it
/**
 * The same rule, worn by the padded wall.
 *
 * `WALLRUN` is a tint meant to MAKE a grey surface amber. The padded panel is
 * already orange with red strips lit into it, so the same tint over it lands
 * somewhere near burnt umber and the rule stops reading. This one only has to
 * keep it amber, which is a much lighter job — it is the same colour to the
 * player and a different number to the shader.
 */
const PADDING = 0xffcf9a;
const PAD = 0x0ea5e9;       // cyan: a thruster step
const ROAD = 0x646c7c;
const TRIM = 0xaab2c2;      // bands and cornices: the line round a building
const PLINTH_C = 0x5a6070;  // the base course every mass stands on
/** The footway: pale, warm, and nothing like either the road or the walls. */
const PAVE_C = 0x9aa0a4;
const PROP_C = 0xffffff;    // never seen: a prop's model hides its brush
/**
 * Paint. The one thing in this district that is allowed to be a colour rather
 * than a material — canopies, shutters, signs, awnings, the stripe round a
 * loading bay.
 *
 * Chosen to stay OUT OF THE WAY of the three colours that carry rules. Amber,
 * violet and cyan mean run along it, slide down it and thrust off it, and they
 * only mean that while nothing else on the map is wearing them. So the paint
 * list is deliberately the rest of the wheel — coral, green, magenta, sea, lime,
 * periwinkle — with no amber, no violet and no cyan in it. The first version had
 * an orange, a lilac and a teal in the list and every one of them was a quiet
 * lie told to the player at street level.
 *
 * They are also never on anything you can run along, and they are small: a
 * canopy, an awning, a hazard lip, a sign.
 */
const ACCENT = [
  0xe86a6a,   // coral
  0x74c07a,   // green
  0xd94f7a,   // magenta
  0x2e8f6f,   // sea
  0xd6d05f,   // lime
  0x6f8fd6,   // periwinkle
];

/** Window light, warm — the common one, because most of this place is offices. */
const LIT_WARM = 0xffb765;
/** Window light, cold. A few buildings on a different shift. */
const LIT_COLD = 0x9fd8ff;

/**
 * Facade tints, one per building.
 *
 * A skyline of forty boxes in one colour is one building drawn forty times. Real
 * districts are built out of whatever was cheap that decade, so a block gets a
 * tint off this list by hash.
 *
 * These carry real HUE, not just value. The first version of this list was six
 * greys a few points apart, which is the same mistake as one grey: at dusk,
 * under a warm key and a blue fill, six greys are one grey. Oxide red, sand,
 * verdigris, bone, slate and a dark steel are still a muted palette — nothing
 * here is a primary — but they are six different materials, and a street with
 * six materials in it is a street somebody built over time.
 */
const FACADE_TINTS = [
  0x8a6a5c,   // oxide, the brick of the place
  0x9a9078,   // sand concrete
  0x6f8683,   // verdigris panel
  0xa0a4ac,   // bone, the newest buildings
  0x6b7488,   // slate
  0x7a6f74,   // weathered mauve-grey
];

// --- surfaces -----------------------------------------------------------------
// Which material recipe each role wears — see engine/surfaces.ts. The point of
// naming them here rather than deriving them from colour is that a surface is a
// MATERIAL and a colour is a RULE, and the level needs to be free to say "this
// amber thing is padded wall and that amber thing is painted steel".
/**
 * A building's wall: panel grain with windows in it.
 *
 * Every mass on the map wears this, the ones behind the rim included — a
 * backdrop tower is a building too, and at that distance the window grid
 * mips down into exactly the mottled, faintly lit tone a city has from a
 * kilometre away.
 */
const S_MASS = 'facade';
/** The other kind of building — see the note in surfaces.ts. */
const S_MASS2 = 'facade2';
/** The footway every building stands on, which is what makes the road a road. */
const S_PAVING = 'paving';
const S_DECK = 'deck';
const S_TRIM = 'trim';
const S_PLINTH = 'plinth';
const S_ROAD = 'road';
const S_STREET = 'street';
const S_STEEL = 'steel';
const S_CRATE = 'crate';
const S_PADDED = 'padded';
const S_MARKED = 'marked';
const S_LAMP = 'lamp';
/** Colour that keeps reading when the sun cannot reach it — see surfaces.ts. */
const S_PAINT = 'paint';

const HALF_PI = Math.PI / 2;

// --- brush plumbing ----------------------------------------------------------

const brushes: Brush[] = [];

/**
 * Ashgate ships as two levels off one generator: `ashgate`, whose street faces
 * are clad in the kit's own buildings, and `ashgate-raw`, which is the same
 * district with nothing but its own masses on it. Same plan, same heights, same
 * lap, same collision everywhere it matters — the difference is entirely what
 * the walls are made of, which makes the pair a straight answer to what the
 * models are actually buying.
 *
 * Brushes that belong to only one of them are recorded here. The clad ones are
 * scattered through the file and get filtered out of the raw list; the raw ones
 * are all emitted at the very END, after everything else, so that dropping them
 * cannot shift an index anything else is holding — `RAMP_BRUSHES` in
 * particular.
 */
const MODELED = new Set<number>();
/** Run `fn` and mark everything it emits as belonging to the clad level only. */
function modeledOnly<T>(fn: () => T): T {
  const from = brushes.length;
  const out = fn();
  for (let i = from; i < brushes.length; i++) MODELED.add(i);
  return out;
}
/** Masses a building ended up standing against — they get two different bases. */
const CLAD_MASSES: { r: Roof; k: number }[] = [];

const box = (
  p: [number, number, number], s: [number, number, number], c: number, q?: Q, t?: string,
): Brush => {
  const b: Brush = q ? { p, s, q, c } : { p, s, c };
  if (t) b.t = t;
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
/**
 * What crowds around plant: vents, fans, cabinets, drums, crates.
 *
 * Half of these come from `assets/more-scifi`, which is the prop half of the
 * same pack — same authoring scale, same trim sheets, so they stand next to the
 * environment set without anything looking borrowed. It is worth the wider list:
 * six objects repeated over fifty roofs is a pattern you start to see, and
 * fourteen is furniture.
 */
const UNITS = [
  'Prop_Fan_Small', 'Prop_Computer', 'Prop_Barrel_Large', 'Prop_Crate4',
  'Prop_Chest', 'Prop_ItemHolder', 'Prop_AccessPoint', 'Prop_Crate3',
  'Prop_Barrel1', 'Prop_Barrel2_Closed', 'Prop_Barrel2_Open', 'Prop_Crate',
  'Prop_Crate_Tarp', 'Prop_Locker', 'Prop_Shelves_WideShort', 'Prop_Ammo_Closed',
];
/** Bigger things, for the ground: a street needs objects a person is smaller than. */
const BULK = [
  'Prop_Crate_Large', 'Prop_Crate_Tarp_Large', 'Prop_Crate_Tarp', 'Prop_Crate',
];
/** What stands on a roof and can be seen from the next district over. */
const SKYLINE = ['Prop_SatelliteDish', 'Column_Pipes', 'Column_Large_Straight'];
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

/**
 * The same colour, lifted or dropped in value. Hue survives, tone does not.
 *
 * Used to put aerial perspective INTO the palette: the tall masses at the back
 * of a view are mixed lighter and the low ones darker, so the roofscape has a
 * depth order even where the fog has not reached and every building is lit by
 * the same sun.
 */
function mix(a: number, b: number, t: number): number {
  const l = (c: number, sh: number) => (c >> sh) & 255;
  const m = (sh: number) => Math.round(l(a, sh) * (1 - t) + l(b, sh) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/**
 * The measured size of any model this level names, whichever kit it came from.
 *
 * Two tables now, and the verifier asks this one question of every prop on the
 * map — so a model that is in neither table must not silently return undefined
 * and skip the distortion check. It cannot: `verify:level` reads the answer and
 * would fail on the missing entry, which is the correct way for a level to find
 * out it is placing something nobody has measured.
 */
export const propBoxOf = (m: string) => SCIFI[m] ?? CITY[m];

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

function ramp(
  from: P3, to: P3, w: number, thick: number, c: number, over = 0, m?: string, t?: string,
) {
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
  const brush = m ? skinned(p, [w, thick, len], c, m, q) : box(p, [w, thick, len], c, q, t);
  RAMP_BRUSHES.push(brushes.length - 1);
  return { yaw, climb, len, q, brush };
}

/** A prop standing on `y`, at the model's own size. */
function prop(m: string, x: number, y: number, z: number, yaw = 0, scale = 1) {
  const s = sciBrush(m, scale);
  skinned([x, y + s[1] / 2, z], s, PROP_C, m, yaw ? axisAngle(0, 1, 0, yaw) : undefined);
  return s;
}

/** The same, for a piece of the city kit. */
function cityProp(m: string, x: number, y: number, z: number, yaw = 0, scale = 1) {
  const s = cityBrush(m, scale);
  skinned([x, y + s[1] / 2, z], s, PROP_C, m, yaw ? axisAngle(0, 1, 0, yaw) : undefined);
  return s;
}

/**
 * A city-kit wall module hung on a face, sitting on `y`.
 *
 * The kit's panels are thin on Z and face their own +Z, so this is a yaw and
 * nothing else — no tipping, no second quarter-turn. `wallProp` exists for the
 * sci-fi kit's mixture of Z-thin and Y-thin models and would be the wrong tool
 * here: it measures which axis is thinnest to decide, and on a 2x3x0.2 panel it
 * happens to get the same answer for the wrong reason.
 */
function cityPanel(
  m: string, nx: number, nz: number, x: number, y: number, z: number, scale = 1,
) {
  const s = cityBrush(m, scale);
  // Set back so the panel's own thickness sits against the wall rather than
  // half inside it, less a bite so nothing rests on a hairline.
  const out = s[2] / 2 - 0.06;
  skinned([x + nx * out, y + s[1] / 2, z + nz * out], s, PROP_C, m,
    axisAngle(0, 1, 0, Math.atan2(nx, nz)));
  return s;
}

/** A flat city marking lying on the road, `yaw` turning its length. */
function road(m: string, x: number, y: number, z: number, yaw = 0, scale = 1) {
  const s = cityBrush(m, scale);
  skinned([x, y + s[1] / 2, z], s, PROP_C, m, yaw ? axisAngle(0, 1, 0, yaw) : undefined);
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
    box(p, sz, TIER, undefined, S_DECK);
    out.push({ x: p[0], y, z: p[2] });
  }
  return out;
}

export interface Roof { cx: number; cz: number; w: number; d: number; top: number }
/** Every walkable deck this file emits. The verifier walks this list. */
export const roofs: Roof[] = [];

/** One mass plus its deck. Everything solid and upright goes through here. */
function mass(cx: number, cz: number, w: number, d: number, top: number): Roof {
  // Tint by WHERE it stands, not by what it is, so a building keeps its colour
  // however the plan around it is edited, and two neighbours are hardly ever the
  // same one. Height then sets the tone on top of that.
  const key = Math.round(cx) * 131 + Math.round(cz);
  const tint = pick(FACADE_TINTS, key);
  const band = shade(tint, top >= 30 ? 1.14 : top >= 20 ? 1 : 0.88);
  // And which of the two building materials it is built out of, by the same
  // hash — so a tint and a bay size travel together and a building is one
  // building rather than a colour applied to a generic wall.
  box([cx, (top - DECK_T - BASE) / 2, cz], [w, top - DECK_T + BASE, d], band,
    undefined, hash(key * 7) % 2 ? S_MASS : S_MASS2);
  // The roof takes some of the building's own colour rather than a single deck
  // grey for the whole district. Not all of it — a roof is weathered plant deck
  // and a wall is cladding, so it stays mostly neutral — but enough that from
  // above you can tell which roof belongs to which building, which is the one
  // view where this map is read as a plan.
  box([cx, top - DECK_T / 2, cz], [w, DECK_T, d], shade(mix(DECK, tint, 0.42), 0.94),
    undefined, S_DECK);
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

/**
 * Lanes the route runs down. Nothing gets built inside one.
 *
 * A level that dresses itself has to be told where the game is, or it will
 * eventually put a cooling unit exactly where you needed the floor.
 */
interface Lane { x0: number; z0: number; x1: number; z1: number; half: number }
const LANES: Lane[] = [
  // The Line's slip roads, where they cross a roof: an on-ramp with a cooling
  // unit parked on it is an on-ramp you cannot use.
  { x0: COLS[3].c - 6, z0: 10, x1: COLS[3].hi + 4, z1: 10, half: 8 },
  { x0: COLS[1].c - 6, z0: -8, x1: COLS[1].hi + 4, z1: -8, half: 8 },
];

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
    box([px, r.top + hh / 2, pz], [hw, hh, hd], FURN, undefined, S_CRATE);
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

  // The OTHER corner gets something with a different outline. A roofscape where
  // every roof carries the same 10 m stack is a texture; a dish next to a stack
  // next to a pipe cluster is a skyline, and the silhouette is all you have to
  // tell one building from another at three hundred metres.
  //
  // Placed in the OPPOSITE CORNER, and judged by the same rule the mast beside
  // it is: a corner is not a launch lane. `fitsEdge` is the wrong test here and
  // fails every roof on the map when you try it — it asks for a 9 m clear ring,
  // which by construction a corner does not have, so the whole feature quietly
  // builds nothing at all.
  const bx = r.cx - sx * (r.w / 2 - 4);
  const bz = r.cz - sz * (r.d / 2 - 4);
  const big = pick(SKYLINE, k * 5 + 1);
  const bs = sciBox(big);
  if (r.w > 26 && r.d > 26 && clearOfLanes(bx, bz, Math.max(bs[0], bs[2]) + 2)) {
    prop(big, bx, r.top, bz, (hash(k * 11) % 4) * HALF_PI);
    // A lit deck plate under it, because a working roof at night is lit where
    // the work is and dark everywhere else.
    box([bx, r.top + 0.06, bz], [bs[0] + 2.4, 0.12, bs[2] + 2.4], LIT_WARM, undefined, S_LAMP);
  }
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

/**
 * Where a building meets the ground, which is the part you actually stand next
 * to and the part that was a box driven straight into another box.
 *
 * Nothing on a street is one plane from the pavement to the roof. It steps: a
 * foot wide enough to kick, a ground storey that is not the same thing as the
 * wall above it, and something sticking out over the pavement to stand under.
 * Three brushes, in three moves, and the profile does the work — this is not
 * detail, it is silhouette, which is the only kind of detail that survives
 * being looked at from forty metres away at speed.
 *
 * All of it is proud of the wall rather than cut into it, because the mass is
 * one solid box and a recess would simply be hidden inside it. Proud is also
 * the more useful shape: the canopy is a metre and a half of ledge round every
 * building on the map, at a height you can reach.
 */
const FOOT_H = 1.0, FOOT_OUT = 1.0;
const SHOP_H = 4.6, SHOP_OUT = 0.5;
const CANOPY_OUT = 1.1;
function groundStorey(r: Roof, k: number, o = 1) {
  // The foot. Wide, low, and the same material as the pavement it stands on, so
  // the building looks like it was poured onto the footway rather than dropped.
  box([r.cx, FOOT_H / 2, r.cz], [r.w + FOOT_OUT * 2 * o, FOOT_H, r.d + FOOT_OUT * 2 * o],
    PLINTH_C, undefined, S_PAVING);
  // The ground storey: darker, glazed, and its own thing. This is the band your
  // eye uses to judge how tall everything above it is.
  // Lighter than it looks it should be. This band wears the ROAD surface, whose
  // base map is the dark worn panel, so a tint chosen to look like a dark
  // shopfront lands at nearly black and every building on the map ends up
  // standing in its own shadow. The tint has to be picked against the map, not
  // against the intention.
  if (o === 1) {
    box([r.cx, (FOOT_H + SHOP_H) / 2, r.cz],
      [r.w + SHOP_OUT * 2, SHOP_H - FOOT_H, r.d + SHOP_OUT * 2],
      0xa8b0bd, undefined, S_ROAD);
  }
  // And the canopy over it, in paint. One brush, and it is the single most
  // visible thing at street level in the whole district — a line of colour at
  // head height running the length of every block, with a shadow under it.
  const c = pick(ACCENT, k * 3 + 1);
  box([r.cx, SHOP_H + 0.3, r.cz],
    [r.w + CANOPY_OUT * 2 * o, 0.6, r.d + CANOPY_OUT * 2 * o], c, undefined, S_PAINT);
  // A lit strip tucked under the canopy's lip, which is what a shopfront is
  // after dark: not a bright wall, a bright soffit and a dark pavement.
  if (o === 1) {
    box([r.cx, SHOP_H - 0.15, r.cz],
      [r.w + (CANOPY_OUT - 0.35) * 2, 0.3, r.d + (CANOPY_OUT - 0.35) * 2],
      LIT_WARM, undefined, S_LAMP);
  }
}

/**
 * Masses still waiting to be told whether they get a ground storey.
 *
 * The plinth, the dark shopfront band and the painted canopy over it are the
 * right base for a mass with a texture on it, and exactly the wrong one for a
 * mass with a building standing against it: they wrap all four sides and cannot
 * be switched off on one, so the canopy sails out a metre in front of the brick
 * and cuts the building in half at the first floor.
 *
 * Which masses those are is not known until the frontages have been built —
 * whether a building fits depends on the height of the wall behind it — so the
 * decision is deferred and taken in one pass at the end.
 */
const PENDING_BASE: { r: Roof; k: number }[] = [];
/** Where a real building ended up standing, so a mass can ask if it has one. */
const STOOD: { x: number; z: number }[] = [];

function facade(r: Roof, from = 0) {
  if (from === 0) PENDING_BASE.push({ r, k: Math.round(r.cx) * 31 + Math.round(r.cz) });
  // Whether this building's lights are on, and what colour they are. By
  // position, so a building is consistent with itself and different from the one
  // next to it — a street where every window is the same warm strip is a
  // wallpaper, and one where they alternate is a place where people work
  // different shifts.
  const k = Math.round(r.cx) * 977 + Math.round(r.cz);
  const lit = hash(k) % 5 === 0 ? LIT_COLD : LIT_WARM;
  let storey = 0;
  for (let y = Math.max(from, PLINTH) + 8.5; y < r.top - 4.5; y += 8.5) {
    box([r.cx, y, r.cz], [r.w + 0.5, 1.1, r.d + 0.5], TRIM, undefined, S_TRIM);
    // A lit slot above the service band, on the tall ones only.
    //
    // These used to be on every band of every building, and they were carrying
    // the whole night skyline on their own. They do not have to any more: the
    // walls have windows in them now, and a continuous glowing line round every
    // storey of every mass on top of that is one lighting idea too many — the
    // bands and the window rows fight for the same horizontal, and the building
    // ends up striped. Kept where a mass is big enough that its middle would
    // otherwise be a blank thirty metres.
    if (r.top > 40 && storey % 2 === 0) {
      box([r.cx, y + 1.45, r.cz], [r.w + 0.34, 0.55, r.d + 0.34], lit, undefined, S_LAMP);
    }
    storey++;
  }
  // Stops just under the deck. A lip that rose ABOVE the roof would be a thing
  // to catch a slide on at every launch edge on the map.
  const capTop = r.top - DECK_T - 0.05;
  if (capTop - from > 3) {
    box([r.cx, capTop - 0.8, r.cz], [r.w + 0.7, 1.6, r.d + 0.7], TRIM, undefined, S_TRIM);
    // A cornice light under the cap, so the top of every building has an edge
    // you can pick out against the sky from the far side of the district.
    box([r.cx, capTop - 2.1, r.cz], [r.w + 0.44, 0.4, r.d + 0.44], lit, undefined, S_LAMP);
  }
}

/**
 * The footway round a block: one slab, a hand's width proud of the road.
 *
 * This is the cheapest separation on the map and the one that was missing
 * longest. A district where the floor and the walls are cut from the same grey
 * has no edge between them — you cannot see where the ground stops, and every
 * street reads as a corridor moulded out of one material. A pale apron in a
 * different material, with the dark road between two of them, is what makes a
 * road a road: one box per block, thirty boxes for the whole city.
 *
 * `APRON` is deliberately under `character.stepHeight` (0.35). It is a kerb to
 * look at and nothing to trip on, at any speed, from any direction.
 */
const APRON = 0.14;
const APRON_OUT = 3.5;
/**
 * The pavement round the outside of the district, between the outermost blocks
 * and the rim. Declared here rather than with the ground it belongs to, because
 * the frontages need it: a face on the edge of the map has this in front of it
 * where an inner one has a street, and how far a building may stand off a wall
 * is decided by what is in front of that wall.
 */
const PAVE = 18;
function footway(cx: number, cz: number, w: number, d: number) {
  box([cx, APRON / 2, cz], [w + APRON_OUT * 2, APRON, d + APRON_OUT * 2], PAVE_C,
    undefined, S_PAVING);
}

// --- the blocks --------------------------------------------------------------

for (let ri = 0; ri < ROWS.length; ri++) {
  for (let ci = 0; ci < COLS.length; ci++) {
    const kind = KIND[ri][ci];
    // Every block gets its footway except the Yard, which is a working yard and
    // is bare concrete for the same reason a loading bay is. It is also where
    // you spawn, and a 14 cm apron under the spawn point puts the player 14 cm
    // above the street — which is invisible, harmless, and exactly the kind of
    // drift `verify:level` exists to refuse.
    if (kind !== 'yard') footway(COLS[ci].c, ROWS[ri].c, COLS[ci].size, ROWS[ri].size);
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

// --- the places that are somewhere ---------------------------------------------
//
// A street lined with identical lamps and identical crates is a street with a
// texture on it, not a street. What makes a place read as a PLACE is that
// stretches of it are doing different jobs — this bit is a loading dock, that
// bit is a workshop with the door up, that bit is a row of stalls — and you can
// tell which is which from across the road, before you can see any of the
// detail, purely from the shape and the colour of what is stuck to the wall.
//
// So a handful of frontages get a THEME instead of the generic kit. Each one is
// about a dozen brushes and every one of them is off the same pack, and each is
// built the same way: something big against the wall to give the bay a
// silhouette, a colour, a light, and one piece of paint that names it.
//
// All of it stands on the footway and inside `APRON_OUT` of the wall, which is
// the strip the route never runs down.

/** A sign board hung flat on a wall: a lit panel with pack art on top of it. */
function signboard(
  f: Face, along: number, y: number, w: number, h: number, c: number, art: string,
) {
  const x = f.along === 'x' ? f.x + along : f.x;
  const z = f.along === 'z' ? f.z + along : f.z;
  // The board itself, 20 cm proud, lit so it reads at night.
  // Set so the board's BACK is inside the wall, not resting on a hairline in
  // front of it. It was 3.5 cm proud, which nothing noticed while a building
  // stood behind it and `verify:level` caught the moment one did not.
  const sw = f.along === 'x' ? w : 0.3;
  const sd = f.along === 'x' ? 0.3 : w;
  box([x + f.nx * 0.12, y + h / 2, z + f.nz * 0.12], [sw, h, sd], c, undefined, S_LAMP);
  // And the artwork, hung on the board. The pack's decals are floor plates, so
  // `wallProp` tips them up to face out — the same quarter turn a vent gets.
  wallProp(art, f.nx, f.nz, x + f.nx * 0.26, y + h * 0.12, z + f.nz * 0.26,
    Math.min(w, h) * 0.62);
}

/** A poster: pack art straight on the wall, no board. Cheap, and there can be many. */
function poster(f: Face, along: number, y: number, art: string, scale: number, out = 0) {
  const x = (f.along === 'x' ? f.x + along : f.x) + f.nx * out;
  const z = (f.along === 'z' ? f.z + along : f.z) + f.nz * out;
  wallProp(art, f.nx, f.nz, x, y, z, scale);
}

/** Art that reads as signage rather than as floor marking. */
const SIGN_ART = ['Decal_Logo', 'Decal_Logo_Letters', 'Decal_Sign', 'Decal_XSign'];
const POSTER_ART = ['Decal_Logo_Small', 'Decal_Sign', 'Decal_A', 'Decal_K', 'Decal_V',
  'Decal_X', 'Decal_Z', 'Decal_XSign'];

export type Bay = 'loading' | 'garage' | 'market' | 'plant';

/**
 * Dress a stretch of frontage as somewhere in particular.
 *
 * `at` is the offset along the face of the bay's centre and `span` how much of
 * the face it takes; everything is placed relative to those two, so a bay can be
 * dropped on any wall on the map without knowing which wall it is. `out` is
 * measured away from the wall and never exceeds the footway, because the middle
 * of the street is the run-up for every roof in the district.
 */
function bay(f: Face, kind: Bay, at: number, span: number, k: number) {
  /** World position at `t` along the face and `out` metres off the wall. */
  const on = (t: number, out: number): [number, number] => [
    (f.along === 'x' ? f.x + at + t : f.x) + f.nx * out,
    (f.along === 'z' ? f.z + at + t : f.z) + f.nz * out,
  ];
  /** A box lying along the face: `len` along it, `dep` off it. */
  const slab = (
    t: number, out: number, y: number, len: number, dep: number, h: number,
    c: number, surf: string,
  ) => {
    const [x, z] = on(t, out);
    box([x, y + h / 2, z], f.along === 'x' ? [len, h, dep] : [dep, h, len], c, undefined, surf);
  };
  const c = pick(ACCENT, k);
  const back = APRON;

  if (kind === 'loading') {
    // A dock at truck-bed height, which is the one piece of street furniture
    // that tells you what a building is FOR. Two shutters behind it, a canopy
    // over it, and the pallets nobody has moved.
    const DEP = 4.2;
    slab(0, DEP / 2, back, span, DEP, 1.1, shade(PLINTH_C, 1.2), S_DECK);
    // The painted lip: hazard colour, a hand's width proud, right on the edge.
    slab(0, DEP - 0.25, back + 1.1, span, 0.5, 0.12, c, S_PAINT);
    slab(0, DEP / 2, 6.4, span, DEP + 0.6, 0.5, c, S_PAINT);           // canopy
    // The soffit light sits UP INTO the canopy rather than under it. A strip
    // hung a hand's width below the thing it is fixed to is a strip attached to
    // nothing, which is both the rule this level keeps and, at this scale,
    // visibly true.
    slab(0, DEP / 2 + 0.4, 6.25, span * 0.9, 0.35, 0.28, LIT_WARM, S_LAMP);
    for (const sgn of [-1, 1]) {
      const t = sgn * span * 0.26;
      const [x, z] = on(t, 0);
      wallProp('Door_Frame_Square', f.nx, f.nz, x, back + 1.1, z);
      wallProp('Door_DarkMetal', f.nx, f.nz, x, back + 1.1, z);
    }
    // Freight on the dock, and a drum that rolled off it.
    const [px, pz] = on(-span * 0.4, 1.6);
    prop('Prop_Crate_Tarp_Large', px, back + 1.1, pz, yawOf(f));
    const [qx, qz] = on(span * 0.42, 2.2);
    prop('Prop_Crate_Large', qx, back + 1.1, qz, yawOf(f));
    const [bx, bz] = on(span * 0.5 + 2.4, 1.2);
    prop('Prop_Barrel1', bx, back, bz);
    signboard(f, at, 7.6, span * 0.34, 1.9, c, pick(SIGN_ART, k));
    decalAt(f, at - span * 0.5 - 3, DEP - 1, 'Decal_Dashes', 2.4);
  } else if (kind === 'garage') {
    // A workshop with the door up. The recess is the trick: a dark box set into
    // the frontage reads as a room you cannot quite see into, and one hole in a
    // wall does more for a street than ten objects in front of it.
    slab(0, 1.4, back, span * 0.62, 2.8, 5.2, 0x1a1e26, S_ROAD);
    const [gx, gz] = on(0, 0.2);
    wallProp('Door_Frame_SquareTall', f.nx, f.nz, gx, back, gz);
    // Lit from inside, low down, so the light spills onto the pavement.
    slab(0, 2.6, back + 0.06, span * 0.5, 0.5, 0.18, LIT_COLD, S_LAMP);
    // The shop: shelves down one side, a bench, drums, a locker.
    const [sx, sz] = on(-span * 0.24, 1.1);
    prop('Prop_Shelves_WideTall', sx, back, sz, yawOf(f));
    const [wx, wz] = on(span * 0.24, 1.2);
    prop('Prop_Desk_Medium', wx, back, wz, yawOf(f));
    const [lx, lz] = on(span * 0.42, 0.9);
    prop('Prop_Locker', lx, back, lz, yawOf(f));
    const [dx, dz] = on(-span * 0.46, 2.0);
    prop('Prop_Barrel2_Open', dx, back, dz);
    prop('Prop_Barrel2_Closed', dx + 1.1, back, dz);
    signboard(f, at + span * 0.42, 6.2, span * 0.3, 1.6, c, pick(SIGN_ART, k + 3));
    poster(f, at - span * 0.5 - 2.2, 3.1, pick(POSTER_ART, k), 1.7);
    decalAt(f, at, 3.4, 'Decal_XSign', 2.2);
  } else if (kind === 'market') {
    // Three stalls under three awnings in three colours. The most colour
    // anywhere on the map, all of it at head height, none of it on anything you
    // can run along.
    for (let i = -1; i <= 1; i++) {
      const t = i * (span / 3);
      const ac = ACCENT[(hash(k + i + 2) % ACCENT.length)];
      slab(t, 2.0, back, span / 3.4, 1.5, 1.0, shade(FURN, 0.9), S_CRATE);   // counter
      // The awning reaches back INTO the wall it hangs off. An awning is a
      // cantilever and this one has to actually be attached to something —
      // floated a metre off the frontage it is a coloured plank in mid-air.
      slab(t, 1.2, 2.9, span / 3.1, 2.6, 0.34, ac, S_PAINT);
      slab(t, 1.2, 2.78, span / 3.4, 2.0, 0.24, LIT_WARM, S_LAMP);           // under it
      const [cx, cz] = on(t + span / 8, 1.4);
      prop(pick(['Prop_Crate', 'Prop_Crate_Tarp', 'Prop_Ammo_Closed'], k + i), cx, back, cz,
        yawOf(f));
      poster(f, t + at, 4.6, pick(POSTER_ART, k + i * 5), 1.4);
    }
    decalAt(f, at, 3.6, 'Decal_Logo_Small', 2.6);
  } else {
    // A plant compound: railed off, humming, and lit from inside the fence.
    const DEP = 3.4;
    slab(0, DEP / 2, back, span, DEP, 0.2, shade(PLINTH_C, 0.9), S_STREET);
    railAlong(f.along, ...railAt(f, at, DEP), span - 1);
    const [px, pz] = on(-span * 0.28, 1.5);
    prop('Column_Pipes', px, back, pz);
    const [fx, fz] = on(span * 0.1, 1.5);
    prop('Prop_Fan_Small', fx, back + 0.2, fz);
    const [bx, bz] = on(span * 0.34, 1.3);
    prop('Prop_Barrel_Large', bx, back + 0.2, bz);
    prop('Prop_AccessPoint', bx + 1.4, back + 0.2, bz);
    slab(0, 0.6, back + 0.2, span * 0.7, 0.4, 0.2, LIT_COLD, S_LAMP);
    signboard(f, at, 5.4, span * 0.28, 1.5, ACCENT[0], 'Decal_XSign');
  }
}

/** The yaw that turns a prop to face out of `f`. */
function yawOf(f: Face) { return Math.atan2(f.nx, f.nz); }
/** Where a rail runs along the outer edge of a bay `dep` metres deep. */
function railAt(f: Face, at: number, dep: number): [number, number, number] {
  return [
    (f.along === 'x' ? f.x + at : f.x) + f.nx * dep,
    APRON + 0.2,
    (f.along === 'z' ? f.z + at : f.z) + f.nz * dep,
  ];
}
/** Floor paint in front of a bay. */
function decalAt(f: Face, at: number, out: number, art: string, scale: number) {
  const x = (f.along === 'x' ? f.x + at : f.x) + f.nx * out;
  const z = (f.along === 'z' ? f.z + at : f.z) + f.nz * out;
  decal(art, x, APRON, z, f.along === 'x' ? 0 : HALF_PI, scale);
}


/** The pack's finished buildings — the only three models on this map that are a
 *  whole building rather than a piece of one. */
const BLOCKS = ['Building_Small_1', 'Building_Medium_2_001', 'Building_Large_2'];

/**
 * How far a building's WALL stands proud of the mass behind it — a hand's
 * width, enough that the two planes never fight over the same pixels.
 *
 * Which is not the same as how far its BRUSH stands proud, and the difference
 * caught me out. A model is fitted to its brush by its bounding box, and these
 * three do not end at their wall: `Building_Small_1` carries 2.3 m of cornice
 * and stoop in front of its brickwork. Line the BOXES up on the street and the
 * brick sits two metres back inside the mass, with the block's own painted
 * canopy sailing out in front of it and cutting the building in half at the
 * first floor. So each one is pushed out by its own overhang as well, and what
 * lands on the line is the wall.
 */
const WALL_OUT = 0.12;
/** How far each of them reaches in front of its wall, in the model's own metres. */
const BUILD_FRONT: Record<string, number> = {
  Building_Small_1: 2.31, Building_Medium_2_001: 0.57, Building_Large_2: 0.32,
};
/** Widest first — see `run`, where that ordering is the whole budget. */
const ORDER = ['Building_Large_2', 'Building_Medium_2_001', 'Building_Small_1'];

/** The tallest mass standing at a point — whatever kind of block put it there. */
function massTopAt(x: number, z: number): number {
  let t = 0;
  for (const r of roofs) {
    if (Math.abs(x - r.cx) <= r.w / 2 - 0.01 && Math.abs(z - r.cz) <= r.d / 2 - 0.01
      && r.top > t) t = r.top;
  }
  return t;
}

/**
 * A street face, built out of the kit's FINISHED buildings.
 *
 * This is the part of the map you are actually in. A block is one solid mass
 * with a facade texture on it, which is the right way to build something you
 * run along the roof of and wallrun the side of — it is one collider and one
 * draw call, and the gameplay is a box because a box is what the movement was
 * tuned against. But the SURFACE of that box, on the two avenues the route runs
 * down, has no business being a texture: those walls are two metres from your
 * shoulder at 40 u/s and they are what the district looks like.
 *
 * So the street faces are lined with real buildings, sunk into the mass until
 * only the building line is proud of it. The collider is unchanged in every way
 * that matters — a box 1.6 m further out, which is less than the canopy it
 * replaces — and what you run past is brick, shopfronts, doorways with steps,
 * sash windows with a lit room behind them, and a cornice at the top.
 *
 * Each one is scaled to stand its stretch of wall up to the parapet, within
 * reason: `s` is capped at 1.6 because a building stops being a building once
 * its windows are three metres tall, and floored at 0.8 for the same reason
 * downward. The height available is measured off the masses themselves rather
 * than read from the plan, because a `step` block's face is only as tall as its
 * base and a `wing` changes height halfway along — and asking the geometry is
 * the only way to get both right without a special case for each kind.
 *
 * Returns the stretches it covered, so the wall-mounted dressing knows whether
 * it is hanging on brick 1.6 m out or on the bare mass behind it.
 */
function frontage(f: Face, k: number, clear: number, maxOut: number): [number, number][] {
  const covered: [number, number][] = [];
  const place = (c: number, m: string, s: number) => {
    const dep = CITY[m][2] * s;
    const out = WALL_OUT + BUILD_FRONT[m] * s - dep / 2;
    const x = (f.along === 'x' ? f.x + c : f.x) + f.nx * out;
    const z = (f.along === 'z' ? f.z + c : f.z) + f.nz * out;
    cityProp(m, x, APRON, z, yawOf(f), s);
    STOOD.push({ x, z });
  };
  /** The lowest the wall gets over a stretch of face, sampled inside it. */
  const roomOver = (lo: number, hi: number) => {
    let t = Infinity;
    const n = Math.max(2, Math.ceil((hi - lo) / 2));
    for (let i = 0; i <= n; i++) {
      const at = lo + 0.4 + Math.max(0, hi - lo - 0.8) * (i / n);
      const x = (f.along === 'x' ? f.x + at : f.x) - f.nx * 2;
      const z = (f.along === 'z' ? f.z + at : f.z) - f.nz * 2;
      t = Math.min(t, massTopAt(x, z));
    }
    return t - DECK_T - 0.3;
  };
  /**
   * The face cut into stretches of equal wall height, measured off the masses
   * themselves rather than read from the plan — a `step` block's face is only
   * as tall as its base, and a `wing` changes height halfway along.
   *
   * It has to be done BEFORE anything is sized, and that is the whole reason
   * this exists. The first version measured the wall over the next 24 m, sized
   * a row against it, and then centred the row in the stretch — which moves it
   * off the ground it was measured over. On the one face where that mattered it
   * put a thirty-metre building half onto a fourteen-metre wing, standing eight
   * metres over a roof the route launches from, and `verify:level` was the only
   * thing that noticed.
   */
  const stretches = () => {
    const out: { lo: number; hi: number; room: number }[] = [];
    const half = f.len / 2;
    for (let t = -half + 0.6; t < half - 0.6; t += 2) {
      const x = (f.along === 'x' ? f.x + t : f.x) - f.nx * 2;
      const z = (f.along === 'z' ? f.z + t : f.z) - f.nz * 2;
      const room = massTopAt(x, z) - DECK_T - 0.3;
      const last = out[out.length - 1];
      if (last && Math.abs(last.room - room) < 0.5) last.hi = Math.min(half, t + 2);
      else {
        // The boundary is somewhere in the two metres between this sample and
        // the last, so it belongs to the SHORTER of the two. Handing the
        // benefit of the doubt to the taller one is how a building ends up
        // hanging a metre and a half over the low half of a wing.
        if (last) last.hi = t - 2;
        out.push({ lo: out.length ? t - 2 : -half, hi: Math.min(half, t + 2), room });
      }
    }
    if (out.length) out[out.length - 1].hi = half;
    return out;
  };
  /** Fill one stretch of constant height, and centre what fits in it. */
  const run = (lo: number, hi: number, room: number, salt: number) => {
    const picked: { m: string; s: number; w: number }[] = [];
    let used = 0;
    for (let i = 0; i < 6; i++) {
      // Every model that fits what is left, widest first. Three buildings over
      // four avenues is not much variety and the temptation is to shuffle them
      // freely — but a wider building is fewer buildings for the same wall, and
      // on this map that is the difference between lining every wide street and
      // lining half of them. So the hash picks between the two widest that fit,
      // and never reaches for the smallest while a bigger one would do.
      const fit = ORDER.map((m) => {
        const nat = CITY[m];
        return { m, s: Math.min(1.6, room / nat[1], (hi - lo - used) / nat[0]) };
      }).filter((o) => o.s >= 0.8
        // And it has to fit the STREET, not just the wall. These do not end at
        // their brickwork, and `Building_Small_1`'s 2.3 m of stoop is most of
        // an 8 m alley once there is one on each side of it.
        && WALL_OUT + BUILD_FRONT[o.m] * o.s <= maxOut);
      if (!fit.length) break;
      const o = fit[hash(k * 53 + salt * 131 + i * 17) % Math.min(2, fit.length)];
      const w = CITY[o.m][0] * o.s;
      picked.push({ m: o.m, s: o.s, w });
      used += w;
    }
    // Nothing stands here — a wing too low for a building, or a stub of face
    // beside a bay. That is what the modular shopfront is still for.
    if (!picked.length) {
      if (hi - lo >= 8) shopfront(f, k, lo, hi);
      return;
    }
    // Centre the row in its stretch: a leftover metre at each end reads as the
    // block's corner returning, where the same metre all at one end reads as a
    // building missing.
    const start = lo + (hi - lo - used) / 2;
    let t = start;
    for (const p of picked) {
      // One last look at the wall this one actually landed on. The row was
      // sized against the stretch and then centred in it, and the stretch
      // boundaries are sampled every two metres — so this is the check that a
      // building is never taller than the thing it is standing against, however
      // the arithmetic above rounded. A gap here reads as a break in the row.
      if (CITY[p.m][1] * p.s <= roomOver(t, t + p.w)) place(t + p.w / 2, p.m, p.s);
      t += p.w;
    }
    covered.push([start, t]);
    if (start - lo >= 8) shopfront(f, k, lo, start);
    if (hi - t >= 8) shopfront(f, k, t, hi);
  };
  let salt = 0;
  for (const g of stretches()) {
    // A themed bay is a hole in the row: a loading dock behind a building is a
    // loading dock nobody will ever see.
    if (clear > 0) {
      if (g.lo < -clear / 2 - 1) run(g.lo, Math.min(g.hi, -clear / 2 - 1), g.room, ++salt);
      if (g.hi > clear / 2 + 1) run(Math.max(g.lo, clear / 2 + 1), g.hi, g.room, ++salt);
    } else {
      run(g.lo, g.hi, g.room, ++salt);
    }
  }
  return covered;
}

/**
 * The older ground storey: 4 m wall modules, a cornice brush, corner columns and
 * a way in. Still the right tool for a stretch too low or too short to stand a
 * whole building on, and it is only ever three metres tall so it fits anywhere.
 */
function shopfront(f: Face, k: number, lo: number, hi: number) {
  const PANEL = 4;
  const len = hi - lo;
  const tiles = Math.floor(len / PANEL);
  const pad = (len - tiles * PANEL) / 2;
  // One material per building, so a frontage is a frontage and not a sample
  // book: brick, brick-with-trim, or the metal-and-concrete of a newer block.
  const kind = hash(k * 13) % 3;
  const wide = ['Brick_Inset_Window', 'Brick_Inset_Window', 'Metal_Window'][kind];
  const blank = ['Brick_Inset', 'Brick_Inset', 'Metal_Plain_3'][kind];
  for (let i = 0; i < tiles; i++) {
    const t = lo + pad + PANEL * (i + 0.5);
    const cx = f.along === 'x' ? f.x + t : f.x;
    const cz = f.along === 'z' ? f.z + t : f.z;
    // Roughly every other bay is glazed and the rest is blank wall. Not only
    // because an unbroken run of identical windows is a texture rather than a
    // building: a glazed module is five draw calls and a blank one is three.
    const m = hash(k * 31 + i) % 3 === 0 ? wide : blank;
    cityPanel(m, f.nx, f.nz, cx, APRON, cz);
  }
  // The band that closes the shopfront off from the mass above it. A brush and
  // not a run of `Cornice_*` modules: a 2 m cornice piece over a long frontage
  // is hundreds of draw calls for a line you read as a line.
  {
    const th = 0.5 + SHOP_OUT * 2;
    const mid = (lo + hi) / 2;
    box([(f.along === 'x' ? f.x + mid : f.x) + f.nx * (SHOP_OUT + 0.1), APRON + 3.1,
      (f.along === 'z' ? f.z + mid : f.z) + f.nz * (SHOP_OUT + 0.1)],
    f.along === 'x' ? [len, 0.55, th] : [th, 0.55, len], TRIM, undefined, S_TRIM);
  }
  // A corner column at each end, which is the piece that stops a facade being a
  // flat card stuck to the front of a box.
  for (const t of [lo + 0.7, hi - 0.7]) {
    cityPanel('Brick_CornerColumn_Bottom', f.nx, f.nz,
      f.along === 'x' ? f.x + t : f.x, APRON, f.along === 'z' ? f.z + t : f.z);
  }
  // Then the things that give it scale, and a way in.
  const n = Math.max(1, Math.round(len / 26));
  for (let i = 0; i < n; i++) {
    const t = lo + ((i + 0.5) / n) * len;
    const ax = f.along === 'x' ? f.x + t : f.x;
    const az = f.along === 'z' ? f.z + t : f.z;
    switch (hash(k * 17 + i) % 3) {
      case 0: {
        // A doorway with its own steps out onto the pavement.
        cityPanel('DoorFrame_Trim', f.nx, f.nz, ax, APRON, az);
        cityProp('Entrance_Concrete_2x2', ax + f.nx * 1.2, 0, az + f.nz * 1.2, yawOf(f));
        break;
      }
      case 1:
        cityPanel('Trim_FirstFloor_Window_001', f.nx, f.nz, ax, APRON, az);
        wallProp('Prop_Light_Wide', f.nx, f.nz, ax, 4.4, az, 1.6);
        break;
      default:
        cityPanel('DoorFrame_Metal_Single', f.nx, f.nz, ax, APRON, az);
        cityProp('Stairs_Entrance_Concrete', ax + f.nx * 1.1, 0, az + f.nz * 1.1, yawOf(f));
        break;
    }
  }
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

/**
 * Which frontage does which job, keyed by the seed the face is dressed with.
 * Hand-written rather than hashed: the point of a themed bay is that it is
 * DIFFERENT from its neighbours, and a random draw puts two loading docks side
 * by side about as often as not.
 */
const BAY_PLAN: Record<number, Bay> = {
  41: 'loading', 49: 'market', 57: 'garage',
  84: 'garage', 92: 'plant', 100: 'loading',
  6: 'market', 86: 'plant',
  51: 'loading', 131: 'garage',
};

/** Dress one street-facing wall: buildings, a theme if it has one, posters. */
function street(f: Face, k: number, maxOut: number) {
  const kind = BAY_PLAN[k];
  const span = Math.min(19, f.len * 0.4);
  const cover = modeledOnly(() => frontage(f, k, kind ? span : 0, maxOut));
  /**
   * Where the wall IS at a point along this face — on the building line, or on
   * the mass behind it. Everything hung on a wall has to ask: a poster pinned
   * to the mass is a poster inside a building, and one pinned to the building
   * line where no building stands is a poster floating over the street.
   */
  const wallAt = (t: number) =>
    cover.some(([a, b]) => t > a + 1.5 && t < b - 1.5) ? WALL_OUT : 0;
  if (kind) bay(f, kind, 0, span, k);
  streetKit(f, k, kind ? span : 0, wallAt, maxOut);
  // A poster or two on the blank stretches either side, whatever the wall does
  // for a living. Paper on a wall is the cheapest life there is.
  for (const sgn of [-1, 1]) {
    const t = sgn * f.len * 0.36;
    poster(f, t, 4.2 + (hash(k + sgn) % 3) * 1.2,
      pick(POSTER_ART, k * 7 + sgn), 1.5 + (hash(k * 5 + sgn) % 3) * 0.35, wallAt(t));
  }
}

// Every outward face of every block in the district.
//
// This used to be the two avenues, then four of them, and the reason it was
// ever a subset is that a modular ground storey cost sixty draw calls a face
// and there was no budget for a hundred and thirty of them. There is now: the
// renderer instances the kit, so the second building of a kind in a cell is a
// matrix and the hundredth is a matrix. What decides where a building goes is
// no longer what it costs — it is whether one FITS, which is a question about
// the wall behind it and the width of the street in front of it, and both are
// measured per face.
//
// The street width is the part that is easy to forget. A face on an avenue has
// twenty-two metres in front of it and a face on an alley has eight, and these
// models do not end at their brickwork: `Building_Small_1` carries 2.3 m of
// stoop, which is most of an alley once there is one on each side. So each face
// is told how far it may reach, and the alleys quietly get the two models that
// stay close to their own wall.
{
  const seedOf = (ri: number, ci: number, f: number) => ri * 40 + ci * 4 + f;
  /** The gap in front of a face: the next block's wall, or the pavement. */
  const gap = (ss: typeof COLS, i: number, dir: -1 | 1) => {
    const next = ss[i + dir];
    if (!next) return PAVE;
    return dir > 0 ? next.lo - ss[i].hi : ss[i].lo - next.hi;
  };
  /** How far a building on this face may stand off it, leaving a lane clear. */
  const reach = (g: number) => Math.max(0.6, g / 2 - 2);
  for (let ri = 0; ri < ROWS.length; ri++) {
    for (let ci = 0; ci < COLS.length; ci++) {
      const R = ROWS[ri], C = COLS[ci];
      if (solidFace(ri, ci, 'x')) {
        street({ x: C.c, z: R.lo, nx: 0, nz: -1, along: 'x', len: C.size },
          seedOf(ri, ci, 0), reach(gap(ROWS, ri, -1)));
        street({ x: C.c, z: R.hi, nx: 0, nz: 1, along: 'x', len: C.size },
          seedOf(ri, ci, 1), reach(gap(ROWS, ri, 1)));
      }
      if (solidFace(ri, ci, 'z')) {
        street({ x: C.hi, z: R.c, nx: 1, nz: 0, along: 'z', len: R.size },
          seedOf(ri, ci, 2), reach(gap(COLS, ci, 1)));
        street({ x: C.lo, z: R.c, nx: -1, nz: 0, along: 'z', len: R.size },
          seedOf(ri, ci, 3), reach(gap(COLS, ci, -1)));
      }
    }
  }
}

// And now the bases, for every mass no building ended up standing on.
{
  const clad = (r: Roof) => STOOD.some((c) =>
    Math.abs(c.x - r.cx) < r.w / 2 + 1 && Math.abs(c.z - r.cz) < r.d / 2 + 1);
  // A mass with a building against it still needs a base on whatever sides did
  // not get one — a block that is brick on the street and a bare box down the
  // alley is worse than either. But the base wraps all four, so on these it is
  // pulled in to a fifth of its depth: still a plinth and still a painted line,
  // and comfortably behind the 12 cm the building line stands at.
  //
  // In the raw level there is nothing to hide behind and it gets the full one
  // instead, which is emitted right at the end of the file.
  for (const b of PENDING_BASE) {
    if (!clad(b.r)) { groundStorey(b.r, b.k, 1); continue; }
    modeledOnly(() => groundStorey(b.r, b.k, 0.18));
    CLAD_MASSES.push(b);
  }
}

/**
 * Street furniture down a frontage: lamps on columns, and clutter against the
 * wall behind them.
 *
 * The avenues are the run-up for every roof on the map and they earn their
 * emptiness — so all of this goes in the 3 m nearest the building, where nobody
 * running the street can reach it, and the middle twenty metres stay swept.
 *
 * `(nx, nz)` points AWAY from the wall, so `out` is measured into the street.
 */
function streetKit(f: Face, k: number, clear = 0,
  wallAt: (t: number) => number = () => 0, maxOut = 9) {
  const SPACING = 24;
  const n = Math.max(2, Math.floor(f.len / SPACING));
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n - 0.5) * f.len;
    // Nothing generic inside a themed bay. A street lamp standing in the middle
    // of a loading dock is the whole point of having themed bays, undone.
    if (Math.abs(t) < clear / 2 + 3) continue;
    const ax = f.along === 'x' ? f.x + t : f.x;
    const az = f.along === 'z' ? f.z + t : f.z;
    // An alley does not get a lamp post. There is 8 m between these buildings
    // and a 2.6 m column on each side leaves under three in the middle — which
    // reads as a blocked street and, worse, plays as one. It gets the thing a
    // real alley has instead: a lamp bracketed to the wall, and none of the
    // kerbside furniture that needs a kerb to stand on.
    if (maxOut < 3) {
      wallProp('Prop_Light_Wide', f.nx, f.nz, ax + f.nx * wallAt(t), 4.6,
        az + f.nz * wallAt(t), 1.6);
      if (hash(k * 7 + i) % 2 === 0) {
        const w = wallAt(t + 3);
        cityPanel('Prop_ACUnit', f.nx, f.nz, ax + (f.along === 'x' ? 3 : 0) + f.nx * w,
          4.2 + (hash(k + i) % 3) * 1.4, az + (f.along === 'z' ? 3 : 0) + f.nz * w);
      }
      continue;
    }
    // A column with a light on it, standing 2.6 m off the wall.
    const lx = ax + f.nx * 2.6;
    const lz = az + f.nz * 2.6;
    prop('Column_Round', lx, APRON, lz);
    // The head: a lit box on top of the column, which is the whole trick to a
    // street lamp that is a model of a post and nothing else.
    box([lx, 4.9 + APRON, lz], [1.5, 0.45, 1.5], LIT_WARM, undefined, S_LAMP);
    if (i % 2 === 0) {
      prop('Prop_Light_Floor', lx + f.nx * 0.9, APRON, lz + f.nz * 0.9,
        Math.atan2(f.nx, f.nz));
    }

    // City furniture on the kerb: the small things a street has and nobody
    // notices until they are missing. All of them are one draw call.
    switch (hash(k * 41 + i) % 4) {
      case 0:
        cityProp('Prop_Bollard', ax + f.nx * 4.4, APRON, az + f.nz * 0.0);
        cityProp('Prop_Bollard', ax + f.nx * 4.4 + (f.along === 'x' ? 2.2 : 0), APRON,
          az + (f.along === 'z' ? 2.2 : 0));
        break;
      case 1:
        cityProp('Prop_Planter_Single', ax + f.nx * 3.4, APRON, az + f.nz * 3.4,
          Math.atan2(f.nx, f.nz));
        break;
      case 2:
        cityProp('Prop_ManholeCover', ax + f.nx * 6.5, 0, az + f.nz * 6.5);
        break;
      default:
        cityProp('Prop_Drain', ax + f.nx * 5.0, 0, az + f.nz * 5.0);
        break;
    }
    // A condenser unit hung on the wall above head height, which is what the
    // back of a building actually looks like.
    if (hash(k * 7 + i) % 3 === 0) {
      const w = wallAt(t + 3);
      cityPanel('Prop_ACUnit', f.nx, f.nz, ax + (f.along === 'x' ? 3 : 0) + f.nx * w,
        4.2 + (hash(k + i) % 3) * 1.4, az + (f.along === 'z' ? 3 : 0) + f.nz * w);
    }

    // And something to walk past between the lamps, hard against the wall — on
    // the lamps the floodlight skipped, so the kerb alternates instead of
    // carrying one of everything at every post.
    if (i % 2 === 0) continue;
    const cm = pick(i % 2 ? BULK : UNITS, k * 29 + i);
    const cs = sciBox(cm);
    const off = ((i * 37) % 11) - 5;
    const back = wallAt(t + off) + cs[2] / 2 + 0.5;
    const gx = (f.along === 'x' ? ax + off : ax) + f.nx * back;
    const gz = (f.along === 'z' ? az + off : az) + f.nz * back;
    prop(cm, gx, APRON, gz, (hash(k + i * 3) % 4) * HALF_PI);
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
  box([x, y - 0.4, z], along === 'x' ? [len, 0.8, w] : [w, 0.8, len], ROAD,
    undefined, S_ROAD);
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

box([0, -BASE / 2, 0],
  [EXTENT.x1 - EXTENT.x0 + PAVE * 2, BASE, EXTENT.z1 - EXTENT.z0 + PAVE * 2], STREET,
  undefined, S_STREET);

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
  box([s * rimX, (RIM_H - BASE) / 2, 0], [2, RIM_H + BASE, rimZ * 2 + 2], MASS_LOW,
    undefined, S_PLINTH);
  box([0, (RIM_H - BASE) / 2, s * rimZ], [rimX * 2 + 2, RIM_H + BASE, 2], MASS_LOW,
    undefined, S_PLINTH);
}

// --- the rest of the city -----------------------------------------------------
//
// Ashgate is a district, and a district is part of something. Without this the
// rim is the end of the world: you stand on a 76 m tower, look out, and the
// city stops at a wall with nothing behind it, which is the moment a place
// turns back into a level.
//
// It is two layers, and they are two different jobs.
//
// The near layer is BUILDINGS. The city pack ships three finished ones —
// `Building_Small_1`, `Building_Medium_2_001` and `Building_Large_2` — and each
// is a whole house in one model: brick and concrete, a cornice, a glazed ground
// floor with a lit interior behind the glass, window bays up the front, a flat
// asphalt roof. Twelve primitives for all of it. Cladding one of the district's
// own masses out of 4 m wall modules costs more than twelve for a SINGLE STOREY
// of a single face, and that arithmetic is the whole argument for where each
// kind belongs: modules on the ground floor of the blocks you run past, and
// finished buildings everywhere the player only ever looks at.
//
// They stand on the ground outside the rim at their own size, which is the only
// size they read at — the windows and doors in them are modelled at human
// scale, and stop being windows and doors the moment they are stretched. The
// rim is 8 m and these are 17 to 28, so they clear it from anywhere you can
// stand: the view down every street on the map now ends in a building instead
// of in a wall.
//
// The far layer is the ring of masses beyond them, out where the fog already
// has them. Those carry no props, no decals and no gameplay — you cannot reach
// them and there is nothing on them to reach. All they do is stand between the
// near layer and the sky, and that is a job for a silhouette.

// The ground the rest of the city stands on. The district's floor stops at the
// rim, so without this every building past it is a model hanging over nothing —
// and it is the gaps BETWEEN them, seen from the crown, where you would notice.
box([0, -0.05 - BASE / 2, 0], [1500, BASE, 1500], shade(STREET, 0.34), undefined, S_STREET);

/**
 * One building of the outer city, on the ground, turned to face the district.
 *
 * The kit's buildings are glazed on their own +Z face — the same convention as
 * its wall panels, and the opposite of the sci-fi kit's `_Straight` pieces — so
 * pointing one at the map is a yaw and nothing else. The scale is uniform by
 * construction, because `cityProp` sizes the brush from the measured box; on a
 * model this large that is the difference between a building and a diorama.
 */
function outerBlock(m: string, x: number, z: number, inx: number, inz: number, k: number) {
  cityProp(m, x, 0, z, Math.atan2(inx, inz), k);
}

// Out here they are MASSES, not models. That is a reversal, and the reason for
// it is the only interesting thing about this block.
//
// The finished buildings were placed here first, filling the street mouths
// outside the rim — which looked right and was the wrong place for them. The
// buildings you run past, wallrun, and come down a street towards are the ones
// INSIDE the map, and once every wide street in the district was lined with
// them there was no budget left for a second set standing where you can only
// ever look at them over an eight-metre wall.
//
// So the outer city is what it should have been: low masses wearing the same
// window facade the district's own blocks wear, one draw call each and one for
// the cornice, fourteen to twenty-six metres tall so they read as the city the
// district stands in rather than competing with the tower ring behind them for
// the skyline. Broken by gaps, because an unbroken row is a wall with windows
// painted on it and the gaps are what read as side streets carrying on.
{
  const SIDES = [
    { ox: rimX + 1, oz: 0, inx: -1, inz: 0, half: rimZ, seed: 31 },
    { ox: -rimX - 1, oz: 0, inx: 1, inz: 0, half: rimZ, seed: 977 },
    { ox: 0, oz: rimZ + 1, inx: 0, inz: -1, half: rimX, seed: 4409 },
    { ox: 0, oz: -rimZ - 1, inx: 0, inz: 1, half: rimX, seed: 8171 },
  ];
  type Side = typeof SIDES[number];
  /**
   * The centre of something standing on a side: `t` along it, `out` away from
   * the rim. `t` runs along the side in the +Z side's -X and the -Z side's +X,
   * which only matters for keeping the seeded layout stable between them.
   */
  const spot = (s: Side, t: number, out: number): [number, number] =>
    [s.ox + s.inz * t - s.inx * out, s.oz - s.inx * t - s.inz * out];
  for (const s of SIDES) {
    let t = -s.half;
    for (let i = 0; t < s.half - 12; i++) {
      const h = hash(s.seed * 3 + i * 809);
      // A gap every few, and the walk carries on past it.
      if (h % 5 === 0) { t += 12 + (h >>> 4) % 14; continue; }
      const bw = Math.min(s.half - t - 2, 16 + (h % 18));
      const bd = 14 + ((h >>> 5) % 12);
      const th = 14 + ((h >>> 9) % 13);
      const [x, z] = spot(s, t + bw / 2, bd / 2 + ((h >>> 15) % 7));
      const tint = shade(pick(FACADE_TINTS, s.seed + i * 5), 0.95);
      const sx = Math.abs(s.inz) > 0.5 ? bw : bd;
      const sz = Math.abs(s.inz) > 0.5 ? bd : bw;
      box([x, (th - 10) / 2, z], [sx, th + 10, sz], tint, undefined, S_MASS);
      t += bw + 2;
    }
  }
}

{
  const RING_IN = 250;
  const RING_OUT = 380;
  /**
   * The rectangle nothing out here may stand inside: the district, its rim, and
   * now the two rows of buildings against it. That last clearance is why this
   * is 75 m rather than the 30 it was — the far ring used to start where the
   * near city now stands, and a backdrop tower growing out of a rooftop is the
   * same bug whether the roof belongs to the map or to the city behind it.
   */
  const CLEAR_X = (EXTENT.x1 - EXTENT.x0) / 2 + PAVE + 75;
  const CLEAR_Z = (EXTENT.z1 - EXTENT.z0) / 2 + PAVE + 75;
  // Eighteen, down from fifty-four. The near silhouette is carried by the
  // outer city's own masses now, and thirty towers' worth of draw calls buys a
  // great deal more standing on a street inside the map than it ever did here.
  for (let i = 0; i < 18; i++) {
    const h = hash(i * 7919);
    // Spread round the compass with a jitter, so the ring is not a polygon.
    const ang = (i / 18) * Math.PI * 2 + ((h % 100) / 100 - 0.5) * 0.09;
    let rad = RING_IN + ((h >>> 7) % 100) / 100 * (RING_OUT - RING_IN);
    // Taller further out, which is how a skyline behind a skyline reads: the
    // near ring cannot hide the far one, so the depth stays legible.
    const top = 26 + ((h >>> 13) % 70) + (rad - RING_IN) * 0.35;
    const w = 22 + ((h >>> 19) % 34);
    const d = 22 + ((h >>> 23) % 34);
    // A ring is a circle and the district is a rectangle, so a radius that
    // clears the map along one bearing plants a tower on a corner roof along
    // another: the district's corners are 256 m out, past the inner radius, and
    // that is exactly where two of these landed the first time. Push each one
    // out until its FOOTPRINT is clear of the whole rectangle — whichever axis
    // it escapes by — rather than trusting the radius alone.
    const ca = Math.abs(Math.cos(ang));
    const sa = Math.abs(Math.sin(ang));
    rad = Math.max(rad, Math.min(
      ca > 1e-3 ? (CLEAR_X + w / 2) / ca : Infinity,
      sa > 1e-3 ? (CLEAR_Z + d / 2) / sa : Infinity,
    ));
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const tint = shade(pick(FACADE_TINTS, i * 13), 0.9);
    // Down to well below the street: the base is never seen, and a backdrop
    // tower standing on its own visible bottom edge is a card, not a building.
    box([x, (top - 60) / 2, z], [w, top + 60, d], tint, undefined, S_MASS);
    box([x, top - 0.7, z], [w + 1.2, 1.4, d + 1.2], TRIM, undefined, S_TRIM);
    // No lit bands out here any more. They were carrying the backdrop's night
    // read before the walls had windows in them; now they are two brushes per
    // tower saying something the facade already says, and 54 towers' worth of
    // that is a hundred draw calls better spent inside the map.
    const lit = h % 4 === 0 ? LIT_COLD : LIT_WARM;
    // What it does at the top. Flat-topped boxes all the way round the horizon
    // is the one thing that gives a backdrop away — a real skyline is mostly
    // things standing on other things — so every tower ends in one of four
    // ways, by hash, and no two neighbours end the same way for long.
    const cap = h % 4;
    let crest = top;
    if (cap === 0 || cap === 1) {
      // Stepped: a smaller mass set back on top, twice for the tall ones. The
      // step used to carry a cornice band of its own, the way the main mass
      // does. At 300 m a 1.2 m band is a pixel and a half, and forty of them
      // is a whole building's worth of calls spent on something unresolvable.
      let cy = top;
      let cw = w * 0.62;
      let cd = d * 0.62;
      for (let step = 0; step < (cap === 0 ? 1 : 2); step++) {
        const ch = 8 + ((h >>> (3 + step * 4)) % 20);
        box([x, cy + ch / 2, z], [cw, ch, cd], tint, undefined, S_MASS);
        cy += ch;
        cw *= 0.62;
        cd *= 0.62;
      }
      crest = cy;
    } else if (cap === 2) {
      // A mast — the outline that says communications rather than offices, and
      // the one shape on a horizon that is unmistakably not a box.
      const mh = 14 + ((h >>> 5) % 26);
      box([x, top + mh / 2, z], [2.2, mh, 2.2], MAST, undefined, S_STEEL);
      box([x, top + mh * 0.42, z], [9, 1.2, 9], MAST, undefined, S_STEEL);
      crest = top + mh;
    }
    // A beacon on anything tall enough to need one, wherever its top ended up.
    if (crest > 84) box([x, crest + 1.2, z], [3.2, 1.5, 3.2], 0xff5a4a, undefined, S_LAMP);
    // And on a few of them, a sign the size of a building — the thing your eye
    // goes to first in any night skyline, and the only saturated colour out
    // here. Turned to face the middle of the district, because a billboard
    // facing away from the only person in the city is a wasted billboard.
    if (h % 7 === 0 && top > 50) {
      const bw = Math.min(w, d) * 0.8;
      const bh = Math.min(24, top * 0.3);
      const inx = -Math.cos(ang);
      const inz = -Math.sin(ang);
      box([x + inx * (w / 2 + 0.6), top * 0.66, z + inz * (d / 2 + 0.6)],
        Math.abs(inx) > Math.abs(inz) ? [1.2, bh, bw] : [bw, bh, 1.2],
        pick(ACCENT, i * 5), undefined, S_LAMP);
    }
  }
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
    box([px, h / 2, pz], [w, h, d], CRATE, undefined, S_CRATE);
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
  10, 1.2, TIER, 3, undefined, S_ROAD);

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
  // A working bench along the back of the deck, lit from over it. The Yard is
  // the only room in the district that gets looked at from standing height for
  // more than a second, so it is the one that has to survive being looked at.
  prop('Prop_Shelves_WideTall', yardDeck.cx - 2, yardDeck.top, yardDeck.cz - 3.4);
  prop('Prop_Locker', yardDeck.cx + 0.6, yardDeck.top, yardDeck.cz - 3.4);
  prop('Prop_Desk_Medium', yardDeck.cx + 4, yardDeck.top, yardDeck.cz - 3.2, HALF_PI);
  // Lit along the FLOOR of the bench rather than over it. A strip hung in the
  // air above a workbench is the one thing this level does not do — there is
  // nothing holding it up — and a lit floor throws the silhouettes of what is
  // standing on it towards you, which was the point of the light anyway.
  box([yardDeck.cx, yardDeck.top + 0.09, yardDeck.cz - 4.2], [13, 0.18, 0.7],
    LIT_WARM, undefined, S_LAMP);
}

// The rest of the Yard: the wall the Ladder is cut into gets a service bay, the
// west end gets the loading it is shaped like, and both get lit. Everything is
// kept out of the middle lane — the run-up to the Ladder mouth is the reason
// this room is the shape it is, and it stays swept.
{
  const bayZ = YARD_Z + 22;
  for (let i = 0; i < 5; i++) {
    const x = YARD_X - 24 + i * 11;
    prop(pick(BULK, i * 5 + 3), x, 0, bayZ - 1.6, (hash(i * 17) % 2) * HALF_PI);
    if (i % 2 === 0) prop('Prop_Barrel1', x + 2.6, 0, bayZ - 3.2);
    if (i % 2 === 1) prop('Prop_Locker', x + 2.2, 0, bayZ - 0.9, Math.PI);
  }
  // Pallets and drums against the south deck, out of the lane.
  for (let i = 0; i < 4; i++) {
    prop(pick(UNITS, i * 23 + 7), YARD_X - 20 + i * 7, 0, YARD_Z - 23.5,
      (hash(i * 5) % 4) * HALF_PI);
  }
  // Bay numbers on the floor under the lamps: this is bay 4, and bay 4 is
  // somewhere, where an unnumbered slab of concrete is not.
  for (let i = 0; i < 3; i++) {
    decal(pick(DIGITS, i + 4), YARD_X - 18 + i * 12, 0, bayZ - 7, 0, 2.4);
  }
  decal('Decal_Dashes', YARD_X - 2, 0, YARD_Z + 18, HALF_PI, 3);
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
    [LADDER_LEN, LADDER_TOP + BASE, 1.4], PADDING, undefined, S_PADDED);
}
export const LADDER_LANDINGS = shaftLedges('x', ladderX, YARD_Z, LADDER_LEN, 0, LADDER_TOP);
export const LADDER_STAGES = LADDER_LANDINGS.length + 1;
// A lamp on every landing. A shaft you climb in the dark is a shaft you climb
// once; lighting the flights is what tells you there is another one above.
for (const l of LADDER_LANDINGS) {
  prop('Prop_Light_Floor', l.x, l.y, YARD_Z + (SLOT / 2 - 0.8) * (l.x > ladderX ? 1 : -1));
}
// A hazard line painted across the mouth, where the floor stops being a room and
// starts being a route.
decal('Decal_Line_Straight', ladderX - LADDER_LEN / 2 - 3, 0, YARD_Z, 0, 3);
// Signed just inside the mouth, so it reads as a way up rather than an alley.
// On the INNER faces: the end of a wall is a 1.4 m strip of nothing to hang a
// sign on, and a sign hung there is a sign standing in mid-air.
wallProp('Prop_AccessPoint', 0, -1, ladderX - LADDER_LEN / 2 + 4, 3.2, YARD_Z + SLOT / 2, 1.6);
wallProp('Prop_Light_Wide', 0, 1, ladderX - LADDER_LEN / 2 + 9, 4.4, YARD_Z - SLOT / 2, 1.6);
// A lintel over the mouth: something to grapple, and it stops the corridor
// reading as a dead end from the far side of the Yard.
box([ladderX - LADDER_LEN / 2 + 0.6, LADDER_TOP + 1.2, YARD_Z], [1.2, 2.4, SLOT + 4],
  GANTRY, undefined, S_STEEL);

// --- the Line ----------------------------------------------------------------
// A conveyor, and the important word is CIRCUIT. It is a closed loop: 412 m
// along the avenue at z = -35, down the east side of the district, 412 m back
// along z = 101, up the west side, and into the first leg again. Something
// running along the top of it never arrives anywhere — it comes back round.
//
// That is the whole reason this is not the grid it started as. A grid of four
// legs crossing has eight ENDS, and a platform travelling a track with an end
// on it eventually runs off the end. There is no end here. Every leg finishes
// at a junction square and every junction square is on the loop, including the
// two chords over the north–south avenues, which leave the loop and rejoin it
// rather than stopping.
//
// The two long sides share one height profile, which is what makes the whole
// thing close: the deck is at the same height at any given x whether you are on
// the northern side or the southern one, so the two short sides are level, the
// chords between them are level at both ends, and going the whole way round
// returns you to where you started. Climb eastward along the north, hold 44
// down the east side, fall westward along the south, hold 20 up the west side.
//
// Above the deck a single beam runs the entire circuit at fourteen metres — the
// rail. It goes through every junction on both axes, so it is as closed as the
// road under it.
//
// What holds all of that up is PIERS, sixty metres apart, and not a frame under
// every stretch of road. The difference matters: the profile has eleven nodes
// in it and the deck is cut into a span at each one, so a frame per span put a
// hundred columns into a district you are meant to be able to see across. A
// girder under the deck and a lapped rail over it carry the road from one pier
// to the next, which is how an elevated road is actually built and why one does
// not stand in a forest of its own legs.

export const LINE_W = 16;
const LINE_T = 1.6;
/**
 * How far the overhead rail rides above the deck.
 *
 * Fourteen metres, which is far more headroom than a road needs and exactly
 * what this one does: the rail is not a roof, it is the thing the cargo hangs
 * from, and the cargo has to clear the deck with room to run under it.
 */
export const LINE_OVER = 14;
/** The rail's section. Every beam that meets it shares it, so nothing steps. */
const RAIL_W = 1.6, RAIL_H = 0.9;
/** How high a frame's posts reach: the top of the rail, and not past it. */
const MAST_UP = LINE_OVER + RAIL_H / 2;
/** How far one span's girder and rail run past a bend into the next one's. */
const LAP = 1.6;
/** How far apart the piers stand, and how clear of a junction they keep. */
const PIER_SPAN = 62, PIER_CLEAR = 26;
/** Portal legs stand this far either side of the centreline. */
export const LINE_PY = LINE_W / 2 - 1.2;
/** Everywhere the Line reaches the ground, so the verifier can measure spans. */
export const LINE_PIERS: { x: number; z: number }[] = [];
/** The two long sides run out here, over the pavement between blocks and rim. */
const LOOP_X = 206;
/** And the loop's two ends, which are the avenues at z = -35 and z = 101. */
const LOOP_Z0 = -35, LOOP_Z1 = 101;

/**
 * A leg of the Line: a straight run with a height profile.
 *
 * `nodes` are the profile as [along, deck height] in increasing `along`, and
 * every one of them is a bend in the road. A junction appears as a PAIR of
 * nodes at the same height sixteen metres apart — the flat square where two
 * legs cross — because a 16° pitch arriving at a flat crossing is a step you
 * catch a slide on, and the only way to not have one is for the profile itself
 * to level out before it gets there.
 */
export interface Leg {
  name: string;
  axis: 'x' | 'z';
  /** The line this leg runs down, on the other axis. */
  at: number;
  nodes: [number, number][];
}

/**
 * The profile both long sides use, west end to east end.
 *
 * Two flat shelves at the ends, two pitches, and gentle grades between. The
 * pitches are where the level change lives: slide friction (3) loses to slope
 * acceleration (95) from about two degrees, so 2.3° holds the speed you arrive
 * with and 13–16° pays you for being there.
 */
const LOOP_PROFILE: [number, number][] = [
  [-LOOP_X, 20], [-150, 20], [-115, 28], [-80, 28], [-64, 28],
  [10, 31], [45, 41], [63, 41], [79, 41], [150, 44], [LOOP_X, 44],
];

/** Where legs meet, and how high the deck is there. */
export const JUNCTIONS: { x: number; z: number; y: number }[] = [
  { x: -LOOP_X, z: LOOP_Z0, y: 20 }, { x: LOOP_X, z: LOOP_Z0, y: 44 },
  { x: -LOOP_X, z: LOOP_Z1, y: 20 }, { x: LOOP_X, z: LOOP_Z1, y: 44 },
  { x: -72, z: LOOP_Z0, y: 28 }, { x: -72, z: LOOP_Z1, y: 28 },
  { x: 71, z: LOOP_Z0, y: 41 }, { x: 71, z: LOOP_Z1, y: 41 },
];
const JUNCT_HALF = LINE_W / 2;

/**
 * A chord: off the loop at one avenue, across the district, back on at the
 * other. It dips in the middle — down a pitch, along the bottom, up the far
 * side — so that both ends can sit at the loop's height and the middle can
 * still be somewhere you accelerate.
 */
const chord = (name: string, x: number, top: number, dip: number): Leg => ({
  name, axis: 'z', at: x,
  nodes: [[LOOP_Z0, top], [LOOP_Z0 + 8, top], [LOOP_Z0 + 35, dip],
    [LOOP_Z1 - 35, dip], [LOOP_Z1 - 8, top], [LOOP_Z1, top]],
});

export const LINE_LEGS: Leg[] = [
  { name: 'north', axis: 'x', at: LOOP_Z0, nodes: LOOP_PROFILE },
  { name: 'south', axis: 'x', at: LOOP_Z1, nodes: LOOP_PROFILE },
  { name: 'east', axis: 'z', at: LOOP_X, nodes: [[LOOP_Z0, 44], [LOOP_Z1, 44]] },
  { name: 'west', axis: 'z', at: -LOOP_X, nodes: [[LOOP_Z0, 20], [LOOP_Z1, 20]] },
  chord('chord-west', -72, 28, 21),
  chord('chord-east', 71, 41, 34),
];

/** Deck height anywhere along a leg. */
export function lineY(leg: Leg, at: number): number {
  const n = leg.nodes;
  if (at <= n[0][0]) return n[0][1];
  for (let i = 1; i < n.length; i++) {
    if (at <= n[i][0]) {
      const t = (at - n[i - 1][0]) / (n[i][0] - n[i - 1][0]);
      return n[i - 1][1] + (n[i][1] - n[i - 1][1]) * t;
    }
  }
  return n[n.length - 1][1];
}

/**
 * Every stretch of deck each leg builds, as [from, to].
 *
 * These are BENDS, not breaks. A leg is cut into spans at each node because a
 * ramp is straight and a profile is not; consecutive spans share an endpoint
 * exactly. The only stretches a leg does not build are the junction squares,
 * and those are built once below — two decks at the same height in the same
 * place is a z-fight and a seam to catch a slide on.
 */
export const LINE_SEGS: Record<string, [number, number][]> = {};

for (const leg of LINE_LEGS) {
  const a0 = leg.nodes[0][0];
  const a1 = leg.nodes[leg.nodes.length - 1][0];
  const skip: [number, number][] = JUNCTIONS
    .filter((j) => Math.abs((leg.axis === 'z' ? j.x : j.z) - leg.at) < 1)
    .map((j) => {
      const c = leg.axis === 'z' ? j.z : j.x;
      return [c - JUNCT_HALF, c + JUNCT_HALF] as [number, number];
    });

  const cuts = new Set<number>([a0, a1]);
  for (const [n] of leg.nodes) if (n > a0 && n < a1) cuts.add(n);
  for (const [lo, hi] of skip) { if (lo > a0) cuts.add(lo); if (hi < a1) cuts.add(hi); }
  const marks = [...cuts].sort((p, q) => p - q);
  const segs: [number, number][] = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const lo = marks[i], hi = marks[i + 1];
    if (hi - lo < 0.5) continue;
    const mid = (lo + hi) / 2;
    if (skip.some(([s0, s1]) => mid > s0 && mid < s1)) continue;
    segs.push([lo, hi]);
  }
  LINE_SEGS[leg.name] = segs;

  const pos = (at: number, y: number): P3 => (leg.axis === 'z'
    ? { x: leg.at, y, z: at }
    : { x: at, y, z: leg.at });
  /** Offset across the leg — the other world axis, whichever that is. */
  const side = (p: P3, off: number): [number, number] => [
    p.x + (leg.axis === 'z' ? off : 0),
    p.z + (leg.axis === 'x' ? off : 0),
  ];

  for (const [lo, hi] of segs) {
    const yLo = lineY(leg, lo);
    const yHi = lineY(leg, hi);
    const seg = ramp(pos(lo, yLo), pos(hi, yHi), LINE_W, LINE_T, ROAD, 0, undefined, S_ROAD);
    const mid = pos((lo + hi) / 2, (yLo + yHi) / 2);

    // A kerb down each edge, so a slide that drifts does not simply leave. Low
    // enough to step over and a solid brush, unlike the handrail it replaces —
    // that was a kit model, and this level has a variant with no models in it.
    for (const sgn of [-1, 1]) {
      const [kx, kz] = side(mid, sgn * (LINE_W / 2 - 0.35));
      box([kx, mid.y + 0.45, kz], [0.7, 0.9, seg.len], TIER, seg.q, S_STEEL);
    }

    // A girder under the deck and the rail over it: both the length of the span
    // and both running LAP past the bend into the next span's, so the two
    // overlap rather than meeting on a plane.
    //
    // That lap is what lets the piers stand sixty metres apart. A span used to
    // need a frame of its own because it had nothing else holding it up, and
    // since the profile bends eleven times a leg, the frames came out wherever
    // the bends did — three of them bunched into forty metres around a pitch,
    // and a hundred columns in the district. A girder that runs from pier to
    // pier carries the road between them instead, which is what a girder is
    // for, and the columns go where a column should go rather than where the
    // road happens to change its mind.
    box([mid.x, mid.y - LINE_T / 2 - 0.8, mid.z], [6, 1.6, seg.len + LAP],
      GANTRY, seg.q, S_STEEL);
    // The rail: ONE beam down the centreline, on the deck's own slope. One, not
    // one under each edge — a single rail is what a gantry runs on and what the
    // frames below are shaped to carry.
    box([mid.x, mid.y + LINE_OVER, mid.z], [RAIL_W, RAIL_H, seg.len + LAP],
      GANTRY, seg.q, S_STEEL);
  }

  // Piers. A leg under each edge of the deck down to the ground, a cap across
  // under the deck, and the same posts carried up to the rail.
  //
  // The Overpass stood on a single column down the centreline, which was fine
  // because it ran down a 24 m avenue nothing else used. The chords run down
  // the 22 m straights that are the only run-up on the map long enough to reach
  // the hard cap, and a column in the middle of one leaves 7 m of lane either
  // side — which `verify:level` measures and refused. At the kerb they leave
  // eleven metres of clear road straight down the middle.
  //
  // They keep well clear of the junctions, which stand on four of their own.
  const blocked = skip
    .map(([s0, s1]) => [s0 - PIER_CLEAR, s1 + PIER_CLEAR] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const open: [number, number][] = [];
  let from = a0;
  for (const [b0, b1] of blocked) {
    if (b0 > from && from < a1) open.push([from, Math.min(b0, a1)]);
    from = Math.max(from, b1);
  }
  if (from < a1) open.push([from, a1]);

  for (const [o0, o1] of open) {
    const run = o1 - o0;
    if (run < 12) continue;
    const n = Math.max(1, Math.round(run / PIER_SPAN));
    for (let i = 0; i < n; i++) {
      const at = o0 + ((i + 0.5) / n) * run;
      const y = lineY(leg, at);
      const top = y - LINE_T;
      const p = pos(at, 0);
      LINE_PIERS.push({ x: p.x, z: p.z });
      for (const sgn of [-1, 1]) {
        const [px, pz] = side(p, sgn * LINE_PY);
        box([px, (top - BASE) / 2, pz], [2.4, top + BASE, 2.4], MAST, undefined, S_STEEL);
        box([px, y + MAST_UP / 2, pz], [1.6, MAST_UP, 1.6], MAST, undefined, S_STEEL);
      }
      const across = LINE_PY * 2 + 2.4;
      box([p.x, top - 1.2, p.z],
        leg.axis === 'z' ? [across, 1.6, 2.4] : [2.4, 1.6, across],
        GANTRY, undefined, S_STEEL);
      // The cross beam, in the SAME band as the rail rather than above it.
      // Above it, it was a step standing proud of the rail at every frame — a
      // bump on the one surface the cargo runs along, and the cargo runs along
      // all of it. Level with it, the two tops are one plane, the rail passes
      // through the beam instead of under it, and the strut hanging off the
      // rail's underside clears both.
      box([p.x, y + LINE_OVER, p.z],
        leg.axis === 'z' ? [across, RAIL_H, RAIL_W] : [RAIL_W, RAIL_H, across],
        GANTRY, undefined, S_STEEL);
    }
  }
}

// The junctions. One flat square each, built once for the two legs that meet
// there rather than twice — the deck, the frame under it and the rail over it
// all have to be single surfaces here, or the circuit has a seam across it in
// one direction and a post standing in it in the other.
//
// No kerbs: a kerb across a junction is a kerb across the road you are turning
// onto. The posts go to the four corners, which is the one part of a crossing
// nothing runs through.
for (const j of JUNCTIONS) {
  const top = j.y - LINE_T;
  box([j.x, j.y - LINE_T / 2, j.z], [LINE_W, LINE_T, LINE_W], ROAD, undefined, S_ROAD);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = j.x + sx * LINE_PY;
      const pz = j.z + sz * LINE_PY;
      box([px, (top - BASE) / 2, pz], [2.4, top + BASE, 2.4], MAST, undefined, S_STEEL);
      box([px, j.y + MAST_UP / 2, pz], [1.6, MAST_UP, 1.6], MAST, undefined, S_STEEL);
    }
  }
  LINE_PIERS.push({ x: j.x, z: j.z });
  const across = LINE_PY * 2 + 2.4;
  // The rail carried straight through on both axes — a single beam each way,
  // crossing in the middle. This is the piece that lets whatever runs along the
  // top of the Line turn a corner instead of arriving at one.
  box([j.x, j.y + LINE_OVER, j.z], [RAIL_W, RAIL_H, LINE_W], GANTRY, undefined, S_STEEL);
  box([j.x, j.y + LINE_OVER, j.z], [LINE_W, RAIL_H, RAIL_W], GANTRY, undefined, S_STEEL);
  for (const sgn of [-1, 1]) {
    box([j.x, top - 1.2, j.z + sgn * LINE_PY], [across, 1.6, 2.4], GANTRY, undefined, S_STEEL);
    box([j.x + sgn * LINE_PY, top - 1.2, j.z], [2.4, 1.6, across], GANTRY, undefined, S_STEEL);
    box([j.x, j.y + LINE_OVER, j.z + sgn * LINE_PY], [across, RAIL_H, RAIL_W],
      GANTRY, undefined, S_STEEL);
  }
}

/**
 * The circuit as a path, for the things that ride it.
 *
 * One closed polyline at RAIL height, anticlockwise from the west end of the
 * north side: east along z = -35 following the profile, south down the east
 * side, west along z = 101 following the same profile backwards, and north up
 * the west side to close. The last point joins the first — nothing in here says
 * where it ends because it does not have one.
 *
 * It is derived from the same profile the deck is built from rather than typed
 * out again, so a bend moved in one is a bend moved in both.
 */
export const rails: [number, number, number][][] = [(() => {
  const pts: [number, number, number][] = [];
  for (const [x, y] of LOOP_PROFILE) pts.push([x, y + LINE_OVER, LOOP_Z0]);
  pts.push([LOOP_X, 44 + LINE_OVER, LOOP_Z1]);
  for (let i = LOOP_PROFILE.length - 2; i >= 0; i--) {
    const [x, y] = LOOP_PROFILE[i];
    pts.push([x, y + LINE_OVER, LOOP_Z1]);
  }
  return pts;
})()];

// Ways on. A conveyor with no way onto it is scenery, so it is tied into the
// roofscape wherever one comes near — which, with nothing on it below 20 m,
// means the tall blocks and the Spire rather than the street.
{
  const north = LINE_LEGS[0];
  const cw = LINE_LEGS[4];
  const ce = LINE_LEGS[5];
  /** A flat bridge from a roof edge to a deck edge. Both are level; a 1° ramp
   *  between them would be the one grade a slide dies on. */
  const bridge = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    box([(x0 + x1) / 2, y - LINE_T / 2, (z0 + z1) / 2],
      [Math.max(10, Math.abs(x1 - x0) + 1), LINE_T, Math.max(10, Math.abs(z1 - z0) + 1)],
      ROAD, undefined, S_ROAD);
  };
  // Off the Spire's terrace, which sits at 30 with the north side passing three
  // metres away at 31.
  bridge(20, ROWS[1].hi, 20, LOOP_Z0 - LINE_W / 2, Math.min(TERRACE, lineY(north, 20)));
  // Onto the west chord where it bottoms out level with the spine roofs.
  bridge(COLS[2].lo, 40, cw.at + LINE_W / 2, 40, Math.min(HEIGHT[2][2], lineY(cw, 40)));
  // And onto the east chord, off the tall block beside it, on a long diagonal
  // because that one is seven metres up.
  ramp({ x: COLS[4].lo, y: HEIGHT[3][4], z: 40 },
    { x: ce.at + LINE_W / 2, y: lineY(ce, 75), z: 75 }, 10, 1.2, ROAD, 3,
    undefined, S_ROAD);

  // A footbridge across the north end of the same avenue. The Overpass used to
  // run the full length of it and carried this crossing for free; the loop turns
  // east at z = -35 and leaves the top of that avenue with a 31 m roof-to-roof
  // jump over it, which is past the budget on both tunes. This is the smallest
  // thing that answers it: one deck at the lower of the two roofs.
  {
    const y = Math.min(HEIGHT[0][3], HEIGHT[0][4]);
    box([(COLS[3].hi + COLS[4].lo) / 2, y - LINE_T / 2, ROWS[0].c],
      [COLS[4].lo - COLS[3].hi + 2, LINE_T, 10], ROAD, undefined, S_ROAD);
  }
}

// --- the Spire ---------------------------------------------------------------
// The landmark, and the only place on the map where the height is not
// negotiable. Base to 30 so the surrounding roofs and the Overpass all meet its
// terrace, tower to 76, and three separate ways up — a single-solution climb in
// a movement game is a lock, not a challenge.

// Banded like everything else, and it was the last thing on the map that was
// not. The landmark went up as a bare slab while every ordinary block around it
// had a foot, a cornice and lit floors — which read exactly backwards: the one
// building you are meant to pick out of the skyline was the one with nothing on
// it to pick out. The tower's bands start at the terrace, because everything
// below that is inside the base mass and would only fight it for the same
// millimetre.
facade(mass(COLS[3].c, ROWS[1].c, COLS[3].size, ROWS[1].size, TERRACE));
facade(mass(TOWER_X, TOWER_Z, TOWER_W, TOWER_D, SPIRE_TOP), TERRACE);

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
  box([px, y - 0.7, pz], [sw, 1.4, sd], PAD, undefined, S_MARKED);
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
    [sw * 0.62, 4.4, sd * 0.62], TIER, undefined, S_STEEL);
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
facade(core, TERRACE);
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
      [1.4, 22, 1.4], MAST, undefined, S_STEEL);
    // Aircraft warning lights on the four masts: the highest thing on the map,
    // and from anywhere in the district they are how you find it.
    box([TOWER_X + sx * (TOWER_W / 2 - 3), SPIRE_TOP + 22.4, TOWER_Z + sz * (TOWER_D / 2 - 3)],
      [2, 1.2, 2], 0xff5a4a, undefined, S_LAMP);
  }
}
box([TOWER_X, SPIRE_TOP + 4, TOWER_Z], [7, 8, 7], GANTRY, undefined, S_STEEL);
prop('Column_Pipes', TOWER_X, SPIRE_TOP + 8, TOWER_Z);
for (const sx of [-1, 1]) prop('Prop_Light_Floor', TOWER_X + sx * 5, SPIRE_TOP, TOWER_Z);
// The top of the map, marked as the top of the map.
decal('Decal_Logo', TOWER_X, SPIRE_TOP, TOWER_Z + 11, 0, 6);

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
    box([C.c, ph - DECK_T / 2, R.c], [pw, DECK_T, pd], DECK, undefined, S_DECK);
    roofs.push({ cx: C.c, cz: R.c, w: pw, d: pd, top: ph });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box([C.c + sx * (pw / 2 - 2), (ph - DECK_T - BASE) / 2, R.c + sz * (pd / 2 - 2)],
          [2.4, ph - DECK_T + BASE, 2.4], TIER, undefined, S_STEEL);
      }
    }
    for (const s of [-1, 1]) {
      box([C.c + (k % 2 ? 1 : -1) * (C.size / 2 - 12), (16 - BASE) / 2,
        R.c + R.size * 0.28 + s * (SLOT / 2 + 0.7)], [14, 16 + BASE, 1.4], PADDING,
      undefined, S_PADDED);
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

// --- the road surface ---------------------------------------------------------
// A centre line down each of the two avenues the route runs along.
//
// Paint is the cheapest thing in this file and close to the most valuable: a
// 22 m strip of ground with a dashed line down it is a ROAD, and the same strip
// without one is a gap between two buildings. It also does a job for the
// player, because a line running away from you down a street is a direction,
// and this is a map you are meant to cross at forty metres a second.
{
  const AVE_X = (COLS[1].hi + COLS[2].lo) / 2;
  const AVE_Z = (ROWS[1].hi + ROWS[2].lo) / 2;
  const STRIDE = 12;
  // The city kit ships road markings as models — a double yellow, a broken lane
  // line, a crosswalk, a stop bar, turn arrows — so none of this is drawn by
  // hand any more. A 6 m marking is one draw call and it is the difference
  // between a strip of ground and a road.
  //
  // The kit's lines run along X, so the north–south avenue turns them a quarter
  // and the east–west one does not.
  for (let z = EXTENT.z0 + 8; z < EXTENT.z1 - 8; z += STRIDE) {
    if (Math.abs(z - AVE_Z) < 18) continue;
    road('Decal_DoubleYellow_Straight', AVE_X, 0, z, HALF_PI);
    // A lane line either side of the centre, so it reads as four lanes. Every
    // other stride: the model is itself a run of dashes, so laying one end to
    // end down the avenue paints a dashed line at twice the price of a dashed
    // line.
    if (Math.round(z / STRIDE) % 2) continue;
    for (const sgn of [-1, 1]) {
      road('Decal_BrokenLine_Straight', AVE_X + sgn * 5.5, 0, z, HALF_PI);
    }
  }
  for (let x = EXTENT.x0 + 8; x < EXTENT.x1 - 8; x += STRIDE) {
    if (Math.abs(x - AVE_X) < 18) continue;
    road('Decal_DoubleYellow_Straight', x, 0, AVE_Z);
    if (Math.round(x / STRIDE) % 2) continue;
    for (const sgn of [-1, 1]) {
      road('Decal_BrokenLine_Straight', x, 0, AVE_Z + sgn * 5.5);
    }
  }
  // The junction: a crosswalk on each approach with a stop bar behind it, and
  // an arrow on the road telling you which way the lane goes. This is the one
  // place on the map where two roads meet, and it is worth eight draw calls.
  for (const s2 of [-1, 1]) {
    road('Decal_Crosswalk', AVE_X + s2 * 13, 0, AVE_Z, HALF_PI);
    road('Decal_Stop', AVE_X + s2 * 18, 0, AVE_Z - s2 * 3, HALF_PI);
    road('Decal_Crosswalk', AVE_X, 0, AVE_Z + s2 * 13);
    road('Decal_Stop', AVE_X - s2 * 3, 0, AVE_Z + s2 * 18);
    road('Decal_ArrowStraight', AVE_X - s2 * 3, 0, AVE_Z + s2 * 26);
  }
}

// --- street lines ------------------------------------------------------------
// Three of them, and no more. The avenues are the run-up for every roof on the
// map, so they earn their emptiness.

// Two of these used to lie down the middle of a wide avenue, which was fine
// while the only thing overhead was sky. The Line stands its portal frames at
// the kerb of all four of them now, and a container line in what is left is a
// container line in the running lane — `verify:level` measures the widest clear
// run down an avenue and it went from 7 m to 4. So they moved out to the
// perimeter road, which is 18 m of pavement nothing else uses.
crates(COLS[1].c - 14, EXTENT.z1 + 9, 'x', 5, 11, 2);
crates(COLS[4].c - 20, (ROWS[0].hi + ROWS[1].lo) / 2, 'x', 5, 10, 4);
crates(EXTENT.x0 - 9, ROWS[3].c - 20, 'z', 4, 12, 6);

// --- the other Ashgate --------------------------------------------------------
// Everything above this line is in both levels or in the clad one. What follows
// is the raw level's own: the full-depth ground storey on the masses the clad
// level hides behind a building. Last in the file, so removing it from the clad
// list is a `splice` off the end and every index anything else holds still
// points at what it did.
const RAW_FROM = brushes.length;
for (const b of CLAD_MASSES) groundStorey(b.r, b.k, 1);
const RAW_ONLY = brushes.splice(RAW_FROM);

export { brushes };

/**
 * The same district with NOTHING from the asset packs in it.
 *
 * Not just the buildings: every brush that wears a model has the model taken
 * off it and stands as the box it always was. The collider is untouched, which
 * is the property that makes the pair worth having — the two levels play
 * identically and differ only in what you are looking at, so anything that
 * feels different between them is the art and not the level.
 *
 * A prop's box is white, because a prop's box is never seen; unwrapped, a
 * district of white boxes is a snowstorm. They go grey here instead.
 */
/**
 * One colour for every solid thing in the district, and two for the lights.
 *
 * The clad level's palette is doing a job that only makes sense with textures
 * under it: six facade tints so neighbouring buildings read apart, a roof that
 * takes some of its building's colour, a plinth that matches the pavement. Strip
 * the maps and all of that becomes sixty flat colours with nothing to justify
 * them, which reads as noise rather than as a scheme.
 *
 * So this level is one grey. Faces still separate — a box lit by a key and a
 * fill has four different values on it before any colour is involved — and what
 * is left carrying meaning is the LIGHT, which is the point of a greybox.
 */
const RAW_MASS = 0x99a2b0;
/** Lighting: the strips and lamps that are just illumination. */
const RAW_WHITE = 0xffffff;
/**
 * And the ones that mean something. Every marking, canopy, beacon, padded wall
 * and painted accent lands here — so on this level red is not a colour choice,
 * it is the whole of what the map is telling you, and there is exactly one
 * thing to learn instead of six.
 */
const RAW_RED = 0xff4436;
/** The two that are only ever illumination — window strips, soffits, lamp heads. */
const RAW_WHITE_FROM = new Set([LIT_WARM, LIT_COLD]);
const RAW_PROP = 0x8f97a6;
void RAW_PROP;
/**
 * Except the flat ones. A poster, a road marking, a wall panel and a vent grille
 * are all a few centimetres of nothing with a picture on them — as a box they
 * are a grey wafer, and one hung on a wall is a grey wafer resting on a
 * hairline, which `verify:level` calls floating and is right to. Anything under
 * a hand's width on some axis existed only to carry an image, so in this level
 * it does not exist. Nothing under `character.stepHeight` was ever holding
 * anything up, so the level plays exactly as it did.
 */
const PAINT_THIN = 0.35;
/**
 * And no textures either. Every surface in this level is `flat` — the brush's
 * colour, lit, sampling nothing — except the ones that were glowing, which
 * become `flatLit` and go on glowing. Stripping the textures off a level is not
 * the same as turning its lights off, and amber still has to mean "wallrun".
 */
const LIT_SURFACES = new Set([S_LAMP, S_PAINT, S_MARKED, S_PADDED]);
const rawSurface = (t?: string) => (t && LIT_SURFACES.has(t) ? 'flatLit' : 'flat');
const rawColour = (b: Brush) => {
  if (!b.t || !LIT_SURFACES.has(b.t)) return RAW_MASS;
  return b.c !== undefined && RAW_WHITE_FROM.has(b.c) ? RAW_WHITE : RAW_RED;
};
const bare = (b: Brush): Brush | null => {
  if (b.m && Math.min(b.s[0], b.s[1], b.s[2]) < PAINT_THIN) return null;
  const { m, ...rest } = b;
  void m;
  return { ...rest, t: rawSurface(b.t), c: rawColour(b) };
};
/**
 * And the ramps, renumbered. `RAMP_BRUSHES` is a list of INDICES, and this level
 * drops brushes out of the middle — so the raw level needs its own list or every
 * ramp on it points at whatever slid into its place. A ramp is also never
 * dropped for being thin: some of them are, and a ramp is a floor.
 */
export const RAMP_BRUSHES_RAW: number[] = [];
export const brushesRaw: Brush[] = (() => {
  const ramps = new Set(RAMP_BRUSHES);
  const out: Brush[] = [];
  const keep = (b: Brush | null) => { if (b) out.push(b); };
  for (let i = 0; i < brushes.length; i++) {
    if (MODELED.has(i)) continue;
    const b = ramps.has(i) ? bare(brushes[i]) ?? brushes[i] : bare(brushes[i]);
    if (!b) continue;
    if (ramps.has(i)) RAMP_BRUSHES_RAW.push(out.length);
    out.push(b);
  }
  for (const b of RAW_ONLY) keep(bare(b));
  return out;
})();

// --- cyberedge ---------------------------------------------------------------
// The same district a third time, in the art direction: off-white masses, a
// single red accent, a hard midday sun and a deep blue sky.
//
// A separate level rather than a switch on the raw one, because `ashgate-raw`
// is the greybox everything else is judged against and an art pass is precisely
// the thing that must never be able to move it. The two derive from the same
// brush list one line apart, so the massing cannot drift between them — what
// cyberedge changes is colour, surface, and later what is bolted onto it.

/**
 * The base the whole district is made of.
 *
 * Off-white, not white. Pure white has nowhere left to go when the key lands on
 * it: every sunlit face clips to the same flat maximum and the building loses
 * the four values that were telling you it was a box. A few percent of headroom
 * is the difference between a white city and a white silhouette.
 */
const CYBER_MASS = 0xf4f2ee;
/**
 * The strips that were illumination in the greybox.
 *
 * On a grey district a white band reads as a light. On a white one it is
 * invisible — so it becomes the other thing this style uses to break up a white
 * wall, which is a dark one. Same brushes, same places, opposite end of the
 * value range, and the district keeps every band it was drawn with.
 */
const CYBER_TRIM = 0x2b2f36;
/** And the accent. It is the only colour in the level and it stays that way. */
const CYBER_RED = 0xe2231a;

/** Ramp indices carry over untouched: this is a recolour, not a re-cut. */
export const RAMP_BRUSHES_CYBER: number[] = RAMP_BRUSHES_RAW.slice();
export const brushesCyber: Brush[] = brushesRaw.map((b) => ({
  ...b,
  // Nothing glows. This is a daylight level, and an emissive surface at noon
  // does not read as a light, it reads as a material with a bug in it.
  t: 'flat',
  c: b.c === RAW_WHITE ? CYBER_TRIM : b.c === RAW_RED ? CYBER_RED : CYBER_MASS,
}));

/**
 * Midday: the key high and nearly white, the dome deep blue, the haze pushed
 * most of the way out of the district.
 *
 * The dusk theme puts the sun low so it rakes across the volumes, which is the
 * right call when one grey has to do all the work. Here the surfaces carry the
 * contrast themselves, so the sun can go up top where it belongs and hand back
 * hard, short shadows with real black in them.
 */
export const CYBER_THEME: Theme = {
  zenith: 0x0a3a86,
  horizon: 0x9fc4ea,
  ember: 0x9fc4ea,
  sun: 0xfff6e8,
  sunPos: [180, 300, 140],
  sunScale: 1.15,
  // Overhead, so the dome's warm lobe sits around the sun instead of on the
  // skyline. At noon there is no sunset to put there.
  glow: [0.5, 0.83, 0.39],
  sky: 0xbcd4f0,
  ground: 0x6b7280,
  skyScale: 0.68,
  fill: 0xa8c0e0,
  fillScale: 0.4,
  fog: 0xdfe8f2,
  fogNear: 260,
  fogFar: 1400,
  exposure: 1.0,
  // The line. Everything else here is colour; this is the thing that makes a
  // white wall in front of a white wall read as two walls.
  ink: 0x0d1014,
  inkWidth: 1.15,
  inkFade: [150, 460],
};

// --- the lap -----------------------------------------------------------------
// Checkpoints sit on the surface you arrive at, never over a gap: one you have
// to stop to collect is one that costs you the run.

export const triggers: Trigger[] = [
  { p: [RINGS.ladder.x, RINGS.ladder.y + 3, RINGS.ladder.z], r: 13, kind: 'checkpoint', name: 'ladder' },
  { p: [RINGS.stacks.x, RINGS.stacks.y + 3, RINGS.stacks.z], r: 13, kind: 'checkpoint', name: 'stacks' },
  // On the Line, at the top of the pitch that climbs out of the middle of the
  // map — the one place on the circuit you arrive at from three directions.
  { p: [60, lineY(LINE_LEGS[0], 60) + 3, LINE_LEGS[0].at], r: 11,
    kind: 'checkpoint', name: 'overpass' },
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
