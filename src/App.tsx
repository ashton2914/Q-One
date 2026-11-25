import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus2, FolderOpen } from "lucide-react";
import { DimensionEditor } from "./components/DimensionEditor";
import { DimensionSidebar } from "./components/DimensionSidebar";
import { MenuBar } from "./components/MenuBar";
import { PdfViewer, type ScrollToPageRequest } from "./components/PdfViewer";
import { createDimension, createProjectFromPdf } from "./lib/dimensions";
import {
  shouldBlockWindowClose,
  shouldClearDirtyAfterSave,
} from "./lib/viewerState";
import {
  importPdf,
  openProject,
  pickOpenProjectFile,
  pickPdfFile,
  pickSaveProjectFile,
  saveProject,
} from "./lib/tauriApi";
import type { Dimension, MarkerPosition, ProjectData } from "./types/project";

interface StatusMessage {
  kind: "info" | "error";
  text: string;
}

export default function App() {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [fitRequestKey, setFitRequestKey] = useState<number>(0);
  const [scrollToPageRequest, setScrollToPageRequest] =
    useState<ScrollToPageRequest | null>(null);
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(
    null,
  );
  const [placingDimensionId, setPlacingDimensionId] = useState<string | null>(
    null,
  );
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const isDirtyRef = useRef<boolean>(isDirty);
  isDirtyRef.current = isDirty;
  const isSavingRef = useRef<boolean>(false);
  const editRevisionRef = useRef<number>(0);

  const markDirty = useCallback(() => {
    editRevisionRef.current += 1;
    setIsDirty(true);
  }, []);

  const activeDrawing = project?.drawings[0] ?? null;
  const pageCount = activeDrawing?.pageCount ?? 1;

  const showStatus = useCallback((kind: "info" | "error", text: string) => {
    setStatus({ kind, text });
  }, []);

  useEffect(() => {
    if (!status || status.kind === "error") return;
    const timer = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "You have unsaved changes. Discard them and continue?",
    );
  }, [isDirty]);

  const handleOpenPdf = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    try {
      const path = await pickPdfFile();
      if (!path) return;
      const imported = await importPdf(path);
      const nextProject = createProjectFromPdf(
        imported.drawingId,
        imported.filename,
        1,
      );
      setProject(nextProject);
      setProjectFilePath(null);
      setPdfBytes(imported.pdfBytes);
      setCurrentPage(1);
      setSelectedDimensionId(null);
      setPlacingDimensionId(null);
      setIsDirty(true);
      setFitRequestKey((k) => k + 1);
      showStatus("info", `Loaded drawing "${imported.filename}"`);
    } catch (err) {
      showStatus(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [confirmDiscardIfDirty, showStatus]);

  const handleOpenProject = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    try {
      const path = await pickOpenProjectFile();
      if (!path) return;
      const opened = await openProject(path);
      setProject(opened.project);
      setProjectFilePath(path);
      setPdfBytes(opened.pdfBytes);
      setCurrentPage(1);
      setSelectedDimensionId(opened.project.dimensions[0]?.id ?? null);
      setPlacingDimensionId(null);
      setIsDirty(false);
      setFitRequestKey((k) => k + 1);
      showStatus("info", `Opened project "${opened.project.name}"`);
    } catch (err) {
      showStatus(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [confirmDiscardIfDirty, showStatus]);

  const persistProject = useCallback(
    async (forcePrompt: boolean) => {
      if (!project || isSavingRef.current) return;
      isSavingRef.current = true;
      try {
        let targetPath = forcePrompt ? null : projectFilePath;
        if (!targetPath) {
          targetPath = await pickSaveProjectFile(project.name);
          if (!targetPath) return;
        }
        const revisionAtSaveStart = editRevisionRef.current;
        const savedAt = new Date().toISOString();
        const snapshot: ProjectData = {
          ...project,
          updatedAt: savedAt,
        };
        await saveProject(targetPath, snapshot);
        setProject((prev) => (prev ? { ...prev, updatedAt: savedAt } : prev));
        setProjectFilePath(targetPath);
        if (
          shouldClearDirtyAfterSave(
            revisionAtSaveStart,
            editRevisionRef.current,
          )
        ) {
          setIsDirty(false);
        }
        const displayName = targetPath.split(/[\\/]/).pop() ?? targetPath;
        showStatus("info", `Saved project to ${displayName}`);
      } catch (err) {
        showStatus(
          "error",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        isSavingRef.current = false;
      }
    },
    [project, projectFilePath, showStatus],
  );

  // Guard window close when there are unsaved changes
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    try {
      const appWindow = getCurrentWindow();
      void appWindow
        .onCloseRequested(async (event) => {
          if (!shouldBlockWindowClose(isDirtyRef.current)) return;
          event.preventDefault();
          const discard = await confirmDialog(
            "You have unsaved changes. Discard them and close DM-One?",
            { title: "Unsaved Changes", kind: "warning" },
          );
          if (discard) {
            isDirtyRef.current = false;
            await appWindow.destroy();
          }
        })
        .then((fn) => {
          unlisten = fn;
        });
    } catch {
      // Non-Tauri browser preview environment
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleSave = useCallback(() => {
    void persistProject(false);
  }, [persistProject]);

  const handleSaveAs = useCallback(() => {
    void persistProject(true);
  }, [persistProject]);

  const handleCloseProject = useCallback(() => {
    if (!project) return;
    if (!confirmDiscardIfDirty()) return;
    setProject(null);
    setProjectFilePath(null);
    setPdfBytes(null);
    setCurrentPage(1);
    setSelectedDimensionId(null);
    setPlacingDimensionId(null);
    setIsDirty(false);
    showStatus("info", "Project closed");
  }, [project, confirmDiscardIfDirty, showStatus]);

  // Global keyboard shortcuts: Esc cancels placement, Cmd/Ctrl+S saves
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && placingDimensionId) {
        setPlacingDimensionId(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (project) {
          e.preventDefault();
          void persistProject(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingDimensionId, project, persistProject]);

  const handlePageCountLoaded = useCallback((count: number) => {
    setProject((prev) => {
      if (!prev || prev.drawings.length === 0) return prev;
      if (prev.drawings[0].pageCount === count) return prev;
      const drawings = [...prev.drawings];
      drawings[0] = { ...drawings[0], pageCount: count };
      return { ...prev, drawings };
    });
  }, []);

  const handleAddDimension = useCallback(() => {
    if (!project) return;
    const nextDim = createDimension(project.dimensions);
    setProject({
      ...project,
      dimensions: [...project.dimensions, nextDim],
    });
    setSelectedDimensionId(nextDim.id);
    setPlacingDimensionId(nextDim.id);
    markDirty();
  }, [project, markDirty]);

  const handleSelectDimension = useCallback(
    (id: string) => {
      setSelectedDimensionId(id);
      const dim = project?.dimensions.find((d) => d.id === id);
      if (dim?.marker) {
        setCurrentPage(dim.marker.page);
        setScrollToPageRequest({ page: dim.marker.page, key: Date.now() });
      }
    },
    [project],
  );

  const handleUpdateDimension = useCallback(
    (id: string, patch: Partial<Dimension>) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        };
      });
      markDirty();
    },
    [markDirty],
  );

  const handleDeleteDimension = useCallback(
    (id: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.filter((d) => d.id !== id),
        };
      });
      setSelectedDimensionId((prev) => (prev === id ? null : prev));
      setPlacingDimensionId((prev) => (prev === id ? null : prev));
      markDirty();
    },
    [markDirty],
  );

  const handlePlaceMarker = useCallback(
    (dimensionId: string, marker: MarkerPosition) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.id === dimensionId ? { ...d, marker } : d,
          ),
        };
      });
      setPlacingDimensionId(null);
      setSelectedDimensionId(dimensionId);
      markDirty();
    },
    [markDirty],
  );

  const handleMoveMarker = useCallback(
    (dimensionId: string, x: number, y: number) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.id === dimensionId && d.marker
              ? { ...d, marker: { ...d.marker, x, y } }
              : d,
          ),
        };
      });
      markDirty();
    },
    [markDirty],
  );

  const handleClearMarker = useCallback(
    (dimensionId: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.id === dimensionId ? { ...d, marker: null } : d,
          ),
        };
      });
      markDirty();
    },
    [markDirty],
  );

  const selectedDimension =
    project?.dimensions.find((d) => d.id === selectedDimensionId) ?? null;

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <MenuBar
        projectName={project?.name ?? null}
        isDirty={isDirty}
        hasProject={project !== null}
        onOpenPdf={() => void handleOpenPdf()}
        onOpenProject={() => void handleOpenProject()}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onCloseProject={handleCloseProject}
      />

      {status && (
        <div
          className={`flex items-center justify-between border-b px-4 py-1.5 text-xs ${
            status.kind === "error"
              ? "border-rose-500/40 bg-rose-950/90 text-rose-200"
              : "border-emerald-500/30 bg-emerald-950/70 text-emerald-200"
          }`}
        >
          <span>{status.text}</span>
          <button
            type="button"
            onClick={() => setStatus(null)}
            className="ml-4 text-[11px] opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
          <DimensionSidebar
            dimensions={project?.dimensions ?? []}
            selectedDimensionId={selectedDimensionId}
            placingDimensionId={placingDimensionId}
            hasProject={project !== null}
            onAddDimension={handleAddDimension}
            onSelectDimension={handleSelectDimension}
            onDeleteDimension={handleDeleteDimension}
          />
          <DimensionEditor
            dimension={selectedDimension}
            isPlacing={
              selectedDimension !== null &&
              placingDimensionId === selectedDimension.id
            }
            onUpdate={handleUpdateDimension}
            onStartPlacing={setPlacingDimensionId}
            onClearMarker={handleClearMarker}
          />
        </aside>

        {project && pdfBytes ? (
          <PdfViewer
            pdfBytes={pdfBytes}
            drawingId={activeDrawing?.id ?? null}
            drawingFilename={activeDrawing?.filename ?? null}
            currentPage={currentPage}
            pageCount={pageCount}
            zoom={zoom}
            fitRequestKey={fitRequestKey}
            scrollToPageRequest={scrollToPageRequest}
            dimensions={project.dimensions}
            selectedDimensionId={selectedDimensionId}
            placingDimensionId={placingDimensionId}
            onPageCountLoaded={handlePageCountLoaded}
            onPageChange={setCurrentPage}
            onZoomChange={setZoom}
            onFitToView={() => setFitRequestKey((k) => k + 1)}
            onPlaceMarker={handlePlaceMarker}
            onSelectDimension={handleSelectDimension}
            onMoveMarker={handleMoveMarker}
            onCancelPlacing={() => setPlacingDimensionId(null)}
          />
        ) : (
          <main className="flex flex-1 items-center justify-center bg-neutral-900 p-8">
            <div className="max-w-md rounded-xl border border-neutral-800 bg-neutral-950/90 p-8 text-center shadow-xl">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-800 text-lg font-bold text-neutral-100 ring-1 ring-neutral-700">
                DM
              </div>
              <h1 className="text-lg font-semibold text-neutral-100">
                DM-One Dimension Manager
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                Open a PDF engineering drawing to compile your dimension list and
                place balloon markers, or resume an existing{" "}
                <span className="font-mono text-neutral-300">.dmone</span> project.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleOpenPdf()}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
                >
                  <FilePlus2 className="h-4 w-4" />
                  Open PDF Drawing
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenProject()}
                  className="inline-flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
                >
                  <FolderOpen className="h-4 w-4 text-amber-400" />
                  Open Project (.dmone)
                </button>
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
