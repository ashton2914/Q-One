import { describe, expect, it } from "vitest";
import {
  createDimension,
  createProjectFromPdf,
  findTypeCompletion,
  formatTolerance,
  nextBalloonNumber,
  rememberDimensionType,
  validateDimensionId,
} from "../dimensions";
import {
  createDefaultGdtSpec,
  createDefaultPointSpec,
  getAvailableDatums,
  getGdtRules,
  getGdtSymbolGlyph,
  sanitizeGdtSpec,
} from "../annotations";
import type { Dimension } from "../../types/project";

describe("dimensions", () => {
  it("computes nextBalloonNumber as max + 1 even after deleting middle items", () => {
    expect(nextBalloonNumber([])).toBe(1);
    const dims: Dimension[] = [
      {
        id: "a",
        drawingId: "d-1",
        balloonNumber: 1,
        dimensionType: "",
        name: "A",
        quantity: 1,
        nominal: "10.00",
        upperTol: "+0.05",
        lowerTol: "-0.05",
        unit: "mm",
        notes: "",
        marker: null,
      },
      {
        id: "c",
        drawingId: "d-1",
        balloonNumber: 3,
        dimensionType: "",
        name: "C",
        quantity: 1,
        nominal: "5.00",
        upperTol: "+0.02",
        lowerTol: "-0.02",
        unit: "mm",
        notes: "",
        marker: null,
      },
    ];
    expect(nextBalloonNumber(dims)).toBe(4);
  });

  it("creates a new unplaced dimension with UUID, next balloonNumber, and mm default", () => {
    const first = createDimension([]);
    expect(first.id.length).toBeGreaterThan(8);
    expect(first.balloonNumber).toBe(1);
    expect(first.unit).toBe("mm");
    expect(first.marker).toBeNull();

    const second = createDimension([first]);
    expect(second.balloonNumber).toBe(2);
    expect(second.id).not.toBe(first.id);
  });

  it("formats symmetric, asymmetric, and empty tolerances cleanly", () => {
    expect(formatTolerance("+0.05", "-0.05")).toBe("±0.05");
    expect(formatTolerance("0.05", "0.05")).toBe("±0.05");
    expect(formatTolerance("+0.05", "-0.02")).toBe("+0.05 / -0.02");
    expect(formatTolerance("+0.05", "")).toBe("+0.05");
    expect(formatTolerance("", "-0.02")).toBe("-0.02");
    expect(formatTolerance("", "")).toBe("");
  });

  it("creates a v1 project from an imported PDF", () => {
    const proj = createProjectFromPdf("drw-123", "Housing-RevB.pdf", 3);
    expect(proj.schemaVersion).toBe(1);
    expect(proj.name).toBe("Housing-RevB");
    expect(proj.drawings).toEqual([
      {
        id: "drw-123",
        filename: "Housing-RevB.pdf",
        archivePath: "drawings/drw-123.pdf",
        pageCount: 3,
      },
    ]);
    expect(proj.dimensions).toEqual([]);
  });

  it("remembers dimension types in MRU order and autocompletes from first letter", () => {
    let history: string[] = [];
    history = rememberDimensionType(history, "CTQ");
    history = rememberDimensionType(history, "FAI");
    history = rememberDimensionType(history, "ctq");
    expect(history).toEqual(["CTQ", "FAI"]);

    expect(findTypeCompletion("c", history)).toBe("CTQ");
    expect(findTypeCompletion("f", history)).toBe("FAI");
    expect(findTypeCompletion("CTQ", history)).toBe("CTQ");
    expect(findTypeCompletion("z", history)).toBeNull();
    expect(findTypeCompletion("", history)).toBeNull();
  });

  it("validates Dimension ID is required and unique (case-insensitive)", () => {
    const existing: Dimension[] = [
      {
        id: "uuid-1",
        drawingId: "d-1",
        balloonNumber: 1,
        dimensionType: "CTQ",
        name: "103",
        quantity: 1,
        nominal: "210.21",
        upperTol: "0.10",
        lowerTol: "0.10",
        unit: "mm",
        notes: "",
        marker: null,
      },
      {
        id: "uuid-2",
        drawingId: "d-1",
        balloonNumber: 2,
        dimensionType: "CTQ",
        name: "512A",
        quantity: 3,
        nominal: "10.00",
        upperTol: "0.05",
        lowerTol: "0.05",
        unit: "mm",
        notes: "",
        marker: null,
      },
    ];

    expect(validateDimensionId("", "uuid-new", existing)).toBe(
      "Dimension ID is required.",
    );
    expect(validateDimensionId("   ", "uuid-new", existing)).toBe(
      "Dimension ID is required.",
    );
    expect(validateDimensionId("103", "uuid-new", existing)).toContain(
      "already exists",
    );
    expect(validateDimensionId("512a", "uuid-new", existing)).toContain(
      "already exists",
    );
    // Same dimension keeping its own ID is valid
    expect(validateDimensionId("512A", "uuid-2", existing)).toBeNull();
    // Brand new unique ID is valid
    expect(validateDimensionId("104", "uuid-new", existing)).toBeNull();
  });

  it("extracts available Datum names and scopes ID uniqueness per annotation kind", () => {
    const dims: Dimension[] = [
      { ...createDimension([], "d-1"), id: "d1", kind: "datum", name: "A" },
      { ...createDimension([], "d-1"), id: "d2", kind: "datum", name: "B" },
      { ...createDimension([], "d-1"), id: "d3", kind: "linear", name: "1" },
      { ...createDimension([], "d-1"), id: "d4", kind: "note", name: "1" },
    ];

    expect(getAvailableDatums(dims)).toEqual(["A", "B"]);
    expect(validateDimensionId("1", "new-note", dims, "note")).toContain(
      "already exists",
    );
    expect(validateDimensionId("1", "new-point", dims, "point")).toBeNull();
    expect(validateDimensionId("", "new-datum", dims, "datum")).toBe(
      "Datum name is required.",
    );
    expect(getGdtSymbolGlyph("position")).toBe("⌖");
    expect(createDefaultGdtSpec().datums).toHaveLength(3);
    expect(createDefaultPointSpec().datums).toHaveLength(3);
  });

  it("enforces ASME Y14.5 applicability rules per GD&T symbol and sanitizes disallowed fields", () => {
    const flatness = getGdtRules("flatness");
    expect(flatness.allowDiameterZone).toBe(false);
    expect(flatness.allowMaterialCondition).toBe(false);
    expect(flatness.allowDatums).toBe(false);

    const runout = getGdtRules("total_runout");
    expect(runout.allowDiameterZone).toBe(false);
    expect(runout.allowMaterialCondition).toBe(false);
    expect(runout.allowDatums).toBe(true);
    expect(runout.allowDatumMaterialCondition).toBe(false);

    const profile = getGdtRules("profile_surface");
    expect(profile.allowDiameterZone).toBe(false);
    expect(profile.allowMaterialCondition).toBe(false);
    expect(profile.allowDatums).toBe(true);
    expect(profile.allowDatumMaterialCondition).toBe(true);

    const sanitized = sanitizeGdtSpec({
      symbol: "flatness",
      diameterZone: true,
      tolerance: "0.08",
      materialCondition: "MMC",
      datums: [
        { datum: "A", materialCondition: "MMC" },
        { datum: "B", materialCondition: "" },
        { datum: "", materialCondition: "" },
      ],
    });
    expect(sanitized.diameterZone).toBe(false);
    expect(sanitized.materialCondition).toBe("");
    expect(sanitized.datums.every((d) => d.datum === "" && d.materialCondition === "")).toBe(true);
  });
});
