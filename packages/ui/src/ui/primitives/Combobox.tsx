'use client';

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { CONTROL_TEXT_BASE, CONTROL_TEXT_SIZE, CONTROL_INVALID, type ControlSize } from './tokens';
import { useFieldControl } from './Field';
import { Portal } from './overlay/Portal';
import { useEscapeKey } from './overlay/useEscapeKey';
import { usePopoverPosition } from './overlay/usePopoverPosition';

/* ═══════════════════════════════════════════════════════════════
   Combobox — canonical primitive (Gate-2 B2)

   NOT exported from the primitives barrel (../index.ts) — import it
   directly:

       import { Combobox } from '@alfanumrik/ui/ui/primitives/Combobox';

   Same reason Menu is module-path-only (see the Menu note in
   ../index.ts, PR #1624): this component's popover positioning depends
   on usePopoverPosition, and packages/ui has no "sideEffects": false, so
   a VALUE re-export from the eager barrel would drag that hook (and this
   whole component) into the shared primitives chunk every route loads,
   whether or not it ever renders a combobox. A type-only re-export costs
   nothing and is safe; that alone is exported from the barrel below.

   ARIA 1.2 combobox pattern (editable, list autocomplete):
     - input: role="combobox" aria-expanded aria-controls
       aria-activedescendant aria-autocomplete="list". Focus NEVER leaves
       the input — the active option is tracked virtually via
       aria-activedescendant, not real DOM focus (unlike Menu, which
       moves focus into the panel).
     - listbox: role="listbox", rendered in a Portal, positioned via
       usePopoverPosition (same flip/clamp foundation Menu uses).
     - option: role="option" aria-selected.
     - keyboard: typing filters the list and opens it; ArrowDown/Up move
       the active option (wrap), opening the list if closed; Enter
       commits the active option; Escape closes without committing;
       Home/End jump to the ends.

   Single-select, controlled (`value` + `onValueChange`) or uncontrolled
   (`defaultValue`). Auto-consumes Field context like Select/Input.
   Default filter is a case-insensitive substring match on each option's
   `label` (stringified) — override via `filter` for custom matching
   (e.g. matching on a separate search key).
   ═══════════════════════════════════════════════════════════════ */

export interface ComboboxOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  size?: ControlSize;
  disabled?: boolean;
  /** Custom filter; defaults to a case-insensitive substring match on the stringified label. */
  filter?: (option: ComboboxOption, query: string) => boolean;
  /** Copy shown when no option matches the query (bilingual — caller localises, P7). */
  noResultsLabel?: string;
  id?: string;
  className?: string;
}

function defaultFilter(option: ComboboxOption, query: string): boolean {
  if (!query) return true;
  const text = typeof option.label === 'string' ? option.label : option.value;
  return text.toLowerCase().includes(query.toLowerCase());
}

export function Combobox({
  options,
  value: controlled,
  defaultValue,
  onValueChange,
  placeholder,
  size = 'md',
  disabled: disabledProp,
  filter = defaultFilter,
  noResultsLabel = 'No matches',
  id: idProp,
  className,
}: ComboboxProps) {
  const field = useFieldControl({ id: idProp, disabled: disabledProp });
  const disabled = field.disabled ?? false;
  const invalid = field['aria-invalid'] === true;

  const isControlled = controlled !== undefined;
  const [uncontrolled, setUncontrolled] = useState<string | undefined>(defaultValue);
  const selectedValue = isControlled ? controlled : uncontrolled;
  const selectedOption = options.find((o) => o.value === selectedValue);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const listboxId = useId();
  const optionId = useCallback((i: number) => `${listboxId}-opt-${i}`, [listboxId]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(
    () => options.filter((o) => filter(o, query)),
    [options, query, filter],
  );

  const { coords } = usePopoverPosition(inputRef, listRef, {
    placement: 'bottom-start',
    enabled: open,
  });

  const commit = useCallback(
    (opt: ComboboxOption) => {
      if (opt.disabled) return;
      if (!isControlled) setUncontrolled(opt.value);
      onValueChange?.(opt.value);
      setQuery('');
      setOpen(false);
      inputRef.current?.focus();
    },
    [isControlled, onValueChange],
  );

  const openList = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(0);
  }, [disabled]);

  const closeList = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useEscapeKey(open, closeList);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
      } else if (e.key === 'Home' && open) {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === 'End' && open) {
        e.preventDefault();
        setActiveIndex(Math.max(0, filtered.length - 1));
      } else if (e.key === 'Enter') {
        if (open && filtered[activeIndex]) {
          e.preventDefault();
          commit(filtered[activeIndex]);
        }
      }
    },
    [open, filtered, activeIndex, openList, commit],
  );

  const displayValue = open ? query : (selectedOption ? String(selectedOption.label) : '');

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? optionId(activeIndex) : undefined}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          if (!open) setOpen(true);
        }}
        onFocus={openList}
        onKeyDown={handleKeyDown}
        {...field}
        className={cn(
          CONTROL_TEXT_BASE,
          CONTROL_TEXT_SIZE[size],
          'pl-3.5 pr-3',
          invalid && CONTROL_INVALID,
        )}
      />

      {open && (
        <Portal>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            style={coords ? { position: 'fixed', top: coords.top, left: coords.left } : undefined}
            className="z-[var(--z-overlay)] max-h-64 w-[max(12rem,var(--combobox-width,0px))] overflow-auto rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-fluid-sm text-muted-foreground">{noResultsLabel}</li>
            ) : (
              filtered.map((opt, i) => (
                <li
                  key={opt.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={opt.value === selectedValue}
                  aria-disabled={opt.disabled}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent the input from losing focus before the click commits.
                    e.preventDefault();
                    commit(opt);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center px-3 py-2 text-fluid-sm',
                    opt.disabled && 'cursor-not-allowed opacity-50',
                    i === activeIndex && !opt.disabled && 'bg-surface-2',
                    opt.value === selectedValue && 'font-semibold text-primary',
                  )}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </Portal>
      )}
    </div>
  );
}
