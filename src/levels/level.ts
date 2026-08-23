// The active level as MUTABLE data. Everything (renderer, physics, editor, main
// loop) reads this one object, so the editor can reshape the world live and a
// rebuild is just "re-read level.*". Levels serialize to plain JSON — same
// philosophy as tuning profiles.

import type { Brush, Trigger, Level } from './types';
import * as arena from './arena';
import * as ashgate from './ashgate';
import * as course01 from './course01';
import * as figure8 from './figure8';

export interface LevelData extends Level {
  name: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// Built-in JSON tracks, bundled at build time (same pattern as tuning profiles).
const TRACK_MODULES = import.meta.glob('./tracks/*.json', { eager: true }) as Record<string, any>;

/** `tracks/figure8.level.json` is the level called `figure8`, not `figure8.level`. */
const trackName = (file: string) => file.replace(/\.json$/, '').replace(/\.level$/, '');

/** Filename each track was actually loaded from, keyed by level name. */
const TRACK_FILES: Record<string, string> = {};

/**
 * Where the editor writes a level. It writes back to the file the level was
 * LOADED from whenever there is one — otherwise saving `loop-course`, which
 * lives in `loop-course.json`, creates a second `loop-course.level.json` that
 * resolves to the same name and shadows the original. You then edit the first
 * file, see nothing change, and have no way to tell why.
 */
export const trackPath = (name: string) =>
  TRACK_FILES[name]
  ?? `src/levels/tracks/${name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')}.level.json`;

/** Pristine copies of every built-in level, keyed by name. */
const BUILTINS: Record<string, () => LevelData> = {};
BUILTINS['arena'] = () => ({
  name: 'arena',
  brushes: clone(arena.brushes),
  triggers: clone(arena.triggers),
  spawn: { ...arena.spawn },
  killY: arena.killY,
  enemies: clone(arena.enemies),
});
BUILTINS['ashgate'] = () => ({
  name: 'ashgate',
  brushes: clone(ashgate.brushes),
  triggers: clone(ashgate.triggers),
  spawn: { ...ashgate.spawn },
  spawnYaw: ashgate.spawnYaw,
  killY: ashgate.killY,
  enemies: clone(ashgate.enemies),
  rails: clone(ashgate.rails),
});
// The same district, generated the same way, with nothing on its walls but its
// own masses. Kept as a level rather than a flag so the two can be flown one
// after the other without a rebuild — which is the only honest way to judge
// what an art pass is worth.
BUILTINS['ashgate-raw'] = () => ({
  name: 'ashgate-raw',
  brushes: clone(ashgate.brushesRaw),
  triggers: clone(ashgate.triggers),
  spawn: { ...ashgate.spawn },
  spawnYaw: ashgate.spawnYaw,
  killY: ashgate.killY,
  enemies: clone(ashgate.enemies),
  rails: clone(ashgate.rails),
});
// And once more in the art direction. Same masses, same lap, same collision —
// the only things that differ from raw are colour, surface and the sky it
// stands under, which is what makes flying one after the other an honest test
// of whether the art is doing any work.
BUILTINS['cyberedge'] = () => ({
  name: 'cyberedge',
  brushes: clone(ashgate.brushesCyber),
  triggers: clone(ashgate.triggers),
  spawn: { ...ashgate.spawn },
  spawnYaw: ashgate.spawnYaw,
  killY: ashgate.killY,
  enemies: clone(ashgate.enemies),
  rails: clone(ashgate.rails),
  theme: clone(ashgate.CYBER_THEME),
});
BUILTINS['figure8'] = () => ({
  name: 'figure8',
  brushes: clone(figure8.brushes),
  triggers: clone(figure8.triggers),
  spawn: { ...figure8.spawn },
  spawnYaw: figure8.spawnYaw,
  killY: figure8.killY,
  enemies: clone(figure8.enemies),
});
BUILTINS['course01'] = () => ({
  name: 'course01',
  brushes: clone(course01.brushes),
  triggers: clone(course01.triggers),
  spawn: { ...course01.spawn },
  killY: course01.killY,
  enemies: [],
});

// Files LAST, so a saved track wins over a generator of the same name. That is
// the rule that makes editing a generated level stick: the TypeScript is the
// seed, `tracks/<name>.level.json` is the level. Delete the file to get the
// generator back. `name` goes after the spread so the FILENAME decides what a
// level is called — the name baked into the JSON is whatever it was exported as,
// and a copy saved under a new filename must not answer to the old one.
for (const [path, mod] of Object.entries(TRACK_MODULES)) {
  const file = path.split('/').pop()!;
  const name = trackName(file);
  TRACK_FILES[name] = `src/levels/tracks/${file}`;
  BUILTINS[name] = () => ({ ...clone((mod as any).default ?? mod), name });
}

export const LEVEL_NAMES = Object.keys(BUILTINS).sort();

/**
 * Every model any built-in level names, so they can all be fetched before the
 * first frame. Cheap to compute (the levels are already in memory) and it means
 * switching tracks in the editor never shows a box where a platform should be.
 */
export const LEVEL_MODELS: string[] = (() => {
  const set = new Set<string>();
  for (const make of Object.values(BUILTINS)) {
    for (const b of make().brushes) if (b.m) set.add(b.m);
  }
  return [...set];
})();

/**
 * Fold a just-written track back into the in-memory copies, so re-picking it
 * from the dropdown gives what is on disk rather than what was bundled at boot.
 */
export function noteTrackSaved(name: string, data: LevelData) {
  const saved = clone(data);
  BUILTINS[name] = () => ({ ...clone(saved), name });
}

// Ashgate is the first level rather than a course, so it is what a fresh
// browser opens on. Anyone who has picked a track before keeps it: boot()
// reads the remembered name first and only falls through to this.
const DEFAULT_LEVEL = BUILTINS['ashgate'] ? 'ashgate' : 'figure8';
export const EDIT_STORE_KEY = 'editor.level.v1';
/** Which level was open last. A name, not a copy of the level. */
const EDIT_ACTIVE_KEY = 'editor.activeLevel';

function boot(): LevelData {
  const last = localStorage.getItem(EDIT_ACTIVE_KEY);
  if (last && BUILTINS[last]) return BUILTINS[last]();
  // No dev server to write files, so the whole level lives in localStorage and
  // an in-progress edit only survives a reload if we restore it from there.
  // Under `npm run dev` the file above IS the in-progress edit, and restoring a
  // stale blob over it would undo work you can see in git.
  if (!import.meta.env.DEV) {
    try {
      const saved = localStorage.getItem(EDIT_STORE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (Array.isArray(d.brushes) && d.spawn) return d;
      }
    } catch { /* fall through to the built-in */ }
  }
  return BUILTINS[DEFAULT_LEVEL]();
}

/** THE level. Mutated in place so every live reference stays valid. */
export const level: LevelData = boot();

/** Replace the active level's contents (same object, new data). */
export function setLevelData(data: LevelData) {
  level.name = data.name ?? 'untitled';
  // Remembered by NAME, so a reload comes back to this level's file rather than
  // to a snapshot of it taken at some point in the past.
  try { localStorage.setItem(EDIT_ACTIVE_KEY, level.name); } catch { /* ignore */ }
  level.brushes = data.brushes ?? [];
  level.triggers = data.triggers ?? [];
  level.spawn = data.spawn ?? { x: 0, y: 3, z: 0 };
  level.killY = data.killY ?? -40;
  level.enemies = data.enemies ?? [];
  level.spawnYaw = data.spawnYaw ?? 0;
}

/** Load a pristine built-in by name. */
export function loadLevel(name: string): boolean {
  const make = BUILTINS[name];
  if (!make) return false;
  setLevelData(make());
  return true;
}
