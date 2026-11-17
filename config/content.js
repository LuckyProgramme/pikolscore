export const CONTENT = {
  // Footer content (references ConsoleFooter.jsx)
  footer: {
    prefix: 'Powered by',
    credit: 'Wren Labs',
    meta: 'Android recorder · 0.1.0',
  },

  // Header content (ConsoleHeader.jsx)
  header: {
    brandTitle: 'PIKOLSCORE',
    resetTooltip: 'Reset Match',
  },

  // Flap display board (FlapDisplay.jsx)
  flapDisplay: {
    label: 'FLAP DISPLAY',
    symbol: '↻',
  },

  // Team labels (TeamScoreColumn.jsx / page.jsx)
  teams: {
    servingLabel: 'SERVING TEAM',
    receivingLabel: 'RECEIVING TEAM',
  },

  // Action rally buttons (ActionControls.jsx)
  actions: {
    undoTitle: 'Undo last rally (Z)',
    undoLabel: 'UNDO',
    pointWonLabel: 'POINT WON',
    faultLabel: 'FAULT',
    startLabel: 'START',
    pauseLabel: 'PAUSE',
    resumeLabel: 'RESUME',
  },

  // Game won celebration dialog (GameWonModal.jsx)
  gameWonModal: {
    title: (winnerName) => `🏆 ${winnerName} WINS!`,
    finalScoreLabel: (scores) =>
      `Final Score: ${scores?.[0]} - ${scores?.[1]} (Official 11-point win by 2)`,
    confirmButton: 'Confirm',
    confirmingButton: 'Confirming...',
    undoButton: 'Undo Winning Point',
    reviewButton: 'Review Scoreboard',
  },

  // Interactive prompts & confirms (app/page.jsx)
  dialogs: {
    resetConfirm: 'Start a new match?',
    editTeamPrompt: 'Edit serving team name:',
  },

  // Page level hints & loading state (app/page.jsx)
  hints: {
    landscapePrompt: '🔄 Rotate your phone to Landscape for optimal courtside console experience',
    loading: 'Loading PikolScore...',
  },
};

export { AUTH_CONTENT } from './content/auth';
export default CONTENT;
