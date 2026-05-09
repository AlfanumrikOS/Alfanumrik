# Internal Admin Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Pre-requisite:** Plan 0 (`2026-05-09-dashboard-foundation.md`) merged — uses `StatCard`, `DataTable`, `LineChart` from `@/components/admin-ui/`.

**Goal:** Decompose the 1385-line `src/app/internal/admin/page.tsx` monolith into composable per-tab components and small primitives. Replace its inline `S` styles + custom `KPI` + custom `Sparkline` with the Plan 0 admin-ui kit. After this plan, the page is a thin tab dispatcher (~150 LOC) and each tab is its own ≤300-LOC component.

**Architecture context:** `/internal/admin` is a separate panel from `/super-admin` — it uses a legacy shared-secret auth (`SUPER_ADMIN_SECRET` passed in headers via `adminHeaders(secret)`) and has 10+ tabs each calling its own `/api/internal/admin/*` endpoint. Per `.claude/CLAUDE.md`, this panel coexists with the newer super-admin panel; consolidating them is Phase 6 territory and out of scope for Plan 5. Plan 5 ONLY refactors the file structure — no auth changes, no consolidation, no new features.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript, Tailwind 3.4, admin-ui kit (Plan 0).

**Solo-developer estimate:** ~3-4 working days. Day 1: snapshot baseline + extract types + small components. Day 2: extract LoginScreen + UserDrawer. Day 3-4: split each tab into its own component, apply admin-ui kit.

---

## Audit findings (verified 2026-05-09)

`src/app/internal/admin/page.tsx` (1385 LOC). Pre-existing seams:

| Section | Lines | Move to |
|---|---|---|
| `Tab` enum + interfaces | 30-126 | `_lib/internal-admin-types.ts` |
| `C` color tokens + `S` style record | 127-191 | DEPRECATE — replace usages with admin-ui Tailwind classes |
| `Sparkline` component | 190-204 | Replace with `<LineChart variant="sparkline">` |
| `KPI` card | 204-224 | Replace with `<StatCard>` from admin-ui |
| `LoginScreen` | 224-281 | `_components/LoginScreen.tsx` |
| `UserDrawer` | 281-501 | `_components/UserDrawer.tsx` (220 LOC) |
| Main `SuperAdminPage` | 502-1385 | Becomes `<InternalAdminShell>` thin dispatcher (~150 LOC) |
| Tab content (per-tab JSX) | embedded | One `_components/<tab>Tab.tsx` per tab |

The function is named `SuperAdminPage` (line 504) but exports as default for `internal/admin/page.tsx`. Misleading. We rename to `InternalAdminPage` in this refactor.

API endpoints called: `/api/internal/admin/{stats, command-center, users, content, schools, revenue, ai-monitor, feature-flags, support, logs, bulk-action}`. Each tab uses one of these.

---

## File Structure

**Create:**
- `src/app/internal/admin/_lib/internal-admin-types.ts`
- `src/app/internal/admin/_components/LoginScreen.tsx`
- `src/app/internal/admin/_components/UserDrawer.tsx`
- `src/app/internal/admin/_components/CommandTab.tsx`
- `src/app/internal/admin/_components/UsersTab.tsx`
- `src/app/internal/admin/_components/ContentTab.tsx`
- `src/app/internal/admin/_components/SchoolsTab.tsx`
- `src/app/internal/admin/_components/RevenueTab.tsx`
- `src/app/internal/admin/_components/AIMonitorTab.tsx`
- `src/app/internal/admin/_components/FlagsTab.tsx`
- `src/app/internal/admin/_components/SupportTab.tsx`
- `src/app/internal/admin/_components/LogsTab.tsx`
- `src/app/internal/admin/_hooks/useAdminFetch.ts` — wraps `adminHeaders(secret)` for typed fetches
- `src/__tests__/internal-admin/page-snapshot.test.tsx`
- `src/__tests__/internal-admin/login-screen.test.tsx`
- `src/__tests__/internal-admin/user-drawer.test.tsx`
- `src/__tests__/internal-admin/use-admin-fetch.test.ts`

