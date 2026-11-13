'use client';

import { useState, useEffect, useId } from 'react';
import { splitPlayerName, getPlayerInitials } from '@/lib/standby-poster';

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
 * Renders one player avatar slot (front or back for Team A or Team B).
 * Preloads and decodes new cutout images before revealing them with a 400ms rise-and-fade
 * entrance (respecting prefers-reduced-motion). Falls back to the placeholder silhouette +
 * team-colored initials badge while decoding, when no cutout exists, or if loading fails.
 */
export function PlayerSlot({ team = 'A', position = 'front', player = null }) {
  const [imageState, setImageState] = useState({
    readyUrl: null,
    failedUrl: null,
  });

  const slotKey = `${team}-${position}`;
  const layoutClass = SLOT_LAYOUT[slotKey] || SLOT_LAYOUT['A-front'];

  const playerName = player?.name ? String(player.name).trim() : '';
  const hasPlayer = Boolean(playerName);
  const cutoutUrl =
    hasPlayer && player?.cutoutUrl ? String(player.cutoutUrl).trim() : null;

  useEffect(() => {
    if (!cutoutUrl || typeof window === 'undefined') {
      setImageState({ readyUrl: null, failedUrl: null });
      return undefined;
    }

    let cancelled = false;
    setImageState((prev) => ({
      readyUrl: prev.readyUrl === cutoutUrl ? cutoutUrl : null,
      failedUrl: null,
    }));

    const img = new window.Image();
    img.decoding = 'async';

    const finalizeDecode = async () => {
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
        if (cancelled) return;
        if (img.naturalWidth > 0) {
          setImageState({ readyUrl: cutoutUrl, failedUrl: null });
        } else {
          setImageState({ readyUrl: null, failedUrl: cutoutUrl });
        }
      } catch {
        if (cancelled) return;
        if (img.complete && img.naturalWidth > 0) {
          setImageState({ readyUrl: cutoutUrl, failedUrl: null });
        } else {
          setImageState({ readyUrl: null, failedUrl: cutoutUrl });
        }
      }
    };

    img.onload = finalizeDecode;
    img.onerror = () => {
      if (!cancelled) {
        setImageState({ readyUrl: null, failedUrl: cutoutUrl });
      }
    };
    img.src = cutoutUrl;

    if (img.complete && img.naturalWidth > 0) {
      finalizeDecode();
    }

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [cutoutUrl]);

  const isDecoded = Boolean(
    cutoutUrl &&
      imageState.readyUrl === cutoutUrl &&
      imageState.failedUrl !== cutoutUrl
  );
  const isFront = position === 'front';
  const isTeamA = team === 'A';

  return (
    <div
      className={`absolute ${layoutClass} pointer-events-none select-none`}
      data-slot={slotKey}
    >
      {hasPlayer && isDecoded ? (
        <img
          key={`${playerName}-${cutoutUrl}`}
          src={cutoutUrl}
          alt={playerName}
          onError={() => setImageState({ readyUrl: null, failedUrl: cutoutUrl })}
          className="w-full h-full object-contain object-bottom block animate-poster-enter motion-reduce:animate-none"
          style={BOTTOM_FADE_MASK}
        />
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
 * Props: `{ courtNumber, matchType, teamA: Player[], teamB: Player[] }`
 * where `Player = { name, cutoutUrl }`.
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
  const backA = activeTeamA[1] || null;
  const frontB = activeTeamB[0] || null;
  const backB = activeTeamB[1] || null;

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
      {!isSingles && <PlayerSlot team="A" position="back" player={backA} />}
      {!isSingles && <PlayerSlot team="B" position="back" player={backB} />}
      <PlayerSlot team="A" position="front" player={frontA} />
      <PlayerSlot team="B" position="front" player={frontB} />

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
