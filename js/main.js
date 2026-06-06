import { requestSensorPermission, startMotion, stopMotion } from './motion.js';
import { loadFile, loadBuffer, play, stop, setPlaybackRate, hasBuffer, getContext, getGainNode, getBuffer } from './audio.js';
import { loadSoundTouch, PitchFixedPlayer } from './pitch-player.js';
import { TRACKS } from './tracks.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const btnPlayStop       = document.getElementById('btn-playstop');
const btnRew            = document.getElementById('btn-rew');
const btnFf             = document.getElementById('btn-ff');
const btnSetTape        = document.getElementById('btn-set-tape');
const btnSetSingle      = document.getElementById('btn-set-single');
const singleFileInput   = document.getElementById('single-file-input');
const tapeFileInput     = document.getElementById('tape-file-input');
const vuFill            = document.getElementById('vu-fill');
const rateDisplay       = document.getElementById('rate-display');
const reelLeft          = document.getElementById('reel-left');
const reelRight         = document.getElementById('reel-right');
const lockToggle        = document.getElementById('lock-toggle');
const lockLabelL        = document.getElementById('lock-label-l');
const lockLabelR        = document.getElementById('lock-label-r');

// Settings modal
const btnSettings         = document.getElementById('btn-settings');
const settingsModal       = document.getElementById('settings-modal');
const settingsOverlay     = document.getElementById('settings-overlay');
const settingsClose       = document.getElementById('settings-close');
const sPitchToggle        = document.getElementById('s-pitch-toggle');
const sPitchLabelL        = document.getElementById('s-pitch-label-l');
const sPitchLabelR        = document.getElementById('s-pitch-label-r');
const sPitchDesc          = document.getElementById('s-pitch-desc');
const sMotionToggle       = document.getElementById('s-motion-toggle');
const sMotionLabelL       = document.getElementById('s-motion-label-l');
const sMotionLabelR       = document.getElementById('s-motion-label-r');
const sMotionDesc         = document.getElementById('s-motion-desc');
const speedCorrectionSlider = document.getElementById('speed-correction');
const speedCorrectionVal  = document.getElementById('speed-correction-val');
const modeStatusText      = document.getElementById('mode-status-text');
const nowPlayingText    = document.getElementById('now-playing-text');
const tapeNameWrap      = document.getElementById('tape-name-wrap');
const tapeNameText      = document.getElementById('tape-name-text');

// Tape modal
const tapeModal         = document.getElementById('tape-modal');
const tapeModalOverlay  = document.getElementById('tape-modal-overlay');
const tapeModalClose    = document.getElementById('tape-modal-close');
const tapeModalBack     = document.getElementById('tape-modal-back');
const tapeModalTitle    = document.getElementById('tape-modal-title');
const tapeViewList      = document.getElementById('tape-view-list');
const tapeViewTracks    = document.getElementById('tape-view-tracks');
const tapeViewNew       = document.getElementById('tape-view-new');
const tapeListContainer = document.getElementById('tape-list-container');
const tapeTrackList     = document.getElementById('tape-track-list');
const tapeSetBtn        = document.getElementById('tape-set-btn');
const newTapeNameInput  = document.getElementById('new-tape-name');
const newTapeTrackList  = document.getElementById('new-tape-track-list');
const newTapeAddPreset  = document.getElementById('new-tape-add-preset');
const newTapeAddLocal   = document.getElementById('new-tape-add-local');
const newTapeSave       = document.getElementById('new-tape-save');

// Preset picker modal
const presetPickerModal   = document.getElementById('preset-picker-modal');
const presetPickerOverlay = document.getElementById('preset-picker-overlay');
const presetPickerClose   = document.getElementById('preset-picker-close');
const presetPickerList    = document.getElementById('preset-picker-list');
const trackAddFromDevice  = document.getElementById('track-add-from-device');

// Tape modal extra controls
const tapeModalShuffle = document.getElementById('tape-modal-shuffle');

// Loading indicator
const loadingIndicator = document.getElementById('loading-indicator');
const loadingStageEl   = document.getElementById('loading-stage');
const loadingStepEl    = document.getElementById('loading-step');
const loadingFill      = document.getElementById('loading-fill');

// Validate overlay
const validateOverlay = document.getElementById('validate-overlay');
const validateMsgEl   = document.getElementById('validate-msg');

// ── ARCHIVE tape (built-in, all preset tracks) ────────────────────────────────
const ARCHIVE_TAPE = {
  id: '__archive__',
  name: 'Archive',
  isBuiltin: true,
  tracks: TRACKS.map(t => ({ type: 'preset', title: t.title, file: t.file })),
};

