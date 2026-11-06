'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PickleballEngine } from '../lib/engine';
import { WebAudioSynth, getSynth } from '../lib/audio';
import { engineToRallyState } from '../lib/hydrate';

function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore haptics errors
  }
}

export function useScoreboard({
  format = 'doubles',
  storageKey = 'pikolscore_v3',
  keyboardShortcuts = true,
  elapsedSeconds = 0,
  onEscape,
  isGuest = false,
  sync = null,
  engineRef: externalEngineRef = null,
} = {}) {
  const [state, setState] = useState(null);
  const localEngineRef = useRef(null);
  const engineRef = externalEngineRef || localEngineRef;
  const audioRef = useRef(null);

  const elapsedSecondsRef = useRef(elapsedSeconds);
  elapsedSecondsRef.current = elapsedSeconds;

  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const syncState = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const s = engine.getState();
    setState(s);

    // Stop writing to localStorage when Cloud Sync is enabled
    if (!sync?.isEnabled) {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            snapshot: engine.saveSnapshot(),
            history: engine.history,
            redoStack: engine.redoStack,
          })
        );
      } catch {
        // Ignore storage write error
      }
    }
  }, [storageKey, sync?.isEnabled, engineRef]);

  // Initial engine setup
  useEffect(() => {
    audioRef.current = getSynth() || new WebAudioSynth();

    if (!engineRef.current) {
      engineRef.current = new PickleballEngine({ format });
    }

    // Fallback to localStorage only when cloud sync is disabled
    if (!sync?.isEnabled) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.snapshot) {
            engineRef.current.restoreSnapshot(parsed.snapshot);
            engineRef.current.history = Array.isArray(parsed.history) ? parsed.history : [];
            engineRef.current.redoStack = Array.isArray(parsed.redoStack) ? parsed.redoStack : [];
          } else {
            engineRef.current.restoreSnapshot(saved);
          }
        }
      } catch {
        // Ignore storage read error
      }
    }

    setState(engineRef.current.getState());
  }, [format, storageKey, sync?.isEnabled, engineRef]);

  // Keep state synchronized whenever cloud rehydration finishes
  useEffect(() => {
    if (engineRef.current) {
      setState(engineRef.current.getState());
    }
  }, [sync?.rehydrateVersion, sync?.serverSession, engineRef]);

  const point = useCallback((reason = null) => {
    if (isGuest) return;
    const engine = engineRef.current;
    if (!engine) return;
    audioRef.current?.init();
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
    const res = engine.pointWon(elapsedSecondsRef.current, cleanReason);
    if (res?.event === 'gameWon') {
      audioRef.current?.gameWon();
    } else {
      audioRef.current?.point();
    }
    vibrate(15);
    syncState();

    if (sync?.isEnabled && res?.logEntry) {
      sync.recordRally({
        eventId:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : null,
        eventType: res.event === 'gameWon' ? 'gameWon' : 'point',
        elapsedSeconds: elapsedSecondsRef.current,
        stateAfter: engineToRallyState(engine),
        callString: res.logEntry.call,
        message: res.logEntry.message,
      });
    }
    return res;
  }, [isGuest, syncState, sync, engineRef]);

  const fault = useCallback((reason = null) => {
    if (isGuest) return;
    const engine = engineRef.current;
    if (!engine) return;
    audioRef.current?.init();
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
    const res = engine.fault(elapsedSecondsRef.current, cleanReason);
    audioRef.current?.fault();
    vibrate(15);
    syncState();

    if (sync?.isEnabled && res?.logEntry) {
      sync.recordRally({
        eventId:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : null,
        eventType: res.event === 'secondServer' ? 'secondServer' : 'sideOut',
        elapsedSeconds: elapsedSecondsRef.current,
        stateAfter: engineToRallyState(engine),
        callString: res.logEntry.call,
        message: res.logEntry.message,
      });
    }
    return res;
  }, [isGuest, syncState, sync, engineRef]);

  const undo = useCallback(() => {
    if (isGuest) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.undo()) {
      syncState();
      if (sync?.isEnabled) {
        sync.undo();
      }
    }
  }, [isGuest, syncState, sync, engineRef]);

  const redo = useCallback(() => {
    if (isGuest) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.redo()) {
      syncState();
      if (sync?.isEnabled) {
        sync.redo();
      }
    }
  }, [isGuest, syncState, sync, engineRef]);

  const reset = useCallback(() => {
    if (isGuest) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.reset();
    syncState();
  }, [isGuest, syncState, engineRef]);

  const setTeamName = useCallback(
    (teamIdx, name) => {
      if (isGuest) return;
      const engine = engineRef.current;
      if (!engine || !name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      engine.setTeamName(teamIdx, trimmed);
      syncState();

      if (sync?.isEnabled) {
        sync.updateSessionMeta({
          teamNames: engine.teamNames,
          teamPalettes: engine.teamPalettes,
        });
      }
    },
    [isGuest, syncState, sync, engineRef]
  );

  const setTeamPalette = useCallback(
    (teamIdx, paletteKey) => {
      if (isGuest) return;
      const engine = engineRef.current;
      if (!engine || !paletteKey) return;
      engine.setTeamPalette(teamIdx, paletteKey);
      syncState();

      if (sync?.isEnabled) {
        sync.updateSessionMeta({
          teamNames: engine.teamNames,
          teamPalettes: engine.teamPalettes,
        });
      }
    },
    [isGuest, syncState, sync, engineRef]
  );

  const timeExpired = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return null;
    const res = engine.timeExpired(elapsedSecondsRef.current);
    syncState();

    if (sync?.isEnabled && res?.logEntry) {
      sync.recordRally({
        eventId:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : null,
        eventType: 'gameWon',
        elapsedSeconds: elapsedSecondsRef.current,
        stateAfter: engineToRallyState(engine),
        callString: res.logEntry.call,
        message: res.logEntry.message,
      });
    }

    return res;
  }, [engineRef, syncState, sync]);

  useEffect(() => {
    if (!keyboardShortcuts || isGuest) return;

    const onKeyDown = (e) => {
      if (isGuest) return;
      if (e.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (
        e.target &&
        typeof e.target.closest === 'function' &&
        e.target.closest('button, [role="button"], input, textarea, select')
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        point();
      } else if (k === 'f') {
        fault();
      } else if (k === 'z') {
        undo();
      } else if (k === 'y') {
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardShortcuts, isGuest, point, fault, undo, redo]);

  return {
    state,
    engineRef,
    servingTeam: state?.servingTeam ?? 0,
    servingTeamKey: state?.servingTeamKey ?? 'omega',
    log: state?.log ?? [],
    canUndo: Boolean(state?.canUndo),
    canRedo: Boolean(state?.canRedo),
    gameOver: Boolean(state?.gameOver),
    winner: state?.winner ?? null,
    winnerName: state?.winnerName ?? null,
    isDraw: Boolean(state?.isDraw),
    point,
    fault,
    undo,
    redo,
    reset,
    timeExpired,
    setTeamName,
    setTeamPalette,
  };
}

export default useScoreboard;
