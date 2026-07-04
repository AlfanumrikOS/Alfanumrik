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

### 8.1 Paired on-surface / on-accent tokens (Phase 2 — legibility invariant)

**The pairing contract.** Text rendered on a surface `X` MUST use its paired
foreground token `--on-X`. **Never** put a bare `#fff` / `text-white` (or any
hardcoded light literal) on a decorative background that might not paint. A
foreground is defined *with* the surface it sits on and AA-verified against it,
so legibility is an invariant of the surface — not a per-consumer guess. This
closes the class of bug in DD-16 (≈468 decoupled light-text sites that go
invisible white-on-cream when their companion dark/gradient background fails).

**Critical gotcha.** `#fff` is AA on the *darkened* CTA stops but NOT on the bare
brand orange:

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `#fff` (`--on-accent`) | `--btn-primary-from` #CB4710 | 4.72:1 | AA |
| `#fff` (`--on-accent`) | `--btn-primary-to` #C2440F | 5.09:1 | AA |
| `#fff` | bare `--orange` #E8581C | **3.59:1** | **FAIL — never do this** |

So `--on-accent` pairs with the **action/CTA surface** (`.btn-primary` gradient /
`--surface-accent` / Tailwind `bg-surface-accent`), never with `bg-brand-orange`.

**Paired-token table (computed sRGB WCAG 2.1).** Each on-token is verified
against the surface it pairs with (light `:root` values unless noted):

| Foreground token | Value | Pairs with surface | Ratio | Verdict |
|---|---|---|---|---|
| `--on-surface-inverse` | #F4ECDB | `--surface-inverse` #241A2E | 14.16:1 | AAA |
| `--on-surface-inverse` | #F4ECDB | Foxy gradient lighter stop #16263F | 12.92:1 | AAA |
| `--on-surface-inverse-muted` | #C9BCA6 | `--surface-inverse` #241A2E | 8.89:1 | AAA |
| `--on-surface-inverse-muted` | #C9BCA6 | Foxy gradient lighter stop #16263F | 8.12:1 | AAA |
| `--on-accent` | #FFFFFF | `--btn-primary-from` #CB4710 (worst case) | 4.72:1 | AA |
| `--on-accent` | #FFFFFF | `--btn-primary-to` #C2440F | 5.09:1 | AA |
| `--on-surface-accent` | #FFFFFF | `--surface-accent` (gradient, worst stop #CB4710) | 4.72:1 | AA |

`--surface-inverse` #241A2E is the darker base of the existing Foxy header
gradient (`#241a2e → #16263f`); both on-inverse tokens clear AAA across the
*entire* gradient range, so they are safe on any Foxy-style dark chrome.

**Cross-scope resolution (same names, AA-verified per scope):**

| Scope | `--surface-inverse` | `--on-surface-inverse` | Ratio | `--on-accent` |
|---|---|---|---|---|
| `:root` (light) | #241A2E | #F4ECDB | 14.16:1 AAA | #fff on CTA (AA) |
| `html[data-design="cosmic"]` | `--bg-elev` #15214A | `--text` #F4F1FF | 14.00:1 AAA | #fff, matches cosmic's existing violet CTA (large/UI ≥3:1) |
| frozen dark (inert) | #0A0812 | #F4ECDB | 16.91:1 AAA | #fff on CTA (AA) |

The cosmic `--on-accent` = `#fff` deliberately mirrors cosmic's pre-existing
`.btn-primary` rendering (white on the violet gradient #8B7EFF→#6B5AE6, 3.22–4.96:1
— button UI text, ≥3:1). The canonical **body-AA** guarantee for `--on-accent`
lives on the light theme's warm CTA stops; cosmic's violet CTA is pre-existing
and out of scope for this token layer.

**Tailwind utilities:** `bg-surface-inverse` + `text-on-inverse` /
`text-on-inverse-muted`; `bg-surface-accent` + `text-on-surface-accent`;
`text-on-accent` for CTA labels. Consumer migration of the 468 decoupled sites
is later page-phase work (DD-16); this phase ships only the token + utility layer.

---

## 9. What Phase 1 did NOT do (Phase 2+)

- The 24 component primitives (Button, Card, Field, StatRing, …) — Phase 2.
  **Batch A of these shipped — see §10.**
- Collapsing the cosmic/Atlas/momentum dialects into pure Tier-2 consumers.
- Splitting `@supabase/*` out of first paint to restore the 160kB shared cap.
- Generalising high-contrast + activating dark (CEO-gated).

