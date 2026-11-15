"""OURANOS: astronaut shroud for the 40 mm Apple Watch SE (aluminum, Ion-X glass).

Parametric build123d model (build123d 0.13.0). The chain-link band is chain.py.
Rebuild everything with:
    uv venv .venv && uv pip install --python .venv/bin/python build123d==0.13.0
    .venv/bin/python band.py && .venv/bin/python chain.py
Both write STL and STEP files to out/, print-ready STLs to out/print/, and run
interference checks.

PARTS (out/print/)
  ouranos_fit_test.stl     slice of the shell at the bezel (fit check).
  ouranos_shell.stl        the shroud: octagonal bezel engraved OURANOS, crown-side and
                           speaker openings, crush ribs, hinge lugs at 12 and 6 o'clock.
                           Prints face-down.
  ouranos_backplate_*.stl  slide-in back plate in five fits: looser_m06, looser_m03,
                           nominal, tighter_p03, tighter_p06 (bearing pad -0.6 to +0.6 mm).
  ouranos_band_*.stl       the chain band and its hook (see chain.py).

PRINT (PLA, Elegoo Neptune 4 Pro, 0.4 mm nozzle)
  0.2 mm layers, 4 walls, 40 % gyroid infill, no supports, no brim, Elegoo PLA
  profile temperatures. Parts are already oriented.

FIT
  Fit test 1 (2026-11-14) printed loose, with the crown and button inside the
  opening; crush ribs were added after it (RIB_SQUEEZE). Ribs too tight: shave them.
  1. Watch in the shell face-down, then slide a back plate in from the side opposite
     the crown until both arms click. Start with nominal. Watch moves front to back:
     tighter_p03, then tighter_p06. Plate won't go in: looser.
  2. Band: put each end link's knuckle between a pair of lug knuckles, push a piece
     of 1.75 mm filament through all three, trim it, and cap both ends with the 3D pen.
  To charge: slide the plate out, or try the charger through the sensor window.

WHAT STAYS OPEN FOR THE SOFTWARE
  The back window lets the optical heart sensor touch skin (HealthKit heart rate,
  HRV, SpO2 in WatchBiometrics.swift). The crown, side button, microphone and
  speaker openings are oversized for gloves and for the estimates below.

COORDINATES are "as worn": +Z from wrist toward the display, +Y toward 12 o'clock,
+X toward the crown. z = 0 is the plane of the watch's back rim.
Published (apple.com/apple-watch-se/specs, same for every SE generation):
  40 mm case = 40.0 (Y) x 34.0 (X) x 10.7 (Z) mm.
Everything marked EST is an estimate that the fit test checks.

AI DISCLOSURE (NASA Space Apps SI rules)
  Sriyan chose the part and its requirements: a shroud for the 40 mm SE that hides
  the Apple Watch look, the name OURANOS, a print-in-place chain-link band with a
  big glove hook for a wrist under 160 mm, PLA on his Neptune 4 Pro, assembly with
  his 3D pen. Claude (Anthropic) in Claude Code wrote this code on 2026-11-14 and
  2026-11-15 during the event and made the mechanical choices: the slide-in back
  plate and its in-plane latch arms, the crush ribs, the teardrop hinge lugs with
  filament pins, the octagonal bezel, the opening sizes and the fit variants. No
  outside 3D model was used. The engraved name uses the system Arial font through
  build123d's Text.
"""
from build123d import (
    Align, Axis, Box, Circle, Cylinder, Plane, Polygon, Pos, Rot, Text,
    RectangleRounded, extrude, export_step, export_stl, fillet, loft,
    BuildPart, BuildSketch,
)
from pathlib import Path
import math

# ---------- watch (published + EST) ----------
WATCH_W = 34.0        # X, published
WATCH_H = 40.0        # Y, published
WATCH_D = 10.7        # Z total, published
DOME = 1.5            # EST: how far the sensor dome sticks out past the back rim
RIM_D = WATCH_D - DOME  # back rim to front glass
WATCH_R = 9.5         # EST plan-view corner radius

# Positions on the crown side, measured from the 12 o'clock edge (EST)
CROWN_FROM_TOP = 11.5
BUTTON_FROM_TOP = 24.5

