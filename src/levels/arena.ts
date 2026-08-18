// Hexagonal combat arena. Built for lateral movement and staying mobile: you should
// always be able to keep moving in a circle, never get cornered, and always have a
// wall or an obstacle within reach to convert into height or a direction change.
//
// Everything is generated, so the arena's shape is a handful of constants rather
// than a list of hand-placed boxes.

import type { Brush, Trigger } from './types';

const FLOOR = 0x4b5563;
const WALL = 0xd97706;
const PILLAR = 0x6b7280;
const PAD = 0x0ea5e9;
const RAMP = 0x8b5cf6;

// --- arena shape
const APOTHEM = 34;        // centre to the middle of a wall
const WALL_H = 15;
const WALL_T = 1.5;
// ~7deg lean. Two limits, not one: it must stay under wall.maxAngle to count as a
// runnable wall at all, AND stay shallow enough that climbing the bank doesn't fight
// the character controller — on a steep outward bank, rising into it reads as trying
// to climb an unclimbable slope and your vertical speed gets zeroed.
const WALL_TILT = 0.12;
const SIDES = 6;

// --- quaternion helpers. Euler order is a trap when you need "yaw, then tilt";
// composing two axis-angle rotations explicitly removes the ambiguity.
type Q = [number, number, number, number];

const axisAngle = (x: number, y: number, z: number, a: number): Q => {
  const s = Math.sin(a / 2);
  return [x * s, y * s, z * s, Math.cos(a / 2)];
};

const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const brushes: Brush[] = [];

// --- floor. One slab; the hex walls define the play space on top of it.
brushes.push({ p: [0, -1, 0], s: [APOTHEM * 2.4, 2, APOTHEM * 2.4], c: FLOOR });

// --- six slanted perimeter walls, leaning outward like a skate bowl so you can
// carry a wallrun around the arena instead of running into a dead stop.
const wallLen = 2 * APOTHEM * Math.tan(Math.PI / SIDES) + 3; // +overlap at the corners
for (let i = 0; i < SIDES; i++) {
  const theta = (i / SIDES) * Math.PI * 2;
  // Push the wall out as it leans, so its base stays on the hex edge.
  const radius = APOTHEM + (WALL_H / 2) * Math.sin(WALL_TILT);
  brushes.push({
    p: [Math.sin(theta) * radius, WALL_H / 2 - 0.5, Math.cos(theta) * radius],
    s: [wallLen, WALL_H, WALL_T],
    // yaw the wall to face the centre, THEN lean its top outward.
    q: qmul(axisAngle(0, 1, 0, theta), axisAngle(1, 0, 0, WALL_TILT)),
    c: WALL,
  });
}

// --- central dais: the contested high ground every arena needs.
brushes.push({ p: [0, 1, 0], s: [13, 2, 13], c: PILLAR });
brushes.push({ p: [0, 2.6, 0], s: [7, 1.2, 7], c: PAD });

// --- three tall pillars to wallrun around and break sightlines.
for (let i = 0; i < 3; i++) {
  const theta = (i / 3) * Math.PI * 2 + Math.PI / 6;
  brushes.push({
    p: [Math.sin(theta) * 17, 6, Math.cos(theta) * 17],
    s: [4.5, 13, 4.5],
    q: axisAngle(0, 1, 0, theta),
    c: PILLAR,
  });
}

// --- three approach ramps, offset from the pillars. The low end is buried below
// the floor so no vertical lip pokes through — a lip taller than character.stepHeight
// reads as a wall and stops you dead (this bit us on the old course ramp).
for (let i = 0; i < 3; i++) {
  const theta = (i / 3) * Math.PI * 2;   // offset from the pad ring so they don't overlap
  const tilt = 0.30;
  const r = 24;
  brushes.push({
    p: [Math.sin(theta) * r, 1.15, Math.cos(theta) * r],
    s: [9, 1, 13],
    q: qmul(axisAngle(0, 1, 0, theta), axisAngle(1, 0, 0, -tilt)),
    c: RAMP,
  });
}

// --- floating pads at mixed heights: dash and double-jump targets, and cover to
// drop off. Two rings, deliberately not aligned with each other.
for (let i = 0; i < 6; i++) {
  const theta = (i / 6) * Math.PI * 2 + Math.PI / 6;
  brushes.push({
    p: [Math.sin(theta) * 25, 6.5 + (i % 2) * 2.5, Math.cos(theta) * 25],
    s: [6, 0.8, 6],
    q: axisAngle(0, 1, 0, theta),
    c: PAD,
  });
}
for (let i = 0; i < 3; i++) {
  const theta = (i / 3) * Math.PI * 2;
  brushes.push({
    p: [Math.sin(theta) * 10.5, 9.5, Math.cos(theta) * 10.5],
    s: [5, 0.8, 5],
    q: axisAngle(0, 1, 0, theta),
    c: PAD,
  });
}

// --- low blocks: vault targets and slide cover, scattered off-axis so the arena
// never reads as symmetrical from the inside.
const lowBlocks: [number, number, number][] = [
  [12, 0, -22], [-20, 0, -12], [22, 0, 9], [-9, 0, 23], [-25, 0, 6], [6, 0, 27],
];
for (const [x, , z] of lowBlocks) {
  brushes.push({ p: [x, 0.75, z], s: [5, 1.5, 2.2], q: axisAngle(0, 1, 0, Math.atan2(x, z)), c: PILLAR });
}

export { brushes };

// The arena is a sandbox, not a race — no checkpoints. The run timer just acts as
// a stopwatch until combat gives us something worth measuring.
export const triggers: Trigger[] = [];

export const spawn = { x: 0, y: 6, z: 0 };   // drop onto the central dais
export const killY = -25;
