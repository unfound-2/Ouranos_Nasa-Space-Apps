# GRAVITYGUARD watch integration (contract v1)

This is everything the watch app needs to send records to the mission computer: the laptop
running the GRAVITYGUARD API and dashboard. It runs offline; nothing goes to a cloud.

What the system is not: it does not diagnose, predict fainting or clear anyone for duty, and the
watch does not measure blood pressure (blood-pressure readings only come from other instruments).
A review event asks a person to look at a record. A completed review records that a person looked.

Machine-readable files, generated from the dashboard's shared contract:

- `contracts/v1/*.schema.json`: JSON Schema (draft 2020-12) for `session`, `event`, `measurement`,
  `bundle`, `heartbeat`, `ack`, `delivery`.
- `contracts/v1/examples/*.json`: one example of each. **Every example is simulated**
  (`isSimulated: true`) because its values are invented. Section 9 lists the fields that differ in
  a real recording.

JSON Schema cannot express the cross-field rules in section 4. The computer enforces them.

---

## 1. What the watch sends, and when

| When | Request | Body |
|---|---|---|
| A recovery check is saved | `POST /api/v1/sessions` | one session |
| A watch rule fires (the rule decides a person should look) | `POST /api/v1/alerts` | one review event |
| About every 20 s while the app is open (optional, recommended) | `POST /api/v1/device/heartbeat` | heartbeat |
| With each heartbeat, to collect alerts the computer created | `GET /api/v1/device/outbox?deviceId=<id>` | none |
| After the app actually displayed an alert from the outbox | `POST /api/v1/alerts/<eventId>/delivery` | delivery report |
| After the wearer tapped acknowledge | `POST /api/v1/alerts/<eventId>/ack` | acknowledgement |
| To test the connection (no token needed, no health data) | `GET /api/v1/health` | none |

Every request from the watch carries `Authorization: Bearer <device token>`. Every POST carries
`Content-Type: application/json`. The watch cannot read sessions or alerts back (`403 LOCAL_USER_ONLY`);
only the dashboard on the laptop can.

`POST /api/v1/measurements` with `{ "measurements": [ ... ] }` (1 to 500) exists for stand-alone
readings from other instruments. The watch does not need it: heart-rate readings go inside the session.

---

## 2. Getting records to the computer

### Path A: live over the local network

