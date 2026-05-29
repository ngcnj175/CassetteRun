/**
 * scan-tracks.js
 * assets/ フォルダの MP3 を自動スキャンして js/tracks.js を生成します。
 *
 * 使い方:
 *   node tools/scan-tracks.js
 *
 * 対応フォーマット: .mp3 .m4a .aac .wav .ogg .flac
 */

const fs   = require('fs');
const path = require('path');

const ASSETS_DIR  = path.join(__dirname, '..', 'assets');
const OUTPUT_FILE = path.join(__dirname, '..', 'js', 'tracks.js');
const EXTENSIONS  = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'];

// assets/ フォルダがなければ作成
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  console.log('assets/ フォルダを作成しました。');
}

// 対応拡張子のファイルを取得
const files = fs.readdirSync(ASSETS_DIR)
  .filter(f => EXTENSIONS.includes(path.extname(f).toLowerCase()))
  .sort();

if (files.length === 0) {
  console.warn('⚠ assets/ に音楽ファイルが見つかりません。');
}

// タイトルをファイル名から生成（拡張子除去）
const tracks = files.map(file => ({
  title: path.basename(file, path.extname(file)),
  file:  `assets/${file}`,
}));

// js/tracks.js を書き出し
const lines = [
  '// ============================================================',
  '// このファイルは tools/scan-tracks.js が自動生成します。',
  '// 手動で編集しないでください。',
  `// 生成日時: ${new Date().toLocaleString('ja-JP')}`,
  '// ============================================================',
  '',
  'export const TRACKS = [',
  ...tracks.map(t =>
    `  { title: ${JSON.stringify(t.title)}, file: ${JSON.stringify(t.file)} },`
  ),
  '];',
  '',
];

fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');

console.log(`✅ ${tracks.length} 曲を登録しました → js/tracks.js`);
tracks.forEach((t, i) => console.log(`   ${i + 1}. ${t.title}`));
