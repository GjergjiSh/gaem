// A new build has landed on disk. Do not reload the page under the player.
//
// `main.ts` self-accepts HMR because the game holds too much global state to
// hot-swap, and for a long time that accept handler was a bare
// `location.reload()`. Which means every deploy — and every source edit —
// yanked the game out from under whoever was playing. That is the whole reason
// the dev tree and the play tree were split apart, and then the deploy step
// walked straight back into it.
//
// So: the files change, the running page does not. Vite has already fetched the
// new modules; the old instance keeps running until someone says otherwise, and
// the page is a coherent snapshot the whole time. A badge says a build is
// waiting. It applies itself the moment the game is paused, or immediately if
// you click it — never mid-run.

class Updates {
  /** A newer build is on disk and this page is not running it. */
  pending = false;
  private badge: HTMLButtonElement;

  constructor() {
    this.badge = document.createElement('button');
    this.badge.textContent = 'new build ready — click, or pause';
    this.badge.style.cssText = `
      position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
      z-index:45; display:none; cursor:pointer; border:0;
      padding:9px 16px; border-radius:999px;
      background:rgba(56,189,248,.92); color:#04121f;
      font:700 11px/1 ui-monospace,monospace; letter-spacing:.14em;
      text-transform:uppercase; box-shadow:0 6px 22px rgba(0,0,0,.5);`;
    this.badge.onclick = () => this.apply();
    document.body.append(this.badge);
  }

  /** Vite handed us a new build. Note it and get out of the way. */
  arrived() {
    this.pending = true;
    this.badge.style.display = 'block';
  }

  /**
   * Called every frame with whether the game is currently frozen. A paused game
   * is the one moment reloading costs nothing, so it takes it.
   */
  applyWhenIdle(paused: boolean) {
    if (this.pending && paused) this.apply();
  }

  private apply() {
    this.badge.textContent = 'reloading…';
    location.reload();
  }
}

export const updates = new Updates();
