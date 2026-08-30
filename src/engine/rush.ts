// Rush: what going fast looks like from inside the helmet.
//
// The movement already HAS a top end — hard cap, overspeed, chain bonuses — and
// until now the only thing on screen that knew about it was a number in the
// debug readout and a few degrees of FOV. This is the other half: the frame
// itself gets louder the closer you are to the cap, so "fast" is something you
// see at the edges rather than something you read.
//
// ## One number drives all of it
//
// Everything below is a function of `amount`, a 0..1 ratio that the renderer
// computes once from speed and damps once. Nothing here looks at velocity, and
// nothing here has its own threshold or its own smoothing — which is the whole
// reason the effects stay in step with each other instead of each arriving at
// its own moment. Retune the ratio and the FOV, the smear, the streaks and the
// vignette all move together.
//
// ## Why a pass and not an overlay
//
// Streaks could be drawn as a transparent quad over the finished frame and cost
// nothing. The smear cannot: a radial blur has to READ the image it is blurring,
// and so does the chromatic split, which is the same march with the channels
// pulled different distances. So this is a real screen-space pass that resamples
// the scene — and once it is resampling, the streaks and the vignette come along
// in the same shader for free rather than as a second draw.
//
// ## Where it sits
//
// Last. `Ink` renders the scene and draws the outline; when this pass is on, ink
// hands its result here instead of to the canvas and this does the tone map on
// the way out. With no ink in the theme the scene renders straight into this
// pass's target instead. Either way the chain ends here, which is the only place
// a full-frame effect can honestly go: tone mapping is an output-referred step
// and there is exactly one output.

import * as THREE from 'three';

/**
 * Taps along the smear.
 *
 * Eight, times three channels, is twenty-four fetches a pixel — but only on the
 * pixels that are actually smeared. The shader early-outs to a single fetch
 * wherever the effect has faded to nothing, which at rest is every pixel on the
 * screen and at speed is still the whole middle of it.
 */
const TAPS = 8;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tColor;
uniform float amount;      // 0..1, already shaped and damped by the renderer
uniform float blur;        // how far the smear reaches at full amount, in UV
uniform float streaks;     // streak brightness at full amount
uniform float streakCount; // how many wedges around the circle
uniform float streakSpeed; // how fast they come and go
uniform float aberration;  // channel split, as a fraction of the smear
uniform float vignette;    // edge darkening at full amount
uniform float inner;       // radius the effect starts at. 0 = centre, 1 = edge
uniform float aspect;
uniform float time;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  vec2 c = vUv - 0.5;
  // Aspect-corrected, or "radius" is an ellipse and the effect creeps in from
  // the sides of a widescreen frame long before it does from the top.
  vec2 d = c * vec2(aspect, 1.0);
  float r = length(d) * 2.0;

  // The middle of the screen is where you are LOOKING. Every part of this is
  // masked off it, so the effect lives at the edges and whatever you are aiming
  // at stays untouched however fast you are going.
  float edge = smoothstep(inner, 1.0, r);
  float k = amount * edge;

  vec3 col;
  if (k < 0.002) {
    // Nothing to do here, and this is most of the screen most of the time.
    col = texture2D(tColor, vUv).rgb;
  } else {
    // The smear: march back toward the centre, weighting the near taps higher
    // so the image stays anchored where it is rather than sliding inward.
    //
    // Each channel marches a slightly different distance, and that IS the
    // chromatic aberration — one loop for both effects rather than a second set
    // of taps for a fringe that wants to follow exactly the same path.
    float s = blur * k;
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < ${TAPS}; i++) {
      float t = float(i) / float(${TAPS} - 1);
      float w = 1.0 - t * 0.65;
      vec2 off = c * (t * s);
      sum.r += texture2D(tColor, vUv - off * (1.0 + aberration)).r * w;
      sum.g += texture2D(tColor, vUv - off).g * w;
      sum.b += texture2D(tColor, vUv - off * (1.0 - aberration)).b * w;
      wsum += w;
    }
    col = sum / wsum;
  }

  // Streaks. The screen is cut into wedges around the centre and each one gets
  // its own seed, so they sit at their own distances out and flicker on their
  // own schedule — a ring of evenly spaced lines all pulsing together reads as
  // a UI element, not as speed.
  if (streaks > 0.001 && k > 0.002) {
    float ang = atan(d.y, d.x);
    float wedge = (ang + 3.14159265) / 6.28318531 * streakCount;
    float id = floor(wedge);
    float f = fract(wedge) - 0.5;
    float rnd = hash(id + 0.5);
    float rnd2 = hash(id + 17.3);
    // Thin across the wedge. The power is what makes it a line rather than a
    // gradient filling the whole wedge.
    float thin = pow(smoothstep(0.5, 0.0, abs(f)), 6.0);
    // And starting at its own radius, so they do not all begin on one circle.
    // The jitter is a fraction of the room LEFT to the edge, not a flat 0.35,
    // so start can never reach 1.0 and break smoothstep's edge0 < edge1
    // requirement — which is exactly what happened when inner was pushed up:
    // inner + rnd * 0.35 went past 1.0 for part of the streaks and GLSL's
    // smoothstep is undefined past that point, which read as streaks that
    // didn't line up with the rest.
    float start = mix(inner, 1.0, rnd * 0.35);
    float along = smoothstep(start, 1.0, r);
    float phase = fract(rnd2 + time * streakSpeed);
    float life = smoothstep(0.0, 0.15, phase) * (1.0 - smoothstep(0.45, 0.9, phase));
    // Black, not white: a dark streak reads as motion blur / shadow racing past;
    // a white one reads as a light source, which is the wrong metaphor here.
    col = mix(col, vec3(0.0), clamp(streaks * k * thin * along * life, 0.0, 1.0));
  }

  // Vignette, on the raw amount rather than on the masked k: this one is
  // allowed to reach further in than the rest, because a dark corner is what
  // makes the middle of the frame look brighter and the tunnel look narrower.
  col *= 1.0 - vignette * amount * smoothstep(inner * 0.6, 1.2, r);

  gl_FragColor = vec4(col, 1.0);

  // Tone map and encode HERE, for the reason Ink used to: this is the last pass
  // and the only one whose destination is the canvas. Everything upstream is
  // linear light in a half-float target, which is where it has to stay until
  // the final step or the highlights clip before the mapper ever sees them.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Speed to the one number, before damping.
 *
 * Pure, exported and living here rather than inline in the renderer, because
 * this IS the centralised tuning the whole system is built around: every effect
 * downstream is a function of what comes out of it, so it is the piece worth
 * being able to test without a GPU.
 *
 * Smoothstepped rather than linear. A linear ramp starts with a corner — at
 * exactly `from` the effect goes from not changing to changing at full rate,
 * and a corner in the first derivative is visible even when the value itself is
 * still near zero.
 */
