import { describe, expect, it } from "vitest";
import {
  addPointsToGroup,
  computeCalibratedPointCoords,
  createEmptyCalibration,
  createPointGroup,
  formatPointGroupDefaultName,
  hasPointIdCollisionOnPage,
  incrementPointId,
  prunePointGroups,
  recalculatePointGroupCoordinates,
  rebindSamePageLinkedPoints,
  removePointsFromGroups,
  resolveLinkedPointDisplayTokens,
  resolveUniquePointIdOnPage,
  suggestNextPointIdForGroup,
} from "../pointGroups";
import { createDimension } from "../dimensions";
import type { Dimension } from "../../types/project";

describe("pointGroups", () => {
  it("formats contiguous and discontinuous point ID sequences cleanly", () => {
    const f1ToF13 = Array.from({ length: 13 }, (_, i) => `F${i + 1}`);
    expect(formatPointGroupDefaultName(f1ToF13)).toBe("F1~F13");

    // Out-of-order discontinuous input: F1~F2, F5, F8~F13
    const broken = [
      "F10",
      "F1",
      "F13",
      "F5",
      "F8",
      "F2",
      "F9",
      "F12",
      "F11",
    ];
    expect(formatPointGroupDefaultName(broken)).toBe("F1~F2, F5, F8~F13");

    // Multiple prefixes
    expect(formatPointGroupDefaultName(["C1", "C2", "C3", "D1", "D4"])).toBe(
      "C1~C3, D1, D4",
    );

    // Single item
    expect(formatPointGroupDefaultName(["P7"])).toBe("P7");
  });

  it("creates a PointGroup with natural-sorted pointIds and default name, and prunes deleted points", () => {
    const mkPt = (id: string, name: string): Dimension => ({
      ...createDimension([], "d-1", 3),
      id,
      kind: "point",
      name,
    });
    const p1 = mkPt("pt-1", "F1");
    const p2 = mkPt("pt-2", "F2");
    const p3 = mkPt("pt-3", "F3");

    const grp = createPointGroup([p3, p1, p2], "d-1", 3);
    expect(grp.name).toBe("F1~F3");
    expect(grp.pointIds).toEqual(["pt-1", "pt-2", "pt-3"]);
    expect(grp.page).toBe(3);
    expect(grp.collapsed).toBe(false);

    // Pruning after deleting p2 keeps p1 and p3
    const pruned = prunePointGroups([grp], [p1, p3]);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].pointIds).toEqual(["pt-1", "pt-3"]);

    // Pruning after deleting all members drops the group
    expect(prunePointGroups([grp], [])).toEqual([]);
  });

  it("collapses fully selected point groups into their group name for linked point display", () => {
    const mkPt = (id: string, name: string): Dimension => ({
      ...createDimension([], "d-1", 2),
      id,
      kind: "point",
      name,
    });
    const d1 = mkPt("pt-1", "D1");
    const d2 = mkPt("pt-2", "D2");
    const d3 = mkPt("pt-3", "D3");
    const e1 = mkPt("pt-4", "E1");
    const byId = new Map([d1, d2, d3, e1].map((d) => [d.id, d]));
    const grp = {
      ...createPointGroup([d1, d2, d3], "d-1", 2),
      name: "D1~D3",
    };

    // Selecting all points in the group collapses to the group badge
    const fullTokens = resolveLinkedPointDisplayTokens(
      ["pt-1", "pt-2", "pt-3"],
      byId,
      [grp],
    );
    expect(fullTokens).toHaveLength(1);
    expect(fullTokens[0].kind).toBe("group");
    if (fullTokens[0].kind === "group") {
      expect(fullTokens[0].group.name).toBe("D1~D3");
      expect(fullTokens[0].points.map((p) => p.name)).toEqual([
        "D1",
        "D2",
        "D3",
      ]);
    }

    // Full group + extra point shows group badge + extra individual point
    const mixedTokens = resolveLinkedPointDisplayTokens(
      ["pt-1", "pt-2", "pt-3", "pt-4"],
      byId,
      [grp],
    );
    expect(mixedTokens).toHaveLength(2);
    expect(mixedTokens[0].kind).toBe("group");
    expect(mixedTokens[1].kind).toBe("point");
    if (mixedTokens[1].kind === "point") {
      expect(mixedTokens[1].point.name).toBe("E1");
    }

    // Partial selection of group members renders individual points
    const partialTokens = resolveLinkedPointDisplayTokens(
      ["pt-1", "pt-3"],
      byId,
      [grp],
    );
    expect(partialTokens).toHaveLength(2);
    expect(partialTokens.every((t) => t.kind === "point")).toBe(true);
  });

  it("computes calibrated X/Y coordinates from X=0, Y=0, and anchor reference point", () => {
    const cal = {
      ...createEmptyCalibration(),
      xZero: 0.2,
      yZero: 0.8, // Y-up engineering convention: clicking above yZero (smaller y) yields positive Y
      anchorX: 0.7,
      anchorY: 0.3,
      anchorValX: "100",
      anchorValY: "50",
    };

    // Clicking at the anchor itself reproduces exact anchor coordinates
    expect(computeCalibratedPointCoords(0.7, 0.3, cal)).toEqual({
      x: "100.00",
      y: "50.00",
    });

    // Clicking halfway between origin and anchor
    expect(computeCalibratedPointCoords(0.45, 0.55, cal)).toEqual({
      x: "50.00",
      y: "25.00",
    });

    // Clicking to the left of X=0 yields negative X
    expect(computeCalibratedPointCoords(0.1, 0.8, cal)).toEqual({
      x: "-20.00",
      y: "0.00",
    });

    // Partial calibration (only X calibrated) leaves Y blank
    const xOnly = { ...cal, yZero: null };
    expect(computeCalibratedPointCoords(0.45, 0.55, xOnly)).toEqual({
      x: "50.00",
      y: "",
    });
  });

  it("increments Point IDs and adds/removes points from groups while preserving custom names", () => {
    expect(incrementPointId("F1")).toBe("F2");
    expect(incrementPointId("F09")).toBe("F10");
    expect(incrementPointId("1")).toBe("2");
    expect(suggestNextPointIdForGroup(["F1", "F2", "F5"])).toBe("F6");

    const mkPt = (id: string, name: string): Dimension => ({
      ...createDimension([], "d-1", 2),
      id,
      kind: "point",
      name,
    });
    const f1 = mkPt("p1", "F1");
    const f2 = mkPt("p2", "F2");
    const f3 = mkPt("p3", "F3");
    const byId = new Map([f1, f2, f3].map((d) => [d.id, d]));

    const autoGrp = createPointGroup([f1, f2], "d-1", 2);
    expect(autoGrp.name).toBe("F1~F2");

    // Adding F3 refreshes default range name to F1~F3
    const afterAdd = addPointsToGroup([autoGrp], autoGrp.id, ["p3"], byId);
    expect(afterAdd[0].pointIds).toEqual(["p1", "p2", "p3"]);
    expect(afterAdd[0].name).toBe("F1~F3");

    // Removing F2 updates default range name to F1, F3
    const afterRemove = removePointsFromGroups(afterAdd, ["p2"], byId);
    expect(afterRemove[0].pointIds).toEqual(["p1", "p3"]);
    expect(afterRemove[0].name).toBe("F1, F3");

    // Custom group name is preserved on add/remove
    const customGrp = { ...autoGrp, name: "Trackpad Rim" };
    const afterCustomAdd = addPointsToGroup([customGrp], customGrp.id, ["p3"], byId);
    expect(afterCustomAdd[0].name).toBe("Trackpad Rim");
  });

  it("enforces same-page Point ID uniqueness and skips taken IDs sequentially", () => {
    const existing = ["F1", "F2", "F4"];
    expect(hasPointIdCollisionOnPage("f2", existing)).toBe(true);
    expect(hasPointIdCollisionOnPage("F3", existing)).toBe(false);

    expect(resolveUniquePointIdOnPage("F1", existing)).toBe("F3");
    expect(resolveUniquePointIdOnPage("F3", existing)).toBe("F3");
    expect(resolveUniquePointIdOnPage("F4", existing)).toBe("F5");
  });

  it("recalculates X/Y coordinates for all marked points in a group while preserving Z and datums", () => {
    const p1: Dimension = {
      ...createDimension([], "d-1", 2),
      id: "p1",
      kind: "point",
      name: "A1",
      point: { x: "999", y: "999", z: "1.50", datums: ["A", "B", ""] },
      marker: { drawingId: "d-1", page: 2, x: 0.3, y: 0.4, width: 0, height: 0 },
    };
    const p2: Dimension = {
      ...createDimension([], "d-1", 2),
      id: "p2",
      kind: "point",
      name: "A2",
      point: { x: "0", y: "0", z: "", datums: ["", "", ""] },
      marker: { drawingId: "d-1", page: 2, x: 0.5, y: 0.6, width: 0, height: 0 },
    };
    const other: Dimension = {
      ...createDimension([], "d-1", 2),
      id: "p3",
      kind: "point",
      name: "B1",
      point: { x: "42", y: "42", z: "", datums: ["", "", ""] },
      marker: { drawingId: "d-1", page: 2, x: 0.8, y: 0.8, width: 0, height: 0 },
    };

    const group = createPointGroup([p1, p2], "d-1", 2);
    const calibration = {
      xZero: 0.1,
      yZero: 0.2,
      anchorX: 0.5,
      anchorY: 0.6,
      anchorValX: "100",
      anchorValY: "200",
    };

    const { updatedDimensions, updatedCount } = recalculatePointGroupCoordinates(
      [p1, p2, other],
      group,
      calibration,
    );
    expect(updatedCount).toBe(2);
    expect(updatedDimensions[0].point).toEqual({
      x: "50.00",
      y: "100.00",
      z: "1.50",
      datums: ["A", "B", ""],
    });
    expect(updatedDimensions[1].point).toEqual({
      x: "100.00",
      y: "200.00",
      z: "",
      datums: ["", "", ""],
    });
    // Non-member point untouched
    expect(updatedDimensions[2].point?.x).toBe("42");
  });

  it("prevents near-zero axis span blowup and derives 1:1 isotropic scale when Anchor sits on X=0 or Y=0", () => {
    // Landscape page with aspect ratio 2.0 (width = 2 * height).
    // Circle centered at (0.5, 0.5) with radius 0.1 in Y (= 0.05 in X).
    // Anchor placed at 12 o'clock top of circle: x = 0.5001 (almost ON X=0), y = 0.4, Ref Y = 5.52.
    const onXAxisCal = {
      xZero: 0.5,
      yZero: 0.5,
      anchorX: 0.5001, // 0.0001 < 0.005 -> sits on X=0!
      anchorY: 0.4,
      anchorValX: "5.52", // even if user mistakenly enters 5.52, should NOT explode to 14000+!
      anchorValY: "5.52",
    };
    // 3 o'clock right edge of circle: (0.55, 0.5) -> should be (5.52, 0.00)
    expect(computeCalibratedPointCoords(0.55, 0.5, onXAxisCal, 2.0)).toEqual({
      x: "5.52",
      y: "0.00",
    });
    // 9 o'clock left edge of circle: (0.45, 0.5) -> should be (-5.52, 0.00)
    expect(computeCalibratedPointCoords(0.45, 0.5, onXAxisCal, 2.0)).toEqual({
      x: "-5.52",
      y: "0.00",
    });
    // 6 o'clock bottom edge of circle: (0.5, 0.6) -> should be (0.00, -5.52)
    expect(computeCalibratedPointCoords(0.5, 0.6, onXAxisCal, 2.0)).toEqual({
      x: "0.00",
      y: "-5.52",
    });
  });

  it("auto-rebinds cross-page linkedPointIds to same-named Points on the dimension's own page", () => {
    const p5F1: Dimension = {
      ...createDimension([], "d-1", 5),
      id: "p5-f1",
      kind: "point",
      name: "F1",
    };
    const p5F2: Dimension = {
      ...createDimension([], "d-1", 5),
      id: "p5-f2",
      kind: "point",
      name: "F2",
    };
    const p11F1: Dimension = {
      ...createDimension([], "d-1", 11),
      id: "p11-f1",
      kind: "point",
      name: "F1",
    };
    // Dimension copied to P11 but still referencing P5's F1 and F2 (only F1 exists on P11)
    const dimOnP11: Dimension = {
      ...createDimension([], "d-1", 11),
      id: "dim-11",
      kind: "linear",
      name: "1101",
      linkedPointIds: ["p5-f1", "p5-f2"],
    };
    // Dimension on P5 should stay bound to P5's F1
    const dimOnP5: Dimension = {
      ...createDimension([], "d-1", 5),
      id: "dim-5",
      kind: "linear",
      name: "501",
      linkedPointIds: ["p5-f1"],
    };

    const rebound = rebindSamePageLinkedPoints([
      p5F1,
      p5F2,
      p11F1,
      dimOnP11,
      dimOnP5,
    ]);
    expect(rebound.find((d) => d.id === "dim-11")?.linkedPointIds).toEqual([
      "p11-f1",
      "p5-f2",
    ]);
    expect(rebound.find((d) => d.id === "dim-5")?.linkedPointIds).toEqual([
      "p5-f1",
    ]);
  });
});
