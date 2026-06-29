# Cross-Cutting P7 Server-Notification Bilingual Fix — IMPLEMENTATION (Cycle 8)

Owner: backend. File changed: `supabase/functions/daily-cron/index.ts` ONLY. No commit made.

House shape matched: top-level English (`title`/`message`/`body`) + Hindi twin in
`data.title_hi` / `data.body_hi`. Evidence: `00000000000000_baseline_from_prod.sql:12503-12521`
(no `*_hi` columns), `notifications/page.tsx:195-198` (client reads `data.*_hi` only),
`notification-triggers.ts:387-390` (verified contract), `daily-cron/index.ts:1582-1586` (in-file
compliant model).

---

## XC-1 — score-milestone producers (student-facing). Added `data.title_hi` + `data.body_hi`.

### A) Score-drop producer (`recalcPerformanceScores`, ~:569-579)

BEFORE:
```ts
          title: `Your ${subject} score dropped by ${Math.round(drop)} points`,
          body: `Your Performance Score went from ${Math.round(prevScore)} to ${Math.round(rounded)}. Review some topics to bring it back up!`,
          data: { subject, previous: prevScore, current: rounded, change: -drop },
```
AFTER:
```ts
          title: `Your ${subject} score dropped by ${Math.round(drop)} points`,
          body: `Your Performance Score went from ${Math.round(prevScore)} to ${Math.round(rounded)}. Review some topics to bring it back up!`,
          // P7 — Hindi twin rides data.title_hi / data.body_hi (the notifications
          // table has NO top-level *_hi columns; the client reads data.*_hi — see
          // notifications/page.tsx and notification-triggers.ts house-shape note).
          data: {
            subject, previous: prevScore, current: rounded, change: -drop,
            title_hi: `तुम्हारा ${subject} स्कोर ${Math.round(drop)} अंक गिर गया`,
            body_hi: `तुम्हारा Performance Score ${Math.round(prevScore)} से ${Math.round(rounded)} हो गया। इसे फिर से बढ़ाने के लिए कुछ टॉपिक दोहराओ!`,
          },
```

### B) Crossed-above-80 producer (~:582-593)

BEFORE:
```ts
          title: `Great job! ${subject} score reached ${Math.round(rounded)}`,
          body: `You've crossed 80 in ${subject}. Keep up the excellent work!`,
          data: { subject, previous: prevScore, current: rounded, milestone: 80 },
```
AFTER:
```ts
          title: `Great job! ${subject} score reached ${Math.round(rounded)}`,
          body: `You've crossed 80 in ${subject}. Keep up the excellent work!`,
          data: {
            subject, previous: prevScore, current: rounded, milestone: 80,
            title_hi: `बहुत बढ़िया! ${subject} स्कोर ${Math.round(rounded)} तक पहुँच गया`,
            body_hi: `तुमने ${subject} में 80 पार कर लिया। बढ़िया काम जारी रखो!`,
          },
```

### C) Dropped-below-50 producer (~:596-607)

BEFORE:
```ts
          title: `${subject} score needs attention`,
          body: `Your score dropped below 50. A quick revision session can help bring it back up!`,
          data: { subject, previous: prevScore, current: rounded, milestone: 50 },
```
AFTER:
```ts
          title: `${subject} score needs attention`,
          body: `Your score dropped below 50. A quick revision session can help bring it back up!`,
          data: {
            subject, previous: prevScore, current: rounded, milestone: 50,
            title_hi: `${subject} स्कोर पर ध्यान देने की ज़रूरत है`,
            body_hi: `तुम्हारा स्कोर 50 से नीचे आ गया। एक छोटा रिवीज़न सेशन इसे फिर से बढ़ाने में मदद कर सकता है!`,
          },
