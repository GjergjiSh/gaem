"""
Scores assets/odm-sounds/*.wav against the real gear's measured profile.

Run:  python tools/check-odm-sounds.py

The targets below were measured off 17 separate gear events in reference
footage, and they exist because the first version of the sound set was wrong in
ways that were obvious against the real thing and invisible on their own. Each
check corresponds to one of those failures:

  BANDS     the reference spreads its energy 10/22/24/25/20 across five bands.
            A verb with most of its energy in one band is a thump or a beep, not
            air. (`jump` was once 93% under 200 Hz.)
  CENTROID  a real burst's spectral centroid HOLDS - 2924 Hz to 3287 Hz over its
            life - because gas leaving a hole does not change pitch. A centroid
            that falls is heard as a "pew" whatever it was built from. This is
            the single most useful check in the file.
  ATTACK    27 ms to half level, median. Air takes time to leave a nozzle.
  SEAMS     loops must be periodic, so no broadband spike at the wrap point.
  EDGES     one-shots must start and end at true zero, so cancelling one cannot
            click - moves here interrupt each other constantly.
"""

import json
import os
import sys
import wave

import numpy as np

SR = 44100
SND = os.path.join(os.path.dirname(__file__), '..', 'assets', 'odm-sounds')
W = 2048

# --- measured from the reference footage
REF_BANDS = np.array([9.6, 21.6, 24.2, 25.2, 19.5])
BAND_EDGES = [(20, 200), (200, 800), (800, 2500), (2500, 6000), (6000, 22050)]
REF_CENTROID = (2924, 3287)          # start -> end; it rises slightly
BAND_TOL = 14.0                      # percentage points a band may stray
CENTROID_FALL_MAX = 0.55             # end/start below this = a falling "pew"
ONE_BAND_MAX = 55.0                  # no single band may own more than this


def read(path):
    with wave.open(path, 'rb') as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2')
    return a.reshape(-1, 2).astype(float) / 32768.0


def frames(x):
    return [x[i:i + W] for i in range(0, len(x) - W, W // 2)
            if np.sqrt((x[i:i + W] ** 2).mean()) > 1e-4]


def bands(m):
    S = np.abs(np.fft.rfft(m * np.hanning(len(m)))) ** 2
    f = np.fft.rfftfreq(len(m), 1 / SR)
    tot = S.sum() + 1e-18
    return np.array([100 * S[(f >= lo) & (f < hi)].sum() / tot for lo, hi in BAND_EDGES])


def centroids(m):
    f = np.fft.rfftfreq(W, 1 / SR)
    out = []
    for fr in frames(m):
        S = np.abs(np.fft.rfft(fr * np.hanning(W))) ** 2
        out.append((S * f).sum() / (S.sum() + 1e-18))
    return out


def main():
    man = json.load(open(os.path.join(SND, 'manifest.json')))
    fails, warns = [], []
    print('%-15s %5s %5s %5s %5s %5s %8s %7s %6s' %
          ('name', 'lo', 'lomid', 'mid', 'himid', 'hi', 'centroid', 'trend', 'atk'))
    print('-' * 72)

    for s in man['sounds']:
        x = read(os.path.join(SND, s['file']))
        m = x.mean(axis=1)
        b = bands(m)
        cs = centroids(m)
        c0 = float(np.mean(cs[:2])) if len(cs) >= 2 else float(cs[0])
        c1 = float(np.mean(cs[-2:])) if len(cs) >= 2 else c0
        trend = c1 / (c0 + 1e-9)
        e = np.abs(m)
        atk = int(np.argmax(e >= 0.5 * e.max())) / SR * 1000

        print('%-15s %5.1f %5.1f %5.1f %5.1f %5.1f %8.0f %6.2fx %5.0fms' %
              (s['name'], b[0], b[1], b[2], b[3], b[4], np.mean(cs), trend, atk))

        if b.max() > ONE_BAND_MAX:
            fails.append('%s: %.0f%% of energy in one band (max %.0f)'
                         % (s['name'], b.max(), ONE_BAND_MAX))
        off = np.abs(b - REF_BANDS).max()
        if off > BAND_TOL:
            warns.append('%s: band profile off reference by %.0f pts' % (s['name'], off))
        if trend < CENTROID_FALL_MAX:
            fails.append('%s: centroid falls %.2fx - reads as a "pew"' % (s['name'], trend))
        if np.max(np.abs(x)) >= 0.999:
            fails.append('%s: clipped' % s['name'])
        if not s['loop'] and (abs(m[0]) > 1e-4 or abs(m[-1]) > 1e-4):
            fails.append('%s: live edge, will click when cancelled' % s['name'])

    print('\nloop wrap-around (HF energy at the seam vs interior):')
    for s in man['sounds']:
        if not s['loop']:
            continue
        m = read(os.path.join(SND, s['file'])).mean(axis=1)
        n = 512
        wrap = np.concatenate([m[-n // 2:], m[:n // 2]]) * np.hanning(n)
        mid = m[len(m) // 2 - n // 2: len(m) // 2 + n // 2] * np.hanning(n)
        hf = lambda g: np.sum(np.abs(np.fft.rfft(g))[n // 4:] ** 2)
        d = 10 * np.log10((hf(wrap) + 1e-18) / (hf(mid) + 1e-18))
        print('  %-15s %+6.2f dB   %s' % (s['name'], d, 'OK' if abs(d) < 6 else 'SEAM'))
        if abs(d) >= 6:
            fails.append('%s: loop seam %+.1f dB' % (s['name'], d))

    allb = np.mean([bands(read(os.path.join(SND, s['file'])).mean(axis=1))
                    for s in man['sounds']], axis=0)
    print('\nset mean  %s' % '  '.join('%.1f' % v for v in allb))
    print('reference %s' % '  '.join('%.1f' % v for v in REF_BANDS))
    print('deviation %s' % '  '.join('%+.1f' % v for v in (allb - REF_BANDS)))

    for w in warns:
        print('\nWARN  ' + w)
    if fails:
        print('\nFAIL')
        for f in fails:
            print('  ' + f)
        sys.exit(1)
    print('\nPASS - %d files match the reference profile' % len(man['sounds']))


if __name__ == '__main__':
    main()
