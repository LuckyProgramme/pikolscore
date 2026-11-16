'use client';

import LoginForm from '@/components/auth/LoginForm';
import CourtPanel from '@/components/auth/CourtPanel';
import DinkVisionLogo from '@/components/ui/DinkVisionLogo';

export function AuthShell({ initialMode = 'signin' }) {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#021024] text-[#FFFFFF]">
      {/* 56px DinkVision Top Telemetry Header */}
      <header className="h-[56px] shrink-0 px-4 sm:px-5 border-b border-[#11263C] bg-[#021024] flex items-center justify-between gap-2 sm:gap-3">
        <DinkVisionLogo size="md" />
        <div className="flex items-center gap-2 sm:gap-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#FFFFFF] whitespace-nowrap shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00E5B8] shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">TV PAIRING READY</span>
          <span className="sm:hidden">READY</span>
          <span className="h-3.5 w-px bg-[#24425E]" aria-hidden="true" />
          <span>UMPIRE CONSOLE</span>
        </div>
      </header>

      {/* Two-Column Desktop Split / Single-Column Mobile Portrait */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100dvh-56px)]">
        <LoginForm initialMode={initialMode} />
        <CourtPanel />
      </main>
    </div>
  );
}

export default AuthShell;
