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
  killY: number;
}