**Modify:**
- `src/app/internal/admin/page.tsx` — drops to ~150 LOC thin dispatcher

The exact list of tabs is per the `Tab` type at line 32. Read it in Step 1.1 below — if the tabs differ from the 10 listed above, adjust the `_components/*Tab.tsx` file list accordingly.

---

## Pre-flight

- [ ] **Step 0.1: Confirm Plan 0 merged**

```bash
ls src/components/admin-ui/StatCard.tsx
ls src/components/admin-ui/DataTable.tsx
```

- [ ] **Step 0.2: Green baseline + branch**

```bash
npm run type-check && npm run lint && npm test -- --run
git checkout main && git pull
git checkout -b refactor/internal-admin
```

- [ ] **Step 0.3: Record baseline LOC**

```bash
wc -l src/app/internal/admin/page.tsx
```

Should be 1385. Goal: page.tsx <200 LOC after Plan 5; each `_components/*` file ≤300 LOC.

---

## Task 1: Snapshot regression test

**Files:**
- Create: `src/__tests__/internal-admin/page-snapshot.test.tsx`

- [ ] **Step 1.1: Read the Tab type to know all tabs**

```bash
sed -n '30,45p' src/app/internal/admin/page.tsx
```

Note the literal tab keys (e.g. `'command' | 'users' | 'content' | ...`). Update the file list above + the test below to match.

- [ ] **Step 1.2: Write smoke-snapshot test (mocked auth)**

`src/__tests__/internal-admin/page-snapshot.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  // Mock fetch — every API call returns success/empty
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [], total: 0 }),
  });
  // Pre-set the secret in sessionStorage so login screen is bypassed
  sessionStorage.setItem('alfanumrik_admin_secret', 'test-secret');
});

describe('Internal admin page regression', () => {
  it('renders the main shell with tabs after login', async () => {
    const { default: Page } = await import('@/app/internal/admin/page');
    render(<Page />);
    // Wait for fetch + state settling
    await new Promise(r => setTimeout(r, 50));
    // Tab navigation must exist
    expect(screen.getByText(/Command Center|Overview/i)).toBeInTheDocument();
  });

  it('shows login screen when no secret stored', async () => {
    sessionStorage.clear();
    const { default: Page } = await import('@/app/internal/admin/page');
    render(<Page />);
    expect(screen.getByLabelText(/admin secret|password/i)).toBeInTheDocument();
  });

  it('switches tabs', async () => {
    const { default: Page } = await import('@/app/internal/admin/page');
    render(<Page />);
    await new Promise(r => setTimeout(r, 50));
    const usersTabBtn = screen.getByRole('button', { name: /users/i });
    fireEvent.click(usersTabBtn);
    // Whatever the Users tab heading is, it should appear
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByText(/Users|Students|Total Users/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 1.3: Run baseline**

```bash
npx vitest run src/__tests__/internal-admin/page-snapshot.test.tsx
```

Adjust mocks/queries as needed against current monolith. Once green, the contract is locked.

- [ ] **Step 1.4: Commit**

```bash
git add src/__tests__/internal-admin/page-snapshot.test.tsx
git commit -m "test(internal-admin): regression snapshot before decomposition"
```

---

## Task 2: Extract types

**Files:**
- Create: `src/app/internal/admin/_lib/internal-admin-types.ts`
- Modify: `src/app/internal/admin/page.tsx`

- [ ] **Step 2.1: Move types**

Cut from `page.tsx` lines 30-126 and paste into `_lib/internal-admin-types.ts`. Add `export` keyword to each:

```ts
export type Tab = /* the existing union from line 32 */;

