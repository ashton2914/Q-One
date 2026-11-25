import type {
  AnnotationKind,
  Dimension,
  GdtSpec,
  GdtSymbol,
  MaterialCondition,
  PointSpec,
} from "../types/project";

export const ANNOTATION_KIND_OPTIONS: Array<{
  value: AnnotationKind;
  label: string;
}> = [
  { value: "linear", label: "Linear" },
  { value: "gdt", label: "GD&T" },
  { value: "note", label: "Note" },
  { value: "datum", label: "Datum" },
  { value: "point", label: "Point" },
];

export interface GdtSymbolOption {
  value: GdtSymbol;
  glyph: string;
  label: string;
  group: "Form" | "Profile" | "Orientation" | "Location" | "Runout";
}

export const GDT_SYMBOL_OPTIONS: GdtSymbolOption[] = [
  { value: "flatness", glyph: "⏥", label: "Flatness", group: "Form" },
  { value: "straightness", glyph: "⏤", label: "Straightness", group: "Form" },
  { value: "circularity", glyph: "○", label: "Circularity", group: "Form" },
  { value: "cylindricity", glyph: "⌭", label: "Cylindricity", group: "Form" },
  {
    value: "profile_line",
    glyph: "⌒",
    label: "Profile of a Line",
    group: "Profile",
  },
  {
    value: "profile_surface",
    glyph: "⌓",
    label: "Profile of a Surface",
    group: "Profile",
  },
  {
    value: "perpendicularity",
    glyph: "⊥",
    label: "Perpendicularity",
    group: "Orientation",
  },
  {
    value: "angularity",
    glyph: "∠",
    label: "Angularity",
    group: "Orientation",
  },
  {
    value: "parallelism",
    glyph: "∥",
    label: "Parallelism",
    group: "Orientation",
  },
  { value: "position", glyph: "⌖", label: "Position", group: "Location" },
  {
    value: "concentricity",
    glyph: "◎",
    label: "Concentricity",
    group: "Location",
  },
  { value: "symmetry", glyph: "⌯", label: "Symmetry", group: "Location" },
  {
    value: "circular_runout",
    glyph: "↗",
    label: "Circular Runout",
    group: "Runout",
  },
  { value: "total_runout", glyph: "⌰", label: "Total Runout", group: "Runout" },
];

export const MATERIAL_CONDITION_OPTIONS: Array<{
  value: MaterialCondition;
  glyph: string;
  label: string;
}> = [
  { value: "", glyph: "", label: "None (RFS)" },
  { value: "MMC", glyph: "Ⓜ", label: "Ⓜ MMC" },
  { value: "LMC", glyph: "Ⓛ", label: "Ⓛ LMC" },
];

export interface GdtApplicability {
  allowDiameterZone: boolean;
  allowMaterialCondition: boolean;
  allowDatums: boolean;
  allowDatumMaterialCondition: boolean;
}

const GDT_RULES: Record<GdtSymbol, GdtApplicability> = {
  flatness: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: false,
    allowDatumMaterialCondition: false,
  },
  straightness: {
    allowDiameterZone: true,
    allowMaterialCondition: true,
    allowDatums: false,
    allowDatumMaterialCondition: false,
  },
  circularity: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: false,
    allowDatumMaterialCondition: false,
  },
  cylindricity: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: false,
    allowDatumMaterialCondition: false,
  },
  profile_line: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: true,
    allowDatumMaterialCondition: true,
  },
  profile_surface: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: true,
    allowDatumMaterialCondition: true,
  },
  perpendicularity: {
    allowDiameterZone: true,
    allowMaterialCondition: true,
    allowDatums: true,
    allowDatumMaterialCondition: true,
  },
  angularity: {
    allowDiameterZone: true,
    allowMaterialCondition: true,
    allowDatums: true,
    allowDatumMaterialCondition: true,
  },
  parallelism: {
    allowDiameterZone: true,
    allowMaterialCondition: true,
    allowDatums: true,
    allowDatumMaterialCondition: true,
  },
  position: {
    allowDiameterZone: true,
    allowMaterialCondition: true,
    allowDatums: true,
    allowDatumMaterialCondition: true,
  },
  concentricity: {
    allowDiameterZone: true,
    allowMaterialCondition: false,
    allowDatums: true,
    allowDatumMaterialCondition: false,
  },
  symmetry: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: true,
    allowDatumMaterialCondition: false,
  },
  circular_runout: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: true,
    allowDatumMaterialCondition: false,
  },
  total_runout: {
    allowDiameterZone: false,
    allowMaterialCondition: false,
    allowDatums: true,
    allowDatumMaterialCondition: false,
  },
};

export function getGdtRules(symbol: GdtSymbol | string): GdtApplicability {
  return GDT_RULES[symbol as GdtSymbol] ?? GDT_RULES.position;
}

export function sanitizeGdtSpec(spec: GdtSpec): GdtSpec {
  const rules = getGdtRules(spec.symbol);
  return {
    ...spec,
    diameterZone: rules.allowDiameterZone ? spec.diameterZone : false,
    materialCondition: rules.allowMaterialCondition
      ? spec.materialCondition
      : "",
    datums: spec.datums.map((d) => ({
      datum: rules.allowDatums ? d.datum : "",
      materialCondition:
        rules.allowDatums && rules.allowDatumMaterialCondition && d.datum
          ? d.materialCondition
          : "",
    })),
  };
}

export function getAnnotationKind(dim: Pick<Dimension, "kind">): AnnotationKind {
  return dim.kind ?? "linear";
}

export function getGdtSymbolGlyph(symbol: GdtSymbol | string): string {
  return GDT_SYMBOL_OPTIONS.find((s) => s.value === symbol)?.glyph ?? "⌖";
}

export function getMaterialConditionGlyph(mc: MaterialCondition | string): string {
  if (mc === "MMC") return "Ⓜ";
  if (mc === "LMC") return "Ⓛ";
  return "";
}

export function createDefaultGdtSpec(): GdtSpec {
  return {
    symbol: "position",
    diameterZone: true,
    tolerance: "",
    materialCondition: "",
    datums: [
      { datum: "", materialCondition: "" },
      { datum: "", materialCondition: "" },
      { datum: "", materialCondition: "" },
    ],
  };
}

export function createDefaultPointSpec(): PointSpec {
  return {
    x: "",
    y: "",
    z: "",
    datums: ["", "", ""],
  };
}

/**
 * Returns the unique, trimmed names of all Datum annotations on the current drawing.
 */
export function getAvailableDatums(dimensions: readonly Dimension[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dim of dimensions) {
    if (getAnnotationKind(dim) !== "datum") continue;
    const name = dim.name.trim();
    if (!name) continue;
    const key = name.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  }
  return result;
}
