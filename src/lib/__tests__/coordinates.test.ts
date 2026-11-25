import { describe, expect, it } from "vitest";
import {
  clamp01,
  clientPointToNormalized,
  normalizedToPixel,
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
});
