import { formatMmSs } from './match-results.js';

const PLACEHOLDER_PLAYER_RE = /^Player\s+[1-4]$/i;

/**
 * Strips whitespace and treats default placeholder names ("Player 1".."Player 4")
 * as empty so fallback resolution can pick real names.
 */
export function cleanPlayerName(val) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim().replace(/\s+/g, ' ');
  if (!trimmed || PLACEHOLDER_PLAYER_RE.test(trimmed)) return '';
  return trimmed;
}

/**
 * Normalizes match format from a match_sessions row ('doubles' | 'singles').
 */
export function normalizeMatchFormat(session) {
  const raw = String(
    session?.format || session?.initial_state?.format || 'doubles'
  )
    .trim()
    .toLowerCase();
  return raw === 'singles' ? 'singles' : 'doubles';
}

/**
 * Collects cleaned slot names [slot0, slot1] for a team from player_names.slots
 * or the flat player_names.team0 / team1 arrays.
 */
export function getTeamSlotNames(session, teamIndex) {
  const pNames = session?.player_names || {};
  const tKey = teamIndex === 0 ? 'team0' : 'team1';
  const slotsArr = Array.isArray(pNames?.slots?.[tKey])
    ? pNames.slots[tKey].map((s) => cleanPlayerName(s?.name))
    : [];
  const flatArr = Array.isArray(pNames?.[tKey])
    ? pNames[tKey].map((n) => cleanPlayerName(n))
    : [];

  return [
    slotsArr[0] || flatArr[0] || '',
    slotsArr[1] || flatArr[1] || '',
  ];
}

/**
 * Resolves ONLY the current server's full name.
 * For doubles, prioritizes court_positions[servingTeam][server_court] (real
 * pickleball court rotation) and falls back to slot order when positions are unset.
 * For singles, uses the active player on the serving team regardless of parity.
 */
export function resolveCurrentServerName(session, servingTeamIdx = 0) {
  const format = normalizeMatchFormat(session);
  const [slot0, slot1] = getTeamSlotNames(session, servingTeamIdx);
  const teamPositions = Array.isArray(session?.court_positions)
    ? session.court_positions[servingTeamIdx]
    : null;

  if (format === 'singles') {
    const posRight = cleanPlayerName(teamPositions?.right);
    const posLeft = cleanPlayerName(teamPositions?.left);
    return (
      posRight ||
      posLeft ||
      slot0 ||
      slot1 ||
      (servingTeamIdx === 0 ? 'Team A' : 'Team B')
    );
  }

  const serverCourt = session?.server_court === 'left' ? 'left' : 'right';
  const fromCourtPos = cleanPlayerName(teamPositions?.[serverCourt]);
  if (fromCourtPos) return fromCourtPos;

  const serverNum = Number(session?.server_number) === 2 ? 2 : 1;
  const fallback = serverNum === 2 ? slot1 || slot0 : slot0 || slot1;
  return fallback || `Server ${serverNum}`;
}

/**
 * Resolves the mint team label ("Team A" / "Team B" or customized team name).
 * In singles, lobby/route.js stores [player0, player1] in team_names; fall back
 * to "Team A" / "Team B" whenever the team name duplicates a player's name.
 */
export function resolveServingTeamLabel(
  session,
  servingTeamIdx = 0,
  format = 'doubles',
  serverName = ''
) {
  const defaultLabel = servingTeamIdx === 0 ? 'Team A' : 'Team B';
  const rawName = String(session?.team_names?.[servingTeamIdx] || '').trim();
  if (!rawName) return defaultLabel;

  if (format === 'singles') {
    const [slot0, slot1] = getTeamSlotNames(session, servingTeamIdx);
    const lowerRaw = rawName.toLowerCase();
    const matchesPlayer =
      (serverName && lowerRaw === serverName.toLowerCase()) ||
      (slot0 && lowerRaw === slot0.toLowerCase()) ||
      (slot1 && lowerRaw === slot1.toLowerCase());
    if (matchesPlayer) {
      return defaultLabel;
    }
  }

  return rawName;
}

