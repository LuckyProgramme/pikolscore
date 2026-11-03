'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Outfit } from 'next/font/google';
import {
  Camera,
  Check,
  Eye,
  Lock,
  LogOut,
  ShieldAlert,
  Trash2,
  Upload,
  User,
  X,
  QrCode,
  Shield,
  Timer,
  Plus,
  Play,
  RotateCcw,
  Sparkles,
  LayoutGrid,
} from 'lucide-react';
import { supabase } from '@/config/supabase';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import FlipDigit from '@/components/scoreboard/FlipDigit';
import { formatMmSs } from '@/hooks/useMatchTimer';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EXPERIENCE_LEVELS = [
  {
    key: 'beginner',
    title: 'Beginner',
    desc: 'Learning the rules, basic strokes, and kitchen boundaries.',
  },
  {
    key: 'novice',
    title: 'Novice',
    desc: 'Can sustain short rallies, developing court positioning and serve consistency.',
  },
  {
    key: 'intermediate',
    title: 'Intermediate',
    desc: 'Consistent placement, directional control, dinking patience, and third-shot drops.',
  },
  {
    key: 'expert',
    title: 'Expert',
    desc: 'Tournament play, high-speed resets, advanced spin control, and tactical aggression.',
  },
];

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getCourtNumber(row) {
  return Number(row?.court_number || row?.player_names?.courtNumber) || null;
}

