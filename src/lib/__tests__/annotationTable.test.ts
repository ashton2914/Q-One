import { describe, expect, it } from "vitest";
import {
  applyTableCellEdits,
  buildGridTsv,
  computePasteEdits,
  formatMarkerPosition,
  getColumnsForKind,
  parseClipboardTsv,
  parseMarkerPosition,
} from "../annotationTable";
import type { Dimension } from "../../types/project";

function makeDim(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: "d1",
    drawingId: "drw-1",
    page: 1,
    kind: "linear",
    balloonNumber: 1,
    dimensionType: "Linear",
    name: "101",
    quantity: 1,
    nominal: "10.00",
    upperTol: "0.05",
    lowerTol: "0.05",
    unit: "mm",
    notes: "",
    gdt: null,
    point: null,
    marker: null,
    ...overrides,
  };
}

describe("annotationTable", () => {
  it("parses and builds TSV clipboard content cleanly", () => {
    const matrix = parseClipboardTsv("10.0\t0.05\r\n20.0\t0.10\r\n");
    expect(matrix).toEqual([
      ["10.0", "0.05"],
      ["20.0", "0.10"],
    ]);

    const tsv = buildGridTsv(matrix, [0, 1], [0, 1], ["Nominal", "+Tol"]);
    expect(tsv).toBe("Nominal\t+Tol\n10.0\t0.05\n20.0\t0.10");
  });

  it("broadcasts a 1x1 clipboard paste across a multi-cell selection range", () => {
    const edits = computePasteEdits(
      [["0.10"]],
      { row: 0, col: 4 },
      { startRow: 0, startCol: 4, endRow: 2, endCol: 5 },
      5,
      8,
    );
    expect(edits).toHaveLength(6);
    expect(edits.every((e) => e.value === "0.10")).toBe(true);
    expect(edits[0]).toEqual({ row: 0, col: 4, value: "0.10" });
    expect(edits[5]).toEqual({ row: 2, col: 5, value: "0.10" });
  });

  it("tiles a multi-cell copied block across a larger selected target range like Excel", () => {
    // Copy 1x3 row slice [1, 1.17, +0.30] and paste into a 4x3 target selection (rows 2..5, cols 1..3)
    const rowTile = computePasteEdits(
      [["1", "1.17", "+0.30"]],
      { row: 2, col: 1 },
      { startRow: 2, startCol: 1, endRow: 5, endCol: 3 },
      10,
      8,
    );
    expect(rowTile).toHaveLength(12);
    expect(rowTile.filter((e) => e.row === 5)).toEqual([
      { row: 5, col: 1, value: "1" },
      { row: 5, col: 2, value: "1.17" },
      { row: 5, col: 3, value: "+0.30" },
    ]);

    // Copy 2x2 block and paste into 4x2 target selection -> repeats twice
    const blockTile = computePasteEdits(
      [
        ["A", "1"],
        ["B", "2"],
      ],
      { row: 0, col: 0 },
      { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      10,
      8,
    );
    expect(blockTile).toEqual([
      { row: 0, col: 0, value: "A" },
      { row: 0, col: 1, value: "1" },
      { row: 1, col: 0, value: "B" },
      { row: 1, col: 1, value: "2" },
      { row: 2, col: 0, value: "A" },
      { row: 2, col: 1, value: "1" },
      { row: 3, col: 0, value: "B" },
      { row: 3, col: 1, value: "2" },
    ]);
  });

  it("evaluates math formulas on numeric columns and sanitizes GD&T specs", () => {
    const linearCols = getColumnsForKind("linear");
    const nominalColIdx = linearCols.findIndex((c) => c.key === "nominal");
    const typeColIdx = linearCols.findIndex((c) => c.key === "dimensionType");
    const d1 = makeDim({ id: "d1", kind: "linear", nominal: "10" });

    const linearRes = applyTableCellEdits([d1], [d1], linearCols, [
      { row: 0, col: nominalColIdx, value: "=12.5+2.5" },
      { row: 0, col: typeColIdx, value: "ctf" },
    ]);
    expect(linearRes.updatedDimensions[0].nominal).toBe("15");
    expect(linearRes.updatedDimensions[0].dimensionType).toBe("CTF");

    const gdtCols = getColumnsForKind("gdt");
    const symbolColIdx = gdtCols.findIndex((c) => c.key === "gdtSymbol");
    const g1 = makeDim({
      id: "g1",
      kind: "gdt",
      gdt: {
        symbol: "position",
        diameterZone: true,
        tolerance: "0.05",
        materialCondition: "MMC",
        datums: [
          { datum: "A", materialCondition: "" },
          { datum: "", materialCondition: "" },
          { datum: "", materialCondition: "" },
        ],
      },
    });

    const gdtRes = applyTableCellEdits([g1], [g1], gdtCols, [
      { row: 0, col: symbolColIdx, value: "flatness" },
    ]);
    expect(gdtRes.updatedDimensions[0].gdt?.symbol).toBe("flatness");
    expect(gdtRes.updatedDimensions[0].gdt?.diameterZone).toBe(false);
    expect(gdtRes.updatedDimensions[0].gdt?.materialCondition).toBe("");
    expect(gdtRes.updatedDimensions[0].gdt?.datums[0].datum).toBe("");
  });

  it("enforces same-page Point ID uniqueness during batch edits", () => {
    const pointCols = getColumnsForKind("point");
    const idColIdx = pointCols.findIndex((c) => c.key === "name");
    const p1 = makeDim({
      id: "p1",
      kind: "point",
      page: 1,
      name: "A1",
      point: { x: "1", y: "2", z: "0", datums: ["", "", ""] },
    });
    const p2 = makeDim({
      id: "p2",
      kind: "point",
      page: 1,
      name: "A2",
      point: { x: "3", y: "4", z: "0", datums: ["", "", ""] },
    });

    const res = applyTableCellEdits([p1, p2], [p1, p2], pointCols, [
      { row: 1, col: idColIdx, value: "A1" },
    ]);
    expect(res.updatedDimensions[1].name).toBe("A2");
    expect(res.skippedDuplicatePointIds).toEqual(["A1"]);
  });

  it("allows pasting existing Linked Points, Linked Notes, Page, and Point Group values while ignoring nonexistent entries", () => {
    const p1 = makeDim({
      id: "p1",
      kind: "point",
      page: 2,
      name: "A1",
      point: { x: "1", y: "2", z: "0", datums: ["", "", ""] },
    });
    const p2 = makeDim({
      id: "p2",
      kind: "point",
      page: 2,
      name: "A2",
      point: { x: "3", y: "4", z: "0", datums: ["", "", ""] },
    });
    const n1 = makeDim({
      id: "n1",
      kind: "note",
      page: 2,
      name: "N1",
      notes: "Critical",
    });
    const d1 = makeDim({ id: "d1", kind: "linear", page: 2, name: "101" });
    const allDims = [d1, p1, p2, n1];
    const linearCols = getColumnsForKind("linear");
    const pageCol = linearCols.findIndex((c) => c.key === "page");
    const lpCol = linearCols.findIndex((c) => c.key === "linkedPoints");
    const lnCol = linearCols.findIndex((c) => c.key === "linkedNotes");

    const res = applyTableCellEdits(
      allDims,
      [d1],
      linearCols,
      [
        { row: 0, col: pageCol, value: "P3" },
        { row: 0, col: lpCol, value: "A1, A2, DOES_NOT_EXIST" },
        { row: 0, col: lnCol, value: "N1" },
      ],
      [],
      5,
    );
    expect(res.updatedDimensions[0].page).toBe(3);
    expect(res.updatedDimensions[0].linkedPointIds).toEqual(["p1", "p2"]);
    expect(res.updatedDimensions[0].linkedNoteIds).toEqual(["n1"]);

    // Nonexistent page (> pageCount) should be ignored
    const invalidPageRes = applyTableCellEdits(
      allDims,
      [d1],
      linearCols,
      [{ row: 0, col: pageCol, value: "P99" }],
      [],
      5,
    );
    expect(invalidPageRes.updatedDimensions[0].page).toBe(2);

    // Pasting an existing Point Group name moves the point into that group
    const pointCols = getColumnsForKind("point");
    const groupCol = pointCols.findIndex((c) => c.key === "pointGroup");
    const groups = [
      {
        id: "g1",
        drawingId: "drw-1",
        page: 2,
        name: "A1~A2",
        pointIds: ["p1"],
      },
    ];
    const groupRes = applyTableCellEdits(
      allDims,
      [p1, p2],
      pointCols,
      [{ row: 1, col: groupCol, value: "A1~A2" }],
      groups,
      5,
    );
    expect(groupRes.updatedPointGroups[0].pointIds).toEqual(["p1", "p2"]);
  });

  it("formats and batch-pastes annotation PDF marker positions across rows", () => {
    const marker = {
      drawingId: "drw-1",
      page: 7,
      x: 0.425,
      y: 0.6125,
      width: 0.084,
      height: 0.031,
    };
    const formatted = formatMarkerPosition(marker);
    expect(formatted).toBe("P7 (42.50%, 61.25%, 8.40%×3.10%)");
    expect(parseMarkerPosition(formatted, "drw-1", 12)).toEqual(marker);

    const d1 = makeDim({ id: "d1", page: 7, marker });
    const d2 = makeDim({ id: "d2", page: null, marker: null });
    const linearCols = getColumnsForKind("linear");
    const posCol = linearCols.findIndex((c) => c.key === "markerPosition");

    const pasted = applyTableCellEdits(
      [d1, d2],
      [d1, d2],
      linearCols,
      [{ row: 1, col: posCol, value: formatted }],
      [],
      12,
    );
    expect(pasted.updatedDimensions[1].marker).toEqual(marker);
    expect(pasted.updatedDimensions[1].page).toBe(7);

    // Clearing position removes the marker
    const cleared = applyTableCellEdits(
      pasted.updatedDimensions,
      pasted.updatedDimensions,
      linearCols,
      [{ row: 1, col: posCol, value: "" }],
      [],
      12,
    );
    expect(cleared.updatedDimensions[1].marker).toBeNull();
  });
});
