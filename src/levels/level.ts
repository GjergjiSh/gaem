// The active level as MUTABLE data. Everything (renderer, physics, editor, main
// loop) reads this one object, so the editor can reshape the world live and a
// rebuild is just "re-read level.*". Levels serialize to plain JSON — same
// philosophy as tuning profiles.

import type { Brush, Trigger, Level } from './types';
import * as arena from './arena';
import * as course01 from './course01';

export interface LevelData extends Level {
  name: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// Built-in JSON tracks, bundled at build time (same pattern as tuning profiles).
const TRACK_MODULES = import.meta.glob('./tracks/*.json', { eager: true }) as Record<string, any>;

/** Pristine copies of every built-in level, keyed by name. */
const BUILTINS: Record<string, () => LevelData> = {};
for (const [path, mod] of Object.entries(TRACK_MODULES)) {
  const name = path.split('/').pop()!.replace(/\.json$/, '');
  BUILTINS[name] = () => ({ name, ...clone((mod as any).default ?? mod) });
}
BUILTINS['arena'] = () => ({
  name: 'arena',
  brushes: clone(arena.brushes),
  triggers: clone(arena.triggers),
  spawn: { ...arena.spawn },
  killY: arena.killY,
  enemies: clone(arena.enemies),
});
BUILTINS['course01'] = () => ({
  name: 'course01',
  brushes: clone(course01.brushes),
  triggers: clone(course01.triggers),
  spawn: { ...course01.spawn },
  killY: course01.killY,
  enemies: [],
});

export const LEVEL_NAMES = Object.keys(BUILTINS).sort();

const DEFAULT_LEVEL = BUILTINS['loop-course'] ? 'loop-course' : 'arena';
export const EDIT_STORE_KEY = 'editor.level.v1';

function boot(): LevelData {
  // An in-progress edit survives reloads; picking a built-in from the editor's
  // dropdown always restores the pristine copy.
  try {
    const saved = localStorage.getItem(EDIT_STORE_KEY);
    if (saved) {
      const d = JSON.parse(saved);
      if (Array.isArray(d.brushes) && d.spawn) return d;
    }
  } catch { /* fall through to the built-in */ }
  return BUILTINS[DEFAULT_LEVEL]();
}

/** THE level. Mutated in place so every live reference stays valid. */
export const level: LevelData = boot();

/** Replace the active level's contents (same object, new data). */
export function setLevelData(data: LevelData) {
  level.name = data.name ?? 'untitled';
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
