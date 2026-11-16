'use client';

import DinkVisionLogo from '@/components/ui/DinkVisionLogo';
import AmbientCourtMotif from '@/components/ui/AmbientCourtMotif';

export function AuthLoadingSplash({ label = 'Checking courtside session...' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#021024] text-[#FFFFFF] select-none overflow-hidden"
    >
      <AmbientCourtMotif variant="glow" />

      <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
        <div className="rounded-2xl bg-[#0B2239] border border-[#24425E] px-6 py-4 dv-top-accent shadow-2xl">
          <DinkVisionLogo size="lg" />
        </div>

        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#00E5B8] mt-1">
          Courtside Precision
        </p>

        <div className="mt-2 flex items-center gap-2.5 rounded-full bg-[#07192B] border border-[#24425E] px-4 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[#00E5B8] animate-ping" />
          <span className="text-[13px] font-medium text-[#B0C4D8]">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

export default AuthLoadingSplash;
