export interface PageDimensions {
  width: number;
  height: number;
}

export function shouldApplyFit(
  fitRequestKey: number,
  lastAppliedFitKey: number,
  basePageSize: PageDimensions | null,
): boolean {
  return (
    fitRequestKey > 0 &&
    fitRequestKey !== lastAppliedFitKey &&
    basePageSize !== null &&
    basePageSize.width > 0 &&
    basePageSize.height > 0
  );
}

export function computeFitZoom(
  containerWidth: number,
  containerHeight: number,
  pageWidth: number,
  pageHeight: number,
  pad = 48,
): number {
  const availW = Math.max(200, containerWidth - pad);
  const availH = Math.max(200, containerHeight - pad);
  const fitScale = Math.min(availW / pageWidth, availH / pageHeight);
  return Math.min(4, Math.max(0.25, Math.round(fitScale * 100) / 100));
}

export function shouldClearDirtyAfterSave(
  revisionAtSaveStart: number,
  currentRevision: number,
): boolean {
  return revisionAtSaveStart === currentRevision;
}

export function shouldBlockWindowClose(isDirty: boolean): boolean {
  return isDirty;
}

export interface PageVerticalBounds {
  page: number;
  top: number;
  height: number;
}

export function findMostVisiblePage(
  viewportTop: number,
  viewportHeight: number,
  pages: readonly PageVerticalBounds[],
): number {
  if (pages.length === 0) return 1;
  const viewportBottom = viewportTop + viewportHeight;
  let bestPage = pages[0].page;
  let bestOverlap = -1;

  for (const p of pages) {
    const pBottom = p.top + p.height;
    const overlap = Math.max(
      0,
      Math.min(viewportBottom, pBottom) - Math.max(viewportTop, p.top),
    );
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestPage = p.page;
    }
  }
  return bestPage;
}

export function computeWheelTargetZoom(
  currentTargetZoom: number,
  deltaY: number,
  minZoom = 0.25,
  maxZoom = 4,
): number {
  const clampedDelta = Math.max(-80, Math.min(80, deltaY));
  const factor = Math.exp(-clampedDelta * 0.0018);
  const next = currentTargetZoom * factor;
  return Math.min(maxZoom, Math.max(minZoom, next));
}

export function computeAnchoredScroll(
  scrollPos: number,
  cursorOffsetInViewport: number,
  contentOffset: number,
  oldZoom: number,
  newZoom: number,
): number {
  if (oldZoom <= 0 || newZoom <= 0) return scrollPos;
  const contentCoord = scrollPos + cursorOffsetInViewport - contentOffset;
  const scaledCoord = contentCoord * (newZoom / oldZoom);
  return Math.max(0, scaledCoord + contentOffset - cursorOffsetInViewport);
}

const MAX_CANVAS_SIDE = 4096;
const MAX_CANVAS_PIXELS = 12_000_000;

export function computeSafeRenderScale(
  baseWidth: number,
  baseHeight: number,
  desiredZoom: number,
  dpr = 1,
): number {
  if (baseWidth <= 0 || baseHeight <= 0 || desiredZoom <= 0) return 1;
  const safeDpr = Math.max(1, dpr);
  const desiredScale = desiredZoom * safeDpr;
  const maxBySide = Math.min(
    MAX_CANVAS_SIDE / baseWidth,
    MAX_CANVAS_SIDE / baseHeight,
  );
  const maxByArea = Math.sqrt(MAX_CANVAS_PIXELS / (baseWidth * baseHeight));
  return Math.max(0.1, Math.min(desiredScale, maxBySide, maxByArea));
}
