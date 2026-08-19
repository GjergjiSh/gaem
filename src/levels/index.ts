// The active level is mutable data behind the `level` singleton — see level.ts.
export { level, loadLevel, setLevelData, LEVEL_NAMES, EDIT_STORE_KEY } from './level';
export type { LevelData } from './level';
export type { Brush, Trigger, Level } from './types';
