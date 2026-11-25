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
