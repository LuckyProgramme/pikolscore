/**
 * Client-side cutout pipeline for Player Portal uploads:
 * 1. Auto-detects already-transparent PNG/WebP images (skips AI step)
 * 2. Runs in-browser @imgly/background-removal (isnet_quint8) on opaque photos
 * 3. Alpha-trims, keeps 12% top headroom, bottom-aligns on a 480x900 (300:562)
 *    canvas anchored by foreground centroid, and exports as lightweight WebP.
 */

export const POSTER_CUTOUT_WIDTH = 480;
export const POSTER_CUTOUT_HEIGHT = 900;
export const POSTER_HEADROOM_RATIO = 0.12;
export const POSTER_HORIZONTAL_MARGIN = 16;
export const MAX_INFERENCE_EDGE = 1600;
export const WEBP_EXPORT_QUALITY = 0.85;

/**
 * Inspects RGBA pixels to determine whether an image already has a transparent background.
 */
export function detectTransparencyFromRgba(rgba, width, height) {
  if (!rgba || !width || !height) return false;

  const borderBand = Math.max(2, Math.min(8, Math.floor(Math.min(width, height) * 0.04)));
  let borderSamples = 0;
  let transparentBorder = 0;
  let opaqueBodySamples = 0;

  const stepY = Math.max(1, Math.floor(height / 120));
  const stepX = Math.max(1, Math.floor(width / 120));

  for (let y = 0; y < height; y += stepY) {
    const isRowBorder = y < borderBand || y >= height - borderBand;
    for (let x = 0; x < width; x += stepX) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      const isBorder =
        isRowBorder || x < borderBand || x >= width - borderBand;

      if (isBorder) {
        borderSamples += 1;
        if (alpha <= 15) transparentBorder += 1;
      } else if (alpha >= 200) {
        opaqueBodySamples += 1;
      }
    }
  }

  if (borderSamples === 0 || opaqueBodySamples === 0) return false;
  return transparentBorder / borderSamples >= 0.55;
}

/**
 * Finds the tight alpha bounding box and alpha-weighted horizontal center of mass.
 */
export function analyzeAlphaBoundsAndCentroid(
  rgba,
  width,
  height,
  alphaThreshold = 16
) {
  if (!rgba || !width || !height) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let weightedSumX = 0;
  let totalAlpha = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(rowOffset + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        weightedSumX += x * alpha;
        totalAlpha += alpha;
      }
    }
  }

  if (maxX < minX || maxY < minY || totalAlpha === 0) {
    return null;
  }

  return {
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      cropW: maxX - minX + 1,
      cropH: maxY - minY + 1,
    },
    centroidX: weightedSumX / totalAlpha,
  };
}

/**
 * Computes destination draw rect on the 480x900 (300:562) poster stage:
 * - Reserving `headroomRatio` at top for raised paddles
 * - Bottom-aligned to `canvasHeight`
 * - Horizontally centered around foreground `centroidX` without clipping edges
 */
export function computePosterPlacement({
  bounds,
  centroidX,
  canvasWidth = POSTER_CUTOUT_WIDTH,
  canvasHeight = POSTER_CUTOUT_HEIGHT,
  headroomRatio = POSTER_HEADROOM_RATIO,
  horizontalMargin = POSTER_HORIZONTAL_MARGIN,
}) {
  const { minX, cropW, cropH } = bounds;
  const availWidth = Math.max(1, canvasWidth - horizontalMargin * 2);
  const availHeight = Math.max(1, canvasHeight * (1 - headroomRatio));

  const scale = Math.min(availWidth / cropW, availHeight / cropH);
  const destW = Math.round(cropW * scale);
  const destH = Math.round(cropH * scale);
  const destY = canvasHeight - destH;

  const anchorOffsetInCrop =
    typeof centroidX === 'number' ? centroidX - minX : cropW / 2;
  const idealDestX = Math.round(canvasWidth / 2 - anchorOffsetInCrop * scale);

  const leftLimit = horizontalMargin;
  const rightLimit = canvasWidth - horizontalMargin - destW;
  const destX =
    leftLimit <= rightLimit
      ? Math.min(Math.max(idealDestX, leftLimit), rightLimit)
      : Math.round((canvasWidth - destW) / 2);

  return { destX, destY, destW, destH, scale };
}

/**
 * Extracts a relative bucket object path from a Supabase public Storage URL.
 */
