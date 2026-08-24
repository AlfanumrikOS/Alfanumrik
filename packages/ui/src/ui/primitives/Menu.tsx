'use client';

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { Portal } from './overlay/Portal';
import { useFocusTrap } from './overlay/useFocusTrap';
import { useEscapeKey } from './overlay/useEscapeKey';
import { usePresence } from './overlay/usePresence';
import { useOverlayStack } from './overlay/overlayStack';
import {
  usePopoverPosition,
  type PopoverPlacement,
} from './overlay/usePopoverPosition';

/* ═══════════════════════════════════════════════════════════════
   Menu — canonical primitive (anchored dropdown)

   The ANCHORED sibling of Dialog / Drawer / BottomSheet: a floating
   panel tethered to a trigger, built on the same shared overlay
   foundation (Portal + overlayStack + useEscapeKey + useFocusTrap +
   usePresence) plus usePopoverPosition for flip/clamp placement.

   NOT a modal. It deliberately does NOT call useScrollLock — an
   anchored menu that freezes the page is a scroll trap, and the panel
   repositions on scroll instead (usePopoverPosition listens in the
   capture phase).

   A11y contract (WAI-ARIA menu button pattern):
     - trigger: aria-haspopup="menu" + aria-expanded + aria-controls
     - panel:   role="menu" aria-orientation="vertical" + aria-label
     - items:   role="menuitem", roving tabindex (one item in the Tab
                sequence at a time)
     - keyboard: ArrowDown / ArrowUp move with WRAP, Home / End jump to
                the ends, Enter / Space activate, Escape closes and
                RETURNS FOCUS to the trigger. ArrowDown on the trigger
                opens at the first item; ArrowUp opens at the last.
     - no typeahead in v1 (deliberate scope cut).

   Bilingual by construction (P7): every item carries `label` +
   `labelHi` and the caller passes `isHi`. The item shape mirrors
   packages/ui/src/navigation/nav-config.ts field-for-field
   (`href` / `icon` / `label` / `labelHi`) so nav config drops straight
   in without a mapping layer.

   ZERO CONSUMERS by design — this is additive infrastructure. Mounting
   it in navigation is a separate, approval-gated phase.
   ═══════════════════════════════════════════════════════════════ */

export type MenuPlacement = PopoverPlacement;

export interface MenuItem {
  /** Destination. When set the item renders as an <a>; otherwise a <button>. */
  href?: string;
  /** Leading glyph. nav-config supplies emoji strings; any node works. */
  icon?: ReactNode | string;
  /** English label (P7). */
  label: string;
  /** Hindi label (P7). Rendered when `isHi`. */
  labelHi: string;
  /** Fired on activation (click, Enter, or Space). */
  onSelect?: () => void;
  /** Non-activatable and skipped by arrow navigation. */
  disabled?: boolean;
  /** Stable React key. Falls back to href, then label. */
  id?: string;
}

export interface MenuProps {
  /**
   * The single interactive trigger element (must accept a ref + props).
   * Cloned with the aria-haspopup / aria-expanded / aria-controls wiring
   * and the open/close handlers — same convention as Tooltip.
   */
  children: ReactElement;
  /** Rows, in render order. */
  items: MenuItem[];
  /** Language switch — selects `labelHi` over `label` (P7). */
  isHi: boolean;
  /** Accessible name for the menu panel (P7 — caller localises). */
  label: string;
  /** Preferred placement; flips to the opposite side when it would overflow. */
  placement?: MenuPlacement;
  /** px between trigger and panel. Default 8. */
  gap?: number;
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean;
  /** Uncontrolled initial open state. Default false. */
  defaultOpen?: boolean;
  /** Fired whenever the menu wants to open or close. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Client-side routing hook for `href` items. When supplied the anchor's
   * default navigation is prevented and this is called instead — which is
   * how this repo's nav surfaces navigate (`router.push`, see
   * navigation/DesktopSidebar.tsx). When omitted the anchor navigates
   * natively, so the primitive itself stays router-free (and JSDOM-safe).
   */
  onNavigate?: (href: string, item: MenuItem) => void;
  /** Close the menu after an item is chosen. Default true. */
  closeOnSelect?: boolean;
  /** Extra classes on the panel. */
  className?: string;
  /** Extra classes on every item. */
  itemClassName?: string;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') {
        (ref as { current: T }).current = node;
      }
    }
  };
}

