'use client';

import { useState, useEffect, useId, useMemo, useRef, useCallback } from 'react';
import {
  splitPlayerName,
  getPlayerInitials,
  STANDBY_SLOT_ORDER,
  MOTION_FRAME_INTERVAL_MS,
  MOTION_INTER_PLAYER_PAUSE_MS,
  getNextSpotlightSlot,
} from '@/lib/standby-poster';

export { splitPlayerName, getPlayerInitials };

export const FIXTURE_CUTOUT_URL = '/asset/player-cutout-fixture.png';

export const STANDBY_POSTER_FIXTURES = {
  doubles: {
    courtNumber: 2,
    matchType: 'Doubles',
    teamA: [
      { name: 'Miguel Reyes', cutoutUrl: FIXTURE_CUTOUT_URL },
      { name: 'Paolo Dizon', cutoutUrl: FIXTURE_CUTOUT_URL },
    ],
    teamB: [
      { name: 'Jun Bautista', cutoutUrl: FIXTURE_CUTOUT_URL },
      { name: 'Rico Lim', cutoutUrl: FIXTURE_CUTOUT_URL },
    ],
  },
  figma: {
    courtNumber: 2,
    matchType: 'Men’s Doubles',
    teamA: [
      { name: 'Miguel Reyes', cutoutUrl: FIXTURE_CUTOUT_URL },
      { name: 'Paolo Dizon', cutoutUrl: FIXTURE_CUTOUT_URL },
    ],
    teamB: [
      { name: 'Jun Bautista', cutoutUrl: FIXTURE_CUTOUT_URL },
      { name: 'Rico Lim', cutoutUrl: FIXTURE_CUTOUT_URL },
    ],
  },
  singles: {
    courtNumber: 2,
    matchType: 'Singles',
    teamA: [{ name: 'Miguel Reyes', cutoutUrl: FIXTURE_CUTOUT_URL }],
    teamB: [{ name: 'Jun Bautista', cutoutUrl: FIXTURE_CUTOUT_URL }],
  },
  empty: {
    courtNumber: 2,
    matchType: 'Doubles',
    teamA: [],
    teamB: [],
  },
  initials: {
    courtNumber: 2,
    matchType: 'Doubles',
    teamA: [
      { name: 'Miguel Reyes', cutoutUrl: null },
      { name: 'Maria Clara De Los Santos-Villanueva', cutoutUrl: null },
    ],
    teamB: [
      { name: 'Madonna', cutoutUrl: null },
      { name: 'Rico Lim', cutoutUrl: FIXTURE_CUTOUT_URL },
    ],
  },
  motion: {
    courtNumber: 2,
    matchType: 'Doubles',
    teamA: [
      {
        id: 'motion-a1',
        name: 'Miguel Reyes',
        cutoutUrls: [
          `${FIXTURE_CUTOUT_URL}?f=a1`,
          `${FIXTURE_CUTOUT_URL}?f=a2`,
          `${FIXTURE_CUTOUT_URL}?f=a3`,
          `${FIXTURE_CUTOUT_URL}?f=a4`,
        ],
      },
      {
        id: 'motion-a2',
        name: 'Paolo Dizon',
        cutoutUrls: [
          `${FIXTURE_CUTOUT_URL}?f=b1`,
          `${FIXTURE_CUTOUT_URL}?f=b2`,
          `${FIXTURE_CUTOUT_URL}?f=b3`,
          `${FIXTURE_CUTOUT_URL}?f=b4`,
        ],
      },
    ],
    teamB: [
      {
        id: 'motion-b1',
        name: 'Jun Bautista',
        cutoutUrls: [`${FIXTURE_CUTOUT_URL}?f=c1`],
      },
      {
        id: 'motion-b2',
        name: 'Rico Lim',
        cutoutUrls: [
          `${FIXTURE_CUTOUT_URL}?f=d1`,
          `${FIXTURE_CUTOUT_URL}?f=d2`,
          `${FIXTURE_CUTOUT_URL}?f=d3`,
          `${FIXTURE_CUTOUT_URL}?f=d4`,
        ],
      },
    ],
  },
};

