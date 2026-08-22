// What a brush is MADE of.
//
// Every brush used to be one flat `MeshLambertMaterial` in the colour the level
// asked for, and that is the single reason a district built out of nine hundred
// carefully placed volumes still read as nine hundred boxes: a real surface
// tells you how far away it is and how big it is, and a flat fill tells you
// nothing at all. Two walls thirty metres apart in the same colour are the same
// wall to the eye. Put a grain on them and the near one has texels you can
// count and the far one does not, and suddenly the street has depth.
//
// So: a SURFACE is a named material recipe — maps, tiling rate, roughness — and
// a brush names one. The colour on the brush stays exactly what it was and is
// multiplied over the base map, which matters more than it sounds: the levels
// encode rules in colour (amber is something to wallrun, violet is something to
// slide down), and an art pass that repaints the world is an art pass that
// costs the player the rules. Texture goes UNDER the colour, never over it.
//
// The maps all come out of `assets/scifi/Textures` — the same pack the models
// use, which is what keeps a textured brush and a kit prop standing next to it
// looking like they were made by the same hand. The pack ships trim sheets
// rather than tiling materials, so each surface takes a CROP of a sheet: a
// region flat enough to repeat. Mirrored wrapping makes any such crop seamless,
// at the price of a mirror symmetry that nothing at these distances can see.
//
// Two rules that are easy to get wrong and expensive to debug:
//
//   * Base colour is sRGB, normals and ORM are not. Tagging a normal map sRGB
//     bends every normal in it towards the +Z pole, which does not look like a
//     bug — it looks like the lighting is merely flat, which is what we came
//     here to fix.
//   * A crop for the BASE map and a crop for the NORMAL map do not have to be
//     the same region. `T_Trim_03_BaseColor` is featureless grunge, so nothing
//     in it can misalign with anything; its normal map is a trim sheet with
//     panel seams. Pairing the two gives a tintable concrete with real seams in
//     it out of a pack that ships neither.

import * as THREE from 'three';

/** Every texture in the pack, basename -> URL, hashed by Vite the same way models are. */
const URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('/assets/**/Textures/*.png', { query: '?url', import: 'default', eager: true }),
)) {
  URLS[path.split('/').pop()!.replace(/\.png$/, '')] = url as string;
}

/** A region of a sheet, in source pixels with the origin top left. */
type Crop = readonly [x: number, y: number, w: number, h: number];

interface Slot {
  /** File basename, e.g. `T_Trim_03_Normal`. Omitted when `paint` draws it all. */
  file?: string;
  /** Region to lift out of it. The whole sheet when omitted. */
  crop?: Crop;
  /**
   * Tile the source this many times across the canvas before anything is
   * painted on it, and repeat the finished texture correspondingly less.
   *
   * This is what lets one surface carry two materials at two different scales:
   * `facade` wants brick at four metres and its window grid at twelve, and a
   * texture has only one set of UVs. Drawing the brick three by three into the
   * canvas and painting the windows over the whole thing puts both on the same
   * UVs at the right sizes — and any map that is NOT painted (the normal, the
   * ORM) gets the same effect for free from `repeat`, which keeps it aligned
   * with the base to the pixel.
   */
  grid?: number;
  /** Extra repeats of a plain, unpainted map. Pairs with `grid`. */
  repeat?: number;
  /**
   * Draw on top of the crop — or draw the whole map, when there is no `file`.
   *
   * The pack has no window in it anywhere, and a district of blank walls is not
   * a city whatever else is on them. So the windows are painted here, over the
   * pack's own grunge, at a pitch measured in metres like everything else. The
   * canvas is the tile: whatever is drawn has to be seamless at its own edges,
   * which is why the panes are laid on cell CENTRES and nothing is allowed to
   * touch a border.
   */
  paint?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Cache key for a painted map, since two of them can share a source file. */
  as?: string;
}

