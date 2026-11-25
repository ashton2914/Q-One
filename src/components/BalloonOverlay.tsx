import React, { useRef, useState } from "react";
import {
  clampMovedRect,
  clientPointToNormalized,
  normalizedToPixel,
  normalizeRectFromPoints,
} from "../lib/coordinates";
import { formatTolerance } from "../lib/dimensions";
import type { Dimension, MarkerPosition } from "../types/project";

export interface BalloonOverlayProps {
  dimensions: Dimension[];
  currentPage: number;
  drawingId: string;
  width: number;
  height: number;
  selectedDimensionId: string | null;
  editingDimensionId: string | null;
  placingDimensionId: string | null;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onSelectDimension: (dimensionId: string) => void;
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

export function BalloonOverlay({
  dimensions,
  currentPage,
  drawingId,
  width,
  height,
  selectedDimensionId,
  editingDimensionId,
  placingDimensionId,
  onPlaceMarker,
  onSelectDimension,
  onMoveMarker,
}: BalloonOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);

  const visibleDimensions = dimensions.filter(
    (d) =>
      d.marker !== null &&
      d.marker.drawingId === drawingId &&
      d.marker.page === currentPage,
  );

  // Drag-to-box region drawing when placingDimensionId is active
  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!placingDimensionId || e.button !== 0 || !overlayRef.current) return;
    e.stopPropagation();
    const rect = overlayRef.current.getBoundingClientRect();
    const norm = clientPointToNormalized(e.clientX, e.clientY, rect);
    if (!norm) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawState({
      pointerId: e.pointerId,
      startX: norm.x,
      startY: norm.y,
      currentX: norm.x,
      currentY: norm.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragged: false,
    });
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawState || drawState.pointerId !== e.pointerId || !overlayRef.current)
      return;
    e.stopPropagation();
    const rect = overlayRef.current.getBoundingClientRect();
    const norm = clientPointToNormalized(e.clientX, e.clientY, rect);
    if (!norm) return;
    const dragged =
      drawState.dragged ||
      Math.hypot(
        e.clientX - drawState.startClientX,
        e.clientY - drawState.startClientY,
      ) >= DRAG_THRESHOLD_PX;
    setDrawState((prev) =>
      prev ? { ...prev, currentX: norm.x, currentY: norm.y, dragged } : null,
    );
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawState || drawState.pointerId !== e.pointerId || !placingDimensionId)
      return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const box = drawState.dragged
      ? normalizeRectFromPoints(
          drawState.startX,
          drawState.startY,
          drawState.currentX,
          drawState.currentY,
          MIN_BOX_SIZE,
        )
      : clampMovedRect(
          drawState.startX - DEFAULT_CLICK_BOX_W / 2,
          drawState.startY - DEFAULT_CLICK_BOX_H / 2,
          DEFAULT_CLICK_BOX_W,
          DEFAULT_CLICK_BOX_H,
        );

    setDrawState(null);
    onPlaceMarker(placingDimensionId, {
      drawingId,
      page: currentPage,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  };

  const handleOverlayPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawState || drawState.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDrawState(null);
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
      onSelectDimension(dim.id);
      return;
    }
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mw = dim.marker.width || DEFAULT_CLICK_BOX_W;
    const mh = dim.marker.height || DEFAULT_CLICK_BOX_H;
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
    drawState && drawState.dragged
      ? normalizeRectFromPoints(
          drawState.startX,
          drawState.startY,
          drawState.currentX,
          drawState.currentY,
          0.002,
        )
      : null;

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={handleOverlayPointerMove}
      onPointerUp={handleOverlayPointerUp}
      onPointerCancel={handleOverlayPointerCancel}
      style={{ width, height }}
      className={`absolute inset-0 select-none ${
        placingDimensionId ? "cursor-crosshair" : ""
      }`}
    >
      {visibleDimensions.map((dim) => {
        const marker = dim.marker!;
        const isDraggingThis = boxDrag?.dimensionId === dim.id && boxDrag.moved;
        const x = isDraggingThis ? boxDrag.previewX : marker.x;
        const y = isDraggingThis ? boxDrag.previewY : marker.y;
        const mw = isDraggingThis
          ? boxDrag.previewWidth
          : marker.width || DEFAULT_CLICK_BOX_W;
        const mh = isDraggingThis
          ? boxDrag.previewHeight
          : marker.height || DEFAULT_CLICK_BOX_H;

        const { px, py } = normalizedToPixel(x, y, width, height);
        const boxW = Math.max(12, mw * width);
        const boxH = Math.max(10, mh * height);
        const isSelected = dim.id === selectedDimensionId;
        const isEditing = dim.id === editingDimensionId;
        const label = dim.name.trim() || `#${dim.balloonNumber}`;
        const tol = formatTolerance(dim.upperTol, dim.lowerTol);
        const tooltip = [
          `#${dim.balloonNumber}`,
          dim.name || "Untitled Dimension",
          dim.nominal ? `${dim.nominal}${tol ? ` ${tol}` : ""} ${dim.unit}` : "",
        ]
          .filter(Boolean)
          .join(" — ");

        const placeLabelInside = py < 16;

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
              left: `${px}px`,
              top: `${py}px`,
              width: `${boxW}px`,
              height: `${boxH}px`,
            }}
            className={`absolute rounded-[2px] border-[1.5px] transition-colors ${
              isSelected
                ? "z-30 border-blue-500 bg-blue-500/[0.06]"
                : "z-20 border-rose-500/80 bg-rose-500/[0.03] hover:border-rose-400"
            } ${
              placingDimensionId
                ? "pointer-events-none opacity-65"
                : !isEditing
                  ? "cursor-pointer"
                  : isDraggingThis
                    ? "cursor-grabbing"
                    : "cursor-grab"
            }`}
          >
            <span
              className={`pointer-events-none absolute left-[-1px] whitespace-nowrap rounded-[2px] px-1 py-[1px] font-mono text-[10px] font-semibold leading-tight shadow-sm ${
                placeLabelInside ? "top-0" : "bottom-full mb-[1px]"
              } ${
                isSelected
                  ? "bg-blue-600/95 text-white"
                  : "bg-rose-600/90 text-white"
              }`}
            >
              {label}
            </span>

            {isEditing && !placingDimensionId && (
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

      {previewDrawBox && (
        <div
          style={{
            left: `${previewDrawBox.x * width}px`,
            top: `${previewDrawBox.y * height}px`,
            width: `${previewDrawBox.width * width}px`,
            height: `${previewDrawBox.height * height}px`,
          }}
          className="pointer-events-none absolute z-40 rounded-[2px] border-[1.5px] border-dashed border-blue-400 bg-blue-500/10"
        />
      )}
    </div>
  );
}
