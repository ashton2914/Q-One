import {
  GDT_SYMBOL_OPTIONS,
  MATERIAL_CONDITION_OPTIONS,
  createDefaultGdtSpec,
  createDefaultPointSpec,
  getAnnotationKind,
  getGdtRules,
  sanitizeGdtSpec,
} from "./annotations";
import { getAnnotationPage } from "./dimensions";
import { evaluateFormulaInput } from "./mathEval";
import {
  addPointsToGroup,
  hasPointIdCollisionOnPage,
  rebindSamePageLinkedPoints,
  removePointsFromGroups,
} from "./pointGroups";
import type {
  AnnotationKind,
  Dimension,
  DimensionUnit,
  GdtSymbol,
  MarkerPosition,
  MaterialCondition,
  PointGroup,
} from "../types/project";

export type GridCellEditorType =
  | "text"
  | "number"
  | "integer"
  | "select"
  | "boolean"
  | "readonly";

export interface GridSelectOption {
  value: string;
  label: string;
}

export interface AnnotationTableContext {
  pointGroups: readonly PointGroup[];
  allDrawingDimensions: readonly Dimension[];
  pageCount?: number;
}

export interface AnnotationColumnDef {
  key: string;
  label: string;
  width: number;
  minWidth?: number;
  mono?: boolean;
  align?: "left" | "right" | "center";
  /** True when the user can freely type/edit via inline input */
  editable: boolean;
  /** True when paste / fill-down / clear are allowed even if free-text editing is disabled */
  pasteable?: boolean;
  editorType: GridCellEditorType;
  options?: readonly GridSelectOption[];
  getValue: (dim: Dimension, ctx: AnnotationTableContext) => string;
  applyValue?: (
    dim: Dimension,
    rawValue: string,
    ctx: AnnotationTableContext,
  ) => Dimension;
}

export interface GridPosition {
  row: number;
  col: number;
}

export interface GridRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface NormalizedGridRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface CellEdit {
  row: number;
  col: number;
  value: string;
}

const UNIT_OPTIONS: readonly GridSelectOption[] = [
  { value: "", label: "—" },
  { value: "mm", label: "mm" },
  { value: "in", label: "in" },
  { value: "deg", label: "deg" },
];

const GDT_SELECT_OPTIONS: readonly GridSelectOption[] = GDT_SYMBOL_OPTIONS.map(
  (opt) => ({
    value: opt.value,
    label: `${opt.glyph} ${opt.label}`,
  }),
);

const MC_SELECT_OPTIONS: readonly GridSelectOption[] =
  MATERIAL_CONDITION_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.value ? `${opt.glyph} ${opt.value}` : "—",
  }));

const BOOLEAN_SELECT_OPTIONS: readonly GridSelectOption[] = [
  { value: "true", label: "Ø Yes" },
  { value: "false", label: "No" },
];

function evaluateNumericInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("=")) {
    const res = evaluateFormulaInput(trimmed);
    return res !== null ? res : trimmed;
  }
  return trimmed;
}

function evaluateToleranceInput(raw: string): string {
  const evaluated = evaluateNumericInput(raw);
  if (!evaluated) return "";
  // Strip redundant leading "+" while preserving "-" (which indicates inverted tolerance direction)
  return evaluated.startsWith("+") ? evaluated.slice(1) : evaluated;
}

function parseOptionalPositiveInt(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") return 0;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseUnit(raw: string, fallback: DimensionUnit): DimensionUnit {
  const lower = raw.trim().toLowerCase();
  if (!lower || lower === "—") return "";
  if (lower === "mm" || lower === "in" || lower === "deg") return lower;
  return fallback;
}

function parseGdtSymbol(raw: string, fallback: GdtSymbol): GdtSymbol {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  const matched = GDT_SYMBOL_OPTIONS.find(
    (opt) =>
      opt.value === lower ||
      opt.glyph === trimmed ||
      opt.label.toLowerCase() === lower ||
      `${opt.glyph} ${opt.label}`.toLowerCase() === lower,
  );
  return matched ? matched.value : fallback;
}

