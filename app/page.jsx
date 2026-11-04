'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/config/supabase';
import AuthLoadingSplash from '@/components/auth/AuthLoadingSplash';
import {
  resolveAuthenticatedDestination,
  resolveSignedOutDestination,
} from '@/lib/auth-session';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    async function routeVisitor() {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(search);

      // Preserve guest demo mode access
      if (params.get('demo') === '1') {
        router.replace(`/pikolscore${search}`);
        return;
      }

      const sessionParam = params.get('session') || null;
      const courtParam = params.get('court') || null;
      const tvParam = params.get('tv') || null;
      const target = { sessionId: sessionParam, courtNumber: courtParam, tvId: tvParam };

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session?.user) {
          const dest = await resolveAuthenticatedDestination(
            supabase,
            session.user.id,
            target
          );
          if (isMounted) router.replace(dest);
          return;
        }

        router.replace(resolveSignedOutDestination(target));
      } catch (err) {
        console.error('Error resolving root route:', err);
        if (isMounted) {
          router.replace(resolveSignedOutDestination(target));
        }
      }
    }

    routeVisitor();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return <AuthLoadingSplash label="Connecting to courtside..." />;
}
