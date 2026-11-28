import type { AnnotationKind, Dimension, ProjectData } from "../types/project";
import { getAnnotationKind } from "./annotations";

export const CURRENT_SCHEMA_VERSION = 1;

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nextBalloonNumber(dimensions: readonly Dimension[]): number {
  let max = 0;
  for (const dim of dimensions) {
    if (dim.balloonNumber > max) {
      max = dim.balloonNumber;
    }
  }
  return max + 1;
}

export function getAnnotationPage(dim: Dimension): number | null {
  return dim.marker?.page ?? dim.page ?? null;
}

export function getAnnotationSectionKey(dim: Dimension): string {
  if (getAnnotationKind(dim) === "datum") return "datum";
  const page = getAnnotationPage(dim);
  return page !== null ? `page:${page}` : "unassigned";
}

export function createDimension(
  existing: readonly Dimension[],
  drawingId: string | null = null,
  page: number | null = null,
): Dimension {
  return {
    id: generateId(),
    drawingId,
    page,
    kind: "linear",
    balloonNumber: nextBalloonNumber(existing),
    dimensionType: "",
    name: "",
    quantity: 1,
    nominal: "",
    upperTol: "",
    lowerTol: "",
    unit: "mm",
    notes: "",
    gdt: null,
    point: null,
    linkedPointIds: [],
    linkedNoteIds: [],
    marker: null,
  };
}

export function suggestDuplicateName(
  sourceName: string,
  existing: readonly Dimension[],
  kind: AnnotationKind,
): string {
  const trimmed = sourceName.trim();
  if (!trimmed) return "";

  const taken = new Set(
    existing
      .filter((d) => getAnnotationKind(d) === kind)
      .map((d) => d.name.trim().toLowerCase()),
  );

  // Trailing integer: e.g. "209" -> "210", "P1" -> "P2", "N01" -> "N02"
  const numMatch = trimmed.match(/^(.*?)(\d+)$/);
  if (numMatch) {
    const prefix = numMatch[1];
    const numStr = numMatch[2];
    const width = numStr.length;
    let n = parseInt(numStr, 10) + 1;
    while (n < 100000) {
      const candidate = `${prefix}${String(n).padStart(width, "0")}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
      n += 1;
    }
  }

  // Single ASCII letter (e.g. Datum "A" -> "B")
  if (/^[A-Za-z]$/.test(trimmed)) {
    const isUpper = trimmed === trimmed.toUpperCase();
    let code = trimmed.toUpperCase().charCodeAt(0) + 1;
    while (code <= 90) {
      const ch = String.fromCharCode(code);
      const candidate = isUpper ? ch : ch.toLowerCase();
      if (!taken.has(candidate.toLowerCase())) return candidate;
      code += 1;
    }
  }

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${trimmed}-${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    suffix += 1;
  }
  return "";
}

export function duplicateDimension(
  source: Dimension,
  existing: readonly Dimension[],
): Dimension {
  const kind = getAnnotationKind(source);
  return {
    ...source,
    id: generateId(),
    page: getAnnotationPage(source),
    kind,
    balloonNumber: nextBalloonNumber(existing),
    name: suggestDuplicateName(source.name, existing, kind),
    gdt: source.gdt
      ? {
          ...source.gdt,
          datums: source.gdt.datums.map((d) => ({ ...d })),
        }
      : null,
    point: source.point
      ? {
          ...source.point,
          datums: [...source.point.datums],
        }
      : null,
    linkedPointIds: [...(source.linkedPointIds ?? [])],
    linkedNoteIds: [...(source.linkedNoteIds ?? [])],
    marker: null,
  };
}

/**
 * Suggests the next sequential ID after the highest existing number for the
 * same kind & prefix (e.g. with C1..C5 existing, C1 -> C6, C2 -> C7, C3 -> C8).
 */
function suggestNextSequentialName(
  sourceName: string,
  existing: readonly Dimension[],
  kind: AnnotationKind,
): string {
  const trimmed = sourceName.trim();
  const numMatch = trimmed.match(/^(.*?)(\d+)$/);
  if (numMatch) {
    const prefix = numMatch[1];
    const prefixLower = prefix.toLowerCase();
    const width = numMatch[2].length;
    let maxNum = parseInt(numMatch[2], 10);

    for (const d of existing) {
      if (getAnnotationKind(d) !== kind) continue;
      const m = d.name.trim().match(/^(.*?)(\d+)$/);
      if (!m) continue;
      if (m[1].toLowerCase() === prefixLower) {
        const val = parseInt(m[2], 10);
        if (val > maxNum) maxNum = val;
      }
    }

    const taken = new Set(
      existing
        .filter((d) => getAnnotationKind(d) === kind)
        .map((d) => d.name.trim().toLowerCase()),
    );
    let n = maxNum + 1;
    while (n < 100000) {
      const candidate = `${prefix}${String(n).padStart(width, "0")}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
      n += 1;
    }
  }
  return suggestDuplicateName(sourceName, existing, kind);
}

