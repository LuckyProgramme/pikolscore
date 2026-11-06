'use client';

export function ControlBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  formattedTime,
  timerLabel,
  timerStatus = 'idle',
  onToggleTimer,
  isGuest = false,
}) {
  const isRunning = timerStatus === 'running';

  const handleUndo = () => {
    if (!canUndo || isGuest) return;
    onUndo?.();
  };

  const handleRedo = () => {
    if (!canRedo || isGuest) return;
    onRedo?.();
  };

  return (
    <div className="relative w-full flex-none">
      <div className="ps-bar w-full">
        <button
          type="button"
          disabled={!canUndo || isGuest}
          aria-disabled={canUndo && !isGuest ? 'false' : 'true'}
          onClick={handleUndo}
          className="ps-bar-btn flex-1 min-h-[76px] text-lg font-bold text-deep-green enabled:bg-teal/10 enabled:hover:bg-teal/15 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 14l-4-4 4-4" />
            <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
          </svg>
          <span>Undo</span>
        </button>

        <button
          type="button"
          disabled={isGuest}
          onClick={onToggleTimer}
          className="ps-bar-btn ps-timer-btn flex-[1.6] min-h-[76px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal"
        >
          <span className="ps-tm flex items-center justify-center gap-2.5">
            <i
              aria-hidden="true"
              className={`size-2.5 rounded-full bg-teal shrink-0 ${
                isRunning ? 'motion-safe:animate-pulse' : 'opacity-60'
              }`}
            />
            <span>{formattedTime}</span>
          </span>
          <span className="ps-tl">{timerLabel}</span>
        </button>

        <button
          type="button"
          disabled={!canRedo || isGuest}
          aria-disabled={canRedo && !isGuest ? 'false' : 'true'}
          onClick={handleRedo}
          className="ps-bar-btn flex-1 min-h-[76px] text-lg font-bold text-deep-green enabled:hover:bg-pale-sage disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal"
        >
          <span>Redo</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 14l4-4-4-4" />
            <path d="M19 10H8a4 4 0 1 0 0 8h1" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ControlBar;
