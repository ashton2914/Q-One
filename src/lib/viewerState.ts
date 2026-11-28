export type ViewerTool = "hand" | "text";

export interface ToolShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  targetTagName?: string | null;
  targetIsContentEditable?: boolean;
}

export function resolveViewerToolShortcut(
  event: ToolShortcutEventLike,
): ViewerTool | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return null;
  }
  const tag = event.targetTagName?.toUpperCase();
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    event.targetIsContentEditable
  ) {
    return null;
  }
  const lower = event.key.toLowerCase();
  if (lower === "c") return "hand";
  if (lower === "v") return "text";
  return null;
}

export type ViewerPanKey = "w" | "a" | "s" | "d";

export type ViewerKeyAction =
  | { type: "tool"; tool: ViewerTool }
  | { type: "points" }
  | { type: "move" }
  | { type: "zoom"; direction: "in" | "out" }
  | { type: "fit" }
  | { type: "pan"; key: ViewerPanKey };

/**
 * Resolves single-key PDF viewer shortcuts:
 * - C: Pan (Hand), V: Text Selection, P: Points, M: Batch Move
 * - W/A/S/D: Smooth viewport panning
 * - Q: Zoom In, E: Zoom Out
 * Ignores events inside text inputs, during IME composition, or with modifier keys.
 */
export function resolveViewerKeyAction(
  event: ToolShortcutEventLike,
): ViewerKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return null;
  }
  const tag = event.targetTagName?.toUpperCase();
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    event.targetIsContentEditable
  ) {
    return null;
  }
  const lower = event.key.toLowerCase();
  if (lower === "c") return { type: "tool", tool: "hand" };
  if (lower === "v") return { type: "tool", tool: "text" };
  if (lower === "p") return { type: "points" };
  if (lower === "m") return { type: "move" };
  if (lower === "q") return { type: "zoom", direction: "out" };
  if (lower === "e") return { type: "zoom", direction: "in" };
  if (lower === "r") return { type: "fit" };
  if (lower === "w" || lower === "a" || lower === "s" || lower === "d") {
    return { type: "pan", key: lower };
  }
  return null;
}

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

export type WheelZoomInputMode =
  | "default"
  | "mac_trackpad_pinch"
  | "mac_trackpad_scroll";

export function detectWheelZoomInputMode(
  event: {
    ctrlKey: boolean;
    metaKey: boolean;
    deltaMode: number;
    deltaY: number;
  },
  isMacPlatform: boolean,
): WheelZoomInputMode {
  if (!isMacPlatform || event.deltaMode !== 0) return "default";
  // macOS trackpad two-finger pinch dispatches synthetic ctrlKey=true, metaKey=false, pixel-mode wheel events.
  if (event.ctrlKey && !event.metaKey) return "mac_trackpad_pinch";
  // macOS Cmd + two-finger trackpad scroll emits fine continuous pixel deltas.
  if (event.metaKey && Math.abs(event.deltaY) < 40) return "mac_trackpad_scroll";
  return "default";
}

export function computeWheelTargetZoom(
  currentTargetZoom: number,
  deltaY: number,
  minZoom = 0.25,
  maxZoom = 4,
  inputMode: WheelZoomInputMode = "default",
): number {
  const sensitivity =
    inputMode === "mac_trackpad_pinch"
      ? 0.0055
      : inputMode === "mac_trackpad_scroll"
        ? 0.003
        : 0.0018;
  const maxAbsDelta = inputMode === "mac_trackpad_pinch" ? 50 : 80;
  const clampedDelta = Math.max(-maxAbsDelta, Math.min(maxAbsDelta, deltaY));
  const factor = Math.exp(-clampedDelta * sensitivity);
  const next = currentTargetZoom * factor;
  return Math.min(maxZoom, Math.max(minZoom, next));
}

export interface WheelPanDelta {
  dx: number;
  dy: number;
}

