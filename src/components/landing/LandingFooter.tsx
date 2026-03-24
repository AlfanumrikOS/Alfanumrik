'use client';

/* ══════════════════════════════════════════════════════════════
   LANDING PAGE FOOTER
   ══════════════════════════════════════════════════════════════ */

const PRODUCT_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Simulations', href: '#simulations' },
  { label: 'AI Tutor', href: '#ai-tutor' },
  { label: 'Study Plans', href: '#study-plans' },
];

const COMPANY_LINKS = [
  { label: 'About', href: '/about' },
  { label: 'Blog', href: '/blog' },
  { label: 'Careers', href: '/careers' },
  { label: 'Contact', href: '/contact' },
  { label: 'Press', href: '/press' },
];

const LEGAL_LINKS = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Cookie Policy', href: '/cookies' },
  { label: 'Refund Policy', href: '/refund' },
];

const SOCIAL_LINKS = [
  { label: 'Twitter', href: 'https://twitter.com/alfanumrik', icon: '𝕏' },
  { label: 'Instagram', href: 'https://instagram.com/alfanumrik', icon: '📷' },
  { label: 'YouTube', href: 'https://youtube.com/@alfanumrik', icon: '▶️' },
  { label: 'LinkedIn', href: 'https://linkedin.com/company/alfanumrik', icon: '🔗' },
];

interface FooterColumnProps {
  title: string;
  links: { label: string; href: string }[];
}

function FooterColumn({ title, links }: FooterColumnProps) {
  return (
    <div className="footer-column">
      <h4 className="column-title">{title}</h4>
      <ul className="column-links">
        {links.map((link) => (
          <li key={link.label}>
            <a href={link.href} className="footer-link">
              {link.label}
            </a>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .footer-column {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .column-title {
          font-family: var(--font-display);
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.5);
        }
        .column-links {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .footer-link {
          font-size: 0.92rem;
          color: rgba(255, 255, 255, 0.65);
          text-decoration: none;
          transition: color 0.2s ease;
          font-weight: 500;
        }
        .footer-link:hover {
          color: #d97757;
        }
      `}</style>
    </div>
  );
}

export default function LandingFooter() {
  return (
    <footer className="landing-footer">
      {/* Jade gradient line at top */}
      <div className="footer-top-line" />
      <div className="footer-inner">
        {/* ── Top grid ── */}
        <div className="footer-grid">
          {/* Brand column */}
          <div className="brand-column">
            <div className="brand-logo">
              <span className="logo-icon" aria-hidden="true">🦊</span>
              <span className="logo-text">Alfanumrik</span>
            </div>
            <p className="brand-tagline">
              India&apos;s Smartest AI Learning Platform
            </p>
            <div className="social-links">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  className="social-icon"
                  aria-label={social.label}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Company" links={COMPANY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        {/* ── Divider ── */}
        <div className="footer-divider" />

        {/* ── Bottom bar ── */}
        <div className="footer-bottom">
          <p className="copyright">
            &copy; 2024 Cusiosense Learning India Pvt. Ltd. &middot; Made with 🧡 in India
          </p>
        </div>
      </div>

      <style jsx>{`
        .landing-footer {
          background: #141413;
          padding: 64px 20px 32px;
          color: rgba(255, 255, 255, 0.65);
          position: relative;
        }
        .footer-top-line {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(217,119,87,0.3), transparent);
        }
        .footer-inner {
          max-width: 1120px;
          margin: 0 auto;
        }
        .footer-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 40px;
          margin-bottom: 48px;
        }

        /* ── Brand column ── */
        .brand-column {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .brand-logo {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .logo-icon {
          font-size: 1.6rem;
        }
        .logo-text {
          font-family: var(--font-display);
          font-size: 1.35rem;
          font-weight: 800;
          color: #FFFFFF;
          letter-spacing: -0.01em;
        }
        .brand-tagline {
          font-size: 0.92rem;
          color: rgba(255, 255, 255, 0.5);
          line-height: 1.5;
          max-width: 260px;
        }
        .social-links {
          display: flex;
          gap: 12px;
          margin-top: 4px;
        }
        .social-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 1rem;
          text-decoration: none;
          transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
        }
        .social-icon:hover {
          background: rgba(217,119,87,0.12);
          border-color: rgba(217,119,87,0.25);
          transform: translateY(-2px);
        }

        /* ── Divider ── */
        .footer-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          margin-bottom: 24px;
        }

        /* ── Bottom bar ── */
        .footer-bottom {
          text-align: center;
        }
        .copyright {
          font-size: 0.82rem;
          color: rgba(255, 255, 255, 0.35);
          line-height: 1.5;
        }

        /* ── Responsive ── */
        @media (min-width: 640px) {
          .footer-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (min-width: 768px) {
          .landing-footer {
            padding: 80px 32px 40px;
          }
        }
        @media (min-width: 1024px) {
          .footer-grid {
            grid-template-columns: 1.5fr 1fr 1fr 1fr;
            gap: 48px;
          }
        }
      `}</style>
    </footer>
  );
}
