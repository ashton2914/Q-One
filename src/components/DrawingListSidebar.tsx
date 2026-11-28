import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpZA,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FilePlus2,
  FileText,
  GripVertical,
  Layers,
  Network,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { DrawingEntry, Part } from "../types/project";
import {
  hasAnnotationRevisionNameCollision,
  resolveLatestAnnotationRevisionId,
} from "../lib/annotationRevisions";
import {
  reorderDrawingIds,
  sortDrawings,
  type DrawingSortMode,
} from "../lib/partTree";
import { FloatingMenu } from "./ui/FloatingMenu";

export interface DrawingListSidebarProps {
  activePart: Part | null;
  drawings: DrawingEntry[];
  activeDrawingId: string | null;
  activeAnnotationRevisionId: string | null;
  latestDrawingId: string | null;
  dimCountByRevision: Map<string, number>;
  onUploadPdf: () => void;
  onSelectDrawing: (drawingId: string, revisionId?: string | null) => void;
  onUpdateDrawingVersion: (drawingId: string, version: string) => void;
  onReorderDrawings: (orderedDrawingIds: string[]) => void;
  onMarkLatest: (drawingId: string) => void;
  onRemoveDrawing: (drawingId: string) => void;
  copiedReviewName: string | null;
  onCopyAnnotationRevision: (drawingId: string, revisionId: string) => void;
  onPasteAnnotationRevision: (targetDrawingId: string) => void;
  onDuplicateAnnotationRevision: (
    drawingId: string,
    sourceRevisionId: string,
  ) => void;
  onCreateBlankAnnotationRevision: (drawingId: string) => void;
  onRenameAnnotationRevision: (
    drawingId: string,
    revisionId: string,
    name: string,
  ) => void;
  onMarkLatestAnnotationRevision: (
    drawingId: string,
    revisionId: string,
  ) => void;
  onDeleteAnnotationRevision: (drawingId: string, revisionId: string) => void;
  onGoToProject: () => void;
}

