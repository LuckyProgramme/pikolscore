'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Outfit } from 'next/font/google';
import { Eye, Shield, User } from 'lucide-react';
import { supabase } from '@/config/supabase';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

export default function RootPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkAuthAndRedirect() {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(search);

      // Preserve guest demo mode access
      if (params.get('demo') === '1') {
        router.replace(`/pikolscore${search}`);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();

          if (!isMounted) return;

          if (profile?.role === 'player') {
            router.replace('/player');
          } else {
            router.replace('/matches');
          }
          return;
        }

        // Unauthenticated visitor: display role chooser
        setCheckingAuth(false);
      } catch (err) {
        if (!isMounted) return;
        console.error('Error resolving root session:', err);
        setCheckingAuth(false);
      }
    }

    checkAuthAndRedirect();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (checkingAuth) {
    return <AuthLoadingSplash label="Connecting to courtside..." />;
  }

  return (
    <div
      className={`${outfit.className} min-h-screen grid place-items-center bg-deep-green p-4 sm:p-6 font-outfit text-dark-teal`}
    >
      <main className="w-full max-w-[560px] rounded-[28px] sm:rounded-[36px] bg-ivory p-6 sm:p-10 shadow-xl border border-line">
        {/* Brand header */}
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

        <h1 className="text-[28px] font-bold tracking-[-0.01em] text-dark-teal m-0 mb-2">
          Courtside precision
        </h1>
        <p className="text-[15px] text-muted m-0 mb-8 leading-relaxed">
          Select your portal to manage your profile or officiate live matches.
        </p>

        {/* Role options */}
        <div className="flex flex-col gap-4">
          {/* Player card */}
          <Link
            href="/player"
            className="group flex items-start gap-4 p-5 rounded-2xl bg-pale-sage border-[1.5px] border-line hover:border-teal/50 hover:bg-[#E2EBE0] transition-all no-underline text-dark-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal text-cream">
              <User size={24} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[17px] font-semibold text-dark-teal m-0">
                  Player portal
                </h2>
                <span className="text-[13px] font-semibold text-teal group-hover:underline">
                  Continue as Player
                </span>
              </div>
              <p className="text-[14px] text-muted m-0 leading-normal">
                Sign in with Google or email to complete your player details, experience level, and court photos.
              </p>
            </div>
          </Link>

          {/* Umpire card */}
          <Link
            href="/umpire"
            className="group flex items-start gap-4 p-5 rounded-2xl bg-off-white border-[1.5px] border-line hover:border-teal/50 hover:bg-pale-sage transition-all no-underline text-dark-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-dark-teal text-cream">
              <Shield size={24} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[17px] font-semibold text-dark-teal m-0">
                  Umpire console
                </h2>
                <span className="text-[13px] font-semibold text-teal group-hover:underline">
                  Continue as Umpire
                </span>
              </div>
              <p className="text-[14px] text-muted m-0 leading-normal">
                Official court scoring with voice control, score audit logs, and 7-day quick account switching.
              </p>
            </div>
          </Link>
        </div>

        {/* Spectator guest link */}
        <div className="mt-8 pt-6 border-t border-line flex flex-col items-center">
          <Link
            href="/pikolscore?demo=1"
            className="flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-off-white border-[1.5px] border-line text-[14px] font-semibold text-dark-teal transition-colors hover:bg-pale-sage hover:border-teal/30 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <Eye size={17} className="text-teal" aria-hidden="true" />
            <span>View Courtside as Guest</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
