'use client';

import dynamic from 'next/dynamic';

const Scoreboard = dynamic(
  () => import('../../components/scoreboard/Scoreboard'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#021024] flex items-center justify-center text-[#B0C4D8]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#00E5B8] border-t-transparent rounded-full animate-spin" />
          <p className="text-[13.5px] font-medium">Loading scoreboard...</p>
        </div>
      </div>
    ),
  }
);

export default function ScoreboardPage() {
  return <Scoreboard />;
}
