'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';

/**
 * TrustFooter — Visible on every page, always.
 *
 * Indian parents judge an app by its transparency signals.
 * PhysicsWallah and Byju's lost trust by hiding data practices.
 * Alfanumrik earns trust by showing them front and center.
 *
 * This footer is our equivalent of Anthropic's Constitutional AI principles
 * being public — transparency is a competitive advantage.
 */
export default function TrustFooter() {
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;

  return (
    <footer
      style={{
        padding: '16px 20px 24px',
        textAlign: 'center',
        fontSize: 11,
        color: 'var(--text-3, #999)',
        lineHeight: 1.8,
        fontFamily: 'var(--font-body)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <Link href="/privacy" style={linkStyle}>
          {isHi ? 'गोपनीयता नीति' : 'Privacy Policy'}
        </Link>
        <Link href="/terms" style={linkStyle}>
          {isHi ? 'नियम एवं शर्तें' : 'Terms'}
        </Link>
        <Link href="/help" style={linkStyle}>
          {isHi ? 'सहायता' : 'Help'}
        </Link>
      </div>
      <div style={{ marginBottom: 4 }}>
        <span role="img" aria-label="shield">🛡️</span>{' '}
        {isHi
          ? 'आपका डेटा एन्क्रिप्टेड और सुरक्षित है। हम कभी आपका डेटा नहीं बेचते।'
          : 'Your data is encrypted & secure. We never sell your data.'}
      </div>
      <div>
        © {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.
        {' · '}
        <span style={{ color: 'var(--text-3, #999)' }}>
          {isHi ? 'भारत में बना' : 'Made in India'} 🇮🇳
        </span>
      </div>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: 'var(--text-3, #888)',
  textDecoration: 'none',
  fontWeight: 500,
  fontSize: 11,
};
