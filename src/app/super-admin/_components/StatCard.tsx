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
  return (
    <div
      onClick={onClick}
      style={{
        padding: '16px 18px',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        borderLeft: accentColor ? `3px solid ${accentColor}` : `1px solid ${colors.border}`,
        background: colors.bg,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)'); }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
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
            <div style={{ fontSize: 11, marginTop: 4, color: trend.value >= 0 ? colors.success : colors.danger, fontWeight: 600 }}>
              {trend.value >= 0 ? '+' : ''}{trend.value} {trend.label}
            </div>
          )}
        </div>
        {icon && <span style={{ fontSize: 22, opacity: 0.7 }}>{icon}</span>}
      </div>
    </div>
  );
}
