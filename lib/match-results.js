/**
 * Formats elapsed seconds into MM:SS.
 */
export function formatMmSs(totalSeconds = 0) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Normalizes team roster slots and player names for a given team index (0 or 1).
 */
function buildTeamRoster(teamIndex, format, playerNames) {
  const tKey = teamIndex === 0 ? 'team0' : 'team1';
  const rawNames = Array.isArray(playerNames?.[tKey]) ? playerNames[tKey] : [];
  const rawSlots = Array.isArray(playerNames?.slots?.[tKey])
    ? playerNames.slots[tKey]
    : [];
  const maxSlots = format === 'singles' ? 1 : 2;
  const players = [];

  for (let i = 0; i < maxSlots; i++) {
    const slot = rawSlots[i] || null;
    const fallbackName =
      typeof rawNames[i] === 'string' && rawNames[i].trim()
        ? rawNames[i].trim()
        : `Player ${teamIndex * 2 + i + 1}`;
    const name =
      typeof slot?.name === 'string' && slot.name.trim()
        ? slot.name.trim()
        : fallbackName;

    players.push({
      slotIndex: i,
      userId: slot?.userId || null,
      name,
    });
  }

  return players;
}

/**
 * Normalizes chronological match logs from either Supabase `match_events` rows
 * or client engine `log` entries.
 */
export function buildNormalizedMatchLogs(events = [], clientLogs = [], legacyLogs = []) {
  const normalized = [];

  if (Array.isArray(legacyLogs) && legacyLogs.length > 0) {
    legacyLogs.forEach((entry, idx) => {
      const elapsedSeconds = Math.max(0, Math.floor(Number(entry.elapsed ?? entry.e ?? 0)));
      normalized.push({
        step: normalized.length + 1,
        sequence: idx + 1,
        source: 'legacy',
        eventType: entry.eventType || 'legacy',
        elapsedSeconds,
        formattedTime: formatMmSs(elapsedSeconds),
        call: entry.call ?? entry.sc ?? '',
        message: entry.message ?? entry.m ?? '',
        stateAfter: null,
        createdAt: entry.createdAt || null,
      });
    });
  }

  const activeDbEvents = Array.isArray(events)
    ? events.filter((ev) => !ev.status || ev.status === 'active')
    : [];

  // Use whichever source has more complete rally history (e.g., if client outbox was still flushing)
  const useClientLogs =
    Array.isArray(clientLogs) && clientLogs.length > activeDbEvents.length;

  if (useClientLogs) {
    clientLogs.forEach((entry, idx) => {
      const elapsedSeconds = Math.max(0, Math.floor(Number(entry.elapsed ?? entry.e ?? 0)));
      normalized.push({
        step: normalized.length + 1,
        sequence: idx + 1,
        source: 'engine',
        eventType: entry.eventType || ( idx === clientLogs.length - 1 ? 'gameWon' : 'rally' ),
        elapsedSeconds,
        formattedTime: formatMmSs(elapsedSeconds),
        call: entry.call ?? entry.sc ?? '',
        message: entry.message ?? entry.m ?? '',
        stateAfter: entry.stateAfter || null,
        createdAt: entry.createdAt || null,
      });
    });
  } else {
    activeDbEvents.forEach((ev, idx) => {
      const elapsedSeconds = Math.max(
        0,
        Math.floor(Number(ev.elapsed_seconds ?? ev.elapsed ?? 0))
      );
      normalized.push({
        step: normalized.length + 1,
        sequence: Number(ev.sequence) || idx + 1,
        source: 'database',
        eventType: ev.event_type || ev.eventType || 'rally',
        elapsedSeconds,
        formattedTime: formatMmSs(elapsedSeconds),
        call: ev.call_string ?? ev.call ?? '',
        message: ev.message ?? '',
        stateAfter: ev.state_after ?? null,
        createdAt: ev.created_at || null,
      });
    });
  }

  return normalized;
}

/**
 * Builds the canonical match conclusion payload containing winning team details
 * and chronological match logs.
 */
