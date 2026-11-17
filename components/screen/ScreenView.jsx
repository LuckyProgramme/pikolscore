'use client';

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Tv,
  QrCode,
  Volume2,
  VolumeX,
  RefreshCw,
  Unlink,
  Loader2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/config/supabase';
import { PikolScoreLogo } from '@/components/ui/PikolScoreLogo';
import { AmbientCourtMotif } from '@/components/ui/AmbientCourtMotif';
import ProjectedScoreboard from '@/components/screen/ProjectedScoreboard';
import StandbyPoster, {
  STANDBY_POSTER_FIXTURES,
} from '@/components/tv/StandbyPoster';
import { buildPosterPropsFromSession } from '@/lib/standby-poster';
import {
  buildProjectedViewProps,
  resolveTvSessionCloseAction,
  PROJECTED_FIXTURES,
} from '@/lib/projected-screen';
import { getSynth } from '@/lib/audio';
import {
  TV_ID_STORAGE_KEY,
  PAIRED_COURT_STORAGE_KEY,
  TV_RETURN_TO_ROLE_KEY,
  generateTvId,
  normalizeTvId,
} from '@/lib/tv-pairing';

const TV_MUTED_STORAGE_KEY = 'pikol_tv_muted';

function getCourtNumber(row) {
  return Number(row?.court_number || row?.player_names?.courtNumber) || null;
}

function getAssignedUmpireId(row) {
  if (row?.player_names && 'umpireId' in row.player_names) {
    return row.player_names.umpireId || null;
  }
  return row?.umpire_id || null;
}

