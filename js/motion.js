/**
 * motion.js — 速度検出モジュール
 *
 * モード:
 *   'gps'    — Geolocation API で実移動速度 (m/s) を取得（デフォルト）
 *   'sensor' — DeviceMotion 加速度センサーで揺れ強度を取得
 *
 * startMotion(callback, mode) で明示的に切り替える。
 */

// ── GPS 設定 ───────────────────────────────────────────────────────────────
const GPS_SPEED_MIN    = 0.5;   // m/s 以下は停止扱い
const GPS_SPEED_NORMAL = 3.0;   // m/s → 1.0x（約 5:30/km ペース）
const GPS_SPEED_MAX    = 6.0;   // m/s → 2.0x 上限

// ── センサー設定 ────────────────────────────────────────────────────────────
const SMOOTHING_WINDOW = 30;
const ACCEL_MIN        = 0.5;
const ACCEL_MAX        = 18.0;

// ── イージング ────────────────────────────────────────────────────────────
const EASE_FACTOR = 0.04;

// ── 状態 ─────────────────────────────────────────────────────────────────
let currentRate  = 0.0;
let targetRate   = 0.0;
let onRateChange = null;
let animFrameId  = null;
let watchId      = null;
let accelSamples = [];
let currentMode  = 'gps'; // 現在のモード

export function getMotionMode() { return currentMode; }

// ── GPS ──────────────────────────────────────────────────────────────────
function speedToRate(speedMps) {
  if (speedMps == null || speedMps < GPS_SPEED_MIN) return 0.0;
  return Math.min(speedMps / GPS_SPEED_NORMAL, 2.0);
}
function handlePosition(pos) {
  targetRate = speedToRate(pos.coords.speed);
}
function handleGPSError(err) {
  console.warn(`GPS エラー: ${err.message}`);
  targetRate = 0;
}

// ── センサー ─────────────────────────────────────────────────────────────
function magnitude(a) {
  return Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
}
function handleMotion(e) {
  const accel = e.acceleration || e.accelerationIncludingGravity;
  if (!accel) return;
  accelSamples.push(magnitude(accel));
  if (accelSamples.length > SMOOTHING_WINDOW) accelSamples.shift();
  const avg = accelSamples.reduce((a, b) => a + b, 0) / accelSamples.length;
  targetRate = avg < ACCEL_MIN ? 0.0
    : Math.min((avg - ACCEL_MIN) / (ACCEL_MAX - ACCEL_MIN) * 2.0, 2.0);
}

// ── イージング tick ───────────────────────────────────────────────────────
function tick() {
  currentRate += (targetRate - currentRate) * EASE_FACTOR;
  if (Math.abs(currentRate - targetRate) < 0.001) currentRate = targetRate;
  if (onRateChange) onRateChange(currentRate);
  animFrameId = requestAnimationFrame(tick);
}

// ── センサー許可（iOS 用） ────────────────────────────────────────────────
export async function requestSensorPermission() {
  if (typeof DeviceMotionEvent === 'undefined') {
    return { ok: false, reason: 'DeviceMotionEvent not supported' };
  }
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return { ok: false, reason: 'Permission denied' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  return { ok: true };
}

// 後方互換
export async function requestPermission() {
  return requestSensorPermission();
}

// ── 開始 ─────────────────────────────────────────────────────────────────
export function startMotion(rateCallback, mode = 'gps') {
  currentMode  = mode;
  onRateChange = rateCallback;
  accelSamples = [];
  targetRate   = 0.0;

  if (mode === 'gps') {
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        handlePosition, handleGPSError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }
  } else {
    window.addEventListener('devicemotion', handleMotion, { passive: true });
  }

  animFrameId = requestAnimationFrame(tick);
}

// ── 停止 ─────────────────────────────────────────────────────────────────
export function stopMotion() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  window.removeEventListener('devicemotion', handleMotion);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId  = null;
  accelSamples = [];
  targetRate   = 0.0;
}

// ── デスクトップ テスト用 ─────────────────────────────────────────────────
export function simulateRate(rate) {
  targetRate = Math.max(0, Math.min(2.0, rate));
}
