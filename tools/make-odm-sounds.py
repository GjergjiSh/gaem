"""
ODM gear movement SFX - synthesised, matched to the real gear's spectrum.

Run:  python tools/make-odm-sounds.py
Out:  assets/odm-sounds/*.wav  +  manifest.json

Companion: tools/check-odm-sounds.py scores every file against the reference
profile below and fails loudly when one drifts off it.

---------------------------------------------------------------- what it is

ODM gear is COMPRESSED AIR. Not a laser, not a bell, not a drum. Every verb here
is a valve opening, gas leaving a nozzle under pressure, and some hardware
rattling while it happens. Everything below follows from that one sentence.

The first version of this file did not, and it is worth writing down why it
failed, because all three mistakes are easy to make and none of them are audible
as mistakes until you compare against the real thing:

  1. SWEPT SINE TONES. A sine whose pitch falls is a ray gun. It was in here as
     the "wire zing" on the dash and the hooks, and it is the single loudest
     reason the set sounded like science fiction instead of hardware.
  2. THE CENTROID COLLAPSED. Measured on the reference, the spectral centroid of
     a real burst goes 2924 Hz -> 3287 Hz across its life: it HOLDS, because gas
     leaving a hole does not change pitch. Mine fell 3534 -> 1185, and a falling
     centroid is heard as a "pew" no matter what the source material was.
  3. THE ENERGY WAS IN ONE BAND. The reference spreads 10/22/24/25/20 across five
     bands. `jump` was 93% under 200 Hz and `hook_fire` was 72% in one mid octave.
     A verb that lives in one band reads as a thump or a beep, never as air.

------------------------------------------------------------- the measurements

ODM_SPECTRUM below is the long-term average magnitude spectrum of the reference
footage - 463 analysis frames across 17 separate gear events - normalised to
0 dB at 1 kHz. It is a description of tone colour, roughly -1.5 dB/octave, and
it is the reason these files sound like the gear: noise is synthesised directly
to this curve rather than filtered toward it.

It is a statistic, not a recording. Nothing is sampled; every waveform here comes
out of a random number generator. The curve above 15 kHz in the source is the
video's AAC lowpass rather than anything the gear does, so it is excluded.

Other numbers taken from the same 17 events, and matched here:

  attack to 50% peak   27 ms median   (air takes time to leave a nozzle; the
                                       old set's 1-5 ms edge is a click, not gas)
  duration             1337 ms mean   (the old set averaged 450 ms - clipped)
  centroid             holds, +-12%   (never falls; see mistake 2)

-------------------------------------------------------- flowing and cancelling

Still true, and still enforced at the bottom of every builder: one-shots decay
rather than sustaining so a cancel-fade never lands on a plateau, every file
starts and ends at true zero, and the level table at the end is a hierarchy so
that four verbs inside 300 ms stay legible. What CHANGED is the attack rule.
These are longer and softer-fronted than before, so instead of a 2 ms edge every
one-shot gets a small fast transient riding a slower swell - the transient is
what makes the input feel connected, the swell is what makes it sound like gas.
"""

import json
import os
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'odm-sounds')

# (Hz, dB relative to 1 kHz) - measured, see the header.
ODM_SPECTRUM = [
    (43.2, 2.95), (50.5, 4.77), (68.9, 3.51), (80.5, 2.81), (94.0, 5.13),
    (109.8, 4.94), (128.3, 4.13), (149.8, 4.29), (175.0, 2.01), (204.4, 1.57),
    (238.8, 2.80), (278.9, 2.80), (325.8, 1.71), (380.6, 2.09), (444.5, 1.55),
    (519.3, 1.36), (606.5, 1.09), (708.5, 0.82), (827.6, 0.22), (966.7, -0.38),
    (1129.2, -0.74), (1319.0, -0.84), (1540.7, -1.26), (1799.6, -1.65),
    (2102.1, -2.03), (2455.4, -1.91), (2868.2, -2.90), (3350.2, -2.80),
    (3913.4, -2.54), (4571.1, -2.92), (5339.5, -3.72), (6237.0, -4.76),
    (7285.3, -5.21), (8509.8, -6.21), (9940.2, -7.85), (11611.0, -10.30),
    (13562.6, -13.50),
    # Beyond the reference's codec cliff, continued on its own slope instead.
    (16000.0, -16.20), (20000.0, -20.50),
]
_SPEC_F = np.log(np.array([p[0] for p in ODM_SPECTRUM]))
_SPEC_D = np.array([p[1] for p in ODM_SPECTRUM])

