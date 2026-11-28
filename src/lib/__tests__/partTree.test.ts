import { describe, expect, it } from "vitest";
import {
  canReparentPart,
  createEmptyProject,
  createPart,
  deletePartSubtree,
  layoutPartTree,
  normalizeLoadedProject,
  reorderDrawingIds,
  sortDrawings,
  reparentPart,
  resolveLatestDrawingId,
} from "../partTree";
import type { Part, ProjectData } from "../../types/project";

describe("partTree", () => {
  const sampleParts: Part[] = [
    {
      id: "root-a",
      parentId: null,
      name: "Assembly A",
      partNumber: "A-001",
      revision: "Rev B",
      notes: "",
      drawingIds: ["d-1"],
    },
    {
      id: "child-1",
      parentId: "root-a",
      name: "Sub-part 1",
      partNumber: "A-101",
      revision: "Rev A",
      notes: "",
      drawingIds: ["d-2"],
    },
    {
      id: "grandchild-1",
      parentId: "child-1",
      name: "Leaf Part",
      partNumber: "",
      revision: "",
      notes: "",
      drawingIds: ["d-3"],
    },
    {
      id: "root-b",
      parentId: null,
      name: "Assembly B",
      partNumber: "B-001",
      revision: "",
      notes: "",
      drawingIds: [],
    },
  ];

  it("prevents cyclic reparenting onto self or transitive descendants", () => {
    expect(canReparentPart(sampleParts, "root-a", "root-a")).toBe(false);
    expect(canReparentPart(sampleParts, "root-a", "child-1")).toBe(false);
    expect(canReparentPart(sampleParts, "root-a", "grandchild-1")).toBe(false);
    expect(canReparentPart(sampleParts, "child-1", "grandchild-1")).toBe(false);

    // Valid reparenting: moving root-a under root-b, or promoting grandchild-1 to root (null)
    expect(canReparentPart(sampleParts, "root-a", "root-b")).toBe(true);
    expect(canReparentPart(sampleParts, "grandchild-1", null)).toBe(true);
    expect(canReparentPart(sampleParts, "grandchild-1", "root-b")).toBe(true);

    const reparented = reparentPart(sampleParts, "root-a", "root-b");
    expect(reparented.find((p) => p.id === "root-a")?.parentId).toBe("root-b");

    // Attempting an invalid cyclic reparent returns original array unchanged
    const unchanged = reparentPart(sampleParts, "root-a", "grandchild-1");
    expect(unchanged.find((p) => p.id === "root-a")?.parentId).toBeNull();
  });

  it("deletes a part along with its entire descendant subtree and returns removed drawing IDs", () => {
    const result = deletePartSubtree(sampleParts, "child-1");
    expect(result.remainingParts.map((p) => p.id)).toEqual([
      "root-a",
      "root-b",
    ]);
    expect(result.removedPartIds.sort()).toEqual(["child-1", "grandchild-1"]);
    expect(result.removedDrawingIds.sort()).toEqual(["d-2", "d-3"]);
  });

  it("computes deterministic non-overlapping left-to-right tree layout and respects collapsed subtrees", () => {
    const full = layoutPartTree(sampleParts, new Set());
    expect(full.nodes).toHaveLength(4);
    expect(full.edges).toHaveLength(2);

    const byId = new Map(full.nodes.map((n) => [n.part.id, n]));
    // Depth strictly increases x from parent -> child -> grandchild
    expect(byId.get("child-1")!.x).toBeGreaterThan(byId.get("root-a")!.x);
    expect(byId.get("grandchild-1")!.x).toBeGreaterThan(byId.get("child-1")!.x);
    // Sibling roots do not overlap vertically
    expect(byId.get("root-b")!.y).toBeGreaterThan(byId.get("root-a")!.y);

    // Collapsing root-a hides child-1 and grandchild-1
    const collapsed = layoutPartTree(sampleParts, new Set(["root-a"]));
    expect(collapsed.nodes.map((n) => n.part.id)).toEqual(["root-a", "root-b"]);
    expect(collapsed.edges).toHaveLength(0);
  });

  it("migrates legacy Milestone 1 projects without parts or dimension.drawingId cleanly", () => {
    const legacy: ProjectData = {
      schemaVersion: 1,
      projectId: "p-legacy",
      name: "Housing-RevB",
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
      parts: [],
      drawings: [
        {
          id: "drw-1",
          filename: "housing.pdf",
          archivePath: "drawings/drw-1.pdf",
          pageCount: 2,
        },
      ],
      dimensions: [
        {
          id: "dim-1",
          drawingId: null,
          balloonNumber: 1,
          dimensionType: "CTF",
          name: "101",
          quantity: 1,
          nominal: "10.00",
          upperTol: "0.05",
          lowerTol: "0.05",
          unit: "mm",
          notes: "",
          marker: {
            drawingId: "drw-1",
            page: 1,
            x: 0.2,
            y: 0.3,
            width: 0.05,
            height: 0.03,
          },
        },
        {
          id: "dim-unplaced",
          drawingId: null,
          balloonNumber: 2,
          dimensionType: "",
          name: "102",
          quantity: 1,
          nominal: "5.00",
          upperTol: "",
          lowerTol: "",
          unit: "mm",
          notes: "",
          marker: null,
        },
      ],
    };

    const normalized = normalizeLoadedProject(legacy);
    expect(normalized.parts).toHaveLength(1);
    expect(normalized.parts[0].parentId).toBeNull();
    expect(normalized.parts[0].name).toBe("Housing-RevB");
    expect(normalized.parts[0].drawingIds).toEqual(["drw-1"]);
    expect(normalized.dimensions[0].drawingId).toBe("drw-1");
    expect(normalized.dimensions[1].drawingId).toBe("drw-1");
  });

  it("creates an empty project and new parts cleanly", () => {
    const empty = createEmptyProject("New Assembly");
    expect(empty.schemaVersion).toBe(1);
    expect(empty.name).toBe("New Assembly");
    expect(empty.parts).toEqual([]);
    expect(empty.drawings).toEqual([]);

    const root = createPart(null, "Top Cover");
    expect(root.parentId).toBeNull();
    expect(root.name).toBe("Top Cover");
    expect(root.drawingIds).toEqual([]);
  });

  it("resolves latest drawing to explicit latestDrawingId or falls back to most recently uploaded", () => {
    const base = createPart(null, "C Cover");
    expect(resolveLatestDrawingId(base)).toBeNull();

    const twoDrawings: Part = { ...base, drawingIds: ["d-1", "d-2"] };
    expect(resolveLatestDrawingId(twoDrawings)).toBe("d-2");

    const explicit: Part = { ...twoDrawings, latestDrawingId: "d-1" };
    expect(resolveLatestDrawingId(explicit)).toBe("d-1");

    const staleExplicit: Part = { ...twoDrawings, latestDrawingId: "d-deleted" };
    expect(resolveLatestDrawingId(staleExplicit)).toBe("d-2");
  });

  it("sorts drawings by custom order, alphabetical ascending, and descending", () => {
    const drawings = [
      {
        id: "d-b",
        filename: "part_revB.pdf",
        archivePath: "drawings/d-b.pdf",
        pageCount: 2,
        version: "B",
      },
      {
        id: "d-a",
        filename: "part_revA.pdf",
        archivePath: "drawings/d-a.pdf",
        pageCount: 2,
        version: "A",
      },
      {
        id: "d-c",
        filename: "part_revC.pdf",
        archivePath: "drawings/d-c.pdf",
        pageCount: 2,
        version: "C",
      },
    ];

    expect(sortDrawings(drawings, "custom").map((d) => d.id)).toEqual([
      "d-b",
      "d-a",
      "d-c",
    ]);
    expect(sortDrawings(drawings, "alpha_asc").map((d) => d.id)).toEqual([
      "d-a",
      "d-b",
      "d-c",
    ]);
    expect(sortDrawings(drawings, "alpha_desc").map((d) => d.id)).toEqual([
      "d-c",
      "d-b",
      "d-a",
    ]);
  });

  it("reorders drawing IDs accurately for pointer drag-and-drop slots", () => {
    expect(reorderDrawingIds(["d-1", "d-2", "d-3"], "d-3", 0)).toEqual([
      "d-3",
      "d-1",
      "d-2",
    ]);
    expect(reorderDrawingIds(["d-1", "d-2", "d-3"], "d-1", 3)).toEqual([
      "d-2",
      "d-3",
      "d-1",
    ]);
    // Dropping into the item's own adjacent slot is a no-op
    expect(reorderDrawingIds(["d-1", "d-2", "d-3"], "d-2", 1)).toEqual([
      "d-1",
      "d-2",
      "d-3",
    ]);
    expect(reorderDrawingIds(["d-1", "d-2", "d-3"], "d-2", 2)).toEqual([
      "d-1",
      "d-2",
      "d-3",
    ]);
  });
});
