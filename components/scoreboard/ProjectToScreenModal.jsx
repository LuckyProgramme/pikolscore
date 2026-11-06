'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Tv,
  X,
  Camera,
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
            // 1. Try native BarcodeDetector first if available
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

            // 2. Universal jsQR canvas decoder
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-deep-green/75 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-screen-modal-title"
    >
      <div className="relative w-full max-w-lg bg-ivory rounded-[28px] sm:rounded-[34px] border border-line shadow-2xl p-5 sm:p-7 my-auto text-dark-teal">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 pb-4 mb-5 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pale-sage text-teal border border-teal/20">
              <Tv size={22} aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-teal px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-cream">
                  Court {courtNumber}
                </span>
                <span className="text-[12px] font-semibold text-muted">
                  Screen Projection
                </span>
              </div>
              <h2
                id="project-screen-modal-title"
                className="text-[20px] sm:text-[22px] font-bold text-dark-teal m-0 mt-0.5"
              >
                Project Court {courtNumber} to TV Screen
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-off-white border border-line text-muted hover:text-dark-teal hover:bg-pale-sage transition-colors cursor-pointer"
            aria-label="Close projection modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Status Messages */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-error/10 border border-error/20 p-3 text-[13px] font-semibold text-error flex items-center gap-2"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mb-4 rounded-xl bg-pale-sage border border-teal p-3 text-[13px] font-bold text-dark-teal flex items-center gap-2"
          >
            <CheckCircle2 size={16} className="text-teal shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* 1. Camera QR Scanner Box */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-teal flex items-center gap-1.5">
              <Camera size={14} />
              <span>Scan QR Code on TV (/umpire page)</span>
            </span>
            {cameraState === 'active' && (
              <span className="text-[11px] font-semibold text-muted">
                Point camera at TV QR
              </span>
            )}
          </div>

          <div className="relative w-full aspect-[4/3] rounded-2xl bg-[#084B46] border-2 border-teal/30 overflow-hidden flex items-center justify-center">
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
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-44 h-44 rounded-2xl border-2 border-[#FEECD6] shadow-[0_0_0_9999px_rgba(8,75,70,0.45)]" />
              </div>
            )}

            {cameraState === 'starting' && (
              <div className="flex flex-col items-center gap-2 text-[#FEECD6] p-4 text-center">
                <Loader2 size={28} className="animate-spin" />
                <span className="text-xs font-semibold">
                  Starting camera QR scanner...
                </span>
              </div>
            )}

            {cameraState === 'denied' && (
              <div className="flex flex-col items-center gap-2 text-[#EAF0E5] p-6 text-center">
                <QrCode size={32} className="text-[#FEECD6]" />
                <span className="text-sm font-bold text-white">
                  Camera preview unavailable
                </span>
                <span className="text-xs text-[#EAF0E5]/80">
                  Enter the 6-character TV Code shown below the QR on the TV&apos;s /umpire page, or scan the TV with your phone&apos;s native camera app.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 2. Manual 6-Character TV Code Input */}
        <form onSubmit={handleManualSubmit} className="mt-5 pt-4 border-t border-line">
          <label
            htmlFor="manual-tv-code"
            className="block text-xs font-bold uppercase tracking-wider text-dark-teal mb-2"
          >
            Or Enter 6-Character TV Code from /umpire
          </label>
          <div className="flex items-center gap-2">
            <input
              id="manual-tv-code"
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="e.g. A4F92C"
              maxLength={12}
              className="h-10 flex-1 min-w-0 rounded-xl bg-off-white border border-line px-3.5 text-sm font-mono font-bold uppercase tracking-widest text-dark-teal outline-none focus:border-teal"
            />
            <button
              type="submit"
              disabled={!manualCode.trim() || isSubmitting}
              className="h-10 px-4 rounded-xl bg-teal hover:bg-forest-teal text-cream text-xs font-bold transition-colors cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Tv size={14} />
                  <span>Connect TV</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* 3. Direct Open in New Tab Option */}
        <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            Connected to an external monitor on this device?
          </span>
          <button
            type="button"
            onClick={handleOpenInNewTab}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-off-white hover:bg-pale-sage border border-line text-xs font-bold text-dark-teal transition-colors cursor-pointer shrink-0"
          >
            <ExternalLink size={13} />
            <span>Open Screen View Tab</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectToScreenModal;
