/** Super Admin White Theme – shared style constants */

export const colors = {
  bg: '#FFFFFF',
  surface: '#F9FAFB',
  surfaceHover: '#F3F4F6',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  borderLight: '#F3F4F6',
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  accent: '#2563EB',
  accentLight: '#EFF6FF',
  danger: '#DC2626',
  dangerLight: '#FEF2F2',
  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#D97706',
  warningLight: '#FFFBEB',
  shadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
  shadowMd: '0 4px 6px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.02)',
  shadowLg: '0 10px 15px rgba(0,0,0,0.04), 0 4px 6px rgba(0,0,0,0.02)',
} as const;

export const S: Record<string, React.CSSProperties> = {
  // Layout
  page: {
    minHeight: '100vh',
    background: colors.bg,
    color: colors.text1,
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    colorScheme: 'light',
  },
  container: {
    padding: '24px 28px',
    maxWidth: 1480,
    margin: '0 auto',
  },

  // Typography
  h1: {
    fontSize: 20,
    fontWeight: 700,
    color: colors.text1,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    color: colors.text3,
    marginBottom: 20,
  },

  // Cards
  card: {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    boxShadow: colors.shadow,
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
  },
  cardSurface: {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
  },

  // Tables
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 14px',
    borderBottom: `2px solid ${colors.border}`,
    color: colors.text2,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    background: colors.surface,
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  td: {
    padding: '10px 14px',
    borderBottom: `1px solid ${colors.borderLight}`,
    color: colors.text1,
    fontSize: 13,
  },

  // Inputs
  searchInput: {
    padding: '8px 12px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text1,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    width: 220,
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  },
  select: {
    padding: '8px 12px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text1,
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  },

  // Buttons
  filterBtn: {
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text2,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  filterActive: {
    background: colors.text1,
    color: colors.bg,
    borderColor: colors.text1,
  },
  primaryBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: colors.text1,
    color: colors.bg,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: 0.2,
    transition: 'all 0.15s ease',
  },
  secondaryBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text1,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  actionBtn: {
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    color: colors.text2,
    transition: 'all 0.15s ease',
  },
  dangerBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: `1px solid ${colors.danger}`,
    background: colors.dangerLight,
    color: colors.danger,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  pageBtn: {
    padding: '7px 16px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text2,
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  dlBtn: {
    padding: '8px 14px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text1,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  // Section header with left accent bar
  sectionHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: colors.text1,
    marginBottom: 16,
    marginTop: 28,
    paddingLeft: 12,
    borderLeft: `3px solid ${colors.accent}`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  // Grid layouts for stat cards
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 },

  // Badge
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
  },

  // Divider
  divider: {
    height: 1,
    background: colors.border,
    margin: '20px 0',
  },

  // Toolbar (row of filters/actions)
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap' as const,
    marginBottom: 16,
  },

  // Empty state
  emptyState: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    color: colors.text3,
    fontSize: 14,
  },

  // Stat card with accent top bar
  statCardAccent: {
    borderTop: `3px solid ${colors.accent}`,
    borderRadius: 8,
    padding: 16,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderTopColor: colors.accent,
    boxShadow: colors.shadow,
    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
  },
};
