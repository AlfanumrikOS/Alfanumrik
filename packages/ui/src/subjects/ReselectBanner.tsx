'use client';

/**
 * ReselectBanner — shown on the dashboard when a legacy student ends up with
 * zero unlocked subjects (e.g. after a grade change or plan downgrade). The
 * banner is the single CTA for them to reopen the subject picker.
 */

interface ReselectBannerProps {
  isHi: boolean;
  onReselect: () => void;
}

export function ReselectBanner({ isHi, onReselect }: ReselectBannerProps) {
  return (
    <div
      className="w-full rounded-2xl p-4 flex items-start gap-3"
      style={{
        background: 'linear-gradient(135deg, rgba(232,88,28,0.08), rgba(245,166,35,0.08))',
        border: '1.5px solid rgba(232,88,28,0.25)',
      }}
      role="region"
      aria-label={isHi ? 'विषय पुनः चुनें' : 'Re-select subjects'}
    >
      <span className="text-2xl" aria-hidden="true">📚</span>
      <div className="flex-1 min-w-0">
        <h3
          className="text-sm font-bold"
          style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'अपने विषय चुनें' : 'Choose your subjects'}
        </h3>
        <p className="text-xs text-[var(--text-2)] mt-1 leading-relaxed">
          {isHi
            ? 'अपनी कक्षा और योजना के लिए विषय चुनने के लिए नीचे टैप करें'
            : 'Tap below to pick the subjects available for your grade and plan.'}
        </p>
        <button
          type="button"
          onClick={onReselect}
          className="mt-3 text-xs font-bold px-4 py-2 rounded-xl text-white transition-all active:scale-[0.97]"
          style={{ background: 'var(--orange)' }}
        >
          {isHi ? 'अपने विषय चुनें' : 'Choose your subjects'}
        </button>
      </div>
    </div>
  );
}

export default ReselectBanner;
