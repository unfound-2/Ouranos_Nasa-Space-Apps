/**
 * The whole edit in one place: 28.0 s at 30 fps (Space Apps limit is 30 s).
 *
 * Cuts sit on the music's beat grid (90 BPM): 2.0 (first hit), 5.333, 7.333, 9.333 (groove starts),
 * 13.333, 17.333, 21.333 (lift) and 26.0 (final hit). Event times inside the footage, measured
 * frame by frame, decide each shot's startAt:
 *   - capture/watch_body.mp4: the chest turns amber ("128 bpm, Review") at 5.533 s.
 *   - capture/web_dashboard.mp4: "Pulse and breathing both flagged" appears at 6.633 s.
 *   - capture/web_dashboard_long.mp4: the same flag at 8.633 s.
 *   - capture/web_other_health_review.mp4: the assistant's answer lands at 2.40 s.
 */
export const FPS = 30;
export const TOTAL = 840;
export const f = (s: number) => Math.round(s * FPS);

/** Where Mission health's flag lands in capture/web_hd_dashboard.mp4, minus four seconds. */
const DASH_START = 9.333;

/** Camera key inside a website shot: [seconds into the shot, zoom, focus x, focus y] (focus is 0..1 of the page). */
export type Cam = [number, number, number, number];

/**
 * Someone using the site, seen up close. All positions are CSS px of the 1920x1080 page (the capture's
 * viewport), so they line up with the footage at any zoom. Times are seconds into the shot.
 */
export type CursorKey = [number, number, number, ("click" | "rest")?];
/** An outline that draws itself around a page element: seconds in, seconds out, [x, y, w, h] in page px. */
export type Mark = { from: number; to: number; box: [number, number, number, number]; color?: string };

/** A push into a point of the frame over the last part of a shot: [seconds into the shot, zoom, focus x, focus y]. */
export type Push = [number, number, number, number];

type Base = { from: number; to: number };
export type Shot =
  | (Base & { kind: "title" })
  | (Base & { kind: "stat"; kicker: string; value: number; unit: string; line: string; source: string })
  | (Base & { kind: "end" })
  | (Base & { kind: "clip"; src: string; startAt: number; rate?: number; push?: Push })
  | (Base & { kind: "watch"; src: string; startAt: number })
  | (Base & { kind: "page"; src: string; startAt: number; cam: Cam[] })
  | (Base & { kind: "usage"; src: string; startAt: number; cam: Cam[]; cursor?: CursorKey[]; marks?: Mark[] })
  | (Base & {
      kind: "web";
      src: string;
      startAt: number;
      cam: Cam[];
      /** The page takes over the whole frame at this second, punching in to the given zoom and focus. */
      takeover?: { at: number; zoom: number; fx: number; fy: number };
    });

