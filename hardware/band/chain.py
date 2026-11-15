"""OURANOS chain-link band: print-in-place links and a big glove hook.

Run after band.py:  .venv/bin/python chain.py
Writes out/print/ouranos_band_a.stl, ouranos_band_b.stl, ouranos_band_hook.stl
(plus STEP and an assembled preview) and checks every hinge clearance.

HOW IT GOES TOGETHER
  Band A (12 o'clock, short): end link + 1 link, with the hook pinned on its end.
  Band B (6 o'clock, long): end link + 7 links, each with a window for the hook.
  Each band prints flat in one piece with its cone hinges already linked: no
  supports, no assembly. Flex every hinge a few times after printing to free it.
  Pins: three pieces of 1.75 mm filament (two into the case lugs, one for the hook).
  Push each through its knuckles, trim, and cap both ends with the 3D pen.
  Wearing: wrap both bands round the wrist, push the hook down through a window of
  band B from the outside, and pull back so the curl catches under it. Tension
  keeps it shut. Lift the pull tab to open; it works with gloves. Pick the window
  that fits: each one changes the length by one link (12 mm). Sized for wrists up
  to about 160 mm.

PRINT the bands flat (as exported) and the hook on its side (as exported) so its
layers follow the curve of the hook. 0.2 mm layers, 4 walls, 100 % infill on the
hook, no supports. HINGE_GAP is the print-in-place clearance; if hinges fuse, raise
it by 0.1 in band.py and rebuild.

Coordinates for each link: the band runs along +Y, hinge axes run along X at
z = BAND_T / 2, the skin side is z = 0.
"""
from build123d import (
    Align, Box, Circle, Compound, Cone, Cylinder, Plane, Polygon, Pos, Rot, extrude, export_stl, export_step,
)
from pathlib import Path
import math

import band
from band import HINGE_GAP as G, END_KNUCKLE_W, LUG_KNUCKLE_R, teardrop

BAND_W = 22.0         # band width
BAND_T = 4.0          # band thickness
R = BAND_T / 2        # knuckle radius
P = 12.0              # link pitch (hinge to hinge)
C = 10.0              # centre-knuckle width at link-to-link hinges
CONE_R, CONE_H, CONE_TIP = 1.5, 1.3, 0.2   # 45 degree hinge cones
CONE_CLEAR = 0.3      # normal clearance around a cone (0.42 along its axis)
PIN_D = 2.2           # band holes for a 1.75 mm filament pin
WIN_X, WIN_Y0, WIN_Y1 = 13.0, 3.8, 8.2     # hook window in each band B link
LINKS_A, LINKS_B = 2, 8

# Hook (in its own frame: knuckle axis along X at the origin, s = +Y along the band,
# t = +Z away from the wrist). Band B lies right under band A where the hook closes.
HOOK_W = C            # sits between the outer knuckles of band A's last link
HOOK_REACH = 14.0     # knuckle axis to the drop
HOOK_T = 2.6          # tongue and drop thickness (fits the 4.4 mm window)
CURL_T, CURL_BACK = 2.4, 2.6
TAB = 6.5             # pull tab beyond the drop

OUT = band.OUT


def xcyl(r, length):
    """Cylinder of radius r and the given length along X, centred on the origin."""
    return Rot(0, 90, 0) * Cylinder(r, length)