function parseMaterialCondition(raw: string): MaterialCondition {
  const upper = raw.trim().toUpperCase();
  if (upper === "MMC" || upper.includes("Ⓜ") || upper === "M") return "MMC";
  if (upper === "LMC" || upper.includes("Ⓛ") || upper === "L") return "LMC";
  return "";
}

function parseBooleanInput(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return (
    lower === "true" ||
    lower === "1" ||
    lower === "yes" ||
    lower === "y" ||
    lower === "ø" ||
    lower === "ø yes" ||
    lower === "dia"
  );
}

function resolveLinkedLabels(
  ids: readonly string[] | undefined,
  allDims: readonly Dimension[],
): string {
  if (!ids || ids.length === 0) return "";
  const byId = new Map(allDims.map((d) => [d.id, d]));
  return ids
    .map((id) => byId.get(id)?.name.trim() || "")
    .filter(Boolean)
    .join(", ");
}

function resolvePointGroupName(
  dimId: string,
  pointGroups: readonly PointGroup[],
): string {
  const group = pointGroups.find((g) => g.pointIds.includes(dimId));
  return group ? group.name : "";
}

function updateGdtDatum(
  dim: Dimension,
  index: number,
  rawDatum: string,
): Dimension {
  const base = dim.gdt ? { ...dim.gdt } : createDefaultGdtSpec();
  const datums = [0, 1, 2].map((i) => ({
    datum: base.datums[i]?.datum ?? "",
    materialCondition: base.datums[i]?.materialCondition ?? "",
  }));
  const trimmed = rawDatum.trim();
  // Allow shorthand like "A M" or "A Ⓜ"
  let datumName = trimmed;
  let mc: MaterialCondition = datums[index].materialCondition;
  if (trimmed.includes("Ⓜ") || /\s+MMC$/i.test(trimmed)) {
    datumName = trimmed.replace(/Ⓜ|\s+MMC$/gi, "").trim();
    mc = "MMC";
  } else if (trimmed.includes("Ⓛ") || /\s+LMC$/i.test(trimmed)) {
    datumName = trimmed.replace(/Ⓛ|\s+LMC$/gi, "").trim();
    mc = "LMC";
  } else if (!trimmed) {
    mc = "";
  }
  datums[index] = { datum: datumName, materialCondition: mc };
  return {
    ...dim,
    gdt: sanitizeGdtSpec({ ...base, datums }),
  };
}

function updatePointDatum(
  dim: Dimension,
  index: number,
  rawDatum: string,
): Dimension {
  const base = dim.point ? { ...dim.point } : createDefaultPointSpec();
  const datums = [
    base.datums[0] ?? "",
    base.datums[1] ?? "",
    base.datums[2] ?? "",
  ];
  datums[index] = rawDatum.trim();
  return {
    ...dim,
    point: { ...base, datums },
  };
}

const ID_COL: AnnotationColumnDef = {
  key: "name",
  label: "ID",
  width: 96,
  minWidth: 64,
  mono: true,
  editable: true,
  editorType: "text",
  getValue: (dim) => dim.name,
  applyValue: (dim, raw) => ({ ...dim, name: raw.trim() }),
};

const TYPE_COL: AnnotationColumnDef = {
  key: "dimensionType",
  label: "Type",
  width: 84,
  minWidth: 60,
  mono: true,
  editable: true,
  editorType: "text",
  getValue: (dim) => dim.dimensionType ?? "",
  applyValue: (dim, raw) => ({
    ...dim,
    dimensionType: raw.trim().toUpperCase(),
  }),
};

