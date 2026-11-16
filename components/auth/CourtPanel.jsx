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
import AmbientCourtMotif from '@/components/ui/AmbientCourtMotif';

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
          dark: '#021024',
          light: '#FFFFFF',
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
      className="hidden lg:flex flex-col items-center justify-center bg-[#07192B] border-l border-[#11263C] p-10 text-[#FFFFFF] relative overflow-hidden"
      aria-label="Courtside TV pairing"
    >
      <AmbientCourtMotif variant="full" opacity={0.7} />

      {/* Elevated #0B2239 Signature Pairing Card (2px #00E5B8 top highlight) */}
      <div className="relative z-10 w-full max-w-[450px] rounded-[20px] bg-[#0B2239] border border-[#24425E] dv-top-accent p-7 flex flex-col items-center text-center shadow-2xl">
        <span className="dv-overline mb-2">COURTSIDE TV PROJECTION</span>
        <h2 className="dv-display text-[32px] leading-[1.06] text-[#FFFFFF] m-0 mb-6">
          SCAN TO PAIR SCREEN
        </h2>

        {/* Crisp White QR Tile */}
        <div
          role="img"
          aria-label="QR code to project to this screen"
          className="w-[240px] h-[240px] rounded-[14px] bg-[#FFFFFF] border border-[#24425E] p-3.5 grid place-items-center"
        >
          {tvQrSvg && !isRefreshing ? (
            <div
              className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:object-contain"
              dangerouslySetInnerHTML={{ __html: tvQrSvg }}
            />
          ) : (
            <Loader2 size={32} className="animate-spin text-[#00E5B8]" aria-hidden="true" />
          )}
        </div>

        {/* Stacked TV Code Chip + 44px Refresh Icon Button */}
        <div className="mt-5 flex items-center gap-3 justify-center">
          <div className="flex flex-col items-center justify-center rounded-[12px] bg-[#07192B] border border-[#24425E] px-6 py-2.5 min-w-[198px]">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6C87A3]">
              TV CODE
            </span>
            <span className="font-mono text-[24px] font-bold tracking-[0.18em] pl-[0.18em] text-[#00E5B8] tabular-nums select-all whitespace-nowrap leading-tight">
              {isRefreshing ? '••••••' : shortTvCode || '------'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleRefreshTvCode}
            disabled={isRefreshing}
            aria-label="Refresh TV code"
            title="Refresh TV code"
            className="size-[44px] shrink-0 rounded-[12px] bg-[#07192B] border border-[#24425E] text-[#FFFFFF] hover:border-[#00E5B8] hover:text-[#00E5B8] grid place-items-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5B8]"
          >
            <RefreshCw
              size={18}
              className={isRefreshing ? 'animate-spin' : ''}
              aria-hidden="true"
            />
          </button>
        </div>

        <h3 className="mt-6 text-[18px] font-bold text-[#FFFFFF] m-0">
          Scan to connect your device
        </h3>

        <ol className="mt-4 p-0 list-none flex flex-col gap-3 w-full max-w-[330px] text-left">
          <li className="flex items-center gap-3 text-[14.5px] text-[#B0C4D8]">
            <span className="size-7 shrink-0 text-[13px] font-bold rounded-full bg-[#07192B] border border-[#00E5B8] text-[#00E5B8] grid place-items-center">
              1
            </span>
            <span>Claim an available court on /matches</span>
          </li>
          <li className="flex items-center gap-3 text-[14.5px] text-[#B0C4D8]">
            <span className="size-7 shrink-0 text-[13px] font-bold rounded-full bg-[#07192B] border border-[#00E5B8] text-[#00E5B8] grid place-items-center">
              2
            </span>
            <span>Scan QR or enter TV code to project</span>
          </li>
        </ol>

        <p className="mt-5 text-[12.5px] text-[#6C87A3] m-0">
          Auto-switches to Standby Poster when paired
        </p>
      </div>
    </aside>
  );
}

export default CourtPanel;
