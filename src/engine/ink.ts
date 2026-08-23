// Ink: the black line the reference is drawn with.
//
// The look this level is aiming at is a white city with a hard line round
// everything in it, and the line is not decoration — it is what makes a white
// wall in front of a white wall read as two walls. Take it away and a district
// of one colour collapses into a silhouette, which is exactly the problem the
// dusk greybox solved with a low raking sun and this one cannot, because at
// noon the sun is not raking anything.
//
// Two ways to draw one. The engine already had the other: a `LineSegments`
// wireframe parented to every brush, twelve edges each, drawn whether or not
// the edge is a silhouette. It is the wrong tool three times over — it draws
// the box's interior edges, it cannot weight a line by what is behind it, and
// being per-mesh it puts every brush back into its own draw call and takes the
// instancing batcher down with it.
//
// So: screen space, off the depth buffer, one fullscreen pass.
//
// The scene renders into a target that carries a depth texture, and the line is
// found by looking at that depth alone — no second pass over the geometry, no
// normal buffer, nothing that scales with how much city there is. What comes
// out costs the same whether the district has one building or a thousand, which
// is the property that matters, because the plan for this level is a thousand.

import * as THREE from 'three';

/**
 * How the line is found, in one place because the two tests are easy to
 * confuse and behave nothing like each other.
 *
 * `curvature` is the SECOND derivative of depth across the pixel — z(left) +
 * z(right) - 2·z(here). On any flat surface that is zero no matter how steeply
 * the surface recedes, which is the whole reason to use it: a first-difference
 * test lights up the entire floor in front of you, because a floor seen at a
 * grazing angle has an enormous depth gradient and no edge in it at all. A
 * silhouette, where the depth jumps, spikes.
 *
 * `crease` compares surface normals reconstructed from the same depth, which is
 * what catches the corner where two faces of one box meet — no depth jump
 * there, so curvature says nothing, but the normal turns ninety degrees.
 */
const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform mat4 invProjection;
uniform vec3 lineColor;
uniform float width;
uniform float curveGain;
uniform float creaseGain;
uniform float fadeNear;
uniform float fadeFar;
varying vec2 vUv;

/** View-space position of whatever is under a pixel. */
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = invProjection * clip;
  return v.xyz / v.w;
}

/** How far away, in metres, along the view axis. */
float dist(vec2 uv) {
  return -viewPos(uv).z;
}

/**
 * The surface normal, from three depth taps.
 *
 * Forward differences rather than central ones: a central difference straddles
 * a silhouette and returns the average of two unrelated surfaces, which draws a
 * second line one pixel inside the first.
 */
vec3 normalAt(vec2 uv) {
  vec3 c = viewPos(uv);
  vec3 dx = viewPos(uv + vec2(texel.x, 0.0)) - c;
  vec3 dy = viewPos(uv + vec2(0.0, texel.y)) - c;
  return normalize(cross(dx, dy));
}

void main() {
  vec4 col = texture2D(tColor, vUv);
  vec2 o = texel * width;

  float zc = dist(vUv);
  float zl = dist(vUv - vec2(o.x, 0.0));
  float zr = dist(vUv + vec2(o.x, 0.0));
  float zu = dist(vUv + vec2(0.0, o.y));
  float zd = dist(vUv - vec2(0.0, o.y));

  // Scaled by depth, or the line thins out with distance and disappears — a
  // 20 cm step is a strong edge at 5 m and nothing at all at 200 m, and the
  // reference draws both of them.
  float curve = (abs(zl + zr - 2.0 * zc) + abs(zu + zd - 2.0 * zc)) / max(zc, 1.0);

  // Roberts cross on the normals, on the diagonals so one tap set does both
  // axes.
  vec3 na = normalAt(vUv + vec2(-o.x, -o.y));
  vec3 nb = normalAt(vUv + vec2(o.x, o.y));
  vec3 nc = normalAt(vUv + vec2(-o.x, o.y));
  vec3 nd = normalAt(vUv + vec2(o.x, -o.y));
  float crease = length(nb - na) + length(nd - nc);

  float e = max(curve * curveGain, crease * creaseGain);

  // Fade the line out with range. Every window mullion and handrail in a
  // district is an edge, and at four hundred metres all of them together are a
  // grey mush that reads as dirt on the screen rather than as a city.
  e *= 1.0 - smoothstep(fadeNear, fadeFar, zc);

  gl_FragColor = vec4(mix(col.rgb, lineColor, clamp(e, 0.0, 1.0)), col.a);

  // Tone map and encode HERE, because the scene pass could not.
  //
  // Three skips tone mapping entirely when the destination is a render target
  // — it is an output-referred step and an intermediate buffer is not output —
  // so what lands in the target is linear and unmapped, including the sky,
  // whose own shader carries the same two includes and compiles them to
  // nothing for the same reason. Everything therefore arrives here in the same
  // space, gets the line drawn on it in that space, and goes through the pair
  // of steps once, on the way to the canvas.
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

export interface InkSettings {
  colour: number;
  /** Line width in pixels. Zero switches the whole pass off. */
  width: number;
  /** Metres at which the line starts fading, and where it is gone. */
  fade: [number, number];
}

export class Ink {
  private rt: THREE.WebGLRenderTarget | null = null;
  private mat: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private w = 0;
  private h = 0;
  private on = false;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        texel: { value: new THREE.Vector2() },
        invProjection: { value: new THREE.Matrix4() },
        lineColor: { value: new THREE.Color(0x000000) },
        width: { value: 1 },
        curveGain: { value: 26 },
        creaseGain: { value: 0.9 },
        fadeNear: { value: 140 },
        fadeFar: { value: 420 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  get enabled() {
    return this.on;
  }

  /** Take the level's theme. `width` of zero means this level has no line. */
  configure(s: InkSettings) {
    this.on = s.width > 0;
    const u = this.mat.uniforms;
    u.lineColor.value.setHex(s.colour);
    u.width.value = s.width;
    u.fadeNear.value = s.fade[0];
    u.fadeFar.value = s.fade[1];
  }

  /**
   * Match the drawing buffer.
   *
   * In drawing-buffer pixels, not CSS ones: the line is a pixel-space effect
   * and a target at CSS size on a 2× display draws it at half the resolution
   * of everything it is drawn over, which looks like the line is blurry rather
   * than like the target is small.
   */
  resize(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (size.x === this.w && size.y === this.h) return;
    this.w = size.x;
    this.h = size.y;
    this.rt?.dispose();
    const depth = new THREE.DepthTexture(this.w, this.h);
    depth.type = THREE.UnsignedIntType;
    depth.format = THREE.DepthFormat;
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, {
      depthTexture: depth,
      depthBuffer: true,
      // The scene still wants its multisampling: the line pass antialiases
      // nothing, it only draws over what it is given.
      samples: 4,
      // Linear and half float: this target holds scene-referred light on its
      // way to a tone mapper, not a picture. Encoding it to sRGB here would
      // clip the highlights before the mapper ever sees them, which on a white
      // city is the entire subject matter.
      type: THREE.HalfFloatType,
    });
    this.mat.uniforms.texel.value.set(1 / this.w, 1 / this.h);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.resize(renderer);
    if (!this.rt) return;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    const u = this.mat.uniforms;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.invProjection.value.copy(camera.projectionMatrixInverse);
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose() {
    this.rt?.dispose();
    this.rt = null;
    this.w = 0;
    this.h = 0;
  }
}
