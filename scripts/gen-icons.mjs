#!/usr/bin/env node
/**
 * Static favicon / apple-touch-icon generator.
 *
 * Browsers auto-probe a handful of root-level icon paths on every page load,
 * regardless of what <link rel="icon"> / manifest.json declares. When those
 * files are absent they emit persistent "Failed to load resource: 404"
 * console noise in production. This script rasterizes the brand SVGs in
 * public/ into the three files browsers request unconditionally:
 *
 *   public/favicon.ico                     (every browser; the classic 404)
 *   public/apple-touch-icon.png            (iOS Safari auto-probe)
 *   public/apple-touch-icon-precomposed.png(iOS Safari auto-probe)
 *
 * Source-of-truth SVGs live in public/. Output PNGs match the existing PWA
 * icon style (see public/ICONS_TODO.md): opaque white background via
 * .flatten({ background: '#FFFFFF' }), high-density SVG render, maximum PNG
 * compression. `sharp` is available as a transitive dep of next/image.
 *
 * Usage:
 *   node scripts/gen-icons.mjs
 *
 * Why a script and not a one-liner?
 *   - sharp cannot write the .ico container, so favicon.ico needs a small
 *     hand-built ICONDIR/ICONDIRENTRY wrapper around a PNG buffer (browsers
 *     accept PNG-compressed ICO entries).
 *   - Keeping it committed makes the assets reproducible when the brand SVG
 *     changes (just rerun the command above).
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const publicDir = join(repoRoot, 'public');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * Rasterize an SVG to a square PNG buffer with an opaque white background,
 * matching the existing icon-192/icon-512 generation style.
 */
async function svgToPngBuffer(svgPath, size) {
  const svg = readFileSync(svgPath);
  return sharp(svg, { density: 600 })
    .resize(size, size, { fit: 'contain', background: WHITE })
    .flatten({ background: '#FFFFFF' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Wrap a 32x32 PNG buffer in a single-image ICO container. sharp can't write
 * .ico, but the ICO format permits a PNG-compressed image entry, which all
 * modern browsers decode.
 *
 *   ICONDIR     (6 bytes):  reserved=0, type=1 (icon), count=1
 *   ICONDIRENTRY(16 bytes): 32x32, 32bpp, byte length + offset to the PNG
 *   <PNG bytes>
 */
function pngBufferToIco(pngBuffer, dim) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(dim === 256 ? 0 : dim, 0); // width  (0 means 256)
  entry.writeUInt8(dim === 256 ? 0 : dim, 1); // height (0 means 256)
  entry.writeUInt8(0, 2); // color palette count (0 = no palette)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // size of image data
  entry.writeUInt32LE(22, 12); // offset of image data (6 + 16)

  return Buffer.concat([header, entry, pngBuffer]);
}

async function main() {
  // 1 + 2. apple-touch-icon(.precomposed).png — 180x180 from icon-512x512.svg.
  const appleSrc = join(publicDir, 'icon-512x512.svg');
  const appleBuffer = await svgToPngBuffer(appleSrc, 180);
  const applePath = join(publicDir, 'apple-touch-icon.png');
  const applePrecomposedPath = join(publicDir, 'apple-touch-icon-precomposed.png');
  writeFileSync(applePath, appleBuffer);
  writeFileSync(applePrecomposedPath, appleBuffer); // identical output
  console.log(`Wrote ${applePath} (180x180)`);
  console.log(`Wrote ${applePrecomposedPath} (180x180)`);

  // 3. favicon.ico — 32x32 PNG-in-ICO from favicon.svg.
  const faviconSrc = join(publicDir, 'favicon.svg');
  const faviconPng = await svgToPngBuffer(faviconSrc, 32);
  const ico = pngBufferToIco(faviconPng, 32);
  const faviconPath = join(publicDir, 'favicon.ico');
  writeFileSync(faviconPath, ico);
  console.log(`Wrote ${faviconPath} (32x32, ${ico.length} bytes)`);
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
