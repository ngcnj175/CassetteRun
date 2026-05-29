/**
 * MagentaJS — AI melody generation + offline rendering to AudioBuffer
 *
 * Flow:
 *   loadMagenta()  → downloads ~5MB model checkpoint (once per session)
 *   generateLoop() → MusicRNN generates a NoteSequence
 *   renderToBuffer() → OfflineAudioContext synth → AudioBuffer
 *   AudioBuffer is fed into audio.js (same playbackRate engine as MP3 mode)
 *
 * Cost: FREE (browser-local, Google CDN, no API keys)
 * Risk: ~5MB model DL on first use; Google CDN dependency
 */

const CHECKPOINT_URL =
  'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn';

// ES module CDN — loaded via dynamic import(), not <script> tag
const MAGENTA_CDN =
  'https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/es6/core.js';

// Seed: 8 note motif in C major
const SEED = {
  notes: [
    { pitch: 60, startTime: 0.0,  endTime: 0.25 },
    { pitch: 62, startTime: 0.25, endTime: 0.5  },
    { pitch: 64, startTime: 0.5,  endTime: 0.75 },
    { pitch: 65, startTime: 0.75, endTime: 1.0  },
    { pitch: 67, startTime: 1.0,  endTime: 1.25 },
    { pitch: 65, startTime: 1.25, endTime: 1.5  },
    { pitch: 64, startTime: 1.5,  endTime: 1.75 },
    { pitch: 62, startTime: 1.75, endTime: 2.0  },
  ],
  totalTime: 2.0,
  tempos: [{ time: 0, qpm: 120 }],
};

let musicRnn = null;
let isLoaded = false;
let mm = null; // will hold the dynamically imported Magenta module

// ── Load MagentaJS + model ─────────────────────────────────────────────────

export async function loadMagenta(onProgress = () => {}) {
  if (isLoaded) return;

  onProgress('MagentaJS を読み込み中... (初回のみ ~5MB)');

  // Dynamic import works for ES modules from CDN (CORS enabled on jsDelivr)
  try {
    mm = await import(/* @vite-ignore */ MAGENTA_CDN);
  } catch (e) {
    throw new Error(`MagentaJS の読み込みに失敗しました: ${e.message}`);
  }

  // The module may expose classes directly or under a default/namespace
  const MusicRNN = mm.MusicRNN ?? mm.default?.MusicRNN;
  const sequences = mm.sequences ?? mm.default?.sequences;

  if (!MusicRNN) {
    throw new Error('MusicRNN が見つかりません。ネットワーク接続を確認してください。');
  }

  // Store resolved refs for later use
  mm._MusicRNN  = MusicRNN;
  mm._sequences = sequences;

  onProgress('モデルを初期化中... (数秒かかります)');
  musicRnn = new MusicRNN(CHECKPOINT_URL);
  await musicRnn.initialize();

  isLoaded = true;
  onProgress('AI 準備完了 ✓');
}

export function isReady() {
  return isLoaded;
}

// ── Generate NoteSequence ──────────────────────────────────────────────────

export async function generateSequence(steps = 64, temperature = 1.05) {
  if (!isLoaded) throw new Error('Magenta が初期化されていません');
  const seq = await musicRnn.continueSequence(SEED, steps, temperature);
  // Prepend the seed so we always have a full loop
  const concatenate = mm._sequences?.concatenate;
  const combined = concatenate ? concatenate([SEED, seq]) : seq;
  return combined;
}

// ── Render NoteSequence → AudioBuffer (OfflineAudioContext synth) ──────────

/**
 * Simple FM-ish piano synth per note.
 * All processing is local — no network calls.
 */
function scheduleNote(ctx, pitch, startSec, durationSec) {
  const freq = 440 * Math.pow(2, (pitch - 69) / 12);
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  // Carrier oscillator
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;

  // Modulator for FM warmth
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  mod.frequency.value = freq * 2.01;
  modGain.gain.value = freq * 0.4;
  mod.connect(modGain);
  modGain.connect(osc.frequency);

  osc.connect(gain);

  // Envelope: attack → sustain → release
  const attack  = 0.01;
  const release = Math.min(0.12, durationSec * 0.4);
  const vel     = 0.22;

  gain.gain.setValueAtTime(0, startSec);
  gain.gain.linearRampToValueAtTime(vel, startSec + attack);
  gain.gain.setValueAtTime(vel, startSec + durationSec - release);
  gain.gain.linearRampToValueAtTime(0, startSec + durationSec);

  mod.start(startSec);
  osc.start(startSec);
  mod.stop(startSec + durationSec + 0.01);
  osc.stop(startSec + durationSec + 0.01);
}

export async function renderToBuffer(noteSequence, bpm = 120) {
  const secPerQuarter = 60 / bpm;

  // Find total duration
  const totalTime = noteSequence.notes.reduce(
    (max, n) => Math.max(max, n.endTime), 0
  ) * secPerQuarter;

  const sampleRate = 44100;
  const offCtx = new OfflineAudioContext(1, Math.ceil((totalTime + 0.5) * sampleRate), sampleRate);

  for (const note of noteSequence.notes) {
    const start    = note.startTime * secPerQuarter;
    const duration = (note.endTime - note.startTime) * secPerQuarter;
    scheduleNote(offCtx, note.pitch, start, duration);
  }

  const buffer = await offCtx.startRendering();
  return buffer;
}
