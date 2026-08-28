// Tuning panel, generated entirely from the shape of T. Adding a param to
// core/tuning.ts is all it takes to get a slider here — no edits in this file.

import { Pane } from 'tweakpane';
import { T, DEFAULTS, TUNING_VERSION, inferRange, snapshot, applyProfile } from '../core/tuning';
import { typingInAField } from '../engine/input';
import { CLIP_NAMES } from '../engine/audio';
import { CAN_WRITE, saveJson, beaconJson, stamp } from './devsave';

/**
 * The three sound groups, and the sub-folder title each gets. Listed here rather
 * than derived from a name prefix so that adding a `sound*` group to T does not
 * silently move it under this folder without a title.
 */
const SOUND_GROUPS: Record<string, string> = {
  soundAssign: 'assign · clip per move',
  soundLevel: 'levels · gain per move',
  soundFlow: 'flow · fades, ducking, retrigger',
};

/**
 * The style meter, likewise under one folder — the master numbers and the
 * per-move ones are one feature and splitting them across two top-level items
 * would mean tuning it in two places at once.
 */
const STYLE_GROUPS: Record<string, string> = {
  style: 'meter · drain, cooling, ranks',
  styleValue: 'value · points per move',
  styleSpam: 'spam · uses before a move goes stale',
};

/** Built from the files actually in assets/odm-sounds-ref/, so the dropdown can
 *  never offer a clip that is not there. Empty value = that move stays silent. */
const CLIP_OPTIONS = [
  { text: '— silent —', value: '' },
  ...CLIP_NAMES.map((n) => ({ text: n, value: n })),
];

const STORE_KEY = `tuning.v${TUNING_VERSION}`;
/** Which profile file edits are written into. Survives reloads on its own. */
const ACTIVE_KEY = 'tuning.activeProfile';
const profilePath = (name: string) => `src/profiles/${name}.json`;

// Built-in game-feel profiles: JSON files in src/profiles/, bundled at build time.
// Each is applied over code DEFAULTS, so a file only has to list what it changes —
// a full snapshot (what "download json" produces) works identically.
const PROFILE_MODULES = import.meta.glob('../profiles/*.json', { eager: true }) as Record<string, any>;
const PROFILES: Record<string, any> = {};
for (const [path, mod] of Object.entries(PROFILE_MODULES)) {
  PROFILES[path.split('/').pop()!.replace(/\.json$/, '')] = (mod as any).default ?? mod;
}
const PROFILE_NAMES = Object.keys(PROFILES).sort();

// The house tune. This is the game's real baseline, not a preset you have to go
// and pick: BASE below is DEFAULTS with it already applied, and every boot starts
// from BASE. The raw tuning.ts numbers stay reachable through "reset to code
// defaults", but nothing ever lands on them by accident.
const DEFAULT_PROFILE = 'titanfall';

/**
 * The tune the game boots into: code defaults with the active profile on top.
 * Reassigned whenever the active profile changes or is written back to disk, so
 * it always means "what a fresh boot would give me".
 *
 * Overrides are stored as a diff against THIS, which is what stops the game ever
 * coming up on a tune nobody picked: an empty save, a corrupt save and a rich
 * save all start from the same feel.
 */
let BASE: any = baseFor(DEFAULT_PROFILE);

function baseFor(name: string): any {
  const base = JSON.parse(JSON.stringify(DEFAULTS));
  if (PROFILES[name]) applyProfile(PROFILES[name], base);
  return base;
}

/**
 * Groups that are switches rather than tuning, and are never persisted anywhere:
 * not into a profile file, not into localStorage. A cheat that survived a reload
 * would be a cheat you forget is on, and then an afternoon spent wondering why
 * the gas meter never moves. Worse, `cheats` written into titanfall.json would
 * ship the cheat to everyone who loads that profile.
 *
 * The cost of the rule is that infinite gas is off again after a refresh, which
 * is the right side to err on.
 */
const EPHEMERAL = new Set(['cheats']);

/** How T differs from code defaults — the shape a profile file is stored in. */
function profileDiff(): any {
  const out: any = {};
  for (const group of Object.keys(T)) {
    if (EPHEMERAL.has(group)) continue;
    const obj = (T as any)[group], def = (DEFAULTS as any)[group];
    for (const key of Object.keys(obj)) {
      if (obj[key] !== def[key]) (out[group] ??= {})[key] = obj[key];
    }
  }
  return out;
}

