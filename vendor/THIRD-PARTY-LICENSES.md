# Third-party components

`mediabunny.js` bundles the following pinned components. Their notices/licenses are supplied in this directory.

- Mediabunny 1.62.1 — MPL-2.0 (`LICENSE-mediabunny-MPL-2.0.txt`)
- `@mediabunny/ac3` 1.62.1 — local AC-3/E-AC-3 decoder — MPL-2.0 (`LICENSE-mediabunny-ac3-MPL-2.0.txt`)
- `@mediabunny/aac-encoder` 1.62.1 — local AAC-LC encoder fallback — MPL-2.0 (`LICENSE-mediabunny-aac-encoder-MPL-2.0.txt`)
- `opus-decoder` 0.7.12 and `@wasm-audio-decoders/common` 9.0.7 — MIT (`LICENSE-opus-decoder-MIT.txt`)
- Bundled libopus reference implementation — BSD-3-Clause (`LICENSE-libopus-BSD-3-Clause.txt`)
- `@eshaz/web-worker` 1.2.2 — Apache-2.0 (`LICENSE-web-worker-Apache-2.0.txt`)
- `simple-yenc` 1.0.4 — MIT (`LICENSE-simple-yenc-MIT.txt`)

Audio decoding and encoding run locally in the browser. Opus packets are decoded to planar PCM, then unsupported audio is encoded as AAC-LC for MP4 output.
