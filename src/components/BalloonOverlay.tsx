import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  clampBatchMoveDelta,
  clampMovedRect,
  clientPointToNormalized,
  collapseOverlappingMarkers,
  computeNonOverlappingLabelOffsets,
  findMarkersAtPixelPoint,
  findMarkersInRect,
  normalizedToPixel,
  normalizeRectFromPoints,
} from "../lib/coordinates";
import { getAnnotationKind } from "../lib/annotations";
import { formatTolerance } from "../lib/dimensions";
import { FloatingMenu } from "./ui";
import type {
  Dimension,
  MarkerPosition,
  PointGroupCalibration,
} from "../types/project";

export interface BalloonOverlayProps {
  dimensions: Dimension[];
  currentPage: number;
  drawingId: string;
  width: number;
  height: number;
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
  onToggleBatchMoveIds?: (
    ids: string[],
    mode: "toggle" | "add" | "remove",
  ) => void;
  onBatchMoveMarkers?: (
    updates: Array<{ id: string; marker: MarkerPosition }>,
  ) => void;
  passthroughMarkers?: boolean;
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

interface DrawState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startClientX: number;
  startClientY: number;
  dragged: boolean;
}

interface BoxDragState {
  mode: "move" | "resize";
  dimensionId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  moved: boolean;
  previewX: number;
  previewY: number;
  previewWidth: number;
  previewHeight: number;
}

const DRAG_THRESHOLD_PX = 4;
const DEFAULT_CLICK_BOX_W = 0.04;
const DEFAULT_CLICK_BOX_H = 0.025;
const MIN_BOX_SIZE = 0.008;

