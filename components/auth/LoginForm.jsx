'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { supabase } from '@/config/supabase';
import { AUTH_CONTENT } from '@/config/content/auth';
import {
  getValidSavedAccounts,
  removeSavedAccount,
  resolveAuthenticatedDestination,
  SEVEN_DAYS_MS,
} from '@/lib/auth-session';
import { TV_RETURN_TO_ROLE_KEY } from '@/lib/tv-pairing';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const firstChar = local[0] || '';
  return `${firstChar}•••@${domain}`;
}

function getInitials(name, email) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function getExpiryWarningLabel(lastActiveAt) {
  const ts = new Date(lastActiveAt || 0).getTime();
  if (!ts) return null;
  const remainingMs = ts + SEVEN_DAYS_MS - Date.now();
  if (remainingMs <= 0 || remainingMs > TWO_DAYS_MS) return null;
  const days = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`;
}

function formatAuthError(error, fallbackAction = 'Check your details and try again.') {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
    return "Email or password didn't match an account. Check both fields and try again, or select Forgot password? to reset it.";
  }
  if (msg.includes('email not confirmed')) {
    return "Your email address isn't verified yet. Open the confirmation link in your inbox, then sign in again.";
  }
  if (msg.includes('user already registered') || msg.includes('already exists')) {
    return 'An account with this email already exists. Sign in or reset your password.';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Too many attempts in a short time. Wait a minute and try again.';
  }
  if (error?.message) {
    return `${error.message}. ${fallbackAction}`;
  }
  return `Authentication couldn't be completed. ${fallbackAction}`;
}

