export interface Brush {
  p: [number, number, number];  // centre
  s: [number, number, number];  // size
  r?: [number, number, number]; // euler rotation (XYZ order), radians
  q?: [number, number, number, number]; // quaternion, wins over r when present
  c?: number;                   // colour
  kind?: 'box' | 'pyramid';     // collision + visual shape, box when omitted
  /**
   * glTF model drawn in place of the box. Decoration only: the collider is
   * still the box, so a model can never change how the level plays. The model
   * is fitted to the unit cube and parented to the brush mesh, which means the
   * brush's own scale stretches it and the editor gizmo keeps working.
   */
  m?: string;
  /**
   * Which surface this brush is made of — see `engine/surfaces.ts`. Names a
   * material recipe (maps, tiling rate, roughness), never a colour: `c` is
   * still the colour and is multiplied over the texture, so a level's colour
   * language survives an art pass intact. Omitted means the default surface.
   */
  t?: string;
  /**
   * Decor: drawn, never collided with. Signs, railings, antennas, lights — the
   * things that make a place look like somewhere without being one more object
   * to hit at 40 u/s. A level can be dressed as heavily as you like and the
   * movement is provably unchanged, because the physics world never sees these.
   */
  d?: boolean;
}

export interface Trigger {
  p: [number, number, number];
  r: number;
  kind: 'checkpoint' | 'goal';
  name: string;
}

/**
 * How a level is LIT, and what colour its sky is.
 *
 * A district's massing is one thing and its art direction is another, and the
 * two have to come apart or a second art style costs a second copy of the
 * generator. A theme is the whole of the second thing: the dome's three
 * colours, the key and where it stands, the two ambients, the haze, and the
 * exposure. Everything left out falls back to the renderer's own default, so a
 * level with no theme looks exactly as it did before themes existed — which is
 * the property that lets a new style be added without touching the old ones.
 *
 * The light INTENSITIES are scales rather than values, because those are on the
 * tuning sliders and the sliders have to keep working. A theme says this sky is
 * two thirds the strength of the default one; it does not say what the default
 * one is.
 */
export interface Theme {
  /** Sky dome: straight up, at the horizon, and the warm lobe round the sun. */
  zenith?: number;
  horizon?: number;
  ember?: number;
  /** The key: its colour, where it stands, and a multiplier on `light.sun`. */
  sun?: number;
  sunPos?: [number, number, number];
  sunScale?: number;
  /**
   * Which way the dome's warm lobe sits. Separate from `sunPos` on purpose:
   * at dusk the glow belongs ON the horizon while the key light still has to
   * come from high enough to cast a usable shadow, and tying the two together
   * lifts the sunset off the skyline.
   */
  glow?: [number, number, number];
  /** Hemisphere ambient: sky above, bounce below, multiplier on `light.sky`. */
  sky?: number;
  ground?: number;
  skyScale?: number;
  /** The back fill, and its multiplier on `light.fill`. */
  fill?: number;
  fillScale?: number;
  /** Distance haze: colour, and where it starts and ends. */
  fog?: number;
  fogNear?: number;
  fogFar?: number;
  /** Tone-mapping exposure. */
  exposure?: number;
  /**
   * The ink line, drawn round everything in screen space — see `engine/ink`.
   *
   * `inkWidth` of zero, which is the default, switches the whole pass off and
   * the level renders straight to the canvas as it always did. Only a level
   * that asks for a line pays for one.
   */
  ink?: number;
  /** Line width, in drawing-buffer pixels. */
  inkWidth?: number;
  /** Metres at which the line begins to fade, and where it is gone. */
  inkFade?: [number, number];
}

export interface Level {
  brushes: Brush[];
  /** Dummy target spawn points, feet position. */
  enemies?: [number, number, number][];
  /**
   * Closed paths that things travel along — the overhead rail of a conveyor,
   * and whatever else ends up needing one. Each is a polyline whose last point
   * joins its first, so a rider on it never reaches an end.
   */
  rails?: [number, number, number][][];
  triggers: Trigger[];
  spawn: { x: number; y: number; z: number };
  /** Camera yaw at spawn — lets a level face the player down its course. */
  spawnYaw?: number;
  /** Sky, key, ambients and haze. Omitted means the renderer's own default. */
  theme?: Theme;
  killY: number;
}
