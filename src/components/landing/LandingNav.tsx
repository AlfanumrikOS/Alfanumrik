'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Testimonials', href: '#testimonials' },
  { label: 'Pricing', href: '#pricing' },
] as const;

interface LandingNavProps {
  onGetStarted?: () => void;
}

export default function LandingNav({ onGetStarted }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastScrollY = useRef(0);

  const handleScroll = useCallback(() => {
    const y = window.scrollY;
    setScrolled(y > 20);
    if (y > lastScrollY.current && y > 80) {
      setHidden(true);
    } else {
      setHidden(false);
    }
    lastScrollY.current = y;
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Close mobile menu on resize
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const smoothScroll = (href: string) => {
    setMobileOpen(false);
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0"
        style={{
          zIndex: 100,
          transform: hidden && !mobileOpen ? 'translateY(-100%)' : 'translateY(0)',
          transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease, backdrop-filter 0.3s ease',
          background: scrolled
            ? 'rgba(250, 249, 245, 0.88)'
            : 'transparent',
          backdropFilter: scrolled ? 'blur(16px) saturate(180%)' : 'none',
          WebkitBackdropFilter: scrolled ? 'blur(16px) saturate(180%)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(20, 20, 19, 0.06)' : '1px solid transparent',
        }}
      >
        <div
          className="mx-auto flex items-center justify-between"
          style={{
            maxWidth: 1200,
            padding: '0 24px',
            height: 64,
          }}
        >
          {/* Logo */}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="flex items-center gap-2 select-none"
            style={{ textDecoration: 'none' }}
          >
            <span style={{ fontSize: '1.5rem' }} aria-hidden="true">🦊</span>
            <span
              className="font-heading"
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #d97757 0%, #c4a35a 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Alfanumrik
            </span>
          </a>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <button
                key={link.href}
                onClick={() => smoothScroll(link.href)}
                className="nav-link-desktop"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '8px 16px',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  borderRadius: 8,
                  fontFamily: 'var(--font-body)',
                  transition: 'color 0.2s ease, background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-1)';
                  e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-2)';
                  e.currentTarget.style.background = 'none';
                }}
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <button
              className="nav-login-btn"
              style={{
                background: 'none',
                border: '1px solid var(--border-mid)',
                padding: '8px 20px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--text-2)',
                cursor: 'pointer',
                borderRadius: 10,
                fontFamily: 'var(--font-body)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-strong)';
                e.currentTarget.style.color = 'var(--text-1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-mid)';
                e.currentTarget.style.color = 'var(--text-2)';
              }}
            >
              Log In
            </button>
            <button
              onClick={onGetStarted}
              style={{
                background: '#d97757',
                border: 'none',
                padding: '8px 22px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#fff',
                cursor: 'pointer',
                borderRadius: 12,
                fontFamily: 'var(--font-body)',
                transition: 'all 0.25s ease',
                boxShadow: '0 2px 8px rgba(217, 119, 87, 0.20)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(217, 119, 87, 0.30)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(217, 119, 87, 0.20)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              Get Started Free
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: mobileOpen ? 0 : 5,
              justifyContent: 'center',
              alignItems: 'center',
              width: 40,
              height: 40,
            }}
          >
            <span
              style={{
                display: 'block',
                width: 22,
                height: 2,
                background: 'var(--text-1)',
                borderRadius: 2,
                transition: 'all 0.3s ease',
                transform: mobileOpen ? 'rotate(45deg) translate(0, 0)' : 'none',
                transformOrigin: 'center',
              }}
            />
            <span
              style={{
                display: 'block',
                width: 22,
                height: 2,
                background: 'var(--text-1)',
                borderRadius: 2,
                transition: 'all 0.3s ease',
                opacity: mobileOpen ? 0 : 1,
              }}
            />
            <span
              style={{
                display: 'block',
                width: 22,
                height: 2,
                background: 'var(--text-1)',
                borderRadius: 2,
                transition: 'all 0.3s ease',
                transform: mobileOpen ? 'rotate(-45deg) translate(0, 0)' : 'none',
                transformOrigin: 'center',
              }}
            />
          </button>
        </div>

        {/* Mobile slide-down panel */}
        <div
          style={{
            maxHeight: mobileOpen ? 420 : 0,
            overflow: 'hidden',
            transition: 'max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
            opacity: mobileOpen ? 1 : 0,
            background: 'rgba(250, 249, 245, 0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: mobileOpen ? '1px solid rgba(0,0,0,0.06)' : 'none',
          }}
          className="md:hidden"
        >
          <div style={{ padding: '12px 24px 24px' }}>
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <button
                  key={link.href}
                  onClick={() => smoothScroll(link.href)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '12px 16px',
                    fontSize: '1rem',
                    fontWeight: 500,
                    color: 'var(--text-1)',
                    cursor: 'pointer',
                    borderRadius: 10,
                    textAlign: 'left',
                    fontFamily: 'var(--font-body)',
                    transition: 'background 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  {link.label}
                </button>
              ))}
            </div>
            <div
              style={{
                height: 1,
                background: 'var(--border)',
                margin: '12px 0',
              }}
            />
            <div className="flex flex-col gap-3">
              <button
                style={{
                  background: 'none',
                  border: '1px solid var(--border-mid)',
                  padding: '12px 20px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  borderRadius: 12,
                  fontFamily: 'var(--font-body)',
                  width: '100%',
                }}
              >
                Log In
              </button>
              <button
                onClick={() => { setMobileOpen(false); onGetStarted?.(); }}
                style={{
                  background: '#d97757',
                  border: 'none',
                  padding: '12px 22px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: '#fff',
                  cursor: 'pointer',
                  borderRadius: 12,
                  fontFamily: 'var(--font-body)',
                  width: '100%',
                  boxShadow: '0 2px 8px rgba(217, 119, 87, 0.20)',
                }}
              >
                Get Started Free
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Spacer so content isn't hidden behind fixed nav */}
      <div style={{ height: 64 }} />
    </>
  );
}
