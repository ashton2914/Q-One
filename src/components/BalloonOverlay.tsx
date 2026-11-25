import React, { useRef, useState } from "react";
import { clientPointToNormalized, normalizedToPixel } from "../lib/coordinates";
import { formatTolerance } from "../lib/dimensions";
import type { Dimension, MarkerPosition } from "../types/project";

export interface BalloonOverlayProps {
  dimensions: Dimension[];
  currentPage: number;
  drawingId: string;
  width: number;
  height: number;
  selectedDimensionId: string | null;
  placingDimensionId: string | null;
  onPlaceMarker: (dimensionId: string, marker: MarkerPosition) => void;
  onSelectDimension: (dimensionId: string) => void;
  onMoveMarker: (dimensionId: string, x: number, y: number) => void;
}

interface DragState {
  dimensionId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  previewX: number;
  previewY: number;
}

const DRAG_THRESHOLD_PX = 4;

export function BalloonOverlay({
  dimensions,
  currentPage,
  drawingId,
  width,
  height,
  selectedDimensionId,
  placingDimensionId,
  onPlaceMarker,
  onSelectDimension,
  onMoveMarker,
}: BalloonOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const visibleDimensions = dimensions.filter(
    (d) =>
      d.marker !== null &&
      d.marker.drawingId === drawingId &&
      d.marker.page === currentPage,
  );

  const handleBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placingDimensionId || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const norm = clientPointToNormalized(e.clientX, e.clientY, rect);
    if (!norm) return;
    onPlaceMarker(placingDimensionId, {
      drawingId,
      page: currentPage,
      x: norm.x,
      y: norm.y,
    });
  };

  const handlePinPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    dim: Dimension,
  ) => {
    if (placingDimensionId || !dim.marker) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      dimensionId: dim.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      previewX: dim.marker.x,
      previewY: dim.marker.y,
    });
  };

  const handlePinPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== e.pointerId || !overlayRef.current) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    const moved = drag.moved || Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
    if (!moved) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const norm = clientPointToNormalized(e.clientX, e.clientY, rect);
    if (!norm) return;

    setDrag((prev) =>
      prev ? { ...prev, moved: true, previewX: norm.x, previewY: norm.y } : null,
    );
  };

  const handlePinPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag.moved) {
      onMoveMarker(drag.dimensionId, drag.previewX, drag.previewY);
      onSelectDimension(drag.dimensionId);
    } else {
      onSelectDimension(drag.dimensionId);
    }
    setDrag(null);
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleBackgroundClick}
      style={{ width, height }}
      className={`absolute inset-0 select-none ${
        placingDimensionId ? "cursor-crosshair" : ""
      }`}
    >
      {visibleDimensions.map((dim) => {
        const marker = dim.marker!;
        const isDragging = drag?.dimensionId === dim.id && drag.moved;
        const x = isDragging ? drag.previewX : marker.x;
        const y = isDragging ? drag.previewY : marker.y;
        const { px, py } = normalizedToPixel(x, y, width, height);
        const isSelected = dim.id === selectedDimensionId;
        const tol = formatTolerance(dim.upperTol, dim.lowerTol);
        const tooltip = [
          `#${dim.balloonNumber}`,
          dim.name || "Untitled Dimension",
          dim.nominal ? `${dim.nominal}${tol ? ` ${tol}` : ""} ${dim.unit}` : "",
        ]
          .filter(Boolean)
          .join(" — ");

        return (
          <button
            key={dim.id}
            type="button"
            title={tooltip}
            aria-label={`Dimension balloon ${dim.balloonNumber}`}
            onPointerDown={(e) => handlePinPointerDown(e, dim)}
            onPointerMove={handlePinPointerMove}
            onPointerUp={handlePinPointerUp}
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${px}px`,
              top: `${py}px`,
              transform: "translate(-50%, -50%)",
            }}
            className={`absolute flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shadow-md transition-transform ${
              isSelected
                ? "z-30 scale-110 border-white bg-blue-600 text-white ring-4 ring-blue-500/40"
                : "z-20 border-white bg-rose-600 text-white hover:scale-105 hover:bg-rose-500"
            } ${
              placingDimensionId
                ? "pointer-events-none opacity-75"
                : isDragging
                  ? "cursor-grabbing"
                  : "cursor-grab"
            }`}
          >
            {dim.balloonNumber}
          </button>
        );
      })}
    </div>
  );
}
