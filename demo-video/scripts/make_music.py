#!/usr/bin/env python3
"""OURANOS demo cue: an original 28.000 s instrumental, synthesized from scratch.

Every sound here is generated in this file from sine/additive oscillators, FM,
or filtered white noise. No samples, no downloaded or reference audio.

Run:  /path/to/python -I scripts/make_music.py
Out:  assets/music/ouranos-music.wav  (48 kHz, 24-bit PCM, stereo, 28.000 s)

Grid: 90 BPM, so one beat is exactly 32000 samples at 48 kHz and every cue is
on a beat: beat 3 = 2.000 s (reveal), 14 = 9.333 s (groove), 20 = 13.333 s
(hats in), 32 = 21.333 s (lift), 39 = 26.000 s (final hit).
"""
import os
import wave

import numpy as np
from scipy import signal as sg
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d

SR = 48000
N = 28 * SR                     # exactly 1,344,000 frames
SPB = 32000                     # samples per beat at 90 BPM
BEAT = SPB / SR
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "music", "ouranos-music.wav"))
rng = np.random.default_rng(902026)
T = np.arange(N) / SR
B_REVEAL, B_DROP, B_HATS, B_LIFT, B_END = 3, 14, 20, 32, 39  # cue beats


def smp(beat): return int(round(beat * SPB))
def sec(beat): return beat * BEAT
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def sos(*a, **k): return sg.butter(*a, fs=SR, output="sos", **k)
def db(x): return 10 ** (x / 20)


def place(buf, x, start, gain=1.0):
    end = min(len(buf), start + len(x))
    if start < 0 or end <= start:
        return
    seg = x[:end - start] * gain
    if buf.ndim == 2 and seg.ndim == 1:
        seg = seg[:, None]
    buf[start:end] += seg


def fade_ends(x, a_ms=0.0, r_ms=3.0):
    n = len(x)
    e = np.ones(n)
    if a_ms:
        m = max(2, int(a_ms * SR / 1000))
        e[:m] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, m))
    m = max(2, int(r_ms * SR / 1000))
    e[-m:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, m))
    return x * e


def envelope(n_on, atk, rel, dec=None, sus=1.0):
    """Raised-cosine attack, optional exp decay toward sus, raised-cosine release to 0."""
    n = n_on + max(2, int(rel * SR))
    t = np.arange(n) / SR
    e = 0.5 - 0.5 * np.cos(np.pi * np.clip(t / max(atk, 1e-4), 0, 1))
    if dec:
        e *= sus + (1 - sus) * np.exp(-t / dec)
    e *= 0.5 + 0.5 * np.cos(np.pi * np.clip((t - n_on / SR) / rel, 0, 1))
    return e


def automation(points, log=False):
    ts, vs = np.array(points, dtype=float).T
    if log:
        return np.exp(np.interp(T, ts, np.log(vs)))
    return np.interp(T, ts, vs)


def drift(n, cents=2.0, rate=3.0):
    k = int(n / SR * rate) + 4
    x = np.interp(np.arange(n) / SR * rate, np.arange(k), rng.standard_normal(k) * cents)
    return uniform_filter1d(x, int(SR / rate))


# ------------------------------------------------------------------ voices
def pad_note(midi, i0, i1, atk, rel, fc, out, dec=None, sus=1.0):
    """Additive detuned saw stack (3 voices per side) through a 4-pole lowpass at fc[t]."""
    f0 = mtof(midi)
    env = envelope(i1 - i0, atk, rel, dec, sus)
    n = min(len(env), N - i0)
    env = env[:n]
    r8 = (f0 / fc[i0:i0 + n]) ** 8
    phases = []
    for side, dets in ((0, (-11, -2, 7)), (1, (-7, 3, 11))):
        for d in dets:
            f = f0 * 2 ** ((d + drift(n)) / 1200)
            phases.append((side, 2 * np.pi * np.cumsum(f) / SR + rng.uniform(0, 2 * np.pi)))
    acc = [np.zeros(n), np.zeros(n)]
    for k in range(1, int(7000 / f0) + 1):
        amp = k ** -1.25 / np.sqrt(1 + k ** 8 * r8)
        if amp.max() < 3e-4:
            break
        for side, ph in phases:
            acc[side] += amp * np.sin(k * ph + rng.uniform(0, 2 * np.pi))
    place(out, np.stack(acc, axis=1) * (env / 3)[:, None], i0)


