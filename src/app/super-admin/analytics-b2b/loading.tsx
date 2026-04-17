export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ height: 22, width: 160, background: '#e5e7eb', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 12, width: 300, background: '#f3f4f6', borderRadius: 4 }} />
        </div>
        <div style={{ height: 32, width: 80, background: '#f3f4f6', borderRadius: 8 }} />
      </div>
      {/* Revenue stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 88, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }} />
        ))}
      </div>
      {/* Growth label + cards */}
      <div style={{ height: 16, width: 80, background: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 80, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }} />
        ))}
      </div>
      {/* Cohort chart */}
      <div style={{ height: 16, width: 200, background: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ height: 120, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 24 }} />
      {/* School table */}
      <div style={{ height: 16, width: 180, background: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ height: 40, background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }} />
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ height: 44, borderBottom: '1px solid #f3f4f6', padding: '12px 16px' }}>
            <div style={{ height: 12, width: `${50+i*8}%`, background: '#f3f4f6', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
