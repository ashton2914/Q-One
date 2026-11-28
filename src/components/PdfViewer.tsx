import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Contrast,
  Copy,
  Crosshair,
  Hand,
  LocateFixed,
  Maximize2,
  Moon,
  Move,
  RefreshCw,
  RotateCcw,
  ScanText,
  SlidersHorizontal,
  Sun,
  TextCursor,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  computeAnchoredScroll,
  computeCenterRegionScroll,
  computeFitZoom,
  computeHighlightAutoZoom,
  computeSafeRenderScale,
  computeVisiblePageCrop,
  computeWheelPanDelta,
  computeWheelTargetZoom,
  detectWheelZoomInputMode,
  findMostVisiblePage,
  resolveViewerKeyAction,
  shouldApplyFit,
  type PageCrop,
  type PageDimensions,
  type ViewerPanKey,
  type ViewerTool,
} from "../lib/viewerState";
import { BalloonOverlay } from "./BalloonOverlay";
import { FloatingMenu } from "./ui";
import {
  DEFAULT_PDF_DISPLAY_SETTINGS,
  MAX_CUSTOM_LINE_WIDTH,
  MIN_CUSTOM_LINE_WIDTH,
  buildPdfCanvasFilter,
  configureLineWeightContext,
  hasCustomPdfDisplaySettings,
  type PdfDisplaySettings,
} from "../lib/pdfDisplay";
import { loadAppSettings, saveAppSettings } from "../lib/tauriApi";
import { getAnnotationKind } from "../lib/annotations";
import { getAnnotationPage } from "../lib/dimensions";
import type { PointCaptureField } from "../lib/annotationRecognize";
import { POINT_CAPTURE_STEPS } from "../lib/annotationRecognize";
import {
  computeCalibratedPointCoords,
  hasPointIdCollisionOnPage,
} from "../lib/pointGroups";
import { evaluateFormulaInput } from "../lib/mathEval";
import type {
  Dimension,
  MarkerPosition,
  PointGroupCalibration,
} from "../types/project";

export type PointEntryPickMode = "x_zero" | "y_zero" | "anchor" | "place";

export interface PointEntrySession {
  page: number;
  groupId: string | null;
  pickMode: PointEntryPickMode;
  nextId: string;
  calibration: PointGroupCalibration;
  placedCount: number;
}

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const CONTAINER_PADDING_PX = 24;
const EMPTY_CAPTURE_REGIONS: Array<{
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}> = [];

export interface ScrollToPageRequest {
  page: number;
  marker?: MarkerPosition;
  key: number;
}

export interface DrawingSwitchOption {
  id: string;
  label: string;
}

