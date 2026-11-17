'use client';

import { memo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Volume2, VolumeX, Unlink, AlertTriangle } from 'lucide-react';

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Monochrome mint perforated pickleball glyph for the serving team label row.
 * Uses only #7FE3BE (mint) and #14284D (serving card fill) to stay inside the 8-color palette.
 */
function PickleballGlyph() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="16" cy="16" r="15" fill="#7FE3BE" />
      <circle cx="16" cy="16" r="2.2" fill="#14284D" />
      <circle cx="16" cy="8.5" r="2.0" fill="#14284D" />
      <circle cx="22.5" cy="12.25" r="2.0" fill="#14284D" />
      <circle cx="22.5" cy="19.75" r="2.0" fill="#14284D" />
      <circle cx="16" cy="23.5" r="2.0" fill="#14284D" />
      <circle cx="9.5" cy="19.75" r="2.0" fill="#14284D" />
      <circle cx="9.5" cy="12.25" r="2.0" fill="#14284D" />
    </svg>
  );
}

/**
 * Split-flap score display with:
 * - No leading zero (0..99)
 * - Fixed 2-digit reserved box (640x560) so 9 -> 10 causes zero layout shift and wide digits (88) never clip
 * - Proportional condensed spacing so 10 / 11 sit tightly together while keeping 580px height
 * - 4px horizontal hinge line across the vertical midpoint in cardBg color
 * - Split-flap fold animation only when the same team's score changes (skipped on side-out swaps)
 */
const SplitFlapScore = memo(function SplitFlapScore({
  value,
  teamIndex,
  textColor,
  cardBg,
}) {
  const elRef = useRef(null);
  const prevValRef = useRef(undefined);
  const prevTeamRef = useRef(undefined);
  const strVal = String(Math.max(0, Number(value ?? 0)));

  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const spans = el.querySelectorAll('span');
    const flaps = el.querySelectorAll('[data-flap]');
    const topFlap = flaps[2];
    const bottomFlap = flaps[3];

    const oldVal = prevValRef.current;
    const oldTeam = prevTeamRef.current;
    prevValRef.current = strVal;
    prevTeamRef.current = teamIndex;

    const teamChanged = oldTeam !== undefined && oldTeam !== teamIndex;
    if (oldVal === strVal && !teamChanged) return;

    if (typeof el.getAnimations === 'function') {
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    }

    if (topFlap) topFlap.style.visibility = 'hidden';
    if (bottomFlap) bottomFlap.style.visibility = 'hidden';

    if (
      oldVal === undefined ||
      teamChanged ||
      oldVal === strVal ||
      prefersReducedMotion() ||
      !topFlap ||
      !bottomFlap ||
      typeof topFlap.animate !== 'function'
    ) {
      spans.forEach((node) => {
        node.textContent = strVal;
      });
      return;
    }

    spans[0].textContent = strVal; // top static (new)
    spans[1].textContent = oldVal; // bottom static (old until unfold finishes)
    spans[2].textContent = oldVal; // top flap folding down
    spans[3].textContent = strVal; // bottom flap unfolding

    topFlap.style.visibility = 'visible';
    const foldDown = topFlap.animate(
      [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
      { duration: 180, easing: 'ease-in' }
    );

    foldDown.onfinish = () => {
      topFlap.style.visibility = 'hidden';
      bottomFlap.style.visibility = 'visible';
      const unfoldBottom = bottomFlap.animate(
        [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
        { duration: 180, easing: 'ease-out' }
      );
      unfoldBottom.onfinish = () => {
        spans[1].textContent = strVal;
        bottomFlap.style.visibility = 'hidden';
      };
    };
  }, [strVal, teamIndex]);

  const halfBaseStyle = {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 'calc(50% - 2px)',
    overflow: 'hidden',
    backgroundColor: cardBg,
    backfaceVisibility: 'hidden',
  };

  const glyphWrapStyle = {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '560px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '580px',
    lineHeight: 1,
    letterSpacing: '-0.025em',
    fontVariantNumeric: 'proportional-nums',
    fontFeatureSettings: '"tnum" 0',
    color: textColor,
  };

  return (
    <div
      ref={elRef}
      data-score-value={strVal}
      className="relative w-[640px] h-[560px] shrink-0 select-none"
      style={{ perspective: '1100px' }}
    >
      {/* Top static (revealed new score) */}
      <div
        data-flap="top-static"
        style={{ ...halfBaseStyle, top: 0, zIndex: 1 }}
      >
        <span style={{ ...glyphWrapStyle, top: 0 }}>{strVal}</span>
      </div>

      {/* Bottom static (old score while top flap folds) */}
      <div
        data-flap="bottom-static"
        style={{ ...halfBaseStyle, bottom: 0, zIndex: 1 }}
      >
        <span style={{ ...glyphWrapStyle, bottom: 0 }}>{strVal}</span>
      </div>

      {/* Top folding flap (old score) */}
      <div
        data-flap="top-flap"
        style={{
          ...halfBaseStyle,
          top: 0,
          zIndex: 2,
          visibility: 'hidden',
          transformOrigin: '50% calc(100% + 2px)',
        }}
      >
        <span style={{ ...glyphWrapStyle, top: 0 }}>{strVal}</span>
      </div>

      {/* Bottom unfolding flap (new score) */}
      <div
        data-flap="bottom-flap"
        style={{
          ...halfBaseStyle,
          bottom: 0,
          zIndex: 2,
          visibility: 'hidden',
          transformOrigin: '50% -2px',
        }}
      >
        <span style={{ ...glyphWrapStyle, bottom: 0 }}>{strVal}</span>
      </div>
    </div>
  );
});

