'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '@/config/supabase';
import {
  TV_ID_STORAGE_KEY,
  PAIRED_COURT_STORAGE_KEY,
  generateTvId,
  getShortTvCode,
  normalizeTvId,
} from '@/lib/tv-pairing';
import { getSynth } from '@/lib/audio';

function getCourtNumber(row) {
  return Number(row?.court_number || row?.player_names?.courtNumber) || null;
}

export function CourtPanel() {
  const router = useRouter();
  const [tvId, setTvId] = useState('');
  const [tvQrSvg, setTvQrSvg] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const routeTvToCourt = useCallback(
    (courtNumber) => {
      const cNum = Number(courtNumber);
      if (!cNum || cNum < 1 || cNum > 4) return;
      getSynth()?.armed();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PAIRED_COURT_STORAGE_KEY, String(cNum));
      }
      router.replace(`/screen?court=${encodeURIComponent(cNum)}`);
    },
    [router]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let storedTvId = normalizeTvId(window.localStorage.getItem(TV_ID_STORAGE_KEY));
    if (!storedTvId || storedTvId.length > 12) {
      storedTvId = generateTvId();
      window.localStorage.setItem(TV_ID_STORAGE_KEY, storedTvId);
    }
    setTvId(storedTvId);
  }, []);

  const tvPairingUrl = useMemo(() => {
    if (typeof window === 'undefined' || !tvId) return '';
    return `${window.location.origin}/?tv=${encodeURIComponent(tvId)}`;
  }, [tvId]);

  useEffect(() => {
    if (!tvPairingUrl) return;
    let isMounted = true;

    QRCode.toString(
      tvPairingUrl,
      {
        type: 'svg',
        margin: 0,
        color: {
          dark: '#084B46',
          light: '#FEFEFB',
        },
      },
      (err, svg) => {
        if (!err && isMounted) {
          setTvQrSvg(svg);
          setIsRefreshing(false);
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, [tvPairingUrl]);

  useEffect(() => {
    if (!tvId) return;
    let isMounted = true;

    async function checkExistingTvPairing() {
      try {
        const { data } = await supabase
          .from('match_sessions')
          .select('id, court_number, player_names, status')
          .eq('status', 'in_progress');

        if (!isMounted || !Array.isArray(data)) return;
        for (const row of data) {
          const tvIds = row?.player_names?.pairedTvIds;
          if (
            Array.isArray(tvIds) &&
            tvIds.some((id) => normalizeTvId(id) === normalizeTvId(tvId))
          ) {
            const cNum = getCourtNumber(row);
            if (cNum >= 1 && cNum <= 4) {
              routeTvToCourt(cNum);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('[/umpire] Error checking existing TV pairing:', err);
      }
    }

    checkExistingTvPairing();

    const pairChannel = supabase
      .channel(`tv_pairing:${tvId}`)
      .on('broadcast', { event: 'paired' }, (msg) => {
        const targetCourt = Number(msg?.payload?.courtNumber);
        if (targetCourt >= 1 && targetCourt <= 4) {
          routeTvToCourt(targetCourt);
        }
      })
      .subscribe();

    const dbChannel = supabase
      .channel(`umpire_tv_db_${tvId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_sessions' },
        (payload) => {
          const newRow = payload?.new;
          if (!newRow || newRow.status !== 'in_progress') return;
          const tvIds = newRow?.player_names?.pairedTvIds;
          if (
            Array.isArray(tvIds) &&
            tvIds.some((id) => normalizeTvId(id) === normalizeTvId(tvId))
          ) {
            const cNum = getCourtNumber(newRow);
            if (cNum >= 1 && cNum <= 4) {
              routeTvToCourt(cNum);
            }
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(pairChannel);
      supabase.removeChannel(dbChannel);
    };
  }, [tvId, routeTvToCourt]);

  const handleRefreshTvCode = () => {
    setIsRefreshing(true);
    const freshId = generateTvId();
    setTvId(freshId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TV_ID_STORAGE_KEY, freshId);
    }
  };

  const shortTvCode = getShortTvCode(tvId);

  return (
    <aside
      className="hidden lg:flex flex-col bg-[#203F39] p-10 text-[#FAF9F5] relative overflow-hidden"
      aria-label="Courtside TV pairing"
    >
      {/* Faint court illustration away from text */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 45 572 340"
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-10 w-[460px] max-w-none h-auto opacity-[0.08]"
      >
        <g>
          <polygon points="15,238 262,58 540,203 290,383" fill="#c3d0c6" transform="translate(0, 12)" />
          <polygon points="15,238 262,58 540,203 290,383" fill="#8A9B82" />
          <polygon points="55,232 265,80 500,203 290,357" fill="#26705f" />
          <polygon points="155,160 395,280 385,285 145,165" fill="#5a9985" />
          <g stroke="#f1e8cf" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="55,232 265,80 500,203 290,357" fill="none" />
            <line x1="197" y1="129" x2="432" y2="253" />
            <line x1="123" y1="183" x2="358" y2="307" />
            <line x1="314.5" y1="191" x2="382.5" y2="141.5" />
            <line x1="240.5" y1="245" x2="172.5" y2="294.5" />
          </g>
        </g>
      </svg>

      {/* One vertically centered column: QR tile → gap-6 → code row → gap-8 → subheading → gap-5 → steps */}
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center text-center">
        {/* 2. Bigger QR code tile (w-full max-w-[280px] aspect-square rounded-3xl bg-[#FEFEFB] p-5) */}
        <div
          role="img"
          aria-label="QR code to project to this screen"
          className="w-full max-w-[280px] aspect-square rounded-3xl bg-[#FEFEFB] p-5 grid place-items-center"
        >
          {tvQrSvg && !isRefreshing ? (
            <div
              className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:object-contain"
              dangerouslySetInnerHTML={{ __html: tvQrSvg }}
            />
          ) : (
            <Loader2 size={32} className="animate-spin text-[#0F5C62]" aria-hidden="true" />
          )}
        </div>

        {/* 3. Stacked TV code chip + 48px Refresh icon button (gap-6 below QR tile) */}
        <div className="mt-6 flex items-center gap-3 justify-center">
          <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-[#FAF9F5]/10 px-6 py-3">
            <span className="text-sm font-medium text-[#EAF0E5]/80">TV code</span>
            <span className="text-3xl font-semibold tracking-[0.18em] pl-[0.18em] text-[#FEFEFB] tabular-nums select-all whitespace-nowrap">
              {isRefreshing ? '••••••' : shortTvCode || '------'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleRefreshTvCode}
            disabled={isRefreshing}
            aria-label="Refresh TV code"
            title="Refresh TV code"
            className="size-12 shrink-0 rounded-full bg-[#FAF9F5]/10 text-[#FAF9F5] hover:bg-[#FAF9F5]/20 border-0 grid place-items-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FAF9F5]/60"
          >
            <RefreshCw
              size={20}
              className={isRefreshing ? 'animate-spin' : ''}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* 4. Subheading (gap-8 below code row) */}
        <h2 className="mt-8 text-2xl xl:text-3xl font-semibold leading-tight text-[#FAF9F5] text-center text-balance">
          Scan to connect your device
        </h2>

        {/* 5. Steps (gap-5 below subheading, left-aligned inside w-fit mx-auto) */}
        <ol className="mt-5 p-0 list-none flex flex-col gap-3 w-fit mx-auto text-left">
          <li className="flex items-center gap-3 text-base xl:text-lg text-[#FAF9F5]">
            <span className="size-8 shrink-0 text-base font-semibold rounded-full bg-[#FAF9F5]/10 text-[#FAF9F5] grid place-items-center">
              1
            </span>
            <span>Claim an available court</span>
          </li>
          <li className="flex items-center gap-3 text-base xl:text-lg text-[#FAF9F5]">
            <span className="size-8 shrink-0 text-base font-semibold rounded-full bg-[#FAF9F5]/10 text-[#FAF9F5] grid place-items-center">
              2
            </span>
            <span>Scan the QR or enter the TV code to project</span>
          </li>
        </ol>
      </div>
    </aside>
  );
}

export default CourtPanel;
