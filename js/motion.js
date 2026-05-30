/**
 * motion.js — 速度検出モジュール
 *
 * 優先順位:
 *   1. GPS (Geolocation API) — 実移動速度 m/s → playbackRate
 *   2. 加速度センサー (DeviceMotion) — GPS 不可時の自動フォールバック
 *
 * GPS が取得できている間は加速度センサーの値を無視する。
 */

// ── GPS 設定 ───────────────────────────────────────────────────────────────
const GPS_SPEED_MIN    = 0.5;   // m/s: これ以下は停止扱い
const GPS_SPEED_NORMAL = 3.0;   // m/s: 1.0x に対応するペース（約 5:30/km）
const GPS_SPEED_MAX    = 6.0;   // m/s: 2.0x 上限（約 2:45/km）

// ── 加速度センサー設定（フォールバック用） ─────────────────────────────────
const SMOOTHING_WINDOW = 30;
const ACCEL_MIN        = 0.5;
const ACCEL_MAX        = 18.0;

// ── イージング設定 ─────────────────────────────────────────────────────────
const EASE_FACTOR = 0.04;       // 小さいほど滑らか

// ── 状態 ───────────────────────────────────────────────────────────────────
let currentRate  = 0.0;
let targetRate   = 0.0;
let onRateChange = null;
let animFrameId  = null;
let watchId      = null;        // GPS watchPosition ID
let usingGPS     = false;       // 現在 GPS で取得中かどうか
let accelSamples = [];

export function isUsingGPS() { return usingGPS; }

// ── GPS: 速度 → playbackRate ───────────────────────────────────────────────
function speedToRate(speedMps) {
  if (speedMps == null || speedMps < GPS_SPEED_MIN) return 0.0;
  return Math.min(speedMps / GPS_SPEED_NORMAL, 2.0);
}

function handlePosition(pos) {
  usingGPS = true;
  targetRate = speedToRate(pos.coords.speed);
}

function handleGPSError(err) {
  // GPS 失敗 → 加速度センサーへフォールバック
  usingGPS = false;
  console.warn(`GPS 無効 (${err.message})、加速度センサーに切替`);
}

// ── 加速度センサー: 揺れ強度 → playbackRate（フォールバック） ─────────────
function magnitude(a) {
  return Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);
}

function handleMotion(e) {
  if (usingGPS) return;           // GPS 優先
  const accel = e.acceleration || e.accelerationIncludingGravity;
  if (!accel) return;
  accelSamples.push(magnitude(accel));
  if (accelSamples.length > SMOOTHING_WINDOW) accelSamples.shift();
  const avg = accelSamples.reduce((a, b) => a + b, 0) / accelSamples.length;
  targetRate = avg < ACCEL_MIN ? 0.0
    : Math.min((avg - ACCEL_MIN) / (ACCEL_MAX - ACCEL_MIN) * 2.0, 2.0);
}

// ── イージング tick ────────────────────────────────────────────────────────
function tick() {
  currentRate += (targetRate - currentRate) * EASE_FACTOR;
  if (Math.abs(currentRate - targetRate) < 0.001) currentRate = targetRate;
  if (onRateChange) onRateChange(currentRate);
  animFrameId = requestAnimationFrame(tick);
}

// ── iOS 加速度センサー許可（フォールバック用） ─────────────────────────────
export async function requestPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return { ok: false, reason: 'Permission denied' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  return { ok: true };
}

// ── 開始 ───────────────────────────────────────────────────────────────────
export function startMotion(rateCallback) {
  onRateChange = rateCallback;

  // GPS を試みる（許可ダイアログはブラウザが自動で出す）
  if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleGPSError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
  }

  // 加速度センサーも常に登録（GPS 不可時のフォールバック）
  window.addEventListener('devicemotion', handleMotion, { passive: true });

  animFrameId = requestAnimationFrame(tick);
}

// ── 停止 ───────────────────────────────────────────────────────────────────
export function stopMotion() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  window.removeEventListener('devicemotion', handleMotion);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId  = null;
  usingGPS     = false;
  accelSamples = [];
}

// ── デスクトップ テスト用スライダー ────────────────────────────────────────
export function simulateRate(rate) {
  targetRate = Math.max(0, Math.min(2.0, rate));
}

export function getConfig() {
  return { GPS_SPEED_MIN, GPS_SPEED_NORMAL, GPS_SPEED_MAX, EASE_FACTOR };
}
