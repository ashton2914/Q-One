export type DimensionUnit = "" | "mm" | "in" | "deg";

export type ActiveModule = "project" | "drawing" | "annotations";

export type AnnotationKind =
  | "linear"
  | "gdt"
  | "non_dimensional"
  | "note"
  | "datum"
  | "point";

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
  /** Annotation revision (copy) within the drawing; defaults to the drawing's Latest revision. */
  annotationRevisionId?: string | null;
  /** Target/owning page for this annotation (persists across unmarked/redraw states) */
  page?: number | null;
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

export interface AnnotationRevision {
  id: string;
  name: string;
  createdAt: string;
}

export interface DrawingEntry {
  id: string;
  version?: string;
  filename: string;
  archivePath: string;
  pageCount: number;
  annotationRevisions?: AnnotationRevision[];
  latestAnnotationRevisionId?: string | null;
}

export interface PointGroupCalibration {
  /** Normalized [0..1] X coordinate of the vertical X=0 reference line */
  xZero: number | null;
  /** Normalized [0..1] Y coordinate of the horizontal Y=0 reference line */
  yZero: number | null;
  /** Normalized [0..1] X coordinate of the calibration anchor point */
  anchorX: number | null;
  /** Normalized [0..1] Y coordinate of the calibration anchor point */
  anchorY: number | null;
  /** Real-world X value of the anchor relative to X=0 */
  anchorValX: string;
  /** Real-world Y value of the anchor relative to Y=0 */
  anchorValY: string;
}

export interface PointGroup {
  id: string;
  drawingId: string;
  /** Annotation revision (copy) within the drawing; defaults to the drawing's Latest revision. */
  annotationRevisionId?: string | null;
  page: number;
  name: string;
  pointIds: string[];
  collapsed?: boolean;
  /** Saved Point Entry tool calibration settings so the user can resume adding points */
  calibration?: PointGroupCalibration | null;
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
  pointGroups?: PointGroup[];
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
