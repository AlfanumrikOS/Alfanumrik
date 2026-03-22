export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg, #FBF8F4)',
      fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: '4px solid var(--surface-2, #f0ebe4)',
        borderTopColor: 'var(--orange, #E8581C)',
        animation: 'spin 0.8s linear infinite',
      }} />
      <p style={{
        marginTop: 16,
        fontSize: 14,
        color: 'var(--text-3, #888)',
        fontWeight: 500,
      }}>
        Loading...
      </p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
