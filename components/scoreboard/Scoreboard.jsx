'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, AlertTriangle, X } from 'lucide-react';
import { useScoreboard } from '../../hooks/useScoreboard';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useMatchSync } from '../../hooks/useMatchSync';
import { useVoiceScoring } from '../../hooks/useVoiceScoring';
import Header from '../layout/Header';
import ConsoleFooter from '../layout/ConsoleFooter';
import ControlBar from './ControlBar';
import TeamPanel from './TeamPanel';
import CallRow from './CallRow';
import MatchLog from './MatchLog';
import GameWonModal from './GameWonModal';
import VoiceDebugOverlay from './VoiceDebugOverlay';
import CourtQrLobbyModal from './CourtQrLobbyModal';
import { VOICE_CONFIG } from '@/config/voice';
import { supabase } from '@/config/supabase';
import { PickleballEngine } from '@/lib/engine';
import { getSynth } from '@/lib/audio';
import {
  resolveAuthenticatedDestination,
  resolveSignedOutDestination,
} from '@/lib/auth-session';

export function Scoreboard() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [gameWonModalOpen, setGameWonModalOpen] = useState(false);
  const [isTimeExpired, setIsTimeExpired] = useState(false);
  const [qrModalExplicitOpen, setQrModalExplicitOpen] = useState(false);
  const [umpireDismissedLobby, setUmpireDismissedLobby] = useState(false);

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
            if (!sessionParam) {
              router.replace('/player');
              return;
            }
            // Signed-in Player viewing an active match via ?session=<id> QR scan (read-only viewer)
            setIsGuest(true);
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
    if (gameWonModalOpen) {
      setGameWonModalOpen(false);
    } else if (logOpen) {
      setLogOpen(false);
    }
  }, [gameWonModalOpen, logOpen]);

  const {
    state,
    canUndo,
    canRedo,
    log,
    gameOver,
    winnerName,
    isDraw,
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
    setGameWonModalOpen(true);
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

  // Automatically pause timer and trigger GameWonModal when a team wins
  useEffect(() => {
    if (state?.gameOver) {
      timer.pause();
      setGameWonModalOpen(true);
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

  const handleRematch = useCallback(async () => {
    if (isGuest || isTransitioningMatchRef.current) return;
    isTransitioningMatchRef.current = true;

    setIsTimeExpired(false);
    setGameWonModalOpen(false);

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
  }, [isGuest, reset, timer, sync, state?.gameOver, router]);

  const handleGoToMatches = useCallback(async () => {
    if (sync?.isEnabled && sync.sessionId && (state?.gameOver || timer.status === 'expired')) {
      await sync.closeSession('completed');
    }
    router.push('/matches');
  }, [sync, state?.gameOver, timer.status, router]);

  const handleUndoWinningPoint = useCallback(() => {
    if (isGuest) return;
    undo();
    setGameWonModalOpen(false);
  }, [isGuest, undo]);

  const handlePoint = useCallback(
    (reason = null) => {
      if (isGuest || isMatchOver) return;
      point(reason);
      if (!engineRef.current?.gameOver) {
        if (timer.status === 'idle') {
          timer.start();
        } else if (timer.status === 'paused') {
          timer.resume();
        }
      }
    },
    [isGuest, isMatchOver, timer, point]
  );

  const handleFault = useCallback(
    (reason = null) => {
      if (isGuest || isMatchOver) return;
      fault(reason);
      if (!engineRef.current?.gameOver) {
        if (timer.status === 'idle') {
          timer.start();
        } else if (timer.status === 'paused') {
          timer.resume();
        }
      }
    },
    [isGuest, isMatchOver, timer, fault]
  );

  const handleUndo = useCallback(() => {
    if (isGuest) return;
    undo();
  }, [isGuest, undo]);

  const handleRedo = useCallback(() => {
    if (isGuest || isMatchOver) return;
    redo();
  }, [isGuest, isMatchOver, redo]);

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
  const servingTeamKey = state?.servingTeamKey || teamKeys[servingTeam];
  const servingTeamName = state?.servingTeamName || teamNames[servingTeam];
  const serverNumber = state?.serverNumber ?? 2;
  const liveAnnouncement =
    state?.liveAnnouncement ||
    `${servingTeamName} serving. ${scores[servingTeam]}, ${scores[1 - servingTeam]}, ${serverNumber}.`;

  return (
    <div className="ps-shell">
      {/* 1. Subtle Spectator / Player Viewer Top Banner */}
      {isGuest && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 bg-[#FAF9F5] border-b border-[#E2E5DC] px-4 py-2 text-center text-[13px] font-semibold text-[#084B46] tracking-wide"
        >
          <Eye size={15} className="text-[#0F5C62] shrink-0" aria-hidden="true" />
          <span>
            {profile?.role === 'player'
              ? `Live Court Session — Connected as ${profile.full_name || userEmail || 'Player'}`
              : 'Spectator Mode (Read-Only) — Sign out to log in as an official umpire.'}
          </span>
        </div>
      )}

      {/* 2. Version Conflict / Sync Alert Toast */}
      {sync?.toastMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center justify-between gap-3 bg-[#FEECD6] border-b border-[#E2E5DC] px-4 py-2 text-[13px] font-medium text-[#203F39]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#BA1A1A] shrink-0" aria-hidden="true" />
            <span>{sync.toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={sync.clearToast}
            className="p-1 text-[#748079] hover:text-[#203F39] rounded"
            aria-label="Dismiss alert"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 3. Header remains outside the disabled/inert wrapper */}
      <Header
        onBack={
          profile
            ? () =>
                router.push(profile.role === 'player' ? '/player' : '/matches')
            : !isGuest
            ? () => router.push('/matches')
            : undefined
        }
        backLabel={profile?.role === 'player' ? 'Profile' : 'Matches'}
        onOpenQrModal={sync?.sessionId ? () => setQrModalExplicitOpen(true) : undefined}
        onOpenLog={() => !isGuest && setLogOpen(true)}
        profile={profile}
        userEmail={userEmail}
        isGuest={isGuest}
        syncStatus={sync?.syncStatus}
        pendingCount={sync?.pendingCount}
        isCloudSync={sync?.isEnabled}
        inert={gameWonModalOpen || undefined}
      />

      {/* 4. Main scoreboard & game controls put behind glass for guests */}
      <div
        inert={isGuest || undefined}
        className={`flex-1 flex flex-col min-h-0 ${isGuest ? 'pointer-events-none select-none' : ''}`}
      >
        <main
          className="ps-main"
          inert={gameWonModalOpen || undefined}
        >
          <ControlBar
            canUndo={!isGuest && canUndo}
            canRedo={!isGuest && canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            formattedTime={timer.formattedTime}
            timerLabel={timer.label}
            onToggleTimer={handleToggleTimer}
            voiceSupported={voice.supported}
            voiceActive={voice.active}
            voicePill={voice.pill}
            onToggleVoice={voice.toggle}
            isGuest={isGuest}
            isTimeExpired={effectiveTimeExpired}
          />

          {state?.gameOver && !gameWonModalOpen && (
            <button
              type="button"
              className="ps-victory-reopen-bar"
              onClick={() => !isGuest && setGameWonModalOpen(true)}
              disabled={isGuest}
            >
              <span>
                {state.isDraw
                  ? `⏰ Match ended in a draw (${scores[0]}–${scores[1]})! Tap to view summary or start new match`
                  : `🏆 Match won by ${state.winnerName}! Tap to view summary or start new match`}
              </span>
            </button>
          )}

          <div className="ps-teams">
            <TeamPanel
              teamKey={teamKeys[0]}
              teamName={teamNames[0]}
              score={scores[0]}
              isServing={servingTeam === 0}
              onPoint={handlePoint}
              onFault={handleFault}
            />
            <TeamPanel
              teamKey={teamKeys[1]}
              teamName={teamNames[1]}
              score={scores[1]}
              isServing={servingTeam === 1}
              onPoint={handlePoint}
              onFault={handleFault}
            />
          </div>

          <CallRow
            servingTeamKey={servingTeamKey}
            servingTeamName={servingTeamName}
            serverNumber={serverNumber}
            format={state?.format || 'doubles'}
          />

          <div className="ps-sr" aria-live="polite">
            {liveAnnouncement}
          </div>
        </main>

        <ConsoleFooter inert={gameWonModalOpen || undefined} />

        <MatchLog
          open={logOpen}
          entries={log}
          legacyEntries={sync?.legacyLog || []}
          format={state?.format || 'doubles'}
          teamNames={teamNames}
          playerNames={state?.playerNames}
          onClose={handleCloseLog}
          inert={gameWonModalOpen || undefined}
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
          canUndo={canUndo && !isTimeExpired}
          isDraw={Boolean(state?.isDraw)}
          isTimeExpired={isTimeExpired || timer.status === 'expired'}
          onRematch={handleRematch}
          onNewMatch={handleRematch}
          onUndo={handleUndoWinningPoint}
          onGoToMatches={handleGoToMatches}
          onClose={handleCloseGameWon}
        />

        {/* 5. Court QR & Pre-Match Lobby Modal */}
        {sync?.serverSession && (
          <CourtQrLobbyModal
            isOpen={Boolean(
              qrModalExplicitOpen ||
                (sync.serverSession.player_names?.lobbyLocked === false &&
                  (!isOwningUmpire || !umpireDismissedLobby))
            )}
            onClose={() => {
              setQrModalExplicitOpen(false);
              setUmpireDismissedLobby(true);
            }}
            session={sync.serverSession}
            currentUser={{ id: userId, email: userEmail }}
            profile={profile}
            isUmpire={isOwningUmpire}
            onSessionUpdated={(updated) => {
              sync.refetchAndRehydrate(updated);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default Scoreboard;
