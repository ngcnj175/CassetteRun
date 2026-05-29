// Accelerometer -> normalized playbackRate (0.0 - 2.0)

const SMOOTHING_WINDOW = 20;       // samples for moving average
const ACCEL_MIN = 0.5;             // below this -> nearly stopped
const ACCEL_MAX = 18.0;            // above this -> full speed (adjustable)
const EASE_FACTOR = 0.08;          // easing coefficient (lower = smoother)

let samples = [];
let currentRate = 0.0;
let targetRate = 0.0;
let onRateChange = null;
let animFrameId = null;
let permissionGranted = false;

function magnitude(accel) {
  const x = accel.x || 0;
  const y = accel.y || 0;
  const z = accel.z || 0;
  return Math.sqrt(x * x + y * y + z * z);
}

function movingAverage(value) {
  samples.push(value);
  if (samples.length > SMOOTHING_WINDOW) samples.shift();
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function normalize(avg) {
  if (avg < ACCEL_MIN) return 0.0;
  const clamped = Math.min(avg, ACCEL_MAX);
  return ((clamped - ACCEL_MIN) / (ACCEL_MAX - ACCEL_MIN)) * 2.0;
}

function tick() {
  // Ease currentRate toward targetRate
  currentRate += (targetRate - currentRate) * EASE_FACTOR;
  if (Math.abs(currentRate - targetRate) < 0.001) currentRate = targetRate;
  if (onRateChange) onRateChange(currentRate);
  animFrameId = requestAnimationFrame(tick);
}

function handleMotion(event) {
  const accel = event.acceleration || event.accelerationIncludingGravity;
  if (!accel) return;
  const mag = magnitude(accel);
  const avg = movingAverage(mag);
  targetRate = normalize(avg);
}

export async function requestPermission() {
  if (typeof DeviceMotionEvent === 'undefined') {
    return { ok: false, reason: 'DeviceMotionEvent not supported' };
  }
  // iOS 13+ requires explicit permission
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== 'granted') return { ok: false, reason: 'Permission denied' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  permissionGranted = true;
  return { ok: true };
}

export function startMotion(rateCallback) {
  onRateChange = rateCallback;
  window.addEventListener('devicemotion', handleMotion, { passive: true });
  animFrameId = requestAnimationFrame(tick);
}

export function stopMotion() {
  window.removeEventListener('devicemotion', handleMotion);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = null;
}

// For desktop testing: simulate motion with keyboard/slider
export function simulateRate(rate) {
  targetRate = Math.max(0, Math.min(2.0, rate));
}

export function getConfig() {
  return { ACCEL_MIN, ACCEL_MAX, EASE_FACTOR, SMOOTHING_WINDOW };
}

export function setConfig(key, value) {
  if (key === 'ACCEL_MIN') samples = []; // reset on sensitivity change
  // Dynamic update via module-level reassignment not possible for const,
  // so expose a mutable config object instead
}
