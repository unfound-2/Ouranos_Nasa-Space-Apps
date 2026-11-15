# Watch connection test (physical Apple Watch SE)

> **Not yet run on the physical watch.** This procedure follows what the watch app
> (`AstronautHealthSystem/AstronautHealthSystem Watch App/ContentView.swift`) actually does and what
> the mission computer answers. The mission-computer side was checked on the Mac; see
> [What was checked on the Mac](#what-was-checked-on-the-mac). Nothing about the watch hardware,
> its Wi-Fi or its permission prompts has been tried yet.

The mission computer reports the connection as nine **Integration checks** (System Status page, or
`GET /api/v1/integration/checks` on the Mac). Each check is `PASS`, `FAIL` or `NOT_TESTED`, and
simulated or demo data never makes one pass. The table in step 9 lists which checks change at each
step.

What the checks can and cannot prove: a passed `pairing` means a watch app holds this computer's
pairing (it could be the app in the Xcode simulator; the mission records call it
"GRAVITYGUARD watch app (code-paired)"). A link shown as `VERIFIED` means only "authenticated
contact from a paired watch app in the last 60 s". `lan-reachable` proves the Mac answers on its
own LAN address, not that the watch can reach it. None of it is a medical result.

## Before you start

- The Mac and the watch on the **same Wi-Fi network**. If the paired iPhone is nearby, it must be
  on that network too (see troubleshooting).
- The watch app installed on the watch from Xcode with your own signing team (README step 2).
- In `dashboard/`: `npm ci` and `npm run build` done once.
- Use a **throwaway data directory** for the test. Step 7 sends a hand-made instrument feed, and
  the mission computer stores what it causes as real (non-simulated) records.

## 1. Start the mission computer on the local network

```bash
cd dashboard
GG_LAN=1 GG_DATA_DIR="$TMPDIR/gg-watch-test" npm start
```

The banner prints one line per local-network address, for example
`LAN:          http://192.168.1.23:4317/api/v1/  (for the watch)`. If macOS asks whether
**node** may accept incoming network connections, click **Allow**.

Open http://127.0.0.1:4317 on the Mac (the dashboard has to run on the Mac itself: entering a
pairing code is only accepted from this computer).

Checks now: `backend` PASS, `lan-enabled` PASS, `network-interface` PASS (it lists the address),
`lan-reachable` PASS. Everything else is `NOT_TESTED`.

Optional: run the **self-test** (`POST /api/v1/integration/selftest`, on the Mac). It sends real
HTTP requests from the Mac to its own pairing and signal endpoints, with a simulated signal that is
stored in the Demo workspace. It proves those endpoints work on the Mac. It is not proof that the
watch can connect, and it changes no check.

## 2. Find the Mac's LAN address

Use the address from the banner, or the address listed by the `network-interface` check on
System Status (`lan.addresses` in the checks). Use the Wi-Fi interface's address (usually `en0`),
not a VPN address. The console address for the watch is `http://<that address>:4317`.

## 3. On the watch: set the console address

Open GRAVITYGUARD. The home screen shows **GRAVITYGUARD**, **Crew telemetry** and the buttons
**Get pairing code**, **Set console address**, **Connect onboard**, **Watch sensors**,
**Run simulation** and **Enable health readings**.

Tap **Set console address**. In **Console address** type `http://192.168.1.23:4317` (your address)
and tap **Save address**. The address then shows in small text under the button. A physical watch
has no default address: until you save one, **Get pairing code** answers
"Enter the address shown under Watch integration on the dashboard."

## 4. Get a pairing code

Tap **Get pairing code** (it shows **Generating code…**). The watch first calls
`GET /api/v1/health` at the saved address, then `POST /api/pairing`.

- The first time, watchOS may ask to allow local network access. The reason shown is the app's own:
  "Connect to the onboard telemetry feed and send review signals to the crew dashboard." Allow it.
- On success the watch shows a code such as `ABCDE-12345`, **Share pairing link**,
  "Open on the console computer: 127.0.0.1:4317." and **Get a new code**.
- Any failure on that first call shows
  "Mission Dashboard unavailable at this address. Check the address and start the console."
  (see troubleshooting).

Checks: no change. The `pairing` detail now says a pairing code is waiting to be entered.

## 5. Pair: enter the code on the dashboard

On the Mac: **System Status → Watch connection** (sub-heading *Watch integration · connect a
watch*, step 4), type the code into **Watch pairing code** (with
or without the dash) and press **Pair watch**. Expected: "Watch paired. Readings appear here when
the watch sends them." **Share pairing link** on the watch shares
`http://127.0.0.1:4317/#pair=<code>`. It only works when opened on the Mac, where it pairs
automatically.

