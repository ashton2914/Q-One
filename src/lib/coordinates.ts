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
