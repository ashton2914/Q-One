import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  computeAnchoredScroll,
  computeFitZoom,
  computeSafeRenderScale,
  computeWheelTargetZoom,
  findMostVisiblePage,
  shouldApplyFit,
  type PageDimensions,
} from "../lib/viewerState";
import { BalloonOverlay } from "./BalloonOverlay";
import type { Dimension, MarkerPosition } from "../types/project";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const CONTAINER_PADDING_PX = 24;

export interface ScrollToPageRequest {
  page: number;
  key: number;
}

export interface PdfViewerProps {
  pdfBytes: Uint8Array | null;
  drawingId: string | null;
  drawingFilename: string | null;
  currentPage: number;
  pageCount: number;
  zoom: number;
  fitRequestKey: number;
  scrollToPageRequest: ScrollToPageRequest | null;
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  placingDimensionId: string | null;
  onPageCountLoaded: (pageCount: number) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onFitToView: () => void;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onSelectDimension: (dimensionId: string) => void;
  onMoveMarker: (dimensionId: string, x: number, y: number) => void;
  onCancelPlacing: () => void;
}

interface PdfPageItemProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  baseSize: PageDimensions;
  displayZoom: number;
  renderZoom: number;
  drawingId: string | null;
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  placingDimensionId: string | null;
  scrollContainer: HTMLDivElement | null;
  registerPageEl: (page: number, el: HTMLDivElement | null) => void;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onSelectDimension: (dimensionId: string) => void;
  onMoveMarker: (dimensionId: string, x: number, y: number) => void;
}

