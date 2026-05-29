import { requestPermission, startMotion, stopMotion, simulateRate } from './motion.js';
import { loadFile, loadBuffer, play, stop, setPlaybackRate, hasBuffer, getContext, getGainNode, getBuffer } from './audio.js';
import { loadSoundTouch, PitchFixedPlayer } from './pitch-player.js';
import { TRACKS } from './tracks.js';

// --- DOM refs ---
const btnStart       = document.getElementById('btn-start');
const btnStop        = document.getElementById('btn-stop');
const fileInput      = document.getElementById('file-input');
const trackList      = document.getElementById('track-list');
const vuFill         = document.getElementById('vu-fill');
const rateDisplay    = document.getElementById('rate-display');
const statusText     = document.getElementById('status-text');
const reelLeft       = document.getElementById('reel-left');
const reelRight      = document.getElementById('reel-right');
const tapeSag        = document.getElementById('tape-sag');
const simSlider      = document.getElementById('sim-slider');
const permBtn        = document.getElementById('btn-permission');
const pitchToggle    = document.getElementById('pitch-toggle');
const toggleLabelL   = document.getElementById('toggle-label-l');
const toggleLabelR   = document.getElementById('toggle-label-r');

let reelAngle     = 0;
let selectedTrack = null;
let pitchFixed    = false;     // false = カセット / true = ピッチ固定
let pitchPlayer   = null;      // PitchFixedPlayer インスタンス

// ── Toggle switch ────────────────────────────────────────────────────────────
pitchToggle.addEventListener('change', () => {
  pitchFixed = pitchToggle.checked;
  toggleLabelL.classList.toggle('active', !pitchFixed);
  toggleLabelR.classList.toggle('active',  pitchFixed);
});

// ── Build preset track list ───────────────────────────────────────────────────
function buildTrackList() {
  trackList.innerHTML = '';
  if (TRACKS.length === 0) {
    const el = document.createElement('div');
    el.className = 'track-empty';
    el.textContent = '曲が登録されていません';
    trackList.appendChild(el);
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
  document.querySelectorAll('.track-item').forEach(b => b.classList.remove('selected'));
  document.getElementById('custom-track-btn').classList.remove('selected');
  el.classList.add('selected');
  selectedTrack = track;
  fileInput.value = '';
  statusText.textContent = `♪ ${track.title}`;
}

// ── Custom MP3 ────────────────────────────────────────────────────────────────
document.getElementById('custom-track-btn').addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.querySelectorAll('.track-item').forEach(b => b.classList.remove('selected'));
  document.getElementById('custom-track-btn').classList.add('selected');
  statusText.textContent = 'Loading...';
  await loadFile(file);
  selectedTrack = 'custom';
  statusText.textContent = `♪ ${file.name}`;
});

// ── Load preset track ─────────────────────────────────────────────────────────
async function loadPresetTrack(track) {
  statusText.textContent = `読み込み中... ${track.title}`;
  const res = await fetch(track.file);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const ab  = await res.arrayBuffer();
  const buf = await getContext().decodeAudioData(ab);
  loadBuffer(buf);
}

// ── Visuals ───────────────────────────────────────────────────────────────────
function updateVisuals(rate) {
  const pct = (rate / 2.0) * 100;
  vuFill.style.width = `${pct}%`;
  vuFill.style.background =
    rate < 0.3 ? '#8B4513' :
    rate < 1.0 ? '#C8860A' :
    rate < 1.6 ? '#E8A020' : '#FF4500';

  rateDisplay.textContent = rate.toFixed(2) + 'x';

  reelAngle += (rate * 180) / 60;
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

// ── Rate handler ──────────────────────────────────────────────────────────────
function onRate(rate) {
  if (pitchFixed && pitchPlayer) {
    // ピッチ固定モード: SoundTouch で速度だけ変える
    pitchPlayer.setTempo(rate);
    // 停止に近い場合はゲインをフェード
    const g = getGainNode();
    if (g) {
      g.gain.setTargetAtTime(
        rate < 0.05 ? 0 : 1.0,
        getContext().currentTime,
        0.05
      );
    }
  } else {
    // カセットモード: playbackRate（速度↑でピッチ↑）
    setPlaybackRate(rate);
  }
  updateVisuals(rate);
}

// ── Start ─────────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  if (!selectedTrack) {
    statusText.textContent = '曲を選んでください';
    return;
  }

  btnStart.disabled = true;

  try {
    // 1. バッファ読み込み
    if (selectedTrack !== 'custom') {
      await loadPresetTrack(selectedTrack);
    }
    if (!hasBuffer()) {
      statusText.textContent = '曲の読み込みに失敗しました';
      btnStart.disabled = false;
      return;
    }

    if (pitchFixed) {
      // 2a. ピッチ固定モード
      statusText.textContent = 'SoundTouch 読み込み中...';
      await loadSoundTouch();
      const ctx  = getContext();
      const gain = getGainNode();
      const buf  = getBuffer();
      if (ctx.state === 'suspended') ctx.resume();
      pitchPlayer = new PitchFixedPlayer(ctx, buf, gain);
      pitchPlayer.start();
    } else {
      // 2b. カセットモード
      pitchPlayer = null;
      play();
    }

  } catch (err) {
    console.error(err);
    statusText.textContent = `エラー: ${err.message}`;
    btnStart.disabled = false;
    return;
  }

  btnStop.disabled = false;

  const { ok } = await requestPermission();
  if (!ok) statusText.textContent = 'センサー非対応: スライダーで操作';
  startMotion(onRate);
});

// ── Stop ──────────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  stopMotion();
  if (pitchFixed && pitchPlayer) {
    pitchPlayer.stop();
    pitchPlayer = null;
  } else {
    stop();
  }
  btnStart.disabled = false;
  btnStop.disabled  = true;
  updateVisuals(0);
});

// ── Desktop sim slider ────────────────────────────────────────────────────────
if (simSlider) {
  simSlider.addEventListener('input', () => {
    simulateRate(parseFloat(simSlider.value));
  });
}

// ── iOS permission ────────────────────────────────────────────────────────────
if (permBtn) {
  permBtn.addEventListener('click', async () => {
    const { ok, reason } = await requestPermission();
    permBtn.textContent = ok ? 'センサー許可済み ✓' : `失敗: ${reason}`;
    permBtn.disabled = ok;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
buildTrackList();
toggleLabelL.classList.add('active'); // 初期: カセットモード
