export type DimensionUnit = "mm" | "in" | "deg";

export type ActiveModule = "project" | "drawing";

export interface MarkerPosition {
  drawingId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Dimension {
  id: string;
  drawingId: string | null;
  balloonNumber: number;
  dimensionType: string;
  name: string;
  quantity: number;
  nominal: string;
  upperTol: string;
  lowerTol: string;
  unit: DimensionUnit;
  notes: string;
  marker: MarkerPosition | null;
}

export interface Part {
  id: string;
  parentId: string | null;
  name: string;
  partNumber: string;
  revision: string;
  notes: string;
  drawingIds: string[];
}

export interface DrawingEntry {
  id: string;
  filename: string;
  archivePath: string;
  pageCount: number;
}

export interface ProjectData {
  schemaVersion: number;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  parts: Part[];
  drawings: DrawingEntry[];
  dimensions: Dimension[];
}

export interface ImportedPdfPayload {
  drawingId: string;
  filename: string;
  pdfBytes: Uint8Array;
}

export interface OpenedProjectPayload {
  project: ProjectData;
  activeDrawingId: string | null;
  pdfBytes: Uint8Array | null;
}
