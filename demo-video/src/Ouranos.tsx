/**
 * Ouranos demo film. The look copies the website's own tokens (dashboard/src/client/*.css):
 * black void, #ededed and #a1a1a1 ink, Geist, ease-out-quart motion and the Pinyon Script wordmark.
 *
 * Edit grammar: hard cuts on the beat, full-frame footage, no cards, frames, pills or dots.
 * Type sits either bottom-left over footage or in a black column beside the product, and each
 * line is revealed from behind a mask. The product picture is the real UI, moved by a camera.
 */
import React from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { MONO, SANS, SCRIPT } from "./lib/fonts";
import media from "./generated/media.json";
import { Cam, CAPTIONS, Caption, CREDIT, CursorKey, FPS, Mark, MUSIC, SHOTS, SIMULATED, Shot, TAGLINE, TOTAL, URL_TEXT } from "./timeline";

const C = { void: "#000000", ink: "#ededed", ink2: "#a1a1a1", ink3: "#8f8f8f" };
const W = 1920;
const H = 1080;
const quart = Easing.bezier(0.25, 1, 0.5, 1); // --ease-out-quart
const inOut = Easing.bezier(0.65, 0, 0.35, 1); // camera moves between keys
const into = Easing.bezier(0.7, 0, 0.84, 0); // a push that accelerates into the cut
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const has = (p: string) => p in (media as Record<string, unknown>);
const between = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Motion blur in px from how fast the zoom changes between two frames (fast punch-ins smear, drifts stay sharp). */
const speedBlur = (z: number, zPrev: number, k = 350, cap = 12) => {
  const b = Math.min(cap, Math.abs(z - zPrev) * k);
  return b > 0.4 ? `blur(${b.toFixed(2)}px)` : undefined;
};

/** Watch and website shots: the type column on the left, the picture from VIEW_X to the right edge. */
const TEXT_X = 120;
const VIEW_X = 700;
const FEATHER = 150;

/** Camera at time t (s): zoom and focus point, eased between keys. */
const camAt = (keys: Cam[], t: number): [number, number, number] => {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2], keys[0][3]];
  for (let i = 1; i < keys.length; i++) {
    const [t0, z0, x0, y0] = keys[i - 1];
    const [t1, z1, x1, y1] = keys[i];
    if (t <= t1) {
      const u = inOut((t - t0) / (t1 - t0));
      return [z0 + (z1 - z0) * u, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
    }
  }
  const k = keys[keys.length - 1];
  return [k[1], k[2], k[3]];
};

const Missing = ({ src }: { src: string }) => (
  <AbsoluteFill style={{ background: "#0a0a0a", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 22, color: C.ink3 }}>
    waiting for {src}
  </AbsoluteFill>
);

const Footage = ({ src, startAt, rate = 1 }: { src: string; startAt: number; rate?: number }) =>
  has(src) ? (
    <OffthreadVideo src={staticFile(src)} startFrom={Math.round(startAt * FPS)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <Missing src={src} />
  );

/** One line of type that rises into view from behind its own edge. */
const Reveal = ({ delay, children, style }: { delay: number; children: React.ReactNode; style: React.CSSProperties }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 16], [0, 1], { ...clamp, easing: quart });
  return (
    <div style={{ overflow: "hidden", paddingBottom: "0.14em", marginBottom: "-0.14em" }}>
      <div style={{ ...style, transform: `translateY(${(1 - p) * 112}%)` }}>{children}</div>
    </div>
  );
};

