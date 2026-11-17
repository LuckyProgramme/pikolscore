'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Tv,
  X,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  QrCode,
} from 'lucide-react';
import jsQR from 'jsqr';
import { pairTvWithCourt, normalizeTvId } from '@/lib/tv-pairing';
import { getSynth } from '@/lib/audio';

export function ProjectToScreenModal({
  isOpen,
  onClose,
  courtNumber,
  sessionId,
  onPaired,
}) {
  const [manualCode, setManualCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [cameraState, setCameraState] = useState('idle'); // 'idle' | 'starting' | 'active' | 'denied'

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const scanLockRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const executePairing = useCallback(
    async (rawTvInput) => {
      if (scanLockRef.current || !courtNumber) return;
      const normalized = normalizeTvId(rawTvInput);
      if (!normalized || normalized.length < 5) {
        setErrorMessage('Invalid TV QR code or pairing code. Please try again.');
        return;
      }

      scanLockRef.current = true;
      setErrorMessage('');
      setIsSubmitting(true);

      try {
        const res = await pairTvWithCourt({
          tvId: normalized,
          courtNumber,
          sessionId,
        });
        getSynth()?.armed();
        stopCamera();
        setSuccessMessage(`Court ${courtNumber} is now projected to the TV screen!`);
        if (onPaired) {
          onPaired(courtNumber, res?.session || null);
        }
        setTimeout(() => {
          onClose?.();
        }, 900);
      } catch (err) {
        scanLockRef.current = false;
        setErrorMessage(err.message || 'Failed to pair TV screen.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [courtNumber, sessionId, onPaired, onClose, stopCamera]
  );

  // Start camera & QR scanning loop when modal opens
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setManualCode('');
      setErrorMessage('');
      setSuccessMessage('');
      setCameraState('idle');
      scanLockRef.current = false;
      return;
    }

    let isMounted = true;
    scanLockRef.current = false;

    async function startScanner() {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        if (isMounted) setCameraState('denied');
        return;
      }

      setCameraState('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraState('active');

        let barcodeDetector = null;
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          try {
            barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
          } catch {
            barcodeDetector = null;
          }
        }

        const scanFrame = async () => {
          if (!isMounted || scanLockRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video && video.readyState >= 2) {
            if (barcodeDetector) {
              try {
                const codes = await barcodeDetector.detect(video);
                if (codes && codes.length > 0 && codes[0].rawValue) {
                  executePairing(codes[0].rawValue);
                  return;
                }
              } catch {
                // Fallback to jsQR canvas decode below
              }
            }

            if (canvas && video.videoWidth > 0 && video.videoHeight > 0) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const qr = jsQR(imgData.data, imgData.width, imgData.height, {
                  inversionAttempts: 'dontInvert',
                });
                if (qr?.data) {
                  executePairing(qr.data);
                  return;
                }
              }
            }
          }

          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err) {
        console.warn('[ProjectToScreenModal] Camera access unavailable:', err);
        if (isMounted) setCameraState('denied');
      }
    }

    startScanner();

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen, executePairing, stopCamera]);

  if (!isOpen) return null;

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualCode.trim() || isSubmitting) return;
    executePairing(manualCode.trim());
  };

  const handleOpenInNewTab = () => {
    if (typeof window === 'undefined' || !courtNumber) return;
    window.open(
      `/screen?court=${encodeURIComponent(courtNumber)}`,
      '_blank',
      'noopener,noreferrer'
    );
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-[#021024]/75 backdrop-blur-[12px] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-screen-modal-title"
    >
      <div className="relative w-full max-w-[510px] bg-[#0B2239] rounded-[20px] border border-[#24425E] dv-top-accent shadow-2xl p-6 my-auto text-[#FFFFFF]">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 pb-3">
          <div>
            <span className="dv-overline block mb-2">
              COURT {courtNumber} · SCREEN PROJECTION
            </span>
            <h2
              id="project-screen-modal-title"
              className="dv-display text-[30px] leading-[1.08] text-[#FFFFFF] m-0"
            >
              PROJECT COURT {courtNumber} TO TV
            </h2>
            <p className="text-[15px] text-[#B0C4D8] m-0 mt-2">
              Point camera at the QR code on the TV screen (/umpire).
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] bg-[#07192B] border border-[#24425E] text-[#FFFFFF] hover:border-[#00E5B8] transition-colors cursor-pointer"
            aria-label="Close projection modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Status Messages */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-[10px] bg-[#07192B] border border-[#F47067] p-3 text-[13px] font-semibold text-[#F47067] flex items-center gap-2"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mb-4 rounded-[10px] bg-[#07192B] border border-[#00E5B8] p-3 text-[13px] font-bold text-[#00E5B8] flex items-center gap-2"
          >
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* 1. 16:10 Camera QR Scanner Box */}
        <div className="relative w-full aspect-[16/10] rounded-[14px] bg-[#030C18] border border-[#24425E] overflow-hidden flex items-center justify-center mt-2">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover ${
              cameraState === 'active' ? 'block' : 'hidden'
            }`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {cameraState === 'active' && (
            <>
              <div className="pointer-events-none absolute top-3.5 left-3.5 inline-flex items-center gap-2 rounded-full bg-[#0B2239]/90 border border-[#24425E] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#FFFFFF]">
                <span className="h-2 w-2 rounded-full bg-[#00E5B8]" />
                <span>SCANNER ACTIVE</span>
              </div>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-40 h-40 rounded-[14px] border-2 border-[#00E5B8] shadow-[0_0_0_9999px_rgba(2,16,36,0.45)]" />
              </div>
            </>
          )}

          {cameraState === 'starting' && (
            <div className="flex flex-col items-center gap-2.5 text-[#00E5B8] p-4 text-center">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-[13px] font-semibold text-[#B0C4D8]">
                Starting camera QR scanner...
              </span>
            </div>
          )}

          {cameraState === 'denied' && (
            <div className="flex flex-col items-center gap-2 text-[#B0C4D8] p-6 text-center">
              <QrCode size={32} className="text-[#00E5B8]" />
              <span className="text-[15px] font-bold text-[#FFFFFF]">
                Camera preview unavailable
              </span>
              <span className="text-[13px] text-[#B0C4D8] max-w-xs">
                Enter the 6-character TV Code shown below the QR on the TV&apos;s /umpire page, or scan with your native camera.
              </span>
            </div>
          )}
        </div>

        {/* 2. Manual 6-Character TV Code Input */}
        <form onSubmit={handleManualSubmit} className="mt-5">
          <label
            htmlFor="manual-tv-code"
            className="block text-[13px] font-bold uppercase tracking-[0.08em] text-[#D8E4F0] mb-2"
          >
            Or enter 6-character TV code
          </label>
          <div className="flex items-center gap-2">
            <input
              id="manual-tv-code"
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="e.g. A4F92C"
              maxLength={12}
              className="h-[52px] flex-1 min-w-0 rounded-[10px] bg-[#07192B] border border-[#24425E] px-4 text-[17px] font-mono font-bold uppercase tracking-widest text-[#FFFFFF] placeholder:text-[#6C87A3] outline-none focus:border-[#00E5B8]"
            />
            <button
              type="submit"
              disabled={!manualCode.trim() || isSubmitting}
              className="h-[52px] px-5 rounded-[10px] bg-[#00E5B8] hover:bg-[#05DFB4] text-[#031B28] text-[15px] font-bold transition-colors cursor-pointer border-0 disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Tv size={15} />
                  <span>Connect TV</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* 3. Direct Open in New Tab Option */}
        <div className="mt-5 pt-4 border-t border-[#11263C] flex flex-col gap-2.5">
          <span className="text-[13.5px] text-[#B0C4D8]">
            Using an external HDMI display?
          </span>
          <button
            type="button"
            onClick={handleOpenInNewTab}
            className="h-[54px] w-full inline-flex items-center justify-center gap-2 rounded-[12px] bg-[#07192B] hover:border-[#00E5B8] border border-[#24425E] text-[15px] font-bold text-[#FFFFFF] transition-colors cursor-pointer"
          >
            <ExternalLink size={16} />
            <span>Open Screen View in New Tab</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectToScreenModal;
