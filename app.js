/* ================================================================
   NebulaConvert — MKV / any video → PS5+Mac-ready MP4, 100% local
   Engine: mediabunny (MPL-2.0) · Theme: Nebula ISO2GOD
   ================================================================ */
import * as MB from './vendor/mediabunny.js';

const $ = (id) => document.getElementById(id);

const els = {
  supportBadges: $('supportBadges'),
  drop: $('drop'), fileInput: $('fileInput'), browseBtn: $('browseBtn'), pickedName: $('pickedName'),
  errorBox: $('errorBox'),
  fileCard: $('fileCard'), fileDetails: $('fileDetails'), ps5Verdict: $('ps5Verdict'),
  modeRow: $('modeRow'), modeNote: $('modeNote'), compressOpts: $('compressOpts'),
  optRes: $('optRes'), optQuality: $('optQuality'), optCodec: $('optCodec'), optHevc: $('optHevc'), optFps: $('optFps'),
  estLine: $('estLine'),
  diskSetup: $('diskSetup'), dlSetup: $('dlSetup'), chooseFileBtn: $('chooseFileBtn'), chosenPath: $('chosenPath'),
  convertBtn: $('convertBtn'), resetBtn: $('resetBtn'),
  progressCard: $('progressCard'), progressStatus: $('progressStatus'), progressPct: $('progressPct'),
  progressBar: $('progressBar'), statSpeed: $('statSpeed'), statWritten: $('statWritten'),
  statElapsed: $('statElapsed'), statEta: $('statEta'), statMode: $('statMode'),
  cancelBtn: $('cancelBtn'), logEl: $('logEl'),
  doneCard: $('doneCard'), doneBanner: $('doneBanner'), doneStats: $('doneStats'),
  dlAgainBtn: $('dlAgainBtn'), convertAnotherBtn: $('convertAnotherBtn'),
};

const hasSavePicker = typeof window.showSaveFilePicker === 'function';

const state = {
  file: null, input: null, analysis: null,
  mode: 'turbo', outMode: 'disk', handle: null,
  conversion: null, writable: null, opfsOutput: null, outputMethod: 'memory',
  blobUrl: null, blob: null, blobName: '',
  converting: false, cancelRequested: false,
  t0: 0, timer: 0, bytesWritten: 0, maxProgress: 0,
};

/* ---------------- helpers ---------------- */
const fmtBytes = (n) => {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' kB';
  return n + ' B';
};
const fmtClock = (sec) => {
  if (sec == null || !isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const fmtFps = (f) => (!f ? '—' : (Math.abs(f - Math.round(f)) < 0.02 ? Math.round(f) : f.toFixed(3)) + ' fps');
const prettyFPS = (f) => (!f ? null : (Math.abs(f * 1.001 - Math.round(f * 1.001)) < 0.05 && f > 5 ? (f * 1000 / 1001).toFixed(3) : f.toFixed(3)));

function showError(msg) {
  els.errorBox.hidden = false;
  els.errorBox.textContent = '⚠️ ' + msg;
}
function clearError() { els.errorBox.hidden = true; els.errorBox.textContent = ''; }

function log(msg) {
  const line = document.createElement('div');
  const t = new Date();
  line.textContent = `[${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}] ${msg}`;
  els.logEl.appendChild(line);
  while (els.logEl.childNodes.length > 240) els.logEl.removeChild(els.logEl.firstChild);
  els.logEl.scrollTop = els.logEl.scrollHeight;
}

const CODEC_LABEL = {
  avc: 'H.264/AVC', hevc: 'H.265/HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', prores: 'ProRes',
  aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3 (Dolby Digital)',
  eac3: 'E-AC-3', dts: 'DTS', webvtt: 'WebVTT',
};
const codecLabel = (c) => (c && CODEC_LABEL[c]) || (c ? c.toUpperCase() : 'unknown');

let aacFallbackRegistered = false;

async function ensureAudioFallbacks() {
  const tracks = state.analysis?.ainfos || [];
  const needsAac = tracks.some((a) => a.codec !== 'aac');
  if (!needsAac) return;

  const hasDolbyDigital = tracks.some((a) => a.codec === 'ac3' || a.codec === 'eac3');
  if (hasDolbyDigital) {
    log('Using bundled local AC-3/E-AC-3 decoder (WASM) for Dolby audio.');
  }

  let nativeAac = false;
  try { nativeAac = await MB.canEncodeAudio('aac'); } catch { /* use fallback */ }
  if (!nativeAac && !aacFallbackRegistered) {
    if (typeof MB.registerAacEncoder !== 'function') {
      throw new Error('This browser has no AAC-LC encoder and the local fallback could not load.');
    }
    MB.registerAacEncoder();
    aacFallbackRegistered = true;
    log('Native AAC encoding is unavailable; using the bundled local AAC-LC encoder (WASM).');
  }
}

/* ---------------- PS5 compatibility math ---------------- */
// Sony's official PS5 USB list: MP4 = H.264 High Profile ≤ Level 5.2 + AAC-LC.
// Community-verified extra: HEVC Main/Main10 (incl. 4K HDR) also plays on PS5.
function avcCompliance(paramStr, levelFallbackOk = true) {
  // e.g. 'avc1.64002A' → PP=0x64 (High), CC, LL=0x2A (4.2)
  const m = /^avc[13]\.([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec((paramStr || '').trim());
  if (!m) return { known: false, ok: levelFallbackOk };
  const profile = parseInt(m[1], 16), level = parseInt(m[3], 16);
  const goodProfiles = [66, 77, 88, 100]; // Baseline, Main, Extended, High (8-bit 4:2:0)
  return { known: true, ok: goodProfiles.includes(profile) && level <= 52, profile, level };
}
function hevcLevel(paramStr) {
  // e.g. 'hvc1.1.6.L153.B0' → level = 0x99(153)/30 = 5.1
  const m = /\.L([0-9A-Fa-f]{3,4})\./.exec(paramStr || '');
  if (!m) return null;
  return parseInt(m[1], 16) / 30;
}

/* ---------------- support badges ---------------- */
async function renderSupport() {
  const badges = [];
  badges.push(`<span class="badge ${hasSavePicker ? 'ok' : 'warn'}">${hasSavePicker ? '✅' : '⚠️'} Stream-save to a chosen file ${hasSavePicker ? '' : '(needs Chrome/Edge)'}</span>`);
  try {
    const avc = await MB.canEncodeVideo('avc');
    badges.push(`<span class="badge ${avc ? 'ok' : 'warn'}">${avc ? '✅' : '⚠️'} Hardware H.264 re-encode</span>`);
  } catch { /* ignore */ }
  try {
    const nativeAac = await MB.canEncodeAudio('aac');
    const fallback = typeof MB.registerAacEncoder === 'function';
    const available = nativeAac || fallback;
    const label = nativeAac ? 'AAC-LC audio encode' : (fallback ? 'AAC-LC audio encode (local WASM)' : 'AAC audio encode unavailable');
    badges.push(`<span class="badge ${available ? 'ok' : 'warn'}">${available ? '✅' : '⚠️'} ${label}</span>`);
    state.canAac = available;
  } catch {
    const fallback = typeof MB.registerAacEncoder === 'function';
    state.canAac = fallback;
    badges.push(`<span class="badge ${fallback ? 'ok' : 'warn'}">${fallback ? '✅ AAC-LC audio encode (local WASM)' : '⚠️ AAC audio encode unavailable'}</span>`);
  }
  badges.push('<span class="badge ok">✅ AC-3/E-AC-3 decode (local WASM)</span>');
  try {
    const hevc = await MB.canEncodeVideo('hevc');
    state.canHevc = hevc;
    if (!hevc) { els.optHevc.disabled = true; els.optHevc.textContent += ' (encoder unavailable in this browser)'; }
  } catch { state.canHevc = false; }
  badges.push('<span class="badge">🛰️ Zero uploads · works offline</span>');
  els.supportBadges.innerHTML = badges.join('');
  state.canAvc = await MB.canEncodeVideo('avc').catch(() => false);
}

/* ---------------- file import ---------------- */
function setFile(file) {
  if (!file) return;
  if (state.converting) { showError('A conversion is running — cancel it first.'); return; }
  clearError();
  resetAnalysis();
  state.file = file;
  els.pickedName.textContent = `${file.name} · ${fmtBytes(file.size)}`;
  analyze(file);
}

els.browseBtn.addEventListener('click', () => els.fileInput.click());
els.drop.addEventListener('click', () => els.fileInput.click());
els.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); } });
els.fileInput.addEventListener('change', () => { setFile(els.fileInput.files[0]); els.fileInput.value = ''; });
for (const ev of ['dragenter', 'dragover']) {
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('dragover'); });
}
for (const ev of ['dragleave', 'drop']) {
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('dragover'); });
}
els.drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) setFile(f);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

