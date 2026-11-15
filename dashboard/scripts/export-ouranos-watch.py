"""Export the OURANOS watch CAD (hardware/band) as display geometry for the dashboard.

Reads band.py and chain.py from the hardware-band branch, read only, and writes
public/ouranos/ouranos-watch.json (manifest, millimetres, as worn: Z up is the watch face) and
public/ouranos/ouranos-watch.bin (Float32 positions then Uint32 indices for each part).

    <cad-venv>/bin/python -I scripts/export-ouranos-watch.py <path to hardware/band> [out dir]

Tessellation keeps vertices per CAD face, so curved faces shade smoothly and CAD edges stay crisp.
"""
import json
import struct
import sys
from pathlib import Path

band_dir = Path(sys.argv[1]).resolve()
out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "public" / "ouranos")
sys.path.insert(0, str(band_dir))

import band  # noqa: E402  (the CAD modules guard their exports behind __main__)
import chain  # noqa: E402
from build123d import Align, Axis, Cylinder, Pos, Rot, RectangleRounded, fillet  # noqa: E402

TOL, ANG = 0.02, 0.12  # mm, rad

lya, lzc = band.hinge_axis()
R, P = chain.R, chain.P

parts = []


def add(name, role, shape, material, pivot=None, explode=(0, 0, 0)):
    verts, tris = shape.tessellate(TOL, ANG)
    parts.append({
        "name": name, "role": role, "material": material,
        "pivot": pivot, "explode": list(explode),
        "positions": [c for v in verts for c in (v.X, v.Y, v.Z)],
        "indices": [i for t in tris for i in t],
    })
    print(f"{name:14s} {len(verts):7d} verts {len(tris):7d} tris")


# Case, plate and the watch, as worn
add("shell", "shell", band.shell(), "pla-shell", explode=(0, 0, 16))
add("backplate", "backplate", Pos(0, 0, band.PLATE_BOT) * band.back_plate(0.0), "pla-plate", explode=(0, 0, -26))

body = band.slab(RectangleRounded(band.WATCH_W, band.WATCH_H, band.WATCH_R), 0, band.RIM_D)
body = fillet(body.edges().group_by(Axis.Z)[-1], 3.0)
add("watch", "watch", body, "aluminum", explode=(0, 0, 38))
dome = Cylinder(12.0, band.DOME, align=(Align.CENTER, Align.CENTER, Align.MAX))
add("sensor", "sensor", dome, "sensor-glass", explode=(0, 0, 38))

# Filament pins through the case lugs
for side, y in (("a", lya), ("b", -lya)):
    pin = Pos(0, y, lzc) * (Rot(0, 90, 0) * Cylinder(0.875, 2 * band.LUG_OUT + 1.0))
    add(f"pin_{side}", "pin", pin, "filament", explode=(38 if side == "a" else -38, 0, 0))

# Chain bands. Link i hinges at its back edge; the viewer curls the chain around these pivots.
seg_a = chain.segment(chain.LINKS_A, "pin", windows=False)
seg_b = chain.segment(chain.LINKS_B, "plain", windows=True)
for i, l in enumerate(seg_a):
    add(f"band_a_{i}", "band-a", Pos(0, lya, lzc - R) * l, "pla-band", pivot=[0, lya + i * P, lzc], explode=(0, 10 + 4 * i, 0))
hook = Pos(0, lya, lzc - R) * (Pos(0, chain.LINKS_A * P, R) * chain.hook())
add("hook", "hook", hook, "pla-band", pivot=[0, lya + chain.LINKS_A * P, lzc], explode=(0, 18, 4))
for i, l in enumerate(seg_b):
    add(f"band_b_{i}", "band-b", Rot(0, 0, 180) * (Pos(0, lya, lzc - R) * l), "pla-band",
        pivot=[0, -(lya + i * P), lzc], explode=(0, -(10 + 3 * i), 0))

out_dir.mkdir(parents=True, exist_ok=True)
blob = bytearray()
manifest_parts = []
for p in parts:
    pos_off = len(blob)
    blob += struct.pack(f"<{len(p['positions'])}f", *p["positions"])
    idx_off = len(blob)
    blob += struct.pack(f"<{len(p['indices'])}I", *p["indices"])
    manifest_parts.append({k: p[k] for k in ("name", "role", "material", "pivot", "explode")} | {
        "positions": [pos_off, len(p["positions"])], "indices": [idx_off, len(p["indices"])]})

manifest = {
    "source": "hardware/band/band.py and chain.py (OURANOS shroud and chain band)",
    "units": "mm",
    "watch": {"w": band.WATCH_W, "h": band.WATCH_H, "r": band.WATCH_R, "d": band.RIM_D, "zFront": band.Z_FRONT_GLASS},
    "case": {"zTop": band.Z_TOP, "zBot": band.Z_BOT, "outW": band.OUT_W, "outH": band.OUT_H},
    "band": {"pitch": P, "hingeY": lya, "hingeZ": lzc, "linksA": chain.LINKS_A, "linksB": chain.LINKS_B},
    "parts": manifest_parts,
}
(out_dir / "ouranos-watch.bin").write_bytes(blob)
(out_dir / "ouranos-watch.json").write_text(json.dumps(manifest, indent=1))
print(f"wrote {len(blob) / 1e6:.2f} MB of geometry, {len(parts)} parts, to {out_dir}")
