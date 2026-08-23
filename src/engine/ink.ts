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
// out costs the same whether the district has one building or a thousand.
//
// ## Supersampling, which is not optional
//
// A line found per pixel is a line one pixel wide with nothing in between: it
// is either on or off, so every diagonal comes out as a staircase, and a
// staircase is the first thing anyone sees. MSAA cannot help — it antialiases
// geometry edges inside the scene pass, and the line does not exist yet when
// that resolves.
//
// The fix is to find the line at higher resolution than the screen and average
// down. The scene renders into a target `SS` times larger on each axis, the
// edge test runs at every one of those pixels, and each output pixel is the
// mean of the SS² beneath it. At SS = 2 a diagonal gets four grey levels
// instead of two, which is the difference between ink and a sawtooth — and the
// same average antialiases the geometry, so MSAA can come off the target
// entirely rather than paying for both.

import * as THREE from 'three';

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
uniform float creaseWeight;
uniform float creaseNear;
uniform float creaseFar;
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

/**
 * How much line belongs at this pixel, from two tests that behave nothing like
 * each other and are easy to confuse.
 *
 * CURVE is the second derivative of depth — z(left) + z(right) - 2·z(here).
 * On any flat surface that is zero no matter how steeply the surface recedes,
 * which is the whole reason to use it: a first-difference test lights up the
 * entire floor in front of you, because a floor at a grazing angle has an
 * enormous depth gradient and no edge in it at all. A silhouette, where the
 * depth jumps, spikes.
 *
 * CREASE compares surface normals, which is what catches the corner where two
 * faces of one box meet — no depth jump there, so curvature says nothing, but
 * the normal turns ninety degrees.
 */
float edgeAt(vec2 uv, vec2 o, float z) {
  float zl = -viewPos(uv - vec2(o.x, 0.0)).z;
  float zr = -viewPos(uv + vec2(o.x, 0.0)).z;
  float zu = -viewPos(uv + vec2(0.0, o.y)).z;
  float zd = -viewPos(uv - vec2(0.0, o.y)).z;

  // Scaled by depth, or the line thins out with distance and disappears — a
  // 20 cm step is a strong edge at 5 m and nothing at all at 200 m, and the
  // reference draws both of them.
  float curve = (abs(zl + zr - 2.0 * z) + abs(zu + zd - 2.0 * z)) / max(z, 1.0);
  float silhouette = smoothstep(0.4, 1.0, curve * curveGain);
  silhouette *= 1.0 - smoothstep(fadeNear, fadeFar, z);

  // Roberts cross on the normals, on the diagonals so one tap set does both
  // axes. Half the offset the silhouette uses: a crease is one line where two
  // faces meet, and sampling wide turns it into a band.
  vec2 co = o * 0.5;
  vec3 na = normalAt(uv + vec2(-co.x, -co.y));
  vec3 nb = normalAt(uv + vec2(co.x, co.y));
  vec3 nc = normalAt(uv + vec2(-co.x, co.y));
  vec3 nd = normalAt(uv + vec2(co.x, -co.y));
  float crease = length(nb - na) + length(nd - nc);

  // A crease is NOT ink, and treating it as though it were is what turns a
  // district into a scribble.
  //
  // The reference draws the boundary between an object and what is behind it
  // in full black, and the corner where two faces of that object meet as a
  // thin grey seam — if it draws it at all. Weighting the two the same puts a
  // hard line on all twelve edges of every box in the city, and since a box
  // fifty metres away has the same twelve, the middle distance fills with line
  // until the shapes stop reading.
  //
  // So: a higher threshold, so only a real corner fires and not the gentle
  // turn across a bevel; a fraction of the weight; and a fade that starts far
  // sooner than the silhouette's. Past that distance a building keeps its
  // outline and loses its panel joints, which is what the eye does anyway.
  float seam = smoothstep(0.85, 1.5, crease * creaseGain) * creaseWeight;
  seam *= 1.0 - smoothstep(creaseNear, creaseFar, z);

  return max(silhouette, seam);
}

void main() {
  vec2 o = texel * width;
  vec3 sum = vec3(0.0);

  // SS x SS taps across the output pixel, each finding its own line. The
  // offsets straddle the pixel centre so the mean is unbiased.
  for (int i = 0; i < SS; i++) {
    for (int j = 0; j < SS; j++) {
      vec2 uv = vUv + (vec2(float(i), float(j)) + 0.5 - float(SS) * 0.5) * texel;
      vec3 col = texture2D(tColor, uv).rgb;
      float z = -viewPos(uv).z;
      sum += mix(col, lineColor, clamp(edgeAt(uv, o, z), 0.0, 1.0));
    }
  }
  gl_FragColor = vec4(sum / float(SS * SS), 1.0);

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
  /** Line width in OUTPUT pixels. Zero switches the whole pass off. */
  width: number;
  /** Metres at which the silhouette starts fading, and where it is gone. */
  fade: [number, number];
  /** Crease seams: how black, and the two metre marks they fade between. */
  crease: [number, number, number];
  /** Resolution multiplier on each axis. 1 is off, 2 is four samples a pixel. */
  super: number;
}

export class Ink {
  private rt: THREE.WebGLRenderTarget | null = null;
  private mat: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private w = 0;
  private h = 0;
  private ss = 2;
  private width = 1;
  private on = false;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { SS: 2 },
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
        creaseWeight: { value: 0.45 },
        creaseNear: { value: 40 },
        creaseFar: { value: 110 },
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
    const ss = Math.max(1, Math.round(s.super));
    if (ss !== this.ss) {
      this.ss = ss;
      this.mat.defines.SS = ss;
      this.mat.needsUpdate = true;
      this.dispose();
    }
    this.width = s.width;
    const u = this.mat.uniforms;
    u.lineColor.value.setHex(s.colour);
    u.fadeNear.value = s.fade[0];
    u.fadeFar.value = s.fade[1];
    u.creaseWeight.value = s.crease[0];
    u.creaseNear.value = s.crease[1];
    u.creaseFar.value = s.crease[2];
  }

  /**
   * Match the drawing buffer, times the supersample.
   *
   * In drawing-buffer pixels, not CSS ones: the line is a pixel-space effect
   * and a target at CSS size on a 2x display draws it at half the resolution
   * of everything it is drawn over, which looks like the line is blurry rather
   * than like the target is small.
   */
  private fit(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.floor(size.x * this.ss);
    const h = Math.floor(size.y * this.ss);
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.rt?.dispose();
      const depth = new THREE.DepthTexture(w, h);
      depth.type = THREE.UnsignedIntType;
      depth.format = THREE.DepthFormat;
      this.rt = new THREE.WebGLRenderTarget(w, h, {
        depthTexture: depth,
        depthBuffer: true,
        // No MSAA on top of the supersample. Four samples a pixel already
        // antialias the geometry, and multisampling a target this size is
        // memory spent twice for the second half of an effect already paid for.
        samples: this.ss > 1 ? 0 : 4,
        // Linear and half float: this target holds scene-referred light on its
        // way to a tone mapper, not a picture. Encoding it to sRGB here would
        // clip the highlights before the mapper ever sees them, which on a
        // white city is the entire subject matter.
        type: THREE.HalfFloatType,
      });
      this.mat.uniforms.texel.value.set(1 / w, 1 / h);
    }
    // Width is authored in output pixels; the buffer is `ss` times finer.
    this.mat.uniforms.width.value = this.width * this.ss;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.fit(renderer);
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
