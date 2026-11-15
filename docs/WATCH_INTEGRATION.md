# GRAVITYGUARD watch integration (contract v1)

This is everything the watch app needs to send records to the mission computer: the laptop
running the GRAVITYGUARD API and dashboard. It runs offline; nothing goes to a cloud.

What the system is not: it does not diagnose, predict fainting or clear anyone for duty, and the
watch does not measure blood pressure (blood-pressure readings only come from other instruments).
A review event asks a person to look at a record. A completed review records that a person looked.

> **Two ways to connect.**
>
> 1. **Code pairing and review signals.** This is what the current GRAVITYGUARD watch app does. The
>    watch asks for a code (`POST /api/pairing`), the operator enters it on the dashboard, and the
>    paired app then sends readings (`POST /api/watch`) and review signals (`POST /api/signals`)
>    with its own pairing token. The computer turns each signal into a review event (reason
>    `WATCH_TELEMETRY_FLAG`). That protocol lives in `dashboard/src/server/watch-link.ts`. How to
>    test it on the watch: [WATCH_CONNECTION_TEST.md](WATCH_CONNECTION_TEST.md).
> 2. **The v1 device-token contract** in this document: recovery sessions and review events sent
>    with `Authorization: Bearer <device token>`, or exported as files. It is for exported files
>    and a future recovery-check flow; the current watch app does not use it yet.
>
> Both end up in the same record store. The Integration checks on System Status count real records
> from either; simulated ones never count.

Machine-readable files, generated from the dashboard's shared contract:

- `contracts/v1/*.schema.json`: JSON Schema (draft 2020-12) for `session`, `event`, `measurement`,
  `bundle`, `heartbeat`, `ack`, `delivery`.
- `contracts/v1/examples/*.json`: one example of each. The session, event, bundle and heartbeat
  examples are **flagged simulated** (`isSimulated: true`) because their values are invented.
  Section 11 lists the fields that differ for a real watch.

JSON Schema cannot express the rules in section 6. The computer enforces them.

---

## 1. What the watch sends, and when

| When | Request | Body |
|---|---|---|
| A recovery check is saved, including one that was stopped or interrupted | `POST /api/v1/sessions` | one session |
| A watch rule fires (section 5 lists the situations) | `POST /api/v1/alerts` | one review event |
| About every 20 s while the app is open (optional, recommended) | `POST /api/v1/device/heartbeat` | heartbeat |
| With each heartbeat, to collect alerts the computer created | `GET /api/v1/device/outbox?deviceId=<id>` | none |
| After the app actually displayed an alert from the outbox | `POST /api/v1/alerts/<eventId>/delivery` | delivery report |
| After the wearer tapped acknowledge | `POST /api/v1/alerts/<eventId>/ack` | acknowledgement |
| To test the connection (no token needed, no health data) | `GET /api/v1/health` | none |

Every request from the watch carries `Authorization: Bearer <device token>`. Every POST carries
`Content-Type: application/json`. The watch cannot read sessions or alerts back (`403 LOCAL_USER_ONLY`);
section 8 lists exactly what it gets back.

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

