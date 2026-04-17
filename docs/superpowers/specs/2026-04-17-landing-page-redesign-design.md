# Landing Page Redesign — "The 60-Second Pitch"

**Date**: 2026-04-17
**Status**: Approved
**Author**: Orchestrator + User (CEO)
**Scope**: `/welcome` page redesign — parent-focused, short-form, high-conversion

---

## 1. Context & Goals

### What exists today
The current `/welcome` page (`src/app/welcome/page.tsx`) is an 800-line monolithic component with 14 sections. It speaks to 4 audiences simultaneously (students, parents, teachers, schools), contains significant content redundancy (same value props repeated across Problem, Solution, Results, and Audience sections), uses no images or animations despite having an Animations component ready, and reads like product documentation rather than a marketing page.

### What we're building
A **5-section + footer** landing page laser-focused on converting **Indian parents** (the decision-makers and payers) into free signups. The page uses aspiration ("your child walks into exams confident") and social proof (institutional credibility, product-scope metrics) as primary emotional drivers.

### Design principles
1. **Parent-first**: Every pixel speaks to a parent deciding at 10pm on their phone
2. **Product as proof**: Real UI mockups > descriptions. Show, don't tell
3. **Honest credibility**: DPIIT + NCERT + product-scope facts. No fake metrics or testimonials
4. **Premium visual identity**: Custom CSS icons and graphics, no generic emoji or icon libraries
5. **Performance**: Stay within P10 bundle budget (shared JS < 160 kB, page < 260 kB). All visuals are CSS-only
6. **Bilingual**: Everything in Hindi + English via existing `LangProvider`

### Success criteria
- Parent can understand the full value proposition within 60 seconds of scrolling
- Single clear conversion path: free signup
- Page loads under 3s on Indian 4G (2-5 Mbps)
- All existing Animations.tsx components (FadeIn, Stagger, HoverScale) are used
- No new heavy JS dependencies added

---

## 2. Page Structure

```
Section 1: Hero (aspiration + product visual)
Section 2: Problem -> Solution (mirror flip, 3+3 cards)
Section 3: Product in 30 Seconds (3 elevated mockups)
Section 4: Credibility Strip (compact trust band)
Section 5: Final CTA + 3-Question FAQ
Footer
```

Total: ~6 scroll-stops on mobile. Approximately 60% shorter than current page.

---

## 3. Section Specifications

### 3.1 Hero — "The 60-Second Hook"

**Layout**: Full viewport height on mobile, ~85vh on desktop. Cream background (`#FBF8F4`) with subtle mesh gradient overlay (existing `.mesh-bg` class).

**Desktop**: Left/right split. Text on left, phone mockup on right.
**Mobile**: Stacked. Text above, phone mockup below.

#### Content

**Pill badge** (top):
- EN: `CBSE Grades 6-12 . Hindi & English`
- HI: `CBSE कक्षा 6-12 . हिन्दी और अंग्रेज़ी`
- Icon: Custom Ashoka Chakra-inspired motif (CSS, not emoji flag)
- Style: `text-xs font-bold px-4 py-1.5 rounded-full`, orange-tinted background

**Headline**:
- EN: "What if your child walked into every exam knowing they're prepared?"
- HI: "क्या होगा अगर आपका बच्चा हर परीक्षा में तैयार होकर जाए?"
- Font: Sora, `text-3xl sm:text-5xl`, extrabold
- "every exam" / "हर परीक्षा" gets `.gradient-text` treatment (orange-to-gold)

**Subheadline**:
- EN: "Alfanumrik is a structured learning system that replaces guesswork with real concept clarity — so you stop worrying and start seeing progress."
- HI: "Alfanumrik एक संरचित शिक्षा प्रणाली है जो अंदाज़ों की जगह असली कॉन्सेप्ट क्लैरिटी लाती है — ताकि आप चिंता करना बंद करें और प्रगति देखना शुरू करें।"
- Font: Plus Jakarta Sans, `text-sm sm:text-lg`, color `--text-2`

**Primary CTA button**:
- EN: "Start Learning Free" / HI: "मुफ्त सीखना शुरू करें"
- Style: `py-4 px-8 rounded-xl font-bold text-white`, `background: linear-gradient(135deg, #E8581C, #F5A623)`
- Links to: `/login`

