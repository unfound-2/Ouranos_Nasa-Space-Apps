# AI use disclosure (dashboard, API and data contract)

NASA Space Apps asks teams to disclose AI use. This file covers Dhruv's part of OURANOS. Mustafa's watch app and Sriyan's hardware are not covered here.

## What was AI-generated

On 14 and 15 November 2026, during the event, an AI coding assistant (Claude, by Anthropic, running in Claude Code) wrote the code and documents in:

- `dashboard/` (the mission-computer API, the React dashboard, the simulated demo fixtures, the model-cleaning script `dashboard/scripts/clean-z2-suit.py`, and all unit, API and end-to-end tests)
- `contracts/v1/` (JSON Schemas and examples, generated from `dashboard/src/shared/contract.ts`)
- every file in `docs/`, and Dhruv's edits to `README.md`

The watch-pairing code merged from the teammate branch `codex/watch-dashboard-integration` (commits 8b712c6 and 8e7acd3, for example `dashboard/adapter.mjs` and `dashboard/src/server/watch-link.ts`) is not covered here, although later commits on this branch changed some of those files.

It worked from a written brief by Dhruv and the team's 12-hour PRD. The product idea, the scope and the safety rules (no diagnosis, no clearance, honest LIVE/SAVED/SIMULATED labels) come from those documents. Dhruv set the visual direction with reference images and rounds of feedback, and asked that the interface follow published design systems; it uses Vercel Geist, Radix Colors and Tremor, listed in `docs/CREDITS.md`. The AI chose the implementation details: the data-contract field names and rules, the event state machine, the record-store design, the layout, and the typefaces (Geist Sans and Geist Mono, bundled from open-source packages).

The subsequent dashboard redesign and watch charts, warning inbox and crew guide were implemented with OpenAI Codex under Mustafa’s direction.

## Images and 3D models

No photo, video, audio or 3D model in the dashboard was made by AI.

- The original dashboard spacesuit is NASA's Z2 model from NASA 3D Resources. The AI-written script `dashboard/scripts/clean-z2-suit.py` edited its texture: it lifted the grime, removed the NASA insignia patch and shrank the file.
- The displayed astronaut is Jungle Jim’s model with edited suit accents and a NASA shoulder patch. The pairing card uses NASA photograph iss072e340644, cropped and compressed.
- The AI drew three small graphics as SVG code: the logo mark, the browser-tab icon (`dashboard/public/favicon.svg`) and the 2D crew figure shown when the browser cannot run WebGL.
- Icons come from Lucide (ISC licence).

Sources and licences for all of these are in `docs/CREDITS.md`.

## What is not real

- Every record under `dashboard/fixtures/simulated/` and every example in `contracts/v1/examples/` is invented and flagged `isSimulated: true`. None of it was measured on a person.
- The end-to-end tests send synthetic records named `e2e-*` to a throwaway data folder.
- No astronaut or medical data was used.

## What a person still has to do

- Check that the data contract matches what the watch app actually produces, and test the live Wi-Fi path on the real watch.
- Review the code and the wording before submission.
- Decide how to describe AI use in the submission, following the official rules.
- Decide whether the three code-drawn graphics (logo mark, tab icon, 2D crew figure) count as AI images that need a visible watermark under the Space Apps rules.
