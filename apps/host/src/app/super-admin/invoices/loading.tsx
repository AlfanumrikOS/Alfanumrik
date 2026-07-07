export default function Loading() {
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ height: 22, width: 190, background: '#e5e7eb', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 12, width: 260, background: '#f3f4f6', borderRadius: 4 }} />
        </div>
        <div style={{ height: 34, width: 140, background: '#e5e7eb', borderRadius: 8 }} />
      </div>
      {/* 4 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 24 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 80, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }} />
        ))}
      </div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[40,72,44,44,60].map((w,i) => (
          <div key={i} style={{ height: 30, width: w, background: '#f3f4f6', borderRadius: 8 }} />
        ))}
      </div>
      {/* Invoices table */}
      <div style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ height: 40, background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }} />
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{ height: 48, borderBottom: '1px solid #f3f4f6', padding: '12px 16px' }}>
            <div style={{ height: 12, width: `${40+i*8}%`, background: '#f3f4f6', borderRadius: 4 }} />
          </div>
        ))}
      </div>
      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
        <div style={{ height: 30, width: 50, background: '#f3f4f6', borderRadius: 6 }} />
        <div style={{ height: 14, width: 80, background: '#f3f4f6', borderRadius: 4, alignSelf: 'center' }} />
        <div style={{ height: 30, width: 50, background: '#f3f4f6', borderRadius: 6 }} />
      </div>
    </div>
  );
}
