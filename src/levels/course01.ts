// Grey-box test course. Data, not hand-placed meshes — so a new obstacle is one line.
// Forward is -Z. Every section exists to isolate one technique.

export interface Brush {
  p: [number, number, number];  // centre
  s: [number, number, number];  // size
  r?: [number, number, number]; // euler rotation, radians
  c?: number;                   // colour
}

export interface Trigger {
  p: [number, number, number];
  r: number;
  kind: 'checkpoint' | 'goal';
  name: string;
}

const PLATFORM = 0x6b7280;
const RAMP = 0x8b5cf6;
const PAD = 0x0ea5e9;
const GOAL = 0x22c55e;
const WALL = 0xd97706;

export const brushes: Brush[] = [
  // --- start plate
  { p: [0, -0.5, 0], s: [14, 1, 14], c: PLATFORM },

  // --- section 1: a 6m gap. Plain jump clears it; dash makes it trivial.
  { p: [0, -0.5, -20], s: [14, 1, 14], c: PLATFORM },

  // --- section 2: slide ramp. ~21deg descent, the slope-accel test.
  // Placed so the top-rear corner lands exactly on the platform lip at (z=-27, y=0)
  // and the surface line hits platform C's top (y=-5) at z=-40. Rotating a box about
  // its centre lifts that corner above the deck, and anything over character.stepHeight
  // becomes an invisible wall you splat into at full speed.
  { p: [0, -3.338, -34.288], s: [14, 1, 16], r: [-0.3672, 0, 0], c: RAMP },
  { p: [0, -5.5, -48], s: [18, 1, 16], c: PLATFORM },

  // --- section 3: 20m void. A plain run-and-jump clears ~8m and a slide jump ~13m,
  // so this gap is only crossable with the dash-slide-jump ledge tech (~26m).
  { p: [0, -5.5, -84], s: [18, 1, 16], c: PLATFORM },

  // --- section 4: vertical. Double jump + air dash up the steps.
  { p: [-6, -3.5, -96], s: [5, 1, 5], c: PAD },
  { p: [4, -1.0, -104], s: [5, 1, 5], c: PAD },
  { p: [-4, 1.5, -112], s: [5, 1, 5], c: PAD },
  { p: [3, 4.0, -120], s: [5, 1, 5], c: PAD },

  // --- section 5: wallrun canyon. No floor — run the walls or fall.
  { p: [0, 4.5, -128], s: [12, 1, 8], c: PLATFORM },      // launch ledge
  { p: [-5, 8.5, -146], s: [1, 10, 30], c: WALL },
  { p: [5, 8.5, -146], s: [1, 10, 30], c: WALL },
  { p: [-3.4, 4.2, -144], s: [2.4, 0.6, 4], c: PAD },     // optional mid rest
  { p: [0, 4.5, -166], s: [14, 1, 10], c: PLATFORM },     // landing

  // --- section 6: wall-jump shaft. Walls run along Z so you attach side-on,
  // then alternate wall jumps to climb to the goal ledge.
  { p: [-3.4, 10.0, -180], s: [1, 14, 14], c: WALL },
  { p: [3.4, 10.0, -180], s: [1, 14, 14], c: WALL },

  // --- goal
  { p: [0, 11.0, -194], s: [14, 1, 14], c: GOAL },
];

export const triggers: Trigger[] = [
  { p: [0, 1, -20], r: 7, kind: 'checkpoint', name: 'gap' },
  { p: [0, -4, -48], r: 8, kind: 'checkpoint', name: 'ramp' },
  { p: [0, -4, -84], r: 8, kind: 'checkpoint', name: 'long gap' },
  { p: [3, 6, -120], r: 5, kind: 'checkpoint', name: 'climb' },
  { p: [0, 6.5, -128], r: 6, kind: 'checkpoint', name: 'canyon' },
  { p: [0, 6.5, -166], r: 7, kind: 'checkpoint', name: 'shaft' },
  { p: [0, 13, -194], r: 7, kind: 'goal', name: 'finish' },
];

export const spawn = { x: 0, y: 1.2, z: 4 };
export const killY = -40;