**Micro-text below CTA**:
- EN: "No credit card . 5 free sessions daily . Cancel anytime"
- HI: "क्रेडिट कार्ड नहीं . रोज़ 5 मुफ्त सेशन . कभी भी रद्द करें"
- Style: `text-xs --text-3`

**Secondary link**:
- EN: "Are you a teacher?" / HI: "क्या आप शिक्षक हैं?"
- Links to: `/login?role=teacher`
- Style: `text-xs --text-3`, subtle underline on hover

#### Hero Visual — Phone Mockup

A floating phone frame showing the Foxy AI tutor conversation:
- CSS-constructed phone bezel (rounded corners `3xl`, subtle inner shadow, thin `--border` outline)
- Content inside: Foxy tutor conversation mockup (student asks about photosynthesis in Hinglish, Foxy responds step-by-step)
- Student message: "Photosynthesis samjhao step by step"
- Foxy response with Step 1, Step 2, Step 3 + chemical equation + follow-up question
- Branded Foxy avatar (geometric CSS fox, not emoji) in the conversation
- `float` animation from Tailwind config (3s ease-in-out, 4px vertical movement)
- Small fox mascot peeking from behind the phone (CSS-only, rotated, with shadow)

#### Stats Strip

Below hero content, still above fold on desktop. Four metrics in horizontal row:

| Value | Label EN | Label HI |
|-------|----------|----------|
| 16 | Subjects | विषय |
| 6-12 | Grades | कक्षाएँ |
| हिन्दी+En | Bilingual | द्विभाषी |
| DPIIT | Recognized | मान्यता प्राप्त |

- Style: `text-sm sm:text-xl font-extrabold` for values (in `--orange`), `text-xs` for labels
- `FadeIn` animation with staggered delays (0s, 0.1s, 0.2s, 0.3s)

#### Sticky Mobile CTA Bar

- Appears when user scrolls past hero CTA button (IntersectionObserver, same pattern as `useInView`)
- Height: 56px, cream background with `backdrop-blur(20px)`
- Contains: compact "Start Free" orange button + "For Parents" text
- Disappears when final CTA section enters viewport
- Mobile only (`sm:hidden`)

#### Navigation (simplified)

Current nav has: Logo | Product | Pricing | For Schools | Book Demo | LangToggle | Log In | Sign Up
New nav: **Logo | LangToggle | Log In | Sign Up Free**

- Product/Pricing/For Schools/Book Demo links move to footer
- Keeps sticky behavior with blur backdrop (existing pattern)
- Sign Up Free button: orange background, bold

---

### 3.2 Problem -> Solution — "The Mirror Flip"

**Layout**: Single section. Background: `--surface-1`. Max-width `5xl`. Padding `py-12 sm:py-16`.

**Section badge**: "THE REAL PROBLEM" / "असली समस्या" (orange pill)

**Section headline**:
- EN: "Most students study hard. The system they follow doesn't work."
- HI: "ज़्यादातर बच्चे मेहनत करते हैं। जो सिस्टम वो फॉलो करते हैं, वो काम नहीं करता।"

#### Top half — Problem Cards (3 cards)

Horizontal row on desktop, vertical stack on mobile. Each card: icon on left, title + one-liner on right. `FadeIn` with stagger (0s, 0.15s, 0.3s).

**Card 1:**
- Icon: Custom line-art brain with dotted fade-out (CSS gradients + borders — represents concepts not sticking)
- EN: "Concepts don't stick" / "They read the chapter, attend the class — and still can't answer the exam question."
- HI: "कॉन्सेप्ट याद नहीं रहते" / "चैप्टर पढ़ते हैं, क्लास जाते हैं — फिर भी परीक्षा में जवाब नहीं दे पाते।"

**Card 2:**
- Icon: Custom scattered dots converging nowhere (CSS positioned dots — represents random practice)
- EN: "Practice is random" / "50 easy questions don't fix the 5 hard ones they keep getting wrong."
- HI: "प्रैक्टिस बेतरतीब है" / "50 आसान सवाल हल करने से वो 5 कठिन सवाल ठीक नहीं होते जो बार-बार गलत होते हैं।"

**Card 3:**
- Icon: Custom eye with strike-through (CSS clip-path + line — represents no visibility for parent)
- EN: "You can't see the real picture" / "By the time the report card arrives, months of gaps have already piled up."
- HI: "आपको असली तस्वीर नहीं दिखती" / "जब तक रिपोर्ट कार्ड आता है, महीनों की कमियाँ जमा हो चुकी होती हैं।"

