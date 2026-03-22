'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        {/* Icon/Illustration */}
        <div style={iconContainerStyle}>
          <span style={iconStyle}>404</span>
        </div>

        {/* Heading */}
        <h1 style={headingStyle}>Page Not Found</h1>

        {/* Description */}
        <p style={descriptionStyle}>
          We couldn't find the page you're looking for. It might have been moved or deleted.
        </p>

        {/* Suggestions */}
        <div style={suggestionsStyle}>
          <p style={suggestionTitleStyle}>What you can do:</p>
          <ul style={listStyle}>
            <li style={listItemStyle}>Check the URL and try again</li>
            <li style={listItemStyle}>Return to the dashboard to continue learning</li>
            <li style={listItemStyle}>Contact support if you think this is a mistake</li>
          </ul>
        </div>

        {/* Action Button */}
        <Link href="/dashboard">
          <button style={buttonStyle}>
            Back to Dashboard
          </button>
        </Link>

        {/* Alternative links */}
        <div style={alternativeLinksStyle}>
          <Link href="/" style={linkStyle}>
            Home
          </Link>
          <span style={separatorStyle}>•</span>
          <a href="mailto:support@alfanumrik.com" style={linkStyle}>
            Support
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px 16px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  backgroundColor: '#0B1120',
  color: '#E2E8F0',
};

const containerStyle: React.CSSProperties = {
  maxWidth: 500,
  textAlign: 'center',
};

const iconContainerStyle: React.CSSProperties = {
  marginBottom: 32,
  animation: 'float 3s ease-in-out infinite',
};

const iconStyle: React.CSSProperties = {
  fontSize: 80,
  fontWeight: 700,
  color: '#6366F1',
  display: 'block',
  lineHeight: 1,
};

const headingStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  color: '#F1F5F9',
  margin: '0 0 12px',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 15,
  color: '#94A3B8',
  margin: '0 0 24px',
  lineHeight: 1.6,
};

const suggestionsStyle: React.CSSProperties = {
  backgroundColor: '#0F172A',
  border: '1px solid #1E293B',
  borderRadius: 12,
  padding: '16px 18px',
  marginBottom: 24,
  textAlign: 'left',
};

const suggestionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  margin: '0 0 10px',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const listItemStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#CBD5E1',
  padding: '6px 0',
  lineHeight: 1.5,
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '100%',
  padding: '12px 20px',
  backgroundColor: '#6366F1',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  transition: 'all 0.3s ease',
  marginBottom: 16,
};

const alternativeLinksStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
};

const linkStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#6366F1',
  textDecoration: 'none',
  fontWeight: 500,
  transition: 'color 0.2s ease',
};

const separatorStyle: React.CSSProperties = {
  color: '#334155',
};

// Global styles with keyframes
const globalStyles = `
  @keyframes float {
    0%, 100% {
      transform: translateY(0px);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  button:hover {
    background-color: #4f46e5 !important;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
  }

  a:hover {
    color: #818cf8 !important;
  }
`;

// Note: globalStyles are unused since we use inline CSSProperties.
// They were injecting into document.head at module load time which
// can break React hydration. Removed.