/**
 * Duplicates multiple selected annotations in ascending natural ID order,
 * assigning sequential IDs continuing after the highest existing number
 * for each prefix (e.g. C1, C2, C3 with C1..C5 existing -> C6, C7, C8).
 */
export function duplicateDimensionsBatch(
  sources: readonly Dimension[],
  existing: readonly Dimension[],
): Dimension[] {
  const orderedSources = [...sources].sort((a, b) =>
    compareAnnotationId(a.name, b.name),
  );
  const workingExisting: Dimension[] = [...existing];
  const created: Dimension[] = [];

  for (const source of orderedSources) {
    const kind = getAnnotationKind(source);
    const nextName = suggestNextSequentialName(
      source.name,
      workingExisting,
      kind,
    );
    const dup: Dimension = {
      ...source,
      id: generateId(),
      page: getAnnotationPage(source),
      kind,
      balloonNumber: nextBalloonNumber(workingExisting),
      name: nextName,
      gdt: source.gdt
        ? {
            ...source.gdt,
            datums: source.gdt.datums.map((d) => ({ ...d })),
          }
        : null,
      point: source.point
        ? {
            ...source.point,
            datums: [...source.point.datums],
          }
        : null,
      linkedPointIds: [...(source.linkedPointIds ?? [])],
      linkedNoteIds: [...(source.linkedNoteIds ?? [])],
      marker: null,
    };
    workingExisting.push(dup);
    created.push(dup);
  }

  return created;
}

export function rememberDimensionType(
  history: readonly string[],
  rawType: string,
): string[] {
  const trimmed = rawType.trim();
  if (!trimmed) return [...history];
  const lower = trimmed.toLowerCase();
  const existing = history.find((item) => item.toLowerCase() === lower);
  const canonical = existing ?? trimmed;
  const rest = history.filter((item) => item.toLowerCase() !== lower);
  return [canonical, ...rest];
}

export function findTypeCompletion(
  input: string,
  history: readonly string[],
): string | null {
  const trimmedStart = input.trimStart();
  if (!trimmedStart) return null;
  const lower = trimmedStart.toLowerCase();
  for (const candidate of history) {
    if (candidate.toLowerCase().startsWith(lower)) {
      return candidate;
    }
  }
  return null;
}

const KIND_ID_LABEL: Record<AnnotationKind, string> = {
  linear: "Dimension ID",
  gdt: "GD&T ID",
  non_dimensional: "Non-Dim ID",
  note: "Note #",
  datum: "Datum name",
  point: "Point #",
};

export function isPageScopedKind(kind: AnnotationKind): boolean {
  return kind === "point" || kind === "note";
}

/**
 * Canonical unique key for an annotation within a drawing.
 * Page-scoped kinds (Point, Note) include their page scope so identical
 * per-page numbers (e.g. Note 1 on P1 vs Note 1 on P2) remain uniquely identifiable.
 */