export function extractStoragePathFromPublicUrl(
  url,
  bucketName = 'player-photos'
) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length).split(/[?#]/)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function blobOrFileToCanvas(source, maxEdge = MAX_INFERENCE_EDGE) {
  const url = URL.createObjectURL(source);
  try {
    const img = new window.Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Unable to read selected image file.'));
      img.src = url;
    });

    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        // Ignore decode warning if image already completed onload with dimensions
      }
    }

    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (!natW || !natH) {
      throw new Error('Selected image has zero dimensions.');
    }

    const edgeScale =
      Math.max(natW, natH) > maxEdge ? maxEdge / Math.max(natW, natH) : 1;
    const outW = Math.max(1, Math.round(natW * edgeScale));
    const outH = Math.max(1, Math.round(natH * edgeScale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function normalizeTransparentCanvasToWebp(sourceCanvas, fileNameBase) {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const { data: rgba } = srcCtx.getImageData(0, 0, srcW, srcH);

  const analysis = analyzeAlphaBoundsAndCentroid(rgba, srcW, srcH);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = POSTER_CUTOUT_WIDTH;
  outCanvas.height = POSTER_CUTOUT_HEIGHT;
  const outCtx = outCanvas.getContext('2d');
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.clearRect(0, 0, POSTER_CUTOUT_WIDTH, POSTER_CUTOUT_HEIGHT);

  if (analysis) {
    const { bounds, centroidX } = analysis;
    const { destX, destY, destW, destH } = computePosterPlacement({
      bounds,
      centroidX,
    });
    outCtx.drawImage(
      sourceCanvas,
      bounds.minX,
      bounds.minY,
      bounds.cropW,
      bounds.cropH,
      destX,
      destY,
      destW,
      destH
    );
  } else {
    // Fallback if image was completely empty/transparent
    const scale = Math.min(
      POSTER_CUTOUT_WIDTH / srcW,
      POSTER_CUTOUT_HEIGHT / srcH
    );
    const destW = Math.round(srcW * scale);
    const destH = Math.round(srcH * scale);
    outCtx.drawImage(
      sourceCanvas,
      0,
      0,
      srcW,
      srcH,
      Math.round((POSTER_CUTOUT_WIDTH - destW) / 2),
      POSTER_CUTOUT_HEIGHT - destH,
      destW,
      destH
    );
  }

  let blob = await canvasToBlob(outCanvas, 'image/webp', WEBP_EXPORT_QUALITY);
  let ext = 'webp';
  if (!blob) {
    blob = await canvasToBlob(outCanvas, 'image/png');
    ext = 'png';
  }
  if (!blob) {
    throw new Error('Failed to export normalized cutout image.');
  }

  const safeBase = String(fileNameBase || 'pose')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 32) || 'pose';

  return new File([blob], `${safeBase}.${ext}`, {
    type: blob.type || `image/${ext}`,
  });
}

/**
 * Processes an uploaded player photo into a normalized 480x900 transparent WebP:
 * - Skips AI segmentation if image already has transparent background
 * - Dynamically loads @imgly/background-removal otherwise
 */
export async function processPlayerCutoutFile(file, { onProgress } = {}) {
  if (typeof window === 'undefined') {
    throw new Error('Cutout processing must run in the browser.');
  }

  onProgress?.({ stage: 'decoding', label: 'Preparing photo…', progress: 0.08 });
  const sourceCanvas = await blobOrFileToCanvas(file, MAX_INFERENCE_EDGE);
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const imgData = srcCtx.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height
  );

  let transparentCanvas = sourceCanvas;
  const alreadyTransparent = detectTransparencyFromRgba(
    imgData.data,
    sourceCanvas.width,
    sourceCanvas.height
  );

  if (!alreadyTransparent) {
    onProgress?.({
      stage: 'removing',
      label: 'Removing background…',
      progress: 0.15,
    });

    const inputBlob = await canvasToBlob(sourceCanvas, 'image/png');
    if (!inputBlob) {
      throw new Error('Unable to prepare image for background removal.');
    }

    const { removeBackground } = await import('@imgly/background-removal');
    const cutoutPngBlob = await removeBackground(inputBlob, {
      model: 'isnet_quint8',
      device: 'cpu',
      output: { format: 'image/png' },
      progress: (key, current, total) => {
        if (!total || total <= 0) return;
        const ratio = Math.max(0, Math.min(1, current / total));
        const isFetch = String(key || '').includes('fetch');
        onProgress?.({
          stage: 'removing',
          label: isFetch ? 'Loading cutout AI model…' : 'Removing background…',
          progress: 0.15 + ratio * 0.65,
        });
      },
    });

    transparentCanvas = await blobOrFileToCanvas(
      cutoutPngBlob,
      MAX_INFERENCE_EDGE
    );
  }

  onProgress?.({
    stage: 'normalizing',
    label: 'Aligning & compressing…',
    progress: 0.9,
  });

  const normalizedFile = await normalizeTransparentCanvasToWebp(
    transparentCanvas,
    file?.name
  );

  onProgress?.({ stage: 'done', label: 'Ready', progress: 1 });
  return normalizedFile;
}
