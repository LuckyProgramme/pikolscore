'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Copy,
  Check,
  QrCode,
  X,
  Play,
  Shuffle,
  AlertCircle,
  Plus,
  Shield,
  Loader2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/config/supabase';

export function CourtQrLobbyModal({
  isOpen,
  onClose,
  session,
  currentUser,
  profile,
  isUmpire,
  canManageRoster,
  onJoinCourt,
  onSessionUpdated,
}) {
  const [qrSvg, setQrSvg] = useState('');
  const [copied, setCopied] = useState(false);
  const [firstServer, setFirstServer] = useState(0); // 0 or 1
  const [randomNotice, setRandomNotice] = useState('');
  const [walkupInputs, setWalkupInputs] = useState({});
  const [activeWalkupSlot, setActiveWalkupSlot] = useState(null); // '0-0', '0-1', '1-0', '1-1'
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
  const allowRosterEdit =
    canManageRoster !== undefined ? canManageRoster : Boolean(isUmpire);

  // Derive slots safely
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

  // Generate QR Code SVG on mount or URL change
  useEffect(() => {
    if (!joinUrl) return;
    let isMounted = true;

    QRCode.toString(
      joinUrl,
      {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#084B46',
          light: '#FAF9F5',
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

  // Copy URL to clipboard
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

  // Check how many slots are filled
  const slotCount = useMemo(() => {
    let filled = 0;
    let total = format === 'singles' ? 2 : 4;

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

  // Helper to call backend lobby API with current user JWT
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

  // Player action: claim open slot, switch to open slot, or leave
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

  // Umpire action: assign walk-up player name or clear slot
  const handleUmpireSetSlot = async (teamIdx, slotIdx, walkupName) => {
    if (isSubmitting || isLobbyLocked || !allowRosterEdit) return;
    const res = await callLobbyApi({
      action: 'umpire_set_slot',
      team: teamIdx,
      slotIndex: slotIdx,
      walkupName,
    });
    if (res?.success) {
      setActiveWalkupSlot(null);
      setWalkupInputs((prev) => ({
        ...prev,
        [`${teamIdx}-${slotIdx}`]: '',
      }));
    }
  };

  // Randomize first server
  const handleRandomizeServer = () => {
    const pick = Math.random() < 0.5 ? 0 : 1;
    setFirstServer(pick);
    const chosenName = teamNames[pick] || `Side ${pick + 1}`;
    setRandomNotice(`Randomly picked: ${chosenName} serves first!`);
    setTimeout(() => setRandomNotice(''), 3000);
  };

  // Umpire action: Start match
  const handleStartMatch = async () => {
    if (!slotCount.isFull || isSubmitting || !allowRosterEdit) return;
    const res = await callLobbyApi({
      action: 'start_match',
      servingTeam: firstServer,
      teamNames,
    });
    if (res?.success) {
      if (onClose) onClose();
    }
  };

  if (!isOpen) return null;

  // Determine if current player is already in a slot
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-deep-green/75 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lobby-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-ivory rounded-[28px] sm:rounded-[36px] border border-line shadow-2xl p-5 sm:p-8 my-auto animate-in fade-in zoom-in-95 duration-200 text-dark-teal">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 pb-4 mb-5 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pale-sage text-teal border border-teal/20">
              <QrCode size={24} aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {courtNumber && (
                  <span className="rounded-full bg-teal px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-cream">
                    Court {courtNumber}
                  </span>
                )}
                <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-teal border border-teal/20">
                  {format === 'singles' ? 'Singles (1 vs 1)' : 'Doubles (2 vs 2)'}
                </span>
                <span className="text-[12px] font-semibold text-muted">
                  {assignedUmpireId
                    ? `Supervised by ${playerNames.umpireName || 'Official Umpire'}`
                    : 'Awaiting Umpire'}
                </span>
              </div>
              <h1 id="lobby-modal-title" className="text-[22px] sm:text-[24px] font-bold text-dark-teal m-0 mt-0.5">
                {isUmpire
                  ? courtNumber
                    ? `Court ${courtNumber} QR & Roster Lobby`
                    : 'Court QR & Roster Lobby'
                  : 'Courtside Match Lobby'}
              </h1>
            </div>
          </div>

          {/* Close button */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-off-white border border-line text-muted hover:text-dark-teal hover:bg-pale-sage transition-colors cursor-pointer"
              aria-label="Close lobby modal"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Status Error Notice */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-error/10 border border-error/20 p-3 text-[13px] font-semibold text-error flex items-center gap-2"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* UMPIRE VIEW: QR Code Share + Live Roster Slot Manager */}
        {isUmpire ? (
          <div className="flex flex-col gap-6">
            {/* Top row: QR code + link copy */}
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-5 items-center p-4 rounded-2xl bg-off-white border border-line">
              <div className="flex items-center justify-center bg-white p-2.5 rounded-xl border border-line shadow-sm">
                {qrSvg ? (
                  <div
                    className="w-32 h-32 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div className="w-32 h-32 flex items-center justify-center text-muted">
                    <Loader2 size={24} className="animate-spin text-teal" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 min-w-0">
                <span className="text-[12px] font-bold uppercase tracking-wider text-teal">
                  Scan to Join {courtNumber ? `Court ${courtNumber}` : 'Court'}
                </span>
                <p className="text-[13px] text-muted m-0 leading-normal">
                  Players can scan this fixed court QR code with their phone camera to join their team slot.
                </p>

                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    readOnly
                    value={joinUrl}
                    className="h-9 flex-1 min-w-0 rounded-lg bg-white border border-line px-3 text-[12px] text-dark-teal font-mono outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-teal px-3 text-[12px] font-semibold text-cream hover:bg-forest-teal transition-colors cursor-pointer border-0"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Roster Slots Grid */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold uppercase tracking-wider text-dark-teal">
                  Court Roster Slots ({slotCount.filled}/{slotCount.total} Filled)
                </span>
                <span className="text-[12px] text-muted">
                  All {slotCount.total} slots required before starting
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Side 0 */}
                <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-pale-sage/60 border border-line">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[14px] font-bold text-dark-teal">
                      {teamNames[0]}
                    </span>
                    <span className="text-[11px] font-semibold text-teal">
                      {format === 'singles' ? 'Player 1' : 'Team A'}
                    </span>
                  </div>

                  {slots.team0.map((slot, idx) => {
                    const slotKey = `0-${idx}`;
                    const isInputOpen = activeWalkupSlot === slotKey;
                    const hasPlayer = Boolean(slot?.name?.trim());

                    return (
                      <div
                        key={slotKey}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-ivory border border-line min-h-[44px]"
                      >
                        {hasPlayer ? (
                          <>
                            <span className="text-[14px] font-semibold text-dark-teal truncate">
                              {slot.name}
                            </span>
                            {allowRosterEdit && (
                              <button
                                type="button"
                                onClick={() => handleUmpireSetSlot(0, idx, '')}
                                aria-label={`Vacate slot ${slot.name}`}
                                title="Clear player slot"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:text-error hover:bg-line/40 transition-colors border-0 bg-transparent cursor-pointer"
                              >
                                <X size={15} />
                              </button>
                            )}
                          </>
                        ) : isInputOpen && allowRosterEdit ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <input
                              type="text"
                              autoFocus
                              placeholder="Walk-up player name"
                              value={walkupInputs[slotKey] || ''}
                              onChange={(e) =>
                                setWalkupInputs((prev) => ({
                                  ...prev,
                                  [slotKey]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleUmpireSetSlot(0, idx, walkupInputs[slotKey] || '');
                                } else if (e.key === 'Escape') {
                                  setActiveWalkupSlot(null);
                                }
                              }}
                              className="h-8 flex-1 min-w-0 rounded-lg bg-off-white border border-line px-2 text-[13px] text-dark-teal outline-none focus:border-teal"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleUmpireSetSlot(0, idx, walkupInputs[slotKey] || '')
                              }
                              className="h-8 px-2.5 rounded-lg bg-teal text-[12px] font-bold text-cream border-0 cursor-pointer"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveWalkupSlot(null)}
                              className="h-8 px-2 rounded-lg bg-transparent text-[12px] text-muted border-0 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-[13px] text-muted italic">
                              Open Slot (Awaiting Scan)
                            </span>
                            {allowRosterEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveWalkupSlot(slotKey);
                                  setWalkupInputs((prev) => ({ ...prev, [slotKey]: '' }));
                                }}
                                className="flex items-center gap-1 text-[11px] font-bold text-teal hover:underline bg-transparent border-0 cursor-pointer"
                              >
                                <Plus size={13} />
                                <span>Add Walk-up</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Side 1 */}
                <div className="flex flex-col gap-2 p-3.5 rounded-2xl bg-pale-sage/60 border border-line">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[14px] font-bold text-dark-teal">
                      {teamNames[1]}
                    </span>
                    <span className="text-[11px] font-semibold text-teal">
                      {format === 'singles' ? 'Player 2' : 'Team B'}
                    </span>
                  </div>

                  {slots.team1.map((slot, idx) => {
                    const slotKey = `1-${idx}`;
                    const isInputOpen = activeWalkupSlot === slotKey;
                    const hasPlayer = Boolean(slot?.name?.trim());

                    return (
                      <div
                        key={slotKey}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-ivory border border-line min-h-[44px]"
                      >
                        {hasPlayer ? (
                          <>
                            <span className="text-[14px] font-semibold text-dark-teal truncate">
                              {slot.name}
                            </span>
                            {allowRosterEdit && (
                              <button
                                type="button"
                                onClick={() => handleUmpireSetSlot(1, idx, '')}
                                aria-label={`Vacate slot ${slot.name}`}
                                title="Clear player slot"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:text-error hover:bg-line/40 transition-colors border-0 bg-transparent cursor-pointer"
                              >
                                <X size={15} />
                              </button>
                            )}
                          </>
                        ) : isInputOpen && allowRosterEdit ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <input
                              type="text"
                              autoFocus
                              placeholder="Walk-up player name"
                              value={walkupInputs[slotKey] || ''}
                              onChange={(e) =>
                                setWalkupInputs((prev) => ({
                                  ...prev,
                                  [slotKey]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleUmpireSetSlot(1, idx, walkupInputs[slotKey] || '');
                                } else if (e.key === 'Escape') {
                                  setActiveWalkupSlot(null);
                                }
                              }}
                              className="h-8 flex-1 min-w-0 rounded-lg bg-off-white border border-line px-2 text-[13px] text-dark-teal outline-none focus:border-teal"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleUmpireSetSlot(1, idx, walkupInputs[slotKey] || '')
                              }
                              className="h-8 px-2.5 rounded-lg bg-teal text-[12px] font-bold text-cream border-0 cursor-pointer"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveWalkupSlot(null)}
                              className="h-8 px-2 rounded-lg bg-transparent text-[12px] text-muted border-0 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-[13px] text-muted italic">
                              Open Slot (Awaiting Scan)
                            </span>
                            {allowRosterEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveWalkupSlot(slotKey);
                                  setWalkupInputs((prev) => ({ ...prev, [slotKey]: '' }));
                                }}
                                className="flex items-center gap-1 text-[11px] font-bold text-teal hover:underline bg-transparent border-0 cursor-pointer"
                              >
                                <Plus size={13} />
                                <span>Add Walk-up</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {allowRosterEdit ? (
              <>
                {/* First Server Selector */}
                <div className="flex flex-col gap-2 pt-2 border-t border-line">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold uppercase tracking-wider text-dark-teal">
                      First Serving Team
                    </span>
                    <button
                      type="button"
                      onClick={handleRandomizeServer}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-teal hover:text-forest-teal bg-pale-sage px-2.5 py-1 rounded-full border border-line transition-colors cursor-pointer"
                    >
                      <Shuffle size={12} aria-hidden="true" />
                      <span>Randomize</span>
                    </button>
                  </div>

                  {randomNotice && (
                    <div className="text-[12px] font-semibold text-teal">
                      {randomNotice}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFirstServer(0)}
                      className={`h-10 flex items-center justify-center gap-2 rounded-xl text-[13px] font-bold transition-colors border-[1.5px] cursor-pointer ${
                        firstServer === 0
                          ? 'bg-teal border-teal text-cream'
                          : 'bg-off-white border-line text-dark-teal hover:bg-pale-sage'
                      }`}
                    >
                      {firstServer === 0 && <Check size={14} />}
                      <span className="truncate">{teamNames[0]}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFirstServer(1)}
                      className={`h-10 flex items-center justify-center gap-2 rounded-xl text-[13px] font-bold transition-colors border-[1.5px] cursor-pointer ${
                        firstServer === 1
                          ? 'bg-teal border-teal text-cream'
                          : 'bg-off-white border-line text-dark-teal hover:bg-pale-sage'
                      }`}
                    >
                      {firstServer === 1 && <Check size={14} />}
                      <span className="truncate">{teamNames[1]}</span>
                    </button>
                  </div>
                </div>

                {/* Start Match CTA */}
                <button
                  type="button"
                  disabled={!slotCount.isFull || isSubmitting}
                  onClick={handleStartMatch}
                  className="mt-2 h-13 w-full flex items-center justify-center gap-2.5 rounded-full bg-teal hover:bg-forest-teal text-cream text-[16px] font-bold shadow-[0_10px_24px_-10px_rgba(15,92,98,0.5)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Starting Match...</span>
                    </>
                  ) : slotCount.isFull ? (
                    <>
                      <Play size={18} fill="currentColor" />
                      <span>Start Match (30:00)</span>
                    </>
                  ) : (
                    <span>
                      Waiting for Players ({slotCount.filled}/{slotCount.total} Claimed)
                    </span>
                  )}
                </button>
              </>
            ) : (
              <div className="pt-2 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3">
                <span className="text-[13px] text-muted">
                  {assignedUmpireId
                    ? `Officiated by ${playerNames.umpireName || 'another umpire'}.`
                    : 'Join this court as its official umpire to manage slots and start the match.'}
                </span>
                {!assignedUmpireId && onJoinCourt && (
                  <button
                    type="button"
                    onClick={onJoinCourt}
                    disabled={isSubmitting}
                    className="h-10 px-5 rounded-full bg-teal hover:bg-forest-teal text-cream text-[13px] font-bold transition-colors cursor-pointer border-0 shrink-0"
                  >
                    Join Court {courtNumber || ''} as Umpire
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* PLAYER VIEW: Pre-Match Lobby Slot Picker */
          <div className="flex flex-col gap-6">
            <div className="p-4 rounded-2xl bg-pale-sage/60 border border-line text-center">
              <span className="text-[12px] font-bold uppercase tracking-wider text-teal">
                Choose Your Courtside & Team Slot
              </span>
              <p className="text-[14px] text-deep-green m-0 mt-1">
                Tap an open slot below to register your courtside. You will automatically enter the live match once the umpire starts the game.
              </p>
            </div>

            {/* Sides Grid for Player */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Side 0 */}
              <div className="flex flex-col gap-2.5 p-4 rounded-2xl bg-off-white border border-line">
                <div className="flex items-center justify-between border-b border-line pb-2 mb-1">
                  <span className="text-[16px] font-bold text-dark-teal">
                    {teamNames[0]}
                  </span>
                  <span className="text-[12px] font-semibold text-teal">
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
                          className={`flex items-center justify-between p-3 rounded-xl border-[1.5px] ${
                            isMine
                              ? 'bg-pale-sage border-teal'
                              : 'bg-ivory border-line'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[14px] font-semibold text-dark-teal truncate">
                              {slot.name}
                            </span>
                            {isMine && (
                              <span className="rounded-full bg-teal px-2 py-0.5 text-[10px] font-bold text-cream">
                                You
                              </span>
                            )}
                          </div>

                          {isMine && (
                            <button
                              type="button"
                              onClick={handlePlayerLeaveSlot}
                              disabled={isSubmitting}
                              className="text-[11px] font-bold text-error hover:underline bg-transparent border-0 cursor-pointer"
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
                          className="flex items-center justify-center gap-2 w-full p-3 rounded-xl border-[1.5px] border-dashed border-teal/40 bg-pale-sage/30 hover:bg-pale-sage text-teal font-semibold text-[13px] transition-colors cursor-pointer"
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
              <div className="flex flex-col gap-2.5 p-4 rounded-2xl bg-off-white border border-line">
                <div className="flex items-center justify-between border-b border-line pb-2 mb-1">
                  <span className="text-[16px] font-bold text-dark-teal">
                    {teamNames[1]}
                  </span>
                  <span className="text-[12px] font-semibold text-teal">
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
                          className={`flex items-center justify-between p-3 rounded-xl border-[1.5px] ${
                            isMine
                              ? 'bg-pale-sage border-teal'
                              : 'bg-ivory border-line'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[14px] font-semibold text-dark-teal truncate">
                              {slot.name}
                            </span>
                            {isMine && (
                              <span className="rounded-full bg-teal px-2 py-0.5 text-[10px] font-bold text-cream">
                                You
                              </span>
                            )}
                          </div>

                          {isMine && (
                            <button
                              type="button"
                              onClick={handlePlayerLeaveSlot}
                              disabled={isSubmitting}
                              className="text-[11px] font-bold text-error hover:underline bg-transparent border-0 cursor-pointer"
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
                          className="flex items-center justify-center gap-2 w-full p-3 rounded-xl border-[1.5px] border-dashed border-teal/40 bg-pale-sage/30 hover:bg-pale-sage text-teal font-semibold text-[13px] transition-colors cursor-pointer"
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

            {/* Bottom Status Callout */}
            <div className="flex items-center justify-center p-3.5 rounded-xl bg-pale-sage text-center text-[13px] font-semibold text-dark-teal">
              {myClaimedSlot ? (
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-teal animate-pulse" />
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