function resolveExistingLinkedPointIds(
  raw: string,
  dim: Dimension,
  ctx: AnnotationTableContext,
): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") return [];
  const tokens = trimmed
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const dimPage = getAnnotationPage(dim);
  const allPoints = ctx.allDrawingDimensions.filter(
    (d) => getAnnotationKind(d) === "point",
  );
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const lower = token.toLowerCase();
    // 1. Match existing Point Group by name (prefer same page)
    const matchedGroup =
      ctx.pointGroups.find(
        (g) => g.page === dimPage && g.name.trim().toLowerCase() === lower,
      ) ??
      ctx.pointGroups.find((g) => g.name.trim().toLowerCase() === lower);
    if (matchedGroup) {
      for (const pid of matchedGroup.pointIds) {
        if (!seen.has(pid)) {
          seen.add(pid);
          resolved.push(pid);
        }
      }
      continue;
    }

    // 2. Match existing Point by ID/name (prefer same page)
    const matchedPoint =
      allPoints.find(
        (p) =>
          getAnnotationPage(p) === dimPage &&
          p.name.trim().toLowerCase() === lower,
      ) ?? allPoints.find((p) => p.name.trim().toLowerCase() === lower);
    if (matchedPoint && !seen.has(matchedPoint.id)) {
      seen.add(matchedPoint.id);
      resolved.push(matchedPoint.id);
    }
  }

  return resolved.length > 0 ? resolved : null;
}

function resolveExistingLinkedNoteIds(
  raw: string,
  dim: Dimension,
  ctx: AnnotationTableContext,
): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") return [];
  const tokens = trimmed
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const dimPage = getAnnotationPage(dim);
  const allNotes = ctx.allDrawingDimensions.filter(
    (d) => getAnnotationKind(d) === "note",
  );
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const matchedNote =
      allNotes.find(
        (n) =>
          getAnnotationPage(n) === dimPage &&
          n.name.trim().toLowerCase() === lower,
      ) ?? allNotes.find((n) => n.name.trim().toLowerCase() === lower);
    if (matchedNote && !seen.has(matchedNote.id)) {
      seen.add(matchedNote.id);
      resolved.push(matchedNote.id);
    }
  }

  return resolved.length > 0 ? resolved : null;
}

function parseExistingPageValue(
  raw: string,
  pageCount: number | undefined,
): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") return null;
  const match = /^p?\s*(\d+)$/i.exec(trimmed);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  if (pageCount !== undefined && pageCount >= 1 && parsed > pageCount) {
    return undefined;
  }
  return parsed;
}

export function formatMarkerPosition(marker: MarkerPosition | null): string {
  if (!marker) return "";
  const xPct = (marker.x * 100).toFixed(2);
  const yPct = (marker.y * 100).toFixed(2);
  if (marker.width > 0 || marker.height > 0) {
    const wPct = (marker.width * 100).toFixed(2);
    const hPct = (marker.height * 100).toFixed(2);
    return `P${marker.page} (${xPct}%, ${yPct}%, ${wPct}%×${hPct}%)`;
  }
  return `P${marker.page} (${xPct}%, ${yPct}%)`;
}

export function parseMarkerPosition(
  raw: string,
  drawingId: string | null,
  pageCount?: number,
): MarkerPosition | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") return null;
  if (!drawingId) return undefined;

  const boxMatch =
    /^P\s*(\d+)\s*\(\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*[×xX]\s*(-?\d+(?:\.\d+)?)%\s*\)$/i.exec(
      trimmed,
    );
  if (boxMatch) {
    const page = Number.parseInt(boxMatch[1], 10);
    const x = Number.parseFloat(boxMatch[2]) / 100;
    const y = Number.parseFloat(boxMatch[3]) / 100;
    const width = Number.parseFloat(boxMatch[4]) / 100;
    const height = Number.parseFloat(boxMatch[5]) / 100;
    if (
      !Number.isFinite(page) ||
      page < 1 ||
      (pageCount !== undefined && pageCount >= 1 && page > pageCount) ||
      ![x, y, width, height].every(Number.isFinite)
    ) {
      return undefined;
    }
    return {
      drawingId,
      page,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Math.max(0, Math.min(1, width)),
      height: Math.max(0, Math.min(1, height)),
    };
  }

  const ptMatch =
    /^P\s*(\d+)\s*\(\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/i.exec(
      trimmed,
    );
  if (ptMatch) {
    const page = Number.parseInt(ptMatch[1], 10);
    const x = Number.parseFloat(ptMatch[2]) / 100;
    const y = Number.parseFloat(ptMatch[3]) / 100;
    if (
      !Number.isFinite(page) ||
      page < 1 ||
      (pageCount !== undefined && pageCount >= 1 && page > pageCount) ||
      ![x, y].every(Number.isFinite)
    ) {
      return undefined;
    }
    return {
      drawingId,
      page,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: 0,
      height: 0,
    };
  }

  return undefined;
}