/**
 * Computes formatted countdown text and expiration state for a match_sessions row.
 */
export function resolveTimerDisplay(session, nowMs = Date.now()) {
  const timerStatus = session?.timer_status || 'idle';
  let timerText = '30:00';
  let isTimerExpired = timerStatus === 'expired';

  if (timerStatus === 'running' && session?.timer_ends_at) {
    const remMs = Math.max(
      0,
      new Date(session.timer_ends_at).getTime() - nowMs
    );
    timerText = formatMmSs(Math.ceil(remMs / 1000));
    if (remMs === 0) isTimerExpired = true;
  } else if (typeof session?.timer_remaining_ms === 'number') {
    timerText = formatMmSs(Math.ceil(session.timer_remaining_ms / 1000));
    if (session.timer_remaining_ms <= 0 && timerStatus !== 'idle') {
      isTimerExpired = true;
    }
  }

  return { timerText, isTimerExpired, timerStatus };
}

/**
 * Resolves the center clock sublabel strictly in the neutral copy set:
 * "Time up" | "Final" | "Paused" | "Time left".
 */
export function resolveTimerSublabel({
  timerStatus,
  isTimerExpired,
  isGameOver,
}) {
  if (isTimerExpired) return 'Time up';
  if (isGameOver) return 'Final';
  if (timerStatus === 'paused') return 'Paused';
  return 'Time left';
}

/**
 * Maps a match_sessions row + paired court number into ProjectedScoreboard props.
 */
export function buildProjectedViewProps(session, pairedCourt, nowMs = Date.now()) {
  const format = normalizeMatchFormat(session);
  const isSingles = format === 'singles';
  const formatLabel = isSingles ? 'Singles' : 'Doubles';
  const courtNumber =
    Number(
      pairedCourt || session?.court_number || session?.player_names?.courtNumber
    ) || 1;

  const servingTeamIdx = session?.serving_team === 1 ? 1 : 0;
  const receivingTeamIdx = 1 - servingTeamIdx;
  const serverNumber = isSingles
    ? 1
    : Number(session?.server_number) === 2
    ? 2
    : 1;

  const scoreTeam0 = Math.max(0, Number(session?.score_team0 ?? 0));
  const scoreTeam1 = Math.max(0, Number(session?.score_team1 ?? 0));
  const servingScore = servingTeamIdx === 0 ? scoreTeam0 : scoreTeam1;
  const receivingScore = receivingTeamIdx === 0 ? scoreTeam0 : scoreTeam1;

  const serverName = resolveCurrentServerName(session, servingTeamIdx);
  const servingTeamLabel = resolveServingTeamLabel(
    session,
    servingTeamIdx,
    format,
    serverName
  );

  const { timerText, isTimerExpired, timerStatus } = resolveTimerDisplay(
    session,
    nowMs
  );

  const targetScore = session?.target_score || 11;
  const winBy = session?.win_by || 2;
  const team0Won = scoreTeam0 >= targetScore && scoreTeam0 - scoreTeam1 >= winBy;
  const team1Won = scoreTeam1 >= targetScore && scoreTeam1 - scoreTeam0 >= winBy;
  const hasWinnerTeam =
    session?.winner_team !== null && session?.winner_team !== undefined;
  const isScoreWin = Boolean(
    team0Won || team1Won || hasWinnerTeam || session?.initial_state?.gameOver
  );

  const timerSublabel = resolveTimerSublabel({
    timerStatus,
    isTimerExpired,
    isGameOver: isScoreWin,
  });

  return {
    courtNumber,
    format,
    formatLabel,
    isSingles,
    timerText,
    timerSublabel,
    servingTeamIdx,
    receivingTeamIdx,
    servingTeamLabel,
    serverName,
    serverNumber,
    servingScore,
    receivingScore,
  };
}

