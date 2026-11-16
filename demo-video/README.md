# Ouranos demo video (Space Apps 2026)

The 28.0 second demo video. Space Apps' limit is 30 seconds, and going over makes the project ineligible.
The rendered file is `ouranos-demo.mp4` in this folder.

## Change something

Everything that matters is in **`src/timeline.ts`**: every shot (start, end, which file, which moment of it) and every caption.
Each website shot has `cam` keys `[seconds, zoom, focusX, focusY]`: the card starts wide and the camera eases in to the focus point (0..1 of the page).
The look is in `src/Ouranos.tsx`, and it copies the website's own tokens: black void, `#0a0a0a` panels, `#2e2e2e` hairlines, `#ededed` and `#a1a1a1` text, Geist, an 18 px card radius, ease-out-quart motion, and the Pinyon Script wordmark.

```bash
npm install
npm run studio     # live preview in the browser
npm run render     # writes out/ouranos-demo.mp4 (mastered to -14 LUFS; fails if over 30 s)
```

Cuts sit on the music's beat grid (90 BPM, so 2.0, 5.333, 9.333, 13.333, 17.333, 21.333 and 26.0 s). Keep new cuts on those times so the hits line up.

## What is in it

| Time | Shot | Source |
|---|---|---|
| 0:00 | Ouranos wordmark | text |
| 0:02 | Putting the watch on, band side view, wrist hero | `assets/clips/c3.mp4`, `c1.mp4` (Sriyan's phone) |
| 0:05 | The app on the real watch, then the app's own screen up close (heart rate jumps to 128 "Review", blood oxygen dial) | `assets/clips/c2.mp4`, `assets/capture/watch_app_long.mp4` |
| 0:09 | Mission health, watch connected, live charts | `assets/capture/web_dashboard.mp4` |
| 0:13 | Monitoring systems (Crew Health) | `assets/capture/web_crew_health.mp4` |
| 0:17 | The live flag (pulse and breathing flagged) | `assets/capture/web_dashboard_long.mp4` |
| 0:21 | Health review: the assistant explains what changed and links the guide | `assets/capture/web_other_health_review.mp4` |
| 0:26 | End card with the URL | text |

Spare footage you can swap in: `assets/capture/web_other_crew_guide.mp4` (Crew guide), `web_other_daily_plan.mp4` (Daily plan), `assets/capture/web_home_watch.mp4` (the Home page's 3D watch assembling), `watch_app.mp4` (simulator, the Analytics screen; flags at 13.8 to 15.5 s), `watch_pairing_code.mp4`, `assets/renders/blender_assemble.mp4` (Blender render of the CAD case and band, scene in `blender/ouranos_hero.blend`). `assets/capture/notes.md` lists the best moments in each website recording.

## Space Apps rules this already follows (keep it that way)

- **Length:** 28.0 s. `scripts/master.sh` fails the render if it goes over 30 s.
- **SI watermark:** "SI-ASSISTED" sits in the bottom-right corner of every frame. Images and video made with SI must carry a visible watermark, so don't remove it.
- **Music:** `assets/music/ouranos-music.wav` is original music, synthesized in code with SI help (`scripts/make_music.py`). No copyrighted music. Say so in the project page's SI disclosure and References: "Demo music: original, synthesized in code with SI assistance."
- **People:** only Sriyan's hands and wrist (he is over 18). Don't add anyone under 18: no face, no voice.
- **NASA branding:** none was added. Check one thing: the dashboard's 3D astronaut (a third-party model credited on the site) has a small round blue patch on its left shoulder that may be a NASA logo. It is tiny in the video. If you want zero risk, crop or zoom past it.
- **Captions** are adapted from the team's own website copy, with SI help on the wording.

## Credits to list in References

- Geist and Geist Mono (Vercel, SIL Open Font License); Pinyon Script (SIL Open Font License).
- Remotion (video framework); Blender (3D render).
