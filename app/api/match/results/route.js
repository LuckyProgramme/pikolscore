import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  buildMatchResultPayload,
  dispatchMatchWebhook,
} from '@/lib/match-results';
import { getAssignedUmpireId, getCourtNumber } from '../lobby/route';

const supabaseAdmin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      )
    : null;

async function authorizeRequest(request, { allowWebhookSecret = false } = {}) {
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKeyHeader = (
    request.headers.get('x-api-key') ||
    request.headers.get('x-webhook-secret') ||
    ''
  ).trim();

  const configuredSecret = (process.env.MATCH_WEBHOOK_SECRET || '').trim();

  if (allowWebhookSecret && configuredSecret) {
    if (bearerToken === configuredSecret || apiKeyHeader === configuredSecret) {
      return { authorized: true, mode: 'webhook_secret', user: null };
    }
  }

  if (!bearerToken || !supabaseAdmin) {
    return { authorized: false, mode: null, user: null };
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(bearerToken);

  if (error || !user) {
    return { authorized: false, mode: null, user: null };
  }

  return { authorized: true, mode: 'supabase_user', user };
}

/**
 * GET /api/match/results
 * Query parameters:
 * - sessionId (optional): UUID of a specific match session
 * - courtNumber (optional): Filter completed matches by court (1-4)
 * - limit (optional): Number of completed matches to return (default 10, max 50)
 */
export async function GET(request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Supabase admin client is not configured' },
        { status: 500 }
      );
    }

    const auth = await authorizeRequest(request, { allowWebhookSecret: true });
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Unauthorized: valid Bearer token or X-API-Key required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const courtNumberParam = searchParams.get('courtNumber');
    const limitParam = Math.min(
      50,
      Math.max(1, Number(searchParams.get('limit')) || 10)
    );

    if (sessionId) {
      const { data: session, error: sessErr } = await supabaseAdmin
        .from('match_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessErr || !session) {
        return NextResponse.json(
          { error: sessErr?.message || 'Match session not found' },
          { status: 404 }
        );
      }

      if (session.player_names?.confirmedResult) {
        return NextResponse.json({
          success: true,
          result: session.player_names.confirmedResult,
        });
      }

      const { data: events } = await supabaseAdmin
        .from('match_events')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .order('sequence', { ascending: true });

      const result = buildMatchResultPayload({
        session,
        events: events || [],
        confirmedAt: session.completed_at || session.updated_at,
      });

      return NextResponse.json({
        success: true,
        result,
      });
    }

    let query = supabaseAdmin
      .from('match_sessions')
      .select('*')
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(limitParam);

    const { data: sessions, error: listErr } = await query;
    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    const targetCourt = courtNumberParam ? Number(courtNumberParam) : null;
    const filteredSessions = (sessions || []).filter((s) =>
      targetCourt ? getCourtNumber(s) === targetCourt : true
    );

    const sessionIds = filteredSessions.map((s) => s.id);
    let eventsBySession = {};

    if (sessionIds.length > 0) {
      const { data: allEvents } = await supabaseAdmin
        .from('match_events')
        .select('*')
        .in('session_id', sessionIds)
        .eq('status', 'active')
        .order('sequence', { ascending: true });

      (allEvents || []).forEach((ev) => {
        if (!eventsBySession[ev.session_id]) {
          eventsBySession[ev.session_id] = [];
        }
        eventsBySession[ev.session_id].push(ev);
      });
    }

    const results = filteredSessions.map((s) => {
      if (s.player_names?.confirmedResult) {
        return s.player_names.confirmedResult;
      }
      return buildMatchResultPayload({
        session: s,
        events: eventsBySession[s.id] || [],
        confirmedAt: s.completed_at || s.updated_at,
      });
    });

    return NextResponse.json({
      success: true,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error('[API GET /api/match/results] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/match/results
 * Finalizes/confirms a concluded match, persists the final result & logs,
 * closes the court session, and dispatches the outbound webhook to the external app.
 */
export async function POST(request) {
  try {
    const auth = await authorizeRequest(request, { allowWebhookSecret: false });
    if (!auth.authorized || !auth.user) {
      return NextResponse.json(
        { error: 'Unauthorized: valid umpire session required' },
        { status: 401 }
      );
    }

    const user = auth.user;
    const body = await request.json();
    const { sessionId, courtNumber, clientSnapshot } = body || {};

    let session = null;
    let events = [];

    if (supabaseAdmin && sessionId) {
      const { data: foundSession } = await supabaseAdmin
        .from('match_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      session = foundSession || null;

      if (session) {
        const assignedUmpireId = getAssignedUmpireId(session);
        if (
          assignedUmpireId &&
          assignedUmpireId !== user.id &&
          session.umpire_id !== user.id
        ) {
          return NextResponse.json(
            { error: 'Only the officiating umpire can confirm this match' },
            { status: 403 }
          );
        }

        const { data: dbEvents } = await supabaseAdmin
          .from('match_events')
          .select('*')
          .eq('session_id', sessionId)
          .eq('status', 'active')
          .order('sequence', { ascending: true });

        events = dbEvents || [];
      }
    }

    const nowIso = new Date().toISOString();
    const resultPayload = buildMatchResultPayload({
      session,
      events,
      clientSnapshot: {
        ...(clientSnapshot || {}),
        sessionId: sessionId || clientSnapshot?.sessionId || null,
        courtNumber:
          courtNumber ||
          getCourtNumber(session) ||
          clientSnapshot?.courtNumber ||
          null,
        umpireId:
          getAssignedUmpireId(session) ||
          clientSnapshot?.umpireId ||
          user.id,
      },
      confirmedAt: nowIso,
    });

    // Dispatch outbound webhook to external app (if MATCH_WEBHOOK_URL is configured)
    const webhookStatus = await dispatchMatchWebhook(resultPayload);

    // Persist confirmed result & close match session in Supabase
    if (supabaseAdmin && session) {
      const resolvedCourtNumber =
        getCourtNumber(session) || Number(courtNumber) || 1;
      const updatedPNames = {
        ...(session.player_names || {}),
        courtNumber: resolvedCourtNumber,
        tvClosedReason: 'completed',
        tvClosedAt: nowIso,
        pairedTvIds: [],
        confirmedAt: nowIso,
        webhookDelivery: webhookStatus,
        confirmedResult: resultPayload,
      };

      // Step 1: Emit update while still in_progress so anon TV clients receive realtime close notice
      if (session.status === 'in_progress') {
        await supabaseAdmin
          .from('match_sessions')
          .update({
            player_names: updatedPNames,
            version: (session.version || 0) + 1,
            updated_at: nowIso,
          })
          .eq('id', session.id);
      }

      // Step 2: Mark session as completed with final scores and winner
      await supabaseAdmin
        .from('match_sessions')
        .update({
          status: 'completed',
          score_team0: resultPayload.finalScore.team0,
          score_team1: resultPayload.finalScore.team1,
          winner_team:
            resultPayload.winner !== null
              ? resultPayload.winner.teamIndex
              : null,
          player_names: updatedPNames,
          completed_at: session.completed_at || nowIso,
          timer_status:
            session.timer_status === 'running'
              ? 'paused'
              : session.timer_status,
          version: (session.version || 0) + 2,
          updated_at: nowIso,
        })
        .eq('id', session.id);
    }

    return NextResponse.json({
      success: true,
      result: resultPayload,
      webhook: webhookStatus,
    });
  } catch (err) {
    console.error('[API POST /api/match/results] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