def pluck(midi, vel, fc, dur=1.3):
    """Additive plucked string: upper partials decay faster, soft lowpass at fc."""
    f0, n = mtof(midi), int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, int(min(6000, 3 * fc) / f0) + 1):
        a = k ** -1.15 / np.sqrt(1 + (k * f0 / fc) ** 4)
        tau = 0.9 / (1 + 0.22 * k ** 1.4)
        y += a * np.exp(-t / tau) * np.sin(2 * np.pi * k * f0 * (1 + 4e-4 * k) * t + rng.uniform(0, 6.28))
    y *= np.clip(t / 0.0015, 0, 1)
    return vel * fade_ends(y, 0, 50)


def epiano(midi, dur, vel):
    """Two-operator FM electric piano (ratio 1:1), index decays for a soft bell attack."""
    f = mtof(midi)
    env = envelope(int(dur * SR), 0.004, 0.3, dec=1.4, sus=0.0)
    t = np.arange(len(env)) / SR
    idx = (0.5 + 1.4 * vel) * np.exp(-t / 0.35) + 0.2
    w1, w2 = 2 * np.pi * f * t, 2 * np.pi * f * 1.0021 * t
    y = np.sin(w1 + idx * np.sin(w1)) + 0.5 * np.sin(w2 + 0.8 * idx * np.sin(w2 + 1.1))
    y += 0.06 * vel * np.sin(4 * w1) * np.exp(-t / 0.06)
    return vel * y * env / 1.5


def lead(midi, dur, vel):
    """Soft rounded lead for the counter-melody: slow attack, delayed vibrato."""
    f = mtof(midi)
    env = envelope(int(dur * SR), 0.14, 0.45)
    t = np.arange(len(env)) / SR
    cents = 6 * np.clip((t - 0.3) / 0.5, 0, 1) * np.sin(2 * np.pi * 4.8 * t)
    ph = 2 * np.pi * np.cumsum(f * 2 ** (cents / 1200)) / SR
    y = np.sin(ph) + 0.18 * np.sin(2 * ph) - 0.08 * np.sin(3 * ph) + 0.03 * np.sin(4 * ph)
    return vel * y * env


def bass(midi, dur, vel, dec=0.9, sus=0.7, rel=0.06):
    """Round sub bass: sine + low harmonics through gentle tanh saturation."""
    f = mtof(midi)
    env = envelope(int(dur * SR), 0.008, rel, dec=dec, sus=sus)
    ph = 2 * np.pi * f * np.arange(len(env)) / SR
    y = np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    return vel * np.tanh(1.2 * y) / np.tanh(1.2) * env


KICK_CLICK = sos(2, 1500, btype="low")


def kick(vel):
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(43 + 87 * np.exp(-t / 0.032)) / SR
    amp = np.exp(-t / 0.20) * np.clip(t / 0.0012, 0, 1)
    y = np.tanh(1.6 * np.sin(ph) * amp) / np.tanh(1.6)
    y += 0.06 * sg.sosfilt(KICK_CLICK, rng.standard_normal(n)) * np.exp(-t / 0.003) * np.clip(t / 5e-4, 0, 1)
    return vel * fade_ends(y, 0, 30)


HAT_BP = sos(2, [1200, 3200], btype="bandpass")


def hat(vel):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    x = sg.sosfilt(HAT_BP, rng.standard_normal(n))
    return vel * fade_ends(x * np.clip(t / 0.002, 0, 1) * np.exp(-t / 0.025), 0, 10)


THUMP_LP = sos(2, 220, btype="low")


