# Student Dashboard Quality Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Pre-requisite:** Plan 0 (`2026-05-09-dashboard-foundation.md`) merged — uses Recharts wrappers from `@/components/admin-ui/charts/`.

**Goal:** Take the student-facing dashboards from "production-ready" (per master roadmap) to "polished and maintainable." Concretely:
1. **Refactor** the 2265-line `/foxy/page.tsx` monolith into composable pieces — currently the largest page in the codebase.
2. **Data viz** — replace the hand-rolled SVG sparkline on `/progress` with Recharts; add a chart to `/leaderboard`.
3. **Bilingual audit** — `/foxy` has only 12 isHi references in 2265 lines (P7 violation by neglect); raise coverage.
4. **Mobile** — verify every breakpoint works on the 5 main student pages.

This is the user-asked "upgrade" axis applied to the student portal: Visual + Refactor + Mobile + Bilingual + Data viz.

**Architecture:** Student portal lives at `/dashboard`, `/foxy`, `/progress`, `/leaderboard`, `/exams`, plus `/lab-notebook`, `/mock-exam`, `/pyq`. The biggest leverage is decomposing `/foxy` — every other page is already <1000 LOC and only needs polish.

`/foxy` is one giant `'use client'` component with inline streaming chat logic, message rendering, settings UI, and report flow. We extract:
- `useFoxyChat()` — streaming + session state hook
- `<MessageList>` — message rendering + RichContent integration
- `<MessageInput>` — text + voice input
- `<FoxySettings>` — subject/mode/language picker
- `<ReportDialog>` — REPORT_REASONS workflow

Each extraction is one commit, preserves behavior, and is guarded by a snapshot regression test added in Task 2.

**Tech Stack:** Next.js 16, React 18, TypeScript, Tailwind 3.4, Recharts (Plan 0), framer-motion, Vitest + RTL.

**Solo-developer estimate:** ~5-7 working days. Day 1: snapshot test + scope. Day 2-3: extract hook + 2 components. Day 4: extract 2 more components. Day 5: charts on /progress + /leaderboard. Day 6: bilingual audit + fixes. Day 7: mobile audit + polish + PR.

---

## File Structure

**Create:**
- `src/app/foxy/_components/MessageList.tsx`
- `src/app/foxy/_components/MessageInput.tsx`
- `src/app/foxy/_components/FoxySettings.tsx`
- `src/app/foxy/_components/ReportDialog.tsx`
- `src/app/foxy/_hooks/useFoxyChat.ts`
- `src/app/foxy/_lib/foxy-constants.ts` — extracted: `LANGS`, `MODES`, `FOXY_FACES`, `MASTERY_COLORS`, `REPORT_REASONS`
- `src/app/foxy/_lib/foxy-types.ts` — extracted: `SubjectConfig`, `ChatMessage`, `StreamingCallbacks`
- `src/__tests__/foxy/foxy-page-snapshot.test.tsx` — regression baseline
- `src/__tests__/foxy/use-foxy-chat.test.ts`
- `src/__tests__/foxy/message-list.test.tsx`
- `src/__tests__/foxy/foxy-settings.test.tsx`
- `src/__tests__/foxy/report-dialog.test.tsx`

**Modify:**
- `src/app/foxy/page.tsx` — drops to ~600-800 LOC composing the new pieces
- `src/app/progress/page.tsx` (~lines 60-130) — replace inline SVG sparkline with `<LineChart>`
- `src/app/leaderboard/page.tsx` — add Top-10 XP `<BarChart>` block
- `src/app/dashboard/page.tsx` — bilingual + mobile audit fixes (likely 0-3 small edits)
- `src/app/exams/page.tsx` — bilingual + mobile audit fixes

---

## Pre-flight

- [ ] **Step 0.1: Confirm Plan 0 is merged**

```bash
ls src/components/admin-ui/charts/LineChart.tsx
ls src/components/admin-ui/charts/BarChart.tsx
```

Both must exist. If not, complete Plan 0 first.

- [ ] **Step 0.2: Green baseline**

```bash
npm run type-check && npm run lint && npm test -- --run
```

- [ ] **Step 0.3: Branch**

```bash
git checkout main && git pull
git checkout -b feat/student-quality-upgrade
```

- [ ] **Step 0.4: Establish a foxy size baseline**

```bash
wc -l src/app/foxy/page.tsx
```

Record the number — should be ~2265. After the plan, we want this <800 LOC and the new component files ≤300 each.

---

