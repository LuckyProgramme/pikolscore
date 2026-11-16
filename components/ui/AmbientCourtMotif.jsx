'use client';

import { useId, useMemo } from 'react';

const BALL_HOLES = [
  [-0.48, -0.35, 0.11],
  [-0.12, -0.52, 0.11],
  [0.28, -0.45, 0.1],
  [-0.55, 0.08, 0.11],
  [-0.14, -0.05, 0.12],
  [0.28, -0.02, 0.11],
  [-0.38, 0.46, 0.1],
  [0.06, 0.38, 0.11],
];

const SPARKLES = [
  [-1.4, -0.3, 2.2],
  [-1.25, -0.6, 1.8],
  [-1.55, 0.1, 1.5],
  [-1.1, -0.9, 2.0],
  [-0.85, -1.15, 1.8],
  [-1.32, 0.35, 2.4],
];

/**
 * Bottom-right ambient halftone pickleball (#C5E832) + cyan court-arc motif (#00E5B8).
 * Use variant="full" on /umpire, /matches, and TV standby; variant="glow" on live scoreboards.
 */
export function AmbientCourtMotif({
  variant = 'full',
  className = '',
  opacity = 0.65,
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const glowId = `dv-ambient-glow-${uid}`;
  const ballGradId = `dv-ball-grad-${uid}`;
  const ballClipId = `dv-ball-clip-${uid}`;

  const cx = 415;
  const cy = 415;
  const ballR = 175;

  const halftoneDots = useMemo(() => {
    const dots = [];
    const step = 15;
    for (let dy = -ballR; dy <= ballR; dy += step) {
      for (let dx = -ballR; dx <= ballR; dx += step) {
        if (dx * dx + dy * dy <= ballR * ballR) {
          const light = Math.max(0, Math.min(1, 0.55 + (dx - dy) / (ballR * 2.4)));
          dots.push({
            cx: cx + dx,
            cy: cy + dy,
            r: Number((1.2 + light * 2.8).toFixed(1)),
            light: light > 0.45,
          });
        }
      }
    }
    return dots;
  }, []);

  if (variant === 'glow') {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 overflow-hidden select-none ${className}`.trim()}
      >
        <div
          className="absolute left-1/2 top-[28%] h-[680px] w-[960px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.08]"
          style={{
            background:
              'radial-gradient(circle, #00E5B8 0%, rgba(0, 229, 184, 0.12) 45%, transparent 72%)',
          }}
        />
      </div>
    );
  }

  return (
    <svg
      viewBox="0 0 560 560"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ opacity }}
      className={`pointer-events-none absolute bottom-0 right-0 w-[340px] sm:w-[440px] lg:w-[520px] h-auto select-none ${className}`.trim()}
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00E5B8" stopOpacity="0.24" />
          <stop offset="55%" stopColor="#C5E832" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#021024" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ballGradId} cx="70%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#D7F34A" />
          <stop offset="52%" stopColor="#C5E832" />
          <stop offset="100%" stopColor="#2E4A16" />
        </radialGradient>
        <clipPath id={ballClipId}>
          <circle cx={cx} cy={cy} r={ballR} />
        </clipPath>
      </defs>

      <circle cx={cx - 40} cy={cy - 30} r={ballR * 1.9} fill={`url(#${glowId})`} />

      {/* Sweeping court arcs */}
      <path
        d={`M 0 505 Q ${cx - 180} ${cy + 55} 580 ${cy + 145}`}
        stroke="#00E5B8"
        strokeWidth="5"
        strokeOpacity="0.35"
      />
      <path
        d={`M ${cx - ballR * 1.45} ${cy + 20} A ${ballR * 1.35} ${ballR * 1.35} 0 0 1 ${cx + 40} ${cy - ballR * 1.5}`}
        stroke="#00E5B8"
        strokeWidth="2"
        strokeOpacity="0.45"
      />
      <path
        d={`M ${cx - ballR * 1.75} ${cy + 70} A ${ballR * 1.65} ${ballR * 1.65} 0 0 1 ${cx + 90} ${cy - ballR * 1.75}`}
        stroke="#00E5B8"
        strokeWidth="1.2"
        strokeDasharray="4 8"
        strokeOpacity="0.5"
      />

      {/* Halftone pickleball */}
      <circle cx={cx} cy={cy} r={ballR} fill={`url(#${ballGradId})`} fillOpacity="0.72" />
      <g clipPath={`url(#${ballClipId})`}>
        {halftoneDots.map((dot, idx) => (
          <circle
            key={idx}
            cx={dot.cx}
            cy={dot.cy}
            r={dot.r}
            fill={dot.light ? '#C5E832' : '#07192B'}
            fillOpacity={dot.light ? 0.55 : 0.45}
          />
        ))}
        {BALL_HOLES.map(([hx, hy, hr], idx) => (
          <circle
            key={`hole-${idx}`}
            cx={cx + hx * ballR}
            cy={cy + hy * ballR}
            r={hr * ballR}
            fill="#031223"
            stroke="#7E9622"
            strokeWidth="1.5"
          />
        ))}
      </g>

      {SPARKLES.map(([sx, sy, sr], idx) => (
        <circle
          key={`sp-${idx}`}
          cx={cx + sx * ballR}
          cy={cy + sy * ballR}
          r={sr}
          fill="#00E5B8"
          fillOpacity="0.7"
        />
      ))}
    </svg>
  );
}

export default AmbientCourtMotif;
