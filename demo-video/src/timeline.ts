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
export const TOTAL = 895; // 29.833 s (Space Apps limit is 30 s); the music was extended two beats to match
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
/** A note in the site's ink on a small glass label, with an arrow that draws itself onto [tx, ty]. Page px, seconds into the shot. */
export type Note = { from: number; to: number; text: string; at: [number, number]; tip: [number, number] };

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
  | (Base & { kind: "usage"; src: string; startAt: number; rate?: number; cam: Cam[]; cursor?: CursorKey[]; marks?: Mark[]; notes?: Note[] })
  | (Base & {
      kind: "web";
      src: string;
      startAt: number;
      cam: Cam[];
      /** The page takes over the whole frame at this second, punching in to the given zoom and focus. */
      takeover?: { at: number; zoom: number; fx: number; fy: number };
    });

export const SHOTS: Shot[] = [
  { kind: "title", from: 0, to: f(2.0) },
  // Real footage (Sriyan's phone), hard cuts on the beat.
  { kind: "clip", from: f(2.0), to: f(3.333), src: "clips/c3.mp4", startAt: 0.5 },
  { kind: "clip", from: f(3.333), to: f(4.333), src: "clips/c3.mp4", startAt: 4.3 },
  { kind: "clip", from: f(4.333), to: f(5.333), src: "clips/c1.mp4", startAt: 0.1, push: [0.0, 1.3, 0.46, 0.48] },
  // The real watch reads 128 bpm, Review; the camera pushes into its screen...
  { kind: "clip", from: f(5.333), to: f(7.333), src: "clips/c2.mp4", startAt: 0.5, rate: 1.5, push: [1.62, 2.5, 0.5, 0.44] },
  // ...and lands on the app's own screen at the same moment: the chest region amber, 128 bpm, Review.
  // A still of the app's own SwiftUI view rendered at 10x, so it stays sharp at 4K.
  // A 3D render of the Ouranos watch (Blender, from the CAD; charcoal like the real print, app on screen).
  { kind: "clip", from: f(7.333), to: f(9.333), src: "renders/watch_hero.mp4", startAt: 0 },
  // Mission health, the whole page, live (recorded at 3840x2160 from useouranos.vercel.app, paired to the
  // dashboard's mock watch). Calm for four seconds, then the flag lands on the 13.333 beat.
  // The website in use, up close (cuts 9.333, 14.667, 19.333, 23.333, 27.333). Positions are page px of 1920x1080.
  // Every push-in takes about a second so the motion reads.
  // Mission health: dive into the live heart-rate chart, then move to the flag as it fires (astronaut turns gold).
  { kind: "usage", from: f(9.333), to: f(14.667), src: "capture4k/web4k_dashboard.mp4", startAt: 0.6, // 4K; flag fires at 3.4 s into the shot
    cam: [[0, 1.0, 0.5, 0.5], [0.3, 1.0, 0.5, 0.5], [1.5, 1.85, 0.685, 0.434], [2.8, 1.92, 0.685, 0.45], [3.95, 1.7, 0.365, 0.42], [5.33, 1.76, 0.365, 0.43]],
    marks: [{ from: 1.6, to: 2.85, box: [1146, 352, 342, 234], color: "#ededed" }, { from: 3.7, to: 5.2, box: [432, 292, 290, 124], color: "#ededed" }],
    notes: [{ from: 1.7, to: 2.85, text: "Live from the watch", at: [1500, 292], tip: [1222, 402] }] },
  // Daily plan: "Very tired", the suggestion appears, "Accept change".
  { kind: "usage", from: f(14.667), to: f(19.333), src: "capture4k/web4k_daily_plan.mp4", startAt: 0.2, // 4K; clicks at 1.0 and 3.6 s into the shot
    cam: [[0, 1.0, 0.5, 0.5], [0.1, 1.0, 0.5, 0.5], [0.95, 1.8, 0.63, 0.52], [2.05, 1.6, 0.67, 0.8], [3.5, 1.66, 0.67, 0.84], [4.6, 1.3, 0.52, 0.6]],
    cursor: [[0.0, 980, 760], [0.88, 1185, 562], [1.0, 1185, 562, "click"], [1.1, 1185, 602], [3.0, 1285, 969], [3.6, 1285, 969, "click"], [4.6, 1180, 1000]],
    marks: [{ from: 1.5, to: 3.45, box: [1099, 701, 373, 366], color: "#ededed" }] },
  // Crew guide: click search, "radiation", the matching checklist opens.
  { kind: "usage", from: f(19.333), to: f(23.333), src: "capture4k/web4k_crew_guide.mp4", startAt: 0.25, // 4K; search 0.55, result 2.85 s into the shot
    cam: [[0, 1.0, 0.5, 0.5], [0.05, 1.0, 0.5, 0.5], [0.95, 1.8, 0.42, 0.29], [1.95, 1.8, 0.4, 0.32], [2.9, 1.62, 0.47, 0.43], [4.0, 1.66, 0.5, 0.46]],
    cursor: [[0.0, 700, 460], [0.45, 560, 310], [0.55, 560, 310, "click"], [2.0, 570, 336], [2.7, 600, 405], [2.85, 600, 405, "click"], [4.0, 690, 540]],
    marks: [{ from: 3.0, to: 3.95, box: [787, 356, 685, 379], color: "#ededed" }] },
  // Health review: ask, and the assistant's answer with its linked NASA guide (0.7x so the answer holds; the site resets at ~3.4 s).
  { kind: "usage", from: f(23.333), to: f(27.333), src: "capture4k/web4k_review.mp4", startAt: 0.4, rate: 0.7,
    cam: [[0, 1.0, 0.5, 0.5], [0.05, 1.0, 0.5, 0.5], [1.0, 1.7, 0.57, 0.65], [1.9, 1.75, 0.644, 0.66], [3.95, 1.82, 0.644, 0.65]],
    cursor: [[0.0, 900, 960], [0.72, 1085, 764], [0.86, 1085, 764, "click"], [2.4, 1000, 905]],
    marks: [{ from: 1.7, to: 3.95, box: [1028, 605, 416, 223], color: "#ededed" }],
    notes: [{ from: 2.2, to: 3.95, text: "Every answer links a NASA source", at: [1462, 690], tip: [1424, 792] }] },
  { kind: "end", from: f(27.333), to: TOTAL },
];

