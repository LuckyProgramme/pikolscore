'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/config/supabase';
import Header from '@/components/layout/Header';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import CourtQrLobbyModal from '@/components/scoreboard/CourtQrLobbyModal';
import { formatMmSs } from '@/hooks/useMatchTimer';

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
  const [actionError, setActionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
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

    for (let c = 1; c <= 4; c++) {
      const cSession = courtsData[c];
      if (
        cSession &&
        getAssignedUmpireId(cSession) === user.id &&
        cSession.player_names?.lobbyLocked === true
      ) {
        router.replace(`/pikolscore?session=${encodeURIComponent(cSession.id)}`);
        return;
      }
    }
  }, [user?.id, courtsData, isLoadingCourts, router]);

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

  // Umpire Actions
  const handleJoinCourt = async (courtNumber) => {
    if (isSubmitting) return;
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
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Title & Status Banner */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#EAF0E5] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#0F5C62] border border-[#E2E5DC]">
                4 Fixed Courts
              </span>
              <span className="text-xs text-[#748079]">Doubles Format (2 vs 2)</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#084B46] mt-1">
              Umpire Court Hub
            </h1>
            <p className="mt-1 text-sm text-[#748079]">
              Join a court as its official umpire to supervise player arrival, manage walk-ups, and officiate.
            </p>
          </div>

          {myAssignedCourtNumber && (
            <div className="flex items-center gap-3 bg-[#EAF0E5] border border-[#0F5C62]/30 px-4 py-2.5 rounded-2xl">
              <Shield size={18} className="text-[#0F5C62] shrink-0" />
              <div>
                <div className="text-xs font-bold text-[#084B46]">
                  Assigned to Court {myAssignedCourtNumber}
                </div>
                <div className="text-[11px] text-[#748079]">
                  Single-court rule: Finish or leave before joining another court.
                </div>
              </div>
            </div>
          )}
        </div>

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

        {/* 4 Fixed Courts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {[1, 2, 3, 4].map((courtNum) => {
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

            // Timer display if match is started
            const timerEndsAt = session?.timer_ends_at;
            let timerDisplay = '30:00';
            if (isMatchStarted && timerEndsAt) {
              const remMs = Math.max(0, new Date(timerEndsAt).getTime() - Date.now());
              timerDisplay = formatMmSs(Math.ceil(remMs / 1000));
            }

            return (
              <div
                key={courtNum}
                className={`rounded-3xl border-[1.5px] p-6 sm:p-7 shadow-[0_4px_16px_-4px_rgba(8,75,70,0.06)] transition-all flex flex-col gap-5 ${
                  isMyCourt
                    ? 'bg-[#FEFEFB] border-[#0F5C62] ring-2 ring-[#0F5C62]/20'
                    : 'bg-[#FEFEFB] border-[#E2E5DC]'
                }`}
              >
                {/* Court Card Header */}
                <div className="flex items-center justify-between pb-4 border-b border-[#E2E5DC]">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-2xl font-black text-lg ${
                        isMyCourt
                          ? 'bg-[#0F5C62] text-[#FEECD6]'
                          : 'bg-[#EAF0E5] text-[#084B46]'
                      }`}
                    >
                      {courtNum}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-[#084B46] tracking-tight m-0">
                        Court {courtNum}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5">
                        {isMatchStarted ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#BA1A1A]">
                            <span className="w-2 h-2 rounded-full bg-[#BA1A1A] animate-ping" />
                            Match in Progress ({timerDisplay})
                          </span>
                        ) : filledCount > 0 ? (
                          <span className="text-xs font-semibold text-[#0F5C62]">
                            Lobby Open · {filledCount}/4 Players
                          </span>
                        ) : (
                          <span className="text-xs text-[#748079]">Available Court</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* QR Code Action Button */}
                  <button
                    type="button"
                    onClick={() => setQrModalCourtNum(courtNum)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] text-xs font-semibold text-[#084B46] hover:bg-[#EAF0E5] transition-colors cursor-pointer"
                    title={`View QR Code for Court ${courtNum}`}
                  >
                    <QrCode size={14} />
                    <span>Court QR</span>
                  </button>
                </div>

                {/* Umpire Assignment Status */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC]">
                  <div className="flex items-center gap-2 text-xs">
                    <Shield
                      size={15}
                      className={
                        isMyCourt
                          ? 'text-[#0F5C62]'
                          : hasOtherUmpire
                          ? 'text-[#748079]'
                          : 'text-[#D97706]'
                      }
                    />
                    <span className="font-semibold text-[#203F39]">
                      {isMyCourt
                        ? 'Officiating: You'
                        : hasOtherUmpire
                        ? `Officiating: ${umpireName || 'Another Umpire'}`
                        : 'No Umpire Assigned'}
                    </span>
                  </div>

                  {/* Umpire Join / Leave Buttons */}
                  <div>
                    {isMyCourt ? (
                      !isMatchStarted && (
                        <button
                          type="button"
                          onClick={() => handleLeaveCourt(courtNum)}
                          disabled={isSubmitting}
                          className="text-xs font-bold text-[#BA1A1A] hover:underline bg-transparent border-0 cursor-pointer"
                        >
                          Leave Court
                        </button>
                      )
                    ) : !hasOtherUmpire && !isMatchStarted ? (
                      <button
                        type="button"
                        onClick={() => handleJoinCourt(courtNum)}
                        disabled={isSubmitting || Boolean(myAssignedCourtNumber)}
                        title={
                          myAssignedCourtNumber
                            ? `You must leave Court ${myAssignedCourtNumber} first`
                            : 'Join as official umpire for this court'
                        }
                        className="px-3 py-1.5 rounded-full bg-[#0F5C62] text-[#FEECD6] text-xs font-bold hover:bg-[#085953] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-0"
                      >
                        Join as Umpire
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* VIEW A: Match in Progress on this court */}
                {isMatchStarted ? (
                  <div className="flex flex-col gap-4">
                    {/* Score summary block */}
                    <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-[#EAF0E5]/60 border border-[#E2E5DC] text-center">
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-bold text-[#748079] uppercase">
                          {session.team_names?.[0] || 'Team A'}
                        </span>
                        <span className="font-mono text-3xl font-black text-[#084B46] mt-1">
                          {session.score_team0 ?? 0}
                        </span>
                      </div>
                      <div className="flex flex-col items-center border-l border-[#E2E5DC]">
                        <span className="text-xs font-bold text-[#748079] uppercase">
                          {session.team_names?.[1] || 'Team B'}
                        </span>
                        <span className="font-mono text-3xl font-black text-[#084B46] mt-1">
                          {session.score_team1 ?? 0}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => router.push(`/pikolscore?session=${session.id}`)}
                      className="h-12 w-full flex items-center justify-center gap-2 rounded-full bg-[#0F5C62] text-[#FEECD6] text-sm font-bold hover:bg-[#085953] transition-colors cursor-pointer"
                    >
                      <Play size={16} fill="currentColor" />
                      <span>{isMyCourt ? 'Resume Scoreboard' : 'Spectate Scoreboard'}</span>
                    </button>
                  </div>
                ) : (
                  /* VIEW B: Pre-Match Lobby & Roster Slots */
                  <div className="flex flex-col gap-4">
                    {/* 4 Player Slots Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Team A Slots */}
                      <div className="flex flex-col gap-2 p-3 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC]">
                        <span className="text-xs font-bold text-[#084B46] uppercase tracking-wider">
                          Team A Slots
                        </span>
                        {[0, 1].map((sIdx) => {
                          const slot = team0Slots[sIdx];
                          const hasPlayer = Boolean(slot?.name?.trim());
                          const isAdding =
                            activeWalkup?.courtNumber === courtNum &&
                            activeWalkup?.team === 0 &&
                            activeWalkup?.slotIndex === sIdx;

                          return (
                            <div
                              key={`t0-${sIdx}`}
                              className="flex items-center justify-between gap-1.5 p-2 rounded-xl bg-white border border-[#E2E5DC] text-xs min-h-[38px]"
                            >
                              {hasPlayer ? (
                                <>
                                  <span className="font-semibold text-[#084B46] truncate">
                                    {slot.name}
                                  </span>
                                  {isMyCourt && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSetWalkupSlot(courtNum, 0, sIdx, '')
                                      }
                                      className="text-[#748079] hover:text-[#BA1A1A] p-1 bg-transparent border-0 cursor-pointer"
                                      title="Remove player"
                                    >
                                      <X size={14} />
                                    </button>
                                  )}
                                </>
                              ) : isAdding ? (
                                <div className="flex items-center gap-1 w-full">
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="Walk-up name"
                                    value={walkupName}
                                    onChange={(e) => setWalkupName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSetWalkupSlot(courtNum, 0, sIdx, walkupName);
                                      } else if (e.key === 'Escape') {
                                        setActiveWalkup(null);
                                      }
                                    }}
                                    className="h-7 flex-1 min-w-0 rounded bg-[#FAF9F5] border border-[#E2E5DC] px-2 text-xs text-[#084B46] outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSetWalkupSlot(courtNum, 0, sIdx, walkupName)
                                    }
                                    className="h-7 px-2 rounded bg-[#0F5C62] text-[11px] font-bold text-white border-0 cursor-pointer"
                                  >
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setActiveWalkup(null)}
                                    className="h-7 px-1.5 text-xs text-[#748079] bg-transparent border-0 cursor-pointer"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-[#748079] italic">
                                    Slot {sIdx + 1}: Open
                                  </span>
                                  {isMyCourt && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveWalkup({ courtNumber: courtNum, team: 0, slotIndex: sIdx });
                                        setWalkupName('');
                                      }}
                                      className="text-[#0F5C62] hover:underline font-bold text-[11px] bg-transparent border-0 cursor-pointer flex items-center gap-0.5"
                                    >
                                      <Plus size={12} />
                                      <span>Walk-up</span>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Team B Slots */}
                      <div className="flex flex-col gap-2 p-3 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC]">
                        <span className="text-xs font-bold text-[#084B46] uppercase tracking-wider">
                          Team B Slots
                        </span>
                        {[0, 1].map((sIdx) => {
                          const slot = team1Slots[sIdx];
                          const hasPlayer = Boolean(slot?.name?.trim());
                          const isAdding =
                            activeWalkup?.courtNumber === courtNum &&
                            activeWalkup?.team === 1 &&
                            activeWalkup?.slotIndex === sIdx;

                          return (
                            <div
                              key={`t1-${sIdx}`}
                              className="flex items-center justify-between gap-1.5 p-2 rounded-xl bg-white border border-[#E2E5DC] text-xs min-h-[38px]"
                            >
                              {hasPlayer ? (
                                <>
                                  <span className="font-semibold text-[#084B46] truncate">
                                    {slot.name}
                                  </span>
                                  {isMyCourt && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSetWalkupSlot(courtNum, 1, sIdx, '')
                                      }
                                      className="text-[#748079] hover:text-[#BA1A1A] p-1 bg-transparent border-0 cursor-pointer"
                                      title="Remove player"
                                    >
                                      <X size={14} />
                                    </button>
                                  )}
                                </>
                              ) : isAdding ? (
                                <div className="flex items-center gap-1 w-full">
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="Walk-up name"
                                    value={walkupName}
                                    onChange={(e) => setWalkupName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSetWalkupSlot(courtNum, 1, sIdx, walkupName);
                                      } else if (e.key === 'Escape') {
                                        setActiveWalkup(null);
                                      }
                                    }}
                                    className="h-7 flex-1 min-w-0 rounded bg-[#FAF9F5] border border-[#E2E5DC] px-2 text-xs text-[#084B46] outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSetWalkupSlot(courtNum, 1, sIdx, walkupName)
                                    }
                                    className="h-7 px-2 rounded bg-[#0F5C62] text-[11px] font-bold text-white border-0 cursor-pointer"
                                  >
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setActiveWalkup(null)}
                                    className="h-7 px-1.5 text-xs text-[#748079] bg-transparent border-0 cursor-pointer"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-[#748079] italic">
                                    Slot {sIdx + 1}: Open
                                  </span>
                                  {isMyCourt && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveWalkup({ courtNumber: courtNum, team: 1, slotIndex: sIdx });
                                        setWalkupName('');
                                      }}
                                      className="text-[#0F5C62] hover:underline font-bold text-[11px] bg-transparent border-0 cursor-pointer flex items-center gap-0.5"
                                    >
                                      <Plus size={12} />
                                      <span>Walk-up</span>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Controls only shown to the assigned umpire on this court */}
                    {isMyCourt ? (
                      <div className="flex flex-col gap-3 pt-2 border-t border-[#E2E5DC]">
                        {/* Server selection */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#084B46]">
                            First Serving Team
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRandomizeServer(courtNum)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-[#0F5C62] bg-[#EAF0E5] px-2 py-0.5 rounded-full border border-[#E2E5DC] cursor-pointer"
                          >
                            <Shuffle size={11} />
                            <span>Randomize</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setFirstServerMap((prev) => ({ ...prev, [courtNum]: 0 }))
                            }
                            className={`h-9 rounded-xl text-xs font-bold transition-colors border cursor-pointer ${
                              firstServerMap[courtNum] === 0
                                ? 'bg-[#0F5C62] border-[#0F5C62] text-[#FEECD6]'
                                : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#203F39]'
                            }`}
                          >
                            Team A
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFirstServerMap((prev) => ({ ...prev, [courtNum]: 1 }))
                            }
                            className={`h-9 rounded-xl text-xs font-bold transition-colors border cursor-pointer ${
                              firstServerMap[courtNum] === 1
                                ? 'bg-[#0F5C62] border-[#0F5C62] text-[#FEECD6]'
                                : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#203F39]'
                            }`}
                          >
                            Team B
                          </button>
                        </div>

                        {/* Start Match CTA */}
                        <button
                          type="button"
                          disabled={!isFull || isSubmitting}
                          onClick={() => handleStartMatch(courtNum)}
                          className="h-12 w-full flex items-center justify-center gap-2 rounded-full bg-[#0F5C62] text-[#FEECD6] text-sm font-bold hover:bg-[#085953] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-0 shadow-sm"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              <span>Starting Match...</span>
                            </>
                          ) : isFull ? (
                            <>
                              <Play size={16} fill="currentColor" />
                              <span>Start Match (30:00)</span>
                            </>
                          ) : (
                            <span>Waiting for 4 Players ({filledCount}/4)</span>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="text-center p-3 rounded-xl bg-[#FAF9F5] border border-dashed border-[#E2E5DC] text-xs text-[#748079]">
                        {hasOtherUmpire
                          ? 'Umpire assigned. Waiting for full roster to start match.'
                          : 'Join as umpire to manage roster and start match.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

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
    </div>
  );
}
