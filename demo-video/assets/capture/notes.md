# OURANOS capture notes (2026-11-15)

All files are H.264 High, yuv420p, constant 30 fps, no audio.

## watch_app.mp4 (324x394, native simulator pixels, 15.5 s)

Apple Watch SE 3 (40mm) simulator, app rebuilt from origin/main, paired to useouranos.vercel.app, running in **Sim** mode (the app's own simulated feed; the simulator has no HealthKit data).

- 0.0-2.6 s: lead-in on the app's Home screen (body figure, "Simulation" label). Static.
- 2.6-4.3 s: menu opens, Analytics is tapped.
- 4.3-6.4 s: Analytics tiles: Heart rate 128 bpm, Breathing 27 /min, pulse bars and sparkline.
- ~6.5 s: values drop to 74 bpm / 16 /min.
- 6.5-14.0 s: readings tick about every 2.4 s (pulse bars and sparkline shift; numbers stay 74 / 16). A short automatic scroll at ~9.6 s shows the Blood oxygen and Skin temperature labels.
- ~14.0-15.5 s: scroll down plus a jump to 128 bpm / 27 /min with "Review" labels; the Blood oxygen ring comes into view. Good closing beat.
- **Best stretch: 4.3-15.5 s.** Best single beat: 13.8-15.5 s (values jump and get flagged "Review").

Avoid or know: values only change every ~2.4 s, so the screen holds still between updates. Once scrolled (from ~9.6 s) the app's round menu button sits over the Breathing tile; that's how the app looks, not a capture glitch. The clock shows the real time (8:38); watchOS simulators don't support a status-bar override.

## watch_pairing_code.mp4 (bonus, 324x394, 6.0 s)

The onboarding screen ("OURANOS / Crew health / Get pairing code").
- 0.0-3.0 s: onboarding screen, static.
- 3.0-4.4 s: "Generating code..."
- ~4.5-6.0 s: the code 8EA13-A77BB appears with "Enter this code on the dashboard." That code was redeemed once and has expired, so it's safe to show.

## web_dashboard.mp4 (1920x1080, 10.0 s, crf 12)

https://useouranos.vercel.app Mission health page (#/) in the paired browser, crew name "Commander". Captured with a Chrome DevTools screencast (JPEG q95, about 40 frames per second), then retimed to constant 30 fps. No cursor.

- Whole clip: "Watch connected · readings received" and "Source: Watch test feed" at upper right. Heart rate (square wave) and Respiration (bars) charts redraw with a new reading about every 2 s (timestamps 02:34:25, :29, :31, :34, :36 UTC).
- 0.0-6.5 s: normal phase: 74 bpm / 16 /min, blue astronaut, "No readings flagged".
- **6.5 s: flag.** "What needs attention" changes to "Pulse and breathing both flagged", the astronaut's suit details turn gold, the charts jump to 128 bpm / 27 /min, and "Readings that triggered the flag" lists "Watch test feed Heart rate 128 bpm / Respiration 27 /min".
- **Best: 0.0-10.0 s as a whole.** For a short cut, 4.0-9.0 s catches the flag.

Avoid or know: the subtitle under "Mission health" shows a random session UUID. "Source: Watch test feed" appears because the watch was sending its simulated feed. The crew name in the top-right menu is cut to "Command...".

`web_dashboard_long.mp4` (bonus) is the full 16.0 s take that the 10 s clip comes from (clip = long 2.0-12.0 s).

## web_home_watch.mp4 (bonus, 1920x1080, 6.5 s)

Home page (/astronaut/), "What is Ouranos?" section, 3D watch on the left, feature card on the right. The page clock ran at half speed during capture and the footage was retimed, so the motion plays at its normal speed at a smooth 30 fps.

- 0.0-0.75 s: exploded view with part labels (Glove hook, Apple Watch SE 40 mm, Chain band A/B, Printed shroud OURANOS engraved, Filament hinge pins, Slide-in back plate).
- 0.75-2.0 s: parts fly together.
- 2.0-2.75 s: assembled, the screen shows OURANOS, and a sparkle burst plays.
- 2.75-6.5 s: slow turntable rotation of the assembled watch.
- **Best: 0.0-3.0 s** (assembly plus sparkle).

## NASA logo check

No NASA logo or insignia was seen in any file.
- The website footer (web_home_watch.mp4, bottom edge) has a "NASA sources" **text** link only.
- web_dashboard.mp4: the astronaut model's right shoulder (viewer's left, around x 800-840, y 520-560) shows a thin blue sliver with a red edge, seen edge-on. At 1080p you can't tell what it is. docs/CREDITS.md says the NASA insignia patch was removed from this model. The other shoulder carries a US flag, which is not a NASA logo. If you want to be extra safe, keep the astronaut small or cropped in the edit.