# ---------- fit and print ----------
CLEAR = 0.25          # XY gap per side between watch and shell
CAV_R = 8.0           # cavity corner radius, deliberately below WATCH_R so corners never bind
RIB_SQUEEZE = 0.10    # crush ribs reach this far past the watch's published width (fit test 1 felt loose)
RIB_Z = (0.6, 6.5)    # rib height band: where the curved case sides are widest
WALL = 2.4            # side wall (6 lines of a 0.4 mm nozzle)
LIP_T = 1.2           # front lip thickness over the glass
LIP_GAP = 0.15        # lip underside above the glass
WINDOW_W, WINDOW_H, WINDOW_R = 27.5, 33.0, 7.0   # display window (active area is about 26 x 31.5)
CORNER_CHAMFER = 5.5  # outer plan-view corner chamfer: an octagon, not Apple's rounded square

PLATE_T = 1.2         # back plate rail thickness (6 layers at 0.2 mm)
PLATE_GAP = 0.15      # plate top below the back rim at the nominal fit
GROOVE_DEPTH = 1.2    # how far the plate edges run into the end walls
GROOVE_CLEAR = 0.20   # extra height and depth in the grooves
RAIL_BELOW = 0.6      # end-wall material under the plate edges (kept thin so the sensor reaches skin)
FIT_STEPS = (-0.6, -0.3, 0.0, 0.3, 0.6)   # back plate bearing-pad offsets to print and try

NAME = "OURANOS"      # engraved on the 6 o'clock band of the bezel

# Hinge lugs for the chain band. Pins are pieces of 1.75 mm filament capped with a 3D pen.
LUG_KNUCKLE_R = 2.6   # shell knuckle radius
LUG_AXIS_OFF = 2.8    # hinge axis distance beyond the end wall (band knuckle 2.0 + 0.4 gap + margin)
LUG_OUT = 13.0        # outer edge of the side knuckles (x)
END_KNUCKLE_W = 12.0  # width of the band's end-link knuckle that sits between them
HINGE_GAP = 0.4       # print-in-place and fit clearance at hinges
PIN_HOLE_D = 2.0      # shell hole for a 1.75 mm filament pin

# ---------- derived ----------
CAV_W = WATCH_W + 2 * CLEAR
CAV_H = WATCH_H + 2 * CLEAR
OUT_W = CAV_W + 2 * WALL
OUT_H = CAV_H + 2 * WALL
Z_FRONT_GLASS = RIM_D
Z_TOP = Z_FRONT_GLASS + LIP_GAP + LIP_T
PLATE_TOP = -PLATE_GAP
PLATE_BOT = PLATE_TOP - PLATE_T
Z_BOT = PLATE_BOT - RAIL_BELOW
HEIGHT = Z_TOP - Z_BOT

OUT = Path(__file__).with_name("out")


def octagon(w, h, c):
    """Rectangle w x h centred on the origin with its four corners cut at 45 degrees."""
    x, y = w / 2, h / 2
    return Polygon(
        (-x + c, -y), (x - c, -y), (x, -y + c), (x, y - c),
        (x - c, y), (-x + c, y), (-x, y - c), (-x, -y + c),
        align=None,
    )


def slab(sketch, z0, z1):
    return Pos(0, 0, z0) * extrude(sketch, amount=z1 - z0)


def teardrop(r, cy, cz, up=1):
    """2D teardrop in a YZ sketch: circle r at (cy, cz) with a 45 degree point toward +z (up=1) or -z (up=-1).

    Horizontal holes print without supports when the point faces the print's +Z.
    """
    k = r / math.sqrt(2)
    tip = Polygon((cy - k, cz + up * k), (cy + k, cz + up * k), (cy, cz + up * r * math.sqrt(2)), align=None)
    return Pos(cy, cz) * Circle(r) + tip


def hinge_axis():
    """(y, z) of the 12 o'clock lug hinge axis, as worn. The 6 o'clock one is (-y, z)."""
    return OUT_H / 2 + LUG_AXIS_OFF, Z_BOT + LUG_KNUCKLE_R


