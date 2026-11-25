import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpToLine,
  Box,
  Check,
  ExternalLink,
  FilePlus2,
  FileText,
  GitBranchPlus,
  Maximize2,
  Pencil,
  Plus,
  Trash2,
  Unlink,
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

type PointerDragState =
  | {
      kind: "card";
      partId: string;
      startClientX: number;
      startClientY: number;
      clientX: number;
      clientY: number;
      active: boolean;
    }
  | {
      kind: "wire";
      direction: "from-parent" | "from-child";
      sourcePartId: string;
      originCanvasX: number;
      originCanvasY: number;
      cursorCanvasX: number;
      cursorCanvasY: number;
    };

const CARD_DRAG_THRESHOLD_PX = 6;
const EMPTY_COLLAPSED = new Set<string>();

interface InPlacePartEditorProps {
  part: Part;
  parentName: string | null;
  attachedDrawings: DrawingEntry[];
  dimCountByDrawing: Map<string, number>;
  x: number;
  y: number;
  onUpdate: (patch: Partial<Part>) => void;
  onDone: () => void;
  onUnlink: () => void;
  onAttachPdf: () => void;
  onDetachPdf: (drawingId: string) => void;
  onOpenDrawing: (drawingId: string) => void;
  onDelete: () => void;
}

function InPlacePartEditor({
  part,
  parentName,
  attachedDrawings,
  dimCountByDrawing,
  x,
  y,
  onUpdate,
  onDone,
  onUnlink,
  onAttachPdf,
  onDetachPdf,
  onOpenDrawing,
  onDelete,
}: InPlacePartEditorProps) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = nameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [part.id]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    }
  };

  return (
    <div
      data-part-card-id={part.id}
      data-part-editor="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      style={{
        left: x,
        top: y,
        width: 296,
      }}
      className="absolute z-40 rounded-lg border border-neutral-500 bg-neutral-950 p-3 text-xs shadow-2xl ring-2 ring-blue-500/40"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-neutral-200">
          <Box className="h-3.5 w-3.5 text-blue-400" />
          <span className="font-semibold">Edit Part</span>
        </div>

        {parentName && (
          <button
            type="button"
            tabIndex={-1}
            title={`Disconnect from "${parentName}"`}
            onClick={onUnlink}
            className="inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-rose-950 hover:text-rose-300"
          >
            <Unlink className="h-2.5 w-2.5" />
            Unlink
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-[11px] text-neutral-400">
            Part Name
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={part.name}
            placeholder="e.g. Metal C-Cover"
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="mb-1 block text-[11px] text-neutral-400">
              Part Number
            </label>
            <input
              type="text"
              value={part.partNumber}
              placeholder="e.g. M1292339"
              onChange={(e) => onUpdate({ partNumber: e.target.value })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-neutral-400">
              Revision
            </label>
            <input
              type="text"
              value={part.revision}
              placeholder="e.g. Rev B"
              onChange={(e) => onUpdate({ revision: e.target.value })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-neutral-400">
            Notes
          </label>
          <input
            type="text"
            value={part.notes}
            placeholder="Material, process, supplier notes..."
            onChange={(e) => onUpdate({ notes: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
          />
        </div>

        {/* Inline Attached Drawings */}
        <div className="border-t border-neutral-800 pt-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Drawings ({attachedDrawings.length})
            </span>
            <button
              type="button"
              tabIndex={-1}
              onClick={onAttachPdf}
              className="inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-200 hover:bg-neutral-700 hover:text-white"
            >
              <FilePlus2 className="h-3 w-3" />
              Attach PDF
            </button>
          </div>

          {attachedDrawings.length === 0 ? (
            <div className="rounded border border-dashed border-neutral-800 py-2 text-center text-[10px] text-neutral-500">
              No PDF attached
            </div>
          ) : (
            <ul className="max-h-28 space-y-1 overflow-y-auto">
              {attachedDrawings.map((drw) => {
                const count = dimCountByDrawing.get(drw.id) ?? 0;
                return (
                  <li
                    key={drw.id}
                    className="flex items-center justify-between gap-1.5 rounded border border-neutral-800 bg-neutral-900/90 px-2 py-1"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3 shrink-0 text-emerald-400" />
                        <span className="truncate font-mono text-[10px] text-neutral-100">
                          {drw.filename}
                        </span>
                      </div>
                      <div className="text-[9px] text-neutral-500">
                        {drw.pageCount}p · {count} dims
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        tabIndex={-1}
                        title="Open in Drawing"
                        onClick={() => onOpenDrawing(drw.id)}
                        className="rounded bg-neutral-800 p-1 text-neutral-300 hover:bg-blue-600 hover:text-white"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        title="Remove drawing"
                        onClick={() => onDetachPdf(drw.id)}
                        className="rounded p-1 text-neutral-500 hover:bg-rose-950 hover:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-neutral-800 pt-2">
        <button
          type="button"
          tabIndex={-1}
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-rose-950/70 hover:text-rose-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>

        <button
          type="button"
          tabIndex={-1}
          title="Done (⌘/Ctrl+Enter)"
          onClick={onDone}
          className="inline-flex items-center gap-1 rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-white"
        >
          <Check className="h-3.5 w-3.5" />
          Done
        </button>
      </div>
    </div>
  );
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
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const rootDropZoneRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<PanState | null>(null);
  const prevPartsCountRef = useRef<number>(project.parts.length);

  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<
    string | "__root__" | null
  >(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Auto-open newly added Part card in-place for immediate naming
  useEffect(() => {
    if (project.parts.length > prevPartsCountRef.current && selectedPartId) {
      setEditingPartId(selectedPartId);
    } else if (
      editingPartId &&
      !project.parts.some((p) => p.id === editingPartId)
    ) {
      setEditingPartId(null);
    }
    prevPartsCountRef.current = project.parts.length;
  }, [project.parts, selectedPartId, editingPartId]);

  const drawingsById = useMemo(
    () => new Map<string, DrawingEntry>(project.drawings.map((d) => [d.id, d])),
    [project.drawings],
  );

  const partsById = useMemo(
    () => new Map<string, Part>(project.parts.map((p) => [p.id, p])),
    [project.parts],
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
    () => layoutPartTree(project.parts, EMPTY_COLLAPSED),
    [project.parts],
  );

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

  // Global pointer tracking for reliable card drag-to-reparent & live Bézier wire connecting
  const pointerDragRef = useRef<PointerDragState | null>(null);
  pointerDragRef.current = pointerDrag;
  const partsRef = useRef<Part[]>(project.parts);
  partsRef.current = project.parts;

  const clientToCanvasPoint = (clientX: number, clientY: number) => {
    const inner = canvasInnerRef.current;
    if (!inner) return { x: 0, y: 0 };
    const rect = inner.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoomRef.current,
      y: (clientY - rect.top) / zoomRef.current,
    };
  };

  const findPartIdAtClientPoint = (
    clientX: number,
    clientY: number,
  ): string | null => {
    const elements = document.elementsFromPoint(clientX, clientY);
    for (const el of elements) {
      const card = (el as HTMLElement).closest?.(
        "[data-part-card-id]",
      ) as HTMLElement | null;
      if (card) {
        return card.dataset.partCardId ?? null;
      }
    }
    return null;
  };

  const isOverRootZone = (clientX: number, clientY: number): boolean => {
    const zone = rootDropZoneRef.current;
    if (!zone) return false;
    const rect = zone.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  };

  useEffect(() => {
    if (!pointerDrag) return;

    const handleMove = (e: PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current) return;

      if (current.kind === "card") {
        const active =
          current.active ||
          Math.hypot(
            e.clientX - current.startClientX,
            e.clientY - current.startClientY,
          ) >= CARD_DRAG_THRESHOLD_PX;
        setPointerDrag({
          ...current,
          clientX: e.clientX,
          clientY: e.clientY,
          active,
        });
        if (!active) return;

        if (isOverRootZone(e.clientX, e.clientY)) {
          setHoveredTargetId("__root__");
          return;
        }
        const hitId = findPartIdAtClientPoint(e.clientX, e.clientY);
        if (
          hitId &&
          hitId !== current.partId &&
          canReparentPart(partsRef.current, current.partId, hitId)
        ) {
          setHoveredTargetId(hitId);
        } else {
          setHoveredTargetId(null);
        }
      } else {
        const pt = clientToCanvasPoint(e.clientX, e.clientY);
        setPointerDrag({
          ...current,
          cursorCanvasX: pt.x,
          cursorCanvasY: pt.y,
        });
        const hitId = findPartIdAtClientPoint(e.clientX, e.clientY);
        if (!hitId || hitId === current.sourcePartId) {
          setHoveredTargetId(null);
          return;
        }
        const valid =
          current.direction === "from-parent"
            ? canReparentPart(partsRef.current, hitId, current.sourcePartId)
            : canReparentPart(partsRef.current, current.sourcePartId, hitId);
        setHoveredTargetId(valid ? hitId : null);
      }
    };

    const handleUp = (e: PointerEvent) => {
      const current = pointerDragRef.current;
      if (!current) return;

      if (current.kind === "card") {
        if (!current.active) {
          onSelectPart(current.partId);
        } else if (isOverRootZone(e.clientX, e.clientY)) {
          const src = partsRef.current.find((p) => p.id === current.partId);
          if (src && src.parentId !== null) {
            onReparentPart(current.partId, null);
          }
        } else {
          const hitId = findPartIdAtClientPoint(e.clientX, e.clientY);
          const src = partsRef.current.find((p) => p.id === current.partId);
          if (
            hitId &&
            src &&
            src.parentId !== hitId &&
            canReparentPart(partsRef.current, current.partId, hitId)
          ) {
            onReparentPart(current.partId, hitId);
          }
        }
      } else {
        const hitId = findPartIdAtClientPoint(e.clientX, e.clientY);
        if (current.direction === "from-parent") {
          if (
            hitId &&
            hitId !== current.sourcePartId &&
            canReparentPart(partsRef.current, hitId, current.sourcePartId)
          ) {
            const child = partsRef.current.find((p) => p.id === hitId);
            if (child && child.parentId !== current.sourcePartId) {
              onReparentPart(hitId, current.sourcePartId);
            }
          }
        } else {
          const src = partsRef.current.find(
            (p) => p.id === current.sourcePartId,
          );
          if (
            hitId &&
            hitId !== current.sourcePartId &&
            canReparentPart(partsRef.current, current.sourcePartId, hitId)
          ) {
            if (src && src.parentId !== hitId) {
              onReparentPart(current.sourcePartId, hitId);
            }
          } else if (!hitId && src && src.parentId !== null) {
            onReparentPart(current.sourcePartId, null);
          }
        }
      }

      setPointerDrag(null);
      setHoveredTargetId(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [pointerDrag !== null, onReparentPart, onSelectPart]);

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
    if (target.closest("[data-part-card-id]")) return;
    if (editingPartId) {
      setEditingPartId(null);
    }
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
    el.scrollLeft = Math.max(
      0,
      pan.startScrollLeft - (e.clientX - pan.startClientX),
    );
    el.scrollTop = Math.max(
      0,
      pan.startScrollTop - (e.clientY - pan.startClientY),
    );
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

  const startCardDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    partId: string,
  ) => {
    if (e.button !== 0 || editingPartId === partId) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-port='true']")) return;
    e.stopPropagation();
    if (editingPartId && editingPartId !== partId) {
      setEditingPartId(null);
    }
    setPointerDrag({
      kind: "card",
      partId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      active: false,
    });
  };

  const startWireDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    direction: "from-parent" | "from-child",
    partId: string,
    originCanvasX: number,
    originCanvasY: number,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (editingPartId) {
      setEditingPartId(null);
    }
    const pt = clientToCanvasPoint(e.clientX, e.clientY);
    setPointerDrag({
      kind: "wire",
      direction,
      sourcePartId: partId,
      originCanvasX,
      originCanvasY,
      cursorCanvasX: pt.x,
      cursorCanvasY: pt.y,
    });
  };

  const activeDraggingCardPart =
    pointerDrag?.kind === "card" && pointerDrag.active
      ? project.parts.find((p) => p.id === pointerDrag.partId) ?? null
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
            {project.parts.length}{" "}
            {project.parts.length === 1 ? "part" : "parts"} ·{" "}
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

      {/* Full-Width Interactive BOM Node Tree Canvas */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeDraggingCardPart && activeDraggingCardPart.parentId !== null && (
          <div
            ref={rootDropZoneRef}
            className={`absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium shadow-xl transition-colors ${
              hoveredTargetId === "__root__"
                ? "border-blue-400 bg-blue-600/90 text-white"
                : "border-neutral-700 bg-neutral-950/95 text-neutral-300"
            }`}
          >
            <ArrowUpToLine className="h-3.5 w-3.5" />
            Drop here to promote "{activeDraggingCardPart.name}" to Root Part
          </div>
        )}

        {pointerDrag?.kind === "wire" && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-blue-500/50 bg-neutral-950/95 px-3.5 py-1 text-[11px] text-blue-200 shadow-xl">
            {pointerDrag.direction === "from-parent"
              ? "Drop wire onto a Part card to attach it as a Sub-part"
              : "Drop wire onto a Parent Part card (or empty space to detach to Root)"}
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
            pointerDrag?.kind === "wire"
              ? "cursor-crosshair"
              : isPanning || activeDraggingCardPart
                ? "cursor-grabbing"
                : "cursor-grab"
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
                  Add parts, double-click or click Edit to edit in-place, drag
                  cards or connection wires to build sub-part hierarchies, and
                  attach PDF drawings.
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
                width: Math.max((layout.width + 120) * zoom, 820),
                height: Math.max((layout.height + 240) * zoom, 560),
              }}
              className="relative"
            >
              <div
                ref={canvasInnerRef}
                style={{
                  width: Math.max(layout.width + 120, 820),
                  height: Math.max(layout.height + 240, 560),
                  transform: `scale(${zoom})`,
                  transformOrigin: "0 0",
                }}
                className="relative"
              >
                {/* SVG Cubic Bézier Edges + Interactive Disconnect + Live Wire Preview */}
                <svg
                  width={Math.max(layout.width + 120, 820)}
                  height={Math.max(layout.height + 240, 560)}
                  className="pointer-events-none absolute inset-0 overflow-visible"
                >
                  {layout.edges.map((edge) => {
                    const midX = (edge.x1 + edge.x2) / 2;
                    const midY = (edge.y1 + edge.y2) / 2;
                    const d = `M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`;
                    const isHovered = hoveredEdgeId === edge.id;
                    const isHighlighted =
                      edge.fromId === selectedPartId ||
                      edge.toId === selectedPartId;
                    return (
                      <g
                        key={edge.id}
                        className="pointer-events-auto cursor-pointer"
                        onMouseEnter={() => setHoveredEdgeId(edge.id)}
                        onMouseLeave={() =>
                          setHoveredEdgeId((prev) =>
                            prev === edge.id ? null : prev,
                          )
                        }
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoveredEdgeId(null);
                          onReparentPart(edge.toId, null);
                        }}
                      >
                        <title>Click to disconnect link</title>
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={16}
                        />
                        <path
                          d={d}
                          fill="none"
                          stroke={
                            isHovered
                              ? "#f43f5e"
                              : isHighlighted
                                ? "#3b82f6"
                                : "#525252"
                          }
                          strokeWidth={isHovered || isHighlighted ? 2.2 : 1.5}
                        />
                        {isHovered && (
                          <g transform={`translate(${midX}, ${midY})`}>
                            <circle
                              r={9}
                              fill="#171717"
                              stroke="#f43f5e"
                              strokeWidth={1.5}
                            />
                            <path
                              d="M -3 -3 L 3 3 M 3 -3 L -3 3"
                              stroke="#fda4af"
                              strokeWidth={1.6}
                              strokeLinecap="round"
                            />
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {pointerDrag?.kind === "wire" &&
                    (() => {
                      const x1 = pointerDrag.originCanvasX;
                      const y1 = pointerDrag.originCanvasY;
                      const x2 = pointerDrag.cursorCanvasX;
                      const y2 = pointerDrag.cursorCanvasY;
                      const dx = Math.max(48, Math.abs(x2 - x1) * 0.5);
                      const c1x =
                        pointerDrag.direction === "from-parent"
                          ? x1 + dx
                          : x1 - dx;
                      const c2x =
                        pointerDrag.direction === "from-parent"
                          ? x2 - dx
                          : x2 + dx;
                      const d = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
                      return (
                        <g>
                          <path
                            d={d}
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                          />
                          <circle cx={x2} cy={y2} r={4} fill="#60a5fa" />
                        </g>
                      );
                    })()}
                </svg>

                {/* Interactive Part Cards & In-Place Editor */}
                {layout.nodes.map((node) => {
                  const { part } = node;
                  const attachedDrawings = part.drawingIds
                    .map((id) => drawingsById.get(id))
                    .filter((d): d is DrawingEntry => Boolean(d));

                  if (editingPartId === part.id) {
                    const parentName = part.parentId
                      ? partsById.get(part.parentId)?.name.trim() ||
                        "Parent Part"
                      : null;
                    return (
                      <InPlacePartEditor
                        key={part.id}
                        part={part}
                        parentName={parentName}
                        attachedDrawings={attachedDrawings}
                        dimCountByDrawing={dimCountByDrawing}
                        x={node.x}
                        y={node.y}
                        onUpdate={(patch) => onUpdatePart(part.id, patch)}
                        onDone={() => setEditingPartId(null)}
                        onUnlink={() => onReparentPart(part.id, null)}
                        onAttachPdf={() => onAttachPdf(part.id)}
                        onDetachPdf={(drwId) => onDetachPdf(part.id, drwId)}
                        onOpenDrawing={onOpenDrawing}
                        onDelete={() => {
                          setEditingPartId(null);
                          onDeletePart(part.id);
                        }}
                      />
                    );
                  }

                  const isSelected = part.id === selectedPartId;
                  const isDropTarget = hoveredTargetId === part.id;
                  const isDraggingThis =
                    pointerDrag?.kind === "card" &&
                    pointerDrag.active &&
                    pointerDrag.partId === part.id;
                  const totalDims = part.drawingIds.reduce(
                    (sum, id) => sum + (dimCountByDrawing.get(id) ?? 0),
                    0,
                  );

                  const leftPortX = node.x;
                  const rightPortX = node.x + PART_CARD_WIDTH;
                  const portY = node.y + PART_CARD_HEIGHT / 2;

                  return (
                    <div
                      key={part.id}
                      data-part-card-id={part.id}
                      onPointerDown={(e) => startCardDrag(e, part.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onSelectPart(part.id);
                        setEditingPartId(part.id);
                      }}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: PART_CARD_WIDTH,
                        height: PART_CARD_HEIGHT,
                      }}
                      className={`group absolute flex cursor-grab flex-col justify-between rounded-lg border p-2.5 shadow-lg transition-shadow select-none ${
                        isDropTarget
                          ? "border-blue-400 bg-blue-950/50 ring-2 ring-blue-500/70"
                          : isSelected
                            ? "border-neutral-400 bg-neutral-900 ring-2 ring-blue-500/40"
                            : "border-neutral-700/90 bg-neutral-950/95 hover:border-neutral-500"
                      } ${isDraggingThis ? "opacity-40" : ""}`}
                    >
                      {/* Left Port */}
                      <button
                        type="button"
                        data-port="true"
                        title="Drag wire to attach under a Parent Part (or drop on empty space to detach)"
                        onPointerDown={(e) =>
                          startWireDrag(
                            e,
                            "from-child",
                            part.id,
                            leftPortX,
                            portY,
                          )
                        }
                        className={`absolute -left-2 top-1/2 z-20 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition-transform hover:scale-125 ${
                          part.parentId
                            ? "border-blue-400 bg-neutral-950"
                            : "border-neutral-500 bg-neutral-900 opacity-75 group-hover:opacity-100"
                        }`}
                      />

                      {/* Right Port */}
                      <button
                        type="button"
                        data-port="true"
                        title="Drag wire onto another Part to make it a Sub-part"
                        onPointerDown={(e) =>
                          startWireDrag(
                            e,
                            "from-parent",
                            part.id,
                            rightPortX,
                            portY,
                          )
                        }
                        className={`absolute -right-2 top-1/2 z-20 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition-transform hover:scale-125 ${
                          node.hasChildren
                            ? "border-blue-400 bg-blue-500"
                            : "border-neutral-500 bg-neutral-900 opacity-75 group-hover:opacity-100"
                        }`}
                      />

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
                              .join(" · ") || "Double-click to edit"}
                          </div>
                        </div>

                        <button
                          type="button"
                          title="Edit part in-place"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPart(part.id);
                            setEditingPartId(part.id);
                          }}
                          className="shrink-0 rounded p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-800 hover:text-neutral-100 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
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

        {/* Floating Ghost Preview while dragging a Part card */}
        {pointerDrag?.kind === "card" &&
          pointerDrag.active &&
          activeDraggingCardPart && (
            <div
              style={{
                left: pointerDrag.clientX + 12,
                top: pointerDrag.clientY + 12,
              }}
              className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-md border border-blue-400/80 bg-neutral-900/95 px-3 py-1.5 text-xs font-medium text-neutral-100 shadow-2xl"
            >
              <Box className="h-3.5 w-3.5 text-blue-400" />
              <span>{activeDraggingCardPart.name.trim() || "Part"}</span>
            </div>
          )}
      </div>
    </div>
  );
}