/**
 * Minimalist 1920x1080 projected scoreboard for courtside TVs.
 * Enforces the exact 8-color palette:
 *   #060F1F (bg), #14284D (serving), #0C182E (receiving), #7FE3BE (mint),
 *   #062A22 (text on mint), #F5F8FF (primary), #A9B9D3 (secondary), #D6E1F2 (receiving score).
 */
export default function ProjectedScoreboard({
  courtNumber = 1,
  formatLabel = 'Doubles',
  isSingles = false,
  timerText = '30:00',
  timerSublabel = 'Time left',
  servingTeamIdx = 0,
  receivingTeamIdx = 1,
  servingTeamLabel = 'Team A',
  serverName = '',
  serverNumber = 1,
  servingScore = 0,
  receivingScore = 0,
  muted = false,
  onToggleMute,
  onUnpairTv,
  controlsVisible = false,
  onRevealControls,
  abandonCountdown = null,
}) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const servingCardRef = useRef(null);
  const receivingCardRef = useRef(null);
  const prevServingTeamRef = useRef(null);
  const beforeRectsRef = useRef(null);
  const serverNameRef = useRef(null);

  // Scale the 1920x1080 design canvas uniformly to fit any TV/browser viewport
  useIsoLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateScale = () => {
      const next = Math.min(
        window.innerWidth / 1920,
        window.innerHeight / 1080
      );
      scaleRef.current = next;
      setScale(next);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Auto-shrink long server names on a single line (56px down to 38px, then ellipsis)
  useIsoLayoutEffect(() => {
    const el = serverNameRef.current;
    if (!el) return;
    let size = 56;
    el.style.fontSize = `${size}px`;
    while (size > 38 && el.scrollWidth > el.clientWidth + 1) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
  }, [serverName, isSingles]);

  // Capture bounding rects right before servingTeamIdx swaps so we can FLIP-animate
  if (
    prevServingTeamRef.current !== null &&
    prevServingTeamRef.current !== servingTeamIdx &&
    servingCardRef.current &&
    receivingCardRef.current
  ) {
    beforeRectsRef.current = {
      serving: servingCardRef.current.getBoundingClientRect(),
      receiving: receivingCardRef.current.getBoundingClientRect(),
    };
  }

  useIsoLayoutEffect(() => {
    const prevTeam = prevServingTeamRef.current;
    prevServingTeamRef.current = servingTeamIdx;

    if (prevTeam === null || prevTeam === servingTeamIdx) {
      beforeRectsRef.current = null;
      return;
    }

    const before = beforeRectsRef.current;
    beforeRectsRef.current = null;

    if (
      !before ||
      prefersReducedMotion() ||
      !servingCardRef.current ||
      !receivingCardRef.current ||
      typeof servingCardRef.current.animate !== 'function'
    ) {
      return;
    }

    const servingEl = servingCardRef.current;
    const receivingEl = receivingCardRef.current;

    if (typeof servingEl.getAnimations === 'function') {
      servingEl.getAnimations().forEach((a) => a.cancel());
    }
    if (typeof receivingEl.getAnimations === 'function') {
      receivingEl.getAnimations().forEach((a) => a.cancel());
    }

    const activeScale = scaleRef.current || 1;
    const afterServing = servingEl.getBoundingClientRect();
    const afterReceiving = receivingEl.getBoundingClientRect();

    const dxS = (before.receiving.left - afterServing.left) / activeScale;
    const dyS = (before.receiving.top - afterServing.top) / activeScale;
    const dxR = (before.serving.left - afterReceiving.left) / activeScale;
    const dyR = (before.serving.top - afterReceiving.top) / activeScale;

    if (Math.abs(dxS) > 0.5 || Math.abs(dyS) > 0.5) {
      servingEl.animate(
        [
          { transform: `translate(${dxS}px, ${dyS}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
    if (Math.abs(dxR) > 0.5 || Math.abs(dyR) > 0.5) {
      receivingEl.animate(
        [
          { transform: `translate(${dxR}px, ${dyR}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  }, [servingTeamIdx]);

  const showHoverControls = Boolean(
    controlsVisible && abandonCountdown === null && (onToggleMute || onUnpairTv)
  );

  return (
    <div
      className="fixed inset-0 bg-[#060F1F] overflow-hidden flex items-center justify-center select-none font-sans"
      onMouseMove={onRevealControls}
      onPointerDown={onRevealControls}
      onTouchStart={onRevealControls}
      onFocusCapture={onRevealControls}
    >
      <div
        className="relative w-[1920px] h-[1080px] bg-[#060F1F] overflow-hidden shrink-0 flex flex-col pt-[36px] px-[48px] pb-[32px]"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* 1. Top Bar: 3 columns (1fr auto 1fr, 150px tall) */}
        <header className="h-[150px] shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-[24px]">
          {/* Left: Court & Format */}
          <div className="flex flex-col justify-center items-start gap-[4px] min-w-0">
            <span className="font-display font-bold text-[44px] leading-[48px] text-[#F5F8FF] tracking-tight">
              Court {courtNumber}
            </span>
            <span className="font-display font-semibold text-[30px] leading-[34px] text-[#A9B9D3]">
              {formatLabel}
            </span>
          </div>

          {/* Center: Match Countdown */}
          <div className="flex flex-col justify-center items-center">
            <span
              className="font-display font-extrabold text-[116px] leading-[102px] text-[#F5F8FF] tracking-[-0.02em] tabular-nums"
              style={{ fontFeatureSettings: '"tnum" 1' }}
            >
              {timerText}
            </span>
            <span className="font-sans font-bold text-[28px] leading-[34px] text-[#A9B9D3] mt-[2px]">
              {timerSublabel}
            </span>
          </div>

          {/* Right: PikolScore Wordmark */}
          <div className="flex flex-col justify-center items-end min-w-0">
            <span className="font-display font-bold text-[36px] leading-[42px] text-[#A9B9D3] text-right">
              PikolScore
            </span>
          </div>
        </header>

        {/* 2. Two Equal Cards by ROLE: LEFT = Serving, RIGHT = Receiving */}
        <main className="flex-1 min-h-0 mt-[20px] grid grid-cols-2 gap-[32px]">
          {/* LEFT CARD: SERVING */}
          <section
            ref={servingCardRef}
            aria-label={`${servingTeamLabel} serving`}
            className="rounded-[28px] bg-[#14284D] overflow-hidden flex flex-col"
          >
            {/* 12px top mint bar */}
            <div className="h-[12px] w-full bg-[#7FE3BE] shrink-0" />

            <div className="flex-1 min-h-0 flex flex-col pt-[28px] px-[40px] pb-[32px]">
              {/* Header (144px) */}
              <div className="h-[144px] shrink-0 flex items-start justify-between gap-[24px]">
                <div className="min-w-0 flex-1 flex flex-col gap-[12px]">
                  <div className="flex items-center gap-[12px] min-w-0">
                    <PickleballGlyph />
                    <span className="font-sans font-bold text-[30px] leading-[34px] text-[#7FE3BE] truncate">
                      {servingTeamLabel}
                    </span>
                  </div>

                  <div
                    ref={serverNameRef}
                    className="font-display font-bold text-[56px] leading-[62px] text-[#F5F8FF] whitespace-nowrap overflow-hidden text-ellipsis"
                  >
                    {serverName}
                  </div>
                </div>

                {/* Server Tile (128x126, hidden in Singles) */}
                {!isSingles && (
                  <div
                    className="w-[128px] h-[126px] rounded-[18px] bg-[#7FE3BE] shrink-0 flex flex-col items-center justify-center pt-[10px] pb-[8px]"
                    aria-label={`Server ${serverNumber}`}
                  >
                    <span className="font-sans font-bold text-[28px] leading-[32px] text-[#062A22]">
                      Server
                    </span>
                    <span
                      className="font-display font-extrabold text-[96px] leading-[84px] text-[#062A22] tabular-nums"
                      style={{ fontFeatureSettings: '"tnum" 1' }}
                    >
                      {serverNumber}
                    </span>
                  </div>
                )}
              </div>

              {/* Centered Score Numeral */}
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <SplitFlapScore
                  value={servingScore}
                  teamIndex={servingTeamIdx}
                  textColor="#F5F8FF"
                  cardBg="#14284D"
                />
              </div>
            </div>
          </section>

          {/* RIGHT CARD: RECEIVING (empty header so scores line up) */}
          <section
            ref={receivingCardRef}
            aria-label="Receiving team score"
            className="rounded-[28px] bg-[#0C182E] overflow-hidden flex flex-col"
          >
            {/* Spacer matching left card's 12px top bar */}
            <div className="h-[12px] w-full shrink-0" aria-hidden="true" />

            <div className="flex-1 min-h-0 flex flex-col pt-[28px] px-[40px] pb-[32px]">
              {/* Empty header matching left card's 144px header */}
              <div className="h-[144px] shrink-0" aria-hidden="true" />

              {/* Centered Score Numeral */}
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <SplitFlapScore
                  value={receivingScore}
                  teamIndex={receivingTeamIdx}
                  textColor="#D6E1F2"
                  cardBg="#0C182E"
                />
              </div>
            </div>
          </section>
        </main>

        {/* 3. Subtle Auto-Hiding TV Controls (shown only on pointer move / touch / focus) */}
        {(onToggleMute || onUnpairTv) && (
          <div
            className={`absolute top-[24px] right-[48px] z-40 flex items-center gap-[10px] rounded-full bg-[#14284D]/95 border border-[#7FE3BE]/35 py-[8px] pl-[18px] pr-[14px] transition-opacity duration-200 focus-within:opacity-100 focus-within:pointer-events-auto ${
              showHoverControls
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="font-sans text-[14px] font-bold tracking-[0.12em] uppercase text-[#7FE3BE] mr-[4px]">
              Court {courtNumber}
            </span>
            {onToggleMute && (
              <button
                type="button"
                onClick={onToggleMute}
                tabIndex={abandonCountdown !== null ? -1 : 0}
                className="flex items-center gap-[8px] rounded-full bg-[#0C182E] border border-[#7FE3BE]/25 hover:border-[#7FE3BE] px-[14px] py-[8px] text-[14px] font-semibold text-[#F5F8FF] transition-colors cursor-pointer"
                aria-label={muted ? 'Unmute TV sound' : 'Mute TV sound'}
              >
                {muted ? (
                  <VolumeX size={16} className="text-[#A9B9D3]" />
                ) : (
                  <Volume2 size={16} className="text-[#7FE3BE]" />
                )}
                <span>{muted ? 'Muted' : 'Sound'}</span>
              </button>
            )}
            {onUnpairTv && (
              <button
                type="button"
                onClick={onUnpairTv}
                tabIndex={abandonCountdown !== null ? -1 : 0}
                className="flex items-center gap-[8px] rounded-full bg-[#0C182E] border border-[#7FE3BE]/25 hover:border-[#7FE3BE] px-[14px] py-[8px] text-[14px] font-semibold text-[#A9B9D3] hover:text-[#F5F8FF] transition-colors cursor-pointer"
                title="Unpair TV or switch court"
                aria-label="Unpair TV or change court"
              >
                <Unlink size={16} />
                <span>Change Court</span>
              </button>
            )}
          </div>
        )}

        {/* 4. 5-Second Abandon Match Overlay (strict 8-color palette) */}
        {abandonCountdown !== null && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="tv-abandon-title"
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#060F1F]/80 backdrop-blur-[12px]"
          >
            <div className="w-[640px] rounded-[28px] bg-[#14284D] overflow-hidden flex flex-col">
              <div className="h-[12px] w-full bg-[#7FE3BE] shrink-0" />

              <div className="px-[44px] py-[40px] flex flex-col items-center text-center gap-[20px]">
                <div className="w-[72px] h-[72px] rounded-[18px] bg-[#0C182E] flex items-center justify-center text-[#7FE3BE]">
                  <AlertTriangle size={36} strokeWidth={2.2} aria-hidden="true" />
                </div>

                <span className="inline-flex items-center rounded-full bg-[#0C182E] px-[16px] py-[6px] font-sans text-[14px] font-bold uppercase tracking-[0.12em] text-[#7FE3BE]">
                  Court {courtNumber} · Match Terminated
                </span>

                <h2
                  id="tv-abandon-title"
                  className="font-display font-extrabold text-[56px] leading-[60px] text-[#F5F8FF] m-0"
                >
                  Abandon the match
                </h2>

                <p className="font-sans font-semibold text-[18px] leading-[26px] text-[#A9B9D3] m-0 max-w-[480px]">
                  The officiating umpire has abandoned this match. Returning to the
                  pairing screen in{' '}
                  <strong className="text-[#F5F8FF] font-bold">
                    {Math.max(0, abandonCountdown)} second
                    {abandonCountdown === 1 ? '' : 's'}
                  </strong>
                  ...
                </p>

                <div className="w-[420px] h-[10px] rounded-full bg-[#0C182E] overflow-hidden">
                  <div
                    className="h-full bg-[#7FE3BE] transition-all duration-1000 ease-linear rounded-full"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, (abandonCountdown / 5) * 100)
                      )}%`,
                    }}
                  />
                </div>

                <div className="flex items-center gap-[14px] pt-[6px]">
                  <div className="inline-flex items-center justify-center px-[22px] py-[12px] rounded-full bg-[#0C182E] text-[#7FE3BE] font-display text-[26px] leading-none font-extrabold tabular-nums">
                    {Math.max(0, abandonCountdown)}s
                  </div>
                  <button
                    type="button"
                    onClick={onUnpairTv}
                    className="px-[28px] py-[14px] rounded-[14px] bg-[#7FE3BE] hover:opacity-90 text-[#062A22] font-sans text-[18px] font-bold border-0 transition-opacity cursor-pointer"
                  >
                    Return to Pairing Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
