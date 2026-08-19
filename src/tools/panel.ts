// Tuning panel, generated entirely from the shape of T. Adding a param to
// core/tuning.ts is all it takes to get a slider here — no edits in this file.

import { Pane } from 'tweakpane';
import { T, DEFAULTS, TUNING_VERSION, inferRange, snapshot, applyProfile } from '../core/tuning';
import { typingInAField } from '../engine/input';

const STORE_KEY = `tuning.v${TUNING_VERSION}`;

// Built-in game-feel profiles: JSON files in src/profiles/, bundled at build time.
// Each is applied over code DEFAULTS, so a file only has to list what it changes —
// a full snapshot (what "download json" produces) works identically.
const PROFILE_MODULES = import.meta.glob('../profiles/*.json', { eager: true }) as Record<string, any>;
const PROFILES: Record<string, any> = {};
for (const [path, mod] of Object.entries(PROFILE_MODULES)) {
  PROFILES[path.split('/').pop()!.replace(/\.json$/, '')] = (mod as any).default ?? mod;
}
const PROFILE_NAMES = Object.keys(PROFILES).sort();

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
      const folder = this.pane.addFolder({ title: group, expanded: group === 'ground' });
      const obj = T[group] as Record<string, any>;
      for (const key of Object.keys(obj)) {
        const path = `${group}/${key}`;
        const value = obj[key];
        if (typeof value === 'boolean' || typeof value === 'string') {
          // Strings get no range: tweakpane turns a '#rrggbb' value into a colour
          // picker on its own, which is exactly what crosshair/color wants.
          folder.addBinding(obj, key).on('change', () => { this.overrides[path] = obj[key]; });
        } else {
          const { min, max, step, doc } = inferRange(path, value);
          const opts: Record<string, number> = { min, max };
          if (step !== undefined) opts.step = step;   // omitted = continuous, no quantising
          const b = folder.addBinding(obj, key, opts);
          b.on('change', () => { this.overrides[path] = obj[key]; });
          if (doc) b.element.title = doc;
        }
      }
    }

    const io = this.pane.addFolder({ title: 'profiles', expanded: true });
    // Built-in feels. The dropdown and the Alt+1–9 hotkeys both land in
    // loadProfile(), which records the whole diff as overrides so the choice
    // survives a reload.
    if (PROFILE_NAMES.length) {
      const opts = [{ text: '— pick —', value: '' },
        ...PROFILE_NAMES.map((n, i) => ({ text: `alt+${i + 1} · ${n}`, value: n }))];
      io.addBinding(this.sel, 'profile', { label: 'built-in', options: opts })
        .on('change', (ev) => { if (ev.value) this.loadProfile(ev.value); });
    }
    io.addButton({ title: 'download json' }).on('click', () => this.download());
    io.addButton({ title: 'copy to clipboard' }).on('click', () => {
      navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
    });
    io.addButton({ title: 'load from file' }).on('click', () => this.upload());
    io.addButton({ title: 'reset to code defaults' }).on('click', () => {
      this.overrides = {};
      this.sel.profile = '';
      localStorage.removeItem(STORE_KEY);
      applyProfile(DEFAULTS);
      this.refresh();
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

    // Survive page reloads with the last tune intact — Vite HMR reloads a lot.
    // The key carries a version: bumping it in tuning.ts discards stale saves so
    // new defaults actually take effect instead of being silently overridden.
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      try {
        this.overrides = JSON.parse(saved);
        for (const [path, v] of Object.entries(this.overrides)) {
          const [group, key] = path.split('/');
          const g = (T as any)[group];
          if (g && key in g) g[key] = v;
        }
        this.refresh();
      } catch { this.overrides = {}; }
    }
    addEventListener('beforeunload', () => {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.overrides));
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

  refresh() { this.pane.refresh(); }

  /** Apply a built-in profile over code defaults and persist it like slider moves. */
  loadProfile(name: string) {
    const data = PROFILES[name];
    if (!data) return;
    applyProfile(DEFAULTS);
    applyProfile(data);
    this.captureOverrides();
    this.sel.profile = name;
    this.refresh();
    this.onChange();
  }

  /**
   * Rebuild the override set from "how does T differ from DEFAULTS right now".
   * Needed after wholesale loads (built-in profile, uploaded file), where the
   * per-slider change tracking never fired — without it the loaded tune is
   * silently lost (or half-merged with stale overrides) on the next reload.
   */
  private captureOverrides() {
    this.overrides = {};
    for (const group of Object.keys(T)) {
      const obj = (T as any)[group], def = (DEFAULTS as any)[group];
      for (const key of Object.keys(obj)) {
        if (obj[key] !== def[key]) this.overrides[`${group}/${key}`] = obj[key];
      }
    }
  }

  /**
   * Record a change made outside the panel (a hotkey, say) so it persists like any
   * slider move and the widget shows the new value instead of going stale.
   */
  noteOverride(path: string, value: number | boolean | string) {
    this.overrides[path] = value;
    this.refresh();
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
