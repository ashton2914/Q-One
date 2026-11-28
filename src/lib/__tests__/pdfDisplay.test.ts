import { describe, expect, it } from "vitest";
import {
  DEFAULT_PDF_DISPLAY_SETTINGS,
  buildPdfCanvasFilter,
  computeStrokeUserLineWidth,
  configureLineWeightContext,
  hasCustomPdfDisplaySettings,
} from "../pdfDisplay";

describe("pdfDisplay", () => {
  it("builds accurate CSS filters for Light/Dark and High Contrast modes", () => {
    expect(buildPdfCanvasFilter(DEFAULT_PDF_DISPLAY_SETTINGS)).toBe("none");
    expect(
      buildPdfCanvasFilter({ ...DEFAULT_PDF_DISPLAY_SETTINGS, theme: "dark" }),
    ).toBe("invert(0.93) hue-rotate(180deg)");
    expect(
      buildPdfCanvasFilter({
        ...DEFAULT_PDF_DISPLAY_SETTINGS,
        highContrast: true,
      }),
    ).toBe("grayscale(1)");
    expect(
      buildPdfCanvasFilter({
        ...DEFAULT_PDF_DISPLAY_SETTINGS,
        theme: "dark",
        highContrast: true,
      }),
    ).toBe("grayscale(1) invert(0.93)");
  });

  it("computes user-space stroke width inversely proportional to CTM scale", () => {
    // 2x uniform scale -> 2 device px needs 1.0 user-space unit
    expect(
      computeStrokeUserLineWidth({ a: 2, b: 0, c: 0, d: 2 }, 2),
    ).toBeCloseTo(1, 5);
    // 90-degree rotated 4x scale -> 2 device px needs 0.5 user-space unit
    expect(
      computeStrokeUserLineWidth({ a: 0, b: 4, c: -4, d: 0 }, 2),
    ).toBeCloseTo(0.5, 5);
  });

  it("detects when any non-default display setting is active", () => {
    expect(hasCustomPdfDisplaySettings(DEFAULT_PDF_DISPLAY_SETTINGS)).toBe(
      false,
    );
    expect(
      hasCustomPdfDisplaySettings({
        ...DEFAULT_PDF_DISPLAY_SETTINGS,
        lineWeightMode: "thin",
      }),
    ).toBe(true);
  });

  it("configures native Canvas2D stroke override and forces non-white strokes to pure black in high contrast mode", () => {
    const observed: Array<{ width: number; style: string }> = [];
    const mockCtx = {
      lineWidth: 0.1,
      strokeStyle: "#cccccc",
      getTransform: () => ({ a: 2, b: 0, c: 0, d: 2 }),
      stroke(this: { lineWidth: number; strokeStyle: string }) {
        observed.push({ width: this.lineWidth, style: this.strokeStyle });
      },
    } as unknown as CanvasRenderingContext2D;

    configureLineWeightContext(
      mockCtx,
      { lineWeightMode: "custom", customLineWidth: 3, highContrast: true },
      2,
    );
    mockCtx.stroke();
    // targetDevicePx = 3 * 2 = 6; CTM scale = 2 -> user-space lineWidth = 3.0; light gray forced to #000000
    expect(observed).toEqual([{ width: 3, style: "#000000" }]);
    expect(mockCtx.lineWidth).toBe(0.1);
    expect(mockCtx.strokeStyle).toBe("#cccccc");

    // Switching back to original restores native stroke behavior
    configureLineWeightContext(
      mockCtx,
      { lineWeightMode: "original", customLineWidth: 3, highContrast: false },
      2,
    );
    mockCtx.stroke();
    expect(observed).toEqual([
      { width: 3, style: "#000000" },
      { width: 0.1, style: "#cccccc" },
    ]);
  });
});
