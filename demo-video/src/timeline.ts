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
  { kind: "clip", from: f(4.333), to: f(5.333), src: "clips/c1.mp4", startAt: 0.1 },
  // The real watch reads 128 bpm, Review; the camera pushes into its screen...
  { kind: "clip", from: f(5.333), to: f(7.333), src: "clips/c2.mp4", startAt: 0.5, rate: 1.5, push: [1.62, 2.5, 0.5, 0.44] },
  // ...and lands on the app's own screen at the same moment: the chest region amber, 128 bpm, Review.
  { kind: "watch", from: f(7.333), to: f(9.333), src: "capture/watch_body.mp4", startAt: 5.75 },
  // Mission health: calm for two seconds, then the flag lands on the beat and the page takes the frame.
  { kind: "web", from: f(9.333), to: f(13.333), src: "capture/web_dashboard.mp4", startAt: 4.633,
    // Framed to keep the 3D astronaut's shoulder patches out of every close-up.
    // Page titles and the session ID stay out of frame; the flag panel lands beside the astronaut.
    cam: [[0, 1.32, 0.8, 0.62], [2.0, 1.38, 0.8, 0.62]],
    takeover: { at: 2.0, zoom: 2.4, fx: 0.333, fy: 0.454 } },
  // Monitoring systems: drift down the list of readings, each with its unit, time, source and quality.
  { kind: "web", from: f(13.333), to: f(17.333), src: "capture/web_crew_health.mp4", startAt: 0.5,
    cam: [[0, 1.5, 0.31, 0.58], [4.0, 1.62, 0.31, 0.7]] },
  // The readings behind the flag: from the heart-rate chart down to the list that triggered it.
  { kind: "web", from: f(17.333), to: f(21.333), src: "capture/web_dashboard_long.mp4", startAt: 9.0,
    cam: [[0, 1.85, 0.755, 0.52], [0.9, 1.85, 0.755, 0.52], [3.1, 1.85, 0.755, 0.97], [4.0, 1.9, 0.755, 0.97]] },
  // Health review: the answer lands on the 23.333 beat, then the camera settles on it and the NASA guide link.
  { kind: "web", from: f(21.333), to: f(26.0), src: "capture/web_other_health_review.mp4", startAt: 0.4,
    cam: [[0, 1.4, 0.645, 0.75], [2.0, 1.48, 0.645, 0.72], [4.667, 1.78, 0.645, 0.665]] },
  { kind: "end", from: f(26.0), to: TOTAL },
];

/**
 * On-screen type. "lower" sits bottom-left over full-frame footage; "left" sits in the black column
 * beside the watch and website shots. Each string in `title` is one line, revealed in turn.
 */
export type Caption = { from: number; to: number; place: "lower" | "left"; title: string[]; sub?: string };

export const CAPTIONS: Caption[] = [
  { from: f(2.13), to: f(5.2), place: "lower", title: ["A 3D-printed band"], sub: "Built around the Apple Watch SE." },
  { from: f(5.43), to: f(7.2), place: "lower", title: ["Readings on the wrist"], sub: "Heart rate, breathing and more." },
  { from: f(7.43), to: f(9.25), place: "left", title: ["It flags", "what changes"], sub: "Pulse and breathing, marked for review." },
  { from: f(9.43), to: f(11.4), place: "left", title: ["Live on the", "dashboard"], sub: "Watch readings arrive as they happen." },
  { from: f(13.43), to: f(17.25), place: "left", title: ["Every reading,", "traceable"], sub: "With unit, time, source and quality." },
  { from: f(17.43), to: f(21.25), place: "left", title: ["See why", "it flagged"], sub: "The exact readings behind every flag." },
  { from: f(21.43), to: f(25.9), place: "left", title: ["Evidence,", "not a diagnosis"], sub: "Ask what changed. Open the NASA guide." },
];

/** Every reading on screen from here on comes from the app's simulated feed, so the film says so. */
export const SIMULATED = { from: f(5.333), to: f(26.0) };

export const MUSIC = "music/ouranos-music.wav";
export const URL_TEXT = "useouranos.vercel.app";
export const TAGLINE = "Health monitoring for astronauts";
export const CREDIT = "Built by Dhruv, Mustafa and Sriyan";
