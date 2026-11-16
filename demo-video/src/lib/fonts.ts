/**
 * Fonts embedded in the bundle (src/generated/fonts64.ts) and registered before any frame
 * renders, so no render tab waits on a network font. Geist and Geist Mono, the website's own UI
 * fonts, for every caption; Pinyon Script (the website's wordmark face) only for "Ouranos".
 */
import { continueRender, delayRender } from "remotion";
import { FONT_DATA } from "../generated/fonts64";

export const SANS = "OuranosGeist";
export const MONO = "OuranosGeistMono";
export const SCRIPT = "OuranosPinyon";

const FACES: [string, string, string][] = [
  [SANS, FONT_DATA.geist, "100 900"],
  [MONO, FONT_DATA.geistMono, "100 900"],
  [SCRIPT, FONT_DATA.script400, "400"],
];

const bytes = (b64: string) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
};

if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  const handle = delayRender("Registering fonts", { timeoutInMilliseconds: 60000, retries: 2 });
  Promise.all(
    FACES.map(([family, data, weight]) =>
      new FontFace(family, bytes(data), { weight, style: "normal" }).load().then((face) => {
        document.fonts.add(face);
      }),
    ),
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error("font registration failed", err);
      continueRender(handle);
    });
}