// ── User tape persistence ─────────────────────────────────────────────────────
function getUserTapes() {
  try { return JSON.parse(localStorage.getItem('cassette-tapes') || '[]'); }
  catch { return []; }
}
function saveUserTapes(tapes) {
  localStorage.setItem('cassette-tapes', JSON.stringify(tapes));
}

// ── Session-only blobs for local tracks ───────────────────────────────────────
const localBlobs = new Map();
let blobIdSeq = Date.now();
function nextBlobId() { return `lb_${blobIdSeq++}`; }

// ── Audio validation limits ───────────────────────────────────────────────────
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB

function showValidating(name) {
  validateMsgEl.textContent = `検証中: ${name}`;
  validateOverlay.style.display = 'flex';
}
function hideValidating() {
  validateOverlay.style.display = 'none';
}

async function validateAndDecodeAudio(file) {
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(0);
    return { ok: false, error: `ファイルサイズが大きすぎます（${mb} MB）。上限は 200 MB です。` };
  }
  let arrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: 'ファイルの読み込みに失敗しました。' };
  }
  let audioBuf;
  try {
    audioBuf = await getContext().decodeAudioData(arrayBuffer);
  } catch {
    return { ok: false, error: '再生できない形式です（MP3, AAC, WAV 等をお試しください）。' };
  }
  return { ok: true, audioBuffer: audioBuf };
}

// ── App state ─────────────────────────────────────────────────────────────────
let currentTape     = null;
let currentTrackIdx = 0;
let isPlaying        = false;
let pitchFixed       = true;
let pitchPlayer      = null;
let motionMode       = 'gps';
let speedCorrection  = 1.0;
let sensorPermAsked  = false;
let reelAngle        = 0;

// State for new-tape builder
let editingTape     = null;

// Tape currently being previewed in the track sub-view
let viewingTape        = null;
let selectedTrackIdx   = 0;

// Draft state for non-builtin tape track editing
let draftTracks  = null;
let draftShuffle = false;
let pickerMode   = 'new-tape'; // 'new-tape' | 'add-track'
let shuffleEnabled = false;
let dragAbort    = null;

const noSleep = typeof NoSleep !== 'undefined' ? new NoSleep() : null;

// ── Loading indicator ─────────────────────────────────────────────────────────
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

// ── Marquee ───────────────────────────────────────────────────────────────────
function setNowPlaying(title) {
  if (!title) {
    nowPlayingText.textContent = '';
    nowPlayingText.classList.remove('scrolling');
    return;
  }
  nowPlayingText.textContent = title;
  nowPlayingText.classList.remove('scrolling');
  requestAnimationFrame(() => {
    const wrap = nowPlayingText.parentElement;
    if (nowPlayingText.scrollWidth > wrap.clientWidth) {
      nowPlayingText.classList.add('scrolling');
    }
  });
}

// ── Tape name display in cassette ─────────────────────────────────────────────
function setTapeName(tape) {
  if (!tape || tape.isSingle) {
    tapeNameWrap.style.display = 'none';
    tapeNameText.textContent = '';
    tapeNameText.classList.remove('scrolling');
    return;
  }
  tapeNameWrap.style.display = '';
  tapeNameText.textContent = tape.name;
  tapeNameText.classList.remove('scrolling');
  requestAnimationFrame(() => {
    if (tapeNameText.scrollWidth > tapeNameWrap.clientWidth) {
      tapeNameText.classList.add('scrolling');
    }
  });
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
}

function onRate(rawRate) {
  const rate = rawRate * speedCorrection;
  if (pitchFixed && pitchPlayer) {
    pitchPlayer.setTempo(rate);
    const g = getGainNode();
    if (g) g.gain.setTargetAtTime(rate < 0.05 ? 0 : 1.0, getContext().currentTime, 0.05);
  } else {
    setPlaybackRate(rate);
  }
  updateVisuals(rate);
}

// ── Stop all audio ────────────────────────────────────────────────────────────
function stopAll() {
  stop();
  if (pitchPlayer) { pitchPlayer.stop(); pitchPlayer = null; }
  const g = getGainNode(), c = getContext();
  if (g && c) { g.gain.cancelScheduledValues(c.currentTime); g.gain.setValueAtTime(1.0, c.currentTime); }
}

// ── Set current tape ──────────────────────────────────────────────────────────
function setCurrentTape(tape, startIdx = 0) {
  if (isPlaying) {
    stopAll(); stopMotion();
    setPlayingState(false); updateVisuals(0);
    noSleep?.disable();
  }
  currentTape     = tape;
  currentTrackIdx = Math.max(0, Math.min(startIdx, tape.tracks.length - 1));
  shuffleEnabled  = tape.shuffle || false;
  setTapeName(tape);
  if (tape.tracks.length > 0) setNowPlaying(tape.tracks[currentTrackIdx].title);
}

