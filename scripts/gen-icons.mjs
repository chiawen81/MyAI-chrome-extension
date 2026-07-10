/**
 * 產生外掛 icon（PNG）。
 * 不依賴任何繪圖套件：直接以 zlib + 手工組裝 PNG 檔案格式，
 * 畫出一個藍色底、左上到右下漸層的方形圖示。
 *
 * 執行：node scripts/gen-icons.mjs（build 時會自動執行）
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];

/* ---------------- PNG 檔案格式的最小實作 ---------------- */

/** CRC32 查表（PNG chunk 的檢查碼演算法） */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** 組一個 PNG chunk：長度 + 類型 + 資料 + CRC */
function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** 把 RGBA 像素資料包成完整的 PNG 檔 */
function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // 寬
  ihdr.writeUInt32BE(size, 4); // 高
  ihdr[8] = 8; // 每通道 8 bit
  ihdr[9] = 6; // 色彩類型 6 = RGBA

  // 每列前面要加一個 filter byte（0 = 不過濾）
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 圖示內容 ---------------- */

/** 依對角線位置在兩色之間漸層，並畫出圓角 */
function drawIcon(size) {
  const from = { r: 0x3b, g: 0x82, b: 0xf6 }; // 藍
  const to = { r: 0x1e, g: 0x3a, b: 0x8a }; // 深藍
  const radius = size / 6; // 圓角半徑
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;

      // 圓角判斷：位於四個角的圓弧外側 → 透明
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      if (cx < radius && cy < radius) {
        const dx = radius - cx;
        const dy = radius - cy;
        if (dx * dx + dy * dy > radius * radius) {
          continue; // alpha 預設 0（透明）
        }
      }

      const t = (x + y) / (2 * (size - 1)); // 0 → 1 的對角線漸層
      pixels[offset] = Math.round(from.r + (to.r - from.r) * t);
      pixels[offset + 1] = Math.round(from.g + (to.g - from.g) * t);
      pixels[offset + 2] = Math.round(from.b + (to.b - from.b) * t);
      pixels[offset + 3] = 255;
    }
  }

  // 中央畫兩條白色橫線，象徵「原文在上、譯文在下」的雙語對照
  const lineHeight = Math.max(1, Math.round(size / 12));
  const lineWidth = Math.round(size * 0.55);
  const lineX = Math.round((size - lineWidth) / 2);
  for (const lineY of [Math.round(size * 0.38), Math.round(size * 0.58)]) {
    for (let y = lineY; y < lineY + lineHeight; y++) {
      for (let x = lineX; x < lineX + lineWidth; x++) {
        const offset = (y * size + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = y >= Math.round(size * 0.5) ? 190 : 255; // 下方那條略淡 = 譯文
      }
    }
  }

  return pixels;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUTPUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log(`已產生 ${file}`);
}
