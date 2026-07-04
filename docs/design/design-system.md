# Alfanumrik Design System — Canonical Spec (Phase 1)

**Status:** Foundation layer. Single source of truth for tokens.
**Scope:** Presentation only. No P1–P15 logic. Additive over the existing
`globals.css` dialects (cosmic / Atlas / momentum) — nothing is removed; the
canonical layer is what new work builds on and what the Phase-1 fixes repaired.

**North star:** every token encodes *learning meaning*. Colour, weight, motion
and hierarchy exist to lower cognitive load and sharpen feedback — not to
decorate. When a choice does not help a grade 6–12 student read, understand, or
feel progress faster, it does not ship.

> **Mode reality (do not misread):** dark + high-contrast token sets are
> DEFINED and correct, but the app FORCES light. `AuthContext` writes
> `data-theme="light"` universally and the dark selector is retargeted to a
> sentinel value. Activating dark is CEO-gated (P13: dark surfaces + PII).
> Build the tokens; never flip the switch here.

---

## 1. Two-tier token model

**Rule 1 (immutable):** a Tier-1 name is bound to ONE hue family, forever.
Never remap `--color-orange-*` to a violet, or `--color-violet-*` to a
pink/gold. Phase 0 documented exactly these landmines (the cosmic scope remaps
the *legacy* `--orange` alias to violet); the two-tier model exists so new code
references **semantic** roles and stays immune to that.

### Tier 1 — raw palette (immutable, never themed)
Descriptive names, fixed hex. These never appear directly in component CSS.

| Token | Hex | Family |
|---|---|---|
| `--color-orange-600` | `#E8581C` | brand warm (burnt orange) |
| `--color-orange-700` | `#C2440F` | brand warm, deep |
| `--color-orange-500` | `#FF7A3D` | brand warm, light |
| `--color-violet-600` | `#7C3AED` | brand cool / AI |
| `--color-violet-500` | `#9333EA` | brand cool, light |
| `--color-gold-500` | `#F5A623` | marigold / XP |
| `--color-teal-600` | `#0891B2` | info |
| `--color-green-600` | `#16A34A` | success |
| `--color-red-600` | `#DC2626` | danger |
| `--color-pink-600` | `#DB2777` | pink accent |
| `--color-cream-50` | `#FBF8F4` | warm bg |
| `--color-cream-100` | `#F5F0EA` | warm surface |
| `--color-cream-200` | `#EDE6DC` | warm surface deep |
| `--color-ink-900` | `#1A1207` | text darkest |
| `--color-ink-700` | `#4A3F2E` | text mid |
| `--color-ink-500` | `#6B6053` | text muted (Phase-1 darkened) |

> Migration note: the shipping `globals.css` currently exposes these as flat
> tokens (`--orange`, `--purple`, `--gold`, `--bg`, `--text-1..3` …). Those stay
> as the de-facto Tier-1 aliases; new Tier-2 roles reference them. Do not rename
> the existing tokens (breaks 8 scope selectors and hundreds of consumers).

### Tier 2 — semantic roles (themeable; what components use)
These rebind per mode via `[data-theme]` (see §7). Components reference ONLY
these.

| Role | Light value | Meaning |
|---|---|---|
| `--bg` | `#FBF8F4` | app canvas |
| `--surface-1` | `#FFFFFF` | raised card |
| `--surface-2` | `#F5F0EA` | inset / recessed |
| `--surface-3` | `#EDE6DC` | deepest well |
| `--fg` (`--text-1`) | `#1A1207` | primary text |
| `--fg-muted` (`--text-2`) | `#4A3F2E` | secondary text |
| `--fg-subtle` (`--text-3`) | `#6B6053` | hint / placeholder |
| `--border` | `rgba(0,0,0,.08)` | hairline |
| `--primary` | `#E8581C` | primary action (brand) |
| `--secondary` | `#7C3AED` | secondary action |
| `--accent` | `#E8581C` | role-tintable emphasis (§7) |
| `--success` | `#16A34A` | positive / verified |
| `--warning` | `#F5A623` | caution / check-yourself |
| `--danger` | `#DC2626` | destructive / error |
| `--info` | `#0891B2` | informational |

**Phase-1 repair:** `--secondary`, `--xp-color`, `--streak-color`,
`--level-up`, `--danger-light` were cosmic-only → now have light `:root`
fallbacks so their utilities stop being silent no-ops on the shipping theme.

---

## 2. Learning-state tokens

Colour alone fails ~8% of boys (deuteranopia): red/gold/green mastery is
indistinguishable to them. **Every learning state therefore carries a REQUIRED
non-colour backup** — an icon and/or text label. Colour is the accelerator, not
the message.