// ── Load the current track into the audio engine ──────────────────────────────
async function loadCurrentTrack() {
  if (!currentTape || currentTape.tracks.length === 0) return false;
  const track = currentTape.tracks[currentTrackIdx];
  if (!track) return false;

  if (track.type === 'preset') {
    const res = await fetch(track.file);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = await getContext().decodeAudioData(await res.arrayBuffer());
    loadBuffer(buf);
  } else if (track.type === 'local') {
    const blob = localBlobs.get(track.id);
    if (blob) {
      if (blob.audioBuffer) {
        loadBuffer(blob.audioBuffer);
      } else {
        await loadFile(blob.file);
      }
    } else if (track.objectUrl) {
      const res = await fetch(track.objectUrl);
      const buf = await getContext().decodeAudioData(await res.arrayBuffer());
      loadBuffer(buf);
    } else {
      return false;
    }
  }
  return true;
}

// ── Playback ──────────────────────────────────────────────────────────────────
function setPlayingState(playing) {
  isPlaying = playing;
  btnPlayStop.textContent = playing ? '■ STOP' : '▶ PLAY';
  btnPlayStop.classList.toggle('is-playing', playing);
}

async function startPlayback() {
  if (!currentTape || currentTape.tracks.length === 0) return;
  btnPlayStop.disabled = true;

  const ctx = getContext();
  if (ctx.state === 'suspended') await ctx.resume();

  stopAll();

  try {
    const ok = await loadCurrentTrack();
    if (!ok || !hasBuffer()) { btnPlayStop.disabled = false; return; }

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
    btnPlayStop.disabled = false;
    return;
  }

  btnPlayStop.disabled = false;
  setPlayingState(true);
  noSleep?.enable();
  startMotion(onRate, motionMode);
}

btnPlayStop.addEventListener('click', async () => {
  if (isPlaying) {
    stopMotion(); stopAll(); showLoading(null);
    setPlayingState(false); updateVisuals(0);
    noSleep?.disable();
    return;
  }
  if (!currentTape) return;
  await startPlayback();
});

// ── REW / FF ──────────────────────────────────────────────────────────────────
async function changeTrack(delta) {
  if (!currentTape || currentTape.tracks.length === 0) return;
  const wasPlaying = isPlaying;
  if (isPlaying) {
    stopAll(); stopMotion(); setPlayingState(false); updateVisuals(0);
    noSleep?.disable();
  }
  if (shuffleEnabled && currentTape.tracks.length > 1) {
    let newIdx;
    do { newIdx = Math.floor(Math.random() * currentTape.tracks.length); }
    while (newIdx === currentTrackIdx);
    currentTrackIdx = newIdx;
  } else {
    currentTrackIdx = (currentTrackIdx + delta + currentTape.tracks.length) % currentTape.tracks.length;
  }
  setNowPlaying(currentTape.tracks[currentTrackIdx].title);
  if (wasPlaying) await startPlayback();
}

btnRew.addEventListener('click', () => changeTrack(-1));
btnFf.addEventListener('click',  () => changeTrack(+1));

// ── SET SINGLE ────────────────────────────────────────────────────────────────
btnSetSingle.addEventListener('click', () => singleFileInput.click());

singleFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  singleFileInput.value = '';
  showValidating(file.name);
  const result = await validateAndDecodeAudio(file);
  hideValidating();
  if (!result.ok) { alert(result.error); return; }
  const id  = nextBlobId();
  const objectUrl = URL.createObjectURL(file);
  localBlobs.set(id, { file, objectUrl, audioBuffer: result.audioBuffer });
  const name = file.name.replace(/\.[^.]+$/, '');
  setCurrentTape({
    id: `single_${Date.now()}`,
    name: `SINGLE: ${name}`,
    isSingle: true,
    tracks: [{ type: 'local', id, title: name, objectUrl }],
  });
});

// ── Tape modal ────────────────────────────────────────────────────────────────
function openTapeModal() {
  showTapeView('list');
  tapeModal.style.display = 'flex';
}
function closeTapeModal() {
  tapeModal.style.display = 'none';
  blurActiveInput();
}