export function getAnnotationScopedKey(dim: Dimension): string {
  const kind = getAnnotationKind(dim);
  const name = dim.name.trim().toLowerCase();
  if (isPageScopedKind(kind)) {
    const pageTag = dim.marker ? `p${dim.marker.page}` : "unmarked";
    return `${kind}:${pageTag}:${name}`;
  }
  return `${kind}:${name}`;
}

/**
 * Formats an annotation's display label for selectors/badges.
 * Appends the page tag (e.g. "1 (P2)") when another annotation of the same
 * page-scoped kind shares the same ID on the drawing.
 */
export function formatScopedAnnotationLabel(
  dim: Dimension,
  allDimensions: readonly Dimension[],
): string {
  const trimmed = dim.name.trim();
  if (!trimmed) return "—";
  const kind = getAnnotationKind(dim);
  if (!isPageScopedKind(kind)) return trimmed;

  const lower = trimmed.toLowerCase();
  const hasSameNameSibling = allDimensions.some(
    (other) =>
      other.id !== dim.id &&
      getAnnotationKind(other) === kind &&
      other.name.trim().toLowerCase() === lower,
  );
  if (!hasSameNameSibling) return trimmed;

  const pageLabel = dim.marker ? `P${dim.marker.page}` : "Unmarked";
  return `${trimmed} (${pageLabel})`;
}

export function validateDimensionId(
  idText: string,
  editingInternalId: string,
  dimensions: readonly Dimension[],
  kind?: AnnotationKind,
): string | null {
  const editing = dimensions.find((d) => d.id === editingInternalId);
  const resolvedKind: AnnotationKind =
    kind ?? (editing ? getAnnotationKind(editing) : "linear");
  const label = KIND_ID_LABEL[resolvedKind];
  const trimmed = idText.trim();
  if (!trimmed) {
    return `${label} is required.`;
  }
  const lower = trimmed.toLowerCase();
  const pageScoped = isPageScopedKind(resolvedKind);
  const editingPage = editing ? getAnnotationPage(editing) : null;

  const duplicate = dimensions.find((d) => {
    if (d.id === editingInternalId) return false;
    if (getAnnotationKind(d) !== resolvedKind) return false;
    if (d.name.trim().toLowerCase() !== lower) return false;
    if (pageScoped) {
      const otherPage = getAnnotationPage(d);
      return otherPage === editingPage;
    }
    return true;
  });
  if (duplicate) {
    if (pageScoped) {
      return editingPage !== null
        ? `${label} "${trimmed}" already exists on P${editingPage}.`
        : `${label} "${trimmed}" already exists (unmarked).`;
    }
    return `${label} "${trimmed}" already exists.`;
  }
  return null;
}

/**
 * Formats stored tolerance magnitudes (`+Tol` = upperTol, `-Tol` = lowerTol).
 * Convention:
 * - Positive `upperTol` ("0.25") displays as "+0.25"; negative ("-0.10") displays as "-0.10".
 * - Positive `lowerTol` ("0.25") displays as "-0.25"; negative ("-0.10") displays as "+0.10".
 */
export function formatTolerance(upperTol: string, lowerTol: string): string {
  const upper = upperTol.trim();
  const lower = lowerTol.trim();
  if (!upper && !lower) return "";

  const formatUpper = (val: string): string => {
    if (val.startsWith("-")) return val;
    return `+${val.replace(/^\+/, "")}`;
  };

  const formatLower = (val: string): string => {
    if (val.startsWith("-")) return `+${val.slice(1)}`;
    return `-${val.replace(/^\+/, "")}`;
  };

  if (upper && lower) {
    const uMag = upper.replace(/^[+-]/, "");
    const lMag = lower.replace(/^[+-]/, "");
    if (
      uMag &&
      uMag === lMag &&
      !upper.startsWith("-") &&
      !lower.startsWith("-")
    ) {
      return `±${uMag}`;
    }
    return `${formatUpper(upper)} / ${formatLower(lower)}`;
  }
  return upper ? formatUpper(upper) : formatLower(lower);
}

