'use client';

import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
  useEffect,
} from 'react';

/* ═══════════════════════════════════════════════════════════════
   ALFANUMRIK WONDER BLOCKS — Component Library
   Inspired by Khan Academy's Wonder Blocks design system.
   Single-file component library for rapid, consistent UI.
   ═══════════════════════════════════════════════════════════════ */

/* ─── Card ────────────────────────────────────────────────── */
interface CardProps {
  children: ReactNode;
  className?: string;
  accent?: string; // color for radial accent glow
  onClick?: () => void;
  hoverable?: boolean;
}

export function Card({ children, className = '', accent, onClick, hoverable }: CardProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`rounded-2xl p-5 relative overflow-hidden ${hoverable ? 'card-hover cursor-pointer' : ''} ${onClick ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2' : ''} ${className}`}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        // Phase 1.5: use theme-aware shadow var. The hardcoded
        // rgba(0,0,0,0.03) was invisible on dark surface.
        boxShadow: 'var(--shadow-md)',
      }}
    >
      {accent && (
        <div
          className="absolute inset-0 opacity-25 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at top right, ${accent}20 0%, transparent 70%)`,
          }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

/* ─── Locked Card ─────────────────────────────────────────── */
/** Use for grade-gated or plan-gated surfaces. Shows a visible "coming soon"
 *  or "upgrade to unlock" state instead of silently hiding the feature. */
interface LockedCardProps {
  icon?: string;
  title: ReactNode;
  reason: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  variant?: 'grade' | 'plan' | 'generic';
  className?: string;
}

export function LockedCard({
  icon,
  title,
  reason,
  actionLabel,
  onAction,
  variant = 'generic',
  className = '',
}: LockedCardProps) {
  const accent =
    variant === 'plan' ? 'var(--purple)' :
    variant === 'grade' ? 'var(--teal)' :
    'var(--text-3)';
  return (
    <div
      className={`rounded-2xl p-5 relative overflow-hidden ${className}`}
      style={{
        background: 'var(--surface-2)',
        border: '1px dashed var(--border-mid)',
      }}
      aria-label={typeof title === 'string' ? `Locked: ${title}` : undefined}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
          }}
          aria-hidden="true"
        >
          <span className="text-lg opacity-70">{icon ?? '🔒'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-[var(--text-2)]" style={{ fontFamily: 'var(--font-display)' }}>
              {title}
            </h3>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              // color-mix tolerates BOTH var() tokens (--purple/--teal) and raw hex,
              // so the soft tint + hairline render even when accent is a token.
              // (Wave 6: the legacy `${accent}15`/`${accent}30` concat was silently
              // transparent for token accents — matches the Badge fix pattern.)
              style={{
                background: `color-mix(in srgb, ${accent} 15%, transparent)`,
                color: accent,
                border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
              }}
            >
              <span aria-hidden="true">🔒</span>
              {variant === 'plan' ? 'Premium' : variant === 'grade' ? 'Unlocks later' : 'Locked'}
            </span>
          </div>
          <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed">{reason}</p>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 rounded"
              style={{ color: accent }}
            >
              {actionLabel} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Upgrade CTA ─────────────────────────────────────────── */
/** Proactive upgrade entry point — distinct from <UpgradeModal>, which
 *  fires on "daily limit reached". This component is for voluntary
 *  discovery (nav pill, settings row, paywall peek). Routes to /pricing
 *  by default, or fires onClick if provided.
 *
 *  `source` is a free-form analytics tag ("nav_more", "profile_row", etc.)
 *  so we can measure where upgrades originate without bolting on a
 *  per-call-site event. Callers that need an in-place limit-reached
 *  checkout should keep using <UpgradeModal>. */
interface UpgradeCTAProps {
  variant?: 'pill' | 'card';
  label?: ReactNode;
  subtitle?: ReactNode;
  source?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function UpgradeCTA({
  variant = 'pill',
  label,
  subtitle,
  source,
  href = '/pricing',
  onClick,
  className = '',
}: UpgradeCTAProps) {
  const resolvedLabel = label ?? 'Upgrade';

  const handleClick = (e: React.MouseEvent) => {
    // Analytics hook: log-only (no PII), non-blocking. Callers that want
    // custom routing pass onClick; we still log the source.
    if (source && typeof window !== 'undefined') {
      try {
        // Use a harmless CustomEvent — whoever wires analytics (ops) can
        // listen for this without this component taking a dependency on
        // a specific analytics SDK.
        window.dispatchEvent(new CustomEvent('alfanumrik:upgrade-cta-click', {
          detail: { source, variant, timestamp: Date.now() },
        }));
      } catch { /* non-blocking */ }
    }
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  if (variant === 'pill') {
    return (
      <a
        href={href}
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${className}`}
        style={{
          background: 'linear-gradient(135deg, var(--purple), var(--purple-light))',
          color: 'white',
          boxShadow: '0 2px 8px rgb(var(--purple-rgb) / 0.25)',
        }}
        data-testid="upgrade-cta-pill"
      >
        <span aria-hidden="true">✨</span>
        <span>{resolvedLabel}</span>
      </a>
    );
  }

  // card variant — larger, for settings/profile rows
  return (
    <a
      href={href}
      onClick={handleClick}
      className={`block rounded-2xl p-4 transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2 ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgb(var(--purple-rgb) / 0.08), rgb(var(--orange-rgb) / 0.06))',
        border: '1px solid rgb(var(--purple-rgb) / 0.2)',
      }}
      data-testid="upgrade-cta-card"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--purple), var(--purple-light))',
            color: 'white',
          }}
          aria-hidden="true"
        >
          <span className="text-lg">✨</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{resolvedLabel}</div>
          {subtitle && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{subtitle}</div>
          )}
        </div>
        <span className="text-xs font-bold" style={{ color: 'var(--purple)' }} aria-hidden="true">→</span>
      </div>
    </a>
  );
}