export function computeWheelPanDelta(
  event: {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    shiftKey: boolean;
  },
  viewportSize: { width: number; height: number },
): WheelPanDelta {
  const linePx = 32;
  const scaleX =
    event.deltaMode === 1
      ? linePx
      : event.deltaMode === 2
        ? Math.max(100, viewportSize.width * 0.85)
        : 1;
  const scaleY =
    event.deltaMode === 1
      ? linePx
      : event.deltaMode === 2
        ? Math.max(100, viewportSize.height * 0.85)
        : 1;

  let dx = event.deltaX * scaleX;
  let dy = event.deltaY * scaleY;

  // Shift + vertical wheel (e.g. standard mouse wheel) pans horizontally
  if (event.shiftKey && dx === 0 && dy !== 0) {
    dx = dy;
    dy = 0;
  }

  return { dx, dy };
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

export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeVisiblePageCrop(
  pageRect: PageRect,
  containerRect: PageRect,
  overscanPx = 160,
): PageCrop | null {
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;

  const visLeft = Math.max(pageRect.left, containerRect.left - overscanPx);
  const visTop = Math.max(pageRect.top, containerRect.top - overscanPx);
  const visRight = Math.min(
    pageRect.left + pageRect.width,
    containerRect.left + containerRect.width + overscanPx,
  );
  const visBottom = Math.min(
    pageRect.top + pageRect.height,
    containerRect.top + containerRect.height + overscanPx,
  );

  if (visRight <= visLeft || visBottom <= visTop) {
    return null;
  }

  const x = Math.max(0, Math.floor(visLeft - pageRect.left));
  const y = Math.max(0, Math.floor(visTop - pageRect.top));
  const maxW = Math.ceil(pageRect.width) - x;
  const maxH = Math.ceil(pageRect.height) - y;
  const width = Math.min(maxW, Math.ceil(visRight - visLeft));
  const height = Math.min(maxH, Math.ceil(visBottom - visTop));

  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export interface CenterRegionScrollInput {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  pageLeft: number;
  pageTop: number;
  pageWidth: number;
  pageHeight: number;
  markerX: number;
  markerY: number;
  markerWidth: number;
  markerHeight: number;
}

export function computeCenterRegionScroll(input: CenterRegionScrollInput): {
  left: number;
  top: number;
} {
  const centerX =
    input.scrollLeft +
    (input.pageLeft - input.viewportLeft) +
    (input.markerX + input.markerWidth / 2) * input.pageWidth;
  const centerY =
    input.scrollTop +
    (input.pageTop - input.viewportTop) +
    (input.markerY + input.markerHeight / 2) * input.pageHeight;

  const maxLeft = Math.max(0, input.scrollWidth - input.viewportWidth);
  const maxTop = Math.max(0, input.scrollHeight - input.viewportHeight);

  const left = Math.min(maxLeft, Math.max(0, centerX - input.viewportWidth / 2));
  const top = Math.min(maxTop, Math.max(0, centerY - input.viewportHeight / 2));
  return { left, top };
}

export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const POINT_HALO_W = 0.03;
const POINT_HALO_H = 0.025;

/**
 * Computes the union normalized bounding box covering a primary marker
 * plus all same-page linked markers (Points and Notes), adding a small visual halo
 * for zero-sized Point markers so their dots and label badges stay inside the viewport.
 */
export function computeHighlightUnionRegion(
  primary: NormalizedRegion,
  linked: readonly NormalizedRegion[],
): NormalizedRegion {
  const toVisualBox = (r: NormalizedRegion) => {
    if (r.width <= 0 || r.height <= 0) {
      return {
        left: Math.max(0, r.x - POINT_HALO_W / 2),
        top: Math.max(0, r.y - POINT_HALO_H / 2),
        right: Math.min(1, r.x + POINT_HALO_W / 2),
        bottom: Math.min(1, r.y + POINT_HALO_H / 2),
      };
    }
    return {
      left: Math.max(0, r.x),
      top: Math.max(0, r.y),
      right: Math.min(1, r.x + r.width),
      bottom: Math.min(1, r.y + r.height),
    };
  };

  let union = toVisualBox(primary);
  for (const item of linked) {
    const b = toVisualBox(item);
    union = {
      left: Math.min(union.left, b.left),
      top: Math.min(union.top, b.top),
      right: Math.max(union.right, b.right),
      bottom: Math.max(union.bottom, b.bottom),
    };
  }

  return {
    x: union.left,
    y: union.top,
    width: Math.max(0.01, union.right - union.left),
    height: Math.max(0.01, union.bottom - union.top),
  };
}

export interface HighlightAutoZoomParams {
  currentZoom: number;
  viewportWidth: number;
  viewportHeight: number;
  basePageWidth: number;
  basePageHeight: number;
  regionWidth: number;
  regionHeight: number;
  paddingRatio?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Computes the zoom level needed so a highlighted union region (dimension + linked Points + linked Notes)
 * fits comfortably inside the viewport. Never zooms in beyond `currentZoom`; only zooms out when the
 * union region would otherwise be clipped at the current zoom.
 */
export function computeHighlightAutoZoom(
  params: HighlightAutoZoomParams,
): number {
  const {
    currentZoom,
    viewportWidth,
    viewportHeight,
    basePageWidth,
    basePageHeight,
    regionWidth,
    regionHeight,
    paddingRatio = 0.8,
    minZoom = 0.25,
    maxZoom = 8,
  } = params;

  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    basePageWidth <= 0 ||
    basePageHeight <= 0 ||
    regionWidth <= 0 ||
    regionHeight <= 0
  ) {
    return currentZoom;
  }

  const usableW = Math.max(1, viewportWidth * paddingRatio);
  const usableH = Math.max(1, viewportHeight * paddingRatio);
  const regionBaseW = Math.max(1, regionWidth * basePageWidth);
  const regionBaseH = Math.max(1, regionHeight * basePageHeight);

  const fitZoom = Math.min(usableW / regionBaseW, usableH / regionBaseH);
  const clampedFit = Math.max(minZoom, Math.min(maxZoom, fitZoom));

  return currentZoom > clampedFit ? clampedFit : currentZoom;
}
