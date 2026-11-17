// List every media file under assets/ with its duration, so the composition can skip
// shots whose footage has not arrived yet. Run before studio/still/render.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../assets/", import.meta.url).pathname;
const out = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(mp4|mov|wav|png)$/i.test(name) || /\/f_\d+\.png$/.test(p)) continue;
    let duration = 0;
    if (!/\.png$/i.test(name)) {
      duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim()) || 0;
    }
    out[relative(root, p)] = { duration };
  }
};
walk(root);
const seq = (d) => { try { return readdirSync(join(root, d)).filter((n) => /^f_\d+\.png$/.test(n)).length; } catch { return 0; } };
out["renders/assemble/"] = { frames: seq("renders/assemble") };
writeFileSync(new URL("../src/generated/media.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(Object.keys(out).length, "media entries");
