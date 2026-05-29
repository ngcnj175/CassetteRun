import { requestPermission, startMotion, stopMotion, simulateRate } from './motion.js';
import { loadFile, loadBuffer, play, stop, setPlaybackRate, hasBuffer, getContext } from './audio.js';
import { TRACKS } from './tracks.js';

// --- DOM refs ---
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const fileInput   = document.getElementById('file-input');
const trackList   = document.getElementById('track-list');
const vuFill      = document.getElementById('vu-fill');
const rateDisplay = document.getElementById('rate-display');
const statusText  = document.getElementById('status-text');
const reelLeft    = document.getElementById('reel-left');
const reelRight   = document.getElementById('reel-right');
const tapeSag     = document.getElementById('tape-sag');
const simSlider   = document.getElementById('sim-slider');
const permBtn     = document.getElementById('btn-permission');

let reelAngle     = 0;
let selectedTrack = null; // { title, file } | 'custom'

// ── Build preset track list ───────────────────────────────────────────────
function buildTrackList() {
  trackList.innerHTML = '';

  if (TRACKS.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'track-empty';
    empty.textContent = '曲が登録されていません';
    trackList.appendChild(empty);
    return;
  }

  TRACKS.forEach((track, i) => {
    const item = document.createElement('button');
    item.className   = 'track-item';
    item.dataset.idx = i;
    item.innerHTML   = `<span class="track-num">${String(i + 1).padStart(2, '0')}</span>
                        <span class="track-title">${track.title}</span>
                        <span class="track-icon">▶</span>`;
    item.addEventListener('click', () => selectTrack(track, item));
    trackList.appendChild(item);
  });
}

function selectTrack(track, el) {
  // Clear previous selection
  document.querySelectorAll('.track-item').forEach(b => b.classList.remove('selected'));
  document.getElementById('custom-track-btn').classList.remove('selected');

  el.classList.add('selected');
  selectedTrack = track;
  fileInput.value = '';
  statusText.textContent = `♪ ${track.title}`;
}

// ── Custom MP3 button ─────────────────────────────────────────────────────
document.getElementById('custom-track-btn').addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Clear preset selection
  document.querySelectorAll('.track-item').forEach(b => b.classList.remove('selected'));
  document.getElementById('custom-track-btn').classList.add('selected');

  statusText.textContent = 'Loading...';
  await loadFile(file);
  selectedTrack = 'custom';
  statusText.textContent = `♪ ${file.name}`;
});

// ── Load preset track via fetch ───────────────────────────────────────────
async function loadPresetTrack(track) {
  statusText.textContent = `読み込み中... ${track.title}`;
  const res = await fetch(track.file);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const ctx = getContext();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  loadBuffer(audioBuffer);
}

// ── Visuals ───────────────────────────────────────────────────────────────
function updateVisuals(rate) {
  const pct = (rate / 2.0) * 100;
  vuFill.style.width = `${pct}%`;
  vuFill.style.background =
    rate < 0.3 ? '#8B4513' :
    rate < 1.0 ? '#C8860A' :
    rate < 1.6 ? '#E8A020' : '#FF4500';

  rateDisplay.textContent = rate.toFixed(2) + 'x';

  const rpm = rate * 180;
  reelAngle += rpm / 60;
  reelLeft.style.transform  = `rotate(${reelAngle}deg)`;
  reelRight.style.transform = `rotate(${reelAngle}deg)`;

  const sag = rate < 0.3 ? Math.max(0, 1 - rate / 0.3) : 0;
  tapeSag.style.opacity   = sag;
  tapeSag.style.transform = `scaleY(${1 + sag * 0.4})`;

  statusText.textContent =
    rate < 0.05 ? '■ STOPPED' :
    rate < 0.6  ? '▶ SLOW' :
    rate < 1.4  ? '▶▶ PLAY' : '▶▶▶ FAST';
}

function onRate(rate) {
  setPlaybackRate(rate);
  updateVisuals(rate);
}

// ── Start ─────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  if (!selectedTrack) {
    statusText.textContent = '曲を選んでください';
    return;
  }

  btnStart.disabled = true;

  try {
    if (selectedTrack !== 'custom') {
      await loadPresetTrack(selectedTrack);
    }
    if (!hasBuffer()) {
      statusText.textContent = '曲の読み込みに失敗しました';
      btnStart.disabled = false;
      return;
    }
    play();
  } catch (err) {
    console.error(err);
    statusText.textContent = `読み込みエラー: ${err.message}`;
    btnStart.disabled = false;
    return;
  }

  btnStop.disabled = false;

  const { ok, reason } = await requestPermission();
  if (!ok) {
    statusText.textContent = `センサー非対応: スライダーで操作`;
  }
  startMotion(onRate);
});

// ── Stop ──────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  stopMotion();
  stop();
  btnStart.disabled = false;
  btnStop.disabled  = true;
  updateVisuals(0);
});

// ── Desktop sim slider ────────────────────────────────────────────────────
if (simSlider) {
  simSlider.addEventListener('input', () => {
    simulateRate(parseFloat(simSlider.value));
  });
}

// ── iOS permission ────────────────────────────────────────────────────────
if (permBtn) {
  permBtn.addEventListener('click', async () => {
    const { ok, reason } = await requestPermission();
    permBtn.textContent = ok ? 'センサー許可済み ✓' : `失敗: ${reason}`;
    permBtn.disabled = ok;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
buildTrackList();
