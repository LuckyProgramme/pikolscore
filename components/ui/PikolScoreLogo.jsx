'use client';

/**
 * PikolScore brand mark and two-tone wordmark.
 * Features the perforated lime pickleball icon alongside condensed italic PIKOLSCORE typography.
 */
export function PikolScoreLogo({
  size = 'md',
  variant = 'dark',
  className = '',
}) {
  const scale =
    size === 'lg'
      ? { ball: 38, font: 'text-[33px]', gap: 'gap-[12px]' }
      : size === 'sm'
      ? { ball: 24, font: 'text-[20px]', gap: 'gap-[8px]' }
      : { ball: 28, font: 'text-[24px]', gap: 'gap-[9px]' };

  const isLight = variant === 'light';
  const pikolColor = isLight ? '#084B46' : '#FFFFFF';
  const scoreColor = isLight ? '#169E8E' : '#6DCBBC';

  return (
    <span
      role="img"
      aria-label="PikolScore"
      className={`inline-flex items-center select-none shrink-0 ${scale.gap} ${className}`.trim()}
    >
      <svg
        width={scale.ball}
        height={scale.ball}
        viewBox="0 0 46 46"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="23" cy="23" r="22.5" fill="#B6C34D" />
        <circle cx="15.5" cy="15.5" r="4.1" fill="#0A1B33" />
        <circle cx="30.8" cy="17.2" r="4.1" fill="#0A1B33" />
        <circle cx="22.7" cy="30.2" r="4.1" fill="#0A1B33" />
      </svg>

      <span
        aria-hidden="true"
        className={`font-sans font-black italic uppercase leading-none tracking-[-0.02em] whitespace-nowrap pr-[2px] ${scale.font}`}
      >
        <span style={{ color: pikolColor }}>PIKOL</span>
        <span style={{ color: scoreColor }}>SCORE</span>
      </span>
    </span>
  );
}

export default PikolScoreLogo;