| State | Token | Light hue | Required non-colour backup | Learning meaning |
|---|---|---|---|---|
| Mastery low | `--mastery-low` | `#DC2626` red | ▲ "At risk" + hollow ring | < 40% — needs re-teach |
| Mastery mid | `--mastery-mid` | `#F5A623` gold | ◐ "Developing" + half ring | 40–69% — practise |
| Mastery high | `--mastery-high` | `#16A34A` green | ● "Strong" + full ring | ≥ 70% — retain / stretch |
| Due / revision | `--revision` → `--secondary` | `#7C3AED` violet | ↻ "Review due" + count | spaced-repetition due |
| Assessment | `--assessment` → `--info` | `#0891B2` teal | ✎ "Test" label | graded / exam context |
| XP | `--xp-color` | `#F5A623` gold | "+N XP" numeral | reward earned |
| Streak | `--streak-color` | `#E8581C` orange | 🔥 flame + day count | consistency |
| Level-up | `--level-up` | `#7C3AED` violet | ★ "Level N" burst | milestone crossed |

`xp/streak/level-up` are **accent hues** (badges, fills, large numerals, icons)
— not body-text-on-surface pairs. They are exempt from the 4.5:1 body rule;
when rendered as ≥24px/large numerals the 3:1 large-text rule applies and they
sit on their own tinted chip, not raw white.

---

## 3. Modular type scale

Single ratio ≈ **1.2** (minor third), **12px hard floor**, fluid `clamp()` per
step (min at 360px → max at 1440px). Latin voice = Fraunces (display) / Sora
(data) / Plus Jakarta Sans (body); Devanagari voice = self-hosted Noto Serif /
Noto Sans Devanagari appended to every stack (P7 — Hindi never falls to tofu).

| Token | Range | Tailwind | Use |
|---|---|---|---|
| `--text-2xs` | 12px (fixed floor) | `text-2xs` | micro-labels (minimum) |
| `--text-xs` | 12→13px | `text-xs` | captions |
| `--text-sm` | 13→14px | `text-sm` | secondary body |
| `--text-base` | 15→16px | `text-base` | body |
| `--text-md` | 16→18px | `text-md` | lead body |
| `--text-lg` | 18→20px | `text-lg` | subheading |
| `--text-xl` | 20→24px | `text-xl` | h4 |
| `--text-2xl` | 24→30px | `text-2xl` | h3 |
| `--text-3xl` | 28→36px | `text-3xl` | h2 |
| `--text-4xl` | 32→44px | `text-4xl` | h1 |
| `--text-5xl` | 40→56px | `text-5xl` | hero |
| `--text-display` | 44→60px | `text-display` | display |

**12px floor is enforced two ways:** `--text-2xs` = 12px, and a CSS guard raises
the ~850 `text-[9px]/[10px]/[11px]` arbitrary usages to 12px (larger, never
smaller — no layout breaks).

**Weight cap: 3 (400 / 600 / 700).** Phase 0 found ~2,345 bold/semibold uses
flattening hierarchy — everything shouts, so nothing does. Rule: body 400,
emphasis/labels 600, headings/data 700. Do not reach for 500/800 to create
hierarchy; use *size* and *space* first, weight last.

Devanagari needs extra leading (top matras collide): `line-height: 1.75` on
`[lang="hi"]` / `.text-hi` (already in place — keep it).

---

## 4. Spacing (4px base)

Two complementary scales:
- **Fixed** `--space-1..16` (`sp-*` utilities) = N×4px. Deterministic gaps,
  grids, component internals. (`sp-4` == 16px == Tailwind `p-4`.)
- **Fluid** `--space-fluid-1..12` = `clamp()` — responsive section rhythm that
  grows a touch on desktop without a breakpoint snap. Prefer for page-level
  margins/gaps.

Rhythm guidance: pack related items at `sp-2/sp-3`; separate groups at
`sp-6`+; section breathing at `--space-fluid-8`+. Generous whitespace is a
cognitive-load tool, not wasted space.

---

## 5. Radius

Stock-Tailwind numeric scale, now actually defined (`--radius-*` were undefined
→ `rounded-xl` etc. computed to 0 = square corners app-wide; this restores the
intended rounding).

| Token | px | Use |
|---|---|---|
| `--radius-sm` | 2 | chips, tags |
| `--radius-md` | 6 | inputs, small controls |
| `--radius-lg` | 8 | buttons, rows |
| `--radius-xl` | 12 | cards |
| `--radius-2xl` | 16 | panels, sheets, hero |
| `--radius-pill` | 999 | pills, avatars |