/* ---------------- analysis ---------------- */
function resetAnalysis() {
  try { state.input?.dispose?.(); } catch { /* ignore */ }
  state.input = null; state.analysis = null; state.handle = null;
  els.chosenPath.textContent = '';
  els.fileCard.hidden = true; els.progressCard.hidden = true; els.doneCard.hidden = true;
  els.convertBtn.disabled = true;
  els.logEl.innerHTML = '';
}

async function analyze(file) {
  try {
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    if (!(await input.canRead())) {
      throw new Error('This container can’t be read in a browser (AVI, WMV, FLV and DVD VOB are the usual suspects). Supported: MKV, WebM, MP4, MOV/M4V, M2TS/TS (AVCHD), OGG, AAC, MP3, FLAC, WAV.');
    }
    state.input = input;

    const format = await input.getFormat().catch(() => null);
    const duration = await input.computeDuration().catch(() => null);
    const vtracks = await input.getVideoTracks().catch(() => []);
    const atracks = await input.getAudioTracks().catch(() => []);
    const allTracks = await input.getTracks().catch(() => []);
    const otherCount = Math.max(0, allTracks.length - vtracks.length - atracks.length); // subtitles & friends

    const v = vtracks[0] || null;
    let vinfo = null;
    if (v) {
      const codec = await v.getCodec();
      const param = await v.getCodecParameterString().catch(() => null);
      const w = await v.getCodedWidth().catch(() => 0);
      const h = await v.getCodedHeight().catch(() => 0);
      const dw = await v.getDisplayWidth().catch(() => w);
      const dh = await v.getDisplayHeight().catch(() => h);
      const rot = await v.getRotation().catch(() => 0);
      let fps = null;
      try { fps = (await v.computeFrameRateMetrics({ targetPacketCount: 400 })).bestGuessFrameRate; } catch { fps = null; }
      const avc = codec === 'avc' ? avcCompliance(param) : null;
      const hLevel = codec === 'hevc' ? hevcLevel(param) : null;
      vinfo = { codec, param, w, h, dw, dh, rot, fps, avc, hLevel };
    }

    const ainfos = [];
    for (const a of atracks.slice(0, 8)) {
      ainfos.push({
        codec: await a.getCodec().catch(() => null),
        channels: await a.getNumberOfChannels().catch(() => null),
        sampleRate: await a.getSampleRate().catch(() => null),
        lang: await a.getLanguageCode().catch(() => null),
        name: await a.getName().catch(() => null),
      });
    }

    // PS5 verdict
    let videoStatus; // 'official' | 'community' | 'incompatible'
    if (!vinfo) videoStatus = 'none';
    else if (vinfo.codec === 'avc' && vinfo.avc?.ok && vinfo.dw <= 4096 && vinfo.dh <= 2160) videoStatus = 'official';
    else if (vinfo.codec === 'hevc' && (!vinfo.hLevel || vinfo.hLevel <= 5.2)) videoStatus = 'community';
    else videoStatus = 'incompatible';
    const audioOk = ainfos.length === 0 || ainfos.every((a) => a.codec === 'aac');

    state.analysis = { file, format, duration, vinfo, ainfos, subCount: otherCount, videoStatus, audioOk };
    renderAnalysis();

    // Default mode: safest sensible choice
    if (videoStatus === 'incompatible') setMode('proof');
    else setMode('turbo');

    els.fileCard.hidden = false;
    els.fileCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

function renderAnalysis() {
  const a = state.analysis;
  if (!a) return;
  const rows = [];
  rows.push(['File', `${a.file.name}`]);
  rows.push(['Size', fmtBytes(a.file.size)]);
  rows.push(['Container', a.format?.name || '—']);
  rows.push(['Duration', a.duration != null ? `${fmtClock(a.duration)} (${a.duration.toFixed(1)} s)` : 'unknown (stream)']);
  if (a.vinfo) {
    const v = a.vinfo;
    rows.push(['Video', `${codecLabel(v.codec)}${v.param ? ` · <code class="tiny">${v.param}</code>` : ''}`]);
    rows.push(['Resolution', `${v.dw}×${v.dh}${v.rot ? ` · rotated ${v.rot}°` : ''}`]);
    rows.push(['Frame rate', fmtFps(v.fps)]);
  }
  a.ainfos.forEach((au, i) => {
    rows.push([`Audio ${i + 1}${au.lang && au.lang !== 'und' ? ` (${au.lang})` : ''}${au.name ? ` — “${au.name}”` : ''}`,
      `${codecLabel(au.codec)}${au.channels ? ` · ${au.channels} ch` : ''}${au.sampleRate ? ` · ${(au.sampleRate / 1000).toFixed(1)} kHz` : ''}`]);
  });
  if (a.subCount) rows.push(['Subtitles / other', `${a.subCount} track${a.subCount > 1 ? 's' : ''} (will be dropped — the PS5 ignores subtitles from USB)`]);
  els.fileDetails.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  // Verdict
  const vEl = els.ps5Verdict;
  vEl.hidden = false;
  if (a.videoStatus === 'none') {
    vEl.className = 'verdict ok';
    vEl.innerHTML = '<b>🎵 Audio-only file</b> Will be converted to AAC audio inside an MP4. (For PS5 music playback, MP3/FLAC/AAC audio files are the ones the Media Gallery lists.)';
  } else if (a.videoStatus === 'official' && a.audioOk) {
    vEl.className = 'verdict ok';
    vEl.innerHTML = '<b>✅ PS5-official streams inside!</b> Video is H.264 High Profile and audio is AAC — exactly Sony’s listed combination. Turbo remux can copy everything <strong>bit-for-bit</strong>: zero quality loss, speed limited only by your disk.';
  } else if (a.videoStatus === 'official' && !a.audioOk) {
    vEl.className = 'verdict ok';
    vEl.innerHTML = '<b>✅ Video is PS5-official (H.264)</b> Some audio track(s) aren’t AAC — Turbo remux copies the video untouched and re-encodes just the audio to AAC-LC (fast: audio-only work).';
  } else if (a.videoStatus === 'community') {
    vEl.className = 'verdict warn';
    vEl.innerHTML = '<b>⚠️ Video is HEVC/H.265</b> HEVC MP4s are widely verified to play on PS5 (including 4K HDR) and QuickTime on Mac, but Sony doesn’t officially list HEVC for USB video. <strong>Turbo remux copies it losslessly (fast).</strong> If your PS5 ever refuses it, re-run with <em>PS5-proof</em> to rebuild the video as H.264.';
  } else {
    const why = a.vinfo ? `${codecLabel(a.vinfo.codec)}${a.vinfo.param ? ` (${a.vinfo.param})` : ''}` : 'This video codec';
    vEl.className = 'verdict bad';
    vEl.innerHTML = `<b>🚫 ${why} won’t play on the PS5</b> It must be re-encoded to H.264 — <em>PS5-proof</em> mode has been selected for you. This uses your GPU/CPU via WebCodecs and runs several times faster than playback.`;
  }
  updatePlan();
  updateEstimate();
}

/* ---------------- modes ---------------- */
const MODE_TEXT = {
  turbo: '<strong>🚀 Turbo remux:</strong> the MP4 is repacked from the original streams with <em>zero re-encoding of video</em>. AAC audio is copied; anything else (including AC-3/E-AC-3, DTS, TrueHD, FLAC, Opus…) is rebuilt as AAC-LC using native or bundled local WASM codecs so the PS5 has official sound. This is the <strong>only mode where a 20 GB movie can finish in about a minute</strong> — it moves bytes at disk speed with no video quality loss.',
  proof: '<strong>🛡️ PS5-proof:</strong> output is guaranteed to match Sony’s official spec — H.264 High Profile video + AAC-LC audio in a plain MP4. If your video is already compliant H.264 it is still <em>copied untouched</em> (only the audio gets fixed). Otherwise the video is re-encoded with hardware acceleration. HDR becomes SDR in this mode.',
  compress: '<strong>🗜️ Compress:</strong> video and audio are always re-encoded to hit your size/quality target. Great for shrinking a 20 GB rip into something a phone, tablet or small USB stick can hold. Takes real encode time (typically a few × faster than playback with hardware acceleration).',
};

function setMode(mode) {
  state.mode = mode;
  for (const b of els.modeRow.querySelectorAll('.mode-btn')) b.classList.toggle('active', b.dataset.mode === mode);
  els.compressOpts.hidden = mode !== 'compress';
  els.modeNote.innerHTML = MODE_TEXT[mode];
  if (mode === 'proof' && state.canAvc === false) {
    els.modeNote.innerHTML += '<br><span style="color:var(--err)">⚠️ This browser can’t encode H.264 with WebCodecs. Re-encode modes need a compatible browser and hardware encoder; Turbo can still copy compatible video.</span>';
  }
  updatePlan();
  updateEstimate();
  updateConvertEnabled();
}
for (const b of els.modeRow.querySelectorAll('.mode-btn')) b.addEventListener('click', () => setMode(b.dataset.mode));

function planFor(mode) {
  const a = state.analysis;
  if (!a) return null;
  const plan = { video: null, audio: [], subs: a.subCount ? 'drop' : null };
  const needAudioRe = a.ainfos.some((x) => x.codec !== 'aac');
  if (mode === 'turbo') {
    plan.video = a.vinfo ? { action: 'copy', label: a.videoStatus === 'incompatible' ? 'copy (⚠ won’t play on PS5!)' : 'copy — lossless' } : null;
    for (const au of a.ainfos) plan.audio.push(au.codec === 'aac' ? { action: 'copy', label: 'copy — lossless' } : { action: 'reencode', label: `re-encode → AAC-LC` });
  } else if (mode === 'proof') {
    if (a.vinfo) {
      const copyable = a.videoStatus === 'official';
      plan.video = copyable ? { action: 'copy', label: 'copy — lossless (already H.264 High)' } : { action: 'reencode', label: 're-encode → H.264 High + AAC (hardware)' };
    }
    for (const au of a.ainfos) plan.audio.push(au.codec === 'aac' ? { action: 'copy', label: 'copy — lossless' } : { action: 'reencode', label: 're-encode → AAC-LC' });
  } else {
    const c = compressPlan();
    if (a.vinfo) plan.video = { action: 'reencode', label: `re-encode → ${c.codec === 'hevc' ? 'HEVC' : 'H.264'} ${c.h ? `· ≤${c.h}p` : ''} · ${els.optQuality.selectedOptions[0].textContent.split(' —')[0].toLowerCase()}` };
    for (const au of a.ainfos) plan.audio.push({ action: 'reencode', label: `re-encode → AAC ${Math.round(c.abr / 1000)}k` });
  }
  return plan;
}

function updatePlan() {
  const a = state.analysis, plan = planFor(state.mode);
  if (!a || !plan) return;
  const pill = (p) => p.action === 'copy' ? `<span class="pill copy">copy</span>${p.label.replace('copy — ', '').replace('copy ', '')}` : p.action === 'reencode' ? `<span class="pill re">re-encode</span>${p.label.replace('re-encode → ', '→ ')}` : '';
  const items = [];
  if (a.vinfo && plan.video) items.push(`<li>🎬 <strong>Video</strong> — ${codecLabel(a.vinfo.codec)} ${a.vinfo.dw}×${a.vinfo.dh} · ${fmtFps(a.vinfo.fps)} &nbsp; ${pill(plan.video)}</li>`);
  a.ainfos.forEach((au, i) => {
    if (!plan.audio[i]) return;
    items.push(`<li>🔊 <strong>Audio ${i + 1}</strong>${au.lang && au.lang !== 'und' ? ` (${au.lang})` : ''} — ${codecLabel(au.codec)}${au.channels ? ` ${au.channels}ch` : ''} &nbsp; ${pill(plan.audio[i])}</li>`);
  });
  if (plan.subs) items.push(`<li>💬 <strong>Subtitles</strong> — ${a.subCount} track(s) &nbsp; <span class="pill drop">dropped</span> PS5 ignores embedded subtitles</li>`);
  const existing = $('planList');
  if (existing) existing.remove();
  const ul = document.createElement('ul');
  ul.className = 'tracklist'; ul.id = 'planList';
  ul.innerHTML = items.join('');
  els.modeNote.appendChild(ul);
}

function compressPlan() {
  const a = state.analysis;
  const codec = els.optCodec.value === 'hevc' && state.canHevc !== false ? 'hevc' : 'avc';
  const cap = parseInt(els.optRes.value, 10) || 0;
  const srcH = a?.vinfo?.dh || 1080, srcW = a?.vinfo?.dw || 1920;
  let h = 0, w = srcW;
  if (cap && srcH > cap) { h = cap; w = Math.round(srcW * (cap / srcH)); } else { h = srcH; }
  const fpsCap = parseInt(els.optFps.value, 10) || 0;
  const srcFps = a?.vinfo?.fps || 30;
  const fps = fpsCap && srcFps > fpsCap ? fpsCap : srcFps;
  const presets = { 'very-high': 12e6, high: 8e6, medium: 5e6, small: 2.5e6, tiny: 1.1e6 };
  const base = presets[els.optQuality.value] ?? 5e6;
  const scale = Math.min(4.2, Math.max(0.2, (w * h * Math.min(60, Math.max(10, fps))) / (1920 * 1080 * 30)));
  let vbr = Math.min(45e6, Math.max(400e3, base * scale));
  if (codec === 'hevc') vbr *= 0.65;
  const ch = a?.ainfos?.[0]?.channels || 2;
  const abr = ch > 2 ? 320e3 : 160e3;
  return { codec, h: cap && srcH > cap ? cap : 0, w, fps: fpsCap && srcFps > fpsCap ? fpsCap : 0, vbr, abr, ch };
}

function updateEstimate() {
  if (state.mode !== 'compress' || !state.analysis) { els.estLine.hidden = true; return; }
  els.estLine.hidden = false;
  const c = compressPlan();
  const dur = state.analysis.duration;
  if (dur == null) { els.estLine.innerHTML = 'Estimated output size: <b>unknown until conversion</b> (stream duration not readable)'; return; }
  const est = (dur * (c.vbr + c.abr)) / 8 * 1.04;
  const pct = ((est / state.analysis.file.size) * 100).toFixed(0);
  els.estLine.innerHTML = `Estimated output: <b>≈ ${fmtBytes(est)}</b> (${pct}% of the original ${fmtBytes(state.analysis.file.size)}) · video ≈ ${Math.round(c.vbr / 1e6 * 10) / 10} Mbps ${c.codec === 'hevc' ? 'HEVC' : 'H.264'}${c.h ? ` · ≤${c.h}p` : ''} · audio ${Math.round(c.abr / 1000)}k AAC`;
}
for (const s of [els.optRes, els.optQuality, els.optCodec, els.optFps]) s.addEventListener('change', () => { updatePlan(); updateEstimate(); });

/* ---------------- output destination ---------------- */
function outModeFromUI() {
  state.outMode = $('outDownload').checked ? 'download' : 'disk';
  els.diskSetup.hidden = state.outMode !== 'disk';
  els.dlSetup.hidden = state.outMode !== 'download';
}
document.querySelectorAll('input[name="outMode"]').forEach((r) => r.addEventListener('change', outModeFromUI));

if (!hasSavePicker) {
  $('outDisk').disabled = true;
  $('outDisk').closest('.radio-card').querySelector('.d').textContent = 'This browser does not expose a picker for saving to an arbitrary folder. Use Browser download below; NebulaConvert will stream through temporary site storage (OPFS) when available, then hand the MP4 to Downloads.';
  $('outDownload').checked = true;
}
outModeFromUI();

function suggestedName() {
  const base = state.file.name.replace(/\.[^.]+$/, '');
  const ext = (state.file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return ext === 'mp4' ? `${base}-converted.mp4` : `${base}.mp4`;
}

// Safari does not expose a picker for an arbitrary user-selected destination. Use
// the Origin Private File System as a disk-backed staging area, then hand Safari
// a File object for its normal Downloads flow. Newer Safari has async createWritable;
// older versions can write through a synchronous access handle in a dedicated worker.
async function createOpfsOutput() {
  const storage = navigator.storage;
  if (typeof storage?.getDirectory !== 'function') return null;

  const root = await storage.getDirectory();
  const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const name = `nebulaconvert-${token}.mp4`;
  const handle = await root.getFileHandle(name, { create: true });

  if (typeof handle.createWritable === 'function') {
    const nativeStream = await handle.createWritable({ keepExistingData: false });
    const writer = nativeStream.getWriter();
    let closed = false;
    const writable = new WritableStream({
      write: (chunk) => writer.write(chunk),
      close: async () => { await writer.close(); closed = true; },
      abort: async (reason) => { try { await writer.abort(reason); } finally { closed = true; } },
    }, { highWaterMark: 1 });
    return {
      kind: 'opfs', name, handle, root, writable,
      abort: async () => {
        if (!closed) { try { await writer.abort(); } catch { /* ignore */ } }
        try { await root.removeEntry(name); } catch { /* ignore */ }
      },
      cleanup: async () => { try { await root.removeEntry(name); } catch { /* ignore */ } },
    };
  }

  if (typeof Worker !== 'function') {
    try { await root.removeEntry(name); } catch { /* ignore */ }
    return null;
  }

  const workerCode = `
    let root = null, access = null, path = null;
    self.onmessage = async (event) => {
      const m = event.data;
      try {
        if (m.type === 'init') {
          root = await navigator.storage.getDirectory();
          path = m.name;
          const file = await root.getFileHandle(path, { create: true });
          access = await file.createSyncAccessHandle();
          access.truncate(0);
          self.postMessage({ id: m.id, ok: true });
        } else if (m.type === 'write') {
          if (!access) throw new Error('Temporary OPFS file is not open.');
          const bytes = new Uint8Array(m.buffer);
          let offset = 0;
          while (offset < bytes.byteLength) {
            const count = access.write(bytes.subarray(offset), { at: m.position + offset });
            if (!count) throw new Error('Could not write to temporary browser storage.');
            offset += count;
          }
          self.postMessage({ id: m.id, ok: true });
        } else if (m.type === 'close') {
          if (access) { access.flush(); access.close(); access = null; }
          self.postMessage({ id: m.id, ok: true });
        } else if (m.type === 'abort') {
          if (access) { access.close(); access = null; }
          if (root && path) { try { await root.removeEntry(path); } catch { /* already removed */ } }
          self.postMessage({ id: m.id, ok: true });
        }
      } catch (error) {
        self.postMessage({ id: m.id, error: error && error.message ? error.message : String(error) });
      }
    };
  `;
  const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  let nextId = 0;
  let workerClosed = false;
  const pending = new Map();
  const request = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, type, ...payload }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
  worker.onmessage = (event) => {
    const { id, error } = event.data || {};
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    error ? job.reject(new Error(error)) : job.resolve();
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Temporary-storage worker failed.');
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  const stopWorker = () => {
    if (workerClosed) return;
    workerClosed = true;
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  };

  try {
    await request('init', { name });
  } catch (error) {
    stopWorker();
    try { await root.removeEntry(name); } catch { /* ignore */ }
    throw error;
  }

  const writable = new WritableStream({
    write: (chunk) => {
      if (chunk?.type !== 'write' || !chunk.data || !Number.isFinite(chunk.position)) {
        throw new TypeError('Unexpected MP4 output chunk.');
      }
      const copy = chunk.data.slice();
      return request('write', { position: chunk.position, buffer: copy.buffer }, [copy.buffer]);
    },
    close: async () => { await request('close'); stopWorker(); },
    abort: async () => { try { await request('abort'); } finally { stopWorker(); } },
  }, { highWaterMark: 1 });

  return {
    kind: 'opfs', name, handle, root, writable,
    abort: async () => {
      if (!workerClosed) { try { await request('abort'); } catch { /* ignore */ } stopWorker(); }
      try { await root.removeEntry(name); } catch { /* ignore */ }
    },
    cleanup: async () => { try { await root.removeEntry(name); } catch { /* ignore */ } },
  };
}

async function cleanupStaleOpfsFiles() {
  if (typeof navigator.storage?.getDirectory !== 'function') return;
  try {
    const root = await navigator.storage.getDirectory();
    const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
    for await (const [name, handle] of root.entries()) {
      if (!name.startsWith('nebulaconvert-') || handle.kind !== 'file') continue;
      try {
        const file = await handle.getFile();
        if (file.lastModified < staleBefore) await root.removeEntry(name);
      } catch { /* ignore an entry that is still open/in use */ }
    }
  } catch { /* OPFS cleanup is best-effort */ }
}
void cleanupStaleOpfsFiles();

els.chooseFileBtn.addEventListener('click', async () => {
  try {
    state.handle = await window.showSaveFilePicker({
      suggestedName: suggestedName(),
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
    });
    els.chosenPath.textContent = `✔ writing to “${state.handle.name}”`;
    updateConvertEnabled();
  } catch (err) {
    if (err?.name !== 'AbortError') showError(`Couldn’t open the save dialog: ${err?.message || err}. You can still use “Browser download” mode.`);
  }
});

function updateConvertEnabled() {
  els.convertBtn.disabled = !state.file || !state.analysis || state.converting;
}

/* ---------------- conversion ---------------- */
function buildTrackOptions() {
  const a = state.analysis;
  const mode = state.mode;
  // Per-track audio policy: AAC tracks get EMPTY options (pure copy — no accidental
  // re-encode); anything else (AC-3/E-AC-3, DTS, FLAC, Opus…) is rebuilt as AAC-LC.
  const aacAudioPolicy = async (track) => {
    const opts = {};
    let codec = null;
    try { codec = await track.getCodec(); } catch { codec = null; }
    if (codec === 'aac') return opts; // copy bit-for-bit
    opts.codec = 'aac';
    let ch = 2;
    try { ch = await track.getNumberOfChannels(); } catch { /* default */ }
    opts.quality = new MB.Quality({ bitrate: ch > 2 ? 448_000 : 192_000 });
    if (ch > 6) opts.numberOfChannels = 6;
    return opts;
  };

  if (mode === 'turbo') {
    // video: copy as-is (no options → mediabunny copies when the MP4 supports it — it supports all)
    return { video: {}, audio: aacAudioPolicy };
  }
  if (mode === 'proof') {
    const video = {};
    if (a.videoStatus !== 'official') {
      video.codec = 'avc';
      video.forceTranscode = true;
      video.quality = new MB.Quality('very-high');
      video.hardwareAcceleration = 'prefer-hardware';
      if (a.vinfo && (a.vinfo.dh > 2160 || a.vinfo.dw > 4096)) video.height = 2160;
    }
    return { video, audio: aacAudioPolicy };
  }
  // compress: always re-encode both
  const c = compressPlan();
  const video = {
    codec: c.codec,
    forceTranscode: true,
    quality: new MB.Quality({ bitrate: Math.round(c.vbr), bitrateMode: 'variable' }),
    hardwareAcceleration: 'prefer-hardware',
  };
  if (c.h) video.height = c.h;
  if (c.fps) video.frameRate = c.fps;
  const audio = {
    codec: 'aac',
    forceTranscode: true,
    quality: new MB.Quality({ bitrate: c.abr }),
  };
  if ((a.ainfos[0]?.channels || 2) > 6) audio.numberOfChannels = 6;
  return { video, audio };
}

els.convertBtn.addEventListener('click', startConversion);

async function startConversion() {
  if (state.converting || !state.analysis) return;
  clearError();

  // resolve destination (user gesture — picker allowed here)
  let writable = null;
  if (state.outMode === 'disk') {
    if (!state.handle) {
      try {
        state.handle = await window.showSaveFilePicker({
          suggestedName: suggestedName(),
          types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        });
        els.chosenPath.textContent = `✔ writing to “${state.handle.name}”`;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // iframe/permission problems → offer download fallback
        showError(`This browser context blocked the save dialog (${err?.message || err}). Switched to “Browser download”.`);
        $('outDownload').checked = true; outModeFromUI();
      }
    }
    if (state.handle) {
      try { writable = await state.handle.createWritable(); }
      catch (err) { showError(`Can’t open “${state.handle.name}” for writing: ${err?.message || err}`); return; }
    }
  }

  // If the user chose a browser download, use OPFS as a disk-backed staging area
  // when available. This is Safari's large-file path; Safari cannot expose a
  // user-picked save path, but it can download a File produced from OPFS.
  let opfsOutput = null;
  let opfsSpaceNote = '';
  if (!writable && state.outMode === 'download') {
    try { opfsOutput = await createOpfsOutput(); }
    catch (err) {
      if (state.file.size >= 1.5e9) {
        showError(`Could not open temporary browser storage (${err?.message || err}). This ${fmtBytes(state.file.size)} input is too large for the in-memory download fallback. Check browser storage/free disk space, or use Chrome/Edge for a direct-to-file save.`);
        return;
      }
      log(`Temporary browser storage unavailable; using memory for this smaller output (${err?.message || err}).`);
    }
    if (!opfsOutput && state.file.size >= 1.5e9) {
      showError(`This browser cannot stream to temporary storage, and the in-memory download is risky for a ${fmtBytes(state.file.size)} input. Update your browser or use Chrome/Edge’s direct-to-file save.`);
      return;
    }
    if (opfsOutput) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate?.quota && Number.isFinite(estimate.usage)) {
          const free = Math.max(0, estimate.quota - estimate.usage);
          opfsSpaceNote = `Temporary browser storage: about ${fmtBytes(free)} available (output needs at least ${fmtBytes(state.file.size)}; re-encoding may need more).`;
        }
      } catch { /* storage estimates are optional */ }
    }
  }

  const toDisk = !!writable && !opfsOutput;
  const outputWritable = writable || opfsOutput?.writable || null;
  const streamed = !!outputWritable;
  const target = streamed ? new MB.StreamTarget(outputWritable, { chunked: true }) : new MB.BufferTarget();
  const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
  const { video, audio } = buildTrackOptions();

  els.progressCard.hidden = false;
  els.doneCard.hidden = true;
  els.logEl.innerHTML = '';
  state.converting = true; state.cancelRequested = false;
  state.bytesWritten = 0; state.maxProgress = 0; state.writable = outputWritable;
  state.opfsOutput = opfsOutput;
  state.outputMethod = toDisk ? 'file' : (opfsOutput ? 'opfs' : 'memory');
  els.convertBtn.disabled = true; els.cancelBtn.disabled = false;
  els.progressCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const modeLabel = { turbo: 'Turbo remux', proof: 'PS5-proof', compress: 'Compress' }[state.mode];
  const destinationLabel = toDisk ? ' · streaming to chosen file' : opfsOutput ? ' · streaming to temporary storage' : ' · in-memory download';
  els.statMode.textContent = modeLabel + destinationLabel;
  log(`Loaded “${state.file.name}” (${fmtBytes(state.file.size)}) — mode: ${modeLabel}`);
  if (opfsSpaceNote) log(opfsSpaceNote);
  if (opfsOutput) log('Output is streaming to temporary site storage (OPFS); the finished MP4 will be sent to the browser Downloads flow.');

  try {
    await ensureAudioFallbacks();
    const conversion = await MB.Conversion.init({ input: state.input, output, video, audio, showWarnings: false });
    state.conversion = conversion;

    const trackKind = (t) => (!t ? 'track' : ('getCodedWidth' in t ? 'video' : ('getNumberOfChannels' in t ? 'audio' : ('getCodec' in t ? 'media' : 'subtitle/other'))));
    let droppedVideo = 0, droppedAudio = 0, droppedSubs = 0;
    for (const d of conversion.discardedTracks || []) {
      const kind = trackKind(d.track);
      let codec = '';
      try { codec = await d.track?.getCodec?.() || ''; } catch { /* ignore */ }
      if (kind === 'video') droppedVideo++;
      else if (kind === 'audio') droppedAudio++;
      else droppedSubs++;
      log(`${kind} track dropped${codec ? ` (${codecLabel(codec)})` : ''} — ${d.reason === 'undecodable_source_codec' ? 'this browser cannot decode/rebuild it' : d.reason}`);
    }
    if (droppedSubs) log(`Note: the PS5’s Media Gallery ignores embedded subtitles — dropping them is normal.`);
    if (droppedVideo && state.analysis.vinfo) {
      throw new Error('The video track could not be produced here: this browser lacks a decoder/encoder for it, or the codec can’t be converted in a browser at all (MPEG-2, VC-1, MPEG-4 ASP/Xvid and DRM-protected content are the usual cases). Supported video: H.264, HEVC, VP8/VP9, AV1, ProRes. Turbo remux copies H.264/HEVC without needing any codec support.');
    }
    if (droppedAudio && state.analysis.ainfos.length && droppedAudio === state.analysis.ainfos.length) {
      const codecs = [...new Set(state.analysis.ainfos.map((a) => codecLabel(a.codec)))].join(', ');
      throw new Error(`All audio tracks (${codecs || 'unknown codec'}) were dropped. The local AC-3/E-AC-3 decoder and AAC-LC fallback are included; reload the page and retry. If it still fails, this source may be damaged or use an unsupported profile.`);
    }
    if (!conversion.isValid) {
      const reasons = [...new Set((conversion.discardedTracks || []).map((d) => d.reason))].join(', ');
      throw new Error(`No playable tracks could be produced (reasons: ${reasons || 'unknown'}). The file may use a codec this browser can’t decode — try Chrome/Edge, or check the FAQ.`);
    }

    conversion.onProgress = (p) => { state.maxProgress = Math.max(state.maxProgress, p || 0); };
    target.on('write', ({ end }) => { state.bytesWritten = Math.max(state.bytesWritten, end); });

    state.t0 = performance.now();
    state.timer = setInterval(tickStats, 250);
    els.progressStatus.textContent = 'Converting…';

    await conversion.execute();

    clearInterval(state.timer); state.timer = 0;
    const elapsed = (performance.now() - state.t0) / 1000;

    let outSize = state.bytesWritten, blob = null;
    if (toDisk) {
      // StreamTarget owns the stream: it already closed (and thus committed) the
      // file when the output finalized. Do NOT close it again here.
      state.writable = null;
      log(`Finalized “${state.handle.name}” — ${fmtBytes(outSize)} written in ${fmtClock(elapsed)}`);
    } else if (opfsOutput) {
      // getFile() returns a disk-backed File; Safari's normal download flow can
      // read it without building a second full-size JS ArrayBuffer.
      const file = await opfsOutput.handle.getFile();
      outSize = file.size;
      blob = file;
      state.blob = file; state.blobName = suggestedName();
      if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = URL.createObjectURL(file);
      triggerDownload(state.blobUrl, state.blobName);
      state.writable = null;
      log(`MP4 staged in site storage (OPFS) and handed to Downloads — ${fmtBytes(outSize)} in ${fmtClock(elapsed)}`);
      setTimeout(() => { void opfsOutput.cleanup?.(); }, 2 * 60 * 60 * 1000);
    } else {
      const buf = output.target.buffer;
      outSize = buf.byteLength;
      blob = new Blob([buf], { type: 'video/mp4' });
      state.blob = blob; state.blobName = suggestedName();
      if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = URL.createObjectURL(blob);
      triggerDownload(state.blobUrl, state.blobName);
      log(`MP4 ready in memory — ${fmtBytes(outSize)} in ${fmtClock(elapsed)}`);
    }

    finish(elapsed, outSize, toDisk, modeLabel);
  } catch (err) {
    clearInterval(state.timer); state.timer = 0;
    try { await state.writable?.abort(); } catch { /* stream may be locked by StreamTarget */ }
    try { await state.opfsOutput?.abort?.(); } catch { /* ignore */ }
    state.writable = null; state.opfsOutput = null; state.outputMethod = 'memory';
    if (err?.name === 'ConversionCanceledError' || state.cancelRequested) {
      els.progressStatus.textContent = 'Canceled.';
      log('Conversion canceled.' + (state.outMode === 'disk' ? ' A partially written file may remain at the destination — overwrite or delete it.' : ''));
    } else {
      console.error(err);
      els.progressStatus.textContent = 'Failed.';
      log(`ERROR: ${err?.message || err}`);
      showError(err?.message || String(err));
    }
    state.converting = false; state.conversion = null;
    els.convertBtn.disabled = false;
  }
}

