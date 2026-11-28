import type { DrawingEntry, Part, ProjectData } from "../types/project";
import { CURRENT_SCHEMA_VERSION } from "./dimensions";
import { ensureDrawingAnnotationRevisions } from "./annotationRevisions";
import { rebindSamePageLinkedPoints } from "./pointGroups";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyProject(name = "Untitled Project"): ProjectData {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: generateId(),
    name: name.trim() || "Untitled Project",
    createdAt: now,
    updatedAt: now,
    parts: [],
    drawings: [],
    dimensions: [],
    pointGroups: [],
  };
}

export function createPart(
  parentId: string | null,
  name = "New Part",
): Part {
  return {
    id: generateId(),
    parentId,
    name,
    partNumber: "",
    revision: "",
    notes: "",
    drawingIds: [],
    latestDrawingId: null,
  };
}

/**
 * Resolves the "Latest" drawing ID for a Part:
 * - If the user explicitly marked `part.latestDrawingId` and it still belongs to the part, use it.
 * - Otherwise, default to the most recently uploaded (last) drawing in `part.drawingIds`.
 */
export function resolveLatestDrawingId(part: Part): string | null {
  if (
    part.latestDrawingId &&
    part.drawingIds.includes(part.latestDrawingId)
  ) {
    return part.latestDrawingId;
  }
  return part.drawingIds.length > 0
    ? part.drawingIds[part.drawingIds.length - 1]
    : null;
}

export function canReparentPart(
  parts: readonly Part[],
  partId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return true;
  if (partId === newParentId) return false;

  const byId = new Map(parts.map((p) => [p.id, p]));
  let cursor: string | null = newParentId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (cursor === partId) return false;
    if (visited.has(cursor)) return false;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return true;
}

export function reparentPart(
  parts: readonly Part[],
  partId: string,
  newParentId: string | null,
): Part[] {
  if (!canReparentPart(parts, partId, newParentId)) {
    return [...parts];
  }
  return parts.map((p) =>
    p.id === partId ? { ...p, parentId: newParentId } : p,
  );
}

export interface DeletePartResult {
  remainingParts: Part[];
  removedPartIds: string[];
  removedDrawingIds: string[];
}

export function deletePartSubtree(
  parts: readonly Part[],
  rootPartId: string,
): DeletePartResult {
  const toRemove = new Set<string>([rootPartId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const p of parts) {
      if (p.parentId !== null && toRemove.has(p.parentId) && !toRemove.has(p.id)) {
        toRemove.add(p.id);
        expanded = true;
      }
    }
  }

  const removedDrawingIds: string[] = [];
  const remainingParts: Part[] = [];
  for (const p of parts) {
    if (toRemove.has(p.id)) {
      removedDrawingIds.push(...p.drawingIds);
    } else {
      remainingParts.push(p);
    }
  }

  return {
    remainingParts,
    removedPartIds: Array.from(toRemove),
    removedDrawingIds,
  };
}

export interface PartTreeNode {
  part: Part;
  x: number;
  y: number;
  depth: number;
  hasChildren: boolean;
  childCount: number;
}