export class Panel {
  pane: Pane;
  private slotA: any = null;
  private slotB: any = null;
  private showingB = false;
  /**
   * Only params you actually moved get persisted, keyed by path. Saving the whole
   * snapshot instead means a default you change in tuning.ts is immediately
   * overwritten by the stale saved copy on the next load — you edit the file, reload,
   * and nothing happens. Storing just the overrides keeps code defaults live for
   * everything you haven't deliberately touched.
   */
  private overrides: Record<string, number | boolean | string> = {};
  /** Bound to the built-in profile dropdown. */
  private sel = { profile: '' };
  /**
   * The profile file every edit is written straight into. Empty means scratch
   * mode — "reset to code defaults" puts you there, so that button can never
   * blank a shipped profile on the next slider move.
   */
  private active = '';
  /** Readonly readout: where the last save went, or why it failed. */
  private io = { saved: '' };
  private savedBlade: any = null;

  constructor(private onChange: () => void) {
    this.pane = new Pane({ title: 'Tuning  ·  F1 hides' });
    // The schema outgrew the screen — without an explicit scroll container the
    // lower folders are simply unreachable.
    const host = this.pane.element.parentElement as HTMLElement;
    host.style.zIndex = '20';
    host.style.maxHeight = 'calc(100vh - 16px)';
    host.style.overflowY = 'auto';
    host.style.overflowX = 'hidden';
    host.style.overscrollBehavior = 'contain';

    for (const group of Object.keys(T) as (keyof typeof T)[]) {
      if (group in SOUND_GROUPS || group in STYLE_GROUPS) continue;  // built below
      const folder = this.pane.addFolder({ title: group, expanded: group === 'ground' });
      const obj = T[group] as Record<string, any>;
      for (const key of Object.keys(obj)) this.bind(folder, group, obj, key);
    }

    // Sound and style each get ONE top-level folder holding their groups as
    // sub-folders, rather than three top-level items apiece. Each is one feature
    // - for sound: which clip, how loud, how they behave together; for style:
    // the meter, what a move is worth, and how fast it goes stale - and tuning
    // either from two places at opposite ends of the panel is what this avoids.
    // The first sub-folder of each is open, being the one you came for.
    for (const [title, groups, first] of [
      ['sounds', SOUND_GROUPS, 'soundAssign'],
      ['style', STYLE_GROUPS, 'style'],
    ] as const) {
      const parent = this.pane.addFolder({ title, expanded: false });
      for (const [group, sub] of Object.entries(groups)) {
        const f = parent.addFolder({ title: sub, expanded: group === first });
        const obj = (T as any)[group] as Record<string, any>;
        for (const key of Object.keys(obj)) this.bind(f, group, obj, key);
      }
    }

    const io = this.pane.addFolder({ title: 'profiles', expanded: true });
    // Built-in feels. The dropdown and the Alt+1–9 hotkeys both land in
    // loadProfile(), which records the whole diff as overrides so the choice
    // survives a reload. The default one is already applied at boot — it is in the
    // list to switch back to, not because you have to pick it.
    if (PROFILE_NAMES.length) {
      const opts = [{ text: '— pick —', value: '' },
        ...PROFILE_NAMES.map((n, i) => ({
          text: `alt+${i + 1} · ${n}${n === DEFAULT_PROFILE ? '  (default)' : ''}`, value: n }))];
      io.addBinding(this.sel, 'profile', { label: 'built-in', options: opts })
        .on('change', (ev) => { if (ev.value) this.loadProfile(ev.value); });
    }
    this.savedBlade = io.addBinding(this.io, 'saved', { readonly: true, label: 'saved' });
    io.addButton({ title: 'save as new profile...' }).on('click', () => this.saveAs());
    io.addButton({ title: 'download json (backup)' }).on('click', () => this.download());
    io.addButton({ title: 'copy to clipboard' }).on('click', () => {
      navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
    });
    io.addButton({ title: 'load from file' }).on('click', () => this.upload());
    // Two different "undo everything", and they are genuinely different: one puts
    // you back on the house tune, the other strips it off and shows the raw
    // tuning.ts numbers. Neither writes a profile file — a reset is not an edit,
    // and a button that could blank titanfall.json in one click is a trap.
    io.addButton({ title: `reset to ${DEFAULT_PROFILE} (default)` }).on('click', () => {
      this.setActive(DEFAULT_PROFILE);
      this.onChange();
    });
    io.addButton({ title: 'reset to code defaults' }).on('click', () => {
      this.setActive('');
      this.onChange();
    });
    io.addButton({ title: 'store as A' }).on('click', () => { this.slotA = snapshot(); });
    io.addButton({ title: 'store as B' }).on('click', () => { this.slotB = snapshot(); });
    io.addButton({ title: 'toggle A / B  [T]' }).on('click', () => this.toggleAB());

    this.pane.on('change', () => this.onChange());

    addEventListener('keydown', (e) => {
      // Same reason the character ignores keys here: these hotkeys are on the
      // window, so without the guard typing a value into a field would trigger them.
      if (typingInAField(e)) return;
      if (e.code === 'F1') { e.preventDefault(); this.toggle(); }
      if (e.code === 'KeyT') this.toggleAB();
      // ALT+digit, not plain digits: 1 and 2 are gun slots now.
      const digit = e.altKey ? e.code.match(/^Digit([1-9])$/) : null;
      if (digit) {
        const name = PROFILE_NAMES[Number(digit[1]) - 1];
        if (name) this.loadProfile(name);
      }
    });

    // Boot: the active profile first, always, then whatever localStorage still
    // holds on top of it. Unconditional, so the game can never come up on a tune
    // nobody picked. The active profile is titanfall unless you chose another one,
    // and under `npm run dev` its FILE already holds your edits — localStorage is
    // only carrying anything at all when the dev server was not there to write.
    this.active = localStorage.getItem(ACTIVE_KEY) ?? DEFAULT_PROFILE;
    if (this.active && !PROFILES[this.active]) this.active = DEFAULT_PROFILE;
    BASE = baseFor(this.active);
    applyProfile(BASE);
    this.sel.profile = this.active;
    this.io.saved = CAN_WRITE
      ? (this.active ? profilePath(this.active) : 'scratch · localStorage only')
      : 'localStorage (no dev server)';
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
      for (const [path, v] of Object.entries(saved as Record<string, any>)) {
        const [group, key] = path.split('/');
        const g = (T as any)[group];
        if (g && key in g) g[key] = v;
      }
    } catch { /* unreadable save: the house tune stands */ }
    // Re-derive the override set from where T actually landed rather than trusting
    // the save. Anything already in the profile file is a no-op against BASE and
    // gets dropped, leaving only edits the file does not have yet.
    this.captureOverrides();
    this.refresh();

