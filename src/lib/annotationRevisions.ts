import type {
  AnnotationRevision,
  Dimension,
  DrawingEntry,
  PointGroup,
} from "../types/project";

export function makeDefaultAnnotationRevisionId(drawingId: string): string {
  return `rev-${drawingId}-1`;
}

export function createAnnotationRevision(
  name: string,
  id?: string,
  createdAt?: string,
): AnnotationRevision {
  const generatedId =
    id ??
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `rev-${crypto.randomUUID()}`
      : `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return {
    id: generatedId,
    name: name.trim() || "Review 1",
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

export function hasAnnotationRevisionNameCollision(
  revisions: readonly AnnotationRevision[],
  candidateName: string,
  excludeRevisionId?: string,
): boolean {
  const normalized = candidateName.trim().toLowerCase();
  if (!normalized) return false;
  return revisions.some(
    (r) =>
      r.id !== excludeRevisionId && r.name.trim().toLowerCase() === normalized,
  );
}

/**
 * Ensures a DrawingEntry always has at least one annotation revision, unique revision names,
 * and a valid latestAnnotationRevisionId.
 */
export function ensureDrawingAnnotationRevisions(
  drawing: DrawingEntry,
  fallbackCreatedAt: string,
): {
  revisions: AnnotationRevision[];
  latestRevisionId: string;
} {
  const raw =
    Array.isArray(drawing.annotationRevisions) &&
    drawing.annotationRevisions.length > 0
      ? drawing.annotationRevisions
      : [
          {
            id: makeDefaultAnnotationRevisionId(drawing.id),
            name: "Review 1",
            createdAt: fallbackCreatedAt,
          },
        ];

  // Guarantee unique case-insensitive names within a drawing
  const seen = new Set<string>();
  const existing: AnnotationRevision[] = raw.map((rev, idx) => {
    const base = rev.name.trim() || `Review ${idx + 1}`;
    let candidate = base;
    let suffix = 2;
    while (seen.has(candidate.toLowerCase())) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    seen.add(candidate.toLowerCase());
    return candidate === rev.name ? rev : { ...rev, name: candidate };
  });

  const hasValidLatest =
    typeof drawing.latestAnnotationRevisionId === "string" &&
    existing.some((r) => r.id === drawing.latestAnnotationRevisionId);
  const latestRevisionId = hasValidLatest
    ? drawing.latestAnnotationRevisionId!
    : existing[existing.length - 1].id;

  return {
    revisions: existing,
    latestRevisionId,
  };
}

export function resolveLatestAnnotationRevisionId(
  drawing: DrawingEntry | null | undefined,
): string | null {
  if (!drawing) return null;
  const revisions = drawing.annotationRevisions ?? [];
  if (revisions.length === 0) {
    return makeDefaultAnnotationRevisionId(drawing.id);
  }
  if (
    drawing.latestAnnotationRevisionId &&
    revisions.some((r) => r.id === drawing.latestAnnotationRevisionId)
  ) {
    return drawing.latestAnnotationRevisionId;
  }
  return revisions[revisions.length - 1].id;
}

export function nextAnnotationRevisionName(
  existing: readonly AnnotationRevision[],
): string {
  const used = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  let idx = existing.length + 1;
  while (used.has(`review ${idx}`)) {
    idx += 1;
  }
  return `Review ${idx}`;
}

export function resolveUniqueAnnotationRevisionName(
  existing: readonly AnnotationRevision[],
  preferredName: string,
): string {
  const base = preferredName.trim() || nextAnnotationRevisionName(existing);
  if (!hasAnnotationRevisionNameCollision(existing, base)) {
    return base;
  }
  let suffix = 2;
  let candidate = `${base} (${suffix})`;
  while (hasAnnotationRevisionNameCollision(existing, candidate)) {
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
  return candidate;
}

function makeFreshId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Deep-clones all dimensions and point groups belonging to (drawingId, sourceRevisionId)
 * into a brand-new isolated annotation revision (on the same or another drawing)
 * with fresh IDs and remapped internal links.
 */
export function duplicateAnnotationRevisionData(params: {
  drawingId: string;
  targetDrawingId?: string;
  targetDrawingPageCount?: number;
  sourceRevisionId: string;
  targetRevisionId: string;
  dimensions: readonly Dimension[];
  pointGroups: readonly PointGroup[];
  idFactory?: (prefix: string) => string;
}): {
  clonedDimensions: Dimension[];
  clonedPointGroups: PointGroup[];
} {
  const nextId = params.idFactory ?? makeFreshId;
  const resolvedTargetDrawingId = params.targetDrawingId ?? params.drawingId;
  const maxPage =
    params.targetDrawingPageCount && params.targetDrawingPageCount > 0
      ? params.targetDrawingPageCount
      : null;
  const clampPage = (page: number): number =>
    maxPage !== null ? Math.max(1, Math.min(maxPage, page)) : page;

  const sourceDims = params.dimensions.filter(
    (d) =>
      (d.drawingId ?? d.marker?.drawingId ?? null) === params.drawingId &&
      d.annotationRevisionId === params.sourceRevisionId,
  );
  const sourceGroups = params.pointGroups.filter(
    (g) =>
      g.drawingId === params.drawingId &&
      g.annotationRevisionId === params.sourceRevisionId,
  );

  const dimIdMap = new Map<string, string>();
  for (const dim of sourceDims) {
    dimIdMap.set(dim.id, nextId("dim"));
  }

  const clonedDimensions: Dimension[] = sourceDims.map((dim) => ({
    ...dim,
    id: dimIdMap.get(dim.id)!,
    drawingId: resolvedTargetDrawingId,
    annotationRevisionId: params.targetRevisionId,
    page:
      dim.page !== undefined && dim.page !== null
        ? clampPage(dim.page)
        : dim.page,
    gdt: dim.gdt
      ? {
          ...dim.gdt,
          datums: dim.gdt.datums.map((ref) => ({ ...ref })),
        }
      : dim.gdt,
    point: dim.point
      ? {
          ...dim.point,
          datums: [...dim.point.datums],
        }
      : dim.point,
    linkedPointIds: (dim.linkedPointIds ?? [])
      .map((pid) => dimIdMap.get(pid))
      .filter((pid): pid is string => Boolean(pid)),
    linkedNoteIds: (dim.linkedNoteIds ?? [])
      .map((nid) => dimIdMap.get(nid))
      .filter((nid): nid is string => Boolean(nid)),
    marker: dim.marker
      ? {
          ...dim.marker,
          drawingId: resolvedTargetDrawingId,
          page: clampPage(dim.marker.page),
        }
      : null,
  }));

  const clonedPointGroups: PointGroup[] = sourceGroups.map((grp) => ({
    ...grp,
    id: nextId("pg"),
    drawingId: resolvedTargetDrawingId,
    annotationRevisionId: params.targetRevisionId,
    page: clampPage(grp.page),
    pointIds: grp.pointIds
      .map((pid) => dimIdMap.get(pid))
      .filter((pid): pid is string => Boolean(pid)),
    calibration: grp.calibration ? { ...grp.calibration } : grp.calibration,
  }));

  return { clonedDimensions, clonedPointGroups };
}
