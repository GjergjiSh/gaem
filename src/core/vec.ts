// Minimal vector math. core/ must not depend on three.js — see DESIGN.md rule 1.

export interface V3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const set = (a: V3, x: number, y: number, z: number) => { a.x = x; a.y = y; a.z = z; return a; };
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);

/** Horizontal (xz) length — the quantity almost every speed rule cares about. */
export const lenH = (a: V3) => Math.hypot(a.x, a.z);

export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3();
};

/** Rescale only the xz components, leaving y untouched. */
export const setLenH = (a: V3, target: number): V3 => {
  const l = lenH(a);
  if (l < 1e-9) return { x: 0, y: a.y, z: 0 };
  const s = target / l;
  return { x: a.x * s, y: a.y, z: a.z * s };
};

/** Remove the component of `a` pointing into `n` (used for slope/wall projection). */
export const projectOnPlane = (a: V3, n: V3): V3 => sub(a, scale(n, dot(a, n)));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Frame-rate independent exponential smoothing. rate is "units of catch-up per second". */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

export const shortestAngle = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// A/B pipeline smoke test.
