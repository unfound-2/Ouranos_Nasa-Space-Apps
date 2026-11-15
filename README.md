# GRAVITYGUARD

Dhruv’s Mission Dashboard connects to the GRAVITYGUARD watch app through the local mission computer.

1. In `dashboard/`, run `npm ci`, `npm run build`, then `npm start`. Open http://127.0.0.1:4317 on that computer.
2. Open `AstronautHealthSystem/AstronautHealthSystem.xcodeproj` in Xcode and run the watch app. The simulator uses port 4317 automatically. For a physical watch, choose your own signing team in Xcode and start the dashboard with `GG_LAN=1 npm start`. In the watch app, tap **Set console address** and enter the LAN URL shown under **System Status → Watch connection** (the Wi-Fi `en0` address). Keep the Mac and watch on the same network.
3. On the watch, tap **Get pairing code**, then **Share pairing link**. Open the link on the computer running the dashboard, or enter the code under **System Status → Watch connection**. A pairing code expires after five minutes and is single-use.
4. Tap **Run simulation** on the watch. Open the dashboard’s **Demo** workspace to see its readings under **Watch connection** and review alerts in **Event History**. Actual watch review events appear in **Mission**.

To test the connection with the physical watch step by step, follow [the watch connection test](docs/WATCH_CONNECTION_TEST.md). The mission computer reports each step as an **Integration check** (`GET /api/v1/integration/checks` on that computer). A check passes only on real records or live pairing state, never on simulated data. A paired watch app shows as "GRAVITYGUARD watch app (code-paired)", because the same app also runs in the Xcode simulator.

Real watch snapshots need **Share watch readings** on the watch. The dashboard shows the latest shared snapshot and clears it when sharing is turned off and the watch reaches the gateway. Review events are retained in the mission computer’s existing record store. Simulated events go into the demo store.

### Instrument adapter

After pairing, find the **Instrument adapter token** under **Watch connection**. It is masked; use **Copy** (or **Reveal**, which hides it again after 15 s). Set that value as `GRAVITYGUARD_ADAPTER_TOKEN` and pipe the upstream decoder’s newline-delimited JSON to `node dashboard/adapter.mjs` from the repository root. Optional `GRAVITYGUARD_GATEWAY_URL` overrides the adapter’s default of `http://127.0.0.1:4317`. Each packet carries a source label, a Unix timestamp in seconds, and named channels with values, quality, and optional status. For example:

```json
{"source":"EMU bench feed","observedAt":1794700000,"channels":{"ecg_heart_rate":{"value":74,"quality":"valid"}}}
```

Send the actual measurement time. Select **Connect onboard** on the watch to monitor fresh instrument readings. Raw instrument and watch readings appear under Watch connection. When the watch rules flag telemetry, the mission computer converts the review signal into its existing event contract so the crew can review it in the dashboard.

See [dashboard setup](dashboard/README.md) and the [native v1 watch contract](docs/WATCH_INTEGRATION.md).