const POSITION_COL: AnnotationColumnDef = {
  key: "markerPosition",
  label: "Position",
  width: 192,
  minWidth: 120,
  mono: true,
  editable: false,
  pasteable: true,
  editorType: "readonly",
  getValue: (dim) => formatMarkerPosition(dim.marker),
  applyValue: (dim, raw, ctx) => {
    const drawingId = dim.drawingId ?? dim.marker?.drawingId ?? null;
    const parsed = parseMarkerPosition(raw, drawingId, ctx.pageCount);
    if (parsed === undefined) return dim;
    if (parsed === null) {
      return { ...dim, marker: null };
    }
    return {
      ...dim,
      page: parsed.page,
      marker: parsed,
    };
  },
};

const PAGE_COL: AnnotationColumnDef = {
  key: "page",
  label: "Page",
  width: 68,
  minWidth: 52,
  mono: true,
  align: "center",
  editable: false,
  pasteable: true,
  editorType: "readonly",
  getValue: (dim) => {
    const p = getAnnotationPage(dim);
    return p !== null ? `P${p}` : "—";
  },
  applyValue: (dim, raw, ctx) => {
    const nextPage = parseExistingPageValue(raw, ctx.pageCount);
    if (nextPage === undefined) return dim;
    if (nextPage === null) {
      return { ...dim, page: null };
    }
    return {
      ...dim,
      page: nextPage,
      marker: dim.marker ? { ...dim.marker, page: nextPage } : null,
    };
  },
};

const QTY_COL: AnnotationColumnDef = {
  key: "quantity",
  label: "Qty",
  width: 58,
  minWidth: 48,
  mono: true,
  align: "right",
  editable: true,
  editorType: "integer",
  getValue: (dim) => (dim.quantity > 0 ? String(dim.quantity) : ""),
  applyValue: (dim, raw) => ({
    ...dim,
    quantity: parseOptionalPositiveInt(raw, dim.quantity ?? 0),
  }),
};

const UNIT_COL: AnnotationColumnDef = {
  key: "unit",
  label: "Unit",
  width: 68,
  minWidth: 56,
  mono: true,
  align: "center",
  editable: true,
  editorType: "select",
  options: UNIT_OPTIONS,
  getValue: (dim) => dim.unit,
  applyValue: (dim, raw) => ({
    ...dim,
    unit: parseUnit(raw, dim.unit),
  }),
};

const LINKED_POINTS_COL: AnnotationColumnDef = {
  key: "linkedPoints",
  label: "Linked Points",
  width: 140,
  minWidth: 90,
  mono: true,
  editable: false,
  pasteable: true,
  editorType: "readonly",
  getValue: (dim, ctx) =>
    resolveLinkedLabels(dim.linkedPointIds, ctx.allDrawingDimensions),
  applyValue: (dim, raw, ctx) => {
    const nextIds = resolveExistingLinkedPointIds(raw, dim, ctx);
    if (nextIds === null) return dim;
    return { ...dim, linkedPointIds: nextIds };
  },
};

const LINKED_NOTES_COL: AnnotationColumnDef = {
  key: "linkedNotes",
  label: "Linked Notes",
  width: 120,
  minWidth: 84,
  mono: true,
  editable: false,
  pasteable: true,
  editorType: "readonly",
  getValue: (dim, ctx) =>
    resolveLinkedLabels(dim.linkedNoteIds, ctx.allDrawingDimensions),
  applyValue: (dim, raw, ctx) => {
    const nextIds = resolveExistingLinkedNoteIds(raw, dim, ctx);
    if (nextIds === null) return dim;
    return { ...dim, linkedNoteIds: nextIds };
  },
};

