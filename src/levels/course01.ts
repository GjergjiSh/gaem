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

export const brushes: Brush[] = [
  // --- start plate
  { p: [0, -0.5, 0], s: [14, 1, 14], c: PLATFORM },

  // --- section 1: a 6m gap. Plain jump clears it; dash makes it trivial.
  { p: [0, -0.5, -20], s: [14, 1, 14], c: PLATFORM },

  // --- section 2: slide ramp. ~20deg descent, the slope-accel test.
  { p: [0, -2.6, -34], s: [14, 1, 16.5], r: [-0.35, 0, 0], c: RAMP },
  { p: [0, -5.5, -48], s: [18, 1, 16], c: PLATFORM },

  // --- section 3: long gap, 13m. Needs slide boost into a dash to clear.
  { p: [0, -5.5, -70], s: [18, 1, 16], c: PLATFORM },

  // --- section 4: vertical. Double jump + air dash up the steps.
  { p: [-6, -3.5, -82], s: [5, 1, 5], c: PAD },
  { p: [4, -1.0, -90], s: [5, 1, 5], c: PAD },
  { p: [-4, 1.5, -98], s: [5, 1, 5], c: PAD },
  { p: [3, 4.0, -106], s: [5, 1, 5], c: PAD },

  // --- section 5: a corridor with walls, to feel collision sliding
  { p: [0, 6.0, -120], s: [10, 1, 20], c: PLATFORM },
  { p: [-5.5, 8.0, -120], s: [1, 4, 20], c: PLATFORM },
  { p: [5.5, 8.0, -120], s: [1, 4, 20], c: PLATFORM },

  // --- goal
  { p: [0, 6.0, -136], s: [14, 1, 14], c: GOAL },
];

export const triggers: Trigger[] = [
  { p: [0, 1, -20], r: 7, kind: 'checkpoint', name: 'gap' },
  { p: [0, -4, -48], r: 8, kind: 'checkpoint', name: 'ramp' },
  { p: [0, -4, -70], r: 8, kind: 'checkpoint', name: 'long gap' },
  { p: [3, 6, -106], r: 5, kind: 'checkpoint', name: 'climb' },
  { p: [0, 8, -136], r: 7, kind: 'goal', name: 'finish' },
];

export const spawn = { x: 0, y: 1.2, z: 4 };
export const killY = -40;
