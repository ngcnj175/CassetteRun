// Web Audio API playback engine

let ctx = null;
let sourceNode = null;
let gainNode = null;
let buffer = null;
let currentRate = 0.0;

function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
  }
  return ctx;
}

export async function loadFile(file) {
  const context = ensureContext();
  const arrayBuffer = await file.arrayBuffer();
  buffer = await context.decodeAudioData(arrayBuffer);
}

export function loadBuffer(audioBuffer) {
  ensureContext();
  buffer = audioBuffer;
}

function createSource() {
  if (sourceNode) {
    sourceNode.onended = null;
    try { sourceNode.stop(); } catch (_) {}
    sourceNode.disconnect();
  }
  sourceNode = ctx.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.loop = true;
  sourceNode.playbackRate.value = Math.max(0.001, currentRate);
  sourceNode.connect(gainNode);
  return sourceNode;
}

export function play() {
  if (!buffer) return;
  ensureContext();
  if (ctx.state === 'suspended') ctx.resume();
  const src = createSource();
  src.start(0);
}

export function stop() {
  if (sourceNode) {
    sourceNode.onended = null;
    try { sourceNode.stop(); } catch (_) {}
    sourceNode = null;
  }
}

export function setPlaybackRate(rate) {
  currentRate = rate;
  if (!sourceNode) return;

  if (rate < 0.05) {
    // Effectively paused — mute and drop rate to near-zero
    gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    sourceNode.playbackRate.setTargetAtTime(0.001, ctx.currentTime, 0.1);
  } else {
    gainNode.gain.setTargetAtTime(1.0, ctx.currentTime, 0.05);
    const capped = Math.min(rate, 2.0);
    sourceNode.playbackRate.setTargetAtTime(capped, ctx.currentTime, 0.05);
  }
}

export function hasBuffer() {
  return buffer !== null;
}

export function getContext() {
  return ensureContext();
}

export function getGainNode() {
  ensureContext();
  return gainNode;
}

export function getBuffer() {
  return buffer;
}