export interface PartTreeEdge {
  id: string;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PartTreeLayout {
  nodes: PartTreeNode[];
  edges: PartTreeEdge[];
  width: number;
  height: number;
}

export const PART_CARD_WIDTH = 256;
export const PART_CARD_HEIGHT = 112;
const COL_GAP = 72;
const ROW_GAP = 28;
const CANVAS_PAD = 48;

export function layoutPartTree(
  parts: readonly Part[],
  collapsedIds: ReadonlySet<string>,
): PartTreeLayout {
  if (parts.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const partIds = new Set(parts.map((p) => p.id));
  const childrenByParent = new Map<string | null, Part[]>();

  for (const part of parts) {
    const parentKey =
      part.parentId !== null && partIds.has(part.parentId)
        ? part.parentId
        : null;
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(part);
    childrenByParent.set(parentKey, list);
  }

  const nodes: PartTreeNode[] = [];
  const edges: PartTreeEdge[] = [];
  const visited = new Set<string>();
  let nextLeafRow = 0;

  const markSubtreeVisited = (partId: string) => {
    const stack = [partId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const child of childrenByParent.get(id) ?? []) {
        stack.push(child.id);
      }
    }
  };

  const placeSubtree = (part: Part, depth: number): PartTreeNode => {
    visited.add(part.id);
    const rawChildren = (childrenByParent.get(part.id) ?? []).filter(
      (c) => !visited.has(c.id),
    );
    const isCollapsed = collapsedIds.has(part.id);
    if (isCollapsed) {
      for (const child of rawChildren) {
        markSubtreeVisited(child.id);
      }
    }
    const visibleChildren = isCollapsed ? [] : rawChildren;
    const x = CANVAS_PAD + depth * (PART_CARD_WIDTH + COL_GAP);

    let y: number;
    const placedChildren: PartTreeNode[] = [];

    if (visibleChildren.length === 0) {
      y = CANVAS_PAD + nextLeafRow * (PART_CARD_HEIGHT + ROW_GAP);
      nextLeafRow += 1;
    } else {
      for (const child of visibleChildren) {
        placedChildren.push(placeSubtree(child, depth + 1));
      }
      const firstY = placedChildren[0].y;
      const lastY = placedChildren[placedChildren.length - 1].y;
      y = (firstY + lastY) / 2;
    }

    const node: PartTreeNode = {
      part,
      x,
      y,
      depth,
      hasChildren: rawChildren.length > 0,
      childCount: rawChildren.length,
    };
    nodes.push(node);

    for (const childNode of placedChildren) {
      edges.push({
        id: `${part.id}->${childNode.part.id}`,
        fromId: part.id,
        toId: childNode.part.id,
        x1: node.x + PART_CARD_WIDTH,
        y1: node.y + PART_CARD_HEIGHT / 2,
        x2: childNode.x,
        y2: childNode.y + PART_CARD_HEIGHT / 2,
      });
    }

    return node;
  };

  const roots = childrenByParent.get(null) ?? [];
  for (const root of roots) {
    if (!visited.has(root.id)) {
      placeSubtree(root, 0);
    }
  }
  // Safety fallback for any disconnected cyclic entries
  for (const part of parts) {
    if (!visited.has(part.id)) {
      placeSubtree(part, 0);
    }
  }

  let maxRight = 0;
  let maxBottom = 0;
  for (const n of nodes) {
    maxRight = Math.max(maxRight, n.x + PART_CARD_WIDTH);
    maxBottom = Math.max(maxBottom, n.y + PART_CARD_HEIGHT);
  }

  return {
    nodes,
    edges,
    width: maxRight + CANVAS_PAD,
    height: maxBottom + CANVAS_PAD,
  };
}

export type DrawingSortMode = "custom" | "alpha_asc" | "alpha_desc";

export function getDrawingSortLabel(
  drawing: Pick<DrawingEntry, "version" | "filename">,
): string {
  return (drawing.version ?? "").trim() || drawing.filename.trim();
}

export function sortDrawings(
  drawings: readonly DrawingEntry[],
  mode: DrawingSortMode,
): DrawingEntry[] {
  if (mode === "custom") {
    return [...drawings];
  }
  const direction = mode === "alpha_asc" ? 1 : -1;
  return [...drawings].sort((a, b) => {
    const labelA = getDrawingSortLabel(a);
    const labelB = getDrawingSortLabel(b);
    const primary = labelA.localeCompare(labelB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (primary !== 0) return primary * direction;
    return (
      a.filename.localeCompare(b.filename, undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction
    );
  });
}

export function reorderDrawingIds(
  drawingIds: readonly string[],
  sourceId: string,
  targetSlot: number,
): string[] {
  const sourceIdx = drawingIds.indexOf(sourceId);
  if (sourceIdx === -1) return [...drawingIds];
  const clampedSlot = Math.max(0, Math.min(drawingIds.length, targetSlot));
  if (clampedSlot === sourceIdx || clampedSlot === sourceIdx + 1) {
    return [...drawingIds];
  }
  const next = [...drawingIds];
  const [moved] = next.splice(sourceIdx, 1);
  const insertIdx = sourceIdx < clampedSlot ? clampedSlot - 1 : clampedSlot;
  next.splice(insertIdx, 0, moved);
  return next;
}

export function normalizeLoadedProject(project: ProjectData): ProjectData {
  const drawings: DrawingEntry[] = project.drawings.map((drw) => {
    const { revisions, latestRevisionId } = ensureDrawingAnnotationRevisions(
      drw,
      project.createdAt,
    );
    return {
      ...drw,
      annotationRevisions: revisions,
      latestAnnotationRevisionId: latestRevisionId,
    };
  });

  const defaultDrawingId = drawings[0]?.id ?? null;
  const revisionIdsByDrawing = new Map<string, Set<string>>();
  const latestRevisionByDrawing = new Map<string, string>();
  for (const drw of drawings) {
    revisionIdsByDrawing.set(
      drw.id,
      new Set((drw.annotationRevisions ?? []).map((r) => r.id)),
    );
    if (drw.latestAnnotationRevisionId) {
      latestRevisionByDrawing.set(drw.id, drw.latestAnnotationRevisionId);
    }
  }

  let parts = Array.isArray(project.parts) ? [...project.parts] : [];
  if (parts.length === 0 && drawings.length > 0) {
    parts = [
      {
        id: generateId(),
        parentId: null,
        name: project.name || "Main Assembly",
        partNumber: "",
        revision: "",
        notes: "",
        drawingIds: drawings.map((d) => d.id),
      },
    ];
  }

  const resolveRevisionId = (
    drawingId: string | null,
    existingRevisionId?: string | null,
  ): string | null => {
    if (!drawingId) return existingRevisionId ?? null;
    const validIds = revisionIdsByDrawing.get(drawingId);
    if (existingRevisionId && validIds?.has(existingRevisionId)) {
      return existingRevisionId;
    }
    return latestRevisionByDrawing.get(drawingId) ?? null;
  };

  const dimensions = rebindSamePageLinkedPoints(
    project.dimensions.map((d) => {
      const drawingId = d.drawingId ?? d.marker?.drawingId ?? defaultDrawingId;
      return {
        ...d,
        drawingId,
        annotationRevisionId: resolveRevisionId(
          drawingId,
          d.annotationRevisionId,
        ),
        dimensionType: d.dimensionType ?? "",
        quantity: d.quantity && d.quantity > 0 ? d.quantity : 1,
      };
    }),
  );

  const pointGroups = (
    Array.isArray(project.pointGroups) ? project.pointGroups : []
  ).map((g) => ({
    ...g,
    annotationRevisionId: resolveRevisionId(
      g.drawingId,
      g.annotationRevisionId,
    ),
  }));

  return {
    ...project,
    parts,
    drawings,
    dimensions,
    pointGroups,
  };
}