export const BalloonOverlay = memo(function BalloonOverlay({
  dimensions,
  currentPage,
  drawingId,
  width,
  height,
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
  onToggleBatchMoveIds,
  onBatchMoveMarkers,
  passthroughMarkers = false,
  onPlaceMarker,
  onAddCaptureRegion,
  onPointEntryClick,
  onPointEntryHover,
  onSelectDimension,
  onMoveMarker,
}: BalloonOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const drawStateRef = useRef<DrawState | null>(null);
  const [batchDragDelta, setBatchDragDelta] = useState<{
    dx: number;
    dy: number;
  } | null>(null);
  const batchDragDeltaRef = useRef<{ dx: number; dy: number } | null>(null);
  const cleanupDrawListenersRef = useRef<(() => void) | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);
  const [overlapPicker, setOverlapPicker] = useState<{
    x: number;
    y: number;
    additive: boolean;
    candidates: Dimension[];
  } | null>(null);

  useEffect(() => {
    if (!overlapPicker) return;
    const close = () => setOverlapPicker(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = (e: Event) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-floating-menu='true']")
      ) {
        return;
      }
      close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [overlapPicker]);

  const visibleDimensions = useMemo(
    () =>
      dimensions.filter(
        (d) =>
          d.marker !== null &&
          d.marker.drawingId === drawingId &&
          d.marker.page === currentPage,
      ),
    [dimensions, drawingId, currentPage],
  );

  const placingDimension = placingDimensionId
    ? dimensions.find((d) => d.id === placingDimensionId) ?? null
    : null;
  const isPlacingPoint = placingDimension
    ? getAnnotationKind(placingDimension) === "point"
    : false;

  const selectedIdSet = new Set(
    selectedDimensionIds && selectedDimensionIds.length > 0
      ? selectedDimensionIds
      : selectedDimensionId
        ? [selectedDimensionId]
        : [],
  );
  const hasAnyHighlight = selectedIdSet.size > 0;
  const linkedPointIdSet = new Set<string>();
  const linkedNoteIdSet = new Set<string>();
  for (const dim of dimensions) {
    if (!selectedIdSet.has(dim.id)) continue;
    for (const pid of dim.linkedPointIds ?? []) linkedPointIdSet.add(pid);
    for (const nid of dim.linkedNoteIds ?? []) linkedNoteIdSet.add(nid);
  }

  const updateDrawState = (next: DrawState | null) => {
    drawStateRef.current = next;
    setDrawState(next);
  };

  const batchMoveSelectedSet = useMemo(
    () => new Set(batchMoveSelectedIds),
    [batchMoveSelectedIds],
  );
  const isBatchMoving = batchMovePhase !== null;
  const isDrawActive = Boolean(
    placingDimensionId || captureMode || pointEntryActive || batchMovePhase,
  );

  // Keep latest placement props accessible from window pointer listeners
  const placementCtxRef = useRef({
    placingDimensionId,
    isPlacingPoint,
    captureMode,
    pointEntryActive,
    batchMovePhase,
    batchMoveSelectedSet,
    visibleDimensions,
    width,
    height,
    drawingId,
    currentPage,
    onPlaceMarker,
    onAddCaptureRegion,
    onPointEntryClick,
    onToggleBatchMoveIds,
    onBatchMoveMarkers,
  });
  placementCtxRef.current = {
    placingDimensionId,
    isPlacingPoint,
    captureMode,
    pointEntryActive,
    batchMovePhase,
    batchMoveSelectedSet,
    visibleDimensions,
    width,
    height,
    drawingId,
    currentPage,
    onPlaceMarker,
    onAddCaptureRegion,
    onPointEntryClick,
    onToggleBatchMoveIds,
    onBatchMoveMarkers,
  };

  // Clean up any active window draw listeners on unmount
  useEffect(() => {
    return () => {
      cleanupDrawListenersRef.current?.();
      cleanupDrawListenersRef.current = null;
    };
  }, []);

  // Drag-to-box region drawing when placingDimensionId or captureMode is active
  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawActive || e.button !== 0 || !overlayRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    // Release focus from any sidebar input/IME cleanly so WKWebView never eats the first drag
    if (
      document.activeElement instanceof HTMLElement &&
      (document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA" ||
        document.activeElement.tagName === "SELECT")
    ) {
      document.activeElement.blur();
    }

    const rect = overlayRef.current.getBoundingClientRect();
    const norm = clientPointToNormalized(e.clientX, e.clientY, rect);
    if (!norm) return;

    cleanupDrawListenersRef.current?.();

    const pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch {
      // Window listeners below guarantee tracking even if pointer capture is rejected
    }

    updateDrawState({
      pointerId,
      startX: norm.x,
      startY: norm.y,
      currentX: norm.x,
      currentY: norm.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragged: false,
    });

    const releaseCapture = () => {
      const el = overlayRef.current;
      if (el && el.hasPointerCapture(pointerId)) {
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          // ignore
        }
      }
    };

    const detach = () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerCancel);
      if (cleanupDrawListenersRef.current === detach) {
        cleanupDrawListenersRef.current = null;
      }
    };

    const onWindowPointerMove = (ev: PointerEvent) => {
      const current = drawStateRef.current;
      if (!current || current.pointerId !== ev.pointerId || !overlayRef.current)
        return;
      const moveRect = overlayRef.current.getBoundingClientRect();
      const moveNorm = clientPointToNormalized(
        ev.clientX,
        ev.clientY,
        moveRect,
      );
      if (!moveNorm) return;
      const dragged =
        current.dragged ||
        Math.hypot(
          ev.clientX - current.startClientX,
          ev.clientY - current.startClientY,
        ) >= DRAG_THRESHOLD_PX;
      updateDrawState({
        ...current,
        currentX: moveNorm.x,
        currentY: moveNorm.y,
        dragged,
      });

      const ctx = placementCtxRef.current;
      if (ctx.batchMovePhase === "move" && dragged) {
        const selectedPageMarkers = ctx.visibleDimensions
          .filter((d) => ctx.batchMoveSelectedSet.has(d.id) && d.marker)
          .map((d) => d.marker!);
        const clamped = clampBatchMoveDelta(
          selectedPageMarkers,
          moveNorm.x - current.startX,
          moveNorm.y - current.startY,
        );
        batchDragDeltaRef.current = clamped;
        setBatchDragDelta(clamped);
      }
    };

    const onWindowPointerUp = (ev: PointerEvent) => {
      const current = drawStateRef.current;
      const ctx = placementCtxRef.current;
      if (
        !current ||
        current.pointerId !== ev.pointerId ||
        (!ctx.placingDimensionId &&
          !ctx.captureMode &&
          !ctx.pointEntryActive &&
          !ctx.batchMovePhase)
      ) {
        return;
      }
      detach();
      releaseCapture();

      if (ctx.batchMovePhase === "select") {
        updateDrawState(null);
        const candidates = ctx.visibleDimensions.map((d) => {
          const m = d.marker!;
          const isPt = getAnnotationKind(d) === "point";
          return {
            id: d.id,
            isPoint: isPt,
            x: m.x,
            y: m.y,
            width: isPt ? 0 : m.width || DEFAULT_CLICK_BOX_W,
            height: isPt ? 0 : m.height || DEFAULT_CLICK_BOX_H,
          };
        });
        if (current.dragged) {
          const rect = normalizeRectFromPoints(
            current.startX,
            current.startY,
            current.currentX,
            current.currentY,
            0.001,
          );
          const hits = findMarkersInRect(candidates, rect);
          if (hits.length > 0) {
            ctx.onToggleBatchMoveIds?.(
              hits.map((h) => h.id),
              ev.altKey ? "remove" : "add",
            );
          }
        } else {
          const px = current.currentX * ctx.width;
          const py = current.currentY * ctx.height;
          const hits = findMarkersAtPixelPoint(
            candidates,
            px,
            py,
            ctx.width,
            ctx.height,
          );
          if (hits.length > 0) {
            const hitIds = hits.map((h) => h.id);
            const allAlreadySelected = hitIds.every((id) =>
              ctx.batchMoveSelectedSet.has(id),
            );
            ctx.onToggleBatchMoveIds?.(
              hitIds,
              allAlreadySelected ? "remove" : "add",
            );
          }
        }
        return;
      }

      if (ctx.batchMovePhase === "move") {
        const delta = batchDragDeltaRef.current;
        batchDragDeltaRef.current = null;
        setBatchDragDelta(null);
        updateDrawState(null);
        if (
          delta &&
          (Math.abs(delta.dx) > 1e-5 || Math.abs(delta.dy) > 1e-5) &&
          ctx.onBatchMoveMarkers
        ) {
          const updates: Array<{ id: string; marker: MarkerPosition }> = [];
          for (const d of ctx.visibleDimensions) {
            if (!ctx.batchMoveSelectedSet.has(d.id) || !d.marker) continue;
            updates.push({
              id: d.id,
              marker: {
                ...d.marker,
                x: Math.max(0, Math.min(1, d.marker.x + delta.dx)),
                y: Math.max(0, Math.min(1, d.marker.y + delta.dy)),
              },
            });
          }
          if (updates.length > 0) {
            ctx.onBatchMoveMarkers(updates);
          }
        }
        return;
      }

      if (ctx.pointEntryActive && ctx.onPointEntryClick) {
        const px = Math.min(1, Math.max(0, current.currentX));
        const py = Math.min(1, Math.max(0, current.currentY));
        updateDrawState(null);
        ctx.onPointEntryClick(ctx.currentPage, px, py);
        return;
      }

      if (ctx.captureMode && ctx.onAddCaptureRegion) {
        const box = current.dragged
          ? normalizeRectFromPoints(
              current.startX,
              current.startY,
              current.currentX,
              current.currentY,
              MIN_BOX_SIZE,
            )
          : clampMovedRect(
              current.startX - DEFAULT_CLICK_BOX_W / 2,
              current.startY - DEFAULT_CLICK_BOX_H / 2,
              DEFAULT_CLICK_BOX_W,
              DEFAULT_CLICK_BOX_H,
            );
        updateDrawState(null);
        ctx.onAddCaptureRegion({
          page: ctx.currentPage,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
        return;
      }

      if (!ctx.placingDimensionId) {
        updateDrawState(null);
        return;
      }

      if (ctx.isPlacingPoint) {
        const px = Math.min(1, Math.max(0, current.currentX));
        const py = Math.min(1, Math.max(0, current.currentY));
        updateDrawState(null);
        ctx.onPlaceMarker(ctx.placingDimensionId, {
          drawingId: ctx.drawingId,
          page: ctx.currentPage,
          x: px,
          y: py,
          width: 0,
          height: 0,
        });
        return;
      }

      const box = current.dragged
        ? normalizeRectFromPoints(
            current.startX,
            current.startY,
            current.currentX,
            current.currentY,
            MIN_BOX_SIZE,
          )
        : clampMovedRect(
            current.startX - DEFAULT_CLICK_BOX_W / 2,
            current.startY - DEFAULT_CLICK_BOX_H / 2,
            DEFAULT_CLICK_BOX_W,
            DEFAULT_CLICK_BOX_H,
          );

      updateDrawState(null);
      ctx.onPlaceMarker(ctx.placingDimensionId, {
        drawingId: ctx.drawingId,
        page: ctx.currentPage,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    };

    const onWindowPointerCancel = (ev: PointerEvent) => {
      const current = drawStateRef.current;
      if (!current || current.pointerId !== ev.pointerId) return;
      detach();
      releaseCapture();
      updateDrawState(null);
    };

    // Attach synchronously during pointerdown so even sub-frame taps/drags are never missed
    cleanupDrawListenersRef.current = detach;
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
  };

  // Drag-to-move or corner-resize an existing region box (only when that dimension is in edit mode)
  const startBoxDrag = (
    e: React.PointerEvent<HTMLElement>,
    dim: Dimension,
    mode: "move" | "resize",
  ) => {
    if (placingDimensionId || e.button !== 0 || !dim.marker) return;
    if (dim.id !== editingDimensionId) {
      e.stopPropagation();
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      if (overlayRef.current) {
        const rect = overlayRef.current.getBoundingClientRect();
        const clickPx = e.clientX - rect.left;
        const clickPy = e.clientY - rect.top;
        const hits = findMarkersAtPixelPoint(
          visibleDimensions.map((d) => ({
            id: d.id,
            dim: d,
            isPoint: getAnnotationKind(d) === "point",
            x: d.marker!.x,
            y: d.marker!.y,
            width: d.marker!.width,
            height: d.marker!.height,
          })),
          clickPx,
          clickPy,
          rect.width,
          rect.height,
        );
        if (hits.length >= 2) {
          setOverlapPicker({
            x: e.clientX + 6,
            y: e.clientY + 6,
            additive,
            candidates: hits.map((h) => h.dim),
          });
          return;
        }
      }
      onSelectDimension(dim.id, additive);
      return;
    }
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const isPoint = getAnnotationKind(dim) === "point";
    const mw = isPoint ? 0 : dim.marker.width || DEFAULT_CLICK_BOX_W;
    const mh = isPoint ? 0 : dim.marker.height || DEFAULT_CLICK_BOX_H;
    setBoxDrag({
      mode,
      dimensionId: dim.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: dim.marker.x,
      originY: dim.marker.y,
      originWidth: mw,
      originHeight: mh,
      moved: false,
      previewX: dim.marker.x,
      previewY: dim.marker.y,
      previewWidth: mw,
      previewHeight: mh,
    });
  };

  const handleBoxPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!boxDrag || boxDrag.pointerId !== e.pointerId || !overlayRef.current)
      return;
    e.stopPropagation();
    const dxPx = e.clientX - boxDrag.startClientX;
    const dyPx = e.clientY - boxDrag.startClientY;
    const moved = boxDrag.moved || Math.hypot(dxPx, dyPx) >= DRAG_THRESHOLD_PX;
    if (!moved) return;

    const rect = overlayRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dxNorm = dxPx / rect.width;
    const dyNorm = dyPx / rect.height;

    if (boxDrag.mode === "move") {
      const clamped = clampMovedRect(
        boxDrag.originX + dxNorm,
        boxDrag.originY + dyNorm,
        boxDrag.originWidth,
        boxDrag.originHeight,
      );
      setBoxDrag((prev) =>
        prev
          ? {
              ...prev,
              moved: true,
              previewX: clamped.x,
              previewY: clamped.y,
            }
          : null,
      );
    } else {
      const nextW = Math.min(
        1 - boxDrag.originX,
        Math.max(MIN_BOX_SIZE, boxDrag.originWidth + dxNorm),
      );
      const nextH = Math.min(
        1 - boxDrag.originY,
        Math.max(MIN_BOX_SIZE, boxDrag.originHeight + dyNorm),
      );
      setBoxDrag((prev) =>
        prev
          ? {
              ...prev,
              moved: true,
              previewWidth: nextW,
              previewHeight: nextH,
            }
          : null,
      );
    }
  };

  const handleBoxPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!boxDrag || boxDrag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (boxDrag.moved) {
      onMoveMarker(
        boxDrag.dimensionId,
        boxDrag.previewX,
        boxDrag.previewY,
        boxDrag.previewWidth,
        boxDrag.previewHeight,
      );
      onSelectDimension(boxDrag.dimensionId);
    } else {
      onSelectDimension(boxDrag.dimensionId);
    }
    setBoxDrag(null);
  };

  const handleBoxPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (!boxDrag || boxDrag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setBoxDrag(null);
  };

  const previewDrawBox =
    drawState &&
    drawState.dragged &&
    !pointEntryActive &&
    (captureMode || !isPlacingPoint)
      ? normalizeRectFromPoints(
          drawState.startX,
          drawState.startY,
          drawState.currentX,
          drawState.currentY,
          0.002,
        )
      : null;

  const renderedMarkers = useMemo(() => {
    const linkedAll = new Set<string>([...linkedPointIdSet, ...linkedNoteIdSet]);
    return collapseOverlappingMarkers(visibleDimensions, {
      isPoint: (d) => getAnnotationKind(d) === "point",
      selectedIds: selectedIdSet,
      linkedIds: linkedAll,
      editingId: editingDimensionId,
      minClusterSize: 4,
    });
  }, [
    visibleDimensions,
    selectedDimensionId,
    selectedDimensionIds,
    editingDimensionId,
    dimensions,
  ]);

  const labelOffsets = useMemo(
    () =>
      computeNonOverlappingLabelOffsets(
        renderedMarkers.map((entry) => {
          const dim = entry.primary;
          const marker = dim.marker!;
          const isDraggingThis =
            boxDrag?.dimensionId === dim.id && boxDrag.moved;
          const x = isDraggingThis ? boxDrag.previewX : marker.x;
          const y = isDraggingThis ? boxDrag.previewY : marker.y;
          const isPoint = getAnnotationKind(dim) === "point";
          const mw = isDraggingThis
            ? boxDrag.previewWidth
            : marker.width || DEFAULT_CLICK_BOX_W;
          const mh = isDraggingThis
            ? boxDrag.previewHeight
            : marker.height || DEFAULT_CLICK_BOX_H;
          const { px, py } = normalizedToPixel(x, y, width, height);
          return {
            id: dim.id,
            isPoint,
            px,
            py,
            boxW: isPoint ? 0 : Math.max(12, mw * width),
            boxH: isPoint ? 0 : Math.max(10, mh * height),
            label: entry.labelOverride ?? (dim.name.trim() || "New"),
          };
        }),
        width,
        height,
      ),
    [renderedMarkers, boxDrag, width, height],
  );

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => {
        if (isDrawActive) {
          e.preventDefault();
        }
      }}
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={(e) => {
        if (!pointEntryActive || !onPointEntryHover || !overlayRef.current)
          return;
        const norm = clientPointToNormalized(
          e.clientX,
          e.clientY,
          overlayRef.current.getBoundingClientRect(),
        );
        onPointEntryHover(norm);
      }}
      onPointerLeave={() => {
        if (pointEntryActive && onPointEntryHover) {
          onPointEntryHover(null);
        }
      }}
      className={`absolute inset-0 z-20 select-none ${
        batchMovePhase === "move"
          ? "pointer-events-auto touch-none cursor-move"
          : isDrawActive
            ? "pointer-events-auto touch-none cursor-crosshair"
            : "pointer-events-none"
      }`}
    >
      {renderedMarkers.map((entry) => {
        const dim = entry.primary;
        const marker = dim.marker!;
        const isDraggingThis = boxDrag?.dimensionId === dim.id && boxDrag.moved;
        const isInBatchSelection =
          isBatchMoving &&
          entry.members.some((m) => batchMoveSelectedSet.has(m.id));
        const bdx = isInBatchSelection && batchDragDelta ? batchDragDelta.dx : 0;
        const bdy = isInBatchSelection && batchDragDelta ? batchDragDelta.dy : 0;
        const x = (isDraggingThis ? boxDrag.previewX : marker.x) + bdx;
        const y = (isDraggingThis ? boxDrag.previewY : marker.y) + bdy;
        const mw = isDraggingThis
          ? boxDrag.previewWidth
          : marker.width || DEFAULT_CLICK_BOX_W;
        const mh = isDraggingThis
          ? boxDrag.previewHeight
          : marker.height || DEFAULT_CLICK_BOX_H;

        const isPoint = getAnnotationKind(dim) === "point";
        const isSelected = isBatchMoving
          ? isInBatchSelection
          : selectedIdSet.has(dim.id);
        const isEditing = dim.id === editingDimensionId;
        const label = entry.labelOverride ?? (dim.name.trim() || "New");
        const tol = formatTolerance(dim.upperTol, dim.lowerTol);
        const tooltip = entry.isCollapsed
          ? `${entry.members.length} overlapping annotations — click to choose`
          : isPoint
          ? [
              `Point ${label}`,
              dim.point
                ? `(${dim.point.x || "—"}, ${dim.point.y || "—"}, ${dim.point.z || "—"})`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : [
              dim.dimensionType?.trim(),
              dim.name.trim() || "New Dimension",
              dim.nominal
                ? `${dim.quantity > 1 ? `${dim.quantity}X ` : ""}${dim.nominal}${tol ? ` ${tol}` : ""} ${dim.unit}`
                : "",
            ]
              .filter(Boolean)
              .join(" — ");

        if (isPoint) {
          const isLinkedToSelected = linkedPointIdSet.has(dim.id);
          const isDimmed = isBatchMoving
            ? !isInBatchSelection
            : (Boolean(placingDimensionId) && dim.id !== placingDimensionId) ||
              (hasAnyHighlight && !isSelected && !isLinkedToSelected);
          const labelOffset = labelOffsets.get(dim.id);
          return (
            <div
              key={dim.id}
              title={tooltip}
              aria-label={`Point marker ${label}`}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => startBoxDrag(e, dim, "move")}
              onPointerMove={handleBoxPointerMove}
              onPointerUp={handleBoxPointerUp}
              onPointerCancel={handleBoxPointerCancel}
              onClick={(e) => e.stopPropagation()}
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 transition-opacity ${
                isSelected || isLinkedToSelected ? "z-30" : "z-20"
              } ${
                isDimmed ? "opacity-35 hover:opacity-85" : "opacity-100"
              } ${
                isDrawActive
                  ? "pointer-events-none"
                  : passthroughMarkers
                    ? "pointer-events-none"
                    : !isEditing
                      ? "pointer-events-auto cursor-pointer"
                      : isDraggingThis
                        ? "pointer-events-auto cursor-grabbing"
                        : "pointer-events-auto cursor-grab"
              }`}
            >
              {/* Crisp precision point dot with subtle outer halo */}
              <div
                className={`flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                  isBatchMoving && isInBatchSelection
                    ? "border-blue-400 bg-blue-500/25 shadow-[0_0_0_2.5px_rgba(59,130,246,0.35)]"
                    : isDimmed
                      ? "border-neutral-400/80 bg-neutral-400/15"
                      : isSelected || isLinkedToSelected
                        ? "border-purple-400 bg-purple-500/25 shadow-[0_0_0_2.5px_rgba(168,85,247,0.3)]"
                        : "border-purple-400 bg-purple-500/20 hover:border-purple-300"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isBatchMoving && isInBatchSelection
                      ? "bg-blue-400"
                      : isDimmed
                        ? "bg-neutral-400"
                        : "bg-purple-400"
                  }`}
                />
              </div>

              <span
                style={
                  labelOffset
                    ? {
                        left: `${8 + labelOffset.dx}px`,
                        top: `${8 + labelOffset.dy}px`,
                      }
                    : undefined
                }
                className={`pointer-events-none absolute whitespace-nowrap rounded-[2px] px-1 py-[1px] font-mono text-[10px] font-semibold leading-tight shadow-sm ${
                  isBatchMoving && isInBatchSelection
                    ? "bg-blue-600 text-white"
                    : isDimmed
                      ? "bg-neutral-500/85 text-white"
                      : isSelected || isLinkedToSelected
                      ? "bg-purple-600 text-white"
                      : "bg-purple-600/90 text-white"
                }`}
              >
                {label}
              </span>
            </div>
          );
        }

        const isLinkedNoteToSelected = linkedNoteIdSet.has(dim.id);
        const isDimmed = isBatchMoving
          ? !isInBatchSelection
          : (Boolean(placingDimensionId) && dim.id !== placingDimensionId) ||
            (hasAnyHighlight && !isSelected && !isLinkedNoteToSelected);
        const labelOffset = labelOffsets.get(dim.id);

        return (
          <div
            key={dim.id}
            title={tooltip}
            aria-label={`Dimension region ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => startBoxDrag(e, dim, "move")}
            onPointerMove={handleBoxPointerMove}
            onPointerUp={handleBoxPointerUp}
            onPointerCancel={handleBoxPointerCancel}
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${mw * 100}%`,
              height: `${mh * 100}%`,
              minWidth: "12px",
              minHeight: "10px",
            }}
            className={`absolute rounded-[2px] border-[1.5px] transition-[opacity,background-color,border-color,box-shadow] ${
              isBatchMoving && isInBatchSelection
                ? "z-30 border-blue-400 bg-blue-500/15 shadow-[0_0_0_2px_rgba(59,130,246,0.28)]"
                : isDimmed
                  ? "z-20 border-neutral-400/75 bg-neutral-400/[0.04]"
                  : isSelected || isLinkedNoteToSelected
                    ? "z-30 border-rose-500 bg-rose-500/[0.07] shadow-[0_0_0_2px_rgba(244,63,94,0.22)]"
                    : "z-20 border-rose-500/80 bg-rose-500/[0.03] hover:border-rose-400"
            } ${
              isDimmed ? "opacity-35 hover:opacity-85" : "opacity-100"
            } ${
              isBatchMoving || placingDimensionId || passthroughMarkers
                ? "pointer-events-none"
                : !isEditing
                  ? "pointer-events-auto cursor-pointer"
                  : isDraggingThis
                    ? "pointer-events-auto cursor-grabbing"
                    : "pointer-events-auto cursor-grab"
            }`}
          >
            <span
              style={
                labelOffset
                  ? {
                      left: `${labelOffset.dx}px`,
                      top: `${labelOffset.dy}px`,
                    }
                  : { left: "-1px", bottom: "100%" }
              }
              className={`pointer-events-none absolute whitespace-nowrap rounded-[2px] px-1 py-[1px] font-mono text-[10px] font-semibold leading-tight shadow-sm ${
                isBatchMoving && isInBatchSelection
                  ? "bg-blue-600 text-white"
                  : isDimmed
                    ? "bg-neutral-500/85 text-white"
                    : isSelected || isLinkedNoteToSelected
                      ? "bg-rose-600 text-white"
                      : "bg-rose-600/90 text-white"
              }`}
            >
              {label}
            </span>

            {isEditing && !placingDimensionId && !passthroughMarkers && (
              <div
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => startBoxDrag(e, dim, "resize")}
                onPointerMove={handleBoxPointerMove}
                onPointerUp={handleBoxPointerUp}
                onPointerCancel={handleBoxPointerCancel}
                title="Drag to resize region"
                className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize rounded-[1px] border border-white bg-blue-600 shadow"
              />
            )}
          </div>
        );
      })}

      {pointEntryActive && pointEntryCalibration && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {pointEntryCalibration.xZero !== null && (
            <div
              style={{ left: `${pointEntryCalibration.xZero * 100}%` }}
              className="absolute top-0 bottom-0 w-0 border-l-[1.5px] border-dashed border-sky-400/90"
            >
              <span className="absolute left-1 top-1 rounded bg-sky-600/95 px-1 py-[1px] font-mono text-[10px] font-semibold text-white shadow">
                X=0
              </span>
            </div>
          )}
          {pointEntryCalibration.yZero !== null && (
            <div
              style={{ top: `${pointEntryCalibration.yZero * 100}%` }}
              className="absolute left-0 right-0 h-0 border-t-[1.5px] border-dashed border-emerald-400/90"
            >
              <span className="absolute left-1 top-1 rounded bg-emerald-600/95 px-1 py-[1px] font-mono text-[10px] font-semibold text-white shadow">
                Y=0
              </span>
            </div>
          )}
          {pointEntryCalibration.anchorX !== null &&
            pointEntryCalibration.anchorY !== null && (
              <div
                style={{
                  left: `${pointEntryCalibration.anchorX * 100}%`,
                  top: `${pointEntryCalibration.anchorY * 100}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-500/20 shadow-[0_0_0_2px_rgba(245,158,11,0.3)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                </div>
                <span className="absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-amber-600/95 px-1.5 py-[1px] font-mono text-[10px] font-semibold text-white shadow">
                  Anchor ({pointEntryCalibration.anchorValX || "?"},{" "}
                  {pointEntryCalibration.anchorValY || "?"})
                </span>
              </div>
            )}
        </div>
      )}

      {captureRegions.map((reg, idx) => (
        <div
          key={`capture-${idx}`}
          style={{
            left: `${reg.x * 100}%`,
            top: `${reg.y * 100}%`,
            width: `${reg.width * 100}%`,
            height: `${reg.height * 100}%`,
          }}
          className="pointer-events-none absolute z-40 rounded-[2px] border-[1.5px] border-dashed border-purple-400 bg-purple-500/15"
        >
          <span className="absolute -top-4 left-0 rounded-[2px] bg-purple-600 px-1 py-[1px] font-mono text-[10px] font-semibold leading-tight text-white shadow-sm">
            {reg.label ?? `#${idx + 1}`}
          </span>
        </div>
      ))}

      {previewDrawBox && batchMovePhase !== "move" && (
        <div
          style={{
            left: `${previewDrawBox.x * 100}%`,
            top: `${previewDrawBox.y * 100}%`,
            width: `${previewDrawBox.width * 100}%`,
            height: `${previewDrawBox.height * 100}%`,
          }}
          className={`pointer-events-none absolute z-40 rounded-[2px] border-[1.5px] border-dashed ${
            captureMode
              ? "border-purple-400 bg-purple-500/15"
              : "border-blue-400 bg-blue-500/15"
          }`}
        />
      )}

      {overlapPicker && (
        <FloatingMenu
          x={overlapPicker.x}
          y={overlapPicker.y}
          role="menu"
          aria-label="Select overlapping annotation"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex w-56 flex-col overflow-hidden rounded-md border border-neutral-700 bg-neutral-900/95 text-xs shadow-2xl backdrop-blur-md"
        >
          <div className="shrink-0 border-b border-neutral-800 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            Select Annotation ({overlapPicker.candidates.length})
          </div>
          <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
          {overlapPicker.candidates.map((cand) => {
            const cKind = getAnnotationKind(cand);
            const cLabel = cand.name.trim() || "—";
            const cSelected = selectedIdSet.has(cand.id);
            const cTol = formatTolerance(cand.upperTol, cand.lowerTol);
            const cSummary =
              cKind === "point"
                ? cand.point
                  ? `(${cand.point.x || "—"}, ${cand.point.y || "—"})`
                  : ""
                : cKind === "linear" && cand.nominal.trim()
                  ? `${cand.nominal.trim()}${cTol ? ` ${cTol}` : ""}`
                  : cKind === "gdt" && cand.gdt?.tolerance.trim()
                    ? cand.gdt.tolerance.trim()
                    : cand.notes.trim();
            const badgeClass =
              cKind === "point"
                ? "bg-purple-500/20 text-purple-300 ring-purple-500/40"
                : cKind === "note"
                  ? "bg-sky-500/20 text-sky-300 ring-sky-500/40"
                  : cKind === "datum"
                    ? "bg-amber-500/20 text-amber-300 ring-amber-500/40"
                    : "bg-neutral-800 text-neutral-300 ring-neutral-700";
            const badgeText =
              cKind === "point"
                ? "PT"
                : cKind === "note"
                  ? "NOTE"
                  : cKind === "datum"
                    ? "DATUM"
                    : cand.dimensionType?.trim() ||
                      (cKind === "gdt"
                        ? "GD&T"
                        : cKind === "non_dimensional"
                          ? "NON-DIM"
                          : "DIM");

            return (
              <button
                key={cand.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  const additive = overlapPicker.additive;
                  setOverlapPicker(null);
                  onSelectDimension(cand.id, additive);
                }}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-neutral-800 hover:text-white ${
                  cSelected ? "bg-neutral-800/70 text-white" : "text-neutral-200"
                }`}
              >
                <span
                  className={`shrink-0 rounded px-1 py-[1px] font-mono text-[9px] font-semibold ring-1 ${badgeClass}`}
                >
                  {badgeText}
                </span>
                <span className="shrink-0 font-mono text-[11px] font-semibold">
                  {cLabel}
                </span>
                {cSummary && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-400">
                    {cSummary}
                  </span>
                )}
              </button>
            );
          })}
          </div>
        </FloatingMenu>
      )}
    </div>
  );
});
