/**
 * The whole edit in one place: 28.0 s at 30 fps (Space Apps limit is 30 s).
 * Cuts sit on the music's beat grid (90 BPM): 2.0, 5.333, 9.333 (groove starts), 13.333,
 * 17.333, 21.333 (lift), 23.667, 26.0 (final hit). Captions reuse the team's website wording.
 */
export const FPS = 30;
export const TOTAL = 840;
export const f = (s: number) => Math.round(s * FPS);

type Base = { from: number; to: number; title?: string; sub?: string; cut?: boolean };
export type Shot =
  | (Base & { kind: "title" })
  | (Base & { kind: "end" })
  | (Base & { kind: "render"; dir: string; frames: number })
  | (Base & { kind: "clip"; src: string; startAt: number; rate?: number })
  | (Base & { kind: "watch"; src: string; startAt: number })
  | (Base & { kind: "web"; src: string; startAt: number; cam?: Cam[] });

/** Camera key inside a website card: [seconds into the shot, zoom, focus x, focus y] (focus in 0..1 of the page). */
export type Cam = [number, number, number, number];

export const SHOTS: Shot[] = [
  { kind: "title", from: 0, to: f(2.0) },
  // Real footage (Sriyan's phone): hard cuts on the beat.
  { kind: "clip", from: f(2.0), to: f(3.333), src: "clips/c3.mp4", startAt: 0.5, cut: true },
  { kind: "clip", from: f(3.333), to: f(4.333), src: "clips/c3.mp4", startAt: 4.3, cut: true },
  { kind: "clip", from: f(4.333), to: f(5.333), src: "clips/c1.mp4", startAt: 0.1, cut: true },
  { kind: "clip", from: f(5.333), to: f(7.333), src: "clips/c2.mp4", startAt: 0.5, rate: 1.5, cut: true },
  // The watch app's own screen, crisp: heart rate jumps to 128 "Review", then the blood oxygen dial.
  { kind: "watch", from: f(7.333), to: f(9.333), src: "capture/watch_app_long.mp4", startAt: 13.2, cut: true },
  // The website: the main part of the video. Each card starts wide, then the camera pushes in.
  { kind: "web", from: f(9.333), to: f(13.333), src: "capture/web_dashboard.mp4", startAt: 0.3,
    cam: [[0, 1.0, 0.5, 0.5], [1.3, 1.0, 0.5, 0.5], [3.4, 1.7, 0.69, 0.57]],
    title: "One health dashboard", sub: "Watch readings arrive live." },
  { kind: "web", from: f(13.333), to: f(17.333), src: "capture/web_crew_health.mp4", startAt: 0.5,
    cam: [[0, 1.45, 0.31, 0.45], [4.3, 1.75, 0.31, 0.58]],
    title: "Every monitoring system", sub: "Each reading keeps its unit, time, source and quality." },
  { kind: "web", from: f(17.333), to: f(21.333), src: "capture/web_dashboard_long.mp4", startAt: 7.6,
    cam: [[0, 1.12, 0.5, 0.5], [1.5, 1.12, 0.5, 0.5], [3.5, 1.95, 0.3, 0.37]],
    title: "Review what stands out", sub: "And check the readings behind a flag." },
  { kind: "web", from: f(21.333), to: f(26.0), src: "capture/web_other_health_review.mp4", startAt: 0.8,
    cam: [[0, 1.0, 0.5, 0.5], [1.0, 1.25, 0.5, 0.45], [3.6, 1.6, 0.62, 0.58]],
    title: "Guidance when you need it", sub: "Ask about your readings and open a linked source." },
  { kind: "end", from: f(26.0), to: TOTAL, sub: "A clearer way to understand your health." },
];

/** Captions laid over the real footage (the web shots carry their own heading). */
export const CAPTIONS: { from: number; to: number; title: string; sub: string }[] = [
  { from: f(2.0), to: f(5.333), title: "A custom shroud and chain band", sub: "3D-printed to fit around the Apple Watch SE." },
  { from: f(5.333), to: f(9.333), title: "The watch and your readings", sub: "Pair it with Ouranos to see trends." },
];

export const MUSIC = "music/ouranos-music.wav";
export const URL_TEXT = "useouranos.vercel.app";
