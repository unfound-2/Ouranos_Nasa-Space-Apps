/**
 * Ouranos demo video. Every visual choice copies the website's own UI tokens
 * (dashboard/src/client/*.css): black void, #0a0a0a panels, #2e2e2e hairlines, #ededed ink,
 * #a1a1a1 secondary ink, Geist + Geist Mono, 18px card radius, ease-out-quart motion,
 * and the Pinyon Script wordmark. No new graphic language: the footage is the UI itself.
 */
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { MONO, SANS, SCRIPT } from "./lib/fonts";
import media from "./generated/media.json";
import { CAPTIONS, Cam, FPS, MUSIC, SHOTS, Shot, URL_TEXT } from "./timeline";

const C = { void: "#000000", panel: "#0a0a0a", line: "#2e2e2e", ink: "#ededed", ink2: "#a1a1a1", ink3: "#8f8f8f" };
const quart = Easing.bezier(0.25, 1, 0.5, 1); // --ease-out-quart
const XF = 8; // crossfade frames between shots
const has = (p: string) => p in (media as Record<string, unknown>);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const smooth = Easing.bezier(0.65, 0, 0.35, 1); // camera moves: ease in and out

/** Camera inside a website card at time t (s): zoom and focus point, eased between keys. */
const camAt = (keys: Cam[] | undefined, t: number): [number, number, number] => {
  if (!keys?.length) return [1, 0.5, 0.5];
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2], keys[0][3]];
  for (let i = 1; i < keys.length; i++) {
    const [t0, s0, x0, y0] = keys[i - 1];
    const [t1, s1, x1, y1] = keys[i];
    if (t <= t1) {
      const u = smooth((t - t0) / (t1 - t0));
      return [s0 + (s1 - s0) * u, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
    }
  }
  const k = keys[keys.length - 1];
  return [k[1], k[2], k[3]];
};

const rise = (frame: number, delay = 0, dur = 16) => interpolate(frame - delay, [0, dur], [0, 1], { ...clamp, easing: quart });

const Heading = ({ title, sub, top = 62 }: { title?: string; sub?: string; top?: number }) => {
  const frame = useCurrentFrame();
  const a = rise(frame, 3), b = rise(frame, 8);
  return (
    <div style={{ position: "absolute", top, left: 0, right: 0, textAlign: "center" }}>
      {title && (
        <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: 62, letterSpacing: "-0.035em", color: C.ink, opacity: a, transform: `translateY(${(1 - a) * 14}px)` }}>
          {title}
        </div>
      )}
      {sub && (
        <div style={{ fontFamily: SANS, fontWeight: 400, fontSize: 28, color: C.ink2, marginTop: 10, opacity: b, transform: `translateY(${(1 - b) * 10}px)` }}>
          {sub}
        </div>
      )}
    </div>
  );
};

const Missing = ({ src }: { src: string }) => (
  <AbsoluteFill style={{ background: C.panel, alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 22, color: C.ink3 }}>
    waiting for {src}
  </AbsoluteFill>
);

