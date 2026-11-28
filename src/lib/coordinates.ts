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

export interface MarkerHitCandidate {
  id: string;
  isPoint: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_HIT_BOX_W = 0.04;
const DEFAULT_HIT_BOX_H = 0.025;
const POINT_HIT_RADIUS_PX = 12;

/**
 * Finds all markers whose rendered pixel bounds contain `(clickPx, clickPy)`,
 * ordered from smallest area (points / inner boxes) to largest.
 */
export function findMarkersAtPixelPoint<T extends MarkerHitCandidate>(
  candidates: readonly T[],
  clickPx: number,
  clickPy: number,
  pageWidth: number,
  pageHeight: number,
): T[] {
  if (pageWidth <= 0 || pageHeight <= 0) return [];
  const hits: Array<{ item: T; area: number }> = [];

  for (const c of candidates) {
    const { px, py } = normalizedToPixel(c.x, c.y, pageWidth, pageHeight);
    if (c.isPoint) {
      const dist = Math.hypot(clickPx - px, clickPy - py);
      if (dist <= POINT_HIT_RADIUS_PX) {
        hits.push({ item: c, area: 0 });
      }
      continue;
    }
    const boxW = Math.max(12, (c.width || DEFAULT_HIT_BOX_W) * pageWidth);
    const boxH = Math.max(10, (c.height || DEFAULT_HIT_BOX_H) * pageHeight);
    if (
      clickPx >= px &&
      clickPx <= px + boxW &&
      clickPy >= py &&
      clickPy <= py + boxH
    ) {
      hits.push({ item: c, area: boxW * boxH });
    }
  }

  hits.sort((a, b) => a.area - b.area);
  return hits.map((h) => h.item);
}

export interface LabelLayoutItem {
  id: string;
  isPoint: boolean;
  /** Marker anchor pixel X (box left or point center) */
  px: number;
  /** Marker anchor pixel Y (box top or point center) */
  py: number;
  /** Rendered box pixel width (0 for points) */
  boxW: number;
  /** Rendered box pixel height (0 for points) */
  boxH: number;
  label: string;
}

export interface LabelOffset {
  /** Offset in px relative to the marker's own top-left (box) or center (point) */
  dx: number;
  dy: number;
}

interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxesOverlap(a: PixelBox, b: PixelBox, pad = 2): boolean {
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

function overlapArea(a: PixelBox, b: PixelBox): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/**
 * Computes collision-free pixel offsets for annotation label badges on a page.
 * Overlapping boxes (e.g. a Note and a Dimension covering the same line) will
 * neatly place their badges side-by-side along the box perimeter instead of stacking.
 */
export function computeNonOverlappingLabelOffsets(
  items: readonly LabelLayoutItem[],
  pageWidth: number,
  pageHeight: number,
): Map<string, LabelOffset> {
  const result = new Map<string, LabelOffset>();
  if (items.length === 0 || pageWidth <= 0 || pageHeight <= 0) return result;

  const placed: PixelBox[] = [];
  const LABEL_H = 15;
  const GAP = 2;

  const clampToPage = (x: number, y: number, w: number, h: number): PixelBox => ({
    x: Math.max(0, Math.min(Math.max(0, pageWidth - w), x)),
    y: Math.max(0, Math.min(Math.max(0, pageHeight - h), y)),
    w,
    h,
  });

  const hasCollision = (box: PixelBox): boolean =>
    placed.some((p) => boxesOverlap(box, p, GAP));

  const totalOverlap = (box: PixelBox): number =>
    placed.reduce((sum, p) => sum + overlapArea(box, p), 0);

  for (const item of items) {
    const labelW = Math.max(16, Math.ceil(item.label.length * 6.4 + 10));
    const candidates: PixelBox[] = [];

    if (item.isPoint) {
      const r = 10;
      candidates.push(
        clampToPage(item.px - labelW / 2, item.py - r - LABEL_H, labelW, LABEL_H),
        clampToPage(item.px - labelW / 2, item.py + r, labelW, LABEL_H),
        clampToPage(item.px + r, item.py - LABEL_H / 2, labelW, LABEL_H),
        clampToPage(item.px - r - labelW, item.py - LABEL_H / 2, labelW, LABEL_H),
        clampToPage(item.px + r, item.py - r - LABEL_H, labelW, LABEL_H),
        clampToPage(item.px + r, item.py + r, labelW, LABEL_H),
        clampToPage(item.px - r - labelW, item.py - r - LABEL_H, labelW, LABEL_H),
        clampToPage(item.px - r - labelW, item.py + r, labelW, LABEL_H),
      );
    } else {
      const topY = item.py >= LABEL_H + 1 ? item.py - LABEL_H - 1 : item.py + 1;
      const bottomY = item.py + item.boxH + 1;

      // 1. Default top-left
      const topLeft = clampToPage(item.px - 1, topY, labelW, LABEL_H);
      candidates.push(topLeft);

      // 2. Slide right along the top edge past any colliding badges
      let slideX = topLeft.x;
      for (let step = 0; step < 6; step += 1) {
        const probe = clampToPage(slideX, topY, labelW, LABEL_H);
        const blocker = placed.find((p) => boxesOverlap(probe, p, GAP));
        if (!blocker) break;
        const nextX = blocker.x + blocker.w + GAP;
        if (nextX <= slideX || nextX + labelW > pageWidth) break;
        slideX = nextX;
        candidates.push(clampToPage(slideX, topY, labelW, LABEL_H));
      }

      // 3. Top-right, bottom-left, bottom-right, left/right outside, inside top-left
      candidates.push(
        clampToPage(item.px + item.boxW - labelW + 1, topY, labelW, LABEL_H),
        clampToPage(item.px - 1, bottomY, labelW, LABEL_H),
        clampToPage(item.px + item.boxW - labelW + 1, bottomY, labelW, LABEL_H),
        clampToPage(item.px - labelW - 2, item.py, labelW, LABEL_H),
        clampToPage(item.px + item.boxW + 2, item.py, labelW, LABEL_H),
        clampToPage(item.px + 1, item.py + 1, labelW, LABEL_H),
      );
    }

    let chosen: PixelBox | null = null;
    for (const c of candidates) {
      if (!hasCollision(c)) {
        chosen = c;
        break;
      }
    }

    if (!chosen) {
      // Fall back to the candidate with minimum overlap area
      chosen = candidates[0];
      let bestOverlap = totalOverlap(chosen);
      for (let i = 1; i < candidates.length; i += 1) {
        const ov = totalOverlap(candidates[i]);
        if (ov < bestOverlap) {
          bestOverlap = ov;
          chosen = candidates[i];
        }
      }
    }

    placed.push(chosen);
    result.set(item.id, {
      dx: chosen.x - item.px,
      dy: chosen.y - item.py,
    });
  }

  return result;
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

export interface CollapsedMarkerItem<
  T extends {
    id: string;
    name: string;
    marker: { x: number; y: number; width: number; height: number } | null;
  },
> {
  primary: T;
  members: T[];
  isCollapsed: boolean;
  labelOverride: string | null;
}

const DEFAULT_OVERLAP_CLUSTER_TOLERANCE = 0.006;

/**
 * Collapses groups of >= `minClusterSize` markers that share virtually the same
 * PDF position/region into a single rendered marker with a compact `... (N)` label
 * to avoid DOM/GPU bloat and label clutter.
 */
export function collapseOverlappingMarkers<
  T extends {
    id: string;
    name: string;
    marker: { x: number; y: number; width: number; height: number } | null;
  },
>(
  items: readonly T[],
  options: {
    isPoint: (item: T) => boolean;
    selectedIds?: ReadonlySet<string>;
    linkedIds?: ReadonlySet<string>;
    editingId?: string | null;
    minClusterSize?: number;
    tolerance?: number;
  },
): CollapsedMarkerItem<T>[] {
  const minClusterSize = options.minClusterSize ?? 4;
  const tol = options.tolerance ?? DEFAULT_OVERLAP_CLUSTER_TOLERANCE;
  const selectedIds = options.selectedIds;
  const linkedIds = options.linkedIds;
  const editingId = options.editingId ?? null;

  interface Bucket {
    isPoint: boolean;
    anchor: { x: number; y: number; width: number; height: number };
    members: T[];
  }
  const buckets: Bucket[] = [];

  for (const item of items) {
    const m = item.marker;
    if (!m) continue;
    const pt = options.isPoint(item);
    let matched: Bucket | null = null;
    for (const bucket of buckets) {
      if (bucket.isPoint !== pt) continue;
      const a = bucket.anchor;
      if (
        Math.abs(a.x - m.x) <= tol &&
        Math.abs(a.y - m.y) <= tol &&
        (pt ||
          (Math.abs(a.width - m.width) <= tol &&
            Math.abs(a.height - m.height) <= tol))
      ) {
        matched = bucket;
        break;
      }
    }
    if (matched) {
      matched.members.push(item);
    } else {
      buckets.push({ isPoint: pt, anchor: m, members: [item] });
    }
  }

  const result: CollapsedMarkerItem<T>[] = [];
  for (const bucket of buckets) {
    if (bucket.members.length < minClusterSize) {
      for (const m of bucket.members) {
        result.push({
          primary: m,
          members: [m],
          isCollapsed: false,
          labelOverride: null,
        });
      }
      continue;
    }

    const editingMember = editingId
      ? bucket.members.find((m) => m.id === editingId)
      : undefined;
    const selectedMembers = selectedIds
      ? bucket.members.filter((m) => selectedIds.has(m.id))
      : [];
    const linkedMember = linkedIds
      ? bucket.members.find((m) => linkedIds.has(m.id))
      : undefined;

    const primary =
      editingMember ?? selectedMembers[0] ?? linkedMember ?? bucket.members[0];
    const hasHighlightedPrimary = Boolean(
      editingMember || selectedMembers.length === 1 || linkedMember,
    );
    const primaryName = primary.name.trim();
    const labelOverride =
      hasHighlightedPrimary && primaryName
        ? `${primaryName} … (${bucket.members.length})`
        : `... (${bucket.members.length})`;

    result.push({
      primary,
      members: bucket.members,
      isCollapsed: true,
      labelOverride,
    });
  }

  return result;
}

/**
 * Returns all candidate markers that intersect (or whose point lies inside) a normalized marquee rectangle.
 */
export function findMarkersInRect<
  T extends {
    id: string;
    isPoint: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  },
>(candidates: readonly T[], rect: NormalizedRect): T[] {
  const rx1 = rect.x;
  const ry1 = rect.y;
  const rx2 = rect.x + rect.width;
  const ry2 = rect.y + rect.height;

  return candidates.filter((c) => {
    if (c.isPoint) {
      return c.x >= rx1 && c.x <= rx2 && c.y >= ry1 && c.y <= ry2;
    }
    const cx1 = c.x;
    const cy1 = c.y;
    const cx2 = c.x + Math.max(0.004, c.width);
    const cy2 = c.y + Math.max(0.004, c.height);
    return cx1 <= rx2 && cx2 >= rx1 && cy1 <= ry2 && cy2 >= ry1;
  });
}

/**
 * Clamps a group translation delta (dx, dy) so that every marker in the group
 * remains inside [0, 1] while preserving their relative offsets.
 */
export function clampBatchMoveDelta(
  markers: readonly { x: number; y: number; width: number; height: number }[],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  if (markers.length === 0) return { dx: 0, dy: 0 };
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;

  for (const m of markers) {
    const w = clamp01(m.width);
    const h = clamp01(m.height);
    minDx = Math.max(minDx, -m.x);
    maxDx = Math.min(maxDx, 1 - w - m.x);
    minDy = Math.max(minDy, -m.y);
    maxDy = Math.min(maxDy, 1 - h - m.y);
  }

  return {
    dx: Math.min(Math.max(dx, minDx), maxDx),
    dy: Math.min(Math.max(dy, minDy), maxDy),
  };
}
