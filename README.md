# 3D Molecule Studio

A static, GitHub Pages–friendly web app for loading a compound by **PubChem CID**, reading its live PubChem record, viewing the published **3D conformer**, and exporting the data and model.

No build step. No backend. No API key.

![Static site](https://img.shields.io/badge/deploy-GitHub%20Pages-2dd4bf)

## What it does

- **Live import by CID** — accepts `2244`, `CID 2244`, `#cid=2244`, or a PubChem compound URL.
- **Verbatim properties** — formula, molecular weight, exact mass, IUPAC name, XLogP, TPSA, H-bond counts, stereo counts, 3D descriptors and more. Values come straight from the PubChem PUG REST property table and are never rounded or recalculated.
- **3D viewing** - renders PubChem's published 3D conformer (`record_type=3d`) with [3Dmol.js](https://3dmol.org/): ball-and-stick, sticks, spheres or lines, hide hydrogens, spin, fullscreen and a locally generated van der Waals surface. An XYZ orientation gizmo appears in the viewport corner while the editor is open; drag it to orbit, or click an axis ball to snap the view.
- **Every published conformer** — all conformer IDs are imported for a CID. A selector in the toolbar steps through them (prev/next or dropdown), and the viewer, properties, hashes and exports always follow the selected conformer. CIDs with a single conformer hide the selector.
- **Exports**:
  - `SDF` — the exact selected-conformer record body returned by PubChem
  - `SDF (all conformers)` — every conformer as one multi-record SDF, with its own SHA-256
  - `MOL` — single MOL block (through `M  END`)
  - `XYZ` — coordinates for external tools
  - `GLB` — a binary glTF mesh of the edited scene (or the active compound), with Draft/Standard/High/Ultra quality and Match viewer/Ball & stick/Sticks/Spheres/Lines style
  - `JSON` — property table, synonyms, parsed coordinates, request URLs and integrity metadata
  - `PNG` — a supersampled high-resolution snapshot (typically ~3600 px on the long edge)
- **Provenance panel** — request URLs, response sizes, retrieval time, SDF SHA-256, raw JSON download and a ready-to-copy citation.
- **Full-screen workspace** — the canvas fills the window, with a top toolbar, a docked/expandable properties inspector and a bottom export drawer. Light and dark themes are both supported.
- **Editor mode** — the **Editor** button in the top bar turns the workspace into an editor. The toolbar becomes the editor’s item strip; the first item is the **3D viewport**, with the model-style and view controls acting as its options.
- **Multi-compound scenes** — while the editor is open, the top search becomes **Add**, so you can import several CIDs into one scene. Compounds are listed in the **Layers** panel, which opens from the top bar like Properties; select one to inspect/export, duplicate it, or remove it. Arrange the whole scene in a **row**, **grid** or **circle**, or use **Fit** and **Reset** to frame or clear every transform. The same CID can be added more than once, which is useful for comparing different conformers side by side. The scene is kept when you leave the editor; only the active compound is shown in normal viewer mode.
- **Studio mode** — a separate animation workspace alongside Editor. Use the **Studio** button in the top bar for simple, simultaneous motions. **Compounds** offers Still, Spin and Rock with an X/Y/Z axis, speed, phase offset and ping-pong. **Camera** offers a true orbit (with X/Y/Z or a custom axis vector), Rock, and Zoom, plus an adjustable orbit **angle**; drag the view to a starting orientation, optionally press **Use view** to turn the dragged result into the orbit angle, then Play or Record. Spin turns compounds in place so multi-compound scenes keep their spacing; camera orbit rotates the whole view around the scene centre. Use **Fit**, **Reset**, **Row**, **Grid** and **Circle** for layout, and **Front**, **Side**, **Top** or **Isometric** to frame the camera. Set the length, loop it and adjust the background colour. Output controls choose 24/30/60 fps and 720p/1080p/1440p at 16:9, square or portrait; the **Border** toggle shows the exact crop frame in the viewport so nothing important falls outside the video (the frame is not recorded). Press **Play**, **Record** for WebM, or **GIF** for a compact shareable clip. The user's current zoom level is preserved when entering Studio and when starting playback or recording; editor selection highlights are cleared on entry because they are not relevant to animation. Leaving Studio restores the pre-animation scene pose and camera.
- **Compound connections** — the editor’s **Connect** tool links an atom in one compound to an atom in another. Choose a single, double or triple bond and a solid, dashed or arrow style before or between picks; arrows point from the first picked atom to the second. **Snap** moves and turns the second compound so the selected atoms sit at a sensible bond length and the molecular bodies extend away from each other; the connection then follows both models through Move/Rotate and the scene gizmo. Added links appear in an **Added bonds** group in Layers, where each row can be selected to edit visibility, colour, thickness, opacity, order and style, or removed. The group has its own Clear action. They are display overlays and are recorded in the JSON export; a scene GLB includes them too, while the underlying SDF/MOL/XYZ records remain untouched.
- **Undo / redo** — <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> undoes the last editor change (adding/removing an added bond, switching bond style/order, colour, thickness, opacity, material/gloss, layer visibility, per-model Move/Rotate, scene arrangement and reset). <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Y</kbd> redoes it. Text fields keep their native undo behaviour.
- **Hierarchical layers** — each compound is a group in Layers. Expand it to toggle its **Atoms** and **Bonds**, expand **Atoms** for per-element layers (C, H, O, …), and expand an element for individual atoms or a compound’s **Bonds** for individual bonds. Eye buttons hide the whole compound, a primitive group, an element, or a single item; the state is visual only and does not change the exported coordinates.
- **Layered editing** — select a compound, the **Atoms** or **Bonds** group, an element, an individual atom/bond, or several atoms/bonds at once. Click an atom or bond in the viewport to select it, or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>-click (also <kbd>Shift</kbd>-click) to add or remove items; <kbd>Alt</kbd>-click remains available for precise picking. The selected item’s **Selection** editor now lives at the top of the **Customize** panel: visibility, colour, size, opacity, bond order, plus a per-selection **Material** and **Gloss** override. Multi-selection edits every chosen item together. Edits are display-only, included in the JSON export, and never rewrite the original PubChem record. Hiding an atom or element hides its sphere marker only — connected bonds stay visible.
- **Customize panel** — a left-side editor panel (opened from the top bar like Layers) for the selection editor plus atom size, bond thickness, opacity, **Line width** (used by the **Lines** style), a **Material** finish (Standard, Outline, Metal, Chrome, Gold, Glass, Plastic, Ceramic, Matte, Neon, Clay), a **Lighting** preset (Studio, Soft, Bright, Dramatic, Rim light), a global **Gloss** amount, Jmol/single-colour scheme, surface colour/opacity, and a viewport background (custom colour, theme, or **transparent**). **Scene guides** add optional XYZ axes, a Blender-style major/minor grid with coloured X/Y/Z centre lines on one selected plane or all three planes at once, a scale bar and Å axis labels. The grid and axes extend well beyond the molecules and stay anchored in the scene while compounds move or rotate; the grid is drawn as thin visible rods rather than invisible 1-pixel lines. Per-item overrides from Layers stack on top of these global values. Settings persist locally and are display-only.
- **Material finishes** — finishes are built from element palettes, thin outlines and opacity (3Dmol’s model shader is diffuse-only, so this is a display approximation). Gloss lightens or darkens the palette; glass also adjusts transparency. Choosing a finish while **Single colour** is active switches back to element colours so the palette is visible.
- **Per-bond appearance** — bonds with a custom colour, thickness, opacity or order are drawn as two-tone cylinder overlays, with parallel offsets for double and triple bonds. The original bond is removed from the rendered bond list so the override is unambiguous; geometry exports still use the PubChem coordinates.
- **Transparent PNGs** — choosing **Transparent** clears the WebGL canvas to alpha 0 (the viewport shows a checkerboard) and PNG exports keep that alpha channel for compositing in other tools.
- **Per-model transforms** — click a model in the editor to select it, choose **Rotate** or **Move** in the object bar, then drag that model. Each compound keeps its own rotation and position. The viewport’s XYZ gizmo still transforms the whole scene at once.
- **Deep links** — `?cid=2244` can be shared; recent CIDs are remembered locally.
- **Quick tour** — a five-step first-run walkthrough covers Editor → Add → Layers → Connect → Studio. It appears once and can be reopened from the info button in the top bar.
- **Welcome note** — a short thank-you and work-in-progress notice appears when the app opens, with a prompt to report bugs or request features. Dismissing it continues to the quick tour on a first visit.
- **Light/dark themes**, keyboard-accessible tabs, responsive layout, reduced-motion support.

## Accuracy model

"Accurate" here means **faithful to the PubChem record**, not independently re-derived chemistry:

1. Properties are rendered as returned by PubChem's property table. No rounding, no local descriptor calculation.
2. 3D coordinates are downloaded from PubChem's published conformers. The app does not generate or optimise conformers.
3. The SDF download is the raw response body for the selected conformer. Its SHA-256 is computed in the browser and shown in the Source tab. The all-conformer download is the exact concatenated PubChem response and has a separate SHA-256.
   Note that PubChem regenerates the SDF header timestamp on each request, so refetching can produce a different hash even when the coordinates are unchanged.
4. The JSON export includes the raw responses, every conformer ID, the selected conformer, source URLs, retrieval timestamp and both hashes.
5. The GLB mesh is built locally from the same coordinates and introduces no new chemistry.

Accuracy is bounded by PubChem itself. The app displays a clear message when PubChem has no 3D conformer for a CID.

## Local development

Any static file server works. ES modules and `fetch` require `http://` or `https://` (not `file://`).

```bash
cd pubchem-3d-studio
python -m http.server 8000
```

Then open <http://localhost:8000>.

You can also use `npx serve .` or VS Code Live Server.

## Deploy to GitHub Pages

### Option A — GitHub Actions (recommended)

1. Create a repository and put the **contents of this folder at the repository root** (so `index.html` is at the root).
2. Push to the `main` branch.
3. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
4. The included workflow (`.github/workflows/deploy.yml`) deploys on every push to `main`.

Your site will be at `https://<username>.github.io/<repository>/`.

### Option B — Deploy from a branch

1. Push these files to `main`.
2. Go to **Settings → Pages**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`, then save.

All asset paths are relative, so the app works at a project subpath as well as at a user site root. The `.nojekyll` file prevents Jekyll processing.

## Project structure

```
.
├── index.html                  # Markup, inline SVG icon sprite
├── css/
│   └── style.css               # Themes, layout, components
├── js/
│   ├── app.js                  # Orchestration, state, UI wiring
│   ├── pubchem.js              # PUG REST client, CID parsing, SHA-256
│   ├── sdf.js                  # V2000/V3000 SDF parser + MOL/XYZ exporters
│   ├── glb.js                  # glTF 2.0 / GLB mesh builder
│   ├── viewer.js               # 3Dmol.js wrapper
│   └── ui.js                   # DOM rendering helpers
├── vendor/
│   ├── 3dmol/                  # Vendored 3Dmol.js 2.5.5 + BSD-3-Clause license
│   └── gif/                    # Vendored gif.js 0.2.0 + worker (MIT)
├── assets/
│   └── favicon.svg
├── .github/workflows/deploy.yml
├── .nojekyll
└── README.md
```

No npm install, bundler, or server-side code is required.

## Data sources

| Purpose | Endpoint |
| --- | --- |
| Properties | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/.../JSON` |
| Conformer list | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/conformers/JSON` |
| 3D conformers | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/conformers/{conformerIDs}/SDF` |
| Synonyms | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/synonyms/JSON` |
| 2D depiction | `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/PNG?record_type=2d&image_size=600x600` |
| Record page | `https://pubchem.ncbi.nlm.nih.gov/compound/{cid}` |

PubChem's PUG REST service sends `Access-Control-Allow-Origin: *`, which is what makes a backend-free browser app possible.

Requests are throttled to roughly four per second to stay within [PubChem's usage guidance](https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access). A load makes three requests for a CID with one conformer, plus one batched SDF request per 40 conformer IDs.

## Export notes

- **SDF / MOL** preserve the PubChem record and are the best choice when you need the authoritative chemistry file. SDF exports the selected conformer; “Download all conformers” writes one multi-record SDF with `$$$$` separators.
- **XYZ** uses the four-decimal coordinates from the SDF and includes a PubChem/CID comment line.
- **GLB** is a display mesh, not a quantum-mechanical surface, and should not be used for measurement. **Edited scene** is the default and bakes every visible compound's current transform, colour, atom/bond size, opacity, hidden-layer state and added cross-compound bond into one scene-space mesh. **Active compound** exports only the current compound with its editor transform. **Mesh quality** controls sphere/cylinder subdivisions: Draft, Standard, High (default) and Ultra; Ultra can produce very large files. **Style** follows the viewport by default; Ball & stick exports spheres plus sticks, Sticks exports a uniform bond skeleton, Spheres exports only spheres (larger radii), and Lines exports thin cylinders. Bond radii and multi-bond spacing follow the viewport, with thinner parallel rods for double and triple bonds. Hidden hydrogens follow the H toggle. Coordinates are centred and rotated into glTF's Y-up frame; `asset.extras` and `extras.compounds` record the CID, retrieval time, SDF SHA-256, per-compound atom/bond counts, transforms, style and quality.
- **JSON** is the audit artifact: raw property and synonym responses, the SDF text for the selected conformer, every conformer ID, parsed coordinates, source URLs and both hashes. The `scene` array also records display-only editor state - per-compound transforms, layer visibility, hidden atoms/bonds, colours, scales, opacities, bond orders, materials and gloss overrides - without altering the PubChem data. A top-level `connections` array records any cross-compound bonds added with the Connect tool; `appearance`, `layoutMode` and `studio` record global display, arrangement and animation settings.
- **PNG** temporarily renders the current camera view at twice the target resolution (up to a safe GPU pixel budget), downsamples it with a high-quality filter, then restores the on-screen canvas. The result is a smooth, high-resolution image (typically 3600 px on the long edge) with clean sphere and bond edges. When the background is set to **Transparent**, the PNG keeps an alpha channel.
- **WebM** recordings use the selected 24/30/60 fps and 720p/1080p/1440p output with a 16:9, square or portrait frame. The view is centre-cropped to fill the chosen aspect, so use the Studio **Border** frame to compose; the guide is an overlay and is never recorded.
- **GIF** is a deterministic offline export (not a screen capture): frames are stepped through the Studio timeline at up to 24 fps and encoded in a worker. The long edge is capped at 720 px for quick sharing. GIF has no alpha, so a transparent background is filled with the theme colour.
- **Scene guides** (axes, grid, scale bar, unit labels) are display-only; they appear in PNG, WebM and GIF but never in SDF, MOL, XYZ, GLB or JSON geometry.

## Viewing notes

- **Ball & stick** draws every atom as a sphere and every bond as a stick. A red sphere at the end of a double bond is the oxygen atom; the two parallel sticks are the double bond.
- In crowded groups such as esters, two oxygen atoms can overlap visually. Drag to rotate, or use **Reset view**, which returns to a tilted starting angle chosen to reduce that overlap.
- **Sticks** removes the atom spheres and draws a uniform single-bond skeleton, matching PubChem's stick view: double and triple bonds are not drawn as parallel sticks. Terminal ends are the normal small rounded stick caps, not atom spheres.
- **PNG** exports are rendered at twice the final resolution and downsampled, so edges stay smooth at 100% zoom.

## Limitations

- Requires an internet connection; data is never bundled.
- A CID may exist without a published 3D conformer. In that case properties and the 2D depiction are shown, while geometry exports are disabled.
- Very large records can be returned as V3000 SDF. Most are supported; if the atom block cannot be parsed, the exact SDF is still downloadable.
- WebGL is required for the interactive viewer. Data and exports still work without it.
- Lighting presets adjust 3Dmol's directional lights; they are a display approximation, not physically based rendering.
- GIF exports are intentionally capped at 720 px on the long edge and 24 fps to keep files small; use WebM for full-resolution output.
- The app is read-only. It does not submit structures or write to PubChem.

## Attribution and license

- Compound data and depictions: [NCBI PubChem](https://pubchem.ncbi.nlm.nih.gov/). PubChem is not affiliated with this project; follow NCBI/PubChem usage policies.
- 3D rendering: [3Dmol.js](https://3dmol.org/), BSD-3-Clause. The vendored build and license are in `vendor/3dmol/`.
- GIF encoding: [gif.js](https://github.com/jnordberg/gif.js), MIT. The vendored build and worker are in `vendor/gif/`.
- Application code: MIT License, see [`LICENSE`](LICENSE).

---

Built for static hosting: every calculation happens in the browser, and every data point keeps a link back to its PubChem source.
