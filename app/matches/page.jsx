'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play,
  Shuffle,
  Timer,
  Check,
  AlertCircle,
  Users,
  User,
  X,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '@/config/supabase';
import Header from '@/components/layout/Header';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import { formatMmSs } from '@/hooks/useMatchTimer';

export default function MatchesPage() {
  const router = useRouter();

  // Auth & Profile state
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Active matches state
  const [activeMatches, setActiveMatches] = useState([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [abandonConfirmId, setAbandonConfirmId] = useState(null);
  const [tick, setTick] = useState(0);

  // Match creation form state
  const [format, setFormat] = useState(''); // '' | 'singles' | 'doubles'

  // Singles fields
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const [singlesServer, setSinglesServer] = useState(0); // 0 (player1) or 1 (player2)

  // Doubles fields
  const [team1Name, setTeam1Name] = useState('');
  const [team1Player1, setTeam1Player1] = useState('');
  const [team1Player2, setTeam1Player2] = useState('');

  const [team2Name, setTeam2Name] = useState('');
  const [team2Player1, setTeam2Player1] = useState('');
  const [team2Player2, setTeam2Player2] = useState('');

  const [doublesServingTeam, setDoublesServingTeam] = useState(0); // 0 (team1) or 1 (team2)

  // Form validation & submission state
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [randomizedNotice, setRandomizedNotice] = useState('');

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

  // 2. Fetch active matches for this umpire
  const fetchActiveMatches = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('match_sessions')
        .select('*')
        .eq('umpire_id', userId)
        .eq('status', 'in_progress')
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('[MatchesPage] Error fetching active matches:', error);
      } else {
        setActiveMatches(data || []);
      }
    } catch (err) {
      console.error('[MatchesPage] Fetch active matches failed:', err);
    } finally {
      setIsLoadingMatches(false);
    }
  }, []);

  useEffect(() => {
    if (user?.id) {
      fetchActiveMatches(user.id);
    }
  }, [user?.id, fetchActiveMatches]);

  // 3. Subscribe to Realtime changes on match_sessions for this umpire
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`umpire_active_matches_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_sessions',
          filter: `umpire_id=eq.${user.id}`,
        },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload;

          setActiveMatches((prev) => {
            if (eventType === 'DELETE') {
              return prev.filter((m) => m.id !== oldRow.id);
            }

            if (eventType === 'INSERT') {
              if (newRow.status === 'in_progress') {
                return [newRow, ...prev.filter((m) => m.id !== newRow.id)];
              }
              return prev;
            }

            if (eventType === 'UPDATE') {
              if (newRow.status === 'in_progress') {
                const filtered = prev.filter((m) => m.id !== newRow.id);
                return [newRow, ...filtered];
              } else {
                // Status changed to 'completed' or 'abandoned'
                return prev.filter((m) => m.id !== newRow.id);
              }
            }

            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // 4. Local 1000ms tick for live countdown timers across active cards
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Compute remaining seconds and timer badge for each active match
  const getTimerInfo = (match) => {
    if (!match) return { text: '30:00', isExpired: false, isRunning: false };

    if (match.timer_status === 'running' && match.timer_ends_at) {
      const endsAt = new Date(match.timer_ends_at).getTime();
      const remMs = Math.max(0, endsAt - Date.now());
      const remSec = Math.ceil(remMs / 1000);
      return {
        text: formatMmSs(remSec),
        isExpired: remSec <= 0,
        isRunning: remSec > 0,
      };
    }

    if (match.timer_status === 'paused') {
      const remMs = match.timer_remaining_ms ?? 1800000;
      return {
        text: `${formatMmSs(Math.ceil(remMs / 1000))} (Paused)`,
        isExpired: false,
        isRunning: false,
      };
    }

    if (match.timer_status === 'expired') {
      return { text: "Time's Up (00:00)", isExpired: true, isRunning: false };
    }

    return { text: '30:00 (Idle)', isExpired: false, isRunning: false };
  };

  // 5. Handle match abandonment
  const handleAbandonMatch = async (matchId) => {
    try {
      const { error } = await supabase.rpc('fn_close_session', {
        p_session_id: matchId,
        p_status: 'abandoned',
      });
      if (error) {
        console.error('[MatchesPage] Failed to abandon match:', error);
      } else {
        setActiveMatches((prev) => prev.filter((m) => m.id !== matchId));
      }
    } catch (err) {
      console.error('[MatchesPage] Abandon error:', err);
    } finally {
      setAbandonConfirmId(null);
    }
  };

  // 6. Randomize First Server handlers
  const handleRandomizeSingles = () => {
    const randomPick = Math.random() < 0.5 ? 0 : 1;
    setSinglesServer(randomPick);
    const chosenName =
      randomPick === 0
        ? player1Name.trim() || 'Player 1'
        : player2Name.trim() || 'Player 2';
    setRandomizedNotice(`Randomly selected: ${chosenName} serves first!`);
    setTimeout(() => setRandomizedNotice(''), 3500);
  };

  const handleRandomizeDoubles = () => {
    const randomPick = Math.random() < 0.5 ? 0 : 1;
    setDoublesServingTeam(randomPick);
    const chosenName =
      randomPick === 0
        ? team1Name.trim() || 'Team 1'
        : team2Name.trim() || 'Team 2';
    setRandomizedNotice(`Randomly selected: ${chosenName} serves first!`);
    setTimeout(() => setRandomizedNotice(''), 3500);
  };

  // 7. Form submission: create session & navigate
  const handleCreateMatch = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!format) {
      setFormError('Please select a match format (Singles or Doubles).');
      return;
    }

    if (format === 'singles') {
      const p1 = player1Name.trim();
      const p2 = player2Name.trim();

      if (!p1 || !p2) {
        setFormError('Both Player 1 and Player 2 names are required for Singles.');
        return;
      }
      if (p1.toLowerCase() === p2.toLowerCase()) {
        setFormError('Player names must be distinct.');
        return;
      }

      setIsSubmitting(true);
      try {
        const newSessionId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sess_${Date.now()}`;

        const teamNames = [p1, p2];
        const playerNames = {
          team0: [p1],
          team1: [p2],
        };

        const initialState = {
          format: 'singles',
          scores: [0, 0],
          servingTeam: singlesServer,
          serverNumber: 1,
          serverCourt: 'right',
          courtPositions: [
            { left: '', right: p1 },
            { left: '', right: p2 },
          ],
          gameOver: false,
          winner: null,
        };

        const { error } = await supabase.rpc('fn_create_session', {
          p_session_id: newSessionId,
          p_format: 'singles',
          p_team_keys: ['omega', 'alpha'],
          p_team_names: teamNames,
          p_team_palettes: ['omega', 'alpha'],
          p_player_names: playerNames,
          p_initial_state: initialState,
          p_timer_duration_ms: 1800000,
          p_legacy_log: null,
          p_auto_start_timer: true,
        });

        if (error) {
          setFormError(`Failed to create match: ${error.message}`);
          setIsSubmitting(false);
          return;
        }

        router.push(`/pikolscore?session=${newSessionId}`);
      } catch (err) {
        console.error('[MatchesPage] Create singles match error:', err);
        setFormError('An unexpected error occurred. Please try again.');
        setIsSubmitting(false);
      }
    } else if (format === 'doubles') {
      const t1 = team1Name.trim();
      const t1p1 = team1Player1.trim();
      const t1p2 = team1Player2.trim();

      const t2 = team2Name.trim();
      const t2p1 = team2Player1.trim();
      const t2p2 = team2Player2.trim();

      if (!t1 || !t1p1 || !t1p2) {
        setFormError('Team 1 name and both of its player names are required.');
        return;
      }
      if (!t2 || !t2p1 || !t2p2) {
        setFormError('Team 2 name and both of its player names are required.');
        return;
      }
      if (t1.toLowerCase() === t2.toLowerCase()) {
        setFormError('Team names must be distinct.');
        return;
      }

      setIsSubmitting(true);
      try {
        const newSessionId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sess_${Date.now()}`;

        const teamNames = [t1, t2];
        const playerNames = {
          team0: [t1p1, t1p2],
          team1: [t2p1, t2p2],
        };

        const initialState = {
          format: 'doubles',
          scores: [0, 0],
          servingTeam: doublesServingTeam,
          serverNumber: 2, // Doubles starts 0-0-2
          serverCourt: 'right',
          courtPositions: [
            { left: t1p2, right: t1p1 },
            { left: t2p2, right: t2p1 },
          ],
          gameOver: false,
          winner: null,
        };

        const { error } = await supabase.rpc('fn_create_session', {
          p_session_id: newSessionId,
          p_format: 'doubles',
          p_team_keys: ['omega', 'alpha'],
          p_team_names: teamNames,
          p_team_palettes: ['omega', 'alpha'],
          p_player_names: playerNames,
          p_initial_state: initialState,
          p_timer_duration_ms: 1800000,
          p_legacy_log: null,
          p_auto_start_timer: true,
        });

        if (error) {
          setFormError(`Failed to create match: ${error.message}`);
          setIsSubmitting(false);
          return;
        }

        router.push(`/pikolscore?session=${newSessionId}`);
      } catch (err) {
        console.error('[MatchesPage] Create doubles match error:', err);
        setFormError('An unexpected error occurred. Please try again.');
        setIsSubmitting(false);
      }
    }
  };

  if (isAuthLoading) {
    return <AuthLoadingSplash label="Loading courtside match hub..." />;
  }

  return (
    <div className="ps-shell min-h-screen flex flex-col bg-[#FAF9F5] text-[#203F39]">
      {/* 1. Header (Shared header with Back and Match Log buttons hidden on hub) */}
      <Header
        profile={profile}
        userEmail={userEmail}
        showMatchLog={false}
        isGuest={false}
      />

      {/* 2. Main Workspace (Side-by-side on desktop, stacked on mobile) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-[#084B46]">
            Umpire Match Hub
          </h1>
          <p className="mt-1 text-sm text-[#748079]">
            Register a new match or monitor and continue your active courts in real time.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* LEFT COLUMN: Mandatory Create Match Setup Form */}
          <section
            aria-labelledby="create-match-heading"
            className="lg:col-span-5 bg-[#FEFEFB] border-[1.5px] border-[#E2E5DC] rounded-3xl p-6 sm:p-7 shadow-[0_4px_16px_-4px_rgba(8,75,70,0.06)]"
          >
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-[#E2E5DC]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#EAF0E5] flex items-center justify-center text-[#0F5C62]">
                  <Play size={16} fill="currentColor" />
                </div>
                <h2
                  id="create-match-heading"
                  className="text-xl font-bold text-[#084B46] tracking-tight"
                >
                  Create New Match
                </h2>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0F5C62] bg-[#EAF0E5] px-2.5 py-1 rounded-full">
                11 Pts · Win by 2
              </span>
            </div>

            <form noValidate onSubmit={handleCreateMatch} className="flex flex-col gap-5">
              {/* Format Dropdown */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="match-format"
                  className="text-xs font-bold uppercase tracking-wider text-[#084B46]"
                >
                  Match Format <span className="text-[#0F5C62]">*</span>
                </label>
                <div className="relative">
                  <select
                    id="match-format"
                    value={format}
                    onChange={(e) => {
                      setFormat(e.target.value);
                      setFormError('');
                      setRandomizedNotice('');
                    }}
                    className="w-full h-12 appearance-none rounded-xl bg-[#FAF9F5] border-[1.5px] border-[#E2E5DC] px-4 pr-10 text-[15px] font-semibold text-[#084B46] focus:border-[#0F5C62] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/20 cursor-pointer"
                  >
                    <option value="" disabled>
                      Select match format...
                    </option>
                    <option value="singles">Singles (1 vs 1)</option>
                    <option value="doubles">Doubles (2 vs 2)</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-[#748079]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* DYNAMIC FORM: Singles */}
              {format === 'singles' && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="p-3 bg-[#EAF0E5]/70 rounded-xl border border-[#E2E5DC] flex items-center gap-2 text-xs text-[#203F39]">
                    <User size={15} className="text-[#0F5C62] shrink-0" />
                    <span>Singles registration: Enter both player names. No team name required.</span>
                  </div>

                  {/* Player 1 */}
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="singles-player-1"
                      className="text-xs font-bold text-[#084B46]"
                    >
                      Player 1 Name <span className="text-[#0F5C62]">*</span>
                    </label>
                    <input
                      id="singles-player-1"
                      type="text"
                      placeholder="e.g. Alex Morgan"
                      value={player1Name}
                      onChange={(e) => setPlayer1Name(e.target.value)}
                      className="h-11 rounded-xl bg-[#FAF9F5] border-[1.5px] border-[#E2E5DC] px-4 text-sm font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/20"
                    />
                  </div>

                  {/* Player 2 */}
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="singles-player-2"
                      className="text-xs font-bold text-[#084B46]"
                    >
                      Player 2 Name <span className="text-[#0F5C62]">*</span>
                    </label>
                    <input
                      id="singles-player-2"
                      type="text"
                      placeholder="e.g. Jordan Vance"
                      value={player2Name}
                      onChange={(e) => setPlayer2Name(e.target.value)}
                      className="h-11 rounded-xl bg-[#FAF9F5] border-[1.5px] border-[#E2E5DC] px-4 text-sm font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/20"
                    />
                  </div>

                  {/* First Server Selector + Randomize Button */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-[#E2E5DC]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#084B46]">
                        First Server Selection
                      </span>
                      <button
                        type="button"
                        onClick={handleRandomizeSingles}
                        className="flex items-center gap-1.5 text-xs font-semibold text-[#0F5C62] hover:text-[#085953] bg-[#EAF0E5] px-2.5 py-1 rounded-full border border-[#E2E5DC] transition-colors cursor-pointer"
                        title="Randomly pick who serves first"
                      >
                        <Shuffle size={13} aria-hidden="true" />
                        <span>Randomize</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSinglesServer(0)}
                        className={`h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-bold transition-colors border-[1.5px] cursor-pointer ${
                          singlesServer === 0
                            ? 'bg-[#0F5C62] border-[#0F5C62] text-[#FEECD6]'
                            : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#203F39] hover:bg-[#EAF0E5]'
                        }`}
                      >
                        {singlesServer === 0 && <Check size={14} />}
                        <span className="truncate">
                          {player1Name.trim() || 'Player 1'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSinglesServer(1)}
                        className={`h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-bold transition-colors border-[1.5px] cursor-pointer ${
                          singlesServer === 1
                            ? 'bg-[#0F5C62] border-[#0F5C62] text-[#FEECD6]'
                            : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#203F39] hover:bg-[#EAF0E5]'
                        }`}
                      >
                        {singlesServer === 1 && <Check size={14} />}
                        <span className="truncate">
                          {player2Name.trim() || 'Player 2'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* DYNAMIC FORM: Doubles */}
              {format === 'doubles' && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="p-3 bg-[#EAF0E5]/70 rounded-xl border border-[#E2E5DC] flex items-center gap-2 text-xs text-[#203F39]">
                    <Users size={15} className="text-[#0F5C62] shrink-0" />
                    <span>Doubles registration: Register both team names and two players per team.</span>
                  </div>

                  {/* Team 1 Registration */}
                  <div className="p-3.5 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC] flex flex-col gap-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#084B46]">
                      Team 1 Details
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="team1-name" className="text-xs font-semibold text-[#203F39]">
                        Team 1 Name <span className="text-[#0F5C62]">*</span>
                      </label>
                      <input
                        id="team1-name"
                        type="text"
                        placeholder="e.g. Apex Smashers"
                        value={team1Name}
                        onChange={(e) => setTeam1Name(e.target.value)}
                        className="h-10 rounded-lg bg-[#FEFEFB] border border-[#E2E5DC] px-3 text-sm font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="team1-p1" className="text-[11px] font-semibold text-[#748079]">
                          Player 1 <span className="text-[#0F5C62]">*</span>
                        </label>
                        <input
                          id="team1-p1"
                          type="text"
                          placeholder="Player A"
                          value={team1Player1}
                          onChange={(e) => setTeam1Player1(e.target.value)}
                          className="h-9 rounded-lg bg-[#FEFEFB] border border-[#E2E5DC] px-2.5 text-xs font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="team1-p2" className="text-[11px] font-semibold text-[#748079]">
                          Player 2 <span className="text-[#0F5C62]">*</span>
                        </label>
                        <input
                          id="team1-p2"
                          type="text"
                          placeholder="Player B"
                          value={team1Player2}
                          onChange={(e) => setTeam1Player2(e.target.value)}
                          className="h-9 rounded-lg bg-[#FEFEFB] border border-[#E2E5DC] px-2.5 text-xs font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Team 2 Registration */}
                  <div className="p-3.5 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC] flex flex-col gap-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#084B46]">
                      Team 2 Details
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="team2-name" className="text-xs font-semibold text-[#203F39]">
                        Team 2 Name <span className="text-[#0F5C62]">*</span>
                      </label>
                      <input
                        id="team2-name"
                        type="text"
                        placeholder="e.g. Baseline Titans"
                        value={team2Name}
                        onChange={(e) => setTeam2Name(e.target.value)}
                        className="h-10 rounded-lg bg-[#FEFEFB] border border-[#E2E5DC] px-3 text-sm font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="team2-p1" className="text-[11px] font-semibold text-[#748079]">
                          Player 1 <span className="text-[#0F5C62]">*</span>
                        </label>
                        <input
                          id="team2-p1"
                          type="text"
                          placeholder="Player C"
                          value={team2Player1}
                          onChange={(e) => setTeam2Player1(e.target.value)}
                          className="h-9 rounded-lg bg-[#FEFEFB] border border-[#E2E5DC] px-2.5 text-xs font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="team2-p2" className="text-[11px] font-semibold text-[#748079]">
                          Player 2 <span className="text-[#0F5C62]">*</span>
                        </label>
                        <input
                          id="team2-p2"
                          type="text"
                          placeholder="Player D"
                          value={team2Player2}
                          onChange={(e) => setTeam2Player2(e.target.value)}
                          className="h-9 rounded-lg bg-[#FEFEFB] border border-[#E2E5DC] px-2.5 text-xs font-medium text-[#084B46] placeholder:text-[#748079] focus:border-[#0F5C62] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Serving Team Selector + Randomize Button */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-[#E2E5DC]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#084B46]">
                        First Serving Team
                      </span>
                      <button
                        type="button"
                        onClick={handleRandomizeDoubles}
                        className="flex items-center gap-1.5 text-xs font-semibold text-[#0F5C62] hover:text-[#085953] bg-[#EAF0E5] px-2.5 py-1 rounded-full border border-[#E2E5DC] transition-colors cursor-pointer"
                        title="Randomly pick which team serves first"
                      >
                        <Shuffle size={13} aria-hidden="true" />
                        <span>Randomize</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDoublesServingTeam(0)}
                        className={`h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-bold transition-colors border-[1.5px] cursor-pointer ${
                          doublesServingTeam === 0
                            ? 'bg-[#0F5C62] border-[#0F5C62] text-[#FEECD6]'
                            : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#203F39] hover:bg-[#EAF0E5]'
                        }`}
                      >
                        {doublesServingTeam === 0 && <Check size={14} />}
                        <span className="truncate">
                          {team1Name.trim() || 'Team 1'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDoublesServingTeam(1)}
                        className={`h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-bold transition-colors border-[1.5px] cursor-pointer ${
                          doublesServingTeam === 1
                            ? 'bg-[#0F5C62] border-[#0F5C62] text-[#FEECD6]'
                            : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#203F39] hover:bg-[#EAF0E5]'
                        }`}
                      >
                        {doublesServingTeam === 1 && <Check size={14} />}
                        <span className="truncate">
                          {team2Name.trim() || 'Team 2'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Format not yet selected */}
              {!format && (
                <div className="p-6 bg-[#FAF9F5] rounded-2xl border border-dashed border-[#E2E5DC] text-center text-sm text-[#748079]">
                  Select <b>Singles</b> or <b>Doubles</b> in the dropdown above to display the mandatory player registration form.
                </div>
              )}

              {/* Feedback & Notifications */}
              {randomizedNotice && (
                <div
                  role="status"
                  className="p-3 bg-[#FEECD6] border border-[#E2E5DC] rounded-xl text-xs font-semibold text-[#084B46] flex items-center gap-2"
                >
                  <Shuffle size={14} className="text-[#0F5C62]" />
                  <span>{randomizedNotice}</span>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-[#BA1A1A] flex items-center gap-2"
                >
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={!format || isSubmitting}
                className="mt-2 h-13 w-full flex items-center justify-center gap-2.5 rounded-full bg-[#0F5C62] hover:bg-[#085953] active:translate-y-[1px] text-[#FEECD6] text-[16px] font-bold shadow-[0_10px_24px_-10px_rgba(15,92,98,0.5)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5C62]"
              >
                <Play size={18} fill="currentColor" />
                <span>{isSubmitting ? 'Starting Match...' : 'Start Match on Scoreboard'}</span>
              </button>
            </form>
          </section>

          {/* RIGHT COLUMN: Active Matches Live List */}
          <section
            aria-labelledby="active-matches-heading"
            className="lg:col-span-7 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h2
                  id="active-matches-heading"
                  className="text-xl font-bold text-[#084B46] tracking-tight"
                >
                  Active Matches Under Your Supervision
                </h2>
                <span className="text-xs font-bold text-[#0F5C62] bg-[#EAF0E5] px-2.5 py-0.5 rounded-full border border-[#E2E5DC]">
                  {activeMatches.length}
                </span>
              </div>
            </div>

            {isLoadingMatches ? (
              <div className="p-12 bg-[#FEFEFB] rounded-3xl border border-[#E2E5DC] flex flex-col items-center justify-center gap-3 text-sm text-[#748079]">
                <div className="w-6 h-6 border-2 border-[#0F5C62] border-t-transparent rounded-full animate-spin" />
                <span>Loading active match sessions...</span>
              </div>
            ) : activeMatches.length === 0 ? (
              <div className="p-10 bg-[#FEFEFB] rounded-3xl border border-dashed border-[#E2E5DC] flex flex-col items-center justify-center text-center gap-2.5 text-[#748079]">
                <div className="w-12 h-12 rounded-full bg-[#EAF0E5] flex items-center justify-center text-[#0F5C62] mb-1">
                  <Play size={22} fill="currentColor" />
                </div>
                <h3 className="text-base font-bold text-[#084B46]">
                  No active matches right now
                </h3>
                <p className="text-sm max-w-sm">
                  Complete the setup form on the left to start your next match, or return to any court when ready.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {activeMatches.map((m) => {
                  const timerInfo = getTimerInfo(m);
                  const isSingles = m.format === 'singles';
                  const team0 = m.team_names?.[0] || 'Team 1';
                  const team1 = m.team_names?.[1] || 'Team 2';
                  const score0 = m.score_team0 ?? 0;
                  const score1 = m.score_team1 ?? 0;
                  const servingTeam = m.serving_team ?? 0;

                  const pNames0 = m.player_names?.team0 || [];
                  const pNames1 = m.player_names?.team1 || [];

                  const isConfirmingAbandon = abandonConfirmId === m.id;

                  return (
                    <div
                      key={m.id}
                      className="bg-[#FEFEFB] border-[1.5px] border-[#E2E5DC] rounded-3xl p-5 sm:p-6 shadow-[0_4px_16px_-4px_rgba(8,75,70,0.06)] hover:border-[#0F5C62]/40 transition-all flex flex-col gap-4"
                    >
                      {/* Top status bar */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-[#0F5C62] bg-[#EAF0E5] px-2.5 py-1 rounded-full border border-[#E2E5DC]">
                            {isSingles ? 'Singles' : 'Doubles'}
                          </span>
                          <span
                            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                              timerInfo.isExpired
                                ? 'bg-red-50 text-[#BA1A1A] border-red-200'
                                : timerInfo.isRunning
                                ? 'bg-[#FAF9F5] text-[#084B46] border-[#E2E5DC]'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            <Timer size={13} className="shrink-0" />
                            <span className="font-mono tabular-nums">{timerInfo.text}</span>
                          </span>
                        </div>

                        {/* Abandon Action */}
                        <div>
                          {isConfirmingAbandon ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-[#BA1A1A]">
                                End match?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleAbandonMatch(m.id)}
                                className="px-2.5 py-1 bg-[#BA1A1A] text-white rounded-lg text-xs font-bold hover:bg-red-800 transition-colors cursor-pointer"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setAbandonConfirmId(null)}
                                className="px-2 py-1 bg-[#FAF9F5] border border-[#E2E5DC] text-[#748079] rounded-lg text-xs font-semibold hover:bg-[#EAF0E5] transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAbandonConfirmId(m.id)}
                              className="text-xs font-semibold text-[#748079] hover:text-[#BA1A1A] px-2 py-1 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                              title="Abandon and close match session"
                            >
                              Abandon
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Matchup & Score Display */}
                      <div className="grid grid-cols-2 gap-3 items-center bg-[#FAF9F5] rounded-2xl p-4 border border-[#E2E5DC]">
                        {/* Side 0 */}
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-base text-[#084B46] truncate">
                              {team0}
                            </span>
                            {servingTeam === 0 && (
                              <span className="w-2 h-2 rounded-full bg-[#0F5C62] animate-pulse" title="Serving" />
                            )}
                          </div>
                          {!isSingles && pNames0.length > 0 && (
                            <span className="text-xs text-[#748079] truncate">
                              {pNames0.filter(Boolean).join(' · ')}
                            </span>
                          )}
                          <div className="mt-1 font-mono text-3xl font-black text-[#084B46] tabular-nums">
                            {score0}
                          </div>
                        </div>

                        {/* Side 1 */}
                        <div className="flex flex-col gap-0.5 text-right items-end">
                          <div className="flex items-center gap-1.5">
                            {servingTeam === 1 && (
                              <span className="w-2 h-2 rounded-full bg-[#0F5C62] animate-pulse" title="Serving" />
                            )}
                            <span className="font-bold text-base text-[#084B46] truncate">
                              {team1}
                            </span>
                          </div>
                          {!isSingles && pNames1.length > 0 && (
                            <span className="text-xs text-[#748079] truncate">
                              {pNames1.filter(Boolean).join(' · ')}
                            </span>
                          )}
                          <div className="mt-1 font-mono text-3xl font-black text-[#084B46] tabular-nums">
                            {score1}
                          </div>
                        </div>
                      </div>

                      {/* Primary CTA: Continue or View Result if time expired */}
                      <div>
                        {timerInfo.isExpired ? (
                          <button
                            type="button"
                            onClick={() => router.push(`/pikolscore?session=${m.id}`)}
                            className="h-11 w-full flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm shadow-sm transition-colors cursor-pointer"
                          >
                            <AlertTriangle size={16} />
                            <span>Time's Up — View Result on Scoreboard</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => router.push(`/pikolscore?session=${m.id}`)}
                            className="h-11 w-full flex items-center justify-center gap-2 rounded-xl bg-[#0F5C62] hover:bg-[#085953] text-[#FEECD6] font-bold text-sm shadow-sm transition-colors cursor-pointer"
                          >
                            <Play size={15} fill="currentColor" />
                            <span>Continue Scoring Match</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
