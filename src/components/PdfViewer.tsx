import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Crosshair, X } from "lucide-react";
import { computeFitZoom, shouldApplyFit } from "../lib/viewerState";
import { BalloonOverlay } from "./BalloonOverlay";
import type { Dimension, MarkerPosition } from "../types/project";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfViewerProps {
  pdfBytes: Uint8Array | null;
  drawingId: string | null;
  currentPage: number;
  zoom: number;
  fitRequestKey: number;
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  placingDimensionId: string | null;
  onPageCountLoaded: (pageCount: number) => void;
  onZoomChange: (zoom: number) => void;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onSelectDimension: (dimensionId: string) => void;
  onMoveMarker: (dimensionId: string, x: number, y: number) => void;
  onCancelPlacing: () => void;
}

export function PdfViewer({
  pdfBytes,
  drawingId,
  currentPage,
  zoom,
  fitRequestKey,
  dimensions,
  selectedDimensionId,
  placingDimensionId,
  onPageCountLoaded,
  onZoomChange,
  onPlaceMarker,
  onSelectDimension,
  onMoveMarker,
  onCancelPlacing,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const appliedFitKeyRef = useRef<number>(0);
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [basePageSize, setBasePageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Load PDF document when pdfBytes changes
  useEffect(() => {
    setPdfDoc(null);
    setPageSize({ width: 0, height: 0 });
    setBasePageSize(null);
    setRenderError(null);

    if (!pdfBytes) {
      return;
    }

    let cancelled = false;
    const loadingTask = getDocument({ data: pdfBytes.slice() });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        setRenderError(null);
        setPdfDoc(doc);
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

  // Render active page to canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    if (currentPage < 1 || currentPage > pdfDoc.numPages) return;

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    pdfDoc
      .getPage(currentPage)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        setBasePageSize((prev) =>
          prev &&
          prev.width === baseViewport.width &&
          prev.height === baseViewport.height
            ? prev
            : { width: baseViewport.width, height: baseViewport.height },
        );

        const viewport = page.getViewport({ scale: zoom });
        const dpr = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        setPageSize({ width: viewport.width, height: viewport.height });

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const task = page.render({ canvas, canvasContext: context, viewport });
        renderTask = task;
        return task.promise;
      })
      .catch((err: unknown) => {
        if (
          !cancelled &&
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "RenderingCancelledException"
        ) {
          return;
        }
        if (!cancelled) {
          setRenderError(
            err instanceof Error ? err.message : "Failed to render PDF page.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, zoom]);

  // Fit-to-viewport: runs once per fitRequestKey increment after basePageSize is ready
  useEffect(() => {
    if (
      !containerRef.current ||
      !shouldApplyFit(fitRequestKey, appliedFitKeyRef.current, basePageSize)
    ) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const clamped = computeFitZoom(
      rect.width,
      rect.height,
      basePageSize!.width,
      basePageSize!.height,
    );
    appliedFitKeyRef.current = fitRequestKey;
    onZoomChange(clamped);
  }, [fitRequestKey, basePageSize, onZoomChange]);

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

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-neutral-900">
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
        <div className="mx-auto flex min-h-full w-fit items-center justify-center">
          <div className="relative bg-white shadow-2xl ring-1 ring-neutral-700/80">
            <canvas ref={canvasRef} className="block" />
            {drawingId && pageSize.width > 0 && pageSize.height > 0 && (
              <BalloonOverlay
                dimensions={dimensions}
                currentPage={currentPage}
                drawingId={drawingId}
                width={pageSize.width}
                height={pageSize.height}
                selectedDimensionId={selectedDimensionId}
                placingDimensionId={placingDimensionId}
                onPlaceMarker={onPlaceMarker}
                onSelectDimension={onSelectDimension}
                onMoveMarker={onMoveMarker}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