def boom(f_hi, f_lo, tau_f, tau_a, length):
    """Low impact: sine pitch drop landing on f_lo, plus a short lowpassed noise thump."""
    n = int(length * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f_lo + (f_hi - f_lo) * np.exp(-t / tau_f)) / SR
    amp = np.clip(t / 0.003, 0, 1) * np.exp(-t / tau_a)
    y = np.tanh(1.4 * np.sin(ph) * amp) / np.tanh(1.4)
    th = sg.sosfilt(THUMP_LP, rng.standard_normal(n))
    y += 0.5 * th / np.abs(th).max() * np.exp(-t / 0.05) * np.clip(t / 0.002, 0, 1)
    return fade_ends(y, 0, 50) / np.abs(y).max()


def noise_riser(length, f_lo, f_hi, bw=0.7, db_from=-32.0):
    """White noise through a band that sweeps f_lo -> f_hi (STFT mask), crescendo to the end."""
    n = int(round(length * SR))
    f, tt, Z = sg.stft(rng.standard_normal(n), SR, nperseg=2048, noverlap=1536)
    c = f_lo * (f_hi / f_lo) ** np.clip(tt / length, 0, 1)
    lf = np.log2(np.maximum(f, 1.0))[:, None]
    _, y = sg.istft(Z * np.exp(-0.5 * ((lf - np.log2(c)[None, :]) / bw) ** 2), SR, nperseg=2048, noverlap=1536)
    y = y[:n] * db(db_from * (1 - np.arange(n) / n) ** 1.6)
    y = fade_ends(y, 60, 3)
    return y / np.abs(y).max()


def reverse_swell(notes, length, ir):
    """Struck chord + its reverb, reversed so it swells up and lands on the cue."""
    n = int(round(length * SR))
    hit = sum(pluck(m, 1.0, 1600, dur=(n + SR) / SR) for m in notes)
    wet = sg.fftconvolve(hit, ir)[:len(hit)]
    y = (0.35 * hit + wet)[:n][::-1].copy()
    y *= np.sin(0.5 * np.pi * np.clip(np.arange(n) / (0.5 * n), 0, 1)) ** 2
    y = fade_ends(y, 0, 2)
    return y / np.abs(y).max()


def make_ir(rt_lo, rt_mid, rt_hi, length=3.5, predelay=0.018):
    """Stereo IR: decorrelated noise, three bands with their own exponential RT60s."""
    n = int(length * SR)
    t = np.arange(n) / SR
    bands = (sos(2, 500, btype="low"), sos(2, [500, 2500], btype="bandpass"), sos(2, 2500, btype="high"))
    out = []
    for _ in range(2):
        w = rng.standard_normal(n)
        ir = sum(g * sg.sosfilt(b, w) * np.exp(-6.9078 * t / rt)
                 for b, rt, g in zip(bands, (rt_lo, rt_mid, rt_hi), (1.0, 0.9, 0.25)))
        ir = sg.sosfilt(sos(4, 3500, btype="low"), ir * (1 - np.exp(-t / 0.012)))
        ir = np.concatenate([np.zeros(int(predelay * SR)), ir])
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(out, axis=1)


# ------------------------------------------------------------------ score
EM_FULL, C_FULL, D_FULL = [40, 47, 52, 55, 59, 66], [36, 43, 52, 55, 59], [38, 45, 54, 57, 64]
EM_MID, C_MID, G_MID, D_MID = [52, 55, 59, 66], [48, 52, 55, 59], [50, 55, 59, 64], [50, 54, 57, 64]
C_LIFT, G_LIFT, D_LIFT = [48, 55, 59, 64, 67], [50, 55, 59, 62, 67], [50, 54, 57, 62, 69]
EM_FINAL = [40, 47, 52, 55, 59, 66, 71]
PAD_CHORDS = [  # (start beat, end beat, notes, attack s, release s)
    (0, 7, EM_FULL, 0.05, 0.9), (7, 11, C_FULL, 0.5, 0.9), (11, 14, D_FULL, 0.5, 0.2),
    (14, 18, EM_MID, 0.06, 0.6), (18, 22, C_MID, 0.4, 0.6), (22, 26, G_MID, 0.4, 0.6),
    (26, 30, D_MID, 0.4, 0.6), (30, 32, EM_MID, 0.4, 0.25),
    (32, 34, C_LIFT, 0.08, 0.5), (34, 36, G_LIFT, 0.35, 0.5), (36, 39, D_LIFT, 0.35, 0.1),
]
CHORDS = [(0, "Em"), (7, "C"), (11, "D"), (14, "Em"), (18, "C"), (22, "G"), (26, "D"),
          (30, "Em"), (32, "C"), (34, "G"), (36, "D")]