export function DrawingListSidebar({
  activePart,
  drawings,
  activeDrawingId,
  activeAnnotationRevisionId,
  latestDrawingId,
  dimCountByRevision,
  onUploadPdf,
  onSelectDrawing,
  onUpdateDrawingVersion,
  onReorderDrawings,
  onMarkLatest,
  onRemoveDrawing,
  copiedReviewName,
  onCopyAnnotationRevision,
  onPasteAnnotationRevision,
  onDuplicateAnnotationRevision,
  onCreateBlankAnnotationRevision,
  onRenameAnnotationRevision,
  onMarkLatestAnnotationRevision,
  onDeleteAnnotationRevision,
  onGoToProject,
}: DrawingListSidebarProps) {
  const prevCountRef = useRef<number>(drawings.length);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const revInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const itemElsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const versionClickTimerRef = useRef<number | null>(null);
  const revClickTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef<boolean>(false);
  const [sortMode, setSortMode] = useState<DrawingSortMode>("custom");
  const [expandedDrawingIds, setExpandedDrawingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [editingDrawingId, setEditingDrawingId] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState<string>("");
  const [editingRevision, setEditingRevision] = useState<{
    drawingId: string;
    revisionId: string;
  } | null>(null);
  const [draftRevisionName, setDraftRevisionName] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<
    | {
        kind: "drawing";
        drawingId: string;
        x: number;
        y: number;
      }
    | {
        kind: "revision";
        drawingId: string;
        revisionId: string;
        x: number;
        y: number;
      }
    | null
  >(null);
  const [dragState, setDragState] = useState<{
    sourceId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    targetSlot: number;
  } | null>(null);
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const displayedDrawings = useMemo(
    () => sortDrawings(drawings, sortMode),
    [drawings, sortMode],
  );
  const displayedDrawingsRef = useRef(displayedDrawings);
  displayedDrawingsRef.current = displayedDrawings;

  const startEditingVersion = (drw: DrawingEntry) => {
    if (versionClickTimerRef.current !== null) {
      window.clearTimeout(versionClickTimerRef.current);
      versionClickTimerRef.current = null;
    }
    setContextMenu(null);
    setEditingDrawingId(drw.id);
    setDraftVersion(drw.version ?? "");
  };

  const commitEditingVersion = (drawingId: string) => {
    setEditingDrawingId(null);
    onUpdateDrawingVersion(drawingId, draftVersion);
  };

  const cancelEditingVersion = () => {
    setEditingDrawingId(null);
  };

  const toggleDrawingExpanded = (drawingId: string) => {
    setExpandedDrawingIds((prev) => {
      const next = new Set(prev);
      if (next.has(drawingId)) {
        next.delete(drawingId);
      } else {
        next.add(drawingId);
      }
      return next;
    });
  };

  const ensureDrawingExpanded = (drawingId: string) => {
    setExpandedDrawingIds((prev) => {
      if (prev.has(drawingId)) return prev;
      const next = new Set(prev);
      next.add(drawingId);
      return next;
    });
  };

  const startEditingRevision = (
    drawingId: string,
    revisionId: string,
    currentName: string,
  ) => {
    if (revClickTimerRef.current !== null) {
      window.clearTimeout(revClickTimerRef.current);
      revClickTimerRef.current = null;
    }
    setContextMenu(null);
    setEditingRevision({ drawingId, revisionId });
    setDraftRevisionName(currentName);
  };

  const commitEditingRevision = (drawingId: string, revisionId: string) => {
    setEditingRevision(null);
    if (draftRevisionName.trim()) {
      onRenameAnnotationRevision(drawingId, revisionId, draftRevisionName);
    }
  };

  const cancelEditingRevision = () => {
    setEditingRevision(null);
  };

  // Focus & select inline revision name input when edit mode activates
  useEffect(() => {
    if (!editingRevision) return;
    const key = `${editingRevision.drawingId}::${editingRevision.revisionId}`;
    const input = revInputRefs.current.get(key);
    if (input) {
      input.focus();
      input.select();
    }
  }, [editingRevision]);

  // Auto-edit the version of a newly uploaded drawing
  useEffect(() => {
    if (drawings.length > prevCountRef.current && drawings.length > 0) {
      const newest = drawings[drawings.length - 1];
      setEditingDrawingId(newest.id);
      setDraftVersion(newest.version ?? "");
    }
    prevCountRef.current = drawings.length;
  }, [drawings]);

  // Focus & select inline version input whenever edit mode activates
  useEffect(() => {
    if (!editingDrawingId) return;
    const input = inputRefs.current.get(editingDrawingId);
    if (input) {
      input.focus();
      input.select();
    }
  }, [editingDrawingId]);

  // Dismiss right-click context menu on outside click, Escape, or blur
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  // Clean up any pending single-click timers on unmount
  useEffect(() => {
    return () => {
      if (versionClickTimerRef.current !== null) {
        window.clearTimeout(versionClickTimerRef.current);
      }
      if (revClickTimerRef.current !== null) {
        window.clearTimeout(revClickTimerRef.current);
      }
    };
  }, []);

  // Global pointer tracking for Tauri-safe drag-to-reorder (5px threshold)
  const dragPointerId = dragState?.pointerId ?? null;
  useEffect(() => {
    if (dragPointerId === null) return;

    const computeTargetSlot = (clientY: number): number => {
      const list = displayedDrawingsRef.current;
      let slot = list.length;
      for (let i = 0; i < list.length; i += 1) {
        const el = itemElsRef.current.get(list[i].id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          slot = i;
          break;
        }
      }
      return slot;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const cur = dragStateRef.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      if (!cur.active) {
        const dist = Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY);
        if (dist < 5) return;
        suppressClickRef.current = true;
        if (versionClickTimerRef.current !== null) {
          window.clearTimeout(versionClickTimerRef.current);
          versionClickTimerRef.current = null;
        }
        setContextMenu(null);
      }
      const nextSlot = computeTargetSlot(e.clientY);
      setDragState((prev) =>
        prev
          ? {
              ...prev,
              active: true,
              targetSlot: nextSlot,
            }
          : null,
      );
    };

    const handlePointerUp = (e: PointerEvent) => {
      const cur = dragStateRef.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      if (cur.active) {
        const currentIds = displayedDrawingsRef.current.map((d) => d.id);
        const reordered = reorderDrawingIds(
          currentIds,
          cur.sourceId,
          cur.targetSlot,
        );
        setSortMode("custom");
        onReorderDrawings(reordered);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragPointerId, onReorderDrawings]);

  const activeDragSourceIdx =
    dragState?.active === true
      ? displayedDrawings.findIndex((d) => d.id === dragState.sourceId)
      : -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Drawings
            </h2>
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
              {drawings.length}
            </span>
          </div>
          {drawings.length > 1 && (
            <div
              role="group"
              aria-label="Sort drawings"
              className="inline-flex items-center rounded border border-neutral-800 bg-neutral-900/90 p-0.5 text-[10px]"
            >
              <button
                type="button"
                title="Custom order (drag to reorder)"
                onClick={() => setSortMode("custom")}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium transition-colors ${
                  sortMode === "custom"
                    ? "bg-neutral-700/90 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <GripVertical className="h-2.5 w-2.5" />
                <span>Custom</span>
              </button>
              <button
                type="button"
                title="Sort A → Z"
                onClick={() => setSortMode("alpha_asc")}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono font-medium transition-colors ${
                  sortMode === "alpha_asc"
                    ? "bg-neutral-700/90 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <ArrowDownAZ className="h-2.5 w-2.5" />
                <span>A–Z</span>
              </button>
              <button
                type="button"
                title="Sort Z → A"
                onClick={() => setSortMode("alpha_desc")}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono font-medium transition-colors ${
                  sortMode === "alpha_desc"
                    ? "bg-neutral-700/90 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <ArrowUpZA className="h-2.5 w-2.5" />
                <span>Z–A</span>
              </button>
            </div>
          )}
        </div>
        {activePart && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-400">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="truncate font-medium text-neutral-300">
              {activePart.name.trim() || "Untitled Part"}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!activePart ? (
          <div className="px-3 py-8 text-center text-xs text-neutral-500">
            <p className="leading-relaxed">
              Activate a part in{" "}
              <span className="font-medium text-neutral-300">Project</span> to
              upload and manage its 2D drawings.
            </p>
            <button
              type="button"
              onClick={onGoToProject}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 hover:text-white"
            >
              <Network className="h-3.5 w-3.5" />
              Go to Project
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={onUploadPdf}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-700 bg-neutral-900/70 px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              Upload PDF Drawing
            </button>

            {drawings.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">
                No drawings yet. Click{" "}
                <span className="font-medium text-neutral-300">
                  Upload PDF Drawing
                </span>{" "}
                above to add a drawing version.
              </div>
            ) : (
              <ul className={`space-y-1.5 ${dragState?.active ? "select-none" : ""}`}>
                {displayedDrawings.map((drw, idx) => {
                  const isCurrent = drw.id === activeDrawingId;
                  const isLatest = drw.id === latestDrawingId;
                  const isEditingVersion = editingDrawingId === drw.id;
                  const isExpanded = expandedDrawingIds.has(drw.id);
                  const revisions = drw.annotationRevisions ?? [];
                  const latestRevId = resolveLatestAnnotationRevisionId(drw);
                  const isDragged =
                    dragState?.active === true && dragState.sourceId === drw.id;
                  const showDropBefore =
                    dragState?.active === true &&
                    dragState.targetSlot === idx &&
                    activeDragSourceIdx !== idx &&
                    activeDragSourceIdx !== idx - 1;
                  const showDropAfter =
                    dragState?.active === true &&
                    idx === displayedDrawings.length - 1 &&
                    dragState.targetSlot === displayedDrawings.length &&
                    activeDragSourceIdx !== displayedDrawings.length - 1;
                  return (
                    <li
                      key={drw.id}
                      ref={(el) => {
                        if (el) {
                          itemElsRef.current.set(drw.id, el);
                        } else {
                          itemElsRef.current.delete(drw.id);
                        }
                      }}
                    >
                      {showDropBefore && (
                        <div className="pointer-events-none mb-1.5 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                      )}
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        title={drw.filename}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || isEditingVersion) return;
                          const target = e.target as HTMLElement | null;
                          if (target?.closest("button, input")) return;
                          setDragState({
                            sourceId: drw.id,
                            pointerId: e.pointerId,
                            startX: e.clientX,
                            startY: e.clientY,
                            active: false,
                            targetSlot: idx,
                          });
                        }}
                        onClick={() => {
                          if (isEditingVersion || suppressClickRef.current) {
                            return;
                          }
                          toggleDrawingExpanded(drw.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({
                            kind: "drawing",
                            drawingId: drw.id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleDrawingExpanded(drw.id);
                          }
                        }}
                        className={`group flex items-center justify-between gap-1.5 rounded-md border px-2 py-2 transition-colors ${
                          isDragged
                            ? "cursor-grabbing border-blue-500/70 bg-neutral-800/60 opacity-50"
                            : isCurrent
                              ? "cursor-pointer border-emerald-500/60 bg-neutral-800/90 text-neutral-100"
                              : "cursor-pointer border-neutral-800/80 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60"
                        }`}
                      >
                        <span
                          title="Drag to reorder"
                          className="shrink-0 cursor-grab text-neutral-600 transition-colors group-hover:text-neutral-400 active:cursor-grabbing"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <FileText
                              className={`h-3.5 w-3.5 shrink-0 ${
                                isCurrent
                                  ? "text-emerald-400"
                                  : "text-neutral-400"
                              }`}
                            />
                            <span className="shrink-0 text-xs font-medium text-neutral-400">
                              Version:
                            </span>
                            {isEditingVersion ? (
                              <input
                                ref={(el) => {
                                  if (el) {
                                    inputRefs.current.set(drw.id, el);
                                  } else {
                                    inputRefs.current.delete(drw.id);
                                  }
                                }}
                                type="text"
                                aria-label="Drawing version"
                                value={draftVersion}
                                placeholder="A, B, C..."
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onChange={(e) => setDraftVersion(e.target.value)}
                                onBlur={() => commitEditingVersion(drw.id)}
                                onKeyDown={(e) => {
                                  if (e.nativeEvent.isComposing) return;
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitEditingVersion(drw.id);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelEditingVersion();
                                  }
                                }}
                                className="min-w-0 flex-1 rounded border border-blue-500/70 bg-neutral-950 px-1 py-0.5 font-mono text-xs font-semibold text-neutral-100 placeholder:font-sans placeholder:font-normal placeholder:text-neutral-600 focus:outline-none"
                              />
                            ) : (
                              <span
                                title="Double-click to edit version"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (suppressClickRef.current) return;
                                  if (versionClickTimerRef.current !== null) {
                                    window.clearTimeout(
                                      versionClickTimerRef.current,
                                    );
                                    versionClickTimerRef.current = null;
                                  }
                                  const targetId = drw.id;
                                  versionClickTimerRef.current =
                                    window.setTimeout(() => {
                                      versionClickTimerRef.current = null;
                                      toggleDrawingExpanded(targetId);
                                    }, 220);
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  startEditingVersion(drw);
                                }}
                                className="min-w-0 flex-1 truncate rounded px-1 py-0.5 font-mono text-xs font-semibold text-neutral-100"
                              >
                                {drw.version?.trim() || (
                                  <span className="font-sans font-normal text-neutral-500">
                                    —
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          <div
                            title={drw.filename}
                            className="mt-0.5 truncate pl-5 font-mono text-[10px] text-neutral-500"
                          >
                            {drw.filename}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-5 font-mono text-[10px] text-neutral-400">
                            <span>{drw.pageCount}p</span>
                            {revisions.length > 1 && (
                              <>
                                <span>·</span>
                                <span
                                  title={`${revisions.length} reviews`}
                                  className="inline-flex items-center gap-0.5 text-neutral-400"
                                >
                                  <Layers className="h-2.5 w-2.5 text-neutral-500" />
                                  {revisions.length} reviews
                                </span>
                              </>
                            )}
                            {isLatest ? (
                              <span className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-[1px] font-sans text-[9px] font-medium text-amber-300 ring-1 ring-amber-500/40">
                                <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                                Latest
                              </span>
                            ) : (
                              <button
                                type="button"
                                title="Mark as Latest drawing version"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMarkLatest(drw.id);
                                }}
                                className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-neutral-800 px-1.5 py-[1px] font-sans text-[9px] font-medium text-neutral-400 opacity-0 ring-1 ring-neutral-700 transition-opacity hover:bg-amber-500/15 hover:text-amber-300 hover:ring-amber-500/40 group-hover:opacity-100 focus:opacity-100"
                              >
                                <Star className="h-2.5 w-2.5" />
                                Set Latest
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center pr-0.5 text-neutral-500 transition-colors group-hover:text-neutral-200">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-1 ml-5 border-l border-neutral-800 pl-2.5 pb-0.5">
                          <ul className="space-y-1">
                            {revisions.map((rev) => {
                              const isRevLatest = rev.id === latestRevId;
                              const isRevActive =
                                isCurrent &&
                                rev.id === activeAnnotationRevisionId;
                              const isRevEditing =
                                editingRevision?.drawingId === drw.id &&
                                editingRevision.revisionId === rev.id;
                              const revCount =
                                dimCountByRevision.get(
                                  `${drw.id}::${rev.id}`,
                                ) ?? 0;
                              const revKey = `${drw.id}::${rev.id}`;

                              return (
                                <li key={rev.id}>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      if (isRevEditing) return;
                                      onSelectDrawing(drw.id, rev.id);
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setContextMenu({
                                        kind: "revision",
                                        drawingId: drw.id,
                                        revisionId: rev.id,
                                        x: e.clientX,
                                        y: e.clientY,
                                      });
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.target !== e.currentTarget) return;
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        onSelectDrawing(drw.id, rev.id);
                                      }
                                    }}
                                    className={`group/rev flex cursor-pointer items-center justify-between gap-1.5 rounded border px-2 py-1.5 text-[11px] transition-colors ${
                                      isRevActive
                                        ? "border-emerald-500/50 bg-neutral-800/80 text-neutral-100"
                                        : "border-neutral-800/70 bg-neutral-900/40 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/50"
                                    }`}
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                          isRevActive
                                            ? "bg-emerald-400"
                                            : "bg-neutral-600"
                                        }`}
                                      />
                                      {isRevEditing ? (
                                        (() => {
                                          const isDuplicateRevName =
                                            hasAnnotationRevisionNameCollision(
                                              revisions,
                                              draftRevisionName,
                                              rev.id,
                                            );
                                          return (
                                            <input
                                              ref={(el) => {
                                                if (el) {
                                                  revInputRefs.current.set(
                                                    revKey,
                                                    el,
                                                  );
                                                } else {
                                                  revInputRefs.current.delete(
                                                    revKey,
                                                  );
                                                }
                                              }}
                                              type="text"
                                              aria-label="Review name"
                                              aria-invalid={
                                                isDuplicateRevName || undefined
                                              }
                                              title={
                                                isDuplicateRevName
                                                  ? "A review with this name already exists"
                                                  : undefined
                                              }
                                              value={draftRevisionName}
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                              onDoubleClick={(e) =>
                                                e.stopPropagation()
                                              }
                                              onChange={(e) =>
                                                setDraftRevisionName(
                                                  e.target.value,
                                                )
                                              }
                                              onBlur={() =>
                                                commitEditingRevision(
                                                  drw.id,
                                                  rev.id,
                                                )
                                              }
                                              onKeyDown={(e) => {
                                                if (e.nativeEvent.isComposing)
                                                  return;
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  if (isDuplicateRevName) {
                                                    onRenameAnnotationRevision(
                                                      drw.id,
                                                      rev.id,
                                                      draftRevisionName,
                                                    );
                                                    return;
                                                  }
                                                  commitEditingRevision(
                                                    drw.id,
                                                    rev.id,
                                                  );
                                                } else if (e.key === "Escape") {
                                                  e.preventDefault();
                                                  cancelEditingRevision();
                                                }
                                              }}
                                              className={`min-w-0 flex-1 rounded border bg-neutral-950 px-1 py-0.5 font-mono text-[11px] font-medium text-neutral-100 focus:outline-none ${
                                                isDuplicateRevName
                                                  ? "border-rose-500/80 text-rose-200"
                                                  : "border-blue-500/70"
                                              }`}
                                            />
                                          );
                                        })()
                                      ) : (
                                        <span
                                          title="Double-click to rename review"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (
                                              revClickTimerRef.current !== null
                                            ) {
                                              window.clearTimeout(
                                                revClickTimerRef.current,
                                              );
                                              revClickTimerRef.current = null;
                                            }
                                            revClickTimerRef.current =
                                              window.setTimeout(() => {
                                                revClickTimerRef.current = null;
                                                onSelectDrawing(drw.id, rev.id);
                                              }, 220);
                                          }}
                                          onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            startEditingRevision(
                                              drw.id,
                                              rev.id,
                                              rev.name,
                                            );
                                          }}
                                          className="truncate font-medium text-neutral-200"
                                        >
                                          {rev.name}
                                        </span>
                                      )}
                                      {isRevLatest && (
                                        <span
                                          title="Selected official review for this drawing version"
                                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-[1px] font-sans text-[9px] font-medium text-emerald-300 ring-1 ring-emerald-500/40"
                                        >
                                          <Check className="h-2.5 w-2.5" />
                                          Selected
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <span className="font-mono text-[10px] text-neutral-400">
                                        {revCount}{" "}
                                        {revCount === 1 ? "dim" : "dims"}
                                      </span>
                                      <ChevronRight className="h-3 w-3 text-neutral-500 transition-transform group-hover/rev:translate-x-0.5 group-hover/rev:text-neutral-200" />
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>

                          <div className="mt-1.5 flex items-center gap-1.5">
                            <button
                              type="button"
                              title="Create a new blank review"
                              onClick={() =>
                                onCreateBlankAnnotationRevision(drw.id)
                              }
                              className="flex flex-1 items-center justify-center gap-1 rounded border border-dashed border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[10px] font-medium text-neutral-400 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70 hover:text-neutral-100"
                            >
                              <Plus className="h-3 w-3" />
                              New Review
                            </button>
                            {copiedReviewName && (
                              <button
                                type="button"
                                title={`Paste copied review "${copiedReviewName}" here`}
                                onClick={() =>
                                  onPasteAnnotationRevision(drw.id)
                                }
                                className="flex shrink-0 items-center justify-center gap-1 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-300 transition-colors hover:border-blue-400/60 hover:bg-blue-500/20 hover:text-blue-200"
                              >
                                <ClipboardPaste className="h-3 w-3" />
                                Paste
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {showDropAfter && (
                        <div className="pointer-events-none mt-1.5 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {contextMenu &&
        (() => {
          const target = drawings.find((d) => d.id === contextMenu.drawingId);
          if (!target) return null;

          if (contextMenu.kind === "revision") {
            const revisions = target.annotationRevisions ?? [];
            const rev = revisions.find((r) => r.id === contextMenu.revisionId);
            if (!rev) return null;
            const latestRevId = resolveLatestAnnotationRevisionId(target);
            const isRevLatest = rev.id === latestRevId;
            return (
              <FloatingMenu
                x={contextMenu.x}
                y={contextMenu.y}
                role="menu"
                aria-label="Review actions"
                onPointerDown={(e) => e.stopPropagation()}
                className="w-48 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setContextMenu(null);
                    onCopyAnnotationRevision(target.id, rev.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
                >
                  <Copy className="h-3.5 w-3.5 text-neutral-400" />
                  Copy Review
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setContextMenu(null);
                    onDuplicateAnnotationRevision(target.id, rev.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
                >
                  <CopyPlus className="h-3.5 w-3.5 text-neutral-400" />
                  Duplicate Review
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    startEditingRevision(target.id, rev.id, rev.name)
                  }
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
                >
                  <Pencil className="h-3.5 w-3.5 text-neutral-400" />
                  Rename
                </button>
                {!isRevLatest && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      onMarkLatestAnnotationRevision(target.id, rev.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-emerald-300"
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Mark as Selected
                  </button>
                )}
                {revisions.length > 1 && (
                  <>
                    <div className="my-1 border-t border-neutral-800" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setContextMenu(null);
                        onDeleteAnnotationRevision(target.id, rev.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-400 hover:bg-rose-950/60 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Review
                    </button>
                  </>
                )}
              </FloatingMenu>
            );
          }

          const isTargetLatest = target.id === latestDrawingId;
          return (
              <FloatingMenu
              x={contextMenu.x}
              y={contextMenu.y}
              role="menu"
              aria-label="Drawing version actions"
              onPointerDown={(e) => e.stopPropagation()}
              className="w-52 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl"
            >
              {copiedReviewName && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      ensureDrawingExpanded(target.id);
                      onPasteAnnotationRevision(target.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-blue-300 hover:bg-blue-500/15 hover:text-blue-200"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      Paste &ldquo;{copiedReviewName}&rdquo;
                    </span>
                  </button>
                  <div className="my-1 border-t border-neutral-800" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => startEditingVersion(target)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5 text-neutral-400" />
                Edit Version
              </button>
              {!isTargetLatest && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setContextMenu(null);
                    onMarkLatest(target.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-amber-300"
                >
                  <Star className="h-3.5 w-3.5 text-amber-400" />
                  Set as Latest
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  ensureDrawingExpanded(target.id);
                  onCreateBlankAnnotationRevision(target.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5 text-neutral-400" />
                New Review
              </button>
              <div className="my-1 border-t border-neutral-800" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  onRemoveDrawing(target.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-400 hover:bg-rose-950/60 hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Drawing
              </button>
            </FloatingMenu>
          );
        })()}
    </div>
  );
}