export default function ScreenView() {
  const router = useRouter();
  const [tvId, setTvId] = useState('');
  const [pairedCourt, setPairedCourt] = useState(null); // 1..4 or null
  const [fixtureMode, setFixtureMode] = useState(null);
  const [courtsData, setCourtsData] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [pairingQrSvg, setPairingQrSvg] = useState('');
  const [profilesById, setProfilesById] = useState({});
  const [profileRefreshNonce, setProfileRefreshNonce] = useState(0);
  const [showPoster, setShowPoster] = useState(false);
  const [isPosterFading, setIsPosterFading] = useState(false);
  const [posterControlsVisible, setPosterControlsVisible] = useState(false);
  const [abandonCountdown, setAbandonCountdown] = useState(null); // 5..0 when match is abandoned
  const [, setTick] = useState(0);

  // Refs for tracking score/serve transitions & timers
  const prevMatchSnapRef = useRef(null);
  const prevMatchStartedRef = useRef(null);
  const controlsTimerRef = useRef(null);
  const lastStartedSessionRef = useRef(null);
  const tvIdRef = useRef('');
  tvIdRef.current = tvId;
  const pairedCourtRef = useRef(null);
  pairedCourtRef.current = pairedCourt;
  const courtsDataRef = useRef({});
  courtsDataRef.current = courtsData;
  const abandonTriggeredRef = useRef(false);
  const handledClosedSessionIdsRef = useRef(new Set());

  // 1. Initialize TV device ID, saved paired court, and audio mute preference
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const urlCourt = Number(params.get('court'));
    const urlFixture = params.get('fixture');
    if (urlFixture) {
      setFixtureMode(urlFixture);
    }

    let storedTvId = normalizeTvId(window.localStorage.getItem(TV_ID_STORAGE_KEY));
    if (!storedTvId || storedTvId.length > 12) {
      storedTvId = generateTvId();
      window.localStorage.setItem(TV_ID_STORAGE_KEY, storedTvId);
    }
    setTvId(storedTvId);

    const savedMuted = window.localStorage.getItem(TV_MUTED_STORAGE_KEY) === '1';
    setMuted(savedMuted);
    const synth = getSynth();
    if (synth) synth.muted = savedMuted;

    if (urlCourt >= 1 && urlCourt <= 4) {
      setPairedCourt(urlCourt);
      window.localStorage.setItem(PAIRED_COURT_STORAGE_KEY, String(urlCourt));
    } else {
      const savedCourt = Number(window.localStorage.getItem(PAIRED_COURT_STORAGE_KEY));
      if (savedCourt >= 1 && savedCourt <= 4) {
        setPairedCourt(savedCourt);
      }
    }
  }, []);

  // Helper to lock TV onto a court (1..4)
  const activateCourtPairing = useCallback((courtNumber) => {
    const cNum = Number(courtNumber);
    if (!cNum || cNum < 1 || cNum > 4) return;
    setPairedCourt((prev) => {
      if (prev !== cNum) {
        getSynth()?.armed();
      }
      return cNum;
    });
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PAIRED_COURT_STORAGE_KEY, String(cNum));
      const url = new URL(window.location.href);
      url.searchParams.set('court', String(cNum));
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

  // Unpair TV and return to /umpire QR Pairing screen
  const handleUnpairTv = useCallback(() => {
    setPairedCourt(null);
    setAbandonCountdown(null);
    setShowPoster(false);
    setIsPosterFading(false);
    setPosterControlsVisible(false);
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    prevMatchSnapRef.current = null;
    prevMatchStartedRef.current = null;
    lastStartedSessionRef.current = null;
    abandonTriggeredRef.current = false;
    handledClosedSessionIdsRef.current.clear();
    const freshId = generateTvId();
    setTvId(freshId);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PAIRED_COURT_STORAGE_KEY);
      window.localStorage.setItem(TV_ID_STORAGE_KEY, freshId);
      window.sessionStorage.setItem(TV_RETURN_TO_ROLE_KEY, '1');
    }
    router.replace('/umpire');
  }, [router]);

  // Trigger 5-second "Abandon the match" prompt before returning to /umpire
  const triggerAbandonPrompt = useCallback(() => {
    if (abandonTriggeredRef.current) return;
    abandonTriggeredRef.current = true;
    const synth = getSynth();
    if (synth && !synth.muted) {
      synth.timeUp();
    }
    setAbandonCountdown(5);
  }, []);

  // 5-second countdown effect when match is abandoned
  useEffect(() => {
    if (abandonCountdown === null) return;
    if (abandonCountdown <= 0) {
      handleUnpairTv();
      return;
    }
    const timer = setTimeout(() => {
      setAbandonCountdown((prev) => (typeof prev === 'number' ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [abandonCountdown, handleUnpairTv]);

  // Toggle sound effects on TV
  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const synth = getSynth();
      if (synth) {
        synth.muted = next;
        if (!next) synth.armed();
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TV_MUTED_STORAGE_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);

  // 2. Fetch active match_sessions and check if any session has pairedTvIds containing tvId
  const fetchCourts = useCallback(
    async (currentTvId) => {
      try {
        const { data, error } = await supabase
          .from('match_sessions')
          .select('*')
          .eq('status', 'in_progress')
          .order('updated_at', { ascending: true });

        if (!error && Array.isArray(data)) {
          const map = {};
          let matchedCourtFromDb = null;

          data.forEach((row) => {
            if (
              handledClosedSessionIdsRef.current.has(row.id) ||
              resolveTvSessionCloseAction(row) !== null
            ) {
              return;
            }
            const cNum = getCourtNumber(row);
            if (cNum >= 1 && cNum <= 4) {
              map[cNum] = row;
              const tvIds = row?.player_names?.pairedTvIds;
              if (
                currentTvId &&
                Array.isArray(tvIds) &&
                tvIds.includes(currentTvId)
              ) {
                matchedCourtFromDb = cNum;
              }
            }
          });

          setCourtsData(map);
          if (matchedCourtFromDb) {
            activateCourtPairing(matchedCourtFromDb);
          }
        }
      } catch (err) {
        console.warn('[ScreenView] Error fetching courts:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [activateCourtPairing]
  );

  useEffect(() => {
    if (!tvId) return;
    fetchCourts(tvId);
  }, [tvId, fetchCourts]);

  // Keep TV paired to the same court and return to Standby Lobby after explicit match confirmation
  const returnToCourtStandby = useCallback(
    (closedSessionId = null) => {
      if (abandonTriggeredRef.current) return;
      const cNum = pairedCourtRef.current;
      const targetId =
        closedSessionId || (cNum ? courtsDataRef.current[cNum]?.id : null);
      if (targetId) {
        if (handledClosedSessionIdsRef.current.has(targetId)) return;
        handledClosedSessionIdsRef.current.add(targetId);
      }

      lastStartedSessionRef.current = null;
      prevMatchSnapRef.current = null;
      setAbandonCountdown(null);

      if (cNum) {
        setCourtsData((prev) => {
          const current = prev[cNum];
          if (!current) return prev;
          if (targetId && current.id !== targetId) return prev;
          const next = { ...prev };
          delete next[cNum];
          return next;
        });
      }

      if (tvIdRef.current) {
        fetchCourts(tvIdRef.current);
      }
    },
    [fetchCourts]
  );

  // 3. Subscribe to Realtime match_sessions changes + tv_pairing:<tvId> broadcast channel
  useEffect(() => {
    if (!tvId) return;

    const dbChannel = supabase
      .channel(`screen_courts_db_${tvId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_sessions' },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload;
          const rowId = newRow?.id || oldRow?.id;
          if (rowId && handledClosedSessionIdsRef.current.has(rowId)) {
            return;
          }
          let cNum = getCourtNumber(newRow) || getCourtNumber(oldRow);
          if (!cNum && rowId) {
            const matchedEntry = Object.entries(courtsDataRef.current).find(
              ([, s]) => s?.id === rowId
            );
            if (matchedEntry) cNum = Number(matchedEntry[0]);
          }
          if (!cNum || cNum < 1 || cNum > 4) return;

          const currentPaired = pairedCourtRef.current;
          const closeAction = resolveTvSessionCloseAction(newRow);

          // Only transition on explicit abandonment or explicit umpire confirmation
          if (currentPaired && cNum === currentPaired) {
            if (closeAction === 'abandoned') {
              triggerAbandonPrompt();
              return;
            }
            if (closeAction === 'completed') {
              returnToCourtStandby(rowId);
              return;
            }
          }

          if (
            eventType !== 'DELETE' &&
            newRow?.status === 'in_progress' &&
            !closeAction &&
            Array.isArray(newRow?.player_names?.pairedTvIds) &&
            newRow.player_names.pairedTvIds.includes(tvId)
          ) {
            activateCourtPairing(cNum);
          }

          setCourtsData((prev) => {
            const next = { ...prev };
            if (
              eventType === 'DELETE' ||
              closeAction !== null ||
              newRow?.status === 'abandoned'
            ) {
              if (
                next[cNum]?.id === rowId &&
                !abandonTriggeredRef.current
              ) {
                delete next[cNum];
              }
            } else if (
              newRow &&
              (newRow.status === 'in_progress' ||
                (newRow.status === 'completed' && next[cNum]?.id === rowId))
            ) {
              next[cNum] = newRow;
            }
            return next;
          });
        }
      )
      .subscribe();

    const pairChannel = supabase
      .channel(`tv_pairing:${tvId}`)
      .on('broadcast', { event: 'paired' }, (msg) => {
        const targetCourt = Number(msg?.payload?.courtNumber);
        if (targetCourt >= 1 && targetCourt <= 4) {
          abandonTriggeredRef.current = false;
          handledClosedSessionIdsRef.current.clear();
          lastStartedSessionRef.current = null;
          setAbandonCountdown(null);
          activateCourtPairing(targetCourt);
          fetchCourts(tvId);
        }
      })
      .on('broadcast', { event: 'court_closed' }, (msg) => {
        const reason = msg?.payload?.reason;
        const closedId = msg?.payload?.sessionId || null;
        if (reason === 'abandoned') {
          triggerAbandonPrompt();
        } else if (reason === 'completed') {
          returnToCourtStandby(closedId);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dbChannel);
      supabase.removeChannel(pairChannel);
    };
  }, [
    tvId,
    activateCourtPairing,
    fetchCourts,
    triggerAbandonPrompt,
    returnToCourtStandby,
  ]);

  // 3b. Subscribe to court-level broadcast channel `tv_court:<pairedCourt>`
  useEffect(() => {
    if (!pairedCourt || pairedCourt < 1 || pairedCourt > 4) return;

    const courtChannel = supabase
      .channel(`tv_court:${pairedCourt}`)
      .on('broadcast', { event: 'court_closed' }, (msg) => {
        const reason = msg?.payload?.reason;
        const closedId = msg?.payload?.sessionId || null;
        if (reason === 'abandoned') {
          triggerAbandonPrompt();
        } else if (reason === 'completed') {
          returnToCourtStandby(closedId);
        }
      })
      .on('broadcast', { event: 'profile_updated' }, () => {
        setProfileRefreshNonce((n) => n + 1);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(courtChannel);
    };
  }, [pairedCourt, triggerAbandonPrompt, returnToCourtStandby]);

  // 4. 1-second timer tick for live match countdown
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 5. Generate Pairing QR Code SVG (used on View 1 unpaired screen)
  const pairingUrl = useMemo(() => {
    if (typeof window === 'undefined' || !tvId) return '';
    return `${window.location.origin}/?tv=${encodeURIComponent(tvId)}`;
  }, [tvId]);

  useEffect(() => {
    if (!pairingUrl) return;
    let mounted = true;
    QRCode.toString(
      pairingUrl,
      {
        type: 'svg',
        margin: 1,
        color: { dark: '#021024', light: '#FFFFFF' },
      },
      (err, svg) => {
        if (!err && mounted) setPairingQrSvg(svg);
      }
    );
    return () => {
      mounted = false;
    };
  }, [pairingUrl]);

  // Light catch-up refresh when TV browser window regains focus or visibility
  useEffect(() => {
    if (!tvId || fixtureMode) return;
    const handleRefresh = () => {
      if (document.visibilityState === 'visible') {
        fetchCourts(tvId);
      }
    };
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', handleRefresh);
    return () => {
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, [tvId, fixtureMode, fetchCourts]);

  // Current paired court session (keep last active session frozen in background during 5s abandon countdown)
  const rawCourtSession = pairedCourt ? courtsData[pairedCourt] || null : null;
  if (
    rawCourtSession &&
    (rawCourtSession.status === 'in_progress' ||
      (rawCourtSession.status === 'completed' &&
        resolveTvSessionCloseAction(rawCourtSession) === null)) &&
    rawCourtSession.player_names?.lobbyLocked === true
  ) {
    lastStartedSessionRef.current = rawCourtSession;
  }
  const activeSession =
    rawCourtSession ||
    (abandonCountdown !== null ? lastStartedSessionRef.current : null);
  const isMatchStarted = Boolean(
    activeSession &&
      (activeSession.status === 'in_progress' ||
        (activeSession.status === 'completed' &&
          resolveTvSessionCloseAction(activeSession) === null) ||
        abandonCountdown !== null) &&
      activeSession.player_names?.lobbyLocked === true
  );

  // Extract registered userIds from standby slots to look up cutout photos in profiles
  const activeSlotUserIds = useMemo(() => {
    const slots = activeSession?.player_names?.slots;
    if (!slots) return [];
    const ids = [];
    for (const teamKey of ['team0', 'team1']) {
      const arr = Array.isArray(slots[teamKey]) ? slots[teamKey] : [];
      for (const slot of arr) {
        if (slot?.userId && typeof slot.userId === 'string') {
          ids.push(slot.userId);
        }
      }
    }
    return Array.from(new Set(ids)).sort();
  }, [activeSession]);

  const activeSlotUserIdsKey = activeSlotUserIds.join(',');

  useEffect(() => {
    if (
      !pairedCourt ||
      isMatchStarted ||
      fixtureMode ||
      activeSlotUserIds.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const loadProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, photo_urls')
          .in('id', activeSlotUserIds);

        if (cancelled || error || !Array.isArray(data)) return;
        setProfilesById((prev) => {
          const next = { ...prev };
          for (const row of data) {
            if (row?.id) next[row.id] = row;
          }
          return next;
        });
      } catch (err) {
        console.warn('[ScreenView] Failed to fetch standby profiles:', err);
      }
    };

    loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [
    pairedCourt,
    isMatchStarted,
    fixtureMode,
    activeSlotUserIdsKey,
    activeSlotUserIds,
    activeSession?.version,
    activeSession?.updated_at,
    profileRefreshNonce,
  ]);

  const posterProps = useMemo(
    () =>
      buildPosterPropsFromSession({
        session: activeSession,
        pairedCourt,
        profilesById,
      }),
    [activeSession, pairedCourt, profilesById]
  );

  // Manage StandbyPoster -> live scoreboard crossfade (~300ms) and unmount on start
  useEffect(() => {
    if (!pairedCourt || isLoading || fixtureMode) {
      prevMatchStartedRef.current = null;
      setShowPoster(false);
      setIsPosterFading(false);
      return;
    }

    const wasStarted = prevMatchStartedRef.current;
    prevMatchStartedRef.current = isMatchStarted;

    if (!isMatchStarted) {
      setShowPoster(true);
      setIsPosterFading(false);
      return;
    }

    // Entered directly into an already-live match on load, or abandoning -> skip poster
    if (wasStarted === null || abandonCountdown !== null) {
      setShowPoster(false);
      setIsPosterFading(false);
      return;
    }

    // Transitioned from standby (false) -> live (true): crossfade then unmount
    if (wasStarted === false && isMatchStarted === true) {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReducedMotion) {
        setShowPoster(false);
        setIsPosterFading(false);
        return;
      }

      setShowPoster(true);
      setIsPosterFading(false);
      setPosterControlsVisible(false);

      let raf1 = null;
      let raf2 = null;
      let unmountTimer = null;

      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          setIsPosterFading(true);
        });
      });

      unmountTimer = window.setTimeout(() => {
        setShowPoster(false);
        setIsPosterFading(false);
      }, 320);

      return () => {
        if (raf1 !== null) window.cancelAnimationFrame(raf1);
        if (raf2 !== null) window.cancelAnimationFrame(raf2);
        if (unmountTimer !== null) window.clearTimeout(unmountTimer);
      };
    }
  }, [pairedCourt, isLoading, isMatchStarted, abandonCountdown, fixtureMode]);

  const revealPosterControls = useCallback(() => {
    setPosterControlsVisible(true);
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = setTimeout(() => {
      setPosterControlsVisible(false);
      controlsTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, []);

  // 5b. Active match heartbeat fallback: if RLS hides an 'abandoned' update from anon
  // or a socket packet is missed, verify the active session status every 2.5 seconds.
  useEffect(() => {
    const watchedId = rawCourtSession?.id;
    const isLocked = Boolean(rawCourtSession?.player_names?.lobbyLocked);
    if (!pairedCourt || !watchedId || !isLocked) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      if (
        cancelled ||
        abandonTriggeredRef.current ||
        handledClosedSessionIdsRef.current.has(watchedId)
      ) {
        return;
      }
      try {
        const { data, error } = await supabase
          .from('match_sessions')
          .select('id, status, player_names')
          .eq('id', watchedId)
          .maybeSingle();

        if (cancelled || error) return;

        // Because RLS for anon only allows status IN ('in_progress', 'completed'),
        // data === null means the session status transitioned to 'abandoned'!
        if (!data) {
          triggerAbandonPrompt();
          return;
        }

        const closeAction = resolveTvSessionCloseAction(data);
        if (closeAction === 'abandoned') {
          triggerAbandonPrompt();
          return;
        }
        if (closeAction === 'completed') {
          returnToCourtStandby(watchedId);
        }
      } catch (err) {
        console.warn('[ScreenView] Session status check warning:', err);
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    pairedCourt,
    rawCourtSession?.id,
    rawCourtSession?.player_names?.lobbyLocked,
    triggerAbandonPrompt,
    returnToCourtStandby,
  ]);

  // Compute live match metrics when match is started
  const servingTeamIdx = activeSession?.serving_team ?? 0;
  const serverNum = activeSession?.server_number ?? 2;
  const scoreTeam0 = activeSession?.score_team0 ?? 0;
  const scoreTeam1 = activeSession?.score_team1 ?? 0;

  // 6. Sound effects on score, side-out, second serve, timer expiry, and match won
  useEffect(() => {
    if (!isMatchStarted || !activeSession) {
      prevMatchSnapRef.current = null;
      return;
    }

    const targetScore = activeSession.target_score || 11;
    const winBy = activeSession.win_by || 2;
    const team0Won = scoreTeam0 >= targetScore && scoreTeam0 - scoreTeam1 >= winBy;
    const team1Won = scoreTeam1 >= targetScore && scoreTeam1 - scoreTeam0 >= winBy;
    const isGameWon = Boolean(
      team0Won || team1Won || activeSession.initial_state?.gameOver
    );

    let isTimerExpired = activeSession.timer_status === 'expired';
    if (
      activeSession.timer_status === 'running' &&
      activeSession.timer_ends_at &&
      new Date(activeSession.timer_ends_at).getTime() <= Date.now()
    ) {
      isTimerExpired = true;
    }

    const prev = prevMatchSnapRef.current;
    if (prev && prev.sessionId === activeSession.id) {
      const synth = getSynth();
      if (synth && !synth.muted) {
        if (!prev.isGameWon && isGameWon) {
          synth.gameWon();
        } else if (!prev.isTimerExpired && isTimerExpired) {
          synth.timeUp();
        } else if (
          scoreTeam0 > prev.scoreTeam0 ||
          scoreTeam1 > prev.scoreTeam1
        ) {
          synth.point();
        } else if (servingTeamIdx !== prev.servingTeamIdx) {
          synth.sideOut();
        } else if (serverNum !== prev.serverNum) {
          synth.secondServe();
        }
      }
    }

    prevMatchSnapRef.current = {
      sessionId: activeSession.id,
      scoreTeam0,
      scoreTeam1,
      servingTeamIdx,
      serverNum,
      isGameWon,
      isTimerExpired,
    };
  }, [
    isMatchStarted,
    activeSession,
    scoreTeam0,
    scoreTeam1,
    servingTeamIdx,
    serverNum,
  ]);

  // ===========================================================================
  // DEV / FIXTURE MODE
  // - Live projected screen fixtures: ?fixture=live | live-singles | live-paused | live-abandon | live-long
  // - Standby poster fixtures: ?fixture=1 | figma | singles | empty | initials | motion
  // ===========================================================================
  if (fixtureMode) {
    if (PROJECTED_FIXTURES[fixtureMode]) {
      const liveFixture = PROJECTED_FIXTURES[fixtureMode];
      return (
        <ProjectedScoreboard
          {...liveFixture}
          muted={muted}
          onToggleMute={handleToggleMute}
          onUnpairTv={handleUnpairTv}
          controlsVisible={posterControlsVisible}
          onRevealControls={revealPosterControls}
        />
      );
    }
    const key =
      fixtureMode === '1' || fixtureMode === 'true' || fixtureMode === 'poster'
        ? 'doubles'
        : fixtureMode;
    const fixtureProps =
      STANDBY_POSTER_FIXTURES[key] || STANDBY_POSTER_FIXTURES.doubles;
    return <StandbyPoster {...fixtureProps} />;
  }

  // ===========================================================================
  // VIEW 1: UNPAIRED TV — DISPLAY UMPIRE PAIRING QR CODE
  // ===========================================================================
  if (!pairedCourt) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#021024] text-[#FFFFFF] flex flex-col justify-between font-sans">
        <AmbientCourtMotif variant="full" opacity={0.55} />

        {/* Top Broadcast Header */}
        <header className="relative z-10 h-[72px] px-6 sm:px-10 bg-[#021024]/90 backdrop-blur-md border-b border-[#11263C] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PikolScoreLogo size="md" />
            <span className="ml-1 rounded-full bg-[#07192B] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#00E5B8] border border-[#24425E] flex items-center gap-1.5">
              <Tv size={13} />
              <span>TV Screen View</span>
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleToggleMute}
              className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-[#07192B] border border-[#24425E] text-xs font-semibold text-[#FFFFFF] hover:border-[#00E5B8] transition-colors cursor-pointer"
            >
              {muted ? (
                <VolumeX size={15} className="text-[#F4A261]" />
              ) : (
                <Volume2 size={15} className="text-[#00E5B8]" />
              )}
              <span>{muted ? 'Sound Muted' : 'Sound On'}</span>
            </button>
            <Link
              href="/umpire"
              className="px-3.5 py-2 rounded-[10px] bg-[#07192B] border border-[#24425E] hover:border-[#00E5B8] text-xs font-semibold text-[#B0C4D8] hover:text-[#FFFFFF] no-underline transition-colors"
            >
              Umpire Console
            </Link>
          </div>
        </header>

        {/* Center Pairing Card */}
        <main className="relative z-10 my-auto max-w-5xl mx-auto w-full px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#0B2239] text-[#FFFFFF] rounded-[20px] p-7 sm:p-10 shadow-2xl border border-[#24425E] dv-top-accent">
            {/* Left: Big QR Code inside Dark Recessed Showcase */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center bg-[#07192B] p-6 rounded-[16px] border border-[#24425E]">
              <div className="bg-[#FFFFFF] p-4 rounded-[16px] shadow-md">
                {pairingQrSvg ? (
                  <div
                    className="w-56 h-56 sm:w-60 sm:h-60 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: pairingQrSvg }}
                  />
                ) : (
                  <div className="w-56 h-56 flex items-center justify-center">
                    <Loader2 size={36} className="animate-spin text-[#021024]" />
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#00E5B8]">
                <QrCode size={14} />
                <span>Umpire Pairing QR</span>
              </div>
              {tvId && (
                <div className="mt-2 px-3 py-1 rounded-[10px] bg-[#021024] border border-[#24425E] font-mono text-xs font-bold tracking-[0.14em] text-[#B0C4D8]">
                  {tvId}
                </div>
              )}
            </div>

            {/* Right: Instructions & Direct Court Picker */}
            <div className="lg:col-span-7 flex flex-col gap-5">
              <div className="inline-flex items-center gap-2 self-start rounded-full bg-[#07192B] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#00E5B8] border border-[#24425E]">
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00E5B8] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00E5B8]" />
                </span>
                <span>Ready to Pair Courtside TV</span>
              </div>

              <h1 className="font-display font-extrabold italic uppercase text-4xl sm:text-5xl text-[#FFFFFF] tracking-tight m-0 leading-[1.02]">
                Scan with Umpire Phone to Connect Court
              </h1>

              <p className="text-sm sm:text-base text-[#B0C4D8] m-0 leading-relaxed">
                Point the officiating umpire&apos;s phone camera at this QR code. This TV will automatically link to the umpire&apos;s court and display the live scoreboard.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3.5 rounded-[14px] bg-[#07192B] border border-[#24425E]">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#00E5B8]">
                    Step 1
                  </div>
                  <div className="text-sm font-bold text-[#FFFFFF] mt-1">
                    Umpire Scans QR
                  </div>
                  <div className="text-xs text-[#6C87A3] mt-0.5 leading-snug">
                    Links TV to the umpire&apos;s assigned court.
                  </div>
                </div>

                <div className="p-3.5 rounded-[14px] bg-[#07192B] border border-[#24425E]">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#00E5B8]">
                    Step 2
                  </div>
                  <div className="text-sm font-bold text-[#FFFFFF] mt-1">
                    Pre-Match Lobby
                  </div>
                  <div className="text-xs text-[#6C87A3] mt-0.5 leading-snug">
                    Shows player slots &amp; court join QR.
                  </div>
                </div>

                <div className="p-3.5 rounded-[14px] bg-[#07192B] border border-[#24425E]">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#00E5B8]">
                    Step 3
                  </div>
                  <div className="text-sm font-bold text-[#FFFFFF] mt-1">
                    Live Scoreboard
                  </div>
                  <div className="text-xs text-[#6C87A3] mt-0.5 leading-snug">
                    Serving : Receiving : Server # view.
                  </div>
                </div>
              </div>

              {/* Optional TV Remote Quick-Select Fallback */}
              <div className="pt-4 border-t border-[#11263C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D8E4F0] whitespace-nowrap">
                  Or select court with TV remote:
                </span>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
                  {[1, 2, 3, 4].map((cNum) => (
                    <button
                      key={cNum}
                      type="button"
                      onClick={() => activateCourtPairing(cNum)}
                      className="px-3 py-2 rounded-[10px] bg-[#07192B] hover:bg-[#00E5B8] text-[#FFFFFF] hover:text-[#031B28] border border-[#24425E] hover:border-[#00E5B8] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer"
                    >
                      Court {cNum}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="relative z-10 w-full px-6 sm:px-10 py-4 border-t border-[#11263C] bg-[#021024]/85 flex items-center justify-between text-xs text-[#8CA2B8]">
          <span>Device ID: {tvId}</span>
          <button
            type="button"
            onClick={() => {
              const nextId = generateTvId();
              setTvId(nextId);
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(TV_ID_STORAGE_KEY, nextId);
              }
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#00E5B8] hover:text-[#05DFB4] hover:underline bg-transparent border-0 cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>Refresh Pairing Code</span>
          </button>
        </footer>
      </div>
    );
  }

  // ===========================================================================
  // LOADING SPLASH WHILE PAIRED COURT SESSION STATE IS BEING FETCHED
  // ===========================================================================
  if (isLoading) {
    return (
      <div
        className="fixed inset-0 bg-[#021024] flex flex-col items-center justify-center gap-4 font-sans"
        aria-busy="true"
      >
        <PikolScoreLogo size="lg" />
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#B0C4D8]">
          <span className="h-2 w-2 rounded-full bg-[#00E5B8] animate-ping" />
          <span>Syncing Court {pairedCourt}...</span>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // VIEW 3: ACTIVE MATCH — PROJECTED ROLE-BASED SCOREBOARD (rendered behind poster during fade)
  // Cards placed by ROLE: LEFT = Serving, RIGHT = Receiving
  // ===========================================================================
  const renderScoreboard = () => {
    if (!isMatchStarted || !activeSession) return null;

    const projectedProps = buildProjectedViewProps(activeSession, pairedCourt);

    return (
      <ProjectedScoreboard
        {...projectedProps}
        muted={muted}
        onToggleMute={handleToggleMute}
        onUnpairTv={handleUnpairTv}
        controlsVisible={posterControlsVisible}
        onRevealControls={revealPosterControls}
        abandonCountdown={abandonCountdown}
      />
    );
  };

  // ===========================================================================
  // VIEW 2: STANDBY POSTER + ~300ms CROSSFADE INTO SCOREBOARD
  // Unmounts completely once match is live and fade completes
  // ===========================================================================
  const shouldRenderPoster = !isMatchStarted || showPoster;

  return (
    <>
      {renderScoreboard()}

      {shouldRenderPoster && (
        <div
          className={`fixed inset-0 z-50 font-sans transition-opacity duration-300 ease-out motion-reduce:duration-0 ${
            isPosterFading ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          onMouseMove={revealPosterControls}
          onPointerDown={revealPosterControls}
          onTouchStart={revealPosterControls}
          onFocusCapture={revealPosterControls}
        >
          <StandbyPoster {...posterProps} />

          {/* Subtle auto-hiding TV controls on pointer move / touch / focus */}
          <div
            className={`fixed top-5 right-6 z-[60] flex items-center gap-2 rounded-full bg-[#0B2239]/95 backdrop-blur-md border border-[#24425E] px-3 py-1.5 shadow-lg transition-opacity duration-200 focus-within:opacity-100 focus-within:pointer-events-auto ${
              posterControlsVisible && !isPosterFading
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="px-2 text-[11px] font-bold tracking-[0.12em] uppercase text-[#00E5B8]">
              Court {pairedCourt}
            </span>
            <button
              type="button"
              onClick={handleToggleMute}
              tabIndex={isPosterFading ? -1 : 0}
              className="flex items-center gap-1.5 rounded-full bg-[#07192B] border border-[#24425E] hover:border-[#00E5B8] px-3 py-1.5 text-xs font-semibold text-[#FFFFFF] transition-colors cursor-pointer"
              aria-label={muted ? 'Unmute TV sound' : 'Mute TV sound'}
            >
              {muted ? (
                <VolumeX size={14} className="text-[#F4A261]" />
              ) : (
                <Volume2 size={14} className="text-[#00E5B8]" />
              )}
              <span>{muted ? 'Muted' : 'Sound'}</span>
            </button>
            <button
              type="button"
              onClick={handleUnpairTv}
              tabIndex={isPosterFading ? -1 : 0}
              className="flex items-center gap-1.5 rounded-full bg-[#07192B] border border-[#24425E] hover:border-[#F47067]/60 hover:text-[#F47067] px-3 py-1.5 text-xs font-semibold text-[#B0C4D8] transition-colors cursor-pointer"
              title="Unpair TV or switch court"
              aria-label="Unpair TV or change court"
            >
              <Unlink size={14} />
              <span>Change Court</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