Card style: `rounded-2xl p-5`, background `--bg`, border `1px solid --border`

#### Visual Connector

Gradient divider between problem and solution halves:
- Horizontal line (orange-to-purple gradient, 1px)
- Centered circle with downward arrow icon
- Text: "Here's what changes" / "यहाँ बदलाव आता है" in `text-xs font-bold`, orange

#### Bottom half — Solution Cards (3 cards, mapped 1:1 to problems)

Same layout as problem cards but with `border-l-3` in `#16A34A` (green left border = solution signal). `StaggerItem` animation.

**Card 1 (answers Pain 1):**
- Icon: Custom brain outline with glowing connected nodes (CSS radial gradients — represents clarity achieved)
- EN: "Concepts explained until they click" / "Foxy AI tutor breaks every topic step-by-step. In Hindi or English. Adapts to what your child already knows."
- HI: "कॉन्सेप्ट तब तक समझाए जाते हैं जब तक समझ न आ जाए" / "Foxy AI ट्यूटर हर टॉपिक स्टेप-बाय-स्टेप समझाता है। हिन्दी या अंग्रेज़ी में। बच्चे की मौजूदा समझ के अनुसार ढलता है।"

**Card 2 (answers Pain 2):**
- Icon: Custom arrow hitting bullseye (CSS concentric circles + triangle arrow — represents targeted practice)
- EN: "Practice targets weak spots only" / "Smart quizzes adapt to your child's level. Board-exam patterns. Bloom's taxonomy built in. No wasted repetition."
- HI: "प्रैक्टिस सिर्फ कमज़ोर जगहों पर" / "स्मार्ट क्विज़ बच्चे के स्तर के अनुसार बदलते हैं। बोर्ड परीक्षा पैटर्न। Bloom's टैक्सोनॉमी शामिल। बेकार दोहराव नहीं।"

**Card 3 (answers Pain 3):**
- Icon: Custom open eye with dashboard reflection (CSS clip-path eye shape + small bar chart inside — represents daily visibility)
- EN: "You see progress every day" / "Your parent dashboard shows what they studied, what's strong, what needs work — updated after every session."
- HI: "आप हर दिन प्रगति देखते हैं" / "आपका पैरेंट डैशबोर्ड दिखाता है क्या पढ़ा, क्या मज़बूत है, किस पर काम चाहिए — हर सेशन के बाद अपडेट।"

Card style: Same as problem cards + green left border + `HoverScale` on desktop

---

### 3.3 Product in 30 Seconds — "See What You Get"

**Layout**: Background `--bg`. Max-width `5xl`. Padding `py-12 sm:py-16`.

**Section badge**: "SEE IT IN ACTION" / "देखें कैसे काम करता है"
**Section headline**:
- EN: "Real product. Real interface. Not stock photos."
- HI: "असली प्रोडक्ट। असली इंटरफ़ेस। स्टॉक फ़ोटो नहीं।"

Desktop: 3 cards side by side, center card elevated (+8px translateY, larger shadow).
Mobile: Vertical stack with Parent Dashboard card first. No carousel — carousels have poor discoverability on mobile and parents may miss cards.

#### Card 1: "What your child sees" — Foxy AI Tutor

Frame: `rounded-2xl`, inner shadow, thin border, device-bezel feel.

Content:
- Top bar: Foxy header with branded fox avatar + mode pills (Learn / Practice / Quiz)
- Student bubble: "Photosynthesis samjhao step by step" (Hinglish)
- Foxy reply: step-by-step explanation with chemical equation
- Foxy follow-up question: "Bata sakte ho chlorophyll kahan hota hai?"
- Typing indicator
- Shadow: `0 4px 24px rgba(0,0,0,0.06)`

Label below: "Your child asks. Foxy explains. In Hindi, English, or both." / "आपका बच्चा पूछता है। Foxy समझाता है। हिन्दी, अंग्रेज़ी, या दोनों में।" (`text-xs --text-2`)

#### Card 2: "What YOU see" — Parent Dashboard (HIGHLIGHTED)

Frame: Same style + green glow (`box-shadow: 0 8px 32px rgba(22,163,74,0.12)`) + floating badge "For You" / "आपके लिए" in green at top-right.

