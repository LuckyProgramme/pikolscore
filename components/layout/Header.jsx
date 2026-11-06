'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  User,
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  ArrowLeft,
  QrCode,
  Tv,
  ChevronDown,
  ClipboardList,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/config/supabase';
import {
  saveAccountForQuickSwitch,
  detachActiveSupabaseSession,
} from '@/lib/auth-session';

export function Header({
  onOpenLog,
  onOpenQrModal,
  onOpenProjectModal,
  onBack,
  backLabel = 'Matches',
  showMatchLog = true,
  logCount = 0,
  courtNumber = null,
  compactMenu = false,
  profile,
  userEmail,
  onLogout,
  onAbandonMatch,
  isGuest = false,
  syncStatus = 'synced',
  pendingCount = 0,
  isCloudSync = false,
  ...rest
}) {
  const router = useRouter();
  const isPlayerProfile = profile?.role === 'player';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef(null);
  const menuBtnRef = useRef(null);
  const menuListRef = useRef(null);

  // 1. Cross-Tab Logout Synchronization Listener
  useEffect(() => {
    const handleCrossTabLogout = (event) => {
      const isSupabaseToken =
        event.key?.startsWith('sb-') && event.key?.endsWith('-auth-token');

      if (isSupabaseToken && event.newValue === null) {
        window.location.replace(isPlayerProfile ? '/player' : '/umpire');
      }
    };

    window.addEventListener('storage', handleCrossTabLogout);
    return () => window.removeEventListener('storage', handleCrossTabLogout);
  }, [isPlayerProfile]);

  // Outside click & Escape handler for compact dropdown menu
  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (e) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    // Focus first enabled menu item on open
    const focusTimer = setTimeout(() => {
      const firstItem = menuListRef.current?.querySelector(
        '[role="menuitem"]:not([disabled])'
      );
      firstItem?.focus();
    }, 15);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleMenuKeyDown = (e) => {
    const items = Array.from(
      menuListRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      items[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const isDemoSpectator =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demo') === '1';
  const isGuestSpectator = Boolean(isGuest) && !profile;

  // 2. Soft Logout + In-Memory Purge & Hard Redirect
  const handleLogout = async () => {
    setMenuOpen(false);
    if (isDemoSpectator || isGuestSpectator) {
      if (typeof onLogout === 'function') {
        try {
          onLogout();
        } catch (e) {
          console.error('onLogout callback error:', e);
        }
      }
      window.location.replace('/role');
      return;
    }

    if (isPlayerProfile) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('Player sign out error:', err);
      } finally {
        window.location.replace('/player');
      }
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
    profile?.full_name || profile?.username || userEmail || (isGuestSpectator ? 'Guest' : 'Umpire');

  if (compactMenu) {
    const courtSuffix = courtNumber ? ` · Court ${courtNumber}` : '';

    return (
      <header
        className="ps-header ps-scoreboard-header"
        {...rest}
      >
        <div className="ps-logo">
          <svg className="ps-logo-mark" viewBox="0 0 44 44" aria-hidden="true">
            <rect width="44" height="44" rx="12" fill="#0F5C62" />
            <circle cx="22" cy="22" r="12.3" fill="#FEECD6" />
          </svg>
          <span>PIKOLSCORE</span>
        </div>

        <div className="ps-header-right">
          {/* Status indicator (dot only on Phone Portrait; rounded pale-sage pill on Tablet Portrait; plain dot + text on Desktop & Phone Landscape) */}
          <div
            className="ps-header-sync"
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
            {syncStatus === 'syncing' ? (
              <>
                <RefreshCw
                  size={13}
                  className="text-[#8A3B08] motion-safe:animate-spin shrink-0"
                  aria-hidden="true"
                />
                <span className="ps-sync-text text-[#8A3B08]">
                  Syncing ({pendingCount}){courtSuffix}
                </span>
              </>
            ) : syncStatus === 'offline' ? (
              <>
                <span
                  className="ps-sync-dot bg-[#5F6D66] shrink-0"
                  aria-hidden="true"
                />
                <span className="ps-sync-text text-[#384640]">
                  Offline ({pendingCount} pending){courtSuffix}
                </span>
              </>
            ) : syncStatus === 'error' ? (
              <>
                <span
                  className="ps-sync-dot bg-error shrink-0"
                  aria-hidden="true"
                />
                <span className="ps-sync-text text-error">Sync error{courtSuffix}</span>
              </>
            ) : (
              <>
                <span
                  className="ps-sync-dot bg-[#0F5C62] shrink-0"
                  aria-hidden="true"
                />
                <span className="ps-sync-text">
                  Synced{courtSuffix}
                </span>
              </>
            )}
          </div>

          {/* Account Menu Button + Dropdown */}
          <div ref={menuWrapRef} className="relative">
            <button
              ref={menuBtnRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((prev) => !prev)}
              className="ps-profile-badge ps-user-pill cursor-pointer hover:bg-teal/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              <span className="max-w-[130px] truncate">{displayIdentity}</span>
              <ChevronDown
                size={16}
                className={`shrink-0 transition-transform duration-150 ${
                  menuOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {menuOpen && (
              <div
                ref={menuListRef}
                role="menu"
                aria-label="Account and match actions"
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 top-full z-40 mt-2 w-[260px] rounded-2xl border border-line bg-ivory p-2 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!onOpenProjectModal || isGuest}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenProjectModal?.();
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-base font-semibold text-deep-green hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal cursor-pointer"
                >
                  <Tv size={18} className="shrink-0 text-teal" aria-hidden="true" />
                  <span>Project to Screen</span>
                </button>

                {showMatchLog && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isGuestSpectator}
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenLog?.();
                    }}
                    className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-base font-semibold text-deep-green hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal cursor-pointer"
                  >
                    <ClipboardList size={18} className="shrink-0 text-teal" aria-hidden="true" />
                    <span className="flex-1">Match log</span>
                    {logCount > 0 && (
                      <span className="inline-flex min-w-6 h-6 items-center justify-center rounded-full bg-pale-sage px-2 text-xs font-bold text-dark-teal">
                        {logCount}
                      </span>
                    )}
                  </button>
                )}

                <hr className="my-1.5 border-line" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-base font-semibold text-deep-green hover:bg-teal/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal cursor-pointer"
                >
                  <LogOut size={18} className="shrink-0 text-deep-green" aria-hidden="true" />
                  <span>Sign out</span>
                </button>

                <hr className="my-1.5 border-line" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={!onAbandonMatch || isGuest}
                  onClick={() => {
                    setMenuOpen(false);
                    onAbandonMatch?.();
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-base font-semibold text-error hover:bg-error/10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-error cursor-pointer"
                >
                  <AlertTriangle size={18} className="shrink-0 text-error" aria-hidden="true" />
                  <span>Abandon match</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="ps-header" {...rest}>
      <div className="flex items-center gap-3">
        {onBack && !isGuestSpectator && (
          <button
            type="button"
            onClick={onBack}
            className="ps-pill ps-pill-back flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-deep-green hover:bg-pale-sage transition-colors"
            aria-label={`Back to ${backLabel}`}
            title={`Back to ${backLabel}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
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

        {onOpenProjectModal && !isGuest && (
          <button
            type="button"
            className="ps-pill flex items-center gap-1.5"
            onClick={onOpenProjectModal}
            title="Project this court to a TV Screen"
            aria-label="Project to Screen"
          >
            <Tv size={14} aria-hidden="true" />
            <span>Project to Screen</span>
          </button>
        )}

        {onOpenQrModal && (
          <button
            type="button"
            className="ps-pill flex items-center gap-1.5"
            onClick={onOpenQrModal}
            title="Show Court QR Code"
            aria-label="Court QR Code"
          >
            <QrCode size={14} aria-hidden="true" />
            <span>Court QR</span>
          </button>
        )}

        {onAbandonMatch && !isGuest && (
          <button
            type="button"
            className="ps-pill text-[#BA1A1A] hover:bg-red-50 hover:border-red-300"
            onClick={onAbandonMatch}
            title="Abandon this match and free the court"
          >
            Abandon Match
          </button>
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
