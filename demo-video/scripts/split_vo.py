"""Cut Sriyan's voiceover take into one file per script line (assets/vo/l1.wav ... l9.wav).

usage: python3 scripts/split_vo.py <take.m4a|wav> [expected_lines=9]
Finds the pauses between lines with ffmpeg silencedetect, keeps the longest speech runs, cleans each
line (high-pass, gentle compression, -16 LUFS-ish) and writes 48 kHz mono WAVs.
"""
import re, subprocess, sys
from pathlib import Path

src, want = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 9
out = Path(__file__).resolve().parents[1] / "assets" / "vo"
out.mkdir(parents=True, exist_ok=True)
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).decode())
for noise, gap in ((-38, 0.5), (-34, 0.45), (-30, 0.4), (-42, 0.6)):
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-af", f"highpass=f=90,silencedetect=n={noise}dB:d={gap}", "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    edges = sorted([(0.0, "end")] + [(s, "start") for s in starts] + [(e, "end") for e in ends] + [(dur, "start")])
    speech, cur = [], None
    for tm, kind in edges:
        if kind == "end": cur = tm
        elif cur is not None:
            if tm - cur > 0.25: speech.append((cur, tm))
            cur = None
    print(f"noise {noise} dB, gap {gap} s: {len(speech)} speech runs")
    if len(speech) == want: break
for i, (a, b) in enumerate(speech[:want], 1):
    a, b = max(0, a - 0.06), min(dur, b + 0.12)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", src, "-ac", "1", "-ar", "48000",
                    "-af", "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-16:TP=-2,afade=t=in:d=0.02,areverse,afade=t=in:d=0.06,areverse",
                    str(out / f"l{i}.wav")], check=True)
    print(f"l{i}: {a:.2f}-{b:.2f} s ({b - a:.2f} s)")
