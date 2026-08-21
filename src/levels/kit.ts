// Natural sizes of the /assets platform kit, in the units the models were
// authored in. Measured from each glTF's POSITION accessors -- regenerate with
// tools/measure.py if the kit changes.
//
// This table exists because of one bug that made the first dressing pass look
// like a scrapyard: a model is stretched to fill its brush, so a box drawn
// without regard for the model's proportions DISTORTS it. `Sign_1` is 0.062
// units thick; a brush 3.2 deep stretched it 51x into a billboard the size of a
// building. Sizing every prop's brush FROM this table makes the stretch exactly
// 1.0 on all three axes, so a prop can only ever appear at its true shape.
//
// Structural brushes -- decks, hull panels -- are exempt on purpose: they are
// meant to be stretched to whatever the collider is.

/** Natural bounding box of each model, [width, height, depth]. */
export const KIT: Record<string, readonly [number, number, number]> = {
  AC: [1.0381, 0.6856, 0.7709],
  AC_Side: [1.6153, 0.8506, 0.7709],
  AC_Stacked: [0.6701, 1.0062, 0.5115],
  Antenna_1: [0.4019, 1.6556, 0.0632],
  Antenna_2: [0.6174, 0.7306, 0.6567],
  Cable_Long: [0.2876, 2.5059, 0.1319],
  Cable_Small: [0.1722, 0.9499, 0.1216],
  Cable_Thick: [0.5462, 1.6396, 0.3857],
  Computer: [0.4697, 1.0078, 0.6293],
  Computer_Large: [1.294, 2.3821, 0.6898],
  Door: [0.6896, 1.1624, 0.1021],
  Fence: [0.6918, 1.2556, 0.0511],
  Light_Square: [0.2715, 0.4948, 0.2715],
  Light_Street_1: [0.1757, 2.8662, 0.6721],
  Light_Street_2: [1.3513, 2.649, 1.1856],
  Pipe_1: [2.4418, 0.2121, 0.5564],
  Pipe_2: [4.6245, 0.2121, 0.5521],
  Pipe_Corner: [2.0002, 0.2121, 2.3265],
  Pipe_Corner_2: [1.154, 0.2121, 3.9431],
  Platform_1x1_Empty: [0.8105, 0.2243, 0.7721],
  Platform_2x1_Empty: [1.8926, 0.2243, 0.7721],
  Platform_2x2: [3.3088, 3.8349, 2.1579],
  Platform_2x2_Empty: [1.8926, 0.2243, 1.8544],
  Platform_4x1: [3.8632, 2.8058, 1.7295],
  Platform_4x1_Empty: [3.8632, 0.2243, 0.9781],
  Platform_4x2: [5.3211, 6.1581, 2.7128],
  Platform_4x4: [4.4683, 3.7581, 3.9036],
  Platform_4x4_Empty: [3.8632, 0.2243, 3.8943],
  Rail_Corner: [0.5943, 0.2368, 0.6816],
  Rail_Corner_2: [1.7222, 0.2368, 0.6816],
  Rail_Long: [2.2927, 0.2365, 0.0605],
  Rail_Short: [1.2545, 0.2365, 0.0605],
  Sign_1: [1.2939, 0.4622, 0.0618],
  Sign_2: [1.2939, 0.4622, 0.0618],
  Sign_3: [1.2717, 0.4555, 0.0618],
  Sign_4: [0.5056, 1.2717, 0.0618],
  Sign_Corner_1: [1.0923, 0.7269, 1.1912],
  Sign_Corner_2: [1.0923, 0.7269, 1.683],
  Sign_Corner_3: [1.0923, 0.7269, 1.683],
  Sign_Corner_3_Fenced: [1.1094, 0.7269, 1.6928],
  Sign_Corner_Hazard: [1.0923, 0.2011, 1.2082],
  Sign_Corner_Small1: [0.5691, 0.7269, 0.6085],
  Sign_Corner_Small2: [0.5691, 0.7269, 0.6085],
  Sign_Small_1: [0.4802, 0.4622, 0.0618],
  Sign_Small_2: [0.4802, 0.4622, 0.0618],
  Sign_Small_3: [0.4802, 0.4622, 0.0618],
  Support: [0.6865, 0.4012, 0.2922],
  Support_Long: [1.1098, 3.561, 0.0878],
  Support_Short: [1.1098, 2.214, 0.0878],
  TV_1: [1.2035, 1.375, 0.4096],
  TV_2: [0.8065, 1.2118, 0.3448],
  TV_3: [0.7336, 2.378, 0.6315],
};

/**
 * Units per kit unit. The kit is authored at roughly half life size: a street
 * light stands 2.87 units tall, and the player is 1.8 metres. 1.8 puts that
 * lamp at 5.2 m, which is a street light, and everything else follows from the
 * same number so the whole kit stays in proportion with itself.
 */
export const KIT_SCALE = 1.8;

/** World-space size of a prop, for a brush that will hold it without distortion. */
export function propBox(name: string, scale = KIT_SCALE): [number, number, number] {
  const n = KIT[name];
  if (!n) throw new Error(`unknown kit model: ${name}`);
  return [n[0] * scale, n[1] * scale, n[2] * scale];
}
