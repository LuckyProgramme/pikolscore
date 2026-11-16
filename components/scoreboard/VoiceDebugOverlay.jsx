'use client';

import { PILL_LABELS } from '../../hooks/useVoiceScoring';

export function VoiceDebugOverlay({ heard }) {
  if (!heard || !heard.text) return null;

  const isFinal = Boolean(heard.isFinal);
  const isAccepted = heard.outcome === 'accepted';
  const outcomeLabel = PILL_LABELS[heard.outcome] || heard.outcome || 'Evaluated';

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[55] pointer-events-none flex items-center justify-center p-4 transition-opacity duration-150"
    >
      <div className="absolute inset-0 bg-[#021024]/75 backdrop-blur-[12px]" />

      <div className="relative max-w-lg w-full bg-[#0B2239] border border-[#24425E] dv-top-accent rounded-[20px] p-6 sm:p-7 shadow-2xl flex flex-col items-center text-center gap-3">
        {!isFinal ? (
          <>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#00E5B8] animate-pulse shrink-0" />
              <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#00E5B8]">
                Listening…
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-medium italic text-[#B0C4D8] break-words max-h-36 overflow-y-auto px-2">
              “{heard.text}”
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {isAccepted ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00E5B8] text-[#031B28] text-[12px] font-bold uppercase tracking-wider">
                  <span>✓</span>
                  <span>
                    {heard.command ? heard.command.toUpperCase() : 'ACCEPTED'}
                    {heard.reason ? ` · ${heard.reason}` : ''}
                  </span>
                </span>
              ) : heard.outcome === 'armed' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#07192B] border border-[#00E5B8] text-[#00E5B8] text-[12px] font-bold uppercase tracking-wider animate-pulse">
                  <span>ARMED: SAY REASON</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#07192B] border border-[#24425E] text-[#F4A261] text-[12px] font-bold tracking-wide">
                  <span>{outcomeLabel}</span>
                </span>
              )}
              <span className="text-[11px] font-mono text-[#B0C4D8] px-2.5 py-0.5 rounded-[8px] bg-[#07192B] border border-[#24425E]">
                {heard.confidence > 0 ? `conf ${heard.confidence.toFixed(2)}` : 'conf n/a'}
              </span>
            </div>

            <div className="dv-display text-2xl sm:text-4xl text-[#FFFFFF] tracking-wide break-words max-h-40 overflow-y-auto px-2">
              “{heard.text}”
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default VoiceDebugOverlay;
