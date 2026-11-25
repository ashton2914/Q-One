export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function clientPointToNormalized(
  clientX: number,
  clientY: number,
  rect: RectLike,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const x = clamp01((clientX - rect.left) / rect.width);
  const y = clamp01((clientY - rect.top) / rect.height);
  return { x, y };
}

export function normalizedToPixel(
  x: number,
  y: number,
  width: number,
  height: number,
): { px: number; py: number } {
  return {
    px: clamp01(x) * width,
    py: clamp01(y) * height,
  };
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeRectFromPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minSize = 0.005,
): NormalizedRect {
  const cx1 = clamp01(x1);
  const cy1 = clamp01(y1);
  const cx2 = clamp01(x2);
  const cy2 = clamp01(y2);
  const x = Math.min(cx1, cx2);
  const y = Math.min(cy1, cy2);
  const width = Math.min(1 - x, Math.max(minSize, Math.abs(cx2 - cx1)));
  const height = Math.min(1 - y, Math.max(minSize, Math.abs(cy2 - cy1)));
  return { x, y, width, height };
}

export function clampMovedRect(
  x: number,
  y: number,
  width: number,
  height: number,
): NormalizedRect {
  const w = clamp01(width);
  const h = clamp01(height);
  const clampedX = Math.min(Math.max(0, x), Math.max(0, 1 - w));
  const clampedY = Math.min(Math.max(0, y), Math.max(0, 1 - h));
  return { x: clampedX, y: clampedY, width: w, height: h };
}
