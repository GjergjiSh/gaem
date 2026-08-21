// Client half of the dev-only file writer (see vite-devsave.ts).
//
// Tunes and levels are source, so they are saved into the repo as you work, not
// into localStorage. localStorage stays as the fallback for a built game, where
// there is no dev server to write anything.

/** True only under `npm run dev`. A production build never writes files. */
export const CAN_WRITE = import.meta.env.DEV;

export interface SaveResult {
  ok: boolean;
  /** Present when the write failed — shown in the UI rather than swallowed. */
  error?: string;
}

/**
 * Write a JSON file in the repo. `path` is repo-relative and must be under
 * `src/profiles/` or `src/levels/tracks/`; the server enforces that too.
 */
export async function saveJson(path: string, data: unknown): Promise<SaveResult> {
  if (!CAN_WRITE) return { ok: false, error: 'no dev server' };
  try {
    const res = await fetch('/__save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as any).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** hh:mm:ss, for the "last saved" readouts. */
export function stamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

/**
 * Fire-and-forget write for page teardown. `fetch` is abandoned when the tab
 * goes away mid-request; sendBeacon is queued by the browser and delivered even
 * as the page dies, which is exactly the "I closed the tab" case that used to
 * lose edits.
 */
export function beaconJson(path: string, data: unknown): void {
  if (!CAN_WRITE || !navigator.sendBeacon) return;
  const body = new Blob([JSON.stringify({ path, data })], { type: 'application/json' });
  navigator.sendBeacon('/__save', body);
}
