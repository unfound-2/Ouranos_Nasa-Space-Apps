# Credits and asset provenance

Everything below ships inside the dashboard and loads from this computer. Nothing is fetched at run time.

## 3D spacesuit model: `dashboard/public/models/z2-suit.glb`
- **Source:** NASA 3D Resources, "Z2 Spacesuit": https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Z2%20Spacesuit.
  - The repository states: "These assets are free and without copyright."
  - Usage guidelines: https://www.nasa.gov/nasa-brand-center/images-and-media.
- **Processing:** done by `dashboard/scripts/clean-z2-suit.py` (Python, Pillow and numpy; run with `python3 clean-z2-suit.py <Z2 Spacesuit.glb> <out.glb> <preview.png>`):
  - lifted the grime on the fabric;
  - removed the NASA insignia patch and its gloss outline (NASA does not endorse this project, and Space Apps projects must not carry the insignia);
  - added a roughness map so the visor is glossy;
  - dropped the specular layer and the JPEG fallbacks;
  - downsized the texture to 2048 px.

  The Draco geometry is unchanged. The result is 0.56 MB, down from 16.9 MB.
- **Draco decoder:** `dashboard/public/draco/` is copied unchanged from three.js 0.181 (`examples/jsm/libs/draco`, Apache-2.0).

## Earth photograph: `dashboard/src/client/assets/earth-horizon.webp`
- **Source:** NASA image iss072e340644, "An orbital sunrise crowns Earth's horizon", taken from the International Space Station on 18 November 2024 (NASA Image and Video Library).
- **Rights:** NASA imagery is generally not subject to copyright in the United States.
- **Processing:** cropped to 1920 × 1080, brightness 0.92, saved as WebP (49 KB).

## Design references
The interface follows published systems; it was not invented for this project:
- **Vercel Geist** (https://vercel.com/geist): layout, buttons, inputs, tabs, tables, and the grey roles (background, border, secondary and primary text).
- **Geist Sans and Geist Mono** fonts (SIL Open Font License 1.1), via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`.
- **Radix Colors** dark scales (https://www.radix-ui.com/colors, MIT): grey steps 1–12 for surfaces and text, and step 9 of red, amber, green, blue and violet for status marks.
- **Tremor** (https://tremor.so, Apache-2.0): the KPI card, spark area chart, bar chart and progress bar, drawn with Recharts.
