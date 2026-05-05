# PWA Icon Generation - DONE

`manifest.json` references `/icon-192.png` and `/icon-512.png` for Android
launcher compatibility (many launchers reject SVG). **Generated 2026-05-05**
via sharp (Node, transitive dep of next/image) from the source SVGs in this
folder.

## Files (now present)
- `public/icon-192.png` (192x192, opaque white background, ~3.1 kB)
- `public/icon-512.png` (512x512, opaque white background, ~9.6 kB)

## How they were generated

```js
// node -e "..."
const sharp = require('sharp');
const fs = require('fs');
const src = fs.readFileSync('public/icon-512x512.svg');
sharp(src, { density: 600 })
  .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .flatten({ background: '#FFFFFF' })
  .png({ compressionLevel: 9 })
  .toFile('public/icon-512.png');
```

## Maskable safe-zone caveat

The current PNGs are direct rasterizations of the SVG (the icon contents
fill 100% of the canvas). For optimal `purpose: "any maskable"` rendering,
the icon contents should occupy the inner 80% of the canvas (Android crops
to a circle/squircle at install time).

If launcher rendering looks cropped on real devices, regenerate with:

```js
sharp(src, { density: 600 })
  .resize(409, 409, { fit: 'contain', background: '#FFFFFF' })   // 80% of 512
  .extend({ top: 51, bottom: 52, left: 51, right: 52, background: '#FFFFFF' })
  .flatten({ background: '#FFFFFF' })
  .png()
  .toFile('public/icon-512.png');
```

## Regeneration

When the SVG source changes, regenerate via the script above. Modern Chrome
will prefer the SVG entries when available (they're listed first in
manifest.icons), so PNG regeneration is only needed when the visual brand
shifts.