interface SurfaceDef {
  base?: Slot;
  normal?: Slot;
  /**
   * Occlusion / roughness / metalness packed into R / G / B, as glTF does it —
   * and used HERE for the occlusion only.
   *
   * The other two channels are deliberately dropped, which is not the obvious
   * choice and was not the first one. A trim sheet's ORM is authored for a
   * model that uses the whole sheet at once, so across any one crop of it the
   * roughness and metalness are near enough constant: 0.35 and 1.0 in this pack.
   * Multiplied into the material they do not add variation, they just quietly
   * overrule every value set below — the entire district came out as polished
   * metal, and a low sun turned every street into a mirror. A constant is not a
   * texture. The scalars underneath say what a surface is; the map is only
   * allowed to say where the dirt sits.
   */
  orm?: Slot;
  emissiveMap?: Slot;
  /** Metres of world per repeat of the map. The one number that sets scale. */
  tile: number;
  roughness?: number;
  metalness?: number;
  /** Strength of the normal map, 1 being as authored. */
  bump?: number;
  /**
   * Emissive colour. `'brush'` takes the brush's own colour, which is how a
   * surface glows in whatever the level painted it — amber wall, violet chute,
   * cyan pad — without the surface having to know about any of them.
   */
  emissive?: number | 'brush';
  emissiveIntensity?: number;
}

// --- the surfaces ------------------------------------------------------------
//
// Tiling rates are in metres and they are the whole art direction. A 4 m repeat
// on a building reads as storeys; a 4 m repeat on a handrail reads as noise. The
// rule used here is that a repeat should be about the size of the real-world
// feature the surface is standing in for — a wall panel, a road slab, a crate
// face — so the eye gets a ruler wherever it looks.

const TRIM01 = 'T_Trim_01';
const TRIM02 = 'T_Trim_02';
const TRIM03 = 'T_Trim_03';

// The city pack (`assets/city`) is a different kind of thing from the sci-fi
// kit and worth its own paragraph. Where that one ships trim sheets — one sheet
// carrying every detail of a model, tileable nowhere — this one ships genuine
// TILING MATERIALS: brick, concrete, asphalt, ornamented stone, each seamless
// in both directions and authored at a real-world scale. That is exactly what a
// district made of brushes needs and what the sci-fi pack could never give it,
// so the buildings and the ground are made of these and everything you get
// close to is still made of the other one.
const BRICK = 'T_RedBrick';
const CONCRETE = 'T_Concrete';
const ORNAMENT = 'T_Ornaments';
const METALCON = 'T_MetalConcrete';
/** How many brick courses go in twelve metres — the window grid's tile. */
const BRICK_GRID = 3;

/** The flat panel band out of Trim_03's normal: a seam, a field, a seam. */
const SEAM_BAND: Crop = [0, 96, 2048, 470];
/** Trim_02's upper panel run — bolted plate with a joint every couple of metres. */
const PLATE_BAND: Crop = [0, 96, 2048, 380];
/** The big dark panel in the bottom half of Trim_01. Worn, unlit, no features. */
const DARK_PANEL: Crop = [220, 1080, 1600, 640];
/** Trim_01's framed upper panels — structural, and it looks it. */
const FRAME_BAND: Crop = [40, 40, 1960, 620];
/** Trim_02's parts shelf: hatches, grilles, clamps. Only tiles at prop scale. */
const PARTS: Crop = [16, 1240, 900, 520];

// --- windows ------------------------------------------------------------------
//
// The pack has walls, doors, vents, rails and floor paint, and no windows at
// all — so a district built out of it is a district where nobody works. These
// are painted, and they are the one thing in this file that is not lifted from
// the art pack, because there was nothing to lift.
//
// The grid is measured in metres like every other tiling rate here: WIN_TILE
// across, WIN_N panes each way, which puts a window every three metres and a
// storey every three metres. That is the number that makes a mass read as a
// building rather than as a box with lights on it, and it is also how your eye
// gets the building's height for free — you can count the floors.

/** Metres of wall per repeat of the window grid. */
const WIN_TILE = 12;
/** Panes per repeat, each way. 5 over 12 m is a window every 2.4 m. */
const WIN_N = 5;

/** Deterministic noise, so a building's lights are the same every time it loads. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Walk the grid, handing each pane its rectangle and whether it is lit.
 *
 * The base map and the emissive map have to agree exactly about where the glass
 * is, so they are drawn from one function with one seed rather than twice from
 * two — otherwise the lit panes and the dark panes drift apart and the wall
 * looks like two walls.
 */
