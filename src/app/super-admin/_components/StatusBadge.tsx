'use client';

import { colors } from './admin-styles';

type Variant = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const variants: Record<Variant, { bg: string; fg: string }> = {
  success: { bg: colors.successLight, fg: colors.success },
  danger: { bg: colors.dangerLight, fg: colors.danger },
  warning: { bg: colors.warningLight, fg: colors.warning },
  neutral: { bg: colors.surface, fg: colors.text3 },
  info: { bg: colors.accentLight, fg: colors.accent },
};

interface StatusBadgeProps {
  label: string;
  variant?: Variant;
}

export default function StatusBadge({ label, variant = 'neutral' }: StatusBadgeProps) {
  const v = variants[variant];
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '3px 10px',
      borderRadius: 12,
      background: v.bg,
      color: v.fg,
      whiteSpace: 'nowrap',
      letterSpacing: 0.2,
    }}>
      {label}
    </span>
  );
}