## Task 1: Add a foxy snapshot regression test (BEFORE refactor)

Refactoring a 2265-line file without a regression net is reckless. Lock the rendered output first.

**Files:**
- Create: `src/__tests__/foxy/foxy-page-snapshot.test.tsx`

- [ ] **Step 1.1: Write the snapshot test**

`src/__tests__/foxy/foxy-page-snapshot.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock all the heavy dynamic imports — we want a fast snapshot of the page shell
vi.mock('@/components/foxy/RichContent', () => ({ default: () => <div data-mock="rich" /> }));
vi.mock('@/components/foxy/FoxyStructuredRenderer', () => ({ default: () => <div data-mock="structured" /> }));
vi.mock('@/components/UpgradeModal', () => ({ default: () => null }));
vi.mock('@/components/SELCheckIn', () => ({ default: () => null }));

// Mock auth + supabase
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: 'test-user',
    role: 'student',
    isHi: false,
    studentProfile: { id: 's-1', grade: '9', name: 'Test' },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  },
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-key',
}));

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({}),
  });
});

describe('Foxy page snapshot regression', () => {
  it('renders the empty state without errors', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    // Don't snapshot literal HTML (style values change). Instead assert key
    // landmarks that must always be present.
    expect(container.querySelector('[role="main"], main')).toBeTruthy();
    expect(container.textContent).toMatch(/Foxy|फॉक्सी/i);
  });

  it('exposes message input region', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    // After refactor, the input must still be reachable
    const inputs = container.querySelectorAll('input[type="text"], textarea');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('exposes subject/mode controls', async () => {
    const { default: FoxyPage } = await import('@/app/foxy/page');
    const { container } = render(<FoxyPage />);
    // At minimum a button to pick subject and a button to pick mode
    expect(container.querySelectorAll('button').length).toBeGreaterThan(2);
  });
});
```

The point of these is NOT to lock pixel-perfect HTML — it's to catch "the page crashes" or "the input is gone" after refactoring. Real snapshots are too fragile for a 2265-line page.

- [ ] **Step 1.2: Run, confirm passes against current monolith**

```bash
npx vitest run src/__tests__/foxy/foxy-page-snapshot.test.tsx
```

If it fails, the mocks need adjusting. The test file is the contract — every refactor below must keep it passing.

- [ ] **Step 1.3: Commit**

```bash
git add src/__tests__/foxy/foxy-page-snapshot.test.tsx
git commit -m "test(foxy): regression-net snapshot before decomposition"
```

---

## Task 2: Extract foxy constants + types

Smallest extraction. Pure data movement, zero behavior change. Sets up the others.

**Files:**
- Create: `src/app/foxy/_lib/foxy-constants.ts`
- Create: `src/app/foxy/_lib/foxy-types.ts`
- Modify: `src/app/foxy/page.tsx`

- [ ] **Step 2.1: Move constants**

Cut from `foxy/page.tsx` and paste into `src/app/foxy/_lib/foxy-constants.ts`:

```ts
// src/app/foxy/_lib/foxy-constants.ts

export const LANGS = [/* paste current value from foxy/page.tsx line ~74 */];
export const MODES = [/* paste current value */];
export const FOXY_FACES: Record<string, string> = { idle: '🦊', thinking: '🤔', happy: '😄' };
export const MASTERY_COLORS: Record<string, string> = {/* paste */};
export const FALLBACK_SCIENCE = { name: 'Science', icon: '⚛', color: '#10B981' } as const;
export const REPORT_REASONS = [/* paste current value from line ~631 */];
```

- [ ] **Step 2.2: Move interfaces/types**

Cut from `foxy/page.tsx` and paste into `src/app/foxy/_lib/foxy-types.ts`:

```ts
// src/app/foxy/_lib/foxy-types.ts

export interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
}

export interface StreamingCallbacks {
  /* paste current shape from line ~400 */
}

export interface ChatMessage {
  /* paste current shape from line ~591 */
}
```

- [ ] **Step 2.3: Update foxy/page.tsx imports**

At top of `foxy/page.tsx`:

```tsx
import {
  LANGS, MODES, FOXY_FACES, MASTERY_COLORS, FALLBACK_SCIENCE, REPORT_REASONS,
} from './_lib/foxy-constants';
import type { SubjectConfig, StreamingCallbacks, ChatMessage } from './_lib/foxy-types';
```

Delete the now-duplicated declarations in `page.tsx`.

- [ ] **Step 2.4: Type-check + snapshot test**

