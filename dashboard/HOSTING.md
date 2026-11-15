# Ouranos deployment

## Crew guide

The Crew Guide uses practical checklists with direct NASA references. Apply `supabase/migrations/202611150003_refresh_crew_guide.sql` in the Supabase SQL Editor to replace the old public evidence index with the server-read `gg_crew_checklists` table. The prior catalog is kept as a private archive; pairing and crew records are unchanged. Until it is applied the dashboard uses the same checklists bundled with the app. The checklists are review and handoff aids, not flight medical procedures.

- [2026 Space Apps challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)
- [NASA-STD-3001 Volume 1 Appendix E](https://www.nasa.gov/reference/appendix-e-health-and-medical-care-technical-requirements/)
- [Human Research Roadmap evidence](https://humanresearchroadmap.nasa.gov/evidence/)
- [NASA media and attribution guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/)
- [2026 Space Apps licensing and attribution rules](https://www.spaceappschallenge.org/legal/)

The project uses [Apache 2.0](../LICENSE) for its original work. Cite every source on the submission form. Keep existing third-party credits and licenses separate. NASA credit does not grant permission for third-party media, NASA branding, or an implication of endorsement.

## Vercel

1. Import the repository and set the **Root Directory** to `dashboard`. The included Vercel configuration builds the Vite frontend and routes API calls to the hosted watch handler.
2. In **Settings → Environment Variables** set `SUPABASE_URL` to the project URL and `SUPABASE_SECRET_KEY` to a Supabase secret key. Set `GROQ_API_KEY` to enable the optional online assistant. Keep both keys server-side. Without Groq, the charts, checklists and review answers use local data.
3. Deploy and open the HTTPS URL in a browser. In the watch, open **Set website address** and enter the deployed website address. Select **Get pairing code**, then enter that code on **Pair watch** on the website. After pairing, tap **Enable health sync** on the watch and allow Health access. Leave the watch in **Watch** mode. It displays its sync status in Settings. The watch must be able to reach the deployed URL directly. A Vercel deployment protection login page will prevent watch requests from reaching its API.
4. Confirm **Watch connected** and a fresh reading in the dashboard. Open a separate private browser window and verify it cannot see the paired feed.

For a fresh database, apply the migrations in order and configure its keys. The hosted adapter stores a latest watch frame and watch review events for the lifetime of the pairing. Codes last five minutes, pairings last twelve hours, and expired rows are cleaned up on subsequent pairing requests. Device disconnect deletes the pairing and its hosted events. Hosted mode supports code pairing, watch frames, watch-generated events, event review, and the bundled simulator. Local file imports, adapter telemetry, and local integration self-tests use the local console.


### Default website in the watch app

The watch app defaults to `https://useouranos.vercel.app`. If the watch already has an address saved, open **Set website address** and tap **Use default**. Generate the pairing code on the watch and redeem it on the same website.

### Verify the deployed site

In `dashboard`, run `node scripts/check-hosted-pairing.mjs https://your-project.vercel.app`. It creates a temporary link, verifies that the code can only be redeemed once, uploads a simulated reading, checks that the reading is private to the paired browser, and disconnects the test watch.