export function Menu({
  children,
  items,
  isHi,
  label,
  placement = 'bottom-start',
  gap = 8,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onNavigate,
  closeOnSelect = true,
  className,
  itemClassName,
}: MenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  /**
   * Index to focus as soon as its DOM node exists. Set when opening, before
   * the portal has painted; the item ref callback drains it. This is what
   * makes "open focuses an item" deterministic — the alternative (an effect
   * in this component) never re-runs after <Portal> flips its own internal
   * mounted flag, so it would read a null ref and silently do nothing.
   */
  const pendingFocusRef = useRef<number | null>(null);

  // Panel node kept in STATE as well as a ref: the ref alone cannot wake up
  // the positioning / focus-trap effects, because <Portal> renders null on
  // its first pass and nothing in this component's dep arrays changes when
  // its children finally attach.
  const [panelNode, setPanelNode] = useState<HTMLDivElement | null>(null);
  // Stable identity is load-bearing — an inline ref callback is re-invoked
  // (null, then node) on every render, and the setState inside would loop.
  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanelNode(node);
  }, []);
  /** Item ref callback: records the node and drains any pending focus. */
  const setItemRef = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      itemRefs.current[index] = node;
      if (node && pendingFocusRef.current === index) {
        pendingFocusRef.current = null;
        node.focus();
      }
    },
    [],
  );

  const autoId = useId();
  const panelId = `${autoId}-menu`;
  const overlayId = `${autoId}-overlay`;

  const { mounted, visible } = usePresence(isOpen, 140);
  const panelReady = mounted && panelNode !== null;

  // `resolvedPlacement` is the placement AFTER flipping — the hook's whole
  // reason for returning it. It was previously discarded and `data-placement`
  // rendered the raw PROP, so a menu that flipped (bottom → top because the
  // trigger sits near the viewport floor) still advertised its unflipped
  // preference. Anything keying off that attribute — enter-animation origin,
  // arrow direction, a visual-regression assertion — was reading a value the
  // panel had already stopped honouring.
  //
  // The prop is the fallback for the render BEFORE the first measurement,
  // where the hook has not resolved anything yet. It is NOT gated on
  // `measured`: usePopoverPosition's JSDOM contract is explicit that callers
  // must never gate on a non-zero measurement, and the flip decision is real
  // arithmetic on real (if zero) rects either way.
  const { coords, placement: resolvedPlacement } = usePopoverPosition(
    triggerRef,
    panelRef,
    {
      placement,
      gap,
      enabled: panelReady,
    },
  );

  // Registered on the shared stack so Escape / Tab act on the FRONTMOST
  // overlay only (a Menu opened inside a Dialog must not close both).
  useOverlayStack(mounted, overlayId);
  // Tab containment only: initial focus and focus RESTORE are handled here
  // instead, so they stay synchronous (testable) and so an outside click
  // does not yank focus back to the trigger the user just clicked away from.
  useFocusTrap(panelReady, panelRef, {
    autoFocus: false,
    restoreFocus: false,
    overlayId,
  });

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const focusTrigger = useCallback(() => {
    const node = triggerRef.current;
    if (node && typeof node.focus === 'function') node.focus();
  }, []);

  /** Close and (unless dismissed by an outside click) restore focus. */
  const close = useCallback(
    (restoreFocusToTrigger: boolean) => {
      pendingFocusRef.current = null;
      setOpen(false);
      if (restoreFocusToTrigger) focusTrigger();
    },
    [setOpen, focusTrigger],
  );

  /** Move DOM focus to an item, deferring if the panel has not painted yet. */
  const focusItem = useCallback((index: number) => {
    const node = itemRefs.current[index];
    if (node) {
      node.focus();
      pendingFocusRef.current = null;
    } else {
      pendingFocusRef.current = index;
    }
  }, []);

  const firstEnabled = useCallback(() => {
    const i = items.findIndex((item) => !item.disabled);
    return i;
  }, [items]);

  const lastEnabled = useCallback(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (!items[i].disabled) return i;
    }
    return -1;
  }, [items]);

  /** Next enabled index in `dir`, wrapping. -1 when nothing is enabled. */
  const step = useCallback(
    (from: number, dir: 1 | -1) => {
      const n = items.length;
      if (n === 0) return -1;
      for (let hop = 1; hop <= n; hop += 1) {
        const idx = (((from + dir * hop) % n) + n) % n;
        if (!items[idx].disabled) return idx;
      }
      return -1;
    },
    [items],
  );

  const openAt = useCallback(
    (index: number) => {
      if (index >= 0) focusItem(index);
      setOpen(true);
    },
    [focusItem, setOpen],
  );

  const activate = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || item.disabled) return;
      item.onSelect?.();
      if (closeOnSelect) close(true);
    },
    [items, closeOnSelect, close],
  );

  // Outside-pointer dismissal. The transparent scrim below already catches
  // clicks in a real browser; this also covers pointer sequences that never
  // reach it (and is what JSDOM tests can drive directly).
  useEffect(() => {
    if (!isOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [isOpen, close]);

  // Memoised: useEscapeKey re-subscribes whenever the handler identity moves.
  const handleEscape = useCallback(() => close(true), [close]);
  useEscapeKey(isOpen, handleEscape, overlayId);

  // Items can change while open (flag-gated nav rows); drop stale nodes so a
  // removed row cannot keep receiving focus.
  useEffect(() => {
    itemRefs.current.length = items.length;
  }, [items.length]);

  const onPanelKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const current = itemRefs.current.findIndex(
        (node) => node !== null && node === document.activeElement,
      );
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = step(current < 0 ? -1 : current, 1);
          if (next >= 0) focusItem(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = step(current < 0 ? 0 : current, -1);
          if (prev >= 0) focusItem(prev);
          break;
        }
        case 'Home': {
          e.preventDefault();
          const i = firstEnabled();
          if (i >= 0) focusItem(i);
          break;
        }
        case 'End': {
          e.preventDefault();
          const i = lastEnabled();
          if (i >= 0) focusItem(i);
          break;
        }
        case 'Enter':
        case ' ':
        case 'Spacebar': {
          if (current < 0) break;
          // preventDefault suppresses the browser's own Enter/Space →
          // click synthesis so the item fires exactly ONCE; the explicit
          // .click() below is what actually activates it (and works under
          // JSDOM, which never synthesises that click).
          e.preventDefault();
          itemRefs.current[current]?.click();
          break;
        }
        default:
          break;
      }
    },
    [step, firstEnabled, lastEnabled, focusItem],
  );

  const onTriggerKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openAt(firstEnabled());
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        openAt(lastEnabled());
      }
    },
    [openAt, firstEnabled, lastEnabled],
  );

  if (!isValidElement(children)) {
    return children as unknown as ReactElement;
  }

  const child = children as ReactElement<Record<string, unknown>> & {
    ref?: Ref<HTMLElement>;
  };
  const childProps = child.props;

  function callChild(name: string, e: unknown) {
    const handler = childProps[name];
    if (typeof handler === 'function') handler(e);
  }

  const trigger = cloneElement(child, {
    ref: mergeRefs(triggerRef, child.ref),
    'aria-haspopup': 'menu',
    'aria-expanded': isOpen,
    // Kept on the closed trigger too: axe exempts aria-controls from its
    // id-reference check while aria-expanded is "false".
    'aria-controls': panelId,
    onClick: (e: unknown) => {
      callChild('onClick', e);
      if (isOpen) close(true);
      else openAt(firstEnabled());
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      callChild('onKeyDown', e);
      onTriggerKeyDown(e);
    },
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {mounted && (
        <Portal>
          {/* One full-viewport container = one stacking context, exactly as
              Dialog does. There is no --z-dropdown token in the ladder
              (globals.css stops at nav 50 / modal 60), so an anchored
              overlay rides --z-modal: above the nav rail it will hang off,
              and DOM-ordered against any sibling overlay. */}
          <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
            {/* TRANSPARENT scrim — dismissal surface only. No --scrim fill
                (an anchored menu must not dim the page) and no scroll lock. */}
            <div
              aria-hidden="true"
              data-menu-scrim=""
              className="absolute inset-0"
              onClick={() => close(false)}
            />
            <div
              ref={setPanelRef}
              id={panelId}
              role="menu"
              aria-orientation="vertical"
              aria-label={label}
              tabIndex={-1}
              data-placement={resolvedPlacement ?? placement}
              onKeyDown={onPanelKeyDown}
              className={cn(
                'absolute flex max-h-[min(70dvh,28rem)] min-w-[12rem] max-w-[18rem] flex-col overflow-y-auto',
                'rounded-2xl border border-surface-3 bg-surface-1 py-1.5 text-foreground shadow-lg',
                'origin-top-left focus-visible:outline-none',
                'transition duration-150 ease-out motion-reduce:transition-none',
                visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
                className,
              )}
              style={{ top: coords?.top ?? 0, left: coords?.left ?? 0 }}
            >
              {items.map((item, index) => {
                const text = isHi ? item.labelHi : item.label;
                const key = item.id ?? item.href ?? `${item.label}-${index}`;
                const shared = {
                  role: 'menuitem' as const,
                  'aria-disabled': item.disabled ? (true as const) : undefined,
                  // Roving tabindex: focus is moved programmatically, so no
                  // item competes for the page's Tab sequence.
                  tabIndex: -1,
                  'data-menu-item': '',
                  className: cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-start text-fluid-sm font-medium',
                    'transition-colors duration-150 ease-out motion-reduce:transition-none',
                    'focus:bg-surface-2 hover:bg-surface-2',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                    item.disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    itemClassName,
                  ),
                  style: { minHeight: 'var(--tap-min)' },
                };
                const body = (
                  <>
                    {item.icon != null && (
                      <span className="w-6 shrink-0 text-center text-lg" aria-hidden="true">
                        {item.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                  </>
                );

                if (item.href && !item.disabled) {
                  return (
                    <a
                      key={key}
                      ref={setItemRef(index)}
                      href={item.href}
                      onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
                        if (onNavigate) {
                          e.preventDefault();
                          onNavigate(item.href as string, item);
                        }
                        activate(index);
                      }}
                      {...shared}
                    >
                      {body}
                    </a>
                  );
                }

                return (
                  <button
                    key={key}
                    type="button"
                    ref={setItemRef(index)}
                    onClick={() => activate(index)}
                    {...shared}
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
