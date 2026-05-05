# PWA Icon TODO — Generate PNG icons

`manifest.json` references `/icon-192.png` and `/icon-512.png` for Android
launcher compatibility (many launchers reject SVG). These files do **not
yet exist** on disk.

## Required files
- `public/icon-192.png` (192x192, opaque background, maskable safe-zone)
- `public/icon-512.png` (512x512, opaque background, maskable safe-zone)

## Suggested generation (one-time)

```bash
# Using sharp (already a transitive dep of next/image):
npx sharp-cli -i public/icon-512x512.svg -o public/icon-512.png resize 512 512
npx sharp-cli -i public/icon-512x512.svg -o public/icon-192.png resize 192 192

# OR using ImageMagick:
magick convert -background none -density 300 -resize 192x192 public/icon-192x192.svg public/icon-192.png
magick convert -background none -density 300 -resize 512x512 public/icon-512x512.svg public/icon-512.png
```

For maskable purpose, the icon contents should occupy the inner 80% of the
canvas (Android crops to a circle/squircle at install time).

Until these PNGs are generated, Android launchers will fall back to the SVG
entries (modern Chrome) or show a generic icon (older launchers).

Filed: 2026-05-05 (Wave 1 launch fixes).
