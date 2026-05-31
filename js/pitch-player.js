/**
 * pitch-player.js — SoundTouchJS によるピッチ固定タイムストレッチ再生
 *
 * 修正済みバグ:
 *  [1] ウォームアップ中に extracted=0 → extracted<BUFFER_SIZE → 毎回リセット → 永久無音
 *      → _warmingUp フラグで「ウォームアップ中はリセットしない」に変更
 *  [2] ScriptProcessorNode に入力未接続 → iOS Safari で onaudioprocess 不発火
 *      → 無音オシレーターをダミー入力として接続し確実に発火させる
 */

const SOUNDTOUCH_ESM = 'https://esm.sh/soundtouchjs@0.1.30';
const BUFFER_SIZE = 4096;

// ウォームアップ最大待機コールバック数（これを超えたら強制的に通過）
// 4096 samples / 44100 Hz ≈ 93ms/callback × 20 = 約1.9秒
const MAX_WARMUP_CALLBACKS = 20;

let libLoaded = false;
let ST = null;

// ── CDN ロード ─────────────────────────────────────────────────────────────
export async function loadSoundTouch() {
  if (libLoaded) return;
  let mod;
  try {
    mod = await import(/* @vite-ignore */ SOUNDTOUCH_ESM);
  } catch (e) {
    throw new Error(`SoundTouchJS の読み込みに失敗しました: ${e.message}`);
  }
  const SoundTouch           = mod.SoundTouch           ?? mod.default?.SoundTouch;
  const SimpleFilter         = mod.SimpleFilter         ?? mod.default?.SimpleFilter;
  const WebAudioBufferSource = mod.WebAudioBufferSource ?? mod.default?.WebAudioBufferSource;
  if (!SoundTouch || !SimpleFilter || !WebAudioBufferSource) {
    throw new Error(`SoundTouchJS: クラスが見つかりません (keys: ${Object.keys(mod).join(', ')})`);
  }
  ST = { SoundTouch, SimpleFilter, WebAudioBufferSource };
  libLoaded = true;
}

// ── PitchFixedPlayer ────────────────────────────────────────────────────────
export class PitchFixedPlayer {
  constructor(ctx, audioBuffer, outputNode) {
    this.ctx          = ctx;
    this.buffer       = audioBuffer;
    this.output       = outputNode;
    this.scriptNode   = null;
    this.st           = null;
    this.filter       = null;
    this._tempo       = 1.0;
    this.playing      = false;
    this._firstAudio  = false;
    this._warmingUp   = true;
    this._warmupCount = 0;
    this.onFirstAudio = null;
    // iOS Safari 対策: onaudioprocess を確実に発火させるダミー入力
    this._driverOsc   = null;
    this._driverGain  = null;
  }

  /** SoundTouch + SimpleFilter を完全に新規作成 */
  _newFilter() {
    const { SoundTouch, SimpleFilter, WebAudioBufferSource } = ST;
    this.st = new SoundTouch(this.ctx.sampleRate);
    this.st.pitch = 1.0;          // ピッチ固定
    this.st.tempo = this._tempo;  // 現在テンポ
    this.filter = new SimpleFilter(new WebAudioBufferSource(this.buffer), this.st);
    // 新規フィルターはウォームアップ待ち
    this._warmingUp   = true;
    this._warmupCount = 0;
  }

  start() {
    if (this.playing) this.stop();
    if (!ST) throw new Error('SoundTouch が初期化されていません');
    if (this.ctx.state !== 'running') throw new Error('AudioContext が running ではありません');

    this._newFilter();
    this._firstAudio = false;

    // ── ScriptProcessorNode（ソースとして使用） ──────────────────────────
    // 入力 1ch（ダミー）、出力 2ch（ステレオ）
    this.scriptNode = this.ctx.createScriptProcessor(BUFFER_SIZE, 1, 2);

    // iOS Safari: 入力がないと onaudioprocess が発火しないため
    // 無音オシレーター（gain=0）をダミー入力として接続
    this._driverOsc  = this.ctx.createOscillator();
    this._driverGain = this.ctx.createGain();
    this._driverGain.gain.value = 0;   // 完全無音
    this._driverOsc.connect(this._driverGain);
    this._driverGain.connect(this.scriptNode);
    this._driverOsc.start();

    this.scriptNode.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0);
      const R = e.outputBuffer.getChannelData(1);
      const interleaved = new Float32Array(BUFFER_SIZE * 2);

      const extracted = this.filter.extract(interleaved, BUFFER_SIZE);

      // ── ウォームアップ管理 ──────────────────────────────────────────────
      if (this._warmingUp) {
        this._warmupCount++;
        if (extracted > 0 || this._warmupCount >= MAX_WARMUP_CALLBACKS) {
          // ウォームアップ完了 or タイムアウト
          this._warmingUp = false;
          if (!this._firstAudio) {
            this._firstAudio = true;
            if (this.onFirstAudio) this.onFirstAudio();
          }
        }
        // ウォームアップ中は extracted<BUFFER_SIZE でもリセットしない
        // → 無音を数コールバック許容し、SoundTouch が溜まるのを待つ
      } else {
        // ── 通常再生中 ────────────────────────────────────────────────────
        // バッファ末尾に到達したらループ（クリーンリセット）
        if (extracted < BUFFER_SIZE) {
          this._newFilter(); // 新規 SoundTouch + WebAudioBufferSource
          // ループ点の短い無音は許容（次コールバックでウォームアップ完了）
        }
      }

      for (let i = 0; i < BUFFER_SIZE; i++) {
        L[i] = interleaved[i * 2];
        R[i] = interleaved[i * 2 + 1];
      }
    };

    this.scriptNode.connect(this.output);
    this.playing = true;
  }

  setTempo(rate) {
    this._tempo = Math.max(0.05, Math.min(2.0, rate));
    if (this.st) this.st.tempo = this._tempo;
  }

  stop() {
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this._driverOsc) {
      try { this._driverOsc.stop(); } catch (_) {}
      this._driverOsc.disconnect();
      this._driverOsc = null;
    }
    if (this._driverGain) {
      this._driverGain.disconnect();
      this._driverGain = null;
    }
    this.filter  = null;
    this.st      = null;
    this.playing = false;
  }
}
