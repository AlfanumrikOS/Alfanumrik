'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={iconContainerStyle}>
          <span style={foxyStyle} role="img" aria-label="Foxy mascot">🦊</span>
          <span style={codeStyle}>404</span>
        </div>

        <h1 style={headingStyle}>Page Not Found</h1>
        <p style={descriptionStyle}>
          Foxy couldn&apos;t find the page you&apos;re looking for.
          It might have been moved or doesn&apos;t exist.
        </p>

        <div style={suggestionsStyle}>
          <p style={suggestionTitleStyle}>What you can do:</p>
          <ul style={listStyle}>
            <li style={listItemStyle}>Check the URL and try again</li>
            <li style={listItemStyle}>Return to the dashboard to continue learning</li>
            <li style={listItemStyle}>Contact support if you think this is a mistake</li>
          </ul>
        </div>

        <Link href="/dashboard" aria-label="Go back to dashboard" style={{ textDecoration: 'none' }}>
          <button style={buttonStyle}>
            Back to Dashboard
          </button>
        </Link>

        <nav style={alternativeLinksStyle} aria-label="Additional navigation">
          <Link href="/welcome" style={linkStyle}>
            Home
          </Link>
          <span style={separatorStyle} aria-hidden="true">&bull;</span>
          <Link href="/help" style={linkStyle}>
            Help
          </Link>
          <span style={separatorStyle} aria-hidden="true">&bull;</span>
          <a href="mailto:support@alfanumrik.com" style={linkStyle}>
            Support
          </a>
        </nav>
      </div>
      <style>{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
      `}</style>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px 16px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  backgroundColor: 'var(--bg, #FBF8F4)',
  color: 'var(--text-1, #1a1a1a)',
};

const containerStyle: React.CSSProperties = { maxWidth: 500, textAlign: 'center' };
const iconContainerStyle: React.CSSProperties = { marginBottom: 24, animation: 'float 3s ease-in-out infinite' };
const foxyStyle: React.CSSProperties = { fontSize: 64, display: 'block', lineHeight: 1 };
const codeStyle: React.CSSProperties = { fontSize: 48, fontWeight: 800, color: 'var(--orange, #E8581C)', display: 'block', lineHeight: 1, marginTop: 8, fontFamily: "'Sora', system-ui, sans-serif" };
const headingStyle: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: 'var(--text-1, #1a1a1a)', margin: '0 0 12px', fontFamily: "'Sora', system-ui, sans-serif" };
const descriptionStyle: React.CSSProperties = { fontSize: 15, color: 'var(--text-2, #555)', margin: '0 0 24px', lineHeight: 1.6 };
const suggestionsStyle: React.CSSProperties = { backgroundColor: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: '16px 20px', marginBottom: 24, textAlign: 'left' };
const suggestionTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-3, #888)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px' };
const listStyle: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const listItemStyle: React.CSSProperties = { fontSize: 14, color: 'var(--text-2, #555)', padding: '6px 0', lineHeight: 1.5 };
const buttonStyle: React.CSSProperties = { display: 'inline-block', width: '100%', padding: '14px 20px', background: 'linear-gradient(135deg, #E8581C, #F5A623)', color: '#FFFFFF', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', transition: 'all 0.2s ease', marginBottom: 16 };
const alternativeLinksStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 };
const linkStyle: React.CSSProperties = { fontSize: 13, color: 'var(--orange, #E8581C)', textDecoration: 'none', fontWeight: 500 };
const separatorStyle: React.CSSProperties = { color: 'var(--border, #e5e0d8)' };
