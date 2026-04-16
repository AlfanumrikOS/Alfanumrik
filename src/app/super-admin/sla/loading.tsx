export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ height: 22, width: 160, background: '#e5e7eb', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 12, width: 280, background: '#f3f4f6', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ height: 24, width: 100, background: '#e5e7eb', borderRadius: 10 }} />
          <div style={{ height: 32, width: 80, background: '#f3f4f6', borderRadius: 8 }} />
        </div>
      </div>
      {/* 4 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 88, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }} />
        ))}
      </div>
      {/* Uptime bar */}
      <div style={{ height: 16, width: 180, background: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20, marginBottom: 24 }}>
        <div style={{ height: 24, background: '#e5e7eb', borderRadius: 4, opacity: 0.5, marginBottom: 12 }} />
        <div style={{ height: 24, background: '#e5e7eb', borderRadius: 4, opacity: 0.4 }} />
      </div>
      {/* Latency table */}
      <div style={{ height: 16, width: 200, background: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ height: 40, background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }} />
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 44, borderBottom: '1px solid #f3f4f6', padding: '12px 16px' }}>
            <div style={{ height: 12, width: `${40+i*12}%`, background: '#f3f4f6', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