function showTapeView(view) {
  blurActiveInput(); // ビュー切替時に入力フォーカスを解除
  tapeViewList.style.display   = view === 'list'   ? 'flex' : 'none';
  tapeViewTracks.style.display = view === 'tracks' ? 'flex' : 'none';
  tapeViewNew.style.display    = view === 'new'    ? 'flex' : 'none';
  tapeModalBack.style.display  = view !== 'list'   ? '' : 'none';

  const isEditableTracks = view === 'tracks' && viewingTape && !viewingTape.isBuiltin;
  tapeModalClose.style.display   = isEditableTracks ? 'none' : '';
  tapeModalShuffle.style.display = isEditableTracks ? '' : 'none';

  if (view === 'list') {
    tapeModalTitle.textContent = 'SELECT TAPE';
    buildTapeList();
  }
  if (view === 'tracks') {
    selectedTrackIdx = 0;
    tapeModalTitle.textContent = viewingTape?.name || '';
    if (!viewingTape.isBuiltin) {
      draftTracks  = viewingTape.tracks.map(t => ({ ...t }));
      draftShuffle = viewingTape.shuffle || false;
      updateShuffleBtn();
    }
    buildTapeTrackView();
  }
  if (view === 'new') {
    tapeModalTitle.textContent = 'NEW TAPE';
    buildNewTapeView();
  }
}

function updateShuffleBtn() {
  tapeModalShuffle.classList.toggle('is-active', draftShuffle);
}

tapeModalShuffle.addEventListener('click', () => {
  draftShuffle = !draftShuffle;
  updateShuffleBtn();
});

btnSetTape.addEventListener('click', openTapeModal);
tapeModalClose.addEventListener('click', closeTapeModal);
tapeModalOverlay.addEventListener('click', closeTapeModal);
tapeModalBack.addEventListener('click', () => showTapeView('list'));

tapeSetBtn.addEventListener('click', () => {
  if (!viewingTape) return;

  if (!viewingTape.isBuiltin && draftTracks !== null) {
    const userTapes = getUserTapes();
    const idx = userTapes.findIndex(t => t.id === viewingTape.id);
    if (idx !== -1) {
      userTapes[idx].tracks  = draftTracks;
      userTapes[idx].shuffle = draftShuffle;
      saveUserTapes(userTapes);
      viewingTape = userTapes[idx];
    }
  } else if (!viewingTape.isBuiltin) {
    const saved = getUserTapes().find(t => t.id === viewingTape.id);
    if (saved) viewingTape = saved;
  }

  const clampedIdx = Math.max(0, Math.min(selectedTrackIdx, (viewingTape.tracks?.length || 1) - 1));
  setCurrentTape(viewingTape, clampedIdx);
  closeTapeModal();
});

// ─ Build tape list ────────────────────────────────────────────────────────────
function buildTapeList() {
  tapeListContainer.innerHTML = '';

  const allTapes = [ARCHIVE_TAPE, ...getUserTapes()];
  allTapes.forEach(tape => {
    const item = document.createElement('div');
    item.className = 'tape-list-item';

    const content = document.createElement('div');
    content.className = 'tape-list-content';
    content.innerHTML = `
      <div class="tape-list-info">
        <div class="tape-list-name">${escHtml(tape.name)}</div>
        <div class="tape-list-meta">${tape.tracks.length} TRACKS</div>
      </div>
      ${tape.isBuiltin ? '<span class="tape-list-builtin-badge">DEFAULT</span>' : ''}
      <span class="tape-list-arrow">▶</span>
    `;
    content.addEventListener('click', () => {
      viewingTape = tape;
      showTapeView('tracks');
    });

    item.appendChild(content);

    if (!tape.isBuiltin) {
      const delBtn = document.createElement('button');
      delBtn.className = 'tape-swipe-delete';
      delBtn.textContent = 'DELETE';
      delBtn.addEventListener('click', () => {
        const tapes = getUserTapes().filter(t => t.id !== tape.id);
        saveUserTapes(tapes);
        buildTapeList();
      });
      item.appendChild(delBtn);
      addSwipeBehavior(item, content, delBtn);
    }

    tapeListContainer.appendChild(item);
  });

  // New Tape button
  const newBtn = document.createElement('button');
  newBtn.className = 'tape-new-btn';
  newBtn.textContent = '＋  New Tape';
  newBtn.addEventListener('click', () => {
    editingTape = { name: '', tracks: [] };
    showTapeView('new');
  });
  tapeListContainer.appendChild(newBtn);
}