ARP_TONES = {"Em": [52, 59, 64, 66, 67, 71], "C": [48, 55, 59, 64, 67, 71],
             "G": [50, 55, 59, 62, 64, 67], "D": [50, 57, 62, 64, 66, 69]}
ARP_PATTERN = [0, 2, 4, 2, 5, 2, 4, 2]
MOTIF = [(14, 1.5, 71), (15.5, .5, 69), (16, 1, 67), (17, 1, 64),
         (18, 1.5, 67), (19.5, .5, 66), (20, 2, 64),
         (22, 1.5, 74), (23.5, .5, 71), (24, 1, 67), (25, 1, 69),
         (26, 1.5, 66), (27.5, .5, 64), (28, 1, 62), (29, 1, 66), (30, 2, 64),
         (32, 1.5, 71), (33.5, .5, 69), (34, 1, 67), (35, 1, 71),
         (36, 1.5, 69), (37.5, .5, 64), (38, .85, 66)]
COUNTER = [(32, 2.0, 76), (34, 2.0, 74), (36, 2.9, 78)]
BASS = [(14, 1.4, 40), (15.5, .45, 40), (16, 1.4, 40), (17.5, .45, 35),
        (18, 1.4, 36), (19.5, .45, 36), (20, 1.4, 36), (21.5, .45, 43),
        (22, 1.4, 43), (23.5, .45, 43), (24, 1.4, 43), (25.5, .45, 38),
        (26, 1.4, 38), (27.5, .45, 38), (28, 1.4, 38), (29.5, .45, 45),
        (30, 1.4, 40), (31.5, .45, 35), (32, 1.4, 36), (33.5, .45, 43),
        (34, 1.4, 43), (35.5, .45, 38), (36, 1.4, 38), (37.5, .45, 38), (38, .45, 38)]
KICKS = [(b, 1.0 if b == 32 else [1.0, .72, .88, .72][(b - 14) % 4]) for b in range(14, 39)]
KICKS += [(b, 0.38) for b in (17.5, 21.5, 25.5, 29.5, 33.5, 35.5)]
FC_POINTS = [(0, 150), (1.99, 250), (2.0, 260), (2.09, 950), (7.33, 1400), (9.30, 1900),
             (9.55, 1250), (21.32, 1500), (21.9, 2300), (25.99, 2500), (26.04, 2900),
             (27.9, 450), (28.0, 420)]
PAD_GAIN = [(2.0, .55), (2.09, .9), (8.0, .9), (9.30, 1.05), (9.45, .72), (21.30, .72),
            (21.8, .88), (28, .88)]


def rms_db(x, a=0.0, b=28.0):
    seg = x[int(round(a * SR)):int(round(b * SR))]
    return 10 * np.log10(np.mean(seg ** 2) + 1e-20)


def level(x, a, b, target):
    return x * db(target - rms_db(x, a, b))


def duck(depth, tau):
    d = np.zeros(N)
    tt = np.arange(int(5 * tau * SR)) / SR
    shape = np.clip(tt / 0.006, 0, 1) * np.exp(-tt / tau)
    for b, v in KICKS:
        place(d, shape * v, smp(b))
    return 1 - depth * np.clip(d, 0, 1)


