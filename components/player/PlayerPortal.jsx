'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
} from 'lucide-react';
import { supabase } from '@/config/supabase';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';

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

export default function PlayerPortal() {
  const router = useRouter();
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sessionParam, setSessionParam] = useState(null);

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
  // Photo slots: array of 3 items: { url: string | null, file: File | null, size: number, isNew: boolean }
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
    setSessionParam(new URLSearchParams(search).get('session') || null);

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

    // Listen for auth state changes (e.g. after Google OAuth redirect)
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

  // 2. Load and sanitize profile data for player
  async function loadUserProfile(user) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.warn('Profile fetch warning:', error);
      }

      let currentProfile = data;

      // Handle brand-new Google OAuth user where role is NULL: claim role = 'player'
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

      // If arriving from a court QR scan (?session=<id>), jump directly to the live match
      const scannedSession =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('session')
          : null;
      if (scannedSession) {
        router.replace(`/pikolscore?session=${encodeURIComponent(scannedSession)}`);
        return;
      }

      // Populate form fields
      setFullName(
        currentProfile?.full_name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          ''
      );
      setExperience(currentProfile?.experience || '');

      // Parse photo_urls
      const rawUrls = Array.isArray(currentProfile?.photo_urls)
        ? currentProfile.photo_urls
        : [null, null, null];

      const initialSlots = [
        { url: rawUrls[0] || currentProfile?.avatar_url || null, file: null, size: 0, isNew: false },
        { url: rawUrls[1] || null, file: null, size: 0, isNew: false },
        { url: rawUrls[2] || null, file: null, size: 0, isNew: false },
      ];

      // Fetch remote sizes in background to populate byte counts accurately
      setPhotos(initialSlots);
      setLoadingInitial(false);

      // Async fetch sizes of existing remote URLs
      initialSlots.forEach(async (slot, idx) => {
        if (slot.url && !slot.url.startsWith('blob:')) {
          try {
            const headRes = await fetch(slot.url, { method: 'HEAD' });
            const len = headRes.headers.get('content-length');
            if (len) {
              const bytes = parseInt(len, 10);
              setPhotos((prev) => {
                const next = [...prev];
                if (next[idx]?.url === slot.url) {
                  next[idx] = { ...next[idx], size: bytes };
                }
                return next;
              });
            }
          } catch {
            // Non-critical if HEAD fails
          }
        }
      });
    } catch (err) {
      console.error('Error loading profile:', err);
      setLoadingInitial(false);
    }
  }

  // 3. Unauthenticated Actions (Sign In / Sign Up / Google OAuth / Forgot Password)
  const sessionSuffix = sessionParam
    ? `?session=${encodeURIComponent(sessionParam)}`
    : '';

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setAuthSuccess('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/player${sessionSuffix}`,
        },
      });
      if (error) {
        setAuthError(error.message);
      }
    } catch (err) {
      setAuthError('Failed to initiate Google sign-in. Please try again.');
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
        setAuthError("Passwords don't match. Please confirm your password.");
        return;
      }

      setAuthLoading(true);
      try {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: authPassword,
          options: {
            data: {
              full_name: trimmedName,
              role: 'player',
            },
            emailRedirectTo: `${window.location.origin}/player${sessionSuffix}`,
          },
        });

        if (error) {
          setAuthError(error.message);
          setAuthLoading(false);
          return;
        }

        if (data?.session) {
          // Immediately signed in
          setSession(data.session);
          await loadUserProfile(data.session.user);
        } else {
          setAuthSuccess(
            'Account created! Check your email inbox to confirm your address, then sign in.'
          );
          setAuthMode('signin');
          setAuthPassword('');
          setAuthConfirmPassword('');
        }
      } catch (err) {
        setAuthError(err.message || 'Registration failed. Please try again.');
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    // Sign in mode
    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: authPassword,
      });

      if (error) {
        setAuthError(error.message);
        setAuthLoading(false);
        return;
      }

      if (data?.session) {
        setSession(data.session);
        await loadUserProfile(data.session.user);
      }
    } catch (err) {
      setAuthError(err.message || 'Sign in failed. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = authEmail.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setAuthError('Enter your email address above to receive a password reset link.');
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/player`,
      });
      if (error) {
        setAuthError(error.message);
      } else {
        setAuthSuccess(`Password reset link sent to ${trimmedEmail}. Check your inbox.`);
      }
    } catch (err) {
      setAuthError('Failed to send reset link. Please try again.');
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setAuthEmail('');
      setAuthPassword('');
      setAuthConfirmPassword('');
      setAuthName('');
      setSaveSuccess('');
      setSaveError('');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  // 4. Photo Slot Handling (Combined 15 MB enforcement)
  const totalBytes = photos.reduce((acc, p) => acc + (p?.size || 0), 0);
  const isOverLimit = totalBytes > MAX_TOTAL_BYTES;

  const handlePhotoSelect = (slotIndex, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate mime type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setSaveError('Only JPG, PNG, and WebP images are allowed.');
      return;
    }

    setSaveError('');
    const previewUrl = URL.createObjectURL(file);

    setPhotos((prev) => {
      const next = [...prev];
      next[slotIndex] = {
        url: previewUrl,
        file,
        size: file.size,
        isNew: true,
      };
      return next;
    });

    // Reset input element value so the same file can be re-selected if desired
    if (fileInputRefs[slotIndex]?.current) {
      fileInputRefs[slotIndex].current.value = '';
    }
  };

  const handlePhotoRemove = (slotIndex) => {
    setSaveError('');
    setPhotos((prev) => {
      const next = [...prev];
      next[slotIndex] = {
        url: null,
        file: null,
        size: 0,
        isNew: false,
      };
      return next;
    });

    if (fileInputRefs[slotIndex]?.current) {
      fileInputRefs[slotIndex].current.value = '';
    }
  };

  // 5. Save Player Profile Handler
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
      setSaveError(
        `Total photos size (${formatBytes(totalBytes)}) exceeds the 15 MB limit. Please remove or replace larger images.`
      );
      return;
    }

    setIsSaving(true);

    try {
      const userId = session.user.id;
      const finalUrls = [null, null, null];

      // Process each photo slot
      for (let i = 0; i < 3; i++) {
        const slot = photos[i];

        if (slot?.isNew && slot?.file) {
          const ext = slot.file.name.split('.').pop() || 'jpg';
          const filePath = `${userId}/slot-${i + 1}-${Date.now()}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('player-photos')
            .upload(filePath, slot.file, {
              cacheControl: '3600',
              upsert: true,
            });

          if (uploadError) {
            throw new Error(`Failed to upload Photo ${i + 1}: ${uploadError.message}`);
          }

          const {
            data: { publicUrl },
          } = supabase.storage.from('player-photos').getPublicUrl(filePath);

          finalUrls[i] = publicUrl;
        } else if (slot?.url && !slot.isNew) {
          finalUrls[i] = slot.url;
        } else {
          finalUrls[i] = null;
        }
      }

      // Determine primary avatar URL (slot 0, or first populated photo)
      const primaryAvatar = finalUrls[0] || finalUrls[1] || finalUrls[2] || null;

      // Update profile in Supabase
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

      if (updateError) {
        throw updateError;
      }

      setProfile(updated);

      // Re-map photo state to saved remote URLs
      setPhotos([
        { url: finalUrls[0], file: null, size: photos[0]?.size || 0, isNew: false },
        { url: finalUrls[1], file: null, size: photos[1]?.size || 0, isNew: false },
        { url: finalUrls[2], file: null, size: photos[2]?.size || 0, isNew: false },
      ]);

      setSaveSuccess('Your player profile has been saved.');
    } catch (err) {
      console.error('Save profile error:', err);
      setSaveError(err.message || 'Failed to save profile. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  };

  // Loading state
  if (loadingInitial) {
    return <AuthLoadingSplash label="Loading player portal..." />;
  }

  // Check if signed-in user is an umpire (role isolation guard)
  if (session && profile?.role === 'referee') {
    return (
      <div
        className={`${outfit.className} min-h-screen grid place-items-center bg-deep-green p-4 sm:p-6 font-outfit text-dark-teal`}
      >
        <div className="w-full max-w-[520px] rounded-[28px] sm:rounded-[36px] bg-ivory p-6 sm:p-10 shadow-xl border border-line text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10 text-error mb-4">
            <ShieldAlert size={32} aria-hidden="true" />
          </div>
          <h1 className="text-[24px] font-bold text-dark-teal m-0 mb-2">
            Umpire account detected
          </h1>
          <p className="text-[15px] text-muted m-0 mb-6 leading-relaxed">
            <strong>{session.user.email}</strong> is registered as an official Umpire account.
            Umpire accounts cannot be converted into player profiles.
          </p>

          <div className="flex flex-col gap-3">
            <Link
              href="/matches"
              className="flex h-[48px] w-full items-center justify-center rounded-full bg-teal text-[15px] font-semibold text-cream transition-colors hover:bg-dark-teal no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              Open Umpire Match Hub
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-off-white border-[1.5px] border-line text-[14px] font-semibold text-dark-teal transition-colors hover:bg-pale-sage cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              <LogOut size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // View A: Unauthenticated Player Auth (Sign In / Sign Up / Google OAuth)
  if (!session) {
    const isSignUp = authMode === 'signup';

    return (
      <div
        className={`${outfit.className} min-h-screen grid place-items-center bg-deep-green p-4 sm:p-6 font-outfit text-dark-teal`}
      >
        <main className="w-full max-w-[460px] rounded-[28px] sm:rounded-[36px] bg-ivory p-6 sm:p-10 shadow-xl border border-line">
          {/* Top Brand & Badge */}
          <div className="flex items-center justify-between mb-6">
            <Link
              href={`/role${sessionSuffix}`}
              aria-label="PikolScore role selection"
              className="flex items-center gap-3 text-[24px] font-bold tracking-[-0.01em] text-dark-teal no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden="true">
                <rect width="40" height="40" rx="12" fill="#0F5C62" />
                <circle cx="20" cy="20" r="10" fill="#FEECD6" />
                <circle cx="16.5" cy="16.5" r="1.6" fill="#084B46" />
                <circle cx="23.5" cy="19" r="1.6" fill="#084B46" />
                <circle cx="19" cy="24" r="1.6" fill="#084B46" />
              </svg>
              PikolScore
            </Link>
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-pale-sage px-3 py-1 text-[12px] font-semibold text-dark-teal border border-teal/20">
                Player Portal
              </span>
              <Link
                href={`/role${sessionSuffix}`}
                className="text-[12px] font-semibold text-teal no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                Switch role
              </Link>
            </div>
          </div>

          <h1 className="text-[24px] font-bold text-dark-teal m-0 mb-1">
            {isSignUp ? 'Create player account' : 'Welcome back'}
          </h1>
          <p className="text-[14px] text-muted m-0 mb-6">
            {isSignUp
              ? 'Sign up to register your player details, skill tier, and court photos.'
              : 'Sign in to update your player details and court photos.'}
          </p>

          {/* Google OAuth Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="flex h-[48px] w-full items-center justify-center gap-3 rounded-full bg-off-white border-[1.5px] border-line text-[15px] font-semibold text-dark-teal transition-colors hover:bg-pale-sage hover:border-teal/30 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <span className="relative bg-ivory px-3 text-[13px] text-muted uppercase tracking-wider">
              or with email
            </span>
          </div>

          {/* Tab Switcher */}
          <div
            role="tablist"
            aria-label="Player authentication mode"
            className="mb-5 grid h-11 grid-cols-2 gap-1 rounded-full bg-off-white border-[1.5px] border-line p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!isSignUp}
              onClick={() => {
                setAuthMode('signin');
                setAuthError('');
                setAuthSuccess('');
              }}
              className={`rounded-full text-[14px] font-semibold transition-all cursor-pointer ${
                !isSignUp
                  ? 'bg-teal text-cream shadow-sm'
                  : 'bg-transparent text-dark-teal hover:text-teal'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignUp}
              onClick={() => {
                setAuthMode('signup');
                setAuthError('');
                setAuthSuccess('');
              }}
              className={`rounded-full text-[14px] font-semibold transition-all cursor-pointer ${
                isSignUp
                  ? 'bg-teal text-cream shadow-sm'
                  : 'bg-transparent text-dark-teal hover:text-teal'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Status notices */}
          {authError && (
            <div
              role="alert"
              className="mb-4 rounded-xl bg-error/10 border border-error/20 p-3 text-[14px] text-error"
            >
              {authError}
            </div>
          )}
          {authSuccess && (
            <div
              role="status"
              className="mb-4 rounded-xl bg-teal/10 border border-teal/20 p-3 text-[14px] text-dark-teal"
            >
              {authSuccess}
            </div>
          )}

          {/* Email/Password Form */}
          <form onSubmit={handleAuthSubmit} noValidate className="flex flex-col gap-4">
            {isSignUp && (
              <div>
                <label
                  htmlFor="player-fullname"
                  className="block text-[13px] font-semibold text-dark-teal mb-1.5"
                >
                  Full name
                </label>
                <input
                  id="player-fullname"
                  type="text"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="e.g. Jordan Lee"
                  required
                  className="h-11 w-full rounded-xl bg-off-white border-[1.5px] border-line px-3 text-[14px] text-dark-teal placeholder:text-muted/60 focus:border-teal focus:bg-white focus:outline-none"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="player-email"
                className="block text-[13px] font-semibold text-dark-teal mb-1.5"
              >
                Email address
              </label>
              <input
                id="player-email"
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@email.com"
                required
                className="h-11 w-full rounded-xl bg-off-white border-[1.5px] border-line px-3 text-[14px] text-dark-teal placeholder:text-muted/60 focus:border-teal focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="player-password"
                  className="text-[13px] font-semibold text-dark-teal"
                >
                  Password
                </label>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-[12px] font-semibold text-teal hover:underline cursor-pointer bg-transparent border-0 p-0"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="player-password"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder={isSignUp ? 'At least 6 characters' : 'Enter your password'}
                required
                className="h-11 w-full rounded-xl bg-off-white border-[1.5px] border-line px-3 text-[14px] text-dark-teal placeholder:text-muted/60 focus:border-teal focus:bg-white focus:outline-none"
              />
            </div>

            {isSignUp && (
              <div>
                <label
                  htmlFor="player-confirm-password"
                  className="block text-[13px] font-semibold text-dark-teal mb-1.5"
                >
                  Confirm password
                </label>
                <input
                  id="player-confirm-password"
                  type="password"
                  value={authConfirmPassword}
                  onChange={(e) => setAuthConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  className="h-11 w-full rounded-xl bg-off-white border-[1.5px] border-line px-3 text-[14px] text-dark-teal placeholder:text-muted/60 focus:border-teal focus:bg-white focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="mt-2 flex h-[48px] w-full items-center justify-center rounded-full bg-teal text-[15px] font-semibold text-cream transition-colors hover:bg-dark-teal cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              {authLoading
                ? isSignUp
                  ? 'Creating account...'
                  : 'Signing in...'
                : isSignUp
                ? 'Create player account'
                : 'Sign in to player portal'}
            </button>
          </form>

          {/* Cross link to Umpire console */}
          <div className="mt-8 pt-5 border-t border-line text-center text-[13px] text-muted">
            Are you a match official?{' '}
            <Link
              href={`/umpire${sessionSuffix}`}
              className="font-semibold text-teal no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              Go to umpire console
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // View B: Authenticated Player Portal (Profile & 3-Photo Bento Editor)
  const isFirstTime = profile?.experience === null;
  const avatarSlot = photos[0]?.url || profile?.avatar_url;

  return (
    <div
      className={`${outfit.className} min-h-screen bg-deep-green p-4 sm:p-8 font-outfit text-dark-teal`}
    >
      <div className="mx-auto w-full max-w-[640px]">
        {/* Navigation & Header */}
        <header className="flex items-center justify-between mb-6">
          <Link
            href="/"
            aria-label="PikolScore home"
            className="flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.01em] text-cream no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <svg width="32" height="32" viewBox="0 0 40 40" aria-hidden="true">
              <rect width="40" height="40" rx="10" fill="#0F5C62" />
              <circle cx="20" cy="20" r="8" fill="#FEECD6" />
              <circle cx="17" cy="17" r="1.3" fill="#084B46" />
              <circle cx="23" cy="19" r="1.3" fill="#084B46" />
              <circle cx="19" cy="23" r="1.3" fill="#084B46" />
            </svg>
            PikolScore
          </Link>

          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-2 rounded-full bg-cream/15 px-4 py-2 text-[13px] font-semibold text-cream hover:bg-cream/25 transition-colors cursor-pointer border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <LogOut size={15} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </header>

        {/* Main Card */}
        <main className="rounded-[28px] sm:rounded-[36px] bg-ivory p-6 sm:p-10 shadow-xl border border-line">
          {/* Top Profile Intro */}
          <div className="flex items-start gap-4 mb-8">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-pale-sage border-2 border-line overflow-hidden">
              {avatarSlot ? (
                <img
                  src={avatarSlot}
                  alt={fullName || 'Player avatar'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <User size={30} className="text-teal" aria-hidden="true" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="inline-block rounded-full bg-pale-sage px-2.5 py-0.5 text-[11px] font-semibold text-teal border border-teal/20 mb-1">
                {isFirstTime ? 'Onboarding' : 'Player Profile'}
              </div>
              <h1 className="text-[24px] font-bold text-dark-teal m-0 tracking-[-0.01em]">
                {isFirstTime ? 'Complete your player profile' : 'Your player profile'}
              </h1>
              <p className="text-[14px] text-muted m-0 mt-0.5">
                {isFirstTime
                  ? 'Confirm your display name, skill tier, and add up to three court photos.'
                  : 'Manage your court identity, experience ranking, and profile photos.'}
              </p>
            </div>
          </div>

          {/* Feedback messages */}
          {saveError && (
            <div
              role="alert"
              className="mb-6 rounded-xl bg-error/10 border border-error/20 p-3.5 text-[14px] text-error flex items-start gap-2.5"
            >
              <span className="font-semibold shrink-0">Error:</span>
              <span>{saveError}</span>
            </div>
          )}

          {saveSuccess && (
            <div
              role="status"
              className="mb-6 rounded-xl bg-teal/10 border border-teal/20 p-3.5 text-[14px] text-dark-teal flex items-center gap-2"
            >
              <Check size={18} className="text-teal shrink-0" aria-hidden="true" />
              <span>{saveSuccess}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} noValidate className="flex flex-col gap-6">
            {/* Identity Fields: Name & Locked Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="profile-name"
                  className="block text-[13px] font-semibold text-dark-teal mb-1.5"
                >
                  Full name <span className="text-error">*</span>
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  required
                  className="h-11 w-full rounded-xl bg-off-white border-[1.5px] border-line px-3 text-[14px] text-dark-teal placeholder:text-muted/60 focus:border-teal focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="profile-email"
                    className="text-[13px] font-semibold text-dark-teal flex items-center gap-1.5"
                  >
                    <span>Email address</span>
                    <Lock size={12} className="text-muted" aria-hidden="true" />
                  </label>
                  <span className="text-[11px] text-muted">Linked to login</span>
                </div>
                <input
                  id="profile-email"
                  type="email"
                  value={session.user.email || ''}
                  disabled
                  readOnly
                  className="h-11 w-full rounded-xl bg-pale-sage/50 border border-line px-3 text-[14px] text-muted cursor-not-allowed"
                />
              </div>
            </div>

            {/* Experience Level Tier Selector */}
            <div>
              <label className="block text-[13px] font-semibold text-dark-teal mb-1">
                Experience level <span className="text-error">*</span>
              </label>
              <p className="text-[12px] text-muted m-0 mb-3">
                Used to seed match pairings and display your court ranking.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {EXPERIENCE_LEVELS.map((lvl) => {
                  const isSelected = experience === lvl.key;

                  return (
                    <button
                      key={lvl.key}
                      type="button"
                      onClick={() => setExperience(lvl.key)}
                      className={`flex flex-col text-left p-3.5 rounded-xl border-[1.5px] transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-pale-sage border-teal shadow-sm'
                          : 'bg-off-white border-line hover:border-teal/40 hover:bg-pale-sage/30'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-[14px] font-semibold text-dark-teal">
                          {lvl.title}
                        </span>
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                            isSelected
                              ? 'border-teal bg-teal text-cream'
                              : 'border-muted/40 bg-transparent'
                          }`}
                        >
                          {isSelected && <Check size={10} strokeWidth={3} />}
                        </div>
                      </div>
                      <p className="text-[12px] text-muted m-0 leading-tight">
                        {lvl.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Photo Bento Grid (3 slots, total <= 15 MB) */}
            <div className="pt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[13px] font-semibold text-dark-teal">
                  Court photos (up to 3)
                </label>
                <div
                  className={`text-[12px] font-medium ${
                    isOverLimit ? 'text-error font-semibold' : 'text-muted'
                  }`}
                >
                  {formatBytes(totalBytes)} / 15.0 MB
                </div>
              </div>
              <p className="text-[12px] text-muted m-0 mb-3">
                Optional. Photo 1 serves as your primary scoreboard avatar. JPG, PNG, or WebP.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[0, 1, 2].map((slotIdx) => {
                  const slot = photos[slotIdx];
                  const hasPhoto = Boolean(slot?.url);

                  return (
                    <div
                      key={slotIdx}
                      className={`relative flex flex-col rounded-2xl border-[1.5px] overflow-hidden ${
                        hasPhoto
                          ? 'bg-pale-sage border-teal/40'
                          : 'bg-off-white border-dashed border-line hover:border-teal/40'
                      }`}
                    >
                      {/* Hidden File Input */}
                      <input
                        ref={fileInputRefs[slotIdx]}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label={`Upload photo slot ${slotIdx + 1}`}
                        onChange={(e) => handlePhotoSelect(slotIdx, e)}
                        className="hidden"
                      />

                      {/* Photo Thumbnail or Empty State */}
                      <div className="relative aspect-square w-full bg-cream/30 flex items-center justify-center overflow-hidden">
                        {hasPhoto ? (
                          <>
                            <img
                              src={slot.url}
                              alt={`Player photo ${slotIdx + 1}`}
                              className="h-full w-full object-cover"
                            />
                            {/* Slot 1 Badge */}
                            {slotIdx === 0 && (
                              <div className="absolute top-2 left-2 rounded-md bg-dark-teal/80 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-cream">
                                Primary Avatar
                              </div>
                            )}
                            {/* Remove button */}
                            <button
                              type="button"
                              onClick={() => handlePhotoRemove(slotIdx)}
                              aria-label={`Remove photo ${slotIdx + 1}`}
                              className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-dark-teal/80 text-cream backdrop-blur-sm hover:bg-error transition-colors cursor-pointer border-0"
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fileInputRefs[slotIdx]?.current?.click()}
                            className="flex flex-col items-center justify-center w-full h-full p-4 text-center cursor-pointer bg-transparent border-0 hover:bg-pale-sage/40 transition-colors"
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pale-sage text-teal mb-2">
                              <Camera size={20} aria-hidden="true" />
                            </div>
                            <span className="text-[13px] font-semibold text-dark-teal">
                              {slotIdx === 0 ? 'Add Primary' : `Add Photo ${slotIdx + 1}`}
                            </span>
                            <span className="text-[11px] text-muted mt-0.5">
                              {slotIdx === 0 ? 'Scoreboard avatar' : 'Action or court'}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Slot footer action */}
                      {hasPhoto && (
                        <div className="flex items-center justify-between p-2.5 bg-ivory border-t border-line/60">
                          <span className="text-[11px] text-muted">
                            {slot.size > 0 ? formatBytes(slot.size) : `Photo ${slotIdx + 1}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => fileInputRefs[slotIdx]?.current?.click()}
                            className="text-[11px] font-semibold text-teal hover:underline cursor-pointer bg-transparent border-0 p-0"
                          >
                            Replace
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {isOverLimit && (
                <p className="mt-2 text-[12px] text-error font-semibold m-0" role="alert">
                  Combined photo size exceeds 15 MB. Please remove or replace photos before saving.
                </p>
              )}
            </div>

            {/* Submit CTA */}
            <div className="pt-4 border-t border-line flex flex-col sm:flex-row items-center gap-3">
              <button
                type="submit"
                disabled={isSaving || isOverLimit}
                className="flex h-[48px] w-full sm:flex-1 items-center justify-center gap-2 rounded-full bg-teal text-[15px] font-semibold text-cream transition-colors hover:bg-dark-teal cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                {isSaving ? (
                  <span>Saving profile...</span>
                ) : (
                  <span>{isFirstTime ? 'Complete registration' : 'Save changes'}</span>
                )}
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