```bash
npm run type-check
npx vitest run src/__tests__/foxy/foxy-page-snapshot.test.tsx
```

Both must pass. If any consumer (`RichContent`, etc.) imported from `page.tsx`, update those imports to point at the new lib files.

- [ ] **Step 2.5: Commit**

```bash
git add src/app/foxy/_lib src/app/foxy/page.tsx
git commit -m "refactor(foxy): extract constants + types to _lib (no behavior change)"
```

---

## Task 3: Extract `useFoxyChat()` hook

The streaming chat logic is the biggest chunk inside the page component. Extract to a hook so it's testable and the page becomes a renderer.

**Files:**
- Create: `src/app/foxy/_hooks/useFoxyChat.ts`
- Create: `src/__tests__/foxy/use-foxy-chat.test.ts`
- Modify: `src/app/foxy/page.tsx`

- [ ] **Step 3.1: Identify the chat state shape**

```bash
grep -nE "useState\(.*messages|useState\(.*streaming|useState\(.*sessionId" src/app/foxy/page.tsx | head -15
```

Note all `useState` calls related to chat: `messages`, `isStreaming`, `currentMessage`, `sessionId`, `errorMsg`, etc.

- [ ] **Step 3.2: Identify the send/stream functions**

```bash
grep -nE "(async function|const sendMessage|const handleStream|chatWithFoxy)" src/app/foxy/page.tsx | head -10
```

These move to the hook.

- [ ] **Step 3.3: Write failing test for the hook**

`src/__tests__/foxy/use-foxy-chat.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFoxyChat } from '@/app/foxy/_hooks/useFoxyChat';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  },
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'k',
}));

describe('useFoxyChat', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('starts with empty messages', () => {
    const { result } = renderHook(() => useFoxyChat({ studentId: 's-1', subject: 'Science', mode: 'tutor' }));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
  });

  it('appends user message on send', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"text":"hi"}\n\n')); c.close(); } }),
    });
    const { result } = renderHook(() => useFoxyChat({ studentId: 's-1', subject: 'Science', mode: 'tutor' }));
    await act(async () => { await result.current.sendMessage('hello'); });
    expect(result.current.messages.find(m => m.role === 'user' && m.content === 'hello')).toBeTruthy();
  });

  it('captures errors', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 500, text: async () => 'err',
    });
    const { result } = renderHook(() => useFoxyChat({ studentId: 's-1', subject: 'Science', mode: 'tutor' }));
    await act(async () => { await result.current.sendMessage('x'); });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
```

- [ ] **Step 3.4: Run failing tests**

```bash
npx vitest run src/__tests__/foxy/use-foxy-chat.test.ts
```

- [ ] **Step 3.5: Implement the hook**

`src/app/foxy/_hooks/useFoxyChat.ts`:

