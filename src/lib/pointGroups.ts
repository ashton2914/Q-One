import type {
  Dimension,
  PointGroup,
  PointGroupCalibration,
} from "../types/project";
import { getAnnotationKind } from "./annotations";
import { compareAnnotationId, getAnnotationPage } from "./dimensions";
import { evaluateFormulaInput } from "./mathEval";

function generateGroupId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compresses a list of Point IDs into a compact range label:
 * - Continuous sequence: ["F1", "F2", ..., "F13"] -> "F1~F13"
 * - Discontinuous sequence: ["F1", "F2", "F5", "F8", ..., "F13"] -> "F1~F2, F5, F8~F13"
 * - Mixed prefixes / non-numeric names are grouped naturally.
 */
export function formatPointGroupDefaultName(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return "Point Group";

  const sorted = [...cleaned].sort(compareAnnotationId);

  // Partition into prefix-numbered runs vs plain non-numeric names while preserving first-seen prefix order
  const prefixOrder: string[] = [];
  const byPrefix = new Map<
    string,
    { canonicalPrefix: string; entries: Array<{ num: number; raw: string }> }
  >();
  const nonNumeric: string[] = [];

  for (const raw of sorted) {
    const m = raw.match(/^(.*?)(\d+)$/);
    if (!m) {
      if (!nonNumeric.includes(raw)) nonNumeric.push(raw);
      continue;
    }
    const prefix = m[1];
    const key = prefix.toLowerCase();
    const num = parseInt(m[2], 10);
    let bucket = byPrefix.get(key);
    if (!bucket) {
      bucket = { canonicalPrefix: prefix, entries: [] };
      byPrefix.set(key, bucket);
      prefixOrder.push(key);
    }
    if (!bucket.entries.some((e) => e.num === num)) {
      bucket.entries.push({ num, raw });
    }
  }

  const segments: string[] = [];

  for (const key of prefixOrder) {
    const bucket = byPrefix.get(key)!;
    bucket.entries.sort((a, b) => a.num - b.num);

    let runStart = 0;
    while (runStart < bucket.entries.length) {
      let runEnd = runStart;
      while (
        runEnd + 1 < bucket.entries.length &&
        bucket.entries[runEnd + 1].num === bucket.entries[runEnd].num + 1
      ) {
        runEnd += 1;
      }
      if (runEnd === runStart) {
        segments.push(bucket.entries[runStart].raw);
      } else {
        segments.push(
          `${bucket.entries[runStart].raw}~${bucket.entries[runEnd].raw}`,
        );
      }
      runStart = runEnd + 1;
    }
  }

  for (const raw of nonNumeric) {
    segments.push(raw);
  }

  return segments.join(", ");
}

/**
 * Creates a new PointGroup from selected point dimensions on a given page.
 */
export function createPointGroup(
  selectedPoints: readonly Dimension[],
  drawingId: string,
  page: number,
): PointGroup {
  const ordered = [...selectedPoints].sort((a, b) =>
    compareAnnotationId(a.name, b.name),
  );
  return {
    id: generateGroupId(),
    drawingId,
    page,
    name: formatPointGroupDefaultName(ordered.map((p) => p.name)),
    pointIds: ordered.map((p) => p.id),
    collapsed: false,
  };
}

/**
 * Removes deleted or non-existent point IDs from groups and drops empty groups.
 */
export function prunePointGroups(
  groups: readonly PointGroup[],
  existingDimensions: readonly Dimension[],
): PointGroup[] {
  const validIds = new Set(existingDimensions.map((d) => d.id));
  const result: PointGroup[] = [];
  for (const grp of groups) {
    const remaining = grp.pointIds.filter((id) => validIds.has(id));
    if (remaining.length > 0) {
      result.push(
        remaining.length === grp.pointIds.length
          ? grp
          : { ...grp, pointIds: remaining },
      );
    }
  }
  return result;
}


export type LinkedPointDisplayToken =
  | { kind: "group"; group: PointGroup; points: Dimension[] }
  | { kind: "point"; point: Dimension };

/**
 * Resolves a dimension's linkedPointIds into display tokens for badges:
 * whenever all existing member points of a PointGroup are present in linkedPointIds,
 * those points collapse into a single group badge showing the group's name;
 * any remaining ungrouped or partially-selected points render individually.
 */
