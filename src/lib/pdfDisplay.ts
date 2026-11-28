export type PdfThemeMode = "light" | "dark";
export type PdfLineWeightMode = "original" | "thin" | "custom";

export interface PdfDisplaySettings {
  theme: PdfThemeMode;
  lineWeightMode: PdfLineWeightMode;
  /** Target stroke width in CSS pixels when lineWeightMode === "custom" (0.25 .. 4.0) */
  customLineWidth: number;
  highContrast: boolean;
}

export const DEFAULT_PDF_DISPLAY_SETTINGS: PdfDisplaySettings = {
  theme: "light",
  lineWeightMode: "original",
  customLineWidth: 1.5,
  highContrast: false,
};

export const MIN_CUSTOM_LINE_WIDTH = 0.25;
export const MAX_CUSTOM_LINE_WIDTH = 4.0;

export function normalizePdfDisplaySettings(
  raw?: Partial<PdfDisplaySettings> | null,
): PdfDisplaySettings {
  if (!raw) return { ...DEFAULT_PDF_DISPLAY_SETTINGS };
  const theme: PdfThemeMode = raw.theme === "dark" ? "dark" : "light";
  const lineWeightMode: PdfLineWeightMode =
    raw.lineWeightMode === "thin" || raw.lineWeightMode === "custom"
      ? raw.lineWeightMode
      : "original";
  const customLineWidth =
    typeof raw.customLineWidth === "number" &&
    Number.isFinite(raw.customLineWidth)
      ? Math.min(
          MAX_CUSTOM_LINE_WIDTH,
          Math.max(MIN_CUSTOM_LINE_WIDTH, raw.customLineWidth),
        )
      : DEFAULT_PDF_DISPLAY_SETTINGS.customLineWidth;
  return {
    theme,
    lineWeightMode,
    customLineWidth,
    highContrast: Boolean(raw.highContrast),
  };
}

export function hasCustomPdfDisplaySettings(
  settings: PdfDisplaySettings,
): boolean {
  return (
    settings.theme !== DEFAULT_PDF_DISPLAY_SETTINGS.theme ||
    settings.lineWeightMode !== DEFAULT_PDF_DISPLAY_SETTINGS.lineWeightMode ||
    settings.highContrast !== DEFAULT_PDF_DISPLAY_SETTINGS.highContrast
  );
}

/**
 * Computes the CSS `filter` applied to rendered PDF canvases:
 * - Dark mode inverts white paper to dark CAD background while rotating hue 180deg
 *   so colored CAD lines (blue, red, green) preserve their hue & readability.
 * - High Contrast strips all color from raster images via `grayscale(1)` without
 *   destructive `contrast()` clipping (vector strokes are forced to crisp `#000000`
 *   in `configureLineWeightContext` so even faint light-gray/yellow CAD lines stay visible).
 */
export function buildPdfCanvasFilter(settings: PdfDisplaySettings): string {
  if (settings.highContrast) {
    if (settings.theme === "dark") {
      return "grayscale(1) invert(0.93)";
    }
    return "grayscale(1)";
  }
  if (settings.theme === "dark") {
    return "invert(0.93) hue-rotate(180deg)";
  }
  return "none";
}

function isNearWhiteCssColor(style: unknown): boolean {
  if (typeof style !== "string") return false;
  const s = style.trim().toLowerCase();
  if (s === "#fff" || s === "#ffffff" || s === "white") return true;
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgbMatch) {
    return (
      Number(rgbMatch[1]) >= 245 &&
      Number(rgbMatch[2]) >= 245 &&
      Number(rgbMatch[3]) >= 245
    );
  }
  const hex6 = /^#([0-9a-f]{6})$/.exec(s);
  if (hex6) {
    const r = Number.parseInt(hex6[1].slice(0, 2), 16);
    const g = Number.parseInt(hex6[1].slice(2, 4), 16);
    const b = Number.parseInt(hex6[1].slice(4, 6), 16);
    return r >= 245 && g >= 245 && b >= 245;
  }
  return false;
}