/* ─── Button ──────────────────────────────────────────────── */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'soft' | 'destructive' | 'link';
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  fullWidth?: boolean;
  loading?: boolean;
  children: ReactNode;
}

const BTN_FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2';

export function Button({
  variant = 'primary',
  size = 'md',
  color,
  fullWidth,
  loading,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base = fullWidth ? 'w-full' : '';
  const sizeMap = {
    sm: 'text-sm px-3 py-2.5 rounded-lg',
    md: 'text-sm px-5 py-3 rounded-xl',
    lg: 'text-base px-7 py-4 rounded-2xl',
  };

  const isDisabled = disabled || loading;
  const disabledAttr = isDisabled ? { 'aria-disabled': true as const, disabled: true } : {};
  const busyAttr = loading ? { 'aria-busy': true as const } : {};

  const spinner = loading ? (
    <span
      className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
      aria-hidden="true"
    />
  ) : null;

  if (variant === 'primary') {
    return (
      <button
        className={`btn-primary ${BTN_FOCUS} ${sizeMap[size]} ${base} ${className}`}
        {...disabledAttr}
        {...busyAttr}
        {...props}
      >
        {spinner}
        {children}
      </button>
    );
  }

  if (variant === 'ghost') {
    return (
      <button
        className={`btn-ghost ${BTN_FOCUS} ${sizeMap[size]} ${base} ${className}`}
        {...disabledAttr}
        {...busyAttr}
        {...props}
      >
        {spinner}
        {children}
      </button>
    );
  }

  if (variant === 'destructive') {
    return (
      <button
        className={`inline-flex items-center justify-center gap-2 font-semibold transition-all ${BTN_FOCUS} ${sizeMap[size]} ${base} ${className}`}
        style={{
          background: 'var(--danger, #DC2626)',
          color: '#fff',
          border: '1.5px solid transparent',
          opacity: isDisabled ? 0.6 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
        }}
        {...disabledAttr}
        {...busyAttr}
        {...props}
      >
        {spinner}
        {children}
      </button>
    );
  }

  if (variant === 'link') {
    return (
      <button
        className={`inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline transition-colors ${BTN_FOCUS} ${base} ${className}`}
        style={{
          color: color ?? 'var(--orange)',
          background: 'transparent',
          padding: 0,
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
        }}
        {...disabledAttr}
        {...busyAttr}
        {...props}
      >
        {spinner}
        {children}
      </button>
    );
  }

  // soft variant — colored background
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-all ${BTN_FOCUS} ${sizeMap[size]} ${base} ${className}`}
      style={{
        // color-mix tolerates BOTH var() tokens and raw hex (Wave 6): the legacy
        // `${color}12` / `${color}30` concat produced invalid CSS — silently
        // transparent — when callers passed a token like var(--purple).
        background: color ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--surface-2)',
        border: `1.5px solid ${color ? `color-mix(in srgb, ${color} 30%, transparent)` : 'var(--border)'}`,
        color: color ?? 'var(--text-1)',
        opacity: isDisabled ? 0.6 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
      }}
      {...disabledAttr}
      {...busyAttr}
      {...props}
    >
      {spinner}
      {children}
    </button>
  );
}

/* ─── Input ───────────────────────────────────────────────── */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div>
      {label && (
        <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
          {label}
        </label>
      )}
      <input
        className={`input-base ${className}`}
        aria-invalid={error ? 'true' : undefined}
        style={error ? { borderColor: '#DC2626', boxShadow: '0 0 0 2px rgba(220,38,38,0.1)' } : undefined}
        {...props}
      />
      {error && (
        <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─── Select ──────────────────────────────────────────────── */
interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  disabled?: boolean;
}

export function Select({ label, value, onChange, options, className = '', disabled }: SelectProps) {
  return (
    <div>
      {label && (
        <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
          {label}
        </label>
      )}
      <select
        className={`input-base ${className}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/* ─── Textarea ────────────────────────────────────────────── */
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export function Textarea({ label, error, helperText, className = '', id, ...props }: TextareaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const descId = error ? `${fieldId}-err` : helperText ? `${fieldId}-hint` : undefined;
  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        className={`input-base ${className}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={descId}
        rows={props.rows ?? 4}
        style={error ? { borderColor: 'var(--red, #DC2626)', boxShadow: '0 0 0 2px rgba(220,38,38,0.1)' } : undefined}
        {...props}
      />
      {error && (
        <p id={descId} className="text-xs mt-1 ml-1 font-medium" style={{ color: 'var(--red, #DC2626)' }} role="alert">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={descId} className="text-xs mt-1 ml-1 text-[var(--text-3)]">{helperText}</p>
      )}
    </div>
  );
}

/* ─── Checkbox ────────────────────────────────────────────── */
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  helperText?: string;
}

export function Checkbox({ label, checked, onChange, helperText, id, disabled, className = '', ...props }: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <label
      htmlFor={fieldId}
      className={`flex items-start gap-2.5 cursor-pointer select-none ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
    >
      <input
        id={fieldId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded accent-[var(--orange)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        {...props}
      />
      <span className="flex flex-col">
        <span className="text-sm text-[var(--text-1)] font-medium leading-snug">{label}</span>
        {helperText && <span className="text-xs text-[var(--text-3)] mt-0.5">{helperText}</span>}
      </span>
    </label>
  );
}

/* ─── Toggle ──────────────────────────────────────────────── */
interface ToggleProps {
  label?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  helperText?: string;
  id?: string;
  className?: string;
}

export function Toggle({ label, checked, onChange, disabled, helperText, id, className = '' }: ToggleProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      {label && (
        <label htmlFor={fieldId} className="flex flex-col cursor-pointer select-none">
          <span className="text-sm text-[var(--text-1)] font-medium">{label}</span>
          {helperText && <span className="text-xs text-[var(--text-3)] mt-0.5">{helperText}</span>}
        </label>
      )}
      <button
        id={fieldId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        style={{
          background: checked ? 'var(--orange)' : 'var(--surface-3)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
          style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)', marginTop: 2 }}
        />
      </button>
    </div>
  );
}

/* ─── FormField ───────────────────────────────────────────── */
/** Wrapper that pairs a label, help text, and error with any form control.
 *  Preferred over writing bare <label> + input pairs. */
interface FormFieldProps {
  label?: ReactNode;
  htmlFor?: string;
  helperText?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, helperText, error, required, children, className = '' }: FormFieldProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-xs text-[var(--text-3)] block ml-1 font-medium"
        >
          {label}
          {required && <span className="ml-0.5" style={{ color: 'var(--red, #DC2626)' }} aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error && (
        <p className="text-xs ml-1 font-medium" style={{ color: 'var(--red, #DC2626)' }} role="alert">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p className="text-xs ml-1 text-[var(--text-3)]">{helperText}</p>
      )}
    </div>
  );
}

/* ─── Badge ───────────────────────────────────────────────── */
interface BadgeProps {
  children: ReactNode;
  color?: string;
  size?: 'sm' | 'md';
}

export function Badge({ children, color = 'var(--orange)', size = 'sm' }: BadgeProps) {
  const sizeClass = size === 'sm' ? 'text-xs px-2.5 py-0.5' : 'text-sm px-3 py-1';
  // color-mix tolerates BOTH design tokens (var(--red)) and raw hex (#DC2626),
  // so callers can pass theme tokens and still get the soft tint + hairline.
  // (Wave 4b: the legacy `${color}12` concat produced invalid CSS for token
  // colors — silently transparent — so this also fixes the default var(--orange)
  // badge's missing tint.)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${sizeClass}`}
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        color,
      }}
    >
      {children}
    </span>
  );
}

