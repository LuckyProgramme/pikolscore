import assert from 'node:assert/strict';
import { PickleballEngine } from './lib/engine.js';
import {
  cleanPlayerName,
  resolveCurrentServerName,
  resolveServingTeamLabel,
  resolveTimerSublabel,
  resolveTvSessionCloseAction,
  buildProjectedViewProps,
} from './lib/projected-screen.js';

console.log('--- Testing Projected Screen Helpers (lib/projected-screen.js) ---');

// 1. Placeholder name filtering
assert.equal(cleanPlayerName('  Miguel   Reyes '), 'Miguel Reyes', 'normalizes whitespace');
assert.equal(cleanPlayerName('Player 1'), '', 'ignores default Player 1 placeholder');
assert.equal(cleanPlayerName('player 4'), '', 'ignores lowercase placeholder');

// 2. Doubles rotation via engine -> court_positions + server_court
{
  const engine = new PickleballEngine({
    format: 'doubles',
    teamNames: ['Team A', 'Team B'],
    playerNames: {
      team0: ['Miguel Reyes', 'Paolo Dizon'],
      team1: ['Jun Bautista', 'Rico Lim'],
      slots: {
        team0: [
          { userId: 'u1', name: 'Miguel Reyes' },
          { userId: 'u2', name: 'Paolo Dizon' },
        ],
        team1: [
          { userId: 'u3', name: 'Jun Bautista' },
          { userId: 'u4', name: 'Rico Lim' },
        ],
      },
    },
  });

  const toRow = (overrides = {}) => {
    const st = engine.getState();
    return {
      court_number: 2,
      format: st.format,
      target_score: 11,
      win_by: 2,
      team_names: st.teamNames,
      player_names: st.playerNames,
      score_team0: st.scores[0],
      score_team1: st.scores[1],
      serving_team: st.servingTeam,
      server_number: st.serverNumber,
      server_court: st.serverCourt,
      court_positions: engine.courtPositions,
      timer_status: 'running',
      timer_ends_at: new Date(Date.now() + 1458000).toISOString(),
      ...overrides,
    };
  };

  // Start of match (0-0-2): Team A serves from right -> Miguel Reyes
  let props = buildProjectedViewProps(toRow(), 2);
  assert.equal(props.formatLabel, 'Doubles');
  assert.equal(props.isSingles, false);
  assert.equal(props.servingTeamLabel, 'Team A');
  assert.equal(props.serverName, 'Miguel Reyes');
  assert.equal(props.serverNumber, 2);

  // Team A scores 1 point (1-0-2): players swap sides and server moves to left -> still Miguel Reyes
  engine.pointWon(10);
  props = buildProjectedViewProps(toRow(), 2);
  assert.equal(props.servingScore, 1);
  assert.equal(props.receivingScore, 0);
  assert.equal(props.serverName, 'Miguel Reyes');

  // Fault at 1-0-2 -> side-out to Team B, Server 1 on right -> Jun Bautista
  engine.fault(20);
  props = buildProjectedViewProps(toRow(), 2);
  assert.equal(props.servingTeamIdx, 1);
  assert.equal(props.servingTeamLabel, 'Team B');
  assert.equal(props.serverNumber, 1);
  assert.equal(props.serverName, 'Jun Bautista');
  assert.equal(props.servingScore, 0);
  assert.equal(props.receivingScore, 1);

  // Team B scores 1 point -> still Jun Bautista, then faults -> Server 2 -> Rico Lim
  engine.pointWon(30);
  engine.fault(40);
  props = buildProjectedViewProps(toRow(), 2);
  assert.equal(props.servingTeamIdx, 1);
  assert.equal(props.serverNumber, 2);
  assert.equal(props.serverName, 'Rico Lim');
  assert.equal(props.servingScore, 1);
  assert.equal(props.receivingScore, 1);
}