const CaptionView = ({ c }: { c: Caption }) => {
  const frame = useCurrentFrame();
  const len = c.to - c.from;
  const out = interpolate(frame, [len - 7, len], [1, 0], { ...clamp, easing: quart });
  const corner = c.place === "corner";
  const lower = c.place === "lower" || corner;
  const margin = c.place === "margin";
  const size = corner ? 56 : lower ? 80 : margin ? 44 : 78;
  const block: React.CSSProperties = corner
    ? { position: "absolute", left: 72, bottom: 92, width: 1100 }
    : lower
    ? { position: "absolute", left: TEXT_X, bottom: 136, width: 1100 }
    : margin
      ? { position: "absolute", left: 64, top: 312, width: 352 }
      : { position: "absolute", left: TEXT_X, top: H / 2, width: 600, transform: "translateY(-50%)" };
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {lower && (
        <AbsoluteFill style={{ background: "radial-gradient(ellipse 62% 58% at 0% 100%, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0) 80%)" }} />
      )}
      <div style={block}>
        {c.title.map((line, i) => (
          <Reveal key={line} delay={i * 3} style={{ fontFamily: SANS, fontSize: size, fontWeight: 600, letterSpacing: "-0.042em", lineHeight: 1.0, color: C.ink, whiteSpace: "nowrap" }}>
            {line}
          </Reveal>
        ))}
        {c.sub && (
          <div style={{ marginTop: corner ? 12 : lower ? 22 : margin ? 16 : 26 }}>
            <Reveal delay={c.title.length * 3 + 3} style={{ fontFamily: SANS, fontSize: corner ? 25 : lower ? 30 : margin ? 21 : 29, fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.36, color: C.ink2, maxWidth: lower ? 900 : margin ? 330 : 560 }}>
              {c.sub}
            </Reveal>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Phone footage, full frame: a slow push, and optionally a fast push into one point to carry a cut. */
const ClipShot = ({ s }: { s: Extract<Shot, { kind: "clip" }> }) => {
  const frame = useCurrentFrame();
  const len = s.to - s.from;
  const t = frame / FPS;
  const at = (tt: number) => {
    let zoom = interpolate(tt * FPS, [0, len], [1.0, 1.045], clamp);
    let ox = 0.5;
    let oy = 0.5;
    if (s.push) {
      const [pAt, z, fx, fy] = s.push;
      const p = interpolate(tt, [pAt, len / FPS], [0, 1], { ...clamp, easing: into });
      zoom += (z - zoom) * p;
      ox = 0.5 + (fx - 0.5) * Math.min(1, p * 3);
      oy = 0.5 + (fy - 0.5) * Math.min(1, p * 3);
    }
    return [zoom, ox, oy] as const;
  };
  const [zoom, ox, oy] = at(t);
  const blur = speedBlur(zoom, at(t - 1 / FPS)[0], 160, 14);
  return (
    <AbsoluteFill style={{ background: C.void, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: `${ox * 100}% ${oy * 100}%`, filter: `contrast(1.05) saturate(1.05)${blur ? " " + blur : ""}` }}>
        <Footage src={s.src} startAt={s.startAt} rate={s.rate} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 85% at 50% 48%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.38) 100%)" }} />
    </AbsoluteFill>
  );
};

/**
 * The watch app's own screen. It enters large, tilted like the real watch at the end of the previous
 * shot, then rights itself and slides right to make room for the type.
 */
const WatchShot = ({ s }: { s: Extract<Shot, { kind: "watch" }> }) => {
  const frame = useCurrentFrame();
  const len = s.to - s.from;
  const p = interpolate(frame, [0, 20], [0, 1], { ...clamp, easing: quart });
  const drift = interpolate(frame, [0, len], [0, 1], clamp);
  const still = /\.png$/.test(s.src);
  const bw = still ? 832 : 832;
  const bh = still ? 816 : 704;
  const cx = 960 + (1290 - 960) * p;
  const cy = 500 + (552 - 500) * p;
  const scale = (still ? 1.1 : 1.24) * (1.42 - 0.42 * p) * (1 + 0.025 * drift);
  return (
    <AbsoluteFill style={{ background: C.void, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh, transform: `rotate(${-13 * (1 - p)}deg) scale(${scale})` }}>
        {/\.png$/.test(s.src) ? <Img src={staticFile(s.src)} style={{ width: "100%", height: "100%" }} /> : <Footage src={s.src} startAt={s.startAt} />}
      </div>
    </AbsoluteFill>
  );
};

/** A website recording seen through a camera. With a takeover, the page widens to the full frame on the beat. */
const WebShot = ({ s }: { s: Extract<Shot, { kind: "web" }> }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const len = (s.to - s.from) / FPS;
  let [z, fx, fy] = camAt(s.cam, t);
  let wide = 0;
  if (s.takeover) {
    const { at, zoom, fx: tx, fy: ty } = s.takeover;
    wide = interpolate(t, [at, at + 0.42], [0, 1], { ...clamp, easing: quart });
    const creep = 1 + 0.045 * interpolate(t, [at, len], [0, 1], clamp);
    z += (zoom * creep - z) * wide;
    fx += (tx - fx) * wide;
    fy += (ty - fy) * wide;
  }
  const vx = VIEW_X * (1 - wide);
  const vw = W - vx;
  const pw = W * z;
  const ph = H * z;
  const x = between(vw / 2 - fx * pw, vw - pw, 0);
  const y = between(H / 2 - fy * ph, H - ph, 0);
  const feather = FEATHER * (1 - wide);
  const mask = feather > 1 ? `linear-gradient(90deg, rgba(0,0,0,0) 0px, rgba(0,0,0,1) ${feather}px)` : undefined;
  const settle = interpolate(frame, [0, 18], [1.035, 1], { ...clamp, easing: quart });
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <div style={{ position: "absolute", left: vx, top: 0, width: vw, height: H, overflow: "hidden", WebkitMaskImage: mask, maskImage: mask }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${settle})`, transformOrigin: "50% 50%" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translate(${x}px, ${y}px) scale(${z})`, transformOrigin: "0 0" }}>
            <Footage src={s.src} startAt={s.startAt} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * A whole website page, full frame and sharp (recorded at 2x). The camera lands with a quick settle, then
 * punches in on the beat where something happens and eases back out to the whole page.
 */
