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

/** A push into a point of the frame over the last part of a shot: [seconds into the shot, zoom, focus x, focus y]. */
export type Push = [number, number, number, number];

type Base = { from: number; to: number };
export type Shot =
  | (Base & { kind: "title" })
  | (Base & { kind: "end" })
  | (Base & { kind: "clip"; src: string; startAt: number; rate?: number; push?: Push })
  | (Base & { kind: "watch"; src: string; startAt: number })
  | (Base & { kind: "page"; src: string; startAt: number; cam: Cam[] })
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
  // Motion: lands with a settle on the groove, drifts, punches in on the flag beat (astronaut turns gold,
  // "Pulse and breathing both flagged"), then eases back out to the whole page before the cut.
  { kind: "page", from: f(9.333), to: f(17.333), src: "capture/web_hd_dashboard.mp4", startAt: DASH_START,
    cam: [[0, 1.1, 0.5, 0.5], [0.4, 1.0, 0.5, 0.5], [3.75, 1.04, 0.5, 0.48], [4.2, 1.2, 0.44, 0.42], [6.4, 1.24, 0.44, 0.42], [7.5, 1.0, 0.5, 0.5]] },
  // Health review, the whole page: a question goes in, the answer lands on the 19.333 beat.
  // Motion: settle, then punch toward the assistant as its answer lands on the 19.333 beat, hold, and ease
  // back out so the whole page sits under "Evidence, not a diagnosis". Focus x stays <= 0.465 so the page
  // never slides under the margin captions.
  { kind: "page", from: f(17.333), to: f(26.0), src: "capture/web_hd_review.mp4", startAt: 0.167,
    cam: [[0, 1.08, 0.5, 0.5], [0.4, 1.0, 0.5, 0.5], [1.75, 1.02, 0.5, 0.5], [2.25, 1.22, 0.465, 0.45], [5.2, 1.25, 0.462, 0.47], [6.4, 1.0, 0.5, 0.5]] },
  { kind: "end", from: f(26.0), to: TOTAL },
];

/**
 * On-screen type. "lower" sits bottom-left over full-frame footage; "left" sits in the black column
 * beside the watch and website shots. Each string in `title` is one line, revealed in turn.
 */
export type Caption = { from: number; to: number; place: "lower" | "left" | "margin"; title: string[]; sub?: string };

export const CAPTIONS: Caption[] = [
  { from: f(2.13), to: f(5.2), place: "lower", title: ["A 3D-printed band"], sub: "Built around the Apple Watch SE." },
  { from: f(5.43), to: f(7.2), place: "lower", title: ["Readings on the wrist"], sub: "Heart rate, breathing and more." },
  { from: f(7.43), to: f(9.25), place: "left", title: ["The body,", "at a glance"], sub: "Amber means a reading needs review." },
  // Website shots: the type sits in the page's own empty left margin, so it covers nothing.
  { from: f(9.5), to: f(13.2), place: "margin", title: ["Live on the", "dashboard"], sub: "Watch readings arrive as they happen." },
  { from: f(13.5), to: f(17.25), place: "margin", title: ["It flags what", "changes"], sub: "Pulse and breathing, marked for review." },
  { from: f(17.5), to: f(19.25), place: "margin", title: ["Ask what", "changed"], sub: "The assistant answers in plain words." },
  { from: f(19.5), to: f(25.9), place: "margin", title: ["Evidence,", "not a diagnosis"], sub: "With a linked NASA guide, for the crew medical officer to decide." },
];

/** Every reading on screen from here on comes from the app's simulated feed, so the film says so. */
export const SIMULATED = { from: f(5.333), to: f(26.0) };

export const MUSIC = "music/ouranos-music.wav";
export const URL_TEXT = "useouranos.vercel.app";
export const TAGLINE = "Health monitoring for astronauts";
export const CREDIT = "Built by Dhruv, Mustafa and Sriyan";
