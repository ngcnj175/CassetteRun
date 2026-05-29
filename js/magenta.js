// MagentaJS music generation (Mode A)
// Generates a looping MIDI sequence and renders it to AudioBuffer via Tone.js

let isLoaded = false;
let musicRnn = null;
let player = null;

const SEED_SEQUENCE = {
  notes: [
    { pitch: 60, startTime: 0.0, endTime: 0.5 },
    { pitch: 62, startTime: 0.5, endTime: 1.0 },
    { pitch: 64, startTime: 1.0, endTime: 1.5 },
    { pitch: 65, startTime: 1.5, endTime: 2.0 },
  ],
  totalTime: 2.0,
};

export async function loadMagenta(onProgress) {
  // Dynamically load MagentaJS from CDN
  await loadScript('https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/es6/core.js');

  if (onProgress) onProgress('Loading MelodyRNN model...');

  musicRnn = new mm.MusicRNN(
    'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn'
  );
  await musicRnn.initialize();
  isLoaded = true;
  if (onProgress) onProgress('Magenta ready');
}

export async function generateLoop(steps = 32, temperature = 1.1) {
  if (!isLoaded) throw new Error('Magenta not loaded');
  const result = await musicRnn.continueSequence(SEED_SEQUENCE, steps, temperature);
  return result;
}

export function isReady() {
  return isLoaded;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