export function resolveLinkedPointDisplayTokens(
  linkedPointIds: readonly string[],
  dimensionsById: ReadonlyMap<string, Dimension>,
  pointGroups: readonly PointGroup[],
): LinkedPointDisplayToken[] {
  if (linkedPointIds.length === 0) return [];
  const linkedSet = new Set(linkedPointIds);
  const coveredPointIds = new Set<string>();
  const tokens: LinkedPointDisplayToken[] = [];

  for (const group of pointGroups) {
    const members = group.pointIds
      .map((id) => dimensionsById.get(id))
      .filter((d): d is Dimension => Boolean(d));
    if (members.length === 0) continue;
    if (members.every((m) => linkedSet.has(m.id))) {
      tokens.push({ kind: "group", group, points: members });
      for (const m of members) {
        coveredPointIds.add(m.id);
      }
    }
  }

  const emittedPointIds = new Set<string>();
  for (const id of linkedPointIds) {
    if (coveredPointIds.has(id) || emittedPointIds.has(id)) continue;
    const pt = dimensionsById.get(id);
    if (!pt) continue;
    emittedPointIds.add(id);
    tokens.push({ kind: "point", point: pt });
  }

  return tokens;
}

export function createEmptyCalibration(): PointGroupCalibration {
  return {
    xZero: null,
    yZero: null,
    anchorX: null,
    anchorY: null,
    anchorValX: "",
    anchorValY: "",
  };
}

function parseCalibrationNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const evaluated = trimmed.startsWith("=")
    ? evaluateFormulaInput(trimmed)
    : trimmed;
  if (evaluated === null) return null;
  const num = Number(evaluated);
  return Number.isFinite(num) ? num : null;
}

function formatCalibratedCoord(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  const normalized = Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? 0 : rounded;
  return normalized.toFixed(2);
}

/**
 * Computes frozen X/Y real-world coordinates for a clicked normalized point `(clickX, clickY)`
 * from the independent linear scales defined by `(xZero, anchorX, anchorValX)` and `(yZero, anchorY, anchorValY)`.
 */
/**
 * Minimum normalized distance between Anchor and X=0 / Y=0 required to compute
 * an independent axis scale (~0.5% of page dimension). Smaller spans mean the
 * Anchor sits directly on the axis line and would cause division-by-near-zero blowup.
 */
export const MIN_CALIBRATION_AXIS_SPAN = 0.005;

/**
 * Computes calibrated real-world X/Y coordinates for a clicked normalized PDF point.
 * - When Anchor is offset from both X=0 and Y=0 (>= 0.5% span), each axis scales independently.
 * - When Anchor sits directly on X=0 (or Y=0) and `pageAspectRatio` (width / height) is supplied,
 *   the missing axis scale is derived 1:1 isotropically from the other calibrated axis.
 */
export function computeCalibratedPointCoords(
  clickX: number,
  clickY: number,
  cal: PointGroupCalibration,
  pageAspectRatio?: number,
): { x: string; y: string } {
  let x = "";
  let y = "";

  const valX = parseCalibrationNumber(cal.anchorValX);
  const valY = parseCalibrationNumber(cal.anchorValY);

  const dx =
    cal.xZero !== null && cal.anchorX !== null ? cal.anchorX - cal.xZero : null;
  const dy =
    cal.yZero !== null && cal.anchorY !== null ? cal.anchorY - cal.yZero : null;

  const hasDirectX =
    dx !== null &&
    valX !== null &&
    Math.abs(valX) > 1e-9 &&
    Math.abs(dx) >= MIN_CALIBRATION_AXIS_SPAN;
  const hasDirectY =
    dy !== null &&
    valY !== null &&
    Math.abs(valY) > 1e-9 &&
    Math.abs(dy) >= MIN_CALIBRATION_AXIS_SPAN;

  if (hasDirectX && cal.xZero !== null && dx !== null && valX !== null) {
    const worldX = ((clickX - cal.xZero) / dx) * valX;
    x = formatCalibratedCoord(worldX);
  } else if (
    !hasDirectX &&
    hasDirectY &&
    cal.xZero !== null &&
    dy !== null &&
    valY !== null &&
    pageAspectRatio !== undefined &&
    Number.isFinite(pageAspectRatio) &&
    pageAspectRatio > 0
  ) {
    // Derive X scale 1:1 isotropically from Y scale using page width/height ratio (X+ to the right)
    const unitsPerPageHeight = Math.abs(valY / dy);
    const unitsPerPageWidth = unitsPerPageHeight * pageAspectRatio;
    const worldX = (clickX - cal.xZero) * unitsPerPageWidth;
    x = formatCalibratedCoord(worldX);
  }

  if (hasDirectY && cal.yZero !== null && dy !== null && valY !== null) {
    const worldY = ((clickY - cal.yZero) / dy) * valY;
    y = formatCalibratedCoord(worldY);
  } else if (
    !hasDirectY &&
    hasDirectX &&
    cal.yZero !== null &&
    dx !== null &&
    valX !== null &&
    pageAspectRatio !== undefined &&
    Number.isFinite(pageAspectRatio) &&
    pageAspectRatio > 0
  ) {
    // Derive Y scale 1:1 isotropically from X scale using page width/height ratio (Y+ upward)
    const unitsPerPageWidth = Math.abs(valX / dx);
    const unitsPerPageHeight = unitsPerPageWidth / pageAspectRatio;
    const worldY = -(clickY - cal.yZero) * unitsPerPageHeight;
    y = formatCalibratedCoord(worldY);
  }

  return { x, y };
}