A code works once and expires after 5 minutes.

Within about 8 s the watch shows **Console connected** with **Disconnect console** and
**Share watch readings**. While the app is open and paired it calls `GET /api/device` every 8 s;
the mission computer records a contact at most every 20 s, and the link counts as `VERIFIED` for
60 s after the last recorded contact. Keep the app in the foreground: when the screen goes to
sleep the app pauses and stops calling.

Checks: `pairing` PASS (it names the device, `watch-…`, and the last contact). The checks' `watch`
block shows `paired: true`, the device id and `lastSeenAt`. In the mission records the watch
appears as "GRAVITYGUARD watch app (code-paired)".

## 6. Optional: share watch readings, then run the simulation

1. Tap **Share watch readings** → "Share watch measurements with the paired crew console?" →
   **Share with console**. Then tap **Watch sensors**: the screen shows **WATCH SENSORS** and
   "On-device monitoring". About every 10 s the watch sends a snapshot (wrist motion, and HealthKit
   values if **Enable health readings** was allowed) with `POST /api/watch`. The app labels this
   snapshot "Apple Watch".
   Checks: no change, because snapshots are not stored records. The checks' `watch.frame` shows
   the time and the metric names.
2. Tap **Stop monitoring**, then **Run simulation**: **SIMULATED FEED**. After a few seconds the
   watch plays a haptic and shows **Review signal** (Heart rate · Respiration), then
   "Queued for console" and "Delivered to console". The signal is simulated, so the event goes to
   the dashboard's **Demo** workspace.
   Checks: **no change**. That is expected: simulated data never passes a check.

## 7. Connect onboard: a real review signal

The watch sends a real (non-simulated) review signal only in **Connect onboard**, from a fresh
instrument feed that it flags. Without a real instrument, feed a hand-made test frame through the
adapter. That is why this test uses a throwaway data directory.

1. On the Mac, copy the **Instrument adapter token** with its **Copy** button (it is masked). It
   appears under System Status → Watch connection after you paired on that page.
2. Feed a fresh frame every 2 s from the repository root. `status: "priority"` makes the watch flag
   it on the first frame:

```bash
export GRAVITYGUARD_ADAPTER_TOKEN='<instrument adapter token>'
for i in 1 2 3 4 5 6 7 8 9 10; do
  printf '{"source":"Connection test feed (hand-made)","observedAt":%s,"channels":{"heart_rate":{"value":128,"quality":"valid","status":"priority"}}}\n' "$(date +%s)"
  sleep 2
done | node dashboard/adapter.mjs
```

   Each accepted frame prints `Accepted Connection test feed (hand-made) · 1 readings`. A frame
   older than 15 s is refused, so start the watch side while this runs.
3. On the watch: **Stop monitoring** if needed, then **Connect onboard** → **ONBOARD FEED**,
   "Receiving telemetry". The watch plays a haptic and shows **Review signal** (Heart rate), then
   "Queued for console" and "Delivered to console".