const NOTES_COL: AnnotationColumnDef = {
  key: "notes",
  label: "Notes",
  width: 220,
  minWidth: 100,
  editable: true,
  editorType: "text",
  getValue: (dim) => dim.notes,
  applyValue: (dim, raw) => ({ ...dim, notes: raw }),
};

export function getColumnsForKind(
  kind: AnnotationKind,
): readonly AnnotationColumnDef[] {
  switch (kind) {
    case "linear":
      return [
        ID_COL,
        TYPE_COL,
        PAGE_COL,
        POSITION_COL,
        QTY_COL,
        {
          key: "nominal",
          label: "Nominal",
          width: 104,
          minWidth: 72,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.nominal,
          applyValue: (dim, raw) => ({
            ...dim,
            nominal: evaluateNumericInput(raw),
          }),
        },
        {
          key: "upperTol",
          label: "+Tol",
          width: 88,
          minWidth: 64,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.upperTol,
          applyValue: (dim, raw) => ({
            ...dim,
            upperTol: evaluateToleranceInput(raw),
          }),
        },
        {
          key: "lowerTol",
          label: "-Tol",
          width: 88,
          minWidth: 64,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.lowerTol,
          applyValue: (dim, raw) => ({
            ...dim,
            lowerTol: evaluateToleranceInput(raw),
          }),
        },
        UNIT_COL,
        LINKED_POINTS_COL,
        LINKED_NOTES_COL,
        NOTES_COL,
      ];

    case "gdt":
      return [
        ID_COL,
        TYPE_COL,
        PAGE_COL,
        POSITION_COL,
        QTY_COL,
        {
          key: "gdtSymbol",
          label: "Symbol",
          width: 152,
          minWidth: 110,
          editable: true,
          editorType: "select",
          options: GDT_SELECT_OPTIONS,
          getValue: (dim) => dim.gdt?.symbol ?? "position",
          applyValue: (dim, raw) => {
            const base = dim.gdt ? { ...dim.gdt } : createDefaultGdtSpec();
            const symbol = parseGdtSymbol(raw, base.symbol);
            return {
              ...dim,
              gdt: sanitizeGdtSpec({ ...base, symbol }),
            };
          },
        },
        {
          key: "gdtDiameter",
          label: "Ø Zone",
          width: 72,
          minWidth: 60,
          mono: true,
          align: "center",
          editable: true,
          editorType: "boolean",
          options: BOOLEAN_SELECT_OPTIONS,
          getValue: (dim) => {
            const spec = dim.gdt ?? createDefaultGdtSpec();
            if (!getGdtRules(spec.symbol).allowDiameterZone) return "";
            return spec.diameterZone ? "true" : "false";
          },
          applyValue: (dim, raw) => {
            const base = dim.gdt ? { ...dim.gdt } : createDefaultGdtSpec();
            if (!getGdtRules(base.symbol).allowDiameterZone) return dim;
            return {
              ...dim,
              gdt: sanitizeGdtSpec({
                ...base,
                diameterZone: parseBooleanInput(raw),
              }),
            };
          },
        },
        {
          key: "gdtTolerance",
          label: "Tolerance",
          width: 96,
          minWidth: 70,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.gdt?.tolerance ?? "",
          applyValue: (dim, raw) => {
            const base = dim.gdt ? { ...dim.gdt } : createDefaultGdtSpec();
            return {
              ...dim,
              gdt: sanitizeGdtSpec({
                ...base,
                tolerance: evaluateNumericInput(raw),
              }),
            };
          },
        },
        {
          key: "gdtMc",
          label: "MC",
          width: 74,
          minWidth: 58,
          mono: true,
          align: "center",
          editable: true,
          editorType: "select",
          options: MC_SELECT_OPTIONS,
          getValue: (dim) => {
            const spec = dim.gdt ?? createDefaultGdtSpec();
            if (!getGdtRules(spec.symbol).allowMaterialCondition) return "";
            return spec.materialCondition;
          },
          applyValue: (dim, raw) => {
            const base = dim.gdt ? { ...dim.gdt } : createDefaultGdtSpec();
            if (!getGdtRules(base.symbol).allowMaterialCondition) return dim;
            return {
              ...dim,
              gdt: sanitizeGdtSpec({
                ...base,
                materialCondition: parseMaterialCondition(raw),
              }),
            };
          },
        },
        {
          key: "gdtDatum1",
          label: "Datum 1",
          width: 82,
          minWidth: 64,
          mono: true,
          align: "center",
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.gdt?.datums[0]?.datum ?? "",
          applyValue: (dim, raw) => updateGdtDatum(dim, 0, raw),
        },
        {
          key: "gdtDatum2",
          label: "Datum 2",
          width: 82,
          minWidth: 64,
          mono: true,
          align: "center",
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.gdt?.datums[1]?.datum ?? "",
          applyValue: (dim, raw) => updateGdtDatum(dim, 1, raw),
        },
        {
          key: "gdtDatum3",
          label: "Datum 3",
          width: 82,
          minWidth: 64,
          mono: true,
          align: "center",
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.gdt?.datums[2]?.datum ?? "",
          applyValue: (dim, raw) => updateGdtDatum(dim, 2, raw),
        },
        UNIT_COL,
        LINKED_POINTS_COL,
        LINKED_NOTES_COL,
        NOTES_COL,
      ];

    case "non_dimensional":
      return [
        ID_COL,
        TYPE_COL,
        PAGE_COL,
        POSITION_COL,
        QTY_COL,
        {
          key: "nominal",
          label: "Specification",
          width: 220,
          minWidth: 120,
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.nominal,
          applyValue: (dim, raw) => ({ ...dim, nominal: raw }),
        },
        LINKED_POINTS_COL,
        LINKED_NOTES_COL,
        NOTES_COL,
      ];

    case "note":
      return [
        ID_COL,
        PAGE_COL,
        POSITION_COL,
        {
          key: "notes",
          label: "Note Content",
          width: 460,
          minWidth: 180,
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.notes,
          applyValue: (dim, raw) => ({ ...dim, notes: raw }),
        },
      ];

    case "datum":
      return [
        ID_COL,
        PAGE_COL,
        POSITION_COL,
        {
          key: "notes",
          label: "Description",
          width: 380,
          minWidth: 160,
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.notes,
          applyValue: (dim, raw) => ({ ...dim, notes: raw }),
        },
      ];

    case "point":
      return [
        ID_COL,
        PAGE_COL,
        POSITION_COL,
        {
          key: "pointGroup",
          label: "Group",
          width: 112,
          minWidth: 80,
          mono: true,
          editable: false,
          pasteable: true,
          editorType: "readonly",
          getValue: (dim, ctx) => resolvePointGroupName(dim.id, ctx.pointGroups),
        },
        {
          key: "pointX",
          label: "X",
          width: 92,
          minWidth: 68,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.point?.x ?? "",
          applyValue: (dim, raw) => {
            const base = dim.point ? { ...dim.point } : createDefaultPointSpec();
            return { ...dim, point: { ...base, x: evaluateNumericInput(raw) } };
          },
        },
        {
          key: "pointY",
          label: "Y",
          width: 92,
          minWidth: 68,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.point?.y ?? "",
          applyValue: (dim, raw) => {
            const base = dim.point ? { ...dim.point } : createDefaultPointSpec();
            return { ...dim, point: { ...base, y: evaluateNumericInput(raw) } };
          },
        },
        {
          key: "pointZ",
          label: "Z",
          width: 92,
          minWidth: 68,
          mono: true,
          align: "right",
          editable: true,
          editorType: "number",
          getValue: (dim) => dim.point?.z ?? "",
          applyValue: (dim, raw) => {
            const base = dim.point ? { ...dim.point } : createDefaultPointSpec();
            return { ...dim, point: { ...base, z: evaluateNumericInput(raw) } };
          },
        },
        {
          key: "pointDatum1",
          label: "Datum 1",
          width: 82,
          minWidth: 64,
          mono: true,
          align: "center",
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.point?.datums[0] ?? "",
          applyValue: (dim, raw) => updatePointDatum(dim, 0, raw),
        },
        {
          key: "pointDatum2",
          label: "Datum 2",
          width: 82,
          minWidth: 64,
          mono: true,
          align: "center",
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.point?.datums[1] ?? "",
          applyValue: (dim, raw) => updatePointDatum(dim, 1, raw),
        },
        {
          key: "pointDatum3",
          label: "Datum 3",
          width: 82,
          minWidth: 64,
          mono: true,
          align: "center",
          editable: true,
          editorType: "text",
          getValue: (dim) => dim.point?.datums[2] ?? "",
          applyValue: (dim, raw) => updatePointDatum(dim, 2, raw),
        },
        NOTES_COL,
      ];
  }
}