/**
 * Increments a Point ID sequentially:
 * "F1" -> "F2", "F09" -> "F10", "1" -> "2", "TP" -> "TP2", "" -> "P1".
 */
export function incrementPointId(currentId: string): string {
  const trimmed = currentId.trim();
  if (!trimmed) return "P1";
  const m = trimmed.match(/^(.*?)(\d+)$/);
  if (!m) return `${trimmed}2`;
  const prefix = m[1];
  const digits = m[2];
  const nextNum = parseInt(digits, 10) + 1;
  const padded =
    digits.length > 1 && digits.startsWith("0")
      ? String(nextNum).padStart(digits.length, "0")
      : String(nextNum);
  return `${prefix}${padded}`;
}

/**
 * Suggests the next Point ID to continue adding to a Point Group.
 */
export function suggestNextPointIdForGroup(
  memberNames: readonly string[],
): string {
  const cleaned = memberNames.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return "P1";
  const sorted = [...cleaned].sort(compareAnnotationId);
  return incrementPointId(sorted[sorted.length - 1]);
}

/**
 * Checks whether a candidate Point ID collides (case-insensitively) with any existing Point on the same page.
 */
export function hasPointIdCollisionOnPage(
  candidateId: string,
  existingPointNamesOnPage: readonly string[],
): boolean {
  const lower = candidateId.trim().toLowerCase();
  if (!lower) return false;
  return existingPointNamesOnPage.some(
    (name) => name.trim().toLowerCase() === lower,
  );
}

/**
 * Resolves a unique Point ID on the target page by advancing sequentially past any already-taken IDs.
 */
