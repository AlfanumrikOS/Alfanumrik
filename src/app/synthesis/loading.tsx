export default function SynthesisLoading() {
  return (
    <main className="app-container py-8">
      <div className="h-32 rounded-3xl animate-pulse" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
    </main>
  );
}
