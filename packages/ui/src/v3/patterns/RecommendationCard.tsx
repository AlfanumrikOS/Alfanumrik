'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RoleId } from '../foundations/types';
import { ProgressBar } from '../data-display/ProgressBar';

export interface CardAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface RecommendationCardProps {
  eyebrow?: string;
  title: string;
  description: string;
  reason?: string;
  reasonLabel?: string;
  meta?: ReactNode;
  progress?: number;
  primaryAction: CardAction;
  secondaryAction?: CardAction;
  accent?: RoleId;
}

function Action({ action, primary = false }: { action: CardAction; primary?: boolean }) {
  const className = `v3-button ${primary ? 'v3-button--primary' : 'v3-button--secondary'} v3-button--md`;
  if (action.href) return <Link className={className} href={action.href} onClick={action.onClick}>{action.label}</Link>;
  return <button type="button" className={className} onClick={action.onClick}>{action.label}</button>;
}

export function RecommendationCard({ eyebrow = 'Recommended next', title, description, reason, reasonLabel = 'Why this is next:', meta, progress, primaryAction, secondaryAction, accent }: RecommendationCardProps) {
  return (
    <article className="v3-recommendation" data-accent={accent}>
      <div className="v3-recommendation__copy">
        <p className="v3-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
        {reason ? <p className="v3-recommendation__reason"><strong>{reasonLabel}</strong> {reason}</p> : null}
        {meta ? <div className="v3-recommendation__meta">{meta}</div> : null}
        {typeof progress === 'number' ? <ProgressBar value={progress} label="Progress" showValue /> : null}
      </div>
      <div className="v3-recommendation__actions">
        <Action action={primaryAction} primary />
        {secondaryAction ? <Action action={secondaryAction} /> : null}
      </div>
    </article>
  );
}
