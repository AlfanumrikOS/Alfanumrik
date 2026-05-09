# Dashboard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the existing super-admin and school-admin UI primitives into a shared `src/components/admin-ui/` kit, add a chart library, unify the two shells around shared building blocks, make the kit bilingual + mobile-responsive, and document the API. This unblocks every other dashboard plan (1–6).

**Architecture:** Two near-identical sidebar shells live today at `src/app/super-admin/_components/AdminShell.tsx` and `src/app/school-admin/_components/SchoolAdminShell.tsx`. They share intent but duplicate ~70% of the structure. Six primitives (`StatCard`, `StatusBadge`, `StalenessTag`, `DetailDrawer`, `DataTable`, `admin-styles`) sit under super-admin only, even though school-admin pages re-implement them inline. We extract the primitives into `src/components/admin-ui/`, replace inline hex literals with the existing CSS-variable Tailwind tokens (`primary`, `surface-1/2/3`, `success`, `danger`, etc.), extract a shared `<DashboardSidebar>` that both shells compose, and add a Recharts-based `<Chart>` wrapper layer. Both shells stay separate (different auth/tenancy concerns) but share primitives.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript, Tailwind 3.4 (existing CSS-var tokens), Recharts 2.x (new dep), Vitest + React Testing Library (existing test infra).

**Solo-developer estimate:** ~5 working days. Day 1 setup + lift small primitives. Day 2 lift DataTable + Tailwind migration. Day 3 sidebar extraction + shell refactor. Day 4 mobile responsive + Recharts. Day 5 docs + validation + commit.

---

## File Structure

**Create:**
- `src/components/admin-ui/index.ts` — public exports
- `src/components/admin-ui/StatCard.tsx`
- `src/components/admin-ui/StatusBadge.tsx`
- `src/components/admin-ui/StalenessTag.tsx`
- `src/components/admin-ui/DetailDrawer.tsx`
- `src/components/admin-ui/DataTable.tsx`
- `src/components/admin-ui/DashboardSidebar.tsx` — shared sidebar primitive both shells compose
- `src/components/admin-ui/charts/LineChart.tsx`
- `src/components/admin-ui/charts/BarChart.tsx`
- `src/components/admin-ui/charts/DonutChart.tsx`
- `src/components/admin-ui/charts/index.ts`
- `src/components/admin-ui/README.md` — kit documentation
- `src/__tests__/admin-ui/StatCard.test.tsx`
- `src/__tests__/admin-ui/StatusBadge.test.tsx`
- `src/__tests__/admin-ui/StalenessTag.test.tsx`
- `src/__tests__/admin-ui/DetailDrawer.test.tsx`
- `src/__tests__/admin-ui/DataTable.test.tsx`
- `src/__tests__/admin-ui/DashboardSidebar.test.tsx`
- `src/__tests__/admin-ui/charts/LineChart.test.tsx`

**Modify:**
- `package.json` — add `recharts`
- `src/app/super-admin/_components/AdminShell.tsx` — refactor to use shared sidebar; add bilingual labels (P7 fix); ~120 LOC reduction
- `src/app/school-admin/_components/SchoolAdminShell.tsx` — refactor to use shared sidebar; ~80 LOC reduction
- `src/app/super-admin/_components/StatCard.tsx` — re-export from `admin-ui`
- `src/app/super-admin/_components/StatusBadge.tsx` — re-export
- `src/app/super-admin/_components/StalenessTag.tsx` — re-export
- `src/app/super-admin/_components/DetailDrawer.tsx` — re-export
- `src/app/super-admin/_components/DataTable.tsx` — re-export
- `src/app/super-admin/_components/admin-styles.ts` — keep but mark deprecated; no consumers should add new usage

**Validation target:**
- `src/app/super-admin/analytics/page.tsx` — migrate to use `admin-ui` kit + a Recharts chart, as Plan 0's validation page

---

## Pre-flight

- [ ] **Step 0.1: Install dependencies in canonical**

The canonical clone at `C:\Users\Bharangpur Primary\Alfanumrik\` has no `node_modules` yet. Run install before any test/typecheck/build.

```bash
cd "C:/Users/Bharangpur Primary/Alfanumrik" && npm install
```

Expected: completes in 2–5 min. If `npm install` errors on Windows path lengths, run `git config --system core.longpaths true` first.

- [ ] **Step 0.2: Confirm baseline is green**

```bash
npm run type-check && npm run lint && npm test -- --run
```

Expected: all three pass. If any fails on a clean checkout of `main`, stop and triage — Plan 0 should not be writing on top of red.

---

## Task 1: Add Recharts and create the admin-ui module

**Files:**
- Modify: `package.json`
- Create: `src/components/admin-ui/index.ts`

- [ ] **Step 1.1: Add Recharts dependency**

```bash
npm install recharts@^2.15.0
```

Expected: `recharts` and `victory-vendor` (its peer) added to `node_modules`. Recharts 2.x supports React 18, ~50 KB gzip.

- [ ] **Step 1.2: Verify the install did not break the build budget**

```bash
npm run build
```

Recharts is loaded only by chart wrappers (next step), so it should not affect base shared JS. After Plan 0 validates a chart on one page, confirm pages remain under the P10 budget (260 kB per page).

- [ ] **Step 1.3: Create the empty admin-ui module file**

Create `src/components/admin-ui/index.ts` with placeholder exports we'll fill in as we lift each primitive:

```ts
// src/components/admin-ui/index.ts
//
// Shared dashboard UI primitives used by /super-admin, /school-admin,
// and (after Plans 1-2) /teacher and /parent shells. Built on the
// existing CSS-variable Tailwind tokens defined in tailwind.config.js
// (primary, surface-1/2/3, success, warning, danger, info).
//
// Lift status: filled in task-by-task. See docs/superpowers/plans/2026-05-09-dashboard-foundation.md.

export {};
```

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): scaffold shared kit module + add recharts dep"
```

---

## Task 2: Lift StatCard

**Files:**
- Read: `src/app/super-admin/_components/StatCard.tsx`
- Create: `src/components/admin-ui/StatCard.tsx`
- Create: `src/__tests__/admin-ui/StatCard.test.tsx`
- Modify: `src/components/admin-ui/index.ts`
- Modify: `src/app/super-admin/_components/StatCard.tsx` (turn into re-export)

- [ ] **Step 2.1: Write the failing test first**

`src/__tests__/admin-ui/StatCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import StatCard from '@/components/admin-ui/StatCard';

describe('admin-ui/StatCard', () => {
  it('renders label and numeric value with thousands separator', () => {
    render(<StatCard label="Active Users" value={12345} />);
    expect(screen.getByText('Active Users')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('renders string value as-is (no localization)', () => {
    render(<StatCard label="Status" value="—" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows positive trend in success color', () => {
    render(<StatCard label="x" value={10} trend={{ value: 5, label: 'this week' }} />);
    const trend = screen.getByText(/\+5 this week/);
    expect(trend).toHaveClass('text-success');
  });

  it('shows negative trend in danger color', () => {
    render(<StatCard label="x" value={10} trend={{ value: -3, label: 'this week' }} />);
    const trend = screen.getByText(/-3 this week/);
    expect(trend).toHaveClass('text-danger');
  });

  it('renders subtitle when provided', () => {
    render(<StatCard label="x" value={1} subtitle="last 24h" />);
    expect(screen.getByText('last 24h')).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<StatCard label="x" value={1} onClick={onClick} />);
    await screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/admin-ui/StatCard.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/admin-ui/StatCard'".

- [ ] **Step 2.3: Create the new StatCard using Tailwind tokens**

`src/components/admin-ui/StatCard.tsx`:

```tsx
'use client';