def hinge_lug(sign):
    """Two side knuckles on the 12 (sign=+1) or 6 (sign=-1) o'clock end wall.

    Side profile: a teardrop around the hinge axis whose 45 degree top runs back up to
    the end wall, so the shell still prints face-down without supports. The band's
    end link sits in the gap between the knuckles; a filament pin runs through all three.
    """
    y_wall = OUT_H / 2
    ya, zc = hinge_axis()
    r = LUG_KNUCKLE_R
    k = r / math.sqrt(2)
    zap = zc + r * math.sqrt(2)                 # apex of the teardrop, above the axis
    y0 = y_wall - 0.5                           # overlap into the wall
    prof = Polygon((y0, Z_BOT), (ya, Z_BOT), (ya, zap), (y0, zap + (ya - y0)), align=None)
    prof += Polygon((ya, zc), (ya + k, zc + k), (ya, zap), align=None)
    prof += Pos(ya, zc) * Circle(r)
    x_in = END_KNUCKLE_W / 2 + HINGE_GAP
    width = LUG_OUT - x_in
    lug = None
    for sx in (-1, 1):
        kn = Pos(sx * (x_in + width / 2), 0, 0) * extrude(Plane.YZ * prof, amount=width / 2, both=True)
        lug = kn if lug is None else lug + kn
    # Pin hole: teardrop pointing worn -Z, which is print +Z when the shell prints face-down
    lug -= extrude(Plane.YZ * teardrop(PIN_HOLE_D / 2, ya, zc, up=-1), amount=LUG_OUT + 1, both=True)
    if sign < 0:
        lug = Rot(0, 0, 180) * lug
    return lug


def crush_ribs():
    """Six small vertical ribs on the cavity walls that squash as the watch goes in.

    Each is a triangle 0.9 mm wide at the wall, reaching CLEAR + RIB_SQUEEZE into
    the cavity, so it takes up the side play. Too tight: shave with a knife.
    Left wall at y = +/-10.5 (between the speaker opening and the corner curve);
    end walls at x = +/-6. The crown side stays open; the ribs push the watch
    gently toward it.
    """
    reach = CLEAR + RIB_SQUEEZE
    z0, z1 = RIB_Z

    def tri(*pts):
        # extrude follows the face normal, so list corners counter-clockwise (normal +Z)
        (ax, ay), (bx, by), (cx, cy) = pts
        if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0:
            pts = pts[::-1]
        return Polygon(*pts, align=None)

    xw, yw = CAV_W / 2, CAV_H / 2
    tris = []
    for y in (-10.5, 10.5):
        tris.append(tri((-xw - 0.3, y - 0.45), (-xw - 0.3, y + 0.45), (-xw + reach, y)))
    for x in (-6.0, 6.0):
        for sy in (-1, 1):
            tris.append(tri((x - 0.45, sy * (yw + 0.3)), (x + 0.45, sy * (yw + 0.3)), (x, sy * (yw - reach))))
    ribs = None
    for t in tris:
        r = slab(t, z0, z1)
        bb = r.bounding_box()
        assert abs(bb.min.Z - z0) < 1e-6 and abs(bb.max.Z - z1) < 1e-6, "rib extruded the wrong way"
        ribs = r if ribs is None else ribs + r
    return ribs