```

---

## XC-2 — parent-digest producers (guardian-facing). Relocated dead top-level `body_hi` into `data.body_hi`; added `data.title_hi`.

### D) parent_digest_no_activity (`generateParentDigests`, :167)

BEFORE (Hindi body at top-level — a column that does not exist / client never reads it; no title_hi):
```ts
    if (!list.length) { const b='Your child did not complete any quizzes yesterday.'; const bhi='आपके बच्चे ने कल कोई प्रश्नोत्तरी पूरी नहीं की।'; notes.push({...base,type:'parent_digest_no_activity',title:'No study activity yesterday',message:b,body:b,body_hi:bhi,data:{quizzes:0,student_id,streak_days:currentStreak}}) }
```
AFTER (Hindi moved into `data`, title_hi added):
```ts
    if (!list.length) { const b='Your child did not complete any quizzes yesterday.'; const bhi='आपके बच्चे ने कल कोई प्रश्नोत्तरी पूरी नहीं की।'; notes.push({...base,type:'parent_digest_no_activity',title:'No study activity yesterday',message:b,body:b,data:{quizzes:0,student_id,streak_days:currentStreak,title_hi:'कल कोई अध्ययन गतिविधि नहीं',body_hi:bhi}}) }
```

### E) parent_digest (:172)

BEFORE:
```ts
      notes.push({...base,type:'parent_digest',title:`Yesterday: ${list.length} quiz${list.length>1?'zes':''} completed`,message:b,body:b,body_hi:bhi,data:{quizzes:list.length,avg_score:sc,total_xp:xp,subjects:sub,student_id,streak_days:currentStreak}})
```
AFTER:
```ts
      notes.push({...base,type:'parent_digest',title:`Yesterday: ${list.length} quiz${list.length>1?'zes':''} completed`,message:b,body:b,data:{quizzes:list.length,avg_score:sc,total_xp:xp,subjects:sub,student_id,streak_days:currentStreak,title_hi:`कल: ${list.length} क्विज़ पूरी${list.length>1?'ं':''}`,body_hi:bhi}})
