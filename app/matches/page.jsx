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

    // If not assigned and no court selected yet, open the "Choose your court" modal prompt
    if (!selectedCourt) {
      const firstAvail =
        [1, 2, 3, 4].find((c) => getCourtStatus(c) === 'available') || null;
      setPendingDropdownCourt(firstAvail);
      setDropdownOpen(true);
      setIsCourtPickerOpen(true);
    } else if (getCourtStatus(selectedCourt) !== 'available') {
      // If the previously selected court became occupied or active by someone else while we were unassigned, re-prompt
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

  // If the umpire scanned a TV QR and is already assigned to a court, auto-pair immediately!
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

  // Other courts for the Right Sidebar ("Other Courts · Live venue status")
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

    return (
      <div
        className={`p-5 sm:p-6 flex flex-col gap-3 ${
          teamIdx === 0
            ? 'border-b sm:border-b-0 sm:border-r border-[#E2E5DC]'
            : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[#084B46] tracking-[-0.01em]">
            {teamLabel}
          </span>
          <span className="text-xs font-bold text-[#0F5C62] bg-[#EAF0E5] px-2.5 py-0.5 rounded-full">
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
                className="h-[46px] px-3.5 rounded-xl bg-[#EAF0E5] border-[1.5px] border-[#0F5C62]/20 text-[#084B46] font-bold text-sm flex items-center justify-between gap-2 transition-all"
              >
                <div className="flex items-center min-w-0">
                  <span className="w-[22px] h-[22px] rounded-md bg-[#0F5C62]/15 text-[#084B46] text-[11px] font-extrabold inline-flex items-center justify-center mr-2.5 shrink-0">
                    {sIdx + 1}
                  </span>
                  <span className="truncate">{slot.name}</span>
                </div>
                {isMyCourt && (
                  <button
                    type="button"
                    onClick={() => handleSetWalkupSlot(courtNum, teamIdx, sIdx, '')}
                    className="text-[#748079] hover:text-[#BA1A1A] p-1 bg-transparent border-0 cursor-pointer shrink-0"
                    title="Remove player"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            );
          }

          if (isAdding) {
            return (
              <div
                key={`t${teamIdx}-${sIdx}`}
                className="h-[46px] px-2.5 rounded-xl bg-[#FAF9F5] border-[1.5px] border-[#0F5C62] flex items-center gap-1.5"
              >
                <span className="w-[22px] h-[22px] rounded-md bg-[#0F5C62]/12 text-[#084B46] text-[11px] font-extrabold inline-flex items-center justify-center shrink-0">
                  {sIdx + 1}
                </span>
                <input
                  type="text"
                  autoFocus
                  placeholder="Walk-up player name"
                  value={walkupName}
                  onChange={(e) => setWalkupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSetWalkupSlot(courtNum, teamIdx, sIdx, walkupName);
                    } else if (e.key === 'Escape') {
                      setActiveWalkup(null);
                    }
                  }}
                  className="h-8 flex-1 min-w-0 rounded-lg bg-white border border-[#E2E5DC] px-2.5 text-xs font-semibold text-[#084B46] outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleSetWalkupSlot(courtNum, teamIdx, sIdx, walkupName)}
                  className="h-8 px-2.5 rounded-lg bg-[#0F5C62] text-xs font-bold text-[#FEECD6] border-0 cursor-pointer"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setActiveWalkup(null)}
                  className="h-8 px-1.5 text-xs text-[#748079] hover:text-[#084B46] bg-transparent border-0 cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            );
          }

          return (
            <div
              key={`t${teamIdx}-${sIdx}`}
              className="h-[46px] px-3.5 rounded-xl bg-[#FAF9F5] border-[1.5px] border-dashed border-[#E2E5DC] text-[#748079] font-medium text-sm flex items-center justify-between gap-2 transition-all"
            >
              <div className="flex items-center">
                <span className="w-[22px] h-[22px] rounded-md bg-[#0F5C62]/10 text-[#084B46] text-[11px] font-extrabold inline-flex items-center justify-center mr-2.5 shrink-0">
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
                className="bg-[#FEFEFB] border border-[#E2E5DC] text-[#0F5C62] font-bold text-xs px-2.5 py-1 rounded-lg enabled:hover:bg-[#EAF0E5] enabled:hover:border-[#0F5C62] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <Plus size={12} />
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

    // Derive slots
    const pNames = session?.player_names || {};
    const slots = pNames.slots || { team0: [null, null], team1: [null, null] };
    const team0Slots = slots.team0 || [null, null];
    const team1Slots = slots.team1 || [null, null];

    // Filled slots count
    const filledCount =
      (team0Slots[0]?.name ? 1 : 0) +
      (team0Slots[1]?.name ? 1 : 0) +
      (team1Slots[0]?.name ? 1 : 0) +
      (team1Slots[1]?.name ? 1 : 0);
    const isFull = filledCount === 4;

    return (
      <section
        key={courtNum}
        className={`rounded-3xl border-[1.5px] bg-[#FEFEFB] overflow-hidden shadow-[0_10px_30px_-12px_rgba(8,75,70,0.08)] transition-all ${
          isMyCourt ? 'border-[#0F5C62]' : 'border-[#E2E5DC]'
        }`}
      >
        {/* Unified Card Header + Court Switcher */}
        <div className="px-5 sm:px-6 py-5 bg-[#FEFEFB] border-b border-[#E2E5DC] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-[14px] font-extrabold text-xl bg-[#0F5C62] text-[#FEECD6] shrink-0">
              {courtNum}
            </div>
            <div>
              <h2 className="text-[22px] font-extrabold text-[#084B46] m-0 leading-tight">
                Court {courtNum}
              </h2>

              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#384640] mt-0.5 flex-wrap">
                {isMyCourt ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#0F5C62]" />
                      <span>Officiating: You</span>
                    </span>
                    <span className="text-[#748079]">·</span>
                    <span>{filledCount}/4 Players Ready</span>
                  </>
                ) : hasOtherUmpire ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[#748079]">
                      <span className="size-2 rounded-full bg-[#748079]" />
                      <span>Officiating: {umpireName || 'Another Umpire'}</span>
                    </span>
                    <span className="text-[#748079]">·</span>
                    <span>{filledCount}/4 Players Ready</span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#0F5C62]" />
                      <span>Available court</span>
                    </span>
                    <span className="text-[#748079]">·</span>
                    <span>{filledCount}/4 Players Ready</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Header Utilities: Change Court / Leave Court, Project to Screen & Court QR */}
          <div className="flex items-center gap-2 flex-wrap">
            {isMyCourt && !isMatchStarted ? (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleLeaveCourt(courtNum)}
                className="h-[38px] px-3.5 rounded-full bg-[#FAF9F5] border-[1.5px] border-[#BA1A1A]/35 text-[13px] font-bold text-[#BA1A1A] enabled:hover:bg-red-50 enabled:hover:border-[#BA1A1A] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
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
                className="h-[38px] px-3.5 rounded-full bg-[#FAF9F5] border-[1.5px] border-[#E2E5DC] text-[13px] font-bold text-[#084B46] enabled:hover:bg-[#EAF0E5] enabled:hover:border-[#0F5C62] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
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
              className="h-[38px] px-3.5 rounded-full bg-[#FAF9F5] border-[1.5px] border-[#E2E5DC] text-[13px] font-bold text-[#084B46] enabled:hover:bg-[#EAF0E5] enabled:hover:border-[#0F5C62] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
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
              className="h-[38px] px-3.5 rounded-full bg-[#FAF9F5] border-[1.5px] border-[#E2E5DC] text-[13px] font-bold text-[#084B46] hover:bg-[#EAF0E5] hover:border-[#0F5C62] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              title={`View QR Code for Court ${courtNum}`}
            >
              <QrCode size={14} />
              <span>Court QR</span>
            </button>
          </div>
        </div>

        {/* Flattened 2-Column Court Roster Sheet */}
        <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-[#E2E5DC]">
          {renderTeamColumn(courtNum, 0, 'Team A', team0Slots, isMyCourt)}
          {renderTeamColumn(courtNum, 1, 'Team B', team1Slots, isMyCourt)}
        </div>

        {/* Compact Single-Row First Serve Strip */}
        <div className="px-5 sm:px-6 py-4 bg-[#FAF9F5] border-b border-[#E2E5DC] flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm font-bold text-[#084B46]">
            First serving team
          </span>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="inline-flex bg-[#FEFEFB] border-[1.5px] border-[#E2E5DC] p-[3px] rounded-xl">
              <button
                type="button"
                disabled={!isMyCourt}
                onClick={() =>
                  isMyCourt && setFirstServerMap((prev) => ({ ...prev, [courtNum]: 0 }))
                }
                className={`px-[18px] py-[7px] rounded-[9px] text-[13px] font-bold transition-colors border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  firstServerMap[courtNum] === 0
                    ? 'bg-[#0F5C62] text-[#FEECD6]'
                    : 'bg-transparent text-[#384640] enabled:hover:text-[#084B46]'
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
                className={`px-[18px] py-[7px] rounded-[9px] text-[13px] font-bold transition-colors border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  firstServerMap[courtNum] === 1
                    ? 'bg-[#0F5C62] text-[#FEECD6]'
                    : 'bg-transparent text-[#384640] enabled:hover:text-[#084B46]'
                }`}
              >
                Team B
              </button>
            </div>

            <button
              type="button"
              disabled={!isMyCourt}
              onClick={() => isMyCourt && handleRandomizeServer(courtNum)}
              className="h-[38px] px-3.5 rounded-xl border-[1.5px] border-[#E2E5DC] bg-[#FEFEFB] text-[#0F5C62] text-xs font-bold inline-flex items-center gap-1.5 enabled:hover:bg-[#EAF0E5] enabled:hover:border-[#0F5C62] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Shuffle size={13} />
              <span>Randomize</span>
            </button>
          </div>
        </div>

        {/* Bottom Primary Action CTA */}
        <div className="p-5 sm:px-6 bg-[#FEFEFB]">
          {!isMyCourt && !hasOtherUmpire && !isMatchStarted ? (
            <button
              type="button"
              disabled={isSubmitting || Boolean(myAssignedCourtNumber)}
              onClick={() => handleJoinCourt(courtNum)}
              className="h-[52px] w-full rounded-2xl bg-[#0F5C62] text-[#FEECD6] text-base font-extrabold hover:bg-[#085953] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed border-0 shadow-[0_6px_16px_-4px_rgba(15,92,98,0.35)] flex items-center justify-center gap-2.5"
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
            <button
              type="button"
              disabled={!isMyCourt || !isFull || isSubmitting}
              onClick={() => handleStartMatch(courtNum)}
              className={`h-[52px] w-full rounded-2xl text-base font-extrabold transition-colors cursor-pointer border-0 flex items-center justify-center gap-2.5 ${
                isMyCourt && isFull
                  ? 'bg-[#0F5C62] text-[#FEECD6] hover:bg-[#085953] shadow-[0_6px_16px_-4px_rgba(15,92,98,0.35)]'
                  : 'bg-[#E2E5DC] text-[#384640] cursor-not-allowed'
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
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="ps-shell min-h-screen flex flex-col bg-[#FAF9F5] text-[#203F39]">
      {/* 1. Header */}
      <Header
        profile={profile}
        userEmail={userEmail}
        showMatchLog={false}
        isGuest={false}
      />

      {/* 2. Main Workspace */}
      <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-8 pt-7 pb-12">
        {/* Clean Page Header */}
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-[#084B46] m-0">
              Umpire Court Hub
            </h1>
            <p className="mt-0.5 text-sm text-[#748079]">
              Select an available court to manage player walk-ups, pair a TV screen, and start the match.
            </p>
          </div>
        </div>

        {/* TV Paired Confirmation Banner */}
        {tvPairedMessage && (
          <div
            role="status"
            className="mb-6 rounded-2xl bg-[#EAF0E5] border-[1.5px] border-[#0F5C62] p-4 text-sm font-bold text-[#084B46] flex items-center justify-between gap-3 animate-in fade-in"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0F5C62] text-[#FEECD6] shrink-0">
                <Check size={16} />
              </div>
              <span>{tvPairedMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setTvPairedMessage('')}
              className="p-1 text-[#084B46] hover:text-[#0F5C62] bg-transparent border-0 cursor-pointer"
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
            className="mb-6 rounded-3xl bg-[#084B46] text-[#FEFEFB] p-5 sm:p-6 border-2 border-[#0F5C62] shadow-lg flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0F5C62] text-[#FEECD6]">
                  <Tv size={22} />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[#FEECD6]">
                    TV Screen Pairing Active
                  </span>
                  <h2 className="text-lg sm:text-xl font-bold text-white m-0 mt-0.5">
                    Select a Court to Display on the TV Screen
                  </h2>
                  <p className="text-xs text-[#EAF0E5]/80 m-0 mt-0.5">
                    Tap a court below to link the TV and join as its supervising umpire.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingTvId(null)}
                className="p-1.5 text-[#EAF0E5]/70 hover:text-white bg-transparent border-0 cursor-pointer"
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
                    className="h-11 rounded-2xl bg-[#0F5C62] hover:bg-[#FEECD6] hover:text-[#084B46] text-[#FEECD6] text-xs font-bold transition-colors cursor-pointer border border-[#FEECD6]/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <Tv size={14} />
                    <span>
                      {otherUmpire ? `Court ${cNum} (Busy)` : `Pair Court ${cNum}`}
                    </span>
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
            className="mb-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm font-semibold text-[#BA1A1A] flex items-center justify-between gap-3 animate-in fade-in"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError('')}
              className="p-1 text-red-500 hover:text-red-700 bg-transparent border-0 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Main Two-Column Layout: Selected Court Sheet (Left) + Live Venue Sidebar (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Selected Court Card */}
          <div className="lg:col-span-8">
            {renderSelectedCourtCard(displayCourtNum)}
          </div>

          {/* Right Sidebar: Other Courts (Live Venue Status) */}
          <aside
            aria-label="Other courts live venue status"
            className="lg:col-span-4 rounded-3xl border-[1.5px] border-[#E2E5DC] bg-[#FEFEFB] p-5 flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E5DC]">
              <h2 className="text-base font-extrabold text-[#084B46] m-0">
                Other Courts
              </h2>
              <span className="text-xs font-semibold text-[#748079]">
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
                      className="rounded-[18px] border-[1.5px] border-[#FED7AA] bg-[#FFF7ED] p-4 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#EA580C] text-white text-[15px] font-extrabold shrink-0">
                            {cNum}
                          </div>
                          <div>
                            <div className="text-[15px] font-extrabold text-[#084B46]">
                              Court {cNum}
                            </div>
                            <div className="text-xs text-[#748079]">
                              Umpire: {umpireName}
                            </div>
                          </div>
                        </div>

                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFEDD5] px-2.5 py-1 text-[11px] font-extrabold text-[#C2410C]">
                          <span className="size-2 rounded-full bg-[#EA580C]" />
                          <span>Active · {timerDisplay}</span>
                        </span>
                      </div>

                      <div className="rounded-xl bg-white border border-[#FED7AA] px-3.5 py-2.5 flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-bold uppercase text-[#748079] truncate max-w-[100px]">
                            {session?.team_names?.[0] || 'TEAM A'}
                          </span>
                          <span className="text-[22px] font-extrabold text-[#084B46] leading-none tabular-nums">
                            {score0}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-[#748079]">vs</span>
                        <div className="flex flex-col gap-0.5 text-right">
                          <span className="text-[11px] font-bold uppercase text-[#748079] truncate max-w-[100px]">
                            {session?.team_names?.[1] || 'TEAM B'}
                          </span>
                          <span className="text-[22px] font-extrabold text-[#084B46] leading-none tabular-nums">
                            {score1}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => router.push(`/pikolscore?session=${session.id}`)}
                        className="h-9 w-full flex items-center justify-center gap-1.5 rounded-[10px] bg-[#EA580C] text-white text-xs font-bold hover:bg-[#C2410C] transition-colors cursor-pointer border-0"
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
                      className="px-3.5 py-[13px] rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC] flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#E2E5DC] text-[#384640] text-[15px] font-extrabold shrink-0">
                          {cNum}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-[#084B46]">
                            Court {cNum}
                          </div>
                          <div className="text-xs text-[#748079] truncate">
                            Umpire: {umpireName} · {filled}/4 players
                          </div>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E2E5DC] px-2.5 py-1 text-[11px] font-bold text-[#384640] shrink-0">
                        <span className="size-2 rounded-full bg-[#748079]" />
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
                    className="w-full text-left px-3.5 py-[13px] rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC] enabled:hover:border-[#0F5C62] enabled:hover:bg-[#EAF0E5]/50 transition-colors flex items-center justify-between gap-2 cursor-pointer disabled:cursor-default"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#EAF0E5] text-[#0F5C62] text-[15px] font-extrabold shrink-0">
                        {cNum}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-[#084B46]">
                          Court {cNum}
                        </div>
                        <div className="text-xs text-[#748079] truncate">
                          No umpire assigned · {filled}/4 players
                        </div>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF0E5] px-2.5 py-1 text-[11px] font-bold text-[#0F5C62] shrink-0">
                      <span className="size-2 rounded-full bg-[#0F5C62]" />
                      <span>Available</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </main>

      {/* "Choose your court" Focused Modal Prompt */}
      {isCourtPickerOpen && !isLoadingCourts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#084B46]/32 backdrop-blur-[4px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="choose-court-title"
        >
          <div className="w-full max-w-[440px] rounded-[28px] border-[1.5px] border-[#E2E5DC] bg-[#FEFEFB] p-7 shadow-[0_28px_60px_-12px_rgba(8,75,70,0.28)] flex flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="choose-court-title"
                  className="text-2xl font-extrabold text-[#084B46] tracking-[-0.02em] m-0"
                >
                  Choose your court
                </h2>
                <p className="text-sm text-[#748079] mt-1 leading-snug">
                  Pick an available court to join as umpire and manage the pre-match roster.
                </p>
              </div>
              {activeCourtNum && (
                <button
                  type="button"
                  onClick={() => setIsCourtPickerOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E5DC] bg-[#FAF9F5] text-[#748079] hover:text-[#084B46] cursor-pointer shrink-0"
                  aria-label="Close court picker"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Refined Court Dropdown */}
            <div ref={dropdownRef} className="flex flex-col gap-2">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex h-[52px] w-full items-center justify-between rounded-2xl border-2 border-[#0F5C62] bg-[#FAF9F5] px-4 text-left transition-colors cursor-pointer"
              >
                {pendingDropdownCourt ? (
                  <>
                    <span className="flex items-center gap-2.5 text-base font-extrabold text-[#084B46]">
                      <span className="size-2.5 rounded-full bg-[#0F5C62]" />
                      <span>Court {pendingDropdownCourt}</span>
                    </span>
                    <span className="flex items-center gap-2.5 text-[13px] font-bold text-[#0F5C62]">
                      <span>Available</span>
                      <ChevronDown
                        size={16}
                        className={`text-[#0F5C62] transition-transform ${
                          dropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-[#748079]">
                      Select an available court...
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-[#0F5C62] transition-transform ${
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
                  className="w-full rounded-[18px] border-[1.5px] border-[#E2E5DC] bg-[#FEFEFB] p-1.5 shadow-[0_12px_28px_-6px_rgba(8,75,70,0.14)] flex flex-col gap-1 m-0 list-none"
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
                          className={`flex h-[46px] w-full items-center justify-between rounded-xl px-3.5 text-left text-sm font-bold transition-colors border-0 ${
                            isAvailable
                              ? isSelected
                                ? 'bg-[#0F5C62] text-[#FEECD6] cursor-pointer'
                                : 'bg-transparent text-[#084B46] hover:bg-[#EAF0E5] cursor-pointer'
                              : isActiveMatch
                              ? 'bg-[#FFF7ED] text-[#9A3412] cursor-not-allowed'
                              : 'bg-[#F4F5F2] text-[#748079] opacity-65 cursor-not-allowed'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <span
                              className={`size-2 rounded-full shrink-0 ${
                                isAvailable
                                  ? isSelected
                                    ? 'bg-[#FEECD6]'
                                    : 'bg-[#0F5C62]'
                                  : isActiveMatch
                                  ? 'bg-[#EA580C]'
                                  : 'bg-[#748079]'
                              }`}
                            />
                            <span>Court {cNum}</span>
                          </span>

                          {isAvailable ? (
                            <span
                              className={`text-xs font-bold ${
                                isSelected ? 'text-[#FEECD6]' : 'text-[#0F5C62]'
                              }`}
                            >
                              Available
                            </span>
                          ) : isActiveMatch ? (
                            <span className="text-xs font-extrabold text-[#EA580C]">
                              Active Match · {session?.score_team0 ?? 0}–{session?.score_team1 ?? 0}
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-[#748079]">
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
              className="h-[52px] w-full rounded-2xl bg-[#0F5C62] text-[#FEECD6] text-base font-extrabold hover:bg-[#085953] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-0 shadow-[0_6px_16px_-4px_rgba(15,92,98,0.35)] flex items-center justify-center gap-2"
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
