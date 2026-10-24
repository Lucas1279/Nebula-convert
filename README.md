# 🎬 NebulaConvert

**MKV and other common media containers → MP4 for PS5 and Mac, entirely in the browser.** Codec compatibility depends on the chosen mode and browser support.
Sister project of [Nebula ISO2GOD](https://lucas1279.github.io/nebula-iso2god/) — same nebula theme, new mission.

No uploads · no server · no install · nothing ever leaves the visitor’s machine.

**Live URL:** use the address shown in Settings → Pages for your repository (for your `Nebula-convert` repo, it should be `https://lucas1279.github.io/Nebula-convert/`).

## Update your existing GitHub Pages site

For the repository you already created (`Lucas1279/Nebula-convert`): open it on GitHub → **Code** → **Add file → Upload files**. Upload the extracted package contents (not the ZIP) and keep the `vendor` folder intact. Commit the changes to `main`; Pages will redeploy automatically. If GitHub’s web uploader will not take the folder, use GitHub Desktop to copy the package contents into the cloned repository and push the commit.

## Publish to GitHub Pages (for a new repository)

**With git (recommended):**

```bash
# 1. On github.com: New repository → name it `nebulaconvert` → Public → no README → Create.
# 2. Then, in this folder:
git init -b main
git add -A
git commit -m "NebulaConvert: browser MKV→MP4 for PS5 & Mac"
git remote add origin https://github.com/lucas1279/nebulaconvert.git
git push -u origin main
# 3. Repo → Settings → Pages → “Deploy from a branch” → branch `main`, folder `/ (root)` → Save.
```

Use the live URL shown in Settings → Pages for your repository.

**Without git:** create the empty repo on github.com, then use “uploading an existing files” and drag
`index.html`, `app.js`, the `vendor` folder **and** `.nojekyll` in (dragging the folder keeps its structure).
If your browser hides `.nojekyll`, add it afterwards via “Add file → Create new file” named exactly `.nojekyll`
(it only skips GitHub’s Jekyll step; the site works either way). Then enable Pages as in step 3 above.

## What’s inside

```
index.html            UI + theme (single file, inline CSS, starfield/nebula/planet from Nebula ISO2GOD)
app.js                conversion logic (ES module)
vendor/mediabunny.js  bundled engine + local WASM AC-3/E-AC-3/Opus decoders and AAC-LC encoder fallback (~2.9 MB)
vendor/THIRD-PARTY-LICENSES.md  license notes for bundled codec extensions
.nojekyll             skips Jekyll processing on Pages
```

Fully static: GitHub Pages serves it over HTTPS, which is exactly what WebCodecs and the
File System Access API need. The page makes **zero network requests** at conversion time.

## What it does

- **🚀 Turbo remux** — repacks supported sources into MP4 without re-encoding video; incompatible audio (AC-3/E-AC-3/DTS/TrueHD/FLAC/Opus…) is rebuilt as AAC-LC with local WASM fallbacks. Video-only remuxes are storage-limited; a full audio transcode adds time.
- **🛡️ PS5-proof** — targets Sony’s listed USB combo: H.264 High Profile ≤ L5.2 + AAC-LC in MP4. Non-compliant video requires a full decode/re-encode and depends on browser codec support.
- **🗜️ Compress** — re-encodes to a target size (resolution cap, quality, H.264/HEVC, fps cap); speed and hardware acceleration depend on the browser/device.
- Built-in PS5 USB guide (exFAT/FAT32, folder at stick root, Media Gallery) and Mac notes.
- HEVC Main/Main10 at or below Level 5.2 can be kept in Turbo remux as MP4 video (community-reported PS5 playback, not Sony’s listed USB profile). PS5-proof H.264 requires a full frame-by-frame transcode and can take much longer than a remux.
- AV1 + standard Opus 5.1 MKVs can be remuxed into MP4 with Opus decoded to AAC-LC (5.1 channel mapping is tested). The AV1 video remains AV1 in Turbo, so it is not PS5-safe and Mac playback depends on AV1 support. PS5-proof requires a browser AV1 decoder and full H.264 re-encode; a 2-hour 4K AV1 source has not been converted end-to-end here. Other multichannel Opus mappings are not covered by the local fallback.
- Safari downloads stream through origin-private site storage (OPFS) when available, then use Safari’s normal Downloads flow. Safari does not support the page-level picker for an arbitrary chosen output path; quota and disk space apply, and Safari Private Browsing may not provide OPFS. The OPFS writer paths have been exercised in Chromium with the save picker disabled, but the deployed site should still be verified in actual Safari before relying on multi-GB conversions.

Media engine: [Mediabunny](https://mediabunny.dev/) (MPL-2.0), with local AC-3/E-AC-3, Opus, and AAC-LC fallbacks; see `vendor/THIRD-PARTY-LICENSES.md`. Theme & app: lucas1279.

### Update an existing Pages site

Replace the repository files with this folder’s contents (not the ZIP itself), keeping `vendor/mediabunny.js` in `vendor/`, then commit to `main`. GitHub Pages deploys the update automatically. AC-3/E-AC-3/Opus decoders and the AAC fallback run locally; Safari streams outputs through its origin-private storage when available, then starts a normal download. No media is uploaded.