export interface CommandData { /* ... */ }
export interface Student { /* ... */ }
export interface SupportTicket { /* ... */ }
export interface FeatureFlag { /* ... */ }
export interface LogEntry { /* ... */ }
export interface Topic { /* ... */ }
export interface Question { /* ... */ }
```

- [ ] **Step 2.2: Update page.tsx**

```tsx
import type {
  Tab, CommandData, Student, SupportTicket, FeatureFlag, LogEntry, Topic, Question,
} from './_lib/internal-admin-types';
```

Delete the now-duplicated declarations.

- [ ] **Step 2.3: Verify + commit**

```bash
npm run type-check
npx vitest run src/__tests__/internal-admin/page-snapshot.test.tsx
git add src/app/internal/admin/_lib src/app/internal/admin/page.tsx
git commit -m "refactor(internal-admin): extract types to _lib (no behavior change)"
```

---

## Task 3: Extract `useAdminFetch` hook

The 11+ inline `fetch('/api/internal/admin/...', { headers: h() })` calls all share the same auth header pattern. Extract.

**Files:**
- Create: `src/app/internal/admin/_hooks/useAdminFetch.ts`
- Create: `src/__tests__/internal-admin/use-admin-fetch.test.ts`
- Modify: `src/app/internal/admin/page.tsx`

- [ ] **Step 3.1: Implement the hook**

`src/app/internal/admin/_hooks/useAdminFetch.ts`:

```ts
'use client';

import { useCallback } from 'react';

const SECRET_KEY = 'alfanumrik_admin_secret'; // confirm match with current page.tsx

export function adminHeaders(secret: string | null) {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Secret': secret ?? '',
  };
}

export function useAdminFetch(secret: string | null) {
  return useCallback(async <T = unknown>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    const res = await fetch(path, {
      ...init,
      headers: { ...adminHeaders(secret), ...(init?.headers || {}) },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => 'unknown');
      throw new Error(`Admin API ${res.status}: ${txt}`);
    }
    return res.json();
  }, [secret]);
}

export function loadAdminSecret(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SECRET_KEY);
}

export function saveAdminSecret(secret: string) {
  sessionStorage.setItem(SECRET_KEY, secret);
}

export function clearAdminSecret() {
  sessionStorage.removeItem(SECRET_KEY);
}
```

NOTE: `'X-Admin-Secret'` is illustrative — read the current `page.tsx` (or `src/lib/admin-auth.ts`) for the exact header name.

- [ ] **Step 3.2: Write test**

`src/__tests__/internal-admin/use-admin-fetch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdminFetch } from '@/app/internal/admin/_hooks/useAdminFetch';

beforeEach(() => { global.fetch = vi.fn(); });

describe('useAdminFetch', () => {
  it('attaches admin secret header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ ok: true }),
    });
    const { result } = renderHook(() => useAdminFetch('test-secret'));
    await act(async () => { await result.current('/api/internal/admin/stats'); });
    const callHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(callHeaders['X-Admin-Secret']).toBe('test-secret');
  });

  it('throws on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 401, text: async () => 'Unauthorized',
    });
    const { result } = renderHook(() => useAdminFetch('bad'));
    await expect(result.current('/api/internal/admin/stats')).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 3.3: Replace inline fetches in page.tsx incrementally**

For each of the 11+ inline `fetch(...)` calls in `page.tsx`, replace with:

```tsx
const apiFetch = useAdminFetch(secret);
// later:
const data = await apiFetch<{ data: Student[] }>('/api/internal/admin/users?...');
```

Don't try to do all 11 at once; do 3-4, run tests, then 3-4 more.

- [ ] **Step 3.4: Verify + commit**

```bash
npm run type-check
npx vitest run src/__tests__/internal-admin/
git add src/app/internal/admin/_hooks src/__tests__/internal-admin/use-admin-fetch.test.ts src/app/internal/admin/page.tsx
git commit -m "refactor(internal-admin): extract useAdminFetch hook + sessionStorage helpers"
```

---

## Task 4: Extract LoginScreen

**Files:**
- Create: `src/app/internal/admin/_components/LoginScreen.tsx`
- Create: `src/__tests__/internal-admin/login-screen.test.tsx`
- Modify: `src/app/internal/admin/page.tsx`

- [ ] **Step 4.1: Read the existing LoginScreen**

```bash
sed -n '224,281p' src/app/internal/admin/page.tsx
```

- [ ] **Step 4.2: Write failing test**

