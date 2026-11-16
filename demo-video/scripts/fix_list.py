"""Rebuild a screencast concat list in timestamp order.

CDP screencast frames can arrive slightly out of order, which leaves negative durations in
list.txt. Timestamps are recovered from the durations, frames are sorted (stable) and
frames that share a timestamp keep only the last one.
usage: python3 fix_list.py <frames_dir>
"""
import os, sys

d = sys.argv[1]
src = os.path.join(d, 'list.txt')
orig = os.path.join(d, 'list.orig.txt')
if not os.path.exists(orig):
    os.rename(src, orig)
names, durs = [], []
for line in open(orig):
    line = line.strip()
    if line.startswith('file '):
        names.append(line[6:-1])
    elif line.startswith('duration '):
        durs.append(float(line.split()[1]))
names = names[:len(durs)]  # drop the repeated last entry
ts, t = [], 0.0
for dur in durs:
    ts.append(t)
    t += dur
end = t
order = sorted(range(len(names)), key=lambda i: (round(ts[i], 6), i))
kept = []
for i in order:
    if kept and abs(ts[kept[-1]] - ts[i]) < 1e-6:
        kept[-1] = i
    else:
        kept.append(i)
out = ['ffconcat version 1.0']
for k, i in enumerate(kept):
    nxt = ts[kept[k + 1]] if k + 1 < len(kept) else max(end, ts[i] + 1 / 30)
    out += [f"file '{names[i]}'", f'duration {nxt - ts[i]:.6f}']
out.append(f"file '{names[kept[-1]]}'")
open(src, 'w').write('\n'.join(out) + '\n')
print(f'{len(names)} frames -> {len(kept)} kept, span {end:.2f}s, effective fps {len(kept) / end:.1f}')
