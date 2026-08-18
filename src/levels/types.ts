export interface Brush {
  p: [number, number, number];  // centre
  s: [number, number, number];  // size
  r?: [number, number, number]; // euler rotation (XYZ order), radians
  q?: [number, number, number, number]; // quaternion, wins over r when present
  c?: number;                   // colour
}

export interface Trigger {
  p: [number, number, number];
  r: number;
  kind: 'checkpoint' | 'goal';
  name: string;
}

export interface Level {
  brushes: Brush[];
  triggers: Trigger[];
  spawn: { x: number; y: number; z: number };
  killY: number;
}
