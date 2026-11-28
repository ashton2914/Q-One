import { describe, expect, it } from "vitest";
import {
  clamp01,
  clampBatchMoveDelta,
  clampMovedRect,
  clientPointToNormalized,
  collapseOverlappingMarkers,
  computeNonOverlappingLabelOffsets,
  findMarkersAtPixelPoint,
  findMarkersInRect,
  normalizedToPixel,
  normalizeRectFromPoints,
} from "../coordinates";

describe("coordinates", () => {
  it("clamps values strictly to [0, 1] and guards NaN", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(1.8)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("maps client points to normalized [0, 1] and clamps out-of-bounds drags", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(clientPointToNormalized(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(clientPointToNormalized(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToNormalized(500, 250, rect)).toEqual({ x: 1, y: 1 });
    expect(clientPointToNormalized(20, -10, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToNormalized(900, 600, rect)).toEqual({ x: 1, y: 1 });
  });

  it("returns null when rect has zero or negative width/height", () => {
    expect(
      clientPointToNormalized(100, 100, { left: 0, top: 0, width: 0, height: 200 }),
    ).toBeNull();
    expect(
      clientPointToNormalized(100, 100, { left: 0, top: 0, width: 200, height: 0 }),
    ).toBeNull();
  });

  it("round-trips normalized coordinates accurately across zoom scales", () => {
    for (const zoom of [1.0, 2.5]) {
      const width = 800 * zoom;
      const height = 600 * zoom;
      const { px, py } = normalizedToPixel(0.35, 0.72, width, height);
      const back = clientPointToNormalized(px + 20, py + 40, {
        left: 20,
        top: 40,
        width,
        height,
      });
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(0.35, 6);
      expect(back!.y).toBeCloseTo(0.72, 6);
    }
  });

  it("normalizes drag rectangles in any direction and clamps inside [0, 1]", () => {
    // Bottom-right to top-left drag
    const r = normalizeRectFromPoints(0.6, 0.5, 0.2, 0.3);
    expect(r.x).toBeCloseTo(0.2, 6);
    expect(r.y).toBeCloseTo(0.3, 6);
    expect(r.width).toBeCloseTo(0.4, 6);
    expect(r.height).toBeCloseTo(0.2, 6);

    // Clamps moved rectangle within [0, 1] without shrinking its size
    expect(clampMovedRect(-0.1, 0.95, 0.2, 0.1)).toEqual({
      x: 0,
      y: 0.9,
      width: 0.2,
      height: 0.1,
    });
  });

  it("finds overlapping markers at a clicked pixel point ordered from smallest to largest", () => {
    const candidates = [
      { id: "big-box", isPoint: false, x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
      { id: "small-box", isPoint: false, x: 0.15, y: 0.15, width: 0.1, height: 0.1 },
      { id: "pt", isPoint: true, x: 0.2, y: 0.2, width: 0, height: 0 },
      { id: "far-box", isPoint: false, x: 0.7, y: 0.7, width: 0.1, height: 0.1 },
    ];

    expect(
      findMarkersAtPixelPoint(candidates, 200, 200, 1000, 1000).map((c) => c.id),
    ).toEqual(["pt", "small-box", "big-box"]);

    expect(
      findMarkersAtPixelPoint(candidates, 120, 120, 1000, 1000).map((c) => c.id),
    ).toEqual(["big-box"]);

    expect(findMarkersAtPixelPoint(candidates, 500, 500, 1000, 1000)).toEqual(
      [],
    );
  });

  it("places overlapping region labels side-by-side without collision", () => {
    const offsets = computeNonOverlappingLabelOffsets(
      [
        {
          id: "note-3-2",
          isPoint: false,
          px: 50,
          py: 100,
          boxW: 400,
          boxH: 24,
          label: "3-2",
        },
        {
          id: "dim-303",
          isPoint: false,
          px: 50,
          py: 100,
          boxW: 405,
          boxH: 24,
          label: "303",
        },
      ],
      800,
      600,
    );

    const o1 = offsets.get("note-3-2")!;
    const o2 = offsets.get("dim-303")!;
    expect(o1).toBeDefined();
    expect(o2).toBeDefined();
    // Same top row, second badge shifted cleanly to the right of the first
    expect(o1.dy).toBe(o2.dy);
    expect(o2.dx).toBeGreaterThan(o1.dx + 20);
  });

  it("collapses >= 4 heavily overlapping markers into a single ... (N) marker", () => {
    const sharedMarker = {
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.05,
    };
    const items = [1, 2, 3, 4, 5].map((n) => ({
      id: `id-${n}`,
      name: `71${n}-A`,
      marker: { ...sharedMarker },
    }));
    const separate = {
      id: "id-sep",
      name: "800",
      marker: { ...sharedMarker, x: 0.7 },
    };

    const collapsed = collapseOverlappingMarkers([...items, separate], {
      isPoint: () => false,
    });
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].isCollapsed).toBe(true);
    expect(collapsed[0].members).toHaveLength(5);
    expect(collapsed[0].labelOverride).toBe("... (5)");
    expect(collapsed[1].isCollapsed).toBe(false);
    expect(collapsed[1].primary.id).toBe("id-sep");

    const withSelection = collapseOverlappingMarkers(items, {
      isPoint: () => false,
      selectedIds: new Set(["id-3"]),
    });
    expect(withSelection).toHaveLength(1);
    expect(withSelection[0].primary.id).toBe("id-3");
    expect(withSelection[0].labelOverride).toBe("713-A … (5)");
  });

  it("finds markers intersecting a marquee rectangle and clamps group move delta preserving relative spacing", () => {
    const candidates = [
      { id: "pt-in", isPoint: true, x: 0.25, y: 0.25, width: 0, height: 0 },
      { id: "box-hit", isPoint: false, x: 0.35, y: 0.35, width: 0.1, height: 0.1 },
      { id: "box-out", isPoint: false, x: 0.8, y: 0.8, width: 0.1, height: 0.1 },
    ];
    const hits = findMarkersInRect(candidates, {
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.2,
    });
    expect(hits.map((h) => h.id)).toEqual(["pt-in", "box-hit"]);

    // Group spanning x=[0.1..0.9] moved right by +0.25 -> clamped to +0.10 so right-most marker hits 1.0
    const clamped = clampBatchMoveDelta(
      [
        { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
        { x: 0.8, y: 0.4, width: 0.1, height: 0.05 },
      ],
      0.25,
      -0.3,
    );
    expect(clamped.dx).toBeCloseTo(0.1, 6);
    expect(clamped.dy).toBeCloseTo(-0.2, 6);
  });
});
