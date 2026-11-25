import { useCallback, useEffect, useRef, useState } from "react";
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
  computeFitZoom,
  findMostVisiblePage,
  shouldApplyFit,
  type PageDimensions,
} from "../lib/viewerState";
import { BalloonOverlay } from "./BalloonOverlay";
import type { Dimension, MarkerPosition } from "../types/project";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
  zoom: number;
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
  zoom,
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

  const width = Math.max(1, Math.round(baseSize.width * zoom));
  const height = Math.max(1, Math.round(baseSize.height * zoom));

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
          if (entry.isIntersecting) {
            setIsVisible(true);
          }
        }
      },
      { root: scrollContainer, rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollContainer]);

  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale: zoom });
        const dpr = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const task = page.render({ canvas, canvasContext: context, viewport });
        renderTask = task;
        return task.promise;
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
  }, [pdfDoc, pageNumber, zoom, isVisible]);

  return (
    <div
      ref={setRefs}
      style={{ width, height }}
      className="relative shrink-0 bg-white shadow-2xl ring-1 ring-neutral-700/80"
    >
      <canvas ref={canvasRef} className="block" />
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
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;
  const currentPageRef = useRef<number>(currentPage);
  currentPageRef.current = currentPage;

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageDimensions[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

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

  // Non-passive native wheel listener for Ctrl/Cmd + wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      const next = Math.min(
        4,
        Math.max(0.25, Math.round((zoomRef.current + delta) * 100) / 100),
      );
      zoomRef.current = next;
      onZoomChange(next);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoomChange]);

  const placingDimension = placingDimensionId
    ? dimensions.find((d) => d.id === placingDimensionId) ?? null
    : null;

  const stepZoom = (delta: number) => {
    const next = Math.min(
      4,
      Math.max(0.25, Math.round((zoom + delta) * 100) / 100),
    );
    onZoomChange(next);
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
              disabled={zoom <= 0.25}
              onClick={() => stepZoom(-0.25)}
              aria-label="Zoom out"
              className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[44px] text-center font-mono text-[11px] text-neutral-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              disabled={zoom >= 4}
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

      <div ref={containerRef} className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex w-fit flex-col items-center gap-6">
          {pdfDoc &&
            pageSizes.map((size, idx) => (
              <PdfPageItem
                key={idx + 1}
                pdfDoc={pdfDoc}
                pageNumber={idx + 1}
                baseSize={size}
                zoom={zoom}
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
