import Link from 'next/link';

interface Crumb {
  label: string;
  /**
   * Optional href. The last (current page) crumb should omit this; intermediate
   * crumbs that point at non-existent landing pages (e.g. "Solutions") may also
   * omit it so they render as plain text rather than a broken link.
   */
  href?: string;
}

interface BreadcrumbsProps {
  items: Crumb[]; // ordered, root first
}

/**
 * Reusable breadcrumb component for deep marketing pages.
 *
 * Renders a visible nav and emits BreadcrumbList JSON-LD inline so Google can
 * surface the trail under search results. The visible markup is plain HTML
 * with inline styles + CSS variables — no client state, server-renderable on
 * any page regardless of which landing-v2 / legacy CSS scope it uses.
 *
 * Mounted by Phase 3 on /about, /pricing, /product, /for-parents, /for-teachers,
 * /for-schools, /research.
 */
export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  const baseUrl = 'https://alfanumrik.com';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: `${baseUrl}${c.href}` } : {}),
    })),
  };

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        style={{
          padding: '12px 16px',
          fontSize: 13,
          color: 'var(--text-2, #5B5141)',
          borderBottom: '1px solid var(--border, #e5e0d8)',
        }}
      >
        <ol
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            listStyle: 'none',
            padding: 0,
            margin: 0,
            maxWidth: 1100,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          {items.map((c, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {c.href ? (
                <Link
                  href={c.href}
                  style={{
                    color: 'var(--text-2, #5B5141)',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current="page"
                  style={{ color: 'var(--text-1, #1a1a1a)', fontWeight: 700 }}
                >
                  {c.label}
                </span>
              )}
              {i < items.length - 1 && (
                <span aria-hidden="true" style={{ opacity: 0.5 }}>
                  ›
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
