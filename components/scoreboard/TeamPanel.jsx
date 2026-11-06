'use client';

import { useRef, useEffect, useLayoutEffect } from 'react';
import FlipDigit from './FlipDigit';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function TeamPanel({
  teamKey,
  teamName,
  score,
  isServing,
  serverNumber = 1,
  players = null,
  format = 'doubles',
  isMatchOver = false,
  isWinner = false,
  isLoser = false,
  onPoint,
  onFault,
}) {
  const panelRef = useRef(null);
  const effectiveServing = isMatchOver ? Boolean(isWinner) : Boolean(isServing);
  const prevServingRef = useRef(effectiveServing);
  const beforeRectRef = useRef(null);

  // Capture bounding rect during render right before DOM updates data-serving/order
  if (panelRef.current && prevServingRef.current !== effectiveServing) {
    beforeRectRef.current = panelRef.current.getBoundingClientRect();
  }

  useIsoLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    if (prevServingRef.current !== effectiveServing) {
      prevServingRef.current = effectiveServing;
      const before = beforeRectRef.current;
      beforeRectRef.current = null;

      const calm =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (before && !calm && typeof el.animate === 'function') {
        const after = el.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (dx !== 0 || dy !== 0) {
          el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 350, easing: 'ease-out' }
          );
        }
      }
    }
  }, [effectiveServing]);

  const numericScore = Number(score ?? 0);
  const paddedScore = String(numericScore).padStart(2, '0');
  const tens = paddedScore[0];
  const units = paddedScore[1];

  const roleText = isMatchOver
    ? isWinner
      ? 'WINNER'
      : isLoser
      ? 'FINAL'
      : 'DRAW'
    : isServing
    ? 'SERVING'
    : 'RECEIVING';

  const hintText = isMatchOver
    ? isWinner
      ? 'Match winner'
      : 'Match complete'
    : isServing
    ? 'Tap: point won'
    : 'Tap: fault';

  const ariaLabel = isMatchOver
    ? `${teamName}, ${roleText.toLowerCase()}, final score ${numericScore}. Match complete.`
    : `${teamName}, ${roleText.toLowerCase()}, score ${numericScore}${
        isServing && format !== 'singles' ? `, server ${serverNumber}` : ''
      }. ${isServing ? 'Tap to score a point.' : 'Tap to call a fault.'}`;

  // Preserve slot 1 (index 0) and slot 2 (index 1) positions so the name changes with serverNumber (1 -> slot 0, 2 -> slot 1)
  const cleanName = (val) => {
    if (typeof val !== 'string') return '';
    const trimmed = val.trim();
    if (!trimmed || /^Player\s+[1-4]$/i.test(trimmed)) return '';
    return trimmed;
  };

  const slot0 = Array.isArray(players) ? cleanName(players[0]) : '';
  const slot1 = Array.isArray(players) ? cleanName(players[1]) : '';

  const activeServerIdx =
    isServing && !isMatchOver ? (Number(serverNumber || 1) === 2 ? 1 : 0) : -1;

  const showActiveServerTile = Boolean(isServing && !isMatchOver);
  const displayedServerNum = format === 'singles' ? '1' : String(serverNumber ?? 1);

  const activeServerName = showActiveServerTile
    ? format === 'singles'
      ? slot0 || slot1
      : activeServerIdx === 1
      ? slot1 || slot0
      : slot0 || slot1
    : '';

  const serverPillRef = useRef(null);
  const prevServerKeyRef = useRef(undefined);
  const currentServerKey = showActiveServerTile
    ? `${serverNumber}:${activeServerName}`
    : '';

  useIsoLayoutEffect(() => {
    const pill = serverPillRef.current;
    if (!pill || !activeServerName) {
      prevServerKeyRef.current = currentServerKey;
      return;
    }

    const oldKey = prevServerKeyRef.current;
    if (oldKey === currentServerKey) return;
    prevServerKeyRef.current = currentServerKey;

    if (typeof pill.getAnimations === 'function') {
      pill.getAnimations().forEach((a) => a.cancel());
    }

    const calm =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!oldKey || calm || typeof pill.animate !== 'function') {
      return;
    }

    pill.animate(
      [
        { transform: 'perspective(400px) rotateX(-85deg)', opacity: 0.25 },
        { transform: 'perspective(400px) rotateX(0deg)', opacity: 1 },
      ],
      { duration: 320, easing: ' cubic-bezier(0.16, 1, 0.3, 1)' }
    );
  }, [currentServerKey, activeServerName]);

  const handleActivate = () => {
    if (isMatchOver) return;
    if (isServing) {
      onPoint?.();
    } else {
      onFault?.();
    }
  };

  return (
    <button
      ref={panelRef}
      type="button"
      disabled={isMatchOver}
      className={`ps-team ${isMatchOver && isLoser ? 'opacity-55' : ''}`}
      data-team={teamKey}
      data-serving={effectiveServing ? 'true' : 'false'}
      aria-label={ariaLabel}
      onClick={handleActivate}
    >
      <div className="ps-chip">
        {/* Left: Team Name */}
        <div className="flex min-w-0 items-center text-left">
          <span
            className={`truncate text-lg sm:text-2xl font-extrabold uppercase tracking-wide leading-none ${
              effectiveServing ? 'text-[#FEFEFB]' : 'text-[#203F39]'
            }`}
          >
            {teamName}
          </span>
        </div>

        {/* Center: Single Active Server Name Pill (Serving card only, 3D flips when server changes) */}
        {showActiveServerTile && activeServerName && (
          <div className="mx-auto flex items-center justify-center min-w-0 px-2">
            <span
              ref={serverPillRef}
              className="inline-block max-w-[140px] sm:max-w-[180px] truncate rounded-full border border-[#FEFEFB]/80 bg-[#FEECD6] px-4 py-1.5 text-center text-sm sm:text-base font-extrabold normal-case tracking-normal text-[#084B46] shadow-sm"
            >
              {activeServerName}
            </span>
          </div>
        )}

        {/* Right: Contrasting SERVER label + Server Number Tile */}
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5 shrink-0">
          <span
            className={`text-[11px] sm:text-xs font-extrabold uppercase tracking-widest ${
              effectiveServing ? 'text-[#FEECD6]' : 'text-[#203F39]'
            }`}
          >
            Server
          </span>
          <span
            className={`grid size-13 sm:size-14 place-items-center rounded-xl text-2xl sm:text-3xl font-black leading-none transition-colors ${
              showActiveServerTile
                ? 'bg-[#FEECD6] text-[#084B46] border-2 border-[#FEFEFB] shadow-md'
                : effectiveServing
                ? 'border-2 border-dashed border-[#FEECD6]/60 text-[#FEECD6] opacity-80'
                : 'bg-[#FAF9F5] text-[#203F39] border-2 border-dashed border-[#203F39]/45'
            }`}
          >
            {showActiveServerTile ? displayedServerNum : '–'}
          </span>
        </div>
      </div>

      <div className="ps-pair">
        <FlipDigit value={tens} dimmed={numericScore < 10} />
        <FlipDigit value={units} />
      </div>

      <div className="ps-hint">{hintText}</div>
    </button>
  );
}

export default TeamPanel;
