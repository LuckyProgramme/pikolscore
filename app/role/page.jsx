'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Outfit } from 'next/font/google';
import { Check, Shield, User } from 'lucide-react';
import { supabase } from '@/config/supabase';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import {
  clearPreferredRole,
  getValidPreferredRole,
  resolveAuthenticatedDestination,
  savePreferredRole,
} from '@/lib/auth-session';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

const ROLE_OPTIONS = [
  {
    key: 'umpire',
    title: 'Umpire',
    description:
      'Officiate live matches with voice scoring, court timers, and rally audit logs.',
    Icon: Shield,
  },
  {
    key: 'player',
    title: 'Player',
    description:
      'Manage your court profile, skill tier, and join active games via court QR scan.',
    Icon: User,
  },
];

export default function RoleChooserPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [cachedRole, setCachedRole] = useState(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [rememberChoice, setRememberChoice] = useState(true);
  const [sessionParam, setSessionParam] = useState(null);
  const optionRefs = useRef({});

  useEffect(() => {
    let isMounted = true;

    async function initRoleChooser() {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(search);
      const scannedSession = params.get('session') || null;
      if (isMounted) setSessionParam(scannedSession);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session?.user) {
          const dest = await resolveAuthenticatedDestination(
            supabase,
            session.user.id,
            scannedSession
          );
          if (isMounted) router.replace(dest);
          return;
        }
      } catch (err) {
        console.error('Error checking session on /role:', err);
      }

      if (!isMounted) return;
      const saved = getValidPreferredRole();
      setCachedRole(saved);
      setSelectedRole(saved || '');
      setRememberChoice(true);
      setCheckingAuth(false);
    }

    initRoleChooser();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleRadioKeyDown = (e, currentIndex) => {
    if (
      e.key === 'ArrowRight' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowUp'
    ) {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % ROLE_OPTIONS.length;
      const nextRole = ROLE_OPTIONS[nextIndex].key;
      setSelectedRole(nextRole);
      optionRefs.current[nextRole]?.focus();
    }
  };

  const handleContinue = (e) => {
    e.preventDefault();
    if (!selectedRole) return;

    if (rememberChoice) {
      savePreferredRole(selectedRole);
    } else {
      clearPreferredRole();
    }

    const suffix = sessionParam
      ? `?session=${encodeURIComponent(sessionParam)}`
      : '';
    router.push(selectedRole === 'umpire' ? `/umpire${suffix}` : `/player${suffix}`);
  };

  if (checkingAuth) {
    return <AuthLoadingSplash label="Preparing courtside portal..." />;
  }

  const ctaLabel =
    selectedRole === 'umpire'
      ? 'Continue as Umpire'
      : selectedRole === 'player'
      ? 'Continue as Player'
      : 'Select a role to continue';

  return (
    <div
      className={`${outfit.className} min-h-screen grid place-items-center bg-deep-green p-4 sm:p-6 font-outfit text-dark-teal`}
    >
      <main className="w-full max-w-[660px] rounded-[28px] sm:rounded-[36px] bg-ivory p-6 sm:p-10 border border-line">
        <div className="flex items-center gap-3 mb-6">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="#0F5C62" />
            <circle cx="20" cy="20" r="10" fill="#FEECD6" />
            <circle cx="16.5" cy="16.5" r="1.6" fill="#084B46" />
            <circle cx="23.5" cy="19" r="1.6" fill="#084B46" />
            <circle cx="19" cy="24" r="1.6" fill="#084B46" />
          </svg>
          <span className="text-[26px] font-bold tracking-[-0.01em] text-dark-teal">
            PikolScore
          </span>
        </div>

        <h1 className="text-[28px] sm:text-[32px] leading-[1.2] font-bold tracking-[-0.02em] text-dark-teal m-0 mb-2">
          Choose how you&apos;re stepping onto court
        </h1>
        <p className="text-[15px] text-deep-green m-0 mb-7 leading-relaxed">
          {sessionParam
            ? 'Select your role to sign in and join the active court session.'
            : 'Pick your portal to officiate live games or manage your player profile.'}
        </p>

        <form onSubmit={handleContinue}>
          <div
            role="radiogroup"
            aria-label="Choose your role"
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {ROLE_OPTIONS.map(({ key, title, description, Icon }, idx) => {
              const isSelected = selectedRole === key;
              const isRemembered = cachedRole === key;

              return (
                <button
                  key={key}
                  ref={(el) => {
                    optionRefs.current[key] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={
                    isSelected || (!selectedRole && idx === 0) ? 0 : -1
                  }
                  onClick={() => setSelectedRole(key)}
                  onKeyDown={(e) => handleRadioKeyDown(e, idx)}
                  className={`group flex flex-col justify-between text-left p-5 sm:p-6 rounded-2xl border-[1.5px] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${
                    isSelected
                      ? 'bg-pale-sage border-teal'
                      : 'bg-off-white border-line hover:bg-pale-sage/50 hover:border-teal/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          isSelected
                            ? 'bg-teal text-cream'
                            : 'bg-pale-sage text-dark-teal group-hover:bg-teal/15'
                        }`}
                      >
                        <Icon size={24} aria-hidden="true" />
                      </div>

                      <div className="flex items-center gap-2">
                        {isRemembered && (
                          <span className="rounded-full bg-cream px-2.5 py-0.5 text-[12px] font-semibold text-dark-teal border border-teal/20">
                            Remembered
                          </span>
                        )}
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                            isSelected
                              ? 'border-teal bg-teal text-cream'
                              : 'border-muted/50 bg-ivory'
                          }`}
                        >
                          {isSelected && <Check size={12} strokeWidth={3} />}
                        </span>
                      </div>
                    </div>

                    <h2 className="text-[19px] font-bold text-dark-teal m-0 mb-1.5">
                      {title}
                    </h2>
                    <p className="text-[14px] text-deep-green m-0 leading-relaxed">
                      {description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-off-white border-[1.5px] border-line px-4 py-3.5">
            <label
              htmlFor="remember-role-switch"
              className="flex flex-col cursor-pointer select-none"
            >
              <span className="text-[14px] font-semibold text-dark-teal">
                Remember my choice on this browser
              </span>
              <span className="text-[13px] text-muted">
                Opens your chosen portal automatically for 7 days
              </span>
            </label>

            <button
              id="remember-role-switch"
              type="button"
              role="switch"
              aria-checked={rememberChoice}
              onClick={() => setRememberChoice((prev) => !prev)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-0 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${
                rememberChoice ? 'bg-teal' : 'bg-line'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-ivory transition-transform ${
                  rememberChoice ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <button
            type="submit"
            disabled={!selectedRole}
            className="mt-6 flex h-[54px] w-full items-center justify-center rounded-full border-0 bg-teal text-[16px] font-semibold text-cream transition-colors hover:bg-forest-teal active:translate-y-[1px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            {ctaLabel}
          </button>
        </form>
      </main>
    </div>
  );
}
