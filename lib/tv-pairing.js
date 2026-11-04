import { supabase } from '@/config/supabase';

export const TV_ID_STORAGE_KEY = 'pikol_tv_device_id';
export const PAIRED_COURT_STORAGE_KEY = 'pikol_tv_paired_court';
export const TV_RETURN_TO_ROLE_KEY = 'pikol_tv_return_to_role';

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generates a clean 6-character uppercase TV pairing ID like `tv_A4F92C`.
 */
export function generateTvId() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return `tv_${code}`;
}

/**
 * Extracts the 6-character human-readable code (e.g. `A4F92C`) from `tv_A4F92C`.
 */
export function getShortTvCode(tvId = '') {
  return String(tvId || '')
    .replace(/^tv_/i, '')
    .toUpperCase();
}

/**
 * Normalizes a scanned QR URL, raw tvId, or 6-character manual code into `tv_<UPPERCASE>`.
 */
export function normalizeTvId(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';

  // Check if input is a URL containing ?tv=...
  try {
    if (raw.includes('tv=')) {
      const url = raw.startsWith('http')
        ? new URL(raw)
        : new URL(raw, 'https://pikolscore.local');
      const tvParam = url.searchParams.get('tv');
      if (tvParam) {
        const cleanParam = tvParam.trim().replace(/^tv_/i, '').toUpperCase();
        return cleanParam ? `tv_${cleanParam}` : '';
      }
    }
  } catch {
    // Fallback to string parsing below
  }

  const cleaned = raw
    .replace(/^tv[-_:\s]*/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  if (!cleaned) return '';
  return `tv_${cleaned}`;
}

/**
 * Broadcasts a TV pairing event over Supabase Realtime and persists the tvId
 * in the court's match_session row via /api/match/lobby (action: 'pair_tv').
 */
export async function pairTvWithCourt({ tvId, courtNumber, sessionId }) {
  const normalizedTvId = normalizeTvId(tvId);
  if (!normalizedTvId || !courtNumber) {
    throw new Error('Valid TV QR code / pairing code and court number are required.');
  }

  const {
    data: { session: authSession },
  } = await supabase.auth.getSession();
  const token = authSession?.access_token || '';

  // 1. Persist pairing in match_sessions via /api/match/lobby
  const res = await fetch('/api/match/lobby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'pair_tv',
      tvId: normalizedTvId,
      courtNumber: Number(courtNumber),
      sessionId: sessionId || undefined,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to pair TV screen');
  }

  // 2. Also broadcast immediately over Supabase Realtime channel for instant wakeup
  try {
    const channel = supabase.channel(`tv_pairing:${normalizedTvId}`);
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const timer = setTimeout(done, 1200);
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.send({
            type: 'broadcast',
            event: 'paired',
            payload: {
              tvId: normalizedTvId,
              courtNumber: Number(courtNumber),
              sessionId: data.session?.id || sessionId || null,
            },
          });
          clearTimeout(timer);
          done();
        }
      });
    });
    supabase.removeChannel(channel);
  } catch (err) {
    console.warn('[pairTvWithCourt] Broadcast fallback warning:', err);
  }

  return data;
}

/**
 * Helper to broadcast an event on a Supabase Realtime channel and clean up.
 */
async function sendRealtimeBroadcast(channelName, event, payload) {
  try {
    const channel = supabase.channel(channelName);
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const timer = setTimeout(done, 1000);
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.send({
            type: 'broadcast',
            event,
            payload,
          });
          clearTimeout(timer);
          done();
        }
      });
    });
    supabase.removeChannel(channel);
  } catch (err) {
    console.warn(`[sendRealtimeBroadcast:${channelName}] Warning:`, err);
  }
}

/**
 * Notifies any Courtside TV displaying `courtNumber` (or `pairedTvIds`) that the
 * match has ended ('completed') or been terminated ('abandoned'), both via
 * Realtime broadcast AND via /api/match/lobby (action: 'close_match').
 */
export async function notifyTvCourtClosed({
  courtNumber,
  sessionId,
  reason = 'completed',
  pairedTvIds = [],
}) {
  const closeReason = reason === 'abandoned' ? 'abandoned' : 'completed';
  const cNum = Number(courtNumber) || null;
  const payload = {
    courtNumber: cNum,
    sessionId: sessionId || null,
    reason: closeReason,
  };

  // 1. Broadcast immediately on court channel + each paired TV's device channel
  const broadcastTasks = [];
  if (cNum >= 1 && cNum <= 4) {
    broadcastTasks.push(
      sendRealtimeBroadcast(`tv_court:${cNum}`, 'court_closed', payload)
    );
  }
  if (Array.isArray(pairedTvIds)) {
    pairedTvIds.forEach((id) => {
      const norm = normalizeTvId(id);
      if (norm) {
        broadcastTasks.push(
          sendRealtimeBroadcast(`tv_pairing:${norm}`, 'court_closed', payload)
        );
      }
    });
  }

  // 2. Also call /api/match/lobby (action: 'close_match') so the in_progress row
  // emits a postgres_changes UPDATE with tvClosedReason before RLS hides 'abandoned'
  const apiTask = (async () => {
    try {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      const token = authSession?.access_token || '';
      if (!token || (!sessionId && !cNum)) return;

      await fetch('/api/match/lobby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'close_match',
          reason: closeReason,
          sessionId: sessionId || undefined,
          courtNumber: cNum || undefined,
        }),
      });
    } catch (err) {
      console.warn('[notifyTvCourtClosed] API warning:', err);
    }
  })();

  await Promise.allSettled([...broadcastTasks, apiTask]);
}
