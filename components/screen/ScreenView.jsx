'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Outfit } from 'next/font/google';
import {
  Tv,
  QrCode,
  Volume2,
  VolumeX,
  Timer,
  Shield,
  Users,
  RefreshCw,
  Unlink,
  Check,
  Loader2,
  Trophy,
  ArrowLeftRight,
  AlertTriangle,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/config/supabase';
import FlipDigit from '@/components/scoreboard/FlipDigit';
import { formatMmSs } from '@/hooks/useMatchTimer';
import { getSynth } from '@/lib/audio';
import {
  TV_ID_STORAGE_KEY,
  PAIRED_COURT_STORAGE_KEY,
  TV_RETURN_TO_ROLE_KEY,
  generateTvId,
  normalizeTvId,
} from '@/lib/tv-pairing';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

const TV_MUTED_STORAGE_KEY = 'pikol_tv_muted';

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
  const [courtsData, setCourtsData] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [pairingQrSvg, setPairingQrSvg] = useState('');
  const [courtQrSvg, setCourtQrSvg] = useState('');
  const [sideOutNotice, setSideOutNotice] = useState('');
  const [abandonCountdown, setAbandonCountdown] = useState(null); // 5..0 when match is abandoned
  const [, setTick] = useState(0);

  // Refs for tracking score/serve transitions & FLIP animation on side-out
  const prevMatchSnapRef = useRef(null);
  const servingCardRef = useRef(null);
  const receivingCardRef = useRef(null);
  const prevServingTeamRef = useRef(null);
  const beforeRectsRef = useRef(null);
  const pairedCourtRef = useRef(null);
  pairedCourtRef.current = pairedCourt;
  const courtsDataRef = useRef({});
  courtsDataRef.current = courtsData;
  const abandonTriggeredRef = useRef(false);
  const completedRedirectRef = useRef(false);

  // 1. Initialize TV device ID, saved paired court, and audio mute preference
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const urlCourt = Number(params.get('court'));

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
    prevMatchSnapRef.current = null;
    abandonTriggeredRef.current = false;
    completedRedirectRef.current = false;
    const freshId = generateTvId();
    setTvId(freshId);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PAIRED_COURT_STORAGE_KEY);
      window.localStorage.setItem(TV_ID_STORAGE_KEY, freshId);
      window.sessionStorage.setItem(TV_RETURN_TO_ROLE_KEY, '1');
    }
    router.replace('/umpire');
  }, [router]);

  // Trigger 5-second "Abandon the match" prompt before returning to /role
  const triggerAbandonPrompt = useCallback(() => {
    if (abandonTriggeredRef.current || completedRedirectRef.current) return;
    abandonTriggeredRef.current = true;
    const synth = getSynth();
    if (synth && !synth.muted) {
      synth.timeUp();
    }
    setAbandonCountdown(5);
  }, []);

  // Trigger immediate return to /role when match is completed & closed
  const triggerCompletedReturnToRole = useCallback(() => {
    if (completedRedirectRef.current || abandonTriggeredRef.current) return;
    completedRedirectRef.current = true;
    handleUnpairTv();
  }, [handleUnpairTv]);

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
          let cNum = getCourtNumber(newRow) || getCourtNumber(oldRow);
          if (!cNum && rowId) {
            const matchedEntry = Object.entries(courtsDataRef.current).find(
              ([, s]) => s?.id === rowId
            );
            if (matchedEntry) cNum = Number(matchedEntry[0]);
          }
          if (!cNum || cNum < 1 || cNum > 4) return;

          const currentPaired = pairedCourtRef.current;
          const closedReason = newRow?.player_names?.tvClosedReason;

          // If this update is for our currently paired court, check if the match was abandoned or ended
          if (currentPaired && cNum === currentPaired) {
            if (closedReason === 'abandoned' || newRow?.status === 'abandoned') {
              triggerAbandonPrompt();
              return;
            }
            if (closedReason === 'completed') {
              triggerCompletedReturnToRole();
              return;
            }
            if (newRow?.status === 'completed') {
              // Wait briefly in case this completion is part of a Rematch creating a new session on the same court
              setTimeout(async () => {
                if (abandonTriggeredRef.current || completedRedirectRef.current) return;
                const { data: activeOnCourt } = await supabase
                  .from('match_sessions')
                  .select('id, court_number, player_names, status')
                  .eq('status', 'in_progress');
                const replacement = (activeOnCourt || []).find(
                  (r) => getCourtNumber(r) === cNum && r.id !== rowId
                );
                if (replacement) {
                  setCourtsData((prev) => ({ ...prev, [cNum]: replacement }));
                } else {
                  triggerCompletedReturnToRole();
                }
              }, 700);
              return;
            }
          }

          if (
            eventType !== 'DELETE' &&
            newRow?.status === 'in_progress' &&
            !closedReason &&
            Array.isArray(newRow?.player_names?.pairedTvIds) &&
            newRow.player_names.pairedTvIds.includes(tvId)
          ) {
            activateCourtPairing(cNum);
          }

          setCourtsData((prev) => {
            const next = { ...prev };
            if (
              eventType === 'DELETE' ||
              (newRow && newRow.status !== 'in_progress')
            ) {
              if (
                next[cNum]?.id === rowId &&
                !abandonTriggeredRef.current
              ) {
                delete next[cNum];
              }
            } else if (newRow && newRow.status === 'in_progress') {
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
          completedRedirectRef.current = false;
          setAbandonCountdown(null);
          activateCourtPairing(targetCourt);
          fetchCourts(tvId);
        }
      })
      .on('broadcast', { event: 'court_closed' }, (msg) => {
        const reason = msg?.payload?.reason;
        if (reason === 'abandoned') {
          triggerAbandonPrompt();
        } else if (reason === 'completed') {
          triggerCompletedReturnToRole();
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
    triggerCompletedReturnToRole,
  ]);

  // 3b. Subscribe to court-level broadcast channel `tv_court:<pairedCourt>`
  useEffect(() => {
    if (!pairedCourt || pairedCourt < 1 || pairedCourt > 4) return;

    const courtChannel = supabase
      .channel(`tv_court:${pairedCourt}`)
      .on('broadcast', { event: 'court_closed' }, (msg) => {
        const reason = msg?.payload?.reason;
        if (reason === 'abandoned') {
          triggerAbandonPrompt();
        } else if (reason === 'completed') {
          triggerCompletedReturnToRole();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(courtChannel);
    };
  }, [pairedCourt, triggerAbandonPrompt, triggerCompletedReturnToRole]);

  // 4. 1-second timer tick for live match countdown
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 5. Generate QR Code SVGs
  const pairingUrl = useMemo(() => {
    if (typeof window === 'undefined' || !tvId) return '';
    return `${window.location.origin}/?tv=${encodeURIComponent(tvId)}`;
  }, [tvId]);

  const playerCourtUrl = useMemo(() => {
    if (typeof window === 'undefined' || !pairedCourt) return '';
    return `${window.location.origin}/?court=${encodeURIComponent(pairedCourt)}`;
  }, [pairedCourt]);

  useEffect(() => {
    if (!pairingUrl) return;
    let mounted = true;
    QRCode.toString(
      pairingUrl,
      {
        type: 'svg',
        margin: 1,
        color: { dark: '#084B46', light: '#FEFEFB' },
      },
      (err, svg) => {
        if (!err && mounted) setPairingQrSvg(svg);
      }
    );
    return () => {
      mounted = false;
    };
  }, [pairingUrl]);

  useEffect(() => {
    if (!playerCourtUrl) return;
    let mounted = true;
    QRCode.toString(
      playerCourtUrl,
      {
        type: 'svg',
        margin: 1,
        color: { dark: '#084B46', light: '#FEFEFB' },
      },
      (err, svg) => {
        if (!err && mounted) setCourtQrSvg(svg);
      }
    );
    return () => {
      mounted = false;
    };
  }, [playerCourtUrl]);

  // Current paired court session (keep last active session frozen in background during 5s abandon countdown)
  const rawCourtSession = pairedCourt ? courtsData[pairedCourt] || null : null;
  const lastStartedSessionRef = useRef(null);
  if (
    rawCourtSession &&
    rawCourtSession.status === 'in_progress' &&
    rawCourtSession.player_names?.lobbyLocked === true
  ) {
    lastStartedSessionRef.current = rawCourtSession;
  }
  const activeSession =
    rawCourtSession ||
    (abandonCountdown !== null ? lastStartedSessionRef.current : null);
  const isMatchStarted = Boolean(
    activeSession &&
      (activeSession.status === 'in_progress' || abandonCountdown !== null) &&
      activeSession.player_names?.lobbyLocked === true
  );

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
        completedRedirectRef.current
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

        const closedReason = data?.player_names?.tvClosedReason;
        if (closedReason === 'abandoned' || data?.status === 'abandoned') {
          triggerAbandonPrompt();
          return;
        }
        if (closedReason === 'completed') {
          triggerCompletedReturnToRole();
          return;
        }

        // Because RLS for anon only allows status IN ('in_progress', 'completed'),
        // data === null means the session status transitioned to 'abandoned'!
        if (!data) {
          triggerAbandonPrompt();
          return;
        }

        if (data.status === 'completed') {
          const { data: activeOnCourt } = await supabase
            .from('match_sessions')
            .select('id, court_number, player_names, status')
            .eq('status', 'in_progress');
          const replacement = (activeOnCourt || []).find(
            (r) => getCourtNumber(r) === pairedCourt && r.id !== watchedId
          );
          if (replacement) {
            setCourtsData((prev) => ({ ...prev, [pairedCourt]: replacement }));
          } else {
            triggerCompletedReturnToRole();
          }
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
    triggerCompletedReturnToRole,
  ]);

  // Compute live match metrics when match is started
  const servingTeamIdx = activeSession?.serving_team ?? 0;
  const receivingTeamIdx = 1 - servingTeamIdx;
  const serverNum = activeSession?.server_number ?? 2;
  const scoreTeam0 = activeSession?.score_team0 ?? 0;
  const scoreTeam1 = activeSession?.score_team1 ?? 0;

  // Capture bounding rects right before servingTeamIdx changes so we can FLIP-animate the two cards swapping!
  if (
    isMatchStarted &&
    prevServingTeamRef.current !== null &&
    prevServingTeamRef.current !== servingTeamIdx &&
    servingCardRef.current &&
    receivingCardRef.current
  ) {
    beforeRectsRef.current = {
      serving: servingCardRef.current.getBoundingClientRect(),
      receiving: receivingCardRef.current.getBoundingClientRect(),
    };
  }

  useIsoLayoutEffect(() => {
    if (!isMatchStarted) {
      prevServingTeamRef.current = null;
      beforeRectsRef.current = null;
      return;
    }

    if (
      prevServingTeamRef.current !== null &&
      prevServingTeamRef.current !== servingTeamIdx
    ) {
      const before = beforeRectsRef.current;
      beforeRectsRef.current = null;

      const tNames = activeSession?.team_names || ['Team A', 'Team B'];
      const newServingName =
        tNames[servingTeamIdx] || (servingTeamIdx === 0 ? 'Team A' : 'Team B');
      setSideOutNotice(`SIDE OUT · ${newServingName} Now Serving`);
      const clearTimer = setTimeout(() => setSideOutNotice(''), 3200);

      // Animate swap between Left (Serving) and Center (Receiving) cards
      if (
        before &&
        servingCardRef.current &&
        receivingCardRef.current &&
        typeof servingCardRef.current.animate === 'function'
      ) {
        const afterServing = servingCardRef.current.getBoundingClientRect();
        const afterReceiving = receivingCardRef.current.getBoundingClientRect();
        const dxS = before.receiving.left - afterServing.left;
        const dyS = before.receiving.top - afterServing.top;
        const dxR = before.serving.left - afterReceiving.left;
        const dyR = before.serving.top - afterReceiving.top;

        if (dxS !== 0 || dyS !== 0) {
          servingCardRef.current.animate(
            [
              { transform: `translate(${dxS}px, ${dyS}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
        }
        if (dxR !== 0 || dyR !== 0) {
          receivingCardRef.current.animate(
            [
              { transform: `translate(${dxR}px, ${dyR}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
        }
      }

      prevServingTeamRef.current = servingTeamIdx;
      return () => clearTimeout(clearTimer);
    }

    prevServingTeamRef.current = servingTeamIdx;
  }, [isMatchStarted, servingTeamIdx, activeSession?.team_names]);

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
  // VIEW 1: UNPAIRED TV — DISPLAY UMPIRE PAIRING QR CODE
  // ===========================================================================
  if (!pairedCourt) {
    return (
      <div
        className={`${outfit.className} min-h-screen bg-[#084B46] text-[#FEFEFB] flex flex-col justify-between p-6 sm:p-10 font-outfit`}
      >
        {/* Top Header */}
        <header className="flex items-center justify-between max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <svg width="42" height="42" viewBox="0 0 40 40" aria-hidden="true">
              <rect width="40" height="40" rx="12" fill="#0F5C62" />
              <circle cx="20" cy="20" r="10" fill="#FEECD6" />
              <circle cx="16.5" cy="16.5" r="1.6" fill="#084B46" />
              <circle cx="23.5" cy="19" r="1.6" fill="#084B46" />
              <circle cx="19" cy="24" r="1.6" fill="#084B46" />
            </svg>
            <span className="text-2xl font-black tracking-tight text-white">
              PIKOLSCORE
            </span>
            <span className="ml-2 rounded-full bg-[#0F5C62] px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#FEECD6] border border-[#FEECD6]/20 flex items-center gap-1.5">
              <Tv size={14} />
              <span>TV Screen View</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleMute}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#0F5C62] text-xs font-bold text-[#FEECD6] hover:bg-[#0F5C62]/80 transition-colors cursor-pointer border border-[#FEECD6]/20"
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{muted ? 'Sound Muted' : 'Sound On'}</span>
            </button>
            <Link
              href="/umpire"
              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-[#EAF0E5] no-underline transition-colors"
            >
              Umpire Console
            </Link>
          </div>
        </header>

        {/* Center Pairing Card */}
        <main className="my-auto max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#FAF9F5] text-[#203F39] rounded-[36px] p-8 sm:p-12 shadow-2xl border-2 border-[#E2E5DC]">
          {/* Left: Big QR Code */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center bg-white p-6 rounded-3xl border-2 border-[#0F5C62]/20 shadow-md">
            {pairingQrSvg ? (
              <div
                className="w-60 h-60 sm:w-64 sm:h-64 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: pairingQrSvg }}
              />
            ) : (
              <div className="w-60 h-60 flex items-center justify-center">
                <Loader2 size={36} className="animate-spin text-[#0F5C62]" />
              </div>
            )}
            <div className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#0F5C62]">
              <QrCode size={15} />
              <span>Umpire Pairing QR</span>
            </div>
          </div>

          {/* Right: Instructions & Direct Court Picker */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-[#EAF0E5] px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#0F5C62] border border-[#E2E5DC]">
              <span className="h-2 w-2 rounded-full bg-[#0F5C62] animate-ping" />
              <span>Ready to Pair Courtside TV</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#084B46] tracking-tight m-0 leading-tight">
              Scan with Umpire Phone to Connect Court
            </h1>

            <p className="text-base text-[#203F39] m-0 leading-relaxed">
              Point the officiating umpire&apos;s phone camera at this QR code. This TV will automatically link to the umpire&apos;s court and display the live scoreboard.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3.5 rounded-2xl bg-[#EAF0E5]/60 border border-[#E2E5DC]">
                <div className="text-xs font-black uppercase text-[#0F5C62]">
                  Step 1
                </div>
                <div className="text-sm font-bold text-[#084B46] mt-0.5">
                  Umpire Scans QR
                </div>
                <div className="text-xs text-[#748079] mt-0.5">
                  Links TV to the umpire&apos;s assigned court.
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#EAF0E5]/60 border border-[#E2E5DC]">
                <div className="text-xs font-black uppercase text-[#0F5C62]">
                  Step 2
                </div>
                <div className="text-sm font-bold text-[#084B46] mt-0.5">
                  Pre-Match Lobby
                </div>
                <div className="text-xs text-[#748079] mt-0.5">
                  Shows player slots &amp; court join QR.
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#EAF0E5]/60 border border-[#E2E5DC]">
                <div className="text-xs font-black uppercase text-[#0F5C62]">
                  Step 3
                </div>
                <div className="text-sm font-bold text-[#084B46] mt-0.5">
                  Live Scoreboard
                </div>
                <div className="text-xs text-[#748079] mt-0.5">
                  Serving : Receiving : Server # view.
                </div>
              </div>
            </div>

            {/* Optional TV Remote Quick-Select Fallback */}
            <div className="pt-4 border-t border-[#E2E5DC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#748079]">
                Or select court with TV remote:
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {[1, 2, 3, 4].map((cNum) => (
                  <button
                    key={cNum}
                    type="button"
                    onClick={() => activateCourtPairing(cNum)}
                    className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#0F5C62] text-[#084B46] hover:text-[#FEECD6] border border-[#E2E5DC] text-xs font-bold transition-colors cursor-pointer"
                  >
                    Court {cNum}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="max-w-6xl mx-auto w-full flex items-center justify-between text-xs text-[#EAF0E5]/70">
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
            className="flex items-center gap-1.5 text-xs font-semibold text-[#FEECD6] hover:underline bg-transparent border-0 cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>Refresh Pairing Code</span>
          </button>
        </footer>
      </div>
    );
  }

  // ===========================================================================
  // VIEW 2: PAIRED TO COURT (1..4) — PRE-MATCH LOBBY PHASE
  // ===========================================================================
  if (!isMatchStarted) {
    const umpireName = activeSession?.player_names?.umpireName || null;
    const assignedUmpireId = getAssignedUmpireId(activeSession);
    const pSlots = activeSession?.player_names?.slots || {};
    const team0Slots = pSlots.team0 || [null, null];
    const team1Slots = pSlots.team1 || [null, null];
    const teamNames = activeSession?.team_names || ['Team A', 'Team B'];

    const filledCount =
      (team0Slots[0]?.name ? 1 : 0) +
      (team0Slots[1]?.name ? 1 : 0) +
      (team1Slots[0]?.name ? 1 : 0) +
      (team1Slots[1]?.name ? 1 : 0);

    return (
      <div
        className={`${outfit.className} min-h-screen bg-[#FAF9F5] text-[#203F39] flex flex-col justify-between font-outfit`}
      >
        {/* Top Broadcast Bar */}
        <header className="h-20 px-6 sm:px-10 bg-[#FEFEFB] border-b border-[#E2E5DC] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true">
              <rect width="40" height="40" rx="10" fill="#0F5C62" />
              <circle cx="20" cy="20" r="8" fill="#FEECD6" />
              <circle cx="17" cy="17" r="1.3" fill="#084B46" />
              <circle cx="23" cy="19" r="1.3" fill="#084B46" />
              <circle cx="19" cy="23" r="1.3" fill="#084B46" />
            </svg>
            <span className="text-2xl font-black text-[#084B46] tracking-tight">
              PIKOLSCORE
            </span>
            <span className="ml-2 rounded-full bg-[#0F5C62] px-4 py-1 text-sm font-bold text-[#FEECD6]">
              Court {pairedCourt}
            </span>
            <span className="rounded-full bg-[#EAF0E5] px-3.5 py-1 text-xs font-bold text-[#0F5C62] border border-[#E2E5DC] flex items-center gap-1.5">
              <Shield size={14} />
              <span>
                {assignedUmpireId
                  ? `Umpire: ${umpireName || 'Official Umpire'}`
                  : 'Waiting for Umpire'}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleMute}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] text-xs font-bold text-[#084B46] hover:bg-[#EAF0E5] transition-colors cursor-pointer"
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{muted ? 'Muted' : 'Sound On'}</span>
            </button>
            <button
              type="button"
              onClick={handleUnpairTv}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] text-xs font-semibold text-[#748079] hover:text-[#BA1A1A] hover:border-red-200 transition-colors cursor-pointer"
              title="Unpair TV or switch court"
            >
              <Unlink size={14} />
              <span>Change Court / Unpair</span>
            </button>
          </div>
        </header>

        {/* Main Pre-Match Court Lobby Content */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-6 sm:px-10 py-8 flex flex-col justify-center gap-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left Column: Player Court Join QR Code */}
            <div className="lg:col-span-5 rounded-[32px] bg-[#FEFEFB] border-2 border-[#E2E5DC] p-8 flex flex-col items-center justify-center text-center shadow-sm">
              <span className="rounded-full bg-[#EAF0E5] px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#0F5C62] border border-[#E2E5DC] mb-4">
                Player Check-In QR
              </span>
              <div className="bg-white p-5 rounded-3xl border-2 border-[#0F5C62]/20 shadow-sm">
                {courtQrSvg ? (
                  <div
                    className="w-52 h-52 sm:w-56 sm:h-56 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: courtQrSvg }}
                  />
                ) : (
                  <div className="w-52 h-52 flex items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-[#0F5C62]" />
                  </div>
                )}
              </div>
              <h2 className="text-xl font-extrabold text-[#084B46] mt-5 mb-1">
                Scan to Join Court {pairedCourt}
              </h2>
              <p className="text-sm text-[#748079] m-0 max-w-xs">
                Players can scan this QR code with their phone to claim a Team A or Team B slot.
              </p>
            </div>

            {/* Right Column: Live Team A & Team B Roster Slots */}
            <div className="lg:col-span-7 rounded-[32px] bg-[#FEFEFB] border-2 border-[#E2E5DC] p-8 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between pb-4 mb-6 border-b border-[#E2E5DC]">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-widest text-[#0F5C62]">
                      Pre-Match Court Lobby
                    </span>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-[#084B46] m-0 mt-0.5">
                      Court {pairedCourt} Player Roster
                    </h1>
                  </div>
                  <div className="rounded-2xl bg-[#EAF0E5] px-4 py-2 border border-[#E2E5DC] text-right">
                    <div className="text-xs font-bold uppercase text-[#748079]">
                      Slots Claimed
                    </div>
                    <div className="text-2xl font-black text-[#084B46]">
                      {filledCount} / 4
                    </div>
                  </div>
                </div>

                {/* 2 Teams Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Team A */}
                  <div className="rounded-2xl bg-[#EAF0E5]/50 border border-[#E2E5DC] p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-extrabold text-[#084B46]">
                        {teamNames[0] || 'Team A'}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#0F5C62]">
                        Side 1
                      </span>
                    </div>
                    {[0, 1].map((sIdx) => {
                      const slot = team0Slots[sIdx];
                      const hasPlayer = Boolean(slot?.name?.trim());
                      return (
                        <div
                          key={`tv-t0-${sIdx}`}
                          className={`h-14 px-4 rounded-xl border flex items-center justify-between ${
                            hasPlayer
                              ? 'bg-white border-[#0F5C62] shadow-sm'
                              : 'bg-[#FAF9F5] border-dashed border-[#E2E5DC]'
                          }`}
                        >
                          {hasPlayer ? (
                            <>
                              <span className="text-base font-bold text-[#084B46] truncate">
                                {slot.name}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF0E5] px-2.5 py-0.5 text-[11px] font-bold text-[#0F5C62]">
                                <Check size={12} /> Ready
                              </span>
                            </>
                          ) : (
                            <span className="text-sm font-medium text-[#748079] italic">
                              Slot {sIdx + 1} · Open
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Team B */}
                  <div className="rounded-2xl bg-[#EAF0E5]/50 border border-[#E2E5DC] p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-extrabold text-[#084B46]">
                        {teamNames[1] || 'Team B'}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#0F5C62]">
                        Side 2
                      </span>
                    </div>
                    {[0, 1].map((sIdx) => {
                      const slot = team1Slots[sIdx];
                      const hasPlayer = Boolean(slot?.name?.trim());
                      return (
                        <div
                          key={`tv-t1-${sIdx}`}
                          className={`h-14 px-4 rounded-xl border flex items-center justify-between ${
                            hasPlayer
                              ? 'bg-white border-[#0F5C62] shadow-sm'
                              : 'bg-[#FAF9F5] border-dashed border-[#E2E5DC]'
                          }`}
                        >
                          {hasPlayer ? (
                            <>
                              <span className="text-base font-bold text-[#084B46] truncate">
                                {slot.name}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF0E5] px-2.5 py-0.5 text-[11px] font-bold text-[#0F5C62]">
                                <Check size={12} /> Ready
                              </span>
                            </>
                          ) : (
                            <span className="text-sm font-medium text-[#748079] italic">
                              Slot {sIdx + 1} · Open
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bottom Status Bar */}
              <div className="mt-6 p-4 rounded-2xl bg-[#084B46] text-[#FEFEFB] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEECD6] animate-pulse" />
                  <span className="text-sm font-bold">
                    {filledCount === 4
                      ? 'All 4 Players Registered — Waiting for Umpire to Start Match (30:00)'
                      : `Waiting for ${4 - filledCount} more player${
                          4 - filledCount === 1 ? '' : 's'
                        } to join Court ${pairedCourt}...`}
                  </span>
                </div>
                <span className="text-xs font-semibold text-[#FEECD6]">
                  Auto-starts on Umpire signal
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ===========================================================================
  // VIEW 3: ACTIVE MATCH — 3-CARD SIDE-OUT SCOREBOARD
  // Pattern: [Serving Team Score] : [Receiving Team Score] : [Server #]
  // ===========================================================================
  const tNames = activeSession.team_names || ['Team A', 'Team B'];
  const pNames = activeSession.player_names || {};
  const slots = pNames.slots || {};

  const getTeamRosterLabel = (teamIndex) => {
    const key = teamIndex === 0 ? 'team0' : 'team1';
    const slotArr = Array.isArray(slots[key]) ? slots[key] : [];
    const namesFromSlots = slotArr
      .map((s) => s?.name?.trim())
      .filter(Boolean);
    if (namesFromSlots.length > 0) return namesFromSlots.join(' & ');

    const flatArr = Array.isArray(pNames[key]) ? pNames[key] : [];
    const namesFromFlat = flatArr.map((n) => n?.trim()).filter(Boolean);
    return namesFromFlat.length > 0 ? namesFromFlat.join(' & ') : '';
  };

  // Left card is ALWAYS the currently Serving Team
  const servingTeamName =
    tNames[servingTeamIdx] || (servingTeamIdx === 0 ? 'Team A' : 'Team B');
  const servingRoster = getTeamRosterLabel(servingTeamIdx);
  const servingScore = servingTeamIdx === 0 ? scoreTeam0 : scoreTeam1;
  const servingPadded = String(servingScore).padStart(2, '0');

  // Center card is ALWAYS the currently Receiving Team
  const receivingTeamName =
    tNames[receivingTeamIdx] || (receivingTeamIdx === 0 ? 'Team A' : 'Team B');
  const receivingRoster = getTeamRosterLabel(receivingTeamIdx);
  const receivingScore = receivingTeamIdx === 0 ? scoreTeam0 : scoreTeam1;
  const receivingPadded = String(receivingScore).padStart(2, '0');

  // Countdown Timer Calculation
  let timerText = '30:00';
  let isTimerExpired = activeSession.timer_status === 'expired';
  if (activeSession.timer_status === 'running' && activeSession.timer_ends_at) {
    const remMs = Math.max(
      0,
      new Date(activeSession.timer_ends_at).getTime() - Date.now()
    );
    timerText = formatMmSs(Math.ceil(remMs / 1000));
    if (remMs === 0) isTimerExpired = true;
  } else if (typeof activeSession.timer_remaining_ms === 'number') {
    timerText = formatMmSs(Math.ceil(activeSession.timer_remaining_ms / 1000));
    if (activeSession.timer_remaining_ms <= 0 && activeSession.timer_status !== 'idle') {
      isTimerExpired = true;
    }
  }

  // Match Win / Draw Detection
  const targetScore = activeSession.target_score || 11;
  const winBy = activeSession.win_by || 2;
  const team0Won = scoreTeam0 >= targetScore && scoreTeam0 - scoreTeam1 >= winBy;
  const team1Won = scoreTeam1 >= targetScore && scoreTeam1 - scoreTeam0 >= winBy;
  const isGameOver = Boolean(
    team0Won || team1Won || isTimerExpired || activeSession.initial_state?.gameOver
  );

  let winnerBannerText = '';
  if (team0Won) {
    winnerBannerText = `🏆 ${tNames[0] || 'Team A'} Wins the Match (${scoreTeam0} – ${scoreTeam1})!`;
  } else if (team1Won) {
    winnerBannerText = `🏆 ${tNames[1] || 'Team B'} Wins the Match (${scoreTeam1} – ${scoreTeam0})!`;
  } else if (isTimerExpired) {
    if (scoreTeam0 > scoreTeam1) {
      winnerBannerText = `⏰ Time Expired · ${tNames[0] || 'Team A'} Wins (${scoreTeam0} – ${scoreTeam1})!`;
    } else if (scoreTeam1 > scoreTeam0) {
      winnerBannerText = `⏰ Time Expired · ${tNames[1] || 'Team B'} Wins (${scoreTeam1} – ${scoreTeam0})!`;
    } else {
      winnerBannerText = `⏰ Time Expired · Match Ended in a Draw (${scoreTeam0} – ${scoreTeam1})!`;
    }
  }

  return (
    <div
      className={`${outfit.className} min-h-screen bg-[#FAF9F5] text-[#203F39] flex flex-col justify-between select-none font-outfit`}
    >
      {/* 1. Minimal Broadcast Top Header */}
      <header className="h-18 px-6 sm:px-10 bg-[#FEFEFB] border-b border-[#E2E5DC] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="10" fill="#0F5C62" />
            <circle cx="20" cy="20" r="8" fill="#FEECD6" />
            <circle cx="17" cy="17" r="1.3" fill="#084B46" />
            <circle cx="23" cy="19" r="1.3" fill="#084B46" />
            <circle cx="19" cy="23" r="1.3" fill="#084B46" />
          </svg>
          <span className="text-xl sm:text-2xl font-black text-[#084B46] tracking-tight">
            PIKOLSCORE
          </span>
          <span className="ml-2 rounded-full bg-[#0F5C62] px-3.5 py-1 text-xs sm:text-sm font-bold text-[#FEECD6]">
            Court {pairedCourt}
          </span>
          {pNames.umpireName && (
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-[#EAF0E5] px-3 py-1 text-xs font-bold text-[#084B46] border border-[#E2E5DC]">
              <Shield size={13} className="text-[#0F5C62]" />
              <span>Umpire: {pNames.umpireName}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleToggleMute}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] text-xs font-bold text-[#084B46] hover:bg-[#EAF0E5] transition-colors cursor-pointer"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            <span>{muted ? 'Muted' : 'Sound On'}</span>
          </button>
          <button
            type="button"
            onClick={handleUnpairTv}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] text-xs font-semibold text-[#748079] hover:text-[#BA1A1A] transition-colors cursor-pointer"
            title="Unpair TV or switch court"
          >
            <Unlink size={14} />
            <span className="hidden sm:inline">Unpair TV</span>
          </button>
        </div>
      </header>

      {/* 2. Centerpiece 3-Card Live Scoreboard */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 max-w-6xl mx-auto w-full gap-5">
        {/* Top Row: Match Countdown Timer + Side-Out / Victory Status Pill */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div
            className={`flex items-center gap-2.5 px-6 py-2.5 rounded-full border shadow-sm ${
              isTimerExpired
                ? 'bg-red-100 border-red-300 text-[#BA1A1A]'
                : activeSession.timer_status === 'paused'
                ? 'bg-[#FEECD6] border-[#0F5C62]/30 text-[#084B46]'
                : 'bg-[#EAF0E5] border-[#E2E5DC] text-[#084B46]'
            }`}
          >
            <Timer size={20} className="text-[#0F5C62]" />
            <span className="font-mono text-2xl sm:text-3xl font-black tracking-tight tabular-nums">
              {timerText}
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-[#748079] ml-1">
              {isTimerExpired
                ? 'Time Expired'
                : activeSession.timer_status === 'paused'
                ? 'Timer Paused'
                : 'Match Countdown'}
            </span>
          </div>

          {sideOutNotice && !isGameOver && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0F5C62] text-[#FEECD6] text-sm font-extrabold uppercase tracking-wider shadow-md animate-in fade-in zoom-in-95"
            >
              <ArrowLeftRight size={16} />
              <span>{sideOutNotice}</span>
            </div>
          )}
        </div>

        {/* Victory / Match Over Banner */}
        {isGameOver && winnerBannerText && (
          <div
            role="status"
            aria-live="assertive"
            className="w-full rounded-3xl bg-[#084B46] text-[#FEECD6] px-6 py-4 border-2 border-[#0F5C62] shadow-lg flex items-center justify-center gap-3 text-center"
          >
            <Trophy size={24} className="shrink-0 text-[#FEECD6]" />
            <span className="text-lg sm:text-2xl font-extrabold tracking-tight">
              {winnerBannerText}
            </span>
          </div>
        )}

        {/* 3-CARD DYNAMIC SIDE-OUT ROW: [Serving Team Score] : [Receiving Team Score] : [Server Number] */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 sm:gap-6 w-full items-stretch">
          {/* CARD 1 (LEFT): ALWAYS THE CURRENTLY SERVING TEAM */}
          <div
            ref={servingCardRef}
            className="sm:col-span-5 rounded-[32px] p-6 sm:p-7 flex flex-col justify-between bg-[#EAF0E5] border-[2.5px] border-[#0F5C62] ring-4 ring-[#0F5C62]/15 shadow-lg transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-xl sm:text-2xl text-[#084B46] tracking-tight truncate">
                    {servingTeamName}
                  </span>
                </div>
                {servingRoster && (
                  <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#203F39] mt-1 truncate">
                    <Users size={14} className="text-[#0F5C62] shrink-0" />
                    <span className="truncate">{servingRoster}</span>
                  </div>
                )}
              </div>

              <span className="shrink-0 text-xs font-extrabold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[#0F5C62] text-[#FEECD6] shadow-sm">
                Serving
              </span>
            </div>

            {/* Serving Team Score Digits */}
            <div className="flex gap-3 justify-center items-center py-3">
              <FlipDigit value={servingPadded[0]} />
              <FlipDigit value={servingPadded[1]} />
            </div>

            <div className="mt-4 text-center text-xs font-bold uppercase tracking-wider text-[#0F5C62]">
              Serving Score (1st Call)
            </div>
          </div>

          {/* CARD 2 (CENTER): ALWAYS THE CURRENTLY RECEIVING TEAM */}
          <div
            ref={receivingCardRef}
            className="sm:col-span-5 rounded-[32px] p-6 sm:p-7 flex flex-col justify-between bg-[#FEFEFB] border-[2px] border-[#E2E5DC] shadow-md transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-xl sm:text-2xl text-[#084B46] tracking-tight truncate">
                    {receivingTeamName}
                  </span>
                </div>
                {receivingRoster && (
                  <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#748079] mt-1 truncate">
                    <Users size={14} className="text-[#748079] shrink-0" />
                    <span className="truncate">{receivingRoster}</span>
                  </div>
                )}
              </div>

              <span className="shrink-0 text-xs font-extrabold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[#E2E5DC] text-[#748079]">
                Receiving
              </span>
            </div>

            {/* Receiving Team Score Digits */}
            <div className="flex gap-3 justify-center items-center py-3">
              <FlipDigit value={receivingPadded[0]} />
              <FlipDigit value={receivingPadded[1]} />
            </div>

            <div className="mt-4 text-center text-xs font-bold uppercase tracking-wider text-[#748079]">
              Receiving Score (2nd Call)
            </div>
          </div>

          {/* CARD 3 (RIGHT): SERVER NUMBER */}
          <div className="sm:col-span-2 rounded-[32px] p-6 sm:p-7 bg-[#085953] border-2 border-[#0F5C62] text-[#FEFEFB] flex flex-col justify-between items-center shadow-lg">
            <span className="text-xs font-extrabold uppercase tracking-widest text-[#FEECD6]">
              Server
            </span>

            <div className="py-3 flex items-center justify-center">
              <FlipDigit value={serverNum} className="ps-fd-sm" />
            </div>

            <span className="text-xs font-bold text-[#FEECD6]/90 text-center uppercase tracking-wider">
              Server #{serverNum}
            </span>
          </div>
        </div>

        {/* Bottom Official Callout Bar */}
        <div className="mt-2 px-6 py-2.5 rounded-full bg-[#FEFEFB] border border-[#E2E5DC] shadow-sm flex items-center gap-3 text-sm font-bold text-[#084B46]">
          <span className="uppercase tracking-wider text-xs text-[#748079]">
            Official Call:
          </span>
          <span className="font-mono text-base font-black text-[#0F5C62]">
            {servingScore} &ndash; {receivingScore} &ndash; {serverNum}
          </span>
          <span className="text-xs font-semibold text-[#203F39]">
            ({servingTeamName} Serving)
          </span>
        </div>
      </main>

      {/* 3. 5-Second "Abandon the match" Prompt Overlay */}
      {abandonCountdown !== null && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="tv-abandon-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#084B46]/85 backdrop-blur-md animate-in fade-in duration-200"
        >
          <div className="w-full max-w-xl rounded-[36px] bg-[#FAF9F5] border-2 border-[#BA1A1A]/30 p-8 sm:p-10 shadow-2xl text-center flex flex-col items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-[#BA1A1A]/10 text-[#BA1A1A] border border-[#BA1A1A]/20 mb-5">
              <AlertTriangle size={42} strokeWidth={2.4} aria-hidden="true" />
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#BA1A1A]/10 px-4 py-1 text-xs font-extrabold uppercase tracking-widest text-[#BA1A1A] mb-3">
              Court {pairedCourt} &middot; Match Terminated
            </span>

            <h2
              id="tv-abandon-title"
              className="text-3xl sm:text-4xl font-black text-[#084B46] tracking-tight m-0 mb-3"
            >
              Abandon the match
            </h2>

            <p className="text-base sm:text-lg text-[#203F39] m-0 mb-6 max-w-md leading-relaxed">
              The officiating umpire has abandoned this match. Returning to the pairing screen in{' '}
              <strong className="text-[#BA1A1A] font-extrabold">
                {Math.max(0, abandonCountdown)} second
                {abandonCountdown === 1 ? '' : 's'}
              </strong>
              ...
            </p>

            {/* Countdown Progress Bar */}
            <div className="w-full max-w-sm h-3 rounded-full bg-[#E2E5DC] overflow-hidden mb-6">
              <div
                className="h-full bg-[#BA1A1A] transition-all duration-1000 ease-linear rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, (abandonCountdown / 5) * 100))}%`,
                }}
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center h-12 px-5 rounded-full bg-[#084B46] text-[#FEECD6] font-mono text-lg font-black">
                {Math.max(0, abandonCountdown)}s
              </div>
              <button
                type="button"
                onClick={handleUnpairTv}
                className="h-12 px-6 rounded-full bg-[#EAF0E5] hover:bg-[#0F5C62] text-[#084B46] hover:text-[#FEECD6] border border-[#E2E5DC] text-sm font-bold transition-colors cursor-pointer"
              >
                Return to Pairing Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