// ─ Swipe-to-reveal delete ─────────────────────────────────────────────────────
function addSwipeBehavior(wrapper, content, delBtn) {
  const REVEAL_W = 70;
  let startX = 0, startY = 0, dx = 0, revealed = false;

  function snapTo(open, animate) {
    if (animate) content.style.transition = 'transform 0.2s ease';
    content.style.transform = open ? `translateX(-${REVEAL_W}px)` : 'translateX(0)';
    delBtn.style.opacity = open ? '1' : '0';
    delBtn.style.pointerEvents = open ? 'auto' : 'none';
    revealed = open;
    if (animate) setTimeout(() => { content.style.transition = ''; }, 220);
  }

  wrapper.addEventListener('touchstart', (e) => {
    if (e.target.closest('.track-drag-handle')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    content.style.transition = '';
  }, { passive: true });

  wrapper.addEventListener('touchmove', (e) => {
    dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) < Math.abs(dy)) return;
    const base = revealed ? -REVEAL_W : 0;
    const clamped = Math.max(base + dx, -REVEAL_W);
    if (clamped <= 0) {
      content.style.transform = `translateX(${clamped}px)`;
      delBtn.style.opacity = String(Math.min(-clamped / REVEAL_W, 1));
    }
  }, { passive: true });

  wrapper.addEventListener('touchend', () => {
    const open = dx < -REVEAL_W * 0.4 || (revealed && dx < REVEAL_W * 0.4);
    snapTo(open, true);
  });
}

// ─ Track list view for selected tape ─────────────────────────────────────────
function buildTapeTrackView() {
  tapeTrackList.innerHTML = '';
  if (dragAbort) { dragAbort.abort(); dragAbort = null; }

  const isEditable = !viewingTape.isBuiltin;
  const tracks = isEditable && draftTracks ? draftTracks : viewingTape.tracks;

  if (tracks.length === 0) {
    const el = document.createElement('div');
    el.className = 'track-empty';
    el.textContent = 'このテープには曲がありません';
    tapeTrackList.appendChild(el);
  } else {
    tracks.forEach((track, i) => {
      if (isEditable) {
        const wrapper = document.createElement('div');
        wrapper.className = 'track-list-item';

        const content = document.createElement('div');
        content.className = 'track-item' + (i === selectedTrackIdx ? ' selected' : '');
        content.dataset.idx = String(i);
        content.style.cursor = 'pointer';

        const num = document.createElement('span');
        num.className = 'track-num';
        num.textContent = String(i + 1).padStart(2, '0');

        const title = document.createElement('span');
        title.className = 'track-title';
        title.textContent = track.title;

        const handle = document.createElement('span');
        handle.className = 'track-drag-handle';
        handle.textContent = '≡';

        content.addEventListener('click', (e) => {
          if (e.target.closest('.track-drag-handle')) return;
          selectedTrackIdx = i;
          tapeTrackList.querySelectorAll('.track-item').forEach((el, j) => {
            el.classList.toggle('selected', j === i);
          });
        });

        content.appendChild(num);
        content.appendChild(title);
        content.appendChild(handle);

        const delBtn = document.createElement('button');
        delBtn.className = 'tape-swipe-delete';
        delBtn.textContent = 'DELETE';
        delBtn.addEventListener('click', () => {
          draftTracks.splice(i, 1);
          if (selectedTrackIdx >= draftTracks.length) selectedTrackIdx = Math.max(0, draftTracks.length - 1);
          buildTapeTrackView();
        });

        wrapper.appendChild(content);
        wrapper.appendChild(delBtn);
        addSwipeBehavior(wrapper, content, delBtn);
        tapeTrackList.appendChild(wrapper);
      } else {
        const item = document.createElement('div');
        item.className = 'track-item' + (i === selectedTrackIdx ? ' selected' : '');
        item.dataset.idx = String(i);
        item.style.cursor = 'pointer';

        const num = document.createElement('span');
        num.className = 'track-num';
        num.textContent = String(i + 1).padStart(2, '0');

        const title = document.createElement('span');
        title.className = 'track-title';
        title.textContent = track.title;

        item.addEventListener('click', () => {
          selectedTrackIdx = i;
          tapeTrackList.querySelectorAll('.track-item').forEach((el, j) => {
            el.classList.toggle('selected', j === i);
          });
        });

        item.appendChild(num);
        item.appendChild(title);
        tapeTrackList.appendChild(item);
      }
    });
  }

  if (isEditable) {
    const newBtn = document.createElement('button');
    newBtn.className = 'track-new-btn';
    newBtn.textContent = '＋  New Track';
    newBtn.addEventListener('click', () => {
      pickerMode = 'add-track';
      openPresetPicker();
    });
    tapeTrackList.appendChild(newBtn);

    if (draftTracks && draftTracks.length > 1) {
      enableTrackDrag(tapeTrackList, draftTracks);
    }
  }
}

// ─ New tape view ──────────────────────────────────────────────────────────────
function buildNewTapeView() {
  newTapeNameInput.value = editingTape.name || '';
  renderNewTapeTrackList();
}