export const SHOTS: Shot[] = [
  // The problem, fast: two NASA facts count up over the music's swell (sources on screen and in References).
  //  - Up to 20 min one-way signal delay, Mars to Earth: https://www.nasa.gov/hrp/hazard-distance-from-earth/
  //  - About 40 h pre-mission medical training for an ISS crew medical officer (often not a physician):
  //    https://ntrs.nasa.gov/api/citations/20080010877/downloads/20080010877.pdf
  { kind: "stat", from: 0, to: f(1.0), kicker: "Up to", value: 20, unit: "min", line: "for a message from Mars to reach Earth.", source: "Source: NASA Human Research Program" },
  { kind: "stat", from: f(1.0), to: f(2.0), kicker: "About", value: 40, unit: "hrs", line: "of medical training for the crew medical officer.", source: "Source: NASA, ISS Medical Operations" },
  // The answer lands on the first hit.
  { kind: "title", from: f(2.0), to: f(3.0) },
  // Real footage (Sriyan's phone), hard cuts on the beat.
  { kind: "clip", from: f(3.0), to: f(3.667), src: "clips/c3.mp4", startAt: 0.5 },
  { kind: "clip", from: f(3.667), to: f(4.333), src: "clips/c3.mp4", startAt: 4.3 },
  { kind: "clip", from: f(4.333), to: f(5.333), src: "clips/c1.mp4", startAt: 0.1, push: [0.0, 1.3, 0.46, 0.48] },
  // The real watch reads 128 bpm, Review; the camera pushes into its screen...
  { kind: "clip", from: f(5.333), to: f(7.333), src: "clips/c2.mp4", startAt: 0.5, rate: 1.5, push: [1.62, 2.5, 0.5, 0.44] },
  // ...and lands on the app's own screen at the same moment: the chest region amber, 128 bpm, Review.
  // A still of the app's own SwiftUI view rendered at 10x, so it stays sharp at 4K.
  { kind: "watch", from: f(7.333), to: f(9.333), src: "capture/watch_body_hires.png", startAt: 0 },
  // Mission health, the whole page, live (recorded at 3840x2160 from useouranos.vercel.app, paired to the
  // dashboard's mock watch). Calm for four seconds, then the flag lands on the 13.333 beat.
  // The website in use, up close (beats 9.333, 14.0, 18.0, 22.0, 26.0). Positions are page px of 1920x1080.
  // Mission health: dive into the live heart-rate chart, then whip to the flag as it fires (astronaut turns gold).
  { kind: "usage", from: f(9.333), to: f(14.0), src: "capture4k/web4k_dashboard.mp4", startAt: 1.1, // 4K; flag fires at 4.0 s
    cam: [[0, 1.0, 0.5, 0.5], [0.3, 1.0, 0.5, 0.5], [1.15, 1.85, 0.685, 0.434], [2.55, 1.92, 0.685, 0.45], [3.0, 1.7, 0.365, 0.42], [4.67, 1.76, 0.365, 0.43]],
    marks: [{ from: 1.25, to: 2.55, box: [1146, 352, 342, 234], color: "#ededed" }, { from: 3.0, to: 4.6, box: [432, 292, 290, 124] }] },
  // Daily plan: "Very tired", the suggestion appears, "Accept change".
  { kind: "usage", from: f(14.0), to: f(18.0), src: "capture4k/web4k_daily_plan.mp4", startAt: 0.7, // 4K; clicks at 1.2 and 3.8 s
    cam: [[0, 1.0, 0.5, 0.5], [0.15, 1.0, 0.5, 0.5], [0.5, 1.8, 0.63, 0.52], [1.25, 1.6, 0.67, 0.8], [2.9, 1.66, 0.67, 0.84], [3.95, 1.25, 0.5, 0.6]],
    cursor: [[0.0, 980, 760], [0.42, 1185, 562], [0.5, 1185, 562, "click"], [0.6, 1185, 602], [2.55, 1285, 969], [3.1, 1285, 969, "click"], [3.95, 1180, 1000]],
    marks: [{ from: 1.0, to: 2.95, box: [1099, 701, 373, 366], color: "#ededed" }] },
  // Crew guide: click search, "radiation", the matching checklist opens.
  { kind: "usage", from: f(18.0), to: f(22.0), src: "capture4k/web4k_crew_guide.mp4", startAt: 0.55, // 4K; search 0.8, result 3.1 s
    cam: [[0, 1.0, 0.5, 0.5], [0.12, 1.0, 0.5, 0.5], [0.4, 1.8, 0.42, 0.29], [1.7, 1.8, 0.4, 0.32], [2.2, 1.65, 0.45, 0.42], [2.6, 1.6, 0.5, 0.45], [3.95, 1.65, 0.52, 0.47]],
    cursor: [[0.0, 700, 460], [0.18, 560, 310], [0.25, 560, 310, "click"], [1.7, 570, 336], [2.4, 600, 405], [2.55, 600, 405, "click"], [3.95, 690, 540]],
    marks: [{ from: 2.7, to: 3.9, box: [787, 356, 685, 379], color: "#ededed" }] },
  // Health review: ask, and the assistant's answer lands with its linked NASA guide.
  { kind: "usage", from: f(22.0), to: f(26.0), src: "capture4k/web4k_review.mp4", startAt: 0.4, // 4K; chip 1.0 s, answer 1.5 s
    cam: [[0, 1.0, 0.5, 0.5], [0.12, 1.0, 0.5, 0.5], [0.45, 1.7, 0.57, 0.65], [1.2, 1.75, 0.644, 0.66], [3.95, 1.82, 0.644, 0.65]],
    cursor: [[0.0, 900, 960], [0.5, 1085, 764], [0.6, 1085, 764, "click"], [2.0, 1000, 905]],
    marks: [{ from: 1.3, to: 3.9, box: [1028, 605, 416, 223], color: "#ededed" }] },
  { kind: "end", from: f(26.0), to: TOTAL },
];

/**
 * On-screen type. "lower" sits bottom-left over full-frame footage; "left" sits in the black column
 * beside the watch and website shots. Each string in `title` is one line, revealed in turn.
 */
export type Caption = { from: number; to: number; place: "lower" | "left" | "margin" | "corner"; title: string[]; sub?: string };

export const CAPTIONS: Caption[] = [
  { from: f(3.1), to: f(5.2), place: "lower", title: ["A 3D-printed band"], sub: "Built around the Apple Watch SE." },
  { from: f(5.43), to: f(7.2), place: "lower", title: ["Readings on the wrist"], sub: "Heart rate, breathing and more." },
  { from: f(7.43), to: f(9.25), place: "left", title: ["The body,", "at a glance"], sub: "Amber means a reading needs review." },
  // Website in use, up close: type sits bottom-left over the picture.
  { from: f(9.5), to: f(12.2), place: "corner", title: ["Live on the dashboard"], sub: "Watch readings arrive as they happen." },
  { from: f(12.4), to: f(13.9), place: "corner", title: ["It flags what changes"], sub: "Pulse and breathing, marked for review." },
  { from: f(14.15), to: f(17.85), place: "corner", title: ["Plans around how you feel"], sub: "Very tired? Flexible work moves to tomorrow." },
  { from: f(18.15), to: f(21.85), place: "corner", title: ["The right checklist, fast"], sub: "Search the crew guide and open the steps." },
  { from: f(22.15), to: f(25.9), place: "corner", title: ["Evidence, not a diagnosis"], sub: "Ask what changed. The crew medical officer decides." },
];

/** Every reading on screen from here on comes from the app's simulated feed, so the film says so. */
export const SIMULATED = { from: f(5.333), to: f(26.0) };

export const MUSIC = "music/ouranos-music.wav";
export const URL_TEXT = "useouranos.vercel.app";
export const TAGLINE = "Health monitoring for astronauts";
export const CREDIT = "Built by Dhruv, Mustafa and Sriyan";
