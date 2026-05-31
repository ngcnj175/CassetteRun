# カセット▶▶RUN — アプリ仕様書

> 走らないと音楽が聴けない

---

## 1. 概要

**カセット▶▶RUN** は、ユーザーの走行速度に応じて音楽の再生速度（または再生テンポ）をリアルタイムに変化させる Web アプリケーション。  
速く走れば音楽が速くなり、止まれば音楽も止まる。カセットテープの外観を模した UI でレトロな雰囲気を演出する。

- **対象プラットフォーム:** スマートフォン（iOS / Android）、デスクトップ（デバッグ用）
- **動作環境:** モダンブラウザ（Web Audio API / Geolocation API 必須）
- **配信形態:** 静的 HTML + JS（サーバー不要、CDN 1本のみ外部依存）

---

## 2. ファイル構成

```
CassetteRun/
├── index.html            # エントリポイント（UI マークアップ）
├── style.css             # 全スタイル（カセットテープテーマ）
├── js/
│   ├── main.js           # アプリ制御・イベント管理
│   ├── audio.js          # Web Audio API ラッパー（通常再生）
│   ├── motion.js         # 速度検出（GPS / センサー）
│   ├── pitch-player.js   # ピッチ固定タイムストレッチ再生
│   └── tracks.js         # プリセットトラックリスト（自動生成）
├── assets/               # 音楽ファイル置き場（.mp3 等）
└── tools/
    └── scan-tracks.js    # assets/ をスキャンして tracks.js を生成する Node スクリプト
```

### 外部依存