export function LoginForm({ initialMode = 'signin' }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Saved accounts on this device (most recent first, expandable up to 5)
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [showAllSaved, setShowAllSaved] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingUserId, setSwitchingUserId] = useState(null);

  const [sessionParam, setSessionParam] = useState(null);
  const [courtParam, setCourtParam] = useState(null);
  const [tvParam, setTvParam] = useState(null);
  const passwordInputRef = useRef(null);

  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const isSignUp = mode === 'signup';
  const copy = isSignUp ? AUTH_CONTENT.signUp : AUTH_CONTENT.signIn;
  const { fields } = AUTH_CONTENT;

  useEffect(() => {
    let isMounted = true;
    let isRouting = false;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);
    const scannedSession = params.get('session') || null;
    const scannedCourt = params.get('court') || null;
    const scannedTv = params.get('tv') || null;
    setSessionParam(scannedSession);
    setCourtParam(scannedCourt);
    setTvParam(scannedTv);
    setSavedAccounts(getValidSavedAccounts());

    const handleStorage = (e) => {
      if (!e.key || e.key === 'pikol_saved_accounts') {
        setSavedAccounts(getValidSavedAccounts());
      }
    };
    window.addEventListener('storage', handleStorage);

    let isTvReturn = false;
    if (typeof window !== 'undefined') {
      isTvReturn = window.sessionStorage.getItem(TV_RETURN_TO_ROLE_KEY) === '1';
      if (isTvReturn) {
        window.sessionStorage.removeItem(TV_RETURN_TO_ROLE_KEY);
      }
    }

    async function handleActiveSession(session) {
      if (!isMounted || !session?.user || isRouting) return;
      if (isTvReturn && !scannedSession && !scannedCourt && !scannedTv) return;
      isRouting = true;

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, role, full_name, avatar_url')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (profile?.role === 'player') {
          await supabase.auth.signOut();
          isRouting = false;
          setIsGoogleLoading(false);
          setIsLoading(false);
          setPasswordError(
            'This account is registered as a player. Sign in through the player portal.'
          );
          return;
        }

        const defaultName =
          profile?.full_name ||
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          session.user.email?.split('@')[0] ||
          'Umpire';
        const defaultAvatar =
          profile?.avatar_url ||
          session.user.user_metadata?.avatar_url ||
          session.user.user_metadata?.picture ||
          null;

        await supabase
          .from('profiles')
          .update({
            role: 'referee',
            full_name: defaultName,
            avatar_url: defaultAvatar,
            last_active_at: new Date().toISOString(),
          })
          .eq('id', session.user.id);

        removeSavedAccount(session.user.id);
        const dest = await resolveAuthenticatedDestination(
          supabase,
          session.user.id,
          { sessionId: scannedSession, courtNumber: scannedCourt, tvId: scannedTv }
        );
        if (isMounted) router.replace(dest);
      } catch (err) {
        isRouting = false;
        console.error('Error checking existing umpire session:', err);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) handleActiveSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        handleActiveSession(session);
      }
    });

    return () => {
      isMounted = false;
      window.removeEventListener('storage', handleStorage);
      subscription?.unsubscribe();
    };
  }, [router]);

  const p = new URLSearchParams();
  if (courtParam) p.set('court', courtParam);
  if (sessionParam) p.set('session', sessionParam);
  if (tvParam) p.set('tv', tvParam);
  const sessionSuffix = p.toString() ? `?${p.toString()}` : '';

  const clearFeedback = () => {
    setNameError('');
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setStatusMessage('');
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    clearFeedback();
    setMode(nextMode);
  };

  const handleQuickLogin = async (account) => {
    if (isSwitching || isLoading || isGoogleLoading) return;
    clearFeedback();
    setIsSwitching(true);
    setSwitchingUserId(account.userId);

    const handleExpiredFallback = async (acc, customMessage) => {
      const updated = removeSavedAccount(acc.userId);
      setSavedAccounts(updated);

      if (acc.provider === 'google' && !customMessage) {
        try {
          await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: `${window.location.origin}/umpire${sessionSuffix}`,
              queryParams: acc.email ? { login_hint: acc.email } : undefined,
            },
          });
          return;
        } catch (err) {
          console.error('Failed to redirect expired Google session to OAuth:', err);
        }
      }

      setIsSwitching(false);
      setSwitchingUserId(null);
      setMode('signin');
      setEmail(acc.email || '');
      setPasswordError(
        customMessage || 'Session expired after 7 days. Enter your password to continue.'
      );
      setTimeout(() => passwordInputRef.current?.focus(), 50);
    };

    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: account.refreshToken,
      });

      if (error || !data?.session?.user) {
        await handleExpiredFallback(account);
        return;
      }

      const userId = data.session.user.id;
      const cutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { data: updatedProfile, error: profileErr } = await supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', userId)
        .gte('last_active_at', cutoffIso)
        .select('id, role')
        .maybeSingle();

      if (profileErr || !updatedProfile) {
        await supabase.auth.signOut();
        await handleExpiredFallback(account);
        return;
      }

      if (updatedProfile.role === 'player') {
        await supabase.auth.signOut();
        await handleExpiredFallback(
          account,
          'This account is registered as a player. Sign in through the player portal.'
        );
        return;
      }

      const nextSaved = removeSavedAccount(account.userId);
      setSavedAccounts(nextSaved);
      const dest = await resolveAuthenticatedDestination(
        supabase,
        userId,
        { sessionId: sessionParam, courtNumber: courtParam, tvId: tvParam }
      );
      router.replace(dest);
    } catch (err) {
      console.error('Quick login failed:', err);
      await handleExpiredFallback(account);
    }
  };

  const handleConfirmRemoveSavedAccount = async (account) => {
    if (isSwitching) return;
    setConfirmRemoveId(null);
    const updated = removeSavedAccount(account.userId);
    setSavedAccounts(updated);

    if (account.sessionId) {
      try {
        await fetch('/api/auth/revoke-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: account.sessionId }),
        });
      } catch (err) {
        console.error('Failed to revoke session on server:', err);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoading || isGoogleLoading || isSwitching) return;
    clearFeedback();
    setIsGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/umpire${sessionSuffix}`,
        },
      });
      if (error) {
        setPasswordError(formatAuthError(error));
        setIsGoogleLoading(false);
      }
    } catch (err) {
      setPasswordError(formatAuthError(err, 'Failed to initiate Google sign-in.'));
      setIsGoogleLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    clearFeedback();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError('Enter your email address first, then select Forgot password?.');
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setEmailError('Enter a valid email address like you@email.com.');
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/umpire`,
      });
      if (error) {
        setEmailError(formatAuthError(error));
        return;
      }
      setStatusMessage(`Password reset link sent to ${trimmedEmail}.`);
    } catch (err) {
      setEmailError(formatAuthError(err));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearFeedback();

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    let hasError = false;

    if (isSignUp && !trimmedName) {
      setNameError('Enter your official name.');
      hasError = true;
    }

    if (!trimmedEmail) {
      setEmailError('Enter the email address for your account.');
      hasError = true;
    } else if (!EMAIL_RE.test(trimmedEmail)) {
      setEmailError('Enter a valid email address like you@email.com.');
      hasError = true;
    }

    if (!password) {
      setPasswordError(
        isSignUp
          ? 'Enter a password of at least 6 characters.'
          : 'Enter your password or select Forgot password? to reset it.'
      );
      hasError = true;
    } else if (isSignUp && password.length < 6) {
      setPasswordError('Use at least 6 characters for your password.');
      hasError = true;
    }

    if (isSignUp) {
      if (!confirmPassword) {
        setConfirmPasswordError('Re-enter your password to confirm.');
        hasError = true;
      } else if (password && confirmPassword !== password) {
        setConfirmPasswordError("Passwords don't match.");
        hasError = true;
      }
    }

    if (hasError) return;

    setIsLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              full_name: trimmedName,
              role: 'referee',
            },
            emailRedirectTo: `${window.location.origin}/umpire`,
          },
        });

        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('already') || msg.includes('email')) {
            setEmailError(formatAuthError(error));
          } else {
            setPasswordError(formatAuthError(error));
          }
          setIsLoading(false);
          return;
        }

        if (data?.session) {
          let dest = '/matches';
          if (data.session.user) {
            try {
              await supabase
                .from('profiles')
                .update({ last_active_at: new Date().toISOString() })
                .eq('id', data.session.user.id);
            } catch (stampErr) {
              console.warn('Failed to stamp last_active_at on signup:', stampErr);
            }
            removeSavedAccount(data.session.user.id);
            dest = await resolveAuthenticatedDestination(
              supabase,
              data.session.user.id,
              { sessionId: sessionParam, courtNumber: courtParam, tvId: tvParam }
            );
          }
          router.replace(dest);
          return;
        }

        setIsLoading(false);
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        setStatusMessage('Account created. Check your email if confirmation is required, then sign in.');
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setPasswordError(formatAuthError(error));
        setIsLoading(false);
        return;
      }

      if (data?.session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.session.user.id)
          .maybeSingle();

        if (profile?.role === 'player') {
          await supabase.auth.signOut();
          setPasswordError(
            'This account is registered as a player. Sign in through the player portal.'
          );
          setIsLoading(false);
          return;
        }

        try {
          await supabase
            .from('profiles')
            .update({ last_active_at: new Date().toISOString() })
            .eq('id', data.session.user.id);
        } catch (stampErr) {
          console.warn('Failed to stamp last_active_at on login:', stampErr);
        }
        removeSavedAccount(data.session.user.id);
        const dest = await resolveAuthenticatedDestination(
          supabase,
          data.session.user.id,
          { sessionId: sessionParam, courtNumber: courtParam, tvId: tvParam }
        );
        router.replace(dest);
        return;
      }

      router.replace('/matches');
    } catch (err) {
      setPasswordError(formatAuthError(err));
      setIsLoading(false);
    }
  };

  const visibleSavedAccounts = showAllSaved
    ? savedAccounts.slice(0, 5)
    : savedAccounts.slice(0, 1);
  const hiddenSavedCount = Math.max(0, Math.min(5, savedAccounts.length) - 1);

  return (
    <section className="bg-[#EAF0E5] px-6 sm:px-12 py-10 flex flex-col">
      {/* Logo only at top */}
      <div className="mb-8">
        <Link
          href={`/umpire${sessionSuffix}`}
          aria-label="PikolScore"
          className="inline-flex items-center gap-3 text-2xl font-bold tracking-tight text-[#084B46] no-underline rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
        >
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
            <rect width="40" height="40" rx="12" fill="#0F5C62" />
            <circle cx="20" cy="20" r="10" fill="#FEECD6" />
            <circle cx="16.5" cy="16.5" r="1.6" fill="#084B46" />
            <circle cx="23.5" cy="19" r="1.6" fill="#084B46" />
            <circle cx="19" cy="24" r="1.6" fill="#084B46" />
          </svg>
          <span>{AUTH_CONTENT.brand}</span>
        </Link>
      </div>

      {/* Form column */}
      <form
        action="#"
        noValidate
        onSubmit={handleSubmit}
        className="mx-auto my-auto w-full max-w-[400px] flex flex-col gap-5"
      >
        <h1 className="m-0 text-4xl leading-10 font-semibold tracking-tight text-[#084B46]">
          {copy.heading}
        </h1>

        {/* Saved-account row (hidden when none; most recent shown, "+N more" expands up to 5) */}
        {!isSignUp && savedAccounts.length > 0 && (
          <div className="flex flex-col gap-2">
            {visibleSavedAccounts.map((account) => {
              const isConfirming = confirmRemoveId === account.userId;
              const isThisSwitching = isSwitching && switchingUserId === account.userId;
              const expiryLabel = getExpiryWarningLabel(account.lastActiveAt);
              const displayName = account.fullName || account.email?.split('@')[0] || 'Umpire';

              if (isConfirming) {
                return (
                  <div
                    key={account.userId}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-[#FAF9F5] p-3 min-h-14"
                  >
                    <span className="text-sm font-medium text-[#203F39]">
                      Remove {displayName} from this device?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(null)}
                        className="h-9 px-3 rounded-full bg-[#EAF0E5] text-sm font-medium text-[#203F39] hover:bg-[#E2E5DC] cursor-pointer border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmRemoveSavedAccount(account)}
                        className="h-9 px-3 rounded-full bg-[#B3412F] text-sm font-medium text-white hover:opacity-90 cursor-pointer border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={account.userId}
                  className="flex items-center gap-3 rounded-2xl bg-[#FAF9F5] hover:bg-[#FEFEFB] p-3 min-h-14 transition-colors"
                >
                  <button
                    type="button"
                    disabled={isSwitching || isLoading || isGoogleLoading}
                    onClick={() => handleQuickLogin(account)}
                    className="flex flex-1 items-center gap-3 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer disabled:cursor-not-allowed rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#FEECD6] text-sm font-semibold text-[#084B46] overflow-hidden">
                      {account.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={account.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        getInitials(account.fullName, account.email)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-medium text-[#203F39]">
                          {displayName}
                        </span>
                        {expiryLabel && (
                          <span className="shrink-0 rounded-full bg-[#FEECD6] px-2 py-0.5 text-xs font-medium text-[#084B46]">
                            {expiryLabel}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-sm text-[#5F6B65]">
                        {isThisSwitching ? 'Signing in…' : maskEmail(account.email)}
                      </div>
                    </div>
                    {isThisSwitching ? (
                      <Loader2 size={18} className="shrink-0 animate-spin text-[#0F5C62]" />
                    ) : (
                      <ChevronRight size={18} className="shrink-0 text-[#5F6B65]" aria-hidden="true" />
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={isSwitching}
                    onClick={() => setConfirmRemoveId(account.userId)}
                    aria-label="Remove from this device"
                    className="size-11 shrink-0 grid place-items-center rounded-full bg-transparent text-[#5F6B65] hover:bg-[#EAF0E5] hover:text-[#203F39] border-0 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}

            {!showAllSaved && hiddenSavedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllSaved(true)}
                className="self-start text-sm font-medium text-[#0F5C62] bg-transparent border-0 px-1 py-0.5 cursor-pointer hover:underline underline-offset-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
              >
                +{hiddenSavedCount} more
              </button>
            )}
          </div>
        )}

        {/* Sign-up Name Field */}
        {isSignUp && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="full-name" className="text-sm font-medium text-[#203F39]">
              {fields.fullName.label}
            </label>
            <input
              id="full-name"
              name="fullName"
              type="text"
              autoComplete="name"
              placeholder={fields.fullName.placeholder}
              required
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                if (nameError) setNameError('');
              }}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'name-error' : undefined}
              className="h-12 w-full rounded-full bg-[#FAF9F5] border-0 px-5 text-base text-[#203F39] placeholder:text-[#5F6B65] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/40"
            />
            {nameError && (
              <p id="name-error" role="alert" className="m-0 text-sm text-[#B3412F]">
                {nameError}
              </p>
            )}
          </div>
        )}

        {/* Email Field */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-[#203F39]">
            {fields.email.label}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={fields.email.placeholder}
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError('');
              if (statusMessage) setStatusMessage('');
            }}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? 'email-error' : undefined}
            className="h-12 w-full rounded-full bg-[#FAF9F5] border-0 px-5 text-base text-[#203F39] placeholder:text-[#5F6B65] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/40"
          />
          {emailError && (
            <p id="email-error" role="alert" className="m-0 text-sm text-[#B3412F]">
              {emailError}
            </p>
          )}
        </div>

        {/* Password Field */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm font-medium text-[#203F39]">
              {fields.password.label}
            </label>
            {!isSignUp && (
              <a
                href="#forgot"
                onClick={handleForgotPassword}
                className="text-sm font-medium text-[#0F5C62] no-underline hover:underline underline-offset-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
              >
                {AUTH_CONTENT.signIn.forgotPassword}
              </a>
            )}
          </div>
          <div className="relative flex items-center">
            <input
              ref={passwordInputRef}
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder={
                isSignUp ? fields.password.signUpPlaceholder : fields.password.signInPlaceholder
              }
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? 'password-error' : undefined}
              className="h-12 w-full rounded-full bg-[#FAF9F5] border-0 pl-5 pr-12 text-base text-[#203F39] placeholder:text-[#5F6B65] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/40"
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-1 size-11 grid place-items-center rounded-full border-0 bg-transparent text-[#5F6B65] hover:text-[#203F39] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          {passwordError && (
            <p id="password-error" role="alert" className="m-0 text-sm text-[#B3412F]">
              {passwordError}
            </p>
          )}
        </div>

        {/* Sign-up Confirm Password Field */}
        {isSignUp && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium text-[#203F39]">
              {fields.confirmPassword.label}
            </label>
            <input
              id="confirm-password"
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={fields.confirmPassword.placeholder}
              required
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmPasswordError) setConfirmPasswordError('');
              }}
              aria-invalid={Boolean(confirmPasswordError)}
              aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
              className="h-12 w-full rounded-full bg-[#FAF9F5] border-0 px-5 text-base text-[#203F39] placeholder:text-[#5F6B65] focus:outline-none focus:ring-2 focus:ring-[#0F5C62]/40"
            />
            {confirmPasswordError && (
              <p id="confirm-password-error" role="alert" className="m-0 text-sm text-[#B3412F]">
                {confirmPasswordError}
              </p>
            )}
          </div>
        )}

        {statusMessage && (
          <p role="status" className="m-0 text-sm text-[#084B46]">
            {statusMessage}
          </p>
        )}

        {/* Primary Sign in Button */}
        <button
          type="submit"
          disabled={isLoading || isGoogleLoading || isSwitching}
          className="h-12 w-full rounded-full border-0 bg-[#0F5C62] font-medium text-base text-white hover:bg-[#084B46] transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
        >
          {isLoading && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          <span>{isLoading ? copy.submitting : copy.submit}</span>
        </button>

        {/* Hairline divider with "or" */}
        <div className="flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-[#E2E5DC]" />
          <span className="text-sm text-[#5F6B65]">or</span>
          <div className="h-px flex-1 bg-[#E2E5DC]" />
        </div>

        {/* Continue with Google */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading || isGoogleLoading || isSwitching}
          className="h-12 w-full rounded-full border-0 bg-[#FEFEFB] text-base font-medium text-[#203F39] hover:bg-white transition-colors flex items-center justify-center gap-3 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
        >
          {isGoogleLoading ? (
            <Loader2 size={18} className="animate-spin text-[#0F5C62]" aria-hidden="true" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
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
          )}
          <span>{isGoogleLoading ? 'Connecting to Google…' : 'Continue with Google'}</span>
        </button>


        {/* Footer */}
        <p className="m-0 text-center text-sm text-[#5F6B65]">
          {copy.footerPrompt}
          <Link
            href="/umpire"
            onClick={(e) => {
              e.preventDefault();
              switchMode(isSignUp ? 'signin' : 'signup');
            }}
            className="font-semibold text-[#0F5C62] no-underline underline-offset-4 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C62]/40"
          >
            {copy.footerLink}
          </Link>
        </p>
      </form>
    </section>
  );
}

export default LoginForm;