def xcone(sx):
    """Hinge cone with its base on the plane x = sx*(C/2 + G), pointing toward x = 0."""
    c = Cone(CONE_R, CONE_TIP, CONE_H, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return Pos(sx * (C / 2 + G), 0, 0) * (Rot(0, -90 * sx, 0) * c)


def xsocket(sx):
    """Matching cone-shaped recess, offset CONE_CLEAR normal to the cone surface."""
    ax = CONE_CLEAR * math.sqrt(2)
    c = Cone(CONE_R + ax, CONE_TIP + 0.05, CONE_H + ax, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return Pos(sx * (C / 2 + G), 0, 0) * (Rot(0, -90 * sx, 0) * c)


def pin_hole(y, length):
    """Horizontal pin hole along X at (y, R), teardrop pointing up so it prints flat."""
    return extrude(Plane.YZ * teardrop(PIN_D / 2, y, R, up=1), amount=length / 2, both=True)


def link(back="cone", front="cone", window=False):
    """One link: back hinge axis at y = 0, front hinge axis at y = P.

    back:  "cone"  centre knuckle with cone sockets (previous link's cones engage it)
           "shell" wide centre knuckle with a pin hole, for the case lug
    front: "cone"  two outer knuckles carrying cones (next link's centre knuckle)
           "pin"   two outer knuckles with a pin hole (the hook)
           "plain" rounded end
    """
    body = Pos(0, P / 2, R) * Box(BAND_W, P, BAND_T)
    # back
    cb = C if back == "cone" else END_KNUCKLE_W
    rb = (R if back == "cone" else LUG_KNUCKLE_R) + G     # clear the neighbour's knuckles
    for sx in (-1, 1):
        x0, x1 = cb / 2, BAND_W / 2 + 1
        body -= Pos(sx * (x0 + x1) / 2, 0, R) * xcyl(rb, x1 - x0)
    body += Pos(0, 0, R) * xcyl(R, cb)
    if back == "cone":
        for sx in (-1, 1):
            body -= Pos(0, 0, R) * xsocket(sx)
    else:
        body -= pin_hole(0, cb + 1)
    # front
    if front == "plain":
        body += Pos(0, P, R) * xcyl(R, BAND_W)
    else:
        body -= Pos(0, P, R) * xcyl(R + G, C + 2 * G)
        body -= Pos(0, P + 3, R) * Box(C + 2 * G, 6, BAND_T + 2)
        for sx in (-1, 1):
            x0, x1 = C / 2 + G, BAND_W / 2
            body += Pos(sx * (x0 + x1) / 2, P, R) * xcyl(R, x1 - x0)
        if front == "cone":
            for sx in (-1, 1):
                body += Pos(0, P, R) * xcone(sx)
        else:
            body -= pin_hole(P, BAND_W + 1)
    if window:
        body -= Pos(0, (WIN_Y0 + WIN_Y1) / 2, R) * Box(WIN_X, WIN_Y1 - WIN_Y0, BAND_T + 2)
    return body


def segment(n, last_front, windows):
    """n links in a row, ready to print flat. Returns the list of link solids."""
    links = []
    for i in range(n):
        back = "shell" if i == 0 else "cone"
        front = last_front if i == n - 1 else "cone"
        links.append(Pos(0, i * P, 0) * link(back, front, window=windows and i > 0))
    return links


def hook():
    """Glove hook, in its own frame (see the constants above)."""
    t0, t1 = -HOOK_T / 2, HOOK_T / 2
    curl_top = -BAND_T - BAND_T / 2 - 0.6      # band B's underside is 1.5 * BAND_T below band A's centre plane; 0.6 mm clearance
    curl_bot = curl_top - CURL_T
    d0, d1 = HOOK_REACH, HOOK_REACH + HOOK_T
    prof = Polygon((0, t0), (d1 + TAB, t0), (d1 + TAB, t1), (0, t1), align=None)           # tongue + tab
    prof += Polygon((d0, curl_bot), (d1, curl_bot), (d1, t1), (d0, t1), align=None)        # drop
    prof += Polygon((d0 - CURL_BACK, curl_bot), (d1, curl_bot), (d1, curl_top), (d0 - CURL_BACK, curl_top), align=None)  # curl
    prof += Pos(0, 0) * Circle(R)                                                     # knuckle
    prof += Pos(d1 + TAB, 0) * Circle(t1)                                             # round tab end
    h = extrude(Plane.YZ * prof, amount=HOOK_W / 2, both=True)
    h -= xcyl(PIN_D / 2, HOOK_W + 2)          # printed on its side, so a round hole is fine
    for k in range(3):                         # grip ridges on the tab
        h += Pos(0, d1 + 1.6 + k * 1.6, t1) * Box(HOOK_W - 2, 0.6, 0.5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return h


def gap(a, b):
    return a.distance_to(b)


if __name__ == "__main__":
    (OUT / "print").mkdir(parents=True, exist_ok=True)
    seg_a = segment(LINKS_A, "pin", windows=False)
    seg_b = segment(LINKS_B, "plain", windows=True)
    hk = hook()

    # Every link is one solid, and neighbours keep the print-in-place clearance
    for name, seg in (("A", seg_a), ("B", seg_b)):
        for i, l in enumerate(seg):
            assert len(l.solids()) == 1 and l.is_valid, f"band {name} link {i} is not one valid solid"
        for i in range(len(seg) - 1):
            v = (seg[i] & seg[i + 1]).volume
            d = gap(seg[i], seg[i + 1])
            assert v < 1e-6 and d >= 0.25, f"band {name} links {i}/{i+1}: overlap {v:.3f} mm3, gap {d:.2f} mm"
        print(f"band {name}: {len(seg)} links, smallest hinge gap "
              f"{min(gap(seg[i], seg[i+1]) for i in range(len(seg)-1)) if len(seg) > 1 else 0:.2f} mm")
    assert len(hk.solids()) == 1 and hk.is_valid

    # Hook pinned to band A's last link
    ya = (LINKS_A) * P
    hook_on_a = Pos(0, ya, R) * hk
    d = gap(hook_on_a, seg_a[-1])
    assert (hook_on_a & seg_a[-1]).volume < 1e-6 and d >= 0.25, f"hook clashes with band A: gap {d:.2f}"
    print(f"hook on band A: gap {d:.2f} mm")

    # End links in the case lugs (12 o'clock for A, 6 o'clock for B)
    sh = band.shell()
    lya, lzc = band.hinge_axis()
    a_in_case = [Pos(0, lya, lzc - R) * l for l in seg_a]
    b_in_case = [Rot(0, 0, 180) * (Pos(0, lya, lzc - R) * l) for l in seg_b]
    for name, first in (("A", a_in_case[0]), ("B", b_in_case[0])):
        v, d = (sh & first).volume, gap(sh, first)
        assert v < 1e-6 and d >= 0.25, f"band {name} end link clashes with the case: overlap {v:.3f}, gap {d:.2f}"
        print(f"band {name} end link in its lug: gap {d:.2f} mm")

    # Hook closed through a band B window: band B stacked right under band A's tongue
    k = 4
    win_center = k * P + (WIN_Y0 + WIN_Y1) / 2
    hook_closed = Pos(0, win_center - (HOOK_REACH + HOOK_T / 2), BAND_T + R) * hk
    v = sum((hook_closed & l).volume for l in seg_b)
    print(f"hook closed in window {k}: overlap with band B {v:.3f} mm3")
    assert v < 1e-6, "closed hook overlaps band B"

    parts = {
        "ouranos_band_a": seg_a,
        "ouranos_band_b": seg_b,
    }
    for name, seg in parts.items():
        comp = Compound(children=seg)
        export_stl(comp, str(OUT / "print" / f"{name}.stl"))
        export_step(comp, str(OUT / f"{name}.step"))
        bb = comp.bounding_box()
        print(f"{name:22s} {bb.size.X:6.2f} x {bb.size.Y:6.2f} x {bb.size.Z:6.2f} mm  {len(seg)} links")
    # Hook on its side: width becomes height, so the layers follow the hook's curve
    side = Rot(0, 90, 0) * hk
    bb = side.bounding_box()
    side = Pos(-bb.center().X, -bb.center().Y, -bb.min.Z) * side
    export_stl(side, str(OUT / "print" / "ouranos_band_hook.stl"))
    export_step(hk, str(OUT / "ouranos_band_hook.step"))
    bb = side.bounding_box()
    print(f"{'ouranos_band_hook':22s} {bb.size.X:6.2f} x {bb.size.Y:6.2f} x {bb.size.Z:6.2f} mm  (printed on its side)")

    # Assembled preview for renders (not for printing)
    export_stl(Compound(children=[sh] + a_in_case + b_in_case + [Pos(0, lya, lzc - R) * hook_on_a]),
               str(OUT / "ref_assembled_flat_NOT_FOR_PRINT.stl"))