/**
 * Determines whether a match_sessions row has been explicitly closed by the
 * officiating umpire ('abandoned' | 'completed') or should keep the TV paired (null).
 * Bare status === 'completed' without explicit confirmation metadata
 * (tvClosedReason or confirmedAt) returns null so the TV never unpairs
 * prematurely when a winning point is scored before the umpire confirms/undoes.
 */
export function resolveTvSessionCloseAction(sessionRow) {
  if (!sessionRow) return null;
  const closedReason = sessionRow?.player_names?.tvClosedReason;
  if (closedReason === 'abandoned' || sessionRow.status === 'abandoned') {
    return 'abandoned';
  }
  if (
    closedReason === 'completed' ||
    Boolean(sessionRow?.player_names?.confirmedAt)
  ) {
    return 'completed';
  }
  return null;
}

/**
 * Deterministic dev preview fixtures (?fixture=live | live-singles | live-paused | live-abandon | live-long).
 */
export const PROJECTED_FIXTURES = {
  live: {
    courtNumber: 2,
    format: 'doubles',
    formatLabel: 'Doubles',
    isSingles: false,
    timerText: '24:18',
    timerSublabel: 'Time left',
    servingTeamIdx: 0,
    receivingTeamIdx: 1,
    servingTeamLabel: 'Team A',
    serverName: 'Miguel Reyes',
    serverNumber: 1,
    servingScore: 11,
    receivingScore: 8,
    abandonCountdown: null,
  },
  'live-singles': {
    courtNumber: 2,
    format: 'singles',
    formatLabel: 'Singles',
    isSingles: true,
    timerText: '18:45',
    timerSublabel: 'Time left',
    servingTeamIdx: 1,
    receivingTeamIdx: 0,
    servingTeamLabel: 'Team B',
    serverName: 'Jun Bautista',
    serverNumber: 1,
    servingScore: 7,
    receivingScore: 10,
    abandonCountdown: null,
  },
  'live-paused': {
    courtNumber: 2,
    format: 'doubles',
    formatLabel: 'Doubles',
    isSingles: false,
    timerText: '14:02',
    timerSublabel: 'Paused',
    servingTeamIdx: 1,
    receivingTeamIdx: 0,
    servingTeamLabel: 'Team B',
    serverName: 'Rico Lim',
    serverNumber: 2,
    servingScore: 9,
    receivingScore: 9,
    abandonCountdown: null,
  },
  'live-abandon': {
    courtNumber: 2,
    format: 'doubles',
    formatLabel: 'Doubles',
    isSingles: false,
    timerText: '24:18',
    timerSublabel: 'Paused',
    servingTeamIdx: 0,
    receivingTeamIdx: 1,
    servingTeamLabel: 'Team A',
    serverName: 'Miguel Reyes',
    serverNumber: 1,
    servingScore: 11,
    receivingScore: 8,
    abandonCountdown: 4,
  },
  'live-long': {
    courtNumber: 2,
    format: 'doubles',
    formatLabel: 'Doubles',
    isSingles: false,
    timerText: '09:05',
    timerSublabel: 'Time left',
    servingTeamIdx: 0,
    receivingTeamIdx: 1,
    servingTeamLabel: 'Team A',
    serverName: 'Maria Clara De Los Santos-Villanueva',
    serverNumber: 2,
    servingScore: 9,
    receivingScore: 10,
    abandonCountdown: null,
  },
  'live-wide': {
    courtNumber: 1,
    format: 'doubles',
    formatLabel: 'Doubles',
    isSingles: false,
    timerText: '28:38',
    timerSublabel: 'Paused',
    servingTeamIdx: 0,
    receivingTeamIdx: 1,
    servingTeamLabel: 'Team A',
    serverName: 'Miguel Reyes',
    serverNumber: 2,
    servingScore: 88,
    receivingScore: 10,
    abandonCountdown: null,
  },
};
