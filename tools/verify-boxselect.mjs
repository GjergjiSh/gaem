// The maths behind the editor's ctrl-drag box select.
//
// Mirrors boxSelect()'s onScreen/inside pair exactly, against a real three.js
// camera. The interesting case is the one that is easy to get wrong: a point
// BEHIND the camera. project() flips the sign of those and lands them back
// inside the rectangle, so a drag in front of you would also grab everything at
// your back. The view-space guard is what stops it, and the last section here
// shows what happens without it.
import * as THREE from 'three';

const W = 1600, H = 900;
const cam = new THREE.PerspectiveCamera(75, W / H, 0.1, 600);
cam.position.set(0, 0, 0);
cam.lookAt(0, 0, -1);              // looking down -Z
cam.updateMatrixWorld();

const r = { left: 0, top: 0, width: W, height: H };

// --- verbatim from Editor.boxSelect ---------------------------------------
const onScreen = (p) => {
  const view = p.clone().applyMatrix4(cam.matrixWorldInverse);
  if (view.z >= 0) return null;
  const ndc = p.clone().project(cam);
  return {
    x: r.left + (ndc.x * 0.5 + 0.5) * r.width,
    y: r.top + (-ndc.y * 0.5 + 0.5) * r.height,
  };
};
const inside = (lo, hi, p) => !!p && p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
// ---------------------------------------------------------------------------

// the same thing without the guard, for comparison
const naive = (p) => {
  const ndc = p.clone().project(cam);
  return {
    x: r.left + (ndc.x * 0.5 + 0.5) * r.width,
    y: r.top + (-ndc.y * 0.5 + 0.5) * r.height,
  };
};

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };
const v = (x, y, z) => new THREE.Vector3(x, y, z);

console.log('\ndead centre and the corners');
{
  const c = onScreen(v(0, 0, -20));
  check(Math.abs(c.x - W / 2) < 0.5 && Math.abs(c.y - H / 2) < 0.5,
    `a point straight ahead lands at the middle (${c.x.toFixed(0)},${c.y.toFixed(0)})`);
  const up = onScreen(v(0, 5, -20));
  check(up.y < c.y, 'up in the world is up on screen');
  const right = onScreen(v(5, 0, -20));
  check(right.x > c.x, 'and +x is to the right');
}

console.log('\na rectangle takes what is in it and nothing else');
{
  const lo = { x: W / 2 - 100, y: H / 2 - 100 };
  const hi = { x: W / 2 + 100, y: H / 2 + 100 };
  check(inside(lo, hi, onScreen(v(0, 0, -20))), 'a point at the centre is in');
  // Distance matters only OFF the view axis: a point on it projects to the
  // centre from any range, which is why the near/far pair below is off-axis.
  check(!inside(lo, hi, onScreen(v(4, 0, -6))),
    'an off-axis point up close is out — perspective throws it wide of the box');
  check(inside(lo, hi, onScreen(v(4, 0, -60))),
    'the same offset ten times further away is in');
  check(!inside(lo, hi, onScreen(v(40, 0, -20))), 'far to the side is out');
  // something small and near vs large and far, both centred: both in
  check(inside(lo, hi, onScreen(v(0.4, 0.2, -6))), 'near and slightly off-axis is in');
  check(inside(lo, hi, onScreen(v(1, 0.5, -200))), 'the same offset far away is in');
}

console.log('\nbehind the camera never selects');
{
  const lo = { x: 0, y: 0 };
  const hi = { x: W, y: H };            // drag over the whole viewport
  const behind = [v(0, 0, 20), v(3, -2, 50), v(-8, 4, 5)];
  for (const p of behind) {
    check(onScreen(p) === null, `(${p.x},${p.y},${p.z}) is rejected outright`);
  }
  const caught = behind.filter((p) => inside(lo, hi, naive(p))).length;
  console.log(`     without the view-space guard, ${caught}/${behind.length} of those`
    + ' would have been selected by a full-screen drag');
  check(caught > 0, 'and the guard is demonstrably doing something');
  check(behind.every((p) => !inside(lo, hi, onScreen(p))), 'with it, none of them are');
}

console.log('\nexactly on the edge counts as in');
{
  const c = onScreen(v(0, 0, -20));
  check(inside({ x: c.x, y: c.y }, { x: c.x, y: c.y }, c), 'a zero-size box round a point holds it');
}

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
