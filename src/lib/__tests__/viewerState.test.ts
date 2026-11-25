import { describe, expect, it } from "vitest";
import {
  computeAnchoredScroll,
  computeCenterRegionScroll,
  computeFitZoom,
  computeSafeRenderScale,
  computeVisiblePageCrop,
  computeWheelTargetZoom,
  findMostVisiblePage,
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

  it("identifies the most visible page during continuous vertical scrolling", () => {
    const pages = [
      { page: 1, top: 0, height: 800 },
      { page: 2, top: 824, height: 800 },
      { page: 3, top: 1648, height: 800 },
    ];
    expect(findMostVisiblePage(0, 600, pages)).toBe(1);
    expect(findMostVisiblePage(600, 600, pages)).toBe(2);
    expect(findMostVisiblePage(1500, 600, pages)).toBe(3);
  });

  it("computes gentle clamped wheel zoom without excessive jumps", () => {
    const zoomedIn = computeWheelTargetZoom(1.0, -50);
    expect(zoomedIn).toBeGreaterThan(1.0);
    expect(zoomedIn).toBeLessThan(1.15);

    // Even a huge wheel spike is capped to a gentle step
    const capped = computeWheelTargetZoom(1.0, -1000);
    expect(capped).toBeLessThanOrEqual(1.2);

    // Clamps strictly to [0.25, 4]
    expect(computeWheelTargetZoom(4.0, -100)).toBe(4.0);
    expect(computeWheelTargetZoom(0.25, 100)).toBe(0.25);
  });

  it("keeps the cursor-anchored content point stationary during zoom", () => {
    // At zoom 1.0, scroll=100, cursor is at 300px in viewport, content pad=24 -> content coord = 376
    // At zoom 2.0, content coord scales to 752 -> scroll should be 752 + 24 - 300 = 476
    expect(computeAnchoredScroll(100, 300, 24, 1.0, 2.0)).toBeCloseTo(476, 4);
  });

  it("caps PDF canvas render scale so WebKit backing-store limits are never exceeded", () => {
    // Normal letter page at 1x on Retina keeps full 2x backing scale
    expect(computeSafeRenderScale(612, 792, 1.0, 2)).toBeCloseTo(2.0, 4);

    // Giant CAD sheet at 400% zoom on Retina must stay within safe side & pixel budgets
    const safeScale = computeSafeRenderScale(3400, 2200, 4.0, 2);
    const w = Math.floor(3400 * safeScale);
    const h = Math.floor(2200 * safeScale);
    expect(w).toBeLessThanOrEqual(4096);
    expect(h).toBeLessThanOrEqual(4096);
    expect(w * h).toBeLessThanOrEqual(12_000_000);
    expect(safeScale).toBeGreaterThan(0.5);
  });

  it("computes visible viewport crop on a zoomed page for native-vector detail rendering", () => {
    // Page is 10000x6000 positioned at (-3000, -1500) relative to a 1000x800 viewport
    const crop = computeVisiblePageCrop(
      { left: -3000, top: -1500, width: 10000, height: 6000 },
      { left: 0, top: 0, width: 1000, height: 800 },
      100,
    );
    expect(crop).toEqual({
      x: 2900,
      y: 1400,
      width: 1200,
      height: 1000,
    });

    // Clamps cleanly at page edges (0, 0)
    const edgeCrop = computeVisiblePageCrop(
      { left: 50, top: 20, width: 1000, height: 800 },
      { left: 0, top: 0, width: 500, height: 400 },
      100,
    );
    expect(edgeCrop).toEqual({
      x: 0,
      y: 0,
      width: 550,
      height: 480,
    });

    // Returns null when page is completely off-screen
    expect(
      computeVisiblePageCrop(
        { left: 0, top: 2000, width: 1000, height: 800 },
        { left: 0, top: 0, width: 1000, height: 800 },
        100,
      ),
    ).toBeNull();
  });

  it("centers a marked region in the viewport and clamps at scroll boundaries", () => {
    // 1000x800 viewport inside 4000x3000 scrollable content; page starts at (24, 24) and is 3952x2952
    // Region center at (0.5, 0.5) => content center (2000, 1500) => scroll (1500, 1100)
    const centered = computeCenterRegionScroll({
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 4000,
      scrollHeight: 3000,
      viewportLeft: 0,
      viewportTop: 0,
      viewportWidth: 1000,
      viewportHeight: 800,
      pageLeft: 24,
      pageTop: 24,
      pageWidth: 3952,
      pageHeight: 2952,
      markerX: 0.45,
      markerY: 0.45,
      markerWidth: 0.1,
      markerHeight: 0.1,
    });
    expect(centered.left).toBeCloseTo(1500, 4);
    expect(centered.top).toBeCloseTo(1100, 4);

    // Near top-left edge clamps cleanly to 0; near bottom-right clamps cleanly to maxScroll
    const topLeft = computeCenterRegionScroll({
      scrollLeft: 500,
      scrollTop: 500,
      scrollWidth: 4000,
      scrollHeight: 3000,
      viewportLeft: 0,
      viewportTop: 0,
      viewportWidth: 1000,
      viewportHeight: 800,
      pageLeft: -476,
      pageTop: -476,
      pageWidth: 3952,
      pageHeight: 2952,
      markerX: 0.01,
      markerY: 0.01,
      markerWidth: 0.02,
      markerHeight: 0.02,
    });
    expect(topLeft.left).toBe(0);
    expect(topLeft.top).toBe(0);
  });
});
