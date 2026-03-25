'use client';

import { useRef, useEffect, useState, type ReactNode } from 'react';

/**
 * CSS-only viewport-triggered animations.
 * Replaces framer-motion (40KB) with native IntersectionObserver (0KB).
 */

function useInView(margin = '-40px') {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: margin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [margin]);
  return { ref, visible };
}

/* Fade-up animation triggered when element enters viewport */
export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.5s cubic-bezier(0.25,0.1,0.25,1) ${delay}s, transform 0.5s cubic-bezier(0.25,0.1,0.25,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

/* Stagger children animations — uses CSS nth-child delays */
export function StaggerContainer({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const { ref, visible } = useInView('-30px');
  return (
    <div ref={ref} className={`${className} ${visible ? 'stagger-visible' : 'stagger-hidden'}`}>
      {children}
    </div>
  );
}

/* Individual stagger child */
export function StaggerItem({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`stagger-item ${className}`}>
      {children}
    </div>
  );
}

/* Scale-up on hover for cards — pure CSS */
export function HoverScale({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-hover ${className}`}>
      {children}
    </div>
  );
}

/* Counter animation for stats */
export function CountUp({ value, suffix = '' }: { value: string; suffix?: string }) {
  const { ref, visible } = useInView();
  return (
    <span
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0.8)',
        transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
        display: 'inline-block',
      }}
    >
      {value}{suffix}
    </span>
  );
}