export function speedRatio(speed: number, cap: number, from: number, full: number): number {
  const lo = from * Math.max(1, cap);
  const hi = Math.max(lo + 1e-3, full * Math.max(1, cap));
  const x = Math.min(1, Math.max(0, (speed - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}

/**
 * What a burst of acceleration is worth, 0..1.
 *
 * Normalised by the threshold itself, so "twice the trigger" is always a full
 * kick whatever the trigger is set to — move the slider and the shape of the
 * response moves with it instead of the whole thing going on or off.
 */
export function kickAmount(accel: number, from: number): number {
  const t = Math.max(1, from);
  return Math.min(1, Math.max(0, (accel - from) / t));
}

/** Everything the pass reads, all of it from `T.rush`. */
export interface RushSettings {
  blur: number;
  streaks: number;
  streakCount: number;
  streakSpeed: number;
  aberration: number;
  vignette: number;
  inner: number;
}

export class Rush {
  private rt: THREE.WebGLRenderTarget | null = null;
  private mat: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private w = 0;
  private h = 0;
  private t = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        amount: { value: 0 },
        blur: { value: 0.12 },
        streaks: { value: 0.5 },
        streakCount: { value: 90 },
        streakSpeed: { value: 2.2 },
        aberration: { value: 0.35 },
        vignette: { value: 0.35 },
        inner: { value: 0.35 },
        aspect: { value: 1 },
        time: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  configure(s: RushSettings) {
    const u = this.mat.uniforms;
    u.blur.value = s.blur;
    u.streaks.value = s.streaks;
    u.streakCount.value = Math.max(1, s.streakCount);
    u.streakSpeed.value = s.streakSpeed;
    u.aberration.value = s.aberration;
    u.vignette.value = s.vignette;
    u.inner.value = s.inner;
  }

  /** The 0..1 the whole pass is a function of. */
  set amount(v: number) {
    this.mat.uniforms.amount.value = v;
  }

  /**
   * The target everything upstream draws into.
   *
   * Sized to the DRAWING buffer rather than to CSS pixels, for the reason Ink is:
   * a target at CSS size on a 2x display resamples the frame at half the
   * resolution of the frame, which reads as the whole picture going soft the
   * moment the pass switches on.
   *
   * MSAA on it, because with no ink in the theme this is where the SCENE lands
   * and the canvas's own antialiasing does not apply to a render target. With
   * ink it is redundant — ink supersamples — but a target that changes shape
   * when a theme changes is a target that reallocates mid-level.
   */
  target(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    if (!this.rt || w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, {
        depthBuffer: true,
        samples: 4,
        type: THREE.HalfFloatType,
      });
    }
    this.mat.uniforms.aspect.value = w / h;
    return this.rt;
  }

  /** Draw the target to the canvas, with everything applied on the way. */
  composite(renderer: THREE.WebGLRenderer, dt: number) {
    if (!this.rt) return;
    // Wrapped, so the streak phase never grows big enough to lose precision in
    // a float uniform during a long session.
    this.t = (this.t + dt) % 1000;
    this.mat.uniforms.time.value = this.t;
    this.mat.uniforms.tColor.value = this.rt.texture;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose() {
    this.rt?.dispose();
    this.rt = null;
    this.w = 0;
    this.h = 0;
  }
}
