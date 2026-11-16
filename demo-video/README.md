# Ouranos demo video (Space Apps 2026)

> **Branch `demo-video-motion`:** the same cut as Dhruv's `demo-video`, with motion added: `ouranos-demo-motion.mp4`. Each website page lands with a quick settle, punches in on the beat where something happens (the flag on Mission health, the assistant's answer on Health review), then eases back out to the whole page. The wrist hero shot pushes into the watch screen, and fast zooms carry motion blur. Focus points keep the zoomed pages clear of the margin captions. Pick whichever cut the team prefers.

The 28.0 second demo video, re-edited on 15 November (Claude, at Dhruv's request) from Sriyan's approved cut. Space Apps' limit is 30 seconds, and going over makes the project ineligible.
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
| 0:00 | The wordmark writes itself on, with "Health monitoring for astronauts" | text |
| 0:02 | Putting the watch on, the chain band from the side, the wrist | `assets/clips/c3.mp4`, `c1.mp4` (Sriyan's phone) |
| 0:05 | The real watch reads 128 bpm, Review; the camera pushes into its screen | `assets/clips/c2.mp4` |
| 0:07 | Match cut to the app's own screen: the body figure's chest amber, 128 bpm, Review | `assets/capture/watch_body_hires.png` |
| 0:09 | Mission health, the whole page, live; the flag lands on the 13.3 s beat and the astronaut turns gold | `assets/capture/web_hd_dashboard.mp4` |
| 0:17 | Health review, the whole page: "What changed?" goes in, the answer and its NASA guide link land on the 19.3 s beat | `assets/capture/web_hd_review.mp4` |
| 0:26 | End card on the final hit: wordmark, tagline, URL, team | text |

How it is cut: hard cuts on the beat, full-frame footage, no cards or frames. The website pages are shown whole and sharp: they were recorded at 3840x2160 (2x device pixels) from useouranos.vercel.app, paired to the dashboard's own mock watch (`dashboard/scripts/mock-watch.mjs`, every frame marked simulated), then downscaled to 1920x1080 with Lanczos (the 4K masters are not committed: rendering straight from them ran this Mac out of memory). The camera does not zoom into them. Type sits bottom-left over the phone footage, beside the watch screen, or in the website's own empty left margin; each line rises from behind a mask. "SIMULATED READINGS" sits bottom-left whenever readings are on screen, opposite the SI watermark.

`watch_body_hires.png` is the watch app's own SwiftUI view (`BodyFigure` from branch `feat/watch-body-figure`, with the app's elevated demo readings) rendered at 10x on a Mac, so it stays sharp at 4K. `watch_body.mp4` is the same screen recorded from the watchOS simulator.


Spare footage you can swap in: `assets/capture/web_other_crew_guide.mp4` (Crew guide), `web_other_daily_plan.mp4` (Daily plan), `assets/capture/web_home_watch.mp4` (the Home page's 3D watch assembling), `watch_app.mp4` (simulator, the Analytics screen; flags at 13.8 to 15.5 s), `watch_pairing_code.mp4`, `assets/renders/blender_assemble.mp4` (Blender render of the CAD case and band, scene in `blender/ouranos_hero.blend`). `assets/capture/notes.md` lists the best moments in each website recording.

## Space Apps rules this already follows (keep it that way)

- **Length:** 28.0 s. `scripts/master.sh` fails the render if it goes over 30 s.
- **SI watermark:** "SI-ASSISTED" sits in the bottom-right corner of every frame. Images and video made with SI must carry a visible watermark, so don't remove it.
- **Music:** `assets/music/ouranos-music.wav` is original music, synthesized in code with SI help (`scripts/make_music.py`). No copyrighted music. Say so in the project page's SI disclosure and References: "Demo music: original, synthesized in code with SI assistance."
- **People:** only Sriyan's hands and wrist (he is over 18). Don't add anyone under 18: no face, no voice.
- **NASA branding:** none was added. Check one thing: the dashboard's 3D astronaut (a third-party model credited on the site) has a small round blue patch on its left shoulder that may be a NASA logo. It is tiny in the video. If you want zero risk, crop or zoom past it.
- **Captions** are adapted from the team's own website copy, with SI help on the wording.
- **Simulated data:** every reading shown comes from the app's simulated feed, and the film labels it "SIMULATED READINGS" for those 20.7 seconds.

## Credits to list in References

- Geist and Geist Mono (Vercel, SIL Open Font License); Pinyon Script (SIL Open Font License).
- Remotion (video framework); Blender (3D render).
