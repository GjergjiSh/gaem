// Escape freezes the game.
//
// Pause is a time scale of zero, which is the same lever the weapon wheel
// pulls — but it is not implemented that way. A zero dt still runs every
// system, and systems that read an input edge (the weapon reads shootPressed
// and clears it) would happily fire a shot into a frozen world. So main skips
// the simulation outright while this is active and only renders.
//
// Escape also drops pointer lock, and the browser gives us no say in that. That
// is the right behaviour anyway — a paused game should give the mouse back — so
// the only thing to handle is getting it back: a click resumes AND recaptures,
// because the canvas's own lock request rides the same gesture.

export class Pause {
  active = false;
  private overlay: HTMLDivElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position:fixed; inset:0; z-index:40; display:none;
      align-items:center; justify-content:center;
      background:rgba(8,10,16,.62); backdrop-filter:blur(2px);
      font:600 13px/1.7 ui-monospace,monospace; color:#e6edf7;
      letter-spacing:.14em; text-transform:uppercase;
      pointer-events:none;`;   // clicks belong to the canvas, which re-locks
    const card = document.createElement('div');
    card.style.cssText = 'text-align:center; text-shadow:0 2px 12px rgba(0,0,0,.8);';
    card.innerHTML = '<div style="font-size:26px; letter-spacing:.3em">PAUSED</div>'
      + '<div style="opacity:.65; margin-top:14px">esc to resume</div>'
      + '<div style="opacity:.45; margin-top:2px">click to resume and recapture the mouse</div>';
    this.overlay.append(card);
    document.body.append(this.overlay);

    // Resume on click. The canvas click handler requests pointer lock from the
    // same event, so one click gives the game back and the mouse back.
    addEventListener('mousedown', () => { if (this.active) this.set(false); });
  }

  /** Escape. Refused while the editor owns the screen — F2 is its own pause. */
  toggle(editing: boolean) {
    if (editing) return;
    this.set(!this.active);
  }

  private set(on: boolean) {
    this.active = on;
    this.overlay.style.display = on ? 'flex' : 'none';
  }
}