    // Persist eagerly. beforeunload alone was the bug behind "my changes don't
    // stick": browsers skip it whenever the tab is discarded, crashed or closed
    // from the background, and a session that ends that way loses everything since
    // the last real navigation. pagehide fires in those cases; the debounced write
    // on each edit covers even a hard kill.
    const flush = () => {
      if (this.saveT) { clearTimeout(this.saveT); this.saveT = 0; }
      this.write();
      // fetch() is abandoned when the page goes away; the beacon is not.
      if (CAN_WRITE && this.active) beaconJson(profilePath(this.active), profileDiff());
    };
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  toggleAB() {
    const from = this.showingB ? this.slotA : this.slotB;
    if (!from) return;
    applyProfile(from);
    this.showingB = !this.showingB;
    this.refresh();
    this.onChange();
  }

  get abLabel() {
    if (!this.slotA && !this.slotB) return '';
    return this.showingB ? 'B' : 'A';
  }

  /**
   * One control, chosen by the value's type and its path. Extracted so the
   * generic groups and the sound sub-folders build their bindings the same way —
   * the sound folders are a different LAYOUT, not different behaviour, and a
   * second copy of this would be where they quietly diverge.
   */
  private bind(folder: any, group: string, obj: Record<string, any>, key: string) {
    const path = `${group}/${key}`;
    const value = obj[key];
    if (group === 'soundAssign') {
      // A dropdown of what is on disk, rather than a text field you have to type
      // a filename into exactly right.
      folder.addBinding(obj, key, { options: CLIP_OPTIONS })
        .on('change', () => this.note(path, obj[key]));
    } else if (typeof value === 'boolean' || typeof value === 'string') {
      // Strings get no range: tweakpane turns a '#rrggbb' value into a colour
      // picker on its own, which is exactly what crosshair/color wants.
      folder.addBinding(obj, key).on('change', () => this.note(path, obj[key]));
    } else {
      const { min, max, step, doc } = inferRange(path, value);
      const opts: Record<string, number> = { min, max };
      if (step !== undefined) opts.step = step;   // omitted = continuous, no quantising
      const b = folder.addBinding(obj, key, opts);
      b.on('change', () => this.note(path, obj[key]));
      if (doc) b.element.title = doc;
    }
  }

  refresh() { this.pane.refresh(); }

  /** Switch to a built-in profile: it becomes the tune AND the file edits go to. */
  loadProfile(name: string) {
    if (!PROFILES[name]) return;
    this.setActive(name);
    this.onChange();
  }

  /**
   * Make `name` the active profile — the tune, the boot state, and the file every
   * later edit is written into. Empty name = scratch: code defaults, and edits go
   * to localStorage only so no profile file is touched.
   */
  private setActive(name: string) {
    this.active = PROFILES[name] ? name : '';
    BASE = baseFor(this.active);
    applyProfile(BASE);
    this.overrides = {};
    this.sel.profile = this.active;
    localStorage.setItem(ACTIVE_KEY, this.active);
    this.write();
    this.io.saved = this.active
      ? (CAN_WRITE ? profilePath(this.active) : `${this.active} · localStorage`)
      : 'scratch · localStorage only';
    this.refresh();
  }

