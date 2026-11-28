import { describe, expect, it } from "vitest";
import {
  parseAnnotationFromRegionText,
  parsePointFromFieldCaptures,
  reconstructTextLines,
} from "../annotationRecognize";

describe("annotationRecognize", () => {
  it("reconstructs positioned text items into reading-order lines", () => {
    const lines = reconstructTextLines([
      { str: "±0.10", x: 0.28, y: 0.2, width: 0.05, height: 0.015 },
      { str: "111.84", x: 0.2, y: 0.201, width: 0.06, height: 0.015 },
      { str: "TOUCHPAD", x: 0.21, y: 0.23, width: 0.08, height: 0.015 },
    ]);
    expect(lines).toEqual(["111.84 ±0.10", "TOUCHPAD"]);
  });

  it("parses Note annotations into Note # and Note Text", () => {
    const res = parseAnnotationFromRegionText("note", [
      "3-1 REFER DOC M1292343 FOR TOUCHPAD DESIGN SPECIFICATIONS.",
    ]);
    expect(res).toEqual({
      name: "3-1",
      notes: "REFER DOC M1292343 FOR TOUCHPAD DESIGN SPECIFICATIONS.",
    });

    const numbered = parseAnnotationFromRegionText("note", [
      "1. INTERPRET DRAWING PER ASME Y14.100.",
    ]);
    expect(numbered).toEqual({
      name: "1",
      notes: "INTERPRET DRAWING PER ASME Y14.100.",
    });
  });

  it("parses Datum annotations cleanly", () => {
    expect(parseAnnotationFromRegionText("datum", ["-A-"])).toEqual({
      name: "A",
    });
    expect(
      parseAnnotationFromRegionText("datum", ["DATUM B PRIMARY PLANE"]),
    ).toEqual({
      name: "B",
      notes: "PRIMARY PLANE",
    });
  });

  it("parses Non-Dimensional specs including optional balloon ID and requirement text", () => {
    const res = parseAnnotationFromRegionText("non_dimensional", [
      "3-2 TRACKPAD FTF AT C1, C2 and C3 = 165 ± 40 GRAMS. 303",
    ]);
    expect(res?.name).toBe("303");
    expect(res?.notes).toBe(
      "TRACKPAD FTF AT C1, C2 and C3 = 165 ± 40 GRAMS.",
    );
  });

  it("parses Linear dimensions with qty, symmetric/asymmetric tolerances, balloon ID, and description", () => {
    const sym = parseAnnotationFromRegionText("linear", [
      "2X 111.84 ±0.10",
      "TOUCHPAD",
      "306",
    ]);
    expect(sym).toMatchObject({
      quantity: 2,
      nominal: "111.84",
      upperTol: "0.10",
      lowerTol: "0.10",
      name: "306",
      notes: "TOUCHPAD",
    });

    const asym = parseAnnotationFromRegionText("linear", [
      "0.15 +0.10 -0.05 mm",
    ]);
    expect(asym).toMatchObject({
      nominal: "0.15",
      upperTol: "0.10",
      lowerTol: "0.05",
      unit: "mm",
    });

    // CAD vector-drawn "±" omitted from PDF text layer, with leading balloon ID
    const vectorPmLeadingId = parseAnnotationFromRegionText("linear", [
      "403 1.60 0.10",
      "C COVER",
    ]);
    expect(vectorPmLeadingId).toMatchObject({
      name: "403",
      nominal: "1.60",
      upperTol: "0.10",
      lowerTol: "0.10",
      notes: "C COVER",
    });

    // Trailing balloon ID + vector-drawn "±"
    const vectorPmTrailingId = parseAnnotationFromRegionText("linear", [
      "213.55 0.15",
      "C COVER",
      "401",
    ]);
    expect(vectorPmTrailingId).toMatchObject({
      name: "401",
      nominal: "213.55",
      upperTol: "0.15",
      lowerTol: "0.15",
      notes: "C COVER",
    });

    // Leading balloon ID + single decimal basic dimension (no tolerance)
    const basicWithId = parseAnnotationFromRegionText("linear", [
      "403 187.12",
    ]);
    expect(basicWithId).toMatchObject({
      name: "403",
      nominal: "187.12",
    });

    // Stacked asymmetric tolerances split above/below nominal with leading balloon ID
    const stackedAsym = parseAnnotationFromRegionText("linear", [
      "+0.35",
      "502 2X 0.00",
      "-0.20",
      "HINGE CAP TO",
      "C-COVER",
      "@ X2, X3",
    ]);
    expect(stackedAsym).toMatchObject({
      name: "502",
      quantity: 2,
      nominal: "0.00",
      upperTol: "0.35",
      lowerTol: "0.20",
      notes: "HINGE CAP TO C-COVER @ X2, X3",
    });

    // No space between qty and nominal (4X0.10) + alphanumeric balloon ID (511C)
    const compactQtyStacked = parseAnnotationFromRegionText("linear", [
      "+0.20",
      "511C 4X0.10",
      "-0.10",
    ]);
    expect(compactQtyStacked).toMatchObject({
      name: "511C",
      quantity: 4,
      nominal: "0.10",
      upperTol: "0.20",
      lowerTol: "0.10",
    });
  });

  it("parses GD&T feature control frames and sanitizes applicability rules", () => {
    const pos = parseAnnotationFromRegionText("gdt", [
      "⌖ ⌀0.05 Ⓜ A B Ⓜ",
      "210",
    ]);
    expect(pos?.name).toBe("210");
    expect(pos?.gdt).toEqual({
      symbol: "position",
      diameterZone: true,
      tolerance: "0.05",
      materialCondition: "MMC",
      datums: [
        { datum: "A", materialCondition: "" },
        { datum: "B", materialCondition: "MMC" },
        { datum: "", materialCondition: "" },
      ],
    });

    // Flatness should sanitize out datums & diameter zone
    const flat = parseAnnotationFromRegionText("gdt", ["⏥ 0.8"]);
    expect(flat?.gdt?.symbol).toBe("flatness");
    expect(flat?.gdt?.tolerance).toBe("0.8");
    expect(flat?.gdt?.diameterZone).toBe(false);

    // Leading balloon ID with CAD vector-drawn FCF glyph omitted from PDF text layer
    const leadingIdGdt = parseAnnotationFromRegionText("gdt", [
      "404 0.8",
      "E1 E16",
    ]);
    expect(leadingIdGdt?.name).toBe("404");
    expect(leadingIdGdt?.gdt?.tolerance).toBe("0.8");
    expect(leadingIdGdt?.notes).toBe("E1 E16");
  });

  it("returns null for single-box point annotations", () => {
    expect(parseAnnotationFromRegionText("point", ["F1"])).toBeNull();
  });

  it("parses guided ID / X / Y / Z point field captures cleanly, including Y1/X10 names and skipped steps", () => {
    const res = parsePointFromFieldCaptures({
      id: ["Y 1"],
      x: ["2X 50.15"],
      y: ["4X 142.73"],
      // z skipped
    });
    expect(res).toEqual({
      name: "Y1",
      point: {
        x: "50.15",
        y: "142.73",
        z: "",
        datums: ["", "", ""],
      },
    });

    // Preserves existing fields when a step is skipped
    const partial = parsePointFromFieldCaptures(
      { z: ["1.25"] },
      { x: "10.00", y: "20.00", z: "", datums: ["A", "B", ""] },
    );
    expect(partial).toEqual({
      point: {
        x: "10.00",
        y: "20.00",
        z: "1.25",
        datums: ["A", "B", ""],
      },
    });

    // All skipped returns null
    expect(parsePointFromFieldCaptures({})).toBeNull();
  });
});