> **Not verified here.** Direct HTTP from watchOS to a laptop on the local network has not been
> tested with a real watch in this project. App Transport Security needs `NSAllowsLocalNetworking`
> (under `NSAppTransportSecurity` in the app's Info.plist) for local hosts. Test this early.

1. On the laptop, in `dashboard/`: `GG_LAN=1 npm start`. It prints one `LAN:` line per
   local-network address. Without `GG_LAN=1` the server only listens on 127.0.0.1, so the watch
   cannot connect at all.
2. Get the device token from the dashboard **System Status** page (it is also in
   `dashboard/data/device-token`; the console only prints its first 4 characters).
3. From the watch, send to `http://<laptop-LAN-IP>:4317/api/v1/...` with
   `Authorization: Bearer <token>`. Use the IP the server printed, or `<laptop-hostname>.local`;
   other host names get `403 HOST_NOT_ALLOWED`.
4. First test from another device on the same network: open `http://<laptop-LAN-IP>:4317/api/v1/health`
   in a browser. It needs no token. If that fails, the watch will fail too (check the network and
   the laptop's firewall prompt for incoming connections to `node`).

Traffic is plain HTTP on the local network, so anyone on that network can see the token. Use a
trusted network. To change the token, stop the server, delete `dashboard/data/device-token` and start
again (or set `GG_DEVICE_TOKEN`), then update the watch.

### Path B: a saved file

1. The watch app writes one export bundle (section 3.7) with the sessions and events to send.
2. Get the file onto the laptop however your app shares files.
3. Import it on the dashboard **System Status** page, or from the laptop itself (no token: only
   requests from the laptop's own loopback address are accepted without one):

```bash
node -e 'const fs=require("fs");const f=process.argv[1];process.stdout.write(JSON.stringify({fileName:require("path").basename(f),content:JSON.parse(fs.readFileSync(f,"utf8"))}))' watch-export.json \
  | curl -sS -X POST http://127.0.0.1:4317/api/v1/import -H "Content-Type: application/json" --data-binary @-
```

A file is all-or-nothing: one malformed record means nothing in it is stored (`422`). Records from
a watch file are labelled saved device data, never live. The request limit is 2 MB.

### Path C: simulated data

Anything that was not measured on a person (tests, demos, generated values) must say so:
`isSimulated: true`, session `mode: "SIMULATED_DEMO"`, reading `source.kind: "SIMULATOR"`,
`provenance.origin: "DEMO_FIXTURE"`. Simulated records go to a separate demo workspace. An id that
was sent as simulated can never be re-sent as real (`409`), and one file cannot mix the two.

---

## 3. Records, field by field

Conventions for every record:

- **Keys** are exactly as written here (camelCase). An unknown or misspelled key is rejected (`422`).
- **Timestamps** are UTC ISO-8601 with a trailing `Z`: `2026-11-14T19:30:05Z`. Up to 6 fractional
  digits are allowed (`2026-11-14T19:30:05.123Z`). Offsets (`+02:00`), local times, numbers,
  impossible dates and years outside 2000 to 2100 are rejected. Use the watch's clock; the computer
  adds its own receive time.
- **Ids** use letters, digits, `.`, `_`, `:` or `-`, start with a letter or digit, at most 128
  characters. A UUID string works. Create an id once, store it with the record, never change it.
- **subjectId** is a pseudonymous crew id such as `crew-a`. Never a name. Keep names out of notes too.
- **"optional"** below means the field may be left out or sent as `null`; both are stored as `null`.
  Missing data is `null`, never `0`.
- **"omit or object"** means leave it out or send an object. `null` is rejected.
- **"computer sets"** means leave it out. The computer replaces anything sent there (it is still
  checked, so a malformed value is rejected).

### 3.1 Recovery session (`POST /api/v1/sessions`, schema `session.schema.json`)

| Field | Allowed values | Send |
|---|---|---|
| `schemaVersion` | `"gravityguard.recovery-session.v1"` | required |
| `sessionId` | id | required |
| `subjectId` | id | required |
| `protocol.id` | `GRAVITY_RECOVERY_CHECK`, `TRAINING_DEMO` | required |
| `protocol.version` | `"1.0"` (digits, dot, digits) | required |
| `protocol.plannedRestSeconds` | integer 5 to 3600 | optional |
| `protocol.plannedRecoverySeconds` | integer 5 to 3600 | optional |
| `mode` | `DEVICE_RECORDING`, `MANUAL_ENTRY`, `SIMULATED_DEMO` | required |
| `isSimulated` | `true` / `false` | required |
| `startedAt` | timestamp | required |
| `endedAt` | timestamp | optional (`null` exactly while `IN_PROGRESS`) |
| `endReason` | `COMPLETED`, `STOPPED_BY_WEARER`, `STOPPED_UNWELL`, `INTERRUPTED`, `IN_PROGRESS` | required |
| `phases` | array (at most 10) of phases, 3.2 | required, may be `[]` |
| `measurements` | array (at most 5000) of readings, 3.3 | required, may be `[]` |
| `symptomCheck.status` | `NONE_REPORTED`, `REPORTED`, `NO_RESPONSE`, `NOT_ASKED` | required |
| `symptomCheck.answeredAt` | timestamp | optional (needed for `REPORTED` and `NONE_REPORTED`) |
| `symptoms` | array (at most 50) of symptoms, 3.4 | required, may be `[]` |
| `summary` | what the watch computed, 3.5 | optional |
| `provenance.origin` | `WATCH_APP` for the watch (`DEMO_FIXTURE` when simulated) | required |
| `provenance.appVersion` | text, at most 40 | optional |
| `provenance.deviceId` | id of this watch, the same as in heartbeats | optional, but send it: it ties records to the watch and counts as contact |
| `provenance.ingestPath`, `.receivedAt`, `.importFileName` | | computer sets |
| `extensions` | any JSON object | omit or object |

### 3.2 Phase (inside `phases`)

| Field | Allowed values | Send |
|---|---|---|
| `phase` | `REST`, `RECOVERY` | required |
| `startedAt` | timestamp | required |
| `endedAt` | timestamp | optional |
| `confirmedAt` | timestamp: when "Phase confirmed" was tapped | optional |
| `confirmedBy` | `WEARER`, `SUPERVISOR` | optional |

### 3.3 Reading (inside `measurements`, schema `measurement.schema.json`)

| Field | Allowed values | Send |
|---|---|---|
| `measurementId` | id, unique within the session | required |
| `subjectId` | id, the same as the session's | required |
| `sessionId` | the session's id | optional (the computer fills it in) |
| `indicator` | `HEART_RATE`, `BLOOD_PRESSURE_SYSTOLIC`, `BLOOD_PRESSURE_DIASTOLIC` | required |
| `value` | number 0 to 1000, or `null` when the sensor gave no reading | optional |
| `unit` | `bpm` for `HEART_RATE`, `mmHg` for blood pressure | required |
| `measuredAt` | timestamp | required |
| `phase` | `REST`, `RECOVERY` | optional |
| `source.kind` | `APPLE_WATCH`, `EXTERNAL_INSTRUMENT`, `MANUAL_ENTRY`, `SIMULATOR` | required |
| `source.device` | text, at most 120 (for example `"Apple Watch"`) | optional |
| `source.sensor` | text, at most 120 (for example `"Optical heart sensor"`) | optional |
| `isSimulated` | the same as the session's | required |
| `quality` | `VALID`, `QUESTIONABLE`, `INVALID`, `MISSING` | required |
| `provenance` | inside a session leave it out (the session's is copied in) | omit or object |
| `receivedAt` | | computer sets |

### 3.4 Symptom (inside `symptoms`)

| Field | Allowed values | Send |
|---|---|---|
| `symptomId` | id, unique within the session | required |
| `code` | `DIZZY`, `WEAK`, `NAUSEATED`, `OTHER` | required |
| `reportedAt` | timestamp | required |
| `phase` | `REST`, `RECOVERY` | optional |
| `bodyRegion` | `HEAD`, `CHEST`, `ARMS`, `LEGS`, only if the person indicated one | optional |
| `reportedBy` | `SELF_REPORTED`, `CREW_OBSERVED` | required |
| `note` | text, at most 280 | optional |

### 3.5 Watch summary (`summary`)

Shown next to the computer's own recalculation, never merged into it.

| Field | Allowed values | Send |
|---|---|---|
| `status` | `RECORDED`, `INCOMPLETE`, `REVIEW_SUGGESTED` | required when `summary` is sent |
| `restMedianBpm`, `recoveryMedianBpm` | number 0 to 1000 | optional |
| `deltaBpm` | number -1000 to 1000 | optional |
| `restValidSamples`, `recoveryValidSamples` | integer 0 or more | optional |

### 3.6 Review event (`POST /api/v1/alerts`, schema `event.schema.json`)

| Field | Allowed values | Send |
|---|---|---|
| `schemaVersion` | `"gravityguard.review-event.v1"` | required |
| `eventId` | id | required |
| `subjectId` | id | required |
| `sessionId` | id of the session the rule looked at | optional |
| `createdAt` | timestamp | required |
| `origin.kind` | `WATCH_RULES` for the watch (`MISSION_COMPUTER_CHECK`, `DEMO_TRIGGER`, `DEMO_FIXTURE` are used by the computer and the demo) | required |
| `origin.ruleSet` | text, at most 60 (for example `"watch-rules 0.1"`) | optional |
| `origin.deviceId` | id | optional |
| `category` | `REVIEW_SUGGESTED`, `VERIFY_SOURCE`, `RECORDING_INCOMPLETE` | required |
| `severity` | `NOTICE`, `REVIEW`, `PRIORITY_REVIEW`: how soon the rule asks a person to look, not a clinical grade | required |
| `reasonCodes` | 1 to 20 codes, `UPPER_SNAKE_CASE`, 2 to 64 characters | required |
| `evidence[]` | at most 200 entries | required, may be `[]` |
| `evidence[].reasonCode` | one of this event's `reasonCodes` | required |
| `evidence[].kind` | `SYMPTOM`, `MEASUREMENT`, `PHASE`, `SESSION`, `DEVICE` | required |
| `evidence[].refId` | the cited `symptomId`, `measurementId`, phase name (`REST` / `RECOVERY`), `sessionId` or `deviceId` | optional |
| `evidence[].note` | text, at most 280 | optional |
| `watchMessage` | `{ "title": at most 40, "body": at most 120 }`, the text shown on the watch | optional |
| `status` | follows from `delivery` and `acknowledgement` (4.3); never `REVIEWED` or `CLOSED` | required |
| `delivery.channel` | `WATCH_LOCAL` (the watch showed its own alert), `COMPUTER_TO_WATCH`, `SIMULATED_WATCH`, `NONE` | required |
| `delivery.state` | `NOT_ATTEMPTED`, `QUEUED`, `PRESENTED`, `UNCONFIRMED`, `WATCH_UNREACHABLE` | required |
| `delivery.presentedAt` | timestamp when the app displayed it | optional (required when `PRESENTED`) |
| `delivery.hapticRequested` | `true` / `false`: the app asked watchOS for a haptic | optional |
| `delivery.lastAttemptAt` | timestamp | optional |
| `delivery.confirmedBy` | `WATCH_APP`, `SIMULATION` | optional (required when `PRESENTED`) |
| `acknowledgement` | `{ "acknowledgedAt": timestamp, "via": "WATCH" }` after the wearer tapped acknowledge | optional |
| `isSimulated` | `true` / `false` | required |
| `provenance` | as for sessions (3.1) | required |
| `review`, `statusHistory` | kept by the mission computer | must be left out (`422` if sent) |
| `extensions` | any JSON object | omit or object |

Reason codes the dashboard explains today: `SYMPTOM_REPORTED`, `SESSION_STOPPED_BY_WEARER`,
`INSUFFICIENT_HR_SAMPLES`, `PHASE_INCOMPLETE`, `HR_UNAVAILABLE`, `SYMPTOM_CHECK_UNANSWERED`,
`MISSING_BASELINE` (and the computer's own `SENSOR_DATA_STALE`, `SOURCE_REVIEW_REQUIRED`). Any other
`UPPER_SNAKE_CASE` code is stored and shown exactly as sent.

### 3.7 Export bundle (Path B file, schema `bundle.schema.json`)

| Field | Allowed values | Send |
|---|---|---|
| `schemaVersion` | `"gravityguard.export-bundle.v1"` | required |
| `exportedAt` | timestamp | required |
| `producer.app` | text, at most 60 (for example `"gravityguard-watch"`) | required |
| `producer.appVersion` | text, at most 40 | optional |
| `producer.deviceId` | id | optional |
| `producer.deviceModel` | text, at most 80 | optional |
| `sessions` | array of sessions (at most 200) | required, may be `[]` |
| `events` | array of events (at most 500) | required, may be `[]` |
| `measurements` | array of stand-alone readings (at most 5000) | omit or array |

### 3.8 Heartbeat, acknowledgement, delivery report

| Body | Field | Allowed values | Send |
|---|---|---|---|
| heartbeat | `deviceId` | id of this watch | required |
| | `subjectId` | id of the wearer | optional, but send it: alerts are queued for the watch of that subject |
| | `sentAt` | timestamp | required |
| | `appVersion` | text, at most 40 | optional |
| | `deviceModel` | text, at most 80 | optional |
| | `pendingRecords` | integer 0 to 100000: records waiting on the watch | optional |
| ack | `deviceId` | id of this watch | required |
| | `acknowledgedAt` | timestamp of the tap, saved once and re-sent unchanged | required |
| delivery | `deviceId` | id of this watch | required |
| | `presentedAt` | timestamp when the app displayed the alert | required |
| | `hapticRequested` | `true` / `false` | optional |

---

## 4. Rules the schema cannot show

### 4.1 Sessions

1. `isSimulated` is `true` exactly when `mode` is `SIMULATED_DEMO`.
2. `endedAt` is `null` exactly when `endReason` is `IN_PROGRESS`, and is not before `startedAt`.
3. `provenance.origin` `DEMO_FIXTURE` requires `isSimulated: true`.
4. Each phase (`REST`, `RECOVERY`) appears at most once; a phase does not end before it starts.
5. Every reading: same `subjectId` and same `isSimulated` as the session; `sessionId` is `null` or
   the session's id; `measurementId` unique within the session.
6. `symptomId` unique within the session.
7. `symptomCheck.status` `REPORTED` needs at least one symptom; any other status needs `symptoms: []`.
8. `REPORTED` and `NONE_REPORTED` need `symptomCheck.answeredAt`.

### 4.2 Readings

1. `unit` matches `indicator`: `HEART_RATE` is `bpm`; both blood-pressure indicators are `mmHg`.
2. `value: null` exactly when `quality` is `MISSING`.
3. `source.kind` `SIMULATOR` requires `isSimulated: true`; so does `provenance.origin` `DEMO_FIXTURE`.

### 4.3 Events

1. Leave out `review` and `statusHistory`; never send `status` `REVIEWED` or `CLOSED`.
2. `status` must be the one this table gives:

   | `acknowledgement` | `delivery.state` | `status` |
   |---|---|---|
   | present | `PRESENTED` (required) | `ACKNOWLEDGED` |
   | `null` | `PRESENTED` | `DELIVERED` |
   | `null` | `QUEUED` | `QUEUED` |
   | `null` | `UNCONFIRMED` | `DELIVERY_UNCONFIRMED` |
   | `null` | `WATCH_UNREACHABLE` | `WATCH_UNREACHABLE` |
   | `null` | `NOT_ATTEMPTED` | `CREATED` |

3. `PRESENTED` needs `presentedAt` and `confirmedBy`; `presentedAt` is only allowed with `PRESENTED`.
4. `acknowledgedAt` is not before `presentedAt`.
5. `channel` `SIMULATED_WATCH`, `confirmedBy` `SIMULATION`, `via` `SIMULATED_WATCH`, `origin.kind`
   `DEMO_TRIGGER` or `DEMO_FIXTURE`, or `provenance.origin` `DEMO_FIXTURE` all require `isSimulated: true`.
6. Every `evidence[].reasonCode` is in `reasonCodes`.

A typical event the watch showed itself: `channel` `WATCH_LOCAL`, `state` `PRESENTED`, `presentedAt`,
`confirmedBy` `WATCH_APP`, `status` `DELIVERED`. After the tap: add `acknowledgement` with
`via` `WATCH` and set `status` `ACKNOWLEDGED`.

### 4.4 Sending the same id again

- **Session:** identical content is `DUPLICATE`. While the stored copy is `IN_PROGRESS`, a newer copy
  with the same `subjectId`, `mode`, `isSimulated`, `startedAt` and `protocol` that still contains
  every earlier `measurementId` is `UPDATED`. Once a finished copy is stored, any change is `409 CONFLICT`.
- **Event:** `subjectId`, `sessionId`, `createdAt`, `origin`, `category`, `severity`, `reasonCodes`,
  `evidence`, `watchMessage` and `isSimulated` can never change (`409`). A copy whose delivery state
  moved forward (`NOT_ATTEMPTED` < `QUEUED` < `UNCONFIRMED` or `WATCH_UNREACHABLE` < `PRESENTED`) or
  which adds the acknowledgement is `UPDATED`. Any other difference in `delivery` or
  `acknowledgement` is `STALE_IGNORED`: the stored state is kept.
- **Stand-alone reading:** identical is `DUPLICATE`, different is `409`.
- **File or batch:** one malformed record means nothing is stored; simulated and real cannot mix.
- An id stored as simulated cannot be sent as real, and the reverse (`409`).

---

## 5. Swift notes

```swift
let encoder = JSONEncoder()
encoder.dateEncodingStrategy = .iso8601   // required: the default writes a Date as a Double (seconds since 2001-01-01): 422
// Keep the default key strategy; the keys must be the exact camelCase names above.

var request = URLRequest(url: URL(string: "http://192.168.1.20:4317/api/v1/sessions")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
request.httpBody = try encoder.encode(session)
```

- `.iso8601` writes UTC with `Z` (`2026-11-14T19:30:05Z`), which the contract accepts. The default
  strategy is rejected with `startedAt: Invalid input: expected string, received number`.
- Enums: `String` raw values that match exactly, for example
  `enum Indicator: String, Codable { case heartRate = "HEART_RATE" }`.
- `value` is a `Double?`. Integer fields (`plannedRestSeconds`, `restValidSamples`,
  `pendingRecords`) are `Int`.
- `isSimulated` is a non-optional `Bool`, always encoded.
- `nil` optionals may be omitted (synthesized `Codable` leaves them out). Exceptions: a reading's
  `provenance`, `extensions` and the bundle's `measurements` may be left out but must not be `null`,
  and an event must not contain `review` or `statusHistory` at all.

---

## 6. Responses

Every response is JSON. A record upload answers `{ "result": { "kind", "id", "workspace", "outcome",
"detail" }, "createdEvents": [...] }`. Every error is `{ "error": { "code", "message", "details"? } }`;
`details` lists field paths, for example `measurements.0.unit: unit for HEART_RATE must be "bpm", got "mmHg"`.

| HTTP | `outcome` or `error.code` | Meaning | What the watch does |
|---|---|---|---|
| 201 | `CREATED` | Stored. | Mark sent. |
| 200 | `DUPLICATE` | An identical copy was already stored. | Success: mark sent. |
| 200 | `UPDATED` | In-progress session extended, or delivery / acknowledgement advanced. | Success. |
| 200 | `STALE_IGNORED` | An older copy; the newer stored state was kept. | Success: mark sent. |
| 200 | (ack, delivery, heartbeat) | Applied. Body has the stored `event`, or `device`, `linkState`, `serverTime`. | Done. |
| 400 | `INVALID_JSON`, `INVALID_QUERY` | Body is not JSON, or `deviceId` missing on the outbox. | Fix the request. |
| 401 | `UNAUTHORIZED`, `INVALID_TOKEN` | Token missing (from another machine) or wrong. | Get the current token; do not loop. |
| 403 | `DEVICE_ONLY`, `LOCAL_USER_ONLY`, `HOST_NOT_ALLOWED` | Wrong caller for this endpoint, or a host name the laptop does not answer to. | Fix the URL or token. |
| 404 | `EVENT_NOT_FOUND`, `NOT_FOUND` | Unknown alert id, or no such endpoint. | Send the event before its ack. |
| 409 | `CONFLICT`, `SIMULATED_EVENT`, `ALREADY_ACKNOWLEDGED`, `NOT_PRESENTED` | Conflicts with what is stored; the stored copy was kept. | Do not resend unchanged; log it. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 2 MB. | Send smaller pieces (one session per request). |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | No `Content-Type: application/json`. | Set the header. |
| 422 | `VALIDATION_FAILED`, `WRONG_RECORD_TYPE` (a session sent to `/alerts` or the reverse), `REJECTED`, `ACK_BEFORE_PRESENTED` | Does not match the contract. Nothing was stored. | Fix the encoder; do not resend unchanged. |
| 500 | `INTERNAL_ERROR` | Bug on the computer. | Retry later, same ids. |
| 503 | `STORAGE_WRITE_FAILED`, `SHUTTING_DOWN` | Not stored. | Retry later, same ids. |

---

## 7. Retries

- Keep every record in a local outbox until it gets a 2xx answer.
- After a network error, a timeout, a 5xx or `503`: resend the **same JSON with the same ids**
  later (for example after 2, 4, 8 ... up to 60 s). Resending is always safe.
- `DUPLICATE` and `STALE_IGNORED` are success. Stop resending.
- Never change an id on retry. A new id makes a second record.
- Never resend a `409` or `422` unchanged; it will fail the same way. Show it as needing attention.
  Two exceptions: after `404 EVENT_NOT_FOUND` on an ack, send the event first, then the ack; after
  `409 NOT_PRESENTED`, send the delivery report first if the alert really was displayed.
- Send a session before the events that cite it, and an event before its ack. If an event is still
  in the watch's outbox when the wearer acknowledges it, just send the event with `acknowledgement`
  filled in.

---

## 8. Delivery and acknowledgement: what they mean

- An HTTP 200 or 201 means the computer stored the request. It is not proof that anyone saw an alert.
- Report `presentedAt` (delivery report, or `delivery.presentedAt` in an event) only after the app
  actually displayed the alert on screen.
- `hapticRequested: true` means the app asked watchOS for a haptic. watchOS does not confirm the
  wrist felt it.
- An acknowledgement means the wearer tapped acknowledge. It is not a medical review.
- The watch never sets `REVIEWED` or `CLOSED`. Only a reviewer on the mission computer does, and a
  completed review is not a medical clearance.
- Link state: a watch is `VERIFIED` only within 60 s of its last authenticated contact (heartbeat,
  record upload, ack or delivery report); after that the dashboard shows `WATCH_UNREACHABLE`.
- Alerts from the computer: when a computer check creates an alert for a subject whose watch is
  `VERIFIED`, it is queued (`QUEUED`) and listed by `GET /api/v1/device/outbox`. If the watch does
  not confirm it within 120 s it becomes `DELIVERY_UNCONFIRMED` and leaves the outbox; if the app
  displays it later anyway, still report the true `presentedAt`. If no watch was reachable when the
  alert was created, it is never queued and the dashboard shows `WATCH_UNREACHABLE`.

---

## 9. The examples are simulated: what changes for a real recording

`contracts/v1/examples/session.json`, `event.json` and `bundle.json` are flagged simulated so they
can never be stored as real data (sending one goes to the demo workspace). In a real recording,
these fields differ (and the values, timestamps and ids come from the real check):

| Record | Field | Example (simulated) | Real recording |
|---|---|---|---|
| session | `mode` | `SIMULATED_DEMO` | `DEVICE_RECORDING` |
| session | `isSimulated` | `true` | `false` |
| session | `measurements[].isSimulated` | `true` | `false` |
| session | `measurements[].source.kind` | `SIMULATOR` | `APPLE_WATCH` |
| session | `measurements[].source.device` / `.sensor` | `Simulated watch` / `Simulated heart-rate values` | the real device and sensor, for example `Apple Watch` / `Optical heart sensor` |
| session, event | `provenance.origin` | `DEMO_FIXTURE` | `WATCH_APP` |
| event | `isSimulated` | `true` | `false` |
| event | `origin.kind` | `DEMO_FIXTURE` | `WATCH_RULES` |
| event | `delivery.channel` | `SIMULATED_WATCH` | `WATCH_LOCAL` |
| event | `delivery.confirmedBy` | `SIMULATION` | `WATCH_APP` |
| event | `acknowledgement.via` (when present) | `SIMULATED_WATCH` | `WATCH` |
| bundle | `producer.deviceModel` | `Simulated watch` | the real model |

`heartbeat.json`, `ack.json` and `delivery.json` carry no readings and can be used as they are.

---

## 10. Failure modes

| What you see | Likely cause | Fix |
|---|---|---|
| Connection refused or timeout from the watch | Server not started with `GG_LAN=1`; different network; wrong IP; laptop firewall | Start with `GG_LAN=1`; use the printed LAN URL; open `/api/v1/health` from a phone browser on the same network |
| ATS error in the Xcode console | Plain HTTP to a local host blocked | Add `NSAllowsLocalNetworking` |
| `403 HOST_NOT_ALLOWED` | The URL uses a host name the laptop does not answer to | Use the printed LAN IP (or `<hostname>.local`) |
| `401 INVALID_TOKEN` | Old or mistyped token | Copy it again from System Status |
| `401 UNAUTHORIZED` | No `Authorization` header | Add `Bearer <token>` |
| `415` | No `Content-Type: application/json` | Set it on every POST |
| `422 ... expected string, received number` on a timestamp | Default `JSONEncoder` date strategy | `dateEncodingStrategy = .iso8601` |
| `422 ... unknown field(s)` | Misspelled or snake_case key | Use the exact camelCase keys |
| `422 ... a reading with no value must have quality "MISSING"` | `null` value with another quality | Send `quality: "MISSING"` |
| `422 status ... does not match delivery/acknowledgement` | `status` set by hand | Derive it with table 4.3 |
| `409 CONFLICT ... already exists with different content` | An id was reused for different content | Generate ids once; never reuse a counter |
| `409 ... a simulated record cannot become real` | A simulated id re-sent as real | Real recordings need new ids |
| `409 SIMULATED_EVENT` | Ack or delivery for a demo alert | Only real alerts take watch reports |
| `409 ALREADY_ACKNOWLEDGED` | A different `acknowledgedAt` for the same alert | Save `acknowledgedAt` at the tap; resend that value |
| `409 NOT_PRESENTED` | Ack for an alert that was never presented | Send the delivery report first |
| `404 EVENT_NOT_FOUND` on an ack | The event has not reached the computer yet | Send the event, then the ack |
| `503 STORAGE_WRITE_FAILED` | Laptop disk problem | Retry later with the same ids |
| Dashboard shows `WATCH_UNREACHABLE` | No contact for 60 s | Heartbeat about every 20 s while the app is open |
| A computer alert never reaches the watch | The watch was unreachable when it was created, or the outbox was not polled within 120 s | Heartbeat and poll the outbox together |

---

## 11. curl examples (run against a real server)

These were run on 2026-11-14 against a local test server started with
`GG_PORT=4391 GG_DATA_DIR=<temporary folder> npx tsx src/server/main.ts`, so `GG` was
`http://127.0.0.1:4391`. Outputs are copied from that run; long ones are trimmed where marked `…`.
Run from `contracts/v1/examples/`:

```bash
export GG_TOKEN='<token from the System Status page>'
GG=http://<laptop-LAN-IP>:4317        # on the laptop itself: http://127.0.0.1:4317
```

Health (no token):

```bash
curl -sS "$GG/api/v1/health"
```
```json
{"ok":true,"service":"gravityguard-mission-computer","version":"0.1.0","contractVersion":"v1","time":"2026-11-14T22:10:38.943Z","uptimeSeconds":30,"storage":{"dataDir":"…","writable":true,"lastWriteError":null},"workspaces":{"mission":{"sessions":0,"events":0,"readings":0,"devices":0},"demo":{"sessions":7,"events":4,"readings":2,"devices":2}},"network":{"bind":"127.0.0.1","lan":false}}
```

Heartbeat:

```bash
curl -sS -X POST "$GG/api/v1/device/heartbeat" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary @heartbeat.json
```
```json
{"device":{"deviceId":"example-watch-01","subjectId":"example-crew-01","isSimulated":false,"firstSeenAt":"2026-11-14T22:10:38.964Z","lastSeenAt":"2026-11-14T22:10:38.964Z","lastSyncAt":null,"appVersion":"0.1.0","deviceModel":"Apple Watch","pendingRecords":0},"linkState":"VERIFIED","serverTime":"2026-11-14T22:10:38.964Z"}
```

A session (the simulated example, so it lands in the demo workspace), then the same again:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/sessions" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary @session.json
```
```
{"result":{"kind":"SESSION","id":"example-ses-20261114-193000","workspace":"demo","outcome":"CREATED","detail":null},"createdEvents":[]}
HTTP 201
{"result":{"kind":"SESSION","id":"example-ses-20261114-193000","workspace":"demo","outcome":"DUPLICATE","detail":"identical session already stored"},"createdEvents":[]}
HTTP 200
```

An event:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/alerts" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary @event.json
```
```
{"result":{"kind":"EVENT","id":"example-evt-20261114-193156","workspace":"demo","outcome":"CREATED","detail":null},"createdEvents":[]}
HTTP 201
```

The same session with the default Swift date encoding (a number instead of a string):

```bash
sed 's/"startedAt": "2026-11-14T19:30:00Z"/"startedAt": 784848600/' session.json \
  | curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/sessions" -H "Authorization: Bearer $GG_TOKEN" \
    -H "Content-Type: application/json" --data-binary @-
```
```
{"result":{"kind":null,"id":"example-ses-20261114-193000","workspace":null,"outcome":"REJECTED","detail":"startedAt: Invalid input: expected string, received number"},"createdEvents":[],"error":{"code":"VALIDATION_FAILED","message":"The record does not match the v1 contract. Nothing was stored.","details":["startedAt: Invalid input: expected string, received number"]}}
HTTP 422
```

A watch acknowledgement for the simulated example event is refused:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/alerts/example-evt-20261114-193156/ack" \
  -H "Authorization: Bearer $GG_TOKEN" -H "Content-Type: application/json" --data-binary @ack.json
```
```
{"error":{"code":"SIMULATED_EVENT","message":"Alert example-evt-20261114-193156 exists only in the simulated demo workspace. A real watch cannot report on a simulated alert."}}
HTTP 409
```

Wrong token, and no `Content-Type`:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/device/heartbeat" -H "Authorization: Bearer not-the-right-token" \
  -H "Content-Type: application/json" --data-binary @heartbeat.json
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/device/heartbeat" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type:" --data-binary @heartbeat.json
```
```
{"error":{"code":"INVALID_TOKEN","message":"The Authorization header does not carry this computer's device token (expected \"Authorization: Bearer <token>\")."}}
HTTP 401
{"error":{"code":"UNSUPPORTED_MEDIA_TYPE","message":"POST requests must send \"Content-Type: application/json\" (send {} when there is nothing else to send)."}}
HTTP 415
```

The same file through Path B (on the laptop, no token): already stored, so both are duplicates.

```bash
node -e 'const fs=require("fs");const f=process.argv[1];process.stdout.write(JSON.stringify({fileName:require("path").basename(f),content:JSON.parse(fs.readFileSync(f,"utf8"))}))' bundle.json \
  | curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/import" -H "Content-Type: application/json" --data-binary @-
```
```
{"results":[{"kind":"SESSION","id":"example-ses-20261114-193000","workspace":"demo","outcome":"DUPLICATE","detail":"identical session already stored"},{"kind":"EVENT","id":"example-evt-20261114-193156","workspace":"demo","outcome":"DUPLICATE","detail":"identical event already stored"}],"workspaces":["demo"],"createdEvents":[]}
HTTP 200
```

### Testing the computer-to-watch alert flow (throwaway server only)

An alert reaches the outbox only when a computer check creates one for the subject of a `VERIFIED`
watch. To try the flow, start a **separate test server with a temporary `GG_DATA_DIR`**, send a
heartbeat, then type in a reading flagged `QUESTIONABLE` from the laptop. That reading is labelled
real, so never do this against the real data directory.

```bash
curl -sS -X POST "$GG/api/v1/measurements" -H "Content-Type: application/json" --data-binary '{"measurements":[{"measurementId":"test-cuff-1","subjectId":"example-crew-01","sessionId":null,"indicator":"BLOOD_PRESSURE_SYSTOLIC","value":120,"unit":"mmHg","measuredAt":"2026-11-14T22:00:00Z","phase":null,"source":{"kind":"EXTERNAL_INSTRUMENT","device":"Test cuff","sensor":null},"isSimulated":false,"quality":"QUESTIONABLE"}]}'
```
```json
{"results":[{"kind":"MEASUREMENT","id":"test-cuff-1","workspace":"mission","outcome":"CREATED","detail":null}],"createdEvents":["dq-test-cuff-1"]}
```

The watch polls its outbox:

```bash
curl -sS "$GG/api/v1/device/outbox?deviceId=example-watch-01" -H "Authorization: Bearer $GG_TOKEN"
```
```
{"deviceId":"example-watch-01","deviceKnown":true,"subjectId":"example-crew-01","serverTime":"2026-11-14T22:11:02.372Z","events":[{"schemaVersion":"gravityguard.review-event.v1","eventId":"dq-test-cuff-1","subjectId":"example-crew-01","sessionId":null,"createdAt":"2026-11-14T22:11:02.346Z","origin":{"kind":"MISSION_COMPUTER_CHECK",…},"category":"VERIFY_SOURCE","severity":"NOTICE",…,"watchMessage":{"title":"VERIFY SOURCE","body":"CHECK MISSION COMPUTER"},"status":"QUEUED","delivery":{"channel":"COMPUTER_TO_WATCH","state":"QUEUED",…},…}]}
```

After the app displayed `watchMessage`, and after the wearer tapped acknowledge (the event in each
answer is trimmed to the changed fields):

```bash
curl -sS -X POST "$GG/api/v1/alerts/dq-test-cuff-1/delivery" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary '{"deviceId":"example-watch-01","presentedAt":"2026-11-14T22:11:02Z","hapticRequested":true}'
curl -sS -X POST "$GG/api/v1/alerts/dq-test-cuff-1/ack" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary '{"deviceId":"example-watch-01","acknowledgedAt":"2026-11-14T22:11:02Z"}'
```
```
HTTP 200  {"event":{"status":"DELIVERED","delivery":{"channel":"COMPUTER_TO_WATCH","state":"PRESENTED","presentedAt":"2026-11-14T22:11:02Z","hapticRequested":true,"lastAttemptAt":"2026-11-14T22:11:02.346Z","confirmedBy":"WATCH_APP"},"acknowledgement":null,…}}
HTTP 200  {"event":{"status":"ACKNOWLEDGED","acknowledgement":{"acknowledgedAt":"2026-11-14T22:11:02Z","via":"WATCH"},"review":{"state":"NOT_STARTED",…},…}}
```

After that the outbox is empty (`"events":[]`). Sending the same ack again answers `200`; a
different `acknowledgedAt`, an unknown alert and a local-time timestamp answered:

```
{"error":{"code":"ALREADY_ACKNOWLEDGED","message":"This alert was already acknowledged."}}
HTTP 409
{"error":{"code":"EVENT_NOT_FOUND","message":"No alert evt-not-sent-yet on this computer. Send the event itself first (POST /api/v1/alerts)."}}
HTTP 404
{"error":{"code":"VALIDATION_FAILED","message":"The acknowledgement does not match the v1 contract. Nothing was stored.","details":["acknowledgedAt: must be a UTC ISO-8601 timestamp such as 2026-11-14T19:30:05Z"]}}
HTTP 422
```
