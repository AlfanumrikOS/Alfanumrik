export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  tone?: 'action' | 'success' | 'warning' | 'danger';
}

export function ProgressBar({ value, max = 100, label, showValue = false, tone = 'action' }: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  const percentage = Math.round((safeValue / safeMax) * 100);
  return (
    <div className="v3-progress-wrap">
      {label || showValue ? (
        <div className="v3-progress__label">
          <span>{label}</span>
          {showValue ? <span>{percentage}%</span> : null}
        </div>
      ) : null}
      <div className="v3-progress" role="progressbar" aria-label={label || 'Progress'} aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={safeValue}>
        <span className={`v3-progress__fill v3-progress__fill--${tone}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