import { twMerge } from 'tailwind-merge';

export interface StatCardProps {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  /** Hex color for the left accent stripe. Pass undefined for no stripe. */
  accentColor?: string;
  subtitle?: string;
  trend?: { value: number; label: string };
  onClick?: () => void;
  className?: string;
}

export default function StatCard({
  label, value, icon, accentColor, subtitle, trend, onClick, className,
}: StatCardProps) {
  const isClickable = !!onClick;
  const Tag = isClickable ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      type={isClickable ? 'button' : undefined}
      className={twMerge(
        'block w-full text-left rounded-lg border border-surface-3 bg-surface-1 p-4 transition-shadow',
        isClickable && 'cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary',
        className,
      )}
      style={accentColor ? { borderLeft: `3px solid ${accentColor}` } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-3xl font-extrabold leading-tight text-foreground">
            {typeof value === 'number' && value >= 0 ? value.toLocaleString() : value}
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
          {trend && (
            <div className={twMerge(
              'mt-1 text-[11px] font-semibold',
              trend.value >= 0 ? 'text-success' : 'text-danger',
            )}>
              {trend.value >= 0 ? '+' : ''}{trend.value} {trend.label}
            </div>
          )}
        </div>
        {icon && <span className="text-2xl opacity-70">{icon}</span>}
      </div>
    </Tag>
  );
}
```

NOTE on tokens: `text-foreground` and `text-muted-foreground` may not yet exist in `tailwind.config.js`. Check `globals.css` for `--foreground` / `--muted-foreground` CSS vars first. If absent, use `text-gray-900` / `text-gray-500` as fallback or extend the tailwind config in this same step:

```js
// tailwind.config.js (add inside theme.extend.colors)
foreground: 'var(--text-1, #111827)',
'muted-foreground': 'var(--text-3, #9CA3AF)',
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/admin-ui/StatCard.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 2.5: Re-export from old path so existing imports keep working**

Replace `src/app/super-admin/_components/StatCard.tsx` with:

```tsx
// Re-export for backwards compatibility. New code should import from
// '@/components/admin-ui' instead.
export { default } from '@/components/admin-ui/StatCard';
export type { StatCardProps } from '@/components/admin-ui/StatCard';
```

- [ ] **Step 2.6: Add to admin-ui module index**

Update `src/components/admin-ui/index.ts`:

```ts
export { default as StatCard } from './StatCard';
export type { StatCardProps } from './StatCard';
```

- [ ] **Step 2.7: Verify nothing broke**

```bash
npm run type-check && npm run lint && npx vitest run
```

Expected: all green. The visual re-export means every existing super-admin page still imports `from './StatCard'` and renders the new Tailwind-based version. Visually the borders may shift by 1px due to the rewrite — note in commit message.

- [ ] **Step 2.8: Manual visual smoke**

```bash
npm run dev
```

Open `http://localhost:3000/super-admin` after logging in. Confirm StatCards still render and look near-identical (allow ~1px border tweaks). If significantly different, diff against the old inline-style version.

- [ ] **Step 2.9: Commit**

```bash
git add src/components/admin-ui/StatCard.tsx src/__tests__/admin-ui/StatCard.test.tsx src/app/super-admin/_components/StatCard.tsx src/components/admin-ui/index.ts tailwind.config.js
git commit -m "feat(admin-ui): lift StatCard to shared kit, switch to tailwind tokens"
```

---

## Task 3: Lift StatusBadge

**Files:**
- Create: `src/components/admin-ui/StatusBadge.tsx`
- Create: `src/__tests__/admin-ui/StatusBadge.test.tsx`
- Modify: `src/components/admin-ui/index.ts`
- Modify: `src/app/super-admin/_components/StatusBadge.tsx` (re-export)

- [ ] **Step 3.1: Write failing test**

`src/__tests__/admin-ui/StatusBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import StatusBadge from '@/components/admin-ui/StatusBadge';

describe('admin-ui/StatusBadge', () => {
  it('defaults to neutral variant', () => {
    render(<StatusBadge label="Pending" />);
    const el = screen.getByText('Pending');
    expect(el).toHaveClass('bg-surface-2');
  });

  it.each([
    ['success', 'bg-success/10', 'text-success'],
    ['danger', 'bg-danger/10', 'text-danger'],
    ['warning', 'bg-warning/10', 'text-warning'],
    ['info', 'bg-info/10', 'text-info'],
  ])('renders %s variant with correct classes', (variant, bgClass, fgClass) => {
    render(<StatusBadge label="x" variant={variant as 'success' | 'danger' | 'warning' | 'info'} />);
    const el = screen.getByText('x');
    expect(el).toHaveClass(bgClass);
    expect(el).toHaveClass(fgClass);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/admin-ui/StatusBadge.test.tsx
```

Expected: FAIL.

- [ ] **Step 3.3: Implement using Tailwind variants**

`src/components/admin-ui/StatusBadge.tsx`:

```tsx
'use client';

import { twMerge } from 'tailwind-merge';

export type StatusBadgeVariant = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const VARIANT_CLASSES: Record<StatusBadgeVariant, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-surface-2 text-muted-foreground',
};

export interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  className?: string;
}

export default function StatusBadge({ label, variant = 'neutral', className }: StatusBadgeProps) {
  return (
    <span className={twMerge(
      'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tracking-wide',
      VARIANT_CLASSES[variant],
      className,
    )}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/admin-ui/StatusBadge.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 3.5: Replace old file with re-export and update module index**

`src/app/super-admin/_components/StatusBadge.tsx`:

```tsx
export { default } from '@/components/admin-ui/StatusBadge';
export type { StatusBadgeProps, StatusBadgeVariant } from '@/components/admin-ui/StatusBadge';
```

`src/components/admin-ui/index.ts`:

```ts
export { default as StatCard } from './StatCard';
export type { StatCardProps } from './StatCard';
export { default as StatusBadge } from './StatusBadge';
export type { StatusBadgeProps, StatusBadgeVariant } from './StatusBadge';
```

- [ ] **Step 3.6: Smoke + commit**

```bash
npm run type-check && npx vitest run
git add src/components/admin-ui/StatusBadge.tsx src/__tests__/admin-ui/StatusBadge.test.tsx src/app/super-admin/_components/StatusBadge.tsx src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): lift StatusBadge to shared kit"
```

---

## Task 4: Lift StalenessTag (already Tailwind, simplest)

**Files:**
- Create: `src/components/admin-ui/StalenessTag.tsx`
- Create: `src/__tests__/admin-ui/StalenessTag.test.tsx`
- Modify: `src/components/admin-ui/index.ts`
- Modify: `src/app/super-admin/_components/StalenessTag.tsx` (re-export)

- [ ] **Step 4.1: Write failing test**

`src/__tests__/admin-ui/StalenessTag.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { StalenessTag } from '@/components/admin-ui/StalenessTag';

