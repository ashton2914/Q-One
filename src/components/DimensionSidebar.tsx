import { MapPin, MapPinOff, Plus, Trash2 } from "lucide-react";
import { formatTolerance } from "../lib/dimensions";
import type { Dimension } from "../types/project";

export interface DimensionSidebarProps {
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  placingDimensionId: string | null;
  hasProject: boolean;
  onAddDimension: () => void;
  onSelectDimension: (id: string) => void;
  onDeleteDimension: (id: string) => void;
}

export function DimensionSidebar({
  dimensions,
  selectedDimensionId,
  placingDimensionId,
  hasProject,
  onAddDimension,
  onSelectDimension,
  onDeleteDimension,
}: DimensionSidebarProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Dimensions
          </h2>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">
            {dimensions.length}
          </span>
        </div>

        <button
          type="button"
          disabled={!hasProject}
          onClick={onAddDimension}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!hasProject ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">
            Open a PDF drawing or project to manage dimensions.
          </div>
        ) : dimensions.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">
            No dimensions yet. Click <span className="font-medium text-slate-300">+ Add</span> to
            create your first dimension and mark it on the drawing.
          </div>
        ) : (
          <ul className="space-y-1">
            {dimensions.map((dim) => {
              const isSelected = dim.id === selectedDimensionId;
              const isPlacing = dim.id === placingDimensionId;
              const tol = formatTolerance(dim.upperTol, dim.lowerTol);

              return (
                <li key={dim.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectDimension(dim.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDimension(dim.id);
                      }
                    }}
                    className={`group flex cursor-pointer items-start justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                      isSelected
                        ? "border-blue-500/60 bg-blue-600/15 text-slate-100"
                        : "border-transparent bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800/70"
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          isSelected
                            ? "bg-blue-600 text-white"
                            : "bg-rose-600/90 text-white"
                        }`}
                      >
                        {dim.balloonNumber}
                      </span>

                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-slate-100">
                          {dim.name.trim() || "Untitled Dimension"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                          {dim.nominal.trim() ? (
                            <span className="font-mono text-slate-300">
                              {dim.nominal.trim()}
                              {tol ? ` ${tol}` : ""} {dim.unit}
                            </span>
                          ) : (
                            <span className="italic text-slate-500">No nominal</span>
                          )}

                          {isPlacing ? (
                            <span className="text-blue-400">Placing…</span>
                          ) : dim.marker ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-400">
                              <MapPin className="h-3 w-3" />P{dim.marker.page}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-amber-400/90">
                              <MapPinOff className="h-3 w-3" />
                              Unplaced
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={`Delete dimension ${dim.balloonNumber}`}
                      title="Delete dimension"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDimension(dim.id);
                      }}
                      className="rounded p-1 text-slate-500 opacity-0 transition-opacity hover:bg-rose-950 hover:text-rose-400 group-hover:opacity-100 focus:opacity-100"
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
  );
}
