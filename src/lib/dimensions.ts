import type { Dimension, ProjectData } from "../types/project";

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

export function createDimension(existing: readonly Dimension[]): Dimension {
  return {
    id: generateId(),
    balloonNumber: nextBalloonNumber(existing),
    name: "",
    nominal: "",
    upperTol: "",
    lowerTol: "",
    unit: "mm",
    notes: "",
    marker: null,
  };
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
