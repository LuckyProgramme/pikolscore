/**
 * Pure domain helpers for the TV Standby Poster (name formatting, initials,
 * profile cutout URL selection, and match_sessions -> StandbyPoster prop mapping).
 */

/**
 * Splits a full player name according to Section 1 rules:
 * - Everything before the last space is the small first line (`firstName`)
 * - The last word is the large surname (`lastName`, rendered uppercase via CSS)
 * - A single-word name shows only the large surname line (`firstName: ''`)
 */
export function splitPlayerName(rawName = '') {
  const cleaned = String(rawName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) {
    return { firstName: '', lastName: '' };
  }
  const lastSpaceIndex = cleaned.lastIndexOf(' ');
  if (lastSpaceIndex === -1) {
    return { firstName: '', lastName: cleaned };
  }
  return {
    firstName: cleaned.slice(0, lastSpaceIndex),
    lastName: cleaned.slice(lastSpaceIndex + 1),
  };
}

/**
 * Extracts up to 2 uppercase initials from a player's name for the no-photo fallback.
 */
export function getPlayerInitials(rawName = '') {
  const parts = String(rawName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isUsableImageUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/')
  );
}

export const STANDBY_SLOT_ORDER = ['A-front', 'A-back', 'B-front', 'B-back'];
export const MOTION_FRAME_INTERVAL_MS = 180;
export const MOTION_INTER_PLAYER_PAUSE_MS = 1500;

/**
 * Resolves all usable cutout pose URLs from a profile row in pose order
 * (`photo_urls[0..3]`), falling back to `avatar_url` when empty.
 */
export function resolveProfileCutoutUrls(profile) {
  if (!profile) return [];
  const rawList = Array.isArray(profile.photo_urls) ? profile.photo_urls : [];
  const urls = rawList
    .filter((u) => isUsableImageUrl(u))
    .map((u) => u.trim());

  if (urls.length > 0) {
    return urls;
  }

  if (isUsableImageUrl(profile.avatar_url)) {
    return [profile.avatar_url.trim()];
  }

  return [];
}

/**
 * Resolves a player's primary idle cutout URL from their profile row.
 */
export function resolveProfileCutoutUrl(profile) {
  return resolveProfileCutoutUrls(profile)[0] || null;
}

/**
 * Given the last spotlight slot key and currently eligible multi-frame slots,
 * returns the next slot in strict team-by-team order (`A-front -> A-back -> B-front -> B-back`).
 */
export function getNextSpotlightSlot(lastSlotKey, eligibleSlots) {
  const orderedEligible = STANDBY_SLOT_ORDER.filter((slot) =>
    eligibleSlots.includes(slot)
  );
  if (orderedEligible.length === 0) return null;
  if (!lastSlotKey) return orderedEligible[0];

  const lastOrderIdx = STANDBY_SLOT_ORDER.indexOf(lastSlotKey);
  if (lastOrderIdx === -1) return orderedEligible[0];

  const nextAfter = orderedEligible.find(
    (slot) => STANDBY_SLOT_ORDER.indexOf(slot) > lastOrderIdx
  );
  return nextAfter || orderedEligible[0];
}

/**
 * Collects active players for one team, compacting empty slots so the first
 * present player takes the Front slot and the second takes the Back slot.
 */
function extractTeamPlayers(slotsArray, fallbackNamesArray, profilesById) {
  if (Array.isArray(slotsArray)) {
    return slotsArray
      .filter((slot) => slot && typeof slot.name === 'string' && slot.name.trim())
      .map((slot) => {
        const name = slot.name.trim();
        const userId = slot.userId || null;
        const profile = userId && profilesById ? profilesById[userId] : null;
        const slotImages = Array.isArray(slot.cutoutUrls)
          ? slot.cutoutUrls.filter((u) => isUsableImageUrl(u)).map((u) => u.trim())
          : [];
        const singleSlotImage = isUsableImageUrl(slot.cutoutUrl)
          ? slot.cutoutUrl.trim()
          : isUsableImageUrl(slot.avatarUrl)
          ? slot.avatarUrl.trim()
          : null;
        const profileUrls = resolveProfileCutoutUrls(profile);
        const cutoutUrls =
          slotImages.length > 0
            ? slotImages
            : singleSlotImage
            ? [singleSlotImage]
            : profileUrls;

        return {
          id: userId || name,
          name,
          cutoutUrl: cutoutUrls[0] || null,
          cutoutUrls,
        };
      });
  }

  if (Array.isArray(fallbackNamesArray)) {
    return fallbackNamesArray
      .filter((n) => typeof n === 'string' && n.trim())
      .map((n) => {
        const name = n.trim();
        return {
          id: name,
          name,
          cutoutUrl: null,
          cutoutUrls: [],
        };
      });
  }

  return [];
}

/**
 * Maps a `match_sessions` row + cached `profilesById` map into the plain
 * `{ courtNumber, matchType, teamA, teamB }` shape expected by `StandbyPoster`.
 */
export function buildPosterPropsFromSession({
  session,
  pairedCourt,
  profilesById = {},
}) {
  const courtNumber =
    Number(session?.court_number || session?.player_names?.courtNumber || pairedCourt) || 1;
  const rawFormat = String(
    session?.format || session?.initial_state?.format || 'doubles'
  )
    .trim()
    .toLowerCase();
  const isSingles = rawFormat === 'singles';
  const matchType = isSingles ? 'Singles' : 'Doubles';

  const pNames = session?.player_names || {};
  const slots = pNames.slots || null;

  const teamA = extractTeamPlayers(slots?.team0, pNames.team0, profilesById);
  const teamB = extractTeamPlayers(slots?.team1, pNames.team1, profilesById);

  return {
    courtNumber,
    matchType,
    teamA: isSingles ? teamA.slice(0, 1) : teamA.slice(0, 2),
    teamB: isSingles ? teamB.slice(0, 1) : teamB.slice(0, 2),
  };
}
