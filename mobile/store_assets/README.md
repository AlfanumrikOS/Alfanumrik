# Play Store listing assets

Generated for the initial Play Store submission (brand colors/fonts taken
directly from the existing app icon design in `apps/host/public/icon-512x512.svg`
and the bundled Sora font family — nothing invented).

| File | Purpose | Spec |
|---|---|---|
| `play_store_icon_512.png` | Play Console "Hi-res icon" upload | 512x512, full-bleed, no pre-baked rounding (Play applies its own mask) |
| `feature_graphic_1024x500.png` | Play Console "Feature graphic" upload | 1024x500 |
| `screenshot_*.png` | Play Console screenshot slots | 1080x1920 (portrait) |

**Screenshots are stylized placeholders**, not real device captures — each one
says so in a footer caption. They unblock creating the store listing today with
brand-consistent, submission-ready dimensions. Before final release, swap them
for real captures (Android Studio emulator or a physical device) of: splash/
login, dashboard, subjects list, Foxy chat, quiz results. Delete the footer
caption in the real captures.

None of these files are referenced by `pubspec.yaml` — they are Play Console
upload assets only, not bundled into the app (zero APK/AAB size impact).

See `mobile/PLAY_STORE_LISTING.md` for the listing copy and content-rating
answers these assets pair with, and `docs/runbooks/mobile-release.md` for the
publish pipeline.
