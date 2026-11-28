import { describe, expect, it } from "vitest";
import type { Dimension, DrawingEntry, PointGroup } from "../../types/project";
import {
  duplicateAnnotationRevisionData,
  ensureDrawingAnnotationRevisions,
  hasAnnotationRevisionNameCollision,
  nextAnnotationRevisionName,
  resolveLatestAnnotationRevisionId,
  resolveUniqueAnnotationRevisionName,
} from "../annotationRevisions";

describe("annotationRevisions", () => {
  it("normalizes legacy drawings without revisions into a default Selected Review 1", () => {
    const legacyDrawing: DrawingEntry = {
      id: "drw-1",
      version: "A",
      filename: "part.pdf",
      archivePath: "drawings/drw-1.pdf",
      pageCount: 3,
    };
    const { revisions, latestRevisionId } = ensureDrawingAnnotationRevisions(
      legacyDrawing,
      "2026-11-28T00:00:00Z",
    );
    expect(revisions).toHaveLength(1);
    expect(revisions[0].name).toBe("Review 1");
    expect(latestRevisionId).toBe(revisions[0].id);
  });

  it("generates unique sequential review names and resolves selected revision id", () => {
    const revisions = [
      { id: "rev-1", name: "Review 1", createdAt: "2026-11-28T00:00:00Z" },
      { id: "rev-2", name: "Review 2", createdAt: "2026-11-28T00:01:00Z" },
    ];
    expect(nextAnnotationRevisionName(revisions)).toBe("Review 3");
    expect(hasAnnotationRevisionNameCollision(revisions, "review 1", "rev-2")).toBe(
      true,
    );
    expect(hasAnnotationRevisionNameCollision(revisions, "Review 1", "rev-1")).toBe(
      false,
    );
    expect(hasAnnotationRevisionNameCollision(revisions, "Review 3", "rev-2")).toBe(
      false,
    );
    expect(
      ensureDrawingAnnotationRevisions(
        {
          id: "drw-dup",
          filename: "dup.pdf",
          archivePath: "drawings/drw-dup.pdf",
          pageCount: 1,
          annotationRevisions: [
            { id: "r1", name: "Review 1", createdAt: "2026-11-28T00:00:00Z" },
            { id: "r2", name: "review 1", createdAt: "2026-11-28T00:01:00Z" },
          ],
        },
        "2026-11-28T00:00:00Z",
      ).revisions.map((r) => r.name),
    ).toEqual(["Review 1", "review 1 (2)"]);
    expect(
      resolveLatestAnnotationRevisionId({
        id: "drw-1",
        filename: "part.pdf",
        archivePath: "drawings/drw-1.pdf",
        pageCount: 1,
        annotationRevisions: revisions,
        latestAnnotationRevisionId: "rev-1",
      }),
    ).toBe("rev-1");
  });

  it("deep-clones dimensions and point groups with remapped IDs and full isolation", () => {
    const dims: Dimension[] = [
      {
        id: "p1",
        drawingId: "drw-1",
        annotationRevisionId: "rev-1",
        page: 1,
        kind: "point",
        balloonNumber: 1,
        dimensionType: "",
        name: "F1",
        quantity: 1,
        nominal: "",
        upperTol: "",
        lowerTol: "",
        unit: "mm",
        notes: "",
        point: { x: "1.0", y: "2.0", z: "", datums: ["A"] },
        marker: {
          drawingId: "drw-1",
          page: 1,
          x: 0.2,
          y: 0.3,
          width: 0,
          height: 0,
        },
      },
      {
        id: "n1",
        drawingId: "drw-1",
        annotationRevisionId: "rev-1",
        page: 1,
        kind: "note",
        balloonNumber: 2,
        dimensionType: "",
        name: "1-1",
        quantity: 1,
        nominal: "",
        upperTol: "",
        lowerTol: "",
        unit: "mm",
        notes: "Deburr edges",
        marker: null,
      },
      {
        id: "d1",
        drawingId: "drw-1",
        annotationRevisionId: "rev-1",
        page: 1,
        kind: "linear",
        balloonNumber: 3,
        dimensionType: "CTF",
        name: "101",
        quantity: 1,
        nominal: "12.50",
        upperTol: "0.10",
        lowerTol: "0.10",
        unit: "mm",
        notes: "",
        linkedPointIds: ["p1"],
        linkedNoteIds: ["n1"],
        marker: {
          drawingId: "drw-1",
          page: 1,
          x: 0.4,
          y: 0.5,
          width: 0.05,
          height: 0.03,
        },
      },
      {
        id: "other-rev-dim",
        drawingId: "drw-1",
        annotationRevisionId: "rev-other",
        page: 1,
        kind: "linear",
        balloonNumber: 1,
        dimensionType: "",
        name: "999",
        quantity: 1,
        nominal: "1.00",
        upperTol: "",
        lowerTol: "",
        unit: "mm",
        notes: "",
        marker: null,
      },
    ];

    const groups: PointGroup[] = [
      {
        id: "pg-1",
        drawingId: "drw-1",
        annotationRevisionId: "rev-1",
        page: 1,
        name: "F1",
        pointIds: ["p1"],
        collapsed: false,
      },
    ];

    let seq = 1;
    const { clonedDimensions, clonedPointGroups } =
      duplicateAnnotationRevisionData({
        drawingId: "drw-1",
        sourceRevisionId: "rev-1",
        targetRevisionId: "rev-2",
        dimensions: dims,
        pointGroups: groups,
        idFactory: (prefix) => `${prefix}-copy-${seq++}`,
      });

    expect(clonedDimensions).toHaveLength(3);
    expect(clonedPointGroups).toHaveLength(1);
    expect(clonedDimensions.every((d) => d.annotationRevisionId === "rev-2")).toBe(
      true,
    );

    const clonedPoint = clonedDimensions.find((d) => d.name === "F1")!;
    const clonedNote = clonedDimensions.find((d) => d.name === "1-1")!;
    const clonedLinear = clonedDimensions.find((d) => d.name === "101")!;

    expect(clonedPoint.id).not.toBe("p1");
    expect(clonedLinear.linkedPointIds).toEqual([clonedPoint.id]);
    expect(clonedLinear.linkedNoteIds).toEqual([clonedNote.id]);
    expect(clonedPointGroups[0].id).not.toBe("pg-1");
    expect(clonedPointGroups[0].annotationRevisionId).toBe("rev-2");
    expect(clonedPointGroups[0].pointIds).toEqual([clonedPoint.id]);
  });

  it("pastes a review onto a different drawing version with remapped drawingId, page clamping, and unique naming", () => {
    const dims: Dimension[] = [
      {
        id: "p1",
        drawingId: "drw-a",
        annotationRevisionId: "rev-a1",
        page: 5,
        kind: "point",
        balloonNumber: 1,
        dimensionType: "",
        name: "F1",
        quantity: 1,
        nominal: "",
        upperTol: "",
        lowerTol: "",
        unit: "mm",
        notes: "",
        point: { x: "1.0", y: "2.0", z: "", datums: ["A"] },
        marker: {
          drawingId: "drw-a",
          page: 5,
          x: 0.2,
          y: 0.3,
          width: 0,
          height: 0,
        },
      },
    ];
    const groups: PointGroup[] = [
      {
        id: "pg-1",
        drawingId: "drw-a",
        annotationRevisionId: "rev-a1",
        page: 5,
        name: "F1",
        pointIds: ["p1"],
        collapsed: false,
      },
    ];

    let seq = 1;
    const { clonedDimensions, clonedPointGroups } =
      duplicateAnnotationRevisionData({
        drawingId: "drw-a",
        targetDrawingId: "drw-b",
        targetDrawingPageCount: 3,
        sourceRevisionId: "rev-a1",
        targetRevisionId: "rev-b2",
        dimensions: dims,
        pointGroups: groups,
        idFactory: (prefix) => `${prefix}-b-${seq++}`,
      });

    expect(clonedDimensions[0].drawingId).toBe("drw-b");
    expect(clonedDimensions[0].annotationRevisionId).toBe("rev-b2");
    expect(clonedDimensions[0].page).toBe(3);
    expect(clonedDimensions[0].marker?.drawingId).toBe("drw-b");
    expect(clonedDimensions[0].marker?.page).toBe(3);
    expect(clonedPointGroups[0].drawingId).toBe("drw-b");
    expect(clonedPointGroups[0].page).toBe(3);
    expect(clonedPointGroups[0].pointIds).toEqual([clonedDimensions[0].id]);

    expect(
      resolveUniqueAnnotationRevisionName(
        [{ id: "r1", name: "Review 1", createdAt: "2026-11-28T00:00:00Z" }],
        "Review 1",
      ),
    ).toBe("Review 1 (2)");
    expect(
      resolveUniqueAnnotationRevisionName(
        [{ id: "r1", name: "Review 1", createdAt: "2026-11-28T00:00:00Z" }],
        "Vendor A",
      ),
    ).toBe("Vendor A");
  });
});
