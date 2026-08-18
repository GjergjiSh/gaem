// Tuning panel, generated entirely from the shape of T. Adding a param to
// core/tuning.ts is all it takes to get a slider here — no edits in this file.

import { Pane } from 'tweakpane';
import { T, TUNING_VERSION, inferRange, snapshot, applyProfile } from '../core/tuning';

const STORE_KEY = `tuning.v${TUNING_VERSION}`;

export class Panel {
  pane: Pane;
  private slotA: any = null;
  private slotB: any = null;
  private showingB = false;

  constructor(private onChange: () => void) {
    this.pane = new Pane({ title: 'Tuning  ·  F1 hides' });
    (this.pane.element.parentElement as HTMLElement).style.zIndex = '20';

    for (const group of Object.keys(T) as (keyof typeof T)[]) {
      const folder = this.pane.addFolder({ title: group, expanded: group === 'ground' });
      const obj = T[group] as Record<string, any>;
      for (const key of Object.keys(obj)) {
        const path = `${group}/${key}`;
        const value = obj[key];
        if (typeof value === 'boolean') {
          folder.addBinding(obj, key);
        } else {
          const { min, max, step, doc } = inferRange(path, value);
          const b = folder.addBinding(obj, key, { min, max, step });
          if (doc) b.element.title = doc;
        }
      }
    }

    const io = this.pane.addFolder({ title: 'profiles', expanded: true });
    io.addButton({ title: 'download json' }).on('click', () => this.download());
    io.addButton({ title: 'copy to clipboard' }).on('click', () => {
      navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
    });
    io.addButton({ title: 'load from file' }).on('click', () => this.upload());
    io.addButton({ title: 'store as A' }).on('click', () => { this.slotA = snapshot(); });
    io.addButton({ title: 'store as B' }).on('click', () => { this.slotB = snapshot(); });
    io.addButton({ title: 'toggle A / B  [T]' }).on('click', () => this.toggleAB());

    this.pane.on('change', () => this.onChange());

    addEventListener('keydown', (e) => {
      if (e.code === 'F1') { e.preventDefault(); this.toggle(); }
      if (e.code === 'KeyT') this.toggleAB();
    });

    // Survive page reloads with the last tune intact — Vite HMR reloads a lot.
    // The key carries a version: bumping it in tuning.ts discards stale saves so
    // new defaults actually take effect instead of being silently overridden.
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) { try { applyProfile(JSON.parse(saved)); this.refresh(); } catch {} }
    addEventListener('beforeunload', () => {
      localStorage.setItem(STORE_KEY, JSON.stringify(snapshot()));
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
      this.refresh();
      this.onChange();
    };
    inp.click();
  }
}
