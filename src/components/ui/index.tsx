'use client';

import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, useState, useEffect } from 'react';

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
      className={`rounded-2xl p-5 relative overflow-hidden ${hoverable ? 'card-hover cursor-pointer' : ''} ${className}`}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
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

/* ─── Button ──────────────────────────────────────────────── */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'soft';
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  color,
  fullWidth,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base = fullWidth ? 'w-full' : '';
  const sizeMap = {
    sm: 'text-sm px-3 py-2.5 rounded-lg',
    md: 'text-sm px-5 py-3 rounded-xl',
    lg: 'text-base px-7 py-4 rounded-2xl',
  };

  if (variant === 'primary') {
    return (
      <button className={`btn-primary ${sizeMap[size]} ${base} ${className}`} {...props}>
        {children}
      </button>
    );
  }

  if (variant === 'ghost') {
    return (
      <button className={`btn-ghost ${sizeMap[size]} ${base} ${className}`} {...props}>
        {children}
      </button>
    );
  }

  // soft variant — colored background
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-all ${sizeMap[size]} ${base} ${className}`}
      style={{
        background: color ? `${color}12` : 'var(--surface-2)',
        border: `1.5px solid ${color ?? 'var(--border)'}30`,
        color: color ?? 'var(--text-1)',
      }}
      {...props}
    >
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

/* ─── Badge ───────────────────────────────────────────────── */
interface BadgeProps {
  children: ReactNode;
  color?: string;
  size?: 'sm' | 'md';
}

export function Badge({ children, color = 'var(--orange)', size = 'sm' }: BadgeProps) {
  const sizeClass = size === 'sm' ? 'text-xs px-2.5 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${sizeClass}`}
      style={{
        background: `${color}12`,
        border: `1px solid ${color}25`,
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
      className="rounded-2xl p-3 text-center card-hover flex flex-col items-center gap-1.5"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.02)',
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
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="ring-fill" style={{ transform: 'rotate(-90deg)' }}>
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

/* ─── Bottom Nav ──────────────────────────────────────────── */
export { default as BottomNav } from './BottomNavComponent';
