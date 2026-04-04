'use client';

import { colors } from './admin-styles';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: string;
  accentColor?: string;
  subtitle?: string;
  trend?: { value: number; label: string };
  onClick?: () => void;
}

export default function StatCard({ label, value, icon, accentColor, subtitle, trend, onClick }: StatCardProps) {
  const accent = accentColor || colors.accent;
  return (
    <div
      onClick={onClick}
      style={{
        padding: '16px 18px',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        borderTop: `3px solid ${accent}`,
        background: colors.bg,
        boxShadow: colors.shadow,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = colors.shadowMd;
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = colors.shadow;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: colors.text1, lineHeight: 1.1 }}>
            {typeof value === 'number' && value >= 0 ? value.toLocaleString() : value}
          </div>
          <div style={{ fontSize: 11, color: colors.text3, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
            {label}
          </div>
          {subtitle && <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>{subtitle}</div>}
          {trend && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 11, marginTop: 6, fontWeight: 600,
              color: trend.value >= 0 ? colors.success : colors.danger,
              background: trend.value >= 0 ? colors.successLight : colors.dangerLight,
              padding: '2px 6px', borderRadius: 4,
            }}>
              <span>{trend.value >= 0 ? '↑' : '↓'}</span>
              <span>{trend.value >= 0 ? '+' : ''}{trend.value}%</span>
              <span style={{ color: colors.text3, fontWeight: 400 }}>{trend.label}</span>
            </div>
          )}
        </div>
        {icon && (
          <span style={{
            fontSize: 22, opacity: 0.6,
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: colors.surface, borderRadius: 8,
          }}>{icon}</span>
        )}
      </div>
    </div>
  );
}
