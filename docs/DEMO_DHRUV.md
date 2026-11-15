# 30-second demo: dashboard side (Dhruv)

The rule for the whole video: anything simulated is labelled simulated on screen and in the narration. Never call a simulated case an astronaut, a diagnosis, or a live connection.

## Before recording

```bash
cd dashboard
npm install          # once, with internet
npm run build        # once
npm start            # http://127.0.0.1:4317, keep this terminal open
```

In the browser (Chrome, 1440×900 window, zoom 100%):

1. Open http://127.0.0.1:4317. Click **Open simulated demo** in the status bar. The violet SIMULATED DEMO strip under the navigation must be visible.
2. Go to **System Status** → **Reset simulated scenarios** (puts the six scenarios back; earlier triggers and reviews are cleared from the demo workspace only).
3. Click **Mission Overview**. The **Scenario** menu in the violet strip should read **Latest activity**. To show one case on purpose, pick it there (A–F); every scenario is simulated.

If the watch app is sending real data (see `docs/WATCH_INTEGRATION.md`), use path A below instead of the simulated trigger. Decide before recording; do not mix them in one shot.

## The 30 seconds

| Time | Show | Click | Say (honest version) |
|---|---|---|---|
| 0–5 s | The printed wearable on a wrist, then the dashboard Overview | — | "After spaceflight, standing back up in gravity can make astronauts dizzy." |
| 5–12 s | Mission Overview | **Trigger simulated watch event** (violet). A simulated watch card slides in: REVIEW SUGGESTED / OPEN MISSION COMPUTER, labelled SIMULATED WATCH. | "Here the watch suggests a review. This run is simulated." |
| 12–21 s | Investigation view | **Open evidence** on the card. Point at marker 1 on the helmet of the 3D crew member (SELF-REPORTED DIZZINESS, a reported symptom, not a measurement), the rest and recovery medians, and +23 bpm. Section 03 lists what the record can and cannot show. | "The computer shows why: a self-reported symptom, the heart-rate readings behind each number, and what is missing, like blood pressure." |
| 21–27 s | Review workflow | **Open review workflow**, tick the five items, type a reviewer (for example "Crew medical officer"), **Mark reviewed**. | "A crew medical officer documents the review. That is a record, not a clearance." |
| 27–30 s | The same page with Wi-Fi off | Turn Wi-Fi off (macOS menu bar), then click **Crew Health**. The Network readout in the status bar reads **Offline · local**. | "All of it runs on the mission computer, with no internet." |

Turning Wi-Fi off does not affect `127.0.0.1`, so the dashboard keeps working. Turn it back on afterwards.

The 3D crew member on the Overview turns when you drag it (or use **Front / Back**); it never moves by itself. Its numbered markers are the same regions as the evidence list beside it. If the browser has no WebGL it shows the 2D drawing instead, with the same markers.

## Path A: real watch over Wi-Fi (only if it has been tested)

The full on-device procedure, with what each check should read at each step, is `docs/WATCH_CONNECTION_TEST.md`.

1. Stop the server and start it with `GG_LAN=1 npm start`. The terminal prints the LAN address.
2. **System Status** → **Watch connection** lists the steps and the address to type on the watch (use the Wi-Fi `en0` address, never a VPN `utun` one). On the watch: **Set console address**, then **Get pairing code**, then type the code into **Watch pairing code** on the dashboard and press **Pair watch**.
3. **Integration check** turns each check to PASS only on real evidence. Read it out loud as it stands. Do not call the system integrated until check 6 (a real device record) has passed. Do not say the watch confirmed an alert unless check 9 has passed.
4. Click **Exit demo** (or stay in mission records). When the watch checks in, the Watch readout shows **Link verified**. If there has been no contact in the last 60 s it reads **Watch unreachable**; say so rather than calling it live.
5. A watch review signal appears in the event queue within a few seconds. Continue from the 12-second row above.

**Run self-test (simulated)** on System Status only shows that this computer's pairing and signal endpoints answer. Never present it as a watch connection.

## Path B: saved real recording

1. Get the exported JSON from the watch (Mustafa).
2. Status bar → **Exit demo** (mission records), then **System Status** → **Integration tools** → **Import saved records** → **Choose JSON file**.
3. It is labelled **SAVED DEVICE DATA**. Say "recorded on the watch earlier", not "live".

## Do not say

- "detected orthostatic intolerance", "predicts fainting", "safe to stand", "cleared for duty"
- "live" for anything simulated or imported
- "the watch measured blood pressure" (it cannot)

## If something goes wrong

- Banner says LOCAL API UNAVAILABLE: the server is not running. Run `npm start` in `dashboard/`.
- No trigger button: you are in mission records. Use **Open simulated demo** in the status bar.
- A check reads FAIL: its line on System Status says what to do (for example, restart with `GG_LAN=1 npm start`).
- Port in use: `GG_PORT=4318 npm start` and open that port.
