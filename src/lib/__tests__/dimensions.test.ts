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
import type { Dimension } from "../../types/project";

describe("dimensions", () => {
  it("computes nextBalloonNumber as max + 1 even after deleting middle items", () => {
    expect(nextBalloonNumber([])).toBe(1);
    const dims: Dimension[] = [
      {
        id: "a",
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
});