function panes(
  w: number, h: number,
  each: (x: number, y: number, pw: number, ph: number, lit: number, r: () => number) => void,
) {
  const cw = w / WIN_N;
  const ch = h / WIN_N;
  // 1.8 m of glass in a 3 m bay, and a metre and a half of it tall: a window,
  // not a porthole and not a curtain wall.
  const pw = cw * 0.58;
  const ph = ch * 0.44;
  for (let iy = 0; iy < WIN_N; iy++) {
    for (let ix = 0; ix < WIN_N; ix++) {
      const r = rng(iy * 977 + ix * 31 + 7);
      // A little under half of them are on. All of them lit is an office block
      // at nine in the morning; none is a derelict.
      const lit = r() < 0.42 ? 0.55 + r() * 0.45 : 0;
      each(cw * (ix + 0.5) - pw / 2, ch * (iy + 0.5) - ph / 2, pw, ph, lit, r);
    }
  }
}

/** The glass itself, over whatever the pack put underneath. */
function paintGlass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  panes(w, h, (x, y, pw, ph, lit, r) => {
    // Dark, and slightly blue: glass reflects the sky even when there is
    // nothing behind it. Lit and unlit panes get the SAME dark glass, which is
    // the opposite of the obvious thing and the thing that makes it work —
    // paint a lit pane pale in the base map as well and the sun lands on it,
    // and a sunlit wall of pale rectangles reads as panelling, not as windows.
    // The light belongs to the emissive map, where the sun cannot reach it.
    const v = r() * 10;
    ctx.fillStyle = `rgba(${14 + v | 0}, ${18 + v | 0}, ${28 + v | 0}, 0.94)`;
    ctx.fillRect(x, y, pw, ph);
    // A frame, and a mullion down the middle. Two rectangles is a pane; a pane
    // with a bar across it is a window.
    ctx.strokeStyle = 'rgba(210, 214, 224, 0.20)';
    ctx.lineWidth = Math.max(1, w / 512);
    ctx.strokeRect(x, y, pw, ph);
    ctx.fillStyle = 'rgba(190, 196, 208, 0.16)';
    ctx.fillRect(x + pw / 2 - ctx.lineWidth / 2, y, ctx.lineWidth, ph);
    // The spandrel under the sill, which is what actually reads as a floor
    // line from the far side of an avenue.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(x - pw * 0.12, y + ph + ph * 0.22, pw * 1.24, ph * 0.1);
  });
}