```ts
'use client';

import { useState, useCallback, useRef } from 'react';
import { supabase, supabaseUrl as SUPABASE_URL, supabaseAnonKey as SUPABASE_ANON } from '@/lib/supabase';
import type { ChatMessage } from '../_lib/foxy-types';

export interface UseFoxyChatOptions {
  studentId: string;
  subject: string;
  mode: string;
  language?: 'en' | 'hi';
  /** Optional initial session id to resume a conversation. */
  sessionId?: string;
}

export interface UseFoxyChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sessionId: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
  reportMessage: (messageId: string, reason: string) => Promise<void>;
}

export function useFoxyChat({
  studentId, subject, mode, language = 'en', sessionId: initialSessionId,
}: UseFoxyChatOptions): UseFoxyChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now(),
    } as ChatMessage;
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
      };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/foxy-tutor`, {
        method: 'POST',
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          student_id: studentId,
          subject,
          mode,
          language,
          message: text,
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown');
        setError(`API ${res.status}: ${errText}`);
        return;
      }

      // Append empty assistant message and accumulate from stream
      const assistantId = crypto.randomUUID();
      setMessages(prev => [...prev, {
        id: assistantId, role: 'assistant', content: '', timestamp: Date.now(),
      } as ChatMessage]);

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const line of buffer.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.text) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + evt.text } : m,
              ));
            }
            if (evt.session_id) setSessionId(evt.session_id);
          } catch { /* skip malformed line */ }
        }
        buffer = buffer.split('\n').pop() ?? '';
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [studentId, subject, mode, language, sessionId, isStreaming]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setError(null);
  }, []);

  const reportMessage = useCallback(async (messageId: string, reason: string) => {
    // Existing behavior in foxy/page.tsx — paste here. Likely a Supabase RPC or
    // an edge fn POST to /functions/v1/foxy-tutor with action: 'report'.
    // Until extracted, keep page-side; this hook exposes the contract only.
    await Promise.resolve({ messageId, reason });
  }, []);

  return { messages, isStreaming, error, sessionId, sendMessage, clearMessages, reportMessage };
}
```

NOTE: the streaming protocol details (event format, action names) MUST match the existing `foxy-tutor` edge function. Read the actual implementation in `foxy/page.tsx` and adjust the parser. The above is the established `data: {json}\n\n` SSE pattern but the actual edge fn may differ.

- [ ] **Step 3.6: Wire the hook into page.tsx, delete inline duplicate**

In `foxy/page.tsx`, replace the inline state + send function with:

```tsx
import { useFoxyChat } from './_hooks/useFoxyChat';
// inside component:
const {
  messages, isStreaming, error, sendMessage, clearMessages, reportMessage,
} = useFoxyChat({ studentId, subject: subject.name, mode: selectedMode, language: isHi ? 'hi' : 'en' });
```

Delete the inline `useState<ChatMessage[]>([])`, `setIsStreaming`, the entire send function, etc.

- [ ] **Step 3.7: Tests pass + snapshot test still passes**

```bash
npx vitest run src/__tests__/foxy/use-foxy-chat.test.ts
npx vitest run src/__tests__/foxy/foxy-page-snapshot.test.tsx
npm run type-check
```

- [ ] **Step 3.8: Manual smoke**

```bash
npm run dev
```

Open `/foxy`, send a message, verify streaming response renders, check report flow works (the inline `reportMessage` may need to be implemented per the contract — verify or adjust the hook to match real edge fn).

- [ ] **Step 3.9: Commit**

```bash
git add src/app/foxy/_hooks/useFoxyChat.ts src/__tests__/foxy/use-foxy-chat.test.ts src/app/foxy/page.tsx
git commit -m "refactor(foxy): extract streaming chat to useFoxyChat() hook"
```

---

## Task 4: Extract `<MessageList>` component

**Files:**
- Create: `src/app/foxy/_components/MessageList.tsx`
- Create: `src/__tests__/foxy/message-list.test.tsx`
- Modify: `src/app/foxy/page.tsx`

- [ ] **Step 4.1: Identify the message-rendering JSX in page.tsx**

```bash
grep -nE "messages\.map|message\.role" src/app/foxy/page.tsx | head -10
```

Find the `messages.map(...)` block. That's what moves.

- [ ] **Step 4.2: Write failing tests**

`src/__tests__/foxy/message-list.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import MessageList from '@/app/foxy/_components/MessageList';
import type { ChatMessage } from '@/app/foxy/_lib/foxy-types';

vi.mock('@/components/foxy/RichContent', () => ({ default: ({ content }: { content: string }) => <div data-testid="rich">{content}</div> }));
vi.mock('@/components/foxy/FoxyStructuredRenderer', () => ({ default: () => <div data-testid="structured" /> }));

const messages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: 1 } as ChatMessage,
  { id: '2', role: 'assistant', content: 'Hi there!', timestamp: 2 } as ChatMessage,
];

describe('foxy MessageList', () => {
  it('renders user messages on the right and assistant on the left', () => {
    render(<MessageList messages={messages} isStreaming={false} onReport={() => {}} isHi={false} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows a thinking indicator while streaming', () => {
    render(<MessageList messages={messages} isStreaming={true} onReport={() => {}} isHi={false} />);
    expect(screen.getByLabelText(/foxy thinking|loading/i)).toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    render(<MessageList messages={[]} isStreaming={false} onReport={() => {}} isHi={false} />);
    expect(screen.getByText(/Ask Foxy anything|फॉक्सी से पूछो/i)).toBeInTheDocument();
  });

  it('exposes report buttons on assistant messages', () => {
    render(<MessageList messages={messages} isStreaming={false} onReport={() => {}} isHi={false} />);
    // user message has no report; assistant does
    expect(screen.getAllByLabelText(/report/i).length).toBe(1);
  });
});
```

- [ ] **Step 4.3: Implement MessageList**

`src/app/foxy/_components/MessageList.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { twMerge } from 'tailwind-merge';
import type { ChatMessage } from '../_lib/foxy-types';

const RichContent = dynamic(() => import('@/components/foxy/RichContent'), { ssr: false });
const FoxyStructuredRenderer = dynamic(() => import('@/components/foxy/FoxyStructuredRenderer'), { ssr: false });

export interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onReport: (messageId: string) => void;
  isHi: boolean;
  className?: string;
}