def render():
    ir = make_ir(2.6, 2.2, 1.2)
    fc = automation(FC_POINTS, log=True)

    pad = np.zeros((N, 2))
    for b0, b1, notes, atk, rel in PAD_CHORDS:
        for m in notes:
            pad_note(m, smp(b0), smp(b1), atk, rel, fc, pad)
    for m in EM_FINAL:  # the held final chord: blooms, then decays under the tail
        pad_note(m, smp(B_END), smp(B_END) + int(0.9 * SR), 0.03, 1.0, fc, pad, dec=1.0, sus=0.25)
    mid, side = (pad[:, 0] + pad[:, 1]) / 2, (pad[:, 0] - pad[:, 1]) / 2
    side = sg.sosfilt(sos(2, 160, btype="high"), side)  # keep the pad lows mono
    pad = np.stack([mid + side, mid - side], axis=1)
    pad = level(pad, sec(14), sec(32), -23.0)
    g = automation(PAD_GAIN)
    g[T < 2.0] = 0.55 * (T[T < 2.0] / 2.0) ** 2
    pad *= (g * duck(0.22, 0.17))[:, None]

    arp = np.zeros(N)
    for s in range(int((38.5 - 3) * 2)):
        beat = 3 + s / 2
        c0, name = max(c for c in CHORDS if c[0] <= beat)
        step = int(round((beat - c0) * 2)) % 8
        if beat < 14:
            u = (beat - 3) / 11
            vel, bright = 0.5 + 0.4 * u, 700 * (2400 / 700) ** u
        elif beat < 32:
            vel, bright = 0.38, 1300
        else:
            vel, bright = 0.5, 2000
        vel += 0.08 if step % 4 == 0 else 0.0
        dur = min(1.3, sec(B_END - beat))  # damp so nothing rings into the final hit
        place(arp, pluck(ARP_TONES[name][ARP_PATTERN[step]], vel, bright, dur), smp(beat))
    arp = level(arp, sec(3), sec(14), -27.0) * duck(0.22, 0.17)

    keys = np.zeros(N)
    for b, d, m in MOTIF:
        vel = 0.9 if b == int(b) and (b - 14) % 2 == 0 else (0.78 if b == int(b) else 0.66)
        place(keys, epiano(m, sec(d), vel), smp(b))
        if b >= B_LIFT:
            place(keys, epiano(m - 12, sec(d), vel * 0.8), smp(b), 0.35)
    for m in [52, 59, 64, 67, 71, 76]:
        place(keys, epiano(m, 1.5, 0.85), smp(B_END), 0.55)
    keys = level(keys, sec(14), sec(32), -25.0)
    D = smp(0.75)  # dotted-eighth echo, mono
    echo = np.zeros(N)
    for k in range(1, 6):
        echo[k * D:] += 0.38 ** k * keys[:-k * D]
    keys += 0.3 * sg.sosfilt(sos(2, [250, 2200], btype="bandpass"), echo)

    ld = np.zeros(N)
    for b, d, m in COUNTER:
        place(ld, lead(m, sec(d), 0.8), smp(b))
    place(ld, lead(76, 0.9, 0.8), smp(B_END))
    ld = level(ld, sec(32), sec(39), -26.0)

    bs = np.zeros(N)
    for b, d, m in BASS:
        place(bs, bass(m, sec(d), 1.0 if b == int(b) else 0.8), smp(b))
    place(bs, bass(28, 1.2, 1.0, dec=0.7, sus=0.0, rel=0.6), smp(B_END))  # E1 under the hit
    place(bs, bass(40, 1.2, 0.6, dec=0.7, sus=0.0, rel=0.6), smp(B_END))
    bs = sg.sosfilt(sos(2, 420, btype="low"), bs)
    bs = level(bs, sec(14), sec(32), -16.5) * duck(0.3, 0.09)

    kk = np.zeros(N)
    for b, v in KICKS:
        place(kk, kick(v), smp(b))
    kk = level(kk, sec(14), sec(32), -21.0)

    hh = np.zeros(N)
    for b in range(B_HATS, 38):
        place(hh, hat(0.6 if b % 2 == 0 else 0.48), smp(b + 0.5))
        if b >= B_LIFT:
            for off in (0.25, 0.75):
                place(hh, hat(0.22), smp(b + off))
    hh = level(hh, sec(20), sec(32), -43.0)

    fx = np.zeros(N)
    e1 = mtof(28)
    place(fx, boom(2.2 * e1, e1, 0.09, 0.7, 3.0), smp(B_REVEAL), db(-14))
    r = noise_riser(sec(3), 250, 1700)
    place(fx, r, smp(B_DROP) - len(r), db(-20))
    r = reverse_swell([52, 59, 64, 71], sec(2), ir[:, 0])
    place(fx, r, smp(B_DROP) - len(r), db(-17))
    place(fx, boom(90, e1, 0.06, 0.45, 2.0), smp(B_DROP), db(-13))
    r = noise_riser(sec(1), 400, 1600)
    place(fx, r, smp(B_LIFT) - len(r), db(-26))
    r = reverse_swell([55, 59, 64], sec(1), ir[:, 0])
    place(fx, r, smp(B_LIFT) - len(r), db(-22))
    r = reverse_swell([52, 59, 64, 71, 76], sec(1), ir[:, 0])
    place(fx, r, smp(B_END) - len(r), db(-18))
    r = noise_riser(sec(1), 300, 1500)
    place(fx, r, smp(B_END) - len(r), db(-24))
    place(fx, boom(95, e1, 0.1, 0.6, 2.0), smp(B_END), db(-8.5))

    send = automation([(0, 1), (25.99, 1), (26.0, 1.7), (28, 1.7)])
    send *= 0.5 * (pad[:, 0] + pad[:, 1]) / 2 + 0.6 * arp + 0.35 * keys + 0.55 * ld + 0.3 * fx + 0.1 * hh
    send = sg.sosfilt(sos(2, 200, btype="high"), send)
    wet = np.stack([sg.fftconvolve(send, ir[:, c])[:N] for c in range(2)], axis=1) * 0.55

    buses = {"pad": pad, "arp": arp, "keys": keys, "lead": ld, "bass": bs, "kick": kk,
             "hats": hh, "fx": fx, "reverb": wet}
    mix = pad + wet + (arp + keys + ld + bs + kk + hh + fx)[:, None]
    mix = sg.sosfilt(sos(2, 24, btype="high"), mix, axis=0)
    mix = sg.sosfilt(sos(8, 4200, btype="low"), mix, axis=0)  # dark top end, like the reference
    tail = np.where(T > 26.9, np.exp(-(T - 26.9) / 0.42), 1.0)
    m = int(0.15 * SR)
    tail[-m:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, m))  # last sample is exactly 0
    return mix * tail[:, None], buses


