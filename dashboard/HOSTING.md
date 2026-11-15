# Ouranos deployment

## Crew guide

Supabase project `ohbufsembuzekdnwlpsd` contains the read-only public `gg_crew_guide` catalog. The migration and bundled fallback use the same 175 entries. They cover the 144 entries from NASA-STD-3001 Volume 1 Appendix E Table E.2-2, the 22 risk records linked in NASA's Human Research Roadmap evidence index, five reference collections, and four project-authored workflows. The medical conditions and evidence records link back to their sources. The workflows organize record review, routine monitoring, and private handoff. These public sources are planning and research references. The app does not provide unpublished flight procedures, treatment instructions, or doses.

- [2026 Space Apps challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)
- [NASA-STD-3001 Volume 1 Appendix E](https://www.nasa.gov/reference/appendix-e-health-and-medical-care-technical-requirements/)
- [Human Research Roadmap evidence](https://humanresearchroadmap.nasa.gov/evidence/)
- [NASA media and attribution guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/)
- [2026 Space Apps licensing and attribution rules](https://www.spaceappschallenge.org/legal/)

The project uses [Apache 2.0](../LICENSE) for its original work. Cite every source on the submission form. Keep existing third-party credits and licenses separate. NASA credit does not grant permission for third-party media, NASA branding, or an implication of endorsement.

## Vercel

1. Import the repository and set the **Root Directory** to `dashboard`. The included Vercel configuration builds the Vite frontend and routes API calls to the hosted watch handler.
2. In **Settings → Environment Variables** set `SUPABASE_URL` to the project URL and `SUPABASE_SECRET_KEY` to a Supabase secret key. Keep the latter server-side. The guide alone uses the public read key included in the client.
3. Deploy and open the HTTPS URL in a browser. In the watch, open **Set website address** and enter the deployed website address. Select **Get pairing code**, then enter that code on **Pair watch** on the website. On the watch, select **Watch** mode and enable **Health readings** and **Send to console**. The watch must be able to reach the deployed URL directly. A Vercel deployment protection login page will prevent watch requests from reaching its API.
4. Confirm **Watch connected** and a fresh reading in the dashboard. Open a separate private browser window and verify it cannot see the paired feed.

The Supabase migrations have been applied to the linked project. For a different database, apply both migrations in order and configure its keys. The hosted adapter stores a latest watch frame and watch review events for the lifetime of the pairing. Codes last five minutes, pairings last twelve hours, and expired rows are cleaned up on subsequent pairing requests. Device disconnect deletes the pairing and its hosted events. Hosted mode supports code pairing, watch frames, watch-generated events, event review, and the bundled simulator. Local file imports, adapter telemetry, and local integration self-tests use the local console.


### Default website in the watch app

The watch app defaults to `https://useouranos.vercel.app`. If the watch already has an address saved, open **Set website address** and tap **Use default**. Generate the pairing code on the watch and redeem it on the same website.

### Verify the deployed site

In `dashboard`, run `node scripts/check-hosted-pairing.mjs https://your-project.vercel.app`. It creates a temporary link, verifies that the code can only be redeemed once, uploads a simulated reading, checks that the reading is private to the paired browser, and disconnects the test watch.