export function normalizeGridRange(range: GridRange): NormalizedGridRange {
  return {
    r1: Math.min(range.startRow, range.endRow),
    c1: Math.min(range.startCol, range.endCol),
    r2: Math.max(range.startRow, range.endRow),
    c2: Math.max(range.startCol, range.endCol),
  };
}

export function formatCellDisplayValue(
  col: AnnotationColumnDef,
  rawValue: string,
): string {
  if (!rawValue) return "";
  if (col.editorType === "select" && col.options) {
    const matched = col.options.find((opt) => opt.value === rawValue);
    if (matched) return matched.label;
  }
  if (col.editorType === "boolean") {
    return rawValue === "true" ? "Ø" : "";
  }
  return rawValue;
}

export function buildGridTsv(
  rows: readonly (readonly string[])[],
  rowIndices: readonly number[],
  colIndices: readonly number[],
  columnHeaders?: readonly string[],
): string {
  const lines: string[] = [];
  if (columnHeaders) {
    lines.push(colIndices.map((c) => columnHeaders[c] ?? "").join("\t"));
  }
  for (const r of rowIndices) {
    const row = rows[r];
    if (!row) continue;
    lines.push(colIndices.map((c) => row[c] ?? "").join("\t"));
  }
  return lines.join("\n");
}

