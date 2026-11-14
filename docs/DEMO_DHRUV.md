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

1. Open http://127.0.0.1:4317. Click **Open simulated demo** in the banner. The violet SIMULATED DEMO banner must be visible.
2. Go to **System Status** → **Reset simulated scenarios** (puts the six scenarios back; earlier triggers and reviews are cleared from the demo workspace only).
3. Click **Overview**.

If the watch app is sending real data (see `docs/WATCH_INTEGRATION.md`), use path A below instead of the simulated trigger. Decide before recording; do not mix them in one shot.

## The 30 seconds

| Time | Show | Click | Say (honest version) |
|---|---|---|---|
| 0–5 s | The printed wearable on a wrist, then the dashboard Overview | — | "After spaceflight, standing back up in gravity can make astronauts dizzy." |
| 5–12 s | Overview | **Trigger simulated watch event** (violet). A simulated watch card slides in: HEALTH REVIEW / OPEN MISSION COMPUTER, labelled SIMULATED WATCH. | "Here the watch flags a review. This run is simulated." |
| 12–21 s | Investigation view | **Open evidence** on the card. Point at the head highlight (DIZZINESS — SELF-REPORTED), the rest and recovery medians, and +23 bpm. | "The computer shows why: a self-reported symptom, the heart-rate readings behind each number, and what is missing, like blood pressure." |
| 21–27 s | Review workflow | **Open review workflow**, tick the five items, type a reviewer (for example "Crew medical officer"), **Mark reviewed**. | "A crew medical officer documents the review. That is a record, not a clearance." |
| 27–30 s | The same page with Wi-Fi off | Turn Wi-Fi off (macOS menu bar), then click **Crew Health**. Top right reads "Network: Offline · running locally". | "All of it runs on the mission computer, with no internet." |

Turning Wi-Fi off does not affect `127.0.0.1`, so the dashboard keeps working. Turn it back on afterwards.

## Path A: real watch over Wi-Fi (only if it has been tested)

1. Stop the server and start it with `GG_LAN=1 npm start`. The terminal prints the LAN address.
2. **System Status** → **Watch integration**: copy the token for the watch app; the address is listed there too.
3. Click **Switch to mission records** in the banner. When the watch checks in, the banner shows **LIVE DEVICE** and the Watch readout shows **Link verified**. If the watch has not checked in during the last 60 s it reads **Watch unreachable**; say so rather than calling it live.
4. When the watch sends its event, it appears in Active health events within about 3 s. Continue from the 12-second row above.

## Path B: saved real recording

1. Get the exported JSON from the watch (Mustafa).
2. Banner → **Switch to mission records**, then **System Status** → **Import records** → choose the file.
3. It is labelled **SAVED DEVICE DATA**. Say "recorded on the watch earlier", not "live".

## Do not say

- "detected orthostatic intolerance", "predicts fainting", "safe to stand", "cleared for duty"
- "live" for anything simulated or imported
- "the watch measured blood pressure" (it cannot)

## If something goes wrong

- Banner says LOCAL API UNAVAILABLE: the server is not running. Run `npm start` in `dashboard/`.
- No trigger button: you are in mission records. Use the banner to open the simulated demo.
- Port in use: `GG_PORT=4318 npm start` and open that port.