export function resolveUniquePointIdOnPage(
  desiredId: string,
  existingPointNamesOnPage: readonly string[],
): string {
  const taken = new Set(
    existingPointNamesOnPage.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  let candidate = desiredId.trim() || "P1";
  let guard = 0;
  while (taken.has(candidate.toLowerCase()) && guard < 10000) {
    candidate = incrementPointId(candidate);
    guard += 1;
  }
  return candidate;
}

function resolveUpdatedGroupName(
  group: PointGroup,
  oldPointIds: readonly string[],
  nextPointIds: readonly string[],
  dimensionsById: ReadonlyMap<string, Dimension>,
): string {
  const oldNames = oldPointIds
    .map((id) => dimensionsById.get(id)?.name ?? "")
    .filter(Boolean);
  const oldDefault = formatPointGroupDefaultName(oldNames);
  if (group.name.trim() !== oldDefault) {
    return group.name;
  }
  const nextNames = nextPointIds
    .map((id) => dimensionsById.get(id)?.name ?? "")
    .filter(Boolean);
  return formatPointGroupDefaultName(nextNames);
}

/**
 * Adds existing point(s) into a target PointGroup (removing them from any previous group).
 * Auto-refreshes the group's name if it still uses its default range name.
 */
export function addPointsToGroup(
  groups: readonly PointGroup[],
  targetGroupId: string,
  pointIds: readonly string[],
  dimensionsById: ReadonlyMap<string, Dimension>,
): PointGroup[] {
  if (pointIds.length === 0) return [...groups];
  const movingSet = new Set(pointIds);
  const result: PointGroup[] = [];

  for (const grp of groups) {
    if (grp.id === targetGroupId) {
      const nextIds = [
        ...grp.pointIds,
        ...pointIds.filter((pid) => !grp.pointIds.includes(pid)),
      ];
      result.push({
        ...grp,
        pointIds: nextIds,
        name: resolveUpdatedGroupName(grp, grp.pointIds, nextIds, dimensionsById),
      });
    } else {
      const remaining = grp.pointIds.filter((pid) => !movingSet.has(pid));
      if (remaining.length > 0) {
        result.push(
          remaining.length === grp.pointIds.length
            ? grp
            : {
                ...grp,
                pointIds: remaining,
                name: resolveUpdatedGroupName(
                  grp,
                  grp.pointIds,
                  remaining,
                  dimensionsById,
                ),
              },
        );
      }
    }
  }

  return result;
}


/**
 * Removes point(s) from whichever PointGroup(s) they belong to without deleting the points.
 * Drops any group that becomes empty and refreshes default names.
 */
export function removePointsFromGroups(
  groups: readonly PointGroup[],
  pointIds: readonly string[],
  dimensionsById: ReadonlyMap<string, Dimension>,
): PointGroup[] {
  if (pointIds.length === 0) return [...groups];
  const removeSet = new Set(pointIds);
  const result: PointGroup[] = [];

  for (const grp of groups) {
    const remaining = grp.pointIds.filter((pid) => !removeSet.has(pid));
    if (remaining.length === 0) continue;
    result.push(
      remaining.length === grp.pointIds.length
        ? grp
        : {
            ...grp,
            pointIds: remaining,
            name: resolveUpdatedGroupName(
              grp,
              grp.pointIds,
              remaining,
              dimensionsById,
            ),
          },
    );
  }

  return result;
}

/**
 * Recalculates X/Y coordinates for all marked points in a PointGroup using the
 * supplied calibration, preserving each point's Z value and datums.
 */
export function recalculatePointGroupCoordinates(
  dimensions: readonly Dimension[],
  group: Pick<PointGroup, "pointIds" | "page">,
  calibration: PointGroupCalibration,
  pageAspectRatio?: number,
): { updatedDimensions: Dimension[]; updatedCount: number } {
  const memberSet = new Set(group.pointIds);
  let updatedCount = 0;

  const updatedDimensions = dimensions.map((dim) => {
    if (!memberSet.has(dim.id)) return dim;
    if (!dim.marker || dim.marker.page !== group.page) return dim;
    const coords = computeCalibratedPointCoords(
      dim.marker.x,
      dim.marker.y,
      calibration,
      pageAspectRatio,
    );
    if (!coords.x && !coords.y) return dim;

    const basePoint = dim.point ?? {
      x: "",
      y: "",
      z: "",
      datums: ["", "", ""],
    };
    const nextX = coords.x || basePoint.x;
    const nextY = coords.y || basePoint.y;
    updatedCount += 1;
    return {
      ...dim,
      point: {
        ...basePoint,
        x: nextX,
        y: nextY,
      },
    };
  });

  return { updatedDimensions, updatedCount };
}

/**
 * Automatically rebinds cross-page `linkedPointIds` to same-named Points on the
 * annotation's own page within the same drawing.
 *
 * Example: if a dimension on P11 still references Point "F1" on P5 (e.g. after
 * copying P5 annotations/points to P11) and P11 has a Point named "F1", its link
 * is automatically updated to P11's "F1". Cross-page links without a same-page
 * counterpart are left untouched.
 */
export function rebindSamePageLinkedPoints(
  dimensions: readonly Dimension[],
): Dimension[] {
  const byId = new Map<string, Dimension>();
  // drawingKey -> page -> lowerName -> pointId
  const pointLookup = new Map<string, Map<number, Map<string, string>>>();

  for (const dim of dimensions) {
    byId.set(dim.id, dim);
    if (getAnnotationKind(dim) !== "point") continue;
    const page = getAnnotationPage(dim);
    const nameKey = dim.name.trim().toLowerCase();
    if (page === null || !nameKey) continue;
    const drawingKey = dim.drawingId ?? dim.marker?.drawingId ?? "";
    let pageMap = pointLookup.get(drawingKey);
    if (!pageMap) {
      pageMap = new Map();
      pointLookup.set(drawingKey, pageMap);
    }
    let nameMap = pageMap.get(page);
    if (!nameMap) {
      nameMap = new Map();
      pageMap.set(page, nameMap);
    }
    if (!nameMap.has(nameKey)) {
      nameMap.set(nameKey, dim.id);
    }
  }

  let anyChanged = false;
  const result = dimensions.map((dim) => {
    const linked = dim.linkedPointIds;
    if (!linked || linked.length === 0) return dim;
    const dimPage = getAnnotationPage(dim);
    if (dimPage === null) return dim;
    const drawingKey = dim.drawingId ?? dim.marker?.drawingId ?? "";
    const samePagePoints = pointLookup.get(drawingKey)?.get(dimPage);
    if (!samePagePoints || samePagePoints.size === 0) return dim;

    let rowChanged = false;
    const nextIds: string[] = [];
    const seen = new Set<string>();

    for (const pid of linked) {
      const targetPt = byId.get(pid);
      let resolvedId = pid;
      if (targetPt && getAnnotationKind(targetPt) === "point") {
        const ptPage = getAnnotationPage(targetPt);
        if (ptPage !== dimPage) {
          const nameKey = targetPt.name.trim().toLowerCase();
          const localMatchId = nameKey ? samePagePoints.get(nameKey) : undefined;
          if (localMatchId && localMatchId !== pid) {
            resolvedId = localMatchId;
            rowChanged = true;
          }
        }
      }
      if (!seen.has(resolvedId)) {
        seen.add(resolvedId);
        nextIds.push(resolvedId);
      } else {
        rowChanged = true;
      }
    }

    if (!rowChanged) return dim;
    anyChanged = true;
    return { ...dim, linkedPointIds: nextIds };
  });

  return anyChanged ? result : [...dimensions];
}
