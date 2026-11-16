'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, AlertTriangle, X, Tv, Trophy, Undo2 } from 'lucide-react';
import { useScoreboard } from '../../hooks/useScoreboard';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useMatchSync } from '../../hooks/useMatchSync';
import { useVoiceScoring } from '../../hooks/useVoiceScoring';
import Header from '../layout/Header';
import ControlBar from './ControlBar';
import TeamPanel from './TeamPanel';
import MatchLog from './MatchLog';
import GameWonModal from './GameWonModal';
import VoiceDebugOverlay from './VoiceDebugOverlay';
import ProjectToScreenModal from './ProjectToScreenModal';
import AmbientCourtMotif from '../ui/AmbientCourtMotif';
import { VOICE_CONFIG } from '@/config/voice';
import { supabase } from '@/config/supabase';
import { PickleballEngine } from '@/lib/engine';
import { getSynth } from '@/lib/audio';
import {
  resolveAuthenticatedDestination,
  resolveSignedOutDestination,
} from '@/lib/auth-session';
import { pairTvWithCourt, notifyTvCourtClosed } from '@/lib/tv-pairing';

export function Scoreboard() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [gameWonModalOpen, setGameWonModalOpen] = useState(false);
  const [isTimeExpired, setIsTimeExpired] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [tvBannerMessage, setTvBannerMessage] = useState('');
  const [rallyToast, setRallyToast] = useState(null);
  const rallyToastTimerRef = useRef(null);
  const abandonCancelBtnRef = useRef(null);
  const pairedTvHandledRef = useRef(false);

  // 1. Detect Viewer / Guest State (isGuest disables officiating controls)
  const [isGuest, setIsGuest] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      return search.get('demo') === '1';
    }
    return false;
  });

  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new PickleballEngine({ format: 'doubles' });
  }

  // Cloud sync coordinator hook
  const sync = useMatchSync({
    engineRef,
    isGuest,
  });

  useEffect(() => {
    let isMounted = true;

    async function checkAuthAndProfile() {
      const search =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams();
      const isDemo = search.get('demo') === '1';
      const sessionParam = search.get('session') || null;

      if (isDemo) {
        if (isMounted) setIsGuest(true);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        // Signed-out scan or visit without ?demo=1: route through role/portal login preserving ?session
        if (!session?.user) {
          router.replace(resolveSignedOutDestination(sessionParam));
          return;
        }

        const user = session.user;
        setUserId(user.id);
        setUserEmail(user.email || null);

        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (data) {
          setProfile(data);

          if (data.role === 'player') {
            // Players do not access live scoreboard on their phones; route to Player Portal
            router.replace('/player');
            return;
          }
        }

        // Signed-in Umpire visiting bare /pikolscore without ?session=<id>: run Smart Resume
        if (!sessionParam) {
          const dest = await resolveAuthenticatedDestination(supabase, user.id);
          if (isMounted) router.replace(dest);
          return;
        }

        setIsGuest(false);
      } catch {
        // Fallback to viewer mode if offline
        if (isMounted) setIsGuest(true);
      }
    }

    checkAuthAndProfile();

    return () => {
      isMounted = false;
    };
  }, [router]);

  // If a signed-in umpire scans a match owned by a different umpire, switch to read-only viewer mode
  useEffect(() => {
    if (
      userId &&
      profile?.role !== 'player' &&
      sync?.serverSession?.umpire_id &&
      sync.serverSession.umpire_id !== userId
    ) {
      setIsGuest(true);
    }
  }, [userId, profile?.role, sync?.serverSession?.umpire_id]);

  const isOwningUmpire = Boolean(
    userId &&
      sync?.serverSession?.umpire_id &&
      sync.serverSession.umpire_id === userId
  );

  // Auto-pair TV if officiating umpire scanned TV QR (?tv=<tvId>) while in active match
  useEffect(() => {
    if (typeof window === 'undefined' || !isOwningUmpire || !sync?.serverSession?.id || pairedTvHandledRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const scannedTv = params.get('tv');
    if (!scannedTv) return;

    pairedTvHandledRef.current = true;
    const courtNum =
      Number(
        sync.serverSession.court_number ||
          sync.serverSession.player_names?.courtNumber
      ) || 1;

    pairTvWithCourt({
      tvId: scannedTv,
      courtNumber: courtNum,
      sessionId: sync.serverSession.id,
    })
      .then(() => {
        setTvBannerMessage(`Connected Courtside TV Screen to Court ${courtNum}!`);
        const url = new URL(window.location.href);
        url.searchParams.delete('tv');
        window.history.replaceState({}, '', url.pathname + url.search);
      })
      .catch((err) => {
        console.warn('[Scoreboard] Failed to pair TV:', err);
      });
  }, [isOwningUmpire, sync?.serverSession]);

  const showRallyToast = useCallback((message) => {
    if (!message) return;
    if (rallyToastTimerRef.current) {
      clearTimeout(rallyToastTimerRef.current);
    }
    setRallyToast({ message, id: Date.now() });
    rallyToastTimerRef.current = setTimeout(() => {
      setRallyToast(null);
      rallyToastTimerRef.current = null;
    }, 4000);
  }, []);

  const clearRallyToast = useCallback(() => {
    if (rallyToastTimerRef.current) {
      clearTimeout(rallyToastTimerRef.current);
      rallyToastTimerRef.current = null;
    }
    setRallyToast(null);
  }, []);

  useEffect(() => {
    return () => {
      if (rallyToastTimerRef.current) {
        clearTimeout(rallyToastTimerRef.current);
      }
    };
  }, []);

  // Focus Cancel button by default when Abandon dialog opens & allow Escape to close
  useEffect(() => {
    if (!showAbandonModal) return;
    const focusTimer = setTimeout(() => {
      abandonCancelBtnRef.current?.focus();
    }, 20);
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowAbandonModal(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [showAbandonModal]);

  const handleTimerExpireRef = useRef(null);
  const isTransitioningMatchRef = useRef(false);

  const timer = useMatchTimer({
    onExpire: () => handleTimerExpireRef.current?.(),
    sync,
  });

  const handleCloseLog = useCallback(() => {
    setLogOpen(false);
  }, []);

  const handleCloseGameWon = useCallback(() => {
    setGameWonModalOpen(false);
  }, []);

  const handleEscape = useCallback(() => {
    if (showAbandonModal) {
      setShowAbandonModal(false);
    } else if (gameWonModalOpen) {
      setGameWonModalOpen(false);
    } else if (logOpen) {
      setLogOpen(false);
    }
  }, [showAbandonModal, gameWonModalOpen, logOpen]);

  const {
    state,
    canUndo,
    canRedo,
    log,
    point,
    fault,
    undo,
    redo,
    reset,
    timeExpired,
  } = useScoreboard({
    elapsedSeconds: timer.elapsedSeconds,
    onEscape: handleEscape,
    isGuest,
    sync,
    engineRef,
  });

  // Handler for when match countdown timer reaches 00:00
  handleTimerExpireRef.current = () => {
    if (state?.gameOver || isTransitioningMatchRef.current) return;
    setIsTimeExpired(true);
    const res = timeExpired?.();
    if (res?.isDraw) {
      // Time-up buzzer already played by useMatchTimer
    } else {
      setTimeout(() => {
        getSynth()?.gameWon();
      }, 500);
    }
  };

  // Automatically trigger match end when timer reaches 0 or hydrates as expired
  useEffect(() => {
    if (
      (timer.status === 'expired' || timer.remainingSeconds === 0) &&
      timer.status !== 'idle' &&
      !state?.gameOver &&
      !isTransitioningMatchRef.current
    ) {
      handleTimerExpireRef.current?.();
    }
  }, [timer.status, timer.remainingSeconds, state?.gameOver]);

  // Automatically pause timer when a team wins (inline R11 row appears first; GameWonModal opens on 'View summary')
  useEffect(() => {
    if (state?.gameOver) {
      timer.pause();
    } else {
      setGameWonModalOpen(false);
    }
  }, [state?.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  // If an authenticated umpire visits /pikolscore without a valid session, redirect to /matches
  useEffect(() => {
    if (
      sync?.isEnabled &&
      !isGuest &&
      !sync?.isLoadingSession &&
      !sync?.sessionId &&
      !isTransitioningMatchRef.current
    ) {
      router.replace('/matches');
    }
  }, [sync?.isEnabled, isGuest, sync?.isLoadingSession, sync?.sessionId, router]);

  // Score & control guards
  const isMatchOver = Boolean(
    state?.gameOver || timer.status === 'expired' || timer.remainingSeconds === 0
  );

  // While officiating an active match, trap browser back button so umpire stays on scoreboard
  useEffect(() => {
    if (!isOwningUmpire || isMatchOver) return;

    window.history.pushState({ page: 'scoreboard' }, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState({ page: 'scoreboard' }, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOwningUmpire, isMatchOver]);

  const handleRematch = useCallback(async () => {
    if (isGuest || isTransitioningMatchRef.current) return;
    isTransitioningMatchRef.current = true;

    setIsTimeExpired(false);
    setGameWonModalOpen(false);
    clearRallyToast();

    try {
      if (sync?.isEnabled && sync.sessionId) {
        const isCompleted = state?.gameOver || timer.status === 'expired';
        await sync.closeSession(isCompleted ? 'completed' : 'abandoned');
      }

      reset();
      timer.reset(false);

      if (sync?.isEnabled && engineRef.current) {
        const newSessionId = await sync.createSession(engineRef.current, timer.durationMs, true);
        if (newSessionId) {
          router.replace(`/pikolscore?session=${newSessionId}`);
        }
      }
      timer.start(true);
    } finally {
      isTransitioningMatchRef.current = false;
    }
  }, [isGuest, reset, timer, sync, state?.gameOver, router, clearRallyToast]);

  const handleGoToMatches = useCallback(async () => {
    const closingSessionId = sync?.sessionId;
    const courtNum =
      Number(
        sync?.serverSession?.court_number ||
          sync?.serverSession?.player_names?.courtNumber
      ) || null;
    const pairedTvIds = Array.isArray(sync?.serverSession?.player_names?.pairedTvIds)
      ? sync.serverSession.player_names.pairedTvIds
      : [];

    if (
      sync?.isEnabled &&
      closingSessionId &&
      (state?.gameOver || timer.status === 'expired' || timer.remainingSeconds === 0)
    ) {
      await Promise.allSettled([
        notifyTvCourtClosed({
          courtNumber: courtNum,
          sessionId: closingSessionId,
          reason: 'completed',
          pairedTvIds,
        }),
        sync.closeSession('completed'),
      ]);
    }
    router.push('/matches');
  }, [sync, state?.gameOver, timer.status, timer.remainingSeconds, router]);

  const handleAbandon = useCallback(async () => {
    if (isGuest || !sync?.sessionId) return;
    const closingSessionId = sync.sessionId;
    const courtNum =
      Number(
        sync?.serverSession?.court_number ||
          sync?.serverSession?.player_names?.courtNumber
      ) || null;
    const pairedTvIds = Array.isArray(sync?.serverSession?.player_names?.pairedTvIds)
      ? sync.serverSession.player_names.pairedTvIds
      : [];

    try {
      await notifyTvCourtClosed({
        courtNumber: courtNum,
        sessionId: closingSessionId,
        reason: 'abandoned',
        pairedTvIds,
      });
      await sync.closeSession('abandoned');
      router.replace('/matches');
    } catch (err) {
      console.error('Failed to abandon match:', err);
    } finally {
      setShowAbandonModal(false);
    }
  }, [isGuest, sync, router]);

  const handleUndoWinningPoint = useCallback(() => {
    if (isGuest) return;
    clearRallyToast();
    undo();
    setGameWonModalOpen(false);
  }, [isGuest, undo, clearRallyToast]);

  const handlePoint = useCallback(
    (reason = null) => {
      if (isGuest || isMatchOver) return;
      const currentServingIdx = engineRef.current?.servingTeam ?? 0;
      const currentTeamNames = engineRef.current?.teamNames || ['Team A', 'Team B'];
      const scoringTeamName = currentTeamNames[currentServingIdx] || 'Serving team';

      point(reason);
      showRallyToast(`Point to ${scoringTeamName}`);

      if (!engineRef.current?.gameOver) {
        if (timer.status === 'idle') {
          timer.start();
        } else if (timer.status === 'paused') {
          timer.resume();
        }
      }
    },
    [isGuest, isMatchOver, timer, point, showRallyToast]
  );

  const handleFault = useCallback(
    (reason = null) => {
      if (isGuest || isMatchOver) return;
      const res = fault(reason);
      const currentTeamNames = engineRef.current?.teamNames || ['Team A', 'Team B'];
      if (res?.event === 'secondServer') {
        showRallyToast('Fault · server 2 is up');
      } else if (res?.event === 'sideOut') {
        const nextTeamName =
          currentTeamNames[res.servingTeam ?? engineRef.current?.servingTeam ?? 0] ||
          'Other team';
        showRallyToast(`Side-out · ${nextTeamName} serves`);
      }

      if (!engineRef.current?.gameOver) {
        if (timer.status === 'idle') {
          timer.start();
        } else if (timer.status === 'paused') {
          timer.resume();
        }
      }
    },
    [isGuest, isMatchOver, timer, fault, showRallyToast]
  );

  const handleUndo = useCallback(() => {
    if (isGuest) return;
    clearRallyToast();
    undo();
  }, [isGuest, undo, clearRallyToast]);

  const handleRedo = useCallback(() => {
    if (isGuest || isMatchOver) return;
    clearRallyToast();
    redo();
  }, [isGuest, isMatchOver, redo, clearRallyToast]);

  const handleToggleTimer = useCallback(() => {
    if (isGuest) return;
    if (timer.status === 'expired' || timer.remainingSeconds === 0) {
      handleRematch();
    } else {
      timer.toggle();
    }
  }, [isGuest, timer, handleRematch]);

  const effectiveTimeExpired = Boolean(
    isTimeExpired ||
      timer.status === 'expired' ||
      (timer.status !== 'idle' && timer.remainingSeconds === 0)
  );

  const voice = useVoiceScoring({
    game: {
      isGuest,
      isTimeExpired: effectiveTimeExpired,
      timerStatus: timer.status,
      gameOver: Boolean(state?.gameOver),
      canUndo: Boolean(canUndo),
      sessionId: sync?.sessionId ?? null,
      format: state?.format || 'doubles',
      serverNumber: state?.serverNumber ?? (state?.format === 'doubles' ? 2 : 1),
      callout: state?.callCompact || '',
      liveAnnouncement: state?.liveAnnouncement || '',
    },
    onPoint: handlePoint,
    onFault: handleFault,
    onSecondServe: handleFault,
    onSideOut: handleFault,
    onUndo: handleUndoWinningPoint,
    onPauseTimer: timer.pause,
    onResumeTimer: timer.resume,
  });

  const teamKeys = state?.teamKeys || ['omega', 'alpha'];
  const teamNames = state?.teamNames || ['Team Omega', 'Team Alpha'];
  const scores = state?.scores || [0, 0];
  const servingTeam = state?.servingTeam ?? 0;
  const servingTeamName = state?.servingTeamName || teamNames[servingTeam];
  const serverNumber = state?.serverNumber ?? 2;
  const winnerIdx =
    state?.winner !== null && state?.winner !== undefined
      ? state.winner
      : isMatchOver
      ? scores[0] > scores[1]
        ? 0
        : scores[1] > scores[0]
        ? 1
        : null
      : null;

  const resolvedCourtNumber =
    Number(
      sync?.serverSession?.court_number ||
        sync?.serverSession?.player_names?.courtNumber ||
        state?.playerNames?.courtNumber
    ) || null;

  const liveAnnouncement =
    state?.liveAnnouncement ||
    `${servingTeamName} serving. ${scores[servingTeam]}, ${scores[1 - servingTeam]}, ${serverNumber}.`;

  return (
    <div className="ps-shell">
      <AmbientCourtMotif variant="glow" />

      {/* 1. Subtle Spectator / Player Viewer Top Banner */}
      {isGuest && (
        <div
          role="status"
          aria-live="polite"
          className="relative z-20 flex items-center justify-center gap-2 bg-[#07192B] border-b border-[#11263C] px-3 sm:px-4 py-1.5 sm:py-2 text-center text-[11.5px] sm:text-[13px] font-semibold text-[#B0C4D8] tracking-wide leading-snug"
        >
          <Eye size={15} className="text-[#00E5B8] shrink-0" aria-hidden="true" />
          <span>
            {profile?.role === 'player'
              ? `Live Court Session — Connected as ${profile.full_name || userEmail || 'Player'}`
              : 'Spectator Mode (Read-Only) — Sign out to log in as an official umpire.'}
          </span>
        </div>
      )}

      {/* 1b. TV Pairing Confirmation Banner */}
      {tvBannerMessage && (
        <div
          role="status"
          aria-live="polite"
          className="relative z-20 flex items-center justify-between gap-3 bg-[#0B2239] border-b border-[#00E5B8]/60 px-4 py-2 text-[13px] font-bold text-[#FFFFFF]"
        >
          <div className="flex items-center gap-2">
            <Tv size={15} className="text-[#00E5B8] shrink-0" aria-hidden="true" />
            <span>{tvBannerMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setTvBannerMessage('')}
            className="p-1 text-[#B0C4D8] hover:text-[#FFFFFF] rounded bg-transparent border-0 cursor-pointer"
            aria-label="Dismiss TV pairing notice"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 2. Version Conflict / Sync Alert Toast */}
      {sync?.toastMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="relative z-20 flex items-center justify-between gap-3 bg-[#0B2239] border-b border-[#F4A261]/60 px-4 py-2 text-[13px] font-medium text-[#FFFFFF]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#F4A261] shrink-0" aria-hidden="true" />
            <span>{sync.toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={sync.clearToast}
            className="p-1 text-[#B0C4D8] hover:text-[#FFFFFF] rounded bg-transparent border-0 cursor-pointer"
            aria-label="Dismiss alert"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 3. Header remains outside the disabled/inert wrapper */}
      <Header
        compactMenu={true}
        courtNumber={resolvedCourtNumber}
        logCount={(log?.length || 0) + (sync?.legacyLog?.length || 0)}
        onAbandonMatch={
          isOwningUmpire && !isMatchOver ? () => setShowAbandonModal(true) : undefined
        }
        onOpenProjectModal={
          isOwningUmpire && sync?.sessionId ? () => setProjectModalOpen(true) : undefined
        }
        onOpenLog={() => !isGuest && setLogOpen(true)}
        profile={profile}
        userEmail={userEmail}
        isGuest={isGuest}
        syncStatus={sync?.syncStatus}
        pendingCount={sync?.pendingCount}
        isCloudSync={sync?.isEnabled}
        inert={gameWonModalOpen || showAbandonModal || undefined}
      />

      {/* 4. Main scoreboard & game controls put behind glass for guests */}
      <div
        inert={isGuest || undefined}
        className={`flex-1 flex flex-col min-h-0 ${isGuest ? 'pointer-events-none select-none' : ''}`}
      >
        <main
          className="ps-main"
          inert={gameWonModalOpen || showAbandonModal || undefined}
        >
          <div className="ps-stage">
            {/* R11: Match-end inline row with final score, View summary, and New match */}
            {isMatchOver && (
              <div
                role="region"
                aria-label="Match complete actions"
                className="flex flex-none flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#24425E] dv-top-accent bg-[#0B2239] px-5 py-3 shadow-lg"
              >
                <div className="flex items-center gap-2.5 text-[15px] font-bold text-[#FFFFFF]">
                  <Trophy size={20} className="shrink-0 text-[#00E5B8]" aria-hidden="true" />
                  <span>
                    {winnerIdx === null
                      ? `Match tied · Final score ${scores[0]}–${scores[1]}`
                      : `${teamNames[winnerIdx]} wins · Final score ${scores[winnerIdx]}–${
                          scores[1 - winnerIdx]
                        }`}
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isGuest}
                    onClick={() => !isGuest && setGameWonModalOpen(true)}
                    className="inline-flex h-[40px] items-center justify-center rounded-[10px] border border-[#24425E] bg-[#07192B] px-4 text-[13px] font-semibold text-[#FFFFFF] hover:border-[#00E5B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer"
                  >
                    View summary
                  </button>
                  <button
                    type="button"
                    disabled={isGuest}
                    onClick={handleGoToMatches}
                    className="inline-flex h-[40px] items-center justify-center rounded-[10px] bg-[#00E5B8] px-4 text-[13px] font-bold text-[#031B28] hover:bg-[#05DFB4] border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer"
                  >
                    New match
                  </button>
                </div>
              </div>
            )}

            <div className="ps-court-grid ps-teams">
              <ControlBar
                canUndo={!isGuest && canUndo}
                canRedo={!isGuest && canRedo}
                onUndo={handleUndo}
                onRedo={handleRedo}
                formattedTime={timer.formattedTime}
                timerLabel={timer.label}
                timerStatus={timer.status}
                onToggleTimer={handleToggleTimer}
                isGuest={isGuest}
              />

              <TeamPanel
                teamIndex={0}
                teamKey={teamKeys[0]}
                teamName={teamNames[0]}
                score={scores[0]}
                isServing={servingTeam === 0}
                serverNumber={serverNumber}
                players={state?.playerNames?.team0}
                format={state?.format || 'doubles'}
                isMatchOver={isMatchOver}
                isWinner={winnerIdx === 0}
                isLoser={winnerIdx === 1}
                onPoint={handlePoint}
                onFault={handleFault}
              />
              <TeamPanel
                teamIndex={1}
                teamKey={teamKeys[1]}
                teamName={teamNames[1]}
                score={scores[1]}
                isServing={servingTeam === 1}
                serverNumber={serverNumber}
                players={state?.playerNames?.team1}
                format={state?.format || 'doubles'}
                isMatchOver={isMatchOver}
                isWinner={winnerIdx === 1}
                isLoser={winnerIdx === 0}
                onPoint={handlePoint}
                onFault={handleFault}
              />
            </div>
          </div>

          <div className="ps-sr" aria-live="polite">
            {liveAnnouncement}
          </div>
        </main>

        {/* R10: Bottom-centre rally feedback toast (4 seconds) with inline Undo */}
        {rallyToast && !isGuest && (
          <div
            key={rallyToast.id}
            role="status"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#00E5B8] bg-[#0B2239] pl-4 pr-2 py-1.5 text-[14px] font-bold text-[#FFFFFF] shadow-2xl"
          >
            <span className="h-2 w-2 rounded-full bg-[#00E5B8] shrink-0" aria-hidden="true" />
            <span>{rallyToast.message}</span>
            {canUndo && (
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#00E5B8] px-3 py-1 text-[12.5px] font-bold text-[#031B28] hover:bg-[#05DFB4] border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer"
              >
                <Undo2 size={13} aria-hidden="true" />
                <span>Undo</span>
              </button>
            )}
          </div>
        )}

        <MatchLog
          open={logOpen}
          entries={log}
          legacyEntries={sync?.legacyLog || []}
          format={state?.format || 'doubles'}
          teamNames={teamNames}
          playerNames={state?.playerNames}
          onClose={handleCloseLog}
          inert={gameWonModalOpen || showAbandonModal || undefined}
          voiceMicMode={voice.micMode}
          voiceMicModeSetting={voice.micModeSetting}
          onSetMicModeSetting={voice.setMicModeSetting}
          voiceTtsEnabled={voice.ttsEnabled}
          onSetTtsEnabled={voice.setTtsEnabled}
        />

        {VOICE_CONFIG.debugOverlay && voice.active && (
          <VoiceDebugOverlay heard={voice.heard} />
        )}

        <GameWonModal
          open={gameWonModalOpen}
          winnerName={state?.winnerName}
          scores={scores}
          teamNames={teamNames}
          courtNumber={resolvedCourtNumber}
          canUndo={canUndo && !isTimeExpired}
          isDraw={Boolean(state?.isDraw)}
          isTimeExpired={isTimeExpired || timer.status === 'expired'}
          onRematch={handleRematch}
          onNewMatch={handleRematch}
          onUndo={handleUndoWinningPoint}
          onGoToMatches={handleGoToMatches}
          onClose={handleCloseGameWon}
        />
      </div>

      {/* 5b. Project to Screen Modal (Available during active match) */}
      {isOwningUmpire && sync?.serverSession && (
        <ProjectToScreenModal
          isOpen={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          courtNumber={resolvedCourtNumber || 1}
          sessionId={sync.serverSession.id}
          onPaired={(cNum, updated) => {
            if (updated) {
              sync.refetchAndRehydrate(updated);
            }
            setTvBannerMessage(`Connected Courtside TV Screen to Court ${cNum}!`);
          }}
        />
      )}

      {/* 6. Abandon Match Confirmation Dialog */}
      {showAbandonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-[#021024]/75 backdrop-blur-[12px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="abandon-modal-title"
        >
          <div className="w-full max-w-[440px] bg-[#0B2239] rounded-[20px] p-6 border border-[#24425E] dv-top-accent-error shadow-2xl text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] bg-[#F47067]/15 border border-[#F47067]/40 text-[#F47067] mb-4">
              <AlertTriangle size={24} aria-hidden="true" />
            </div>
            <span className="dv-overline block text-[#F47067] mb-1.5">MATCH TERMINATION</span>
            <h3 id="abandon-modal-title" className="dv-display text-[30px] leading-[1.08] text-[#FFFFFF] mb-3">
              ABANDON THIS MATCH?
            </h3>
            <p className="text-[15px] text-[#B0C4D8] mb-6 leading-relaxed">
              Abandoning this match will end the match, remove all players from the court, and free the court for a new match. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                ref={abandonCancelBtnRef}
                type="button"
                onClick={() => setShowAbandonModal(false)}
                className="flex-1 h-[54px] rounded-[12px] border border-[#24425E] bg-[#07192B] text-[#FFFFFF] font-bold text-[16px] hover:border-[#00E5B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAbandon}
                className="flex-1 h-[54px] rounded-[12px] bg-[#F47067] text-[#031B28] font-bold text-[16px] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F47067] cursor-pointer border-0"
              >
                Abandon match
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Scoreboard;
