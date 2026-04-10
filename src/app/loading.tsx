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
        fontSize: 48,
        marginBottom: 16,
        animation: 'foxyBounce 1.2s ease-in-out infinite',
      }}>
        🦊
      </div>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        border: '3px solid var(--surface-2, #f0ebe4)',
        borderTopColor: 'var(--orange, #E8581C)',
        animation: 'spin 0.8s linear infinite',
      }} />
      <p style={{
        marginTop: 16,
        fontSize: 14,
        color: 'var(--text-3, #888)',
        fontWeight: 500,
      }}>
        Loading Alfanumrik...
      </p>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes foxyBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
      `}</style>
    </div>
  );
}
