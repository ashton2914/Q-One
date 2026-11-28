import { describe, expect, it } from "vitest";
import {
  createDimension,
  createProjectFromPdf,
  duplicateDimension,
  duplicateDimensionsBatch,
  findTypeCompletion,
  formatScopedAnnotationLabel,
  formatTolerance,
  getAnnotationPage,
  getAnnotationScopedKey,
  insertDimensionAtSlot,
  insertDimensionsAtSlot,
  nextBalloonNumber,
  rememberDimensionType,
  reorderDimensionList,
  reorderWithinSection,
  replaceDrawingDimensionsOrder,
  resolveAdjacentDimensionId,
  sortDrawingAnnotations,
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

  it("formats symmetric, asymmetric, and inverted-sign tolerances cleanly", () => {
    expect(formatTolerance("0.05", "0.05")).toBe("±0.05");
    expect(formatTolerance("0.05", "0.02")).toBe("+0.05 / -0.02");
    expect(formatTolerance("0.35", "-0.10")).toBe("+0.35 / +0.10");
    expect(formatTolerance("-0.10", "0.35")).toBe("-0.10 / -0.35");
    expect(formatTolerance("0.05", "")).toBe("+0.05");
    expect(formatTolerance("-0.05", "")).toBe("-0.05");
    expect(formatTolerance("", "0.02")).toBe("-0.02");
    expect(formatTolerance("", "-0.02")).toBe("+0.02");
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

  it("duplicates annotations with deep-cloned specs, cleared marker, and auto-incremented IDs", () => {
    const p1: Dimension = {
      ...createDimension([], "d-1"),
      id: "p-1",
      kind: "point",
      name: "P1",
      point: { x: "10", y: "20", z: "0", datums: ["A", "B", ""] },
      linkedPointIds: ["pt-a"],
      linkedNoteIds: ["note-1"],
      marker: { drawingId: "d-1", page: 1, x: 0.5, y: 0.5, width: 0, height: 0 },
    };
    const dup = duplicateDimension(p1, [p1]);
    expect(dup.id).not.toBe(p1.id);
    expect(dup.name).toBe("P2");
    expect(dup.marker).toBeNull();
    expect(dup.point).toEqual(p1.point);
    expect(dup.point).not.toBe(p1.point);
    expect(dup.linkedPointIds).toEqual(["pt-a"]);
    expect(dup.linkedPointIds).not.toBe(p1.linkedPointIds);
    expect(dup.linkedNoteIds).toEqual(["note-1"]);
    expect(dup.linkedNoteIds).not.toBe(p1.linkedNoteIds);

    const datumA: Dimension = {
      ...createDimension([], "d-1"),
      id: "dat-a",
      kind: "datum",
      name: "A",
    };
    const dupDatum = duplicateDimension(datumA, [datumA]);
    expect(dupDatum.name).toBe("B");
  });

  it("sorts Datums first, then per-page Notes -> Linear/GD&T -> Points with natural numeric order", () => {
    const mk = (
      id: string,
      kind: Dimension["kind"],
      name: string,
      page: number | null,
    ): Dimension => ({
      id,
      drawingId: "d-1",
      kind,
      balloonNumber: 1,
      dimensionType: "",
      name,
      quantity: 1,
      nominal: "",
      upperTol: "",
      lowerTol: "",
      unit: "mm",
      notes: "",
      marker:
        page === null
          ? null
          : { drawingId: "d-1", page, x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    });

    const input: Dimension[] = [
      mk("p2-pt10", "point", "P10", 2),
      mk("p2-dim12", "linear", "12", 2),
      mk("p1-dim10", "linear", "10", 1),
      mk("datum-b", "datum", "B", 3),
      mk("p1-note10", "note", "10", 1),
      mk("p1-gdt2", "gdt", "2", 1),
      mk("p2-note2-1", "note", "2-1", 2),
      mk("p1-pt2", "point", "P2", 1),
      mk("unplaced-dim", "linear", "1", null),
      mk("p1-dim1", "linear", "1", 1),
      mk("p1-nondim2a", "non_dimensional", "2A", 1),
      mk("p1-dim3", "linear", "3", 1),
      mk("p1-note2", "note", "2", 1),
      mk("datum-a", "datum", "A", 1),
      mk("p1-pt10", "point", "P10", 1),
      mk("p2-gdt3", "gdt", "3", 2),
      mk("p2-pt1", "point", "P1", 2),
      mk("p2-note5", "note", "5", 2),
      mk("datum-unplaced", "datum", "C", null),
    ];

    const sortedIds = sortDrawingAnnotations(input).map((d) => d.id);
    expect(sortedIds).toEqual([
      "datum-a",
      "datum-b",
      "datum-unplaced",
      "p1-note2",
      "p1-note10",
      "p1-dim1",
      "p1-gdt2",
      "p1-nondim2a",
      "p1-dim3",
      "p1-dim10",
      "p1-pt2",
      "p1-pt10",
      "p2-note2-1",
      "p2-note5",
      "p2-gdt3",
      "p2-dim12",
      "p2-pt1",
      "p2-pt10",
      "unplaced-dim",
    ]);
  });

  it("reorders dimensions cleanly by slot index and preserves other drawings", () => {
    const mk = (id: string, drawingId: string): Dimension => ({
      id,
      drawingId,
      kind: "linear",
      balloonNumber: 1,
      dimensionType: "",
      name: id,
      quantity: 1,
      nominal: "",
      upperTol: "",
      lowerTol: "",
      unit: "mm",
      notes: "",
      marker: null,
    });

    const list = [mk("A", "d-1"), mk("B", "d-1"), mk("C", "d-1"), mk("D", "d-1")];
    expect(reorderDimensionList(list, "A", 2).map((d) => d.id)).toEqual([
      "B",
      "A",
      "C",
      "D",
    ]);
    expect(reorderDimensionList(list, "A", 4).map((d) => d.id)).toEqual([
      "B",
      "C",
      "D",
      "A",
    ]);
    expect(reorderDimensionList(list, "C", 0).map((d) => d.id)).toEqual([
      "C",
      "A",
      "B",
      "D",
    ]);
    expect(reorderDimensionList(list, "B", 1).map((d) => d.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(reorderDimensionList(list, "B", 2).map((d) => d.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);

    const mixed = [
      mk("X1", "d-2"),
      mk("A", "d-1"),
      mk("B", "d-1"),
      mk("X2", "d-2"),
      mk("C", "d-1"),
    ];
    const reorderedActive = [mk("C", "d-1"), mk("A", "d-1"), mk("B", "d-1")];
    expect(
      replaceDrawingDimensionsOrder(mixed, "d-1", reorderedActive).map(
        (d) => d.id,
      ),
    ).toEqual(["X1", "C", "A", "X2", "B"]);
  });

  it("scopes Point and Note ID uniqueness per page and disambiguates duplicate labels across pages", () => {
    const mk = (
      id: string,
      kind: Dimension["kind"],
      name: string,
      page: number | null,
    ): Dimension => ({
      id,
      drawingId: "d-1",
      kind,
      balloonNumber: 1,
      dimensionType: "",
      name,
      quantity: 1,
      nominal: "",
      upperTol: "",
      lowerTol: "",
      unit: "mm",
      notes: "",
      marker:
        page === null
          ? null
          : { drawingId: "d-1", page, x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    });

    const noteP1 = mk("n-p1", "note", "1", 1);
    const noteP2 = mk("n-p2", "note", "1", 2);
    const noteP2Dup = mk("n-p2-dup", "note", "1", 2);
    const ptP1 = mk("pt-p1", "point", "P1", 1);
    const ptP2 = mk("pt-p2", "point", "P1", 2);
    const ptUnique = mk("pt-unique", "point", "P9", 1);
    const dimP1 = mk("dim-p1", "linear", "100", 1);
    const dimP2 = mk("dim-p2", "linear", "100", 2);

    const all = [noteP1, noteP2, ptP1, ptP2, ptUnique, dimP1];

    // Same Note # or Point # on DIFFERENT pages is allowed
    expect(validateDimensionId("1", noteP2.id, [noteP1, noteP2], "note")).toBeNull();
    expect(validateDimensionId("P1", ptP2.id, [ptP1, ptP2], "point")).toBeNull();

    // Same Note # or Point # on the SAME page is rejected with page info
    expect(
      validateDimensionId("1", noteP2Dup.id, [noteP1, noteP2, noteP2Dup], "note"),
    ).toBe('Note # "1" already exists on P2.');

    // Drawing-wide kinds (Linear) still enforce uniqueness across pages
    expect(
      validateDimensionId("100", dimP2.id, [dimP1, dimP2], "linear"),
    ).toBe('Dimension ID "100" already exists.');

    // Canonical scoped keys uniquely identify per-page Notes & Points
    expect(getAnnotationScopedKey(noteP1)).toBe("note:p1:1");
    expect(getAnnotationScopedKey(noteP2)).toBe("note:p2:1");
    expect(getAnnotationScopedKey(noteP1)).not.toBe(
      getAnnotationScopedKey(noteP2),
    );

    // Display label adds (P#) only when duplicates exist across pages
    expect(formatScopedAnnotationLabel(noteP1, all)).toBe("1 (P1)");
    expect(formatScopedAnnotationLabel(noteP2, all)).toBe("1 (P2)");
    expect(formatScopedAnnotationLabel(ptP1, all)).toBe("P1 (P1)");
    expect(formatScopedAnnotationLabel(ptP2, all)).toBe("P1 (P2)");
    expect(formatScopedAnnotationLabel(ptUnique, all)).toBe("P9");
  });

  it("batch-duplicates selected annotations sequentially after the highest existing number", () => {
    const mkPoint = (id: string, name: string, x: string): Dimension => ({
      ...createDimension([], "d-1"),
      id,
      kind: "point",
      name,
      point: { x, y: "5", z: "", datums: ["", "", ""] },
      marker: { drawingId: "d-1", page: 3, x: 0.2, y: 0.2, width: 0, height: 0 },
    });

    const c1 = mkPoint("id-1", "C1", "44.88");
    const c2 = mkPoint("id-2", "C2", "0");
    const c3 = mkPoint("id-3", "C3", "-44.88");
    const c4 = mkPoint("id-4", "C4", "10");
    const c5 = mkPoint("id-5", "C5", "20");

    // When C1..C3 exist and user selects [C3, C2, C1], copies become C4, C5, C6
    const dups1 = duplicateDimensionsBatch([c3, c2, c1], [c3, c2, c1]);
    expect(dups1.map((d) => d.name)).toEqual(["C4", "C5", "C6"]);
    expect(dups1.map((d) => d.point?.x)).toEqual(["44.88", "0", "-44.88"]);
    expect(dups1.every((d) => d.marker === null)).toBe(true);

    // When C1..C5 exist and user selects [C1, C2, C3], copies become C6, C7, C8
    const dups2 = duplicateDimensionsBatch(
      [c1, c2, c3],
      [c1, c2, c3, c4, c5],
    );
    expect(dups2.map((d) => d.name)).toEqual(["C6", "C7", "C8"]);
    expect(dups2.map((d) => d.point?.x)).toEqual(["44.88", "0", "-44.88"]);
  });

  it("inserts a new dimension at the requested slot within the active drawing without disturbing other drawings", () => {
    const mk = (id: string, drawingId: string): Dimension => ({
      ...createDimension([], drawingId),
      id,
      name: id,
    });

    const mixed = [
      mk("X1", "d-2"),
      mk("A", "d-1"),
      mk("X2", "d-2"),
      mk("B", "d-1"),
      mk("C", "d-1"),
    ];
    const n = mk("NEW", "d-1");

    // Slot 0 -> right before first active drawing item
    expect(
      insertDimensionAtSlot(mixed, "d-1", n, 0).map((d) => d.id),
    ).toEqual(["X1", "NEW", "A", "X2", "B", "C"]);

    // Slot 1 -> between A and B (right before B)
    expect(
      insertDimensionAtSlot(mixed, "d-1", n, 1).map((d) => d.id),
    ).toEqual(["X1", "A", "X2", "NEW", "B", "C"]);

    // Slot 3 (end) -> right after C
    expect(
      insertDimensionAtSlot(mixed, "d-1", n, 3).map((d) => d.id),
    ).toEqual(["X1", "A", "X2", "B", "C", "NEW"]);

    // Batch insert right after B (slot 2)
    const batch = [mk("D1", "d-1"), mk("D2", "d-1")];
    expect(
      insertDimensionsAtSlot(mixed, "d-1", batch, 2).map((d) => d.id),
    ).toEqual(["X1", "A", "X2", "B", "D1", "D2", "C"]);
  });

  it("steps to adjacent dimension IDs with up/down and clamps at boundaries", () => {
    const mk = (id: string): Dimension => ({
      ...createDimension([], "d-1"),
      id,
      name: id,
    });
    const list = [mk("A"), mk("B"), mk("C")];

    expect(resolveAdjacentDimensionId([], null, "down")).toBeNull();
    expect(resolveAdjacentDimensionId(list, null, "down")).toBe("A");
    expect(resolveAdjacentDimensionId(list, null, "up")).toBe("C");
    expect(resolveAdjacentDimensionId(list, "A", "down")).toBe("B");
    expect(resolveAdjacentDimensionId(list, "C", "down")).toBe("C");
    expect(resolveAdjacentDimensionId(list, "B", "up")).toBe("A");
    expect(resolveAdjacentDimensionId(list, "A", "up")).toBe("A");
  });

  it("reorders strictly within a page section and resolves owning page before placement", () => {
    const mk = (id: string, page: number): Dimension => ({
      ...createDimension([], "d-1", page),
      id,
      name: id,
    });
    const list = [mk("P1-A", 1), mk("P1-B", 1), mk("P2-A", 2), mk("P2-B", 2)];
    expect(getAnnotationPage(list[0])).toBe(1);

    // Move P2-B to slot 0 of its own section (P2) -> cannot cross into P1
    expect(
      reorderWithinSection(list, "P2-B", 0).map((d) => d.id),
    ).toEqual(["P1-A", "P1-B", "P2-B", "P2-A"]);
  });
});
