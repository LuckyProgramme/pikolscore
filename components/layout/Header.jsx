'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, User, Cloud, CloudOff, RefreshCw, CheckCircle2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/config/supabase';
import {
  saveAccountForQuickSwitch,
  detachActiveSupabaseSession,
} from '@/lib/auth-session';

export function Header({
  onOpenLog,
  onBack,
  showMatchLog = true,
  profile,
  userEmail,
  onLogout,
  isGuest = false,
  syncStatus = 'synced',
  pendingCount = 0,
  isCloudSync = false,
  ...rest
}) {
  const router = useRouter();

  // 1. Cross-Tab Logout Synchronization Listener
  useEffect(() => {
    const handleCrossTabLogout = (event) => {
      const isSupabaseToken =
        event.key?.startsWith('sb-') && event.key?.endsWith('-auth-token');

      if (isSupabaseToken && event.newValue === null) {
        window.location.replace('/umpire');
      }
    };

    window.addEventListener('storage', handleCrossTabLogout);
    return () => window.removeEventListener('storage', handleCrossTabLogout);
  }, []);

  const isGuestSpectator =
    Boolean(isGuest) ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('demo') === '1');

  // 2. Soft Logout + In-Memory Purge & Hard Redirect
  const handleLogout = async () => {
    if (isGuestSpectator) {
      if (typeof onLogout === 'function') {
        try {
          onLogout();
        } catch (e) {
          console.error('onLogout callback error:', e);
        }
      }
      window.location.replace('/umpire');
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        // Stamp latest activity on public.profiles before detaching
        await supabase
          .from('profiles')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', session.user.id);

        // Save session credentials to pikol_saved_accounts (max 5 MRU)
        saveAccountForQuickSwitch(session, profile?.full_name);
      }
    } catch (err) {
      console.error('Soft logout preparation warning:', err);
    } finally {
      if (typeof onLogout === 'function') {
        try {
          onLogout();
        } catch (e) {
          console.error('onLogout callback error:', e);
        }
      }
      // Remove active sb-<project>-auth-token from localStorage
      detachActiveSupabaseSession();
      // Hard redirect to wipe in-memory Supabase client state
      window.location.replace('/umpire');
    }
  };

  const displayIdentity =
    profile?.full_name || profile?.username || userEmail || (isGuestSpectator ? 'Guest Spectator' : null);

  return (
    <header className="ps-header" {...rest}>
      <div className="flex items-center gap-3">
        {onBack && !isGuestSpectator && (
          <button
            type="button"
            onClick={onBack}
            className="ps-pill ps-pill-back flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-deep-green hover:bg-pale-sage transition-colors"
            aria-label="Back to matches"
            title="Back to Match Hub"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Matches</span>
          </button>
        )}
        <div className="ps-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="#0F5C62" />
            <circle cx="20" cy="20" r="10" fill="#FEECD6" />
            <circle cx="16.5" cy="16.5" r="1.6" fill="#203F39" />
            <circle cx="23.5" cy="19" r="1.6" fill="#203F39" />
            <circle cx="19" cy="24" r="1.6" fill="#203F39" />
          </svg>
          <span>PIKOLSCORE</span>
        </div>
      </div>

      <div className="ps-header-actions">
        {/* Sync Status Badge when Cloud Sync is active */}
        {isCloudSync && !isGuestSpectator && (
          <div
            className={`ps-sync-pill ps-sync-${syncStatus}`}
            title={
              syncStatus === 'synced'
                ? 'All actions synced to cloud'
                : syncStatus === 'syncing'
                ? `Syncing ${pendingCount} action${pendingCount === 1 ? '' : 's'}...`
                : syncStatus === 'offline'
                ? `Offline: ${pendingCount} pending action${pendingCount === 1 ? '' : 's'}`
                : 'Cloud sync error'
            }
          >
            {syncStatus === 'synced' && (
              <>
                <CheckCircle2 size={14} className="text-[#15803D]" aria-hidden="true" />
                <span>Synced</span>
              </>
            )}
            {syncStatus === 'syncing' && (
              <>
                <RefreshCw size={14} className="text-[#D97706] animate-spin" aria-hidden="true" />
                <span>Syncing ({pendingCount})</span>
              </>
            )}
            {syncStatus === 'offline' && (
              <>
                <CloudOff size={14} className="text-[#748079]" aria-hidden="true" />
                <span>Offline ({pendingCount} pending)</span>
              </>
            )}
            {syncStatus === 'error' && (
              <>
                <Cloud size={14} className="text-[#BA1A1A]" aria-hidden="true" />
                <span>Sync error</span>
              </>
            )}
          </div>
        )}

        {showMatchLog && (
          <button
            type="button"
            className={`ps-pill ${isGuestSpectator ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
            onClick={isGuestSpectator ? undefined : onOpenLog}
            disabled={isGuestSpectator}
            title={isGuestSpectator ? 'Match log disabled in spectator mode' : undefined}
            aria-disabled={isGuestSpectator}
          >
            Match log
          </button>
        )}

        {displayIdentity && (
          <div className="ps-profile-badge" title={displayIdentity}>
            <User size={14} aria-hidden="true" />
            <span>{displayIdentity}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          title="Sign out of Courtside"
          className="ps-pill ps-pill-logout"
          aria-label="Sign out"
        >
          <LogOut size={15} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </header>
  );
}

export default Header;
