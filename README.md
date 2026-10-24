# 🎬 NebulaConvert

**MKV (and other common media containers) → MP4 for PS5 and Mac, entirely in your browser.** Codec compatibility depends on the selected mode and the browser’s hardware support.
Sister project of [Nebula ISO2GOD](https://lucas1279.github.io/nebula-iso2god/) — same nebula theme, new mission:
drop in a movie, get a clean MP4 you can put on a USB stick and play on a PS5 (and double-click on a Mac).

No uploads. No server. No install. Nothing ever leaves your machine.

## Try it now (this sandbox)

The site is live on the preview port (see the live preview panel), or run:

```bash
cd /home/user/nebulaconvert
python3 server.py          # serves site/ on 0.0.0.0:8000
```

Then open `http://localhost:8000` (Chrome/Edge can save to a chosen path; Safari uses an OPFS-staged browser download when available).

## Deploy it (it’s fully static)

`ghpages/` is the publish-ready package (Opus timestamp-trace diagnostic: `NebulaConvert-Opus-Timestamp-Trace.zip`): upload its contents to GitHub Pages,
Netlify, any web host. It includes `.nojekyll` and a README with step-by-step publish instructions.
GitHub Pages serves it over **HTTPS**, which is exactly what WebCodecs + File System Access need.

```
ghpages/
├── index.html          # theme + UI (single file, inline CSS)
├── app.js              # conversion logic (ES module)
├── vendor/mediabunny.js  # Mediabunny + AC-3/E-AC-3/Opus decoders and AAC-LC WASM fallback (~2.9 MB)
├── .nojekyll
└── README.md           # publish instructions
```

Works from any base path (all URLs are relative) — verified from a `/nebulaconvert/` subpath.
The dev copy lives in `site/` (served by `server.py`); keep both in sync if you edit.

## How the requirements are met

| Requirement | How |
|---|---|
| MKV / any video in, MP4 out | Reads MKV, WebM, MP4, MOV/M4V, M2TS/TS (AVCHD), OGG, MP3/FLAC/WAV via the `mediabunny` engine; writes a plain MP4. |
| Plays on PS5 from USB | Official-safe output = **H.264 High Profile ≤ L5.2 + AAC-LC in MP4**. Turbo can remux HEVC or AV1 into MP4 without re-encoding video, but Sony does not list these codecs as the official USB profile; HEVC has community-reported PS5 playback, AV1 is not PS5-safe. PS5-proof must decode and re-encode non-H.264 video to H.264. |
| Plays on Mac | H.264/AAC MP4 is the safest target; HEVC is also supported by modern QuickTime. AV1-in-MP4 playback depends on the Mac model/OS, so Turbo AV1 is not a universal Mac-playable file. `moov` is at the file start. |
| 20 GB files | Input is read in chunks; output is streamed through `StreamTarget` to a chosen file in Chrome/Edge or to OPFS staging in Safari when supported. Large Safari outputs need enough origin-storage quota and free disk space. A 20 GB end-to-end browser conversion has not yet been run. |
| Under 1 minute | Near a minute is possible only for a remux with little/no media transcoding. A synthetic 2-minute 5.1 Opus-silence → AAC test took 6.7 seconds in headless Chromium with the bundled WASM decoder/encoder; a 2-hour audio transcode could take several minutes (not tested on the Mac). A full AV1/HEVC-to-H.264 movie transcode is much longer than a remux. |
| Works on Mac | Chrome/Edge can save directly to a chosen path. Safari uses OPFS as disk-backed temporary storage when available, then hands a File to the normal Downloads flow; the user cannot choose an arbitrary save path in Safari. Safari Private Browsing may not provide OPFS. |
| Theme | Copied from your nebula-iso2god site: starfield canvas, drifting nebulas, planet SVG, gradient headline, glass panels, badges, progress & log styling. |

## Conversion modes

1. **🚀 Turbo remux (default)** — repack with zero quality loss; only incompatible audio is re-encoded. Fastest by far.
2. **🛡️ PS5-proof** — targets H.264 High + AAC-LC (video is copied when already compliant; other video needs browser decode + encode support and a full transcode).
3. **🗜️ Compress smaller** — re-encode to a target size: resolution cap, quality preset, H.264/HEVC, fps cap, live size estimate.

## QA performed (headless Chromium E2E in this workspace)

- `test-e2e.mjs` — upload → analysis → PS5 verdict → convert → download; ffprobe-verified H.264/AAC output.
- `test-eac3-fallback.mjs` — E-AC-3 5.1 input converted to AAC-LC 5.1 in PS5-proof mode using local WASM decoder/encoder; full decode verified.
- `test-opus-fallback.mjs` — synthetic AV1 + Opus 5.1 MKV remuxed to MP4 with AAC-LC 5.1; ffprobe, full decode, and 5.1 channel-tone mapping verified.
- Timestamp diagnosis — the original full movie fails on output track 2 (AAC audio): packet PTS 9.960s follows 9.9735s. The 20-second LosslessCut excerpt passes, so it is not a reproduction. The latest diagnostic preserves the current audio behavior and can show recent bundled Opus packet timestamps and any backward source PTS; no media leaves the browser.
- `test-safari-opfs.mjs` — browser-download path streamed through OPFS and downloaded; also tested the dedicated-worker synchronous OPFS fallback; both outputs full-decode verified.
- `test-hevc-level.mjs` — verifies HEVC `L120` is parsed as decimal level_idc 120 (Level 4.0), not hexadecimal.
- `test-e2e3.mjs` — the streaming save-to-disk path with a mocked File System Access API: byte-exact output
  for a 15.7 MB file. The optional 1 GB browser test was skipped because its fixture is not present.
- Node-level checks (`test-remux.cjs`, `test-stream.cjs`, `test-audio-opts.cjs`, `test-opts.cjs`) validated the
  copy-vs-transcode policy, MP4 box layout, and option shapes. (Re-running them requires re-downloading a
  static ffmpeg build for ffprobe; the E2E scripts only need `playwright-core` + the headless shell.)

## Notes / honest limits

- Local WASM fallbacks decode AC-3/E-AC-3 and Opus (mono/stereo plus standard Matroska 5.1 channel mapping), and encode AAC-LC when WebCodecs lacks support. AV1 can be remuxed into MP4 unchanged; converting it to H.264 for PS5 needs a working browser AV1 decoder and H.264 encoder, and a feature-length 4K transcode will take far longer than a remux. Other multichannel Opus mapping layouts have not been implemented/tested.
- Safari does not expose a save-location picker. For large downloads, the app streams to OPFS (origin-private site storage) when available and then triggers a standard download; quota/free disk space still apply, and Safari Private Browsing may not provide OPFS. Both OPFS writer paths were exercised in Chromium with the picker disabled; actual Safari and a multi-GB Safari conversion still need verification.
- Browsers cannot decode MPEG-2, VC-1 or MPEG-4 ASP (Xvid/DivX), so old AVI/VOB-era content can’t be converted
  in-browser — the UI detects and explains that immediately.
- PS5’s Media Gallery ignores embedded subtitles; subtitle tracks are dropped and reported in the log.
- HDR (HEVC Main10) survives Turbo remux perfectly; forcing H.264 converts it to SDR (the UI warns).

Media engine: [Mediabunny](https://mediabunny.dev/) (MPL-2.0). Theme: Nebula ISO2GOD.