Content:
- Child info: Avatar with warm gradient circle (orange-to-cream) + initial "A", "Aarav Sharma", "Class 8 . CBSE", green "Active today" dot
- This Week summary: 3 metrics in pills — `5 Quizzes | 82% Avg | 45m Study`
- Strengths / Weaknesses: Two side-by-side boxes with small horizontal progress bar indicators:
  - Strong (green left-border): "Algebra, Photosynthesis, Grammar" with high-filled bars
  - Needs Work (orange left-border): "Geometry, Chemical Reactions" with partially-filled bars

Desktop: `float` animation (subtle 4px up/down, 4s cycle).

Label below: "See what they studied. Know what's weak. No surprises." / "देखें क्या पढ़ा। जानें क्या कमज़ोर है। कोई सरप्राइज़ नहीं।" (`text-xs --text-2`)

#### Card 3: "How they improve" — Smart Quiz

Frame: Standard card with blue accent (`#2563EB`).

Content:
- Top bar: "Smart Quiz" + Bloom's level pill with layered-triangle icon (3 CSS triangles, active level highlighted) + Difficulty pill "Medium"
- Progress: Segmented bar (10 small blocks, 7 filled) — not smooth gradient
- Question: "Which of the following is the correct product of photosynthesis?"
- 4 options: A, B (correct, green highlight), C, D
- Feedback preview: "Correct! +10 XP" with star-burst XP icon (CSS `clip-path`)

Label below: "Board-pattern questions. Instant feedback. Real improvement." / "बोर्ड-पैटर्न सवाल। तुरंत फीडबैक। असली सुधार।" (`text-xs --text-2`)

#### Animation
- `StaggerContainer` + `StaggerItem` with 0.15s delay
- Center card: `float` animation on desktop
- All cards: `HoverScale` on desktop hover

---

### 3.4 Credibility Strip — "Trust Without Bragging"

**Layout**: Slim band. Background: warm gradient from `rgba(232,88,28,0.03)` to `rgba(124,58,237,0.03)`. Thin top/bottom borders. Padding: `py-8 sm:py-10`. Centered.

#### Layer 1: Institutional Trust Badges

Five glass-pill badges in horizontal flex-wrap row. Each badge: `text-xs font-semibold rounded-full px-4 py-2`, glass-morphism (`backdrop-blur-sm bg-white/60 border-white/40`).

| Custom Icon | Label EN | Label HI |
|-------------|----------|----------|
| Ashoka Chakra motif (CSS `conic-gradient` + thin spokes in navy/orange, circular) | DPIIT Recognized Startup | DPIIT मान्यता प्राप्त स्टार्टअप |
| Shield shape (CSS `clip-path`, green-to-teal gradient fill) | DPDPA Compliant | DPDPA अनुपालित |
| Geometric padlock (two overlapping rounded rects + circle keyhole, gold accent) | Data Encrypted | डेटा एन्क्रिप्टेड |
| Open book (two CSS parallelograms meeting at spine, NCERT green `#16A34A`) | NCERT Aligned | NCERT के अनुरूप |
| Prohibition circle (circle + diagonal line, clean geometric, muted red) | No Ads. Ever. | कभी विज्ञापन नहीं। |

`FadeIn` with stagger on viewport entry.

#### Layer 2: Metrics Line

Single horizontal line of product-scope facts:

- EN: "16 subjects . 7 grades . 115 STEM experiments . 6 Bloom's levels in every quiz . Hindi & English . Built in India"
- HI: "16 विषय . 7 कक्षाएँ . 115 STEM प्रयोग . हर क्विज़ में 6 Bloom's स्तर . हिन्दी और अंग्रेज़ी . भारत में निर्मित"

Style: `text-sm font-medium --text-2`, metric values in `font-bold --text-1`, dot separators in `--orange` with slight opacity. Wraps naturally on mobile.

#### Layer 3: Aspirational Social Proof Line

- EN: "Trusted by parents who want more than tuition classes."
- HI: "उन माता-पिता का भरोसा जो ट्यूशन क्लास से ज़्यादा चाहते हैं।"
- Style: `text-xs --text-3 italic`
- Below: `Cusiosense Learning India Pvt. Ltd. . CIN: U58200UP2025PTC238093` in `text-[10px] --text-3`

