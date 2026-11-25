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

export function createDimension(
  existing: readonly Dimension[],
  drawingId: string | null = null,
): Dimension {
  return {
    id: generateId(),
    drawingId,
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
    marker: null,
  };
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
  note: "Note #",
  datum: "Datum name",
  point: "Point #",
};

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
  const duplicate = dimensions.find(
    (d) =>
      d.id !== editingInternalId &&
      getAnnotationKind(d) === resolvedKind &&
      d.name.trim().toLowerCase() === lower,
  );
  if (duplicate) {
    return `${label} "${trimmed}" already exists.`;
  }
  return null;
}

export function formatTolerance(upperTol: string, lowerTol: string): string {
  const upper = upperTol.trim();
  const lower = lowerTol.trim();
  if (!upper && !lower) return "";
  if (upper && lower) {
    const uMag = upper.replace(/^[+-]/, "");
    const lMag = lower.replace(/^[+-]/, "");
    if (uMag && uMag === lMag && !upper.startsWith("-") && !lower.startsWith("+")) {
      return `±${uMag}`;
    }
    return `${upper} / ${lower}`;
  }
  return upper || lower;
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