---

## 10. Component Primitives (Batch A)

**Status:** Phase 2 Batch A — the canonical primitive layer. Every future page
imports from here. **Import path:** `@/components/ui/primitives` (also surfaced
as the `primitives` namespace on the `@/components/ui` barrel). Source files:
`src/components/ui/primitives/*`. Showcase: `/dev/ui` (dev-only, not in nav).

> **Coexistence rule.** The legacy single-file "Wonder Blocks" set (moved to
> `src/components/ui/wonder-blocks.tsx`) keeps the root `@/components/ui` names
> (`Button`, `Card`, …) until its ~134 consumers migrate. The canonical set uses
> the same names with a stricter API, so it lives on the `/primitives` subpath
> until promotion. Do NOT clobber the legacy root names in this phase.

**Every primitive is:** token-driven (zero inline hex / `rgb()` / arbitrary
Tailwind values — semantic Tier-2 tokens + the `.text-fluid-*` scale + `sp-*` /
`--radius-*` / elevation scales only), accessible by default (≥44px touch
targets — `h-11`/`h-12`/`h-14`; visible `focus-visible:ring-2 ring-primary`;
real semantics; `prefers-reduced-motion` via `motion-reduce:*`; a non-colour
backup on every colour-coded state), and bilingual-safe (all copy via
props/`children` — P7).

Shared types (`primitives/tokens.ts`):
`Tone = neutral | success | warning | danger | info | brand`;
`ActionVariant = primary | secondary | ghost | danger`;
`ControlSize = sm | md | lg`. Solid tone foregrounds are AA-picked (ink on the
light tones, `white` on danger/brand — warning never renders gold-as-text).

| Primitive | Key props | Variants / sizes / tones |
|---|---|---|
| `Button` | `variant`, `size`, `loading`, `disabled`, `fullWidth`, `leadingIcon`, `trailingIcon` | variant: primary (`--btn-primary-*` gradient) / secondary / ghost / danger · size sm/md/lg |
| `IconButton` | `label` (required aria-label), `icon`, `variant`, `size`, `loading` | same variants/sizes; square `h/w-11/12/14` |
| `Card` + `CardHeader`/`CardBody`/`CardFooter` | `variant`, `onClick` | flat / elevated / interactive (keyboard-focusable when clickable); `overflow-hidden` media-safe |
| `Badge` | `tone`, `variant`, `icon` | soft (ink on tint, always AA) / solid; 6 tones |
| `Chip` | `selected`, `tone`, `icon`, `onClick`, `disabled` | selectable filter; `aria-pressed` = non-colour state signal |
| `ProgressBar` | `value`, `tone`, `size`, `label`, `showValue`, `ariaLabel` | determinate; `role=progressbar`; sm/md track |
| `ProgressRing` | `value`, `size`, `strokeWidth`, `tone`, `children`, `ariaLabel` | circular determinate; reduced-motion aware |
| `MasteryRing` | `value`, `size`, `strokeWidth`, `showLabel`, `bandLabel` | bands low `▲ At risk` / mid `◐ Developing` / high `● Strong` — **required icon + label backup** (deuteranopia-safe); `bandLabel(key)` for Hindi |
| `Skeleton` / `SkeletonText` / `SkeletonCircle` | `radius` · `lines` · `size`; sizing via passthrough classes | composable (not fixed shapes); no shimmer under reduced-motion |
| `EmptyState` | `icon`, `title`, `description`, `action`, `compact` | generalizes admin `NoDataState`; `role=status` |

**`--on-accent` token (added — see §8.1):** the semantic `--on-accent`
foreground token now exists (light `:root`, cosmic, and inert dark scopes), paired
and AA-verified against the `--btn-primary-*` CTA gradient. `TONE_SOLID_FG` still
uses the CSS `white` keyword; repointing it to `var(--on-accent)` is a follow-up
tracked in DD-12 (consumer migration is deferred to the page phases).

---

## 11. Form Primitives (Batch B1)

**Status:** Phase 2 Batch B1 — the canonical form-control layer, built on the
exact conventions of §10 (variant/size props, `tokens.ts` shared maps,
`forwardRef`, token-only, a11y-by-default). Same import path
(`@/components/ui/primitives`, `primitives` namespace on the barrel) and the
same coexistence rule — additive over the legacy dialects, nothing removed.
Source: `src/components/ui/primitives/{Field,Input,Textarea,Select,Checkbox,Radio,Switch}.tsx`.
Showcase: `/dev/ui` → "Form Primitives".

