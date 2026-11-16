'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatMmSs } from '../../hooks/useMatchTimer';
import {
  read as readVoiceAudit,
  clear as clearVoiceAudit,
  toCsv as voiceAuditToCsv,
} from '../../lib/voiceParser';

export function MatchLog({
  open,
  entries = [],
  legacyEntries = [],
  format = 'doubles',
  teamNames = ['Team Omega', 'Team Alpha'],
  playerNames = null,
  onClose,
  voiceMicMode = 'open_mic',
  voiceMicModeSetting = 'auto',
  onSetMicModeSetting,
  voiceTtsEnabled = false,
  onSetTtsEnabled,
  ...rest
}) {
  const [voiceEntries, setVoiceEntries] = useState([]);

  const refreshVoiceAudit = useCallback(() => {
    setVoiceEntries(readVoiceAudit());
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    refreshVoiceAudit();
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('pikolscore:voice-audit', refreshVoiceAudit);
    return () => window.removeEventListener('pikolscore:voice-audit', refreshVoiceAudit);
  }, [open, refreshVoiceAudit]);

  // Preserve optional voice audit props without lint issues
  void voiceEntries;
  void voiceMicMode;
  void voiceMicModeSetting;
  void onSetMicModeSetting;
  void voiceTtsEnabled;
  void onSetTtsEnabled;
  void readVoiceAudit;
  void clearVoiceAudit;
  void voiceAuditToCsv;

  if (!open) return null;

  const reversed = [...entries].reverse();
  const reversedLegacy = [...legacyEntries].reverse();

  return (
    <>
      <div className="ps-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="ps-log-aside" aria-label="Match log" {...rest}>
        <div className="ps-log-header">
          <div className="flex flex-col">
            <span className="dv-overline leading-none mb-1">RALLY AUDIT</span>
            <span>Match log</span>
          </div>
          <button type="button" className="ps-pill" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Match Roster: Historical Participant Truth */}
        <div className="mb-4 rounded-[12px] bg-[#07192B] border border-[#24425E] p-3.5 text-[12.5px] text-[#B0C4D8]">
          <div className="font-bold uppercase tracking-[0.1em] text-[11px] text-[#00E5B8] mb-1.5">
            {format === 'singles' ? 'Singles Match Lineup' : 'Doubles Match Lineup'}
          </div>
          {format === 'singles' ? (
            <div className="font-semibold text-[#FFFFFF]">
              <span>{teamNames[0] || 'Player 1'}</span>
              <span className="text-[#6C87A3] mx-1.5">vs</span>
              <span>{teamNames[1] || 'Player 2'}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-[13px]">
              <div>
                <span className="font-bold text-[#FFFFFF]">{teamNames[0] || 'Team A'}:</span>{' '}
                <span className="text-[#B0C4D8]">
                  {playerNames?.team0?.filter(Boolean).join(' & ') || 'Player 1 & Player 2'}
                </span>
              </div>
              <div>
                <span className="font-bold text-[#FFFFFF]">{teamNames[1] || 'Team B'}:</span>{' '}
                <span className="text-[#B0C4D8]">
                  {playerNames?.team1?.filter(Boolean).join(' & ') || 'Player 3 & Player 4'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Legacy imported entries notice & list */}
        {reversedLegacy.length > 0 && (
          <div className="ps-legacy-log-section">
            <div className="ps-legacy-log-badge">
              <span>Imported local log (read-only)</span>
            </div>
            <ol className="ps-log-list ps-legacy-log-list">
              {reversedLegacy.map((item, idx) => (
                <li
                  key={`legacy-${idx}-${item.elapsed ?? item.e ?? 0}`}
                  className="ps-log-item ps-log-item-legacy"
                >
                  <b>{formatMmSs(item.elapsed ?? item.e ?? 0)}</b>
                  <div>{item.message ?? item.m}</div>
                  <span>{item.call ?? item.sc}</span>
                </li>
              ))}
            </ol>
            <div className="ps-legacy-divider" />
          </div>
        )}

        <ol className="ps-log-list">
          {reversed.length === 0 && reversedLegacy.length === 0 ? (
            <li className="ps-log-empty">No points yet.</li>
          ) : (
            reversed.map((item, idx) => (
              <li
                key={`${entries.length - 1 - idx}-${item.elapsed ?? item.e ?? 0}`}
                className="ps-log-item"
              >
                <b>{formatMmSs(item.elapsed ?? item.e ?? 0)}</b>
                <div>{item.message ?? item.m}</div>
                <span>{item.call ?? item.sc}</span>
              </li>
            ))
          )}
        </ol>
      </aside>
    </>
  );
}

export default MatchLog;