export default function PlayerPortal() {
  const router = useRouter();
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sessionParam, setSessionParam] = useState(null);
  const [courtParam, setCourtParam] = useState(null);

  // Active view tab when not in started match: 'courts' | 'profile'
  const [activeTab, setActiveTab] = useState('courts');

  // Courts Data: map of courtNumber -> match_session
  const [courtsData, setCourtsData] = useState({});
  const [isLobbySubmitting, setIsLobbySubmitting] = useState(false);
  const [lobbyError, setLobbyError] = useState('');
  const [tick, setTick] = useState(0);

  // Auth form state (unauthenticated)
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  // Player Profile form state (authenticated)
  const [fullName, setFullName] = useState('');
  const [experience, setExperience] = useState('');
  const [photos, setPhotos] = useState([
    { url: null, file: null, size: 0, isNew: false },
    { url: null, file: null, size: 0, isNew: false },
    { url: null, file: null, size: 0, isNew: false },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  const fileInputRefs = [useRef(null), useRef(null), useRef(null)];

  // 1. Initial Session & Profile Loader
  useEffect(() => {
    let isMounted = true;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);
    setSessionParam(params.get('session') || null);
    setCourtParam(Number(params.get('court')) || null);

    async function loadUserSession() {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!isMounted) return;
        setSession(currentSession);

        if (currentSession?.user) {
          await loadUserProfile(currentSession.user);
        } else {
          setLoadingInitial(false);
        }
      } catch (err) {
        console.error('Session load error:', err);
        if (isMounted) setLoadingInitial(false);
      }
    }

    loadUserSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      if (newSession?.user) {
        await loadUserProfile(newSession.user);
      } else {
        setProfile(null);
        setLoadingInitial(false);
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // 2. Fetch courts and subscribe to realtime updates
  const fetchCourts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('match_sessions')
        .select('*')
        .eq('status', 'in_progress')
        .order('updated_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        const map = {};
        data.forEach((row) => {
          const cNum = getCourtNumber(row);
          if (cNum >= 1 && cNum <= 4) map[cNum] = row;
        });
        setCourtsData(map);
      }
    } catch (err) {
      console.warn('Failed to fetch courts for player:', err);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchCourts();

      const channel = supabase
        .channel('player_courts_realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'match_sessions' },
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
    }
  }, [session?.user, fetchCourts]);

  // Tick for timers
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 3. Load profile data
  async function loadUserProfile(user) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) console.warn('Profile fetch warning:', error);

      let currentProfile = data;

      if (!currentProfile || currentProfile.role === null) {
        const defaultName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split('@')[0] ||
          '';

        const { data: claimedProfile } = await supabase
          .from('profiles')
          .update({
            role: 'player',
            full_name: currentProfile?.full_name || defaultName,
            last_active_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select('*')
          .maybeSingle();

        currentProfile = claimedProfile || {
          ...currentProfile,
          role: 'player',
          full_name: defaultName,
        };
      }

      setProfile(currentProfile);

      setFullName(
        currentProfile?.full_name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          ''
      );
      setExperience(currentProfile?.experience || '');

      // If new profile with no experience, default tab to profile onboarding
      if (!currentProfile?.experience) {
        setActiveTab('profile');
      }

      const rawUrls = Array.isArray(currentProfile?.photo_urls)
        ? currentProfile.photo_urls
        : [null, null, null];

      const initialSlots = [
        { url: rawUrls[0] || currentProfile?.avatar_url || null, file: null, size: 0, isNew: false },
        { url: rawUrls[1] || null, file: null, size: 0, isNew: false },
        { url: rawUrls[2] || null, file: null, size: 0, isNew: false },
      ];

      setPhotos(initialSlots);
      setLoadingInitial(false);
    } catch (err) {
      console.error('Error loading profile:', err);
      setLoadingInitial(false);
    }
  }

  // Prevent browser back button from falling back to login or external previous tab history
  useEffect(() => {
    if (loadingInitial || !session?.user || profile?.role === 'referee') return;

    window.history.pushState({ page: 'player' }, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState({ page: 'player' }, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [loadingInitial, session?.user, profile?.role]);

  // 4. Lobby API Caller for Player slot claiming / leaving
  const callLobbyApi = async (payload) => {
    setLobbyError('');
    setIsLobbySubmitting(true);
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
        throw new Error(data.error || 'Failed to claim court slot');
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
      setLobbyError(err.message || 'Operation failed');
      return null;
    } finally {
      setIsLobbySubmitting(false);
    }
  };

  const handleClaimSlot = async (courtNumber, team, slotIndex) => {
    const s = courtsData[courtNumber];
    await callLobbyApi({
      action: 'claim_slot',
      courtNumber,
      sessionId: s?.id,
      team,
      slotIndex,
    });
    fetchCourts();
  };

  const handleLeaveSlot = async (courtNumber) => {
    const s = courtsData[courtNumber];
    if (!s) return;
    await callLobbyApi({
      action: 'claim_slot',
      courtNumber,
      sessionId: s.id,
      team: null,
      slotIndex: null,
    });
    fetchCourts();
  };

  // 5. Auth Handlers
  const sessionQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (courtParam) p.set('court', String(courtParam));
    if (sessionParam) p.set('session', String(sessionParam));
    const str = p.toString();
    return str ? `?${str}` : '';
  }, [courtParam, sessionParam]);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/player${sessionQuery}`,
        },
      });
      if (error) setAuthError(error.message);
    } catch {
      setAuthError('Failed to initiate Google sign-in.');
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');

    const trimmedEmail = authEmail.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setAuthError('Please enter a valid email address.');
      return;
    }

    if (!authPassword || authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    if (authMode === 'signup') {
      const trimmedName = authName.trim();
      if (!trimmedName) {
        setAuthError('Please enter your full name.');
        return;
      }
      if (authPassword !== authConfirmPassword) {
        setAuthError("Passwords don't match.");
        return;
      }

      setAuthLoading(true);
      try {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: authPassword,
          options: {
            data: { full_name: trimmedName, role: 'player' },
            emailRedirectTo: `${window.location.origin}/player${sessionQuery}`,
          },
        });

        if (error) {
          setAuthError(error.message);
          return;
        }

        if (data?.session) {
          setSession(data.session);
          await loadUserProfile(data.session.user);
        } else {
          setAuthSuccess('Account created! Check your email to confirm your address, then sign in.');
          setAuthMode('signin');
        }
      } catch (err) {
        setAuthError(err.message || 'Registration failed.');
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    // Sign in
    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: authPassword,
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      if (data?.session) {
        setSession(data.session);
        await loadUserProfile(data.session.user);
      }
    } catch (err) {
      setAuthError(err.message || 'Sign in failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  // 6. Photo & Profile Handlers
  const totalBytes = photos.reduce((acc, p) => acc + (p?.size || 0), 0);
  const isOverLimit = totalBytes > MAX_TOTAL_BYTES;

  const handlePhotoSelect = (slotIndex, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setSaveError('Only JPG, PNG, and WebP images are allowed.');
      return;
    }

    setSaveError('');
    const previewUrl = URL.createObjectURL(file);

    setPhotos((prev) => {
      const next = [...prev];
      next[slotIndex] = { url: previewUrl, file, size: file.size, isNew: true };
      return next;
    });

    if (fileInputRefs[slotIndex]?.current) {
      fileInputRefs[slotIndex].current.value = '';
    }
  };

  const handlePhotoRemove = (slotIndex) => {
    setSaveError('');
    setPhotos((prev) => {
      const next = [...prev];
      next[slotIndex] = { url: null, file: null, size: 0, isNew: false };
      return next;
    });
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess('');

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setSaveError('Please enter your full name.');
      return;
    }

    if (!experience) {
      setSaveError('Please select your experience level.');
      return;
    }

    if (isOverLimit) {
      setSaveError('Total photo size exceeds 15 MB.');
      return;
    }

    setIsSaving(true);
    try {
      const userId = session.user.id;
      const finalUrls = [null, null, null];

      for (let i = 0; i < 3; i++) {
        const slot = photos[i];
        if (slot?.isNew && slot?.file) {
          const ext = slot.file.name.split('.').pop() || 'jpg';
          const filePath = `${userId}/slot-${i + 1}-${Date.now()}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('player-photos')
            .upload(filePath, slot.file, { cacheControl: '3600', upsert: true });

          if (uploadError) throw new Error(`Upload error on photo ${i + 1}: ${uploadError.message}`);

          const {
            data: { publicUrl },
          } = supabase.storage.from('player-photos').getPublicUrl(filePath);

          finalUrls[i] = publicUrl;
        } else if (slot?.url && !slot.isNew) {
          finalUrls[i] = slot.url;
        }
      }

      const primaryAvatar = finalUrls[0] || finalUrls[1] || finalUrls[2] || null;

      const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          experience,
          photo_urls: finalUrls,
          avatar_url: primaryAvatar,
          last_active_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('*')
        .single();

      if (updateError) throw updateError;

      setProfile(updated);
      setSaveSuccess('Player profile updated successfully!');
      setActiveTab('courts');
    } catch (err) {
      setSaveError(err.message || 'Failed to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  // 7. Detect if Player is in an ACTIVE STARTED MATCH
  const myStartedMatch = useMemo(() => {
    if (!session?.user?.id) return null;
    const uid = session.user.id;

    for (let c = 1; c <= 4; c++) {
      const s = courtsData[c];
      if (s && s.status === 'in_progress' && s.player_names?.lobbyLocked === true) {
        const rSlots = s.player_names?.slots || {};
        const inTeam0 = rSlots.team0?.some((sl) => sl?.userId === uid);
        const inTeam1 = rSlots.team1?.some((sl) => sl?.userId === uid);
        if (inTeam0) return { session: s, myTeamIndex: 0, courtNumber: c };
        if (inTeam1) return { session: s, myTeamIndex: 1, courtNumber: c };
      }
    }
    return null;
  }, [session?.user?.id, courtsData]);

  // Loading state
  if (loadingInitial) {
    return <AuthLoadingSplash label="Loading player portal..." />;
  }

  // Umpire account guard
  if (session && profile?.role === 'referee') {
    return (
      <div className={`${outfit.className} min-h-screen grid place-items-center bg-[#FAF9F5] p-4 font-outfit text-[#203F39]`}>
        <div className="w-full max-w-[500px] rounded-3xl bg-[#FEFEFB] p-8 shadow-xl border border-[#E2E5DC] text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-[#BA1A1A] mb-4">
            <ShieldAlert size={32} />
          </div>
          <h1 className="text-2xl font-bold text-[#084B46] mb-2">Umpire Account Detected</h1>
          <p className="text-sm text-[#748079] mb-6">
            <strong>{session.user.email}</strong> is registered as an official match umpire.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/matches"
              className="h-12 flex items-center justify-center rounded-full bg-[#0F5C62] text-sm font-bold text-[#FEECD6] no-underline hover:bg-[#085953]"
            >
              Open Umpire Court Hub
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="h-11 rounded-full border border-[#E2E5DC] bg-white text-xs font-semibold text-[#084B46] cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // View A: Unauthenticated Player Auth Form
  if (!session) {
    const isSignUp = authMode === 'signup';

    return (
      <div className={`${outfit.className} min-h-screen grid place-items-center bg-[#FAF9F5] p-4 sm:p-6 font-outfit text-[#203F39]`}>
        <main className="w-full max-w-[460px] rounded-[32px] bg-[#FEFEFB] p-6 sm:p-10 shadow-xl border border-[#E2E5DC]">
          <div className="flex items-center justify-between mb-6">
            <Link
              href={`/role${sessionQuery}`}
              className="flex items-center gap-3 text-2xl font-bold tracking-tight text-[#084B46] no-underline"
            >
              <svg width="36" height="36" viewBox="0 0 40 40">
                <rect width="40" height="40" rx="12" fill="#0F5C62" />
                <circle cx="20" cy="20" r="10" fill="#FEECD6" />
                <circle cx="16.5" cy="16.5" r="1.6" fill="#084B46" />
                <circle cx="23.5" cy="19" r="1.6" fill="#084B46" />
                <circle cx="19" cy="24" r="1.6" fill="#084B46" />
              </svg>
              PikolScore
            </Link>
            <span className="rounded-full bg-[#EAF0E5] px-3 py-1 text-xs font-bold text-[#0F5C62] border border-[#E2E5DC]">
              Player Portal
            </span>
          </div>

          <h1 className="text-2xl font-bold text-[#084B46] mb-1">
            {isSignUp ? 'Create Player Account' : 'Welcome to PikolScore'}
          </h1>
          <p className="text-xs text-[#748079] mb-6">
            {isSignUp
              ? 'Register to join active court lobbies and track your matches.'
              : 'Sign in to join court lobbies and view live scores.'}
          </p>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-full bg-white border border-[#E2E5DC] text-sm font-semibold text-[#084B46] hover:bg-[#FAF9F5] transition-colors cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="relative my-5 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#E2E5DC]" />
            </div>
            <span className="relative bg-[#FEFEFB] px-3 text-xs text-[#748079] uppercase tracking-wider">
              or with email
            </span>
          </div>

          <div className="mb-4 grid h-10 grid-cols-2 gap-1 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] p-1">
            <button
              type="button"
              onClick={() => setAuthMode('signin')}
              className={`rounded-full text-xs font-bold transition-all cursor-pointer ${
                !isSignUp ? 'bg-[#0F5C62] text-[#FEECD6]' : 'text-[#084B46]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
              className={`rounded-full text-xs font-bold transition-all cursor-pointer ${
                isSignUp ? 'bg-[#0F5C62] text-[#FEECD6]' : 'text-[#084B46]'
              }`}
            >
              Sign Up
            </button>
          </div>

          {authError && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#BA1A1A] font-semibold">
              {authError}
            </div>
          )}
          {authSuccess && (
            <div className="mb-4 rounded-xl bg-[#EAF0E5] border border-[#0F5C62]/30 p-3 text-xs text-[#0F5C62] font-semibold">
              {authSuccess}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="flex flex-col gap-3.5">
            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-[#084B46] mb-1">Full name</label>
                <input
                  type="text"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="e.g. Jordan Lee"
                  required
                  className="h-10 w-full rounded-xl bg-[#FAF9F5] border border-[#E2E5DC] px-3 text-xs text-[#084B46] focus:border-[#0F5C62] focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#084B46] mb-1">Email address</label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@email.com"
                required
                className="h-10 w-full rounded-xl bg-[#FAF9F5] border border-[#E2E5DC] px-3 text-xs text-[#084B46] focus:border-[#0F5C62] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#084B46] mb-1">Password</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                className="h-10 w-full rounded-xl bg-[#FAF9F5] border border-[#E2E5DC] px-3 text-xs text-[#084B46] focus:border-[#0F5C62] focus:outline-none"
              />
            </div>

            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-[#084B46] mb-1">Confirm password</label>
                <input
                  type="password"
                  value={authConfirmPassword}
                  onChange={(e) => setAuthConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  className="h-10 w-full rounded-xl bg-[#FAF9F5] border border-[#E2E5DC] px-3 text-xs text-[#084B46] focus:border-[#0F5C62] focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="mt-2 h-11 w-full rounded-full bg-[#0F5C62] text-sm font-bold text-[#FEECD6] hover:bg-[#085953] transition-colors cursor-pointer border-0 disabled:opacity-50"
            >
              {authLoading ? 'Loading...' : isSignUp ? 'Create Player Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#E2E5DC] text-center text-xs text-[#748079]">
            Are you a match official?{' '}
            <Link href={`/umpire${sessionQuery}`} className="font-bold text-[#0F5C62] hover:underline">
              Go to Umpire Console
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================================
  // MODE 1: PLAYER LIVE SCORING VIEW (Fixed Position: My Team : Opponent : Server #)
  // =========================================================================
  if (myStartedMatch) {
    const { session: liveSession, myTeamIndex, courtNumber } = myStartedMatch;
    const opponentTeamIndex = 1 - myTeamIndex;

    const tNames = liveSession.team_names || ['Team A', 'Team B'];
    const myTeamName = tNames[myTeamIndex] || (myTeamIndex === 0 ? 'Team A' : 'Team B');
    const oppTeamName = tNames[opponentTeamIndex] || (opponentTeamIndex === 0 ? 'Team A' : 'Team B');

    const myScore = myTeamIndex === 0 ? (liveSession.score_team0 ?? 0) : (liveSession.score_team1 ?? 0);
    const oppScore = opponentTeamIndex === 0 ? (liveSession.score_team0 ?? 0) : (liveSession.score_team1 ?? 0);

    const isMyTeamServing = liveSession.serving_team === myTeamIndex;
    const serverNum = liveSession.server_number ?? 2;

    // Padded 2-digit scores
    const myPadded = String(myScore).padStart(2, '0');
    const oppPadded = String(oppScore).padStart(2, '0');

    // Live countdown timer
    let timerText = '30:00';
    if (liveSession.timer_ends_at) {
      const remMs = Math.max(0, new Date(liveSession.timer_ends_at).getTime() - Date.now());
      timerText = formatMmSs(Math.ceil(remMs / 1000));
    }

    return (
      <div className={`${outfit.className} min-h-screen bg-[#FAF9F5] text-[#203F39] flex flex-col`}>
        {/* Top Minimal Header: Logo + Player Identity + Sign out only */}
        <header className="h-16 px-4 sm:px-8 bg-[#FEFEFB] border-b border-[#E2E5DC] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="32" height="32" viewBox="0 0 40 40">
              <rect width="40" height="40" rx="10" fill="#0F5C62" />
              <circle cx="20" cy="20" r="8" fill="#FEECD6" />
              <circle cx="17" cy="17" r="1.3" fill="#084B46" />
              <circle cx="23" cy="19" r="1.3" fill="#084B46" />
              <circle cx="19" cy="23" r="1.3" fill="#084B46" />
            </svg>
            <span className="text-xl font-black text-[#084B46] tracking-tight">PIKOLSCORE</span>
            <span className="ml-2 rounded-full bg-[#EAF0E5] px-2.5 py-0.5 text-xs font-bold text-[#0F5C62] border border-[#E2E5DC]">
              Court {courtNumber}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FAF9F5] border border-[#E2E5DC] text-xs font-semibold text-[#084B46]">
              <User size={13} />
              <span>{profile?.full_name || 'Player'}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="p-2 text-[#748079] hover:text-[#BA1A1A] rounded-full hover:bg-[#EAF0E5] transition-colors border-0 bg-transparent cursor-pointer"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Live Match Centerpiece */}
        <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 max-w-5xl mx-auto w-full">
          {/* Match Countdown Timer Card */}
          <div className="mb-6 flex items-center gap-2 px-5 py-2 rounded-full bg-[#EAF0E5] border border-[#E2E5DC] shadow-sm">
            <Timer size={18} className="text-[#0F5C62]" />
            <span className="font-mono text-xl sm:text-2xl font-black text-[#084B46] tracking-tight tabular-nums">
              {timerText}
            </span>
            <span className="text-xs font-semibold text-[#748079] uppercase ml-1">
              Match Countdown
            </span>
          </div>

          {/* 3-CARD FIXED ROW: [My Team Score] : [Opponent Score] : [Server Number] */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 sm:gap-6 w-full items-stretch">
            {/* 1. LEFT CARD: My Team (Fixed position, never swaps) */}
            <div
              className={`sm:col-span-5 rounded-[28px] p-5 sm:p-6 flex flex-col justify-between border-[2px] transition-all shadow-md ${
                isMyTeamServing
                  ? 'bg-[#EAF0E5] border-[#0F5C62] ring-2 ring-[#0F5C62]/20'
                  : 'bg-[#FEFEFB] border-[#E2E5DC]'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-lg sm:text-xl text-[#084B46] tracking-tight">
                    {myTeamName}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#0F5C62] bg-white/70 px-2 py-0.5 rounded-full border border-[#E2E5DC]">
                    Your Team
                  </span>
                </div>
                <span
                  className={`text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    isMyTeamServing
                      ? 'bg-[#0F5C62] text-[#FEECD6]'
                      : 'bg-[#E2E5DC] text-[#748079]'
                  }`}
                >
                  {isMyTeamServing ? 'Serving' : 'Receiving'}
                </span>
              </div>

              {/* Digits Pair */}
              <div className="flex gap-3 justify-center items-center py-2">
                <FlipDigit value={myPadded[0]} />
                <FlipDigit value={myPadded[1]} />
              </div>

              <div className="mt-4 text-center text-xs font-semibold text-[#748079]">
                {isMyTeamServing ? 'Your side has the serve' : 'Defending / Receiving'}
              </div>
            </div>

            {/* 2. CENTER CARD: Opponent Team (Fixed position, never swaps) */}
            <div
              className={`sm:col-span-5 rounded-[28px] p-5 sm:p-6 flex flex-col justify-between border-[2px] transition-all shadow-md ${
                !isMyTeamServing
                  ? 'bg-[#EAF0E5] border-[#0F5C62] ring-2 ring-[#0F5C62]/20'
                  : 'bg-[#FEFEFB] border-[#E2E5DC]'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-lg sm:text-xl text-[#084B46] tracking-tight">
                    {oppTeamName}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#748079] bg-white/70 px-2 py-0.5 rounded-full border border-[#E2E5DC]">
                    Opponent
                  </span>
                </div>
                <span
                  className={`text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    !isMyTeamServing
                      ? 'bg-[#0F5C62] text-[#FEECD6]'
                      : 'bg-[#E2E5DC] text-[#748079]'
                  }`}
                >
                  {!isMyTeamServing ? 'Serving' : 'Receiving'}
                </span>
              </div>

              {/* Digits Pair */}
              <div className="flex gap-3 justify-center items-center py-2">
                <FlipDigit value={oppPadded[0]} />
                <FlipDigit value={oppPadded[1]} />
              </div>

              <div className="mt-4 text-center text-xs font-semibold text-[#748079]">
                {!isMyTeamServing ? 'Opponent is serving' : 'Opponent is receiving'}
              </div>
            </div>

            {/* 3. RIGHT CARD: Server Number */}
            <div className="sm:col-span-2 rounded-[28px] p-5 sm:p-6 bg-[#085953] border-2 border-[#0F5C62] text-[#FEFEFB] flex flex-col justify-between items-center shadow-md">
              <span className="text-xs font-bold uppercase tracking-widest text-[#FEECD6]">
                Server
              </span>

              <div className="py-2">
                <FlipDigit value={serverNum} className="ps-fd-sm" />
              </div>

              <span className="text-[11px] font-medium text-[#FEECD6]/80 text-center">
                Server #{serverNum}
              </span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================================
  // MODE 2: LOBBY & COURT BROWSER + PROFILE EDITOR
  // =========================================================================
  return (
    <div className={`${outfit.className} min-h-screen bg-[#FAF9F5] p-4 sm:p-8 font-outfit text-[#203F39]`}>
      <div className="mx-auto w-full max-w-6xl">
        {/* Top Header */}
        <header className="flex items-center justify-between mb-8 pb-4 border-b border-[#E2E5DC]">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-[#084B46] no-underline"
          >
            <svg width="36" height="36" viewBox="0 0 40 40">
              <rect width="40" height="40" rx="10" fill="#0F5C62" />
              <circle cx="20" cy="20" r="8" fill="#FEECD6" />
              <circle cx="17" cy="17" r="1.3" fill="#084B46" />
              <circle cx="23" cy="19" r="1.3" fill="#084B46" />
              <circle cx="19" cy="23" r="1.3" fill="#084B46" />
            </svg>
            PikolScore
          </Link>

          {/* Subnav & Sign out */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 p-1 rounded-full bg-[#EAF0E5] border border-[#E2E5DC]">
              <button
                type="button"
                onClick={() => setActiveTab('courts')}
                className={`flex items-center gap-1.5 px-4 rounded-full text-xs font-bold transition-all cursor-pointer border-0 ${
                  activeTab === 'courts'
                    ? 'bg-[#0F5C62] text-[#FEECD6] shadow-sm'
                    : 'bg-transparent text-[#084B46]'
                }`}
              >
                <LayoutGrid size={14} />
                <span>Available Courts (4)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={`flex items-center gap-1.5 px-4 rounded-full text-xs font-bold transition-all cursor-pointer border-0 ${
                  activeTab === 'profile'
                    ? 'bg-[#0F5C62] text-[#FEECD6] shadow-sm'
                    : 'bg-transparent text-[#084B46]'
                }`}
              >
                <User size={14} />
                <span>My Profile</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-[#E2E5DC] text-xs font-semibold text-[#084B46] hover:bg-red-50 hover:text-[#BA1A1A] transition-colors cursor-pointer"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* Global Lobby Error */}
        {lobbyError && (
          <div
            role="alert"
            className="mb-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-xs font-semibold text-[#BA1A1A] flex items-center justify-between"
          >
            <span>{lobbyError}</span>
            <button
              type="button"
              onClick={() => setLobbyError('')}
              className="p-1 bg-transparent border-0 text-red-700 cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* TAB 1: 4 COURTS BROWSER & LOBBIES */}
        {activeTab === 'courts' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-[#084B46] tracking-tight m-0">
                  Select a Court & Claim Your Slot
                </h1>
                <p className="text-sm text-[#748079] m-0 mt-0.5">
                  Pick any open Team A or Team B slot below. You can switch slots or courts anytime before the umpire starts the match.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {[1, 2, 3, 4].map((courtNum) => {
                const s = courtsData[courtNum];
                const isMatchInProgress = Boolean(s?.player_names?.lobbyLocked);
                const umpireName = s?.player_names?.umpireName;

                const pSlots = s?.player_names?.slots || {};
                const team0Slots = pSlots.team0 || [null, null];
                const team1Slots = pSlots.team1 || [null, null];

                // Check if caller is registered on this court
                let mySlotInfo = null;
                if (session?.user?.id) {
                  team0Slots.forEach((sl, idx) => {
                    if (sl?.userId === session.user.id) mySlotInfo = { team: 0, slotIndex: idx };
                  });
                  team1Slots.forEach((sl, idx) => {
                    if (sl?.userId === session.user.id) mySlotInfo = { team: 1, slotIndex: idx };
                  });
                }

                const isTargetCourt = courtParam === courtNum;

                return (
                  <div
                    key={courtNum}
                    className={`rounded-3xl bg-[#FEFEFB] border-[2px] p-6 shadow-sm transition-all flex flex-col gap-4 ${
                      mySlotInfo
                        ? 'border-[#0F5C62] ring-2 ring-[#0F5C62]/20'
                        : isTargetCourt
                        ? 'border-[#0F5C62]/50 bg-[#EAF0E5]/30'
                        : 'border-[#E2E5DC]'
                    }`}
                  >
                    {/* Court Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2E5DC]">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-2xl font-black text-base ${
                            mySlotInfo
                              ? 'bg-[#0F5C62] text-[#FEECD6]'
                              : 'bg-[#EAF0E5] text-[#084B46]'
                          }`}
                        >
                          {courtNum}
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-[#084B46] tracking-tight m-0">
                            Court {courtNum}
                          </h2>
                          <span className="text-xs text-[#748079]">
                            {umpireName ? `Supervised by ${umpireName}` : 'Waiting for Umpire'}
                          </span>
                        </div>
                      </div>

                      <div>
                        {isMatchInProgress ? (
                          <span className="rounded-full bg-red-100 text-[#BA1A1A] px-3 py-1 text-xs font-bold">
                            Match in Progress
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#EAF0E5] text-[#0F5C62] px-3 py-1 text-xs font-bold border border-[#E2E5DC]">
                            Lobby Open
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Team A vs Team B Slots */}
                    {isMatchInProgress ? (
                      <div className="p-4 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC] text-center text-xs text-[#748079]">
                        This court is currently in a live match. Please join an open court lobby.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Team A Slots */}
                        <div className="flex flex-col gap-2 p-3 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC]">
                          <span className="text-xs font-bold text-[#084B46] uppercase tracking-wider">
                            Team A
                          </span>
                          {[0, 1].map((sIdx) => {
                            const slot = team0Slots[sIdx];
                            const isMine = slot?.userId === session?.user?.id;
                            const hasPlayer = Boolean(slot?.name?.trim());

                            return (
                              <div
                                key={`t0-${sIdx}`}
                                className={`flex items-center justify-between p-2 rounded-xl border text-xs min-h-[38px] ${
                                  isMine
                                    ? 'bg-[#EAF0E5] border-[#0F5C62]'
                                    : 'bg-white border-[#E2E5DC]'
                                }`}
                              >
                                {hasPlayer ? (
                                  <>
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span className="font-semibold text-[#084B46] truncate">
                                        {slot.name}
                                      </span>
                                      {isMine && (
                                        <span className="rounded-full bg-[#0F5C62] text-[10px] font-bold text-[#FEECD6] px-1.5 py-0.2">
                                          You
                                        </span>
                                      )}
                                    </div>
                                    {isMine && (
                                      <button
                                        type="button"
                                        onClick={() => handleLeaveSlot(courtNum)}
                                        disabled={isLobbySubmitting}
                                        className="text-[#BA1A1A] hover:underline font-bold text-[11px] bg-transparent border-0 cursor-pointer"
                                      >
                                        Leave
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleClaimSlot(courtNum, 0, sIdx)}
                                    disabled={isLobbySubmitting}
                                    className="w-full flex items-center justify-center gap-1 text-[#0F5C62] hover:bg-[#EAF0E5] py-1 rounded font-bold text-xs bg-transparent border-0 cursor-pointer"
                                  >
                                    <Plus size={13} />
                                    <span>Join Slot {sIdx + 1}</span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Team B Slots */}
                        <div className="flex flex-col gap-2 p-3 rounded-2xl bg-[#FAF9F5] border border-[#E2E5DC]">
                          <span className="text-xs font-bold text-[#084B46] uppercase tracking-wider">
                            Team B
                          </span>
                          {[0, 1].map((sIdx) => {
                            const slot = team1Slots[sIdx];
                            const isMine = slot?.userId === session?.user?.id;
                            const hasPlayer = Boolean(slot?.name?.trim());

                            return (
                              <div
                                key={`t1-${sIdx}`}
                                className={`flex items-center justify-between p-2 rounded-xl border text-xs min-h-[38px] ${
                                  isMine
                                    ? 'bg-[#EAF0E5] border-[#0F5C62]'
                                    : 'bg-white border-[#E2E5DC]'
                                }`}
                              >
                                {hasPlayer ? (
                                  <>
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span className="font-semibold text-[#084B46] truncate">
                                        {slot.name}
                                      </span>
                                      {isMine && (
                                        <span className="rounded-full bg-[#0F5C62] text-[10px] font-bold text-[#FEECD6] px-1.5 py-0.2">
                                          You
                                        </span>
                                      )}
                                    </div>
                                    {isMine && (
                                      <button
                                        type="button"
                                        onClick={() => handleLeaveSlot(courtNum)}
                                        disabled={isLobbySubmitting}
                                        className="text-[#BA1A1A] hover:underline font-bold text-[11px] bg-transparent border-0 cursor-pointer"
                                      >
                                        Leave
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleClaimSlot(courtNum, 1, sIdx)}
                                    disabled={isLobbySubmitting}
                                    className="w-full flex items-center justify-center gap-1 text-[#0F5C62] hover:bg-[#EAF0E5] py-1 rounded font-bold text-xs bg-transparent border-0 cursor-pointer"
                                  >
                                    <Plus size={13} />
                                    <span>Join Slot {sIdx + 1}</span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: PROFILE EDITOR */}
        {activeTab === 'profile' && (
          <main className="rounded-[32px] bg-[#FEFEFB] p-6 sm:p-10 shadow-xl border border-[#E2E5DC] max-w-2xl mx-auto">
            <div className="flex items-start gap-4 mb-6">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#EAF0E5] border border-[#E2E5DC] overflow-hidden">
                {photos[0]?.url ? (
                  <img src={photos[0].url} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <User size={26} className="text-[#0F5C62]" />
                )}
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#084B46] m-0">Your Player Profile</h2>
                <p className="text-xs text-[#748079] m-0 mt-0.5">
                  Manage your display name, experience tier, and court avatar photos.
                </p>
              </div>
            </div>

            {saveError && (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#BA1A1A] font-semibold">
                {saveError}
              </div>
            )}
            {saveSuccess && (
              <div className="mb-4 rounded-xl bg-[#EAF0E5] border border-[#0F5C62]/30 p-3 text-xs text-[#0F5C62] font-semibold">
                {saveSuccess}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-bold text-[#084B46] mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="h-10 w-full rounded-xl bg-[#FAF9F5] border border-[#E2E5DC] px-3 text-xs text-[#084B46] focus:border-[#0F5C62] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#084B46] mb-2">
                  Skill Level <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {EXPERIENCE_LEVELS.map((lvl) => (
                    <button
                      key={lvl.key}
                      type="button"
                      onClick={() => setExperience(lvl.key)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        experience === lvl.key
                          ? 'bg-[#EAF0E5] border-[#0F5C62] text-[#084B46]'
                          : 'bg-[#FAF9F5] border-[#E2E5DC] text-[#748079]'
                      }`}
                    >
                      <div className="font-bold text-xs">{lvl.title}</div>
                      <div className="text-[11px] mt-0.5 leading-tight">{lvl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-[#084B46]">Court Photos (up to 3)</label>
                  <span className="text-[11px] text-[#748079]">
                    {formatBytes(totalBytes)} / 15 MB
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[0, 1, 2].map((idx) => {
                    const slot = photos[idx];
                    return (
                      <div
                        key={idx}
                        className="relative aspect-square rounded-2xl border border-dashed border-[#E2E5DC] bg-[#FAF9F5] overflow-hidden flex items-center justify-center"
                      >
                        <input
                          ref={fileInputRefs[idx]}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => handlePhotoSelect(idx, e)}
                          className="hidden"
                        />
                        {slot?.url ? (
                          <>
                            <img src={slot.url} alt={`Slot ${idx + 1}`} className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => handlePhotoRemove(idx)}
                              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white cursor-pointer border-0"
                            >
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fileInputRefs[idx]?.current?.click()}
                            className="flex flex-col items-center justify-center p-2 text-center text-[#748079] bg-transparent border-0 cursor-pointer"
                          >
                            <Camera size={18} />
                            <span className="text-[10px] mt-1 font-semibold">Photo {idx + 1}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="mt-2 h-11 w-full rounded-full bg-[#0F5C62] text-sm font-bold text-[#FEECD6] hover:bg-[#085953] transition-colors cursor-pointer border-0 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </form>
          </main>
        )}
      </div>
    </div>
  );
}
