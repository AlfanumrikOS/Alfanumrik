export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ height: 22, width: 120, background: '#e5e7eb', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 12, width: 340, background: '#f3f4f6', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ height: 32, width: 80, background: '#f3f4f6', borderRadius: 8 }} />
          <div style={{ height: 32, width: 90, background: '#e5e7eb', borderRadius: 8 }} />
        </div>
      </div>
      {/* Templates row */}
      <div style={{ height: 10, width: 110, background: '#f3f4f6', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {[140,160,150,130,150].map((w,i) => (
          <div key={i} style={{ height: 30, width: w, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }} />
        ))}
      </div>
      {/* 3 summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ height: 72, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }} />
        ))}
      </div>
      {/* Rules table */}
      <div style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ height: 40, background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }} />
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 48, borderBottom: '1px solid #f3f4f6', padding: '12px 16px' }}>
            <div style={{ height: 12, width: `${40+i*12}%`, background: '#f3f4f6', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
