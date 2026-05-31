import { requestSensorPermission, startMotion, stopMotion, simulateRate, getMotionMode } from './motion.js';
import { loadFile, loadBuffer, play, stop, setPlaybackRate, hasBuffer, getContext, getGainNode, getBuffer } from './audio.js';
import { loadSoundTouch, PitchFixedPlayer } from './pitch-player.js';
import { TRACKS } from './tracks.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const btnPlayStop       = document.getElementById('btn-playstop');
const fileInput         = document.getElementById('file-input');
const trackList         = document.getElementById('track-list');
const vuFill            = document.getElementById('vu-fill');
const rateDisplay       = document.getElementById('rate-display');
const statusText        = document.getElementById('status-text');
const reelLeft          = document.getElementById('reel-left');
const reelRight         = document.getElementById('reel-right');
const tapeSag           = document.getElementById('tape-sag');
const simSlider         = document.getElementById('sim-slider');
const pitchToggle       = document.getElementById('pitch-toggle');
const toggleLabelL      = document.getElementById('toggle-label-l');
const toggleLabelR      = document.getElementById('toggle-label-r');
const motionToggle      = document.getElementById('motion-toggle');
const motionLabelL      = document.getElementById('motion-label-l');
const motionLabelR      = document.getElementById('motion-label-r');
const trackSelectBtn    = document.getElementById('track-select-btn');
const selectedTrackName = document.getElementById('selected-track-name');
const trackModal        = document.getElementById('track-modal');
const modalOverlay      = document.getElementById('modal-overlay');
const modalClose        = document.getElementById('modal-close');
const nowPlayingText    = document.getElementById('now-playing-text');

// ── State ─────────────────────────────────────────────────────────────────────
let reelAngle        = 0;
let selectedTrack    = null;
let pitchFixed       = false;
let pitchPlayer      = null;
let isPlaying        = false;
let motionMode       = 'gps';    // 'gps' | 'sensor'
let sensorPermAsked  = false;    // センサー許可ダイアログ表示済みか

const noSleep = typeof NoSleep !== 'undefined' ? new NoSleep() : null;

// ── Loading indicator ─────────────────────────────────────────────────────────
const loadingIndicator = document.getElementById('loading-indicator');
const loadingStageEl   = document.getElementById('loading-stage');
const loadingStepEl    = document.getElementById('loading-step');
const loadingFill      = document.getElementById('loading-fill');

const STAGES = [
  { label: 'SoundTouch 読み込み中...', pct: 33  },
  { label: 'バッファ準備中...',         pct: 66  },
  { label: '再生開始 ✓',              pct: 100 },
];

function showLoading(stepIdx) {
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
  if (stepIdx < STAGES.length - 1) {
    loadingFill.classList.add('pulse');
  } else {
    loadingFill.classList.remove('pulse');
    setTimeout(() => showLoading(null), 1000);
  }
}

// ── マーキー制御 ──────────────────────────────────────────────────────────────
function setNowPlaying(title) {
  nowPlayingText.textContent = title;
  // コンテナより長い場合だけ流れるアニメーション
  nowPlayingText.classList.remove('scrolling');
  requestAnimationFrame(() => {
    const wrap = nowPlayingText.parentElement;
    if (nowPlayingText.scrollWidth > wrap.clientWidth) {
      nowPlayingText.classList.add('scrolling');
    }
  });
}

// ── Pitch toggle ──────────────────────────────────────────────────────────────
pitchToggle.addEventListener('change', () => {
  pitchFixed = pitchToggle.checked;
  toggleLabelL.classList.toggle('active', !pitchFixed);
  toggleLabelR.classList.toggle('active',  pitchFixed);
});

// ── Motion mode toggle ────────────────────────────────────────────────────────
motionToggle.addEventListener('change', async () => {
  const useSensor = motionToggle.checked;
  motionMode = useSensor ? 'sensor' : 'gps';
  motionLabelL.classList.toggle('active', !useSensor);
  motionLabelR.classList.toggle('active',  useSensor);

  // センサーモードへの初回切替時のみ許可ダイアログを表示
  if (useSensor && !sensorPermAsked) {
    sensorPermAsked = true;
    const { ok, reason } = await requestSensorPermission();
    if (!ok) {
      // 許可されなかった場合は GPS に戻す
      motionToggle.checked = false;
      motionMode = 'gps';
      motionLabelL.classList.add('active');
      motionLabelR.classList.remove('active');
      statusText.textContent = `センサー許可が必要です: ${reason}`;
    }
  }
});

// ── iOS ドラッグ・スクロール防止 ──────────────────────────────────────────────
document.addEventListener('touchmove', (e) => {
  // モーダルのトラックリスト内は縦スクロールを許可
  if (e.target.closest('.modal-track-list')) return;
  e.preventDefault();
}, { passive: false });

// ── 全音源停止 ────────────────────────────────────────────────────────────────
function stopAll() {
  stop();
  if (pitchPlayer) { pitchPlayer.stop(); pitchPlayer = null; }
  const g = getGainNode(), c = getContext();
  if (g && c) { g.gain.cancelScheduledValues(c.currentTime); g.gain.setValueAtTime(1.0, c.currentTime); }
}

