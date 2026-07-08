'use client';

/**
 * PendingLinkApproval — the child-side consent surface for a parent's link
 * request. Rebuilt on canonical primitives (Phase 3a, DD-16): the whole block
 * is an Alert(tone="info") shell; each request is a Card with an Avatar, a
 * Badge for the request age, and Button primary(approve) / ghost(reject)
 * actions. Outcome banners reuse Alert (success / info). Every legibility
 * concern (colour, on-accent text, 44px targets, focus ring) is owned by the
 * primitives — this file carries ZERO hardcoded colours or raw <button>s.
 *
 * The supabase fetch + approve/reject logic and the 1.5s auto-refresh handoff
 * are unchanged. Bilingual via `isHi` (P7). Self-hides when nothing is pending.
 */

import { useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
} from '@alfanumrik/ui/ui/primitives';

// P7: bilingual helper
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface PendingLink {
  id: string;
  parentName: string;
  requestedAt: string;
}

export interface PendingLinkApprovalProps {
  links: PendingLink[];
  onApproved: () => void;
  isHi: boolean;
}

function daysSince(dateStr: string): number {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

function requestedCopy(dateStr: string, isHi: boolean): string {
  const days = daysSince(dateStr);
  if (days === 0) return t(isHi, 'Requested today', 'आज अनुरोध किया');
  return t(
    isHi,
    `Requested ${days} day${days > 1 ? 's' : ''} ago`,
    `${days} दिन पहले अनुरोध किया`,
  );
}

function LinkRow({
  link,
  onApproved,
  isHi,
}: {
  link: PendingLink;
  onApproved: () => void;
  isHi: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'approved' | 'rejected'>('idle');
  const [error, setError] = useState('');

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/parent/approve-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId: link.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        setError(
          data?.error ||
            t(
              isHi,
              'Something went wrong. Please try again.',
              'कुछ गलत हुआ। कृपया फिर से कोशिश करें।',
            ),
        );
        setLoading(false);
        return;
      }
      setStatus(action === 'approve' ? 'approved' : 'rejected');
      setTimeout(() => {
        onApproved();
      }, 1500);
    } catch {
      setError(
        t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया फिर से कोशिश करें।'),
      );
      setLoading(false);
    }
  };

  if (status === 'approved') {
    return (
      <Alert tone="success">
        {t(
          isHi,
          `${link.parentName} approved as parent!`,
          `${link.parentName} को अभिभावक के रूप में स्वीकार किया!`,
        )}
      </Alert>
    );
  }

  if (status === 'rejected') {
    return (
      <Alert tone="info" icon={<span aria-hidden="true">✕</span>}>
        {t(
          isHi,
          `Request from ${link.parentName} declined.`,
          `${link.parentName} का अनुरोध अस्वीकार किया गया।`,
        )}
      </Alert>
    );
  }

  return (
    <Card variant="flat">
      <CardBody className="flex items-center gap-3 py-3">
        <Avatar name={link.parentName} alt={link.parentName} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-fluid-sm font-semibold text-foreground">
            {link.parentName}
          </p>
          <Badge tone="neutral" variant="soft" className="mt-1">
            {requestedCopy(link.requestedAt, isHi)}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            onClick={() => handleAction('approve')}
          >
            {t(isHi, 'Approve', 'स्वीकार करें')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => handleAction('reject')}
          >
            {t(isHi, 'Reject', 'अस्वीकार करें')}
          </Button>
        </div>
      </CardBody>
      {error && (
        <div className="px-4 pb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}

export default function PendingLinkApproval({
  links,
  onApproved,
  isHi,
}: PendingLinkApprovalProps) {
  if (!links || links.length === 0) return null;

  const countLine =
    links.length === 1
      ? t(isHi, '1 pending request', '1 लंबित अनुरोध')
      : t(isHi, `${links.length} pending requests`, `${links.length} लंबित अनुरोध`);

  return (
    <Alert
      tone="info"
      icon={<span aria-hidden="true">🔔</span>}
      title={t(isHi, 'Parent Link Request', 'अभिभावक लिंक अनुरोध')}
    >
      <p className="text-fluid-xs text-muted-foreground">{countLine}</p>
      <div className="mt-3 flex flex-col gap-2.5">
        {links.map((link) => (
          <LinkRow key={link.id} link={link} onApproved={onApproved} isHi={isHi} />
        ))}
      </div>
    </Alert>
  );
}
