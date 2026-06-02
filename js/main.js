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
const pitchToggle       = document.getElementById('pitch-toggle');
const toggleLabelL      = document.getElementById('toggle-label-l');
const toggleLabelR      = document.getElementById('toggle-label-r');
const motionToggle      = document.getElementById('motion-toggle');
const motionLabelL      = document.getElementById('motion-label-l');
const motionLabelR      = document.getElementById('motion-label-r');
const lockToggle        = document.getElementById('lock-toggle');
const lockLabelL        = document.getElementById('lock-label-l');
const lockLabelR        = document.getElementById('lock-label-r');
const nowPlayingText    = document.getElementById('now-playing-text');
const tapeStatusName    = document.getElementById('tape-status-name');

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

// Loading indicator
const loadingIndicator = document.getElementById('loading-indicator');
const loadingStageEl   = document.getElementById('loading-stage');
const loadingStepEl    = document.getElementById('loading-step');
const loadingFill      = document.getElementById('loading-fill');

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

// ── App state ─────────────────────────────────────────────────────────────────
let currentTape     = null;
let currentTrackIdx = 0;
let isPlaying       = false;
let pitchFixed      = false;
let pitchPlayer     = null;
let motionMode      = 'gps';
let sensorPermAsked = false;
let reelAngle       = 0;

// State for new-tape builder
let editingTape     = null;

// Tape currently being previewed in the track sub-view
let viewingTape        = null;
let selectedTrackIdx   = 0;

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
  nowPlayingText.textContent = title;
  nowPlayingText.classList.remove('scrolling');
  requestAnimationFrame(() => {
    const wrap = nowPlayingText.parentElement;
    if (nowPlayingText.scrollWidth > wrap.clientWidth) {
      nowPlayingText.classList.add('scrolling');
    }
  });
}

// ── Status display ────────────────────────────────────────────────────────────
function updateStatusDisplay() {
  if (!currentTape) { tapeStatusName.textContent = '— NO TAPE —'; return; }
  const track = currentTape.tracks[currentTrackIdx];
  const trackInfo = track ? ` [${currentTrackIdx + 1}/${currentTape.tracks.length}]` : '';
  tapeStatusName.textContent = currentTape.name + trackInfo;
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
  updateStatusDisplay();
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
      await loadFile(blob.file);
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
  currentTrackIdx = (currentTrackIdx + delta + currentTape.tracks.length) % currentTape.tracks.length;
  setNowPlaying(currentTape.tracks[currentTrackIdx].title);
  updateStatusDisplay();
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
  const id  = nextBlobId();
  const objectUrl = URL.createObjectURL(file);
  localBlobs.set(id, { file, objectUrl });
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
}

function showTapeView(view) {
  tapeViewList.style.display   = view === 'list'   ? 'flex' : 'none';
  tapeViewTracks.style.display = view === 'tracks' ? 'flex' : 'none';
  tapeViewNew.style.display    = view === 'new'    ? 'flex' : 'none';
  tapeModalBack.style.display  = view !== 'list'   ? '' : 'none';

  if (view === 'list')   { tapeModalTitle.textContent = 'SELECT TAPE';  buildTapeList(); }
  if (view === 'tracks') { selectedTrackIdx = 0; tapeModalTitle.textContent = viewingTape?.name || ''; buildTapeTrackView(); }
  if (view === 'new')    { tapeModalTitle.textContent = 'NEW TAPE';     buildNewTapeView(); }
}

btnSetTape.addEventListener('click', openTapeModal);
tapeModalClose.addEventListener('click', closeTapeModal);
tapeModalOverlay.addEventListener('click', closeTapeModal);
tapeModalBack.addEventListener('click', () => showTapeView('list'));

