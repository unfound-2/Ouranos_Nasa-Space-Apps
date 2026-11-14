# AI use disclosure (dashboard, API and data contract)

NASA Space Apps asks teams to disclose AI use. This file covers Dhruv's part of GRAVITYGUARD. Mustafa's watch app and Sriyan's hardware are not covered here.

## What was AI-generated

On 14 November 2026, during the event, an AI coding assistant (Claude, by Anthropic, running in Claude Code) wrote the code and documents in:

- `dashboard/` (the mission-computer API, the React dashboard, the simulated demo fixtures, and all unit, API and end-to-end tests)
- `contracts/v1/` (JSON Schemas and examples, generated from `dashboard/src/shared/contract.ts`)
- `docs/WATCH_INTEGRATION.md`, `docs/DEMO_DHRUV.md` and this file

It worked from a written brief by Dhruv and the team's 12-hour PRD. The product idea, the scope, the safety rules (no diagnosis, no clearance, honest LIVE/SAVED/SIMULATED labels) and the visual direction come from those documents. The AI chose the implementation details: the data-contract field names and rules, the event state machine, the record-store design, the layout, and the typefaces (B612, Michroma, JetBrains Mono, all bundled from open-source packages).

## What is not real

- Every record under `dashboard/fixtures/simulated/` and every example in `contracts/v1/examples/` is invented and flagged `isSimulated: true`. None of it was measured on a person.
- The end-to-end tests send synthetic records named `e2e-*` to a throwaway data folder.
- No astronaut, NASA or medical data was used, and no NASA logos or branding appear in the dashboard.

## What a person still has to do

- Check that the data contract matches what the watch app actually produces, and test the live Wi-Fi path on the real watch.
- Review the code and the wording before submission.
- Decide how to describe AI use in the submission, following the official rules.
