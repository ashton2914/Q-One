import { describe, expect, it } from "vitest";
import {
  computeFitZoom,
  shouldApplyFit,
  shouldBlockWindowClose,
  shouldClearDirtyAfterSave,
} from "../viewerState";

describe("viewerState review fixes", () => {
  it("applies Fit-to-View only once per fitRequestKey increment so zooming does not snap back", () => {
    const pageSize = { width: 800, height: 600 };
    // Never fits when key is 0 or pageSize not loaded yet
    expect(shouldApplyFit(0, 0, pageSize)).toBe(false);
    expect(shouldApplyFit(1, 0, null)).toBe(false);

    // Fits once when key advances and pageSize is ready
    expect(shouldApplyFit(1, 0, pageSize)).toBe(true);

    // Does NOT re-trigger fit on subsequent renders/zoom changes with the same key
    expect(shouldApplyFit(1, 1, { width: 800, height: 600 })).toBe(false);

    // Fits again only when user explicitly triggers Fit or opens a new document
    expect(shouldApplyFit(2, 1, pageSize)).toBe(true);
  });

  it("computes clamped Fit-to-View zoom from container and base page dimensions", () => {
    expect(computeFitZoom(1048, 848, 1000, 1000)).toBe(0.8);
    expect(computeFitZoom(4000, 4000, 100, 100)).toBe(4);
    expect(computeFitZoom(200, 200, 5000, 5000)).toBe(0.25);
  });

  it("clears dirty flag after async save only if no concurrent edit occurred", () => {
    expect(shouldClearDirtyAfterSave(3, 3)).toBe(true);
    expect(shouldClearDirtyAfterSave(3, 4)).toBe(false);
  });

  it("blocks window close when project has unsaved changes", () => {
    expect(shouldBlockWindowClose(true)).toBe(true);
    expect(shouldBlockWindowClose(false)).toBe(false);
  });
});