# ------------------------------------------------------------------ master
def k_weight(x):
    x = sg.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285],
                   [1.0, -1.69065929318241, 0.73248077421585], x, axis=0)
    return sg.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], x, axis=0)


def lufs(x):
    """ITU-R BS.1770-4 integrated loudness (400 ms blocks, 75% overlap, two gates)."""
    sq = k_weight(x) ** 2
    cs = np.vstack([np.zeros((1, 2)), np.cumsum(sq, axis=0)])
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    st = np.arange(0, len(x) - blk + 1, hop)
    z = (cs[st + blk] - cs[st]) / blk
    lk = -0.691 + 10 * np.log10(z.sum(axis=1) + 1e-20)
    g1 = lk > -70
    rel = -0.691 + 10 * np.log10(z[g1].mean(axis=0).sum()) - 10
    return -0.691 + 10 * np.log10(z[g1 & (lk > rel)].mean(axis=0).sum())


def true_peak(x):
    up = sg.resample_poly(x, 4, 1, axis=0)
    return np.maximum(np.abs(up).max(axis=1).reshape(-1, 4).max(axis=1), np.abs(x).max(axis=1))


def limiter(x, ceiling_db=-1.6, look_ms=3.0, rel_s=0.12):
    """Lookahead true-peak limiter: min-filter gain, 120 ms release, box smoothing."""
    req = np.minimum(1.0, db(ceiling_db) / np.maximum(true_peak(x), 1e-9))
    if req.min() >= 1.0:
        return x, 0.0
    L = int(look_ms * SR / 1000)
    gmin = minimum_filter1d(req, 2 * L + 1, mode="nearest")
    a, cur, g = np.exp(-1 / (rel_s * SR)), 1.0, np.empty(len(gmin))
    for i, v in enumerate(gmin.tolist()):
        cur = v if v < cur else v + (cur - v) * a
        g[i] = cur
    g = uniform_filter1d(g, L + 1, mode="nearest")
    return x * g[:, None], -20 * np.log10(g.min())


