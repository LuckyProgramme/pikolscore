'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Tv, QrCode, RefreshCw, Loader2 } from 'lucide-react';
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

  // Navigate TV to /screen?court=<courtNumber> when umpire pairs this TV code
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

  // Initialize or load persistent TV pairing device ID
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let storedTvId = normalizeTvId(window.localStorage.getItem(TV_ID_STORAGE_KEY));
    if (!storedTvId || storedTvId.length > 12) {
      storedTvId = generateTvId();
      window.localStorage.setItem(TV_ID_STORAGE_KEY, storedTvId);
    }
    setTvId(storedTvId);
  }, []);

  // Generate QR Code SVG for the TV Pairing Panel
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
        margin: 1,
        color: {
          dark: '#084B46',
          light: '#FEFEFB',
        },
      },
      (err, svg) => {
        if (!err && isMounted) {
          setTvQrSvg(svg);
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, [tvPairingUrl]);

  // Listen in real-time on /umpire so scanning the QR code with an umpire phone auto-detects the court and projects it
  useEffect(() => {
    if (!tvId) return;

    let isMounted = true;

    // 1. Check if this tvId was already paired to an active match_session
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

    // 2. Subscribe to Supabase Realtime broadcast channel `tv_pairing:<tvId>`
    const pairChannel = supabase
      .channel(`tv_pairing:${tvId}`)
      .on('broadcast', { event: 'paired' }, (msg) => {
        const targetCourt = Number(msg?.payload?.courtNumber);
        if (targetCourt >= 1 && targetCourt <= 4) {
          routeTvToCourt(targetCourt);
        }
      })
      .subscribe();

    // 3. Subscribe to postgres_changes on match_sessions as reliable DB fallback
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
    const freshId = generateTvId();
    setTvId(freshId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TV_ID_STORAGE_KEY, freshId);
    }
  };

  const shortTvCode = getShortTvCode(tvId);

  return (
    <aside
      className="relative hidden min-[900px]:flex flex-col justify-between items-center overflow-hidden bg-ivory px-10 py-10"
      aria-label="Courtside TV Projection QR"
    >
      {/* Top Right Status Pill */}
      <div className="w-full flex items-center justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-pale-sage px-3.5 py-1.5 text-xs font-bold text-teal border border-teal/20">
          <Tv size={14} />
          <span>TV Auto-Projection Ready</span>
        </span>
      </div>

      {/* Centered Courtside TV Screen Card */}
      <div className="my-auto w-full max-w-[420px] rounded-3xl bg-[#084B46] text-[#FEFEFB] p-6 sm:p-8 border-2 border-[#0F5C62] flex flex-col justify-between items-center text-center shadow-lg">
        <div className="w-full flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0F5C62] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#FEECD6] border border-[#FEECD6]/20">
            <Tv size={13} />
            <span>Courtside TV Screen</span>
          </span>
          <button
            type="button"
            onClick={handleRefreshTvCode}
            title="Generate a new TV pairing code"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#EAF0E5]/80 hover:text-[#FEECD6] bg-transparent border-0 cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="my-5 flex flex-col items-center">
          <div className="bg-white p-3.5 rounded-2xl border-2 border-[#FEECD6]/30 shadow-md">
            {tvQrSvg ? (
              <div
                className="w-48 h-48 sm:w-52 sm:h-52 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: tvQrSvg }}
              />
            ) : (
              <div className="w-48 h-48 sm:w-52 sm:h-52 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-[#0F5C62]" />
              </div>
            )}
          </div>

          <div className="mt-3.5 inline-flex items-center gap-2 rounded-xl bg-[#0F5C62] px-3.5 py-1.5 border border-[#FEECD6]/20">
            <QrCode size={14} className="text-[#FEECD6]" />
            <span className="text-[11px] uppercase font-bold tracking-wider text-[#EAF0E5]">
              TV Code:
            </span>
            <span className="font-mono text-sm font-black tracking-widest text-[#FEECD6]">
              {shortTvCode || '------'}
            </span>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-extrabold text-white m-0 mb-1">
            Scan with Umpire Phone to Project
          </h2>
          <p className="text-xs text-[#EAF0E5]/85 m-0 leading-relaxed">
            Umpires can tap <strong>&ldquo;Project to Screen&rdquo;</strong> on their court or scan this QR code to automatically project their court&apos;s lobby and live scoreboard here.
          </p>
        </div>
      </div>

      <div className="h-4" aria-hidden="true" />
    </aside>
  );
}

export default CourtPanel;
