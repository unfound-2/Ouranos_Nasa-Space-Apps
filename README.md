# OURANOS

Dhruv’s Mission Dashboard connects to the OURANOS watch app through the local mission computer.

1. In `dashboard/`, run `npm ci`, `npm run build`, then `npm start`. Open http://127.0.0.1:4317 on that computer.
2. Open `AstronautHealthSystem/AstronautHealthSystem.xcodeproj` in Xcode and run the watch app. The simulator uses port 4317 automatically. For a physical watch, choose your own signing team in Xcode and start the dashboard with `GG_LAN=1 npm start`. In the watch app, tap **Set console address** and enter the LAN URL shown under **Watch connection**. Keep the Mac and watch on the same network.
3. On the watch, tap **Get pairing code**. Enter it in the dashboard under **System Status → Watch integration**. A pairing code expires after five minutes and is single-use.
4. On the watch, open **Analytics**, tap **Sim**. Open the dashboard’s **Demo** workspace to see its readings under **Watch connection** and review alerts in **Event History**. Actual watch review events appear in **Mission**.

Real watch snapshots need **Send to console** on the watch. The dashboard shows the latest shared snapshot and clears it when sharing is turned off and the watch reaches the gateway. Review events are retained in the mission computer’s existing record store. Simulated events go into the demo store.

### Instrument adapter

After pairing, find the **Instrument adapter token** under **Watch connection**. Set that value as `GRAVITYGUARD_ADAPTER_TOKEN` and pipe the upstream decoder’s newline-delimited JSON to `node dashboard/adapter.mjs` from the repository root. Optional `GRAVITYGUARD_GATEWAY_URL` overrides the adapter’s default of `http://127.0.0.1:4317`. Each packet carries a source label, a Unix timestamp in seconds, and named channels with values, quality, and optional status. For example:

```json
{"source":"EMU bench feed","observedAt":1794700000,"channels":{"ecg_heart_rate":{"value":74,"quality":"valid"}}}
```

Send the actual measurement time. Raw instrument and watch readings appear in the dashboard under **Watch connection**. On the watch, **Analytics** switches between watch sensors and simulation.

See [dashboard setup](dashboard/README.md) and the [native v1 watch contract](docs/WATCH_INTEGRATION.md).


## Hosting and license

See the [website and watch setup](dashboard/HOSTING.md) for Vercel deployment and HTTPS pairing.

Original Ouranos contributions are licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) and [asset credits](docs/CREDITS.md) for third-party terms and sources.
