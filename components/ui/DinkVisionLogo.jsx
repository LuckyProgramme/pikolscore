'use client';

/**
 * DinkVision brand wordmark and perforated pickleball trajectory icon.
 * Matches the 104x28 design-system header specification with scalable sizing.
 */
export function DinkVisionLogo({ size = 'md', className = '' }) {
  const dims =
    size === 'lg'
      ? { w: 148, h: 40 }
      : size === 'sm'
      ? { w: 96, h: 26 }
      : { w: 108, h: 30 };

  return (
    <span className={`inline-flex items-center select-none shrink-0 ${className}`.trim()}>
      <svg
        width={dims.w}
        height={dims.h}
        viewBox="0 0 112 30"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="DinkVision"
      >
        {/* Dynamic trajectory swoop */}
        <path
          d="M 19 10 Q 41 -0.5 64 3.5 Q 45 3.5 19 10 Z"
          fill="#00E5B8"
        />
        {/* Perforated pickleball */}
        <circle cx="71.5" cy="5.8" r="5.2" fill="#00E5B8" />
        <circle cx="71.5" cy="5.8" r="1.15" fill="#021024" />
        <circle cx="69.2" cy="4.1" r="0.95" fill="#021024" />
        <circle cx="73.8" cy="4.1" r="0.95" fill="#021024" />
        <circle cx="69.2" cy="7.5" r="0.95" fill="#021024" />
        <circle cx="73.8" cy="7.5" r="0.95" fill="#021024" />
        {/* Wordmark */}
        <text
          x="0"
          y="25.5"
          fontFamily="var(--font-sans), Plus Jakarta Sans, sans-serif"
          fontSize="20"
          fontWeight="800"
          letterSpacing="-0.6"
          fill="#FFFFFF"
        >
          Dink
        </text>
        <text
          x="44"
          y="25.5"
          fontFamily="var(--font-sans), Plus Jakarta Sans, sans-serif"
          fontSize="20"
          fontWeight="800"
          letterSpacing="-0.6"
          fill="#00E5B8"
        >
          Vision
        </text>
      </svg>
    </span>
  );
}

export default DinkVisionLogo;