# Every verb is air PLUS some hardware, and the hardware layers - the transient
# edge, the resonators, the saturation - are all brighter than the curve. So a
# file whose air matches the reference exactly comes out brighter than the
# reference once they are added. This tilts the air back down by the amount the
# hardware adds, so that the SUM lands on the measured profile rather than the
# air layer alone. Checked by tools/check-odm-sounds.py, which scores the
# finished mix; the value below is what brings the set mean onto the reference.
GLOBAL_TILT = -0.85     # dB/octave about 1 kHz


# ---------------------------------------------------------------- primitives


def nsamp(dur):
    return int(round(dur * SR))


def tline(n):
    return np.arange(n) / SR


def odm_curve(freqs, tilt=0.0, bump=None):
    """The measured curve in dB, plus optional per-sound colour.

    `tilt` is dB/octave added about 1 kHz - the only global brightness control,
    and it is kept small (well inside +-3) because the curve is the thing that
    makes these sound right. `bump` is (centre_hz, gain_db, width_octaves): a
    WIDE gaussian, never a resonant peak. A narrow peak here is a whistle, and a
    whistle is how the last version went wrong.
    """
    lf = np.log(np.maximum(freqs, 1.0))
    db = np.interp(lf, _SPEC_F, _SPEC_D)
    db = db + (tilt + GLOBAL_TILT) * np.log2(np.maximum(freqs, 20.0) / 1000.0)
    if bump:
        c, g, w = bump
        db = db + g * np.exp(-0.5 * (np.log2(np.maximum(freqs, 20.0) / c) / w) ** 2)
    return db


def air(n, ch, seed, tilt=0.0, bump=None, lo=30.0, hi=19500.0):
    """THE core sound. Noise synthesised straight onto the gear's own spectrum.

    Built in the frequency domain - every bin gets the measured magnitude and a
    random phase - so the result has the reference's tone colour exactly, by
    construction, instead of approximately after a filter. It is also periodic
    over n by definition, which is what the loops need.

    Two channels share most of their phase (see the 0.80/0.42 split) so the burst
    stays centred and mono-safe while the hiss opens up either side.
    """
    freqs = np.fft.rfftfreq(n, 1 / SR)
    mag = 10 ** (odm_curve(freqs, tilt, bump) / 20.0)
    mag *= 1.0 / (1.0 + (lo / np.maximum(freqs, 1.0)) ** 4)      # gentle HP
    mag *= 1.0 / (1.0 + (np.maximum(freqs, 1.0) / hi) ** 6)      # gentle LP
    common = np.exp(2j * np.pi * np.random.default_rng(seed * 104729).random(len(freqs)))
    unique = np.exp(2j * np.pi * np.random.default_rng(seed * 104729 + 31 + ch).random(len(freqs)))
    spec = mag * (0.80 * common + 0.42 * unique)
    spec[0] = 0.0
    x = np.fft.irfft(spec, n)
    return x / (np.max(np.abs(x)) + 1e-12)


def svf(x, cutoff, q=0.9, mode='bp'):
    """State-variable filter, cutoff modulated per sample. Used for RESONANCE
    (ringing metal excited by noise) and for slow colour movement - never for the
    fast downward sweeps that made the last set sound like a toy."""
    n = len(x)
    cut = np.clip(np.broadcast_to(np.asarray(cutoff, dtype=float), (n,)), 20.0, SR * 0.46)
    g = np.tan(np.pi * cut / SR)
    k = 1.0 / q
    out = np.empty(n)
    ic1 = ic2 = 0.0
    for i in range(n):
        gi = g[i]
        a1 = 1.0 / (1.0 + gi * (gi + k))
        a2 = gi * a1
        a3 = gi * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        out[i] = v2 if mode == 'lp' else v1 if mode == 'bp' else x[i] - k * v1 - v2
    return out


