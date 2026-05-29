/**
 * AI Melody Generator — Markov chain + music theory rules
 *
 * MagentaJS CDN の動的ロードが不安定なため、同等の確率的生成を
 * ブラウザ完結で実装。CDN不要・オフライン動作・即時起動。
 *
 * アルゴリズム:
 *   - Cメジャーペンタトニック音階上のマルコフ連鎖
 *   - フレーズ構造（4小節単位）でメロディーに抑揚
 *   - 音長バリエーション（8分・4分・付点）
 *   - OfflineAudioContext で FM シンセ → AudioBuffer
 */

// ── Scale & harmony ────────────────────────────────────────────────────────

// C major pentatonic across 2 octaves
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

// Markov transition weights: index offset from current note
// [-3, -2, -1, 0(rest), +1, +2, +3]
const TRANSITIONS = [
  { delta: -2, weight: 0.10 },
  { delta: -1, weight: 0.25 },
  { delta:  0, weight: 0.08 }, // repeat same note
  { delta: +1, weight: 0.30 },
  { delta: +2, weight: 0.20 },
  { delta: +3, weight: 0.07 },
];

// Rhythm patterns (in quarter-note units)
const RHYTHMS = [0.5, 0.5, 1.0, 1.0, 1.5, 2.0];
const RHYTHM_WEIGHTS = [0.25, 0.25, 0.20, 0.15, 0.10, 0.05];

function weightedChoice(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function nextScaleIndex(current, phrasePosition, phraseLength) {
  // Phrase ending: tend to resolve toward root (index 0 or 5)
  const nearEnd = phrasePosition > phraseLength * 0.75;
  const transitions = nearEnd
    ? TRANSITIONS.map(t => ({ ...t, weight: t.delta < 0 ? t.weight * 1.8 : t.weight * 0.6 }))
    : TRANSITIONS;

  const delta = weightedChoice(
    transitions.map(t => t.delta),
    transitions.map(t => t.weight)
  );
  return Math.max(0, Math.min(SCALE.length - 1, current + delta));
}

// ── Generate NoteSequence ─────────────────────────────────────────────────

export function generateSequence(totalBars = 8, bpm = 120) {
  const quarterSec = 60 / bpm;
  const barBeats   = 4;
  const notes      = [];

  let scaleIdx  = 2; // start on E4
  let timeSec   = 0;
  let bar       = 0;
  let beatInBar = 0;

  while (bar < totalBars) {
    const phraseBar    = bar % 4;
    const phraseBeat   = phraseBar * barBeats + beatInBar;
    const phraseLength = 4 * barBeats;

    // Occasional rest (15%)
    const isRest = Math.random() < 0.15;
    const dur    = weightedChoice(RHYTHMS, RHYTHM_WEIGHTS) * quarterSec;

    if (!isRest) {
      scaleIdx = nextScaleIndex(scaleIdx, phraseBeat, phraseLength);
      notes.push({
        pitch:     SCALE[scaleIdx],
        startTime: timeSec,
        endTime:   timeSec + dur * 0.88, // slight staccato
      });
    }

    timeSec   += dur;
    beatInBar += dur / quarterSec;
    while (beatInBar >= barBeats) {
      beatInBar -= barBeats;
      bar++;
    }
  }

  return { notes, totalTime: timeSec };
}

// ── Render NoteSequence → AudioBuffer (FM synth) ──────────────────────────

function scheduleNote(ctx, pitch, startSec, durationSec) {
  const freq   = 440 * Math.pow(2, (pitch - 69) / 12);
  const gain   = ctx.createGain();
  const osc    = ctx.createOscillator();
  const mod    = ctx.createOscillator();
  const modGain = ctx.createGain();

  gain.connect(ctx.destination);
  mod.connect(modGain);
  modGain.connect(osc.frequency);
  osc.connect(gain);

  osc.type          = 'triangle';
  osc.frequency.value = freq;
  mod.frequency.value = freq * 2.01;
  modGain.gain.value  = freq * 0.35;

  const attack  = 0.012;
  const release = Math.min(0.15, durationSec * 0.35);
  const vel     = 0.20;

  gain.gain.setValueAtTime(0, startSec);
  gain.gain.linearRampToValueAtTime(vel, startSec + attack);
  gain.gain.setValueAtTime(vel, startSec + durationSec - release);
  gain.gain.linearRampToValueAtTime(0, startSec + durationSec);

  mod.start(startSec);
  osc.start(startSec);
  mod.stop(startSec + durationSec + 0.02);
  osc.stop(startSec + durationSec + 0.02);
}

export async function renderToBuffer(noteSequence) {
  const totalTime  = noteSequence.totalTime + 0.5;
  const sampleRate = 44100;
  const offCtx     = new OfflineAudioContext(1, Math.ceil(totalTime * sampleRate), sampleRate);

  for (const note of noteSequence.notes) {
    const duration = note.endTime - note.startTime;
    scheduleNote(offCtx, note.pitch, note.startTime, duration);
  }

  return await offCtx.startRendering();
}

// ── Compatibility stubs (same API surface as before) ──────────────────────

export async function loadMagenta(onProgress = () => {}) {
  // No external loading needed — all local
  onProgress('AI ジェネレーター 準備完了 ✓');
}

export function isReady() {
  return true; // always ready, no model download required
}
