// Level-authoring maths. Euler order is a trap the moment a brush needs more
// than one rotation — "yaw, then tilt" and "tilt, then yaw" are different
// surfaces — so levels compose explicit axis-angle quaternions instead.

export type Q = [number, number, number, number];

export const axisAngle = (x: number, y: number, z: number, a: number): Q => {
  const s = Math.sin(a / 2);
  return [x * s, y * s, z * s, Math.cos(a / 2)];
};

export const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/**
 * A brush laid along a path: yaw it so its local +Z runs down the tangent, pitch
 * it onto the slope, then bank it about its own length. Applied in that order,
 * which is the only one that means what it reads like.
 */
export const orient = (yaw: number, pitch: number, roll = 0): Q =>
  qmul(qmul(axisAngle(0, 1, 0, yaw), axisAngle(1, 0, 0, pitch)), axisAngle(0, 0, 1, roll));

/** Rotate a vector by a quaternion. */
export const qapply = (q: Q, v: [number, number, number]): [number, number, number] => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx,
  ];
};

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Shortest signed difference between two angles, in (-PI, PI]. */
export const wrapAngle = (d: number) => {
  let a = d % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};
