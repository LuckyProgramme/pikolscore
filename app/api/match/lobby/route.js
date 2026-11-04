import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export function getCourtNumber(row) {
  return Number(row?.court_number || row?.player_names?.courtNumber) || null;
}

export function getAssignedUmpireId(row) {
  if (row?.player_names && 'umpireId' in row.player_names) {
    return row.player_names.umpireId || null;
  }
  return row?.umpire_id || null;
}

/**
 * Helper to retrieve or create the active in_progress session for a court (1..4)
 * or find by sessionId. Stores courtNumber & umpireId inside player_names JSONB
 * so it works regardless of whether the optional court_number column migration is applied.
 */
async function getOrCreateSession({ sessionId, courtNumber, callerUserId }) {
  if (sessionId) {
    const { data, error } = await supabaseAdmin
      .from('match_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (data) return { session: data, error: null };
    if (!courtNumber) return { session: null, error };
  }

  const cNum = Number(courtNumber);
  if (!cNum || cNum < 1 || cNum > 4) {
    return { session: null, error: new Error('Valid courtNumber (1-4) or sessionId required') };
  }

  // Find existing in_progress session on this court
  const { data: activeRows, error: findErr } = await supabaseAdmin
    .from('match_sessions')
    .select('*')
    .eq('status', 'in_progress')
    .order('updated_at', { ascending: false });

  if (findErr) {
    return { session: null, error: findErr };
  }

  const existing = (activeRows || []).find((r) => getCourtNumber(r) === cNum);
  if (existing) {
    return { session: existing, error: null };
  }

  // Create new active lobby session for this court
  const newSessionId = crypto.randomUUID();
  const initialState = {
    format: 'doubles',
    scores: [0, 0],
    servingTeam: 0,
    serverNumber: 2,
    serverCourt: 'right',
    courtPositions: [
      { left: '', right: '' },
      { left: '', right: '' },
    ],
    gameOver: false,
    winner: null,
  };

  const initialPlayerNames = {
    courtNumber: cNum,
    umpireId: null,
    umpireName: null,
    lobbyLocked: false,
    team0: ['', ''],
    team1: ['', ''],
    slots: {
      team0: [null, null],
      team1: [null, null],
    },
  };

  // umpire_id column has a NOT NULL constraint in the base schema;
  // player_names.umpireId tracks whether an umpire has actually joined the lobby.
  const newRow = {
    id: newSessionId,
    umpire_id: callerUserId,
    format: 'doubles',
    target_score: 11,
    win_by: 2,
    status: 'in_progress',
    team_keys: ['omega', 'alpha'],
    team_names: ['Team A', 'Team B'],
    team_palettes: ['omega', 'alpha'],
    player_names: initialPlayerNames,
    initial_state: initialState,
    court_positions: initialState.courtPositions,
    score_team0: 0,
    score_team1: 0,
    serving_team: 0,
    server_number: 2,
    server_court: 'right',
    timer_status: 'idle',
    timer_duration_ms: 1800000,
    timer_remaining_ms: 1800000,
    timer_updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('match_sessions')
    .insert(newRow)
    .select('*')
    .maybeSingle();

  if (insertErr) {
    const { data: retryRows } = await supabaseAdmin
      .from('match_sessions')
      .select('*')
      .eq('status', 'in_progress')
      .order('updated_at', { ascending: false });
    const retry = (retryRows || []).find((r) => getCourtNumber(r) === cNum);
    if (retry) return { session: retry, error: null };
    return { session: null, error: insertErr };
  }

  return { session: inserted, error: null };
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: missing token' }, { status: 401 });
    }

    const {
      data: { user },
      error: userErr,
    } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 401 });
    }

    const body = await request.json();
    const { action, sessionId, courtNumber } = body;

    const { session, error: sessErr } = await getOrCreateSession({
      sessionId,
      courtNumber,
      callerUserId: user.id,
    });
    if (sessErr || !session) {
      return NextResponse.json(
        { error: sessErr?.message || 'Match session not found for court' },
        { status: 404 }
      );
    }

    const currentSessionId = session.id;
    const assignedUmpireId = getAssignedUmpireId(session);
    const isUmpire = assignedUmpireId === user.id;
    const resolvedCourtNumber = getCourtNumber(session) || Number(courtNumber) || 1;
    const format = session.format || 'doubles';
    const playerNames = {
      ...(session.player_names || {}),
      courtNumber: resolvedCourtNumber,
    };
    const slots = playerNames.slots || {
      team0: format === 'doubles' ? [null, null] : [null],
      team1: format === 'doubles' ? [null, null] : [null],
    };

    // -------------------------------------------------------------
    // ACTION: join_umpire
    // Umpire assigns themselves to a court's open lobby
    // -------------------------------------------------------------
    if (action === 'join_umpire') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.role !== 'referee') {
        return NextResponse.json(
          { error: 'Only registered umpires can officiate courts' },
          { status: 403 }
        );
      }

      // Check if umpire is already assigned to ANY other in_progress session
      const { data: activeSessions } = await supabaseAdmin
        .from('match_sessions')
        .select('id, umpire_id, player_names')
        .eq('status', 'in_progress')
        .neq('id', currentSessionId);

      const existingAssignment = (activeSessions || []).find(
        (r) => getAssignedUmpireId(r) === user.id && getCourtNumber(r)
      );

      if (existingAssignment) {
        const cNum = getCourtNumber(existingAssignment);
        const cText = cNum ? `Court ${cNum}` : 'another court';
        return NextResponse.json(
          {
            error: `You are already assigned as umpire on ${cText}. Please finish or remove yourself from that court first.`,
          },
          { status: 409 }
        );
      }

      // Ensure target court lobby is not locked and has no active other umpire
      if (playerNames.lobbyLocked) {
        return NextResponse.json(
          { error: 'Cannot join: match is already in progress on this court' },
          { status: 400 }
        );
      }

      if (assignedUmpireId && assignedUmpireId !== user.id) {
        return NextResponse.json(
          { error: 'Another umpire is already assigned to this court' },
          { status: 409 }
        );
      }

      const umpireDisplayName =
        profile?.full_name?.trim() ||
        user.user_metadata?.full_name?.trim() ||
        user.user_metadata?.name?.trim() ||
        user.email?.split('@')[0] ||
        'Official Umpire';

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        umpireId: user.id,
        umpireName: umpireDisplayName,
      };

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          umpire_id: user.id,
          player_names: updatedPNames,
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION: leave_umpire
    // Umpire removes themselves from a court's lobby before match start
    // -------------------------------------------------------------
    if (action === 'leave_umpire') {
      if (!isUmpire) {
        return NextResponse.json({ error: 'You are not assigned to this court' }, { status: 403 });
      }

      if (playerNames.lobbyLocked) {
        return NextResponse.json(
          { error: 'Cannot leave court while match is in progress. Use Abandon Match instead.' },
          { status: 400 }
        );
      }

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        umpireId: null,
        umpireName: null,
      };

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          player_names: updatedPNames,
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION: claim_slot
    // Player joins, switches, or leaves a slot
    // -------------------------------------------------------------
    if (action === 'claim_slot') {
      if (playerNames.lobbyLocked) {
        return NextResponse.json({ error: 'Lobby is already locked' }, { status: 400 });
      }

      const { team, slotIndex } = body; // team: 0 | 1 | null, slotIndex: 0 | 1 | null

      // Check if user is locked in an already-started match on another court
      const { data: allActive } = await supabaseAdmin
        .from('match_sessions')
        .select('id, player_names, version')
        .eq('status', 'in_progress');

      if (Array.isArray(allActive)) {
        for (const sRow of allActive) {
          if (sRow.id !== currentSessionId && sRow.player_names?.lobbyLocked) {
            const rowSlots = sRow.player_names?.slots || {};
            const isPlaying =
              rowSlots.team0?.some((sl) => sl?.userId === user.id) ||
              rowSlots.team1?.some((sl) => sl?.userId === user.id);
            if (isPlaying) {
              const otherCourt = getCourtNumber(sRow);
              return NextResponse.json(
                {
                  error: `You are currently in an active match on Court ${otherCourt || ''}. You cannot join another court until it finishes.`,
                },
                { status: 409 }
              );
            }
          }
        }

        // Vacate caller from any other court's open lobby
        for (const sRow of allActive) {
          if (sRow.id !== currentSessionId && !sRow.player_names?.lobbyLocked) {
            const rSlots = sRow.player_names?.slots;
            let dirty = false;
            if (rSlots) {
              ['team0', 'team1'].forEach((tKey) => {
                if (Array.isArray(rSlots[tKey])) {
                  rSlots[tKey] = rSlots[tKey].map((sl) => {
                    if (sl && sl.userId === user.id) {
                      dirty = true;
                      return null;
                    }
                    return sl;
                  });
                }
              });
            }
            if (dirty) {
              const cleanT0 = [
                rSlots.team0?.[0]?.name || '',
                rSlots.team0?.[1]?.name || '',
              ];
              const cleanT1 = [
                rSlots.team1?.[0]?.name || '',
                rSlots.team1?.[1]?.name || '',
              ];
              await supabaseAdmin
                .from('match_sessions')
                .update({
                  player_names: {
                    ...sRow.player_names,
                    team0: cleanT0,
                    team1: cleanT1,
                    slots: rSlots,
                  },
                  version: (sRow.version || 0) + 1,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', sRow.id);
            }
          }
        }
      }

      // Get player display name
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      const playerName =
        profile?.full_name?.trim() ||
        user.user_metadata?.full_name?.trim() ||
        user.user_metadata?.name?.trim() ||
        user.email?.split('@')[0] ||
        'Player';

      // 1. Vacate any existing slot held by this user in this court
      ['team0', 'team1'].forEach((tKey) => {
        if (Array.isArray(slots[tKey])) {
          slots[tKey] = slots[tKey].map((slot) => {
            if (slot && slot.userId === user.id) return null;
            return slot;
          });
        }
      });

      // 2. If target team and slot are provided, claim it
      if (team !== null && team !== undefined && slotIndex !== null && slotIndex !== undefined) {
        const tKey = team === 0 ? 'team0' : 'team1';
        if (!Array.isArray(slots[tKey])) {
          slots[tKey] = format === 'doubles' ? [null, null] : [null];
        }

        const existingTarget = slots[tKey][slotIndex];
        if (existingTarget && existingTarget.userId && existingTarget.userId !== user.id) {
          return NextResponse.json(
            { error: 'This slot has already been claimed by another player' },
            { status: 409 }
          );
        }

        slots[tKey][slotIndex] = {
          userId: user.id,
          name: playerName,
        };
      }

      // Re-derive flat arrays
      const newTeam0 = [
        slots.team0?.[0]?.name || '',
        format === 'doubles' ? slots.team0?.[1]?.name || '' : '',
      ];
      const newTeam1 = [
        slots.team1?.[0]?.name || '',
        format === 'doubles' ? slots.team1?.[1]?.name || '' : '',
      ];

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        team0: newTeam0,
        team1: newTeam1,
        slots,
      };

      const updatedCourtPositions =
        format === 'singles'
          ? [
              { left: '', right: newTeam0[0] },
              { left: '', right: newTeam1[0] },
            ]
          : [
              { left: newTeam0[1], right: newTeam0[0] },
              { left: newTeam1[1], right: newTeam1[0] },
            ];

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          player_names: updatedPNames,
          court_positions: updatedCourtPositions,
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION: umpire_set_slot
    // Umpire assigns walk-up player name or removes a player
    // -------------------------------------------------------------
    if (action === 'umpire_set_slot') {
      if (!isUmpire) {
        return NextResponse.json(
          { error: 'Only the supervising umpire can manage slots' },
          { status: 403 }
        );
      }

      if (playerNames.lobbyLocked) {
        return NextResponse.json({ error: 'Lobby is already locked' }, { status: 400 });
      }

      const { team, slotIndex, walkupName } = body;
      const tKey = team === 0 ? 'team0' : 'team1';
      if (!Array.isArray(slots[tKey])) {
        slots[tKey] = format === 'doubles' ? [null, null] : [null];
      }

      const cleanName = typeof walkupName === 'string' ? walkupName.trim() : '';
      if (!cleanName) {
        slots[tKey][slotIndex] = null;
      } else {
        slots[tKey][slotIndex] = {
          userId: null,
          name: cleanName,
        };
      }

      const newTeam0 = [
        slots.team0?.[0]?.name || '',
        format === 'doubles' ? slots.team0?.[1]?.name || '' : '',
      ];
      const newTeam1 = [
        slots.team1?.[0]?.name || '',
        format === 'doubles' ? slots.team1?.[1]?.name || '' : '',
      ];

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        team0: newTeam0,
        team1: newTeam1,
        slots,
      };

      const updatedCourtPositions =
        format === 'singles'
          ? [
              { left: '', right: newTeam0[0] },
              { left: '', right: newTeam1[0] },
            ]
          : [
              { left: newTeam0[1], right: newTeam0[0] },
              { left: newTeam1[1], right: newTeam1[0] },
            ];

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          player_names: updatedPNames,
          court_positions: updatedCourtPositions,
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION: start_match
    // Umpire locks lobby and starts the match countdown
    // -------------------------------------------------------------
    if (action === 'start_match') {
      if (!isUmpire) {
        return NextResponse.json(
          { error: 'Only the supervising umpire can start the match' },
          { status: 403 }
        );
      }

      const p0 = (playerNames.team0?.[0] || '').trim();
      const p1 = (playerNames.team1?.[0] || '').trim();

      if (format === 'singles') {
        if (!p0 || !p1) {
          return NextResponse.json(
            { error: 'Both player slots must be filled before starting a singles match' },
            { status: 400 }
          );
        }
      } else {
        const p2 = (playerNames.team0?.[1] || '').trim();
        const p3 = (playerNames.team1?.[1] || '').trim();
        if (!p0 || !p1 || !p2 || !p3) {
          return NextResponse.json(
            { error: 'All 4 player slots must be filled before starting a doubles match' },
            { status: 400 }
          );
        }
      }

      const servingTeam = typeof body.servingTeam === 'number' ? body.servingTeam : 0;
      const teamNames =
        format === 'singles'
          ? [p0, p1]
          : body.teamNames || session.team_names || ['Team A', 'Team B'];

      const durationMs = session.timer_duration_ms || 1800000;
      const timerEndsAt = new Date(Date.now() + durationMs).toISOString();

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        umpireId: user.id,
        lobbyLocked: true,
      };

      const updatedInitialState = {
        ...(session.initial_state || {}),
        servingTeam,
        serverNumber: format === 'doubles' ? 2 : 1,
        teamNames,
      };

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          umpire_id: user.id,
          player_names: updatedPNames,
          team_names: teamNames,
          serving_team: servingTeam,
          server_number: format === 'doubles' ? 2 : 1,
          timer_status: 'running',
          timer_ends_at: timerEndsAt,
          timer_updated_at: new Date().toISOString(),
          initial_state: updatedInitialState,
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION: pair_tv
    // Links a Courtside TV (tvId) to this court's active session
    // -------------------------------------------------------------
    if (action === 'pair_tv') {
      const { tvId } = body;
      if (!tvId || typeof tvId !== 'string') {
        return NextResponse.json({ error: 'Valid tvId is required' }, { status: 400 });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.role !== 'referee') {
        return NextResponse.json(
          { error: 'Only registered umpires can pair a courtside TV screen' },
          { status: 403 }
        );
      }

      // Remove tvId from any other active court session
      const { data: allActive } = await supabaseAdmin
        .from('match_sessions')
        .select('id, umpire_id, player_names, version')
        .eq('status', 'in_progress')
        .neq('id', currentSessionId);

      if (Array.isArray(allActive)) {
        for (const sRow of allActive) {
          const existingTvIds = sRow.player_names?.pairedTvIds;
          if (Array.isArray(existingTvIds) && existingTvIds.includes(tvId)) {
            const filtered = existingTvIds.filter((id) => id !== tvId);
            await supabaseAdmin
              .from('match_sessions')
              .update({
                player_names: {
                  ...sRow.player_names,
                  pairedTvIds: filtered,
                },
                version: (sRow.version || 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq('id', sRow.id);
          }
        }
      }

      // Check if caller is already assigned to another court
      const otherCourtAssignment = (allActive || []).find(
        (r) => getAssignedUmpireId(r) === user.id && getCourtNumber(r)
      );

      let nextUmpireId = assignedUmpireId;
      let nextUmpireName = playerNames.umpireName || null;

      // If this court has no umpire yet and the caller isn't on another court, assign them!
      if (!assignedUmpireId && !otherCourtAssignment && !playerNames.lobbyLocked) {
        nextUmpireId = user.id;
        nextUmpireName =
          profile?.full_name?.trim() ||
          user.user_metadata?.full_name?.trim() ||
          user.user_metadata?.name?.trim() ||
          user.email?.split('@')[0] ||
          'Official Umpire';
      }

      const prevTvIds = Array.isArray(playerNames.pairedTvIds)
        ? playerNames.pairedTvIds
        : [];
      const nextTvIds = prevTvIds.includes(tvId) ? prevTvIds : [...prevTvIds, tvId];

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        umpireId: nextUmpireId,
        umpireName: nextUmpireName,
        pairedTvIds: nextTvIds,
      };

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          umpire_id: nextUmpireId || session.umpire_id,
          player_names: updatedPNames,
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        courtNumber: resolvedCourtNumber,
        session: updatedSession,
      });
    }

    // -------------------------------------------------------------
    // ACTION: close_match
    // Marks the court session as 'abandoned' or 'completed' and notifies
    // any paired Courtside TV screens BEFORE RLS hides 'abandoned' rows
    // -------------------------------------------------------------
    if (action === 'close_match') {
      if (!isUmpire && session.umpire_id !== user.id) {
        return NextResponse.json(
          { error: 'Only the officiating umpire can close this match' },
          { status: 403 }
        );
      }

      const closeReason =
        body.reason === 'abandoned' ? 'abandoned' : 'completed';
      const nowIso = new Date().toISOString();

      const updatedPNames = {
        ...playerNames,
        courtNumber: resolvedCourtNumber,
        tvClosedReason: closeReason,
        tvClosedAt: nowIso,
        pairedTvIds: [],
      };

      // Step 1: Update player_names while status is STILL 'in_progress' so
      // anon TV clients receive the postgres_changes UPDATE event via RLS
      await supabaseAdmin
        .from('match_sessions')
        .update({
          player_names: updatedPNames,
          version: (session.version || 0) + 1,
          updated_at: nowIso,
        })
        .eq('id', currentSessionId);

      // Step 2: Transition session status to 'abandoned' or 'completed'
      const finalStatus =
        closeReason === 'abandoned'
          ? 'abandoned'
          : session.winner_team !== null || closeReason === 'completed'
          ? 'completed'
          : closeReason;

      const { data: closedSession, error: closeErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          status: finalStatus,
          player_names: updatedPNames,
          completed_at: nowIso,
          timer_status:
            session.timer_status === 'running' ? 'paused' : session.timer_status,
          version: (session.version || 0) + 2,
          updated_at: nowIso,
        })
        .eq('id', currentSessionId)
        .select('*')
        .single();

      if (closeErr) {
        return NextResponse.json({ error: closeErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        courtNumber: resolvedCourtNumber,
        reason: closeReason,
        session: closedSession,
      });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (err) {
    console.error('[API /api/match/lobby] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
