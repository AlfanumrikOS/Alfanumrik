'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export interface ActionQueueItem {
  id: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  status?: ReactNode;
  href?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ActionQueueProps {
  title?: string;
  items: ActionQueueItem[];
  empty?: ReactNode;
}

export function ActionQueue({ title, items, empty }: ActionQueueProps) {
  return (
    <section className="v3-action-queue" aria-label={title || 'Action queue'}>
      {title ? <h2>{title}</h2> : null}
      {items.length === 0 ? (empty || <p className="v3-muted">You are all caught up.</p>) : (
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <div className="v3-action-queue__copy">
                <div className="v3-action-queue__title-row"><h3>{item.title}</h3>{item.status}</div>
                {item.description ? <p>{item.description}</p> : null}
                {item.meta ? <div className="v3-action-queue__meta">{item.meta}</div> : null}
              </div>
              {item.href ? <Link className="v3-text-action" href={item.href}>{item.actionLabel || 'Review'}<span aria-hidden="true"> →</span></Link> : null}
              {!item.href && item.onAction ? <button type="button" className="v3-text-action" onClick={item.onAction}>{item.actionLabel || 'Review'}<span aria-hidden="true"> →</span></button> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
