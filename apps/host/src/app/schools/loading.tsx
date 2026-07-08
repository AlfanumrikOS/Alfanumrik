export default function Loading() {
  const b = '#e5e7eb', l = '#f3f4f6', s = '#f9fafb', bg = '#FBF8F4';
  return (
    <div style={{ minHeight: '100vh', background: bg }}>
      {/* Nav */}
      <nav style={{ height: 64, borderBottom: `1px solid ${b}`, display: 'flex', alignItems: 'center', padding: '0 16px', maxWidth: 1024, margin: '0 auto' }}>
        <div style={{ height: 24, width: 140, background: b, borderRadius: 6 }} />
        <div style={{ marginLeft: 'auto', height: 28, width: 120, background: l, borderRadius: 8 }} />
      </nav>
      {/* Hero */}
      <div style={{ padding: '64px 16px', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ height: 22, width: 120, background: 'rgba(124,58,237,0.08)', borderRadius: 12, margin: '0 auto 16px' }} />
        <div style={{ height: 36, width: '80%', background: b, borderRadius: 8, margin: '0 auto 12px' }} />
        <div style={{ height: 36, width: '55%', background: b, borderRadius: 8, margin: '0 auto 20px' }} />
        <div style={{ height: 14, width: '60%', background: l, borderRadius: 4, margin: '0 auto 24px' }} />
        <div style={{ height: 44, width: 180, background: b, borderRadius: 12, margin: '0 auto' }} />
      </div>
      {/* Features */}
      <div style={{ padding: '56px 16px', background: '#f5f2ed' }}>
        <div style={{ maxWidth: 1024, margin: '0 auto' }}>
          <div style={{ height: 28, width: 300, background: b, borderRadius: 6, margin: '0 auto 40px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 24 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ background: bg, borderRadius: 16, border: `1px solid ${b}`, padding: 24 }}>
                <div style={{ height: 48, width: 48, background: 'rgba(124,58,237,0.08)', borderRadius: 12, marginBottom: 16 }} />
                <div style={{ height: 14, width: 140, background: b, borderRadius: 4, marginBottom: 8 }} />
                <div style={{ height: 12, width: '80%', background: l, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Pricing */}
      <div style={{ padding: '56px 16px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ height: 28, width: 280, background: b, borderRadius: 6, margin: '0 auto 32px' }} />
        <div style={{ borderRadius: 16, border: `2px solid ${b}`, padding: 32 }}>
          <div style={{ height: 32, width: 100, background: b, borderRadius: 6, marginBottom: 20 }} />
          {[1,2,3].map(i => (
            <div key={i} style={{ height: 12, width: `${50+i*10}%`, background: l, borderRadius: 4, marginBottom: 12 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
