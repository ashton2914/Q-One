import { useEffect, useRef } from "react";
import {
  ChevronRight,
  FilePlus2,
  FileText,
  Network,
  Trash2,
} from "lucide-react";
import type { DrawingEntry, Part } from "../types/project";

export interface DrawingListSidebarProps {
  activePart: Part | null;
  drawings: DrawingEntry[];
  activeDrawingId: string | null;
  dimCountByDrawing: Map<string, number>;
  onUploadPdf: () => void;
  onSelectDrawing: (drawingId: string) => void;
  onUpdateDrawingVersion: (drawingId: string, version: string) => void;
  onRemoveDrawing: (drawingId: string) => void;
  onGoToProject: () => void;
}

export function DrawingListSidebar({
  activePart,
  drawings,
  activeDrawingId,
  dimCountByDrawing,
  onUploadPdf,
  onSelectDrawing,
  onUpdateDrawingVersion,
  onRemoveDrawing,
  onGoToProject,
}: DrawingListSidebarProps) {
  const prevCountRef = useRef<number>(drawings.length);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Auto-focus the version input of a newly uploaded drawing
  useEffect(() => {
    if (drawings.length > prevCountRef.current && drawings.length > 0) {
      const newest = drawings[drawings.length - 1];
      const input = inputRefs.current.get(newest.id);
      if (input) {
        input.focus();
        input.select();
      }
    }
    prevCountRef.current = drawings.length;
  }, [drawings]);

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
              <ul className="space-y-1.5">
                {drawings.map((drw) => {
                  const isCurrent = drw.id === activeDrawingId;
                  const dimCount = dimCountByDrawing.get(drw.id) ?? 0;
                  return (
                    <li key={drw.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        title={drw.filename}
                        onClick={() => onSelectDrawing(drw.id)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectDrawing(drw.id);
                          }
                        }}
                        className={`group flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                          isCurrent
                            ? "border-emerald-500/60 bg-neutral-800/90 text-neutral-100"
                            : "border-neutral-800/80 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60"
                        }`}
                      >
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
                              value={drw.version ?? ""}
                              placeholder="A, B, C..."
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                onUpdateDrawingVersion(drw.id, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) return;
                                if (e.key === "Enter" || e.key === "Escape") {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs font-semibold text-neutral-100 placeholder:font-sans placeholder:font-normal placeholder:text-neutral-600 hover:border-neutral-700 focus:border-neutral-500 focus:bg-neutral-950 focus:outline-none"
                            />
                          </div>
                          <div
                            title={drw.filename}
                            className="mt-0.5 truncate pl-5 font-mono text-[10px] text-neutral-500"
                          >
                            {drw.filename}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 pl-5 font-mono text-[10px] text-neutral-400">
                            <span>{drw.pageCount}p</span>
                            <span>·</span>
                            <span>
                              {dimCount} {dimCount === 1 ? "dim" : "dims"}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            title="Remove drawing"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveDrawing(drw.id);
                            }}
                            className="rounded p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-rose-950 hover:text-rose-400 group-hover:opacity-100 focus:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <ChevronRight className="h-3.5 w-3.5 text-neutral-500 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-200" />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
