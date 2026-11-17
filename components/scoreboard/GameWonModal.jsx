'use client';

import { useEffect, useRef } from 'react';
import { Trophy, Check, Loader2, Undo2, X } from 'lucide-react';
import { CONTENT } from '../../config/content';

export function GameWonModal({
  open,
  winnerName,
  scores = [0, 0],
  teamNames = ['Team Omega', 'Team Alpha'],
  courtNumber = null,
  onConfirm,
  onUndo,
  onClose,
  canUndo = true,
  isConfirming = false,
  isDraw = false,
  isTimeExpired = false,
  title,
  detail,
  inert: inertProp,
}) {
  const overlayRef = useRef(null);
  const primaryBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const previouslyFocused = document.activeElement;
    const modifiedElements = [];

    let current = overlay;
    while (
      current &&
      current.parentElement &&
      current.parentElement !== document.documentElement
    ) {
      const parent = current.parentElement;
      for (const child of parent.children) {
        if (child !== current && !child.contains(overlay)) {
          if (!child.hasAttribute('inert')) {
            child.setAttribute('inert', '');
            try {
              child.inert = true;
            } catch {
              // Ignore if not supported directly on property
            }
            modifiedElements.push(child);
          }
        }
      }
      current = parent;
    }

    const focusTimer = setTimeout(() => {
      if (primaryBtnRef.current) {
        primaryBtnRef.current.focus();
      }
    }, 40);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);

      modifiedElements.forEach((el) => {
        el.removeAttribute('inert');
        try {
          el.inert = false;
        } catch {
          // Ignore
        }
      });

      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try {
          previouslyFocused.focus();
        } catch {
          // Ignore
        }
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const resolvedWinner = winnerName || teamNames[0] || 'Team';
  const displayTitle =
    title ??
    (isDraw
      ? `MATCH TIED: ${scores[0]} – ${scores[1]}`
      : `${resolvedWinner} WINS!`);

  const displayDetail =
    detail ??
    (isDraw
      ? 'Time expired · Match concluded in a draw'
      : isTimeExpired
      ? `Final Score: ${scores[0]} – ${scores[1]} (Time Expired)`
      : CONTENT.gameWonModal.finalScoreLabel(scores));

  const team0Leading = Number(scores[0]) > Number(scores[1]);
  const team1Leading = Number(scores[1]) > Number(scores[0]);

  return (
    <div
      ref={overlayRef}
      className="ps-modal-overlay"
      role="presentation"
      inert={Boolean(inertProp)}
    >
      <div className="ps-scrim" inert aria-hidden="true" />
      <div
        className="ps-victory-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="victory-modal-title"
      >
        <button
          type="button"
          className="ps-modal-close-btn"
          disabled={isConfirming}
          onClick={() => !isConfirming && onClose?.()}
          aria-label="Dismiss and review scoreboard"
          title="Review scoreboard"
        >
          <X size={16} aria-hidden="true" />
        </button>

        <div className="ps-victory-trophy-wrap">
          <Trophy className="ps-victory-trophy" size={32} strokeWidth={2.2} />
        </div>

        <span className="dv-overline mb-2">
          MATCH COMPLETE{courtNumber ? ` · COURT ${courtNumber}` : ''}
        </span>

        <h2 id="victory-modal-title" className="ps-victory-title">
          {displayTitle}
        </h2>

        <div className="ps-victory-scoreboard">
          <div className="ps-victory-team-box">
            <span
              className="ps-victory-team-name"
              style={team0Leading ? { color: '#00E5B8' } : undefined}
            >
              {teamNames[0]}
            </span>
            <span
              className="ps-victory-team-score"
              style={team0Leading ? { color: '#00E5B8' } : { color: '#B0C4D8' }}
            >
              {String(scores[0] ?? 0).padStart(2, '0')}
            </span>
          </div>
          <div className="ps-victory-score-divider">–</div>
          <div className="ps-victory-team-box">
            <span
              className="ps-victory-team-name"
              style={team1Leading ? { color: '#00E5B8' } : undefined}
            >
              {teamNames[1]}
            </span>
            <span
              className="ps-victory-team-score"
              style={team1Leading ? { color: '#00E5B8' } : { color: '#B0C4D8' }}
            >
              {String(scores[1] ?? 0).padStart(2, '0')}
            </span>
          </div>
        </div>

        <p className="ps-victory-detail">{displayDetail}</p>

        <div className="ps-victory-actions flex flex-col gap-2.5 w-full">
          <button
            ref={primaryBtnRef}
            type="button"
            disabled={isConfirming}
            className="ps-victory-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onConfirm}
          >
            {isConfirming ? (
              <>
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                <span>{CONTENT.gameWonModal.confirmingButton || 'Confirming...'}</span>
              </>
            ) : (
              <>
                <Check size={17} aria-hidden="true" />
                <span>{CONTENT.gameWonModal.confirmButton || 'Confirm'}</span>
              </>
            )}
          </button>

          {canUndo && onUndo && !isConfirming && (
            <button
              type="button"
              className="ps-victory-btn-secondary"
              onClick={onUndo}
            >
              <Undo2 size={16} aria-hidden="true" />
              <span>{CONTENT.gameWonModal.undoButton}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default GameWonModal;