export interface PdfViewerProps {
  isActive?: boolean;
  pdfBytes: Uint8Array | null;
  drawingId: string | null;
  drawingFilename: string | null;
  drawingOptions?: DrawingSwitchOption[];
  onSwitchDrawing?: (drawingId: string) => void;
  currentPage: number;
  pageCount: number;
  zoom: number;
  fitRequestKey: number;
  scrollToPageRequest: ScrollToPageRequest | null;
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  selectedDimensionIds?: string[];
  editingDimensionId: string | null;
  placingDimensionId: string | null;
  pointCapturePage?: number | null;
  pointCaptureStep?: PointCaptureField | null;
  pointCaptureRegions?: Array<{
    field: PointCaptureField;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  }>;
  onPageCountLoaded: (pageCount: number, pageAspectRatios?: number[]) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onFitToView: () => void;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onAddPointCaptureRegion?: (rect: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onAdvancePointCaptureStep?: () => void;
  onApplyPointCapture?: () => void;
  onCancelPointCapture?: () => void;
  pointEntrySession?: PointEntrySession | null;
  onTogglePointEntry?: () => void;
  onUpdatePointEntry?: (patch: Partial<PointEntrySession>) => void;
  onUpdatePointEntryCalibration?: (patch: Partial<PointGroupCalibration>) => void;
  hasCopiedPointEntryCalibration?: boolean;
  onCopyPointEntryCalibration?: () => void;
  onPastePointEntryCalibration?: () => void;
  onRecalculatePointGroupCoords?: () => void;
  onPointEntryClick?: (page: number, x: number, y: number) => void;
  onClosePointEntry?: () => void;
  onSelectDimension: (dimensionId: string, additive?: boolean) => void;
  onClearSelection?: () => void;
  onMoveMarker: (
    dimensionId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  onBatchMoveMarkers?: (
    updates: Array<{ id: string; marker: MarkerPosition }>,
  ) => void;
  onCancelPlacing: () => void;
}

interface PdfPageItemProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  baseSize: PageDimensions;
  displayZoom: number;
  renderZoom: number;
  viewportEpoch: number;
  viewerTool: ViewerTool;
  drawingId: string | null;
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  selectedDimensionIds?: string[];
  editingDimensionId: string | null;
  placingDimensionId: string | null;
  captureMode?: boolean;
  captureRegions?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  }>;
  pointEntryActive?: boolean;
  pointEntryCalibration?: PointGroupCalibration | null;
  batchMovePhase?: "select" | "move" | null;
  batchMoveSelectedIds?: readonly string[];
  displaySettings: PdfDisplaySettings;
  onToggleBatchMoveIds?: (
    ids: string[],
    mode: "toggle" | "add" | "remove",
  ) => void;
  onBatchMoveMarkers?: (
    updates: Array<{ id: string; marker: MarkerPosition }>,
  ) => void;
  scrollContainer: HTMLDivElement | null;
  registerPageEl: (page: number, el: HTMLDivElement | null) => void;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onAddCaptureRegion?: (rect: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onPointEntryClick?: (page: number, x: number, y: number) => void;
  onPointEntryHover?: (pos: { x: number; y: number } | null) => void;
  onSelectDimension: (dimensionId: string, additive?: boolean) => void;
  onMoveMarker: (
    dimensionId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
}

interface DetailTileRect extends PageCrop {
  zoom: number;
  lineWeightKey: string;
}

const PdfPageItem = memo(function PdfPageItem({
  pdfDoc,
  pageNumber,
  baseSize,
  displayZoom,
  renderZoom,
  viewportEpoch,
  viewerTool,
  drawingId,
  dimensions,
  selectedDimensionId,
  selectedDimensionIds,
  editingDimensionId,
  placingDimensionId,
  captureMode = false,
  captureRegions = [],
  pointEntryActive = false,
  pointEntryCalibration = null,
  batchMovePhase = null,
  batchMoveSelectedIds = [],
  displaySettings,
  onToggleBatchMoveIds,
  onBatchMoveMarkers,
  scrollContainer,
  registerPageEl,
  onPlaceMarker,
  onAddCaptureRegion,
  onPointEntryClick,
  onPointEntryHover,
  onSelectDimension,
  onMoveMarker,
}: PdfPageItemProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);
  const textLayerScaleRef = useRef<number>(0);
  const baseScaleRef = useRef<number>(0);
  const baseLineWeightKeyRef = useRef<string>("");
  const detailTileRef = useRef<DetailTileRect | null>(null);
  const baseOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const detailOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const displayZoomRef = useRef<number>(displayZoom);
  displayZoomRef.current = displayZoom;
  const [isVisible, setIsVisible] = useState<boolean>(pageNumber <= 2);

  // Keep detail canvas geometry in sync with displayZoom synchronously during zoom animations
  useLayoutEffect(() => {
    const target = detailCanvasRef.current;
    const tile = detailTileRef.current;
    if (!target || !tile) return;
    const ratio = displayZoom / tile.zoom;
    target.style.left = `${tile.x * ratio}px`;
    target.style.top = `${tile.y * ratio}px`;
    target.style.width = `${tile.width * ratio}px`;
    target.style.height = `${tile.height * ratio}px`;
  }, [displayZoom]);

  const width = Math.max(1, Math.round(baseSize.width * displayZoom));
  const height = Math.max(1, Math.round(baseSize.height * displayZoom));

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      registerPageEl(pageNumber, el);
    },
    [pageNumber, registerPageEl],
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !scrollContainer) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting);
        }
      },
      { root: scrollContainer, rootMargin: "250px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollContainer]);

  // Release reusable offscreen canvases cleanly on unmount to prevent WKWebView GPU surface leaks
  useEffect(() => {
    return () => {
      if (baseOffscreenRef.current) {
        baseOffscreenRef.current.width = 0;
        baseOffscreenRef.current.height = 0;
        baseOffscreenRef.current = null;
      }
      if (detailOffscreenRef.current) {
        detailOffscreenRef.current.width = 0;
        detailOffscreenRef.current.height = 0;
        detailOffscreenRef.current = null;
      }
    };
  }, []);

  // Layer 1: Lightweight base overview canvas (always stays visible while panning/zooming)
  useEffect(() => {
    const baseCanvas = baseCanvasRef.current;
    if (!baseCanvas) return;

    if (!isVisible) {
      baseCanvas.width = 0;
      baseCanvas.height = 0;
      baseScaleRef.current = 0;
      if (detailCanvasRef.current) {
        detailCanvasRef.current.style.opacity = "0";
        detailCanvasRef.current.width = 0;
        detailCanvasRef.current.height = 0;
      }
      if (baseOffscreenRef.current) {
        baseOffscreenRef.current.width = 0;
        baseOffscreenRef.current.height = 0;
      }
      if (detailOffscreenRef.current) {
        detailOffscreenRef.current.width = 0;
        detailOffscreenRef.current.height = 0;
      }
      detailTileRef.current = null;
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Keep overview backing store strictly bounded (~12MB max) so macOS WKWebView Metal GPU never OOMs
    const rawOverviewScale = computeSafeRenderScale(
      baseSize.width,
      baseSize.height,
      Math.min(renderZoom, 1.0),
      dpr,
    );
    const overviewMaxSide = Math.min(
      2048 / Math.max(1, baseSize.width),
      2048 / Math.max(1, baseSize.height),
    );
    const overviewMaxArea = Math.sqrt(
      3_000_000 / Math.max(1, baseSize.width * baseSize.height),
    );
    const targetBaseScale = Math.max(
      0.1,
      Math.min(rawOverviewScale, overviewMaxSide, overviewMaxArea),
    );
    const lineWeightKey = `${displaySettings.lineWeightMode}:${displaySettings.customLineWidth}:${displaySettings.highContrast ? 1 : 0}`;
    // Avoid re-rendering overview layer once rendered at sufficient overview quality with matching line weights
    if (
      baseCanvas.width > 0 &&
      baseScaleRef.current > 0 &&
      Math.abs(baseScaleRef.current - targetBaseScale) < 0.05 &&
      baseLineWeightKeyRef.current === lineWeightKey
    ) {
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !baseCanvasRef.current) return;
        const renderViewport = page.getViewport({ scale: targetBaseScale });
        if (!baseOffscreenRef.current) {
          baseOffscreenRef.current = document.createElement("canvas");
        }
        const offscreen = baseOffscreenRef.current;
        offscreen.width = Math.max(1, Math.floor(renderViewport.width));
        offscreen.height = Math.max(1, Math.floor(renderViewport.height));

        const offCtx = offscreen.getContext("2d");
        if (!offCtx) return;

        configureLineWeightContext(offCtx, displaySettings, dpr);
        const task = page.render({
          canvas: offscreen,
          canvasContext: offCtx,
          viewport: renderViewport,
        });
        renderTask = task;
        return task.promise.then(() => {
          if (cancelled || !baseCanvasRef.current) return;
          const target = baseCanvasRef.current;
          target.width = offscreen.width;
          target.height = offscreen.height;
          const targetCtx = target.getContext("2d");
          if (targetCtx) {
            targetCtx.drawImage(offscreen, 0, 0);
            baseScaleRef.current = targetBaseScale;
            baseLineWeightKeyRef.current = lineWeightKey;
          }
          offscreen.width = 0;
          offscreen.height = 0;
        });
      })
      .catch((err: unknown) => {
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "RenderingCancelledException"
        ) {
          return;
        }
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [
    pdfDoc,
    pageNumber,
    baseSize.width,
    baseSize.height,
    renderZoom,
    isVisible,
    displaySettings.lineWeightMode,
    displaySettings.customLineWidth,
    displaySettings.highContrast,
  ]);

  // Layer 2: Razor-sharp native-vector viewport detail tile at FULL renderZoom * dpr
  useEffect(() => {
    const detailCanvas = detailCanvasRef.current;
    const wrapperEl = wrapperRef.current;
    if (!detailCanvas || !wrapperEl || !scrollContainer || !isVisible) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const desiredScale = renderZoom * dpr;
    const overviewScale = Math.max(
      0.1,
      Math.min(
        computeSafeRenderScale(
          baseSize.width,
          baseSize.height,
          Math.min(renderZoom, 1.0),
          dpr,
        ),
        2048 / Math.max(1, baseSize.width),
        2048 / Math.max(1, baseSize.height),
        Math.sqrt(3_000_000 / Math.max(1, baseSize.width * baseSize.height)),
      ),
    );

    // If overview layer already covers full native resolution, no detail tile needed
    if (desiredScale <= overviewScale * 1.05) {
      detailCanvas.style.opacity = "0";
      detailCanvas.width = 0;
      detailCanvas.height = 0;
      detailTileRef.current = null;
      return;
    }

    const pageRect = wrapperEl.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();

    // Skip re-rendering if existing detail tile at the same zoom already covers the visible viewport
    const existing = detailTileRef.current;
    const tightCrop = computeVisiblePageCrop(pageRect, containerRect, 0);
    if (!tightCrop) {
      detailCanvas.style.opacity = "0";
      detailCanvas.width = 0;
      detailCanvas.height = 0;
      detailTileRef.current = null;
      return;
    }
    const lineWeightKey = `${displaySettings.lineWeightMode}:${displaySettings.customLineWidth}:${displaySettings.highContrast ? 1 : 0}`;
    if (
      existing &&
      existing.lineWeightKey === lineWeightKey &&
      Math.abs(existing.zoom - renderZoom) < 0.001 &&
      existing.x <= tightCrop.x &&
      existing.y <= tightCrop.y &&
      existing.x + existing.width >= tightCrop.x + tightCrop.width &&
      existing.y + existing.height >= tightCrop.y + tightCrop.height
    ) {
      return;
    }

    const crop = computeVisiblePageCrop(pageRect, containerRect, 80);
    if (!crop) {
      detailCanvas.style.opacity = "0";
      detailCanvas.width = 0;
      detailCanvas.height = 0;
      detailTileRef.current = null;
      return;
    }

    // Strictly cap detail tile backing store (~18MB max) so macOS WKWebView GPU process stays rock-solid
    const tileDpr = Math.min(
      dpr,
      2560 / Math.max(1, crop.width),
      2560 / Math.max(1, crop.height),
      Math.sqrt(4_500_000 / Math.max(1, crop.width * crop.height)),
    );

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !detailCanvasRef.current) return;
        const viewport = page.getViewport({ scale: renderZoom });
        if (!detailOffscreenRef.current) {
          detailOffscreenRef.current = document.createElement("canvas");
        }
        const offscreen = detailOffscreenRef.current;
        offscreen.width = Math.max(1, Math.floor(crop.width * tileDpr));
        offscreen.height = Math.max(1, Math.floor(crop.height * tileDpr));

        const offCtx = offscreen.getContext("2d");
        if (!offCtx) return;

        // Translate native PDF vector drawing directly to the visible viewport crop
        configureLineWeightContext(offCtx, displaySettings, tileDpr);
        const task = page.render({
          canvas: offscreen,
          canvasContext: offCtx,
          viewport,
          transform: [
            tileDpr,
            0,
            0,
            tileDpr,
            -crop.x * tileDpr,
            -crop.y * tileDpr,
          ],
        });
        renderTask = task;
        return task.promise.then(() => {
          if (cancelled || !detailCanvasRef.current) return;
          const target = detailCanvasRef.current;
          const targetCtx = target.getContext("2d");
          if (!targetCtx) return;

          // Atomically update both canvas bitmap AND CSS position in the exact same frame
          const ratio = displayZoomRef.current / renderZoom;
          target.width = offscreen.width;
          target.height = offscreen.height;
          target.style.left = `${crop.x * ratio}px`;
          target.style.top = `${crop.y * ratio}px`;
          target.style.width = `${crop.width * ratio}px`;
          target.style.height = `${crop.height * ratio}px`;
          target.style.opacity = "1";
          targetCtx.drawImage(offscreen, 0, 0);
          detailTileRef.current = { ...crop, zoom: renderZoom, lineWeightKey };
          offscreen.width = 0;
          offscreen.height = 0;
        });
      })
      .catch((err: unknown) => {
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "RenderingCancelledException"
        ) {
          return;
        }
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [
    pdfDoc,
    pageNumber,
    baseSize.width,
    baseSize.height,
    renderZoom,
    viewportEpoch,
    isVisible,
    scrollContainer,
    displaySettings.lineWeightMode,
    displaySettings.customLineWidth,
    displaySettings.highContrast,
  ]);

  // Layer 3: Selectable PDF.js TextLayer (lazy-rendered only when visible in Text Selection mode)
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) return;

    if (!isVisible || viewerTool !== "text") {
      if (textLayerInstanceRef.current) {
        textLayerInstanceRef.current.cancel();
        textLayerInstanceRef.current = null;
      }
      textLayerScaleRef.current = 0;
      container.replaceChildren();
      return;
    }

    let cancelled = false;

    pdfDoc
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled || !textLayerRef.current) return;
        const viewport = page.getViewport({ scale: renderZoom });

        if (textLayerInstanceRef.current && textLayerScaleRef.current > 0) {
          if (Math.abs(textLayerScaleRef.current - renderZoom) >= 0.005) {
            textLayerInstanceRef.current.update({ viewport });
            textLayerScaleRef.current = renderZoom;
          }
          return;
        }

        const textContent = await page.getTextContent();
        if (cancelled || !textLayerRef.current) return;

        textLayerRef.current.replaceChildren();
        const layer = new TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport,
        });
        textLayerInstanceRef.current = layer;
        textLayerScaleRef.current = renderZoom;
        await layer.render();
      })
      .catch(() => {
        // Ignore cancellation / text extraction errors on image-only pages
      });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, isVisible, viewerTool, renderZoom]);

  // Clean up TextLayer instance on document change or unmount
  useEffect(() => {
    return () => {
      if (textLayerInstanceRef.current) {
        textLayerInstanceRef.current.cancel();
        textLayerInstanceRef.current = null;
      }
      textLayerScaleRef.current = 0;
    };
  }, [pdfDoc, pageNumber]);

  const isTextSelectable =
    viewerTool === "text" &&
    !placingDimensionId &&
    !captureMode &&
    !pointEntryActive;

  const canvasFilter = buildPdfCanvasFilter(displaySettings);

  return (
    <div
      ref={setRefs}
      style={{ width, height }}
      className={`relative shrink-0 overflow-hidden ring-1 ring-neutral-700/80 ${
        displaySettings.theme === "dark" ? "bg-[#121212]" : "bg-white"
      }`}
    >
      <canvas
        ref={baseCanvasRef}
        style={canvasFilter !== "none" ? { filter: canvasFilter } : undefined}
        className="block h-full w-full"
      />
      <canvas
        ref={detailCanvasRef}
        style={{
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          opacity: 0,
          ...(canvasFilter !== "none" ? { filter: canvasFilter } : {}),
        }}
        className="pointer-events-none absolute block"
      />
      <div
        ref={textLayerRef}
        style={
          {
            "--total-scale-factor": displayZoom,
          } as React.CSSProperties
        }
        className={`textLayer ${
          isTextSelectable
            ? "pointer-events-auto select-text"
            : "pointer-events-none select-none"
        }`}
      />
      {drawingId &&
        (isVisible ||
          Boolean(placingDimensionId) ||
          captureMode ||
          pointEntryActive) && (
        <BalloonOverlay
          dimensions={dimensions}
          currentPage={pageNumber}
          drawingId={drawingId}
          width={Math.max(1, Math.round(baseSize.width * renderZoom))}
          height={Math.max(1, Math.round(baseSize.height * renderZoom))}
          selectedDimensionId={selectedDimensionId}
          selectedDimensionIds={selectedDimensionIds}
          editingDimensionId={editingDimensionId}
          placingDimensionId={placingDimensionId}
          captureMode={captureMode}
          captureRegions={captureRegions}
          pointEntryActive={pointEntryActive}
          pointEntryCalibration={pointEntryCalibration}
          batchMovePhase={batchMovePhase}
          batchMoveSelectedIds={batchMoveSelectedIds}
          onToggleBatchMoveIds={onToggleBatchMoveIds}
          onBatchMoveMarkers={onBatchMoveMarkers}
          passthroughMarkers={isTextSelectable}
          onPlaceMarker={onPlaceMarker}
          onAddCaptureRegion={onAddCaptureRegion}
          onPointEntryClick={onPointEntryClick}
          onPointEntryHover={onPointEntryHover}
          onSelectDimension={onSelectDimension}
          onMoveMarker={onMoveMarker}
        />
      )}
    </div>
  );
});

