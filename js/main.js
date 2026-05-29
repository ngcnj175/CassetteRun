import { requestPermission, startMotion, stopMotion, simulateRate } from './motion.js';
import { loadFile, play, stop, setPlaybackRate, hasBuffer, getIsPlaying } from './audio.js';
import { loadMagenta, generateLoop, isReady } from './magenta.js';

// --- DOM refs ---
const btnStart     = document.getElementById('btn-start');
const btnStop      = document.getElementById('btn-stop');
const fileInput    = document.getElementById('file-input');
const modeMP3      = document.getElementById('mode-mp3');
const modeMagenta  = document.getElementById('mode-magenta');
const vuFill       = document.getElementById('vu-fill');
const rateDisplay  = document.getElementById('rate-display');
const statusText   = document.getElementById('status-text');
const reelLeft     = document.getElementById('reel-left');
const reelRight    = document.getElementById('reel-right');
const tapeSag      = document.getElementById('tape-sag');
const simSlider    = document.getElementById('sim-slider');
const permBtn      = document.getElementById('btn-permission');

let running = false;
let reelAngle = 0;

// --- Reel animation ---
function updateVisuals(rate) {
  // VU meter
  const pct = (rate / 2.0) * 100;
  vuFill.style.width = `${pct}%`;
  vuFill.style.background = rate < 0.3 ? '#8B4513'
    : rate < 1.0 ? '#C8860A'
    : rate < 1.6 ? '#E8A020'
    : '#FF4500';

  // Speed label
  rateDisplay.textContent = rate.toFixed(2) + 'x';

  // Reel rotation — faster spin at higher rate
  const rpm = rate * 180; // degrees per second
  reelAngle += rpm / 60;  // assuming ~60fps from rAF in motion.js
  reelLeft.style.transform  = `rotate(${reelAngle}deg)`;
  reelRight.style.transform = `rotate(${reelAngle}deg)`;

  // Tape sag at low speed
  const sag = rate < 0.3 ? Math.max(0, 1 - rate / 0.3) : 0;
  tapeSag.style.opacity = sag;
  tapeSag.style.transform = `scaleY(${1 + sag * 0.4})`;

  // Status text
  if (rate < 0.05) statusText.textContent = '■ STOPPED';
  else if (rate < 0.6) statusText.textContent = '▶ SLOW';
  else if (rate < 1.4) statusText.textContent = '▶▶ PLAY';
  else statusText.textContent = '▶▶▶ FAST';
}

// --- Main rate handler ---
function onRate(rate) {
  setPlaybackRate(rate);
  updateVisuals(rate);
}

// --- Start ---
btnStart.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;

  if (mode === 'mp3') {
    if (!hasBuffer()) {
      statusText.textContent = 'MP3を選択してください';
      return;
    }
    play();
  } else {
    // Magenta mode
    if (!isReady()) {
      statusText.textContent = 'Magenta読み込み中...';
      await loadMagenta(msg => { statusText.textContent = msg; });
    }
    statusText.textContent = '生成中...';
    // TODO: render MIDI sequence to AudioBuffer and call loadBuffer()
    statusText.textContent = 'Magenta: 開発中';
    return;
  }

  running = true;
  btnStart.disabled = true;
  btnStop.disabled = false;

  const { ok, reason } = await requestPermission();
  if (!ok) {
    // Fallback: desktop simulation via slider
    statusText.textContent = `センサー非対応: スライダーで操作 (${reason})`;
  }
  startMotion(onRate);
});

// --- Stop ---
btnStop.addEventListener('click', () => {
  running = false;
  stopMotion();
  stop();
  btnStart.disabled = false;
  btnStop.disabled = true;
  statusText.textContent = '■ STOPPED';
  updateVisuals(0);
});

// --- MP3 file load ---
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  statusText.textContent = 'Loading...';
  await loadFile(file);
  statusText.textContent = `Loaded: ${file.name}`;
});

// --- Desktop simulation slider ---
if (simSlider) {
  simSlider.addEventListener('input', () => {
    simulateRate(parseFloat(simSlider.value));
  });
}

// --- iOS permission button ---
if (permBtn) {
  permBtn.addEventListener('click', async () => {
    const { ok, reason } = await requestPermission();
    permBtn.textContent = ok ? 'センサー許可済み ✓' : `失敗: ${reason}`;
    permBtn.disabled = ok;
  });
}
