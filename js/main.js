import { requestPermission, startMotion, stopMotion, simulateRate, isUsingGPS } from './motion.js';
import { loadFile, loadBuffer, play, stop, setPlaybackRate, hasBuffer, getContext, getGainNode, getBuffer } from './audio.js';
import { loadSoundTouch, PitchFixedPlayer } from './pitch-player.js';
import { TRACKS } from './tracks.js';

// --- DOM refs ---
const btnPlayStop    = document.getElementById('btn-playstop');
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
let pitchFixed    = false;
let pitchPlayer   = null;
let isPlaying     = false;

// NoSleep.js — 画面スリープ防止（START時に有効化）
const noSleep = typeof NoSleep !== 'undefined' ? new NoSleep() : null;

// ── Loading indicator ────────────────────────────────────────────────────────
const loadingIndicator = document.getElementById('loading-indicator');
const loadingStageEl   = document.getElementById('loading-stage');
const loadingStepEl    = document.getElementById('loading-step');
const loadingFill      = document.getElementById('loading-fill');

const STAGES = [
  { label: 'SoundTouch 読み込み中...',  pct: 33  }, // ① CDN DL
  { label: 'バッファ準備中...',          pct: 66  }, // ② SoundTouch init
  { label: '再生開始 ✓',               pct: 100 }, // ③ 初回音声出力
];

function showLoading(stepIdx) {
  // stepIdx: 0〜2 → 各ステージ表示 / null → 非表示
  if (stepIdx === null) {
    loadingIndicator.style.display = 'none';
    loadingFill.classList.remove('pulse');
    return;
  }
  const s = STAGES[stepIdx];
  loadingIndicator.style.display = 'block';
  loadingStageEl.textContent = s.label;
  loadingStepEl.textContent  = `${stepIdx + 1} / ${STAGES.length}`;
  loadingFill.style.width    = `${s.pct}%`;

  // ③（再生開始）以外は測定不能 → 点滅アニメーション
  if (stepIdx < STAGES.length - 1) {
    loadingFill.classList.add('pulse');
  } else {
    loadingFill.classList.remove('pulse');
    // 1秒後に自動で閉じる
    setTimeout(() => showLoading(null), 1000);
  }
}

// ── Toggle switch ────────────────────────────────────────────────────────────
pitchToggle.addEventListener('change', () => {
  pitchFixed = pitchToggle.checked;
  toggleLabelL.classList.toggle('active', !pitchFixed);
  toggleLabelR.classList.toggle('active',  pitchFixed);
});

// ── 全音源を確実に停止（モード問わず両方止める）────────────────────────────
function stopAll() {
  // カセットモードの AudioBufferSourceNode を停止
  stop();
  // ピッチ固定モードの ScriptProcessorNode を停止
  if (pitchPlayer) {
    pitchPlayer.stop();
    pitchPlayer = null;
  }
  // gain を必ず 1.0 に戻す（0 のまま次の再生が始まるのを防ぐ）
  const g = getGainNode();
  const c = getContext();
  if (g && c) g.gain.cancelScheduledValues(c.currentTime);
  if (g && c) g.gain.setValueAtTime(1.0, c.currentTime);
}

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

  const src = isUsingGPS() ? '📡' : '📳';
  statusText.textContent =
    rate < 0.05 ? `${src} STOPPED` :
    rate < 0.6  ? `${src} SLOW` :
    rate < 1.4  ? `${src} PLAY` : `${src} FAST`;
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

// ── START / STOP 統合ボタン ───────────────────────────────────────────────────
function setPlayingState(playing) {
  isPlaying = playing;
  btnPlayStop.textContent = playing ? '■ STOP' : '▶ START';
  btnPlayStop.classList.toggle('is-playing', playing);
}

btnPlayStop.addEventListener('click', async () => {
  // ── STOP ──
  if (isPlaying) {
    stopMotion();
    stopAll();
    showLoading(null);
    setPlayingState(false);
    updateVisuals(0);
    noSleep?.disable(); // 画面スリープ防止を解除
    return;
  }

  // ── START ──
  if (!selectedTrack) {
    statusText.textContent = '曲を選んでください';
    return;
  }

  btnPlayStop.disabled = true;
  stopAll();

  try {
    if (selectedTrack !== 'custom') {
      await loadPresetTrack(selectedTrack);
    }
    if (!hasBuffer()) {
      statusText.textContent = '曲の読み込みに失敗しました';
      btnPlayStop.disabled = false;
      return;
    }

    if (pitchFixed) {
      showLoading(0);
      await loadSoundTouch();
      showLoading(1);
      const ctx  = getContext();
      const gain = getGainNode();
      const buf  = getBuffer();
      if (ctx.state === 'suspended') ctx.resume();
      pitchPlayer = new PitchFixedPlayer(ctx, buf, gain);
      pitchPlayer.onFirstAudio = () => showLoading(2);
      pitchPlayer.start();
    } else {
      play();
    }

  } catch (err) {
    console.error(err);
    statusText.textContent = `エラー: ${err.message}`;
    btnPlayStop.disabled = false;
    return;
  }

  btnPlayStop.disabled = false;
  setPlayingState(true);
  noSleep?.enable(); // 画面スリープ防止を有効化（ユーザー操作内で呼ぶ必要あり）

  const { ok } = await requestPermission();
  if (!ok) statusText.textContent = 'センサー非対応: スライダーで操作';
  startMotion(onRate);
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

// ── 画面復帰時に AudioContext を再開 ──────────────────────────────────────────
// 電源ボタン等で一時的にバックグラウンドになった場合のフォールバック
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isPlaying) {
    getContext()?.resume();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
buildTrackList();
toggleLabelL.classList.add('active'); // 初期: カセットモード