def shell():
    outer = slab(octagon(OUT_W, OUT_H, CORNER_CHAMFER), Z_BOT, Z_TOP)
    part = outer
    part += hinge_lug(+1)
    part += hinge_lug(-1)

    # Watch cavity, from the bottom up to the lip underside
    cavity = slab(RectangleRounded(CAV_W, CAV_H, CAV_R), Z_BOT - 1, Z_FRONT_GLASS + LIP_GAP)
    part -= cavity
    part += crush_ribs()
    # Display window, with a 45 degree bevel so edge swipes still work
    win = slab(RectangleRounded(WINDOW_W, WINDOW_H, WINDOW_R), Z_FRONT_GLASS, Z_TOP + 1)
    part -= win
    bevel = 0.9
    with BuildPart() as b:
        with BuildSketch(Plane.XY.offset(Z_TOP - bevel)):
            RectangleRounded(WINDOW_W, WINDOW_H, WINDOW_R)
        with BuildSketch(Plane.XY.offset(Z_TOP + 0.01)):
            RectangleRounded(WINDOW_W + 2 * bevel, WINDOW_H + 2 * bevel, WINDOW_R + bevel)
        loft()
    part -= b.part

    # Back plate grooves in the 12 and 6 o'clock walls, and the entry on the left (-X) side
    g_h = PLATE_T + GROOVE_CLEAR
    g_z0 = PLATE_BOT - GROOVE_CLEAR / 2
    groove_len_y = CAV_H + 2 * (GROOVE_DEPTH + GROOVE_CLEAR)
    groove_x0 = -OUT_W / 2 - 1                         # open through the left wall
    groove_x1 = CAV_W / 2 + GROOVE_DEPTH + GROOVE_CLEAR  # stops inside the right wall
    part -= Pos((groove_x0 + groove_x1) / 2, 0, g_z0) * Box(
        groove_x1 - groove_x0, groove_len_y, g_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    # Left wall below the plate is removed so nothing has to bridge over the entry
    part -= Pos(-OUT_W / 2, 0, Z_BOT - 1) * Box(
        2 * (WALL + GROOVE_DEPTH + 1), groove_len_y, (g_z0 - Z_BOT) + 1, align=(Align.CENTER, Align.CENTER, Align.MIN))
    # Latch notches for the plate's spring arms (one in each groove, near the left)
    for sy in (-1, 1):
        part -= Pos(-CAV_W / 2 + 6.0, sy * (groove_len_y / 2), g_z0) * Cylinder(
            0.9, g_h, align=(Align.CENTER, Align.CENTER, Align.MIN))

    # Crown side (+X): one glove-sized opening for crown, microphone and side button
    top_y = CAV_H / 2
    y_hi = top_y - (CROWN_FROM_TOP - 5.0)
    y_lo = top_y - (BUTTON_FROM_TOP + 7.0)
    part -= Pos(OUT_W / 2, (y_hi + y_lo) / 2, 1.0) * Box(
        2 * WALL + 2, y_hi - y_lo, Z_FRONT_GLASS - 1.0 + LIP_GAP, align=(Align.CENTER, Align.CENTER, Align.MIN))
    # Speaker side (-X): opening over the speaker
    part -= Pos(-OUT_W / 2, 0, 2.5) * Box(2 * WALL + 2, 16.0, 5.0, align=(Align.CENTER, Align.CENTER, Align.MIN))

    # Name on the 6 o'clock band of the bezel, engraved 0.6 mm
    band_mid = -(WINDOW_H / 2 + (OUT_H / 2 - WINDOW_H / 2) / 2)
    txt = Text(NAME, font_size=4.4)
    part -= Pos(0, band_mid, Z_TOP - 0.6) * extrude(txt, amount=1.0)
    return part


SENSOR_WIN = (29.0, 31.0, 10.0)   # back plate window: X, Y, corner radius


def back_plate(fit=0.0):
    """Slide-in back plate, modelled with its underside at z = 0.

    The rails that ride in the shell grooves are always PLATE_T thick. `fit` only
    raises (+, clamps tighter) or lowers (-, looser) the pad that bears on the
    watch back, so every variant slides into the same grooves.
    The sensor window lets the optical heart sensor reach the skin. Two in-plane
    cantilever arms click into notches in the shell grooves.
    """
    t = PLATE_T
    y_len = CAV_H + 2 * GROOVE_DEPTH            # edges run into the end-wall grooves
    x_right = CAV_W / 2 + GROOVE_DEPTH           # leading edge runs into the right wall
    x_left = -OUT_W / 2 - 2.0                    # grip tab stands 2 mm proud of the left wall
    plate = Pos((x_left + x_right) / 2, 0, 0) * Box(x_right - x_left, y_len, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
    window = RectangleRounded(*SENSOR_WIN)
    pad = RectangleRounded(CAV_W - 0.8, CAV_H - 0.8, CAV_R - 0.4) - window
    if fit > 0:
        plate += Pos(0, 0, t) * extrude(pad, amount=fit)
    elif fit < 0:
        plate -= Pos(0, 0, t + fit) * extrude(pad, amount=-fit + 1)
    plate -= Pos(0, 0, -1) * extrude(window, amount=t + abs(fit) + 3)
    # Grip ridges on the tab
    for gx in (x_left + 0.45, x_left + 1.25):       # both stay outboard of the left wall
        plate += Pos(gx, 0, t) * Box(0.5, 22.0, 0.6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    # Cantilever arms: 1.6 mm wide, about 12 mm long, root on the right, free tip on the left.
    # The 0.6 mm bump deflects the tip 0.4 mm in the plate's own plane (about 0.7 % strain),
    # so PLA bends along its layers rather than across them.
    arm_x = -CAV_W / 2 + 6.0
    for sy in (-1, 1):
        edge = sy * y_len / 2
        slot_y = edge - sy * 2.0                    # 0.8 mm slot behind a 1.6 mm arm
        plate -= Pos((arm_x - 1.8 + arm_x + 11.0) / 2, slot_y, -1) * Box(
            12.8, 0.8, t + 3, align=(Align.CENTER, Align.CENTER, Align.MIN))
        plate -= Pos(arm_x - 1.4, edge - sy * 1.0, -1) * Box(          # frees the tip
            0.8, 2.6, t + 3, align=(Align.CENTER, Align.CENTER, Align.MIN))
        plate += Pos(arm_x, edge, 0) * Cylinder(0.6, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return plate


def fit_test():
    """A slice of the shell at the lip, to check the outline and corner radius quickly."""
    s = shell()
    cut = Pos(0, 0, Z_FRONT_GLASS - 3.0) * Box(200, 200, 50, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return s & cut


def watch_dummy():
    """Rough stand-in for the watch, for interference checks only (EST shape)."""
    body = slab(RectangleRounded(WATCH_W, WATCH_H, WATCH_R), 0, RIM_D)
    body = fillet(body.edges().group_by(Axis.Z)[-1], 3.0)
    dome = Pos(0, 0, 0) * Cylinder(12.0, DOME, align=(Align.CENTER, Align.CENTER, Align.MAX))
    return body + dome


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    sh = shell()
    parts = {"ouranos_shell": sh, "ouranos_fit_test": fit_test()}
    for f in FIT_STEPS:
        tag = "nominal" if f == 0 else (f"tighter_{f:+.1f}" if f > 0 else f"looser_{f:+.1f}")
        parts[f"ouranos_backplate_{tag}".replace("+", "p").replace("-", "m").replace(".", "")] = back_plate(f)
    for name, p in parts.items():
        export_stl(p, str(OUT / f"{name}.stl"))
        export_step(p, str(OUT / f"{name}.step"))
        bb = p.bounding_box()
        assert len(p.solids()) == 1, f"{name} is {len(p.solids())} separate pieces"
        print(f"{name:30s} {bb.size.X:6.2f} x {bb.size.Y:6.2f} x {bb.size.Z:6.2f} mm  volume {p.volume/1000:5.2f} cm3  valid={p.is_valid}")
    print(f"shell height {HEIGHT:.2f} mm (watch {WATCH_D} mm); cavity {CAV_W:.2f} x {CAV_H:.2f} mm")

    # Print-ready copies: the shell and fit test face-down (bezel on the bed, no supports), plates flat
    (OUT / "print").mkdir(exist_ok=True)
    for name, p in parts.items():
        q = p
        if name in ("ouranos_shell", "ouranos_fit_test"):
            q = Rot(180, 0, 0) * p
        bb = q.bounding_box()
        q = Pos(-bb.center().X, -bb.center().Y, -bb.min.Z) * q
        export_stl(q, str(OUT / "print" / f"{name}.stl"))

    # Interference checks against the EST watch stand-in (volumes in mm3; 0 means no clash)
    w = watch_dummy()
    plate_in_place = Pos(0, 0, PLATE_BOT) * back_plate(0.0)
    rib_squeeze = (crush_ribs() & w).volume
    print(f"clash shell/watch      {(sh & w).volume - rib_squeeze:8.3f} mm3 (plus {rib_squeeze:.3f} mm3 of designed crush-rib squeeze)")
    print(f"clash plate/watch      {(plate_in_place & w).volume:8.3f} mm3")
    print(f"clash shell/plate      {(sh & plate_in_place).volume:8.3f} mm3 (bumps sit in their notches)")
    print(f"sensor dome bottom {-DOME:+.2f}  plate bottom {PLATE_BOT:+.2f}  shell bottom {Z_BOT:+.2f}  "
          f"-> dome sits {(-DOME) - Z_BOT:.2f} mm above the shell's skin plane (0 = flush; strap tension closes small gaps)")
    export_stl(w, str(OUT / "ref_watch_standin_NOT_FOR_PRINT.stl"))
    export_stl(plate_in_place, str(OUT / "ref_backplate_in_place_NOT_FOR_PRINT.stl"))