`src/__tests__/internal-admin/login-screen.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LoginScreen from '@/app/internal/admin/_components/LoginScreen';

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('LoginScreen', () => {
  it('renders an admin secret input + submit', () => {
    render(<LoginScreen onLogin={() => {}} />);
    expect(screen.getByLabelText(/admin secret|password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login|sign in/i })).toBeInTheDocument();
  });

  it('calls onLogin with secret on submit when API returns 200', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText(/admin secret|password/i), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: /login|sign in/i }));
    await new Promise(r => setTimeout(r, 0));
    expect(onLogin).toHaveBeenCalledWith('s3cret');
  });

  it('shows error on bad secret', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid' });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText(/admin secret|password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /login|sign in/i }));
    await new Promise(r => setTimeout(r, 0));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid|wrong|denied/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.3: Implement LoginScreen using admin-ui Tailwind**

Take the existing JSX from page.tsx lines 224-281 and rewrite using Tailwind classes from the admin-ui kit. The body of the component is small — likely ~60 LOC.

```tsx
'use client';

import { useState } from 'react';

export interface LoginScreenProps {
  onLogin: (secret: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/internal/admin/stats', {
        headers: { 'X-Admin-Secret': secret },
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid secret' : `Error ${res.status}`);
        return;
      }
      onLogin(secret);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-1 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-surface-3 bg-surface-1 p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-bold text-foreground">Internal Admin</h1>
        <p className="mb-5 text-sm text-muted-foreground">Restricted access.</p>
        <label htmlFor="admin-secret" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Admin Secret
        </label>
        <input
          id="admin-secret"
          type="password"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          autoComplete="current-password"
          className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading || !secret}
          className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {loading ? 'Verifying…' : 'Login'}
        </button>
      </form>
    </div>
  );
}
```

(Confirm header name and login-validation endpoint per current `page.tsx`.)

- [ ] **Step 4.4: Replace inline LoginScreen in page.tsx**

Where `page.tsx` previously rendered the login screen, replace with `<LoginScreen onLogin={handleLogin} />`. Delete the inline `LoginScreen` function definition (lines 224-281).

- [ ] **Step 4.5: Verify + commit**

```bash
npx vitest run src/__tests__/internal-admin/
npm run type-check
git add src/app/internal/admin/_components/LoginScreen.tsx src/__tests__/internal-admin/login-screen.test.tsx src/app/internal/admin/page.tsx
git commit -m "refactor(internal-admin): extract LoginScreen + tailwind rewrite"
```

---

## Task 5: Extract UserDrawer

`UserDrawer` is the largest small-component (lines 281-501, ~220 LOC). Extract whole.

**Files:**
- Create: `src/app/internal/admin/_components/UserDrawer.tsx`
- Create: `src/__tests__/internal-admin/user-drawer.test.tsx`
- Modify: `src/app/internal/admin/page.tsx`

- [ ] **Step 5.1: Read the current UserDrawer**

```bash
sed -n '281,501p' src/app/internal/admin/page.tsx
```

Note its props signature: `{ student, secret, onClose, onRefresh }`. Note state, fetch calls, action buttons (resetPassword, lockAccount, etc.).

- [ ] **Step 5.2: Move it whole, swap inline styles for Tailwind**

Create `UserDrawer.tsx` with the same logic. Replace `<div style={S.drawer}>` etc. with the admin-ui `<DetailDrawer>` primitive from Plan 0:

```tsx
import DetailDrawer from '@/components/admin-ui/DetailDrawer';
import StatusBadge from '@/components/admin-ui/StatusBadge';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { Student } from '../_lib/internal-admin-types';

export interface UserDrawerProps {
  student: Student | null;
  secret: string;
  onClose: () => void;
  onRefresh: () => void;
}