1. The watch app writes one export bundle (section 4.7) with the sessions and events to send.
2. Get the file onto the laptop however your app shares files.
3. Import it on the dashboard **System Status** page, or from the laptop itself (no token: only
   requests from the laptop's own loopback address are accepted without one):

```bash
node -e 'const fs=require("fs");const f=process.argv[1];process.stdout.write(JSON.stringify({fileName:require("path").basename(f),content:JSON.parse(fs.readFileSync(f,"utf8"))}))' watch-export.json \
  | curl -sS -X POST http://127.0.0.1:4317/api/v1/import -H "Content-Type: application/json" --data-binary @-
```

A file is all-or-nothing: one malformed record means nothing in it is stored (`422`). Records from
a watch file are labelled saved device data, never live. A file can add new events with their own
delivery and acknowledgement, but it can never advance the delivery or acknowledgement of an event
that is already stored (`409`, section 6.5): only the watch reports those, over the device API. So
when moving events by file, export each event once its delivery and acknowledgement are final.
The request limit is 2 MB.

### Path C: simulated data

Anything that was not measured on a person (tests, demos, generated values) must say so:
`isSimulated: true`, session `mode: "SIMULATED_DEMO"`, reading `source.kind: "SIMULATOR"`,
`provenance.origin: "DEMO_FIXTURE"`. A test client's heartbeat also says `isSimulated: true`.
Simulated records and devices go to a separate demo workspace. An id that was sent as simulated can
never be re-sent as real (`409`), and one file cannot mix the two. A real person doing a training
check on the real watch is real data (section 5).

---

## 3. Vocabulary

Every enum value, exactly as sent.

### 3.1 Sessions

| Field | Value | Meaning |
|---|---|---|
| `protocol.id` | `GRAVITY_RECOVERY_CHECK` | The gravity-recovery heart-rate check. |
| | `TRAINING_DEMO` | A training run of the check. Never compared with `GRAVITY_RECOVERY_CHECK` sessions for the personal baseline. |
| `mode` | `DEVICE_RECORDING` | Recorded by the watch on a person. |
| | `MANUAL_ENTRY` | Typed in by a person (not used by the watch). |
| | `SIMULATED_DEMO` | Simulated or generated values. Requires `isSimulated: true`. |
| `endReason` | `COMPLETED` | The check ran to the end and was saved. |
| | `STOPPED_BY_WEARER` | The wearer ended it early without saying they were unwell. |
| | `STOPPED_UNWELL` | The wearer ended it with "Stop / I'm unwell". |
| | `INTERRUPTED` | The app was killed and a partial session was recovered on relaunch. |
| | `IN_PROGRESS` | Still running: a partial copy sent early. `endedAt` is `null`. |
| `heartRateAccess` | `AUTHORIZED` | The app could read heart rate. |
| | `DENIED` | The app knows heart-rate access was refused. |
| | `NOT_DETERMINED` | The app does not know (never asked, or cannot tell). |
| | `UNAVAILABLE` | Heart rate could not be read for another reason, for example the sensor or HealthKit was not available. |
| `symptomCheck.status` | `NONE_REPORTED` | The wearer answered "None". |
| | `REPORTED` | The wearer chose one or more symptoms. |
| | `NO_RESPONSE` | The question was shown and not answered. |
| | `NOT_ASKED` | The check ended before the question was shown. |
| `phases[].phase`, `phase` | `REST` | The rest phase of the check. |
| | `RECOVERY` | The recovery phase that follows it. |
| `phases[].confirmedBy` | `WEARER` / `SUPERVISOR` | Who tapped "Phase confirmed". |
| `symptoms[].code` | `DIZZY`, `WEAK`, `NAUSEATED`, `OTHER` | The answer chosen. |
| `symptoms[].bodyRegion` | `HEAD`, `CHEST`, `ARMS`, `LEGS` | Where the person said they felt it. Only when they indicated a place. |
| `symptoms[].reportedBy` | `SELF_REPORTED` | The wearer reported it. |
| | `CREW_OBSERVED` | Another crew member reported what they saw. |
| `summary.status` | `RECORDED` | The watch recorded the check and its rules did not ask for a review. |
| | `INCOMPLETE` | The watch could not compute its summary, for example too few readings. |
| | `REVIEW_SUGGESTED` | The watch's rules asked for a review. |

### 3.2 Readings

| Field | Value | Meaning |
|---|---|---|
| `indicator` | `HEART_RATE` | Heart rate, in `bpm`. |
| | `BLOOD_PRESSURE_SYSTOLIC`, `BLOOD_PRESSURE_DIASTOLIC` | Blood pressure, in `mmHg`, only from another instrument. |
| `unit` | `bpm` / `mmHg` | Beats per minute / millimetres of mercury. |
| `quality` | `VALID` | A usable value. |
| | `QUESTIONABLE` | A value the sensor or app flagged as doubtful. |
| | `INVALID` | A value the source marked unusable. |
| | `MISSING` | A real sample attempt at a real time that produced no value. `value` is `null`. |
| `source.kind` | `APPLE_WATCH` | The watch's sensor. |
| | `EXTERNAL_INSTRUMENT` | Another device, such as a blood-pressure cuff. |
| | `MANUAL_ENTRY` | Typed in by a person. |
| | `SIMULATOR` | Simulated values. Requires `isSimulated: true`. |

### 3.3 Provenance origin (`provenance.origin`)

| Value | Meaning |
|---|---|
| `WATCH_APP` | Sent by the watch app. The value a real watch sends. |
| `DEMO_FIXTURE` | Simulated data. Only with `isSimulated: true`. |
| `MISSION_COMPUTER` | Created by this computer (its data checks). The watch never sends it. |
| `EXTERNAL_SYSTEM` | From another system, such as an instrument export. |

No response to the watch contains provenance (section 8), so the watch never has to decode it.

### 3.4 Review events

| Field | Value | Meaning |
|---|---|---|
| `category` | `REVIEW_SUGGESTED` | A person should look at this check, for example a symptom was reported. |
| | `RECORDING_INCOMPLETE` | The check could not be recorded completely. |
| | `VERIFY_SOURCE` | A person should check where a reading came from. Created by the computer. |
| `severity` | `NOTICE` / `REVIEW` / `PRIORITY_REVIEW` | How soon the rule asks a person to look: when convenient / soon / first. Not a clinical grade. |
| `origin.kind` | `WATCH_RULES` | Created by the watch's rules. The value a real watch sends. |
| | `DEMO_FIXTURE`, `DEMO_TRIGGER` | Simulated demo events. Require `isSimulated: true`. |
| | `MISSION_COMPUTER_CHECK` | Created by this computer. A producer may not send it (`422`). |
| `evidence[].kind` | `SYMPTOM`, `MEASUREMENT`, `PHASE`, `SESSION`, `DEVICE` | What `refId` names: a `symptomId`, a `measurementId`, a phase name (`REST` or `RECOVERY`), a `sessionId` or a `deviceId`. |
| `status` | `CREATED` | Not shown on any watch yet. |
| | `QUEUED` | Waiting in the computer's outbox for the watch. |
| | `DELIVERED` | Displayed on the watch. |
| | `ACKNOWLEDGED` | The wearer tapped acknowledge. Not a medical review. |
| | `DELIVERY_UNCONFIRMED` | The computer queued it and no display was confirmed within 120 s. |
| | `WATCH_UNREACHABLE` | The computer could not send it: no watch was reachable. |
| | `REVIEWED`, `CLOSED` | Set only by a reviewer on the computer. The watch never sends them. |
| `delivery.channel` | `WATCH_LOCAL` | The watch showed its own alert. |
| | `COMPUTER_TO_WATCH` | The computer created it; the watch collects it from the outbox. |
| | `SIMULATED_WATCH` | Simulated demo delivery. Requires `isSimulated: true`. |
| | `NONE` | Not meant to be shown on a watch. |
| `delivery.state` | `NOT_ATTEMPTED` | Not shown yet. |
| | `QUEUED` | Waiting for the watch. |
| | `PRESENTED` | The app displayed it. |
| | `UNCONFIRMED` | No display was confirmed in time. |
| | `WATCH_UNREACHABLE` | It could not be sent. |
| `delivery.confirmedBy` | `WATCH_APP` / `SIMULATION` | Who reported the display: the watch app / the demo simulation. |
| `acknowledgement.via` | `WATCH` / `SIMULATED_WATCH` | Tapped on the real watch / simulated. |

### 3.5 Responses

| Field | Value | Meaning |
|---|---|---|
| `result.outcome` | `CREATED`, `DUPLICATE`, `UPDATED`, `STALE_IGNORED`, `CONFLICT`, `REJECTED` | Section 8. |
| `linkState` | `VERIFIED` | An authenticated contact from this paired watch app within the last 60 s. It does not show which hardware the app runs on. |
| | `WATCH_UNREACHABLE` | Known watch, no contact for more than 60 s. |
| | `NOT_PAIRED` | No watch has checked in for this subject. |
| | `SIMULATED` | A simulated device. Never shown as live. |

---

## 4. Records, field by field

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

### 4.1 Recovery session (`POST /api/v1/sessions`, schema `session.schema.json`)

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
| `phases` | array (at most 10) of phases, 4.2 | required, may be `[]` |
| `measurements` | array (at most 5000) of readings, 4.3 | required, may be `[]` |
| `symptomCheck.status` | `NONE_REPORTED`, `REPORTED`, `NO_RESPONSE`, `NOT_ASKED` | required |
| `symptomCheck.answeredAt` | timestamp | optional (needed for `REPORTED` and `NONE_REPORTED`) |
| `symptoms` | array (at most 50) of symptoms, 4.4 | required, may be `[]` |
| `summary` | what the watch computed, 4.5 | optional |
| `heartRateAccess` | `AUTHORIZED`, `DENIED`, `NOT_DETERMINED`, `UNAVAILABLE` (3.1) | optional |
| `provenance.origin` | `WATCH_APP` for the watch (`DEMO_FIXTURE` when simulated) | required |
| `provenance.appVersion` | text, at most 40 | optional |
| `provenance.deviceId` | id of this watch, the same as in heartbeats | optional, but send it: it ties records to the watch and counts as contact |
| `provenance.ingestPath`, `.receivedAt`, `.importFileName` | | computer sets |
| `extensions` | any JSON object, at most 8 levels deep and 8192 bytes (6.4) | omit or object |

### 4.2 Phase (inside `phases`)

| Field | Allowed values | Send |
|---|---|---|
| `phase` | `REST`, `RECOVERY` | required |
| `startedAt` | timestamp | required |
| `endedAt` | timestamp | optional (leave it out if the phase never ended) |
| `confirmedAt` | timestamp: when "Phase confirmed" was tapped | optional |
| `confirmedBy` | `WEARER`, `SUPERVISOR` | optional |

### 4.3 Reading (inside `measurements`, schema `measurement.schema.json`)

| Field | Allowed values | Send |
|---|---|---|
| `measurementId` | id, unique within the session | required |
| `subjectId` | id, the same as the session's | required |
| `sessionId` | the session's id | optional (the computer fills it in) |
| `indicator` | `HEART_RATE`, `BLOOD_PRESSURE_SYSTOLIC`, `BLOOD_PRESSURE_DIASTOLIC` | required |
| `value` | number 0 to 1000, or `null` when a real sample attempt gave no reading | optional |
| `unit` | `bpm` for `HEART_RATE`, `mmHg` for blood pressure | required |
| `measuredAt` | timestamp of the sample (or of the real attempt) | required |
| `phase` | `REST`, `RECOVERY` | optional |
| `source.kind` | `APPLE_WATCH`, `EXTERNAL_INSTRUMENT`, `MANUAL_ENTRY`, `SIMULATOR` | required |
| `source.device` | text, at most 120 (for example `"Apple Watch"`) | optional |
| `source.sensor` | text, at most 120 (for example `"Optical heart sensor"`) | optional |
| `isSimulated` | the same as the session's | required |
| `quality` | `VALID`, `QUESTIONABLE`, `INVALID`, `MISSING` | required |
| `provenance` | inside a session leave it out (the session's is copied in) | omit or object |
| `receivedAt` | | computer sets |

Readings have no `extensions` field.

### 4.4 Symptom (inside `symptoms`)

| Field | Allowed values | Send |
|---|---|---|
| `symptomId` | id, unique within the session | required |
| `code` | `DIZZY`, `WEAK`, `NAUSEATED`, `OTHER` | required |
| `reportedAt` | timestamp | required |
| `phase` | `REST`, `RECOVERY` | optional |
| `bodyRegion` | `HEAD`, `CHEST`, `ARMS`, `LEGS`, only if the person indicated one | optional |
| `reportedBy` | `SELF_REPORTED`, `CREW_OBSERVED` | required |
| `note` | text, at most 280 | optional |

### 4.5 Watch summary (`summary`)

Shown next to the computer's own recalculation, never merged into it.

| Field | Allowed values | Send |
|---|---|---|
| `status` | `RECORDED`, `INCOMPLETE`, `REVIEW_SUGGESTED` | required when `summary` is sent |
| `restMedianBpm`, `recoveryMedianBpm` | number 0 to 1000 | optional |
| `deltaBpm` | number -1000 to 1000 | optional |
| `restValidSamples`, `recoveryValidSamples` | integer 0 or more | optional |

### 4.6 Review event (`POST /api/v1/alerts`, schema `event.schema.json`)

| Field | Allowed values | Send |
|---|---|---|
| `schemaVersion` | `"gravityguard.review-event.v1"` | required |
| `eventId` | id | required |
| `subjectId` | id | required |
| `sessionId` | id of the session the rule looked at, same subject | optional |
| `createdAt` | timestamp | required |
| `origin.kind` | `WATCH_RULES` for the watch (`DEMO_TRIGGER`, `DEMO_FIXTURE` are simulated) | required |
| `origin.ruleSet` | text, at most 60 (for example `"watch-rules 0.1"`) | optional |
| `origin.deviceId` | id | optional |
| `category` | `REVIEW_SUGGESTED`, `VERIFY_SOURCE`, `RECORDING_INCOMPLETE` | required |
| `severity` | `NOTICE`, `REVIEW`, `PRIORITY_REVIEW` | required |
| `reasonCodes` | 1 to 20 codes, `UPPER_SNAKE_CASE`, 2 to 64 characters | required |
| `evidence[]` | at most 200 entries | required, may be `[]` |
| `evidence[].reasonCode` | one of this event's `reasonCodes` | required |
| `evidence[].kind` | `SYMPTOM`, `MEASUREMENT`, `PHASE`, `SESSION`, `DEVICE` | required |
| `evidence[].refId` | the cited `symptomId`, `measurementId`, phase name (`REST` / `RECOVERY`), `sessionId` or `deviceId` | optional |
| `evidence[].note` | text, at most 280 | optional |
| `watchMessage` | `{ "title": at most 40, "body": at most 120 }`, the text shown on the watch | optional |
| `status` | follows from `delivery` and `acknowledgement` (6.3); never `REVIEWED` or `CLOSED` | required |
| `delivery.channel` | `WATCH_LOCAL` (the watch showed its own alert), `COMPUTER_TO_WATCH`, `SIMULATED_WATCH`, `NONE` | required |
| `delivery.state` | `NOT_ATTEMPTED`, `QUEUED`, `PRESENTED`, `UNCONFIRMED`, `WATCH_UNREACHABLE` | required |
| `delivery.presentedAt` | timestamp when the app displayed it | optional (required when `PRESENTED`) |
| `delivery.hapticRequested` | `true` / `false`: the app asked watchOS for a haptic | optional |
| `delivery.lastAttemptAt` | timestamp | optional |
| `delivery.confirmedBy` | `WATCH_APP`, `SIMULATION` | optional (required when `PRESENTED`) |
| `delivery.confirmedByDeviceId` | id of the watch that displayed it | optional; when left out the computer uses `provenance.deviceId` |
| `acknowledgement` | `{ "acknowledgedAt": timestamp, "via": "WATCH", "deviceId": id }` after the wearer tapped acknowledge | optional |
| `acknowledgement.deviceId` | id of the watch it was acknowledged on | optional; when left out the computer uses `provenance.deviceId` |
| `isSimulated` | `true` / `false` | required |
| `provenance` | as for sessions (4.1) | required |
| `review`, `statusHistory` | kept by the mission computer | must be left out (`422` if sent) |
| `extensions` | any JSON object, at most 8 levels deep and 8192 bytes (6.4) | omit or object |

Reason codes the dashboard explains: `SYMPTOM_REPORTED`, `SESSION_STOPPED_UNWELL`,
`SESSION_STOPPED_BY_WEARER`, `SYMPTOM_CHECK_UNANSWERED`, `HR_UNAVAILABLE`, `INSUFFICIENT_HR_SAMPLES`,
`PHASE_INCOMPLETE`, `MISSING_BASELINE` (and the computer's own `SENSOR_DATA_STALE`,
`SOURCE_REVIEW_REQUIRED`). Any other `UPPER_SNAKE_CASE` code is stored and shown exactly as sent.

### 4.7 Export bundle (Path B file, schema `bundle.schema.json`)

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

### 4.8 Heartbeat, acknowledgement, delivery report

| Body | Field | Allowed values | Send |
|---|---|---|---|
| heartbeat | `deviceId` | id of this watch | required |
| | `subjectId` | id of the wearer | optional, but send it: it binds the watch to that subject (6.6) and alerts are queued for it |
| | `sentAt` | timestamp | required |
| | `appVersion` | text, at most 40 | optional |
| | `deviceModel` | text, at most 80 | optional |
| | `pendingRecords` | integer 0 to 100000: records waiting on the watch | optional |
| | `isSimulated` | `false` for a real watch (the default when left out); `true` only from a test or demo client, which then appears only in the demo workspace | optional |
| ack | `deviceId` | id of this watch; stored as `acknowledgement.deviceId` | required |
| | `acknowledgedAt` | timestamp of the tap, saved once and re-sent unchanged | required |
| delivery | `deviceId` | id of this watch; stored as `delivery.confirmedByDeviceId` | required |
| | `presentedAt` | timestamp when the app displayed the alert | required |
| | `hapticRequested` | `true` / `false` | optional |

---

## 5. Situations on the watch

What to send in each situation. "Event" is the review event the watch sends with `POST /api/v1/alerts`.
Its evidence cites records by id (`SYMPTOM` by `symptomId`, `SESSION` by `sessionId`, `PHASE` by
`REST` or `RECOVERY`).

| Situation | `endReason` | `symptomCheck.status` / `answeredAt` | `heartRateAccess` | Event (`category`, `severity`, `reasonCodes`, evidence) |
|---|---|---|---|---|
| Normal check, the wearer answers "None" | `COMPLETED` | `NONE_REPORTED` / tap time | `AUTHORIZED` | none |
| The wearer chooses Dizzy, Weak, Nauseated or Other (several allowed) | `COMPLETED` | `REPORTED` / tap time; one symptom per code chosen | `AUTHORIZED` | `REVIEW_SUGGESTED`, `REVIEW`, `[SYMPTOM_REPORTED]`, one `SYMPTOM` ref per symptom |
| "No response" to the symptom question | `COMPLETED` | `NO_RESPONSE` / `null` | `AUTHORIZED` | optional: `RECORDING_INCOMPLETE`, `NOTICE`, `[SYMPTOM_CHECK_UNANSWERED]`, a `SESSION` ref |
| "Stop / I'm unwell" | `STOPPED_UNWELL`, `endedAt` = the stop time; phases may have no `endedAt` | `NOT_ASKED` / `null` if stopped before the question | as known | `REVIEW_SUGGESTED`, `PRIORITY_REVIEW`, `[SESSION_STOPPED_UNWELL]`, a `SESSION` ref |
| A plain stop without "unwell" (if the app has one) | `STOPPED_BY_WEARER`, `endedAt` = the stop time | `NOT_ASKED` / `null` if stopped before the question | as known | `RECORDING_INCOMPLETE`, `NOTICE`, `[SESSION_STOPPED_BY_WEARER]`, a `SESSION` ref |
| Heart-rate permission denied | as the check ended | as answered | `DENIED`; `measurements: []` | `RECORDING_INCOMPLETE`, `NOTICE`, `[HR_UNAVAILABLE]`, a `SESSION` ref |
| Fewer than 3 valid readings in a phase | as the check ended | as answered | `AUTHORIZED` | `RECORDING_INCOMPLETE`, `NOTICE`, `[INSUFFICIENT_HR_SAMPLES]`, a `PHASE` ref per short phase |
| The app was killed; a partial session was recovered on relaunch | `INTERRUPTED`, `endedAt` = the last time the app saved anything for the check | `NOT_ASKED` / `null` if not reached | as known | none required |
| Training run | as above | as above | as above | as above |

For every event the watch shows itself: `delivery.channel` `WATCH_LOCAL`. Until the alert has
actually been shown, `state` `NOT_ATTEMPTED` and `status` `CREATED`; once shown, send the same event
again with `state` `PRESENTED`, `presentedAt`, `confirmedBy` `WATCH_APP` and `status` `DELIVERED`.

- **No readings** is `measurements: []`. A `MISSING` reading is only for a real sample attempt at a
  real time. Never invent attempt timestamps.
- **Training runs** use `protocol.id` `TRAINING_DEMO`. A real volunteer on the real watch is real
  data: `isSimulated: false`, `mode` `DEVICE_RECORDING`, `source.kind` `APPLE_WATCH`. Only simulator
  or generated values are `isSimulated: true`. Training sessions are never compared with
  `GRAVITY_RECOVERY_CHECK` sessions for the baseline.
- **Severity** says how soon the rule asks a person to look. It is not a diagnosis.

---

## 6. Rules the schema cannot show

### 6.1 Sessions

1. `isSimulated` is `true` exactly when `mode` is `SIMULATED_DEMO`.
2. `endedAt` is `null` exactly when `endReason` is `IN_PROGRESS`, and is not before `startedAt`.
3. `provenance.origin` `DEMO_FIXTURE` requires `isSimulated: true`.
4. Each phase (`REST`, `RECOVERY`) appears at most once; a phase does not end before it starts.
5. Every reading: same `subjectId` and same `isSimulated` as the session; `sessionId` is `null` or
   the session's id; `measurementId` unique within the session.
6. `symptomId` unique within the session.
7. `symptomCheck.status` `REPORTED` needs at least one symptom; any other status needs `symptoms: []`.
8. `REPORTED` and `NONE_REPORTED` need `symptomCheck.answeredAt`.
9. A new session is refused (`REJECTED`) when stored readings or events already name its `sessionId`
   under another `subjectId`. In the other order, the reading or event is the one refused, so a
   session and the records that cite it always belong to the same subject.

### 6.2 Readings

1. `unit` matches `indicator`: `HEART_RATE` is `bpm`; both blood-pressure indicators are `mmHg`.
2. `value: null` exactly when `quality` is `MISSING`.
3. `source.kind` `SIMULATOR` requires `isSimulated: true`; so does `provenance.origin` `DEMO_FIXTURE`.
4. A stand-alone reading whose `sessionId` names a stored session of another subject is refused.

### 6.3 Events

1. Leave out `review` and `statusHistory`; never send `status` `REVIEWED` or `CLOSED`; never send
   `origin.kind` `MISSION_COMPUTER_CHECK`.
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
5. For `delivery.channel` `WATCH_LOCAL` all three times come from the watch clock: `presentedAt`
   is not more than 1 s before `createdAt`, and `acknowledgedAt` is not before `createdAt`.
6. `channel` `SIMULATED_WATCH`, `confirmedBy` `SIMULATION`, `via` `SIMULATED_WATCH`, `origin.kind`
   `DEMO_TRIGGER` or `DEMO_FIXTURE`, or `provenance.origin` `DEMO_FIXTURE` all require `isSimulated: true`.
7. Every `evidence[].reasonCode` is in `reasonCodes`.
8. An event whose `sessionId` names a stored session of another subject is refused (`REJECTED`).

### 6.4 `extensions`

Sessions and events may carry `extensions`: free-form data, stored as sent and never interpreted.
It may be at most 8 levels of objects and arrays deep, counting `extensions` itself (so
`{"a": {"b": 1}}` is 2 levels), and at most 8192 bytes as UTF-8 JSON. Larger or deeper is `422`.

### 6.5 Sending the same id again

- **Session:** identical content is `DUPLICATE`. While the stored copy is `IN_PROGRESS`, a newer copy
  with the same `subjectId`, `mode`, `isSimulated`, `startedAt` and `protocol` that still contains
  every earlier `measurementId` is `UPDATED`. An **older** in-progress copy arriving late (same
  identity, `endReason` `IN_PROGRESS`, all of its `measurementId`s already stored) is
  `STALE_IGNORED`, whether the stored copy is still in progress or already finished. Any other change
  to a finished session is `409 CONFLICT`.
- **Event:** `subjectId`, `sessionId`, `createdAt`, `origin`, `category`, `severity`, `reasonCodes`,
  `evidence`, `watchMessage` and `isSimulated` can never change (`409`).
  - Same `delivery` and `acknowledgement`: `DUPLICATE`. If only `provenance` or `extensions`
    differ, the detail says `already stored; provenance and extensions are kept from the first copy`.
  - A copy whose delivery moved forward (`NOT_ATTEMPTED` < `QUEUED` < `UNCONFIRMED` or
    `WATCH_UNREACHABLE` < `PRESENTED`) or which adds the acknowledgement: `UPDATED`, but only when
    the watch sends it live. From a file it is `409` with the detail
    `delivery and acknowledgement of a stored event can only be reported by the watch over the device API`.
  - Any other difference in `delivery` or `acknowledgement`: `STALE_IGNORED`; the stored state is kept.
  - `confirmedByDeviceId` and `acknowledgement.deviceId` are kept from the copy that first reported them.
- **Stand-alone reading:** identical is `DUPLICATE`, different is `409`.
- **File or batch:** one malformed record means nothing is stored; simulated and real cannot mix.
- An id stored as simulated cannot be sent as real, and the reverse (`409`).

### 6.6 Which watch may report

The computer binds a watch (by `deviceId`) to one subject: the `subjectId` of its latest heartbeat
that names one (a heartbeat without `subjectId` keeps the binding), or, before that, the subject of
its first live record or report. A watch bound to another subject cannot report
on an alert: delivery reports and acknowledgements answer `409 DEVICE_SUBJECT_MISMATCH`, and a live
re-send of the event that would advance it answers `409 CONFLICT`. The computer records which watch
reported (`delivery.confirmedByDeviceId`, `acknowledgement.deviceId`) and names it in the alert's
history on the dashboard.

---

## 7. Swift notes

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
- `isSimulated` is a non-optional `Bool`, always encoded on sessions, readings and events. On the
  heartbeat it may be left out (it means `false`).
- `heartRateAccess` is a `String` enum with the four values in 3.1. HealthKit may not tell an app
  whether read access was refused (to the app, a refused read can look like no data). Send `DENIED`
  only when the app knows; otherwise `NOT_DETERMINED`.
- `nil` optionals may be omitted (synthesized `Codable` leaves them out). Exceptions: a reading's
  `provenance`, `extensions` and the bundle's `measurements` may be left out but must not be `null`,
  and an event must not contain `review` or `statusHistory` at all.
- When decoding responses, accept unknown keys: the computer may add fields to responses.

---

## 8. Responses

Every response is JSON. Every error is `{ "error": { "code", "message", "details"? } }`; `details`
lists field paths, for example `measurements.0.unit: unit for HEART_RATE must be "bpm", got "mmHg"`.
No response to the watch contains review notes, reviewer names, evidence, history or provenance.

What each watch request gets back on success:

| Request | Body |
|---|---|
| `POST /sessions`, `POST /alerts` | `{ "result": { "kind", "id", "workspace", "outcome", "detail" }, "createdEvents": [ids] }`. Error answers keep `result` next to `error`. |
| `POST /device/heartbeat` | `{ "device": { "deviceId", "subjectId", "isSimulated", "firstSeenAt", "lastSeenAt", "lastSyncAt", "appVersion", "deviceModel", "pendingRecords" }, "linkState", "serverTime" }` |
| `GET /device/outbox` | `{ "deviceId", "deviceKnown", "subjectId", "serverTime", "events": [ { "eventId", "subjectId", "createdAt", "category", "severity", "reasonCodes", "watchMessage", "delivery": { "channel", "state" } } ] }`, oldest first |
| `POST /alerts/{id}/delivery`, `POST /alerts/{id}/ack` | `{ "event": { "eventId", "subjectId", "createdAt", "category", "severity", "reasonCodes", "watchMessage", "status", "delivery": { "channel", "state", "presentedAt", "hapticRequested", "confirmedBy", "confirmedByDeviceId" }, "acknowledgement": { "acknowledgedAt", "via", "deviceId" } or null } }` |

`status` in these answers can be `REVIEWED` or `CLOSED` once a reviewer has acted. That records that
a person looked; it is not a medical clearance, so the watch should not present it as one.

| HTTP | `outcome` or `error.code` | Meaning | What the watch does |
|---|---|---|---|
| 201 | `CREATED` | Stored. | Mark sent. |
| 200 | `DUPLICATE` | An identical copy (or one differing only in provenance or extensions) was already stored. | Success: mark sent. |
| 200 | `UPDATED` | In-progress session extended, or delivery / acknowledgement advanced. | Success. |
| 200 | `STALE_IGNORED` | An older copy; the newer stored state was kept. | Success: mark sent. |
| 200 | (ack, delivery, heartbeat) | Applied. | Done. |
| 400 | `INVALID_JSON`, `INVALID_QUERY` | Body is not JSON, or `deviceId` missing on the outbox. | Fix the request. |
| 401 | `UNAUTHORIZED`, `INVALID_TOKEN` | Token missing (from another machine) or wrong. | Get the current token; do not loop. |
| 403 | `DEVICE_ONLY`, `LOCAL_USER_ONLY`, `HOST_NOT_ALLOWED` | Wrong caller for this endpoint, or a host name the laptop does not answer to. | Fix the URL or token. |
| 404 | `EVENT_NOT_FOUND`, `NOT_FOUND` | Unknown alert id, or no such endpoint. | Send the event before its ack. |
| 409 | `CONFLICT`, `SIMULATED_EVENT`, `ALREADY_ACKNOWLEDGED`, `NOT_PRESENTED`, `DEVICE_SUBJECT_MISMATCH` | Conflicts with what is stored; the stored copy was kept. | Do not resend unchanged; log it. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 2 MB. | Send smaller pieces (one session per request). |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | No `Content-Type: application/json`. | Set the header. |
| 422 | `VALIDATION_FAILED`, `WRONG_RECORD_TYPE` (a session sent to `/alerts` or the reverse), `REJECTED`, `ACK_BEFORE_PRESENTED` | Does not match the contract, or links to another subject's session. Nothing was stored. | Fix the record; do not resend unchanged. |
| 500 | `INTERNAL_ERROR`, `UNSTORABLE_CHANGE` | A bug on the computer. Nothing from this request was stored. | Retry later, same ids. |
| 503 | `STORAGE_WRITE_FAILED`, `SHUTTING_DOWN` | Not stored. | Retry later, same ids. |

---

## 9. Retries

- Keep every record in a local outbox until it gets a 2xx answer.
- After a network error, a timeout, a 5xx or `503`: resend the **same JSON with the same ids**
  later (for example after 2, 4, 8 ... up to 60 s). Resending is always safe.
- `DUPLICATE` and `STALE_IGNORED` are success. Stop resending. A late retry of an older in-progress
  session copy is `STALE_IGNORED`, not an error.
- Never change an id on retry. A new id makes a second record.
- Never resend a `409` or `422` unchanged; it will fail the same way. Show it as needing attention.
  Two exceptions: after `404 EVENT_NOT_FOUND` on an ack, send the event first, then the ack; after
  `409 NOT_PRESENTED`, send the delivery report first if the alert really was displayed.
- Send a session before the events that cite it, and an event before its ack. If an event is still
  in the watch's outbox when the wearer acknowledges it, just send the event with `acknowledgement`
  filled in.

---

## 10. Delivery and acknowledgement: what they mean

- An HTTP 200 or 201 means the computer stored the request. It is not proof that anyone saw an alert.
- Report `presentedAt` (delivery report, or `delivery.presentedAt` in an event) only after the app
  actually displayed the alert on screen.
- `hapticRequested: true` means the app asked watchOS for a haptic. watchOS does not confirm the
  wrist felt it.
- An acknowledgement means the wearer tapped acknowledge. It is not a medical review.
- The watch never sets `REVIEWED` or `CLOSED`. Only a reviewer on the mission computer does, and a
  completed review is not a medical clearance.
- The computer records which watch displayed or acknowledged an alert, and refuses a watch bound to
  another subject (6.6).
- Link state: a watch is `VERIFIED` only within 60 s of its last authenticated contact (heartbeat,
  record upload, ack or delivery report); after that the dashboard shows `WATCH_UNREACHABLE`.
- Alerts from the computer: when a computer check creates an alert for a subject whose watch is
  `VERIFIED`, it is queued (`QUEUED`) and listed by `GET /api/v1/device/outbox`. Show its
  `watchMessage`, then send the delivery report. If the watch does not confirm it within 120 s it
  becomes `DELIVERY_UNCONFIRMED` and leaves the outbox; if the app displays it later anyway, still
  report the true `presentedAt`. If no watch was reachable when the alert was created, it is never
  queued and the dashboard shows `WATCH_UNREACHABLE`.

---

## 11. The examples are simulated: what changes for a real watch

`contracts/v1/examples/session.json`, `event.json`, `bundle.json` and `heartbeat.json` are flagged
simulated so they can never be stored as real data or make a fake watch look verified (sending one
goes to the demo workspace). For a real watch these fields differ (and the values, timestamps and
ids come from the real check):

| Record | Field | Example (simulated) | Real watch |
|---|---|---|---|
| session | `mode` | `SIMULATED_DEMO` | `DEVICE_RECORDING` |
| session | `isSimulated` | `true` | `false` |
| session | `measurements[].isSimulated` | `true` | `false` |
| session | `measurements[].source.kind` | `SIMULATOR` | `APPLE_WATCH` |
| session | `measurements[].source.device` / `.sensor` | `Simulated watch` / `Simulated heart-rate values` | the real device and sensor, for example `Apple Watch` / `Optical heart sensor` |
| session | `heartRateAccess` | `null` (simulated values never came from HealthKit) | the app's value, normally `AUTHORIZED` |
| session, event | `provenance.origin` | `DEMO_FIXTURE` | `WATCH_APP` |
| event | `isSimulated` | `true` | `false` |
| event | `origin.kind` | `DEMO_FIXTURE` | `WATCH_RULES` |
| event | `delivery.channel` | `SIMULATED_WATCH` | `WATCH_LOCAL` |
| event | `delivery.confirmedBy` | `SIMULATION` | `WATCH_APP` |
| event | `acknowledgement.via` (when present) | `SIMULATED_WATCH` | `WATCH` |
| bundle | `producer.deviceModel` | `Simulated watch` | the real model |
| heartbeat | `isSimulated` | `true` | `false` (or leave it out) |
| heartbeat | `deviceModel` | `Simulated watch` | the real model |

`ack.json` and `delivery.json` carry no readings. Their `deviceId` must be the reporting watch's own id.

---

## 12. Failure modes

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
| `422 status ... does not match delivery/acknowledgement` | `status` set by hand | Derive it with table 6.3 |
| `422 origin.kind: MISSION_COMPUTER_CHECK is reserved ...` | The watch claimed the computer created the event | Send `WATCH_RULES` |
| `422 delivery.presentedAt: a watch-shown alert cannot be presented more than 1 s before it was created` (or acknowledged before it was created) | Times from different clocks, or set by hand | Take all three from the watch clock when they happen |
| `422 extensions is nested more than 8 levels deep ...` (or larger than 8192 bytes) | Too much free-form data | Keep `extensions` small and flat |
| `422 REJECTED ... belongs to a different subject` | A session, event or reading links to another subject's session | Use the same `subjectId` throughout one check |
| `409 CONFLICT ... already exists with different content` | An id was reused for different content | Generate ids once; never reuse a counter |
| `409 ... a simulated record cannot become real` | A simulated id re-sent as real | Real recordings need new ids |
| `409 CONFLICT delivery and acknowledgement of a stored event can only be reported by the watch over the device API` | A file tried to advance a stored event | Let the watch report it live (delivery report, ack, or a live re-send) |
| `409 SIMULATED_EVENT` | Ack or delivery for a demo alert | Only real alerts take watch reports |
| `409 DEVICE_SUBJECT_MISMATCH` | This watch is bound to another subject | Send heartbeats with the wearer's `subjectId`; report only that subject's alerts |
| `409 ALREADY_ACKNOWLEDGED` | A different `acknowledgedAt` for the same alert | Save `acknowledgedAt` at the tap; resend that value |
| `409 NOT_PRESENTED` | Ack for an alert that was never presented | Send the delivery report first |
| `404 EVENT_NOT_FOUND` on an ack | The event has not reached the computer yet | Send the event, then the ack |
| `503 STORAGE_WRITE_FAILED` | Laptop disk problem | Retry later with the same ids |
| Dashboard shows `WATCH_UNREACHABLE` | No contact for 60 s | Heartbeat about every 20 s while the app is open |
| Dashboard shows the watch as `SIMULATED` | Heartbeats sent with `isSimulated: true` (as in the example) | Real watch: `isSimulated: false` or leave it out |
| A computer alert never reaches the watch | The watch was unreachable when it was created, or the outbox was not polled within 120 s | Heartbeat and poll the outbox together |

---

## 13. curl examples (run against a real server)

These were run on 2026-11-14 against a local test server started with
`GG_PORT=4391 GG_DATA_DIR=<temporary folder> npx tsx src/server/main.ts`, so `GG` was
`http://127.0.0.1:4391`. The outputs are copied from that run; only the data directory in the health
answer is shortened to `…`. Run from `contracts/v1/examples/`:

```bash
export GG_TOKEN='<token from the System Status page>'
GG=http://<laptop-LAN-IP>:4317        # on the laptop itself: http://127.0.0.1:4317
```

Health (no token):

```bash
curl -sS "$GG/api/v1/health"
```
```json
{"ok":true,"service":"gravityguard-mission-computer","version":"0.1.0","contractVersion":"v1","time":"2026-11-14T23:08:42.701Z","uptimeSeconds":12,"storage":{"dataDir":"…","writable":true,"lastWriteError":null},"workspaces":{"mission":{"sessions":0,"events":0,"readings":0,"devices":0},"demo":{"sessions":7,"events":4,"readings":2,"devices":2}},"network":{"bind":"127.0.0.1","lan":false}}
```

The example heartbeat is flagged simulated, so the watch appears only in the demo workspace:

```bash
curl -sS -X POST "$GG/api/v1/device/heartbeat" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary @heartbeat.json
```
```json
{"device":{"deviceId":"example-watch-01","subjectId":"example-crew-01","isSimulated":true,"firstSeenAt":"2026-11-14T23:08:42.722Z","lastSeenAt":"2026-11-14T23:08:42.722Z","lastSyncAt":null,"appVersion":"0.1.0","deviceModel":"Simulated watch","pendingRecords":0},"linkState":"SIMULATED","serverTime":"2026-11-14T23:08:42.722Z"}
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

The same session with Swift's default date encoding (`2026-11-14T19:30:00Z` becomes `816377400`,
seconds since 2001-01-01):

```bash
sed 's/"startedAt": "2026-11-14T19:30:00Z"/"startedAt": 816377400/' session.json \
  | curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/sessions" -H "Authorization: Bearer $GG_TOKEN" \
    -H "Content-Type: application/json" --data-binary @-
```
```
{"result":{"kind":null,"id":"example-ses-20261114-193000","workspace":null,"outcome":"REJECTED","detail":"startedAt: Invalid input: expected string, received number"},"createdEvents":[],"error":{"code":"VALIDATION_FAILED","message":"The record does not match the v1 contract. Nothing was stored.","details":["startedAt: Invalid input: expected string, received number"]}}
HTTP 422
```

An event claiming the computer created it:

```bash
sed 's/"kind": "DEMO_FIXTURE",/"kind": "MISSION_COMPUTER_CHECK",/' event.json | sed 's/example-evt-20261114-193156/example-evt-forged/' \
  | curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/alerts" -H "Authorization: Bearer $GG_TOKEN" \
    -H "Content-Type: application/json" --data-binary @-
```
```
{"result":{"kind":null,"id":"example-evt-forged","workspace":null,"outcome":"REJECTED","detail":"origin.kind: MISSION_COMPUTER_CHECK is reserved for events this mission computer creates"},"createdEvents":[],"error":{"code":"VALIDATION_FAILED","message":"The record does not match the v1 contract. Nothing was stored.","details":["origin.kind: MISSION_COMPUTER_CHECK is reserved for events this mission computer creates"]}}
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

The same records through Path B (on the laptop, no token): already stored, so both are duplicates.

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
real watch. To try the flow, start a **separate test server with a temporary `GG_DATA_DIR`**, send a
real heartbeat (`isSimulated: false`), then type in a reading flagged `QUESTIONABLE` from the laptop.
These records are labelled real, so never do this against the real data directory.

```bash
curl -sS -X POST "$GG/api/v1/device/heartbeat" -H "Authorization: Bearer $GG_TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"deviceId":"test-watch-01","subjectId":"test-crew-01","sentAt":"2026-11-14T23:09:05Z","isSimulated":false}'
curl -sS -X POST "$GG/api/v1/measurements" -H "Content-Type: application/json" --data-binary '{"measurements":[{"measurementId":"test-cuff-1","subjectId":"test-crew-01","sessionId":null,"indicator":"BLOOD_PRESSURE_SYSTOLIC","value":120,"unit":"mmHg","measuredAt":"2026-11-14T22:00:00Z","phase":null,"source":{"kind":"EXTERNAL_INSTRUMENT","device":"Test cuff","sensor":null},"isSimulated":false,"quality":"QUESTIONABLE"}]}'
```
```
{"device":{"deviceId":"test-watch-01","subjectId":"test-crew-01","isSimulated":false,"firstSeenAt":"2026-11-14T23:09:05.225Z","lastSeenAt":"2026-11-14T23:09:05.225Z","lastSyncAt":null,"appVersion":null,"deviceModel":null,"pendingRecords":null},"linkState":"VERIFIED","serverTime":"2026-11-14T23:09:05.225Z"}
{"results":[{"kind":"MEASUREMENT","id":"test-cuff-1","workspace":"mission","outcome":"CREATED","detail":null}],"createdEvents":["dq-test-cuff-1"]}
```

The watch polls its outbox:

```bash
curl -sS "$GG/api/v1/device/outbox?deviceId=test-watch-01" -H "Authorization: Bearer $GG_TOKEN"
```
```json
{"deviceId":"test-watch-01","deviceKnown":true,"subjectId":"test-crew-01","serverTime":"2026-11-14T23:09:05.271Z","events":[{"eventId":"dq-test-cuff-1","subjectId":"test-crew-01","createdAt":"2026-11-14T23:09:05.249Z","category":"VERIFY_SOURCE","severity":"NOTICE","reasonCodes":["SOURCE_REVIEW_REQUIRED"],"watchMessage":{"title":"VERIFY SOURCE","body":"CHECK MISSION COMPUTER"},"delivery":{"channel":"COMPUTER_TO_WATCH","state":"QUEUED"}}]}
```

A second watch, bound by its heartbeat to another subject (`test-crew-02`; the heartbeat answers
`200`), cannot report on it:

```bash
curl -sS -X POST "$GG/api/v1/device/heartbeat" -H "Authorization: Bearer $GG_TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"deviceId":"test-watch-02","subjectId":"test-crew-02","sentAt":"2026-11-14T23:09:05Z"}'
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$GG/api/v1/alerts/dq-test-cuff-1/delivery" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary '{"deviceId":"test-watch-02","presentedAt":"2026-11-14T23:09:05Z","hapticRequested":true}'
```
```
{"error":{"code":"DEVICE_SUBJECT_MISMATCH","message":"Device test-watch-02 is bound to a different crew member, so it cannot report on this alert."}}
HTTP 409
```

After the app displayed `watchMessage`, and after the wearer tapped acknowledge:

```bash
curl -sS -X POST "$GG/api/v1/alerts/dq-test-cuff-1/delivery" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary '{"deviceId":"test-watch-01","presentedAt":"2026-11-14T23:09:05Z","hapticRequested":true}'
curl -sS -X POST "$GG/api/v1/alerts/dq-test-cuff-1/ack" -H "Authorization: Bearer $GG_TOKEN" \
  -H "Content-Type: application/json" --data-binary '{"deviceId":"test-watch-01","acknowledgedAt":"2026-11-14T23:09:05Z"}'
```
```
{"event":{"eventId":"dq-test-cuff-1","subjectId":"test-crew-01","createdAt":"2026-11-14T23:09:05.249Z","category":"VERIFY_SOURCE","severity":"NOTICE","reasonCodes":["SOURCE_REVIEW_REQUIRED"],"watchMessage":{"title":"VERIFY SOURCE","body":"CHECK MISSION COMPUTER"},"delivery":{"channel":"COMPUTER_TO_WATCH","state":"PRESENTED","presentedAt":"2026-11-14T23:09:05Z","hapticRequested":true,"confirmedBy":"WATCH_APP","confirmedByDeviceId":"test-watch-01"},"status":"DELIVERED","acknowledgement":null}}
{"event":{"eventId":"dq-test-cuff-1","subjectId":"test-crew-01","createdAt":"2026-11-14T23:09:05.249Z","category":"VERIFY_SOURCE","severity":"NOTICE","reasonCodes":["SOURCE_REVIEW_REQUIRED"],"watchMessage":{"title":"VERIFY SOURCE","body":"CHECK MISSION COMPUTER"},"delivery":{"channel":"COMPUTER_TO_WATCH","state":"PRESENTED","presentedAt":"2026-11-14T23:09:05Z","hapticRequested":true,"confirmedBy":"WATCH_APP","confirmedByDeviceId":"test-watch-01"},"status":"ACKNOWLEDGED","acknowledgement":{"acknowledgedAt":"2026-11-14T23:09:05Z","via":"WATCH","deviceId":"test-watch-01"}}}
```

After that the outbox is empty (`"events":[]`), and the dashboard's history for the alert reads
`watch app confirmed it displayed the alert (device test-watch-01)` and
`acknowledged on the watch (device test-watch-01)`. Sending the same ack again answers `200`; a
different `acknowledgedAt`, an unknown alert and a local-time timestamp answered:

```
{"error":{"code":"ALREADY_ACKNOWLEDGED","message":"This alert was already acknowledged."}}
HTTP 409
{"error":{"code":"EVENT_NOT_FOUND","message":"No alert evt-not-sent-yet on this computer. Send the event itself first (POST /api/v1/alerts)."}}
HTTP 404
{"error":{"code":"VALIDATION_FAILED","message":"The acknowledgement does not match the v1 contract. Nothing was stored.","details":["acknowledgedAt: must be a UTC ISO-8601 timestamp such as 2026-11-14T19:30:05Z"]}}
HTTP 422
```