def write_wav24(path, x):
    xi = np.clip(np.round(x * 8388607), -8388608, 8388607).astype("<i4")  # 24-bit: no dither needed
    with wave.open(path, "wb") as w:
        w.setnchannels(2), w.setsampwidth(3), w.setframerate(SR)
        w.writeframes(xi.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def read_wav24(path):
    with wave.open(path, "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (2, 3, SR)
        b = np.frombuffer(w.readframes(w.getnframes()), np.uint8).reshape(-1, 3).astype(np.int32)
    v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
    v = np.where(v >= 1 << 23, v - (1 << 24), v)
    return v.reshape(-1, 2) / 8388608.0


def report(x, buses):
    print(f"frames {len(x)}  duration {len(x) / SR:.6f} s  finite {np.isfinite(x).all()}")
    print(f"internal: {lufs(x):.2f} LUFS, true peak {20 * np.log10(true_peak(x).max()):.2f} dBTP")
    for a, b in [(0, 2), (2, 28 / 3), (28 / 3, 64 / 3), (64 / 3, 26), (26, 28), (26, 26.5), (27.7, 27.9)]:
        print(f"RMS {a:6.3f}-{b:6.3f} s: {rms_db(x, a, b):7.2f} dBFS")
    mono = x.mean(axis=1)
    f, _, Z = sg.stft(mono, SR, nperseg=2048, noverlap=1536)  # librosa-style frames
    mag = np.abs(Z)
    e = mag.sum(axis=0)
    cent = (f[:, None] * mag).sum(axis=0)[e > 0] / e[e > 0]
    F = np.abs(np.fft.rfft(mono))
    fw, P = np.fft.rfftfreq(len(mono), 1 / SR), F ** 2
    band = lambda lo, hi: P[(fw >= lo) & (fw < hi)].sum()
    print(f"centroid: frame-mean {cent.mean():.0f} Hz (magnitude, 2048-pt frames), whole-track FFT "
          f"{np.sum(fw * F) / F.sum():.0f} Hz (magnitude), {np.sum(fw * P) / P.sum():.0f} Hz (power)")
    print(f"energy 20-250 Hz / 250-2000 Hz = {band(20, 250) / band(250, 2000):.2f}x; "
          f"above 4 kHz = {100 * band(4000, 24001) / P.sum():.3f}% of total")
    hf = maximum_filter1d(np.abs(sg.sosfilt(sos(4, 9000, btype="high"), mono)), 48)
    i = int(hf.argmax())
    print(f"click check: max >9 kHz envelope {20 * np.log10(hf[i] + 1e-12):.1f} dBFS at {i / SR:.3f} s; "
          f"max 2nd difference {np.abs(np.diff(x, 2, axis=0)).max():.4f}")
    print("cue samples:", {k: smp(b) for k, b in
                           (("reveal", 3), ("groove", 14), ("hats", 20), ("lift", 32), ("final", 39))})
    print("bus RMS 9.33-21.33 s (pre-master):",
          {k: round(rms_db(v, 28 / 3, 64 / 3), 1) for k, v in buses.items()})


def main():
    mix, buses = render()
    gain = 1.0
    for _ in range(6):
        y, gr = limiter(mix * gain)
        loud = lufs(y)
        if abs(loud + 16.0) < 0.03:
            break
        gain *= db(-16.0 - loud)
    print(f"master gain {20 * np.log10(gain):+.2f} dB, limiter max reduction {gr:.2f} dB")
    assert np.isfinite(y).all()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_wav24(OUT, y)
    back = read_wav24(OUT)
    print("wrote", OUT, f"(last frame {back[-1].tolist()})")
    report(back, buses)


if __name__ == "__main__":
    main()