Softer corners read as friendlier/safer to younger students; keep radius
consistent per component tier so the eye can group by shape.

---

## 6. Elevation & motion

**Elevation** — subtle, premium. Phase 0 says *reduce* borders/clutter; prefer
one soft shadow over a hard 1px box.

| Token | Value | Use |
|---|---|---|
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,.04)` | resting card |
| `--shadow-md` | `0 2px 12px rgba(0,0,0,.06)` | raised / hover |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,.08)` | modal / sheet |
| `--shadow-glow` | `0 0 24px rgba(232,88,28,.15)` | focus / celebrate |

**Motion** — meaningful only. Motion should explain a state change (a value
arriving, a level crossed), never decorate idle UI.

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 150ms | press / hover / toggle |
| `--dur-base` | 250ms | enter / reveal |
| `--dur-slow` | 400ms | celebratory (XP burst, level-up) |
| `--ease-standard` | `cubic-bezier(.4,0,.2,1)` | most transitions |
| `--ease-atlas` | `cubic-bezier(.22,1,.36,1)` | premium enters |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | reward pops |

**Every animation MUST honour `prefers-reduced-motion: reduce`** → collapse to
opacity/none (the existing OS-reveal block already does this; follow it).

---

## 7. Modes

Modes are **Tier-2 rebindings only** — Tier-1 hex never moves. Driven by
`[data-theme]`; `[data-role]` re-tints `--accent` ONLY (parent/teacher/school
get their own accent hue, everything else stays put).

- **light** — ships. Warm cream canvas, ink text. Values above.
- **dark** — built, correct, **not activated** (CEO/P13 gate). Surfaces invert
  to dark-ink, text to warm-cream; brand hues hold. Contrast verified ≥ AA
  (see the frozen `[data-theme="dark-…"]` block + cosmic dark block).
- **high-contrast** — near-black bg, pure-white text (~20:1 AAA), thicker
  strokes. For low-vision / harsh sunlight. Exists in the cosmic scope
  (`data-theme="hc"`); generalise to the default theme in a later wave.

Role tinting example (cosmic): `[data-role="teacher"]` shifts `--accent` to the
teacher hue; it must never touch `--fg/--bg/--surface-*` (readability is
role-independent).

---

## 8. Contrast table (computed, sRGB WCAG 2.1)

Body text needs ≥ 4.5:1; large text / UI ≥ 3:1. AAA ≥ 7:1.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `--text-1` #1A1207 | `--bg` #FBF8F4 | 17.5:1 | AAA |
| `--text-2` #4A3F2E | `--bg` #FBF8F4 | 9.7:1 | AAA |
| `--text-3` #6B6053 | `--bg` #FBF8F4 | 5.8:1 | AA |
| `--text-3` #6B6053 | `--surface-1` #FFFFFF | 6.1:1 | AA |
| `--text-3` #6B6053 | `--surface-2` #F5F0EA | 5.4:1 | AA |
| `--text-3` #6B6053 | `--surface-3` #EDE6DC | 4.95:1 | AA |
| #FFFFFF | `--btn-primary-from` #CB4710 | 4.72:1 | AA |
| #FFFFFF | `--btn-primary-to` #C2440F | 5.09:1 | AA |
| `--text-1` | `--surface-1` #FFFFFF | 18.6:1 | AAA |

### Fixed in Phase 1 (were failing)
| Pair | Before | After |
|---|---|---|
| `--text-3` on `--surface-3` | #7D7264 → 3.80:1 ✗ | #6B6053 → 4.95:1 ✓ |
| `--text-3` on `--surface-2` | #7D7264 → 4.15:1 ✗ | #6B6053 → 5.4:1 ✓ |
| white on `.btn-primary` | #E8581C 3.59 / #FF7A3D 2.59 ✗ | #CB4710 4.72 / #C2440F 5.09 ✓ |

### Known non-text / accent pairs (exempt from body rule)
- `--xp-color` gold, `--warning` gold, `--streak-color` orange as **text on raw
  white** fail body contrast by design — they are accent fills / large numerals
  on their own tinted chips, never body copy on white. Enforce a dark foreground
  or a chip background when rendering them as text.
- Hairline `--border` (8% ink) is decorative, not a sole state indicator; where a
  border is the *only* affordance cue, use `--border-strong` (≥3:1).

---

## 9. What Phase 1 did NOT do (Phase 2+)

- The 24 component primitives (Button, Card, Field, StatRing, …) — Phase 2.
- Collapsing the cosmic/Atlas/momentum dialects into pure Tier-2 consumers.
- Splitting `@supabase/*` out of first paint to restore the 160kB shared cap.
- Generalising high-contrast + activating dark (CEO-gated).
