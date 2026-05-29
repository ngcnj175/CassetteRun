/**
 * pitch-player.js
 * SoundTouchJS を使ったピッチ固定タイムストレッチ再生
 *
 * カセットモード : AudioBufferSourceNode.playbackRate（速度↑でピッチ↑）
 * ピッチ固定モード: SoundTouch + ScriptProcessorNode（速度が変わってもキー固定）
 */

// esm.sh は npm パッケージを ES module に変換して配信する CDN
// dynamic import() で確実にクラスを取得できる
const SOUNDTOUCH_ESM = 'https://esm.sh/soundtouchjs@0.1.30';
const BUFFER_SIZE = 4096;

let libLoaded = false;
let ST = null; // { SoundTouch, SimpleFilter, WebAudioBufferSource }

// ── ES module ロード ───────────────────────────────────────────────────────

export async function loadSoundTouch() {
  if (libLoaded) return;

  let mod;
  try {
    mod = await import(/* @vite-ignore */ SOUNDTOUCH_ESM);
  } catch (e) {
    throw new Error(`SoundTouchJS の読み込みに失敗しました: ${e.message}`);
  }

  // esm.sh は named exports / default export 両方ありうる
  const SoundTouch          = mod.SoundTouch          ?? mod.default?.SoundTouch;
  const SimpleFilter        = mod.SimpleFilter        ?? mod.default?.SimpleFilter;
  const WebAudioBufferSource = mod.WebAudioBufferSource ?? mod.default?.WebAudioBufferSource;

  if (!SoundTouch || !SimpleFilter || !WebAudioBufferSource) {
    throw new Error(
      `SoundTouchJS: クラスが見つかりません ` +
      `(keys: ${Object.keys(mod).join(', ')})`
    );
  }

  ST = { SoundTouch, SimpleFilter, WebAudioBufferSource };
  libLoaded = true;
}

export function isSoundTouchReady() {
  return libLoaded;
}

// ── PitchFixedPlayer ────────────────────────────────────────────────────────

export class PitchFixedPlayer {
  /**
   * @param {AudioContext} ctx
   * @param {AudioBuffer}  audioBuffer
   * @param {AudioNode}    outputNode  - 接続先（gainNode など）
   */
  constructor(ctx, audioBuffer, outputNode) {
    this.ctx        = ctx;
    this.buffer     = audioBuffer;
    this.output     = outputNode;
    this.scriptNode = null;
    this.st         = null;
    this.filter     = null;
    this._tempo     = 0.001; // 初期値はほぼ停止
    this.playing    = false;
  }

  _buildFilter() {
    const { SoundTouch, SimpleFilter, WebAudioBufferSource } = ST;
    // SoundTouch インスタンスは再利用（tempo 状態を保持するため）
    if (!this.st) {
      this.st = new SoundTouch(this.ctx.sampleRate);
      this.st.pitch = 1.0; // ピッチ固定
    }
    this.st.tempo = this._tempo;
    const source = new WebAudioBufferSource(this.buffer);
    this.filter = new SimpleFilter(source, this.st);
  }

  start() {
    if (this.playing) this.stop();
    if (!ST) throw new Error('SoundTouch が初期化されていません');

    this._buildFilter();

    this.scriptNode = this.ctx.createScriptProcessor(BUFFER_SIZE, 2, 2);
    this.scriptNode.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0);
      const R = e.outputBuffer.getChannelData(1);
      const interleaved = new Float32Array(BUFFER_SIZE * 2);

      const extracted = this.filter.extract(interleaved, BUFFER_SIZE);

      // バッファ末尾 → source だけ巻き戻してループ（st は再利用）
      if (extracted < BUFFER_SIZE) {
        const { SimpleFilter, WebAudioBufferSource } = ST;
        const newSource = new WebAudioBufferSource(this.buffer);
        this.filter = new SimpleFilter(newSource, this.st); // st 再利用でバッファ引き継ぎ
        const rest = new Float32Array((BUFFER_SIZE - extracted) * 2);
        this.filter.extract(rest, BUFFER_SIZE - extracted);
        interleaved.set(rest, extracted * 2);
      }

      for (let i = 0; i < BUFFER_SIZE; i++) {
        L[i] = interleaved[i * 2];
        R[i] = interleaved[i * 2 + 1];
      }
    };

    this.scriptNode.connect(this.output);
    this.playing = true;
  }

  /** rate: 0.0 〜 2.0 */
  setTempo(rate) {
    this._tempo = Math.max(0.001, Math.min(2.0, rate));
    if (this.st) this.st.tempo = this._tempo;
  }

  stop() {
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null; // コールバックを即座に無効化
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    this.filter  = null;
    this.st      = null;
    this.playing = false;
  }
}