// 3. Fallback when court_positions is empty
{
  const session = {
    format: 'doubles',
    serving_team: 0,
    server_number: 2,
    server_court: 'left',
    court_positions: null,
    team_names: ['Team A', 'Team B'],
    player_names: {
      team0: ['Miguel Reyes', 'Paolo Dizon'],
      team1: ['Jun Bautista', 'Rico Lim'],
    },
  };
  assert.equal(
    resolveCurrentServerName(session, 0),
    'Paolo Dizon',
    'falls back to slot 1 for server 2 when court_positions missing'
  );
}

// 4. Singles handling: duplicate team_names from lobby API and odd-score left server_court
{
  const singlesSession = {
    court_number: 3,
    format: 'singles',
    team_names: ['Miguel Reyes', 'Jun Bautista'],
    serving_team: 0,
    server_number: 1,
    server_court: 'left',
    score_team0: 3,
    score_team1: 5,
    court_positions: [
      { left: '', right: 'Miguel Reyes' },
      { left: '', right: 'Jun Bautista' },
    ],
    player_names: {
      team0: ['Miguel Reyes', ''],
      team1: ['Jun Bautista', ''],
    },
    timer_status: 'paused',
    timer_remaining_ms: 842000,
  };
  const props = buildProjectedViewProps(singlesSession, 3);
  assert.equal(props.formatLabel, 'Singles');
  assert.equal(props.isSingles, true);
  assert.equal(
    props.servingTeamLabel,
    'Team A',
    'replaces player-name team_names in singles with Team A'
  );
  assert.equal(
    props.serverName,
    'Miguel Reyes',
    'resolves singles server even on odd score when court_positions.left is empty'
  );
  assert.equal(props.timerText, '14:02');
  assert.equal(props.timerSublabel, 'Paused');

  // Customized singles team name is preserved if distinct from player name
  assert.equal(
    resolveServingTeamLabel(
      { ...singlesSession, team_names: ['Team Omega', 'Team Alpha'] },
      0,
      'singles',
      'Miguel Reyes'
    ),
    'Team Omega'
  );
}

// 5. Timer sublabels: Time up > Final > Paused > Time left
assert.equal(
  resolveTimerSublabel({ timerStatus: 'expired', isTimerExpired: true, isGameOver: true }),
  'Time up'
);
assert.equal(
  resolveTimerSublabel({ timerStatus: 'paused', isTimerExpired: false, isGameOver: true }),
  'Final'
);
assert.equal(
  resolveTimerSublabel({ timerStatus: 'paused', isTimerExpired: false, isGameOver: false }),
  'Paused'
);
assert.equal(
  resolveTimerSublabel({ timerStatus: 'running', isTimerExpired: false, isGameOver: false }),
  'Time left'
);

// 6. TV Session Close Action (only close on explicit confirmation or abandonment)
assert.equal(
  resolveTvSessionCloseAction({
    status: 'in_progress',
    winner_team: 0,
    player_names: { lobbyLocked: true },
  }),
  null,
  'keeps TV paired when match reaches gameOver/winner_team before confirmation'
);
assert.equal(
  resolveTvSessionCloseAction({
    status: 'completed',
    winner_team: 0,
    player_names: { lobbyLocked: true },
  }),
  null,
  'keeps TV paired if status=completed arrives without explicit confirmation metadata'
);
assert.equal(
  resolveTvSessionCloseAction({
    status: 'completed',
    winner_team: 0,
    player_names: { tvClosedReason: 'completed' },
  }),
  'completed',
  'triggers return to standby when tvClosedReason=completed is set'
);
assert.equal(
  resolveTvSessionCloseAction({
    status: 'completed',
    winner_team: 0,
    player_names: { confirmedAt: '2026-11-17T10:00:00.000Z' },
  }),
  'completed',
  'triggers return to standby when confirmedAt timestamp is set'
);
assert.equal(
  resolveTvSessionCloseAction({
    status: 'in_progress',
    player_names: { tvClosedReason: 'abandoned' },
  }),
  'abandoned',
  'triggers abandon flow when tvClosedReason=abandoned'
);
assert.equal(
  resolveTvSessionCloseAction({
    status: 'abandoned',
    player_names: {},
  }),
  'abandoned',
  'triggers abandon flow when status=abandoned'
);

console.log('--- All Projected Screen helper tests passed! ---');
