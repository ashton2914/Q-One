export type DimensionUnit = "mm" | "in" | "deg";

export type ActiveModule = "project" | "drawing";

export type AnnotationKind = "linear" | "gdt" | "note" | "datum" | "point";

export type GdtSymbol =
  | "flatness"
  | "straightness"
  | "circularity"
  | "cylindricity"
  | "profile_line"
  | "profile_surface"
  | "perpendicularity"
  | "angularity"
  | "parallelism"
  | "position"
  | "concentricity"
  | "symmetry"
  | "circular_runout"
  | "total_runout";

export type MaterialCondition = "" | "MMC" | "LMC" | "RFS";

export interface GdtDatumRef {
  datum: string;
  materialCondition: MaterialCondition;
}

export interface GdtSpec {
  symbol: GdtSymbol;
  diameterZone: boolean;
  tolerance: string;
  materialCondition: MaterialCondition;
  datums: GdtDatumRef[];
}

export interface PointSpec {
  x: string;
  y: string;
  z: string;
  datums: string[];
}

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
  kind?: AnnotationKind;
  balloonNumber: number;
  dimensionType: string;
  name: string;
  quantity: number;
  nominal: string;
  upperTol: string;
  lowerTol: string;
  unit: DimensionUnit;
  notes: string;
  gdt?: GdtSpec | null;
  point?: PointSpec | null;
  linkedPointIds?: string[];
  linkedNoteIds?: string[];
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
  latestDrawingId?: string | null;
}

export interface DrawingEntry {
  id: string;
  version?: string;
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
