'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play,
  Shuffle,
  AlertCircle,
  X,
  QrCode,
  Plus,
  Loader2,
  Shield,
  Tv,
  Check,
  ChevronDown,
  Eye,
} from 'lucide-react';
import { supabase } from '@/config/supabase';
import Header from '@/components/layout/Header';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import CourtQrLobbyModal from '@/components/scoreboard/CourtQrLobbyModal';
import ProjectToScreenModal from '@/components/scoreboard/ProjectToScreenModal';
import AmbientCourtMotif from '@/components/ui/AmbientCourtMotif';
import { formatMmSs } from '@/hooks/useMatchTimer';
import { pairTvWithCourt } from '@/lib/tv-pairing';

function getCourtNumber(row) {
  return Number(row?.court_number || row?.player_names?.courtNumber) || null;
}

function getAssignedUmpireId(row) {
  if (row?.player_names && 'umpireId' in row.player_names) {
    return row.player_names.umpireId || null;
  }
  return row?.umpire_id || null;
}

export default function MatchesPage() {
  const router = useRouter();

  // Auth & Profile state
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // 4 Courts State (keyed by court number 1..4)
  const [courtsData, setCourtsData] = useState({});
  const [isLoadingCourts, setIsLoadingCourts] = useState(true);
  const [activeWalkup, setActiveWalkup] = useState(null); // { courtNumber, team, slotIndex }
  const [walkupName, setWalkupName] = useState('');
  const [firstServerMap, setFirstServerMap] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [qrModalCourtNum, setQrModalCourtNum] = useState(null);
  const [projectModalCourtNum, setProjectModalCourtNum] = useState(null);
  const [actionError, setActionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingTvId, setPendingTvId] = useState(null);
  const [tvPairedMessage, setTvPairedMessage] = useState('');
  const [selectedCourt, setSelectedCourt] = useState(null);
  const [isCourtPickerOpen, setIsCourtPickerOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pendingDropdownCourt, setPendingDropdownCourt] = useState(null);
  const dropdownRef = useRef(null);
  const [, setTick] = useState(0);

  // 1. Authenticate user & load profile
  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (!session?.user) {
          router.replace('/umpire');
          return;
        }

        const currentUser = session.user;
        setUser(currentUser);
        setUserEmail(currentUser.email || null);

        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .single();

        if (profileData?.role === 'player') {
          router.replace('/player');
          return;
        }

        if (isMounted) {
          if (profileData) setProfile(profileData);
          setIsAuthLoading(false);
        }
      } catch (err) {
        console.error('[MatchesPage] Auth check error:', err);
        if (isMounted) router.replace('/umpire');
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [router]);

  // 1b. Trap browser back button so authenticated umpires stay on /matches
  useEffect(() => {
    if (isAuthLoading || !user) return;

    window.history.pushState({ page: 'matches' }, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState({ page: 'matches' }, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isAuthLoading, user]);

  // 2. Fetch all 4 active court sessions
  const fetchCourts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('match_sessions')
        .select('*')
        .eq('status', 'in_progress')
        .order('updated_at', { ascending: true });

      if (error) {
        console.warn('[MatchesPage] Error fetching courts:', error);
      } else {
        const map = {};
        (data || []).forEach((row) => {
          const cNum = getCourtNumber(row);
          if (cNum >= 1 && cNum <= 4) {
            map[cNum] = row;
          }
        });
        setCourtsData(map);
      }
    } catch (err) {
      console.error('[MatchesPage] Failed to fetch courts:', err);
    } finally {
      setIsLoadingCourts(false);
    }
  }, []);

  useEffect(() => {
    fetchCourts();
  }, [fetchCourts]);

  // 3. Realtime subscription across all match_sessions
  useEffect(() => {
    const channel = supabase
      .channel('all_courts_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_sessions',
        },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload;
          setCourtsData((prev) => {
            const next = { ...prev };
            const cNum = getCourtNumber(newRow) || getCourtNumber(oldRow);
            if (!cNum || cNum < 1 || cNum > 4) return prev;

            if (eventType === 'DELETE' || (newRow && newRow.status !== 'in_progress')) {
              delete next[cNum];
            } else if (newRow && newRow.status === 'in_progress') {
              next[cNum] = newRow;
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 4. Timer tick for live display
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // 5. Active Match Lock Check: If this umpire is on a STARTED match (lobbyLocked === true), redirect!
  useEffect(() => {
    if (!user?.id || isLoadingCourts) return;

    const search = typeof window !== 'undefined' ? window.location.search : '';
    const tvParam = new URLSearchParams(search).get('tv');

    for (let c = 1; c <= 4; c++) {
      const cSession = courtsData[c];
      if (
        cSession &&
        getAssignedUmpireId(cSession) === user.id &&
        cSession.player_names?.lobbyLocked === true
      ) {
        const destParams = new URLSearchParams();
        destParams.set('session', cSession.id);
        if (tvParam) destParams.set('tv', tvParam);
        router.replace(`/pikolscore?${destParams.toString()}`);
        return;
      }
    }
  }, [user?.id, courtsData, isLoadingCourts, router]);

  // Read ?tv=<tvId> parameter on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const scannedTv = params.get('tv');
    if (scannedTv) {
      setPendingTvId(scannedTv);
    }
  }, []);

  // Auto-join if arriving via ?court=1..4 and currently unassigned
  useEffect(() => {
    if (!user?.id || isLoadingCourts) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const scannedCourt = Number(new URLSearchParams(search).get('court'));
    if (scannedCourt >= 1 && scannedCourt <= 4) {
      const alreadyAssigned = Object.values(courtsData).some(
        (s) => getAssignedUmpireId(s) === user.id
      );
      if (!alreadyAssigned) {
        const targetSession = courtsData[scannedCourt];
        if (!targetSession || !getAssignedUmpireId(targetSession)) {
          handleJoinCourt(scannedCourt);
        }
      }
    }
  }, [user?.id, isLoadingCourts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper to call lobby API with auth token
  const callLobbyApi = async (payload) => {
    setActionError('');
    setIsSubmitting(true);
    try {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      const token = authSession?.access_token || '';

      const res = await fetch('/api/match/lobby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update court');
      }

      const cNum = getCourtNumber(data.session) || Number(payload.courtNumber);
      if (data.session && cNum) {
        setCourtsData((prev) => ({
          ...prev,
          [cNum]: data.session,
        }));
      }
      return data;
    } catch (err) {
      setActionError(err.message || 'Operation failed');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pair a TV screen with a specific court
  const handlePairTvToCourt = useCallback(
    async (courtNumber, explicitTvId = null) => {
      const tvToPair = explicitTvId || pendingTvId;
      if (!tvToPair || !courtNumber) return;
      setActionError('');
      setIsSubmitting(true);
      try {
        const existingSession = courtsData[courtNumber];
        const data = await pairTvWithCourt({
          tvId: tvToPair,
          courtNumber,
          sessionId: existingSession?.id,
        });
        if (data?.session) {
          setCourtsData((prev) => ({
            ...prev,
            [courtNumber]: data.session,
          }));
        }
        setPendingTvId(null);
        setTvPairedMessage(`Connected Courtside TV Screen to Court ${courtNumber}!`);
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.delete('tv');
          window.history.replaceState({}, '', url.pathname + url.search);
        }
        fetchCourts();
      } catch (err) {
        setActionError(err.message || 'Failed to pair TV screen');
      } finally {
        setIsSubmitting(false);
      }
    },
    [pendingTvId, courtsData, fetchCourts]
  );

  // Umpire Actions
  const handleJoinCourt = async (courtNumber) => {
    if (isSubmitting) return;
    if (pendingTvId) {
      await handlePairTvToCourt(courtNumber, pendingTvId);
      return;
    }
    const res = await callLobbyApi({
      action: 'join_umpire',
      courtNumber,
    });
    if (res?.success) {
      fetchCourts();
    }
  };

  const handleLeaveCourt = async (courtNumber) => {
    if (isSubmitting) return;
    const s = courtsData[courtNumber];
    if (!s) return;
    const res = await callLobbyApi({
      action: 'leave_umpire',
      sessionId: s.id,
      courtNumber,
    });
    if (res?.success) {
      fetchCourts();
    }
  };

  const handleSetWalkupSlot = async (courtNumber, team, slotIndex, name) => {
    const s = courtsData[courtNumber];
    if (!s || isSubmitting) return;
    const res = await callLobbyApi({
      action: 'umpire_set_slot',
      sessionId: s.id,
      courtNumber,
      team,
      slotIndex,
      walkupName: name,
    });
    if (res?.success) {
      setActiveWalkup(null);
      setWalkupName('');
    }
  };

  const handleRandomizeServer = (courtNumber) => {
    const pick = Math.random() < 0.5 ? 0 : 1;
    setFirstServerMap((prev) => ({ ...prev, [courtNumber]: pick }));
  };

  const handleStartMatch = async (courtNumber) => {
    const s = courtsData[courtNumber];
    if (!s || isSubmitting) return;
    const servingTeam = firstServerMap[courtNumber] ?? 0;
    const res = await callLobbyApi({
      action: 'start_match',
      sessionId: s.id,
      courtNumber,
      servingTeam,
      teamNames: s.team_names || ['Team A', 'Team B'],
    });

    if (res?.success && res.session?.id) {
      router.push(`/pikolscore?session=${encodeURIComponent(res.session.id)}`);
    }
  };

  // Identify which court the caller is currently assigned to (if any)
  const myAssignedCourtNumber = useMemo(() => {
    if (!user?.id) return null;
    for (let c = 1; c <= 4; c++) {
      if (getAssignedUmpireId(courtsData[c]) === user.id) {
        return c;
      }
    }
    return null;
  }, [user?.id, courtsData]);

  // Helper to classify each court's status: 'available' | 'occupied' | 'active'
  const getCourtStatus = useCallback(
    (courtNum) => {
      const session = courtsData[courtNum];
      const assignedUmpireId = getAssignedUmpireId(session);
      const isMyCourt = Boolean(user?.id && assignedUmpireId === user.id);
      const isMatchStarted = Boolean(session?.player_names?.lobbyLocked);
      const hasOtherUmpire = Boolean(assignedUmpireId && !isMyCourt);

      if (isMatchStarted) return 'active';
      if (hasOtherUmpire) return 'occupied';
      return 'available';
    },
    [courtsData, user?.id]
  );

  // Sync selectedCourt & initial modal prompt when courts finish loading
  useEffect(() => {
    if (isLoadingCourts || !user?.id) return;

    if (myAssignedCourtNumber) {
      setSelectedCourt(myAssignedCourtNumber);
      setPendingDropdownCourt(myAssignedCourtNumber);
      setIsCourtPickerOpen(false);
      return;
    }

    if (!selectedCourt) {
      const firstAvail =
        [1, 2, 3, 4].find((c) => getCourtStatus(c) === 'available') || null;
      setPendingDropdownCourt(firstAvail);
      setDropdownOpen(true);
      setIsCourtPickerOpen(true);
    } else if (getCourtStatus(selectedCourt) !== 'available') {
      const firstAvail =
        [1, 2, 3, 4].find((c) => getCourtStatus(c) === 'available') || null;
      setSelectedCourt(null);
      setPendingDropdownCourt(firstAvail);
      setDropdownOpen(true);
      setIsCourtPickerOpen(true);
    }
  }, [
    isLoadingCourts,
    user?.id,
    myAssignedCourtNumber,
    selectedCourt,
    getCourtStatus,
  ]);

  // Close custom dropdown inside modal on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [dropdownOpen]);

  // Auto-pair if arriving with ?tv=<tvId> while assigned
  useEffect(() => {
    if (!user?.id || isLoadingCourts || !pendingTvId || !myAssignedCourtNumber || isSubmitting) {
      return;
    }
    handlePairTvToCourt(myAssignedCourtNumber, pendingTvId);
  }, [user?.id, isLoadingCourts, pendingTvId, myAssignedCourtNumber, isSubmitting, handlePairTvToCourt]);

  const activeQrModalSession = useMemo(() => {
    if (!qrModalCourtNum) return null;
    return (
      courtsData[qrModalCourtNum] || {
        court_number: qrModalCourtNum,
        format: 'doubles',
        team_names: ['Team A', 'Team B'],
        player_names: {
          courtNumber: qrModalCourtNum,
          umpireId: null,
          umpireName: null,
          lobbyLocked: false,
          slots: { team0: [null, null], team1: [null, null] },
        },
      }
    );
  }, [qrModalCourtNum, courtsData]);

  if (isAuthLoading) {
    return <AuthLoadingSplash label="Loading courtside umpire hub..." />;
  }

  const activeCourtNum = myAssignedCourtNumber || selectedCourt;
  const displayCourtNum =
    activeCourtNum ||
    pendingDropdownCourt ||
    [1, 2, 3, 4].find((c) => getCourtStatus(c) === 'available') ||
    1;

  // Other courts for Right Sidebar
  const sidebarCourts = [1, 2, 3, 4]
    .filter((cNum) => cNum !== displayCourtNum)
    .map((cNum) => ({
      courtNum: cNum,
      session: courtsData[cNum],
      status: getCourtStatus(cNum),
    }))
    .sort((a, b) => {
      const rank = { active: 0, occupied: 1, available: 2 };
      return (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.courtNum - b.courtNum;
    });

  const renderTeamColumn = (courtNum, teamIdx, teamLabel, teamSlots, isMyCourt) => {
    const teamReadyCount =
      (teamSlots[0]?.name?.trim() ? 1 : 0) + (teamSlots[1]?.name?.trim() ? 1 : 0);
    const isTeamReady = teamReadyCount === 2;

    return (
      <div
        className={`p-5 sm:p-6 flex flex-col gap-3 ${
          teamIdx === 0 ? 'border-b sm:border-b-0 sm:border-r border-[#11263C]' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-bold uppercase tracking-[0.06em] text-[#FFFFFF]">
            {teamLabel}
          </span>
          <span
            className={`text-[11.5px] font-bold px-2.5 py-0.5 rounded-full border ${
              isTeamReady
                ? 'text-[#00E5B8] bg-[#00E5B8]/15 border-[#00E5B8]/50'
                : 'text-[#F4A261] bg-[#F4A261]/15 border-[#F4A261]/50'
            }`}
          >
            {teamReadyCount}/2 Ready
          </span>
        </div>

        {[0, 1].map((sIdx) => {
          const slot = teamSlots[sIdx];
          const hasPlayer = Boolean(slot?.name?.trim());
          const isAdding =
            activeWalkup?.courtNumber === courtNum &&
            activeWalkup?.team === teamIdx &&
            activeWalkup?.slotIndex === sIdx;

          if (hasPlayer) {
            return (
              <div
                key={`t${teamIdx}-${sIdx}`}
                className="h-[52px] px-3.5 rounded-[10px] bg-[#07192B] border border-[#24425E] text-[#FFFFFF] font-semibold text-[15px] flex items-center justify-between gap-2"
              >
                <div className="flex items-center min-w-0">
                  <span className="w-[26px] h-[26px] rounded-[6px] bg-[#00E5B8]/15 text-[#00E5B8] text-[12px] font-bold inline-flex items-center justify-center mr-3 shrink-0">
                    {sIdx + 1}
                  </span>
                  <span className="truncate">{slot.name}</span>
                </div>
                {isMyCourt && (
                  <button
                    type="button"
                    onClick={() => handleSetWalkupSlot(courtNum, teamIdx, sIdx, '')}
                    className="text-[#6C87A3] hover:text-[#F47067] p-1 bg-transparent border-0 cursor-pointer shrink-0 transition-colors"
                    title="Remove player"
                    aria-label={`Remove ${slot.name}`}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            );
          }

          if (isAdding) {
            const hasTypedName = Boolean(walkupName.trim());
            return (
              <div key={`t${teamIdx}-${sIdx}`} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Walk-up player name"
                    value={walkupName}
                    onChange={(e) => setWalkupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && hasTypedName) {
                        handleSetWalkupSlot(courtNum, teamIdx, sIdx, walkupName);
                      } else if (e.key === 'Escape') {
                        setActiveWalkup(null);
                      }
                    }}
                    className="h-[52px] flex-1 min-w-0 rounded-[10px] bg-[#07192B] border border-[#00E5B8] px-4 text-[16px] font-medium text-[#FFFFFF] placeholder:text-[#6C87A3] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!hasTypedName || isSubmitting}
                    onClick={() => handleSetWalkupSlot(courtNum, teamIdx, sIdx, walkupName)}
                    className={`min-w-[78px] h-[52px] px-3 rounded-[10px] border text-[15px] font-bold transition-colors cursor-pointer shrink-0 ${
                      hasTypedName
                        ? 'bg-[#07192B] border-[#00E5B8] text-[#FFFFFF] hover:bg-[#00E5B8] hover:text-[#031B28]'
                        : 'bg-[#07192B] border-[#24425E] text-[#6C87A3] cursor-not-allowed'
                    }`}
                  >
                    + Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWalkup(null)}
                    aria-label="Cancel walk-up entry"
                    className="h-[52px] w-9 grid place-items-center text-[#6C87A3] hover:text-[#FFFFFF] bg-transparent border-0 cursor-pointer shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>
                <span className="text-[12px] text-[#B0C4D8]">
                  Walk-up input active · Tap + Add to assign slot {sIdx + 1}
                </span>
              </div>
            );
          }

          return (
            <div
              key={`t${teamIdx}-${sIdx}`}
              className="h-[52px] px-3.5 rounded-[10px] bg-[#021024]/60 border border-dashed border-[#24425E] text-[#6C87A3] font-medium text-[14px] flex items-center justify-between gap-2"
            >
              <div className="flex items-center">
                <span className="w-[26px] h-[26px] rounded-[6px] bg-[#07192B] border border-[#24425E] text-[#6C87A3] text-[12px] font-bold inline-flex items-center justify-center mr-3 shrink-0">
                  {sIdx + 1}
                </span>
                <span>Open slot</span>
              </div>
              <button
                type="button"
                disabled={!isMyCourt}
                onClick={() => {
                  if (!isMyCourt) return;
                  setActiveWalkup({ courtNumber: courtNum, team: teamIdx, slotIndex: sIdx });
                  setWalkupName('');
                }}
                className="h-[34px] px-3 rounded-[8px] bg-[#07192B] border border-[#24425E] text-[#FFFFFF] font-semibold text-[12.5px] enabled:hover:border-[#00E5B8] enabled:hover:text-[#00E5B8] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <Plus size={13} />
                <span>Walk-up</span>
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSelectedCourtCard = (courtNum) => {
    if (!courtNum) return null;
    const session = courtsData[courtNum];
    const assignedUmpireId = getAssignedUmpireId(session);
    const isMyCourt = Boolean(user?.id && assignedUmpireId === user.id);
    const isMatchStarted = Boolean(session?.player_names?.lobbyLocked);
    const umpireName = session?.player_names?.umpireName;
    const hasOtherUmpire = Boolean(assignedUmpireId && !isMyCourt);

    const pNames = session?.player_names || {};
    const slots = pNames.slots || { team0: [null, null], team1: [null, null] };
    const team0Slots = slots.team0 || [null, null];
    const team1Slots = slots.team1 || [null, null];

    const filledCount =
      (team0Slots[0]?.name ? 1 : 0) +
      (team0Slots[1]?.name ? 1 : 0) +
      (team1Slots[0]?.name ? 1 : 0) +
      (team1Slots[1]?.name ? 1 : 0);
    const isFull = filledCount === 4;

    return (
      <section
        key={courtNum}
        className="rounded-[20px] border border-[#24425E] dv-top-accent bg-[#0B2239] overflow-hidden shadow-2xl transition-all"
      >
        {/* Unified Card Header + Utility Buttons */}
        <div className="px-5 sm:px-6 py-5 border-b border-[#11263C] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5">
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-[12px] font-display font-extrabold text-[28px] leading-none bg-[#00E5B8] text-[#031B28] shrink-0">
              {courtNum}
            </div>
            <div>
              <h2 className="dv-display text-[26px] leading-[1.08] text-[#FFFFFF] m-0">
                COURT {courtNum}
              </h2>

              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#B0C4D8] mt-1 flex-wrap">
                {isMyCourt ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#00E5B8]" />
                      <span>Officiating: You</span>
                    </span>
                    <span className="text-[#6C87A3]">·</span>
                    <span>{filledCount}/4 Players Ready</span>
                  </>
                ) : hasOtherUmpire ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[#6C87A3]">
                      <span className="size-2 rounded-full bg-[#6C87A3]" />
                      <span>Officiating: {umpireName || 'Another Umpire'}</span>
                    </span>
                    <span className="text-[#6C87A3]">·</span>
                    <span>{filledCount}/4 Players Ready</span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#00E5B8]" />
                      <span>Available court</span>
                    </span>
                    <span className="text-[#6C87A3]">·</span>
                    <span>{filledCount}/4 Players Ready</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Small Footer/Header Utility Buttons (40px height, 10px radius, 8px gap) */}
          <div className="flex items-center gap-2 flex-wrap">
            {isMyCourt && !isMatchStarted ? (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleLeaveCourt(courtNum)}
                className="h-[40px] px-3.5 rounded-[10px] bg-[#07192B] border border-[#F47067] text-[13px] font-semibold text-[#F47067] enabled:hover:bg-[#F47067]/10 transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                title={`Leave Court ${courtNum}`}
              >
                <X size={14} />
                <span>Leave Court</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={Boolean(myAssignedCourtNumber)}
                onClick={() => {
                  if (myAssignedCourtNumber) return;
                  setPendingDropdownCourt(courtNum);
                  setDropdownOpen(true);
                  setIsCourtPickerOpen(true);
                }}
                className="h-[40px] px-3.5 rounded-[10px] bg-[#07192B] border border-[#24425E] text-[13px] font-semibold text-[#FFFFFF] enabled:hover:border-[#00E5B8] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                title="Choose a different available court"
              >
                <ChevronDown size={14} />
                <span>Change Court</span>
              </button>
            )}
            <button
              type="button"
              disabled={!isMyCourt}
              onClick={() => isMyCourt && setProjectModalCourtNum(courtNum)}
              className="h-[40px] px-3.5 rounded-[10px] bg-[#07192B] border border-[#24425E] text-[13px] font-semibold text-[#FFFFFF] enabled:hover:border-[#00E5B8] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              title={
                isMyCourt
                  ? `Project Court ${courtNum} to a TV Screen`
                  : 'Join as umpire first to project this court to a TV screen'
              }
            >
              <Tv size={14} />
              <span>Project to Screen</span>
            </button>
            <button
              type="button"
              onClick={() => setQrModalCourtNum(courtNum)}
              className="h-[40px] px-3.5 rounded-[10px] bg-[#07192B] border border-[#24425E] text-[13px] font-semibold text-[#FFFFFF] hover:border-[#00E5B8] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              title={`View QR Code for Court ${courtNum}`}
            >
              <QrCode size={14} />
              <span>Court QR</span>
            </button>
          </div>
        </div>

        {/* 2-Column Court Roster Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-[#11263C]">
          {renderTeamColumn(courtNum, 0, 'Team A', team0Slots, isMyCourt)}
          {renderTeamColumn(courtNum, 1, 'Team B', team1Slots, isMyCourt)}
        </div>

        {/* First Serving Team Strip */}
        <div className="px-5 sm:px-6 py-4 bg-[#07192B] border-b border-[#11263C] flex items-center justify-between gap-4 flex-wrap">
          <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#D8E4F0]">
            First serving team
          </span>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="inline-flex bg-[#021024] border border-[#24425E] p-1 rounded-[10px]">
              <button
                type="button"
                disabled={!isMyCourt}
                onClick={() =>
                  isMyCourt && setFirstServerMap((prev) => ({ ...prev, [courtNum]: 0 }))
                }
                className={`px-4 py-1.5 rounded-[8px] text-[13.5px] font-bold transition-colors border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  firstServerMap[courtNum] === 0
                    ? 'bg-[#00E5B8] text-[#031B28]'
                    : 'bg-transparent text-[#B0C4D8] enabled:hover:text-[#FFFFFF]'
                }`}
              >
                Team A
              </button>
              <button
                type="button"
                disabled={!isMyCourt}
                onClick={() =>
                  isMyCourt && setFirstServerMap((prev) => ({ ...prev, [courtNum]: 1 }))
                }
                className={`px-4 py-1.5 rounded-[8px] text-[13.5px] font-bold transition-colors border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  firstServerMap[courtNum] === 1
                    ? 'bg-[#00E5B8] text-[#031B28]'
                    : 'bg-transparent text-[#B0C4D8] enabled:hover:text-[#FFFFFF]'
                }`}
              >
                Team B
              </button>
            </div>

            <button
              type="button"
              disabled={!isMyCourt}
              onClick={() => isMyCourt && handleRandomizeServer(courtNum)}
              className="h-[40px] px-3.5 rounded-[10px] border border-[#24425E] bg-[#07192B] text-[#FFFFFF] text-[13px] font-semibold inline-flex items-center gap-1.5 enabled:hover:border-[#00E5B8] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Shuffle size={14} />
              <span>Randomize</span>
            </button>
          </div>
        </div>

        {/* Bottom Primary Action CTA */}
        <div className="p-5 sm:px-6 bg-[#0B2239]">
          {!isMyCourt && !hasOtherUmpire && !isMatchStarted ? (
            <button
              type="button"
              disabled={isSubmitting || Boolean(myAssignedCourtNumber)}
              onClick={() => handleJoinCourt(courtNum)}
              className="h-[54px] w-full rounded-[12px] bg-[#00E5B8] text-[#031B28] text-[16px] font-bold hover:bg-[#05DFB4] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed border-0 flex items-center justify-center gap-2.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Joining Court {courtNum}...</span>
                </>
              ) : (
                <>
                  <Shield size={18} />
                  <span>Join Court {courtNum} as Umpire</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex flex-col gap-2.5">
              {!isFull && (
                <p className="m-0 text-[13.5px] text-[#B0C4D8]">
                  Add {4 - filledCount} more player{4 - filledCount === 1 ? '' : 's'} to unlock match start.
                </p>
              )}
              <button
                type="button"
                disabled={!isMyCourt || !isFull || isSubmitting}
                onClick={() => handleStartMatch(courtNum)}
                className={`h-[54px] w-full rounded-[12px] text-[16px] font-bold transition-colors flex items-center justify-center gap-2.5 ${
                  isMyCourt && isFull
                    ? 'bg-[#00E5B8] text-[#031B28] hover:bg-[#05DFB4] border-0 cursor-pointer'
                    : 'bg-[#07192B] border border-[#24425E] text-[#6C87A3] cursor-not-allowed'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Starting Match...</span>
                  </>
                ) : isFull ? (
                  <>
                    <Play size={17} fill="currentColor" />
                    <span>Start Match (30:00)</span>
                  </>
                ) : (
                  <span>Waiting for 4 Players ({filledCount}/4 Ready)</span>
                )}
              </button>
              <p className="m-0 text-center text-[12px] text-[#6C87A3]">
                Match timer: 30:00 countdown · Official 11-point win by 2
              </p>
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#021024] text-[#FFFFFF] relative overflow-x-hidden">
      <AmbientCourtMotif variant="full" opacity={0.35} />

      {/* 1. Header */}
      <Header
        profile={profile}
        userEmail={userEmail}
        showMatchLog={false}
        isGuest={false}
      />

      {/* 2. Main Workspace */}
      <main className="relative z-10 flex-1 w-full max-w-[1200px] mx-auto px-5 sm:px-8 pt-7 pb-12">
        {/* Page Header */}
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dv-overline block mb-1">MATCH CONTROL</span>
            <h1 className="dv-display text-[36px] leading-[1.05] text-[#FFFFFF] m-0">
              UMPIRE COURT HUB
            </h1>
            <p className="mt-1 text-[15px] text-[#B0C4D8]">
              Select an available court to manage player walk-ups, pair a TV screen, and start the match.
            </p>
          </div>
        </div>

        {/* TV Paired Confirmation Banner */}
        {tvPairedMessage && (
          <div
            role="status"
            className="mb-5 rounded-[12px] bg-[#0B2239] border border-[#00E5B8] p-3.5 text-[14px] font-bold text-[#FFFFFF] flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#00E5B8] text-[#031B28] shrink-0">
                <Check size={16} />
              </div>
              <span>{tvPairedMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setTvPairedMessage('')}
              className="p-1 text-[#B0C4D8] hover:text-[#FFFFFF] bg-transparent border-0 cursor-pointer"
              aria-label="Dismiss TV pairing notice"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Pending TV Pairing Selection Banner */}
        {pendingTvId && !myAssignedCourtNumber && (
          <div
            role="region"
            aria-label="Pair Courtside TV"
            className="mb-6 rounded-[20px] bg-[#0B2239] text-[#FFFFFF] p-5 sm:p-6 border border-[#24425E] dv-top-accent shadow-xl flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#00E5B8] text-[#031B28]">
                  <Tv size={20} />
                </div>
                <div>
                  <span className="dv-overline block">TV SCREEN PAIRING ACTIVE</span>
                  <h2 className="dv-display text-[24px] leading-tight text-[#FFFFFF] m-0 mt-0.5">
                    SELECT A COURT FOR THIS TV SCREEN
                  </h2>
                  <p className="text-[13.5px] text-[#B0C4D8] m-0 mt-0.5">
                    Tap a court below to link the TV and join as its supervising umpire.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingTvId(null)}
                className="p-1.5 text-[#6C87A3] hover:text-[#FFFFFF] bg-transparent border-0 cursor-pointer"
                aria-label="Cancel TV pairing"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[1, 2, 3, 4].map((cNum) => {
                const s = courtsData[cNum];
                const existingUmpire = getAssignedUmpireId(s);
                const otherUmpire = Boolean(existingUmpire && existingUmpire !== user?.id);
                return (
                  <button
                    key={`pair-btn-${cNum}`}
                    type="button"
                    disabled={isSubmitting || otherUmpire}
                    onClick={() => handlePairTvToCourt(cNum, pendingTvId)}
                    className="h-[44px] rounded-[10px] bg-[#07192B] border border-[#24425E] enabled:hover:border-[#00E5B8] enabled:hover:bg-[#00E5B8] enabled:hover:text-[#031B28] text-[#FFFFFF] text-[13px] font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <Tv size={14} />
                    <span>{otherUmpire ? `Court ${cNum} (Busy)` : `Pair Court ${cNum}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Global Error Banner */}
        {actionError && (
          <div
            role="alert"
            className="mb-5 rounded-[12px] bg-[#0B2239] border border-[#F47067] p-4 text-[14px] font-semibold text-[#F47067] flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError('')}
              className="p-1 text-[#F47067] hover:text-[#FFFFFF] bg-transparent border-0 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Main Two-Column Layout: Selected Court Sheet (Left) + Live Venue Sidebar (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8">{renderSelectedCourtCard(displayCourtNum)}</div>

          <aside
            aria-label="Other courts live venue status"
            className="lg:col-span-4 rounded-[14px] border border-[#24425E] bg-[#0B2239] p-5 flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#11263C]">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#FFFFFF] m-0">
                Other Courts
              </h2>
              <span className="text-[12px] font-medium text-[#6C87A3]">
                Live venue status
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {sidebarCourts.map(({ courtNum: cNum, session, status }) => {
                const isMatchActive = status === 'active';
                const isOccupied = status === 'occupied';
                const umpireName = session?.player_names?.umpireName || 'Official Umpire';
                const slots = session?.player_names?.slots || {
                  team0: [null, null],
                  team1: [null, null],
                };
                const filled =
                  (slots.team0?.[0]?.name ? 1 : 0) +
                  (slots.team0?.[1]?.name ? 1 : 0) +
                  (slots.team1?.[0]?.name ? 1 : 0) +
                  (slots.team1?.[1]?.name ? 1 : 0);

                let timerDisplay = '30:00';
                if (isMatchActive && session?.timer_ends_at) {
                  const remMs = Math.max(
                    0,
                    new Date(session.timer_ends_at).getTime() - Date.now()
                  );
                  timerDisplay = formatMmSs(Math.ceil(remMs / 1000));
                }

                if (isMatchActive) {
                  const score0 = String(session?.score_team0 ?? 0).padStart(2, '0');
                  const score1 = String(session?.score_team1 ?? 0).padStart(2, '0');
                  return (
                    <div
                      key={`sidebar-court-${cNum}`}
                      className="rounded-[12px] border border-[#F4A261] bg-[#07192B] p-4 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] bg-[#F4A261] text-[#031B28] font-display text-[22px] font-extrabold shrink-0">
                            {cNum}
                          </div>
                          <div>
                            <div className="text-[15px] font-bold text-[#FFFFFF]">
                              Court {cNum}
                            </div>
                            <div className="text-[12px] text-[#B0C4D8]">
                              Umpire: {umpireName}
                            </div>
                          </div>
                        </div>

                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F4A261]/60 bg-[#F4A261]/15 px-2.5 py-1 text-[11px] font-bold text-[#F4A261]">
                          <span className="size-1.5 rounded-full bg-[#F4A261]" />
                          <span>Active · {timerDisplay}</span>
                        </span>
                      </div>

                      <div className="rounded-[10px] bg-[#021024] border border-[#11263C] px-3.5 py-2.5 flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#6C87A3] truncate max-w-[100px]">
                            {session?.team_names?.[0] || 'TEAM A'}
                          </span>
                          <span className="font-display text-[32px] font-extrabold text-[#FFFFFF] leading-none tabular-nums">
                            {score0}
                          </span>
                        </div>
                        <span className="text-[12px] font-semibold text-[#6C87A3]">vs</span>
                        <div className="flex flex-col gap-0.5 text-right">
                          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#6C87A3] truncate max-w-[100px]">
                            {session?.team_names?.[1] || 'TEAM B'}
                          </span>
                          <span className="font-display text-[32px] font-extrabold text-[#B0C4D8] leading-none tabular-nums">
                            {score1}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => router.push(`/pikolscore?session=${session.id}`)}
                        className="h-[40px] w-full flex items-center justify-center gap-1.5 rounded-[10px] bg-[#07192B] border border-[#F4A261] text-[#F4A261] text-[13px] font-semibold hover:bg-[#F4A261] hover:text-[#031B28] transition-colors cursor-pointer"
                      >
                        <Eye size={14} />
                        <span>Spectate Match</span>
                      </button>
                    </div>
                  );
                }

                if (isOccupied) {
                  return (
                    <div
                      key={`sidebar-court-${cNum}`}
                      className="px-3.5 py-3.5 rounded-[12px] bg-[#07192B] border border-[#24425E] flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] bg-[#0B2239] border border-[#24425E] text-[#6C87A3] font-display text-[22px] font-extrabold shrink-0">
                          {cNum}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold text-[#FFFFFF]">
                            Court {cNum}
                          </div>
                          <div className="text-[12px] text-[#6C87A3] truncate">
                            {umpireName} · {filled}/4 players
                          </div>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0B2239] border border-[#24425E] px-2.5 py-1 text-[11px] font-bold text-[#6C87A3] shrink-0">
                        <span>Occupied</span>
                      </span>
                    </div>
                  );
                }

                return (
                  <button
                    key={`sidebar-court-${cNum}`}
                    type="button"
                    disabled={Boolean(myAssignedCourtNumber)}
                    onClick={() => {
                      if (myAssignedCourtNumber) return;
                      setSelectedCourt(cNum);
                    }}
                    title={
                      myAssignedCourtNumber
                        ? `Leave Court ${myAssignedCourtNumber} first to switch courts`
                        : `Switch to Court ${cNum}`
                    }
                    className="w-full text-left px-3.5 py-3.5 rounded-[12px] bg-[#07192B] border border-[#24425E] enabled:hover:border-[#00E5B8] transition-colors flex items-center justify-between gap-2 cursor-pointer disabled:cursor-default"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] bg-[#00E5B8]/15 border border-[#00E5B8] text-[#00E5B8] font-display text-[22px] font-extrabold shrink-0">
                        {cNum}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold text-[#FFFFFF]">
                          Court {cNum}
                        </div>
                        <div className="text-[12px] text-[#B0C4D8] truncate">
                          No umpire · {filled}/4 players
                        </div>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#00E5B8]/15 border border-[#00E5B8]/50 px-2.5 py-1 text-[11px] font-bold text-[#00E5B8] shrink-0">
                      <span className="size-1.5 rounded-full bg-[#00E5B8]" />
                      <span>Available</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </main>

      {/* "Choose your court" Signature DinkVision Modal */}
      {isCourtPickerOpen && !isLoadingCourts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-[#021024]/75 backdrop-blur-[12px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="choose-court-title"
        >
          <div className="w-full max-w-[480px] rounded-[20px] border border-[#24425E] dv-top-accent bg-[#0B2239] p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="dv-overline block mb-2">COURT ASSIGNMENT</span>
                <h2
                  id="choose-court-title"
                  className="dv-display text-[30px] leading-[1.08] text-[#FFFFFF] m-0"
                >
                  CHOOSE YOUR COURT
                </h2>
                <p className="text-[15px] text-[#B0C4D8] mt-3 leading-relaxed">
                  Pick an available court to join as umpire and manage the pre-match roster.
                </p>
              </div>
              {activeCourtNum && (
                <button
                  type="button"
                  onClick={() => setIsCourtPickerOpen(false)}
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-[10px] border border-[#24425E] bg-[#07192B] text-[#FFFFFF] hover:border-[#00E5B8] cursor-pointer shrink-0"
                  aria-label="Close court picker"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Court Selector Dropdown */}
            <div ref={dropdownRef} className="flex flex-col gap-2">
              <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#D8E4F0]">
                SELECT COURT
              </span>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex h-[52px] w-full items-center justify-between rounded-[10px] border border-[#00E5B8] bg-[#07192B] px-4 text-left transition-colors cursor-pointer"
              >
                {pendingDropdownCourt ? (
                  <>
                    <span className="flex items-center gap-2.5 text-[16px] font-bold text-[#FFFFFF]">
                      <span className="size-2.5 rounded-full bg-[#00E5B8]" />
                      <span>Court {pendingDropdownCourt}</span>
                    </span>
                    <span className="flex items-center gap-2 text-[13px] font-bold text-[#00E5B8]">
                      <span>Available</span>
                      <ChevronDown
                        size={16}
                        className={`text-[#00E5B8] transition-transform ${
                          dropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[15px] font-medium text-[#6C87A3]">
                      Select an available court...
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-[#00E5B8] transition-transform ${
                        dropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </>
                )}
              </button>

              {dropdownOpen && (
                <ul
                  role="listbox"
                  aria-label="Courts"
                  className="w-full rounded-[12px] border border-[#24425E] bg-[#07192B] p-2 flex flex-col gap-1.5 m-0 list-none"
                >
                  {[1, 2, 3, 4].map((cNum) => {
                    const status = getCourtStatus(cNum);
                    const isAvailable = status === 'available';
                    const isActiveMatch = status === 'active';
                    const session = courtsData[cNum];
                    const umpireName = session?.player_names?.umpireName;
                    const isSelected = pendingDropdownCourt === cNum;

                    return (
                      <li key={`dropdown-court-${cNum}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={!isAvailable}
                          onClick={() => {
                            if (!isAvailable) return;
                            setPendingDropdownCourt(cNum);
                          }}
                          className={`flex h-[46px] w-full items-center justify-between rounded-[10px] px-3.5 text-left text-[14.5px] font-bold transition-colors border-0 ${
                            isAvailable
                              ? isSelected
                                ? 'bg-[#00E5B8] text-[#031B28] cursor-pointer'
                                : 'bg-[#0B2239]/60 text-[#FFFFFF] hover:bg-[#0B2239] cursor-pointer'
                              : isActiveMatch
                              ? 'bg-[#0B2239]/35 text-[#F4A261] cursor-not-allowed'
                              : 'bg-[#0B2239]/25 text-[#6C87A3] cursor-not-allowed'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <span
                              className={`size-2 rounded-full shrink-0 ${
                                isAvailable
                                  ? isSelected
                                    ? 'bg-[#031B28]'
                                    : 'bg-[#00E5B8]'
                                  : isActiveMatch
                                  ? 'bg-[#F4A261]'
                                  : 'bg-[#6C87A3]'
                              }`}
                            />
                            <span>Court {cNum}</span>
                          </span>

                          {isAvailable ? (
                            <span
                              className={`text-[12.5px] font-bold ${
                                isSelected ? 'text-[#031B28]' : 'text-[#00E5B8]'
                              }`}
                            >
                              Available
                            </span>
                          ) : isActiveMatch ? (
                            <span className="text-[12.5px] font-bold text-[#F4A261]">
                              Active Match · {session?.score_team0 ?? 0}–{session?.score_team1 ?? 0}
                            </span>
                          ) : (
                            <span className="text-[12.5px] font-semibold text-[#6C87A3]">
                              Occupied{umpireName ? ` · ${umpireName}` : ''}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button
              type="button"
              disabled={
                isSubmitting ||
                !pendingDropdownCourt ||
                getCourtStatus(pendingDropdownCourt) !== 'available'
              }
              onClick={async () => {
                if (!pendingDropdownCourt) return;
                const targetCourt = pendingDropdownCourt;
                setSelectedCourt(targetCourt);
                setIsCourtPickerOpen(false);
                await handleJoinCourt(targetCourt);
              }}
              className="h-[54px] w-full rounded-[12px] bg-[#00E5B8] text-[#031B28] text-[16px] font-bold hover:bg-[#05DFB4] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-0 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Joining Court {pendingDropdownCourt}...</span>
                </>
              ) : pendingDropdownCourt ? (
                <span>Join Court {pendingDropdownCourt} as Umpire</span>
              ) : (
                <span>No Available Courts</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* QR Modal for court */}
      {activeQrModalSession && (
        <CourtQrLobbyModal
          isOpen={Boolean(activeQrModalSession)}
          onClose={() => setQrModalCourtNum(null)}
          session={activeQrModalSession}
          currentUser={{ id: user?.id, email: userEmail }}
          profile={profile}
          isUmpire={true}
          canManageRoster={getAssignedUmpireId(activeQrModalSession) === user?.id}
          onJoinCourt={
            !myAssignedCourtNumber && !getAssignedUmpireId(activeQrModalSession)
              ? () => handleJoinCourt(qrModalCourtNum)
              : undefined
          }
          onSessionUpdated={(updated) => {
            const cNum = getCourtNumber(updated) || qrModalCourtNum;
            if (cNum) {
              setCourtsData((prev) => ({ ...prev, [cNum]: updated }));
            }
          }}
        />
      )}

      {/* Project to Screen Modal */}
      <ProjectToScreenModal
        isOpen={Boolean(projectModalCourtNum)}
        onClose={() => setProjectModalCourtNum(null)}
        courtNumber={projectModalCourtNum}
        sessionId={
          projectModalCourtNum ? courtsData[projectModalCourtNum]?.id : undefined
        }
        onPaired={(cNum, updatedSession) => {
          if (updatedSession && cNum) {
            setCourtsData((prev) => ({ ...prev, [cNum]: updatedSession }));
          }
          setTvPairedMessage(`Connected Courtside TV Screen to Court ${cNum}!`);
          fetchCourts();
        }}
      />
    </div>
  );
}
