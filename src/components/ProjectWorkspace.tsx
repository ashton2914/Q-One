import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpToLine,
  Box,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileText,
  GitBranchPlus,
  Maximize2,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  canReparentPart,
  layoutPartTree,
  PART_CARD_HEIGHT,
  PART_CARD_WIDTH,
} from "../lib/partTree";
import type { DrawingEntry, Part, ProjectData } from "../types/project";

export interface ProjectWorkspaceProps {
  project: ProjectData;
  selectedPartId: string | null;
  onSelectPart: (partId: string | null) => void;
  onRenameProject: (name: string) => void;
  onAddPart: (parentId: string | null) => void;
  onUpdatePart: (partId: string, patch: Partial<Part>) => void;
  onReparentPart: (partId: string, newParentId: string | null) => void;
  onDeletePart: (partId: string) => void;
  onAttachPdf: (partId: string) => void;
  onDetachPdf: (partId: string, drawingId: string) => void;
  onOpenDrawing: (drawingId: string) => void;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

export function ProjectWorkspace({
  project,
  selectedPartId,
  onSelectPart,
  onRenameProject,
  onAddPart,
  onUpdatePart,
  onReparentPart,
  onDeletePart,
  onAttachPdf,
  onDetachPdf,
  onOpenDrawing,
}: ProjectWorkspaceProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const panRef = useRef<PanState | null>(null);

  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [draggingPartId, setDraggingPartId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | "__root__" | null>(
    null,
  );

  const drawingsById = useMemo(
    () => new Map<string, DrawingEntry>(project.drawings.map((d) => [d.id, d])),
    [project.drawings],
  );

  const dimCountByDrawing = useMemo(() => {
    const map = new Map<string, number>();
    for (const dim of project.dimensions) {
      const id = dim.drawingId ?? dim.marker?.drawingId ?? null;
      if (id) {
        map.set(id, (map.get(id) ?? 0) + 1);
      }
    }
    return map;
  }, [project.dimensions]);

  const layout = useMemo(
    () => layoutPartTree(project.parts, collapsedIds),
    [project.parts, collapsedIds],
  );

  const selectedPart =
    project.parts.find((p) => p.id === selectedPartId) ?? null;

  // Cmd/Ctrl + wheel zoom on the BOM canvas
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const next = Math.min(
        2,
        Math.max(0.4, Math.round((zoomRef.current + delta) * 100) / 100),
      );
      setZoom(next);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const toggleCollapse = (partId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
      }
      return next;
    });
  };

  const handleFitCanvas = () => {
    if (!viewportRef.current || layout.width === 0 || layout.height === 0) {
      setZoom(1);
      return;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    const fit = Math.min(
      (rect.width - 32) / layout.width,
      (rect.height - 32) / layout.height,
      1,
    );
    setZoom(Math.min(2, Math.max(0.4, Math.round(fit * 100) / 100)));
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !viewportRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-part-card='true']")) return;
    const el = viewportRef.current;
    el.setPointerCapture(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
    };
    setIsPanning(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const el = viewportRef.current;
    if (!pan || !el || pan.pointerId !== e.pointerId) return;
    el.scrollLeft = Math.max(0, pan.startScrollLeft - (e.clientX - pan.startClientX));
    el.scrollTop = Math.max(0, pan.startScrollTop - (e.clientY - pan.startClientY));
  };

  const stopCanvasPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
    setIsPanning(false);
  };

  const handleDragStart = (e: React.DragEvent, partId: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", partId);
    setDraggingPartId(partId);
  };

  const handleDragEnd = () => {
    setDraggingPartId(null);
    setDropTargetId(null);
  };

  const handleCardDragOver = (e: React.DragEvent, targetPartId: string) => {
    if (!draggingPartId) return;
    if (!canReparentPart(project.parts, draggingPartId, targetPartId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetId !== targetPartId) {
      setDropTargetId(targetPartId);
    }
  };

  const handleCardDrop = (e: React.DragEvent, targetPartId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggingPartId || e.dataTransfer.getData("text/plain");
    if (sourceId && canReparentPart(project.parts, sourceId, targetPartId)) {
      onReparentPart(sourceId, targetPartId);
      setCollapsedIds((prev) => {
        if (!prev.has(targetPartId)) return prev;
        const next = new Set(prev);
        next.delete(targetPartId);
        return next;
      });
    }
    setDraggingPartId(null);
    setDropTargetId(null);
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = draggingPartId || e.dataTransfer.getData("text/plain");
    if (sourceId) {
      onReparentPart(sourceId, null);
    }
    setDraggingPartId(null);
    setDropTargetId(null);
  };

  const draggingPart = draggingPartId
    ? project.parts.find((p) => p.id === draggingPartId) ?? null
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-900">
      {/* Top Project Bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950/90 px-3 text-xs text-neutral-300">
        <div className="flex items-center gap-3">
          <input
            type="text"
            aria-label="Project name"
            value={project.name}
            onChange={(e) => onRenameProject(e.target.value)}
            className="w-52 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-semibold text-neutral-100 hover:border-neutral-800 focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => onAddPart(null)}
            className="inline-flex items-center gap-1.5 rounded bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-950 hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Part
          </button>

          <span className="hidden text-[11px] text-neutral-500 sm:inline">
            {project.parts.length} {project.parts.length === 1 ? "part" : "parts"} ·{" "}
            {project.drawings.length}{" "}
            {project.drawings.length === 1 ? "drawing" : "drawings"} ·{" "}
            {project.dimensions.length}{" "}
            {project.dimensions.length === 1 ? "dimension" : "dimensions"}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded bg-neutral-900 px-1 py-0.5 ring-1 ring-neutral-800">
          <button
            type="button"
            disabled={zoom <= 0.4}
            onClick={() =>
              setZoom((z) => Math.max(0.4, Math.round((z - 0.15) * 100) / 100))
            }
            aria-label="Zoom out BOM"
            className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center font-mono text-[11px] text-neutral-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            disabled={zoom >= 2}
            onClick={() =>
              setZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))
            }
            aria-label="Zoom in BOM"
            className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitCanvas}
            title="Fit BOM tree to viewport"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-neutral-800"
          >
            <Maximize2 className="h-3 w-3" />
            Fit
          </button>
        </div>
      </div>

      {/* Main Split: Interactive Node Tree Canvas + Right Part Inspector Drawer */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {draggingPart && draggingPart.parentId !== null && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTargetId("__root__");
              }}
              onDragLeave={() => {
                if (dropTargetId === "__root__") setDropTargetId(null);
              }}
              onDrop={handleRootDrop}
              className={`z-30 flex items-center justify-center gap-2 border-b px-4 py-2 text-xs font-medium transition-colors ${
                dropTargetId === "__root__"
                  ? "border-blue-500 bg-blue-600/25 text-blue-100"
                  : "border-neutral-700 bg-neutral-950/90 text-neutral-300"
              }`}
            >
              <ArrowUpToLine className="h-3.5 w-3.5" />
              Drop "{draggingPart.name}" here to promote to top-level Root Part
            </div>
          )}

          <div
            ref={viewportRef}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={stopCanvasPan}
            onPointerCancel={stopCanvasPan}
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
            className={`relative flex-1 overflow-auto ${
              isPanning ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            {project.parts.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="max-w-sm rounded-xl border border-neutral-800 bg-neutral-950/90 p-6 text-center shadow-xl">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300">
                    <Box className="h-5 w-5" />
                  </div>
                  <h2 className="text-sm font-semibold text-neutral-100">
                    Start Your Assembly BOM
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                    Add your first part, nest sub-parts by clicking{" "}
                    <span className="font-medium text-neutral-200">+ Sub-part</span>{" "}
                    or dragging cards onto each other, and attach PDF drawings to
                    any part.
                  </p>
                  <button
                    type="button"
                    onClick={() => onAddPart(null)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-950 hover:bg-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add First Part
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  width: Math.max(layout.width * zoom, 600),
                  height: Math.max(layout.height * zoom, 420),
                }}
                className="relative"
              >
                <div
                  style={{
                    width: layout.width,
                    height: layout.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "0 0",
                  }}
                  className="relative"
                >
                  {/* SVG Cubic Bézier Edges */}
                  <svg
                    width={layout.width}
                    height={layout.height}
                    className="pointer-events-none absolute inset-0"
                  >
                    {layout.edges.map((edge) => {
                      const midX = (edge.x1 + edge.x2) / 2;
                      const d = `M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`;
                      const isHighlighted =
                        edge.fromId === selectedPartId ||
                        edge.toId === selectedPartId;
                      return (
                        <path
                          key={edge.id}
                          d={d}
                          fill="none"
                          stroke={isHighlighted ? "#3b82f6" : "#525252"}
                          strokeWidth={isHighlighted ? 2 : 1.5}
                        />
                      );
                    })}
                  </svg>

                  {/* Interactive Part Cards */}
                  {layout.nodes.map((node) => {
                    const { part } = node;
                    const isSelected = part.id === selectedPartId;
                    const isCollapsed = collapsedIds.has(part.id);
                    const isDropTarget = dropTargetId === part.id;
                    const isDraggingThis = draggingPartId === part.id;
                    const attachedDrawings = part.drawingIds
                      .map((id) => drawingsById.get(id))
                      .filter((d): d is DrawingEntry => Boolean(d));
                    const totalDims = part.drawingIds.reduce(
                      (sum, id) => sum + (dimCountByDrawing.get(id) ?? 0),
                      0,
                    );

                    return (
                      <div
                        key={part.id}
                        data-part-card="true"
                        draggable
                        onDragStart={(e) => handleDragStart(e, part.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleCardDragOver(e, part.id)}
                        onDragLeave={() => {
                          if (dropTargetId === part.id) setDropTargetId(null);
                        }}
                        onDrop={(e) => handleCardDrop(e, part.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPart(part.id);
                        }}
                        style={{
                          left: node.x,
                          top: node.y,
                          width: PART_CARD_WIDTH,
                          height: PART_CARD_HEIGHT,
                        }}
                        className={`group absolute flex cursor-pointer flex-col justify-between rounded-lg border p-2.5 shadow-lg transition-all select-none ${
                          isDropTarget
                            ? "border-blue-400 bg-blue-950/50 ring-2 ring-blue-500/60"
                            : isSelected
                              ? "border-neutral-400 bg-neutral-900 ring-2 ring-blue-500/40"
                              : "border-neutral-700/90 bg-neutral-950/95 hover:border-neutral-500"
                        } ${isDraggingThis ? "opacity-45" : ""}`}
                      >
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Box className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                              <span className="truncate text-xs font-semibold text-neutral-100">
                                {part.name.trim() || "Untitled Part"}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-neutral-400">
                              {[part.partNumber.trim(), part.revision.trim()]
                                .filter(Boolean)
                                .join(" · ") || "Drag onto another part to nest"}
                            </div>
                          </div>

                          {node.hasChildren && (
                            <button
                              type="button"
                              title={
                                isCollapsed
                                  ? `Expand ${node.childCount} sub-parts`
                                  : "Collapse sub-parts"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapse(part.id);
                              }}
                              className="inline-flex items-center gap-0.5 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-white"
                            >
                              {isCollapsed ? (
                                <>
                                  <ChevronRight className="h-3 w-3" />
                                  <span>{node.childCount}</span>
                                </>
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>

                        {/* Middle: attached PDF chips */}
                        <div className="flex items-center gap-1 overflow-hidden">
                          {attachedDrawings.length === 0 ? (
                            <span className="text-[10px] italic text-neutral-500">
                              No drawing attached
                            </span>
                          ) : (
                            <>
                              {attachedDrawings.slice(0, 2).map((drw) => (
                                <button
                                  key={drw.id}
                                  type="button"
                                  title={`Open "${drw.filename}" in Drawing`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenDrawing(drw.id);
                                  }}
                                  className="inline-flex max-w-[110px] items-center gap-1 rounded bg-neutral-800/90 px-1.5 py-0.5 text-[10px] text-neutral-200 ring-1 ring-neutral-700 hover:bg-blue-600/30 hover:text-white hover:ring-blue-500/60"
                                >
                                  <FileText className="h-2.5 w-2.5 shrink-0 text-emerald-400" />
                                  <span className="truncate">{drw.filename}</span>
                                </button>
                              ))}
                              {attachedDrawings.length > 2 && (
                                <span className="text-[10px] text-neutral-400">
                                  +{attachedDrawings.length - 2}
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Footer: dimension count + quick actions */}
                        <div className="flex items-center justify-between border-t border-neutral-800/90 pt-1.5 text-[10px]">
                          <span className="font-mono text-neutral-500">
                            {totalDims} {totalDims === 1 ? "dim" : "dims"}
                          </span>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              title="Attach PDF drawing"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAttachPdf(part.id);
                              }}
                              className="inline-flex items-center gap-0.5 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-700 hover:text-white"
                            >
                              <FilePlus2 className="h-3 w-3" />
                              PDF
                            </button>
                            <button
                              type="button"
                              title="Add sub-part"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollapsedIds((prev) => {
                                  if (!prev.has(part.id)) return prev;
                                  const next = new Set(prev);
                                  next.delete(part.id);
                                  return next;
                                });
                                onAddPart(part.id);
                              }}
                              className="inline-flex items-center gap-0.5 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-700 hover:text-white"
                            >
                              <GitBranchPlus className="h-3 w-3" />
                              Sub
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Part Inspector Drawer */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950 text-xs">
          <div className="border-b border-neutral-800 px-3 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Part Inspector
            </h2>
          </div>

          {!selectedPart ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-neutral-500">
              Select a part on the canvas to edit its metadata, manage attached
              drawings, or add sub-parts.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-400">
                    Part Name
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={selectedPart.name}
                    placeholder="e.g. Metal C-Cover"
                    onChange={(e) =>
                      onUpdatePart(selectedPart.id, { name: e.target.value })
                    }
                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-neutral-400">
                      Part Number
                    </label>
                    <input
                      type="text"
                      value={selectedPart.partNumber}
                      placeholder="e.g. M1292339"
                      onChange={(e) =>
                        onUpdatePart(selectedPart.id, {
                          partNumber: e.target.value,
                        })
                      }
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-neutral-400">
                      Revision
                    </label>
                    <input
                      type="text"
                      value={selectedPart.revision}
                      placeholder="e.g. Rev B"
                      onChange={(e) =>
                        onUpdatePart(selectedPart.id, {
                          revision: e.target.value,
                        })
                      }
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-neutral-400">
                    Notes
                  </label>
                  <textarea
                    rows={2}
                    value={selectedPart.notes}
                    placeholder="Material, process, supplier notes..."
                    onChange={(e) =>
                      onUpdatePart(selectedPart.id, { notes: e.target.value })
                    }
                    className="w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
                  />
                </div>

                {/* Attached PDF Drawings */}
                <div className="border-t border-neutral-800 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                      Drawings ({selectedPart.drawingIds.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => onAttachPdf(selectedPart.id)}
                      className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700 hover:text-white"
                    >
                      <FilePlus2 className="h-3 w-3" />
                      Attach PDF
                    </button>
                  </div>

                  {selectedPart.drawingIds.length === 0 ? (
                    <div className="rounded-md border border-dashed border-neutral-800 p-4 text-center text-[11px] text-neutral-500">
                      No PDF drawings attached to this part yet.
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {selectedPart.drawingIds.map((drwId) => {
                        const drw = drawingsById.get(drwId);
                        if (!drw) return null;
                        const count = dimCountByDrawing.get(drw.id) ?? 0;
                        return (
                          <li
                            key={drw.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-900/80 px-2.5 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                <span className="truncate font-mono text-[11px] text-neutral-100">
                                  {drw.filename}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-neutral-500">
                                {drw.pageCount}{" "}
                                {drw.pageCount === 1 ? "page" : "pages"} ·{" "}
                                {count} {count === 1 ? "dimension" : "dimensions"}
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                title="Open in Drawing module"
                                onClick={() => onOpenDrawing(drw.id)}
                                className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-blue-600 hover:text-white"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Open
                              </button>
                              <button
                                type="button"
                                title="Remove drawing"
                                onClick={() =>
                                  onDetachPdf(selectedPart.id, drw.id)
                                }
                                className="rounded p-1 text-neutral-500 hover:bg-rose-950 hover:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-neutral-800 p-3">
                <button
                  type="button"
                  onClick={() => onDeletePart(selectedPart.id)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-neutral-400 hover:bg-rose-950/70 hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Part
                </button>

                <button
                  type="button"
                  onClick={() => onAddPart(selectedPart.id)}
                  className="inline-flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700"
                >
                  <GitBranchPlus className="h-3.5 w-3.5" />
                  Add Sub-part
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