/** The same panes again, as light. Black everywhere else — this map only glows. */
function paintLights(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  panes(w, h, (x, y, pw, ph, lit, r) => {
    if (!lit) return;
    // Warm for most of them, cold for the ones on a different shift, and never
    // at full: a window is a room seen through glass, not a lamp.
    const cold = r() < 0.22;
    const k = lit * 0.72;
    const c = cold
      ? [140 * k, 190 * k, 255 * k]
      : [255 * k, 186 * k, 118 * k];
    ctx.fillStyle = `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
    // Inset, so the frame the base map drew stays dark and the light looks
    // like it is BEHIND the glass rather than painted on it.
    const i = ctx.lineWidth * 1.5;
    ctx.fillRect(x + i, y + i, pw - i * 2, ph - i * 2);
    // Half the lit rooms have something in front of the window.
    if (r() < 0.5) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      const bw = pw * (0.2 + r() * 0.3);
      ctx.fillRect(x + i + (pw - i * 2 - bw) * r(), y + ph * 0.45, bw, ph * 0.55 - i);
    }
  });
}

export const SURFACES: Record<string, SurfaceDef> = {
  /**
   * The default, and most of the district by area: the building volumes. A big
   * repeat, because these are read at fifty metres and a tight one turns into
   * moire long before you get close enough to see the detail.
   */
  panel: {
    base: { file: `${TRIM03}_BaseColor` },
    normal: { file: `${TRIM03}_Normal`, crop: SEAM_BAND },
    orm: { file: `${TRIM03}_ORM` },
    tile: 9, roughness: 0.94, metalness: 0.0, bump: 0.7,
  },
  /**
   * A building's wall: the panel grain with windows in it.
   *
   * Separate from `panel` rather than replacing it, because plenty of things on
   * this map are panelled and are not buildings — a rim wall, a backdrop mass, a
   * plant housing — and windows on those are windows on a wall with no rooms
   * behind it.
   */
  facade: {
    base: { file: `${BRICK}_BaseColor`, grid: BRICK_GRID, paint: paintGlass, as: 'glass' },
    normal: { file: `${BRICK}_Normal`, repeat: BRICK_GRID },
    orm: { file: `${BRICK}_ORM`, repeat: BRICK_GRID },
    emissiveMap: { paint: paintLights, as: 'lights' },
    tile: WIN_TILE, roughness: 0.95, metalness: 0.0, bump: 1.1,
    emissive: 0xffffff, emissiveIntensity: 0.4,
  },
  /**
   * The concrete-framed kind: post-war, cheaper, and most of the district.
   */
  facade2: {
    base: { file: `${CONCRETE}_BaseColor`, grid: 2, paint: paintGlass, as: 'glass' },
    normal: { file: `${CONCRETE}_Normal`, repeat: 2 },
    orm: { file: `${CONCRETE}_ORM`, repeat: 2 },
    emissiveMap: { paint: paintLights, as: 'lights' },
    tile: WIN_TILE * 1.15, roughness: 0.92, metalness: 0.03, bump: 1,
    emissive: 0xffffff, emissiveIntensity: 0.4,
  },
  /**
   * And the newest ones: clad panel over a concrete frame, bigger glazing.
   */
  facade3: {
    base: { file: `${METALCON}_BaseColor`, grid: 2, paint: paintGlass, as: 'glass' },
    normal: { file: `${METALCON}_Normal`, repeat: 2 },
    orm: { file: `${METALCON}_ORM`, repeat: 2 },
    emissiveMap: { paint: paintLights, as: 'lights' },
    tile: WIN_TILE * 1.35, roughness: 0.6, metalness: 0.2, bump: 0.9,
    emissive: 0xffffff, emissiveIntensity: 0.4,
  },
  /** The base course every mass stands on. Coarser and rougher: this is concrete. */
  plinth: {
    base: { file: `${CONCRETE}_BaseColor` },
    normal: { file: `${CONCRETE}_Normal` },
    orm: { file: `${CONCRETE}_ORM` },
    tile: 5, roughness: 1, metalness: 0, bump: 1,
  },
  /** Roof decks and balconies — plate you stand on, so it tiles at plate size. */
  deck: {
    base: { file: `${TRIM02}_BaseColor`, crop: PLATE_BAND },
    normal: { file: `${TRIM02}_Normal`, crop: PLATE_BAND },
    orm: { file: `${TRIM02}_ORM`, crop: PLATE_BAND },
    tile: 4.5, roughness: 0.74, metalness: 0.16, bump: 1,
  },
  /** Bands, cornices, lintels. Small repeat: these are 1 m strips seen up close. */
  trim: {
    base: { file: `${ORNAMENT}_BaseColor` },
    normal: { file: `${ORNAMENT}_Normal` },
    orm: { file: `${ORNAMENT}_ORM` },
    tile: 3, roughness: 0.72, metalness: 0.12, bump: 1,
  },
  /** Roadway: the Overpass, catwalks, ramps. Dark, matte, unreflective. */
  road: {
    base: { file: `${TRIM01}_BaseColor`, crop: DARK_PANEL },
    normal: { file: `${TRIM01}_Normal`, crop: DARK_PANEL },
    orm: { file: `${TRIM01}_ORM`, crop: DARK_PANEL },
    tile: 6, roughness: 0.88, metalness: 0.05, bump: 1,
  },
  /**
   * The street itself.
   *
   * The biggest surface on the map by a distance — 400 m of it — and the one
   * you spend the most time looking at, because at street level it is half the
   * screen. It wants the LOOSEST tiling that still has grain in it: too tight
   * and 400 m of road strobes as you run, too loose and it is a flat fill
   * again, which is where this started.
   *
   * Cut from a DIFFERENT sheet than the walls, and that is the entire point of
   * it having its own entry. It shared the walls' grunge for a while and the
   * district read as one continuous material folded into buildings and floor —
   * you could not see where the ground stopped. Two surfaces standing at right
   * angles to each other have to disagree about something, and the cheapest
   * thing for them to disagree about is what they are made of.
   */
  street: {
    base: { file: 'T_Concrete_Asphalt_BaseColor' },
    normal: { file: `${CONCRETE}_Normal` },
    orm: { file: `${CONCRETE}_ORM` },
    tile: 8, roughness: 1, metalness: 0.0, bump: 0.8,
  },
  /**
   * The footway: the apron of paving every building stands on.
   *
   * A road and a pavement are the oldest trick a street has for telling you
   * where you are, and it costs one box per block. It is the pale strip that
   * separates a dark road from a lit wall, which means it is doing the job the
   * eye was asking for whenever the district looked like one material.
   */
  paving: {
    base: { file: `${CONCRETE}_BaseColor` },
    normal: { file: `${CONCRETE}_Normal` },
    orm: { file: `${CONCRETE}_ORM` },
    tile: 4, roughness: 1, metalness: 0, bump: 1.2,
  },
  /** Structure: masts, gantries, pylons, columns. */
  steel: {
    base: { file: `${TRIM01}_BaseColor`, crop: FRAME_BAND },
    normal: { file: `${TRIM01}_Normal`, crop: FRAME_BAND },
    orm: { file: `${TRIM01}_ORM`, crop: FRAME_BAND },
    tile: 3.4, roughness: 0.52, metalness: 0.5, bump: 1,
  },
  /** Containers and plant housings — machinery, at machinery scale. */
  crate: {
    base: { file: `${TRIM02}_BaseColor`, crop: PARTS },
    normal: { file: `${TRIM02}_Normal`, crop: PARTS },
    orm: { file: `${TRIM02}_ORM`, crop: PARTS },
    tile: 2.2, roughness: 0.68, metalness: 0.22, bump: 1,
  },
  /**
   * The padded wall, which is the one genuinely tiling material in the pack and
   * the only one that ships its own emissive. It is orange with red strips in
   * it, so it goes where the level is already amber — the Ladder, the Chute's
   * walls — and the two agree instead of arguing.
   */
  padded: {
    base: { file: 'T_PaddedWall_BaseColor' },
    normal: { file: 'T_PaddedWall_Normal' },
    orm: { file: 'T_PaddedWall_ORM' },
    emissiveMap: { file: 'T_PaddingWall_Emissive' },
    tile: 6, roughness: 0.82, metalness: 0.06, bump: 1,
    emissive: 0xffffff, emissiveIntensity: 0.9,
  },
  /**
   * Paint that survives being in shadow.
   *
   * Everything coloured in this district — canopies, awnings, hazard lips,
   * shutters — hangs at the bottom of a street, under an overhang, on the side
   * of a building the dusk sun never reaches. Lit only by the sky it goes black,
   * and a black canopy is not a colour, it is a gap. A quarter of a stop of its
   * own colour is enough to keep it reading as PAINT at street level without it
   * ever looking like a light.
   */
  paint: {
    base: { file: `${TRIM02}_BaseColor`, crop: PLATE_BAND },
    normal: { file: `${TRIM02}_Normal`, crop: PLATE_BAND },
    orm: { file: `${TRIM02}_ORM`, crop: PLATE_BAND },
    tile: 2.4, roughness: 0.62, metalness: 0.1, bump: 1,
    emissive: 'brush', emissiveIntensity: 0.28,
  },
  /**
   * A lit strip: no map at all, just the brush's own colour burning. Window
   * bands, floor lights, the beacons on the masts. This is what turns a
   * silhouette into a skyline after dark, and it costs one material.
   */
  lamp: {
    tile: 1, roughness: 0.4, metalness: 0,
    // Under one on purpose. Emissive is not lighting here — nothing is lit BY a
    // window strip — it is paint that ignores the sun, and paint at 1.0 through
    // a filmic curve clips to white and stops being a colour. Held down, a warm
    // strip stays warm and a cold one stays cold, which is the entire point of
    // having two of them.
    emissive: 'brush', emissiveIntensity: 0.62,
  },
  /**
   * A surface that means something: amber wallrun, violet slide, cyan pad. The
   * grain is the same as everything else so it belongs to the same world, but
   * it carries a low glow of its own colour so the rule stays readable at
   * distance and in shadow — which flat paint on an unlit face does not.
   */
  marked: {
    base: { file: `${TRIM02}_BaseColor`, crop: PLATE_BAND },
    normal: { file: `${TRIM02}_Normal`, crop: PLATE_BAND },
    orm: { file: `${TRIM02}_ORM`, crop: PLATE_BAND },
    tile: 4, roughness: 0.7, metalness: 0.12, bump: 1,
    emissive: 'brush', emissiveIntensity: 0.5,
  },
};

/** What a brush with nothing to say about itself is made of. */
export const DEFAULT_SURFACE = 'panel';

// --- loading -----------------------------------------------------------------

/**
 * Longest edge of a cropped map. The sheets are 2048 and a crop of one is a
 * fraction of that anyway; anything past this is paying for texels smaller than
 * a pixel on a wall you run past at 40 u/s.
 */
const MAX_EDGE = 768;

const loader = new THREE.TextureLoader();
/** One GPU texture per (file, crop). Surfaces share sheets constantly. */
const cache = new Map<string, THREE.Texture>();
/** Raw sheets, so four crops of Trim_02 decode the PNG once between them. */
const sheets = new Map<string, Promise<THREE.Texture>>();

let anisotropy = 1;

/**
 * Every material handed out so far, so the anisotropy and the maps can be
 * filled in after the fact. Materials are built the moment the level asks for
 * one — the first frame does not wait on a texture decode — and the maps land
 * on them when the sheets arrive.
 */
const materials = new Map<string, THREE.MeshStandardMaterial>();

function sheet(file: string): Promise<THREE.Texture> {
  let p = sheets.get(file);
  if (!p) {
    const url = URLS[file];
    p = url ? loader.loadAsync(url) : Promise.reject(new Error(`no texture ${file}`));
    sheets.set(file, p);
  }
  return p;
}

/**
 * One map, cropped and shrunk, ready to tile.
 *
 * `srgb` is not cosmetic. A base colour is authored in sRGB and everything else
 * — normals, roughness, metalness, occlusion — is raw data that must not be
 * decoded, and getting that backwards is a bug that reads as "the art is a bit
 * flat" rather than as an error.
 */
async function mapOf(slot: Slot, srgb: boolean): Promise<THREE.Texture> {
  const key = `${slot.file ?? 'painted'}|${slot.crop?.join(',') ?? 'full'}|${slot.as ?? ''}`
    + `|${slot.grid ?? 1}|${slot.repeat ?? 1}`;
  const got = cache.get(key);
  if (got) return got;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  if (slot.file) {
    const src = await sheet(slot.file);
    const img = src.image as CanvasImageSource & { width: number; height: number };
    const [cx, cy, cw, ch] = slot.crop ?? [0, 0, img.width, img.height];
    const k = Math.min(1, MAX_EDGE / Math.max(cw, ch));
    canvas.width = Math.max(1, Math.round(cw * k));
    canvas.height = Math.max(1, Math.round(ch * k));
    const n = slot.grid ?? 1;
    const w = canvas.width / n;
    const h = canvas.height / n;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) ctx.drawImage(img, cx, cy, cw, ch, gx * w, gy * h, w, h);
    }
  } else {
    canvas.width = MAX_EDGE;
    canvas.height = MAX_EDGE;
  }
  slot.paint?.(ctx, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  // Mirrored, not plain repeat: it is what makes an arbitrary crop of a trim
  // sheet tile without a seam down every join.
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (slot.repeat) tex.repeat.set(slot.repeat, slot.repeat);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Attach a surface's maps to a material once they have decoded. */
async function dress(mat: THREE.MeshStandardMaterial, def: SurfaceDef) {
  const [base, normal, orm, emissive] = await Promise.all([
    def.base ? mapOf(def.base, true) : null,
    def.normal ? mapOf(def.normal, false) : null,
    def.orm ? mapOf(def.orm, false) : null,
    def.emissiveMap ? mapOf(def.emissiveMap, true) : null,
  ]);
  if (base) mat.map = base;
  if (normal) {
    mat.normalMap = normal;
    mat.normalScale.set(def.bump ?? 1, def.bump ?? 1);
  }
  // Occlusion only — see the note on `orm`. three.js reads .r for it, which is
  // the channel that carries something worth having.
  if (orm) mat.aoMap = orm;
  if (emissive) mat.emissiveMap = emissive;
  mat.needsUpdate = true;
}

/**
 * Decode every sheet up front, so the first frame is drawn with the world
 * already dressed rather than grey for a moment and then not.
 */
export async function preloadSurfaces(): Promise<void> {
  const files = new Set<string>();
  for (const def of Object.values(SURFACES)) {
    for (const slot of [def.base, def.normal, def.orm, def.emissiveMap]) {
      if (slot?.file) files.add(slot.file);
    }
  }
  await Promise.all([...files].map((f) => sheet(f).catch(() => null)));
}

/**
 * Anisotropy has to come from the renderer's capabilities, and the renderer is
 * built after this module loads. Called once, it back-fills every texture
 * already made — the streets are seen at a grazing angle nearly all the time,
 * and 1x anisotropy on a road surface is a smear starting ten metres out.
 */
export function useAnisotropy(n: number) {
  anisotropy = n;
  for (const t of cache.values()) { t.anisotropy = n; t.needsUpdate = true; }
}

// --- materials ---------------------------------------------------------------

/**
 * The material for a (surface, colour) pair, shared by every brush that asks
 * for it. Sharing matters: the district is nine hundred brushes and perhaps
 * thirty distinct combinations, so this is thirty programs and thirty uniform
 * uploads instead of nine hundred.
 */
export function materialFor(surface: string, colour: number): THREE.MeshStandardMaterial {
  const name = SURFACES[surface] ? surface : DEFAULT_SURFACE;
  const key = `${name}|${colour}`;
  const got = materials.get(key);
  if (got) return got;

  const def = SURFACES[name];
  const mat = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: def.roughness ?? 0.9,
    metalness: def.metalness ?? 0.1,
  });
  if (def.emissive !== undefined) {
    mat.emissive = new THREE.Color(def.emissive === 'brush' ? colour : def.emissive);
    mat.emissiveIntensity = def.emissiveIntensity ?? 1;
  }
  materials.set(key, mat);
  void dress(mat, def);
  return mat;
}

// --- geometry ----------------------------------------------------------------

/**
 * A unit box whose UVs are in METRES of the brush it will be stretched onto.
 *
 * This is the other half of the job, and the half that is easy to skip. A brush
 * mesh is unit geometry scaled to the brush's size, so the stock box's 0..1 UVs
 * stretch with it: a 54 m wall and a 2 m handrail both get exactly one repeat,
 * which is a texture smeared to nothing on one and compressed to noise on the
 * other — the same distortion the model table exists to keep off the props,
 * arriving through the back door on every surface that has no model at all.
 *
 * Sizing the UVs from the brush instead pins texel density to the WORLD, so a
 * metre of wall is a metre of wall everywhere in the district and the texture
 * becomes something the eye can measure distance with.
 *
 * Each face takes its two world axes: the sides span (depth, height), the top
 * and bottom (width, depth), the front and back (width, height).
 */
const geometries = new Map<string, THREE.BufferGeometry>();

export function boxFor(
  sx: number, sy: number, sz: number, surface: string,
): THREE.BufferGeometry {
  const name = SURFACES[surface] ? surface : DEFAULT_SURFACE;
  const tile = SURFACES[name].tile;
  // Quantised, so the hundreds of brushes that share a size share a geometry.
  const q = (v: number) => Math.round(Math.abs(v) * 4) / 4;
  const key = `${name}|${q(sx)}|${q(sy)}|${q(sz)}`;
  const got = geometries.get(key);
  if (got) return got;

  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry lays its faces out +X, -X, +Y, -Y, +Z, -Z, four vertices each.
  const spans: [number, number][] = [
    [q(sz), q(sy)], [q(sz), q(sy)],
    [q(sx), q(sz)], [q(sx), q(sz)],
    [q(sx), q(sy)], [q(sx), q(sy)],
  ];
  for (let f = 0; f < 6; f++) {
    const [u, v] = spans[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * (u / tile), uv.getY(i) * (v / tile));
    }
  }
  uv.needsUpdate = true;
  // Ambient occlusion samples the second UV set, which for a brush is the same
  // set. Without this the AO channel of every ORM map is silently unused.
  g.setAttribute('uv1', uv.clone());
  geometries.set(key, g);
  return g;
}