export function parseClipboardTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  // Drop a single trailing newline commonly added by spreadsheets
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  return rawLines.map((line) => line.split("\t"));
}

/**
 * Computes cell edits for pasting a TSV matrix into the grid (Excel behavior):
 * - Single cell (1×1) pasted into a multi-cell range fills every cell in that range.
 * - Multi-cell block (M×N) pasted into a larger target range (R×C) tiles/repeats the
 *   copied block across the entire target range.
 * - Multi-cell block (M×N) pasted onto a single cell or smaller range expands from the
 *   top-left of the selection to paste the full M×N block (clamped to grid bounds).
 */
export function computePasteEdits(
  matrix: readonly (readonly string[])[],
  anchor: GridPosition,
  selectionRange: GridRange | null,
  rowCount: number,
  colCount: number,
): CellEdit[] {
  if (matrix.length === 0 || rowCount <= 0 || colCount <= 0) return [];
  const srcRows = matrix.length;
  const srcCols = Math.max(1, ...matrix.map((line) => line.length));

  const norm = selectionRange ? normalizeGridRange(selectionRange) : null;
  const startRow = norm ? norm.r1 : anchor.row;
  const startCol = norm ? norm.c1 : anchor.col;
  const targetRows = norm ? norm.r2 - norm.r1 + 1 : 1;
  const targetCols = norm ? norm.c2 - norm.c1 + 1 : 1;

  const fillRows = Math.max(targetRows, srcRows);
  const fillCols = Math.max(targetCols, srcCols);

  const edits: CellEdit[] = [];
  for (let dr = 0; dr < fillRows; dr++) {
    const targetRow = startRow + dr;
    if (targetRow < 0 || targetRow >= rowCount) continue;
    const srcLine = matrix[dr % srcRows] ?? [];
    for (let dc = 0; dc < fillCols; dc++) {
      const targetCol = startCol + dc;
      if (targetCol < 0 || targetCol >= colCount) continue;
      const value = srcLine[dc % srcLine.length] ?? "";
      edits.push({ row: targetRow, col: targetCol, value });
    }
  }
  return edits;
}