function renderNewTapeTrackList() {
  newTapeTrackList.innerHTML = '';
  if (editingTape.tracks.length === 0) {
    const el = document.createElement('div');
    el.className = 'track-empty';
    el.textContent = 'まだ曲が追加されていません';
    newTapeTrackList.appendChild(el);
    return;
  }
  editingTape.tracks.forEach((track, i) => {
    const item = document.createElement('div');
    item.className = 'track-item new-tape-track-item';

    const num = document.createElement('span');
    num.className = 'track-num';
    num.textContent = String(i + 1).padStart(2, '0');

    const title = document.createElement('span');
    title.className = 'track-title';
    title.textContent = track.title;

    const del = document.createElement('button');
    del.className = 'track-del-btn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      editingTape.tracks.splice(i, 1);
      renderNewTapeTrackList();
    });

    item.appendChild(num);
    item.appendChild(title);
    item.appendChild(del);
    newTapeTrackList.appendChild(item);
  });
}

// ─ Drag-to-reorder for track list ────────────────────────────────────────────
function enableTrackDrag(listEl, tracks) {
  if (dragAbort) dragAbort.abort();
  dragAbort = new AbortController();
  const signal = dragAbort.signal;

  let dragEl = null, dragIdx = -1, overIdx = -1, startY = 0;

  function getWrappers() {
    return Array.from(listEl.querySelectorAll('.track-list-item'));
  }

  const onStart = (e) => {
    if (!e.target.closest('.track-drag-handle')) return;
    e.preventDefault();
    const wrappers = getWrappers();
    dragEl = e.target.closest('.track-list-item');
    if (!dragEl) return;
    dragIdx = wrappers.indexOf(dragEl);
    overIdx = dragIdx;
    startY  = e.touches[0].clientY;
    dragEl.classList.add('track-dragging');
  };

  const onMove = (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const dy = e.touches[0].clientY - startY;
    dragEl.style.transform = `translateY(${dy}px)`;

    const wrappers = getWrappers();
    const { top, bottom, height } = dragEl.getBoundingClientRect();
    const center = top + height / 2;
    let newOver = dragIdx;
    wrappers.forEach((el, i) => {
      if (el === dragEl) return;
      const r = el.getBoundingClientRect();
      if (center > r.top && center < r.bottom) newOver = i;
    });

    if (newOver !== overIdx) {
      overIdx = newOver;
      const itemH = dragEl.offsetHeight + 6;
      wrappers.forEach((el, i) => {
        if (el === dragEl) return;
        el.style.transition = 'transform 0.15s';
        if      (dragIdx < overIdx && i > dragIdx && i <= overIdx) el.style.transform = `translateY(-${itemH}px)`;
        else if (dragIdx > overIdx && i >= overIdx && i < dragIdx) el.style.transform = `translateY(${itemH}px)`;
        else el.style.transform = '';
      });
    }
  };

  const onEnd = () => {
    if (!dragEl) return;
    const finalIdx = overIdx;
    dragEl.classList.remove('track-dragging');
    dragEl.style.transform = '';

    if (finalIdx !== dragIdx) {
      const [removed] = tracks.splice(dragIdx, 1);
      tracks.splice(finalIdx, 0, removed);
      if      (selectedTrackIdx === dragIdx) selectedTrackIdx = finalIdx;
      else if (dragIdx < finalIdx && selectedTrackIdx > dragIdx  && selectedTrackIdx <= finalIdx) selectedTrackIdx--;
      else if (dragIdx > finalIdx && selectedTrackIdx >= finalIdx && selectedTrackIdx < dragIdx)  selectedTrackIdx++;
      buildTapeTrackView();
    } else {
      getWrappers().forEach(el => { el.style.transform = ''; el.style.transition = ''; });
    }
    dragEl = null; dragIdx = -1; overIdx = -1;
  };

  listEl.addEventListener('touchstart', onStart,  { passive: false, signal });
  listEl.addEventListener('touchmove',  onMove,   { passive: false, signal });
  listEl.addEventListener('touchend',   onEnd,    { signal });
  listEl.addEventListener('touchcancel',onEnd,    { signal });
}

// ─ Preset picker ──────────────────────────────────────────────────────────────
function openPresetPicker() {
  presetPickerList.innerHTML = '';
  TRACKS.forEach((track, i) => {
    const item = document.createElement('button');
    item.className = 'track-item';
    item.innerHTML = `<span class="track-num">${String(i + 1).padStart(2, '0')}</span>
                      <span class="track-title">${escHtml(track.title)}</span>
                      <span class="track-icon">＋</span>`;
    item.addEventListener('click', () => {
      const t = { type: 'preset', title: track.title, file: track.file };
      if (pickerMode === 'add-track') {
        draftTracks.push(t);
        buildTapeTrackView();
      } else {
        editingTape.tracks.push(t);
        renderNewTapeTrackList();
      }
      presetPickerModal.style.display = 'none';
    });
    presetPickerList.appendChild(item);
  });
  presetPickerModal.style.display = 'flex';
}

