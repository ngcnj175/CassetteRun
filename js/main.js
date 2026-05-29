import { requestPermission, startMotion, stopMotion, simulateRate } from './motion.js';
import { loadFile, loadBuffer, play, stop, setPlaybackRate, hasBuffer } from './audio.js';
import { loadMagenta, generateSequence, renderToBuffer, isReady } from './magenta.js';

// --- DOM refs ---
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const fileInput   = document.getElementById('file-input');
const vuFill      = document.getElementById('vu-fill');
const rateDisplay = document.getElementById('rate-display');
const statusText  = document.getElementById('status-text');
const reelLeft    = document.getElementById('reel-left');
const reelRight   = document.getElementById('reel-right');
const tapeSag     = document.getElementById('tape-sag');
const simSlider   = document.getElementById('sim-slider');
const permBtn     = document.getElementById('btn-permission');
const mp3Row      = document.getElementById('mp3-row');
const magentaRow  = document.getElementById('magenta-row');

let reelAngle = 0;

// ── Mode toggle UI ───────────────────────────────────────────────────────────
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isMagenta = radio.value === 'magenta';
    mp3Row.style.display     = isMagenta ? 'none'  : 'flex';
    magentaRow.style.display = isMagenta ? 'flex'  : 'none';
  });
});

// ── Visuals ──────────────────────────────────────────────────────────────────
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

// ── Start ────────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;

  if (mode === 'mp3') {
    if (!hasBuffer()) {
      statusText.textContent = 'MP3を選択してください';
      return;
    }
    play();

  } else {
    // ── Magenta mode ──
    btnStart.disabled = true;

    try {
      // 1. Load model (no-op if already loaded)
      if (!isReady()) {
        await loadMagenta(msg => { statusText.textContent = msg; });
      }

      // 2. Generate sequence
      statusText.textContent = 'メロディーを生成中...';
      const seq = await generateSequence(64, 1.05);

      // 3. Render to AudioBuffer
      statusText.textContent = 'レンダリング中...';
      const audioBuf = await renderToBuffer(seq, 120);
      loadBuffer(audioBuf);

      // 4. Play
      play();
      statusText.textContent = '🤖 AI BGM 再生中';

    } catch (err) {
      console.error(err);
      statusText.textContent = `エラー: ${err.message}`;
      btnStart.disabled = false;
      return;
    }
  }

  // Common: start sensor + update UI
  btnStart.disabled = true;
  btnStop.disabled  = false;

  const { ok, reason } = await requestPermission();
  if (!ok) {
    statusText.textContent = `センサー非対応: スライダーで操作 (${reason})`;
  }
  startMotion(onRate);
});

// ── Stop ─────────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  stopMotion();
  stop();
  btnStart.disabled = false;
  btnStop.disabled  = true;
  statusText.textContent = '■ STOPPED';
  updateVisuals(0);
});

// ── MP3 load ─────────────────────────────────────────────────────────────────
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  statusText.textContent = 'Loading...';
  await loadFile(file);
  statusText.textContent = `Loaded: ${file.name}`;
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
