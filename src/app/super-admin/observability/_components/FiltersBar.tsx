'use client';

import { colors, S } from '../../_components/admin-styles';

export interface Filters {
  range: string;
  from: string;
  to: string;
  category: string[];
  severity: string[];
  env: string;
  q: string;
}

export const DEFAULT_FILTERS: Filters = {
  range: '1h',
  from: '',
  to: '',
  category: [],
  severity: [],
  env: 'production',
  q: '',
};

const TIME_RANGES = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

const CATEGORIES = ['ai', 'auth', 'payment', 'quiz', 'health', 'deploy', 'admin_action', 'cron', 'error'];
const SEVERITIES = ['info', 'warning', 'error', 'critical'];
const ENVIRONMENTS = ['production', 'preview', 'development'];

interface FiltersBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onClear: () => void;
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...S.filterBtn,
        ...(active ? S.filterActive : {}),
        padding: '4px 10px',
        fontSize: 11,
      }}
    >
      {label}
    </button>
  );
}

export default function FiltersBar({ filters, onChange, onClear }: FiltersBarProps) {
  const isCustomRange = filters.range === 'custom' || (filters.from !== '' && filters.to !== '');
  const hasFilters =
    filters.range !== '1h' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.category.length > 0 ||
    filters.severity.length > 0 ||
    filters.env !== 'production' ||
    filters.q !== '';

  const toggleCategory = (cat: string) => {
    const next = filters.category.includes(cat)
      ? filters.category.filter(c => c !== cat)
      : [...filters.category, cat];
    onChange({ ...filters, category: next });
  };

  const toggleSeverity = (sev: string) => {
    const next = filters.severity.includes(sev)
      ? filters.severity.filter(s => s !== sev)
      : [...filters.severity, sev];
    onChange({ ...filters, severity: next });
  };

  return (
    <div style={{ ...S.card, marginBottom: 16, padding: 14 }}>
      {/* Row 1: Time range + environment + search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={isCustomRange ? 'custom' : filters.range}
          onChange={e => {
            const val = e.target.value;
            if (val === 'custom') {
              onChange({ ...filters, range: 'custom' });
            } else {
              onChange({ ...filters, range: val, from: '', to: '' });
            }
          }}
          style={S.select}
        >
          {TIME_RANGES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        {isCustomRange && (
          <>
            <input
              type="datetime-local"
              value={filters.from}
              onChange={e => onChange({ ...filters, range: 'custom', from: e.target.value })}
              style={{ ...S.searchInput, width: 190 }}
            />
            <span style={{ color: colors.text3, fontSize: 12 }}>to</span>
            <input
              type="datetime-local"
              value={filters.to}
              onChange={e => onChange({ ...filters, range: 'custom', to: e.target.value })}
              style={{ ...S.searchInput, width: 190 }}
            />
          </>
        )}

        <select
          value={filters.env}
          onChange={e => onChange({ ...filters, env: e.target.value })}
          style={S.select}
        >
          {ENVIRONMENTS.map(env => (
            <option key={env} value={env}>{env}</option>
          ))}
        </select>

        <input
          value={filters.q}
          onChange={e => onChange({ ...filters, q: e.target.value })}
          placeholder="Search messages, IDs..."
          style={{ ...S.searchInput, flex: 1, minWidth: 180 }}
        />

        {hasFilters && (
          <button onClick={onClear} style={{ ...S.actionBtn, fontSize: 11 }}>
            Clear
          </button>
        )}
      </div>

      {/* Row 2: Category toggles */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, alignSelf: 'center', marginRight: 4 }}>
          Category
        </span>
        {CATEGORIES.map(cat => (
          <ToggleChip key={cat} label={cat} active={filters.category.includes(cat)} onClick={() => toggleCategory(cat)} />
        ))}
      </div>

      {/* Row 3: Severity toggles */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, alignSelf: 'center', marginRight: 4 }}>
          Severity
        </span>
        {SEVERITIES.map(sev => (
          <ToggleChip key={sev} label={sev} active={filters.severity.includes(sev)} onClick={() => toggleSeverity(sev)} />
        ))}
      </div>
    </div>
  );
}
