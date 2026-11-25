import {
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  Maximize2,
  Save,
  SaveAll,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export interface TopToolbarProps {
  projectName: string | null;
  isDirty: boolean;
  hasProject: boolean;
  currentPage: number;
  pageCount: number;
  zoom: number;
  onOpenPdf: () => void;
  onOpenProject: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onFitToView: () => void;
}

export function TopToolbar({
  projectName,
  isDirty,
  hasProject,
  currentPage,
  pageCount,
  zoom,
  onOpenPdf,
  onOpenProject,
  onSave,
  onSaveAs,
  onPageChange,
  onZoomChange,
  onFitToView,
}: TopToolbarProps) {
  const stepZoom = (delta: number) => {
    const next = Math.min(4, Math.max(0.25, Math.round((zoom + delta) * 100) / 100));
    onZoomChange(next);
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-200">
      <div className="flex items-center gap-2">
        <div className="mr-2 flex items-center gap-2 border-r border-neutral-800 pr-3">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 text-[11px] font-bold text-neutral-100 ring-1 ring-neutral-700">
            DM
          </div>
          <span className="font-semibold tracking-tight text-neutral-100">
            DM-One
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenPdf}
          className="inline-flex items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-100 hover:bg-neutral-700"
        >
          <FilePlus2 className="h-3.5 w-3.5 text-blue-400" />
          Open PDF
        </button>

        <button
          type="button"
          onClick={onOpenProject}
          className="inline-flex items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-100 hover:bg-neutral-700"
        >
          <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
          Open Project
        </button>

        <div className="mx-1 h-5 w-px bg-neutral-800" />

        <button
          type="button"
          disabled={!hasProject}
          onClick={onSave}
          title="Save Project (Ctrl/Cmd+S)"
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>

        <button
          type="button"
          disabled={!hasProject}
          onClick={onSaveAs}
          className="inline-flex items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-500"
        >
          <SaveAll className="h-3.5 w-3.5" />
          Save As
        </button>
      </div>

      <div className="hidden max-w-xs truncate text-xs text-neutral-400 md:block">
        {projectName ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="truncate font-medium text-neutral-200">
              {projectName}
            </span>
            {isDirty && (
              <span
                title="Unsaved changes"
                className="h-2 w-2 rounded-full bg-amber-400"
              />
            )}
          </span>
        ) : (
          <span>No project open</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded bg-neutral-900 px-1 py-0.5 ring-1 ring-neutral-800">
          <button
            type="button"
            disabled={!hasProject || currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
            className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[72px] text-center font-mono text-[11px] text-neutral-300">
            {hasProject ? `Page ${currentPage} / ${pageCount}` : "Page —"}
          </span>
          <button
            type="button"
            disabled={!hasProject || currentPage >= pageCount}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
            className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1 rounded bg-neutral-900 px-1 py-0.5 ring-1 ring-neutral-800">
          <button
            type="button"
            disabled={!hasProject || zoom <= 0.25}
            onClick={() => stepZoom(-0.25)}
            aria-label="Zoom out"
            className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center font-mono text-[11px] text-neutral-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            disabled={!hasProject || zoom >= 4}
            onClick={() => stepZoom(0.25)}
            aria-label="Zoom in"
            className="rounded p-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!hasProject}
            onClick={onFitToView}
            title="Fit drawing to viewport"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <Maximize2 className="h-3 w-3" />
            Fit
          </button>
        </div>
      </div>
    </header>
  );
}