function PdfPageItem({
  pdfDoc,
  pageNumber,
  baseSize,
  displayZoom,
  renderZoom,
  drawingId,
  dimensions,
  selectedDimensionId,
  placingDimensionId,
  scrollContainer,
  registerPageEl,
  onPlaceMarker,
  onSelectDimension,
  onMoveMarker,
}: PdfPageItemProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(pageNumber <= 2);

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
      { root: scrollContainer, rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollContainer]);

  useEffect(() => {
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return;

    if (!isVisible) {
      // Free WebKit canvas backing-store memory for far-offscreen pages
      visibleCanvas.width = 0;
      visibleCanvas.height = 0;
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let offscreen: HTMLCanvasElement | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const safeScale = computeSafeRenderScale(
          baseSize.width,
          baseSize.height,
          renderZoom,
          window.devicePixelRatio || 1,
        );
        const renderViewport = page.getViewport({ scale: safeScale });
        offscreen = document.createElement("canvas");
        offscreen.width = Math.max(1, Math.floor(renderViewport.width));
        offscreen.height = Math.max(1, Math.floor(renderViewport.height));

        const offCtx = offscreen.getContext("2d");
        if (!offCtx) return;

        const task = page.render({
          canvas: offscreen,
          canvasContext: offCtx,
          viewport: renderViewport,
        });
        renderTask = task;
        return task.promise.then(() => {
          if (cancelled || !canvasRef.current || !offscreen) return;
          const target = canvasRef.current;
          target.width = offscreen.width;
          target.height = offscreen.height;
          const targetCtx = target.getContext("2d");
          if (targetCtx) {
            targetCtx.drawImage(offscreen, 0, 0);
          }
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
      })
      .finally(() => {
        if (offscreen) {
          offscreen.width = 0;
          offscreen.height = 0;
          offscreen = null;
        }
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageNumber, baseSize.width, baseSize.height, renderZoom, isVisible]);

  return (
    <div
      ref={setRefs}
      style={{ width, height }}
      className="relative shrink-0 bg-white shadow-2xl ring-1 ring-neutral-700/80"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {drawingId && (
        <BalloonOverlay
          dimensions={dimensions}
          currentPage={pageNumber}
          drawingId={drawingId}
          width={width}
          height={height}
          selectedDimensionId={selectedDimensionId}
          placingDimensionId={placingDimensionId}
          onPlaceMarker={onPlaceMarker}
          onSelectDimension={onSelectDimension}
          onMoveMarker={onMoveMarker}
        />
      )}
    </div>
  );
}

interface ZoomAnchor {
  cursorX: number;
  cursorY: number;
  prevZoom: number;
  prevScrollLeft: number;
  prevScrollTop: number;
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
  pdfBytes,
  drawingId,
  drawingFilename,
  currentPage,
  pageCount,
  zoom,
  fitRequestKey,
  scrollToPageRequest,
  dimensions,
  selectedDimensionId,
  placingDimensionId,
  onPageCountLoaded,
  onPageChange,
  onZoomChange,
  onFitToView,
  onPlaceMarker,
  onSelectDimension,
  onMoveMarker,
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

  // Smooth drag-pan state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panRef = useRef<PanState | null>(null);
  const panRafRef = useRef<number | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageDimensions[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

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

  // Sync external zoom changes (Fit / +/- buttons) smoothly
  useEffect(() => {
    if (Math.abs(zoom - targetZoomRef.current) < 0.005) return;
    targetZoomRef.current = zoom;
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      zoomAnchorRef.current = {
        cursorX: rect.width / 2,
        cursorY: rect.height / 2,
        prevZoom: displayZoomRef.current,
        prevScrollLeft: container.scrollLeft,
        prevScrollTop: container.scrollTop,
      };
    }
    startSmoothZoomAnimation();
  }, [zoom, startSmoothZoomAnimation]);

  // Apply cursor-anchored scroll immediately after displayZoom layout update (zero jitter)
  useLayoutEffect(() => {
    const anchor = pendingAnchorScrollRef.current;
    const container = containerRef.current;
    if (!anchor || !container) return;
    pendingAnchorScrollRef.current = null;

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
    }, 140);
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
        onPageCountLoaded(doc.numPages);
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

  // Fit-to-viewport: runs once per fitRequestKey increment after page sizes are ready
  useEffect(() => {
    if (
      !containerRef.current ||
      !shouldApplyFit(fitRequestKey, appliedFitKeyRef.current, firstPageSize)
    ) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const clamped = computeFitZoom(
      rect.width,
      rect.height,
      firstPageSize!.width,
      firstPageSize!.height,
    );
    appliedFitKeyRef.current = fitRequestKey;
    targetZoomRef.current = clamped;
    displayZoomRef.current = clamped;
    setDisplayZoom(clamped);
    setRenderZoom(clamped);
    onZoomChange(clamped);
  }, [fitRequestKey, firstPageSize, onZoomChange]);

  const scrollToPage = useCallback((targetPage: number) => {
    const el = pageElsRef.current.get(targetPage);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Respond to external scroll requests (e.g. clicking a dimension in the sidebar)
  useEffect(() => {
    if (!scrollToPageRequest) return;
    scrollToPage(scrollToPageRequest.page);
  }, [scrollToPageRequest, scrollToPage]);

  // Track most visible page while scrolling continuously
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageSizes.length === 0) return;

    let rafId: number | null = null;
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

    const onScroll = () => {
      if (rafId === null) {
        rafId = window.requestAnimationFrame(updateActivePage);
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [pageSizes.length, onPageChange]);

  // Non-passive native wheel listener: smooth cursor-anchored zoom with gentle sensitivity
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAnchorRef.current = {
        cursorX: e.clientX - rect.left,
        cursorY: e.clientY - rect.top,
        prevZoom: displayZoomRef.current,
        prevScrollLeft: el.scrollLeft,
        prevScrollTop: el.scrollTop,
      };
      targetZoomRef.current = computeWheelTargetZoom(
        targetZoomRef.current,
        e.deltaY,
      );
      startSmoothZoomAnimation();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [startSmoothZoomAnimation]);

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
    if (e.button !== 0 || placingDimensionId || !containerRef.current) return;
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

  const stepZoom = (delta: number) => {
    const next = Math.min(
      4,
      Math.max(0.25, Math.round((targetZoomRef.current + delta) * 100) / 100),
    );
    const el = containerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      zoomAnchorRef.current = {
        cursorX: rect.width / 2,
        cursorY: rect.height / 2,
        prevZoom: displayZoomRef.current,
        prevScrollLeft: el.scrollLeft,
        prevScrollTop: el.scrollTop,
      };
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950/90 px-3 text-xs text-neutral-300">
        <span className="truncate font-mono text-[11px] text-neutral-400">
          {drawingFilename ?? "Drawing"}
        </span>

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
              aria-label="Zoom out"
              className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[44px] text-center font-mono text-[11px] text-neutral-300">
              {Math.round(displayZoom * 100)}%
            </span>
            <button
              type="button"
              disabled={displayZoom >= 4}
              onClick={() => stepZoom(0.25)}
              aria-label="Zoom in"
              className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onFitToView}
              title="Fit drawing to viewport"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-neutral-800"
            >
              <Maximize2 className="h-3 w-3" />
              Fit
            </button>
          </div>
        </div>
      </div>

      {placingDimension && (
        <div className="z-30 flex items-center justify-between border-b border-blue-500/40 bg-blue-600/20 px-4 py-2 text-xs font-medium text-blue-100">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-blue-400" />
            <span>
              Click on the drawing to place Balloon #{placingDimension.balloonNumber}
              {placingDimension.name ? ` (${placingDimension.name})` : ""} — Press Esc to cancel
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
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        className={`flex-1 overflow-auto p-6 select-none ${
          placingDimensionId
            ? "cursor-crosshair"
            : isPanning
              ? "cursor-grabbing"
              : "cursor-grab"
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
                drawingId={drawingId}
                dimensions={dimensions}
                selectedDimensionId={selectedDimensionId}
                placingDimensionId={placingDimensionId}
                scrollContainer={containerRef.current}
                registerPageEl={registerPageEl}
                onPlaceMarker={onPlaceMarker}
                onSelectDimension={onSelectDimension}
                onMoveMarker={onMoveMarker}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