interface ZoomAnchor {
  cursorX: number;
  cursorY: number;
  prevZoom: number;
  prevScrollLeft: number;
  prevScrollTop: number;
  /** Exact page & normalized page coordinates under the zoom focal point */
  page: number | null;
  normX: number;
  normY: number;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  targetScrollLeft: number;
  targetScrollTop: number;
}

export function PdfViewer({
  isActive = true,
  pdfBytes,
  drawingId,
  drawingFilename: _drawingFilename,
  drawingOptions: _drawingOptions,
  onSwitchDrawing: _onSwitchDrawing,
  currentPage,
  pageCount,
  zoom,
  fitRequestKey,
  scrollToPageRequest,
  dimensions,
  selectedDimensionId,
  selectedDimensionIds,
  editingDimensionId,
  placingDimensionId,
  pointCapturePage = null,
  pointCaptureStep = null,
  pointCaptureRegions = [],
  onPageCountLoaded,
  onPageChange,
  onZoomChange,
  onFitToView,
  onPlaceMarker,
  onAddPointCaptureRegion,
  onAdvancePointCaptureStep,
  onApplyPointCapture,
  onCancelPointCapture,
  pointEntrySession = null,
  onTogglePointEntry,
  onUpdatePointEntry,
  onUpdatePointEntryCalibration,
  hasCopiedPointEntryCalibration = false,
  onCopyPointEntryCalibration,
  onPastePointEntryCalibration,
  onRecalculatePointGroupCoords,
  onPointEntryClick,
  onClosePointEntry,
  onSelectDimension,
  onClearSelection,
  onMoveMarker,
  onBatchMoveMarkers,
  onCancelPlacing,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const appliedFitKeyRef = useRef<number>(0);
  const currentPageRef = useRef<number>(currentPage);
  currentPageRef.current = currentPage;

  // Smooth zoom state: targetZoom -> displayZoom (60fps rAF) -> renderZoom (debounced HiDPI)
  const [displayZoom, setDisplayZoom] = useState<number>(zoom);
  const [renderZoom, setRenderZoom] = useState<number>(zoom);
  const displayZoomRef = useRef<number>(zoom);
  displayZoomRef.current = displayZoom;
  const targetZoomRef = useRef<number>(zoom);
  const zoomRafRef = useRef<number | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const pendingAnchorScrollRef = useRef<ZoomAnchor | null>(null);
  const committedDisplayZoomRef = useRef<number>(zoom);
  const pendingCenterRegionRef = useRef<{
    page: number;
    marker: { x: number; y: number; width: number; height: number };
    expectedZoom: number;
  } | null>(null);

  // Active viewer tool: Hand (pan) vs Text Selection
  const [viewerTool, setViewerTool] = useState<ViewerTool>("hand");
  const [pointEntryHoverPos, setPointEntryHoverPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [batchMoveSession, setBatchMoveSession] = useState<{
    phase: "select" | "move";
    selectedIds: string[];
  } | null>(null);
  const [displaySettings, setDisplaySettings] = useState<PdfDisplaySettings>(
    DEFAULT_PDF_DISPLAY_SETTINGS,
  );
  const displaySettingsHydratedRef = useRef<boolean>(false);
  const [displayMenuPos, setDisplayMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Load persisted PDF display settings from ~/.config/qone/settings.json on mount
  useEffect(() => {
    let cancelled = false;
    void loadAppSettings().then((loaded) => {
      if (cancelled) return;
      setDisplaySettings(loaded.pdfDisplay);
      displaySettingsHydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist PDF display settings to ~/.config/qone/settings.json whenever user changes them
  useEffect(() => {
    if (!displaySettingsHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveAppSettings({ pdfDisplay: displaySettings });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [displaySettings]);

  useEffect(() => {
    if (!displayMenuPos) return;
    const close = () => setDisplayMenuPos(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [displayMenuPos]);

  useEffect(() => {
    setBatchMoveSession(null);
  }, [drawingId]);

  // Close batch move when another exclusive overlay mode opens
  useEffect(() => {
    if (pointEntrySession || placingDimensionId || pointCapturePage !== null) {
      setBatchMoveSession(null);
    }
  }, [pointEntrySession, placingDimensionId, pointCapturePage]);

  const handleToggleBatchMoveTool = useCallback(() => {
    setBatchMoveSession((prev) => {
      if (prev) return null;
      if (pointEntrySession) onClosePointEntry?.();
      if (placingDimensionId) onCancelPlacing();
      return { phase: "select", selectedIds: [] };
    });
  }, [pointEntrySession, placingDimensionId, onClosePointEntry, onCancelPlacing]);

  const handleToggleBatchMoveIds = useCallback(
    (ids: string[], mode: "toggle" | "add" | "remove") => {
      setBatchMoveSession((prev) => {
        if (!prev) return prev;
        const set = new Set(prev.selectedIds);
        for (const id of ids) {
          if (mode === "add") {
            set.add(id);
          } else if (mode === "remove") {
            set.delete(id);
          } else if (set.has(id)) {
            set.delete(id);
          } else {
            set.add(id);
          }
        }
        return { ...prev, selectedIds: [...set] };
      });
    },
    [],
  );

  // Batch Move keyboard shortcuts: Space confirms selection -> move phase; Esc clears selection or exits; Enter finishes
  useEffect(() => {
    if (!isActive || !batchMoveSession) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase() ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setBatchMoveSession((prev) => {
          if (!prev) return null;
          if (prev.phase === "move") {
            return { ...prev, phase: "select" };
          }
          if (prev.selectedIds.length > 0) {
            return { ...prev, selectedIds: [] };
          }
          return null;
        });
        return;
      }

      if (e.key === " " || e.code === "Space") {
        if (
          batchMoveSession.phase === "select" &&
          batchMoveSession.selectedIds.length > 0
        ) {
          e.preventDefault();
          e.stopPropagation();
          setBatchMoveSession((prev) =>
            prev && prev.selectedIds.length > 0
              ? { ...prev, phase: "move" }
              : prev,
          );
        }
        return;
      }

      if (e.key === "Enter" && batchMoveSession.phase === "move") {
        e.preventDefault();
        e.stopPropagation();
        setBatchMoveSession(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isActive, batchMoveSession]);

  // Smooth drag-pan state & empty-space click detection
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panRef = useRef<PanState | null>(null);
  const panRafRef = useRef<number | null>(null);
  const emptyClickRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const switchViewerTool = useCallback(
    (nextTool: ViewerTool) => {
      setBatchMoveSession(null);
      if (pointEntrySession) {
        onClosePointEntry?.();
      }
      setViewerTool(nextTool);
      if (nextTool === "hand") {
        window.getSelection()?.removeAllRanges();
      } else {
        panRef.current = null;
        setIsPanning(false);
      }
    },
    [pointEntrySession, onClosePointEntry],
  );

  const savedScrollRef = useRef<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  const isActiveRef = useRef<boolean>(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    savedScrollRef.current = { left: 0, top: 0 };
  }, [drawingId]);

  useLayoutEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollLeft = savedScrollRef.current.left;
    container.scrollTop = savedScrollRef.current.top;
    setViewportEpoch((e) => e + 1);
  }, [isActive]);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageDimensions[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [viewportEpoch, setViewportEpoch] = useState<number>(0);

  const captureZoomAnchor = useCallback(
    (clientX: number, clientY: number): ZoomAnchor | null => {
      const container = containerRef.current;
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();

      let bestPage: number | null = null;
      let bestDist = Infinity;
      let bestRect: DOMRect | null = null;

      pageElsRef.current.forEach((pageEl, pageNum) => {
        const pRect = pageEl.getBoundingClientRect();
        if (pRect.width <= 0 || pRect.height <= 0) return;
        const dy =
          clientY < pRect.top
            ? pRect.top - clientY
            : clientY > pRect.bottom
              ? clientY - pRect.bottom
              : 0;
        if (dy < bestDist) {
          bestDist = dy;
          bestPage = pageNum;
          bestRect = pRect;
        }
      });

      const normX = bestRect
        ? (clientX - (bestRect as DOMRect).left) / (bestRect as DOMRect).width
        : 0.5;
      const normY = bestRect
        ? (clientY - (bestRect as DOMRect).top) / (bestRect as DOMRect).height
        : 0.5;

      return {
        cursorX: clientX - containerRect.left,
        cursorY: clientY - containerRect.top,
        prevZoom: displayZoomRef.current,
        prevScrollLeft: container.scrollLeft,
        prevScrollTop: container.scrollTop,
        page: bestPage,
        normX,
        normY,
      };
    },
    [],
  );

  const startSmoothZoomAnimation = useCallback(() => {
    if (zoomRafRef.current !== null) return;

    const step = () => {
      const current = displayZoomRef.current;
      const target = targetZoomRef.current;
      const diff = target - current;

      if (Math.abs(diff) < 0.002) {
        zoomRafRef.current = null;
        if (current !== target) {
          const container = containerRef.current;
          if (container && zoomAnchorRef.current) {
            pendingAnchorScrollRef.current = {
              ...zoomAnchorRef.current,
              prevZoom: current,
              prevScrollLeft: container.scrollLeft,
              prevScrollTop: container.scrollTop,
            };
          }
          displayZoomRef.current = target;
          setDisplayZoom(target);
        }
        const rounded = Math.round(target * 100) / 100;
        onZoomChange(rounded);
        return;
      }

      const next = current + diff * 0.28;
      const container = containerRef.current;
      if (container && zoomAnchorRef.current) {
        pendingAnchorScrollRef.current = {
          ...zoomAnchorRef.current,
          prevZoom: current,
          prevScrollLeft: container.scrollLeft,
          prevScrollTop: container.scrollTop,
        };
      }
      displayZoomRef.current = next;
      setDisplayZoom(next);
      zoomRafRef.current = window.requestAnimationFrame(step);
    };

    zoomRafRef.current = window.requestAnimationFrame(step);
  }, [onZoomChange]);

  // Keyboard shortcuts: C=Pan, V=Text, P=Points, M=Move, WASD=Smooth Pan, Q=Zoom Out, E=Zoom In
  const activePanKeysRef = useRef<Set<ViewerPanKey>>(new Set());
  const panShiftHeldRef = useRef<boolean>(false);
  const keyPanRafRef = useRef<number | null>(null);
  const keyPanLastTimeRef = useRef<number>(0);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isActive) {
      activePanKeysRef.current.clear();
      if (keyPanRafRef.current !== null) {
        window.cancelAnimationFrame(keyPanRafRef.current);
        keyPanRafRef.current = null;
      }
      return;
    }

    const stopKeyPanLoop = () => {
      activePanKeysRef.current.clear();
      if (keyPanRafRef.current !== null) {
        window.cancelAnimationFrame(keyPanRafRef.current);
        keyPanRafRef.current = null;
      }
    };

    const tickKeyPan = (now: number) => {
      const keys = activePanKeysRef.current;
      const container = containerRef.current;
      if (keys.size === 0 || !container) {
        keyPanRafRef.current = null;
        return;
      }
      const dtSec = Math.min(0.05, Math.max(0.001, (now - keyPanLastTimeRef.current) / 1000));
      keyPanLastTimeRef.current = now;
      const speed = panShiftHeldRef.current ? 1600 : 820;
      let dx = 0;
      let dy = 0;
      if (keys.has("a")) dx -= 1;
      if (keys.has("d")) dx += 1;
      if (keys.has("w")) dy -= 1;
      if (keys.has("s")) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        container.scrollLeft += (dx / len) * speed * dtSec;
        container.scrollTop += (dy / len) * speed * dtSec;
      }
      keyPanRafRef.current = window.requestAnimationFrame(tickKeyPan);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      panShiftHeldRef.current = e.shiftKey;
      const target = e.target as HTMLElement | null;
      const action = resolveViewerKeyAction({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        isComposing: e.isComposing,
        targetTagName: target?.tagName ?? null,
        targetIsContentEditable: target?.isContentEditable ?? false,
      });
      if (!action) return;

      if (action.type === "tool") {
        e.preventDefault();
        switchViewerTool(action.tool);
        return;
      }
      if (action.type === "points") {
        if (!onTogglePointEntry) return;
        e.preventDefault();
        onTogglePointEntry();
        return;
      }
      if (action.type === "move") {
        if (!onBatchMoveMarkers) return;
        e.preventDefault();
        handleToggleBatchMoveTool();
        return;
      }
      if (action.type === "zoom") {
        e.preventDefault();
        pendingCenterRegionRef.current = null;
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const pt = lastPointerPosRef.current;
          const anchorClientX =
            pt && pt.x >= rect.left && pt.x <= rect.right
              ? pt.x
              : rect.left + rect.width / 2;
          const anchorClientY =
            pt && pt.y >= rect.top && pt.y <= rect.bottom
              ? pt.y
              : rect.top + rect.height / 2;
          zoomAnchorRef.current = captureZoomAnchor(
            anchorClientX,
            anchorClientY,
          );
        }
        const factor = action.direction === "in" ? 1.15 : 1 / 1.15;
        targetZoomRef.current = Math.min(
          5,
          Math.max(0.25, targetZoomRef.current * factor),
        );
        startSmoothZoomAnimation();
        return;
      }
      if (action.type === "fit") {
        e.preventDefault();
        onFitToView();
        return;
      }
      if (action.type === "pan") {
        e.preventDefault();
        activePanKeysRef.current.add(action.key);
        if (keyPanRafRef.current === null) {
          keyPanLastTimeRef.current = performance.now();
          keyPanRafRef.current = window.requestAnimationFrame(tickKeyPan);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      panShiftHeldRef.current = e.shiftKey;
      const lower = e.key.toLowerCase();
      if (lower === "w" || lower === "a" || lower === "s" || lower === "d") {
        activePanKeysRef.current.delete(lower);
      }
    };

    const onWindowPointerMove = (e: PointerEvent) => {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointermove", onWindowPointerMove, {
      passive: true,
    });
    window.addEventListener("blur", stopKeyPanLoop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("blur", stopKeyPanLoop);
      stopKeyPanLoop();
    };
  }, [
    isActive,
    switchViewerTool,
    onTogglePointEntry,
    onBatchMoveMarkers,
    handleToggleBatchMoveTool,
    captureZoomAnchor,
    startSmoothZoomAnimation,
    onFitToView,
  ]);

  // Sync external zoom changes (Fit / +/- buttons) smoothly
  useEffect(() => {
    if (Math.abs(zoom - targetZoomRef.current) < 0.005) return;
    targetZoomRef.current = zoom;
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      zoomAnchorRef.current = captureZoomAnchor(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
    }
    startSmoothZoomAnimation();
  }, [zoom, captureZoomAnchor, startSmoothZoomAnimation]);

  // Apply exact page-anchored scroll or pending highlight centering synchronously after displayZoom layout commit
  useLayoutEffect(() => {
    committedDisplayZoomRef.current = displayZoom;
    const container = containerRef.current;
    if (!container) return;

    const pendingCenter = pendingCenterRegionRef.current;
    if (
      pendingCenter &&
      Math.abs(displayZoom - pendingCenter.expectedZoom) < 0.001
    ) {
      pendingCenterRegionRef.current = null;
      pendingAnchorScrollRef.current = null;
      const pageEl = pageElsRef.current.get(pendingCenter.page);
      if (pageEl) {
        const cRect = container.getBoundingClientRect();
        const pRect = pageEl.getBoundingClientRect();
        const target = computeCenterRegionScroll({
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
          scrollWidth: container.scrollWidth,
          scrollHeight: container.scrollHeight,
          viewportLeft: cRect.left,
          viewportTop: cRect.top,
          viewportWidth: cRect.width,
          viewportHeight: cRect.height,
          pageLeft: pRect.left,
          pageTop: pRect.top,
          pageWidth: pRect.width,
          pageHeight: pRect.height,
          markerX: pendingCenter.marker.x,
          markerY: pendingCenter.marker.y,
          markerWidth: pendingCenter.marker.width,
          markerHeight: pendingCenter.marker.height,
        });
        container.scrollLeft = target.left;
        container.scrollTop = target.top;
        return;
      }
    }

    const anchor = pendingAnchorScrollRef.current;
    if (!anchor) return;
    pendingAnchorScrollRef.current = null;

    if (anchor.page !== null) {
      const pageEl = pageElsRef.current.get(anchor.page);
      if (pageEl) {
        const containerRect = container.getBoundingClientRect();
        const pageRect = pageEl.getBoundingClientRect();
        if (pageRect.width > 0 && pageRect.height > 0) {
          const pointClientX = pageRect.left + anchor.normX * pageRect.width;
          const pointClientY = pageRect.top + anchor.normY * pageRect.height;
          const desiredClientX = containerRect.left + anchor.cursorX;
          const desiredClientY = containerRect.top + anchor.cursorY;
          container.scrollLeft += pointClientX - desiredClientX;
          container.scrollTop += pointClientY - desiredClientY;
          return;
        }
      }
    }

    container.scrollLeft = computeAnchoredScroll(
      anchor.prevScrollLeft,
      anchor.cursorX,
      CONTAINER_PADDING_PX,
      anchor.prevZoom,
      displayZoom,
    );
    container.scrollTop = computeAnchoredScroll(
      anchor.prevScrollTop,
      anchor.cursorY,
      CONTAINER_PADDING_PX,
      anchor.prevZoom,
      displayZoom,
    );
  }, [displayZoom]);

  // Debounce crisp HiDPI canvas re-render until smooth zoom settles
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRenderZoom(displayZoom);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [displayZoom]);

  // Clean up animation frames on unmount
  useEffect(() => {
    return () => {
      if (zoomRafRef.current !== null) {
        window.cancelAnimationFrame(zoomRafRef.current);
      }
      if (panRafRef.current !== null) {
        window.cancelAnimationFrame(panRafRef.current);
      }
    };
  }, []);

  const registerPageEl = useCallback(
    (page: number, el: HTMLDivElement | null) => {
      if (el) {
        pageElsRef.current.set(page, el);
      } else {
        pageElsRef.current.delete(page);
      }
    },
    [],
  );

  // Load PDF document and intrinsic sizes for all pages
  useEffect(() => {
    setPdfDoc(null);
    setPageSizes([]);
    setRenderError(null);
    pageElsRef.current.clear();

    if (!pdfBytes) {
      return;
    }

    let cancelled = false;
    const loadingTask = getDocument({ data: pdfBytes.slice() });

    loadingTask.promise
      .then(async (doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        const sizes: PageDimensions[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          if (cancelled) {
            void doc.destroy();
            return;
          }
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ width: vp.width, height: vp.height });
        }
        setRenderError(null);
        setPdfDoc(doc);
        setPageSizes(sizes);
        onPageCountLoaded(
          doc.numPages,
          sizes.map((s) => (s.height > 0 ? s.width / s.height : 1)),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRenderError(
            err instanceof Error ? err.message : "Failed to load PDF document.",
          );
        }
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [pdfBytes, onPageCountLoaded]);

  // Destroy previous PDFDocumentProxy cleanly outside state updaters
  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  const firstPageSize = pageSizes[0] ?? null;

  // Fit-to-viewport: runs once per fitRequestKey increment after page sizes are ready,
  // keeping the active page centered instead of letting scrollTop clamp to the last page.
  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !shouldApplyFit(fitRequestKey, appliedFitKeyRef.current, firstPageSize)
    ) {
      return;
    }
    const targetPage = Math.max(
      1,
      Math.min(pageSizes.length || 1, currentPageRef.current),
    );
    const targetPageSize = pageSizes[targetPage - 1] ?? firstPageSize!;
    const rect = container.getBoundingClientRect();
    const clamped = computeFitZoom(
      rect.width,
      rect.height,
      targetPageSize.width,
      targetPageSize.height,
    );
    appliedFitKeyRef.current = fitRequestKey;

    if (zoomRafRef.current !== null) {
      window.cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = null;
    }
    if (panRafRef.current !== null) {
      window.cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    pendingAnchorScrollRef.current = null;
    zoomAnchorRef.current = null;

    if (Math.abs(clamped - committedDisplayZoomRef.current) > 0.001) {
      pendingCenterRegionRef.current = {
        page: targetPage,
        marker: { x: 0, y: 0, width: 1, height: 1 },
        expectedZoom: clamped,
      };
      targetZoomRef.current = clamped;
      displayZoomRef.current = clamped;
      setDisplayZoom(clamped);
      setRenderZoom(clamped);
      onZoomChange(clamped);
      return;
    }

    pendingCenterRegionRef.current = null;
    const pageEl = pageElsRef.current.get(targetPage);
    if (pageEl) {
      const pRect = pageEl.getBoundingClientRect();
      const target = computeCenterRegionScroll({
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
        scrollWidth: container.scrollWidth,
        scrollHeight: container.scrollHeight,
        viewportLeft: rect.left,
        viewportTop: rect.top,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        pageLeft: pRect.left,
        pageTop: pRect.top,
        pageWidth: pRect.width,
        pageHeight: pRect.height,
        markerX: 0,
        markerY: 0,
        markerWidth: 1,
        markerHeight: 1,
      });
      container.scrollTo({ left: target.left, top: target.top, behavior: "smooth" });
    }
  }, [fitRequestKey, firstPageSize, pageSizes, onZoomChange]);

  const scrollToPage = useCallback((targetPage: number) => {
    const el = pageElsRef.current.get(targetPage);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Respond to external scroll requests (e.g. clicking a dimension in the sidebar -> auto-zoom if needed & center union region)
  useEffect(() => {
    if (!scrollToPageRequest) return;
    const container = containerRef.current;
    const pageEl = pageElsRef.current.get(scrollToPageRequest.page);
    if (scrollToPageRequest.marker && container && pageEl) {
      const m = scrollToPageRequest.marker;
      const containerRect = container.getBoundingClientRect();
      const baseSize = pageSizes[scrollToPageRequest.page - 1];
      const markerW = m.width || 0.04;
      const markerH = m.height || 0.025;

      const centerRegionNow = (behavior: ScrollBehavior) => {
        const curContainer = containerRef.current;
        const curPageEl = pageElsRef.current.get(scrollToPageRequest.page);
        if (!curContainer || !curPageEl) return;
        const cRect = curContainer.getBoundingClientRect();
        const pRect = curPageEl.getBoundingClientRect();
        const target = computeCenterRegionScroll({
          scrollLeft: curContainer.scrollLeft,
          scrollTop: curContainer.scrollTop,
          scrollWidth: curContainer.scrollWidth,
          scrollHeight: curContainer.scrollHeight,
          viewportLeft: cRect.left,
          viewportTop: cRect.top,
          viewportWidth: cRect.width,
          viewportHeight: cRect.height,
          pageLeft: pRect.left,
          pageTop: pRect.top,
          pageWidth: pRect.width,
          pageHeight: pRect.height,
          markerX: m.x,
          markerY: m.y,
          markerWidth: markerW,
          markerHeight: markerH,
        });
        curContainer.scrollTo({
          left: target.left,
          top: target.top,
          behavior,
        });
      };

      if (baseSize) {
        const currentCommittedZoom = committedDisplayZoomRef.current;
        const nextZoom = computeHighlightAutoZoom({
          currentZoom: currentCommittedZoom,
          viewportWidth: containerRect.width,
          viewportHeight: containerRect.height,
          basePageWidth: baseSize.width,
          basePageHeight: baseSize.height,
          regionWidth: markerW,
          regionHeight: markerH,
        });
        if (Math.abs(nextZoom - currentCommittedZoom) > 0.01) {
          if (zoomRafRef.current !== null) {
            window.cancelAnimationFrame(zoomRafRef.current);
            zoomRafRef.current = null;
          }
          if (panRafRef.current !== null) {
            window.cancelAnimationFrame(panRafRef.current);
            panRafRef.current = null;
          }
          pendingAnchorScrollRef.current = null;
          zoomAnchorRef.current = null;
          // Center synchronously inside useLayoutEffect([displayZoom]) once React commits the new page heights
          pendingCenterRegionRef.current = {
            page: scrollToPageRequest.page,
            marker: {
              x: m.x,
              y: m.y,
              width: markerW,
              height: markerH,
            },
            expectedZoom: nextZoom,
          };
          targetZoomRef.current = nextZoom;
          displayZoomRef.current = nextZoom;
          setDisplayZoom(nextZoom);
          setRenderZoom(nextZoom);
          onZoomChange(nextZoom);
          return;
        }
      }

      if (zoomRafRef.current !== null) {
        window.cancelAnimationFrame(zoomRafRef.current);
        zoomRafRef.current = null;
      }
      if (panRafRef.current !== null) {
        window.cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      pendingCenterRegionRef.current = null;
      centerRegionNow("smooth");
      return;
    }
    scrollToPage(scrollToPageRequest.page);
  }, [scrollToPageRequest, scrollToPage, pageSizes, onZoomChange]);

  // Track most visible page while scrolling continuously
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageSizes.length === 0) return;

    let rafId: number | null = null;
    let settleTimer: number | null = null;
    const updateActivePage = () => {
      rafId = null;
      const containerRect = container.getBoundingClientRect();
      const bounds: Array<{ page: number; top: number; height: number }> = [];
      pageElsRef.current.forEach((el, page) => {
        const rect = el.getBoundingClientRect();
        bounds.push({
          page,
          top: rect.top - containerRect.top,
          height: rect.height,
        });
      });
      bounds.sort((a, b) => a.page - b.page);
      const visible = findMostVisiblePage(0, containerRect.height, bounds);
      if (visible !== currentPageRef.current) {
        onPageChange(visible);
      }
    };

    const scheduleDetailRefresh = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        setViewportEpoch((e) => e + 1);
      }, 240);
    };

    const onScroll = () => {
      if (isActiveRef.current && container.clientHeight > 0) {
        savedScrollRef.current = {
          left: container.scrollLeft,
          top: container.scrollTop,
        };
      }
      if (rafId === null) {
        rafId = window.requestAnimationFrame(updateActivePage);
      }
      scheduleDetailRefresh();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", scheduleDetailRefresh);
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", scheduleDetailRefresh);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [pageSizes.length, onPageChange]);

  // Non-passive native wheel listener:
  // - Cmd/Ctrl + wheel (or macOS trackpad pinch) zooms smoothly around cursor
  // - Plain 2-finger trackpad / wheel pans freely in 2D (no macOS axis-locking)
  const wheelPanRemainderRef = useRef({ x: 0, y: 0, lastTime: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isMacPlatform =
      typeof navigator !== "undefined" &&
      /mac/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`);
    const handleWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-floating-menu='true']")) {
        return;
      }
      e.preventDefault();

      if (e.metaKey || e.ctrlKey) {
        pendingCenterRegionRef.current = null;
        zoomAnchorRef.current = captureZoomAnchor(e.clientX, e.clientY);
        const inputMode = detectWheelZoomInputMode(e, isMacPlatform);
        targetZoomRef.current = computeWheelTargetZoom(
          targetZoomRef.current,
          e.deltaY,
          0.25,
          5,
          inputMode,
        );
        startSmoothZoomAnimation();
        return;
      }

      // Free 2D omnidirectional trackpad / wheel panning (bypasses WebKit scroll axis-locking)
      const { dx, dy } = computeWheelPanDelta(e, {
        width: el.clientWidth,
        height: el.clientHeight,
      });
      if (dx === 0 && dy === 0) return;

      const now = performance.now();
      const rem = wheelPanRemainderRef.current;
      if (now - rem.lastTime > 120) {
        rem.x = 0;
        rem.y = 0;
      }
      rem.lastTime = now;

      const totalDx = dx + rem.x;
      const totalDy = dy + rem.y;
      const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const prevLeft = el.scrollLeft;
      const prevTop = el.scrollTop;
      const targetLeft = Math.max(0, Math.min(maxScrollLeft, prevLeft + totalDx));
      const targetTop = Math.max(0, Math.min(maxScrollTop, prevTop + totalDy));

      el.scrollLeft = targetLeft;
      el.scrollTop = targetTop;

      const appliedDx = el.scrollLeft - prevLeft;
      const appliedDy = el.scrollTop - prevTop;
      rem.x = targetLeft <= 0 || targetLeft >= maxScrollLeft ? 0 : totalDx - appliedDx;
      rem.y = targetTop <= 0 || targetTop >= maxScrollTop ? 0 : totalDy - appliedDy;
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [captureZoomAnchor, startSmoothZoomAnimation]);

  // Smooth click-and-drag panning on the PDF viewport
  const runSmoothPan = useCallback(() => {
    panRafRef.current = null;
    const pan = panRef.current;
    const el = containerRef.current;
    if (!pan || !el) return;

    const dx = pan.targetScrollLeft - el.scrollLeft;
    const dy = pan.targetScrollTop - el.scrollTop;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      el.scrollLeft = pan.targetScrollLeft;
      el.scrollTop = pan.targetScrollTop;
      return;
    }

    el.scrollLeft += dx * 0.45;
    el.scrollTop += dy * 0.45;
    panRafRef.current = window.requestAnimationFrame(runSmoothPan);
  }, []);

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      e.button !== 0 ||
      placingDimensionId ||
      pointCapturePage !== null ||
      pointEntrySession !== null ||
      !containerRef.current
    ) {
      return;
    }
    emptyClickRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
    if (viewerTool !== "hand") {
      return;
    }
    const el = containerRef.current;
    el.setPointerCapture(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
      targetScrollLeft: el.scrollLeft,
      targetScrollTop: el.scrollTop,
    };
    setIsPanning(true);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - pan.startClientX;
    const dy = e.clientY - pan.startClientY;
    pan.targetScrollLeft = Math.max(0, pan.startScrollLeft - dx);
    pan.targetScrollTop = Math.max(0, pan.startScrollTop - dy);
    if (panRafRef.current === null) {
      panRafRef.current = window.requestAnimationFrame(runSmoothPan);
    }
  };

  const stopPanning = (e: React.PointerEvent<HTMLDivElement>) => {
    const clickStart = emptyClickRef.current;
    if (clickStart && clickStart.pointerId === e.pointerId) {
      emptyClickRef.current = null;
      const moved = Math.hypot(
        e.clientX - clickStart.startX,
        e.clientY - clickStart.startY,
      );
      const hasTextSelection =
        viewerTool === "text" &&
        Boolean(window.getSelection()?.toString().trim());
      if (moved < 4 && !placingDimensionId && !hasTextSelection) {
        onClearSelection?.();
      }
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
    setIsPanning(false);
  };

  const placingDimension = placingDimensionId
    ? dimensions.find((d) => d.id === placingDimensionId) ?? null
    : null;
  const placingLockedPage =
    placingDimension && getAnnotationKind(placingDimension) !== "datum"
      ? getAnnotationPage(placingDimension)
      : null;

  const stepZoom = (delta: number) => {
    const next = Math.min(
      5,
      Math.max(0.25, Math.round((targetZoomRef.current + delta) * 100) / 100),
    );
    const el = containerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      zoomAnchorRef.current = captureZoomAnchor(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
    }
    targetZoomRef.current = next;
    startSmoothZoomAnimation();
  };

  const handleJumpPage = (targetPage: number) => {
    const clamped = Math.min(pageCount, Math.max(1, targetPage));
    onPageChange(clamped);
    scrollToPage(clamped);
  };

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-neutral-900">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950/90 px-3 text-xs text-neutral-300">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            if (displayMenuPos) {
              setDisplayMenuPos(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setDisplayMenuPos({ x: rect.left, y: rect.bottom + 6 });
          }}
          aria-label="PDF display settings"
          aria-expanded={Boolean(displayMenuPos)}
          title="Display Settings — Theme, line weight, high contrast"
          className={`relative inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
            displayMenuPos || hasCustomPdfDisplaySettings(displaySettings)
              ? "border-neutral-600 bg-neutral-800 text-neutral-100"
              : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800 hover:text-white"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Display</span>
          {hasCustomPdfDisplaySettings(displaySettings) && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          )}
        </button>

        {displayMenuPos && (
          <FloatingMenu
            x={displayMenuPos.x}
            y={displayMenuPos.y}
            role="dialog"
            aria-label="PDF Display Settings"
            onPointerDown={(e) => e.stopPropagation()}
            className="w-64 rounded-md border border-neutral-700 bg-neutral-950/95 p-3 text-xs text-neutral-200 shadow-2xl backdrop-blur-md"
          >
            <div className="mb-2.5 flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
                Display Settings
              </span>
              {hasCustomPdfDisplaySettings(displaySettings) && (
                <button
                  type="button"
                  onClick={() => setDisplaySettings(DEFAULT_PDF_DISPLAY_SETTINGS)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {/* 1. Light / Dark Theme */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-neutral-400">
                  Background Theme
                </span>
                <div className="grid grid-cols-2 gap-1 rounded bg-neutral-900 p-0.5 ring-1 ring-neutral-800">
                  <button
                    type="button"
                    onClick={() =>
                      setDisplaySettings((prev) => ({
                        ...prev,
                        theme: "light",
                      }))
                    }
                    className={`inline-flex items-center justify-center gap-1.5 rounded py-1 text-[11px] font-medium transition-colors ${
                      displaySettings.theme === "light"
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    Light
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDisplaySettings((prev) => ({
                        ...prev,
                        theme: "dark",
                      }))
                    }
                    className={`inline-flex items-center justify-center gap-1.5 rounded py-1 text-[11px] font-medium transition-colors ${
                      displaySettings.theme === "dark"
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    Dark
                  </button>
                </div>
              </div>

              {/* 2. Line Weight */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-neutral-400">
                    Line Weight
                  </span>
                  {displaySettings.lineWeightMode === "custom" && (
                    <span className="font-mono text-[10px] text-neutral-300">
                      {displaySettings.customLineWidth.toFixed(2)}px
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1 rounded bg-neutral-900 p-0.5 ring-1 ring-neutral-800">
                  {(
                    [
                      { value: "original", label: "Original" },
                      { value: "thin", label: "Hairline" },
                      { value: "custom", label: "Custom" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setDisplaySettings((prev) => ({
                          ...prev,
                          lineWeightMode: opt.value,
                        }))
                      }
                      className={`rounded py-1 text-[11px] font-medium transition-colors ${
                        displaySettings.lineWeightMode === opt.value
                          ? "bg-neutral-700 text-white"
                          : "text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {displaySettings.lineWeightMode === "custom" && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="font-mono text-[10px] text-neutral-500">
                      {MIN_CUSTOM_LINE_WIDTH}
                    </span>
                    <input
                      type="range"
                      min={MIN_CUSTOM_LINE_WIDTH}
                      max={MAX_CUSTOM_LINE_WIDTH}
                      step={0.25}
                      value={displaySettings.customLineWidth}
                      onChange={(e) => {
                        const val = Number.parseFloat(e.target.value);
                        if (Number.isFinite(val)) {
                          setDisplaySettings((prev) => ({
                            ...prev,
                            customLineWidth: val,
                          }));
                        }
                      }}
                      className="h-1.5 flex-1 cursor-pointer accent-neutral-200"
                    />
                    <span className="font-mono text-[10px] text-neutral-500">
                      {MAX_CUSTOM_LINE_WIDTH}
                    </span>
                  </div>
                )}
              </div>

              {/* 3. High Contrast Monochrome */}
              <div className="flex items-center justify-between border-t border-neutral-800 pt-2.5">
                <div className="flex items-center gap-2">
                  <Contrast className="h-3.5 w-3.5 text-neutral-400" />
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-neutral-200">
                      High Contrast
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      Monochrome lines &amp; images
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={displaySettings.highContrast}
                  onClick={() =>
                    setDisplaySettings((prev) => ({
                      ...prev,
                      highContrast: !prev.highContrast,
                    }))
                  }
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    displaySettings.highContrast
                      ? "bg-blue-500"
                      : "bg-neutral-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      displaySettings.highContrast
                        ? "translate-x-4"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </FloatingMenu>
        )}

        <div
          role="group"
          aria-label="Viewer tools"
          className="flex items-center gap-0.5 rounded bg-neutral-900 p-0.5 ring-1 ring-neutral-800"
        >
          <button
            type="button"
            onClick={() => switchViewerTool("hand")}
            aria-label="Pan tool (C)"
            aria-pressed={
              viewerTool === "hand" && !pointEntrySession && !batchMoveSession
            }
            title="Pan — Drag or use WASD to pan, Q/E to zoom (C)"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
              viewerTool === "hand" && !pointEntrySession && !batchMoveSession
                ? "bg-neutral-700/90 text-white"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
          >
            <Hand className="h-3.5 w-3.5" />
            <span className="font-medium">Pan</span>
            <span className="font-mono text-[10px] opacity-65">C</span>
          </button>
          <button
            type="button"
            onClick={() => switchViewerTool("text")}
            aria-label="Text selection tool (V)"
            aria-pressed={
              viewerTool === "text" && !pointEntrySession && !batchMoveSession
            }
            title="Text Selection — Select & copy PDF text (V)"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
              viewerTool === "text" && !pointEntrySession && !batchMoveSession
                ? "bg-neutral-700/90 text-white"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
          >
            <TextCursor className="h-3.5 w-3.5" />
            <span className="font-medium">Text</span>
            <span className="font-mono text-[10px] opacity-65">V</span>
          </button>
          {onTogglePointEntry && (
            <button
              type="button"
              onClick={onTogglePointEntry}
              aria-label="Point entry tool (P)"
              aria-pressed={Boolean(pointEntrySession)}
              title="Points — Calibrate X=0 / Y=0 / Anchor and rapid-click Points (P)"
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                pointEntrySession
                  ? "bg-purple-600/30 text-purple-200 ring-1 ring-purple-400/60"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              <span className="font-medium">Points</span>
              <span className="font-mono text-[10px] opacity-65">P</span>
            </button>
          )}
          {onBatchMoveMarkers && (
            <button
              type="button"
              onClick={handleToggleBatchMoveTool}
              aria-label="Batch move markers tool (M)"
              aria-pressed={Boolean(batchMoveSession)}
              title="Move — Click or drag-select markers, press Space to confirm, then drag to move together (M)"
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                batchMoveSession
                  ? "bg-blue-600/30 text-blue-200 ring-1 ring-blue-400/60"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
            >
              <Move className="h-3.5 w-3.5" />
              <span className="font-medium">Move</span>
              <span className="font-mono text-[10px] opacity-65">M</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded bg-neutral-900 px-1 py-0.5 ring-1 ring-neutral-800">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => handleJumpPage(currentPage - 1)}
              aria-label="Previous page"
              className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[72px] text-center font-mono text-[11px] text-neutral-300">
              Page {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= pageCount}
              onClick={() => handleJumpPage(currentPage + 1)}
              aria-label="Next page"
              className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded bg-neutral-900 px-1 py-0.5 ring-1 ring-neutral-800">
            <button
              type="button"
              disabled={displayZoom <= 0.25}
              onClick={() => stepZoom(-0.25)}
              aria-label="Zoom out (Q)"
              title="Zoom out (Q)"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ZoomOut className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] opacity-65">Q</span>
            </button>
            <span className="min-w-[44px] text-center font-mono text-[11px] text-neutral-300">
              {Math.round(displayZoom * 100)}%
            </span>
            <button
              type="button"
              disabled={displayZoom >= 5}
              onClick={() => stepZoom(0.25)}
              aria-label="Zoom in (E)"
              title="Zoom in (E)"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] opacity-65">E</span>
            </button>
            <button
              type="button"
              onClick={onFitToView}
              aria-label="Fit drawing to viewport (R)"
              title="Fit drawing to viewport (R)"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-neutral-800"
            >
              <Maximize2 className="h-3 w-3" />
              <span>Fit</span>
              <span className="font-mono text-[10px] opacity-65">R</span>
            </button>
          </div>
        </div>
      </div>

      {pointEntrySession && (() => {
        const cal = pointEntrySession.calibration;
        const pagePointNames = dimensions
          .filter(
            (d) =>
              getAnnotationKind(d) === "point" &&
              getAnnotationPage(d) === pointEntrySession.page,
          )
          .map((d) => d.name);
        const isDuplicateNextId = hasPointIdCollisionOnPage(
          pointEntrySession.nextId,
          pagePointNames,
        );
        const sessionPageSize = pageSizes[pointEntrySession.page - 1];
        const sessionPageAspect =
          sessionPageSize && sessionPageSize.height > 0
            ? sessionPageSize.width / sessionPageSize.height
            : undefined;
        const hoverCoords = pointEntryHoverPos
          ? computeCalibratedPointCoords(
              pointEntryHoverPos.x,
              pointEntryHoverPos.y,
              cal,
              sessionPageAspect,
            )
          : null;
        const pickHint: Record<PointEntryPickMode, string> = {
          x_zero: "Click on the drawing to mark vertical X = 0 line",
          y_zero: "Click on the drawing to mark horizontal Y = 0 line",
          anchor:
            "Click a reference point (farther from origin = higher accuracy), then enter its X & Y",
          place: `Click on Page ${pointEntrySession.page} to create points sequentially (auto-increments ID)`,
        };
        const handleAnchorFormula = (
          e: React.KeyboardEvent<HTMLInputElement>,
          field: "anchorValX" | "anchorValY",
          value: string,
        ) => {
          if (
            e.nativeEvent.isComposing ||
            e.key !== "Enter" ||
            e.metaKey ||
            e.ctrlKey ||
            e.altKey
          ) {
            return;
          }
          const res = evaluateFormulaInput(value);
          if (res !== null) {
            e.preventDefault();
            onUpdatePointEntryCalibration?.({ [field]: res });
          }
        };
        return (
          <div className="pointer-events-auto absolute left-1/2 top-12 z-30 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-lg border border-neutral-700/90 bg-neutral-950/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-purple-300 ring-1 ring-purple-500/40">
                POINTS · P{pointEntrySession.page}
              </span>

              <button
                type="button"
                onClick={() => {
                  if (cal.xZero !== null) {
                    onUpdatePointEntryCalibration?.({ xZero: null });
                  }
                  onUpdatePointEntry?.({ pickMode: "x_zero" });
                }}
                title={
                  cal.xZero !== null
                    ? "Click to clear X = 0 reference line and re-pick"
                    : "Mark vertical X = 0 reference line on the drawing"
                }
                className={`group inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors ${
                  pointEntrySession.pickMode === "x_zero"
                    ? "bg-sky-600 text-white"
                    : cal.xZero !== null
                      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40 hover:bg-rose-500/20 hover:text-rose-200 hover:ring-rose-500/40"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
                }`}
              >
                <span>X=0</span>
                {cal.xZero !== null && (
                  <>
                    <Check className="h-3 w-3 group-hover:hidden" />
                    <X className="hidden h-3 w-3 group-hover:block" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (cal.yZero !== null) {
                    onUpdatePointEntryCalibration?.({ yZero: null });
                  }
                  onUpdatePointEntry?.({ pickMode: "y_zero" });
                }}
                title={
                  cal.yZero !== null
                    ? "Click to clear Y = 0 reference line and re-pick"
                    : "Mark horizontal Y = 0 reference line on the drawing"
                }
                className={`group inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors ${
                  pointEntrySession.pickMode === "y_zero"
                    ? "bg-emerald-600 text-white"
                    : cal.yZero !== null
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-rose-500/20 hover:text-rose-200 hover:ring-rose-500/40"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
                }`}
              >
                <span>Y=0</span>
                {cal.yZero !== null && (
                  <>
                    <Check className="h-3 w-3 group-hover:hidden" />
                    <X className="hidden h-3 w-3 group-hover:block" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (cal.anchorX !== null || cal.anchorY !== null) {
                    onUpdatePointEntryCalibration?.({
                      anchorX: null,
                      anchorY: null,
                    });
                  }
                  onUpdatePointEntry?.({ pickMode: "anchor" });
                }}
                title={
                  cal.anchorX !== null
                    ? "Click to clear anchor point and re-pick"
                    : "Mark a reference anchor point (choose a point far from X=0 and Y=0 for higher accuracy)"
                }
                className={`group inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors ${
                  pointEntrySession.pickMode === "anchor"
                    ? "bg-amber-600 text-white"
                    : cal.anchorX !== null
                      ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40 hover:bg-rose-500/20 hover:text-rose-200 hover:ring-rose-500/40"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
                }`}
              >
                <Crosshair className="h-3 w-3" />
                <span>Anchor</span>
                {cal.anchorX !== null && (
                  <>
                    <Check className="h-3 w-3 group-hover:hidden" />
                    <X className="hidden h-3 w-3 group-hover:block" />
                  </>
                )}
              </button>

              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-neutral-500">X</span>
                <input
                  type="text"
                  value={cal.anchorValX}
                  placeholder="Ref X"
                  title="Anchor real-world X relative to X=0 (supports =formula + Enter)"
                  onKeyDown={(e) =>
                    handleAnchorFormula(e, "anchorValX", cal.anchorValX)
                  }
                  onChange={(e) =>
                    onUpdatePointEntryCalibration?.({
                      anchorValX: e.target.value,
                    })
                  }
                  className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400 focus:outline-none"
                />
                <span className="font-mono text-[10px] text-neutral-500">Y</span>
                <input
                  type="text"
                  value={cal.anchorValY}
                  placeholder="Ref Y"
                  title="Anchor real-world Y relative to Y=0 (supports =formula + Enter)"
                  onKeyDown={(e) =>
                    handleAnchorFormula(e, "anchorValY", cal.anchorValY)
                  }
                  onChange={(e) =>
                    onUpdatePointEntryCalibration?.({
                      anchorValY: e.target.value,
                    })
                  }
                  className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400 focus:outline-none"
                />
              </div>

              {(onCopyPointEntryCalibration || onPastePointEntryCalibration) && (
                <div className="flex items-center gap-1">
                  {onCopyPointEntryCalibration && (
                    <button
                      type="button"
                      disabled={
                        cal.xZero === null &&
                        cal.yZero === null &&
                        cal.anchorX === null
                      }
                      onClick={onCopyPointEntryCalibration}
                      aria-label="Copy coordinate definition"
                      title="Copy coordinate definition (X=0, Y=0, Anchor)"
                      className="inline-flex items-center justify-center rounded border border-neutral-800 bg-neutral-900 p-1 text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onPastePointEntryCalibration && (
                    <button
                      type="button"
                      disabled={!hasCopiedPointEntryCalibration}
                      onClick={onPastePointEntryCalibration}
                      aria-label="Paste coordinate definition"
                      title={
                        hasCopiedPointEntryCalibration
                          ? "Paste copied coordinate definition"
                          : "Copy a coordinate definition first"
                      }
                      className="inline-flex items-center justify-center rounded border border-neutral-800 bg-neutral-900 p-1 text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onRecalculatePointGroupCoords && (() => {
                    const hasAnyAxisReady =
                      (cal.xZero !== null &&
                        cal.anchorX !== null &&
                        cal.anchorValX.trim() !== "") ||
                      (cal.yZero !== null &&
                        cal.anchorY !== null &&
                        cal.anchorValY.trim() !== "");
                    const canRecalc =
                      pointEntrySession.groupId !== null && hasAnyAxisReady;
                    return (
                      <button
                        type="button"
                        disabled={!canRecalc}
                        onClick={onRecalculatePointGroupCoords}
                        aria-label="Regenerate group point coordinates"
                        title={
                          canRecalc
                            ? "Regenerate X/Y coordinates for all points in this group from current calibration"
                            : pointEntrySession.groupId === null
                              ? "Place or resume a point group first"
                              : "Complete X=0 / Y=0 and Anchor calibration first"
                        }
                        className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Recalc</span>
                      </button>
                    );
                  })()}
                </div>
              )}

              <div className="mx-0.5 h-4 w-px bg-neutral-800" />

              <button
                type="button"
                onClick={() => onUpdatePointEntry?.({ pickMode: "place" })}
                title="Click on the drawing to rapidly place points"
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  pointEntrySession.pickMode === "place"
                    ? "bg-purple-600 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
                }`}
              >
                <LocateFixed className="h-3 w-3" />
                <span>Place</span>
              </button>

              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-neutral-500">
                  ID
                </span>
                <input
                  type="text"
                  value={pointEntrySession.nextId}
                  placeholder="F1"
                  title={
                    isDuplicateNextId
                      ? `Point ID "${pointEntrySession.nextId.trim()}" already exists on Page ${pointEntrySession.page}`
                      : "Next Point ID (auto-increments after each click)"
                  }
                  onChange={(e) =>
                    onUpdatePointEntry?.({ nextId: e.target.value })
                  }
                  className={`w-16 rounded border bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] placeholder:text-neutral-600 focus:outline-none ${
                    isDuplicateNextId
                      ? "border-rose-500 text-rose-200 focus:border-rose-400"
                      : "border-neutral-700 text-purple-100 focus:border-purple-400"
                  }`}
                />
              </div>

              {pointEntrySession.placedCount > 0 ||
              pointEntrySession.groupId !== null ? (
                <button
                  type="button"
                  onClick={onClosePointEntry}
                  title="Finish Point Entry tool (Esc)"
                  className="ml-1 inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-950 transition-colors hover:bg-white"
                >
                  <Check className="h-3 w-3" />
                  <span>Done</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClosePointEntry}
                  title="Cancel and exit Point Entry tool (Esc)"
                  className="ml-1 inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                >
                  <X className="h-3 w-3" />
                  <span>Cancel</span>
                </button>
              )}
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-neutral-800/80 pt-1 text-[10px]">
              <span className="text-neutral-400">
                {pickHint[pointEntrySession.pickMode]}
              </span>
              <div className="flex shrink-0 items-center gap-2 font-mono">
                {hoverCoords && (hoverCoords.x || hoverCoords.y) && (
                  <span className="text-purple-300">
                    X:{hoverCoords.x || "—"} Y:{hoverCoords.y || "—"}
                  </span>
                )}
                {pointEntrySession.placedCount > 0 && (
                  <span className="rounded bg-purple-500/15 px-1.5 py-[1px] text-purple-200">
                    +{pointEntrySession.placedCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {pointCapturePage !== null && pointCaptureStep !== null && (() => {
        const capturedFields = new Set(pointCaptureRegions.map((r) => r.field));
        const stepLabels: Record<PointCaptureField, string> = {
          id: "ID",
          x: "X",
          y: "Y",
          z: "Z",
        };
        const stepPrompts: Record<PointCaptureField, string> = {
          id: "Select Point ID",
          x: "Select X coordinate",
          y: "Select Y coordinate",
          z: "Select Z coordinate",
        };
        const isLastStep = pointCaptureStep === "z";
        return (
          <div className="z-30 flex items-center justify-between gap-2 border-b border-purple-500/40 bg-purple-600/20 px-4 py-2 text-xs font-medium text-purple-100">
            <div className="flex min-w-0 items-center gap-2.5">
              <ScanText className="h-4 w-4 shrink-0 text-purple-300" />
              <div className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                {POINT_CAPTURE_STEPS.map((step, i) => {
                  const active = step === pointCaptureStep;
                  const done = capturedFields.has(step);
                  return (
                    <span key={step} className="inline-flex items-center gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 font-semibold transition-colors ${
                          active
                            ? "bg-purple-500 text-white ring-1 ring-purple-300"
                            : done
                              ? "bg-purple-500/30 text-purple-100 ring-1 ring-purple-400/50"
                              : "bg-neutral-900/70 text-purple-300/60"
                        }`}
                      >
                        {stepLabels[step]}
                        {done ? "✓" : ""}
                      </span>
                      {i < POINT_CAPTURE_STEPS.length - 1 && (
                        <span className="text-purple-400/60">→</span>
                      )}
                    </span>
                  );
                })}
              </div>
              <span className="truncate text-purple-100/90">
                {stepPrompts[pointCaptureStep]} (P{pointCapturePage}) — Space:{" "}
                {isLastStep ? "finish" : "next/skip"} · Enter: apply · Esc:
                cancel
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={
                  isLastStep ? onApplyPointCapture : onAdvancePointCaptureStep
                }
                className="inline-flex items-center gap-1 rounded bg-purple-600 px-2.5 py-0.5 text-white transition-colors hover:bg-purple-500"
              >
                <Check className="h-3.5 w-3.5" />
                {isLastStep ? "Apply (Space)" : "Next (Space)"}
              </button>
              <button
                type="button"
                onClick={onCancelPointCapture}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-purple-200 hover:bg-purple-500/30 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {batchMoveSession && (
        <div className="pointer-events-auto absolute left-1/2 top-12 z-30 flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2.5 rounded-lg border border-neutral-700/90 bg-neutral-950/95 px-3 py-1.5 text-xs shadow-2xl backdrop-blur-md">
          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-300 ring-1 ring-blue-500/40">
            {batchMoveSession.phase === "select"
              ? "MOVE · SELECT"
              : "MOVE · DRAG"}
          </span>
          <span className="font-mono text-[11px] text-neutral-200">
            {batchMoveSession.selectedIds.length} selected
          </span>
          <span className="text-[11px] text-neutral-400">
            {batchMoveSession.phase === "select"
              ? "Click or drag box to select · Click again to deselect · Esc clear · Space confirm"
              : "Drag on page to move group · Esc re-select · Enter done"}
          </span>
          <div className="flex items-center gap-1.5">
            {batchMoveSession.phase === "select" ? (
              <button
                type="button"
                disabled={batchMoveSession.selectedIds.length === 0}
                onClick={() =>
                  setBatchMoveSession((prev) =>
                    prev && prev.selectedIds.length > 0
                      ? { ...prev, phase: "move" }
                      : prev,
                  )
                }
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-3 w-3" />
                Confirm (Space)
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setBatchMoveSession((prev) =>
                    prev ? { ...prev, phase: "select" } : null,
                  )
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
              >
                Re-select
              </button>
            )}
            <button
              type="button"
              onClick={() => setBatchMoveSession(null)}
              className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-950 transition-colors hover:bg-white"
            >
              <Check className="h-3 w-3" />
              Done
            </button>
          </div>
        </div>
      )}

      {placingDimension && (
        <div className="z-30 flex items-center justify-between border-b border-blue-500/40 bg-blue-600/20 px-4 py-2 text-xs font-medium text-blue-100">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-blue-400" />
            <span>
              Drag on{" "}
              {placingLockedPage !== null
                ? `Page ${placingLockedPage}`
                : "the drawing"}{" "}
              to box{" "}
              {placingDimension.name.trim()
                ? `ID "${placingDimension.name.trim()}"`
                : "new dimension"}{" "}
              — Press Esc to cancel
            </span>
          </div>
          <button
            type="button"
            onClick={onCancelPlacing}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-blue-200 hover:bg-blue-500/30 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      )}

      {renderError && (
        <div className="border-b border-rose-500/40 bg-rose-950/80 px-4 py-2 text-xs text-rose-200">
          {renderError}
        </div>
      )}

      <div
        ref={containerRef}
        style={{ overflowAnchor: "none" }}
        onMouseDown={(e) => {
          if (viewerTool === "hand" || placingDimensionId) {
            e.preventDefault();
          }
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={(e) => {
          lastPointerPosRef.current = {
            x: e.clientX,
            y: e.clientY,
          };
          handleViewportPointerMove(e);
        }}
        onPointerLeave={() => {
          lastPointerPosRef.current = null;
        }}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        className={`flex-1 overflow-auto overscroll-none p-6 ${
          placingDimensionId ||
          pointCapturePage !== null ||
          pointEntrySession !== null
            ? "cursor-crosshair select-none"
            : viewerTool === "hand"
              ? isPanning
                ? "cursor-grabbing select-none"
                : "cursor-grab select-none"
              : "cursor-default"
        }`}
      >
        <div className="mx-auto flex w-fit flex-col items-center gap-6">
          {pdfDoc &&
            pageSizes.map((size, idx) => (
              <PdfPageItem
                key={idx + 1}
                pdfDoc={pdfDoc}
                pageNumber={idx + 1}
                baseSize={size}
                displayZoom={displayZoom}
                renderZoom={renderZoom}
                viewportEpoch={viewportEpoch}
                viewerTool={viewerTool}
                drawingId={drawingId}
                dimensions={dimensions}
                selectedDimensionId={selectedDimensionId}
                selectedDimensionIds={selectedDimensionIds}
                editingDimensionId={editingDimensionId}
                placingDimensionId={
                  placingLockedPage === null || idx + 1 === placingLockedPage
                    ? placingDimensionId
                    : null
                }
                captureMode={pointCapturePage === idx + 1}
                captureRegions={
                  pointCapturePage === idx + 1 && pointCaptureRegions.length > 0
                    ? pointCaptureRegions.filter((r) => r.page === idx + 1)
                    : EMPTY_CAPTURE_REGIONS
                }
                pointEntryActive={pointEntrySession?.page === idx + 1}
                pointEntryCalibration={
                  pointEntrySession?.page === idx + 1
                    ? pointEntrySession.calibration
                    : null
                }
                batchMovePhase={batchMoveSession?.phase ?? null}
                batchMoveSelectedIds={batchMoveSession?.selectedIds ?? []}
                displaySettings={displaySettings}
                onToggleBatchMoveIds={handleToggleBatchMoveIds}
                onBatchMoveMarkers={onBatchMoveMarkers}
                scrollContainer={containerRef.current}
                registerPageEl={registerPageEl}
                onPlaceMarker={onPlaceMarker}
                onAddCaptureRegion={onAddPointCaptureRegion}
                onPointEntryClick={onPointEntryClick}
                onPointEntryHover={setPointEntryHoverPos}
                onSelectDimension={onSelectDimension}
                onMoveMarker={onMoveMarker}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
