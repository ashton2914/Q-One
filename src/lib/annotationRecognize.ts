import type {
  AnnotationKind,
  Dimension,
  GdtDatumRef,
  GdtSpec,
  GdtSymbol,
  MaterialCondition,
  PointSpec,
} from "../types/project";
import {
  createDefaultGdtSpec,
  createDefaultPointSpec,
  sanitizeGdtSpec,
} from "./annotations";

export interface PositionedTextItem {
  str: string;
  /** Normalized [0..1] left coordinate in viewport space */
  x: number;
  /** Normalized [0..1] top coordinate in viewport space */
  y: number;
  /** Normalized [0..1] width */
  width: number;
  /** Normalized [0..1] height */
  height: number;
}

/**
 * Groups positioned PDF text items inside a marker box into reading-order lines.
 */
export function reconstructTextLines(
  items: readonly PositionedTextItem[],
): string[] {
  const nonEmpty = items.filter((item) => item.str.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  const sorted = [...nonEmpty].sort((a, b) => {
    const lineTol = Math.max(a.height, b.height, 0.006) * 0.55;
    if (Math.abs(a.y - b.y) > lineTol) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const lines: Array<{ y: number; h: number; parts: PositionedTextItem[] }> = [];
  for (const item of sorted) {
    const prev = lines[lines.length - 1];
    const lineTol = prev
      ? Math.max(prev.h, item.height, 0.006) * 0.55
      : 0;
    if (prev && Math.abs(item.y - prev.y) <= lineTol) {
      prev.parts.push(item);
      prev.h = Math.max(prev.h, item.height);
    } else {
      lines.push({ y: item.y, h: item.height, parts: [item] });
    }
  }

  return lines
    .map((line) => {
      line.parts.sort((a, b) => a.x - b.x);
      let out = "";
      for (let i = 0; i < line.parts.length; i += 1) {
        const cur = line.parts[i];
        const prev = i > 0 ? line.parts[i - 1] : null;
        if (prev) {
          const prevRight = prev.x + prev.width;
          const gap = cur.x - prevRight;
          const charWidth =
            prev.str.length > 0 ? prev.width / prev.str.length : 0.004;
          const needsSpace =
            gap > Math.max(charWidth * 0.28, 0.0015) &&
            !out.endsWith(" ") &&
            !cur.str.startsWith(" ");
          if (needsSpace) {
            out += " ";
          }
        }
        out += cur.str;
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

const KNOWN_DIM_TYPES = new Set([
  "CTF",
  "CTQ",
  "SPC",
  "REF",
  "KEY",
  "KPC",
  "CPK",
  "FAI",
  "SC",
  "CC",
]);

const GDT_GLYPH_MAP: Array<{ pattern: RegExp; symbol: GdtSymbol }> = [
  { pattern: /[⏥▱]/, symbol: "flatness" },
  { pattern: /[⏤⎯]/, symbol: "straightness" },
  { pattern: /[○◯]/, symbol: "circularity" },
  { pattern: /⌭/, symbol: "cylindricity" },
  { pattern: /⌒/, symbol: "profile_line" },
  { pattern: /⌓/, symbol: "profile_surface" },
  { pattern: /[⊥⟂]/, symbol: "perpendicularity" },
  { pattern: /∠/, symbol: "angularity" },
  { pattern: /[∥‖]/, symbol: "parallelism" },
  { pattern: /[⌖⊕]/, symbol: "position" },
  { pattern: /◎/, symbol: "concentricity" },
  { pattern: /⌯/, symbol: "symmetry" },
  { pattern: /↗/, symbol: "circular_runout" },
  { pattern: /⌰/, symbol: "total_runout" },
];

const GDT_KEYWORD_MAP: Array<{ pattern: RegExp; symbol: GdtSymbol }> = [
  { pattern: /\bFLATNESS\b/i, symbol: "flatness" },
  { pattern: /\bSTRAIGHTNESS\b/i, symbol: "straightness" },
  { pattern: /\bCIRCULARITY\b|\bROUNDNESS\b/i, symbol: "circularity" },
  { pattern: /\bCYLINDRICITY\b/i, symbol: "cylindricity" },
  { pattern: /\bPROFILE\s+OF\s+A?\s*LINE\b/i, symbol: "profile_line" },
  { pattern: /\bPROFILE\b/i, symbol: "profile_surface" },
  { pattern: /\bPERPENDICULARITY\b/i, symbol: "perpendicularity" },
  { pattern: /\bANGULARITY\b/i, symbol: "angularity" },
  { pattern: /\bPARALLELISM\b/i, symbol: "parallelism" },
  { pattern: /\bTRUE\s+POSITION\b|\bPOSITION\b/i, symbol: "position" },
  { pattern: /\bCONCENTRICITY\b/i, symbol: "concentricity" },
  { pattern: /\bSYMMETRY\b/i, symbol: "symmetry" },
  { pattern: /\bTOTAL\s+RUNOUT\b/i, symbol: "total_runout" },
  { pattern: /\bRUNOUT\b/i, symbol: "circular_runout" },
];

function normalizeParsedTolerance(raw: string, side: "upper" | "lower"): string {
  const cleaned = raw.replace(/\s+/g, "").replace(/−/g, "-");
  if (!cleaned) return "";
  const isNegative = cleaned.startsWith("-");
  const isPositive = cleaned.startsWith("+");
  const mag = cleaned.replace(/^[+-]/, "");
  if (!mag) return "";

  if (side === "upper") {
    // +Tol stores positive for +x, negative for -x
    return isNegative ? `-${mag}` : mag;
  }
  // -Tol stores positive for -x (or unsigned x), negative for +x
  return isPositive ? `-${mag}` : mag;
}

function parseMaterialConditionToken(token: string): MaterialCondition {
  const t = token.trim().toUpperCase();
  if (t === "Ⓜ" || t === "(M)" || t === "MMC") return "MMC";
  if (t === "Ⓛ" || t === "(L)" || t === "LMC") return "LMC";
  return "";
}

function parseNoteFromLines(lines: readonly string[]): Partial<Dimension> {
  const fullText = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!fullText) return {};

  // Match leading note IDs such as "3-1 ", "2-1.", "N1:", "1. ", "12) "
  const m = fullText.match(
    /^([A-Za-z]?\d+(?:-\d+)?[A-Za-z]?)(?:[.):\]]\s*|\s+)(.+)$/,
  );
  if (m) {
    return {
      name: m[1].trim(),
      notes: m[2].trim(),
    };
  }

  return { notes: fullText };
}

function parseDatumFromLines(lines: readonly string[]): Partial<Dimension> {
  const fullText = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!fullText) return {};

  // Match "DATUM A", "-A-", "[A]", or leading standalone uppercase letter "A ..."
  const explicit = fullText.match(
    /^(?:DATUM\s+)?[-|[\]()\s]*([A-Z]{1,2})[-|[\]()\s]*(.*)$/i,
  );
  if (explicit) {
    const datumName = explicit[1].toUpperCase();
    const rest = explicit[2].replace(/^[:\-–—\s]+/, "").trim();
    const patch: Partial<Dimension> = { name: datumName };
    if (rest) patch.notes = rest;
    return patch;
  }

  return { name: fullText.toUpperCase() };
}

function extractLeadingTypeAndTrailingId(text: string): {
  dimensionType?: string;
  id?: string;
  cleaned: string;
} {
  let working = text.trim();
  let dimensionType: string | undefined;
  let id: string | undefined;

  // Optional leading known dimension type token (e.g. "CTF 303 ..." or "CTQ ...")
  const typeMatch = working.match(/^([A-Z]{2,4})\b\s*(.*)$/);
  if (typeMatch && KNOWN_DIM_TYPES.has(typeMatch[1].toUpperCase())) {
    dimensionType = typeMatch[1].toUpperCase();
    working = typeMatch[2].trim();
  }

  // Optional trailing balloon ID (e.g. "... 303", "... 303B", "... (304)")
  const trailingId = working.match(
    /^(.*?)(?:\s+|\.)(?:\()?(\d{2,4}[A-Z]?)(?:\))?$/,
  );
  if (trailingId) {
    const candidate = trailingId[2];
    const before = trailingId[1].trim();
    // Avoid mistaking a measurement value after "=", "±", or with unit for a balloon ID
    const endsWithOperator = /[=±+\-*/<>]$/.test(before);
    if (before.length > 0 && !endsWithOperator) {
      id = candidate;
      working = before;
    }
  }

  return { dimensionType, id, cleaned: working.trim() };
}

function parseNonDimensionalFromLines(
  lines: readonly string[],
): Partial<Dimension> {
  const fullText = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!fullText) return {};

  // Strip optional leading note index like "3-2 " if user boxed a note line containing a spec
  const withoutNotePrefix = fullText.replace(/^\d+-\d+\s+/, "");
  const { dimensionType, id, cleaned } =
    extractLeadingTypeAndTrailingId(withoutNotePrefix);

  const patch: Partial<Dimension> = {};
  if (dimensionType) patch.dimensionType = dimensionType;
  if (id) patch.name = id;
  patch.notes = cleaned || fullText;
  return patch;
}

function parseLinearFromLines(lines: readonly string[]): Partial<Dimension> {
  const fullText = lines
    .join(" ")
    .replace(/−/g, "-")
    .replace(/\uF0B1|\+\/-|\+-/g, "±")
    .replace(/\s+/g, " ")
    .trim();
  if (!fullText) return {};

  const patch: Partial<Dimension> = {};
  let working = fullText;

  // Check for known dimension type token (e.g. CTF / CTQ / SPC)
  const typeMatch = working.match(/\b(CTF|CTQ|SPC|REF|KPC|FAI)\b/i);
  if (typeMatch) {
    patch.dimensionType = typeMatch[1].toUpperCase();
    working = working.replace(typeMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Extract quantity prefix like "2X", "4X", "4X0.10", "17X", "2×"
  const qtyMatch = working.match(/\b(\d{1,3})\s*[xX×](?=\s|\d|[⌀ØøR]|$)/);
  if (qtyMatch) {
    const parsedQty = parseInt(qtyMatch[1], 10);
    if (parsedQty >= 1) {
      patch.quantity = parsedQty;
    }
    working = working.replace(qtyMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Extract unit if explicitly present
  const unitMatch = working.match(/\b(mm|in|inch)\b/i);
  if (unitMatch) {
    const rawUnit = unitMatch[1].toLowerCase();
    patch.unit = rawUnit === "mm" ? "mm" : "in";
  }

  // 1) Try symmetric tolerance: "<nominal> ± <tol>"
  const symMatch = working.match(
    /(?:[⌀ØøR]\s*)?(\d+(?:\.\d+)?)\s*±\s*(\d*\.\d+|\d+)/,
  );
  if (symMatch) {
    patch.nominal = symMatch[1];
    patch.upperTol = normalizeParsedTolerance(symMatch[2], "upper");
    patch.lowerTol = normalizeParsedTolerance(symMatch[2], "lower");
    working = working.replace(symMatch[0], " ").replace(/\s+/g, " ").trim();
  } else {
    // 2) Try contiguous asymmetric / bilateral tolerance: "<nominal> +0.10 -0.05" or "<nominal> +0.10/-0.05"
    const asymMatch = working.match(
      /(?:[⌀ØøR]\s*)?(\d+(?:\.\d+)?)\s*([+-]\s*\d*\.\d+|[+-]\s*\d+)\s*[/\s]\s*([+-]\s*\d*\.\d+|[+-]\s*\d+)/,
    );
    if (asymMatch) {
      patch.nominal = asymMatch[1];
      patch.upperTol = normalizeParsedTolerance(asymMatch[2], "upper");
      patch.lowerTol = normalizeParsedTolerance(asymMatch[3], "lower");
      working = working.replace(asymMatch[0], " ").replace(/\s+/g, " ").trim();
    } else {
      // 3) Stacked asymmetric tolerances split across lines by vertical y-order
      //    e.g. "+0.35" (above), "502 0.00" (middle), "-0.20" (below)
      const signedMatches = Array.from(
        working.matchAll(/(?:^|[\s/])([+-]\s*\d*\.\d+)(?=\s|$|\/)/g),
      );
      if (signedMatches.length >= 2) {
        const firstTok = signedMatches[0][1];
        const secondTok = signedMatches[1][1];
        patch.upperTol = normalizeParsedTolerance(firstTok, "upper");
        patch.lowerTol = normalizeParsedTolerance(secondTok, "lower");
        working = working
          .replace(firstTok, " ")
          .replace(secondTok, " ")
          .replace(/\s+/g, " ")
          .trim();

        const decimalNomMatch = working.match(/(?:[⌀ØøR]\s*)?(\d+\.\d+)/);
        const nomMatch =
          decimalNomMatch ?? working.match(/(?:[⌀ØøR]\s*)?(\d+)/);
        if (nomMatch) {
          patch.nominal = nomMatch[1];
          working = working.replace(nomMatch[0], " ").replace(/\s+/g, " ").trim();
        }
      } else {
        // 4) CAD vector-drawn "±" (not present in PDF text layer): "<decimal> <decimal>"
        const implicitSymMatch = working.match(
          /(?:[⌀ØøR]\s*)?(\d+\.\d+)\s+(\d*\.\d+)/,
        );
        if (implicitSymMatch) {
          patch.nominal = implicitSymMatch[1];
          patch.upperTol = normalizeParsedTolerance(implicitSymMatch[2], "upper");
          patch.lowerTol = normalizeParsedTolerance(implicitSymMatch[2], "lower");
          working = working
            .replace(implicitSymMatch[0], " ")
            .replace(/\s+/g, " ")
            .trim();
        } else {
          // 5) Fallback: strongly prefer a decimal value over a bare integer (which is often the balloon ID)
          const decimalNomMatch = working.match(/(?:[⌀ØøR]\s*)?(\d+\.\d+)/);
          const nomMatch =
            decimalNomMatch ?? working.match(/(?:[⌀ØøR]\s*)?(\d+)/);
          if (nomMatch) {
            patch.nominal = nomMatch[1];
            working = working
              .replace(nomMatch[0], " ")
              .replace(/\s+/g, " ")
              .trim();
          }
        }
      }
    }
  }

  // Strip unit token from remaining description
  if (unitMatch) {
    working = working
      .replace(new RegExp(`\\b${unitMatch[1]}\\b`, "i"), " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Check if a standalone balloon ID token remains (e.g. "306", "103B")
  const idMatch = working.match(/(?:^|\s)\(?(\d{2,4}[A-Z]?)\)?(?=\s|$)/);
  if (idMatch) {
    patch.name = idMatch[1];
    working = working.replace(idMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Clean stray punctuation from remaining description
  const desc = working.replace(/^[()[\],.;:\s]+|[()[\],.;:\s]+$/g, "").trim();
  if (desc) {
    patch.notes = desc;
  }

  return patch;
}

function parseGdtFromLines(
  lines: readonly string[],
  existingGdt?: GdtSpec | null,
): Partial<Dimension> {
  const fullText = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!fullText) return {};

  const baseGdt: GdtSpec = existingGdt
    ? {
        ...existingGdt,
        datums: [0, 1, 2].map((i) => ({
          datum: existingGdt.datums?.[i]?.datum ?? "",
          materialCondition: existingGdt.datums?.[i]?.materialCondition ?? "",
        })),
      }
    : createDefaultGdtSpec();

  let working = fullText;
  let detectedSymbol: GdtSymbol | null = null;

  for (const { pattern, symbol } of GDT_GLYPH_MAP) {
    const m = working.match(pattern);
    if (m) {
      detectedSymbol = symbol;
      working = working.replace(m[0], " ").replace(/\s+/g, " ").trim();
      break;
    }
  }

  if (!detectedSymbol) {
    for (const { pattern, symbol } of GDT_KEYWORD_MAP) {
      if (pattern.test(working)) {
        detectedSymbol = symbol;
        break;
      }
    }
  }

  const nextGdt: GdtSpec = {
    ...baseGdt,
    symbol: detectedSymbol ?? baseGdt.symbol,
  };

  // Look for optional diameter zone + tolerance value + optional material condition.
  // Strongly prefer an explicit diameter-prefixed value or a decimal value (e.g. "0.8", "0.05")
  // over a bare integer so a leading balloon ID (e.g. "404 0.8") is not mistaken for tolerance.
  const explicitDiaTolMatch = working.match(
    /([⌀Øø])\s*(\d*\.\d+|\d+)\s*(Ⓜ|Ⓛ|\(M\)|\(L\)|MMC|LMC)?/i,
  );
  const decimalTolMatch = working.match(
    /([⌀Øø])?\s*(\d*\.\d+)\s*(Ⓜ|Ⓛ|\(M\)|\(L\)|MMC|LMC)?/i,
  );
  const fallbackIntTolMatch = working.match(
    /([⌀Øø])?\s*(\d+)\s*(Ⓜ|Ⓛ|\(M\)|\(L\)|MMC|LMC)?/i,
  );
  const tolMatch = explicitDiaTolMatch ?? decimalTolMatch ?? fallbackIntTolMatch;
  if (tolMatch) {
    nextGdt.diameterZone = Boolean(tolMatch[1]);
    nextGdt.tolerance = tolMatch[2];
    if (tolMatch[3]) {
      nextGdt.materialCondition = parseMaterialConditionToken(tolMatch[3]);
    }
    working = working.replace(tolMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Extract up to 3 datum references (single uppercase letters A-Z, excluding common words)
  const datumRefs: GdtDatumRef[] = [];
  const tokens = working.split(/\s+/).filter(Boolean);
  const consumedIndices = new Set<number>();

  for (let i = 0; i < tokens.length && datumRefs.length < 3; i += 1) {
    const cleanTok = tokens[i].replace(/^\[|\]$/g, "");
    const m = cleanTok.match(/^([A-Z])(Ⓜ|Ⓛ|\(M\)|\(L\))?$/);
    if (m) {
      const datumLetter = m[1];
      let mc: MaterialCondition = m[2]
        ? parseMaterialConditionToken(m[2])
        : "";
      consumedIndices.add(i);
      if (!mc && i + 1 < tokens.length) {
        const nextMc = parseMaterialConditionToken(tokens[i + 1]);
        if (nextMc) {
          mc = nextMc;
          consumedIndices.add(i + 1);
          i += 1;
        }
      }
      datumRefs.push({ datum: datumLetter, materialCondition: mc });
    }
  }

  if (datumRefs.length > 0) {
    nextGdt.datums = [0, 1, 2].map(
      (i) => datumRefs[i] ?? { datum: "", materialCondition: "" },
    );
  }

  const remainingTokens = tokens.filter((_, idx) => !consumedIndices.has(idx));
  let remainder = remainingTokens.join(" ").trim();

  const patch: Partial<Dimension> = {
    gdt: sanitizeGdtSpec(nextGdt),
  };

  // Optional known type token
  const typeMatch = remainder.match(/\b(CTF|CTQ|SPC|REF|KPC|FAI)\b/i);
  if (typeMatch) {
    patch.dimensionType = typeMatch[1].toUpperCase();
    remainder = remainder.replace(typeMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Optional balloon ID
  const idMatch = remainder.match(/(?:^|\s)\(?(\d{2,4}[A-Z]?)\)?(?=\s|$)/);
  if (idMatch) {
    patch.name = idMatch[1];
    remainder = remainder.replace(idMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  if (remainder) {
    patch.notes = remainder;
  }

  return patch;
}

/**
 * Parses extracted PDF region text lines into a Dimension patch tailored to the chosen AnnotationKind.
 * Returns null for `point` or when no text was extracted.
 */
export function parseAnnotationFromRegionText(
  kind: AnnotationKind,
  lines: readonly string[],
  currentDimension?: Partial<Dimension>,
): Partial<Dimension> | null {
  if (kind === "point") return null;
  const cleanedLines = lines.map((l) => l.trim()).filter(Boolean);
  if (cleanedLines.length === 0) return null;

  switch (kind) {
    case "note":
      return parseNoteFromLines(cleanedLines);
    case "datum":
      return parseDatumFromLines(cleanedLines);
    case "non_dimensional":
      return parseNonDimensionalFromLines(cleanedLines);
    case "linear":
      return parseLinearFromLines(cleanedLines);
    case "gdt":
      return parseGdtFromLines(cleanedLines, currentDimension?.gdt);
    default:
      return null;
  }
}

export type PointCaptureField = "id" | "x" | "y" | "z";

export const POINT_CAPTURE_STEPS: readonly PointCaptureField[] = [
  "id",
  "x",
  "y",
  "z",
];

export interface PointFieldCaptureTexts {
  id?: readonly string[];
  x?: readonly string[];
  y?: readonly string[];
  z?: readonly string[];
}

function extractPointIdFromLines(lines: readonly string[]): string {
  const raw = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  // Collapse accidental PDF glyph split between letters and digits (e.g. "Y 1" -> "Y1", "X 10" -> "X10")
  const compact = raw.replace(/^([A-Za-z]{1,3})\s+(\d{1,3}[A-Za-z]?)$/, "$1$2");
  return compact.toUpperCase();
}

function extractCoordinateFromLines(lines: readonly string[]): string {
  const raw = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/−/g, "-")
    .replace(/\b\d{1,3}\s*[xX×](?=\s|\d|[⌀ØøR]|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  const decMatch = raw.match(/([+-]?\d+\.\d+)/);
  if (decMatch) return decMatch[1];
  const intMatch = raw.match(/([+-]?\d+)/);
  return intMatch ? intMatch[1] : "";
}

/**
 * Parses explicitly guided Point capture fields (ID, X, Y, Z) into a Dimension patch.
 * Any skipped/empty field leaves the existing value untouched.
 */
export function parsePointFromFieldCaptures(
  captures: PointFieldCaptureTexts,
  existingPoint?: PointSpec | null,
): Partial<Dimension> | null {
  const basePoint: PointSpec = existingPoint
    ? {
        x: existingPoint.x ?? "",
        y: existingPoint.y ?? "",
        z: existingPoint.z ?? "",
        datums: [
          existingPoint.datums?.[0] ?? "",
          existingPoint.datums?.[1] ?? "",
          existingPoint.datums?.[2] ?? "",
        ],
      }
    : createDefaultPointSpec();

  const name = captures.id ? extractPointIdFromLines(captures.id) : "";
  const x = captures.x ? extractCoordinateFromLines(captures.x) : "";
  const y = captures.y ? extractCoordinateFromLines(captures.y) : "";
  const z = captures.z ? extractCoordinateFromLines(captures.z) : "";

  if (!name && !x && !y && !z) {
    return null;
  }

  const patch: Partial<Dimension> = {};
  if (name) {
    patch.name = name;
  }
  if (x || y || z) {
    patch.point = {
      ...basePoint,
      x: x || basePoint.x,
      y: y || basePoint.y,
      z: z || basePoint.z,
    };
  }
  return patch;
}