const Footage = ({ src, startAt, rate = 1 }: { src: string; startAt: number; rate?: number }) =>
  has(src) ? (
    <OffthreadVideo src={staticFile(src)} startFrom={Math.round(startAt * FPS)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <Missing src={src} />
  );

const WebShot = ({ s }: { s: Extract<Shot, { kind: "web" }> }) => {
  const frame = useCurrentFrame();
  const W = 1440, H = 810;
  const [z, fx, fy] = camAt(s.cam, frame / FPS);
  const tx = Math.min(0, Math.max(W - W * z, W / 2 - fx * W * z));
  const ty = Math.min(0, Math.max(H - H * z, H / 2 - fy * H * z));
  const lift = rise(frame, 0, 24);
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Heading title={s.title} sub={s.sub} />
      <div style={{ position: "absolute", left: (1920 - W) / 2, top: 214, width: W, height: H, borderRadius: 18, overflow: "hidden", border: `1px solid ${C.line}`, background: C.panel,
        transform: `perspective(1800px) translateY(${(1 - lift) * 44}px) rotateX(${(1 - lift) * 7}deg) scale(${0.97 + 0.03 * lift})` }}>
        <div style={{ width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${z})`, transformOrigin: "0 0" }}>
          <Footage src={s.src} startAt={s.startAt} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const WatchShot = ({ s }: { s: Extract<Shot, { kind: "watch" }> }) => {
  const frame = useCurrentFrame();
  const lift = rise(frame, 0, 22);
  const drift = interpolate(frame, [0, s.to - s.from], [0, 1], clamp);
  const h = 640, w = Math.round((h * 324) / 394);
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Heading title={s.title} sub={s.sub} />
      <div style={{ position: "absolute", left: (1920 - w) / 2 - 20, top: 250, padding: 20, borderRadius: 140, background: C.panel, border: `1px solid ${C.line}`,
        transform: `perspective(1600px) translateY(${(1 - lift) * 40}px) rotateY(${-10 + 7 * drift}deg) rotateX(${(1 - lift) * 6}deg) scale(${0.94 + 0.06 * lift + 0.03 * drift})` }}>
        <div style={{ width: w, height: h, borderRadius: 120, overflow: "hidden", background: "#000" }}>
          <Footage src={s.src} startAt={s.startAt} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ClipShot = ({ s }: { s: Extract<Shot, { kind: "clip" }> }) => {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, s.to - s.from + XF], [1.0, 1.05], clamp);
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <AbsoluteFill style={{ transform: `scale(${z})` }}>
        <Footage src={s.src} startAt={s.startAt} rate={s.rate} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const CaptionOverlay = ({ title, sub, len }: { title: string; sub: string; len: number }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 6, len - 6, len], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 22%, rgba(0,0,0,0) 38%)" }} />
      <Heading title={title} sub={sub} />
    </AbsoluteFill>
  );
};

const RenderShot = ({ s }: { s: Extract<Shot, { kind: "render" }> }) => {
  const frame = useCurrentFrame();
  const i = Math.min(s.frames, frame + 1);
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Img src={staticFile(`${s.dir}f_${String(i).padStart(4, "0")}.png`)} style={{ width: "100%", height: "100%" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 30%)" }} />
      <Heading title={s.title} sub={s.sub} />
    </AbsoluteFill>
  );
};

const Wordmark = ({ size, opacity, y }: { size: number; opacity: number; y: number }) => (
  <div style={{ fontFamily: SCRIPT, fontSize: size, color: C.ink, opacity, transform: `translateY(${y}px)`, lineHeight: 1.2 }}>Ouranos</div>
);

const Title = ({ len }: { len: number }) => {
  const frame = useCurrentFrame();
  const a = rise(frame, 4, 24);
  const out = interpolate(frame, [len - 10, len], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.void, alignItems: "center", justifyContent: "center" }}>
      <Wordmark size={220} opacity={a * out} y={(1 - a) * 16} />
    </AbsoluteFill>
  );
};

const End = ({ sub }: { sub?: string }) => {
  const frame = useCurrentFrame();
  const a = rise(frame, 2, 20), b = rise(frame, 9), c = rise(frame, 14);
  return (
    <AbsoluteFill style={{ background: C.void, alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
      <Wordmark size={190} opacity={a} y={(1 - a) * 14} />
      <div style={{ fontFamily: SANS, fontSize: 30, color: C.ink2, marginTop: 6, opacity: b }}>{sub}</div>
      <div style={{ fontFamily: MONO, fontSize: 24, color: C.ink3, marginTop: 22, opacity: c }}>{URL_TEXT}</div>
    </AbsoluteFill>
  );
};

const ShotView = ({ s }: { s: Shot }) => {
  switch (s.kind) {
    case "title": return <Title len={s.to - s.from} />;
    case "end": return <End sub={s.sub} />;
    case "web": return <WebShot s={s} />;
    case "watch": return <WatchShot s={s} />;
    case "clip": return <ClipShot s={s} />;
    case "render": return <RenderShot s={s} />;
  }
};

const Fade = ({ children, title }: { children: React.ReactNode; title: boolean }) => {
  const frame = useCurrentFrame();
  const o = title ? 1 : interpolate(frame, [0, XF], [0, 1], { ...clamp, easing: quart });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Ouranos = () => (
  <AbsoluteFill style={{ background: C.void }}>
    {SHOTS.map((s, i) => {
      const last = i === SHOTS.length - 1;
      return (
        <Sequence key={i} from={s.from} durationInFrames={s.to - s.from + (last || SHOTS[i + 1]?.cut ? 0 : XF)}>
          <Fade title={s.kind === "title" || !!s.cut}>
            <ShotView s={s} />
          </Fade>
        </Sequence>
      );
    })}
    {CAPTIONS.map((c, i) => (
      <Sequence key={`c${i}`} from={c.from} durationInFrames={c.to - c.from}>
        <CaptionOverlay title={c.title} sub={c.sub} len={c.to - c.from} />
      </Sequence>
    ))}
    {/* Space Apps: video made with SI must carry a visible watermark, on every frame. */}
    <div style={{ position: "absolute", right: 30, bottom: 24, fontFamily: MONO, fontSize: 17, letterSpacing: "0.08em", color: C.ink, opacity: 0.82, textShadow: "0 1px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)" }}>SI-ASSISTED</div>
    {has(MUSIC) && <Audio src={staticFile(MUSIC)} />}
  </AbsoluteFill>
);
