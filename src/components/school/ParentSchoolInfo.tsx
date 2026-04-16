'use client';

import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';

function t(isHi: boolean, en: string, hi: string): string { return isHi ? hi : en; }

/**
 * School information card for parent dashboard.
 * Shows school logo, name, tagline for B2B parents.
 * Returns null for B2C parents (no school context).
 */
export default function ParentSchoolInfo() {
  const { isHi } = useAuth();
  const tenant = useTenant();

  if (!tenant.schoolId) return null;

  const primaryColor = tenant.branding.primaryColor;

  return (
    <div style={{
      padding: 16,
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e5e7eb',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {tenant.branding.logoUrl ? (
          <img
            src={tenant.branding.logoUrl}
            alt={tenant.schoolName || ''}
            style={{ height: 36, width: 36, borderRadius: 8, objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            height: 36, width: 36, borderRadius: 8,
            background: primaryColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 16,
          }}>
            {(tenant.schoolName || 'S')[0]}
          </div>
        )}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
            {tenant.schoolName}
          </div>
          {tenant.branding.tagline && (
            <div style={{ fontSize: 11, color: '#888' }}>{tenant.branding.tagline}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#aaa' }}>
        {t(isHi, 'Your child is learning at this school via Alfanumrik',
          'आपका बच्चा इस स्कूल में अल्फान्यूमरिक के माध्यम से पढ़ रहा है')}
      </div>
    </div>
  );
}