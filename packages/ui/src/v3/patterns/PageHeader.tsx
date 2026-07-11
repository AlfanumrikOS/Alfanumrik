import Link from 'next/link';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  metadata?: ReactNode;
  backHref?: string;
}

export function PageHeader({ eyebrow, title, description, actions, metadata, backHref }: PageHeaderProps) {
  return (
    <header className="v3-page-header">
      <div className="v3-page-header__copy">
        {backHref ? <Link href={backHref} className="v3-back-link" aria-label={`Back from ${title}`}>← Back</Link> : null}
        {eyebrow ? <p className="v3-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="v3-page-header__description">{description}</p> : null}
        {metadata ? <div className="v3-page-header__metadata">{metadata}</div> : null}
      </div>
      {actions ? <div className="v3-page-header__actions">{actions}</div> : null}
    </header>
  );
}