export default function MessageList({
  messages, isStreaming, onReport, isHi, className,
}: MessageListProps) {
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className={twMerge('flex flex-1 flex-col items-center justify-center px-6 py-12 text-center', className)}>
        <div className="text-6xl mb-4">🦊</div>
        <p className="text-lg font-semibold text-foreground">
          {isHi ? 'फॉक्सी से कुछ भी पूछो' : 'Ask Foxy anything'}
        </p>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          {isHi
            ? 'NCERT पाठ्यक्रम पर सवाल पूछो, समझो, अभ्यास करो।'
            : 'Questions about NCERT chapters, concepts, or practice problems.'}
        </p>
      </div>
    );
  }

  return (
    <div className={twMerge('flex flex-1 flex-col gap-3 overflow-y-auto p-4', className)}>
      {messages.map(msg => (
        <div
          key={msg.id}
          className={twMerge(
            'max-w-[85%] rounded-2xl px-4 py-2.5',
            msg.role === 'user'
              ? 'self-end bg-primary text-white'
              : 'self-start bg-surface-2 text-foreground',
          )}
        >
          {/* Re-use existing renderers for assistant; user is plain text */}
          {msg.role === 'assistant' ? (
            // If the message includes structured payload, render with FoxyStructuredRenderer.
            // Else, fall through to RichContent.
            <RichContent content={msg.content} />
          ) : (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          )}

          {msg.role === 'assistant' && (
            <button
              onClick={() => onReport(msg.id)}
              aria-label={isHi ? 'इस उत्तर की रिपोर्ट करें' : 'Report this answer'}
              className="mt-1.5 text-[11px] text-muted-foreground hover:text-danger"
            >
              {isHi ? '⚠ रिपोर्ट करें' : '⚠ Report'}
            </button>
          )}
        </div>
      ))}
      {isStreaming && (
        <div
          aria-label={isHi ? 'फॉक्सी सोच रहा है' : 'Foxy thinking'}
          className="self-start flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-surface-2"
        >
          <span className="text-2xl animate-bounce">🦊</span>
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:.4s]" />
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.4: Replace inline rendering in page.tsx**

In `foxy/page.tsx`, replace the entire `messages.map(...)` block (and surrounding container) with:

```tsx
<MessageList
  messages={messages}
  isStreaming={isStreaming}
  onReport={openReportDialog}
  isHi={isHi}
/>
```

Where `openReportDialog` is whatever the page already had to open the report flow (Task 5 will extract that flow itself).

- [ ] **Step 4.5: Tests + snapshot + smoke + commit**

```bash
npx vitest run src/__tests__/foxy/message-list.test.tsx
npx vitest run src/__tests__/foxy/foxy-page-snapshot.test.tsx
npm run type-check && npm run dev   # manual: send a message
git add src/app/foxy/_components/MessageList.tsx src/__tests__/foxy/message-list.test.tsx src/app/foxy/page.tsx
git commit -m "refactor(foxy): extract <MessageList> with empty/streaming states + a11y labels"
```

---

## Task 5: Extract `<MessageInput>`, `<FoxySettings>`, `<ReportDialog>`

The pattern from Tasks 3-4 applies to each. Smaller per-task descriptions; reuse the same TDD steps (write failing test, implement, replace inline block, verify snapshot).

**Files:** all under `src/app/foxy/_components/` and `src/__tests__/foxy/`.

- [ ] **Step 5.1: `<MessageInput>`**

Props: `{ onSend: (text: string) => Promise<void>; isStreaming: boolean; isHi: boolean }`. Includes voice input button if the original page has one. Test: typing + Enter sends, Enter on empty doesn't send, Shift+Enter newlines.

- [ ] **Step 5.2: `<FoxySettings>`**

Props: `{ subject: SubjectConfig; mode: string; language: 'en' | 'hi'; onSubjectChange; onModeChange; onLanguageChange; isHi: boolean }`. Renders the LANGS / MODES / subject pickers from `_lib/foxy-constants.ts`. Test: clicking each changes the state.

- [ ] **Step 5.3: `<ReportDialog>`**

Props: `{ open: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void>; isHi: boolean }`. Renders REPORT_REASONS as a list, captures selected reason, calls onSubmit, closes. Test: open/close, reason selection, submit fires callback.

For each: failing test → implement → replace inline → verify snapshot still passes → commit.

- [ ] **Step 5.4: After all 3 extractions, verify foxy/page.tsx is now <800 LOC**

```bash
wc -l src/app/foxy/page.tsx
```

If still >1200, audit what's left — there's likely more to extract (e.g. `<UpgradeBanner>`, `<DailyLimitWarning>`, etc.).

---

## Task 6: Replace progress sparkline with Recharts LineChart

`src/app/progress/page.tsx` line ~62 has a hand-rolled SVG sparkline. The author noted "no chart library (P10)" — but Plan 0 added Recharts globally. Replacing this is a small change with high readability/maintainability win, and the bundle hit is one-time (Recharts is already loaded for any other page that uses it).

**Files:**
- Read: `src/app/progress/page.tsx` lines 60-130
- Modify: `src/app/progress/page.tsx`

- [ ] **Step 6.1: Read the sparkline block**

```bash
sed -n '60,135p' src/app/progress/page.tsx
```

Identify the data shape (likely an array of `{ date: string, score: number }` or similar) and the props (width, height, color).

- [ ] **Step 6.2: Replace with `<LineChart>` from admin-ui**

Replace the sparkline component (or inline JSX) with:

```tsx
import { LineChart } from '@/components/admin-ui';

// Replace the entire <svg>...</svg> block:
<div className="w-full" style={{ minHeight: 80 }}>
  <LineChart
    data={trendData}
    xKey="date"
    series={[{ key: 'score', label: t(isHi, 'Score', 'अंक'), color: '#7C3AED' }]}
    height={80}
    emptyMessage={t(isHi, 'No quizzes yet', 'अभी तक कोई क्विज़ नहीं')}
  />
</div>
```

Sparkline-style customization (no axes, no legend, no grid) — if the existing wrapper from Plan 0 doesn't expose those toggles, either:

(a) Pass `height={80}` and accept the existing axes/grid.
(b) Add a `variant: 'sparkline' | 'full'` prop to `LineChart` that hides axes/grid/legend when sparkline.

Recommended: add the variant prop in a follow-up commit to Plan 0 if needed. For Plan 4, accept the slightly fuller chart — it's still smaller than what's there now.

- [ ] **Step 6.3: Verify P10 bundle budget**

```bash
npm run build
```

Check the `/progress` page First Load JS. If it exceeds 260 kB:

```bash
# Wrap LineChart in a dynamic import to defer loading
import dynamic from 'next/dynamic';
const LineChart = dynamic(() => import('@/components/admin-ui/charts/LineChart'), { ssr: false });
```

- [ ] **Step 6.4: Smoke + commit**

```bash
npm run dev
# Open /progress, verify the chart renders identically (or better) to the SVG sparkline
git add src/app/progress/page.tsx
git commit -m "refactor(progress): replace hand-rolled SVG sparkline with Recharts LineChart"
```

---

## Task 7: Add a chart to leaderboard

`/leaderboard` currently has no visualization — it's a ranked list. Add a Top-10 XP bar chart at the top so the eye sees the distribution before reading names.

**Files:**
- Modify: `src/app/leaderboard/page.tsx`

- [ ] **Step 7.1: Add the BarChart import + slice the data**

At top of `leaderboard/page.tsx`:

```tsx
import { BarChart } from '@/components/admin-ui';
```

Below the existing leaderboard fetch, slice top-10:

```tsx
const top10 = leaderboard
  .slice(0, 10)
  .map(entry => ({ name: entry.display_name, xp: entry.xp_total }));
```

- [ ] **Step 7.2: Render above the list**

```tsx
{leaderboard.length > 0 && (
  <section className="mb-6">
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {t(isHi, 'Top 10 by XP', 'XP के अनुसार शीर्ष 10')}
    </h2>
    <BarChart
      data={top10}
      xKey="name"
      series={[{ key: 'xp', label: 'XP', color: '#F97316' }]}
      height={240}
      layout="vertical"
    />
  </section>
)}
```

- [ ] **Step 7.3: Smoke + commit**

```bash
npm run dev
# Open /leaderboard, verify chart appears above the list, hover tooltips work
git add src/app/leaderboard/page.tsx
git commit -m "feat(leaderboard): add Top-10 XP bar chart"
```

---

## Task 8: Foxy bilingual audit

`/foxy/page.tsx` has 2265 LOC but only 12 `isHi` references. After the decomposition (Tasks 2-5), the surface area shrinks but bilingual gaps remain in the extracted children.

**Files:** vary (each new component file from Tasks 4-5)

- [ ] **Step 8.1: Grep all hardcoded English strings in foxy components**

```bash
# Find string literals that look like UI copy (long enough, in JSX)
grep -nE "(['\"])[A-Z][a-z]+ [a-z]+[a-z. ]+['\"]" src/app/foxy/_components/ src/app/foxy/page.tsx | head -40
```

Filter out: imports, type strings, technical identifiers. Keep: anything a user reads.

- [ ] **Step 8.2: For each hit, wrap in `t(isHi, en, hi)`**

The helper `t` already exists in `foxy/page.tsx`. Either:
- Pass `t` down as prop to each component
- Re-define a local `t` helper in each component file
- Use AuthContext directly: `const { isHi } = useAuth();` and define inline

Recommended: each component takes `isHi: boolean` as a prop (already does, per Tasks 4-5). Add a tiny local helper at the top of each file:

```tsx
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;
```

Then for every English-only literal, wrap it with `t(isHi, '...', 'हिंदी ...')`.

- [ ] **Step 8.3: Hindi translation source**

The user's standing rules say "Technical terms (CBSE, XP, Bloom's) are not translated." For everything else, get translations from:
- Existing translations in the codebase: `grep` for the English phrase elsewhere
- `mobile/lib/i18n/` if Flutter has the same strings
- For new strings: native Hindi (the user is fluent — confirm with them OR use clear, simple Hindi phrasing as in `school-admin` examples already in canonical)

- [ ] **Step 8.4: Re-count after audit**

```bash
grep -c "isHi\|t(isHi" src/app/foxy/page.tsx src/app/foxy/_components/*.tsx
```

Should be ≥40 across all foxy files.

- [ ] **Step 8.5: Commit**

```bash
git add src/app/foxy
git commit -m "fix(foxy): bilingual audit — wrap remaining English literals in t() helper"
```

---

## Task 9: Mobile responsiveness audit

The student dashboard already uses `BottomNav` (mobile-first). But the 5 main pages need a verification pass at the breakpoints CLAUDE.md targets (Indian 4G, mobile-first).

**Pages to audit:** `/dashboard`, `/foxy`, `/progress`, `/leaderboard`, `/exams`.

- [ ] **Step 9.1: Boot dev server**

```bash
npm run dev
```

- [ ] **Step 9.2: For each page, test at 360px, 768px, 1280px**

Use Chrome DevTools device toolbar. For each (page, breakpoint):

- Sidebar/nav doesn't overlap content
- Touch targets are ≥44×44 px
- No horizontal scroll
- Text is readable (≥14px for body, ≥12px for secondary)
- Tables scroll horizontally rather than break layout
- Charts (Tasks 6+7) reflow correctly

Capture issues in a checklist file:

`docs/superpowers/runbooks/2026-05-09-student-mobile-audit.md`:

```markdown
# Student Pages — Mobile Audit (2026-05-09)

For each (page, breakpoint), tick if pass. Note specific failure if not.

|  | 360px | 768px | 1280px |
|---|---|---|---|
| /dashboard | ☐ | ☐ | ☐ |
| /foxy | ☐ | ☐ | ☐ |
| /progress | ☐ | ☐ | ☐ |
| /leaderboard | ☐ | ☐ | ☐ |
| /exams | ☐ | ☐ | ☐ |

## Failures
- [page]: [breakpoint]: [issue]
```

- [ ] **Step 9.3: Fix any failures inline**

For each failure: locate the offending element, add Tailwind responsive classes (`max-sm:`, `md:`, `lg:`), commit per-page.

- [ ] **Step 9.4: Re-run audit, tick all rows**

- [ ] **Step 9.5: Commit checklist + fixes**

```bash
git add docs/superpowers/runbooks/2026-05-09-student-mobile-audit.md src/app/dashboard src/app/progress src/app/leaderboard src/app/exams src/app/foxy
git commit -m "fix(student): mobile audit — fix breakpoint issues across 5 main pages"
```

---

## Task 10: Final validation + PR

- [ ] **Step 10.1: Full local checks**

```bash
npm run type-check
npm run lint
npm test -- --run
npm run build
```

- [ ] **Step 10.2: Confirm size reduction**

```bash
wc -l src/app/foxy/page.tsx src/app/foxy/_components/*.tsx src/app/foxy/_hooks/*.ts src/app/foxy/_lib/*.ts
```

`foxy/page.tsx` should be <800 LOC. The new files should each be <400 LOC.

- [ ] **Step 10.3: Bundle check**

```bash
npm run analyze
```

`/foxy`, `/progress`, `/leaderboard` First Load JS each under P10 budget (260 kB). If any over, dynamic-import the Recharts wrappers on that page.

- [ ] **Step 10.4: E2E**

```bash
npx playwright test --project=chromium
```

If a foxy E2E spec exists, it must pass. The decomposition should be invisible to E2E.

- [ ] **Step 10.5: Cross-check (per memory `feedback_cross_check_previews.md`)**

For each of the 5 student pages: theme (light + dark if dark exists), language (EN + हिं), breakpoints (360/768/1280), states (empty + populated + loading + error). The mobile-audit runbook from Task 9 covers most of this.

- [ ] **Step 10.6: Push + PR**

```bash
git push -u origin feat/student-quality-upgrade
gh pr create --title "feat(student): quality upgrade — decompose foxy, charts, bilingual, mobile" --body "$(cat <<'EOF'
## Summary
- Decomposes 2265-LOC `foxy/page.tsx` into hook + 4 components (page now <800 LOC)
- Adds vitest coverage for `useFoxyChat`, `MessageList`, `MessageInput`, `FoxySettings`, `ReportDialog`
- Replaces hand-rolled SVG sparkline on `/progress` with Recharts LineChart
- Adds Top-10 XP BarChart to `/leaderboard`
- Bilingual audit on `/foxy` — raises isHi coverage from 12 to 40+
- Mobile audit pass on 5 student pages × 3 breakpoints

## Closes
Plan 4 of dashboard upgrade workstream.

## Test plan
- [x] Snapshot regression test passes throughout decomposition
- [x] All 5 new unit-test files pass
- [x] Type-check + lint + build clean
- [x] Bundle: `/foxy`, `/progress`, `/leaderboard` under 260 kB First Load JS
- [x] Manual smoke: send message in /foxy, verify streaming + report flow
- [x] Mobile audit checklist all pass
EOF
)"
```

---

## Self-Review

**Spec coverage** vs the upgrade axes (Visual + Refactor + Mobile + Bilingual + Data viz):
- Visual: implicit via Recharts swap, leaderboard chart, mobile polish ✅
- Refactor: foxy decomposition (Tasks 2-5) ✅
- Mobile: Task 9 audit ✅
- Bilingual: Task 8 audit ✅
- Data viz: Tasks 6 + 7 ✅

**Placeholder scan:** every step has either complete code, a literal grep command, or a specific decision matrix. The `reportMessage` stub in Task 3.5 has a NOTE pointing the executor to read the existing implementation — not a TBD, just a "consult source before implementing."

**Type consistency:** `ChatMessage` defined once in `_lib/foxy-types.ts` (Task 2), consumed by hook (Task 3), MessageList (Task 4), tests. ✅

**Dependencies:** Task 1 (snapshot) before Tasks 2-5 (decomposition) — required regression net. Task 2 (constants extraction) before Task 3 (hook needs the types). Tasks 6-7 (charts) after Plan 0. Task 8 (bilingual audit) AFTER Tasks 4-5 because we audit the new component files. Task 9 (mobile) is independent — could run earlier.

**Risk items:**
- The streaming protocol in `useFoxyChat` (Task 3.5) MUST match the `foxy-tutor` edge fn. The pasted SSE pattern is illustrative; verify against actual edge fn.
- Recharts may push student pages over P10 budget — Task 6.3 + 10.3 catch this with dynamic-import fallbacks.
- The `RichContent` and `FoxyStructuredRenderer` dynamic imports in MessageList (Task 4.3) preserve existing render behavior, but if the structured payload detection logic is buried deep in the page, it needs to come along — read the original conditional carefully.

---

## Out of scope (intentional)

- New foxy features. This is decomposition + polish, not new capability.
- Foxy backend migration to the new Next.js `/api/foxy/route.ts` (mentioned in `.claude/CLAUDE.md` of canonical). That's a separate AI-engineering plan.
- /lab-notebook, /mock-exam, /pyq pages. Each could use its own polish but they're under-baked surfaces — defer until master roadmap or product brings them up.
- /scan, /diagnostic, /challenge — same deferral logic.
- Visual normalization across all student/admin themes. Plan 6 territory.
- Adding new charts to /dashboard or /exams. Possible but not strictly upgrade — if data is informative, follow up post-launch.