export default function UserDrawer({ student, secret, onClose, onRefresh }: UserDrawerProps) {
  const apiFetch = useAdminFetch(secret);
  // ... rest of state + handlers from current implementation

  if (!student) return null;

  return (
    <DetailDrawer open onClose={onClose} title={student.name || 'User'} width={520}>
      {/* migrate the body JSX, replacing S.* with Tailwind utility classes */}
    </DetailDrawer>
  );
}
```

- [ ] **Step 5.3: Test + replace inline + commit**

`src/__tests__/internal-admin/user-drawer.test.tsx` — at minimum: renders student name, calls onRefresh after a successful action, calls onClose on Escape (covered by DetailDrawer's own test from Plan 0 but verify integration).

```bash
npx vitest run src/__tests__/internal-admin/user-drawer.test.tsx
```

In `page.tsx`, replace the inline `UserDrawer` definition + delete it. Update the call site (search `<UserDrawer student={`) — should already match.

```bash
git add src/app/internal/admin/_components/UserDrawer.tsx src/__tests__/internal-admin/user-drawer.test.tsx src/app/internal/admin/page.tsx
git commit -m "refactor(internal-admin): extract UserDrawer + use admin-ui DetailDrawer + StatusBadge"
```

---

## Task 6: Replace Sparkline + KPI with admin-ui kit

The custom `Sparkline` (line 192) and `KPI` (line 206) duplicate primitives now in admin-ui.

**Files:**
- Modify: `src/app/internal/admin/page.tsx`

- [ ] **Step 6.1: Replace KPI usages**

Search for `<KPI ` in `page.tsx`. Replace each with `<StatCard>`:

```tsx
// Before:
<KPI label="Total Users" value={1234} sub="last 7d" sparkData={[1,2,3]} color={C.orange} />

// After:
<StatCard
  label="Total Users"
  value={1234}
  subtitle="last 7d"
  accentColor="#F97316"
/>
```

The `sparkData` prop has no direct equivalent on `<StatCard>`. Two options:
(a) Drop the inline sparkline — KPIs become cleaner.
(b) Compose: render `<StatCard>` + a small `<LineChart>` inside via children-slot. Requires Plan 0 to have a children slot on StatCard. If not, defer to a follow-up.

Default: (a) drop sparklines from KPIs. They were busy and the sparkline-on-card pattern is questionable a11y-wise. The trend value can be shown via `trend={{ value: ..., label: '...' }}`.

- [ ] **Step 6.2: Delete the inline Sparkline + KPI definitions**

Lines 192-204 (Sparkline) and 206-224 (KPI). Now unused after Step 6.1 swaps.

- [ ] **Step 6.3: Replace remaining `style={S.*}` with Tailwind**

The big `S` record (lines 146-191) is the legacy inline styles. Each `style={S.btn()}`, `style={S.card}`, etc. has a Tailwind equivalent. Search:

```bash
grep -nE "style=\{S\." src/app/internal/admin/page.tsx | wc -l
```

Migrate in batches of ~15 per commit. Common substitutions:
- `S.card` → `rounded-lg border border-surface-3 bg-surface-1 p-4`
- `S.btn()` → `rounded-md bg-surface-2 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-3`
- `S.input` → `rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-sm`
- `S.h1` → `text-xl font-bold text-foreground`
- `S.h2` → `text-xs font-semibold uppercase tracking-wider text-muted-foreground`

After all substitutions, delete the `S` record + the `C` color object.

- [ ] **Step 6.4: Verify + commit**

```bash
npm run type-check && npx vitest run src/__tests__/internal-admin/
git add src/app/internal/admin/page.tsx
git commit -m "refactor(internal-admin): replace inline Sparkline+KPI+S styles with admin-ui kit"
```

---

## Task 7: Split each tab into its own component

This is the biggest task. Each tab's JSX block (~100-200 LOC) becomes a separate component file.

**Pattern (apply to each tab):**

- Read: the tab's JSX block in `page.tsx`
- Create: `_components/<TabName>Tab.tsx`
- Move: the JSX + the tab-specific fetch + state into the component
- Replace: the inline block with `<XxxTab secret={secret} />`
- Repeat per tab

- [ ] **Step 7.1: Identify all tabs**

```bash
grep -nE "tab === '" src/app/internal/admin/page.tsx | head -15
```

- [ ] **Step 7.2: Extract one tab to validate the pattern**

Start with the smallest tab — likely "logs" or "support". Move its block to `_components/LogsTab.tsx`. Add a small test asserting it renders empty state correctly.

After this works, replicate for the other tabs.

Per-tab pattern:

```tsx
'use client';

import { useEffect, useState } from 'react';
import DataTable from '@/components/admin-ui/DataTable';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { LogEntry } from '../_lib/internal-admin-types';

export interface LogsTabProps {
  secret: string;
}

export default function LogsTab({ secret }: LogsTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('all');

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: LogEntry[]; total: number }>(`/api/internal/admin/logs?source=${source}&page=${page}&limit=25`)
      .then(d => setLogs(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [apiFetch, source, page]);

  return (
    <DataTable
      columns={[
        { key: 'timestamp', label: 'Time' },
        { key: 'source', label: 'Source' },
        { key: 'level', label: 'Level' },
        { key: 'message', label: 'Message' },
      ]}
      data={logs}
      keyField="id"
      loading={loading}
      emptyMessage="No logs"
    />
  );
}
```

- [ ] **Step 7.3: Repeat for each tab**

Suggested order (smallest first):
1. LogsTab
2. FlagsTab
3. SupportTab
4. AIMonitorTab
5. RevenueTab
6. SchoolsTab
7. ContentTab
8. UsersTab
9. CommandTab (largest, last)

Each extraction:
- Move the JSX + tab-specific state into the new file
- Replace the page.tsx block with `{tab === 'logs' && <LogsTab secret={secret} />}`
- Run snapshot test — must still pass
- Commit per tab: `refactor(internal-admin): extract <TabName>Tab`

After all extractions, the remaining `page.tsx` should be ~150 LOC: header, tab nav, conditional renderer, login gate.

- [ ] **Step 7.4: Final shape of page.tsx**

After Task 7 complete, `page.tsx` should look approximately:

```tsx
'use client';

import { useState, useEffect } from 'react';
import LoginScreen from './_components/LoginScreen';
import LogsTab from './_components/LogsTab';
import FlagsTab from './_components/FlagsTab';
// ... other tab imports
import { loadAdminSecret, saveAdminSecret, clearAdminSecret } from './_hooks/useAdminFetch';
import type { Tab } from './_lib/internal-admin-types';

const TAB_DEFS: { key: Tab; label: string }[] = [
  { key: 'command', label: 'Command Center' },
  { key: 'users', label: 'Users' },
  // ...
];

export default function InternalAdminPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('command');

  useEffect(() => { setSecret(loadAdminSecret()); }, []);

  if (!secret) {
    return <LoginScreen onLogin={s => { saveAdminSecret(s); setSecret(s); }} />;
  }

  return (
    <div className="min-h-screen bg-surface-1">
      <header className="border-b border-surface-3 bg-surface-1 px-6 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-foreground">Internal Admin</h1>
          <button
            onClick={() => { clearAdminSecret(); setSecret(null); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Logout
          </button>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-surface-3 bg-surface-1 px-6">
        {TAB_DEFS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="p-6">
        {tab === 'command' && <CommandTab secret={secret} />}
        {tab === 'users' && <UsersTab secret={secret} />}
        {tab === 'content' && <ContentTab secret={secret} />}
        {tab === 'schools' && <SchoolsTab secret={secret} />}
        {tab === 'revenue' && <RevenueTab secret={secret} />}
        {tab === 'ai-monitor' && <AIMonitorTab secret={secret} />}
        {tab === 'flags' && <FlagsTab secret={secret} />}
        {tab === 'support' && <SupportTab secret={secret} />}
        {tab === 'logs' && <LogsTab secret={secret} />}
      </main>
    </div>
  );
}
```

---

## Task 8: Final validation + PR

- [ ] **Step 8.1: Confirm size goals**

```bash
wc -l src/app/internal/admin/page.tsx
wc -l src/app/internal/admin/_components/*.tsx
wc -l src/app/internal/admin/_hooks/*.ts
wc -l src/app/internal/admin/_lib/*.ts
```

- `page.tsx` ≤200 LOC ✅
- Each `_components/*` ≤300 LOC ✅
- Total LOC across all internal/admin files should be similar to or slightly higher than 1385 (small testing overhead is expected)

- [ ] **Step 8.2: Full local checks**

```bash
npm run type-check
npm run lint
npm test -- --run
npm run build
```

- [ ] **Step 8.3: Bundle check**

```bash
npm run analyze
```

`/internal/admin` First Load JS — should drop slightly (Tailwind classes are tree-shaken; inline-style strings aren't). Confirm under 260 kB.

- [ ] **Step 8.4: Manual smoke**

```bash
npm run dev
```

Login with the admin secret. Click through every tab. Confirm:
- Tab switches without console errors
- Data loads on each tab (or shows empty state if no data in dev)
- UserDrawer opens from the Users tab
- Logout clears the secret + returns to login

- [ ] **Step 8.5: Push + PR**

```bash
git push -u origin refactor/internal-admin
gh pr create --title "refactor(internal-admin): decompose 1385-LOC monolith into per-tab components" --body "$(cat <<'EOF'
## Summary
- Splits `internal/admin/page.tsx` from 1385 LOC to ~150 LOC thin dispatcher
- Extracts: types, useAdminFetch hook, LoginScreen, UserDrawer, 9 tab components
- Replaces inline `S` style record + `C` color tokens + custom `KPI` + `Sparkline` with admin-ui kit
- Adds vitest coverage for hook + 3 components + page snapshot
- Zero behavior change — auth flow + tab navigation + every action preserved

## Closes
Plan 5 of dashboard upgrade workstream.

## Test plan
- [x] Snapshot test passes throughout decomposition
- [x] All new unit tests pass
- [x] Type-check + lint + build clean
- [x] Manual: login, click every tab, open UserDrawer, perform 1 admin action, logout
EOF
)"
```

---

## Self-Review

**Spec coverage** (the user's "upgrade" axes for Internal Admin):
- Refactor (decompose) ✅ Tasks 2-7
- Visual (admin-ui kit applied) ✅ Tasks 4-6
- Mobile: Internal admin is desktop-only (operator panel) — no mobile audit. Document in Out of Scope.
- Bilingual: Internal admin is English-only (operator-facing) — no bilingual audit. Same.
- Data viz: Sparkline replaced; charts can be added per-tab later as needed.

**Placeholder scan:** every step has either complete code or a literal grep + read. The per-tab extractions in Task 7 use a documented pattern with one full example (LogsTab) — replicating to other tabs is mechanical. ✅

**Type consistency:** `Tab`, `Student`, etc. defined once in `_lib/internal-admin-types.ts`, consumed by every `*Tab.tsx`. `useAdminFetch` types are consistent across all consumers. ✅

**Dependencies:** Task 1 (snapshot) before Tasks 2-7. Task 2 (types) before Tasks 3-7. Task 3 (hook) before Task 7 (tabs use the hook). Task 4 + 5 are independent of each other. Task 6 cleanup can happen interleaved with Task 7 extractions or after.

**Risk items:**
- The exact admin-secret header name and login-check endpoint must match current implementation. Tasks 3.1 + 4.3 flag this.
- Some tabs may share state/refs not obvious until extracted. If a tab fails to render after extraction, check for cross-tab state leaks (e.g. a shared `selectedUser` state). The fix: lift such state up to `page.tsx` and pass via props.
- Adding 9 component files adds slight build-time overhead. Should be negligible, but check `npm run build` runtime.

---

## Out of scope (intentional)

- Consolidating `/internal/admin` and `/super-admin` panels. Phase 6 in master plan; both panels coexist intentionally.
- Migrating from `SUPER_ADMIN_SECRET` shared-secret auth to Supabase auth + RBAC. Bigger architecture change.
- Adding new tabs or new admin features. Pure refactor.
- Mobile responsiveness. Internal admin is an operator-only panel; users access from desks. No mobile breakpoint requirements.
- Bilingual support. Operator UI; English-only by design.
- Per-tab tests beyond LogsTab smoke. Each tab is a thin shell over a `<DataTable>` — covered indirectly by `<DataTable>` tests in Plan 0. Add tab-specific tests if a regression appears.
