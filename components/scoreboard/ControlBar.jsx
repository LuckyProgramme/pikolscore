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
    <div className="ps-control-slot">
      {/* Pickleball Net Line & Net Posts (visible in Tablet Portrait Court View) */}
      <div className="ps-net-line" aria-hidden="true">
        <span className="ps-net-post" />
        <span className="ps-net-cord" />
        <span className="ps-net-post" />
      </div>

      <div className="ps-bar">
        <button
          type="button"
          disabled={!canUndo || isGuest}
          aria-disabled={canUndo && !isGuest ? 'false' : 'true'}
          onClick={handleUndo}
          className="ps-bar-btn ps-undo-btn focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal"
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
          data-running={isRunning ? 'true' : 'false'}
          className="ps-bar-btn ps-timer-btn focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal"
        >
          <span className="ps-tm">{formattedTime}</span>
          <span className="ps-tl">{timerLabel}</span>
        </button>

        <button
          type="button"
          disabled={!canRedo || isGuest}
          aria-disabled={canRedo && !isGuest ? 'false' : 'true'}
          onClick={handleRedo}
          className="ps-bar-btn ps-redo-btn focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal"
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
