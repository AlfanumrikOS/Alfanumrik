export default function OnboardingLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="text-3xl animate-pulse">✨</div>
      <p className="text-sm text-muted-foreground animate-pulse">Setting up your account…</p>
    </div>
  );
}
