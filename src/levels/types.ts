export interface Brush {
  p: [number, number, number];  // centre
  s: [number, number, number];  // size
  r?: [number, number, number]; // euler rotation (XYZ order), radians
  q?: [number, number, number, number]; // quaternion, wins over r when present
  c?: number;                   // colour
  kind?: 'box' | 'pyramid';     // collision + visual shape, box when omitted
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
  triggers: Trigger[];
  spawn: { x: number; y: number; z: number };
  /** Camera yaw at spawn — lets a level face the player down its course. */
  spawnYaw?: number;
  killY: number;
}
