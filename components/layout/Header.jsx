'use client';

import { useState, useEffect, useRef } from 'react';
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
import DinkVisionLogo from '@/components/ui/DinkVisionLogo';

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
      window.location.replace('/umpire');
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
        await supabase
          .from('profiles')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', session.user.id);

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
      detachActiveSupabaseSession();
      window.location.replace('/umpire');
    }
  };

  const displayIdentity =
    profile?.full_name || profile?.username || userEmail || (isGuestSpectator ? 'Guest' : 'Umpire');

  if (compactMenu) {
    const courtLabel = courtNumber ? `COURT ${courtNumber}` : null;

    return (
      <header className="ps-header ps-scoreboard-header" {...rest}>
        <div className="ps-logo">
          <DinkVisionLogo size="md" />
        </div>

        <div className="ps-header-right">
          {/* Status cluster: 6px dot + uppercase status | COURT N */}
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
                  size={12}
                  className="text-[#F4A261] motion-safe:animate-spin shrink-0"
                  aria-hidden="true"
                />
                <span className="ps-sync-text text-[#F4A261]">
                  SYNCING ({pendingCount})
                </span>
              </>
            ) : syncStatus === 'offline' ? (
              <>
                <span className="ps-sync-dot bg-[#6C87A3] shrink-0" aria-hidden="true" />
                <span className="ps-sync-text text-[#B0C4D8]">
                  OFFLINE ({pendingCount})
                </span>
              </>
            ) : syncStatus === 'error' ? (
              <>
                <span className="ps-sync-dot bg-[#F47067] shrink-0" aria-hidden="true" />
                <span className="ps-sync-text text-[#F47067]">SYNC ERROR</span>
              </>
            ) : (
              <>
                <span className="ps-sync-dot bg-[#00E5B8] shrink-0" aria-hidden="true" />
                <span className="ps-sync-text text-[#FFFFFF]">SYNCED</span>
              </>
            )}
            {courtLabel && (
              <>
                <span className="ps-sync-text h-3.5 w-px bg-[#24425E] mx-0.5" aria-hidden="true" />
                <span className="ps-sync-text text-[#FFFFFF]">{courtLabel}</span>
              </>
            )}
          </div>

          {/* Account Menu Button + DinkVision Signature Dropdown */}
          <div ref={menuWrapRef} className="relative">
            <button
              ref={menuBtnRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((prev) => !prev)}
              className={`ps-profile-badge ps-user-pill cursor-pointer transition-colors hover:border-[#00E5B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5B8] ${
                menuOpen ? 'border-[#00E5B8]' : ''
              }`}
            >
              <span className="max-w-[130px] truncate">{displayIdentity}</span>
              <ChevronDown
                size={15}
                className={`shrink-0 text-[#B0C4D8] transition-transform duration-150 ${
                  menuOpen ? 'rotate-180 text-[#00E5B8]' : ''
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
                className="absolute right-0 top-full z-40 mt-2 w-[260px] rounded-[14px] border border-[#24425E] bg-[#0B2239] dv-top-accent p-2 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!onOpenProjectModal || isGuest}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenProjectModal?.();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14.5px] font-semibold text-[#FFFFFF] hover:bg-[#07192B] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer bg-transparent border-0"
                >
                  <Tv size={17} className="shrink-0 text-[#00E5B8]" aria-hidden="true" />
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
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14.5px] font-semibold text-[#FFFFFF] hover:bg-[#07192B] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer bg-transparent border-0"
                  >
                    <ClipboardList size={17} className="shrink-0 text-[#00E5B8]" aria-hidden="true" />
                    <span className="flex-1">Match log</span>
                    {logCount > 0 && (
                      <span className="inline-flex min-w-6 h-5 items-center justify-center rounded-full bg-[#00E5B8] px-2 text-[11px] font-bold text-[#031B28]">
                        {logCount}
                      </span>
                    )}
                  </button>
                )}

                <hr className="my-1.5 border-[#11263C]" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14.5px] font-semibold text-[#FFFFFF] hover:bg-[#07192B] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#00E5B8] cursor-pointer bg-transparent border-0"
                >
                  <LogOut size={17} className="shrink-0 text-[#B0C4D8]" aria-hidden="true" />
                  <span>Sign out</span>
                </button>

                <hr className="my-1.5 border-[#11263C]" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={!onAbandonMatch || isGuest}
                  onClick={() => {
                    setMenuOpen(false);
                    onAbandonMatch?.();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14.5px] font-semibold text-[#F47067] hover:bg-[#F47067]/10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#F47067] cursor-pointer bg-transparent border-0"
                >
                  <AlertTriangle size={17} className="shrink-0 text-[#F47067]" aria-hidden="true" />
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
            className="inline-flex h-[40px] w-[40px] sm:w-auto sm:px-3.5 items-center justify-center gap-1.5 rounded-[12px] bg-[#07192B] border border-[#24425E] text-[13px] font-semibold text-[#FFFFFF] hover:border-[#00E5B8] transition-colors cursor-pointer"
            aria-label={`Back to ${backLabel}`}
            title={`Back to ${backLabel}`}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
          </button>
        )}
        <div className="ps-logo">
          <DinkVisionLogo size="md" />
        </div>
      </div>

      <div className="ps-header-actions">
        {/* Default status cluster when cloud sync badge isn't explicitly overriding */}
        {!isCloudSync && (
          <div className="hidden sm:flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#FFFFFF] mr-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00E5B8]" aria-hidden="true" />
            <span>COURT READY</span>
            <span className="h-3.5 w-px bg-[#24425E] mx-1" aria-hidden="true" />
          </div>
        )}

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
                <CheckCircle2 size={14} className="text-[#00E5B8]" aria-hidden="true" />
                <span>Synced</span>
              </>
            )}
            {syncStatus === 'syncing' && (
              <>
                <RefreshCw size={14} className="text-[#F4A261] animate-spin" aria-hidden="true" />
                <span>Syncing ({pendingCount})</span>
              </>
            )}
            {syncStatus === 'offline' && (
              <>
                <CloudOff size={14} className="text-[#6C87A3]" aria-hidden="true" />
                <span>Offline ({pendingCount})</span>
              </>
            )}
            {syncStatus === 'error' && (
              <>
                <Cloud size={14} className="text-[#F47067]" aria-hidden="true" />
                <span>Sync error</span>
              </>
            )}
          </div>
        )}

        {onOpenProjectModal && !isGuest && (
          <button
            type="button"
            className="ps-pill"
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
            className="ps-pill"
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
            className="ps-pill text-[#F47067] hover:border-[#F47067]"
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
          <div className="ps-profile-badge hidden md:inline-flex" title={displayIdentity}>
            <User size={14} className="text-[#00E5B8] shrink-0" aria-hidden="true" />
            <span>{displayIdentity}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          title="Sign out of DinkVision"
          className="ps-pill ps-pill-logout"
          aria-label="Sign out"
        >
          <LogOut size={14} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </header>
  );
}

export default Header;