tapeSetBtn.addEventListener('click', () => {
  if (!viewingTape) return;

  // For user tapes, re-fetch from localStorage to get latest (after track edits)
  if (!viewingTape.isBuiltin) {
    const saved = getUserTapes().find(t => t.id === viewingTape.id);
    if (saved) viewingTape = saved;
  }

  setCurrentTape(viewingTape, selectedTrackIdx);
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
  if (!viewingTape || viewingTape.tracks.length === 0) {
    const el = document.createElement('div');
    el.className = 'track-empty';
    el.textContent = 'このテープには曲がありません';
    tapeTrackList.appendChild(el);
    return;
  }

  viewingTape.tracks.forEach((track, i) => {
    const item = document.createElement('div');
    item.className = 'track-item' + (i === selectedTrackIdx ? ' selected' : '');
    item.style.cursor = 'pointer';

    const num = document.createElement('span');
    num.className = 'track-num';
    num.textContent = String(i + 1).padStart(2, '0');

    const title = document.createElement('span');
    title.className = 'track-title';
    title.textContent = track.title;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.track-del-btn')) return;
      selectedTrackIdx = i;
      tapeTrackList.querySelectorAll('.track-item').forEach((el, j) => {
        el.classList.toggle('selected', j === i);
      });
    });

    item.appendChild(num);
    item.appendChild(title);

    // User tapes: allow track deletion
    if (!viewingTape.isBuiltin) {
      const delBtn = document.createElement('button');
      delBtn.className = 'track-del-btn';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        viewingTape.tracks.splice(i, 1);
        if (selectedTrackIdx >= viewingTape.tracks.length) selectedTrackIdx = Math.max(0, viewingTape.tracks.length - 1);
        const userTapes = getUserTapes();
        const idx = userTapes.findIndex(t => t.id === viewingTape.id);
        if (idx !== -1) { userTapes[idx].tracks = viewingTape.tracks; saveUserTapes(userTapes); }
        buildTapeTrackView();
      });
      item.appendChild(delBtn);
    }

    tapeTrackList.appendChild(item);
  });
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
      editingTape.tracks.push({ type: 'preset', title: track.title, file: track.file });
      renderNewTapeTrackList();
      presetPickerModal.style.display = 'none';
    });
    presetPickerList.appendChild(item);
  });
  presetPickerModal.style.display = 'flex';
}

newTapeAddPreset.addEventListener('click', openPresetPicker);
presetPickerClose.addEventListener('click',   () => { presetPickerModal.style.display = 'none'; });
presetPickerOverlay.addEventListener('click', () => { presetPickerModal.style.display = 'none'; });

// ─ Add local files to new tape ────────────────────────────────────────────────
newTapeAddLocal.addEventListener('click', () => tapeFileInput.click());

tapeFileInput.addEventListener('change', (e) => {
  Array.from(e.target.files).forEach(file => {
    const id  = nextBlobId();
    const objectUrl = URL.createObjectURL(file);
    localBlobs.set(id, { file, objectUrl });
    const name = file.name.replace(/\.[^.]+$/, '');
    editingTape.tracks.push({ type: 'local', id, title: name, objectUrl });
  });
  tapeFileInput.value = '';
  renderNewTapeTrackList();
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

// ── Toggles ───────────────────────────────────────────────────────────────────
pitchToggle.addEventListener('change', () => {
  pitchFixed = pitchToggle.checked;
  toggleLabelL.classList.toggle('active', !pitchFixed);
  toggleLabelR.classList.toggle('active',  pitchFixed);
});

lockToggle.addEventListener('change', () => {
  const locked = lockToggle.checked;
  lockLabelL.classList.toggle('active', !locked);
  lockLabelR.classList.toggle('active', locked);
  [btnPlayStop, btnRew, btnFf, btnSetTape, btnSetSingle, pitchToggle, motionToggle]
    .forEach(el => { el.disabled = locked; });
});

motionToggle.addEventListener('change', async () => {
  const useSensor = motionToggle.checked;
  motionMode = useSensor ? 'sensor' : 'gps';
  motionLabelL.classList.toggle('active', !useSensor);
  motionLabelR.classList.toggle('active',  useSensor);

  if (useSensor && !sensorPermAsked) {
    sensorPermAsked = true;
    const { ok } = await requestSensorPermission();
    if (!ok) {
      motionToggle.checked = false;
      motionMode = 'gps';
      motionLabelL.classList.add('active');
      motionLabelR.classList.remove('active');
    }
  }
});

// ── iOS scroll lock ───────────────────────────────────────────────────────────
document.addEventListener('touchmove', (e) => {
  if (e.target.closest('.modal-track-list')) return;
  e.preventDefault();
}, { passive: false });

// ── Visibility change ─────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isPlaying) getContext()?.resume();
});

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
toggleLabelL.classList.add('active');
updateStatusDisplay();