```
(The `bhi` English-derived body string is unchanged — `विषय: ${sub}। औसत अंक: ${sc}%। XP: +${xp}।`.)

---

## First-quiz nudge — NO CHANGE (already compliant)
`daily-cron/index.ts:1582-1586` already carries `data.title_hi` + `data.body_hi`. The audit's
`:1579-1581` English-only finding reflects a pre-fix snapshot. Verified compliant, left untouched.

---

## Hindi strings added (summary)
| Producer | Field | Hindi |
|---|---|---|
| score-drop | data.title_hi | `तुम्हारा ${subject} स्कोर ${Math.round(drop)} अंक गिर गया` |
| score-drop | data.body_hi | `तुम्हारा Performance Score ${Math.round(prevScore)} से ${Math.round(rounded)} हो गया। इसे फिर से बढ़ाने के लिए कुछ टॉपिक दोहराओ!` |
| above-80 | data.title_hi | `बहुत बढ़िया! ${subject} स्कोर ${Math.round(rounded)} तक पहुँच गया` |
| above-80 | data.body_hi | `तुमने ${subject} में 80 पार कर लिया। बढ़िया काम जारी रखो!` |
| below-50 | data.title_hi | `${subject} स्कोर पर ध्यान देने की ज़रूरत है` |
| below-50 | data.body_hi | `तुम्हारा स्कोर 50 से नीचे आ गया। एक छोटा रिवीज़न सेशन इसे फिर से बढ़ाने में मदद कर सकता है!` |
| parent no-activity | data.title_hi | `कल कोई अध्ययन गतिविधि नहीं` |
| parent no-activity | data.body_hi | (relocated) `आपके बच्चे ने कल कोई प्रश्नोत्तरी पूरी नहीं की।` |
| parent digest | data.title_hi | `कल: ${list.length} क्विज़ पूरी${list.length>1?'ं':''}` |
| parent digest | data.body_hi | (relocated) `विषय: ${sub}। औसत अंक: ${sc}%। XP: +${xp}।` |

Technical/product terms left untranslated per P7: **XP**, **Performance Score**. Tone: student
producers informal (तुम/तुम्हारा, mirroring the first-quiz nudge); parent producers formal (आपके
बच्चे, mirroring the in-file body + notification-triggers parent rows). All numeric interpolations
preserved in the Hindi twins.

## P7 rationale
The client (`notifications/page.tsx:195-198`) renders `data.title_hi`/`data.body_hi` for Hindi-mode
users, else falls back to English. Before this change the score-milestone twins were absent and the
parent-digest twins were on a top-level column the client never reads — so Hindi-mode users saw
English on the highest-value re-engagement notifications. Now every fixed producer carries the twin
in the shape the client reads, so it renders Hindi.

## Self-review
- [x] No trigger/threshold change — all `if (drop >= 5)`, `prevScore < 80 && rounded >= 80`,
      `prevScore >= 50 && rounded < 50`, list-length branches and idempotency_keys untouched.
- [x] No English text changed; no `message`/`body`/`title` value altered.
- [x] No XP or score value changed (XP/score interpolations are read-only in the Hindi twin).
- [x] Shape matches the verified house contract (`data.*_hi`) + the client reader exactly.
- [x] P13: no PII added — Hindi twins interpolate only subject string + integers already in English.
- [x] Scope held to `daily-cron/index.ts`; school-operations + parent-portal noted as follow-ups.
- [x] `deno check` produced only the PRE-EXISTING untyped-Supabase-client `never[]` errors
      (lines 73/89/122/141/146/208/276/633/…) on `.update()`/`.upsert()` calls — these predate this
      change and are unrelated to the `data` jsonb string additions. No NEW type error introduced.

### tests (testing) — mobile↔web drift contracts + bundle-cap pin

Three test-only files were added (no runtime/source change), converting the RC-3 / RC-4 "comments
not contracts" gaps into CI-enforced pins. 11 tests total. All test-only — no bundle footprint.

| Test file | Gap | Invariant | What it pins | REG |
|---|---|---|---|---|
| `src/__tests__/mobile-web-sync/subscription-price-drift.test.ts` | XC-6 | P11-adjacent / mobile | Parses the Dart price literals in `mobile/lib/data/models/subscription.dart` (299/2399, 699/5599, 1499/11999) and asserts equality against web `src/lib/plans.ts:95-97`. Parity-only — pins NO absolute value, asserts web↔mobile EQUALITY, so a legitimate user-approved price change passes iff BOTH sides change. No drift today. | **REG-191** |
| `src/__tests__/mobile-web-sync/score-config-drift.test.ts` | XC-5 | mobile / P1-adjacent | Extracts all 41 Performance-Score constants from `mobile/lib/core/constants/score_config.dart` (bloom ceilings, retention floors, behavior weights + windows, level thresholds, formula weights) and asserts equality against `src/lib/score-config.ts`. Parity-only; all 41 identical web↔Flutter today. Any unsynced web edit fails CI. | **REG-192** |
| `src/__tests__/bundle/bundle-cap-pin.test.ts` | XC-4a | P10 | Pins the caps declared in `scripts/check-bundle-size.mjs` (CAP_SHARED_KB=284, CAP_PAGE_KB=260, CAP_MIDDLEWARE_KB=120) so any future raise is a conscious, reviewed code change (anti cap-creep / RC-3). Does not re-measure the build (CI's `check:bundle-size` does that); it freezes the cap NUMBERS. | **REG-193** |

Counts (independently re-run): **11/11 cross-cutting tests PASS**. Parity tests read the real Dart
files on disk (not a fixture), so a one-sided web edit produces a failing assertion. The price test is
explicitly parity-only (no value pinned) so it does NOT collide with the PAY-2 USER-gated pricing
decision — it only guarantees web and mobile cannot silently diverge.

P13: the drift tests read only numeric/string constants from source files — no PII, no DB, no network.

REG additions: **REG-191** (subscription price web↔mobile parity), **REG-192** (score-config web↔Flutter
parity, 41 constants), **REG-193** (bundle-cap pin). Catalog **157 → 160**.