def biquad(x, kind, freq, order=2):
    sos = signal.butter(order, np.clip(freq, 20, SR * 0.45), btype=kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def circ_svf(x, cutoff, q=0.9, mode='bp'):
    """Loops only. A recursive filter starts from zero state, so the head of its
    output is a settling transient and the tail is steady state - and on a loop
    those two ends are adjacent, which is a click. Three tiled copies, keep the
    middle, and the filter has had a whole period to settle."""
    n = len(x)
    c = np.asarray(cutoff, dtype=float)
    c3 = np.tile(c, 3) if c.ndim and c.size == n else c
    return svf(np.tile(x, 3), c3, q, mode)[n:2 * n]


def circ_biquad(x, kind, freq, order=2):
    n = len(x)
    return biquad(np.tile(x, 3), kind, freq, order)[n:2 * n]


def gas_env(n, attack, decay, curve=1.15, hold=0.0):
    """The gas envelope: a rounded rise, an optional plateau, a long tail.

    The rise is `1 - exp` shaped rather than linear because a valve does not open
    instantly - measured on the reference this takes about 27 ms to reach half
    level, which is an order of magnitude slower than the click the old set used
    and most of why this one reads as pressure rather than percussion.
    """
    t = tline(n)
    a = 1.0 - np.exp(-t / max(attack / 2.2, 1e-5))
    # np.maximum before the power: np.where evaluates BOTH branches, and a
    # negative base raised to a fractional exponent is nan.
    d = np.exp(-(np.maximum(t - hold, 0.0) / max(decay, 1e-4)) ** curve)
    return a * d


def tick_env(n, attack, decay):
    """For mechanical detail only - the hardware, not the air."""
    t = tline(n)
    return np.clip(t / max(attack, 1e-5), 0, 1) * np.exp(-t / max(decay, 1e-4))


def turbulence(n, seed, depth=0.25, lo=6.0, hi=45.0, k=5):
    """Gas under pressure is not smooth. A few slow random rates multiplied onto
    the amplitude - this is what separates a burst of air from a burst of hiss."""
    rng = np.random.default_rng(seed)
    t = tline(n)
    m = np.ones(n)
    for _ in range(k):
        f = rng.uniform(lo, hi)
        m += (depth / k) * np.sin(2 * np.pi * f * t + rng.random() * 6.283)
    return m


def ring(x, freqs, q=14.0, decay=None):
    """Metal, made of noise.

    The old file built metal from clusters of sine waves, which is a chime. Real
    struck hardware inside a noisy event reads as noise squeezed through a few
    sharp resonances - so that is what this is: the same air, resonated. It has
    the metallic colour and none of the pitch.
    """
    n = len(x)
    out = np.zeros(n)
    for i, f in enumerate(freqs):
        if f > SR * 0.45:
            continue
        band = svf(x, f, q=q, mode='bp')
        if decay is not None:
            band = band * np.exp(-tline(n) / (decay / (1 + i * 0.35)))
        out += band / (1 + i * 0.5)
    return out / (np.max(np.abs(out)) + 1e-12)


def ratchet(n, rate0, rate1, duty=0.5, curve=1.0):
    """A spool gate. Applied to NOISE, never to a tone - it is the mechanism you
    hear turning, and gating noise keeps it mechanical instead of musical."""
    r = np.linspace(0.0, 1.0, n) ** curve
    rate = rate0 + (rate1 - rate0) * r
    return (np.mod(np.cumsum(rate) / SR, 1.0) < duty).astype(float)


def drive(x, amount):
    return np.tanh(x * amount) / np.tanh(amount)


def place(dest, src, at):
    i = nsamp(at)
    if i >= len(dest):
        return dest
    k = min(len(src), len(dest) - i)
    dest[i:i + k] += src[:k]
    return dest


def fade_edges(x, head=0.0008, tail=0.030):
    h, t = nsamp(head), nsamp(tail)
    if 0 < h < len(x):
        x[:h] *= np.linspace(0.0, 1.0, h)
    if 0 < t < len(x):
        x[-t:] *= np.linspace(1.0, 0.0, t) ** 1.5
    return x


def peak_db(stereo, db):
    p = np.max(np.abs(stereo))
    return stereo * (10 ** (db / 20.0) / (p + 1e-12))


def render(builder, dur, seed):
    n = nsamp(dur)
    return np.stack([builder(n, ch, seed) for ch in (0, 1)], axis=1)


def write_wav(path, stereo):
    pcm = (np.clip(stereo, -1.0, 1.0) * 32767.0).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- the grammar
#
# Three phrases, and nearly every verb below is a combination of them. Keeping
# them shared is what makes seventeen sounds read as one set of hardware.


def burst(n, ch, seed, attack, decay, tilt=0.0, bump=None, turb=0.28, hold=0.0, sat=1.5):
    """A valve opening: air, a rounded rise, a long tail, turbulence throughout."""
    a = air(n, ch, seed, tilt=tilt, bump=bump)
    a = drive(a, sat)
    return a * gas_env(n, attack, decay, hold=hold) * turbulence(n, seed * 13 + ch, turb)


def edge(n, ch, seed, decay=0.006, hp=1200.0, tilt=0.6):
    """The fast front. Small, broadband, and NOT the body of the sound - it is
    only there so the press feels connected while the gas takes its 27 ms.

    Deliberately held down (the 0.6 below) and only gently high-passed. Louder or
    brighter and it stops being a front and becomes a click on top of the gas,
    which is audible as two separate sounds rather than one event starting.
    """
    a = biquad(air(n, ch, seed, tilt=tilt), 'highpass', hp)
    return 0.6 * a * tick_env(n, 0.0004, decay)


def hardware(n, ch, seed, freqs, decay=0.05, q=9.0):
    """Latches, buckles, the anchor, the spool - metal excited by the same air.

    q is the dial between "metal" and "whistle" and it wants to stay low. At 15+
    each resonance is narrow enough to read as a pitch, which piles the energy
    into one band and brings back exactly the tonal quality this set exists to
    avoid; around 9 it is coloured but still plainly noise.
    """
    return 0.72 * ring(air(n, ch, seed, tilt=1.0), freqs, q=q, decay=decay)


# ------------------------------------------------------------------- builders


def b_jump(n, ch, s):
    """A short kick of gas off the ground. The most-fired verb, so it is the
    smallest: one chuff, a little hardware, and out."""
    out = np.zeros(n)
    out += 0.30 * edge(n, ch, s, 0.005)
    out += 1.00 * burst(n, ch, s, 0.018, 0.20, tilt=0.3, turb=0.30)
    out += 0.16 * hardware(n, ch, s + 2, [1400, 2600, 4100], 0.035)
    # A little weight, made of low noise rather than a sine - a sine here is a
    # kick drum, and the gear does not have one.
    out += 0.26 * biquad(air(n, ch, s + 5), 'lowpass', 220, 4) * gas_env(n, 0.010, 0.10)
    return fade_edges(out * 0.85)


def b_double_jump(n, ch, s):
    """The air jump spends gas, so it is simply MORE gas: longer, harder, and a
    touch brighter than the ground jump. Same hardware, opened further."""
    out = np.zeros(n)
    out += 0.34 * edge(n, ch, s, 0.006)
    out += 0.42 * hardware(n, ch, s + 1, [1900, 3400], 0.025, q=16)     # the valve
    out += 1.00 * burst(n, ch, s, 0.022, 0.30, tilt=0.5, turb=0.34, sat=1.9)
    out += 0.20 * biquad(air(n, ch, s + 5), 'lowpass', 260, 4) * gas_env(n, 0.014, 0.12)
    return fade_edges(out * 0.9)


def b_wall_jump(n, ch, s):
    """Boot into the wall, then gas off it. The contact is broadband noise, not a
    thud - a body hitting stone in this spectrum is a crack, not a drum."""
    out = np.zeros(n)
    out += 0.60 * biquad(air(n, ch, s, tilt=0.8), 'highpass', 500) * tick_env(n, 0.0008, 0.035)
    out += 0.34 * biquad(air(n, ch, s + 7), 'lowpass', 300, 4) * gas_env(n, 0.006, 0.07)
    out += 0.24 * hardware(n, ch, s + 2, [1250, 2400, 3900], 0.05)
    m = n - nsamp(0.030)
    if m > 0:
        place(out, 0.95 * burst(m, ch, s, 0.020, 0.26, tilt=0.4, turb=0.32), 0.030)
    return fade_edges(out * 0.88)


def b_dash(n, ch, s):
    """The air dash: one long hard release, held open then let go.

    The `hold` is what makes it a dash rather than a puff - the valve stays open
    for 60 ms at full before the tail starts, which is the sound of gas actually
    pushing something. No sweep anywhere in here; the colour sits still and the
    ENVELOPE does all the movement.
    """
    out = np.zeros(n)
    out += 0.34 * edge(n, ch, s, 0.006)
    out += 1.00 * burst(n, ch, s, 0.016, 0.34, tilt=0.4, hold=0.060, turb=0.34, sat=2.1)
    # Second nozzle, slightly late and slightly darker - two hips, not one.
    m = n - nsamp(0.022)
    if m > 0:
        place(out, 0.52 * burst(m, ch, s + 4, 0.020, 0.28, tilt=-0.4, turb=0.30), 0.022)
    out += 0.20 * hardware(n, ch, s + 2, [1600, 3100, 5200], 0.04)
    out += 0.22 * biquad(air(n, ch, s + 5), 'lowpass', 240, 4) * gas_env(n, 0.012, 0.11)
    return fade_edges(out * 0.92)


def b_super_dash(n, ch, s):
    """Half a tank, and the only verb that gets a wind-up.

    Structure is valve -> swell -> full release -> long tail, which is the shape
    of a pressure vessel actually dumping. It is the longest file in the set at
    1.5 s and it earns it: this is the move you commit to.
    """
    out = np.zeros(n)
    out += 0.30 * edge(n, ch, s, 0.007)
    out += 0.40 * hardware(n, ch, s + 1, [2100, 3600], 0.03, q=17)
    # Pressure building - audible from the first frame, so the press connects.
    pre = nsamp(0.075)
    out[:pre] += 0.34 * air(pre, ch, s + 2, tilt=-1.0) * (np.linspace(0, 1, pre) ** 2.2)
    m = n - pre
    if m > 0:
        lay = 1.00 * burst(m, ch, s, 0.020, 0.62, tilt=0.5, hold=0.110, turb=0.32, sat=2.6)
        lay += 0.34 * biquad(air(m, ch, s + 5), 'lowpass', 200, 4) * gas_env(m, 0.016, 0.30)
        # The spool spinning up under it, gating noise rather than a tone.
        lay += 0.13 * air(m, ch, s + 9, tilt=1.0) * ratchet(m, 40, 150, 0.45) * gas_env(m, 0.03, 0.34)
        place(out, lay, 0.075)
    return fade_edges(out * 0.95)


def b_slide(n, ch, s):
    """Friction, not gas. The one verb with no valve in it: broadband contact
    noise with a slow wobble, sitting a little darker than the rest of the set so
    it stays out of the way of everything that cancels into it."""
    out = np.zeros(n)
    out += 0.45 * biquad(air(n, ch, s, tilt=1.0), 'highpass', 700) * tick_env(n, 0.001, 0.05)
    body = air(n, ch, s + 4, tilt=-0.9, bump=(900, 3.0, 1.3))
    out += 1.00 * body * gas_env(n, 0.030, 0.42, hold=0.10) * turbulence(n, s + 11, 0.42, 4, 26)
    out += 0.30 * biquad(air(n, ch, s + 8), 'lowpass', 300, 4) * gas_env(n, 0.020, 0.34)
    out += 0.10 * hardware(n, ch, s + 2, [1100, 2200], 0.09)
    return fade_edges(out * 0.82)


def b_bhop(n, ch, s):
    """The chain tick. The smallest thing in the set - it fires on every clean
    landing in a streak, so it is a confirmation and not an event."""
    out = np.zeros(n)
    out += 0.55 * edge(n, ch, s, 0.005, hp=2200)
    out += 0.85 * burst(n, ch, s, 0.008, 0.07, tilt=1.2, turb=0.22)
    out += 0.25 * hardware(n, ch, s + 2, [3000, 5200], 0.02, q=17)
    return fade_edges(out * 0.7, tail=0.02)


def b_slam(n, ch, s):
    """The DIVE, not the landing.

    A slam lasts as long as the drop, and a drop is however tall the roof was, so
    an impact baked in here would land early off a ledge and late off a tower.
    `land` covers the arrival and the two were mixed to be heard back to back.
    The gas fires downward and then SWELLS as the fall builds.
    """
    out = np.zeros(n)
    out += 0.32 * edge(n, ch, s, 0.006)
    out += 1.00 * burst(n, ch, s, 0.020, 0.50, tilt=0.2, hold=0.080, turb=0.34, sat=2.3)
    out += 0.28 * biquad(air(n, ch, s + 5), 'lowpass', 210, 4) * gas_env(n, 0.014, 0.24)
    # Rising wind under it: the only thing in the set that grows, and it grows in
    # LEVEL at a fixed colour - which is what falling sounds like.
    t = tline(n)
    swell = air(n, ch, s + 6, tilt=0.8) * np.clip(t / 0.42, 0, 1) ** 1.6 * np.exp(-t / 0.70)
    out += 0.44 * swell * turbulence(n, s + 12, 0.3, 3, 18)
    out += 0.16 * hardware(n, ch, s + 2, [1500, 2900], 0.05)
    return fade_edges(out * 0.9)


def b_land(n, ch, s):
    """Arrival. Broadband crack, harness rattle, and a short vent of gas as the
    gear takes the shock - NOT a bass drum, which is what it was before."""
    out = np.zeros(n)
    out += 0.90 * biquad(air(n, ch, s, tilt=0.6), 'highpass', 420) * tick_env(n, 0.0010, 0.045)
    out += 0.50 * biquad(air(n, ch, s + 5), 'lowpass', 260, 4) * gas_env(n, 0.005, 0.085)
    out += 0.40 * burst(n, ch, s + 3, 0.012, 0.13, tilt=0.3, turb=0.26)
    # The harness settling, just behind the hit - kit strapped to a body.
    m = n - nsamp(0.035)
    if m > 0:
        place(out, 0.34 * hardware(m, ch, s + 2, [1150, 2100, 3600, 5400], 0.075), 0.035)
    return fade_edges(out * 0.92)


def b_vault(n, ch, s):
    """Hands and feet over a ledge. Contact and hardware, almost no gas - leaving
    the valve out is what stops this being another jump."""
    out = np.zeros(n)
    out += 0.85 * air(n, ch, s, tilt=0.5, bump=(1500, 2.5, 1.5)) \
        * gas_env(n, 0.012, 0.16) * turbulence(n, s + 9, 0.5, 8, 40)
    out += 0.40 * biquad(air(n, ch, s + 7), 'lowpass', 320, 4) * tick_env(n, 0.0015, 0.05)
    m = n - nsamp(0.050)
    if m > 0:
        place(out, 0.46 * hardware(m, ch, s + 2, [1050, 2000, 3300], 0.055), 0.050)
    out += 0.18 * burst(n, ch, s + 3, 0.014, 0.09, tilt=0.6, turb=0.24)
    return fade_edges(out * 0.85)


def b_hook_fire(n, ch, s):
    """The signature: piston, gas, spool - in that order, and the order is the
    sound. Simultaneous it is a hiss; staggered it is a harpoon leaving a tube.

    The wire used to be a falling sine here. That was the ray gun. It is a gated
    band of air now: the same mechanism, made of the same material as everything
    else, and it reads as something spinning instead of something firing a laser.
    """
    out = np.zeros(n)
    # 1. Piston, on the frame.
    out += 0.75 * edge(n, ch, s, 0.004, hp=2000, tilt=1.2)
    out += 0.52 * hardware(n, ch, s + 1, [2400, 4300, 6800], 0.022, q=18)
    # 2. Gas.
    m2 = n - nsamp(0.008)
    place(out, 1.00 * burst(m2, ch, s, 0.014, 0.34, tilt=0.6, hold=0.045, turb=0.34, sat=2.3), 0.008)
    # 3. Wire paying out: a band of air, gated by a spool that SLOWS as the line
    #    runs. Rate falls, colour does not.
    m3 = n - nsamp(0.016)
    if m3 > 0:
        wire = air(m3, ch, s + 7, tilt=0.9, bump=(3200, 3.5, 1.1))
        gate = 0.45 + 0.55 * ratchet(m3, 210, 55, 0.5, curve=0.75)
        place(out, 0.40 * wire * gate * gas_env(m3, 0.010, 0.40), 0.016)
    out += 0.20 * biquad(air(n, ch, s + 5), 'lowpass', 230, 4) * gas_env(n, 0.008, 0.09)
    return fade_edges(out * 0.93)


def b_hook_hit(n, ch, s):
    """The anchor biting. Fires on the SAME frame as hook_fire - the raycast
    resolves on the press - so the pair were mixed together: this one is hardware
    and debris, and it leaves the wide gas band to the launch."""
    out = np.zeros(n)
    out += 0.65 * edge(n, ch, s, 0.005, hp=1800, tilt=1.0)
    # The BODY is broadband debris with a real tail, not the ring. Two rewrites
    # went into that order. With the resonators on top this was 66% of its energy
    # in one band and its centroid fell 0.53x, because every mode of a struck bar
    # dies faster the higher it is - so the bright half evaporated and left a low
    # hum, which is the "pew" the whole set is built to avoid. Air lasting longer
    # than the steel is what holds the colour still.
    out += 1.00 * air(n, ch, s + 3, tilt=0.6) * gas_env(n, 0.0035, 0.17, curve=1.0)
    # Steel, spread over three octaves and mixed UNDER the debris.
    out += 0.55 * hardware(n, ch, s + 1, [1500, 2600, 4400, 7600], 0.05, q=6.0)
    out += 0.50 * biquad(air(n, ch, s + 4, tilt=0.8), 'highpass', 2000) * tick_env(n, 0.0008, 0.028)
    # The low thud is kept SHORTER than the highs on purpose - a long one outlives
    # them and drags the centroid down on its own.
    out += 0.34 * biquad(air(n, ch, s + 5), 'lowpass', 340, 4) * tick_env(n, 0.0015, 0.030)
    return fade_edges(out * 0.9)


def b_hook_release(n, ch, s):
    """Detach and retract: the mirror of the fire. The spool ACCELERATES here
    instead of slowing, and it ends on the hook seating - kept smaller than the
    detach itself, so the file does not peak 150 ms after the input."""
    out = np.zeros(n)
    out += 0.80 * edge(n, ch, s, 0.004, hp=2200, tilt=1.2)
    out += 0.50 * hardware(n, ch, s + 1, [2000, 3700], 0.020, q=17)
    m = n - nsamp(0.012)
    if m > 0:
        wire = air(m, ch, s + 4, tilt=0.8, bump=(2800, 3.0, 1.2))
        gate = 0.42 + 0.58 * ratchet(m, 70, 260, 0.45, curve=1.3)
        place(out, 0.62 * wire * gate * gas_env(m, 0.014, 0.30), 0.012)
    seat = 0.19
    k = n - nsamp(seat)
    if k > 0:
        place(out, 0.34 * hardware(k, ch, s + 6, [1500, 2700, 4400], 0.04, q=15), seat)
    return fade_edges(out * 0.85)


def b_wing_deploy(n, ch, s):
    """The suit catching air. A fabric snap is broadband noise with a very fast
    front and no pitch at all, then the wing loads up and the bed takes over."""
    out = np.zeros(n)
    out += 0.70 * edge(n, ch, s, 0.008, hp=900, tilt=0.8)
    out += 0.40 * hardware(n, ch, s + 1, [1800, 3200], 0.025, q=16)
    # The snap: hard front, quick tail, wide.
    out += 0.95 * air(n, ch, s + 3, tilt=0.7) * tick_env(n, 0.0018, 0.055) * turbulence(n, s + 9, 0.4, 10, 60)
    # The wing loading - a swell that hands off to wingsuit_loop.
    t = tline(n)
    out += 0.55 * air(n, ch, s + 6, tilt=-0.3) * np.clip(t / 0.10, 0, 1) ** 1.4 * np.exp(-t / 0.28) \
        * turbulence(n, s + 12, 0.28, 5, 22)
    out += 0.24 * biquad(air(n, ch, s + 5), 'lowpass', 250, 4) * gas_env(n, 0.020, 0.13)
    return fade_edges(out * 0.88)


def b_thruster_loop(n, ch, s):
    """Held jets. A BED: it sits under every one-shot and must never compete with
    one, so it carries no transient at all and is mixed well down.

    Periodic by construction - air() is built in the frequency domain, and every
    modulator is a sine whose period divides the buffer exactly - so the last
    sample runs into the first with no seam and no crossfade.
    """
    t = tline(n)
    dur = n / SR

    def cyc(hz):
        return max(1, round(hz * dur)) / dur

    out = 1.00 * air(n, ch, s, tilt=-0.3)
    out += 0.34 * circ_biquad(air(n, ch, s + 3, tilt=-2.0), 'lowpass', 320, 4)
    turb = (1.0
            + 0.20 * np.sin(2 * np.pi * cyc(7.0) * t)
            + 0.13 * np.sin(2 * np.pi * cyc(11.0) * t + 2.1)
            + 0.09 * np.sin(2 * np.pi * cyc(19.0) * t + 4.4)
            + 0.06 * np.sin(2 * np.pi * cyc(31.0) * t + 1.2))
    out *= turb
    out += 0.12 * circ_svf(air(n, ch, s + 5), 2100, q=7.0)      # nozzle resonance
    out = drive(out * 0.95, 1.6)
    return out


def b_wingsuit_loop(n, ch, s):
    """Held flight. Brighter than the jets and with no pressure body, because the
    two are heard together whenever the jets are lit inside the suit - the jets
    keep the bottom, the suit takes the top and the flutter."""
    t = tline(n)
    dur = n / SR

    def cyc(hz):
        return max(1, round(hz * dur)) / dur

    out = 1.00 * air(n, ch, s, tilt=1.1, lo=150.0)
    flut = (1.0
            + 0.22 * np.sin(2 * np.pi * cyc(11.0) * t)
            + 0.14 * np.sin(2 * np.pi * cyc(23.0) * t + 1.3)
            + 0.08 * np.sin(2 * np.pi * cyc(37.0) * t + 3.0))
    out *= flut
    out += 0.18 * circ_biquad(air(n, ch, s + 2, tilt=-1.5), 'bandpass', [220, 1100])
    return out


def b_reel_loop(n, ch, s):
    """Reeling in on the rope: wire under tension being wound. The spool gate is
    the same one the hooks use, held at a constant rate that fits the buffer
    whole so the loop stays seamless."""
    t = tline(n)
    dur = n / SR

    def cyc(hz):
        return max(1, round(hz * dur)) / dur

    rate = cyc(42)
    spool = 0.55 + 0.45 * (np.mod(rate * t, 1.0) < 0.5)
    out = 0.85 * air(n, ch, s, tilt=0.5, bump=(2600, 3.0, 1.2)) * spool
    out += 0.60 * air(n, ch, s + 2, tilt=0.2, lo=120.0)     # the haul wind
    out += 0.22 * circ_svf(air(n, ch, s + 4), 3100, q=9.0) * spool
    return out


# ------------------------------------------------------------------- the table
#
# name, builder, seconds, peak dBFS, loops?, the event it fires on
#
# Durations follow the reference (1337 ms mean across 17 real events); the old
# set averaged 450 ms, which is most of why it sounded clipped and synthetic.
#
# The dB column is a HIERARCHY, not a normalisation: all of these can be live at
# once, so the verbs that END a sequence sit on top, the reflexes sit under them,
# the chain tick is nearly subliminal because it fires constantly, and the held
# beds sit well down because they play under everything for as long as they last.

SOUNDS = [
    ('land',          b_land,          0.75, -2.0,  False, 'touchdown from any airborne state'),
    ('super_dash',    b_super_dash,    1.50, -2.0,  False, 'Z - the committed launch'),
    ('slam',          b_slam,          1.25, -3.0,  False, 'C in the air - the dive, not the impact'),
    ('hook_fire',     b_hook_fire,     1.05, -3.5,  False, 'middle mouse - cable launch, hit or miss'),
    ('dash',          b_dash,          0.95, -4.0,  False, 'Shift - air or ground dash'),
    ('hook_hit',      b_hook_hit,      0.55, -4.5,  False, 'anchor bites; layers over hook_fire'),
    ('wing_deploy',   b_wing_deploy,   0.90, -4.5,  False, 'X - suit opens, starts wingsuit_loop'),
    ('wall_jump',     b_wall_jump,     0.80, -5.0,  False, 'kick off a wallrun'),
    ('double_jump',   b_double_jump,   0.80, -5.5,  False, 'air jump - the gas-assisted one'),
    ('vault',         b_vault,         0.65, -6.0,  False, 'ledge mantle'),
    ('hook_release',  b_hook_release,  0.85, -6.0,  False, 'cable detaches and retracts'),
    ('slide',         b_slide,         1.15, -6.0,  False, 'Ctrl - entry scuff and grind'),
    ('jump',          b_jump,          0.60, -7.0,  False, 'ground jump'),
    ('bhop',          b_bhop,          0.30, -11.0, False, 'clean rehop inside the bhop window'),
    ('thruster_loop', b_thruster_loop, 2.50, -13.0, True,  'held Space with no jumps left - jets'),
    ('wingsuit_loop', b_wingsuit_loop, 2.50, -14.0, True,  'while in the wingsuit state'),
    ('reel_loop',     b_reel_loop,     2.50, -15.0, True,  'W held on a live cable'),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for i, (name, fn, dur, db, loops, note) in enumerate(SOUNDS):
        stereo = peak_db(render(fn, dur, seed=i + 1), db)
        # Loops get no edge fade - a fade IS a seam. They are periodic instead.
        if not loops:
            for c in (0, 1):
                stereo[:, c] = fade_edges(stereo[:, c])
        write_wav(os.path.join(OUT, name + '.wav'), stereo)
        rms = float(np.sqrt(np.mean(stereo ** 2)))
        manifest.append({
            'name': name, 'file': name + '.wav', 'seconds': round(dur, 3),
            'loop': loops, 'peakDb': db, 'rmsDb': round(20 * np.log10(rms + 1e-12), 1),
            'event': note,
        })
        print('%-15s %5.2fs  peak %6.1f dB  rms %6.1f dB  %s'
              % (name, dur, db, 20 * np.log10(rms + 1e-12), 'loop' if loops else 'one-shot'))

    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({
            'sampleRate': SR, 'format': 'wav / 16-bit / stereo',
            'note': 'Synthesised originals - no sampled source material. Tone colour is '
                    'matched to the long-term average spectrum of real ODM gear footage. '
                    'Regenerate with: python tools/make-odm-sounds.py',
            'sounds': manifest,
        }, f, indent=2)
    print('\n%d files -> %s' % (len(SOUNDS), os.path.normpath(OUT)))


if __name__ == '__main__':
    main()
