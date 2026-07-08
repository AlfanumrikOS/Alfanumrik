'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Tabs — canonical primitive (Phase 2 Batch B3)

   Compound API: <Tabs> / <TabList> / <Tab> / <TabPanel>. A11y contract
   (WAI-ARIA tabs pattern):
     - TabList = role="tablist"; each Tab = role="tab" with
       aria-selected + aria-controls → its panel; each TabPanel =
       role="tabpanel" with aria-labelledby → its tab.
     - ROVING tabindex: the active tab is tabindex=0, the rest -1, so
       Tab/Shift+Tab enters the group once and Arrow keys move within.
     - keyboard: Left/Right (horizontal) or Up/Down (vertical) move +
       activate (skipping disabled), Home/End jump to the ends.
     - controlled (`value` + `onValueChange`) OR uncontrolled
       (`defaultValue`).
     - mobile: TabList scrolls horizontally (no overflow clip) with
       >=44px targets; the active-tab underline is token-driven and
       reduced-motion aware.

   All copy comes from children (P7).
   ═══════════════════════════════════════════════════════════════ */

type Orientation = 'horizontal' | 'vertical';

interface TabsContextValue {
  value: string | undefined;
  select: (value: string) => void;
  baseId: string;
  orientation: Orientation;
  tabId: (value: string) => string;
  panelId: (value: string) => string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used within <Tabs>.`);
  return ctx;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Controlled active tab value. */
  value?: string;
  /** Uncontrolled initial active tab value. */
  defaultValue?: string;
  /** Fired when the active tab changes. */
  onValueChange?: (value: string) => void;
  orientation?: Orientation;
  children: ReactNode;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
  ...props
}: TabsProps) {
  const baseId = useId();
  const [uncontrolled, setUncontrolled] = useState<string | undefined>(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : uncontrolled;

  const select = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const ctx = useMemo<TabsContextValue>(
    () => ({
      value,
      select,
      baseId,
      orientation,
      tabId: (v) => `${baseId}-tab-${v}`,
      panelId: (v) => `${baseId}-panel-${v}`,
    }),
    [value, select, baseId, orientation],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div
        className={cn('flex', orientation === 'vertical' ? 'flex-row gap-4' : 'flex-col gap-3', className)}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the tablist (P7). */
  'aria-label': string;
  children: ReactNode;
}

export function TabList({ className, children, onKeyDown, ...props }: TabListProps) {
  const { orientation } = useTabsContext('TabList');
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      const list = listRef.current;
      if (!list) return;
      const tabs = Array.from(
        list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
      );
      if (tabs.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = tabs.findIndex((t) => t === current);

      const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
      const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

      let target = -1;
      if (e.key === next) target = idx < 0 ? 0 : (idx + 1) % tabs.length;
      else if (e.key === prev) target = idx < 0 ? tabs.length - 1 : (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') target = 0;
      else if (e.key === 'End') target = tabs.length - 1;

      if (target >= 0) {
        e.preventDefault();
        tabs[target].focus();
        tabs[target].click();
      }
    },
    [onKeyDown, orientation],
  );

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex gap-1',
        orientation === 'vertical'
          ? 'flex-col border-e border-surface-3 pe-1'
          : // Horizontal: scroll on overflow (no clip), hairline baseline.
            'overflow-x-auto border-b border-surface-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** Identity of this tab; matches the sibling <TabPanel value>. */
  value: string;
  children: ReactNode;
}

export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { value, disabled, className, children, onClick, ...props },
  ref,
) {
  const { value: active, select, orientation, tabId, panelId } = useTabsContext('Tab');
  const selected = active === value;

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={tabId(value)}
      aria-selected={selected}
      aria-controls={panelId(value)}
      // Roving tabindex: only the active tab is in the Tab sequence.
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!disabled) select(value);
      }}
      className={cn(
        'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap px-4 text-fluid-sm font-semibold',
        'transition-colors duration-150 ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Active-tab indicator: token-driven edge + primary text.
        orientation === 'vertical'
          ? cn('-me-px border-e-2', selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')
          : cn('-mb-px border-b-2', selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Matches the controlling <Tab value>. */
  value: string;
  children: ReactNode;
}

export function TabPanel({ value, className, children, ...props }: TabPanelProps) {
  const { value: active, tabId, panelId } = useTabsContext('TabPanel');
  const selected = active === value;

  return (
    <div
      role="tabpanel"
      id={panelId(value)}
      aria-labelledby={tabId(value)}
      hidden={!selected}
      tabIndex={0}
      className={cn('flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg', className)}
      {...props}
    >
      {selected ? children : null}
    </div>
  );
}
