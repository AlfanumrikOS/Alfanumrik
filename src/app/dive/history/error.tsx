'use client';

export default function DiveHistoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">Could not load dive history. Please try again.</p>
      <button
        onClick={reset}
        className="rounded-lg px-4 py-2 text-sm font-medium"
        style={{ background: 'var(--primary)', color: 'white' }}
      >
        Try again
      </button>
    </div>
  );
}