/**
 * Computes the Canvas2D user-space `lineWidth` needed to draw a stroke of
 * `targetDevicePx` device pixels under the given current transform matrix (CTM).
 */
export function computeStrokeUserLineWidth(
  ctm: { a: number; b: number; c: number; d: number },
  targetDevicePx: number,
): number {
  const det = Math.abs(ctm.a * ctm.d - ctm.b * ctm.c);
  const scale =
    det > 1e-12
      ? Math.sqrt(det)
      : Math.hypot(ctm.a, ctm.b) || Math.hypot(ctm.c, ctm.d) || 1;
  return Math.max(1e-4, targetDevicePx / scale);
}

interface LineWeightPatchedContext extends CanvasRenderingContext2D {
  __qoneNativeStroke?: (this: CanvasRenderingContext2D, path?: Path2D) => void;
  __qoneTargetLineWidthPx?: number | null;
  __qoneHighContrast?: boolean;
}

/**
 * Configures line-weight & high-contrast monochrome stroke overrides directly on a
 * native `CanvasRenderingContext2D` (compatible with Safari/WKWebView and PDF.js v5).
 * Stores the native `stroke` once per context and updates target properties so rapid
 * slider changes and cancelled renders never race or clobber each other.
 */
export function configureLineWeightContext(
  ctx: CanvasRenderingContext2D,
  settings: Pick<
    PdfDisplaySettings,
    "lineWeightMode" | "customLineWidth" | "highContrast"
  >,
  devicePixelRatio: number,
): void {
  const patched = ctx as LineWeightPatchedContext;
  const needsLineWeight = settings.lineWeightMode !== "original";
  const needsHighContrast = Boolean(settings.highContrast);

  if (!needsLineWeight && !needsHighContrast) {
    patched.__qoneTargetLineWidthPx = null;
    patched.__qoneHighContrast = false;
    if (patched.__qoneNativeStroke) {
      ctx.stroke =
        patched.__qoneNativeStroke as CanvasRenderingContext2D["stroke"];
    }
    return;
  }

  if (needsLineWeight) {
    const dpr = Math.max(1, devicePixelRatio || 1);
    const targetCssPx =
      settings.lineWeightMode === "thin"
        ? 0.75
        : Math.min(
            MAX_CUSTOM_LINE_WIDTH,
            Math.max(MIN_CUSTOM_LINE_WIDTH, settings.customLineWidth),
          );
    patched.__qoneTargetLineWidthPx = targetCssPx * dpr;
  } else {
    patched.__qoneTargetLineWidthPx = null;
  }
  patched.__qoneHighContrast = needsHighContrast;

  if (!patched.__qoneNativeStroke) {
    patched.__qoneNativeStroke = ctx.stroke as (
      this: CanvasRenderingContext2D,
      path?: Path2D,
    ) => void;
  }

  const nativeStroke = patched.__qoneNativeStroke;
  ctx.stroke = function (this: LineWeightPatchedContext, path?: Path2D) {
    const targetPx = this.__qoneTargetLineWidthPx;
    const highContrast = Boolean(this.__qoneHighContrast);
    if (targetPx == null && !highContrast) {
      if (path !== undefined) {
        nativeStroke.call(this, path);
      } else {
        nativeStroke.call(this);
      }
      return;
    }
    const prevWidth = this.lineWidth;
    const prevStyle = this.strokeStyle;
    try {
      if (targetPx != null) {
        const ctm = this.getTransform();
        this.lineWidth = computeStrokeUserLineWidth(ctm, targetPx);
      }
      if (highContrast && !isNearWhiteCssColor(prevStyle)) {
        this.strokeStyle = "#000000";
      }
      if (path !== undefined) {
        nativeStroke.call(this, path);
      } else {
        nativeStroke.call(this);
      }
    } finally {
      this.lineWidth = prevWidth;
      this.strokeStyle = prevStyle;
    }
  } as CanvasRenderingContext2D["stroke"];
}
