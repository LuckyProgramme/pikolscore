'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { outbox } from '@/lib/outbox';
import { sessionToEngine, headSessionToEngine, engineToRallyState } from '@/lib/hydrate';

const ACTIVE_SESSION_KEY = 'pikolscore_active_session_id';
const V3_STORAGE_KEY = 'pikolscore_v3';
const TIMER_STORAGE_KEY = 'pikolscore_timer_v2';

export function useMatchSync({ engineRef, timerRef, isGuest = false }) {
  const isEnabled = process.env.NEXT_PUBLIC_CLOUD_SYNC === 'true';

  const [sessionId, setSessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlSession = new URLSearchParams(window.location.search).get('session');
      return urlSession || (isGuest ? window.localStorage.getItem(ACTIVE_SESSION_KEY) : null) || null;
    }
    return null;
  });
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const [localVersion, setLocalVersion] = useState(0);
  const localVersionRef = useRef(0);
  localVersionRef.current = localVersion;

  const [syncStatus, setSyncStatus] = useState('synced');
  const [pendingCount, setPendingCount] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);
  const [legacyLog, setLegacyLog] = useState([]);
  const [serverSession, setServerSession] = useState(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [rehydrateVersion, setRehydrateVersion] = useState(0);

  // Setup outbox executor function
  useEffect(() => {
    outbox.setExecutor(async (item) => {
      const { op, args } = item;
      try {
        const { data, error } = await supabase.rpc(op, args);
        if (error) {
          if (op === 'fn_update_session_meta' && error.code === '42883') {
            const { data: updateData, error: updateErr } = await supabase
              .from('match_sessions')
              .update({
                team_names: args.p_team_names,
                team_palettes: args.p_team_palettes,
              })
              .eq('id', args.p_session_id)
              .select()
              .single();
            return { data: updateData, error: updateErr };
          }
          return { data: null, error };
        }
        if (data && data.id && data.id === sessionIdRef.current) {
          setServerSession(data);
        }
        return { data, error: null };
      } catch (networkErr) {
        return { data: null, error: networkErr };
      }
    });

    const unsubStatus = outbox.onStatusChange((status, count) => {
      setSyncStatus(status);
      setPendingCount(count);
    });

    return () => {
      unsubStatus();
    };
  }, []);

  // Helper to refetch session + events and rehydrate engine
  const refetchAndRehydrate = useCallback(
    async (knownSession = null, targetSessionId = null) => {
      const currentId =
        targetSessionId ||
        knownSession?.id ||
        sessionIdRef.current ||
        (typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('session') ||
            window.localStorage.getItem(ACTIVE_SESSION_KEY)
          : null);

      if (!currentId) return null;

      try {
        let session = knownSession;
        if (!session) {
          const { data, error } = await supabase
            .from('match_sessions')
            .select('*')
            .eq('id', currentId)
            .single();

          if (error || !data) {
            console.warn('[useMatchSync] Session not found:', error);
            return null;
          }
          session = data;
        }

        const { data: events, error: eErr } = await supabase
          .from('match_events')
          .select('*')
          .eq('session_id', currentId)
          .in('status', ['active', 'undone'])
          .order('sequence', { ascending: true });

        if (eErr) {
          console.warn('[useMatchSync] Failed to fetch events:', eErr);
          return null;
        }

        setServerSession(session);
        setLocalVersion(session.version || 0);
        localVersionRef.current = session.version || 0;
        if (Array.isArray(session.legacy_log)) {
          setLegacyLog(session.legacy_log);
        }

        if (engineRef?.current) {
          sessionToEngine(engineRef.current, session, events || []);
        }

        setRehydrateVersion((v) => v + 1);

        return { session, events };
      } catch (err) {
        console.error('[useMatchSync] Error during rehydration:', err);
        return null;
      }
    },
    [engineRef]
  );

  // Subscribe to outbox error events (conflict 40001 handling and recovery)
  useEffect(() => {
    const unsubError = outbox.onError(async ({ code, error, item }) => {
      console.warn(`[useMatchSync] Outbox error (${code}):`, error);
      if (code === '40001') {
        outbox.pause();

        const droppedCount = outbox.filterQueue(
          (q) => !['fn_record_rally', 'fn_undo_rally', 'fn_redo_rally'].includes(q.op)
        );

        await refetchAndRehydrate();
        outbox.resume();

        setToastMessage(
          `Score was updated on another device. ${droppedCount} pending taps were not applied.`
        );
      } else if (code === '42501') {
        // Forbidden: operation rejected by RLS or not umpire
        outbox.filterQueue((q) => q.id !== item.id);
        await refetchAndRehydrate();
        outbox.resume();
        setToastMessage('Action not permitted on this session.');
      } else if (code === 'P0001') {
        // Session closed — drop stale ops for that closed session without showing a false error toast
        const closedId = item?.args?.p_session_id;
        outbox.filterQueue(
          (q) => q.id !== item.id && (!closedId || q.args?.p_session_id !== closedId)
        );
        if (closedId && closedId === sessionIdRef.current) {
          await refetchAndRehydrate();
        }
        outbox.resume();
      } else if (code === 'P0002') {
        // Nothing to undo or redo
        outbox.filterQueue((q) => q.id !== item.id);
        await refetchAndRehydrate();
        outbox.resume();
      }
    });

    return () => {
      unsubError();
    };
  }, [refetchAndRehydrate]);

  // Section 8: One-Time Legacy Migration from localStorage
  const performLegacyMigration = useCallback(
    async (user) => {
      if (typeof window === 'undefined') return null;

      const rawV3 = window.localStorage.getItem(V3_STORAGE_KEY);
      const rawTimer = window.localStorage.getItem(TIMER_STORAGE_KEY);

      if (!rawV3) return null;

      try {
        const parsedV3 = JSON.parse(rawV3);
        const snapshot = parsedV3?.snapshot
          ? JSON.parse(parsedV3.snapshot)
          : parsedV3;

        if (!snapshot) return null;

        const parsedTimer = rawTimer ? JSON.parse(rawTimer) : null;
        const newSessionId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sess_${Date.now()}`;

        const format = snapshot.format || 'doubles';
        const teamKeys = snapshot.teamKeys || ['omega', 'alpha'];
        const teamNames = snapshot.teamNames || ['Team Omega', 'Team Alpha'];
        const teamPalettes = snapshot.teamPalettes || ['omega', 'alpha'];
        const playerNames = snapshot.playerNames || {
          team0: ['Player 1', 'Player 2'],
          team1: ['Player 3', 'Player 4'],
        };

        const initialState = {
          format,
          scores: [0, 0],
          servingTeam: 0,
          serverNumber: format === 'doubles' ? 2 : 1,
          serverCourt: 'right',
          courtPositions: snapshot.courtPositions || [
            { left: 'Player 2', right: 'Player 1' },
            { left: 'Player 4', right: 'Player 3' },
          ],
          gameOver: false,
          winner: null,
        };

        const legacyLogData = Array.isArray(snapshot.log) ? snapshot.log : [];

        // 1. Create Session
        const { error: sessErr } = await supabase.rpc('fn_create_session', {
          p_session_id: newSessionId,
          p_format: format,
          p_team_keys: teamKeys,
          p_team_names: teamNames,
          p_team_palettes: teamPalettes,
          p_player_names: playerNames,
          p_initial_state: initialState,
          p_timer_duration_ms: parsedTimer?.remainingMs || 1800000,
          p_legacy_log: legacyLogData,
          p_auto_start_timer: false,
        });

        if (sessErr) {
          console.error('[useMatchSync] Legacy migration createSession failed:', sessErr);
          return null;
        }

        // 2. Set Timer if existing
        if (parsedTimer?.status) {
          await supabase.rpc('fn_set_timer', {
            p_session_id: newSessionId,
            p_status: parsedTimer.status,
            p_remaining_ms: parsedTimer.remainingMs || 1800000,
            p_ends_at: parsedTimer.endsAt ? new Date(parsedTimer.endsAt).toISOString() : null,
            p_client_ts: new Date().toISOString(),
          });
        }

        // 3. Rename keys
        window.localStorage.setItem('pikolscore_v3_migrated', rawV3);
        window.localStorage.removeItem(V3_STORAGE_KEY);
        if (rawTimer) {
          window.localStorage.setItem('pikolscore_timer_v2_migrated', rawTimer);
          window.localStorage.removeItem(TIMER_STORAGE_KEY);
        }

        window.localStorage.setItem(ACTIVE_SESSION_KEY, newSessionId);
        setSessionId(newSessionId);
        return newSessionId;
      } catch (err) {
        console.error('[useMatchSync] Legacy migration warning:', err);
        return null;
      }
    },
    []
  );

  // Initialize Session on Mount with Auto-Discovery of In-Progress Sessions
  useEffect(() => {
    if (!isEnabled) {
      setIsLoadingSession(false);
      return;
    }

    let mounted = true;

    async function init() {
      setIsLoadingSession(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user || null;

      // 1. Check URL for explicit ?session=<id>
      let activeId =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('session')
          : null;
      let discoveredSession = null;

      // 2. Multi-device discovery ONLY for explicit ?demo=1 guest mode when no ?session is in URL
      const isDemoMode =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('demo') === '1';
      if (!activeId && isGuest && isDemoMode) {
        try {
          const { data: publicActive } = await supabase
            .from('match_sessions')
            .select('*')
            .eq('status', 'in_progress')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (publicActive?.id) {
            activeId = publicActive.id;
            discoveredSession = publicActive;
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(ACTIVE_SESSION_KEY, activeId);
            }
          }
        } catch (err) {
          console.warn('[useMatchSync] Could not auto-discover public session:', err);
        }
      }

      if (!mounted) return;

      if (activeId) {
        setSessionId(activeId);
        sessionIdRef.current = activeId;
        const res = await refetchAndRehydrate(discoveredSession, activeId);
        // If session could not be retrieved or is not accessible, clear activeId
        if (!res) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(ACTIVE_SESSION_KEY);
          }
          setSessionId(null);
          sessionIdRef.current = null;
        }
      } else {
        setSessionId(null);
        sessionIdRef.current = null;
      }

      setIsLoadingSession(false);
    }

    init();

    return () => {
      mounted = false;
    };
  }, [isEnabled, isGuest, performLegacyMigration, refetchAndRehydrate]);

  // Realtime Subscription on public.match_sessions
  useEffect(() => {
    if (!isEnabled || !sessionId) return;

    const channel = supabase
      .channel(`match_sessions_realtime_${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'match_sessions',
          filter: `id=eq.${sessionId}`,
        },
        async (payload) => {
          const newRow = payload.new;
          if (!newRow) return;

          // Always sync the serverSession state so timer and badges update immediately
          setServerSession(newRow);

          const newVersion = Number(newRow.version) || 0;
          if (newVersion > localVersionRef.current) {
            localVersionRef.current = newVersion;
            setLocalVersion(newVersion);

            if (isGuest) {
              // Spectators update directly from the row payload — zero extra queries!
              if (engineRef?.current) {
                headSessionToEngine(engineRef.current, newRow);
                setRehydrateVersion((v) => v + 1);
              }
            } else if (!outbox.hasPendingRallies()) {
              await refetchAndRehydrate(newRow);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isEnabled, isGuest, sessionId, refetchAndRehydrate]);

  // Create a brand new session in Supabase
  const createSession = useCallback(
    async (engine, timerDurationMs = 1800000, autoStartTimer = true) => {
      if (!isEnabled || !engine || isGuest) return null;

      const newId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `sess_${Date.now()}`;

      const format = engine.format || 'doubles';
      const teamKeys = engine.teamKeys || ['omega', 'alpha'];
      const teamNames = engine.teamNames || ['Team Omega', 'Team Alpha'];
      const teamPalettes = engine.teamPalettes || ['omega', 'alpha'];
      const prevPNames = serverSession?.player_names || {};
      const basePNames = engine.playerNames || {
        team0: ['Player 1', 'Player 2'],
        team1: ['Player 3', 'Player 4'],
      };
      const playerNames = {
        ...prevPNames,
        ...basePNames,
        ...(prevPNames.courtNumber ? { courtNumber: prevPNames.courtNumber } : {}),
        ...(prevPNames.umpireId ? { umpireId: prevPNames.umpireId } : {}),
        ...(prevPNames.umpireName ? { umpireName: prevPNames.umpireName } : {}),
        ...(prevPNames.slots ? { slots: prevPNames.slots } : {}),
        lobbyLocked: true,
      };

      const initialState = engineToRallyState(engine);

      try {
        const { data, error } = await supabase.rpc('fn_create_session', {
          p_session_id: newId,
          p_format: format,
          p_team_keys: teamKeys,
          p_team_names: teamNames,
          p_team_palettes: teamPalettes,
          p_player_names: playerNames,
          p_initial_state: initialState,
          p_timer_duration_ms: timerDurationMs,
          p_legacy_log: null,
          p_auto_start_timer: autoStartTimer,
        });

        if (error) {
          console.error('[useMatchSync] createSession failed:', error);
          return null;
        }

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ACTIVE_SESSION_KEY, newId);
        }
        // Purge any leftover queued ops from prior sessions
        outbox.filterQueue((q) => !q.args?.p_session_id || q.args.p_session_id === newId);
        sessionIdRef.current = newId;
        setSessionId(newId);
        localVersionRef.current = data?.version || 1;
        setLocalVersion(data?.version || 1);
        setServerSession(data);
        return newId;
      } catch (err) {
        console.error('[useMatchSync] Unexpected createSession error:', err);
        return null;
      }
    },
    [isEnabled, isGuest]
  );

  // Record a rally event (Point / Fault / GameWon)
  const recordRally = useCallback(
    ({ eventId, eventType, elapsedSeconds, stateAfter, callString, message }) => {
      const currentSessionId = sessionIdRef.current || sessionId;
      if (!isEnabled || !currentSessionId || isGuest) return;

      const expectedVersion = localVersionRef.current;
      localVersionRef.current += 1;
      setLocalVersion(localVersionRef.current);

      outbox.enqueue({
        op: 'fn_record_rally',
        args: {
          p_session_id: currentSessionId,
          p_event_id:
            eventId ||
            (typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `evt_${Date.now()}`),
          p_expected_version: expectedVersion,
          p_event_type: eventType,
          p_elapsed_seconds: elapsedSeconds || 0,
          p_state_after: stateAfter,
          p_call_string: callString || '',
          p_message: message || '',
        },
        expectedVersion,
      });
    },
    [isEnabled, sessionId, isGuest]
  );

  // Undo
  const undo = useCallback(() => {
    const currentSessionId = sessionIdRef.current || sessionId;
    if (!isEnabled || !currentSessionId || isGuest) return;

    const expectedVersion = localVersionRef.current;
    localVersionRef.current += 1;
    setLocalVersion(localVersionRef.current);

    outbox.enqueue({
      op: 'fn_undo_rally',
      args: {
        p_session_id: currentSessionId,
        p_expected_version: expectedVersion,
      },
      expectedVersion,
    });
  }, [isEnabled, sessionId, isGuest]);

  // Redo
  const redo = useCallback(() => {
    const currentSessionId = sessionIdRef.current || sessionId;
    if (!isEnabled || !currentSessionId || isGuest) return;

    const expectedVersion = localVersionRef.current;
    localVersionRef.current += 1;
    setLocalVersion(localVersionRef.current);

    outbox.enqueue({
      op: 'fn_redo_rally',
      args: {
        p_session_id: currentSessionId,
        p_expected_version: expectedVersion,
      },
      expectedVersion,
    });
  }, [isEnabled, sessionId, isGuest]);

  // Set Timer
  const setTimer = useCallback(
    ({ status, remainingMs, endsAt, clientTs }) => {
      const currentSessionId = sessionIdRef.current || sessionId;
      if (!isEnabled || !currentSessionId || isGuest) return;

      outbox.enqueue({
        op: 'fn_set_timer',
        args: {
          p_session_id: currentSessionId,
          p_status: status,
          p_remaining_ms: remainingMs,
          p_ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          p_client_ts: clientTs || new Date().toISOString(),
        },
      });
    },
    [isEnabled, sessionId, isGuest]
  );

  // Update session metadata
  const updateSessionMeta = useCallback(
    ({ teamNames, teamPalettes }) => {
      const currentSessionId = sessionIdRef.current || sessionId;
      if (!isEnabled || !currentSessionId || isGuest) return;

      outbox.enqueue({
        op: 'fn_update_session_meta',
        args: {
          p_session_id: currentSessionId,
          p_team_names: teamNames,
          p_team_palettes: teamPalettes,
        },
      });
    },
    [isEnabled, sessionId, isGuest]
  );

  // Close session
  const closeSession = useCallback(
    async (status = 'completed') => {
      const closingId = sessionIdRef.current || sessionId;
      if (!isEnabled || !closingId) return;

      // Immediately detach sessionIdRef and purge any queued ops for the closing session
      sessionIdRef.current = null;
      setSessionId(null);
      localVersionRef.current = 0;
      setLocalVersion(0);
      setServerSession(null);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
      outbox.filterQueue((q) => q.args?.p_session_id !== closingId);

      try {
        await supabase.rpc('fn_close_session', {
          p_session_id: closingId,
          p_status: status,
        });
      } catch (err) {
        console.error('[useMatchSync] closeSession failed:', err);
      }
    },
    [isEnabled, sessionId]
  );

  return {
    isEnabled,
    isGuest,
    sessionId,
    localVersion,
    syncStatus,
    pendingCount,
    legacyLog,
    toastMessage,
    serverSession,
    isLoadingSession,
    rehydrateVersion,
    clearToast: () => setToastMessage(null),
    createSession,
    recordRally,
    undo,
    redo,
    setTimer,
    updateSessionMeta,
    closeSession,
    refetchAndRehydrate,
  };
}
