'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Copy,
  Check,
  X,
  AlertCircle,
  Plus,
  Loader2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/config/supabase';

export function CourtQrLobbyModal({
  isOpen,
  onClose,
  session,
  currentUser,
  isUmpire,
  canManageRoster,
  onSessionUpdated,
}) {
  const [qrSvg, setQrSvg] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const format = session?.format || 'doubles';
  const playerNames = session?.player_names || {};
  const isLobbyLocked = Boolean(playerNames?.lobbyLocked);
  const courtNumber = Number(session?.court_number || playerNames?.courtNumber) || null;
  const assignedUmpireId =
    playerNames && 'umpireId' in playerNames
      ? playerNames.umpireId
      : session?.umpire_id || null;

  const slots = useMemo(() => {
    const s = playerNames.slots || {};
    return {
      team0: Array.isArray(s.team0)
        ? s.team0
        : format === 'doubles'
        ? [null, null]
        : [null],
      team1: Array.isArray(s.team1)
        ? s.team1
        : format === 'doubles'
        ? [null, null]
        : [null],
    };
  }, [playerNames.slots, format]);

  const teamNames = useMemo(() => {
    if (Array.isArray(session?.team_names) && session.team_names.length >= 2) {
      return session.team_names;
    }
    return format === 'doubles' ? ['Team A', 'Team B'] : ['Player 1', 'Player 2'];
  }, [session?.team_names, format]);

  const joinUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (courtNumber) {
      return `${window.location.origin}/?court=${encodeURIComponent(courtNumber)}`;
    }
    if (!session?.id) return '';
    return `${window.location.origin}/pikolscore?session=${encodeURIComponent(session.id)}`;
  }, [courtNumber, session?.id]);

  // Generate QR Code SVG (#021024 modules on crisp #FFFFFF background)
  useEffect(() => {
    if (!joinUrl) return;
    let isMounted = true;

    QRCode.toString(
      joinUrl,
      {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#021024',
          light: '#FFFFFF',
        },
      },
      (err, svg) => {
        if (!err && isMounted) {
          setQrSvg(svg);
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, [joinUrl]);

  const handleCopy = useCallback(async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  }, [joinUrl]);

  const slotCount = useMemo(() => {
    let filled = 0;
    const total = format === 'singles' ? 2 : 4;

    const p0 = slots.team0?.[0]?.name?.trim();
    const p1 = slots.team1?.[0]?.name?.trim();
    if (p0) filled += 1;
    if (p1) filled += 1;

    if (format === 'doubles') {
      const p2 = slots.team0?.[1]?.name?.trim();
      const p3 = slots.team1?.[1]?.name?.trim();
      if (p2) filled += 1;
      if (p3) filled += 1;
    }

    return { filled, total, isFull: filled === total };
  }, [slots, format]);

  const callLobbyApi = useCallback(
    async (payload) => {
      setErrorMessage('');
      setIsSubmitting(true);
      try {
        const {
          data: { session: authSession },
        } = await supabase.auth.getSession();
        const token = authSession?.access_token || '';

        const res = await fetch('/api/match/lobby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            sessionId: session?.id,
            courtNumber,
            ...payload,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update lobby');
        }

        if (data.session && onSessionUpdated) {
          onSessionUpdated(data.session);
        }
        return data;
      } catch (err) {
        setErrorMessage(err.message || 'Network error occurred');
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [session?.id, courtNumber, onSessionUpdated]
  );

  const handlePlayerClaimSlot = async (teamIdx, slotIdx) => {
    if (isSubmitting || isLobbyLocked) return;
    await callLobbyApi({
      action: 'claim_slot',
      team: teamIdx,
      slotIndex: slotIdx,
    });
  };

  const handlePlayerLeaveSlot = async () => {
    if (isSubmitting || isLobbyLocked) return;
    await callLobbyApi({
      action: 'claim_slot',
      team: null,
      slotIndex: null,
    });
  };

  if (!isOpen) return null;

  let myClaimedSlot = null;
  ['team0', 'team1'].forEach((tKey, tIdx) => {
    if (Array.isArray(slots[tKey])) {
      slots[tKey].forEach((slot, sIdx) => {
        if (slot?.userId && slot.userId === currentUser?.id) {
          myClaimedSlot = { team: tIdx, slotIndex: sIdx };
        }
      });
    }
  });

  // Preserve unused prop compatibility if parent passes it
  void canManageRoster;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-[#021024]/75 backdrop-blur-[12px] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lobby-modal-title"
    >
      <div
        className={`relative w-full ${
          isUmpire ? 'max-w-[460px] p-6' : 'max-w-2xl p-6'
        } bg-[#0B2239] rounded-[20px] border border-[#24425E] dv-top-accent shadow-2xl my-auto text-[#FFFFFF]`}
      >
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <span className="dv-overline block mb-2">
              {isUmpire ? 'PLAYER LOBBY INVITE' : 'COURTSIDE MATCH LOBBY'}
            </span>
            <h1
              id="lobby-modal-title"
              className="dv-display text-[30px] leading-[1.08] text-[#FFFFFF] m-0"
            >
              {isUmpire
                ? courtNumber
                  ? `COURT ${courtNumber} QR CODE`
                  : 'COURT QR CODE'
                : 'CHOOSE YOUR TEAM SLOT'}
            </h1>
            <p className="text-[15px] text-[#B0C4D8] m-0 mt-2">
              {isUmpire
                ? 'Players scan this QR to claim their team slot.'
                : assignedUmpireId
                ? `Supervised by ${playerNames.umpireName || 'Official Umpire'}`
                : 'Awaiting Umpire'}
            </p>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] bg-[#07192B] border border-[#24425E] text-[#FFFFFF] hover:border-[#00E5B8] transition-colors cursor-pointer"
              aria-label="Close QR modal"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Status Error Notice */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-[10px] bg-[#07192B] border border-[#F47067] p-3 text-[13px] font-semibold text-[#F47067] flex items-center gap-2"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* UMPIRE VIEW: Focused Large QR Card */}
        {isUmpire ? (
          <div className="flex flex-col items-center gap-5">
            <div className="w-full flex flex-col items-center justify-center p-6 rounded-[14px] bg-[#07192B] border border-[#24425E] gap-5">
              <div className="flex items-center justify-center bg-[#FFFFFF] p-3.5 rounded-[14px] border border-[#24425E]">
                {qrSvg ? (
                  <div
                    className="w-52 h-52 sm:w-56 sm:h-56 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div className="w-52 h-52 sm:w-56 sm:h-56 flex items-center justify-center">
                    <Loader2 size={28} className="animate-spin text-[#00E5B8]" />
                  </div>
                )}
              </div>

              <span className="inline-flex items-center gap-2 rounded-full bg-[#0B2239] border border-[#00E5B8] px-4 py-1.5 text-[12.5px] font-bold text-[#FFFFFF]">
                <span className="size-2 rounded-full bg-[#00E5B8]" />
                <span>
                  {slotCount.filled}/{slotCount.total} Players Joined
                </span>
              </span>
            </div>

            {/* Copyable Link Row (52px height + 78px Copy button) */}
            <div className="w-full flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={joinUrl}
                className="h-[52px] flex-1 min-w-0 rounded-[10px] bg-[#07192B] border border-[#24425E] px-4 text-[13.5px] text-[#FFFFFF] font-mono outline-none focus:border-[#00E5B8]"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="flex min-w-[78px] h-[52px] shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-[#00E5B8] px-3.5 text-[14px] font-bold text-[#031B28] hover:bg-[#05DFB4] transition-colors cursor-pointer border-0"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* PLAYER VIEW: Pre-Match Lobby Slot Picker */
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Side 0 */}
              <div className="flex flex-col gap-2.5 p-4 rounded-[14px] bg-[#07192B] border border-[#24425E]">
                <div className="flex items-center justify-between border-b border-[#11263C] pb-2 mb-1">
                  <span className="text-[15px] font-bold text-[#FFFFFF]">
                    {teamNames[0]}
                  </span>
                  <span className="text-[12px] font-bold text-[#00E5B8]">
                    {format === 'singles' ? 'Player 1' : 'Team A'}
                  </span>
                </div>

                {slots.team0.map((slot, idx) => {
                  const isMine = slot?.userId === currentUser?.id;
                  const hasPlayer = Boolean(slot?.name?.trim());

                  return (
                    <div key={`p-0-${idx}`}>
                      {hasPlayer ? (
                        <div
                          className={`flex items-center justify-between p-3 rounded-[10px] border ${
                            isMine
                              ? 'bg-[#0B2239] border-[#00E5B8]'
                              : 'bg-[#021024] border-[#24425E]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[14px] font-semibold text-[#FFFFFF] truncate">
                              {slot.name}
                            </span>
                            {isMine && (
                              <span className="rounded-full bg-[#00E5B8] px-2 py-0.5 text-[10px] font-bold text-[#031B28]">
                                You
                              </span>
                            )}
                          </div>

                          {isMine && (
                            <button
                              type="button"
                              onClick={handlePlayerLeaveSlot}
                              disabled={isSubmitting}
                              className="text-[12px] font-bold text-[#F47067] hover:underline bg-transparent border-0 cursor-pointer"
                            >
                              Leave
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handlePlayerClaimSlot(0, idx)}
                          className="flex items-center justify-center gap-2 w-full p-3 rounded-[10px] border border-dashed border-[#00E5B8]/60 bg-[#021024]/50 hover:bg-[#0B2239] text-[#00E5B8] font-semibold text-[13px] transition-colors cursor-pointer"
                        >
                          <Plus size={15} />
                          <span>Join Slot {idx + 1}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Side 1 */}
              <div className="flex flex-col gap-2.5 p-4 rounded-[14px] bg-[#07192B] border border-[#24425E]">
                <div className="flex items-center justify-between border-b border-[#11263C] pb-2 mb-1">
                  <span className="text-[15px] font-bold text-[#FFFFFF]">
                    {teamNames[1]}
                  </span>
                  <span className="text-[12px] font-bold text-[#00E5B8]">
                    {format === 'singles' ? 'Player 2' : 'Team B'}
                  </span>
                </div>

                {slots.team1.map((slot, idx) => {
                  const isMine = slot?.userId === currentUser?.id;
                  const hasPlayer = Boolean(slot?.name?.trim());

                  return (
                    <div key={`p-1-${idx}`}>
                      {hasPlayer ? (
                        <div
                          className={`flex items-center justify-between p-3 rounded-[10px] border ${
                            isMine
                              ? 'bg-[#0B2239] border-[#00E5B8]'
                              : 'bg-[#021024] border-[#24425E]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[14px] font-semibold text-[#FFFFFF] truncate">
                              {slot.name}
                            </span>
                            {isMine && (
                              <span className="rounded-full bg-[#00E5B8] px-2 py-0.5 text-[10px] font-bold text-[#031B28]">
                                You
                              </span>
                            )}
                          </div>

                          {isMine && (
                            <button
                              type="button"
                              onClick={handlePlayerLeaveSlot}
                              disabled={isSubmitting}
                              className="text-[12px] font-bold text-[#F47067] hover:underline bg-transparent border-0 cursor-pointer"
                            >
                              Leave
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handlePlayerClaimSlot(1, idx)}
                          className="flex items-center justify-center gap-2 w-full p-3 rounded-[10px] border border-dashed border-[#00E5B8]/60 bg-[#021024]/50 hover:bg-[#0B2239] text-[#00E5B8] font-semibold text-[13px] transition-colors cursor-pointer"
                        >
                          <Plus size={15} />
                          <span>Join Slot {idx + 1}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-center p-3.5 rounded-[10px] bg-[#07192B] border border-[#24425E] text-center text-[13px] font-semibold text-[#B0C4D8]">
              {myClaimedSlot ? (
                <div className="flex items-center gap-2 text-[#FFFFFF]">
                  <span className="h-2 w-2 rounded-full bg-[#00E5B8] animate-pulse" />
                  <span>You are registered in the match. Waiting for umpire to start...</span>
                </div>
              ) : (
                <span>Tap any open slot above to claim your spot on court.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CourtQrLobbyModal;