| ライブラリ | 用途 | 取得方法 |
|-----------|------|---------|
| [NoSleep.js v0.12](https://github.com/richtr/NoSleep.js) | 再生中のスリープ防止 | CDN（jsDelivr） |
| [SoundTouchJS v0.1.30](https://github.com/cutterbl/SoundTouchJS) | ピッチ固定タイムストレッチ | 動的 import（esm.sh） |

SoundTouchJS は**ピッチ固定モード選択時のみ**ロードされる。

---

## 3. 機能仕様

### 3.1 音源選択

ユーザーは以下の 2 種類の方法で音源を選択する。

#### プリセットトラック
- 「🎵 リストから選曲」ボタンでモーダルを開く
- `js/tracks.js` に列挙されたトラックを一覧表示
- 選択後、ボタン上に曲名が表示される
- 選択した曲は START 押下時に `fetch()` で `assets/` から取得・デコード

#### カスタム MP3
- 「📂 自分の MP3 を使う」ボタンでファイル選択ダイアログを開く
- 対応形式: `.mp3` `.m4a` `.aac` `.wav` `.ogg` `.flac` `audio/*`
- 選択後、ブラウザ内で ArrayBuffer としてデコード（サーバー送信なし）
- ファイル名（拡張子除去）が曲名として表示される

どちらか一方が選択された状態でのみ START が有効。

---

### 3.2 再生モード

START ボタン押下前にトグルで選択する。

#### カセットモード（デフォルト）
- Web Audio API の `BufferSourceNode.playbackRate` を速度に応じて変化
- 音程も速度に連動して変化（カセットテープを早送りする感覚）
- 速度 `< 0.05x` のとき: ゲインを 0 に絞り、再生レートを 0.001 に下げる（事実上の無音一時停止）
- 通常再生: ゲイン 1.0、レート上限 2.0x

#### ピッチ固定モード
- SoundTouchJS（ScriptProcessorNode）でテンポのみを変化させ、音程を固定
- START 時に 3 ステップのローディングを表示：
  1. SoundTouch 読み込み中（33%）
  2. バッファ準備中（66%）
  3. 再生開始 ✓（100% → 1秒後に非表示）
- iOS Safari 対応: 無音オシレーター（gain=0）をダミー入力として `ScriptProcessorNode` に接続し `onaudioprocess` を確実に発火させる
- バッファ末端到達でループ（新規 SoundTouch インスタンスを生成してリセット）
- ウォームアップ: 最大 20 コールバック（約 1.9 秒）分、extracted=0 でも強制停止しない

---

### 3.3 速度検出モード

START ボタン押下前にトグルで選択する。

#### 📡 GPS モード（デフォルト）
- `navigator.geolocation.watchPosition()` で実移動速度（m/s）を継続取得
- オプション: `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 5000`

| 実速度 | 再生レート |
|-------|-----------|
| < 0.5 m/s | 0.0x（停止） |
| 3.0 m/s（約 5:30/km ペース） | 1.0x（基準速度） |
| 6.0 m/s 以上 | 2.0x（上限） |

線形補間: `rate = min(speed / 3.0, 2.0)`

#### 📳 センサーモード
- `devicemotion` イベントの加速度（3軸合成ベクトル長）を取得
- 直近 30 サンプルの移動平均でスムージング
- `acceleration` が利用可能な場合はそちらを優先、なければ `accelerationIncludingGravity` を使用

| 平均加速度 | 再生レート |
|-----------|-----------|
| < 0.5 m/s² | 0.0x |
| 0.5〜18.0 m/s² | 0.0〜2.0x（線形） |
| 18.0 m/s² 以上 | 2.0x（上限） |

- iOS Safari では初回センサーモード切替時に `DeviceMotionEvent.requestPermission()` を呼び出す
- 許可が得られない場合は GPS モードに戻し、理由をステータスに表示

#### イージング（共通）
- 毎フレーム `requestAnimationFrame` で `currentRate += (targetRate - currentRate) * 0.04` を計算
- 差が 0.001 未満になったら `targetRate` に収束させてスナップ

---

### 3.4 UI 表示・ビジュアル

#### カセットシェル
- 擬似的なカセットテープ外観（CSS のみ、画像不使用）
- ネジ・リール窓・テープパス・テープたるみを CSS で描画

#### リール回転アニメーション
- 毎フレーム `reelAngle += rate * 3` で左右リールを同方向に回転
- `will-change: transform` でハードウェアアクセラレーション

#### テープたるみ
- `rate < 0.3` のとき opacity と scaleY でたるみを表現
- `rate >= 0.3` で消える（transition 0.3s）

#### VU メーター
- `rate / 2.0 * 100%` の幅で伸縮
- 色変化:

| rate | 色 |
|------|----|
| < 0.3 | 茶（`#8B4513`） |
| 0.3〜1.0 | 黄（`#C8860A`） |
| 1.0〜1.6 | オレンジ（`#E8A020`） |
| ≥ 1.6 | 赤（`#FF4500`） |

#### ステータスライン
- 速度検出モードアイコン（📡 / 📳）+ 状態テキスト

| rate | テキスト |
|------|---------|
| < 0.05 | STOPPED |
| 0.05〜0.6 | SLOW |
| 0.6〜1.4 | PLAY |
| ≥ 1.4 | FAST |

#### 曲名マーキー（Now Playing）
- ラベル内に曲名を表示
- テキスト幅がコンテナより広い場合のみ `marquee-scroll` アニメーション（10秒ループ）

---

### 3.5 スリープ防止

- START 時に `NoSleep.enable()` を呼び出し、画面スリープを防止
- STOP 時に `NoSleep.disable()`
- ブラウザが NoSleep.js を解釈できない場合は `null` チェックでスキップ（optional chaining）

---

### 3.6 iOS 対応

- **AudioContext の自動再開:** `touchmove` は `.modal-track-list` 内を除き `preventDefault()`（スクロール・ドラッグ防止）
- **スクロールロック:** `overscroll-behavior: none`（html/body）+ `touch-action: manipulation`（body）
- **バックグラウンドからの復帰:** `visibilitychange` イベントで再生中なら `AudioContext.resume()`
- **iOS AudioContext 解除:** START ボタンのクリックハンドラー（ユーザージェスチャー内）で `ctx.resume()` を await してから非同期処理を実行

---

### 3.7 デバッグスライダー

- `0〜2x` のスライダー（`sim-slider`）で `simulateRate()` を呼び出し、GPS/センサーなしでレートを手動制御
- 常時表示（デスクトップ開発用）

---

## 4. トラック管理

### プリセット追加手順
1. 音楽ファイルを `assets/` に配置
2. `node tools/scan-tracks.js` を実行
3. `js/tracks.js` が自動更新される

### 対応フォーマット
`.mp3` `.m4a` `.aac` `.wav` `.ogg` `.flac`

### tracks.js フォーマット
```js
export const TRACKS = [
  { title: "曲名", file: "assets/ファイル名.mp3" },
  // ...
];
```
このファイルは自動生成のため手動編集禁止。

---

## 5. 音声グラフ構成

### カセットモード
```
BufferSourceNode (loop=true, playbackRate=可変)
  └── GainNode (gain=0〜1.0)
        └── AudioContext.destination
```

### ピッチ固定モード
```
OscillatorNode (freq=任意, gain=0) ─ [ダミー入力]
  └── GainNode (gain=0)
        └── ScriptProcessorNode (4096 samples, 1in / 2out)
              └── GainNode (gain=0〜1.0)
                    └── AudioContext.destination

SoundTouch + SimpleFilter + WebAudioBufferSource
  → ScriptProcessorNode.onaudioprocess でフレーム毎に処理
```

ピッチ固定モードの GainNode はカセットモードと共用（`audio.js` が管理）。

---

## 6. 状態管理（main.js）

| 変数 | 型 | 説明 |
|-----|----|------|
| `selectedTrack` | `Object \| 'custom' \| null` | 選択中のトラック |
| `pitchFixed` | `boolean` | ピッチ固定モードか |
| `pitchPlayer` | `PitchFixedPlayer \| null` | 現在の PFP インスタンス |
| `isPlaying` | `boolean` | 再生中か |
| `motionMode` | `'gps' \| 'sensor'` | 速度検出モード |
| `sensorPermAsked` | `boolean` | センサー許可ダイアログ表示済みか |

---

## 7. 既知の制約・注意事項

- `ScriptProcessorNode` は Web Audio API において deprecated だが、`AudioWorklet` が iOS Safari で安定しないため継続使用
- GPS 速度（`coords.speed`）は環境・デバイスによって精度が異なる。屋内・低速では 0 を返すことがある
- センサーモードは歩行・走行以外の振動（電車等）にも反応する
- SoundTouchJS は CDN（esm.sh）からの動的 import のため、オフライン環境では使用不可
- カスタム MP3 はブラウザ内処理のため外部送信はされない