newTapeAddPreset.addEventListener('click', () => { pickerMode = 'new-tape'; openPresetPicker(); });
presetPickerClose.addEventListener('click',   () => { presetPickerModal.style.display = 'none'; });
presetPickerOverlay.addEventListener('click', () => { presetPickerModal.style.display = 'none'; });

trackAddFromDevice.addEventListener('click', () => {
  presetPickerModal.style.display = 'none';
  tapeFileInput.click();
});

// ─ Add local files to new tape / existing tape ───────────────────────────────
newTapeAddLocal.addEventListener('click', () => { pickerMode = 'new-tape'; tapeFileInput.click(); });

tapeFileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  tapeFileInput.value = '';
  const errors = [];
  for (const file of files) {
    showValidating(file.name);
    const result = await validateAndDecodeAudio(file);
    if (!result.ok) { errors.push(`${file.name}: ${result.error}`); continue; }
    const id = nextBlobId();
    const objectUrl = URL.createObjectURL(file);
    localBlobs.set(id, { file, objectUrl, audioBuffer: result.audioBuffer });
    const name = file.name.replace(/\.[^.]+$/, '');
    const t = { type: 'local', id, title: name, objectUrl };
    if (pickerMode === 'add-track') { draftTracks.push(t); }
    else { editingTape.tracks.push(t); }
  }
  hideValidating();
  if (errors.length > 0) alert(errors.join('\n'));
  if (pickerMode === 'add-track') { buildTapeTrackView(); }
  else { renderNewTapeTrackList(); }
});

// ─ Save new tape ──────────────────────────────────────────────────────────────
newTapeSave.addEventListener('click', () => {
  const name = newTapeNameInput.value.trim();
  if (!name) { alert('テープ名を入力してください。'); return; }
  if (editingTape.tracks.length === 0) { alert('曲を1曲以上追加してください。'); return; }
  const tape = {
    id:       `tape_${Date.now()}`,
    name,
    isBuiltin: false,
    tracks:   editingTape.tracks,
  };
  const tapes = getUserTapes();
  tapes.push(tape);
  saveUserTapes(tapes);
  editingTape = null;
  showTapeView('list');
});

// ── Settings persistence ──────────────────────────────────────────────────────
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('cassette-settings') || '{}');
    pitchFixed      = s.pitchFixed      !== false;
    motionMode      = s.motionMode      === 'sensor' ? 'sensor' : 'gps';
    speedCorrection = typeof s.speedCorrection === 'number' ? s.speedCorrection : 1.0;
  } catch { /* ignore */ }
}

function saveSettings() {
  localStorage.setItem('cassette-settings', JSON.stringify({ pitchFixed, motionMode, speedCorrection }));
}

// ── Mode status bar ───────────────────────────────────────────────────────────
function updateModeStatusBar() {
  const motionLabel = motionMode === 'sensor' ? 'センサー' : 'GPS計測';
  const pitchLabel  = pitchFixed ? 'ピッチ固定' : 'ピッチ変化';
  const corrLabel   = Math.abs(speedCorrection - 1.0) >= 0.005 ? ` ｜ ${speedCorrection.toFixed(2)}x` : '';
  modeStatusText.textContent = `${motionLabel} ｜ ${pitchLabel}${corrLabel}`;
}

// ── Settings modal ────────────────────────────────────────────────────────────
function updatePitchDesc() {
  sPitchDesc.textContent = pitchFixed
    ? 'ピッチを一定に保ち、テンポのみ変化します'
    : '速度変化に合わせてピッチも上下します';
}

function updateMotionDesc() {
  sMotionDesc.textContent = motionMode === 'sensor'
    ? '端末センサーで速度を推測します（室内・トレッドミル対応）'
    : '位置情報から速度を算出します（屋外推奨）';
}

function updateSpeedCorrectionDisplay() {
  speedCorrectionVal.textContent = speedCorrection.toFixed(2) + 'x';
}

function applySettingsToUI() {
  sPitchToggle.checked = pitchFixed;
  sPitchLabelL.classList.toggle('active', !pitchFixed);
  sPitchLabelR.classList.toggle('active',  pitchFixed);
  updatePitchDesc();

  sMotionToggle.checked = (motionMode === 'sensor');
  sMotionLabelL.classList.toggle('active', motionMode !== 'sensor');
  sMotionLabelR.classList.toggle('active', motionMode === 'sensor');
  updateMotionDesc();

  speedCorrectionSlider.value = Math.round(speedCorrection * 100);
  updateSpeedCorrectionDisplay();
}