export function compareAnnotationId(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  const primary = ta.localeCompare(tb, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (primary !== 0) return primary;
  return ta.localeCompare(tb, undefined, { numeric: true });
}

function getPageCategoryRank(kind: AnnotationKind): number {
  switch (kind) {
    case "note":
      return 0;
    case "linear":
    case "gdt":
    case "non_dimensional":
      return 1;
    case "point":
      return 2;
    case "datum":
      return -1;
  }
}

/**
 * Sorts a drawing's annotations:
 * 1. All Datums first (across all pages), naturally sorted by ID.
 * 2. Remaining annotations grouped by page ascending (unplaced last),
 *    within each page: Notes -> Dimensions (Linear & GD&T together) -> Points,
 *    each naturally sorted by ID (so 1, 2, 3 precede 10, 11, 12).
 */
export function sortDrawingAnnotations(
  dimensions: readonly Dimension[],
): Dimension[] {
  return [...dimensions].sort((a, b) => {
    const kindA = getAnnotationKind(a);
    const kindB = getAnnotationKind(b);
    const isDatumA = kindA === "datum";
    const isDatumB = kindB === "datum";

    if (isDatumA !== isDatumB) {
      return isDatumA ? -1 : 1;
    }
    if (isDatumA && isDatumB) {
      return compareAnnotationId(a.name, b.name);
    }

    const pageA = getAnnotationPage(a) ?? Number.POSITIVE_INFINITY;
    const pageB = getAnnotationPage(b) ?? Number.POSITIVE_INFINITY;
    if (pageA !== pageB) {
      return pageA - pageB;
    }

    const catA = getPageCategoryRank(kindA);
    const catB = getPageCategoryRank(kindB);
    if (catA !== catB) {
      return catA - catB;
    }

    return compareAnnotationId(a.name, b.name);
  });
}

/**
 * Moves the dimension with `sourceId` to insertion slot `targetSlot` (0..dimensions.length).
 */
export function reorderDimensionList(
  dimensions: readonly Dimension[],
  sourceId: string,
  targetSlot: number,
): Dimension[] {
  const fromIndex = dimensions.findIndex((d) => d.id === sourceId);
  if (fromIndex === -1) return [...dimensions];

  const clampedSlot = Math.max(0, Math.min(dimensions.length, targetSlot));
  if (clampedSlot === fromIndex || clampedSlot === fromIndex + 1) {
    return [...dimensions];
  }

  const next = [...dimensions];
  const [moved] = next.splice(fromIndex, 1);
  const insertAt = fromIndex < clampedSlot ? clampedSlot - 1 : clampedSlot;
  next.splice(insertAt, 0, moved);
  return next;
}

/**
 * Reorders `sourceId` strictly within its own page/datum section (`targetSectionSlot`),
 * guaranteeing cross-page dragging is impossible.
 */
export function reorderWithinSection(
  dimensions: readonly Dimension[],
  sourceId: string,
  targetSectionSlot: number,
): Dimension[] {
  const source = dimensions.find((d) => d.id === sourceId);
  if (!source) return [...dimensions];

  const sectionKey = getAnnotationSectionKey(source);
  const sectionItems = dimensions.filter(
    (d) => getAnnotationSectionKey(d) === sectionKey,
  );
  const reorderedSection = reorderDimensionList(
    sectionItems,
    sourceId,
    targetSectionSlot,
  );

  let sectionIdx = 0;
  return dimensions.map((dim) => {
    if (getAnnotationSectionKey(dim) !== sectionKey) return dim;
    const replacement = reorderedSection[sectionIdx];
    sectionIdx += 1;
    return replacement ?? dim;
  });
}

/**
 * Replaces the order of dimensions belonging to `activeDrawingId` within the
 * full project dimensions array while leaving other drawings untouched.
 */
export function replaceDrawingDimensionsOrder(
  allDimensions: readonly Dimension[],
  activeDrawingId: string,
  orderedActiveDimensions: readonly Dimension[],
): Dimension[] {
  const belongsToActive = (d: Dimension) =>
    (d.drawingId ?? d.marker?.drawingId ?? null) === activeDrawingId;

  let activeIdx = 0;
  return allDimensions.map((dim) => {
    if (!belongsToActive(dim)) return dim;
    const replacement = orderedActiveDimensions[activeIdx];
    activeIdx += 1;
    return replacement ?? dim;
  });
}

/**
 * Inserts one or more `newDimensions` at `activeSlot` (0..activeCount) within
 * the active drawing's annotations while preserving all other drawings' annotations.
 */
export function insertDimensionsAtSlot(
  allDimensions: readonly Dimension[],
  activeDrawingId: string,
  newDimensions: readonly Dimension[],
  activeSlot: number,
): Dimension[] {
  if (newDimensions.length === 0) return [...allDimensions];
  const belongsToActive = (d: Dimension) =>
    (d.drawingId ?? d.marker?.drawingId ?? null) === activeDrawingId;

  const activeIndices: number[] = [];
  for (let i = 0; i < allDimensions.length; i += 1) {
    if (belongsToActive(allDimensions[i])) {
      activeIndices.push(i);
    }
  }

  const clampedSlot = Math.max(0, Math.min(activeIndices.length, activeSlot));
  const next = [...allDimensions];
  if (activeIndices.length === 0 || clampedSlot === 0) {
    const insertIdx = activeIndices.length > 0 ? activeIndices[0] : 0;
    next.splice(insertIdx, 0, ...newDimensions);
    return next;
  }
  if (clampedSlot >= activeIndices.length) {
    const lastIdx = activeIndices[activeIndices.length - 1];
    next.splice(lastIdx + 1, 0, ...newDimensions);
    return next;
  }
  const targetIdx = activeIndices[clampedSlot];
  next.splice(targetIdx, 0, ...newDimensions);
  return next;
}

export function insertDimensionAtSlot(
  allDimensions: readonly Dimension[],
  activeDrawingId: string,
  newDimension: Dimension,
  activeSlot: number,
): Dimension[] {
  return insertDimensionsAtSlot(
    allDimensions,
    activeDrawingId,
    [newDimension],
    activeSlot,
  );
}

/**
 * Resolves the next/previous dimension ID when stepping with ArrowUp / ArrowDown.
 */
export function resolveAdjacentDimensionId(
  dimensions: readonly Dimension[],
  currentId: string | null,
  direction: "up" | "down",
): string | null {
  if (dimensions.length === 0) return null;
  if (!currentId) {
    return direction === "down"
      ? dimensions[0].id
      : dimensions[dimensions.length - 1].id;
  }
  const idx = dimensions.findIndex((d) => d.id === currentId);
  if (idx === -1) {
    return direction === "down"
      ? dimensions[0].id
      : dimensions[dimensions.length - 1].id;
  }
  const nextIdx =
    direction === "down"
      ? Math.min(dimensions.length - 1, idx + 1)
      : Math.max(0, idx - 1);
  return dimensions[nextIdx].id;
}

export function createProjectFromPdf(
  drawingId: string,
  filename: string,
  pageCount: number,
): ProjectData {
  const now = new Date().toISOString();
  const baseName = filename.replace(/\.pdf$/i, "").trim() || "Untitled Project";
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: generateId(),
    name: baseName,
    createdAt: now,
    updatedAt: now,
    parts: [
      {
        id: generateId(),
        parentId: null,
        name: baseName,
        partNumber: "",
        revision: "",
        notes: "",
        drawingIds: [drawingId],
      },
    ],
    drawings: [
      {
        id: drawingId,
        filename,
        archivePath: `drawings/${drawingId}.pdf`,
        pageCount,
      },
    ],
    dimensions: [],
  };
}