Checks: `device-ingest` PASS ("Event … arrived over the watch review signal from device
watch-…"), `record-persisted` PASS (read back from `mission.json` on disk), `watch-confirmation`
PASS (the watch app reported it displayed the alert). `dashboard-display` is decided by the
dashboard: it passes once the mission records the dashboard shows include that event (its id is
the checks' `recordId`). The event is in the **Mission** workspace under Event History, with the
reason "Watch telemetry flag".

## 8. Disconnect and clean up

On the watch: **Stop monitoring**, **Disconnect console** → "Console disconnected." Check:
`pairing` returns to `NOT_TESTED`; the record checks stay `PASS`, because the record is stored.
Stop the server with Ctrl-C and delete the throwaway folder (`rm -rf "$TMPDIR/gg-watch-test"`).

## 9. Which checks change at each step

| After step | backend | lan-enabled | network-interface | lan-reachable | pairing | device-ingest | record-persisted | dashboard-display | watch-confirmation |
|---|---|---|---|---|---|---|---|---|---|
| 1. `GG_LAN=1 npm start` | PASS | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 1. without `GG_LAN=1` | PASS | **FAIL** | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| Self-test | no change | | | | | | | | |
| 4. Get pairing code | no change | | | | | | | | |
| 5. Code entered on the dashboard | | | | | **PASS** | | | | |
| 6. Watch sensors, Run simulation | no change | | | | | | | | |
| 7. Connect onboard, review signal | | | | | PASS | **PASS** | **PASS** | PASS when the dashboard shows the record | **PASS** |
| 8. Disconnect console | | | | | NOT_TESTED | PASS | PASS | | PASS |

## Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| "Enter the address shown under Watch integration on the dashboard." | No console address saved (a physical watch has no default). | Step 3. |
| "Mission Dashboard unavailable at this address. Check the address and start the console." | The watch could not get `GET /api/v1/health` from that address. Any of: wrong address or port; server not running or started without `GG_LAN=1`; Mac firewall; different network; local network access declined; a host name the Mac does not answer to. | Check the address against step 2. Check the banner says `LAN:`. Open `http://<address>:4317/api/v1/health` in a browser on another device on the same Wi-Fi. Work through the rows below. |
| watchOS asked about local network access and it was declined | Without it the app cannot reach the Mac. | Delete the app from the watch and run it again from Xcode, then allow the prompt. |
| App Transport Security error in Xcode's console | Plain HTTP blocked. `WatchInfo.plist` already sets `NSAllowsLocalNetworking` (and `NSLocalNetworkUsageDescription`). | Use the IP address form `http://192.168.x.y:4317` (or `<mac-name>.local`). |
| macOS asked whether node may accept incoming connections and it was denied | The application firewall blocks the watch. `lan-reachable` can still PASS, because the Mac reaching itself is not blocked. | System Settings → Network → Firewall → Options: allow incoming connections for node, or turn the firewall off for the test. |
| Works with the iPhone away, fails with it nearby (or the reverse) | When the paired iPhone is nearby, the watch may send its traffic through the iPhone, so the iPhone's network is the one that matters. | Put the iPhone on the same Wi-Fi as the Mac (not cellular), or turn the iPhone's Bluetooth off for the test so the watch uses its own Wi-Fi. |
| "Code expired. Generate another." on the watch, or "This console could not use that code…" on the dashboard | Codes expire after 5 minutes and work once. | **Get a new code** and enter it promptly. |
| "Pairing expired. Generate a new code." after restarting the server | Pairings live in the server's memory and are lost when it restarts. | Pair again (steps 4 and 5). |
| "Pair the crew console first." on **Connect onboard** | Not paired. | Steps 4 and 5. |
| **ONBOARD FEED** stays at "Waiting for fresh onboard data" | No fresh adapter frames. Frames older than 15 s are dropped. | Run the adapter loop in step 7 with the current time. |
| "Console unreachable · queued" under the review signal | The watch lost the connection; it retries every 2 s while monitoring. | Check Wi-Fi; keep the app in the foreground. |
| "Waiting for permitted HealthKit samples." | HealthKit gave the app no samples (permission, or no recent data). | Only affects shared snapshots; not needed for the checks. |
| Link shows `WATCH_UNREACHABLE` on the dashboard | No recorded contact for 60 s: the app paused (screen asleep) or lost the network. | Raise the wrist and keep the app open. |

## What was checked on the Mac

Run on 2026-11-14 on the development Mac, with `GG_LAN=1 GG_PORT=4391` and a temporary data
directory. **No watch was involved**; curl stood in for the watch app.

- The server listened on all interfaces (`*:4391`). It listed two local-network addresses:
  `en0 192.168.x.x` (Wi-Fi) and `utun1 100.x.x.x` (a tunnel interface; a watch on Wi-Fi uses
  the `en0` address).
- Checks on the fresh server: `backend`, `lan-enabled`, `network-interface` and `lan-reachable`
  PASS (both addresses answered `/api/v1/health` with 200 from the Mac itself). The other five
  were `NOT_TESTED`.
- Self-test: `POST /api/pairing` (201), `POST /api/pairing/redeem` on 127.0.0.1 (200),
  `POST /api/signals` with a simulated frame (202), `DELETE /api/device` (200), all through
  `http://192.168.x.x:4391` except the redeem. The event went to the Demo workspace. Afterwards
  every check was unchanged and the mission records held no devices and no events.
- Pairing by curl over `http://192.168.x.x:4391`: code issued, code redeemed on the Mac,
  `GET /api/device` answered `{"paired":true}`, and a simulated signal was accepted (202) and stored
  in Demo only. The mission records showed the device as
  "GRAVITYGUARD watch app (code-paired)", `VERIFIED`. While paired, `pairing` was PASS and the
  four record checks stayed `NOT_TESTED`. After `DELETE /api/device`, `pairing` was `NOT_TESTED`
  again. No token text appeared in the checks or in the server log.
- Whether macOS showed a firewall prompt for node could not be observed from the command line.
  `lan-reachable` passing does not answer that either, because the Mac reaching itself is not
  filtered by the application firewall.
- The watch app compiled for the watchOS simulator without signing (Xcode 26.4,
  `xcodebuild -scheme "AstronautHealthSystem Watch App" -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build`):
  **BUILD SUCCEEDED**. The only warning was the App Intents metadata step finding no App Intents
  dependency. It was compiled only; it was not run in the simulator or installed on the watch.
