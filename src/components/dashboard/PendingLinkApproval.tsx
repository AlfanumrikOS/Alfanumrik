'use client';

import { useState } from 'react';

// P7: bilingual helper
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

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
  const days = daysSince(link.requestedAt);

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
        setError(data?.error || t(isHi, 'Something went wrong. Please try again.', 'कुछ गलत हुआ। कृपया फिर से कोशिश करें।'));
        setLoading(false);
        return;
      }
      setStatus(action === 'approve' ? 'approved' : 'rejected');
      setTimeout(() => {
        onApproved();
      }, 1500);
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया फिर से कोशिश करें।'));
      setLoading(false);
    }
  };

  if (status === 'approved') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 rounded-xl border border-green-200">
        <span className="text-green-600 text-lg">✓</span>
        <span className="text-sm font-semibold text-green-700">
          {t(isHi, `${link.parentName} approved as parent!`, `${link.parentName} को अभिभावक के रूप में स्वीकार किया!`)}
        </span>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200">
        <span className="text-gray-400 text-lg">✕</span>
        <span className="text-sm text-gray-500">
          {t(isHi, `Request from ${link.parentName} declined.`, `${link.parentName} का अनुरोध अस्वीकार किया गया।`)}
        </span>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-amber-50 rounded-xl border border-amber-200">
      <div className="flex items-start gap-3">
        {/* Parent avatar */}
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {link.parentName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 m-0 truncate">
            {link.parentName}
          </p>
          <p className="text-xs text-amber-600 m-0">
            {days === 0
              ? t(isHi, 'Requested today', 'आज अनुरोध किया')
              : t(isHi, `Requested ${days} day${days > 1 ? 's' : ''} ago`, `${days} दिन पहले अनुरोध किया`)}
          </p>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => handleAction('approve')}
            disabled={loading}
            aria-label={t(isHi, 'Approve', 'स्वीकार करें')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-none text-white transition-opacity ${loading ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}
            style={{ backgroundColor: '#16A34A' }}
          >
            {loading ? (
              <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              t(isHi, 'Approve', 'स्वीकार करें')
            )}
          </button>
          <button
            onClick={() => handleAction('reject')}
            disabled={loading}
            aria-label={t(isHi, 'Reject', 'अस्वीकार करें')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold bg-transparent transition-opacity ${loading ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}
            style={{ border: '1px solid #EF4444', color: '#EF4444' }}
          >
            {t(isHi, 'Reject', 'अस्वीकार करें')}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-2 m-0">{error}</p>
      )}
    </div>
  );
}

export default function PendingLinkApproval({ links, onApproved, isHi }: PendingLinkApprovalProps) {
  if (!links || links.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-300 overflow-hidden mb-4" style={{ backgroundColor: '#FFFBEB' }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-100 border-b border-amber-200">
        <span className="text-xl" aria-hidden>🔔</span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-amber-900 m-0">
            {t(isHi, 'Parent Link Request', 'अभिभावक लिंक अनुरोध')}
          </h3>
          <p className="text-xs text-amber-600 m-0">
            {links.length === 1
              ? t(isHi, '1 pending request', '1 लंबित अनुरोध')
              : t(isHi, `${links.length} pending requests`, `${links.length} लंबित अनुरोध`)}
          </p>
        </div>
      </div>

      {/* Link rows */}
      <div className="p-3 flex flex-col gap-2.5">
        {links.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            onApproved={onApproved}
            isHi={isHi}
          />
        ))}
      </div>
    </div>
  );
}