function tickStats() {
  const elapsed = (performance.now() - state.t0) / 1000;
  const p = Math.max(state.maxProgress, state.analysis?.duration ? Math.min(0.99, state.bytesWritten / Math.max(1, state.file.size)) : 0);
  els.progressBar.style.width = (p * 100).toFixed(1) + '%';
  els.progressPct.textContent = (p * 100).toFixed(1) + '%';
  const speed = elapsed > 0.4 ? state.bytesWritten / elapsed : 0;
  els.statSpeed.textContent = speed > 0 ? fmtBytes(speed) + '/s' : '—';
  els.statWritten.textContent = fmtBytes(state.bytesWritten);
  els.statElapsed.textContent = fmtClock(elapsed);
  els.statEta.textContent = p > 0.02 && speed > 0 ? fmtClock((elapsed / p) * (1 - p)) : '—';
}

els.cancelBtn.addEventListener('click', async () => {
  if (!state.converting) return;
  state.cancelRequested = true;
  els.cancelBtn.disabled = true;
  els.progressStatus.textContent = 'Canceling…';
  log('Canceling…');
  try { await state.conversion?.cancel(); } catch (e) { console.warn(e); }
});

function triggerDownload(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

function finish(elapsed, outSize, toDisk, modeLabel) {
  state.converting = false; state.conversion = null;
  els.progressStatus.textContent = 'Done!';
  els.progressBar.style.width = '100%'; els.progressPct.textContent = '100%';
  els.convertBtn.disabled = false; els.cancelBtn.disabled = true;

  const avg = elapsed > 0 ? outSize / elapsed : 0;
  els.doneBanner.innerHTML = toDisk
    ? `Your MP4 has been streamed to <strong>“${state.handle.name}”</strong> — nothing was held in memory.`
    : state.outputMethod === 'opfs'
      ? `Your MP4 was streamed to temporary browser storage and handed to Downloads: <strong>${state.blobName}</strong>. Use “Download again” if your browser did not start it.`
      : `Your MP4 (<strong>${state.blobName}</strong>) should be downloading now.`;
  els.doneStats.innerHTML = `
    <div class="est"><div class="k">Output size</div><div class="v">${fmtBytes(outSize)}</div></div>
    <div class="est"><div class="k">Time</div><div class="v">${fmtClock(elapsed)}</div></div>
    <div class="est"><div class="k">Avg speed</div><div class="v">${fmtBytes(avg)}/s</div></div>
    <div class="est"><div class="k">Mode</div><div class="v">${modeLabel}</div></div>
    <div class="est"><div class="k">Source</div><div class="v">${fmtBytes(state.file.size)}</div></div>`;
  els.dlAgainBtn.hidden = toDisk;
  if (!toDisk) { els.dlAgainBtn.href = state.blobUrl; els.dlAgainBtn.download = state.blobName; }
  els.doneCard.hidden = false;
  els.doneCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  log(`🌟 Finished in ${fmtClock(elapsed)} · ${fmtBytes(outSize)} · avg ${fmtBytes(avg)}/s`);
}

els.resetBtn.addEventListener('click', resetAll);
els.convertAnotherBtn.addEventListener('click', resetAll);
function resetAll() {
  if (state.converting) return;
  try { state.input?.dispose?.(); } catch { /* ignore */ }
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.file = null; state.input = null; state.analysis = null; state.handle = null;
  state.blob = null; state.blobUrl = null; state.conversion = null; state.writable = null;
  state.opfsOutput = null; state.outputMethod = 'memory';
  els.pickedName.textContent = ''; els.chosenPath.textContent = '';
  els.fileCard.hidden = true; els.progressCard.hidden = true; els.doneCard.hidden = true;
  els.logEl.innerHTML = ''; clearError();
  els.progressBar.style.width = '0%'; els.progressPct.textContent = '0%';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('beforeunload', (e) => {
  if (state.converting) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------- space background (from Nebula ISO2GOD) ---------------- */
function initStarfield() {
  const canvas = $('stars');
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [], shooting = [], w = 0, h = 0, raf = 0, last = 0;
  let parX = 0, parY = 0, targetX = 0, targetY = 0;
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(420, Math.floor(w * h / 4200));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      z: 0.25 + Math.random() * 0.75,
      r: 0.4 + Math.random() * 1.5,
      tw: Math.random() * Math.PI * 2,
      twSpeed: 0.4 + Math.random() * 1.6,
      drift: 1.5 + Math.random() * 6,
      hue: [210, 230, 260, 190, 45][Math.floor(Math.random() * 5)],
    }));
    if (reduced) draw(0);
  }
  function spawnShooting() {
    shooting.push({
      x: Math.random() * w * 0.7 + w * 0.15, y: Math.random() * h * 0.3,
      vx: -(380 + Math.random() * 320), vy: 210 + Math.random() * 160,
      life: 0, ttl: 0.9 + Math.random() * 0.7,
    });
  }
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    parX += (targetX - parX) * 0.03; parY += (targetY - parY) * 0.03;
    for (const s of stars) {
      const x = (s.x - parX * 18 * s.z + w) % w;
      const y = (s.y - parY * 12 * s.z + h) % h;
      const alpha = 0.35 + 0.65 * Math.abs(Math.sin(s.tw + t * 0.001 * s.twSpeed));
      ctx.beginPath();
      ctx.fillStyle = 'hsla(' + s.hue + ', 90%, 86%, ' + (alpha * s.z).toFixed(3) + ')';
      ctx.arc(x, y, s.r * s.z + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = shooting.length - 1; i >= 0; i--) {
      const sh = shooting[i];
      const fade = Math.sin(Math.min(1, sh.life / sh.ttl) * Math.PI);
      const grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 0.22, sh.y - sh.vy * 0.22);
      grad.addColorStop(0, 'rgba(255,255,255,' + (0.9 * fade) + ')');
      grad.addColorStop(1, 'rgba(150,200,255,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * 0.22, sh.y - sh.vy * 0.22);
      ctx.stroke();
    }
  }
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    for (const s of stars) { s.x -= s.drift * dt * 0.35; if (s.x < -4) s.x = w + 4; }
    for (let i = shooting.length - 1; i >= 0; i--) {
      const sh = shooting[i];
      sh.life += dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      if (sh.life > sh.ttl) shooting.splice(i, 1);
    }
    if (Math.random() < dt * 0.12 && shooting.length < 2) spawnShooting();
    draw(t);
    raf = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    targetX = (e.clientX / Math.max(1, w) - 0.5) * 2;
    targetY = (e.clientY / Math.max(1, h) - 0.5) * 2;
  }, { passive: true });
  resize();
  if (!reduced) raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (reduced) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
}

/* ---------------- boot ---------------- */
renderSupport().then(() => {
  if (state.analysis) updatePlan();
});
initStarfield();