/* ─── Progress Bar ────────────────────────────────────────── */
interface ProgressBarProps {
  value: number; // 0–100
  color?: string;
  height?: number;
  label?: string;
  showPercent?: boolean;
}

export function ProgressBar({ value, color = 'var(--orange)', height = 8, label, showPercent }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div>
      {(label || showPercent) && (
        <div className="flex justify-between text-xs text-[var(--text-3)] mb-1">
          {label && <span>{label}</span>}
          {showPercent && <span>{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height, background: 'var(--surface-2)' }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || `Progress: ${Math.round(pct)}%`}
      >
        <div
          className="h-full rounded-full xp-bar"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ─── Stat Card ───────────────────────────────────────────── */
interface StatCardProps {
  value: string | number;
  label: string;
  color?: string;
  icon?: string;
}

export function StatCard({ value, label, color = 'var(--text-1)', icon }: StatCardProps) {
  return (
    <div className="rounded-xl py-2.5 px-3 text-center" style={{ background: 'var(--surface-2)' }}>
      {icon && <div className="text-lg mb-0.5">{icon}</div>}
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-[var(--text-3)] mt-0.5 font-medium">{label}</div>
    </div>
  );
}

/* ─── Subject Chip ────────────────────────────────────────── */
interface SubjectChipProps {
  icon: string;
  name: string;
  color: string;
  active?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export function SubjectChip({ icon, name, color, active, onClick, size = 'md' }: SubjectChipProps) {
  if (size === 'sm') {
    return (
      <button
        onClick={onClick}
        className="rounded-xl p-2 text-center transition-all"
        style={{
          background: active ? `${color}12` : 'var(--surface-1)',
          border: active ? `1.5px solid ${color}` : '1px solid var(--border)',
        }}
      >
        <div className="text-lg">{icon}</div>
        <div
          className="text-xs mt-0.5 truncate font-semibold"
          style={{ color: active ? color : 'var(--text-3)' }}
        >
          {name.split(' ')[0]}
        </div>
      </button>
    );
  }

  return (
    <span
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium cursor-pointer transition-all"
      onClick={onClick}
      style={{
        background: active ? `${color}18` : `${color}08`,
        border: `1px solid ${active ? color : `${color}20`}`,
        color,
      }}
    >
      <span>{icon}</span>
      {name}
    </span>
  );
}

/* ─── Action Tile ─────────────────────────────────────────── */
interface ActionTileProps {
  icon: string;
  label: string;
  color: string;
  onClick: () => void;
}

export function ActionTile({ icon, label, color, onClick }: ActionTileProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="rounded-2xl p-3 text-center card-hover flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        // Phase 1.5: use theme-aware shadow var; old rgba(0,0,0,0.02) was
        // invisible on dark surface (and barely on light too).
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </button>
  );
}

/* ─── Section Header ──────────────────────────────────────── */
interface SectionHeaderProps {
  icon?: string;
  children: ReactNode;
}

export function SectionHeader({ icon, children }: SectionHeaderProps) {
  return (
    <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
      {icon && <>{icon} </>}{children}
    </h2>
  );
}

/* ─── Avatar ──────────────────────────────────────────────── */
interface AvatarProps {
  name: string;
  size?: number;
}

export function Avatar({ name, size = 36 }: AvatarProps) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: 'linear-gradient(135deg, var(--orange), var(--gold))',
      }}
    >
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

/* ─── Empty State ─────────────────────────────────────────── */
interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-6">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
      {description && <p className="text-sm text-[var(--text-3)] mb-4 max-w-xs mx-auto">{description}</p>}
      {action}
    </div>
  );
}

