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
  { kind: "title", from: 0, to: f(2.0) },
  // Real footage (Sriyan's phone), hard cuts on the beat.
  { kind: "clip", from: f(2.0), to: f(3.333), src: "clips/c3.mp4", startAt: 0.5 },
  { kind: "clip", from: f(3.333), to: f(4.333), src: "clips/c3.mp4", startAt: 4.3 },
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
  { kind: "usage", from: f(9.333), to: f(14.0), src: "capture/web_hd_dashboard.mp4", startAt: 10.433,
    cam: [[0, 1.0, 0.5, 0.5], [0.3, 1.0, 0.5, 0.5], [1.15, 1.85, 0.685, 0.434], [2.55, 1.92, 0.685, 0.45], [3.0, 1.7, 0.365, 0.42], [4.67, 1.76, 0.365, 0.43]],
    marks: [{ from: 1.25, to: 2.55, box: [1146, 354, 340, 230], color: "#ededed" }, { from: 3.0, to: 4.6, box: [432, 294, 288, 120] }] },
  // Daily plan: "Very tired", the suggestion appears, "Accept change".
  { kind: "usage", from: f(14.0), to: f(18.0), src: "capture/web_other_daily_plan.mp4", startAt: 0.7,
    cam: [[0, 1.0, 0.5, 0.5], [0.15, 1.0, 0.5, 0.5], [0.5, 1.8, 0.63, 0.52], [1.25, 1.6, 0.66, 0.79], [3.95, 1.66, 0.65, 0.8]],
    cursor: [[0.0, 980, 760], [0.42, 1190, 563], [0.5, 1190, 563, "click"], [0.62, 1190, 600], [2.55, 1282, 968], [3.1, 1282, 968, "click"], [3.95, 1236, 1010]],
    marks: [{ from: 1.0, to: 2.9, box: [1104, 702, 362, 330], color: "#ededed" }] },
  // Crew guide: click search, "radiation", the matching checklist opens.
  { kind: "usage", from: f(18.0), to: f(22.0), src: "capture/web_other_crew_guide.mp4", startAt: 0.35,
    cam: [[0, 1.0, 0.5, 0.5], [0.12, 1.0, 0.5, 0.5], [0.42, 1.8, 0.42, 0.3], [1.4, 1.8, 0.4, 0.33], [1.9, 1.6, 0.47, 0.45], [3.95, 1.66, 0.5, 0.47]],
    cursor: [[0.0, 700, 450], [0.18, 560, 312], [0.22, 560, 312, "click"], [1.3, 566, 336], [1.65, 600, 400], [1.75, 600, 400, "click"], [3.9, 690, 520]],
    marks: [{ from: 2.0, to: 3.9, box: [790, 356, 680, 375], color: "#ededed" }] },
  // Health review: ask, and the assistant's answer lands with its linked NASA guide.
  { kind: "usage", from: f(22.0), to: f(26.0), src: "capture/web_hd_review.mp4", startAt: 0.9,
    cam: [[0, 1.0, 0.5, 0.5], [0.12, 1.0, 0.5, 0.5], [0.5, 1.72, 0.64, 0.66], [3.95, 1.8, 0.64, 0.65]],
    cursor: [[0.0, 1100, 980], [0.55, 1418, 889], [0.63, 1418, 889, "click"], [2.2, 1300, 960]],
    marks: [{ from: 1.45, to: 3.9, box: [1026, 610, 414, 210], color: "#ededed" }] },
  { kind: "end", from: f(26.0), to: TOTAL },
];

/**
 * On-screen type. "lower" sits bottom-left over full-frame footage; "left" sits in the black column
 * beside the watch and website shots. Each string in `title` is one line, revealed in turn.
 */
export type Caption = { from: number; to: number; place: "lower" | "left" | "margin" | "corner"; title: string[]; sub?: string };

export const CAPTIONS: Caption[] = [
  { from: f(2.13), to: f(5.2), place: "lower", title: ["A 3D-printed band"], sub: "Built around the Apple Watch SE." },
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
