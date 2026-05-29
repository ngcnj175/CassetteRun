/**
 * pitch-player.js
 * SoundTouchJS を使ったピッチ固定タイムストレッチ再生
 *
 * カセットモード : AudioBufferSourceNode.playbackRate（速度↑でピッチ↑）
 * ピッチ固定モード: SoundTouch + ScriptProcessorNode（速度が変わってもキー固定）
 */

const SOUNDTOUCH_CDN =
  'https://cdn.jsdelivr.net/npm/soundtouchjs@0.1.30/dist/soundtouch.js';
const BUFFER_SIZE = 4096;

let libLoaded = false;
let ST = null; // { SoundTouch, SimpleFilter, WebAudioBufferSource }

// ── CDN ロード ─────────────────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

export async function loadSoundTouch() {
  if (libLoaded) return;
  await loadScript(SOUNDTOUCH_CDN);

  // UMD build → window.soundtouchjs.* または window.SoundTouch / window.SimpleFilter
  const ns = window.soundtouchjs ?? window;
  const SoundTouch         = ns.SoundTouch;
  const SimpleFilter       = ns.SimpleFilter;
  const WebAudioBufferSource = ns.WebAudioBufferSource;

  if (!SoundTouch || !SimpleFilter || !WebAudioBufferSource) {
    throw new Error('SoundTouchJS の読み込みに失敗しました（グローバルが見つかりません）');
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
    this.st = new SoundTouch(this.ctx.sampleRate);
    this.st.tempo = this._tempo;
    this.st.pitch = 1.0; // ピッチ変換なし
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

      // バッファ末尾でループ
      if (extracted < BUFFER_SIZE) {
        this._buildFilter();
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
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    this.filter = null;
    this.st     = null;
    this.playing = false;
  }
}