**Shared control tokens** (added to `primitives/tokens.ts`, reused by the
text-entry controls): `CONTROL_TEXT_SIZE` (height + type per `ControlSize` —
`md` = 48px touch, `sm` = 44px minimum), `CONTROL_TEXT_BASE` (surface + border +
focus-ring base), `CONTROL_INVALID` (danger border + ring, applied from the
resolved `aria-invalid`). No new CSS custom property was required.

### The Field contract (accessibility backbone)

`Field` is the composite wrapper every text-entry control sits inside. It owns
the id graph and pushes it down through **`FieldContext`**, which
`Input` / `Textarea` / `Select` read via the exported **`useFieldControl()`**
hook. `<Field label="…"><Input/></Field>` therefore wires, with zero prop
threading:

- `id` on the control ⇄ `htmlFor` on the `<label>` (auto-generated with
  `useId` unless `htmlFor` is passed);
- `aria-describedby` = `"<id>-hint <id>-error"` (only the parts that exist);
- `aria-invalid=true` whenever `error` is set (the error `<p>` is
  `role="alert"` and carries an icon — the state is **never colour-only**);
- `required` on the control + a shape marker (`*` glyph) + an SR-only word
  (`requiredText`, localisable) on the label — required is **not** signalled by
  colour alone;
- `disabled` propagated to the control.
Explicit props on the control always beat the context (escape hatch). `optional`
+ `optionalText` render a localisable "(optional)" affordance.

### Per-control a11y + API

| Primitive | Key props | A11y contract |
|---|---|---|
| `Field` | `label`, `htmlFor?`, `hint?`, `error?`, `required?`, `optional?`, `optionalText?`, `disabled?`, `requiredText?`, `errorIcon?` | Associates `<label>`↔control; builds `aria-describedby`; sets `aria-invalid`; error is `role="alert"` + icon; required = glyph + SR word |
| `Input` | `size` (sm/md/lg), `leadingAdornment?`, `trailingAdornment?`, all native `<input>` attrs | Native input; consumes Field context; 48px (md) target; adornments are `aria-hidden` + `pointer-events-none`; danger border/ring on invalid |
| `Textarea` | `minRows` (default 3), native `<textarea>` attrs | Native textarea; consumes Field context; vertical-only resize (360px-safe); invalid styling |
| `Select` | `size`, `placeholder?` (disabled hidden sentinel option), `options?` or `children`, native `<select>` attrs | **Native** `<select>` (mobile-correct + a11y-safe; no custom listbox this batch); token chevron is `aria-hidden`; consumes Field context |
| `Checkbox` | `label`, `hint?`, `error?`, `indeterminate?`, native attrs | Native checkbox; whole `<label>` ≥44px hit area (visual box 20px); focus-ring on box; `indeterminate` set on the DOM node + dash glyph; own `aria-describedby` |
| `Radio` | `label`, native attrs | Single native radio; ≥44px label hit area; dot via `peer-checked` |
| `RadioGroup` | `name` (required), `label` (legend), `options`, `value?`/`defaultValue?`, `onChange?`, `hint?`, `error?`, `required?`, `orientation?`, `requiredText?` | `<fieldset>` + `<legend>` grouping → native roving focus + arrow-key nav; `aria-describedby`/`aria-invalid`/`aria-required` on the fieldset; vertical or horizontal |
| `Switch` | `label`, `labelPosition?` (start/end), native attrs | Native `<input type="checkbox" role="switch">` → free keyboard toggle + on/off announcement; ≥44px label; thumb travel is `motion-reduce`-aware |

**Design decisions.** Native controls under the hood everywhere (best a11y +
mobile picker behaviour); a custom `Select` listbox is deliberately out of scope.
Radius is `rounded-lg` on text controls (control-family cohesion with `Button`)
and `rounded-md`/`rounded-full` on the check/radio boxes. No control forces a
serif face, so Devanagari renders correctly (proven by the `lang="hi"` sample on
`/dev/ui`). All copy (label / hint / error / placeholder / required + optional
words) is passed in — bilingual-safe (P7).

> **DD-15.** Override a `Field` control's id via **`Field htmlFor`**, never on the
> control itself — put `id` on the `<Input>`/`<Select>` and the `<label htmlFor>`
> keeps pointing at the auto-generated id, so label association silently desyncs.

## 12. Overlay Primitives (Batch B2)