function openSettingsModal() {
  applySettingsToUI();
  settingsModal.style.display = 'flex';
}

function closeSettingsModal() {
  settingsModal.style.display = 'none';
}

btnSettings.addEventListener('click', openSettingsModal);
settingsClose.addEventListener('click', closeSettingsModal);
settingsOverlay.addEventListener('click', closeSettingsModal);

sPitchLabelL.addEventListener('click', () => {
  if (sPitchToggle.checked) { sPitchToggle.checked = false; sPitchToggle.dispatchEvent(new Event('change')); }
});
sPitchLabelR.addEventListener('click', () => {
  if (!sPitchToggle.checked) { sPitchToggle.checked = true; sPitchToggle.dispatchEvent(new Event('change')); }
});
sMotionLabelL.addEventListener('click', () => {
  if (sMotionToggle.checked) { sMotionToggle.checked = false; sMotionToggle.dispatchEvent(new Event('change')); }
});
sMotionLabelR.addEventListener('click', () => {
  if (!sMotionToggle.checked) { sMotionToggle.checked = true; sMotionToggle.dispatchEvent(new Event('change')); }
});

sPitchToggle.addEventListener('change', () => {
  pitchFixed = sPitchToggle.checked;
  sPitchLabelL.classList.toggle('active', !pitchFixed);
  sPitchLabelR.classList.toggle('active',  pitchFixed);
  updatePitchDesc();
  updateModeStatusBar();
  saveSettings();
});

sMotionToggle.addEventListener('change', async () => {
  const useSensor = sMotionToggle.checked;
  motionMode = useSensor ? 'sensor' : 'gps';
  sMotionLabelL.classList.toggle('active', !useSensor);
  sMotionLabelR.classList.toggle('active',  useSensor);

  if (useSensor && !sensorPermAsked) {
    sensorPermAsked = true;
    const { ok } = await requestSensorPermission();
    if (!ok) {
      sMotionToggle.checked = false;
      motionMode = 'gps';
      sMotionLabelL.classList.add('active');
      sMotionLabelR.classList.remove('active');
    }
  }

  updateMotionDesc();
  updateModeStatusBar();
  saveSettings();
});

speedCorrectionSlider.addEventListener('input', () => {
  speedCorrection = speedCorrectionSlider.value / 100;
  updateSpeedCorrectionDisplay();
  updateModeStatusBar();
  saveSettings();
});

// ── Toggles ───────────────────────────────────────────────────────────────────
lockToggle.addEventListener('change', () => {
  const locked = lockToggle.checked;
  lockLabelL.classList.toggle('active', !locked);
  lockLabelR.classList.toggle('active', locked);
  [btnPlayStop, btnRew, btnFf, btnSetTape, btnSetSingle, btnSettings]
    .forEach(el => { el.disabled = locked; });
});

// ── iOS scroll lock ───────────────────────────────────────────────────────────
document.addEventListener('touchmove', (e) => {
  if (e.target.closest('.modal-track-list')) return;
  if (e.target.closest('.settings-body')) return;
  e.preventDefault();
}, { passive: false });

// ── Visibility change ─────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isPlaying) getContext()?.resume();
});

// ── iOS Shake-to-Undo 防止 ────────────────────────────────────────────────────
// テキスト入力の Undo スタックをリセットする
function clearUndoHistory(el) {
  if (!el || !('value' in el)) return;
  const v = el.value;
  el.value = '';
  el.value = v;
}

// アクティブな入力要素をブラーしてフォーカスを解除する
function blurActiveInput() {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    clearUndoHistory(el);
    el.blur();
  }
}

// タッチ開始時、入力フィールド外ならブラー
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('input[type="text"], input[type="search"], textarea')) return;
  blurActiveInput();
}, { passive: true });

// テープ名入力: ブラー時に Undo 履歴をクリア
newTapeNameInput.addEventListener('blur', () => clearUndoHistory(newTapeNameInput));

// execCommand('undo') を無効化（シェイク確定後のフォールバック）
try {
  const _exec = document.execCommand.bind(document);
  document.execCommand = (cmd, showUI, val) => {
    if (typeof cmd === 'string' && cmd.toLowerCase() === 'undo') return false;
    return _exec(cmd, showUI, val);
  };
} catch (_) { /* 非対応ブラウザは無視 */ }

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
applySettingsToUI();
updateModeStatusBar();
setTapeName(null);
setNowPlaying(null);
