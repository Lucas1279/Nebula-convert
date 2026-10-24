# 🎬 NebulaConvert

**MKV (or any video) → PS5- & Mac-ready MP4, entirely in the browser.**
Sister project of [Nebula ISO2GOD](https://lucas1279.github.io/nebula-iso2god/) — same nebula theme, new mission.

No uploads · no server · no install · nothing ever leaves the visitor’s machine.

**Live:** https://lucas1279.github.io/nebulaconvert/ *(after you publish — see below)*

## Publish to GitHub Pages (2 minutes)

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

The site is live about a minute later at `https://lucas1279.github.io/nebulaconvert/`.

**Without git:** create the empty repo on github.com, then use “uploading an existing files” and drag
`index.html`, `app.js`, the `vendor` folder **and** `.nojekyll` in (dragging the folder keeps its structure).
If your browser hides `.nojekyll`, add it afterwards via “Add file → Create new file” named exactly `.nojekyll`
(it only skips GitHub’s Jekyll step; the site works either way). Then enable Pages as in step 3 above.

## What’s inside

```
index.html            UI + theme (single file, inline CSS, starfield/nebula/planet from Nebula ISO2GOD)
app.js                conversion logic (ES module)
vendor/mediabunny.js  bundled media engine (mediabunny, MPL-2.0), minified ~700 KB
.nojekyll             skips Jekyll processing on Pages
```

Fully static: GitHub Pages serves it over HTTPS, which is exactly what WebCodecs and the
File System Access API need. The page makes **zero network requests** at conversion time.

## What it does

- **🚀 Turbo remux** — repacks MKV→MP4 bit-for-bit (zero quality loss); only incompatible audio
  (DTS/AC-3/TrueHD/FLAC/Opus…) is rebuilt as AAC-LC. Disk-speed only, streams 20 GB+ files with flat RAM.
- **🛡️ PS5-proof** — guarantees Sony’s official USB combo: H.264 High Profile ≤ L5.2 + AAC-LC in MP4.
- **🗜️ Compress** — hardware-accelerated re-encode to a target size (resolution cap, quality, H.264/HEVC, fps cap).
- Built-in PS5 USB guide (exFAT/FAT32, folder at stick root, Media Gallery) and Mac notes.

Media engine: [Mediabunny](https://mediabunny.dev/) (MPL-2.0). Theme & app: lucas1279.