describe('admin-ui/StalenessTag', () => {
  it('returns null when lastUpdated is null', () => {
    const { container } = render(<StalenessTag lastUpdated={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "just now" for recent updates', () => {
    const recent = new Date(Date.now() - 30_000); // 30s ago
    render(<StalenessTag lastUpdated={recent} />);
    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it('shows minutes ago for older updates', () => {
    const old = new Date(Date.now() - 3 * 60_000); // 3m ago
    render(<StalenessTag lastUpdated={old} />);
    expect(screen.getByText(/3m ago/)).toBeInTheDocument();
  });

  it('marks as stale past threshold', () => {
    const stale = new Date(Date.now() - 10 * 60_000); // 10m ago, default threshold 5
    render(<StalenessTag lastUpdated={stale} />);
    const el = screen.getByText(/10m ago/);
    expect(el).toHaveClass('text-warning');
    expect(el.textContent).toContain('⚠');
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/admin-ui/StalenessTag.test.tsx
```

Expected: FAIL.

- [ ] **Step 4.3: Copy from existing source, switch `text-amber-600` → `text-warning`, `text-gray-400` → `text-muted-foreground`**

`src/components/admin-ui/StalenessTag.tsx`:

```tsx
'use client';

export interface StalenessTagProps {
  lastUpdated: Date | null;
  thresholdMinutes?: number;
}

export function StalenessTag({ lastUpdated, thresholdMinutes = 5 }: StalenessTagProps) {
  if (!lastUpdated) return null;

  const ageSeconds = Math.round((Date.now() - lastUpdated.getTime()) / 1000);
  const ageMinutes = Math.round(ageSeconds / 60);
  const isStale = ageMinutes >= thresholdMinutes;

  const label = ageSeconds < 60 ? 'just now' : `${ageMinutes}m ago`;

  return (
    <span className={`text-xs ${isStale ? 'text-warning' : 'text-muted-foreground'}`}>
      {label}{isStale ? ' ⚠' : ''}
    </span>
  );
}
```

- [ ] **Step 4.4: Test passes, replace old file with re-export, update index, commit**

```bash
npx vitest run src/__tests__/admin-ui/StalenessTag.test.tsx
```

Replace `src/app/super-admin/_components/StalenessTag.tsx`:

```tsx
export { StalenessTag } from '@/components/admin-ui/StalenessTag';
export type { StalenessTagProps } from '@/components/admin-ui/StalenessTag';
```

Add to `src/components/admin-ui/index.ts`:

```ts
export { StalenessTag } from './StalenessTag';
export type { StalenessTagProps } from './StalenessTag';
```

```bash
git add src/components/admin-ui/StalenessTag.tsx src/__tests__/admin-ui/StalenessTag.test.tsx src/app/super-admin/_components/StalenessTag.tsx src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): lift StalenessTag to shared kit, semantic tokens"
```

---

## Task 5: Lift DetailDrawer

**Files:**
- Create: `src/components/admin-ui/DetailDrawer.tsx`
- Create: `src/__tests__/admin-ui/DetailDrawer.test.tsx`
- Modify: `src/components/admin-ui/index.ts`
- Modify: `src/app/super-admin/_components/DetailDrawer.tsx` (re-export)

- [ ] **Step 5.1: Write failing tests**

`src/__tests__/admin-ui/DetailDrawer.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from '@/components/admin-ui/DetailDrawer';

describe('admin-ui/DetailDrawer', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <DetailDrawer open={false} onClose={() => {}} title="x">body</DetailDrawer>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title and children when open', () => {
    render(
      <DetailDrawer open={true} onClose={() => {}} title="Student details">
        <p>body content</p>
      </DetailDrawer>,
    );
    expect(screen.getByText('Student details')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn();
    render(<DetailDrawer open={true} onClose={onClose} title="x">y</DetailDrawer>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn();
    render(<DetailDrawer open={true} onClose={onClose} title="x">y</DetailDrawer>);
    fireEvent.click(screen.getByTestId('detail-drawer-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has correct ARIA role for accessibility', () => {
    render(<DetailDrawer open={true} onClose={() => {}} title="x">y</DetailDrawer>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'x');
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/admin-ui/DetailDrawer.test.tsx
```

- [ ] **Step 5.3: Implement with Tailwind + a11y improvements**

`src/components/admin-ui/DetailDrawer.tsx`:

```tsx
'use client';

import { useEffect } from 'react';

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Drawer width in pixels. Mobile (<640px) always full-width. */
  width?: number;
}

export default function DetailDrawer({
  open, onClose, title, children, width = 480,
}: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden'; // lock background scroll
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        data-testid="detail-drawer-overlay"
        onClick={onClose}
        className="fixed inset-0 bg-black/20 z-[999] animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 bottom-0 z-[1000] flex flex-col bg-surface-1 border-l border-surface-3 shadow-2xl overflow-hidden animate-slide-up max-sm:w-full"
        style={{ width: typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : width }}
      >
        <div className="flex items-center justify-between border-b border-surface-3 p-4 shrink-0">
          <h3 className="m-0 text-base font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1 text-sm text-muted-foreground hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 5.4: Tests pass, replace old file, commit**

```bash
npx vitest run src/__tests__/admin-ui/DetailDrawer.test.tsx
```

Replace `src/app/super-admin/_components/DetailDrawer.tsx`:

```tsx
export { default } from '@/components/admin-ui/DetailDrawer';
export type { DetailDrawerProps } from '@/components/admin-ui/DetailDrawer';
```

Add to index, then commit:

```bash
git add src/components/admin-ui/DetailDrawer.tsx src/__tests__/admin-ui/DetailDrawer.test.tsx src/app/super-admin/_components/DetailDrawer.tsx src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): lift DetailDrawer to shared kit, add aria-modal + scroll lock"
```

---

## Task 6: Lift DataTable

**Files:**
- Create: `src/components/admin-ui/DataTable.tsx`
- Create: `src/__tests__/admin-ui/DataTable.test.tsx`
- Modify: `src/components/admin-ui/index.ts`
- Modify: `src/app/super-admin/_components/DataTable.tsx` (re-export)

- [ ] **Step 6.1: Write failing tests**

`src/__tests__/admin-ui/DataTable.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable, { Column } from '@/components/admin-ui/DataTable';

interface Row { id: string; name: string; age: number }
const cols: Column<Row>[] = [
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age' },
];
const rows: Row[] = [
  { id: '1', name: 'Charlie', age: 30 },
  { id: '2', name: 'Alice', age: 25 },
  { id: '3', name: 'Bob', age: 28 },
];

describe('admin-ui/DataTable', () => {
  it('renders columns and rows', () => {
    render(<DataTable columns={cols} data={rows} keyField="id" />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<DataTable columns={cols} data={[]} keyField="id" loading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<DataTable columns={cols} data={[]} keyField="id" emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('sorts ascending then descending on header click', () => {
    render(<DataTable columns={cols} data={rows} keyField="id" />);
    const nameHeader = screen.getByText('Name');
    fireEvent.click(nameHeader);
    const cells = screen.getAllByRole('cell').filter(c => /Alice|Bob|Charlie/.test(c.textContent ?? ''));
    expect(cells[0].textContent).toBe('Alice');
    fireEvent.click(nameHeader);
    const cells2 = screen.getAllByRole('cell').filter(c => /Alice|Bob|Charlie/.test(c.textContent ?? ''));
    expect(cells2[0].textContent).toBe('Charlie');
  });

  it('fires onRowClick', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={cols} data={rows} keyField="id" onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Charlie'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('selectable mode toggles selection', () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={cols}
        data={rows}
        keyField="id"
        selectable
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // First is the header "select all", rest are per-row
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });
});
```

- [ ] **Step 6.2: Run failing tests**

```bash
npx vitest run src/__tests__/admin-ui/DataTable.test.tsx
```

- [ ] **Step 6.3: Port DataTable, drop the inline `S` styles in favor of Tailwind classes**

`src/components/admin-ui/DataTable.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { twMerge } from 'tailwind-merge';

export interface Column<T> {
  key: string;
  label: string;
  width?: number | string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
}

const TH_BASE = 'sticky top-0 z-10 bg-surface-2 border-b-2 border-surface-3 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TD_BASE = 'border-b border-surface-3 px-3.5 py-2.5 text-sm text-foreground';

export default function DataTable<T extends Record<string, unknown>>({
  columns, data, keyField, onRowClick, selectable, selectedIds, onSelectionChange,
  emptyMessage = 'No data', loading, className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    const allIds = new Set(data.map(r => String(r[keyField])));
    if (selectedIds && selectedIds.size === data.length) onSelectionChange(new Set());
    else onSelectionChange(allIds);
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  const allSelected = !!selectedIds && selectedIds.size === data.length && data.length > 0;
  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className={twMerge('overflow-x-auto rounded-lg border border-surface-3', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {selectable && (
              <th className={twMerge(TH_BASE, 'w-10 text-center')}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
            )}
            {columns.map(col => (
              <th
                key={col.key}
                style={{ width: col.width }}
                onClick={() => col.sortable !== false && toggleSort(col.key)}
                className={twMerge(TH_BASE, col.sortable !== false && 'cursor-pointer select-none')}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <span className="text-[10px] text-foreground">{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={colSpan} className={twMerge(TD_BASE, 'p-8 text-center text-muted-foreground')}>
                Loading...
              </td>
            </tr>
          )}
          {!loading && sortedData.length === 0 && (
            <tr>
              <td colSpan={colSpan} className={twMerge(TD_BASE, 'p-8 text-center text-muted-foreground')}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {!loading && sortedData.map(row => {
            const id = String(row[keyField]);
            const isSelected = selectedIds?.has(id);
            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(row)}
                className={twMerge(
                  'transition-colors',
                  onRowClick && 'cursor-pointer',
                  isSelected ? 'bg-primary/5' : 'hover:bg-surface-2',
                )}
              >
                {selectable && (
                  <td
                    className={twMerge(TD_BASE, 'w-10 text-center')}
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select row ${id}`}
                      checked={!!isSelected}
                      onChange={() => toggleRow(id)}
                      className="cursor-pointer"
                    />
                  </td>
                )}
                {columns.map(col => (
                  <td key={col.key} style={{ width: col.width }} className={TD_BASE}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6.4: Tests pass, re-export, commit**

```bash
npx vitest run src/__tests__/admin-ui/DataTable.test.tsx
```

Replace `src/app/super-admin/_components/DataTable.tsx`:

```tsx
export { default } from '@/components/admin-ui/DataTable';
export type { Column, DataTableProps } from '@/components/admin-ui/DataTable';
```

Update `src/components/admin-ui/index.ts`:

```ts
export { default as DataTable } from './DataTable';
export type { Column, DataTableProps } from './DataTable';
```

```bash
git add src/components/admin-ui/DataTable.tsx src/__tests__/admin-ui/DataTable.test.tsx src/app/super-admin/_components/DataTable.tsx src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): lift DataTable to shared kit, switch to tailwind tokens"
```

---

## Task 7: Extract DashboardSidebar primitive

**Files:**
- Create: `src/components/admin-ui/DashboardSidebar.tsx`
- Create: `src/__tests__/admin-ui/DashboardSidebar.test.tsx`
- Modify: `src/components/admin-ui/index.ts`

- [ ] **Step 7.1: Write the failing tests for the new primitive**

`src/__tests__/admin-ui/DashboardSidebar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardSidebar, { SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';

const items: SidebarNavItem[] = [
  { href: '/x', label: 'Overview', labelHi: 'अवलोकन', icon: '▦' },
  { href: '/x/users', label: 'Users', labelHi: 'उपयोगकर्ता', icon: '⊕' },
];

describe('admin-ui/DashboardSidebar', () => {
  it('renders all items in English by default', () => {
    render(
      <DashboardSidebar
        brandTitle="Test"
        brandSubtitle="Sub"
        items={items}
        currentPath="/x"
        isHi={false}
      />,
    );
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('renders Hindi labels when isHi=true', () => {
    render(
      <DashboardSidebar brandTitle="Test" brandSubtitle="Sub" items={items} currentPath="/x" isHi={true} />,
    );
    expect(screen.getByText('अवलोकन')).toBeInTheDocument();
    expect(screen.getByText('उपयोगकर्ता')).toBeInTheDocument();
  });

  it('marks the current item as active', () => {
    render(
      <DashboardSidebar brandTitle="T" brandSubtitle="S" items={items} currentPath="/x/users" isHi={false} />,
    );
    expect(screen.getByText('Users').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Overview').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('collapses when toggle clicked', () => {
    render(
      <DashboardSidebar brandTitle="T" brandSubtitle="S" items={items} currentPath="/x" isHi={false} />,
    );
    const toggle = screen.getByLabelText(/collapse|expand/i);
    fireEvent.click(toggle);
    // After collapse, label text is hidden but icon remains
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });

  it('hides items whose moduleKey resolves to false', () => {
    const itemsWithModule: SidebarNavItem[] = [
      ...items,
      { href: '/x/exams', label: 'Exams', labelHi: 'परीक्षा', icon: '⊙', moduleKey: 'testing_engine' },
    ];
    render(
      <DashboardSidebar
        brandTitle="T" brandSubtitle="S"
        items={itemsWithModule}
        currentPath="/x"
        isHi={false}
        moduleEnablement={{ testing_engine: false }}
      />,
    );
    expect(screen.queryByText('Exams')).not.toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('opens mobile drawer when hamburger clicked', () => {
    const { container } = render(
      <DashboardSidebar brandTitle="T" brandSubtitle="S" items={items} currentPath="/x" isHi={false} />,
    );
    const hamburger = screen.getByLabelText(/open menu/i);
    fireEvent.click(hamburger);
    expect(container.querySelector('[data-mobile-drawer="open"]')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.2: Run failing tests**

```bash
npx vitest run src/__tests__/admin-ui/DashboardSidebar.test.tsx
```

- [ ] **Step 7.3: Implement the shared sidebar**

`src/components/admin-ui/DashboardSidebar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { twMerge } from 'tailwind-merge';

export interface SidebarNavItem {
  href: string;
  label: string;
  labelHi: string;
  icon: React.ReactNode;
  /** When set, hide the item if moduleEnablement[moduleKey] === false. */
  moduleKey?: string;
}

export interface DashboardSidebarProps {
  /** Top-of-sidebar title (e.g. "Alfanumrik" or the school name). */
  brandTitle: string;
  /** Sub-title under the brand title (e.g. "Super Admin" or "School Administration"). */
  brandSubtitle: string;
  /** Optional logo URL. If absent, renders a colored initial tile. */
  logoUrl?: string | null;
  /** Hex color for active nav highlight. Defaults to brand-purple. */
  primaryColor?: string;
  items: SidebarNavItem[];
  /** Current pathname for active-item highlighting. */
  currentPath: string;
  isHi: boolean;
  /** Optional module enablement map. null/undefined → fail-open (show all items). */
  moduleEnablement?: Record<string, boolean> | null;
  /** Footer slot (e.g. logout button or "Powered by"). */
  footer?: React.ReactNode;
  className?: string;
}

const PRIMARY_DEFAULT = '#7C3AED';

export default function DashboardSidebar({
  brandTitle, brandSubtitle, logoUrl, primaryColor = PRIMARY_DEFAULT,
  items, currentPath, isHi, moduleEnablement = null, footer, className,
}: DashboardSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = items.filter(item => {
    if (!item.moduleKey) return true;
    if (moduleEnablement === null || moduleEnablement === undefined) return true;
    return moduleEnablement[item.moduleKey] !== false;
  });

  const sidebarBody = (
    <>
      {/* Brand header */}
      <div className="flex items-center gap-2 border-b border-surface-3 p-3 min-h-12">
        {logoUrl ? (
          <img src={logoUrl} alt={brandTitle} className="h-7 w-7 shrink-0 rounded-md object-cover" />
        ) : (
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
            style={{ background: primaryColor }}
          >
            {brandTitle[0]?.toUpperCase()}
          </div>
        )}
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="truncate text-[13px] font-bold text-foreground">{brandTitle}</div>
            <div className="text-[10px] text-muted-foreground">{brandSubtitle}</div>
          </div>
        )}
      </div>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden md:block px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
      >
        {collapsed ? '→' : '←'}
      </button>

      {/* Nav */}
      <nav className="flex-1 pt-1 overflow-y-auto">
        {visibleItems.map(item => {
          const isActive = currentPath === item.href ||
            (item.href !== items[0].href && currentPath.startsWith(item.href));
          const label = isHi ? item.labelHi : item.label;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              title={label}
              onClick={() => setMobileOpen(false)}
              className={twMerge(
                'flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors',
                'border-l-[3px]',
                isActive ? 'border-l-primary bg-primary/5 font-semibold text-primary' : 'border-l-transparent text-foreground/70 hover:bg-surface-2',
                collapsed && 'justify-center px-0',
              )}
              style={isActive ? { color: primaryColor, borderLeftColor: primaryColor, background: `${primaryColor}10` } : undefined}
            >
              <span className="text-[15px] shrink-0 w-5 text-center">{item.icon}</span>
              {!collapsed && <span className="truncate">{label}</span>}
            </a>
          );
        })}
      </nav>

      {/* Footer slot */}
      {footer && !collapsed && (
        <div className="border-t border-surface-3 p-3">{footer}</div>
      )}
    </>
  );

  return (
    <>
      {/* Mobile hamburger (visible <md) */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-3 left-3 z-50 rounded-md border border-surface-3 bg-surface-1 p-2 text-foreground shadow-sm"
      >
        ☰
      </button>

      {/* Desktop sidebar */}
      <aside
        className={twMerge(
          'hidden md:flex flex-col shrink-0 border-r border-surface-3 bg-surface-1 transition-[width]',
          className,
        )}
        style={{ width: collapsed ? 56 : 220 }}
      >
        {sidebarBody}
      </aside>

      {/* Mobile drawer (visible <md when open) */}
      {mobileOpen && (
        <>
          <div
            data-mobile-drawer="open"
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-black/30"
          />
          <aside className="md:hidden fixed top-0 bottom-0 left-0 z-50 flex w-64 flex-col bg-surface-1 shadow-2xl">
            {sidebarBody}
          </aside>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 7.4: Tests pass**

```bash
npx vitest run src/__tests__/admin-ui/DashboardSidebar.test.tsx
```

- [ ] **Step 7.5: Update index, commit**

Update `src/components/admin-ui/index.ts`:

```ts
export { default as DashboardSidebar } from './DashboardSidebar';
export type { DashboardSidebarProps, SidebarNavItem } from './DashboardSidebar';
```

```bash
git add src/components/admin-ui/DashboardSidebar.tsx src/__tests__/admin-ui/DashboardSidebar.test.tsx src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): add shared DashboardSidebar with bilingual + module-gated nav + mobile drawer"
```

---

## Task 8: Refactor SchoolAdminShell to use DashboardSidebar

**Files:**
- Modify: `src/app/school-admin/_components/SchoolAdminShell.tsx` (refactor — drop ~80 LOC of inline sidebar)

We do this BEFORE AdminShell because SchoolAdminShell already has bilingual labels and module gating, so it maps cleanly to the new primitive without semantic changes.

- [ ] **Step 8.1: Replace the sidebar block with DashboardSidebar**

Open `src/app/school-admin/_components/SchoolAdminShell.tsx`. Replace the entire `return (...)` body with:

```tsx
  return (
    <div className="flex min-h-screen bg-surface-2">
      <DashboardSidebar
        brandTitle={schoolName || (isHi ? 'स्कूल प्रशासन' : 'School Admin')}
        brandSubtitle={isHi ? 'स्कूल प्रशासन' : 'School Administration'}
        logoUrl={logoUrl}
        primaryColor={primaryColor}
        items={NAV_ITEMS}
        currentPath={pathname || ''}
        isHi={isHi}
        moduleEnablement={moduleEnablement}
        footer={
          (tenant.branding.showPoweredBy || tenant.schoolId) ? (
            <div className="text-[10px] text-muted-foreground">
              Powered by{' '}
              <a href="https://alfanumrik.com" className="text-primary no-underline">Alfanumrik</a>
            </div>
          ) : null
        }
      />
      <main className="flex-1 max-w-screen-xl overflow-auto p-6">{children}</main>
    </div>
  );
```

Add the import at top:

```tsx
import DashboardSidebar from '@/components/admin-ui/DashboardSidebar';
```

The `NAV_ITEMS` constant (lines 32-48 in current file) keeps the same shape — `SidebarNavItem` is structurally compatible with the existing `SchoolAdminNavItem` type.

- [ ] **Step 8.2: Verify type-check + tests + visual smoke**

```bash
npm run type-check && npx vitest run
npm run dev
```

Open `http://localhost:3000/school-admin` after logging in as a school admin. Verify:
- Sidebar renders identically (school logo, primary color, all 15 items)
- Module gating still works (try toggling a module via API and reload — gated item should disappear)
- Bilingual toggle still flips labels (Hindi via `isHi`)
- Footer "Powered by Alfanumrik" still shows when `showPoweredBy` true

Run the cross-check from memory: light mode + dark mode (if dark mode exists in this codebase — check globals.css), EN + हिं, mobile + desktop, active + hover + collapsed states.

- [ ] **Step 8.3: Commit**

```bash
git add src/app/school-admin/_components/SchoolAdminShell.tsx
git commit -m "refactor(school-admin): use shared DashboardSidebar primitive (-80 LOC)"
```

---

## Task 9: Refactor AdminShell + add bilingual labels (P7 fix)

**Files:**
- Modify: `src/app/super-admin/_components/AdminShell.tsx`

This is the most consequential refactor: AdminShell is currently NOT bilingual, violating P7. The lift fixes that.

- [ ] **Step 9.1: Add `labelHi` to NAV_ITEMS**

In `AdminShell.tsx`, replace `const NAV_ITEMS` (lines 22-47) with bilingual labels. Suggested translations (verify with assessment agent if uncertain — these technical terms often stay English):

```tsx
const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/super-admin', label: 'Overview', labelHi: 'अवलोकन', icon: '▦' },
  { href: '/super-admin/analytics', label: 'Analytics', labelHi: 'विश्लेषण', icon: '◍' },
  { href: '/super-admin/users', label: 'Users & Roles', labelHi: 'उपयोगकर्ता और भूमिकाएँ', icon: '⊕' },
  { href: '/super-admin/rbac', label: 'RBAC', labelHi: 'RBAC', icon: '⛊' },
  { href: '/super-admin/oauth-apps', label: 'OAuth Apps', labelHi: 'OAuth ऐप्स', icon: '⊚' },
  { href: '/super-admin/subscriptions', label: 'Subscriptions', labelHi: 'सदस्यता', icon: '◈' },
  { href: '/super-admin/learning', label: 'Learning Intel', labelHi: 'लर्निंग इंटेल', icon: '◉' },
  { href: '/super-admin/diagnostics', label: 'Diagnostics', labelHi: 'डायग्नोस्टिक्स', icon: '⊘' },
  { href: '/super-admin/marking-integrity', label: 'Marking Integrity', labelHi: 'अंकन सत्यनिष्ठा', icon: '⛉' },
  { href: '/super-admin/oracle-health', label: 'Oracle Health', labelHi: 'ओरेकल स्वास्थ्य', icon: '◐' },
  { href: '/super-admin/observability', label: 'Observability', labelHi: 'अवलोकनीयता', icon: '◎' },
  { href: '/super-admin/workbench', label: 'Data Workbench', labelHi: 'डेटा वर्कबेंच', icon: '⊞' },
  { href: '/super-admin/flags', label: 'Feature Flags', labelHi: 'फ़ीचर फ़्लैग्स', icon: '⊡' },
  { href: '/super-admin/institutions', label: 'Institutions', labelHi: 'संस्थान', icon: '⊟' },
  { href: '/super-admin/invoices', label: 'Invoices', labelHi: 'चालान', icon: '⊓' },
  { href: '/super-admin/analytics-b2b', label: 'B2B Analytics', labelHi: 'B2B विश्लेषण', icon: '⊿' },
  { href: '/super-admin/sla', label: 'SLA Monitor', labelHi: 'SLA मॉनिटर', icon: '⊗' },
  { href: '/super-admin/alerts', label: 'Alerts', labelHi: 'अलर्ट', icon: '⊚' },
  { href: '/super-admin/cms', label: 'CMS', labelHi: 'CMS', icon: '⊠' },
  { href: '/super-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊏' },
  { href: '/super-admin/logs', label: 'Audit Logs', labelHi: 'ऑडिट लॉग', icon: '⊙' },
  { href: '/super-admin/support', label: 'Support Center', labelHi: 'सहायता केंद्र', icon: '⊛' },
  { href: '/super-admin/bulk-actions', label: 'Bulk Actions', labelHi: 'बल्क क्रियाएँ', icon: '⊞' },
  { href: '/super-admin/demo', label: 'Demo Accounts', labelHi: 'डेमो खाते', icon: '⊜' },
];
```

Update the type imports at the top:

```tsx
import DashboardSidebar, { type SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';
import { useAuth } from '@/lib/AuthContext';
```

- [ ] **Step 9.2: Replace the inline sidebar in the return body**

Replace the entire `<aside>...</aside>` block (lines 134-216) with `<DashboardSidebar>`. Final return body:

```tsx
  const { isHi } = useAuth();

  return (
    <AdminCtx.Provider value={{ accessToken, adminName, supabase, headers, apiFetch }}>
      <div className="flex min-h-screen bg-surface-1">
        <DashboardSidebar
          brandTitle="ALFANUMRIK"
          brandSubtitle={isHi ? 'सुपर एडमिन' : 'Super Admin'}
          items={NAV_ITEMS}
          currentPath={currentPath}
          isHi={isHi}
          footer={
            <div>
              {adminName && (
                <div className="mb-2 truncate text-[11px] text-muted-foreground">{adminName}</div>
              )}
              <button
                onClick={async () => { await supabase.auth.signOut(); window.location.href = '/super-admin/login'; }}
                className="w-full rounded-md border border-surface-3 bg-surface-1 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
              >
                {isHi ? 'लॉगआउट' : 'Logout'}
              </button>
            </div>
          }
        />
        <main className="flex-1">
          <div className="max-w-screen-2xl p-6">{children}</div>
        </main>
      </div>
    </AdminCtx.Provider>
  );
```

The loading state (when `!accessToken`) can stay as-is or use Tailwind classes — whichever is shorter.

- [ ] **Step 9.3: Type-check + tests + visual smoke**

```bash
npm run type-check && npx vitest run
npm run dev
```

Login as super-admin. Confirm:
- All 24 nav items render
- Hindi toggle (if super-admin uses AuthContext.isHi — verify) flips labels
- Active item highlight matches old behavior
- Logout still works

NOTE: super-admin login flow may not pass through AuthContext (it has its own session). If `useAuth().isHi` returns undefined, the labels will fall through to English — which preserves current behavior. The bilingual support is wired but only activates if AuthContext is set up for super-admin sessions. That wiring is out of scope for Plan 0; document the gap in the commit message.

- [ ] **Step 9.4: Commit**

```bash
git add src/app/super-admin/_components/AdminShell.tsx
git commit -m "feat(super-admin): use shared DashboardSidebar + add bilingual nav labels (P7)"
```

---

## Task 10: Add Recharts wrappers — LineChart, BarChart, DonutChart

**Files:**
- Create: `src/components/admin-ui/charts/LineChart.tsx`
- Create: `src/components/admin-ui/charts/BarChart.tsx`
- Create: `src/components/admin-ui/charts/DonutChart.tsx`
- Create: `src/components/admin-ui/charts/index.ts`
- Create: `src/__tests__/admin-ui/charts/LineChart.test.tsx`
- Modify: `src/components/admin-ui/index.ts`

- [ ] **Step 10.1: Write a failing test for LineChart**

`src/__tests__/admin-ui/charts/LineChart.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import LineChart from '@/components/admin-ui/charts/LineChart';

describe('admin-ui/charts/LineChart', () => {
  it('renders SVG with one path per series', () => {
    const data = [
      { date: '2026-05-01', users: 100, sessions: 200 },
      { date: '2026-05-02', users: 110, sessions: 220 },
      { date: '2026-05-03', users: 120, sessions: 240 },
    ];
    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <LineChart
          data={data}
          xKey="date"
          series={[
            { key: 'users', label: 'Users' },
            { key: 'sessions', label: 'Sessions' },
          ]}
        />
      </div>,
    );
    // Recharts renders one <path class="recharts-line-curve"> per series
    const paths = container.querySelectorAll('.recharts-line-curve');
    expect(paths.length).toBe(2);
  });

  it('renders empty state when data is empty', () => {
    const { getByText } = render(
      <div style={{ width: 600, height: 300 }}>
        <LineChart data={[]} xKey="date" series={[{ key: 'users', label: 'Users' }]} />
      </div>,
    );
    expect(getByText(/No data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10.2: Run failing test**

```bash
npx vitest run src/__tests__/admin-ui/charts/LineChart.test.tsx
```

Expected: FAIL.

- [ ] **Step 10.3: Implement LineChart wrapper**

`src/components/admin-ui/charts/LineChart.tsx`:

```tsx
'use client';

import {
  ResponsiveContainer, LineChart as RechartsLineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

export interface ChartSeries {
  key: string;
  label: string;
  /** Hex color. Defaults to a token-driven palette by index. */
  color?: string;
}

export interface LineChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  series: ChartSeries[];
  /** Height in px. Width is always responsive to parent. Default 300. */
  height?: number;
  emptyMessage?: string;
}

const DEFAULT_PALETTE = ['#7C3AED', '#F97316', '#16A34A', '#DC2626', '#2563EB', '#D97706'];

export default function LineChart<T extends Record<string, unknown>>({
  data, xKey, series, height = 300, emptyMessage = 'No data',
}: LineChartProps<T>) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3, #E5E7EB)" />
        <XAxis dataKey={xKey} stroke="var(--text-3, #9CA3AF)" fontSize={11} />
        <YAxis stroke="var(--text-3, #9CA3AF)" fontSize={11} />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-1, #FFFFFF)',
            border: '1px solid var(--surface-3, #E5E7EB)',
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 10.4: Pass test, then mirror for BarChart and DonutChart**

```bash
npx vitest run src/__tests__/admin-ui/charts/LineChart.test.tsx
```

`src/components/admin-ui/charts/BarChart.tsx` — same shape as LineChart but uses Recharts `<BarChart>` and `<Bar>`. Implementation pattern:

```tsx
'use client';

import {
  ResponsiveContainer, BarChart as RechartsBarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { ChartSeries } from './LineChart';

export interface BarChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  series: ChartSeries[];
  height?: number;
  emptyMessage?: string;
  layout?: 'horizontal' | 'vertical';
}

const DEFAULT_PALETTE = ['#7C3AED', '#F97316', '#16A34A', '#DC2626', '#2563EB', '#D97706'];

export default function BarChart<T extends Record<string, unknown>>({
  data, xKey, series, height = 300, emptyMessage = 'No data', layout = 'horizontal',
}: BarChartProps<T>) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} layout={layout} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3, #E5E7EB)" />
        <XAxis type={layout === 'vertical' ? 'number' : 'category'} dataKey={layout === 'vertical' ? undefined : xKey} stroke="var(--text-3, #9CA3AF)" fontSize={11} />
        <YAxis type={layout === 'vertical' ? 'category' : 'number'} dataKey={layout === 'vertical' ? xKey : undefined} stroke="var(--text-3, #9CA3AF)" fontSize={11} />
        <Tooltip contentStyle={{ background: 'var(--surface-1, #FFFFFF)', border: '1px solid var(--surface-3, #E5E7EB)', borderRadius: 6, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]} radius={[4, 4, 0, 0]} />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
```

`src/components/admin-ui/charts/DonutChart.tsx`:

```tsx
'use client';

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  height?: number;
  innerRadiusPct?: number;
  emptyMessage?: string;
}

const DEFAULT_PALETTE = ['#7C3AED', '#F97316', '#16A34A', '#DC2626', '#2563EB', '#D97706'];

export default function DonutChart({
  data, height = 280, innerRadiusPct = 60, emptyMessage = 'No data',
}: DonutChartProps) {
  if (data.length === 0 || data.every(d => d.value === 0)) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={`${innerRadiusPct}%`} outerRadius="90%" paddingAngle={1}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={d.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: 'var(--surface-1, #FFFFFF)', border: '1px solid var(--surface-3, #E5E7EB)', borderRadius: 6, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

`src/components/admin-ui/charts/index.ts`:

```ts
export { default as LineChart } from './LineChart';
export type { LineChartProps, ChartSeries } from './LineChart';
export { default as BarChart } from './BarChart';
export type { BarChartProps } from './BarChart';
export { default as DonutChart } from './DonutChart';
export type { DonutChartProps, DonutSlice } from './DonutChart';
```

- [ ] **Step 10.5: Add charts to admin-ui module index**

Update `src/components/admin-ui/index.ts` to add:

```ts
export * from './charts';
```

- [ ] **Step 10.6: Type-check + commit**

```bash
npm run type-check && npx vitest run
git add src/components/admin-ui/charts src/__tests__/admin-ui/charts src/components/admin-ui/index.ts
git commit -m "feat(admin-ui): add Recharts wrappers (LineChart, BarChart, DonutChart) with token-driven palette"
```

---

## Task 11: Validate the kit on a real page — migrate /super-admin/analytics

**Files:**
- Modify: `src/app/super-admin/analytics/page.tsx`

This is the proof-of-life: take one existing admin page that uses StatCard/DataTable inline + has a hand-rolled visualization, and migrate it to the new kit. If this works, every other page in /super-admin and /school-admin can follow the same pattern.

- [ ] **Step 11.1: Read the current analytics page**

```bash
wc -l src/app/super-admin/analytics/page.tsx
```

If the page is very large (>500 LOC), scope this validation to one section. The goal is to demonstrate kit usage end-to-end, not to refactor everything.

- [ ] **Step 11.2: Replace one ad-hoc visualization with `<LineChart>`**

Find any block in the analytics page that renders a hand-rolled <svg> chart, hand-drawn `<div>` bars, or `dangerouslySetInnerHTML` SVG. Replace with:

```tsx
import { LineChart } from '@/components/admin-ui';

// inside the page component, replace the hand-rolled chart:
<LineChart
  data={trendData}
  xKey="date"
  series={[
    { key: 'dau', label: 'Daily Active Users' },
    { key: 'mau', label: 'Monthly Active Users' },
  ]}
  height={320}
/>
```

- [ ] **Step 11.3: Replace direct `import StatCard from '../_components/StatCard'` with `from '@/components/admin-ui'`**

Search the file:

```bash
grep -n "from '../_components" src/app/super-admin/analytics/page.tsx
```

Update each import to pull from `@/components/admin-ui` where the symbol is now exported.

- [ ] **Step 11.4: Run dev + manual smoke**

```bash
npm run dev
```

Open `http://localhost:3000/super-admin/analytics`. Confirm:
- Page renders without errors
- StatCards look identical (or 1px-tweaked) to before
- The new chart renders, is responsive on resize, and shows tooltips on hover
- Cross-check (per memory `feedback_cross_check_previews.md`): light/dark mode, EN/हिं, mobile + desktop, hover/active/empty states

- [ ] **Step 11.5: Commit**

```bash
git add src/app/super-admin/analytics/page.tsx
git commit -m "refactor(super-admin): migrate analytics to admin-ui kit + Recharts LineChart"
```

---

## Task 12: Documentation

**Files:**
- Create: `src/components/admin-ui/README.md`
- Modify: `src/app/super-admin/_components/admin-styles.ts` (add deprecation banner)

- [ ] **Step 12.1: Write the kit README**

`src/components/admin-ui/README.md`:

````markdown
# admin-ui — Shared Dashboard Primitives

Used by `/super-admin`, `/school-admin`, and (after Plans 1-2) `/teacher` and `/parent` shells. Consume from `@/components/admin-ui`.

## Components

| Symbol | Purpose |
|---|---|
| `StatCard` | Headline-number tile with optional trend, icon, accent stripe, click handler |
| `StatusBadge` | Pill label with `success` / `danger` / `warning` / `info` / `neutral` variants |
| `StalenessTag` | "3m ago" tag that turns warning-colored past a threshold |
| `DetailDrawer` | Right-side modal drawer with ESC + overlay close, ARIA dialog, body scroll lock |
| `DataTable<T>` | Sortable, selectable table with empty/loading states, generic over row type |
| `DashboardSidebar` | Bilingual + module-gated sidebar with mobile drawer, used by all shells |
| `LineChart`, `BarChart`, `DonutChart` | Recharts wrappers with token-driven palette and empty-state fallback |

## Tokens

All visual styles use the existing CSS-variable Tailwind tokens (see `tailwind.config.js`):

| Token | Use |
|---|---|
| `bg-surface-1`, `bg-surface-2`, `bg-surface-3` | Card / page / hover backgrounds |
| `text-foreground`, `text-muted-foreground` | Body / secondary text |
| `text-primary`, `bg-primary/5`, `bg-primary/10` | Brand-accent — overridable per tenant via SchoolThemeProvider |
| `text-success`, `text-danger`, `text-warning`, `text-info` | Status colors |
| `border-surface-3` | Default card / divider borders |
| Animations: `animate-fade-in`, `animate-slide-up` | Drawer, modal, dropdown entries |

## Conventions

- All components are `'use client'` — they use state, ref, or browser APIs.
- All components accept `className` and use `twMerge` so callers can override Tailwind classes.
- Bilingual support: components that render text use `isHi` props, never hardcode strings. Pass it from `useAuth().isHi`.
- Mobile: `<md` (640px) is the breakpoint. `DashboardSidebar` collapses into a hamburger drawer below it.
- Charts: pass a fixed `height`. Width is always responsive to the parent container.

## When NOT to use

- Student-facing surfaces (gamified UI, level-up, XP burst). Use `src/components/dashboard/*`, `src/components/xp/*`, etc.
- Marketing pages. Those have their own design language under `src/components/landing*`.

## Adding a new primitive

1. TDD: write `src/__tests__/admin-ui/<Name>.test.tsx` first.
2. Implement in `src/components/admin-ui/<Name>.tsx`.
3. Re-export from `src/components/admin-ui/index.ts`.
4. If lifting from an existing `_components/` folder, leave a re-export shim in the old path so existing imports keep working — DRY without forcing every page to update its imports.
````

- [ ] **Step 12.2: Add deprecation banner to admin-styles**

Open `src/app/super-admin/_components/admin-styles.ts` and prepend:

```ts
/**
 * @deprecated Use `@/components/admin-ui` Tailwind primitives instead.
 *
 * This inline-style system predates the CSS-variable tokens in
 * tailwind.config.js. New code should not import from here.
 * Existing super-admin pages that still use S/colors will be migrated
 * incrementally; remove this file once all imports are gone.
 */
```

- [ ] **Step 12.3: Commit docs**

```bash
git add src/components/admin-ui/README.md src/app/super-admin/_components/admin-styles.ts
git commit -m "docs(admin-ui): add kit README + deprecate admin-styles inline system"
```

---

## Task 13: Final validation + bundle check

- [ ] **Step 13.1: Full test suite**

```bash
npm run type-check
npm run lint
npm test -- --run
```

Expected: all green. New tests added in Tasks 2-7 and 10 should all pass. Existing tests in `src/__tests__/school-*` should not regress.

- [ ] **Step 13.2: Production build + bundle check**

```bash
npm run build
```

Expected: build succeeds. Inspect output for:
- `/super-admin` and `/super-admin/analytics` First Load JS — should be under the P10 page budget (260 kB). Recharts is heavy (~50 kB gzip) — if a chart-using page exceeds budget, follow up with a `dynamic(() => import(...), { ssr: false })` wrapper around the chart import.
- Shared JS — should not have grown beyond 160 kB. The kit primitives are tree-shaken from anywhere they're not imported.

```bash
npm run analyze
```

If bundle bloat appears, the most likely cause is `recharts` getting pulled into shared code. Add it to a per-page dynamic import wrapper instead.

- [ ] **Step 13.3: E2E smoke**

```bash
npx playwright test --project=chromium
```

Existing E2E specs (auth gate, school-admin shell) should continue passing.

- [ ] **Step 13.4: Cross-check the validation page (per `feedback_cross_check_previews.md`)**

For `/super-admin/analytics`:
- Theme: light + dark (if dark mode is wired in this codebase — check `globals.css` for a `.dark` selector)
- Language: EN + हिं (toggle via dev-tools `localStorage.setItem('isHi', '1')` then reload, if the AuthContext reads it from there)
- Breakpoints: 360px, 768px, 1280px (sidebar collapse, mobile drawer, full layout)
- States: empty (no chart data), loading (network throttle), populated, hover, active

If any state breaks, fix in this same task before merging.

- [ ] **Step 13.5: Final commit + ready to merge**

```bash
git add -A
git status   # should be clean
git log --oneline -20   # confirm the commit chain
```

The branch should now have ~12-15 commits that together:
- Add Recharts dep
- Lift 6 primitives + sidebar into shared kit
- Refactor both shells to use shared sidebar (- ~150 LOC)
- Add bilingual labels to AdminShell (P7 fix)
- Add 3 chart wrappers
- Migrate /super-admin/analytics as validation
- Document kit + deprecate admin-styles

PR title: `feat(admin-ui): shared dashboard primitives + Recharts (Plan 0)`.

---

## Self-Review

**Spec coverage:** every File Structure entry has a Task that creates or modifies it. The validation goal (`/super-admin/analytics` migrated) is Task 11. ✅

**Placeholder scan:** no "TBD", "fill in details", or "similar to Task N". Every code block contains the exact code to type. ✅ (One exception: Task 9.1 says "verify with assessment agent" for Hindi translations — that's a real review chain hand-off, not a placeholder.)

**Type consistency:** `SidebarNavItem` is the single shared type used in DashboardSidebar (Task 7), SchoolAdminShell refactor (Task 8), and AdminShell refactor (Task 9). `Column<T>` and `DataTableProps<T>` are consistent in Task 6 and re-export in Task 6.4. `ChartSeries` is shared between LineChart and BarChart in Task 10. ✅

**Dependencies between tasks:** Task 1 (npm install + recharts) must precede Task 10 (chart wrappers). Task 7 (extract DashboardSidebar) must precede Tasks 8 + 9 (refactor shells). Task 11 (analytics validation) requires Tasks 2 + 6 + 10 done so it can use StatCard, DataTable, and LineChart. ✅

**Risk items:**
- Tailwind tokens `text-foreground` / `text-muted-foreground` may not be in `tailwind.config.js` yet — Task 2.3 covers extending the config if missing.
- `useAuth().isHi` may not be wired into super-admin sessions — Task 9.3 documents the gap.
- Recharts may push `/super-admin/analytics` over the 260 kB page budget — Task 13.2 has the dynamic-import fallback.

---

## Out of scope (intentional)

- Migrating every super-admin sub-page to the kit. That's Plan 6.
- Migrating school-admin sub-pages. That's part of Plan 4 (school admin upgrade) — but most school-admin pages already use these primitives via the existing super-admin re-exports, so the lift is mostly transparent.
- A `<DashboardShell>` mega-component that subsumes both AdminShell and SchoolAdminShell. They have different auth/tenancy concerns; a thin shared sidebar is the right level of abstraction.
- Dark mode tokens. If the codebase doesn't already define `.dark` overrides for the CSS vars, that's a separate enhancement (Plan 4 student or Plan 6 super-admin can fold it in).
- Storybook / visual regression infra. Out of scope for solo founder; revisit when team grows past 1.
