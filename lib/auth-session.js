const SAVED_ACCOUNTS_KEY = 'pikol_saved_accounts';
const PREFERRED_ROLE_KEY = 'pikol_preferred_role';
const MAX_SAVED_ACCOUNTS = 5;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reads the remembered browser role ('umpire' | 'player') from localStorage
 * and prunes it if older than 7 days.
 */
export function getValidPreferredRole() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFERRED_ROLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const isValidRole = parsed?.role === 'umpire' || parsed?.role === 'player';
    const isFresh =
      typeof parsed?.savedAt === 'number' &&
      Date.now() - parsed.savedAt <= SEVEN_DAYS_MS;

    if (!isValidRole || !isFresh) {
      window.localStorage.removeItem(PREFERRED_ROLE_KEY);
      return null;
    }
    return parsed.role;
  } catch (err) {
    console.error('Failed to read preferred role:', err);
    return null;
  }
}

/**
 * Saves the preferred role ('umpire' | 'player') in localStorage for 7 days.
 */
export function savePreferredRole(role) {
  if (typeof window === 'undefined') return;
  if (role !== 'umpire' && role !== 'player') return;
  try {
    window.localStorage.setItem(
      PREFERRED_ROLE_KEY,
      JSON.stringify({ role, savedAt: Date.now() })
    );
  } catch (err) {
    console.error('Failed to save preferred role:', err);
  }
}

/**
 * Clears the remembered role from localStorage.
 */
export function clearPreferredRole() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFERRED_ROLE_KEY);
  } catch (err) {
    console.error('Failed to clear preferred role:', err);
  }
}

/**
 * Builds query string preserving court, session, and/or tv URL parameters.
 */
export function buildQuerySuffix(target = null) {
  if (!target) return '';
  if (typeof target === 'string') {
    return target.startsWith('?') ? target : `?session=${encodeURIComponent(target)}`;
  }
  const p = new URLSearchParams();
  if (target.courtNumber || target.court) {
    p.set('court', String(target.courtNumber || target.court));
  }
  if (target.sessionId || target.session) {
    p.set('session', String(target.sessionId || target.session));
  }
  if (target.tvId || target.tv) {
    p.set('tv', String(target.tvId || target.tv));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

/**
 * Resolves the target route for a signed-out visitor based on 7-day cached role
 * and optional ?court=1..4, ?session=<id>, or ?tv=<tvId> parameter from a QR scan.
 */
export function resolveSignedOutDestination(target = null) {
  const suffix = buildQuerySuffix(target);
  // Scanning a TV pairing QR (?tv=...) is an umpire action -> route straight to Umpire sign-in
  if (target && typeof target === 'object' && (target.tvId || target.tv)) {
    return `/umpire${suffix}`;
  }
  const cachedRole = getValidPreferredRole();
  if (cachedRole === 'umpire') return `/umpire${suffix}`;
  if (cachedRole === 'player') return `/player${suffix}`;
  return `/role${suffix}`;
}

/**
 * Resolves the target route for an authenticated user, supporting:
 * - Player portal (/player?court=n or ?session=id)
 * - Umpire active match lock (/pikolscore?session=<id>) or Match Hub (/matches?court=n&tv=id)
 */
export async function resolveAuthenticatedDestination(
  supabase,
  userId,
  target = null
) {
  const suffix = buildQuerySuffix(target);
  const tvId =
    target && typeof target === 'object' ? target.tvId || target.tv || null : null;

  if (!supabase || !userId) {
    return resolveSignedOutDestination(target);
  }

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.role === 'player') {
      return `/player${suffix}`;
    }

    // Umpire check: if umpire is in a started match (lobbyLocked = true), lock them into it!
    const { data: activeSessions } = await supabase
      .from('match_sessions')
      .select('id, umpire_id, player_names')
      .eq('umpire_id', userId)
      .eq('status', 'in_progress')
      .order('updated_at', { ascending: false });

    const lockedMatch = (activeSessions || []).find((s) => {
      const assignedId =
        s.player_names && 'umpireId' in s.player_names
          ? s.player_names.umpireId
          : s.umpire_id;
      return assignedId === userId && s.player_names?.lobbyLocked === true;
    });

    if (lockedMatch?.id) {
      const lockedParams = new URLSearchParams();
      lockedParams.set('session', lockedMatch.id);
      if (tvId) lockedParams.set('tv', String(tvId));
      return `/pikolscore?${lockedParams.toString()}`;
    }
  } catch (err) {
    console.error('Failed to resolve authenticated destination:', err);
  }

  return `/matches${suffix}`;
}

/**
 * Extracts the session_id claim from a Supabase access_token JWT.
 */
export function extractSessionIdFromJwt(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') return null;
  try {
    const payloadBase64 = accessToken.split('.')[1];
    if (!payloadBase64) return null;
    const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const claims = JSON.parse(jsonPayload);
    return claims.session_id || null;
  } catch (err) {
    console.error('Failed to decode session_id from JWT:', err);
    return null;
  }
}

/**
 * Reads saved accounts from localStorage and prunes any entry older than 7 days.
 */
export function getValidSavedAccounts() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    const valid = parsed.filter(
      (acc) =>
        acc &&
        acc.userId &&
        acc.refreshToken &&
        typeof acc.loggedOutAt === 'number' &&
        now - acc.loggedOutAt <= SEVEN_DAYS_MS
    );

    if (valid.length !== parsed.length) {
      window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(valid));
    }

    return valid.sort((a, b) => b.loggedOutAt - a.loggedOutAt);
  } catch (err) {
    console.error('Failed to read saved accounts:', err);
    return [];
  }
}

/**
 * Pushes or updates an account in pikol_saved_accounts, capped at 5 MRU items.
 */
export function saveAccountForQuickSwitch(session, profileName = '') {
  if (typeof window === 'undefined' || !session?.user || !session?.refresh_token) {
    return;
  }

  const user = session.user;
  const sessionId = extractSessionIdFromJwt(session.access_token);
  const fullName =
    profileName ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    'Umpire';

  const existing = getValidSavedAccounts().filter((acc) => acc.userId !== user.id);

  const newEntry = {
    userId: user.id,
    email: user.email || '',
    fullName,
    sessionId: sessionId || '',
    refreshToken: session.refresh_token,
    loggedOutAt: Date.now(),
  };

  const updated = [newEntry, ...existing]
    .sort((a, b) => b.loggedOutAt - a.loggedOutAt)
    .slice(0, MAX_SAVED_ACCOUNTS);

  window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
}

/**
 * Removes a specific userId from pikol_saved_accounts.
 */
export function removeSavedAccount(userId) {
  if (typeof window === 'undefined' || !userId) return [];
  const remaining = getValidSavedAccounts().filter((acc) => acc.userId !== userId);
  window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(remaining));
  return remaining;
}

/**
 * Removes the active Supabase auth token from localStorage without calling server signOut.
 */
export function detachActiveSupabaseSession() {
  if (typeof window === 'undefined') return;
  const keysToRemove = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
}
