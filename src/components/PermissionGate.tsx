'use client';

import { type ReactNode } from 'react';
import { usePermissions } from '@/lib/usePermissions';
import { useAuth } from '@/lib/AuthContext';

interface PermissionGateProps {
  permission: string;
  children: ReactNode;
  fallback?: 'hide' | 'lock' | 'upgrade';
  planRequired?: string;
  lockMessage?: string;
}

export default function PermissionGate({
  permission,
  children,
  fallback = 'hide',
  planRequired,
  lockMessage,
}: PermissionGateProps) {
  const { can, loading } = usePermissions();
  const { isHi } = useAuth();

  if (loading) return null;

  if (can(permission)) {
    return <>{children}</>;
  }

  // Permission denied -- render fallback
  if (fallback === 'hide') {
    return null;
  }

  if (fallback === 'lock') {
    const message =
      lockMessage ??
      (isHi ? '\u092F\u0939 \u0938\u0941\u0935\u093F\u0927\u093E \u0932\u0949\u0915 \u0939\u0948' : 'This feature is locked');

    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-500">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm font-medium">{message}</span>
      </div>
    );
  }

  if (fallback === 'upgrade') {
    const plan = planRequired ?? 'Pro';
    const upgradeText = isHi
      ? `${plan} \u092E\u0947\u0902 \u0909\u092A\u0932\u092C\u094D\u0927 \u2014 \u0905\u0928\u0932\u0949\u0915 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0905\u092A\u0917\u094D\u0930\u0947\u0921 \u0915\u0930\u0947\u0902`
      : `Available in ${plan} \u2014 Upgrade to unlock`;
    const buttonText = isHi ? '\u0905\u092A\u0917\u094D\u0930\u0947\u0921 \u0915\u0930\u0947\u0902' : 'Upgrade';

    return (
      <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 shrink-0 text-orange-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        <span className="flex-1 text-sm font-medium text-orange-700">
          {upgradeText}
        </span>
        <a
          href="/billing"
          className="inline-flex items-center rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-600 transition-colors"
        >
          {buttonText}
        </a>
      </div>
    );
  }

  return null;
}
