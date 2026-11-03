'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, X } from 'lucide-react';
import { supabase } from '@/config/supabase';
import { AUTH_CONTENT } from '@/config/content/auth';
import {
  getValidSavedAccounts,
  removeSavedAccount,
  resolveAuthenticatedDestination,
  SEVEN_DAYS_MS,
} from '@/lib/auth-session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getInitials(name, email) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
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
    return 'An account with this email already exists. Switch to Sign In or reset your password.';
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

  // Soft logout & quick switch state
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingUserId, setSwitchingUserId] = useState(null);
  const [sessionParam, setSessionParam] = useState(null);
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
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const scannedSession = new URLSearchParams(search).get('session') || null;
    setSessionParam(scannedSession);
    setSavedAccounts(getValidSavedAccounts());

    async function checkExistingSession() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted || !session?.user) return;
        const dest = await resolveAuthenticatedDestination(
          supabase,
          session.user.id,
          scannedSession
        );
        if (isMounted) router.replace(dest);
      } catch (err) {
        console.error('Error checking existing umpire session:', err);
      }
    }

    checkExistingSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

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
    if (nextMode === 'signin') {
      setSavedAccounts(getValidSavedAccounts());
    }
  };

  // Quick Login Handler with Double-Tap Mutex & Server-Side Expiry Check
  const handleQuickLogin = async (account) => {
    if (isSwitching) return; // Mutex prevents double-tap token revocation
    setIsSwitching(true);
    setSwitchingUserId(account.userId);
    clearFeedback();

    const handleExpiredFallback = (acc) => {
      const updated = removeSavedAccount(acc.userId);
      setSavedAccounts(updated);
      setEmail(acc.email);
      setIsSwitching(false);
      setSwitchingUserId(null);
      setPasswordError(
        'Session expired after 7 days. Please enter your password to continue.'
      );
      setTimeout(() => passwordInputRef.current?.focus(), 50);
    };

    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: account.refreshToken,
      });

      if (error || !data?.session?.user) {
        handleExpiredFallback(account);
        return;
      }

      const userId = data.session.user.id;

      // Verify 7-day activity boundary and stamp fresh activity in 1 atomic round-trip
      const cutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { data: updatedProfile, error: profileErr } = await supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', userId)
        .gte('last_active_at', cutoffIso)
        .select('id, role')
        .maybeSingle();

      if (profileErr || !updatedProfile) {
        // Officially terminate the stale session via Supabase Auth API
        await supabase.auth.signOut();
        handleExpiredFallback(account);
        return;
      }

      if (updatedProfile.role === 'player') {
        await supabase.auth.signOut();
        handleExpiredFallback(account);
        setPasswordError(
          'This account is registered as a Player. Please sign in through the Player Portal.'
        );
        return;
      }

      removeSavedAccount(account.userId);
      const dest = await resolveAuthenticatedDestination(
        supabase,
        userId,
        sessionParam
      );
      router.replace(dest);
    } catch (err) {
      console.error('Quick login failed:', err);
      handleExpiredFallback(account);
    }
  };

  // Manual Account Removal ("x" Hard Logout)
  const handleRemoveSavedAccount = async (e, account) => {
    e.stopPropagation();
    if (isSwitching) return;

    // Optimistic removal from UI and localStorage
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

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    clearFeedback();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError('Enter your email address first, then select Forgot password? to receive a reset link.');
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setEmailError('That email address is incomplete. Enter a valid address like you@email.com.');
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/umpire`,
      });
      if (error) {
        setEmailError(
          formatAuthError(error, 'Verify the email address on your account and try again.')
        );
        return;
      }
      setStatusMessage(`Password reset link sent to ${trimmedEmail}. Check your inbox to set a new password.`);
    } catch (err) {
      setEmailError(
        formatAuthError(err, 'Check your internet connection and try again.')
      );
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearFeedback();

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    let hasError = false;

    if (isSignUp && !trimmedName) {
      setNameError('Name is required. Enter your official or player name.');
      hasError = true;
    }

    if (!trimmedEmail) {
      setEmailError('Email is required. Enter the email address for your account.');
      hasError = true;
    } else if (!EMAIL_RE.test(trimmedEmail)) {
      setEmailError('That email address is incomplete. Enter a valid address like you@email.com.');
      hasError = true;
    }

    if (!password) {
      setPasswordError(
        isSignUp
          ? 'Password is required. Enter at least 6 characters.'
          : 'Password is required. Enter your password or select Forgot password? to reset it.'
      );
      hasError = true;
    } else if (isSignUp && password.length < 6) {
      setPasswordError('Password is too short. Use at least 6 characters.');
      hasError = true;
    }

    if (isSignUp) {
      if (!confirmPassword) {
        setConfirmPasswordError('Confirm your password by re-entering it above.');
        hasError = true;
      } else if (password && confirmPassword !== password) {
        setConfirmPasswordError("Passwords don't match. Make sure both password fields are identical.");
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
              sessionParam
            );
          }
          router.push(dest);
          return;
        }

        setIsLoading(false);
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        setStatusMessage('Account created! Check your email if confirmation is required, then sign in.');
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
        // Enforce role isolation: player accounts cannot sign into umpire console
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.session.user.id)
          .maybeSingle();

        if (profile?.role === 'player') {
          await supabase.auth.signOut();
          setPasswordError(
            'This account is registered as a Player. Please sign in through the Player Portal.'
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
          sessionParam
        );
        router.push(dest);
        return;
      }

      router.push('/matches');
    } catch (err) {
      setPasswordError(
        formatAuthError(err, 'Check your internet connection and try again.')
      );
      setIsLoading(false);
    }
  };

  const sessionSuffix = sessionParam
    ? `?session=${encodeURIComponent(sessionParam)}`
    : '';

  return (
    <section className="relative flex flex-col items-center bg-pale-sage px-8 pt-10 pb-10">
      <div className="mb-6 ml-6 flex items-center justify-between self-start w-[calc(100%-1.5rem)]">
        <Link
          href={`/role${sessionSuffix}`}
          aria-label="PikolScore role selection"
          className="flex items-center gap-3 text-[26px] font-bold tracking-[-0.01em] text-dark-teal no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="#0F5C62" />
            <circle cx="20" cy="20" r="10" fill="#FEECD6" />
            <circle cx="16.5" cy="16.5" r="1.6" fill="#084B46" />
            <circle cx="23.5" cy="19" r="1.6" fill="#084B46" />
            <circle cx="19" cy="24" r="1.6" fill="#084B46" />
          </svg>
          {AUTH_CONTENT.brand}
        </Link>
        <div className="flex items-center gap-2.5">
          <span className="rounded-full bg-teal/10 px-3 py-1 text-[12px] font-semibold text-dark-teal border border-teal/20">
            Umpire Console
          </span>
          <Link
            href={`/role${sessionSuffix}`}
            className="text-[12px] font-semibold text-teal no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            Switch role
          </Link>
        </div>
      </div>

      <form
        action="#"
        noValidate
        onSubmit={handleSubmit}
        className="my-auto flex w-full max-w-[400px] flex-col py-4"
      >
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="mb-6 grid h-11 grid-cols-2 gap-1 rounded-full bg-off-white border-[1.5px] border-line p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            onClick={() => switchMode('signin')}
            disabled={isLoading || isSwitching}
            className={`flex items-center justify-center rounded-full border-0 text-[15px] font-semibold transition-colors cursor-pointer disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-teal ${
              !isSignUp ? 'bg-teal text-off-white' : 'bg-transparent text-deep-green hover:bg-pale-sage'
            }`}
          >
            {AUTH_CONTENT.tabs.signIn}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            onClick={() => switchMode('signup')}
            disabled={isLoading || isSwitching}
            className={`flex items-center justify-center rounded-full border-0 text-[15px] font-semibold transition-colors cursor-pointer disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-teal ${
              isSignUp ? 'bg-teal text-off-white' : 'bg-transparent text-deep-green hover:bg-pale-sage'
            }`}
          >
            {AUTH_CONTENT.tabs.signUp}
          </button>
        </div>

        <h1 className="m-0 text-center text-[40px] leading-[48px] font-bold tracking-[-0.02em] text-dark-teal">
          {copy.heading}
        </h1>
        <p className="mt-2 mb-6 text-center text-[16px] leading-[24px] text-deep-green">
          {copy.subtitle}
        </p>

        <div className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-2">
              <label htmlFor="full-name" className="text-[14px] font-semibold text-dark-teal">
                {fields.fullName.label} <span className="text-teal" aria-hidden="true">*</span>
              </label>
              <div className="flex h-[52px] items-center gap-3 rounded-full bg-off-white border-[1.5px] border-line px-5 focus-within:border-teal focus-within:ring-2 focus-within:ring-teal">
                <svg
                  className="shrink-0"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#084B46"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c1.8-3.6 5-5.5 8-5.5s6.2 1.9 8 5.5" />
                </svg>
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
                  className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-medium text-dark-teal placeholder:text-muted outline-none"
                />
              </div>
              {nameError && (
                <p id="name-error" role="alert" className="m-0 text-sm text-error">
                  {nameError}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-[14px] font-semibold text-dark-teal">
              {fields.email.label} <span className="text-teal" aria-hidden="true">*</span>
            </label>
            <div className="flex h-[52px] items-center gap-3 rounded-full bg-off-white border-[1.5px] border-line px-5 focus-within:border-teal focus-within:ring-2 focus-within:ring-teal">
              <svg
                className="shrink-0"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#084B46"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m4 7 8 6 8-6" />
              </svg>
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
                className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-medium text-dark-teal placeholder:text-muted outline-none"
              />
            </div>
            {emailError && (
              <p id="email-error" role="alert" className="m-0 text-sm text-error">
                {emailError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <label htmlFor="password" className="text-[14px] font-semibold text-dark-teal">
                {fields.password.label} <span className="text-teal" aria-hidden="true">*</span>
              </label>
              {!isSignUp && (
                <a
                  href="#forgot"
                  onClick={handleForgotPassword}
                  className="text-[14px] font-semibold text-teal no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
                >
                  {AUTH_CONTENT.signIn.forgotPassword}
                </a>
              )}
            </div>
            <div className="flex h-[52px] items-center gap-3 rounded-full bg-off-white border-[1.5px] border-line px-5 focus-within:border-teal focus-within:ring-2 focus-within:ring-teal">
              <svg
                className="shrink-0"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#084B46"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="9" rx="2.5" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
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
                className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-medium text-dark-teal placeholder:text-muted outline-none"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((prev) => !prev)}
                className="flex border-0 bg-transparent p-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                <svg
                  className="shrink-0"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#084B46"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            {passwordError && (
              <p id="password-error" role="alert" className="m-0 text-sm text-error">
                {passwordError}
              </p>
            )}
          </div>

          {isSignUp && (
            <div className="flex flex-col gap-2">
              <label htmlFor="confirm-password" className="text-[14px] font-semibold text-dark-teal">
                {fields.confirmPassword.label} <span className="text-teal" aria-hidden="true">*</span>
              </label>
              <div className="flex h-[52px] items-center gap-3 rounded-full bg-off-white border-[1.5px] border-line px-5 focus-within:border-teal focus-within:ring-2 focus-within:ring-teal">
                <svg
                  className="shrink-0"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#084B46"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="5" y="11" width="14" height="9" rx="2.5" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
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
                  className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-medium text-dark-teal placeholder:text-muted outline-none"
                />
              </div>
              {confirmPasswordError && (
                <p id="confirm-password-error" role="alert" className="m-0 text-sm text-error">
                  {confirmPasswordError}
                </p>
              )}
            </div>
          )}
        </div>

        {statusMessage && (
          <p role="status" className="mt-4 text-center text-[15px] text-deep-green">
            {statusMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading || isSwitching}
          className="mt-6 flex h-[56px] items-center justify-center gap-3 rounded-full border-0 bg-teal text-[17px] font-semibold text-cream shadow-[0_10px_24px_-10px_rgba(15,92,98,0.5)] transition-colors hover:bg-forest-teal active:translate-y-[2px] cursor-pointer disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {isLoading ? copy.submitting : copy.submit}
        </button>

        {/* Lower Panel: Account Chooser + Guest Action (Sign In mode) */}
        {!isSignUp && (
          <div className="mt-8 flex flex-col gap-4">
            {savedAccounts.length > 0 && (
              <>
                <div className="relative flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-line" />
                  </div>
                  <span className="relative bg-pale-sage px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
                    Or Quick Switch
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="m-0 text-[13px] font-semibold text-deep-green">
                    Saved accounts on this device (up to 5):
                  </p>
                  <div className="flex flex-col gap-2">
                    {savedAccounts.map((account) => {
                      const isThisSwitching = isSwitching && switchingUserId === account.userId;
                      return (
                        <div
                          key={account.userId}
                          role="button"
                          tabIndex={isSwitching ? -1 : 0}
                          onClick={() => !isSwitching && handleQuickLogin(account)}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !isSwitching) {
                              e.preventDefault();
                              handleQuickLogin(account);
                            }
                          }}
                          aria-disabled={isSwitching}
                          aria-label={`Switch to account ${account.fullName || account.email}`}
                          className={`group relative flex items-center justify-between gap-3 rounded-2xl bg-off-white border-[1.5px] border-line p-3 transition-colors text-left ${
                            isSwitching
                              ? 'opacity-60 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-pale-sage hover:border-teal/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal text-[14px] font-bold text-cream">
                              {getInitials(account.fullName, account.email)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="m-0 truncate text-[15px] font-semibold text-dark-teal">
                                {account.fullName}
                              </p>
                              <p className="m-0 truncate text-[13px] text-muted">
                                {account.email}
                              </p>
                              <p className="m-0 text-[12px] font-medium text-teal">
                                {isThisSwitching ? 'Switching...' : 'Tap to continue'}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isSwitching}
                            onClick={(e) => handleRemoveSavedAccount(e, account)}
                            aria-label={`Remove saved account for ${account.fullName || account.email}`}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-line/40 hover:text-error transition-colors cursor-pointer disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => router.push('/pikolscore?demo=1')}
              disabled={isSwitching || isLoading}
              className="flex h-[48px] w-full items-center justify-center gap-2 rounded-full bg-off-white border-[1.5px] border-line text-[15px] font-semibold text-dark-teal transition-colors hover:bg-pale-sage hover:border-teal/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              <Eye size={18} className="text-teal" aria-hidden="true" />
              <span>View Courtside as Guest</span>
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-[15px] text-deep-green">
          {copy.footerPrompt}
          <Link
            href="/umpire"
            onClick={(e) => {
              e.preventDefault();
              switchMode(isSignUp ? 'signin' : 'signup');
            }}
            className="font-semibold text-teal no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            {copy.footerLink}
          </Link>
        </p>

        <p className="mt-3 text-center text-[13px] text-muted">
          Are you a player?{' '}
          <Link
            href={`/player${sessionSuffix}`}
            className="font-semibold text-teal no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            Sign in to player portal
          </Link>
        </p>
      </form>
    </section>
  );
}

export default LoginForm;
