'use client';

import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';

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
    sm: 'text-xs px-3 py-2 rounded-lg',
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
}

export function Input({ label, className = '', ...props }: InputProps) {
  return (
    <div>
      {label && (
        <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
          {label}
        </label>
      )}
      <input className={`input-base ${className}`} {...props} />
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
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-3 py-1';
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
      <div className="text-[10px] text-[var(--text-3)] mt-0.5 font-medium">{label}</div>
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
          className="text-[9px] mt-0.5 truncate font-semibold"
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
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-5xl animate-float">🦊</div>
    </div>
  );
}

/* ─── Bottom Nav ──────────────────────────────────────────── */
export { default as BottomNav } from './BottomNavComponent';
