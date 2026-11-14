# GRAVITYGUARD mission dashboard

The onboard-computer side of GRAVITYGUARD: a local API that receives, checks and stores watch records, and a dashboard that turns a wrist alert into an evidence-backed health review. Everything runs on the laptop. No cloud, no external requests, no LLM.

It records and organises evidence for people to review. It does not diagnose, predict fainting, measure blood pressure on the wrist, or clear anyone for duty.

## Commands

Run everything from this folder (`dashboard/`). Node 20 or newer.

| What | Command |
|---|---|
| Install (once, needs internet) | `npm install` |
| Develop (API on 4317 + Vite on 5317, hot reload) | `npm run dev` → http://127.0.0.1:5317 |
| Build the dashboard | `npm run build` |
| Run the mission computer (offline, one process) | `npm start` → http://127.0.0.1:4317 |
| Let the watch connect over Wi-Fi | `GG_LAN=1 npm start` |
| Unit and API tests | `npm test` |
| Type-check | `npm run typecheck` |
| End-to-end tests (builds, starts a throwaway server, drives Chromium) | `npx playwright install chromium` (once), then `npm run test:e2e` |
| Regenerate the simulated fixtures | `npm run fixtures` |
| Regenerate the watch JSON Schemas in `../contracts/v1` | `npm run contracts` |

`npm start` needs a build first. After `npm install` and `npm run build`, nothing else needs the internet: fonts, icons, the astronaut figure and all analysis are bundled or local.

Environment: `GG_PORT` (default 4317), `GG_DATA_DIR` (default `dashboard/data`), `GG_LAN=1` (listen on the local network), `GG_DEVICE_TOKEN` (fix the watch token instead of generating one).

## Where records live

`dashboard/data/` (git-ignored):

- `mission.json`: real records only.
- `demo.json`: simulated records only. Seeded from `fixtures/simulated/demo-bundle.json` on first start; reset from System Status.
- `device-token`: the watch pairing token, mode 0600.

A record's `isSimulated` flag decides which file it goes to. An id that exists in one can never be written into the other, so a simulated record cannot be re-sent as real. Writes are atomic (temp file, fsync, rename), and a corrupt file stops the server with a clear error instead of being overwritten.

## Data paths and labels

| How a record arrived | Label on screen |
|---|---|
| Watch app over authenticated live sync, link verified in the last 60 s | LIVE DEVICE |
| Same, but the watch has not checked in for 60 s | SAVED DEVICE DATA |
| Watch export file imported on System Status | SAVED DEVICE DATA |
| Other JSON file imported | IMPORTED |
| Typed in on System Status (external cuff etc.) | MANUALLY ENTERED |
| Anything with `isSimulated: true` | SIMULATED DEMO (violet, on every page) |
| Nothing recorded | UNAVAILABLE |

There is no fallback: if the API is down the dashboard says so and shows nothing.

## Layout

```
src/shared/   contract (zod, v1), analysis, record store, explanations, demo fixtures (pure, tested)
src/server/   Express 5 API, JSON persistence, auth (loopback or device token), host allowlist
src/client/   React dashboard: Overview, event investigation, Crew Health, Event History, System Status
e2e/          Playwright: full flow, honesty rules, offline with WAN blocked, phone width, device path
fixtures/simulated/   deterministic SIMULATED scenarios A-F
../contracts/v1/      JSON Schemas and examples for the watch app
../docs/WATCH_INTEGRATION.md   what the watch app sends, for Mustafa
../docs/DEMO_DHRUV.md          the 30-second demo, click by click
```

## Rules the code enforces

- Missing readings stay `null`, never 0. A median needs at least 3 valid readings in a phase; the observed difference needs both medians. A personal baseline needs 3 earlier comparable sessions (same crew member, protocol, simulated flag, completed). These are product rules, not clinical thresholds.
- Event status is derived from delivery, acknowledgement and review. Only the watch can report that it showed or that the wearer acknowledged an alert; a successful HTTP send proves neither. Acknowledged is not reviewed, and reviewed is not cleared.
- Every number on screen keeps its unit, time, source device, simulated flag and quality.
- Explanations are built only from the event's own reason codes and the stored readings.