  /**
   * Rebuild the override set from "how does T differ from BASE right now".
   * Needed after wholesale loads (built-in profile, uploaded file), where the
   * per-slider change tracking never fired — without it the loaded tune is
   * silently lost (or half-merged with stale overrides) on the next reload.
   *
   * Against BASE, not DEFAULTS: the diff has to be replayable on top of the tune
   * the game boots into. It still reproduces any profile exactly — where a profile
   * is silent, T holds the code default, and if BASE disagrees there that shows up
   * in the diff like any other edit.
   */
  private captureOverrides() {
    this.overrides = {};
    for (const group of Object.keys(T)) {
      if (EPHEMERAL.has(group)) continue;
      const obj = (T as any)[group], base = (BASE as any)[group];
      for (const key of Object.keys(obj)) {
        if (obj[key] !== base[key]) this.overrides[`${group}/${key}`] = obj[key];
      }
    }
    this.save();
  }

  /**
   * Record a change made outside the panel (a hotkey, say) so it persists like any
   * slider move and the widget shows the new value instead of going stale.
   */
  noteOverride(path: string, value: number | boolean | string) {
    this.note(path, value);
    this.refresh();
  }

  /** Record one changed param and schedule a save. */
  private note(path: string, value: number | boolean | string) {
    if (EPHEMERAL.has(path.split('/')[0])) return;
    this.overrides[path] = value;
    this.save();
  }

  /**
   * Debounced so dragging a slider does not hit localStorage once per pixel;
   * short enough that a click-and-release is on disk before you can reload.
   */
  private saveT = 0;
  private writing = false;
  private queued = false;
  private save() {
    if (this.saveT) return;
    this.saveT = setTimeout(() => { this.saveT = 0; this.write(); }, 250) as unknown as number;
  }

  /**
   * localStorage always — it is the only store a built game has, and the fallback
   * whenever the dev server is not answering. Then, under `npm run dev`, the real
   * one: the active profile file in the repo.
   */
  private write() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.overrides)); } catch { /* full/blocked */ }
    if (!CAN_WRITE || !this.active) return;
    const name = this.active;
    const diff = profileDiff();
    // Nothing to say. Without this every page load would rewrite the profile it
    // just read and leave the repo dirty for no reason.
    if (JSON.stringify(diff) === JSON.stringify(PROFILES[name])) return;
    // One write at a time, with at most one queued behind it. Dragging a slider
    // can outrun the round trip, and two responses landing out of order would
    // leave BASE describing a file that is no longer what is on disk.
    if (this.writing) { this.queued = true; return; }
    this.writing = true;
    void saveJson(profilePath(name), diff).then((r) => {
      this.writing = false;
      if (this.queued) { this.queued = false; this.write(); }
      if (this.active !== name) return;   // switched profiles mid-flight
      if (r.ok) {
        // The file now holds these values, so they stop being overrides: fold them
        // into the in-memory profile and into BASE. Without this the same edits
        // would live in two stores and the next diff would double-count them.
        PROFILES[name] = diff;
        BASE = baseFor(name);
        this.overrides = {};
        try { localStorage.setItem(STORE_KEY, '{}'); } catch { /* ignore */ }
        this.io.saved = `${profilePath(name)} · ${stamp()}`;
      } else {
        // Never silent. A failed write means localStorage is all you have.
        this.io.saved = `NOT SAVED: ${r.error}`;
      }
      this.savedBlade?.refresh();
    });
  }

  /**
   * Write the current tune to a NEW profile file and switch to it. This is the
   * "snapshot before I start wrecking things" button: the old file stops changing
   * the moment the new one becomes active.
   */
  private async saveAs() {
    const raw = prompt('New profile name', `${this.active || 'tune'}-copy`);
    if (!raw) return;
    const name = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return;
    const note = (msg: string) => { this.io.saved = msg; this.savedBlade?.refresh(); };
    if (!CAN_WRITE) return note('NOT SAVED: no dev server');
    const diff = profileDiff();
    const r = await saveJson(profilePath(name), diff);
    if (!r.ok) return note(`NOT SAVED: ${r.error}`);
    PROFILES[name] = diff;
    this.active = name;
    BASE = baseFor(name);
    this.overrides = {};
    localStorage.setItem(ACTIVE_KEY, name);
    // The dropdown is built once from the glob, so a brand new file only joins the
    // list on reload. It is already active and already on disk either way.
    note(`${profilePath(name)} · ${stamp()} · reload to list`);
  }

  toggle() {
    const el = this.pane.element.parentElement as HTMLElement;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }

  private download() {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'profile.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private upload() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      applyProfile(JSON.parse(await f.text()));
      this.captureOverrides();
      this.sel.profile = '';
      this.refresh();
      this.onChange();
    };
    inp.click();
  }
}