export interface ApplyEditsResult {
  updatedDimensions: Dimension[];
  updatedPointGroups: PointGroup[];
  changedCount: number;
  skippedDuplicatePointIds: string[];
}

/**
 * Applies a batch of spreadsheet cell edits to the full drawing dimensions list
 * (and point groups when pasting into the `pointGroup` column).
 * Enforces same-page Point ID uniqueness and validates paste-only columns against existing entities.
 */
export function applyTableCellEdits(
  allDrawingDimensions: readonly Dimension[],
  visibleCategoryRows: readonly Dimension[],
  columns: readonly AnnotationColumnDef[],
  edits: readonly CellEdit[],
  pointGroups: readonly PointGroup[] = [],
  pageCount?: number,
): ApplyEditsResult {
  const working = allDrawingDimensions.map((d) => d);
  let workingGroups: PointGroup[] = pointGroups.map((g) => g);
  const indexById = new Map(working.map((d, i) => [d.id, i]));
  let changedCount = 0;
  const skippedDuplicatePointIds: string[] = [];

  for (const edit of edits) {
    const rowDim = visibleCategoryRows[edit.row];
    const col = columns[edit.col];
    if (!rowDim || !col) continue;
    if (!col.editable && !col.pasteable) continue;
    const fullIdx = indexById.get(rowDim.id);
    if (fullIdx === undefined) continue;

    const current = working[fullIdx];

    // Special case: pasting/clearing `pointGroup` updates pointGroups membership against existing groups
    if (col.key === "pointGroup") {
      const dimsById = new Map(working.map((d) => [d.id, d]));
      const trimmed = edit.value.trim();
      if (!trimmed || trimmed === "—") {
        const nextGroups = removePointsFromGroups(
          workingGroups,
          [current.id],
          dimsById,
        );
        if (nextGroups !== workingGroups) {
          workingGroups = nextGroups;
          changedCount += 1;
        }
        continue;
      }
      const ptPage = getAnnotationPage(current);
      const targetGroup =
        workingGroups.find(
          (g) =>
            g.page === ptPage &&
            g.name.trim().toLowerCase() === trimmed.toLowerCase(),
        ) ?? null;
      if (targetGroup && !targetGroup.pointIds.includes(current.id)) {
        const nextGroups = addPointsToGroup(
          workingGroups,
          targetGroup.id,
          [current.id],
          dimsById,
        );
        if (nextGroups !== workingGroups) {
          workingGroups = nextGroups;
          changedCount += 1;
        }
      }
      continue;
    }

    if (!col.applyValue) continue;
    const ctx: AnnotationTableContext = {
      pointGroups: workingGroups,
      allDrawingDimensions: working,
      pageCount,
    };
    const next = col.applyValue(current, edit.value, ctx);

    // Enforce same-page Point ID uniqueness
    if (
      col.key === "name" &&
      getAnnotationKind(next) === "point" &&
      next.name.trim()
    ) {
      const page = getAnnotationPage(next);
      if (page !== null) {
        const otherNamesOnPage = working
          .filter(
            (d) =>
              d.id !== next.id &&
              getAnnotationKind(d) === "point" &&
              getAnnotationPage(d) === page,
          )
          .map((d) => d.name);
        if (hasPointIdCollisionOnPage(next.name, otherNamesOnPage)) {
          skippedDuplicatePointIds.push(next.name.trim());
          continue;
        }
      }
    }

    if (next !== current) {
      working[fullIdx] = next;
      changedCount += 1;
    }
  }

  const reboundDimensions = rebindSamePageLinkedPoints(working);
  return {
    updatedDimensions: reboundDimensions,
    updatedPointGroups: workingGroups,
    changedCount,
    skippedDuplicatePointIds,
  };
}