/**
 * 1920x1080 fixed-size stage scaled with a single `transform: scale()` to fit any viewport,
 * letterboxed with `#0C211E` (`bg-poster-stage`).
 */
export function PosterStage({ children, className = '' }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateScale = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setScale(Math.min(vw / 1920, vh / 1080));
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <div
      className={`fixed inset-0 bg-poster-stage overflow-hidden flex items-center justify-center select-none font-outfit ${className}`}
    >
      <div
        className="relative w-[1920px] h-[1080px] bg-poster-stage overflow-hidden shrink-0"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Split diagonal court backdrop with Team A teal gradient, Team B sage gradient,
 * radial glows, and cream center seam at 90% opacity.
 */
export function PosterBackground() {
  return (
    <svg
      width="1920"
      height="1080"
      viewBox="0 0 1920 1080"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 w-[1920px] h-[1080px] pointer-events-none"
      aria-hidden="true"
    >
      <g clipPath="url(#poster-stage-clip)">
        {/* Team A polygon: (0,0) (1034,0) (886,1080) (0,1080) */}
        <path
          d="M0 0H1034L886 1080H0V0Z"
          fill="url(#poster-team-a-grad)"
        />
        {/* Team B polygon: (1034,0) (1920,0) (1920,1080) (886,1080) */}
        <path
          d="M1034 0H1920V1080H886L1034 0Z"
          fill="url(#poster-team-b-grad)"
        />
        {/* Team A radial glow: r=560 at (470, 640) #3AA7AC 36% -> 0 */}
        <circle
          cx="470"
          cy="640"
          r="560"
          fill="url(#poster-team-a-glow)"
        />
        {/* Team B radial glow: r=560 at (1450, 640) #8A9B82 34% -> 0 */}
        <circle
          cx="1450"
          cy="640"
          r="560"
          fill="url(#poster-team-b-glow)"
        />
        {/* Seam parallelogram: (1034,0) (1042,0) (894,1080) (886,1080) */}
        <path
          d="M1034 0H1042L894 1080H886L1034 0Z"
          fill="#FEECD6"
          fillOpacity="0.9"
        />
      </g>
      <defs>
        <linearGradient
          id="poster-team-a-grad"
          x1="0"
          y1="0"
          x2="1000"
          y2="1080"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0F5C62" />
          <stop offset="1" stopColor="#073A38" />
        </linearGradient>
        <linearGradient
          id="poster-team-b-grad"
          x1="1920"
          y1="0"
          x2="900"
          y2="1080"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#2A4F47" />
          <stop offset="1" stopColor="#14302B" />
        </linearGradient>
        <radialGradient
          id="poster-team-a-glow"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(470 640) scale(560)"
        >
          <stop stopColor="#3AA7AC" stopOpacity="0.36" />
          <stop offset="1" stopColor="#3AA7AC" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id="poster-team-b-glow"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(1450 640) scale(560)"
        >
          <stop stopColor="#8A9B82" stopOpacity="0.34" />
          <stop offset="1" stopColor="#8A9B82" stopOpacity="0" />
        </radialGradient>
        <clipPath id="poster-stage-clip">
          <rect width="1920" height="1080" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * Placeholder silhouette SVG (native 300x562 aspect).
 * All subpaths wind the same direction so head, neck, and torso never cut holes in each other.
 */
function PlaceholderSilhouette() {
  const rawId = useId();
  const gradId = `silhouette-grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      viewBox="0 0 300 562"
      fill="none"
      className="w-full h-full block"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="0"
          y2="562"
        >
          <stop offset="0" stopColor="#EAF0E5" stopOpacity=".34" />
          <stop offset=".72" stopColor="#EAF0E5" stopOpacity=".22" />
          <stop offset="1" stopColor="#EAF0E5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M88 120 a62 62 0 1 1 124 0 a62 62 0 1 1 -124 0 Z M122 165 L178 165 L178 250 L122 250 Z M0 562 C0 430 34 330 104 290 C124 278 130 262 130 250 L170 250 C170 262 176 278 196 290 C266 330 300 430 300 562 Z"
      />
    </svg>
  );
}

const SLOT_LAYOUT = {
  'A-back': 'left-[455px] top-[330px] w-[350px] h-[655px] z-20',
  'B-back': 'left-[1115px] top-[330px] w-[350px] h-[655px] z-20',
  'A-front': 'left-[110px] top-[250px] w-[420px] h-[786px] z-30',
  'B-front': 'left-[1390px] top-[250px] w-[420px] h-[786px] z-30',
};

const BOTTOM_FADE_MASK = {
  WebkitMaskImage:
    'linear-gradient(to bottom, #000 0%, #000 84%, transparent 100%)',
  maskImage:
    'linear-gradient(to bottom, #000 0%, #000 84%, transparent 100%)',
};

/**
 * Preloads an image URL offscreen and awaits decode() so swap-in never flashes partial paints.
 */
function preloadAndDecodeImage(url) {
  if (!url || typeof window === 'undefined') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const img = new window.Image();
    img.decoding = 'async';
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
        resolve(img.naturalWidth > 0);
      } catch {
        resolve(Boolean(img.complete && img.naturalWidth > 0));
      }
    };

    img.onload = finish;
    img.onerror = () => {
      if (settled) return;
      settled = true;
      resolve(false);
    };
    img.src = url;

    if (img.complete && img.naturalWidth > 0) {
      finish();
    }
  });
}

/**
 * Renders one player avatar slot (front or back for Team A or Team B).
 * - Immediately preloads and decodes Frame 0 (Idle) with a 400ms rise-and-fade entrance.
 * - Preloads motion frames (1..3) once allowed by the sequential loader, keeping all decoded
 *   layers mounted so stop-motion frame transitions happen with zero decode or paint flicker.
 * - Falls back to placeholder silhouette + team-colored initials badge while loading or on error.
 */
export function PlayerSlot({
  team = 'A',
  position = 'front',
  player = null,
  slotSignature = '',
  activeFrameIndex = 0,
  allowMotionPreload = false,
  onSlotReadyChange,
  onMotionPreloadDone,
}) {
  const slotKey = `${team}-${position}`;
  const layoutClass = SLOT_LAYOUT[slotKey] || SLOT_LAYOUT['A-front'];

  const playerName = player?.name ? String(player.name).trim() : '';
  const hasPlayer = Boolean(playerName);

  const rawFramesKey = !hasPlayer
    ? ''
    : (Array.isArray(player?.cutoutUrls)
        ? player.cutoutUrls
        : player?.cutoutUrl
        ? [player.cutoutUrl]
        : []
      )
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim())
        .join('|');

  const frameUrls = useMemo(
    () => (rawFramesKey ? rawFramesKey.split('|') : []),
    [rawFramesKey]
  );

  const primaryUrl = frameUrls[0] || null;
  const effectiveSignature =
    slotSignature || `${playerName}|${rawFramesKey}`;

  const [frameState, setFrameState] = useState({
    primaryUrl: null,
    decodedUrls: [],
  });

  const callbacksRef = useRef({ onSlotReadyChange, onMotionPreloadDone });
  callbacksRef.current = { onSlotReadyChange, onMotionPreloadDone };

  // Phase 1: Always preload & decode Frame 0 (Idle) first
  useEffect(() => {
    let cancelled = false;
    const sig = effectiveSignature;

    if (!hasPlayer || !primaryUrl) {
      setFrameState({ primaryUrl: null, decodedUrls: [] });
      callbacksRef.current.onSlotReadyChange?.(slotKey, {
        signature: sig,
        idleSettled: true,
        decodedCount: 0,
      });
      callbacksRef.current.onMotionPreloadDone?.(slotKey, sig);
      return undefined;
    }

    setFrameState((prev) =>
      prev.primaryUrl === primaryUrl
        ? prev
        : { primaryUrl: null, decodedUrls: [] }
    );

    preloadAndDecodeImage(primaryUrl).then((ok) => {
      if (cancelled) return;
      if (ok) {
        setFrameState((prev) => ({
          primaryUrl,
          decodedUrls:
            prev.primaryUrl === primaryUrl && prev.decodedUrls.length > 0
              ? prev.decodedUrls
              : [primaryUrl],
        }));
        callbacksRef.current.onSlotReadyChange?.(slotKey, {
          signature: sig,
          idleSettled: true,
          decodedCount: 1,
        });
      } else {
        setFrameState({ primaryUrl: null, decodedUrls: [] });
        callbacksRef.current.onSlotReadyChange?.(slotKey, {
          signature: sig,
          idleSettled: true,
          decodedCount: 0,
        });
        callbacksRef.current.onMotionPreloadDone?.(slotKey, sig);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hasPlayer, primaryUrl, slotKey, effectiveSignature]);

  // Phase 2: Once idle frames settle & spotlight order reaches this slot, preload extra frames
  const isIdleDecoded = Boolean(primaryUrl && frameState.primaryUrl === primaryUrl);

  useEffect(() => {
    if (!hasPlayer || !allowMotionPreload || !isIdleDecoded) {
      return undefined;
    }

    const sig = effectiveSignature;

    if (frameUrls.length <= 1) {
      callbacksRef.current.onSlotReadyChange?.(slotKey, {
        signature: sig,
        idleSettled: true,
        decodedCount: 1,
      });
      callbacksRef.current.onMotionPreloadDone?.(slotKey, sig);
      return undefined;
    }

    let cancelled = false;

    const loadExtraFrames = async () => {
      const validFrames = [frameUrls[0]];
      for (let i = 1; i < frameUrls.length; i += 1) {
        const ok = await preloadAndDecodeImage(frameUrls[i]);
        if (cancelled) return;
        if (ok) {
          validFrames.push(frameUrls[i]);
        }
      }

      if (cancelled) return;
      setFrameState({
        primaryUrl: frameUrls[0],
        decodedUrls: validFrames,
      });
      callbacksRef.current.onSlotReadyChange?.(slotKey, {
        signature: sig,
        idleSettled: true,
        decodedCount: validFrames.length,
      });
      callbacksRef.current.onMotionPreloadDone?.(slotKey, sig);
    };

    loadExtraFrames();

    return () => {
      cancelled = true;
    };
  }, [hasPlayer, allowMotionPreload, isIdleDecoded, frameUrls, slotKey, effectiveSignature]);

  const decodedUrls =
    hasPlayer && frameState.primaryUrl === primaryUrl
      ? frameState.decodedUrls
      : [];
  const isPrimaryReady = decodedUrls.length > 0;
  const displayIdx =
    activeFrameIndex >= 0 && activeFrameIndex < decodedUrls.length
      ? activeFrameIndex
      : 0;

  const isFront = position === 'front';
  const isTeamA = team === 'A';
  const playerKey = `${player?.id || playerName}-${primaryUrl || 'none'}`;

  return (
    <div
      className={`absolute ${layoutClass} pointer-events-none select-none`}
      data-slot={slotKey}
      data-frame={isPrimaryReady ? displayIdx : undefined}
    >
      {isPrimaryReady ? (
        <div
          key={playerKey}
          className="relative w-full h-full animate-poster-enter motion-reduce:animate-none"
          style={BOTTOM_FADE_MASK}
        >
          {decodedUrls.map((url, idx) => (
            <img
              key={`${idx}-${url}`}
              src={url}
              alt={idx === 0 ? playerName : ''}
              aria-hidden={idx !== 0}
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain object-bottom block pointer-events-none"
              style={{ opacity: idx === displayIdx ? 1 : 0 }}
            />
          ))}
        </div>
      ) : (
        <div className="relative w-full h-full">
          <PlaceholderSilhouette />
          {hasPlayer && (
            <div className="absolute inset-x-0 top-[36%] flex items-center justify-center">
              <div
                key={`initials-${playerName}`}
                className={`rounded-full flex items-center justify-center font-outfit font-black tracking-tight shadow-[0_12px_32px_rgba(0,0,0,0.32)] animate-poster-enter motion-reduce:animate-none ${
                  isFront
                    ? 'w-[148px] h-[148px] text-[56px]'
                    : 'w-[124px] h-[124px] text-[46px]'
                } ${
                  isTeamA
                    ? 'bg-cream text-dark-teal border-[3px] border-teal/40'
                    : 'bg-sage text-poster-ink border-[3px] border-cream/40'
                }`}
              >
                {getPlayerInitials(playerName)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PILL_POSITIONS = {
  'A-front': 'left-[70px] top-[884px] z-[42]',
  'A-back': 'left-[630px] -translate-x-1/2 top-[800px] z-40',
  'B-front': 'right-[70px] top-[884px] z-[42]',
  'B-back': 'left-[1290px] -translate-x-1/2 top-[800px] z-40',
};

/**
 * Renders the player NamePill (or the quiet "Waiting for player" pill when the slot is empty).
 * Enforces a ~520px max width and steps down the surname font size for very long surnames.
 */
export function NamePill({ team = 'A', position = 'front', player = null }) {
  const slotKey = `${team}-${position}`;
  const posClass = PILL_POSITIONS[slotKey] || PILL_POSITIONS['A-front'];
  const hasPlayer = Boolean(player?.name && String(player.name).trim());

  if (!hasPlayer) {
    return (
      <div
        className={`absolute ${posClass} flex flex-col items-center justify-center rounded-[64px] pt-[16px] pb-[18px] px-[44px] bg-poster-stage/65 border-2 border-cream/25 shadow-[0_10px_28px_rgba(0,0,0,0.22)] whitespace-nowrap`}
        data-pill={slotKey}
      >
        <p className="font-outfit font-medium text-[26px] leading-[32px] text-pale-sage/75">
          Waiting for player
        </p>
      </div>
    );
  }

  const { firstName, lastName } = splitPlayerName(player.name);
  const isTeamA = team === 'A';

  // Step down surname font size so the pill never exceeds ~520px
  const surnameLen = lastName.length;
  let surnameSizeClass = 'text-[46px] leading-[52px]';
  if (surnameLen > 22) {
    surnameSizeClass = 'text-[22px] leading-[30px]';
  } else if (surnameLen > 16) {
    surnameSizeClass = 'text-[28px] leading-[36px]';
  } else if (surnameLen > 11) {
    surnameSizeClass = 'text-[36px] leading-[44px]';
  }

  return (
    <div
      className={`absolute ${posClass} flex flex-col items-center justify-center rounded-[64px] pt-[14px] pb-[18px] px-[56px] min-h-[116px] max-w-[520px] shadow-[0_10px_28px_rgba(0,0,0,0.28)] ${
        isTeamA ? 'bg-cream' : 'bg-sage text-poster-ink'
      }`}
      data-pill={slotKey}
    >
      {firstName && (
        <p
          className={`font-outfit font-medium text-[26px] leading-[32px] max-w-full truncate ${
            isTeamA ? 'text-teal' : 'text-poster-ink'
          }`}
        >
          {firstName}
        </p>
      )}
      <p
        className={`font-outfit font-bold ${surnameSizeClass} tracking-[0.02em] uppercase max-w-full truncate ${
          isTeamA ? 'text-dark-teal' : 'text-poster-ink'
        }`}
      >
        {lastName}
      </p>
    </div>
  );
}

/**
 * VS badge centered at (960, 600): 224px ring with 3px #FEECD6 at 50%, 176px #FEECD6 disc,
 * and "VS" in Outfit Black 76/80 #084B46.
 */
export function VsBadge() {
  return (
    <div
      className="absolute left-[848px] top-[488px] w-[224px] h-[224px] z-40 flex items-center justify-center pointer-events-none"
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-full border-[3px] border-cream/50" />
      <div className="w-[176px] h-[176px] rounded-full bg-cream flex items-center justify-center">
        <span className="font-outfit font-black text-[76px] leading-[80px] text-dark-teal">
          VS
        </span>
      </div>
    </div>
  );
}

/**
 * Bottom waiting status chip centered on x=960, top=978.
 */
export function StatusChip({ label = 'Waiting for the umpire to start' }) {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 top-[978px] z-40 flex items-center gap-[16px] py-[18px] pl-[34px] pr-[40px] rounded-full bg-poster-stage/80 border-2 border-cream/35 whitespace-nowrap"
      role="status"
      aria-live="polite"
    >
      <span className="w-[16px] h-[16px] rounded-full bg-cream shrink-0" />
      <p className="font-outfit font-medium text-[30px] leading-[38px] text-off-white">
        {label}
      </p>
    </div>
  );
}

/**
 * Broadcast-style TV Standby Poster (1920x1080 design stage).
 * Coordinates ordered progressive frame preloading (all Frame 0 Idle cutouts first,
 * then extra motion frames 1..3 in spotlight order) and runs a 1-by-1 turn-taking
 * stop-motion spotlight (`A-front -> A-back -> B-front -> B-back`), skipping
 * empty or 1-photo slots and honoring `prefers-reduced-motion`.
 *
 * Props: `{ courtNumber, matchType, teamA: Player[], teamB: Player[] }`
 * where `Player = { id?, name, cutoutUrl?, cutoutUrls?: string[] }`.
 */
export default function StandbyPoster({
  courtNumber = 1,
  matchType = 'Doubles',
  teamA = [],
  teamB = [],
  className = '',
}) {
  const normalizedType = String(matchType || 'Doubles').trim();
  const isSingles = normalizedType.toLowerCase() === 'singles';
  const chipLabel =
    normalizedType.toLowerCase() === 'doubles'
      ? 'Doubles'
      : normalizedType.toLowerCase() === 'singles'
      ? 'Singles'
      : normalizedType;

  // Compact active players so first joined takes front slot, second takes back slot
  const activeTeamA = (Array.isArray(teamA) ? teamA : []).filter(
    (p) => p && String(p.name || '').trim()
  );
  const activeTeamB = (Array.isArray(teamB) ? teamB : []).filter(
    (p) => p && String(p.name || '').trim()
  );

  const frontA = activeTeamA[0] || null;
  const backA = isSingles ? null : activeTeamA[1] || null;
  const frontB = activeTeamB[0] || null;
  const backB = isSingles ? null : activeTeamB[1] || null;

  const activeOrder = useMemo(
    () => (isSingles ? ['A-front', 'B-front'] : STANDBY_SLOT_ORDER),
    [isSingles]
  );

  const slotPlayers = useMemo(
    () => ({
      'A-front': frontA,
      'A-back': backA,
      'B-front': frontB,
      'B-back': backB,
    }),
    [frontA, backA, frontB, backB]
  );

  const slotSignatures = useMemo(() => {
    const sig = {};
    for (const key of STANDBY_SLOT_ORDER) {
      const p = slotPlayers[key];
      const urls = Array.isArray(p?.cutoutUrls)
        ? p.cutoutUrls
        : p?.cutoutUrl
        ? [p.cutoutUrl]
        : [];
      const cleanUrls = urls
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim())
        .join(',');
      sig[key] = `${p?.name || ''}|${cleanUrls}`;
    }
    return sig;
  }, [slotPlayers]);

  const slotHasPrimaryUrl = useMemo(() => {
    const has = {};
    for (const key of STANDBY_SLOT_ORDER) {
      const p = slotPlayers[key];
      const urls = Array.isArray(p?.cutoutUrls)
        ? p.cutoutUrls
        : p?.cutoutUrl
        ? [p.cutoutUrl]
        : [];
      has[key] = Boolean(
        p && urls.some((u) => typeof u === 'string' && u.trim())
      );
    }
    return has;
  }, [slotPlayers]);

  const rosterKey = useMemo(
    () => activeOrder.map((k) => `${k}:${slotSignatures[k]}`).join('||'),
    [activeOrder, slotSignatures]
  );

  const [slotStatus, setSlotStatus] = useState({});
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [spotlight, setSpotlight] = useState({ activeSlot: null, frameIndex: 0 });
  const lastSpotlightSlotRef = useRef(null);

  // Sync reduced-motion media preference
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const onChange = (e) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const handleSlotReadyChange = useCallback(
    (slotKey, { signature, idleSettled, decodedCount }) => {
      setSlotStatus((prev) => {
        const cur = prev[slotKey];
        if (
          cur &&
          cur.signature === signature &&
          cur.idleSettled === idleSettled &&
          cur.decodedCount === decodedCount
        ) {
          return prev;
        }
        return {
          ...prev,
          [slotKey]: {
            signature,
            idleSettled,
            decodedCount,
            motionPreloaded:
              cur && cur.signature === signature ? Boolean(cur.motionPreloaded) : false,
          },
        };
      });
    },
    []
  );

  const handleMotionPreloadDone = useCallback((slotKey, signature) => {
    setSlotStatus((prev) => {
      const cur = prev[slotKey];
      if (cur && cur.signature === signature && cur.motionPreloaded) {
        return prev;
      }
      return {
        ...prev,
        [slotKey]: {
          signature,
          idleSettled: true,
          decodedCount:
            cur && cur.signature === signature ? cur.decodedCount || 0 : 0,
          motionPreloaded: true,
        },
      };
    });
  }, []);

  // Derive signature-verified status for every slot without parent/child effect races.
  // Slots without a primary cutout URL settle immediately so they never stall extra-frame preloads.
  const effectiveSlotStatus = useMemo(() => {
    const out = {};
    for (const key of STANDBY_SLOT_ORDER) {
      if (!slotHasPrimaryUrl[key]) {
        out[key] = {
          idleSettled: true,
          decodedCount: 0,
          motionPreloaded: true,
        };
      } else {
        const cur = slotStatus[key];
        out[key] =
          cur && cur.signature === slotSignatures[key]
            ? cur
            : {
                idleSettled: false,
                decodedCount: 0,
                motionPreloaded: false,
              };
      }
    }
    return out;
  }, [slotHasPrimaryUrl, slotStatus, slotSignatures]);

  const effectiveSlotStatusRef = useRef({});
  effectiveSlotStatusRef.current = effectiveSlotStatus;

  // Gate extra motion frame downloads: wait until ALL Frame 0 idle cutouts settle,
  // then unlock extra frames strictly in turn order (A-front -> A-back -> B-front -> B-back).
  const preloadGrantIdx = useMemo(() => {
    const allIdleDone = activeOrder.every(
      (k) => effectiveSlotStatus[k]?.idleSettled
    );
    if (!allIdleDone) return -1;
    const firstPending = activeOrder.findIndex(
      (k) => !effectiveSlotStatus[k]?.motionPreloaded
    );
    return firstPending === -1 ? activeOrder.length - 1 : firstPending;
  }, [activeOrder, effectiveSlotStatus]);

  const eligibleSlots = useMemo(
    () =>
      activeOrder.filter(
        (k) => (effectiveSlotStatus[k]?.decodedCount || 0) >= 2
      ),
    [activeOrder, effectiveSlotStatus]
  );

  const eligibleSlotsRef = useRef([]);
  eligibleSlotsRef.current = eligibleSlots;
  const hasEligibleMotion = eligibleSlots.length > 0;

  // 1-by-1 sequential turn-taking stop-motion coordinator
  useEffect(() => {
    if (prefersReducedMotion || !hasEligibleMotion) {
      setSpotlight({ activeSlot: null, frameIndex: 0 });
      return undefined;
    }

    let cancelled = false;
    let timerId = null;

    const stepBurst = (slotKey, frameIdx, totalFrames) => {
      if (cancelled) return;
      setSpotlight({ activeSlot: slotKey, frameIndex: frameIdx });

      timerId = window.setTimeout(() => {
        if (cancelled) return;
        if (frameIdx + 1 < totalFrames) {
          stepBurst(slotKey, frameIdx + 1, totalFrames);
        } else {
          // Return to Idle Frame 0 and hold before starting next eligible player
          runPauseThenNext(MOTION_INTER_PLAYER_PAUSE_MS);
        }
      }, MOTION_FRAME_INTERVAL_MS);
    };

    const runPauseThenNext = (delayMs) => {
      if (cancelled) return;
      setSpotlight({ activeSlot: null, frameIndex: 0 });

      timerId = window.setTimeout(() => {
        if (cancelled) return;
        const currentEligible = eligibleSlotsRef.current;
        const nextSlot = getNextSpotlightSlot(
          lastSpotlightSlotRef.current,
          currentEligible
        );
        if (!nextSlot) return;

        lastSpotlightSlotRef.current = nextSlot;
        const totalFrames =
          effectiveSlotStatusRef.current[nextSlot]?.decodedCount || 0;
        if (totalFrames < 2) {
          runPauseThenNext(MOTION_INTER_PLAYER_PAUSE_MS);
          return;
        }
        stepBurst(nextSlot, 1, totalFrames);
      }, delayMs);
    };

    // Initial breath so the 400ms entrance animation settles cleanly before Player 1 moves
    runPauseThenNext(650);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [prefersReducedMotion, hasEligibleMotion, rosterKey]);

  const getSlotProps = (slotKey) => {
    const orderIdx = activeOrder.indexOf(slotKey);
    const allowMotionPreload = orderIdx !== -1 && orderIdx <= preloadGrantIdx;
    const activeFrameIndex =
      spotlight.activeSlot === slotKey ? spotlight.frameIndex : 0;

    return {
      slotSignature: slotSignatures[slotKey],
      activeFrameIndex,
      allowMotionPreload,
      onSlotReadyChange: handleSlotReadyChange,
      onMotionPreloadDone: handleMotionPreloadDone,
    };
  };

  return (
    <PosterStage className={className}>
      {/* 1. Split Diagonal Background & Glows */}
      <PosterBackground />

      {/* 2. Top-left Wordmark */}
      <p className="absolute left-[64px] top-[46px] z-10 font-outfit font-semibold text-[32px] leading-[40px] text-off-white/[0.92] whitespace-nowrap">
        PikolScore
      </p>

      {/* 3. Top-center Match-Type Chip */}
      <div className="absolute left-1/2 -translate-x-1/2 top-[40px] z-10 px-[36px] py-[12px] rounded-full bg-poster-stage/60 border-2 border-cream/50 flex items-center justify-center">
        <p className="font-outfit font-semibold text-[30px] leading-[38px] tracking-[0.03em] text-cream whitespace-nowrap">
          {chipLabel}
        </p>
      </div>

      {/* 4. Giant Court Headline (sits behind players so heads overlap the bottom of the letters) */}
      <h1 className="absolute left-1/2 -translate-x-1/2 top-[78px] z-10 font-outfit font-black text-[340px] leading-[340px] tracking-[-0.02em] text-off-white whitespace-nowrap m-0 pointer-events-none">
        COURT {courtNumber || 1}
      </h1>

      {/* 5. Player Avatar Slots (stack order: back players first, then front players) */}
      {!isSingles && (
        <PlayerSlot
          team="A"
          position="back"
          player={backA}
          {...getSlotProps('A-back')}
        />
      )}
      {!isSingles && (
        <PlayerSlot
          team="B"
          position="back"
          player={backB}
          {...getSlotProps('B-back')}
        />
      )}
      <PlayerSlot
        team="A"
        position="front"
        player={frontA}
        {...getSlotProps('A-front')}
      />
      <PlayerSlot
        team="B"
        position="front"
        player={frontB}
        {...getSlotProps('B-front')}
      />

      {/* 6. Player Name Pills */}
      <NamePill team="A" position="front" player={frontA} />
      {!isSingles && <NamePill team="A" position="back" player={backA} />}
      <NamePill team="B" position="front" player={frontB} />
      {!isSingles && <NamePill team="B" position="back" player={backB} />}

      {/* 7. Center VS Badge */}
      <VsBadge />

      {/* 8. Bottom Waiting Status Chip */}
      <StatusChip />
    </PosterStage>
  );
}
