import Link from 'next/link';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  href?: string;
}

/**
 * Alfanumrik Logo — consistent brand mark across the app.
 * Uses the geometric "A" SVG icon with optional wordmark.
 * Sizes: sm (navbar), md (default), lg (hero/footer).
 */
export function Logo({ size = 'md', showText = true, href = '/welcome' }: LogoProps) {
  const sizes = {
    sm: { icon: 28, text: 'text-base', gap: 'gap-1.5' },
    md: { icon: 36, text: 'text-lg', gap: 'gap-2' },
    lg: { icon: 48, text: 'text-2xl', gap: 'gap-3' },
  };

  const s = sizes[size];

  const content = (
    <span className={`inline-flex items-center ${s.gap}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicon.svg"
        alt="Alfanumrik"
        width={s.icon}
        height={s.icon}
        style={{ width: s.icon, height: s.icon, objectFit: 'contain' }}
      />
      {showText && (
        <span
          className={`${s.text} font-extrabold`}
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          Alfanumrik
        </span>
      )}
    </span>
  );

  if (href) {
    return <Link href={href} className="inline-flex items-center">{content}</Link>;
  }

  return content;
}

export default Logo;
