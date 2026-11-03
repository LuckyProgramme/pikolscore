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
    const { action, sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'Valid sessionId is required' }, { status: 400 });
    }

    // Fetch match session
    const { data: session, error: sessErr } = await supabaseAdmin
      .from('match_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessErr || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const isUmpire = session.umpire_id === user.id;
    const format = session.format || 'doubles';
    const playerNames = session.player_names || {};
    const slots = playerNames.slots || {
      team0: format === 'doubles' ? [null, null] : [null],
      team1: format === 'doubles' ? [null, null] : [null],
    };

    // -------------------------------------------------------------
    // ACTION 1: claim_slot (Player joins, switches, or leaves a slot)
    // -------------------------------------------------------------
    if (action === 'claim_slot') {
      if (playerNames.lobbyLocked) {
        return NextResponse.json({ error: 'Lobby is already locked' }, { status: 400 });
      }

      const { team, slotIndex } = body; // team: 0 | 1 | null, slotIndex: 0 | 1 | null

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

      // 1. Vacate any existing slot held by this user
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
        .eq('id', sessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION 2: umpire_set_slot (Umpire assigns walk-up or clears)
    // -------------------------------------------------------------
    if (action === 'umpire_set_slot') {
      if (!isUmpire) {
        return NextResponse.json({ error: 'Only the supervising umpire can edit slots' }, { status: 403 });
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
        .eq('id', sessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    // -------------------------------------------------------------
    // ACTION 3: start_match (Umpire locks lobby and starts 30:00 timer)
    // -------------------------------------------------------------
    if (action === 'start_match') {
      if (!isUmpire) {
        return NextResponse.json({ error: 'Only the supervising umpire can start the match' }, { status: 403 });
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
        lobbyLocked: true,
      };

      const { data: updatedSession, error: updateErr } = await supabaseAdmin
        .from('match_sessions')
        .update({
          player_names: updatedPNames,
          team_names: teamNames,
          serving_team: servingTeam,
          server_number: format === 'doubles' ? 2 : 1,
          timer_status: 'running',
          timer_ends_at: timerEndsAt,
          timer_updated_at: new Date().toISOString(),
          version: (session.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, session: updatedSession });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (err) {
    console.error('[API /api/match/lobby] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