**Status:** Phase 2 Batch B2 — the canonical overlay layer, same conventions as
§10/§11 (token-only, `forwardRef` where a DOM ref is meaningful, a11y-by-default,
copy via props/children — P7). Same import path (`@/components/ui/primitives`)
and the same additive coexistence rule: the existing bespoke modals (UpgradeModal,
SubscriptionConfirm, foxy/ReportIssueModal, admin-ui/DetailDrawer,
achievements/LevelUpModal, ui/toast) are untouched — they migrate onto this set
later. Source: `src/components/ui/primitives/{Dialog,Drawer,BottomSheet,Tooltip}.tsx`
+ the shared foundation in `primitives/overlay/`. Showcase: `/dev/ui` → "Overlays".

**New token.** `--scrim` was added to the token layer (light: warm-ink
`rgba(26,18,7,.45)`; dark: `rgba(0,0,0,.62)`) — it was genuinely missing. It is
declared in `globals.css` alongside `--border`/`--shadow-*` (which are also rgba
in the token layer) so overlays reference **only** `var(--scrim)`, never a raw
literal. The z-index rungs (`--z-overlay` scrim, `--z-modal` dialog/drawer/sheet,
`--z-tooltip`) already existed.

### Shared foundation (`primitives/overlay/`)

One substrate, reused by all four overlays — **no duplication**:

| Piece | Responsibility |
|---|---|
| `Portal` | Renders into `document.body` (SSR-safe: mounts only after hydration) so overlays escape ancestor `overflow`/`transform` clipping. |
| `useScrollLock(active)` | Locks `<body>` scroll while open. **Ref-counted** at module scope so nested/stacked overlays only unlock on the LAST release; compensates for scrollbar width to avoid layout jump. |
| `useFocusTrap(active, ref, opts)` | From scratch (no library). Focuses `initialFocusRef` or the first focusable on open; wraps Tab/Shift+Tab inside the panel; **restores focus to the trigger** on close. |
| `useEscapeKey(active, onEscape)` | Capture-phase Escape → close; stops propagation so one Escape closes only the frontmost overlay in a stack. |
| `usePresence(open, ms)` | Drives enter/exit: mounts immediately on open (flips `visible` next frame), plays the exit transition then unmounts. `prefers-reduced-motion` ⇒ instant. |
| `Scrim` | Token-driven backdrop (`var(--scrim)` on `--z-overlay`), optional click-to-dismiss + blur, reduced-motion fade. |

### Per-overlay a11y contract

| Primitive | Contract |
|---|---|
| `Dialog` / `ConfirmDialog` | Centered; `role="dialog"` `aria-modal="true"`; `aria-labelledby`←`DialogTitle`, `aria-describedby`←`DialogBody` (both auto-registered via context; falls back to `aria-label`); focus trap + restore; Escape + scrim-click close (both individually disable-able — `ConfirmDialog destructive` hardens both off); scroll-lock; sizes sm/md/lg. `ConfirmDialog` focuses **Cancel** first. |
| `Drawer` | Left/right side sheet; identical dialog semantics (`role="dialog"` `aria-modal`, `aria-labelledby`/`-describedby` from `title`/`description`); slide-X transition (reduced-motion aware); token-driven width (sm/md/lg via Tailwind `max-w` scale); optional close `IconButton` (needs `closeLabel`); Escape + scrim close. |
| `BottomSheet` | **Primary mobile pattern.** Bottom-anchored, snaps to content height (`maxHeight: 90dvh`), `safe-area-inset-bottom` padding via `.safe-bottom`. Full dialog a11y contract. Visible **drag handle is a real `<button>`** (keyboard/click close fallback) that also affords **swipe-to-dismiss** via pointer events (no lib): drag down past ~110px (or flick) closes, short drag snaps back; `touch-none` on the handle. Escape + scrim close too. |
| `Tooltip` | Supplementary hint. Shows on **hover AND keyboard focus**; wires `aria-describedby` trigger→`role="tooltip"` node; **touch**: tap shows / tap-away hides; positioned top/bottom/left/right, **flips + clamps** to stay in the viewport (body-portalled, `fixed`); reduced-motion fade; **never uses the native `title` attribute** (no browser dialog). Tooltips are supplementary — never the ONLY way to reach information. |

**Bilingual (P7).** Every overlay takes its copy through props/children —
titles, descriptions, button labels, `closeLabel`/`handleLabel`, and tooltip
`content`. Nothing is hardcoded; callers localise via `AuthContext.isHi`.