// ── Track list modal ──────────────────────────────────────────────────────────
function openModal()  { trackModal.style.display = 'flex'; }
function closeModal() { trackModal.style.display = 'none'; }

trackSelectBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);

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
    item.addEventListener('click', () => {
      selectTrack(track, item);
      closeModal();
    });
    trackList.appendChild(item);
  });
}

function selectTrack(track, el) {
  document.querySelectorAll('.track-item').forEach(b => b.classList.remove('selected'));
  document.getElementById('custom-track-btn').classList.remove('selected');
  el.classList.add('selected');
  selectedTrack = track;
  fileInput.value = '';
  // ボタンに曲名を反映
  selectedTrackName.textContent = track.title;
  trackSelectBtn.classList.add('selected');
  setNowPlaying(track.title);
}

// ── Custom MP3 ────────────────────────────────────────────────────────────────
document.getElementById('custom-track-btn').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.querySelectorAll('.track-item').forEach(b => b.classList.remove('selected'));
  document.getElementById('custom-track-btn').classList.add('selected');
  trackSelectBtn.classList.remove('selected');
  selectedTrackName.textContent = '未選択';
  statusText.textContent = 'Loading...';
  await loadFile(file);
  selectedTrack = 'custom';
  const name = file.name.replace(/\.[^.]+$/, '');
  setNowPlaying(name);
  statusText.textContent = `♪ ${name}`;
});

// ── Load preset track ─────────────────────────────────────────────────────────
async function loadPresetTrack(track) {
  statusText.textContent = `読み込み中...`;
  const res = await fetch(track.file);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const buf = await getContext().decodeAudioData(await res.arrayBuffer());
  loadBuffer(buf);
}

// ── Visuals ───────────────────────────────────────────────────────────────────
function updateVisuals(rate) {
  vuFill.style.width = `${(rate / 2.0) * 100}%`;
  vuFill.style.background =
    rate < 0.3 ? '#4a6a8a' : rate < 1.0 ? '#6a8aaa' : rate < 1.6 ? '#90a8c0' : '#c0392b';

  rateDisplay.textContent = rate.toFixed(2) + 'x';

  reelAngle += (rate * 180) / 60;
  reelLeft.style.transform  = `rotate(${reelAngle}deg)`;
  reelRight.style.transform = `rotate(${reelAngle}deg)`;

  const sag = rate < 0.3 ? Math.max(0, 1 - rate / 0.3) : 0;
  tapeSag.style.opacity   = sag;
  tapeSag.style.transform = `scaleY(${1 + sag * 0.4})`;

  const src = getMotionMode() === 'gps' ? '📡' : '📳';
  statusText.textContent =
    rate < 0.05 ? `${src} STOPPED` :
    rate < 0.6  ? `${src} SLOW`    :
    rate < 1.4  ? `${src} PLAY`    : `${src} FAST`;
}

// ── Rate handler ──────────────────────────────────────────────────────────────
function onRate(rate) {
  if (pitchFixed && pitchPlayer) {
    pitchPlayer.setTempo(rate);
    const g = getGainNode();
    if (g) g.gain.setTargetAtTime(rate < 0.05 ? 0 : 1.0, getContext().currentTime, 0.05);
  } else {
    setPlaybackRate(rate);
  }
  updateVisuals(rate);
}

// ── START / STOP ──────────────────────────────────────────────────────────────
function setPlayingState(playing) {
  isPlaying = playing;
  btnPlayStop.textContent = playing ? '■ STOP' : '▶ START';
  btnPlayStop.classList.toggle('is-playing', playing);
}

btnPlayStop.addEventListener('click', async () => {
  // ── STOP ──
  if (isPlaying) {
    stopMotion(); stopAll(); showLoading(null);
    setPlayingState(false); updateVisuals(0);
    noSleep?.disable();
    return;
  }

  // ── START ──
  if (!selectedTrack) { statusText.textContent = '曲を選んでください'; return; }

  btnPlayStop.disabled = true;

  // iOS: AudioContext を async の前に必ず resume（ユーザージェスチャー内で実行）
  const ctx = getContext();
  if (ctx.state === 'suspended') await ctx.resume();

  stopAll();

  try {
    if (selectedTrack !== 'custom') await loadPresetTrack(selectedTrack);
    if (!hasBuffer()) {
      statusText.textContent = '読み込み失敗';
      btnPlayStop.disabled = false;
      return;
    }

    if (pitchFixed) {
      showLoading(0);
      await loadSoundTouch();
      showLoading(1);
      const gain = getGainNode();
      const buf  = getBuffer();
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
  noSleep?.enable();

  startMotion(onRate, motionMode);
});

// ── Sim slider ────────────────────────────────────────────────────────────────
simSlider?.addEventListener('input', () => simulateRate(parseFloat(simSlider.value)));

// ── 画面復帰時 AudioContext 再開 ──────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isPlaying) getContext()?.resume();
});

// ── Init ──────────────────────────────────────────────────────────────────────
buildTrackList();
toggleLabelL.classList.add('active');
