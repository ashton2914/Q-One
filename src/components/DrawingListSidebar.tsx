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
  onRemoveDrawing,
  onGoToProject,
}: DrawingListSidebarProps) {
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
                {drawings.map((drw, index) => {
                  const isCurrent = drw.id === activeDrawingId;
                  const dimCount = dimCountByDrawing.get(drw.id) ?? 0;
                  return (
                    <li key={drw.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectDrawing(drw.id)}
                        onKeyDown={(e) => {
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
                            <span
                              title={drw.filename}
                              className="truncate font-mono text-xs font-medium text-neutral-100"
                            >
                              {drw.filename}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-neutral-400">
                            <span className="rounded bg-neutral-800 px-1 py-[1px] text-neutral-300">
                              V{index + 1}
                            </span>
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