/* ─── Loading Spinner ─────────────────────────────────────── */
export function LoadingFoxy() {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center" role="status" aria-label="Loading">
      <div className="text-5xl animate-float">🦊</div>
    </div>
  );
}

/* ─── Foxy Avatar ────────────────────────────────────────── */
type FoxyState = 'idle' | 'thinking' | 'happy' | 'encouraging';

const FOXY_STATE_MAP: Record<FoxyState, { emoji: string; label: string }> = {
  idle: { emoji: '🦊', label: 'Foxy' },
  thinking: { emoji: '🤔', label: 'Foxy is thinking' },
  happy: { emoji: '😄', label: 'Foxy is happy' },
  encouraging: { emoji: '💪', label: 'Foxy encourages you' },
};

interface FoxyAvatarProps {
  state?: FoxyState;
  size?: 'sm' | 'md' | 'lg';
}

export function FoxyAvatar({ state = 'idle', size = 'md' }: FoxyAvatarProps) {
  const sizeMap = { sm: 40, md: 56, lg: 80 };
  const fontMap = { sm: 'text-xl', md: 'text-3xl', lg: 'text-5xl' };
  const px = sizeMap[size];
  const { emoji, label } = FOXY_STATE_MAP[state];
  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 ${state === 'thinking' ? 'animate-pulse' : state === 'happy' ? 'animate-bounce-once' : ''}`}
      style={{
        width: px,
        height: px,
        background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
        border: '2px solid rgba(232,88,28,0.15)',
      }}
      aria-label={label}
      role="img"
    >
      <span className={fontMap[size]}>{emoji}</span>
    </div>
  );
}

/* ─── XP Burst ───────────────────────────────────────────── */
interface XPBurstProps {
  amount: number;
  visible: boolean;
}

export function XPBurst({ amount, visible }: XPBurstProps) {
  if (!visible || amount <= 0) return null;
  return (
    <span
      className="xp-rise inline-block font-bold text-sm pointer-events-none"
      style={{ color: 'var(--orange)' }}
      aria-live="polite"
    >
      +{amount} XP
    </span>
  );
}

/* ─── Mastery Ring ───────────────────────────────────────── */
interface MasteryRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: ReactNode;
}

export function MasteryRing({ value, size = 64, strokeWidth = 5, color, children }: MasteryRingProps) {
  const pct = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const ringColor = color ?? (pct < 40 ? '#DC2626' : pct < 70 ? 'var(--orange)' : 'var(--green)');

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`Mastery: ${Math.round(pct)}%`}>
      <svg width={size} height={size} className="ring-fill" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={ringColor} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children ?? <span className="text-xs font-bold" style={{ color: ringColor }}>{Math.round(pct)}%</span>}
      </div>
    </div>
  );
}

/* ─── Step Indicator ─────────────────────────────────────── */
interface StepIndicatorProps {
  total: number;
  current: number;
  color?: string;
}

export function StepIndicator({ total, current, color = 'var(--orange)' }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-300"
          style={{
            width: i === current ? 20 : 8,
            height: 8,
            background: i <= current ? color : 'var(--surface-3)',
          }}
        />
      ))}
    </div>
  );
}

/* ─── Session Complete ───────────────────────────────────── */
interface SessionCompleteProps {
  title: string;
  xpEarned: number;
  stats?: Array<{ label: string; value: string | number }>;
  foxyMessage?: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export function SessionComplete({ title, xpEarned, stats, foxyMessage, primaryAction, secondaryAction }: SessionCompleteProps) {
  return (
    <div className="text-center py-8 px-5 animate-fade-in">
      <FoxyAvatar state="happy" size="lg" />
      <h2 className="text-xl font-bold mt-4" style={{ fontFamily: 'var(--font-display)' }}>{title}</h2>
      {foxyMessage && <p className="text-sm text-[var(--text-2)] mt-2 max-w-xs mx-auto">{foxyMessage}</p>}
      {xpEarned > 0 && (
        <div className="mt-4">
          <span className="text-3xl font-bold gradient-text">+{xpEarned}</span>
          <span className="text-sm text-[var(--text-3)] ml-1">XP</span>
        </div>
      )}
      {stats && stats.length > 0 && (
        <div className="flex justify-center gap-6 mt-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{s.value}</div>
              <div className="text-xs text-[var(--text-3)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-6 space-y-2 max-w-xs mx-auto">
        {primaryAction && (
          <Button variant="primary" fullWidth onClick={primaryAction.onClick}>{primaryAction.label}</Button>
        )}
        {secondaryAction && (
          <Button variant="ghost" fullWidth onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>
        )}
      </div>
    </div>
  );
}

/* ─── Foxy Banner ────────────────────────────────────────── */
interface FoxyBannerProps {
  message: string;
  actionLabel: string;
  onAction: () => void;
  accent?: string;
}

export function FoxyBanner({ message, actionLabel, onAction, accent }: FoxyBannerProps) {
  return (
    <button
      onClick={onAction}
      className="w-full rounded-2xl p-4 flex items-center gap-3 text-left transition-all active:scale-[0.98]"
      style={{
        background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
        border: '1.5px solid rgba(232,88,28,0.15)',
      }}
    >
      <FoxyAvatar state="idle" size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text-1)] truncate">{message}</p>
        <p className="text-xs font-bold mt-0.5" style={{ color: accent ?? 'var(--orange)' }}>{actionLabel} →</p>
      </div>
    </button>
  );
}

/* ─── Streak Badge ───────────────────────────────────────── */
interface StreakBadgeProps {
  count: number;
  compact?: boolean;
}

export function StreakBadge({ count, compact }: StreakBadgeProps) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-0.5 text-sm font-bold">
        <span className={count > 0 ? 'streak-flame' : ''}>🔥</span>
        <span style={{ color: count > 0 ? 'var(--orange)' : 'var(--text-3)' }}>{count}</span>
      </span>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
      style={{
        background: count > 0 ? 'rgba(232,88,28,0.08)' : 'var(--surface-2)',
        border: `1px solid ${count > 0 ? 'rgba(232,88,28,0.2)' : 'var(--border)'}`,
      }}
    >
      <span className={count > 0 ? 'streak-flame' : ''}>🔥</span>
      <span className="text-sm font-bold" style={{ color: count > 0 ? 'var(--orange)' : 'var(--text-3)' }}>{count}</span>
      <span className="text-xs text-[var(--text-3)]">day{count !== 1 ? 's' : ''}</span>
    </div>
  );
}

/* ─── Sheet Modal ────────────────────────────────────────── */
interface SheetModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function SheetModal({ open, onClose, title, children }: SheetModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={onClose} aria-hidden="true" />
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-3xl max-h-[80vh] flex flex-col animate-slide-up"
        style={{
          background: 'var(--surface-1)',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.1)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        {title && (
          <div className="px-5 pb-2">
            <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {children}
        </div>
      </div>
    </>
  );
}

/* ─── Skeleton ───────────────────────────────────────────── */
interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: string;
  /** Visual variant: 'text' | 'title' | 'circle' | 'rect'. 'circle' forces rounded-full. */
  variant?: 'text' | 'title' | 'circle' | 'rect';
}

export function Skeleton({ className = '', width, height, rounded = 'rounded-lg', variant }: SkeletonProps) {
  const roundedClass = variant === 'circle' ? 'rounded-full' : rounded;
  return (
    <div
      className={`animate-pulse ${roundedClass} ${className}`}
      style={{
        width,
        height,
        background: 'var(--surface-2)',
      }}
      aria-hidden="true"
    />
  );
}

/* ─── Responsive Table ───────────────────────────────────── */
/** Adaptive data table for the Indian-4G / low-end-Android audience.
 *
 *  - On >= md (tablets/desktop) it renders a real semantic <table> so
 *    screen readers and keyboard users get native table navigation.
 *  - On < md (phones, 320–414px) it renders each row as a stacked
 *    label:value "card" instead of forcing a horizontal scroll — every
 *    cell stays readable at 320px and tap targets stay >= 44px.
 *
 *  Bilingual by contract: the CALLER passes already-localized strings for
 *  every `header` (and any rendered cell content). This component never
 *  hardcodes English — keep your `isHi ? '…' : '…'` at the call site.
 *
 *  Generic over the row type so `render` / `key` stay type-safe.
 */
export interface ResponsiveColumn<T> {
  /** Stable key. If `accessor`/`render` are absent, used to index the row. */
  key: string;
  /** Already-localized column header (caller does isHi). */
  header: ReactNode;
  /** Custom cell renderer. Receives the whole row. */
  render?: (row: T, rowIndex: number) => ReactNode;
  /** Plain value accessor when no custom render is needed. */
  accessor?: (row: T) => ReactNode;
  /** Desktop text alignment. Mobile cards are always label-left / value-right. */
  align?: 'left' | 'center' | 'right';
  /** Hide this column's label on the mobile card (e.g. an actions column). */
  hideLabelOnMobile?: boolean;
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  /** Stable React key per row. */
  rowKey: (row: T, rowIndex: number) => string | number;
  /** Optional accessible caption / aria-label (caller localizes). */
  caption?: ReactNode;
  /** Shown (centered) when `rows` is empty. Caller localizes. */
  emptyMessage?: ReactNode;
  /** Optional per-row click (whole row becomes a button on both layouts). */
  onRowClick?: (row: T, rowIndex: number) => void;
  className?: string;
}

function renderCell<T>(col: ResponsiveColumn<T>, row: T, rowIndex: number): ReactNode {
  if (col.render) return col.render(row, rowIndex);
  if (col.accessor) return col.accessor(row);
  // Fall back to indexing the row by `key`.
  return (row as Record<string, ReactNode>)[col.key];
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyMessage,
  onRowClick,
  className = '',
}: ResponsiveTableProps<T>) {
  if (rows.length === 0 && emptyMessage) {
    return (
      <div
        className={`rounded-2xl py-8 px-5 text-center text-sm text-[var(--text-3)] ${className}`}
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        {emptyMessage}
      </div>
    );
  }

  const alignClass = (a?: 'left' | 'center' | 'right') =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className={className}>
      {/* ── Desktop / tablet: semantic table (>= md) ── */}
      <div
        className="hidden md:block rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr style={{ background: 'var(--surface-2)' }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 font-bold text-xs uppercase tracking-wide text-[var(--text-3)] ${alignClass(col.align)}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowKey(row, rowIndex)}
                onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
                className={onRowClick ? 'cursor-pointer transition-colors hover:bg-[var(--surface-2)]' : ''}
                style={{ borderTop: '1px solid var(--border)' }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-[var(--text-1)] align-middle ${alignClass(col.align)}`}
                  >
                    {renderCell(col, row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile: stacked label:value cards (< md) ── */}
      <div className="md:hidden space-y-3">
        {rows.map((row, rowIndex) => {
          const cardInner = (
            <dl className="space-y-1.5">
              {columns.map((col) => (
                <div key={col.key} className="flex items-start justify-between gap-3">
                  {!col.hideLabelOnMobile && (
                    <dt className="text-xs font-semibold text-[var(--text-3)] shrink-0">
                      {col.header}
                    </dt>
                  )}
                  <dd
                    className={`text-sm text-[var(--text-1)] min-w-0 ${col.hideLabelOnMobile ? 'w-full' : 'text-right'}`}
                  >
                    {renderCell(col, row, rowIndex)}
                  </dd>
                </div>
              ))}
            </dl>
          );

          const cardStyle = {
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-sm)',
            minHeight: 44, /* tap target on budget phones */
          } as const;

          return onRowClick ? (
            <button
              key={rowKey(row, rowIndex)}
              type="button"
              onClick={() => onRowClick(row, rowIndex)}
              className="w-full text-left rounded-2xl p-4 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
              style={cardStyle}
            >
              {cardInner}
            </button>
          ) : (
            <div key={rowKey(row, rowIndex)} className="rounded-2xl p-4" style={cardStyle}>
              {cardInner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ALFA MOMENTUM PRIMITIVES (Wave 0)
   New, additive premium primitives. Token-driven (CSS vars only, zero
   hardcoded hex), bilingual-safe (all copy comes from the caller — no
   hardcoded English), and reduced-motion-aware (they lean on the global
   prefers-reduced-motion block in globals.css + spring keyframes added
   there in Wave 0). Existing Wonder Blocks above are untouched.
   ═══════════════════════════════════════════════════════════════ */

/* ─── PremiumCard ─────────────────────────────────────────────
   Refined surface card: layered shadow, hairline warm border, optional
   orange glow + subtle gradient wash, spring hover lift. */
interface PremiumCardProps {
  children: ReactNode;
  className?: string;
  /** Soft orange glow ring around the card. */
  glow?: boolean;
  /** Subtle warm gradient wash across the surface. */
  gradient?: boolean;
  /** Spring hover lift (disabled automatically under reduced motion). */
  hoverable?: boolean;
  onClick?: () => void;
  /** Optional test hook (forwarded to the root element). */
  'data-testid'?: string;
}

export function PremiumCard({
  children,
  className = '',
  glow = false,
  gradient = false,
  hoverable = false,
  onClick,
  'data-testid': dataTestId,
}: PremiumCardProps) {
  return (
    <div
      data-testid={dataTestId}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`relative overflow-hidden rounded-2xl p-5 ${hoverable ? 'card-hover cursor-pointer' : ''} ${onClick ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2' : ''} ${className}`}
      style={{
        background: gradient
          ? 'linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)'
          : 'var(--surface-1)',
        // Hairline warm border + layered depth shadow, all token-driven.
        border: '1px solid var(--border)',
        boxShadow: glow
          ? 'var(--shadow-md), 0 0 0 1px color-mix(in srgb, var(--orange) 18%, transparent), var(--shadow-glow)'
          : 'var(--shadow-md)',
      }}
    >
      {gradient && (
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(ellipse at top right, color-mix(in srgb, var(--orange) 12%, transparent) 0%, transparent 60%)',
          }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

/* ─── GlowButton ──────────────────────────────────────────────
   Orange-gradient CTA with a CSS-only shimmer sweep on hover and an
   optional icon slot. Sizes sm/md/lg. All copy/icon supplied by caller. */
interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg';
  /** Optional leading icon node (emoji, svg, etc.). */
  icon?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
}

export function GlowButton({
  size = 'md',
  icon,
  fullWidth,
  loading,
  children,
  className = '',
  disabled,
  ...props
}: GlowButtonProps) {
  const sizeMap = {
    sm: 'text-sm px-4 py-2.5 rounded-lg gap-1.5',
    md: 'text-sm px-6 py-3 rounded-xl gap-2',
    lg: 'text-base px-8 py-4 rounded-2xl gap-2.5',
  };
  const isDisabled = disabled || loading;
  return (
    <button
      className={`group relative inline-flex items-center justify-center overflow-hidden font-bold transition-transform active:scale-[0.98] ${BTN_FOCUS} ${sizeMap[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      style={{
        background: 'linear-gradient(135deg, var(--orange) 0%, var(--orange-light) 100%)',
        color: '#fff',
        border: '1px solid color-mix(in srgb, var(--orange) 70%, #000)',
        boxShadow: isDisabled ? 'none' : 'var(--shadow-glow)',
        opacity: isDisabled ? 0.6 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
      }}
      aria-disabled={isDisabled ? true : undefined}
      aria-busy={loading ? true : undefined}
      disabled={isDisabled}
      {...props}
    >
      {/* CSS-only shimmer sweep — hidden until hover, collapses under reduced
          motion via the global animate-shimmer override in globals.css. */}
      <span
        aria-hidden="true"
        className="animate-shimmer pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'linear-gradient(110deg, transparent 25%, color-mix(in srgb, #fff 35%, transparent) 50%, transparent 75%)',
          backgroundSize: '200% auto',
        }}
      />
      {loading ? (
        <span
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden="true"
        />
      ) : (
        icon && <span aria-hidden="true" className="relative inline-flex">{icon}</span>
      )}
      <span className="relative">{children}</span>
    </button>
  );
}

/* ─── StatRing ────────────────────────────────────────────────
   Animated circular progress ring for XP / mastery / score. Composes the
   MasteryRing geometry, adds the mastery-fill stroke motion + a score-reveal
   pop on the numeric center, which uses the `data` (Sora) font. Caller owns
   any label text (bilingual-safe). */
interface StatRingProps {
  /** 0–100 progress. */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** Ring color token; defaults to a mastery-banded color. */
  color?: string;
  /** Override the center content (e.g. "1,240 XP"). Defaults to "{value}%". */
  children?: ReactNode;
  /** Animate the number with the score-reveal spring. Default true. */
  animateValue?: boolean;
}

export function StatRing({
  value,
  size = 72,
  strokeWidth = 6,
  color,
  children,
  animateValue = true,
}: StatRingProps) {
  const pct = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const ringColor =
    color ?? (pct < 40 ? 'var(--mastery-low)' : pct < 70 ? 'var(--mastery-mid)' : 'var(--mastery-high)');

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(pct)}%`}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={ringColor} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          // Drive the fill via the centralized mastery-fill motion; the
          // transition handles incremental value changes, the keyframe handles
          // mount. Both collapse to ~0ms under reduced motion.
          className="animate-mastery-fill"
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center ${animateValue ? 'animate-score-reveal' : ''}`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {children ?? (
          <span className="text-sm font-extrabold tabular-nums" style={{ color: ringColor }}>
            {Math.round(pct)}%
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Bottom Nav ──────────────────────────────────────────── */

