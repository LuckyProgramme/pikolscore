'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Outfit } from 'next/font/google';
import {
  Check,
  Shield,
  Tv,
  User,
  QrCode,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/config/supabase';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import {
  clearPreferredRole,
  getValidPreferredRole,
  resolveAuthenticatedDestination,
  savePreferredRole,
} from '@/lib/auth-session';
import {
  TV_ID_STORAGE_KEY,
  PAIRED_COURT_STORAGE_KEY,
  TV_RETURN_TO_ROLE_KEY,
  generateTvId,
  getShortTvCode,
  normalizeTvId,
} from '@/lib/tv-pairing';
import { getSynth } from '@/lib/audio';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
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

function getCourtNumber(row) {
  return Number(row?.court_number || row?.player_names?.courtNumber) || null;
}

export default function RoleChooserPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [cachedRole, setCachedRole] = useState(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [rememberChoice, setRememberChoice] = useState(true);
  const [sessionParam, setSessionParam] = useState(null);
  const [courtParam, setCourtParam] = useState(null);
  const [tvParam, setTvParam] = useState(null);

  // Built-in TV Pairing QR state on /role
  const [tvId, setTvId] = useState('');
  const [tvQrSvg, setTvQrSvg] = useState('');
  const optionRefs = useRef({});

  // Navigate TV to /screen?court=<courtNumber> when umpire scans the QR code
  const routeTvToCourt = useCallback(
    (courtNumber) => {
      const cNum = Number(courtNumber);
      if (!cNum || cNum < 1 || cNum > 4) return;
      getSynth()?.armed();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PAIRED_COURT_STORAGE_KEY, String(cNum));
      }
      router.replace(`/screen?court=${encodeURIComponent(cNum)}`);
    },
    [router]
  );

  useEffect(() => {
    let isMounted = true;

    async function initRoleChooser() {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(search);
      const scannedSession = params.get('session') || null;
      const scannedCourt = params.get('court') || null;
      const scannedTv = params.get('tv') || null;
      if (isMounted) {
        setSessionParam(scannedSession);
        setCourtParam(scannedCourt);
        setTvParam(scannedTv);
      }

      // Initialize or load persistent TV pairing device ID
      let isTvReturn = false;
      if (typeof window !== 'undefined') {
        isTvReturn =
          window.sessionStorage.getItem(TV_RETURN_TO_ROLE_KEY) === '1';
        if (isTvReturn) {
          window.sessionStorage.removeItem(TV_RETURN_TO_ROLE_KEY);
        }
        let storedTvId = normalizeTvId(window.localStorage.getItem(TV_ID_STORAGE_KEY));
        if (!storedTvId || storedTvId.length > 12) {
          storedTvId = generateTvId();
          window.localStorage.setItem(TV_ID_STORAGE_KEY, storedTvId);
        }
        if (isMounted) setTvId(storedTvId);
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        // If this tab just returned from TV Screen View after match end/abandon,
        // keep it on /role for next TV pairing even if an account is signed in on this browser.
        if (session?.user && (!isTvReturn || scannedSession || scannedCourt || scannedTv)) {
          const dest = await resolveAuthenticatedDestination(
            supabase,
            session.user.id,
            { sessionId: scannedSession, courtNumber: scannedCourt, tvId: scannedTv }
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

  // Generate QR Code SVG for the TV Pairing Panel on /role
  const tvPairingUrl = useMemo(() => {
    if (typeof window === 'undefined' || !tvId) return '';
    return `${window.location.origin}/?tv=${encodeURIComponent(tvId)}`;
  }, [tvId]);

  useEffect(() => {
    if (!tvPairingUrl) return;
    let isMounted = true;

    QRCode.toString(
      tvPairingUrl,
      {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#084B46',
          light: '#FEFEFB',
        },
      },
      (err, svg) => {
        if (!err && isMounted) {
          setTvQrSvg(svg);
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, [tvPairingUrl]);

  // Listen in real-time on /role so scanning the QR code with an umpire phone auto-detects the court and projects it!
  useEffect(() => {
    if (!tvId || checkingAuth) return;

    let isMounted = true;

    // 1. Check if this tvId was already paired to an active match_session
    async function checkExistingTvPairing() {
      try {
        const { data } = await supabase
          .from('match_sessions')
          .select('id, court_number, player_names, status')
          .eq('status', 'in_progress');

        if (!isMounted || !Array.isArray(data)) return;
        for (const row of data) {
          const tvIds = row?.player_names?.pairedTvIds;
          if (
            Array.isArray(tvIds) &&
            tvIds.some((id) => normalizeTvId(id) === normalizeTvId(tvId))
          ) {
            const cNum = getCourtNumber(row);
            if (cNum >= 1 && cNum <= 4) {
              routeTvToCourt(cNum);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('[/role] Error checking existing TV pairing:', err);
      }
    }

    checkExistingTvPairing();

    // 2. Subscribe to Supabase Realtime broadcast channel `tv_pairing:<tvId>`
    const pairChannel = supabase
      .channel(`tv_pairing:${tvId}`)
      .on('broadcast', { event: 'paired' }, (msg) => {
        const targetCourt = Number(msg?.payload?.courtNumber);
        if (targetCourt >= 1 && targetCourt <= 4) {
          routeTvToCourt(targetCourt);
        }
      })
      .subscribe();

    // 3. Subscribe to postgres_changes on match_sessions as reliable DB fallback
    const dbChannel = supabase
      .channel(`role_tv_db_${tvId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_sessions' },
        (payload) => {
          const newRow = payload?.new;
          if (!newRow || newRow.status !== 'in_progress') return;
          const tvIds = newRow?.player_names?.pairedTvIds;
          if (
            Array.isArray(tvIds) &&
            tvIds.some((id) => normalizeTvId(id) === normalizeTvId(tvId))
          ) {
            const cNum = getCourtNumber(newRow);
            if (cNum >= 1 && cNum <= 4) {
              routeTvToCourt(cNum);
            }
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(pairChannel);
      supabase.removeChannel(dbChannel);
    };
  }, [tvId, checkingAuth, routeTvToCourt]);

  const handleRefreshTvCode = () => {
    const freshId = generateTvId();
    setTvId(freshId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TV_ID_STORAGE_KEY, freshId);
    }
  };

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

    const p = new URLSearchParams();
    if (courtParam) p.set('court', courtParam);
    if (sessionParam) p.set('session', sessionParam);
    if (tvParam) p.set('tv', tvParam);
    const suffix = p.toString() ? `?${p.toString()}` : '';
    router.replace(selectedRole === 'umpire' ? `/umpire${suffix}` : `/player${suffix}`);
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

  const shortTvCode = getShortTvCode(tvId);

  return (
    <div
      className={`${outfit.className} min-h-screen grid place-items-center bg-deep-green p-4 sm:p-6 font-outfit text-dark-teal`}
    >
      <main className="w-full max-w-[1040px] rounded-[28px] sm:rounded-[36px] bg-ivory p-6 sm:p-10 border border-line shadow-2xl">
        {/* Brand Header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
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
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-pale-sage px-3 py-1 text-xs font-bold text-teal border border-teal/20">
            <Tv size={14} />
            <span>TV Auto-Projection Ready</span>
          </span>
        </div>

        {/* Split Layout: Left = Umpire & Player Role Chooser | Right = Courtside TV Auto-Project QR */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* LEFT COLUMN: UMPIRE & PLAYER ROLE SELECTION */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <div>
              <h1 className="text-[28px] sm:text-[32px] leading-[1.2] font-bold tracking-[-0.02em] text-dark-teal m-0 mb-2">
                Choose how you&apos;re stepping onto court
              </h1>
              <p className="text-[15px] text-deep-green m-0 mb-6 leading-relaxed">
                {sessionParam
                  ? 'Select your role to sign in and join the active court session.'
                  : 'Pick your portal to officiate live games or manage your player profile.'}
              </p>
            </div>

            <form onSubmit={handleContinue} className="flex flex-col flex-1 justify-between">
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

              <div>
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
              </div>
            </form>
          </div>

          {/* RIGHT COLUMN: COURTSIDE TV DISPLAY QR PANEL (Auto-Detects Umpire's Court) */}
          <aside
            aria-label="Courtside TV Projection QR"
            className="lg:col-span-5 rounded-3xl bg-[#084B46] text-[#FEFEFB] p-6 sm:p-7 border-2 border-[#0F5C62] flex flex-col justify-between items-center text-center shadow-lg"
          >
            <div className="w-full flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0F5C62] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#FEECD6] border border-[#FEECD6]/20">
                <Tv size={13} />
                <span>Courtside TV Screen</span>
              </span>
              <button
                type="button"
                onClick={handleRefreshTvCode}
                title="Generate a new TV pairing code"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#EAF0E5]/80 hover:text-[#FEECD6] bg-transparent border-0 cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="my-4 flex flex-col items-center">
              <div className="bg-white p-3.5 rounded-2xl border-2 border-[#FEECD6]/30 shadow-md">
                {tvQrSvg ? (
                  <div
                    className="w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: tvQrSvg }}
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center">
                    <Loader2 size={28} className="animate-spin text-[#0F5C62]" />
                  </div>
                )}
              </div>

              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#0F5C62] px-3.5 py-1.5 border border-[#FEECD6]/20">
                <QrCode size={14} className="text-[#FEECD6]" />
                <span className="text-[11px] uppercase font-bold tracking-wider text-[#EAF0E5]">
                  TV Code:
                </span>
                <span className="font-mono text-sm font-black tracking-widest text-[#FEECD6]">
                  {shortTvCode || '------'}
                </span>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-extrabold text-white m-0 mb-1">
                Scan with Umpire Phone to Project
              </h2>
              <p className="text-xs text-[#EAF0E5]/85 m-0 leading-relaxed">
                Umpires can tap <strong>&ldquo;Project to Screen&rdquo;</strong> on their court or scan this QR code to automatically project their court&apos;s lobby and live scoreboard here.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