const PageShot = ({ s }: { s: Extract<Shot, { kind: "page" }> }) => {
  const frame = useCurrentFrame();
  const [z, fx, fy] = camAt(s.cam, frame / FPS);
  const [zPrev] = camAt(s.cam, (frame - 1) / FPS);
  const pw = W * z;
  const ph = H * z;
  const x = between(W / 2 - fx * pw, W - pw, 0);
  const y = between(H / 2 - fy * ph, H - ph, 0);
  return (
    <AbsoluteFill style={{ background: C.void, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translate(${x}px, ${y}px) scale(${z})`, transformOrigin: "0 0", filter: speedBlur(z, zPrev) }}>
        <Footage src={s.src} startAt={s.startAt} />
      </div>
    </AbsoluteFill>
  );
};


/** Cursor position at time t, eased between keys (page px). */
const cursorAt = (keys: CursorKey[], t: number): [number, number] => {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    const [t0, x0, y0] = keys[i - 1];
    const [t1, x1, y1] = keys[i];
    if (t <= t1) {
      const u = inOut((t - t0) / (t1 - t0));
      return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
    }
  }
  const k = keys[keys.length - 1];
  return [k[1], k[2]];
};

/** A pointer in the site's ink, the same size on screen at any zoom; it presses and ripples on a click. */
const Cursor = ({ keys, t, z }: { keys: CursorKey[]; t: number; z: number }) => {
  const [x, y] = cursorAt(keys, t);
  const show = interpolate(t, [keys[0][0] - 0.25, keys[0][0]], [0, 1], clamp);
  const clicks = keys.filter((k) => k[3] === "click").map((k) => k[0]);
  const press = clicks.reduce((m, c) => Math.max(m, interpolate(t, [c - 0.08, c, c + 0.12], [0, 1, 0], clamp)), 0);
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `scale(${1 / z})`, transformOrigin: "0 0", opacity: show, pointerEvents: "none" }}>
      {clicks.map((c, i) => {
        const r = interpolate(t, [c, c + 0.5], [0, 1], { ...clamp, easing: quart });
        const on = t >= c && t <= c + 0.5;
        return on ? (
          <div key={i} style={{ position: "absolute", left: -34 * r, top: -34 * r, width: 68 * r, height: 68 * r, borderRadius: "50%", border: `2px solid rgba(237,237,237,${0.9 * (1 - r)})`, background: `rgba(237,237,237,${0.18 * (1 - r)})` }} />
        ) : null;
      })}
      <svg width="34" height="40" viewBox="0 0 34 40" style={{ position: "absolute", left: -3, top: -2, transform: `scale(${1 - 0.14 * press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.55))" }}>
        <path d="M3 2 L3 31 L10.5 24.5 L15.5 36 L20.5 33.8 L15.6 22.6 L25.5 22.6 Z" fill="#ededed" stroke="#0a0a0a" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** An outline that draws itself around an element, then fades. Stroke width stays the same on screen. */
const MarkBox = ({ m, t, z }: { m: Mark; t: number; z: number }) => {
  const [bx, by, bw, bh] = m.box;
  const pad = 10;
  const w = bw + pad * 2, h = bh + pad * 2, r = 16;
  const per = 2 * (w + h - 4 * r) + 2 * Math.PI * r;
  const draw = interpolate(t, [m.from, m.from + 0.55], [0, 1], { ...clamp, easing: quart });
  const fade = interpolate(t, [m.to - 0.25, m.to], [1, 0], clamp);
  if (t < m.from || t > m.to) return null;
  return (
    <svg style={{ position: "absolute", left: bx - pad, top: by - pad, overflow: "visible", pointerEvents: "none" }} width={w} height={h}>
      <rect x={0} y={0} width={w} height={h} rx={r} fill="none" stroke={m.color ?? "#ffc53d"} strokeWidth={3 / z} strokeDasharray={per} strokeDashoffset={per * (1 - draw)} opacity={fade}
        style={{ filter: `drop-shadow(0 0 ${6 / z}px ${(m.color ?? "#ffc53d")}66)` }} />
    </svg>
  );
};

/** Someone using the site, up close: the camera follows the action, with a cursor and outlines on top. */
const UsageShot = ({ s }: { s: Extract<Shot, { kind: "usage" }> }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const [z, fx, fy] = camAt(s.cam, t);
  const [zp, fxp, fyp] = camAt(s.cam, t - 1 / FPS);
  const pw = W * z;
  const ph = H * z;
  const x = between(W / 2 - fx * pw, W - pw, 0);
  const y = between(H / 2 - fy * ph, H - ph, 0);
  const speed = Math.abs(z - zp) * 300 + Math.hypot((fx - fxp) * W, (fy - fyp) * H) * z * 0.06;
  const blur = Math.min(10, speed);
  return (
    <AbsoluteFill style={{ background: C.void, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translate(${x}px, ${y}px) scale(${z})`, transformOrigin: "0 0", filter: blur > 0.4 ? `blur(${blur.toFixed(2)}px)` : undefined }}>
        <Footage src={s.src} startAt={s.startAt} />
        {(s.marks ?? []).map((m, i) => <MarkBox key={i} m={m} t={t} z={z} />)}
        {s.cursor && <Cursor keys={s.cursor} t={t} z={z} />}
      </div>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 80% at 50% 50%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.35) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

/** The wordmark writes itself on behind a soft wipe while the music rises into the first hit. */
const Title = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const w = interpolate(t, [0.2, 1.4], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) });
  const edge = w * 125 - 12;
  const mask = `linear-gradient(90deg, rgba(0,0,0,1) ${edge}%, rgba(0,0,0,0) ${edge + 12}%)`;
  const settle = 1.035 - 0.035 * interpolate(t, [0, 2], [0, 1], { ...clamp, easing: quart });
  return (
    <AbsoluteFill style={{ background: C.void, alignItems: "center", justifyContent: "center" }}>
      <div style={{ transform: `scale(${settle})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: SCRIPT, fontSize: 236, lineHeight: 1.18, color: C.ink, padding: "0 60px", WebkitMaskImage: mask, maskImage: mask }}>Ouranos</div>
        <Reveal delay={31} style={{ fontFamily: SANS, fontSize: 30, fontWeight: 400, letterSpacing: "-0.01em", color: C.ink2 }}>
          {TAGLINE}
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

/** On the final hit: the wordmark is already there; the lines follow, then everything leaves to black. */
const End = () => {
  const frame = useCurrentFrame();
  const len = TOTAL - SHOTS[SHOTS.length - 1].from;
  const settle = 1.05 - 0.05 * interpolate(frame, [0, 28], [0, 1], { ...clamp, easing: quart });
  const away = interpolate(frame, [len - 16, len - 2], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.void, alignItems: "center", justifyContent: "center", opacity: away }}>
      <div style={{ transform: `scale(${settle})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: SCRIPT, fontSize: 210, lineHeight: 1.18, color: C.ink, opacity: interpolate(frame, [0, 3], [0, 1], clamp) }}>Ouranos</div>
        <Reveal delay={5} style={{ fontFamily: SANS, fontSize: 30, fontWeight: 400, letterSpacing: "-0.01em", color: C.ink2 }}>
          {TAGLINE}
        </Reveal>
        <div style={{ height: 30 }} />
        <Reveal delay={9} style={{ fontFamily: MONO, fontSize: 25, color: C.ink, letterSpacing: "0.01em" }}>
          {URL_TEXT}
        </Reveal>
        <div style={{ height: 14 }} />
        <Reveal delay={13} style={{ fontFamily: SANS, fontSize: 22, color: C.ink3 }}>
          {CREDIT}
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

const ShotView = ({ s }: { s: Shot }) => {
  switch (s.kind) {
    case "title": return <Title />;
    case "end": return <End />;
    case "web": return <WebShot s={s} />;
    case "page": return <PageShot s={s} />;
    case "usage": return <UsageShot s={s} />;
    case "watch": return <WatchShot s={s} />;
    case "clip": return <ClipShot s={s} />;
  }
};

/** Disclosure text, bottom corners, in the watermark's own style. */
const corner: React.CSSProperties = {
  position: "absolute", bottom: 24, fontFamily: MONO, fontSize: 17, letterSpacing: "0.08em", color: C.ink, opacity: 0.82,
  textShadow: "0 0 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,0.95), 0 1px 10px rgba(0,0,0,0.9), 0 0 22px rgba(0,0,0,0.7)",
};

export const Ouranos = () => (
  <AbsoluteFill style={{ background: C.void }}>
    {SHOTS.map((s, i) => (
      <Sequence key={i} from={s.from} durationInFrames={s.to - s.from}>
        <ShotView s={s} />
      </Sequence>
    ))}
    {CAPTIONS.map((c, i) => (
      <Sequence key={`c${i}`} from={c.from} durationInFrames={c.to - c.from}>
        <CaptionView c={c} />
      </Sequence>
    ))}
    <Sequence from={SIMULATED.from} durationInFrames={SIMULATED.to - SIMULATED.from}>
      <div style={{ ...corner, left: 30 }}>SIMULATED READINGS</div>
    </Sequence>
    {/* Space Apps: video made with SI must carry a visible watermark, on every frame. */}
    <div style={{ ...corner, right: 30 }}>SI-ASSISTED</div>
    {has(MUSIC) && <Audio src={staticFile(MUSIC)} />}
  </AbsoluteFill>
);