#### Future expansion slots
- Testimonials: Add Layer 2.5 — single rotating parent quote (name, city, child's grade)
- School logos: Add to Layer 1 as subtle logo strip
- User counts: Prepend to metrics line ("2,000+ students . 16 subjects . ...")

---

### 3.5 Final CTA + Compressed FAQ — "The Close"

**Layout**: Mesh gradient background (`mesh-bg` at 40% opacity over cream). Padding: `py-14 sm:py-20`. Centered.

#### Part 1: Closing Pitch

**Foxy mark**: Large branded CSS fox avatar (`w-16 h-16`). `scale-in` animation on viewport entry.

**Headline**:
- EN: "Every week without a system is a week of guesswork."
- HI: "बिना सिस्टम के हर हफ्ता अंदाज़ों का हफ्ता है।"
- Font: Sora, `text-2xl sm:text-4xl`, extrabold. "guesswork" / "अंदाज़ों" gets `.gradient-text`

**Subheadline**:
- EN: "Start free. See the difference in how your child studies within the first week."
- HI: "मुफ्त शुरू करें। पहले हफ्ते में ही फर्क देखें।"
- Style: `text-sm sm:text-lg --text-2`

**Primary CTA**:
- EN: "Start Learning Free" / HI: "मुफ्त सीखना शुरू करें"
- Style: `py-4 px-10 rounded-2xl text-base font-bold text-white`, orange-to-gold gradient
- Idle animation: `pulse-glow` — expanding glow ring every 3s via CSS `box-shadow` keyframe
- Links to: `/login`

**Micro-text**: "No credit card . 5 free sessions daily . Works on any phone" / "क्रेडिट कार्ड नहीं . रोज़ 5 मुफ्त सेशन . किसी भी फ़ोन पर" (`text-xs --text-3`)

**Secondary role links**: "I'm a teacher . I'm a student" / "मैं शिक्षक हूँ . मैं छात्र हूँ" — `text-xs --text-3`, subtle underline on hover. Links to `/login?role=teacher` and `/login`.

#### Part 2: Compressed FAQ

Positioned below CTA with `mt-12`. Max-width `2xl`.

Mini-heading: "Quick answers" / "त्वरित जवाब" — `text-sm font-bold --text-3`

3 collapsible `<details>` elements. Native HTML, zero JS:

**Q1**: "Is it really free?" / "क्या यह सच में मुफ्त है?"
- A: "Yes. The free plan includes 5 AI tutor sessions and 5 quizzes per day across 2 subjects. No credit card needed. Upgrade to Starter (₹399/mo), Pro (₹699/mo), or Unlimited (₹999/mo) when you want more."
- A (HI): "हाँ। फ्री प्लान में रोज़ 2 विषयों में 5 AI ट्यूटर सेशन और 5 क्विज़ शामिल हैं। क्रेडिट कार्ड नहीं चाहिए। Starter (₹399/माह), Pro (₹699/माह), या Unlimited (₹999/माह) में अपग्रेड करें जब ज़रूरत हो।"

**Q2**: "Is it safe for my child?" / "क्या यह मेरे बच्चे के लिए सुरक्षित है?"
- A: "All data is encrypted. We follow India's DPDPA data protection rules. We never show ads, never sell data, and AI responses are filtered to stay age-appropriate and within CBSE curriculum."
- A (HI): "सारा डेटा एन्क्रिप्टेड है। हम भारत के DPDPA डेटा सुरक्षा नियमों का पालन करते हैं। हम कभी विज्ञापन नहीं दिखाते, कभी डेटा नहीं बेचते, और AI जवाब उम्र के अनुसार और CBSE पाठ्यक्रम के अंदर रहते हैं।"

**Q3**: "Which grades and subjects?" / "कौन सी कक्षाएँ और विषय?"
- A: "CBSE Grades 6-12. 16 subjects including Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Science, and more."
- A (HI): "CBSE कक्षा 6-12। 16 विषय जिनमें गणित, विज्ञान, भौतिकी, रसायन विज्ञान, जीव विज्ञान, अंग्रेज़ी, हिन्दी, सामाजिक विज्ञान, और बहुत कुछ शामिल है।"

FAQ card style: `rounded-2xl`, `--bg` background, `--border` border, `text-sm`. Custom CSS chevron animates on open/close.

---

### 3.6 Footer — "Clean Authority"

**Layout**: Background `--surface-1`. Top border. Padding `py-8 sm:py-10`. Max-width `5xl`.

#### Row 1: Three columns (desktop), stacked (mobile)

**Column 1 — Brand:**
- Branded fox mark (small, `w-8 h-8`) + "Alfanumrik" in Sora extrabold with gradient
- "Structured learning for CBSE students" / "CBSE छात्रों के लिए संरचित शिक्षा" in `text-xs --text-3`

**Column 2 — Quick Links:**
- Product: `/pricing`, `/for-schools`
- Account: `/login`, `/login?role=parent` (label: "Parent Login"), `/login?role=teacher` (label: "Teacher Login")
- Only link to pages that exist

**Column 3 — Contact & Legal:**
- Email: support@alfanumrik.com
- Legal: `/privacy`, `/terms`

#### Row 2: Bottom bar

Left: `(c) 2026 Cusiosense Learning India Pvt. Ltd. All rights reserved.` / Hindi equivalent
Right: `DPIIT Recognized . DPDPA Compliant . Data Encrypted . No Ads` in `text-xs --text-3`
CIN number as quiet legal detail.

---

## 4. Visual Language System

### 4.1 The Foxy Mark

A distinctive CSS-only geometric fox avatar. Replaces every `🦊` emoji on the page.

**Construction:**
- Circular base: orange-to-gold gradient background (`linear-gradient(135deg, #E8581C, #F5A623)`)
- Two triangular ears: CSS `clip-path` or `border` triangles, slightly darker orange
- Minimal white inner detail: two small circular dots (eyes), small triangular nose
- No external images or SVGs — pure CSS

**Sizes:**
- Small (`w-7 h-7`): Chat avatars, inline references
- Medium (`w-12 h-12`): Section accents, card headers
- Large (`w-16 h-16`): Final CTA anchor

### 4.2 Custom Icon System

No emoji. No generic icon libraries. Every icon is a custom CSS construction using gradients, borders, clip-path, and positioned elements.

#### Problem card icons:

**Pain 1 — "Concepts don't stick":**
Brain outline with dotted fade-out. CSS construction: rounded shape with internal curved lines (using `border-radius` on child elements), dots created with `radial-gradient` that fade to transparent on one side. Colors: `--text-3` for outline, fading to transparent. Communicates: knowledge dissolving.

**Pain 2 — "Practice is random":**
Scattered dots converging nowhere. CSS construction: 6-8 small circles (`border-radius: 50%`) positioned pseudo-randomly using absolute positioning within a square container. Colors: mix of `--text-3` and `--orange` at varying opacity. Communicates: chaos, no direction.

**Pain 3 — "You can't see the real picture":**
Eye with strike-through. CSS construction: eye shape using `border-radius` and `clip-path` (oval with pointed ends), circular pupil inside, diagonal line (`transform: rotate(-45deg)`) crossing through. Colors: `--text-3` for eye, `--orange` for strike line. Communicates: blindness, no visibility.

#### Solution card icons:

**Solution 1 — "Concepts explained until they click":**
Brain outline with glowing connected nodes. CSS construction: same brain shape as Pain 1 but with small circles at intersections connected by lines, with a subtle glow effect (`box-shadow` with orange spread). Colors: `--orange` for nodes, `--text-2` for connections. Communicates: neural connections forming.

**Solution 2 — "Practice targets weak spots only":**
Arrow hitting bullseye. CSS construction: three concentric circles (borders) with a triangular arrow element pointing to center. Colors: outer rings in `--text-3`, center in `--orange`, arrow in `--orange`. Communicates: precision, targeting.

**Solution 3 — "You see progress every day":**
Open eye with dashboard reflection. CSS construction: same eye shape as Pain 3 but without strike-through, pupil contains a tiny bar chart (3 vertical bars of increasing height using `div` elements). Colors: eye in `#16A34A` (green), bars in white/light. Communicates: clear vision, data visibility.

#### Trust badge icons:

| Badge | CSS Construction | Colors |
|-------|-----------------|--------|
| DPIIT | Ashoka Chakra motif: circle with 8 thin spokes using `conic-gradient` segments | Navy `#1a237e` + orange accents |
| DPDPA | Shield: `clip-path: polygon()` forming shield silhouette with layered fill | Green-to-teal gradient `#16A34A -> #0891B2` |
| Encrypted | Padlock: two overlapping rounded rectangles (body + shackle) with circle keyhole | Gold `#D97706` body, dark shackle |
| NCERT | Open book: two parallelogram `div`s meeting at a spine, slight page-fan effect | NCERT green `#16A34A` |
| No Ads | Prohibition: circle (`border`) with diagonal line (`transform: rotate(-45deg)`) | Muted red `#DC2626` at 70% opacity |

#### Product card icons:

| Element | CSS Construction |
|---------|-----------------|
| Foxy avatar (in chat) | Small Foxy Mark (see 4.1) |
| Bloom's level indicator | Three stacked triangles using `clip-path`, active level highlighted in blue `#2563EB` |
| XP reward icon | Star-burst shape using CSS `clip-path: polygon()` with 8 points, orange fill |
| Progress bar (quiz) | 10 individual `div` blocks with rounded corners, filled blocks use orange-to-gold gradient |
| Mastery bars (parent card) | Thin horizontal bars with rounded ends, filled portion uses contextual color (green for strong, orange for needs-work) |

### 4.3 Color Application

| Element | Color | CSS Value |
|---------|-------|-----------|
| Primary CTA, headline accents, Foxy brand, progress fills | Orange-to-Gold gradient | `linear-gradient(135deg, #E8581C, #F5A623)` |
| Secondary accents, Bloom's, level badges | Purple | `#7C3AED` |
| Parent-specific elements, solution signals, "strong" | Green | `#16A34A` |
| Quiz/learning elements, teacher references | Blue | `#2563EB` |
| Problem/attention/warning, "needs work" | Warm orange (low opacity) | `#E8581C` at 8-15% opacity for backgrounds |
| Backgrounds | Cream + surface layers | `#FBF8F4`, `var(--surface-1)`, `var(--surface-2)` |
| Text hierarchy | Dark / Medium / Light | `var(--text-1)`, `var(--text-2)`, `var(--text-3)` |
| Glass-morphism (trust badges) | White at 60% + blur | `bg-white/60 backdrop-blur-sm` |

### 4.4 Typography

| Role | Font | Size | Weight |
|------|------|------|--------|
| Hero headline | Sora | `text-3xl sm:text-5xl` | 800 (extrabold) |
| Section headlines | Sora | `text-2xl sm:text-3xl` | 800 |
| Card titles | Sora | `text-sm` | 700 (bold) |
| Body text, descriptions | Plus Jakarta Sans | `text-sm` | 400 |
| Micro text, labels, captions | Plus Jakarta Sans | `text-xs` | 500 (medium) |
| Metric values | Plus Jakarta Sans | `text-sm sm:text-xl` | 800 |
| Badge text | Plus Jakarta Sans | `text-xs` | 600 (semibold) |

### 4.5 Animation System

All animations use existing infrastructure — no new dependencies.

| Animation | Source | Usage |
|-----------|--------|-------|
| `FadeIn` | `Animations.tsx` | Sections on viewport entry, individual elements |
| `StaggerContainer` + `StaggerItem` | `Animations.tsx` | Card groups (0.15s delay between items) |
| `HoverScale` | `Animations.tsx` | Product cards, trust badges on desktop hover |
| `float` | `tailwind.config.js` | Hero phone mockup, center product card |
| `scale-in` | `tailwind.config.js` | Foxy mark in final CTA |
| `pulse-glow` (NEW) | New CSS keyframe (~5 lines) | Final CTA button idle glow |
| `sticky-reveal` (NEW) | New CSS transform + existing `useInView` pattern | Mobile sticky CTA bar slide-up |

New CSS keyframes to add:

```css
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 88, 28, 0.3); }
  50% { box-shadow: 0 0 0 12px rgba(232, 88, 28, 0); }
}
```

---

## 5. Responsive Strategy

| Breakpoint | Layout Behavior |
|------------|----------------|
| Mobile (< 640px) | Everything stacks vertically. Hero: text then phone mockup. Product cards: vertical stack (parent card first) or horizontal snap-scroll. Sticky CTA bar visible. Nav: logo + lang + signup only. |
| Tablet (640-1024px) | Hero: left/right split begins. Cards: 2-column grid. Sticky CTA bar hidden. |
| Desktop (> 1024px) | Full layout. Hero: left/right split. Cards: 3-column. Center card elevated. All hover effects active. |

Target: Indian 4G (2-5 Mbps). Page should load and be interactive within 3 seconds on a mid-range Android phone. All visuals are CSS-only (no image downloads). Font loading via existing `next/font` setup.

---

## 6. Content Migration Plan

### Stays on /welcome (redesigned)
- Hero value proposition (rewritten for parent focus)
- Problem/solution framing (compressed from 4+3+5+4 sections to 3+3 cards)
- Product mockups (elevated from current "See It In Action")
- Trust badges (compressed into strip)
- Final CTA (refined)
- FAQ (cut from 6 to 3)
- Footer (simplified)

### Moves to other pages
| Content | Current Location | New Location |
|---------|-----------------|--------------|
| How It Works (5-step cycle) | /welcome | /product |
| 6 feature cards ("Built for Indian students") | /welcome | /product |
| For Teachers section (3 points) | /welcome | /for-schools |
| For Schools section (3 points) | /welcome | /for-schools |
| "What's Live / Coming Next" | /welcome | /product |
| "Systems over shortcuts" philosophy | /welcome | /about (future) |
| 3 of 6 FAQs | /welcome | /pricing FAQ or /help |

### Deleted (redundant)
- Results/Outcomes section (duplicates Solution section messaging)
- "For Students" audience section (covered by product mockup cards)

---

## 7. Technical Constraints

1. **P10 Bundle Budget**: Shared JS < 160 kB, page < 260 kB. No new npm packages. All icons and graphics are CSS-only.
2. **P7 Bilingual**: All text via existing `LangProvider` and `useLang()` from `src/components/landing/LangToggle.tsx`. No infrastructure changes needed.
3. **SEO**: Metadata stays in `src/app/welcome/layout.tsx` (Server Component). Update OpenGraph title/description to match new headline. FAQ schema (JSON-LD) updated to new 3-question set.
4. **Accessibility**: All interactive elements have aria-labels. Color contrast ratios meet WCAG AA. Focus states on all buttons/links. FAQ uses native `<details>` (keyboard accessible).
5. **No breaking changes to other pages**: `/product`, `/pricing`, `/for-schools`, `/demo` continue to work. Content moved from `/welcome` to these pages is a separate follow-up task, not part of this redesign.
6. **Component structure**: Break the monolithic 800-line file into separate components for maintainability:
   - `src/components/landing/Hero.tsx`
   - `src/components/landing/ProblemSolution.tsx`
   - `src/components/landing/ProductShowcase.tsx`
   - `src/components/landing/CredibilityStrip.tsx`
   - `src/components/landing/FinalCTA.tsx`
   - `src/components/landing/Footer.tsx`
   - `src/components/landing/FoxyMark.tsx` (reusable branded fox avatar)
   - `src/components/landing/CustomIcons.tsx` (all CSS-only icon components)
   - `src/components/landing/StickyMobileCTA.tsx`
   - Main `src/app/welcome/page.tsx` composes these components

---

## 8. Files Affected

### Modified
- `src/app/welcome/page.tsx` — Complete rewrite (compose new components)
- `src/app/welcome/layout.tsx` — Update SEO metadata to match new headline/description

### New files
- `src/components/landing/Hero.tsx`
- `src/components/landing/ProblemSolution.tsx`
- `src/components/landing/ProductShowcase.tsx`
- `src/components/landing/CredibilityStrip.tsx`
- `src/components/landing/FinalCTA.tsx`
- `src/components/landing/Footer.tsx`
- `src/components/landing/FoxyMark.tsx`
- `src/components/landing/CustomIcons.tsx`
- `src/components/landing/StickyMobileCTA.tsx`

### Unchanged (used as-is)
- `src/components/landing/Animations.tsx` — Now imported and used
- `src/components/landing/LangToggle.tsx` — No changes needed
- `src/components/landing/T.tsx` — No changes needed

### Not touched (separate follow-up)
- `/product`, `/pricing`, `/for-schools`, `/demo` pages — Content migration from old `/welcome` to these pages is out of scope for this task

---

## 9. Out of Scope

- Creating actual image assets (illustrations, photos, screenshots) — all visuals are CSS-only
- Content migration to `/product`, `/for-schools`, `/about` pages
- Changes to authentication flow or signup process
- Changes to pricing plans or payment flow
- Mobile app (Flutter) changes
- A/B testing infrastructure
- Analytics event tracking (can be added as follow-up)