export function buildMatchResultPayload({
  session = null,
  events = [],
  clientSnapshot = null,
  confirmedAt = null,
} = {}) {
  const nowIso = confirmedAt || new Date().toISOString();
  const format =
    clientSnapshot?.format ||
    session?.format ||
    session?.initial_state?.format ||
    'doubles';

  const teamKeys =
    (Array.isArray(clientSnapshot?.teamKeys) && clientSnapshot.teamKeys.length === 2
      ? clientSnapshot.teamKeys
      : Array.isArray(session?.team_keys) && session.team_keys.length === 2
      ? session.team_keys
      : ['omega', 'alpha']);

  const teamNames =
    (Array.isArray(clientSnapshot?.teamNames) && clientSnapshot.teamNames.length === 2
      ? clientSnapshot.teamNames
      : Array.isArray(session?.team_names) && session.team_names.length === 2
      ? session.team_names
      : ['Team A', 'Team B']);

  const playerNames = {
    ...(session?.player_names || {}),
    ...(clientSnapshot?.playerNames || {}),
    slots:
      clientSnapshot?.playerNames?.slots ||
      session?.player_names?.slots ||
      undefined,
  };

  const score0 = Number(
    clientSnapshot?.scores?.[0] ?? session?.score_team0 ?? 0
  );
  const score1 = Number(
    clientSnapshot?.scores?.[1] ?? session?.score_team1 ?? 0
  );
  const scores = [score0, score1];

  let winnerIndex = null;
  if (
    clientSnapshot?.winner === 0 ||
    clientSnapshot?.winner === 1
  ) {
    winnerIndex = clientSnapshot.winner;
  } else if (
    session?.winner_team === 0 ||
    session?.winner_team === 1
  ) {
    winnerIndex = Number(session.winner_team);
  } else if (score0 > score1) {
    winnerIndex = 0;
  } else if (score1 > score0) {
    winnerIndex = 1;
  }

  const isDraw = Boolean(
    winnerIndex === null &&
      (clientSnapshot?.isDraw || score0 === score1)
  );
  const isTimeExpired = Boolean(
    clientSnapshot?.isTimeExpired ||
      session?.timer_status === 'expired'
  );

  const team0Players = buildTeamRoster(0, format, playerNames);
  const team1Players = buildTeamRoster(1, format, playerNames);

  const teams = [
    {
      teamIndex: 0,
      teamKey: teamKeys[0],
      teamName: teamNames[0],
      score: score0,
      isWinner: winnerIndex === 0,
      players: team0Players,
    },
    {
      teamIndex: 1,
      teamKey: teamKeys[1],
      teamName: teamNames[1],
      score: score1,
      isWinner: winnerIndex === 1,
      players: team1Players,
    },
  ];

  const winningTeam =
    winnerIndex !== null ? teams[winnerIndex] : null;

  const summaryMessage = winningTeam
    ? `${winningTeam.teamName} wins (${scores[winnerIndex]}–${scores[1 - winnerIndex]})`
    : `Match tied (${score0}–${score1})`;

  const matchLogs = buildNormalizedMatchLogs(
    events,
    clientSnapshot?.log || [],
    clientSnapshot?.legacyLog || session?.legacy_log || []
  );

  const courtNumber =
    Number(
      clientSnapshot?.courtNumber ||
        session?.court_number ||
        session?.player_names?.courtNumber
    ) || null;

  const umpireId =
    session?.player_names?.umpireId ||
    session?.umpire_id ||
    clientSnapshot?.umpireId ||
    null;
  const umpireName =
    session?.player_names?.umpireName ||
    clientSnapshot?.umpireName ||
    null;

  const lastLogElapsed =
    matchLogs.length > 0
      ? matchLogs[matchLogs.length - 1].elapsedSeconds
      : 0;
  const elapsedSeconds = Math.max(
    0,
    Math.floor(Number(clientSnapshot?.elapsedSeconds ?? lastLogElapsed ?? 0))
  );

  return {
    event: 'match.concluded',
    sessionId: session?.id || clientSnapshot?.sessionId || null,
    courtNumber,
    format,
    status: 'completed',
    isConfirmed: true,
    isDraw,
    isTimeExpired,
    message: summaryMessage,
    finalScore: {
      team0: score0,
      team1: score1,
      display: `${score0}–${score1}`,
    },
    winner: winningTeam
      ? {
          teamIndex: winningTeam.teamIndex,
          teamKey: winningTeam.teamKey,
          teamName: winningTeam.teamName,
          score: winningTeam.score,
          opponentScore: scores[1 - winningTeam.teamIndex],
          players: winningTeam.players,
        }
      : null,
    teams,
    umpire: {
      id: umpireId,
      name: umpireName,
    },
    timestamps: {
      startedAt: session?.created_at || null,
      completedAt: session?.completed_at || nowIso,
      confirmedAt: nowIso,
      elapsedSeconds,
      formattedDuration: formatMmSs(elapsedSeconds),
    },
    matchLogs,
  };
}

/**
 * Dispatches the concluded match payload to an external application webhook URL
 * with automatic brief retry on transient failure.
 */
export async function dispatchMatchWebhook(
  payload,
  {
    webhookUrl = process.env.MATCH_WEBHOOK_URL,
    webhookSecret = process.env.MATCH_WEBHOOK_SECRET,
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
    maxRetries = 1,
  } = {}
) {
  const targetUrl = typeof webhookUrl === 'string' ? webhookUrl.trim() : '';
  if (!targetUrl) {
    return {
      configured: false,
      delivered: false,
      attempts: 0,
      status: null,
      error: null,
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      configured: true,
      delivered: false,
      attempts: 0,
      status: null,
      error: 'Fetch implementation unavailable',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-PikolScore-Event': 'match.concluded',
  };

  const cleanSecret =
    typeof webhookSecret === 'string' ? webhookSecret.trim() : '';
  if (cleanSecret) {
    headers.Authorization = `Bearer ${cleanSecret}`;
    headers['X-Webhook-Secret'] = cleanSecret;
  }

  let attempts = 0;
  let lastError = null;
  let lastStatus = null;

  while (attempts <= maxRetries) {
    attempts += 1;
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (timer) clearTimeout(timer);
      lastStatus = response.status;

      if (response.ok) {
        return {
          configured: true,
          delivered: true,
          attempts,
          status: response.status,
          error: null,
        };
      }

      lastError = `HTTP ${response.status}`;
      // Do not retry 4xx client errors (except 408/429)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        break;
      }
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastError = err?.message || 'Webhook request failed';
    }

    if (attempts <= maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return {
    configured: true,
    delivered: false,
    attempts,
    status: lastStatus,
    error: lastError,
  };
}