/**
 * On-screen type. "lower" sits bottom-left over full-frame footage; "left" sits in the black column
 * beside the watch and website shots. Each string in `title` is one line, revealed in turn.
 */
export type Caption = { from: number; to: number; place: "lower" | "left" | "margin" | "corner"; title: string[]; sub?: string };

export const CAPTIONS: Caption[] = [
  { from: f(2.13), to: f(5.2), place: "lower", title: ["A 3D-printed band"], sub: "Built around the Apple Watch SE." },
  { from: f(5.43), to: f(7.2), place: "lower", title: ["Readings on the wrist"], sub: "Heart rate, breathing and more." },
  { from: f(7.43), to: f(9.25), place: "left", title: ["Built for", "gloved hands"], sub: "A chain band with a big hook made for gloved fingers." },
  // Website in use, up close: type sits bottom-left over the picture.
  { from: f(9.5), to: f(12.6), place: "corner", title: ["Live on the dashboard"], sub: "Watch readings arrive as they happen." },
  { from: f(12.8), to: f(14.55), place: "corner", title: ["It flags what changes"], sub: "Pulse and breathing, marked for review." },
  { from: f(14.8), to: f(19.2), place: "corner", title: ["Plans around how you feel"], sub: "Very tired? Flexible work moves to tomorrow." },
  { from: f(19.5), to: f(23.2), place: "corner", title: ["The right checklist, fast"], sub: "Search the crew guide and open the steps." },
  { from: f(23.5), to: f(27.2), place: "corner", title: ["Evidence, not a diagnosis"], sub: "No link to Earth? Onboard guidance runs on the local mission computer." },
];

/**
 * NASA facts that pop up beside the product on a blurred glass panel (sources on screen and in References):
 *  - up to 20 min one-way signal delay, Mars to Earth: https://www.nasa.gov/hrp/hazard-distance-from-earth/
 *  - about 40 h pre-mission medical training for an ISS crew medical officer (often not a physician):
 *    https://ntrs.nasa.gov/api/citations/20080010877/downloads/20080010877.pdf
 */
export type Stat = { from: number; to: number; side: "right" | "left"; kicker: string; value: number; unit: string; line: string; source: string };
export const STATS: Stat[] = [
  { from: f(2.4), to: f(5.25), side: "right", kicker: "Up to", value: 20, unit: "min", line: "for a message from Mars to reach Earth.", source: "NASA Human Research Program" },
  { from: f(23.8), to: f(27.2), side: "left", kicker: "About", value: 40, unit: "hrs", line: "of medical training for the crew medical officer.", source: "NASA, ISS Medical Operations" },
];

/** Every reading on screen from here on comes from the app's simulated feed, so the film says so. */
export const SIMULATED = { from: f(5.333), to: f(27.333) };

export const MUSIC = "music/ouranos-music.wav";

/**
 * Voiceover: Sriyan's take cut into one file per line (assets/vo/l1.wav ... l9.wav, by scripts/split_vo.py),
 * each placed on its shot. Lines that are missing are simply skipped. The music ducks under the voice.
 */
export const VO: { n: number; at: number }[] = [
  // Cut from Sriyan's take by Whisper word times (3 = lines 3+4 read as one phrase; 7 starts at "finds").
  { n: 1, at: f(0.35) }, { n: 2, at: f(2.2) }, { n: 3, at: f(5.5) }, { n: 5, at: f(9.55) },
  { n: 6, at: f(14.85) }, { n: 7, at: f(19.55) }, { n: 8, at: f(23.6) }, { n: 9, at: f(27.35) },
];
export const URL_TEXT = "useouranos.vercel.app";
export const TAGLINE = "Health monitoring for astronauts";
export const CREDIT = "Built by Dhruv, Mustafa and Sriyan";
