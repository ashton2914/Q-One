import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus2, FolderOpen, FolderPlus, Network } from "lucide-react";
import { ActivityBar } from "./components/ActivityBar";
import { DimensionSidebar } from "./components/DimensionSidebar";
import { DrawingListSidebar } from "./components/DrawingListSidebar";
import { MenuBar } from "./components/MenuBar";
import {
  PdfViewer,
  type DrawingSwitchOption,
  type ScrollToPageRequest,
} from "./components/PdfViewer";
import { ProjectWorkspace } from "./components/ProjectWorkspace";
import {
  createDimension,
  createProjectFromPdf,
  validateDimensionId,
} from "./lib/dimensions";
import {
  createEmptyProject,
  createPart,
  deletePartSubtree,
  normalizeLoadedProject,
  reparentPart,
} from "./lib/partTree";
import {
  clearDrawings,
  getDrawingBytes,
  importPdf,
  openProject,
  pickOpenProjectFile,
  pickPdfFile,
  pickSaveProjectFile,
  removeDrawingBytes,
  saveProject,
} from "./lib/tauriApi";
import {
  shouldBlockWindowClose,
  shouldClearDirtyAfterSave,
} from "./lib/viewerState";
import type {
  ActiveModule,
  Dimension,
  DrawingEntry,
  MarkerPosition,
  Part,
  ProjectData,
} from "./types/project";

interface StatusMessage {
  kind: "info" | "error";
  text: string;
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>("project");
  const [project, setProject] = useState<ProjectData | null>(null);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [drawingSidebarView, setDrawingSidebarView] = useState<
    "drawings" | "dimensions"
  >("drawings");

  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [fitRequestKey, setFitRequestKey] = useState<number>(0);
  const [scrollToPageRequest, setScrollToPageRequest] =
    useState<ScrollToPageRequest | null>(null);

  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(
    null,
  );
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(
    null,
  );
  const [placingDimensionId, setPlacingDimensionId] = useState<string | null>(
    null,
  );
  const [focusNameKey, setFocusNameKey] = useState<number>(0);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const editingOriginRef = useRef<{
    id: string;
    isNew: boolean;
    snapshot: Dimension | null;
  } | null>(null);
  const isDirtyRef = useRef<boolean>(isDirty);
  isDirtyRef.current = isDirty;
  const isSavingRef = useRef<boolean>(false);
  const editRevisionRef = useRef<number>(0);
  const drawingLoadSeqRef = useRef<number>(0);

  const markDirty = useCallback(() => {
    editRevisionRef.current += 1;
    setIsDirty(true);
  }, []);

  const activePart = useMemo(
    () => project?.parts.find((p) => p.id === activePartId) ?? null,
    [project, activePartId],
  );

  const activePartDrawings = useMemo<DrawingEntry[]>(() => {
    if (!project || !activePart) return [];
    const byId = new Map(project.drawings.map((d) => [d.id, d]));
    return activePart.drawingIds
      .map((id) => byId.get(id))
      .filter((d): d is DrawingEntry => Boolean(d));
  }, [project, activePart]);

  const dimCountByDrawing = useMemo(() => {
    const map = new Map<string, number>();
    if (!project) return map;
    for (const dim of project.dimensions) {
      const id = dim.drawingId ?? dim.marker?.drawingId ?? null;
      if (id) {
        map.set(id, (map.get(id) ?? 0) + 1);
      }
    }
    return map;
  }, [project]);

  const activeDrawing = useMemo(
    () => project?.drawings.find((d) => d.id === activeDrawingId) ?? null,
    [project, activeDrawingId],
  );
  const pageCount = activeDrawing?.pageCount ?? 1;

  const activeDrawingDimensions = useMemo(() => {
    if (!project || !activeDrawingId) return [];
    return project.dimensions.filter(
      (d) => (d.drawingId ?? d.marker?.drawingId ?? null) === activeDrawingId,
    );
  }, [project, activeDrawingId]);

  const drawingSwitchOptions = useMemo<DrawingSwitchOption[]>(() => {
    if (!project) return [];
    const partByDrawingId = new Map<string, Part>();
    for (const part of project.parts) {
      for (const drwId of part.drawingIds) {
        partByDrawingId.set(drwId, part);
      }
    }
    return project.drawings.map((drw) => {
      const part = partByDrawingId.get(drw.id);
      const label = part
        ? `${part.name.trim() || "Untitled Part"} / ${drw.filename}`
        : drw.filename;
      return { id: drw.id, label };
    });
  }, [project]);

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

  const handleNewProject = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    try {
      await clearDrawings();
    } catch {
      // Ignore outside Tauri runtime
    }
    const fresh = createEmptyProject("Untitled Project");
    drawingLoadSeqRef.current += 1;
    setProject(fresh);
    setProjectFilePath(null);
    setSelectedPartId(null);
    setActivePartId(null);
    setDrawingSidebarView("drawings");
    setActiveDrawingId(null);
    setPdfBytes(null);
    setCurrentPage(1);
    setSelectedDimensionId(null);
    setEditingDimensionId(null);
    setPlacingDimensionId(null);
    setIsDirty(false);
    setActiveModule("project");
    showStatus("info", "Created new project");
  }, [confirmDiscardIfDirty, showStatus]);

  const handleOpenPdf = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    try {
      const path = await pickPdfFile();
      if (!path) return;
      const previousDrawingIds = project?.drawings.map((d) => d.id) ?? [];
      const imported = await importPdf(path);
      for (const oldId of previousDrawingIds) {
        if (oldId !== imported.drawingId) {
          try {
            await removeDrawingBytes(oldId);
          } catch {
            // ignore
          }
        }
      }
      const nextProject = createProjectFromPdf(
        imported.drawingId,
        imported.filename,
        1,
      );
      drawingLoadSeqRef.current += 1;
      setProject(nextProject);
      setProjectFilePath(null);
      const firstPartId = nextProject.parts[0]?.id ?? null;
      setSelectedPartId(firstPartId);
      setActivePartId(firstPartId);
      setDrawingSidebarView("dimensions");
      setActiveDrawingId(imported.drawingId);
      setPdfBytes(imported.pdfBytes);
      setCurrentPage(1);
      setSelectedDimensionId(null);
      setEditingDimensionId(null);
      setPlacingDimensionId(null);
      setIsDirty(true);
      setActiveModule("drawing");
      setFitRequestKey((k) => k + 1);
      showStatus("info", `Loaded drawing "${imported.filename}"`);
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : String(err));
    }
  }, [project, confirmDiscardIfDirty, showStatus]);

  const handleOpenProject = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    try {
      const path = await pickOpenProjectFile();
      if (!path) return;
      const opened = await openProject(path);
      const normalized = normalizeLoadedProject(opened.project);
      drawingLoadSeqRef.current += 1;
      setProject(normalized);
      setProjectFilePath(path);
      const ownerPart = opened.activeDrawingId
        ? normalized.parts.find((p) =>
            p.drawingIds.includes(opened.activeDrawingId!),
          )
        : undefined;
      const initialPartId = ownerPart?.id ?? normalized.parts[0]?.id ?? null;
      setSelectedPartId(initialPartId);
      setActivePartId(initialPartId);
      setDrawingSidebarView(opened.activeDrawingId ? "dimensions" : "drawings");
      setActiveDrawingId(opened.activeDrawingId);
      setPdfBytes(opened.pdfBytes);
      setCurrentPage(1);
      const firstDrwDim = opened.activeDrawingId
        ? normalized.dimensions.find(
            (d) =>
              (d.drawingId ?? d.marker?.drawingId ?? null) ===
              opened.activeDrawingId,
          )
        : undefined;
      setSelectedDimensionId(firstDrwDim?.id ?? null);
      setEditingDimensionId(null);
      setPlacingDimensionId(null);
      setIsDirty(false);
      setActiveModule(opened.activeDrawingId ? "drawing" : "project");
      if (opened.activeDrawingId) {
        setFitRequestKey((k) => k + 1);
      }
      showStatus("info", `Opened project "${normalized.name}"`);
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : String(err));
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
        showStatus("error", err instanceof Error ? err.message : String(err));
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

  const handleCloseProject = useCallback(async () => {
    if (!project) return;
    if (!confirmDiscardIfDirty()) return;
    try {
      await clearDrawings();
    } catch {
      // ignore outside Tauri
    }
    drawingLoadSeqRef.current += 1;
    setProject(null);
    setProjectFilePath(null);
    setSelectedPartId(null);
    setActivePartId(null);
    setDrawingSidebarView("drawings");
    setActiveDrawingId(null);
    setPdfBytes(null);
    setCurrentPage(1);
    setSelectedDimensionId(null);
    setEditingDimensionId(null);
    setPlacingDimensionId(null);
    setIsDirty(false);
    showStatus("info", "Project closed");
  }, [project, confirmDiscardIfDirty, showStatus]);

  // Project / BOM handlers
  const handleRenameProject = useCallback(
    (name: string) => {
      setProject((prev) => (prev ? { ...prev, name } : prev));
      markDirty();
    },
    [markDirty],
  );

  const handleAddPart = useCallback(
    (parentId: string | null) => {
      if (!project) return;
      const defaultName =
        parentId === null
          ? `Part ${project.parts.length + 1}`
          : `Sub-part ${project.parts.length + 1}`;
      const nextPart = createPart(parentId, defaultName);
      setProject((prev) =>
        prev ? { ...prev, parts: [...prev.parts, nextPart] } : prev,
      );
      setSelectedPartId(nextPart.id);
      markDirty();
    },
    [project, markDirty],
  );

  const handleUpdatePart = useCallback(
    (partId: string, patch: Partial<Part>) => {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) =>
                p.id === partId ? { ...p, ...patch } : p,
              ),
            }
          : prev,
      );
      markDirty();
    },
    [markDirty],
  );

  const handleReparentPart = useCallback(
    (partId: string, newParentId: string | null) => {
      setProject((prev) => {
        if (!prev) return prev;
        const nextParts = reparentPart(prev.parts, partId, newParentId);
        return { ...prev, parts: nextParts };
      });
      markDirty();
    },
    [markDirty],
  );

  const handleDeletePart = useCallback(
    async (partId: string) => {
      if (!project) return;
      const preview = deletePartSubtree(project.parts, partId);
      const removedSet = new Set(preview.removedDrawingIds);
      const affectedDims = project.dimensions.filter((d) =>
        removedSet.has(d.drawingId ?? d.marker?.drawingId ?? ""),
      ).length;

      if (
        preview.removedPartIds.length > 1 ||
        preview.removedDrawingIds.length > 0 ||
        affectedDims > 0
      ) {
        const ok = window.confirm(
          `Delete this part along with ${preview.removedPartIds.length - 1} sub-part(s), ${preview.removedDrawingIds.length} drawing(s), and ${affectedDims} dimension(s)?`,
        );
        if (!ok) return;
      }

      for (const drwId of preview.removedDrawingIds) {
        try {
          await removeDrawingBytes(drwId);
        } catch {
          // ignore
        }
      }

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          parts: preview.remainingParts,
          drawings: prev.drawings.filter((d) => !removedSet.has(d.id)),
          dimensions: prev.dimensions.filter(
            (d) => !removedSet.has(d.drawingId ?? d.marker?.drawingId ?? ""),
          ),
        };
      });

      if (selectedPartId && preview.removedPartIds.includes(selectedPartId)) {
        setSelectedPartId(preview.remainingParts[0]?.id ?? null);
      }
      if (activePartId && preview.removedPartIds.includes(activePartId)) {
        setActivePartId(null);
      }
      if (activeDrawingId && removedSet.has(activeDrawingId)) {
        drawingLoadSeqRef.current += 1;
        setActiveDrawingId(null);
        setPdfBytes(null);
        setSelectedDimensionId(null);
        setEditingDimensionId(null);
        setPlacingDimensionId(null);
      }
      markDirty();
    },
    [project, selectedPartId, activePartId, activeDrawingId, markDirty],
  );

  const handleAttachPdf = useCallback(
    async (partId: string) => {
      if (!project) return;
      try {
        const path = await pickPdfFile();
        if (!path) return;
        const imported = await importPdf(path);
        const newDrawing = {
          id: imported.drawingId,
          filename: imported.filename,
          archivePath: `drawings/${imported.drawingId}.pdf`,
          pageCount: 1,
        };
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            drawings: [...prev.drawings, newDrawing],
            parts: prev.parts.map((p) =>
              p.id === partId
                ? { ...p, drawingIds: [...p.drawingIds, imported.drawingId] }
                : p,
            ),
          };
        });
        if (activePartId === partId) {
          drawingLoadSeqRef.current += 1;
          setActiveDrawingId(imported.drawingId);
          setPdfBytes(imported.pdfBytes);
          setCurrentPage(1);
          setSelectedDimensionId(null);
          setPlacingDimensionId(null);
          setFitRequestKey((k) => k + 1);
        }
        markDirty();
        showStatus("info", `Attached "${imported.filename}"`);
      } catch (err) {
        showStatus("error", err instanceof Error ? err.message : String(err));
      }
    },
    [project, activePartId, markDirty, showStatus],
  );

  const handleDetachPdf = useCallback(
    async (partId: string, drawingId: string) => {
      if (!project) return;
      const dimCount = project.dimensions.filter(
        (d) => (d.drawingId ?? d.marker?.drawingId ?? null) === drawingId,
      ).length;
      if (dimCount > 0) {
        const ok = window.confirm(
          `Remove this drawing and its ${dimCount} dimension(s)?`,
        );
        if (!ok) return;
      }
      const ownerPart = project.parts.find((p) => p.id === partId);
      const fallbackDrawingId =
        ownerPart?.drawingIds.find((id) => id !== drawingId) ?? null;

      try {
        await removeDrawingBytes(drawingId);
      } catch {
        // ignore
      }
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          parts: prev.parts.map((p) =>
            p.id === partId
              ? { ...p, drawingIds: p.drawingIds.filter((id) => id !== drawingId) }
              : p,
          ),
          drawings: prev.drawings.filter((d) => d.id !== drawingId),
          dimensions: prev.dimensions.filter(
            (d) => (d.drawingId ?? d.marker?.drawingId ?? null) !== drawingId,
          ),
        };
      });
      if (activeDrawingId === drawingId) {
        const seq = ++drawingLoadSeqRef.current;
        if (fallbackDrawingId) {
          try {
            const bytes = await getDrawingBytes(fallbackDrawingId);
            if (drawingLoadSeqRef.current === seq) {
              setActiveDrawingId(fallbackDrawingId);
              setPdfBytes(bytes);
              setCurrentPage(1);
              setSelectedDimensionId(null);
              setEditingDimensionId(null);
              setPlacingDimensionId(null);
              setFitRequestKey((k) => k + 1);
            }
          } catch {
            if (drawingLoadSeqRef.current === seq) {
              setActiveDrawingId(null);
              setPdfBytes(null);
            }
          }
        } else {
          setActiveDrawingId(null);
          setPdfBytes(null);
          setDrawingSidebarView("drawings");
          setSelectedDimensionId(null);
          setEditingDimensionId(null);
          setPlacingDimensionId(null);
        }
      }
      markDirty();
    },
    [project, activeDrawingId, markDirty],
  );

  const handleCancelEditing = useCallback(() => {
    const origin = editingOriginRef.current;
    editingOriginRef.current = null;
    if (origin) {
      if (origin.isNew) {
        setProject((prev) =>
          prev
            ? {
                ...prev,
                dimensions: prev.dimensions.filter((d) => d.id !== origin.id),
              }
            : prev,
        );
        setSelectedDimensionId((prev) => (prev === origin.id ? null : prev));
      } else if (origin.snapshot) {
        const snap = origin.snapshot;
        setProject((prev) =>
          prev
            ? {
                ...prev,
                dimensions: prev.dimensions.map((d) =>
                  d.id === origin.id ? snap : d,
                ),
              }
            : prev,
        );
      }
    }
    setEditingDimensionId(null);
    setPlacingDimensionId(null);
  }, []);

  const handleActivatePart = useCallback(
    async (partId: string) => {
      if (!project) return;
      const part = project.parts.find((p) => p.id === partId);
      if (!part) return;
      if (editingDimensionId) {
        handleCancelEditing();
      }
      setActivePartId(partId);
      setSelectedPartId(partId);
      setDrawingSidebarView("drawings");

      const partLabel = part.name.trim() || "Untitled Part";
      if (part.drawingIds.length === 0) {
        drawingLoadSeqRef.current += 1;
        setActiveDrawingId(null);
        setPdfBytes(null);
        setSelectedDimensionId(null);
        setPlacingDimensionId(null);
        showStatus("info", `Activated "${partLabel}" (no drawing attached)`);
        return;
      }

      const targetDrawingId =
        activeDrawingId && part.drawingIds.includes(activeDrawingId)
          ? activeDrawingId
          : part.drawingIds[0];

      if (targetDrawingId !== activeDrawingId || !pdfBytes) {
        const seq = ++drawingLoadSeqRef.current;
        try {
          const bytes = await getDrawingBytes(targetDrawingId);
          if (drawingLoadSeqRef.current !== seq) return;
          setActiveDrawingId(targetDrawingId);
          setPdfBytes(bytes);
          setCurrentPage(1);
          setSelectedDimensionId(null);
          setPlacingDimensionId(null);
          setFitRequestKey((k) => k + 1);
        } catch (err) {
          showStatus("error", err instanceof Error ? err.message : String(err));
          return;
        }
      }
      showStatus("info", `Activated "${partLabel}"`);
    },
    [
      project,
      editingDimensionId,
      handleCancelEditing,
      activeDrawingId,
      pdfBytes,
      showStatus,
    ],
  );

  const handleOpenDrawing = useCallback(
    async (drawingId: string) => {
      if (!project) return;
      if (editingDimensionId) {
        handleCancelEditing();
      }
      const ownerPart = project.parts.find((p) =>
        p.drawingIds.includes(drawingId),
      );
      if (ownerPart) {
        setActivePartId(ownerPart.id);
        setSelectedPartId(ownerPart.id);
      }
      try {
        if (drawingId !== activeDrawingId || !pdfBytes) {
          const seq = ++drawingLoadSeqRef.current;
          const bytes = await getDrawingBytes(drawingId);
          if (drawingLoadSeqRef.current !== seq) return;
          setActiveDrawingId(drawingId);
          setPdfBytes(bytes);
          setCurrentPage(1);
          setSelectedDimensionId(null);
          setPlacingDimensionId(null);
          setFitRequestKey((k) => k + 1);
        }
        setDrawingSidebarView("dimensions");
        setActiveModule("drawing");
      } catch (err) {
        showStatus("error", err instanceof Error ? err.message : String(err));
      }
    },
    [
      project,
      editingDimensionId,
      handleCancelEditing,
      activeDrawingId,
      pdfBytes,
      showStatus,
    ],
  );

  const handleSelectModule = useCallback(
    (module: ActiveModule) => {
      if (module !== "drawing" && editingDimensionId) {
        handleCancelEditing();
      }
      setActiveModule(module);
    },
    [editingDimensionId, handleCancelEditing],
  );

  // Drawing / Dimension handlers
  const handlePageCountLoaded = useCallback(
    (count: number) => {
      if (!activeDrawingId) return;
      setProject((prev) => {
        if (!prev) return prev;
        const idx = prev.drawings.findIndex((d) => d.id === activeDrawingId);
        if (idx === -1 || prev.drawings[idx].pageCount === count) return prev;
        const drawings = [...prev.drawings];
        drawings[idx] = { ...drawings[idx], pageCount: count };
        return { ...prev, drawings };
      });
    },
    [activeDrawingId],
  );

  const handleAddDimension = useCallback(() => {
    if (!project || !activeDrawingId) return;
    const nextDim = createDimension(activeDrawingDimensions, activeDrawingId);
    editingOriginRef.current = { id: nextDim.id, isNew: true, snapshot: null };
    setProject({
      ...project,
      dimensions: [nextDim, ...project.dimensions],
    });
    setSelectedDimensionId(nextDim.id);
    setEditingDimensionId(nextDim.id);
    setPlacingDimensionId(nextDim.id);
    setFocusNameKey((k) => k + 1);
    markDirty();
  }, [project, activeDrawingId, activeDrawingDimensions, markDirty]);

  const handleStartEditing = useCallback(
    (id: string) => {
      const existing = project?.dimensions.find((d) => d.id === id) ?? null;
      editingOriginRef.current = {
        id,
        isNew: false,
        snapshot: existing
          ? {
              ...existing,
              marker: existing.marker ? { ...existing.marker } : null,
            }
          : null,
      };
      setSelectedDimensionId(id);
      setEditingDimensionId(id);
      setFocusNameKey((k) => k + 1);
    },
    [project],
  );

  const handleFinishEditing = useCallback(() => {
    if (editingDimensionId && project) {
      const currentDim = project.dimensions.find(
        (d) => d.id === editingDimensionId,
      );
      if (currentDim) {
        const idErr = validateDimensionId(
          currentDim.name,
          currentDim.id,
          activeDrawingDimensions,
        );
        if (idErr) return;

        const trimmedName = currentDim.name.trim();
        const trimmedType = (currentDim.dimensionType ?? "").trim();
        if (
          trimmedName !== currentDim.name ||
          trimmedType !== (currentDim.dimensionType ?? "")
        ) {
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  dimensions: prev.dimensions.map((d) =>
                    d.id === currentDim.id
                      ? { ...d, name: trimmedName, dimensionType: trimmedType }
                      : d,
                  ),
                }
              : prev,
          );
        }
      }
    }
    editingOriginRef.current = null;
    setEditingDimensionId(null);
    setPlacingDimensionId(null);
  }, [editingDimensionId, project, activeDrawingDimensions]);

  // Global keyboard shortcuts: Esc cancels editing/placement, Cmd/Ctrl+S saves
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingDimensionId) {
          handleCancelEditing();
        } else if (placingDimensionId) {
          setPlacingDimensionId(null);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (project) {
          e.preventDefault();
          void persistProject(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editingDimensionId,
    placingDimensionId,
    project,
    handleCancelEditing,
    persistProject,
  ]);

  const handleSelectFromSidebar = useCallback(
    (id: string) => {
      setSelectedDimensionId(id);
      const dim = activeDrawingDimensions.find((d) => d.id === id);
      if (dim?.marker) {
        setCurrentPage(dim.marker.page);
        setScrollToPageRequest({
          page: dim.marker.page,
          marker: dim.marker,
          key: Date.now(),
        });
      }
    },
    [activeDrawingDimensions],
  );

  const handleSelectFromDrawing = useCallback((id: string) => {
    setSelectedDimensionId(id);
  }, []);

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
      setEditingDimensionId((prev) => (prev === id ? null : prev));
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
            d.id === dimensionId
              ? { ...d, drawingId: marker.drawingId, marker }
              : d,
          ),
        };
      });
      setPlacingDimensionId(null);
      setSelectedDimensionId(dimensionId);
      if (
        editingDimensionId === dimensionId &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        setFocusNameKey((k) => k + 1);
      }
      markDirty();
    },
    [editingDimensionId, markDirty],
  );

  const handleMoveMarker = useCallback(
    (
      dimensionId: string,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.id === dimensionId && d.marker
              ? { ...d, marker: { ...d.marker, x, y, width, height } }
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

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <MenuBar
        projectName={project?.name ?? null}
        isDirty={isDirty}
        hasProject={project !== null}
        onNewProject={() => void handleNewProject()}
        onOpenPdf={() => void handleOpenPdf()}
        onOpenProject={() => void handleOpenProject()}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onCloseProject={() => void handleCloseProject()}
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
        <ActivityBar
          activeModule={activeModule}
          onSelectModule={handleSelectModule}
          hasActiveDrawing={activeDrawingId !== null}
        />

        {!project ? (
          <main className="flex flex-1 items-center justify-center bg-neutral-900 p-8">
            <div className="max-w-lg rounded-xl border border-neutral-800 bg-neutral-950/90 p-8 text-center shadow-xl">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-800 text-lg font-bold text-neutral-100 ring-1 ring-neutral-700">
                DM
              </div>
              <h1 className="text-lg font-semibold text-neutral-100">
                DM-One Dimension Manager
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                Create a new multi-part BOM project, open a PDF engineering
                drawing directly, or resume an existing{" "}
                <span className="font-mono text-neutral-300">.dmone</span>{" "}
                project.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleNewProject()}
                  className="inline-flex items-center gap-2 rounded-md bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-950 hover:bg-white"
                >
                  <FolderPlus className="h-4 w-4" />
                  New Project
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenPdf()}
                  className="inline-flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
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
        ) : activeModule === "project" ? (
          <ProjectWorkspace
            project={project}
            selectedPartId={selectedPartId}
            activePartId={activePartId}
            onSelectPart={setSelectedPartId}
            onActivatePart={(id) => void handleActivatePart(id)}
            onRenameProject={handleRenameProject}
            onAddPart={handleAddPart}
            onUpdatePart={handleUpdatePart}
            onReparentPart={handleReparentPart}
            onDeletePart={(id) => void handleDeletePart(id)}
            onAttachPdf={(id) => void handleAttachPdf(id)}
            onDetachPdf={(partId, drwId) => void handleDetachPdf(partId, drwId)}
            onOpenDrawing={(drwId) => void handleOpenDrawing(drwId)}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            <aside className="flex w-80 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
              {drawingSidebarView === "dimensions" && activeDrawing ? (
                <DimensionSidebar
                  dimensions={activeDrawingDimensions}
                  selectedDimensionId={selectedDimensionId}
                  editingDimensionId={editingDimensionId}
                  placingDimensionId={placingDimensionId}
                  focusNameKey={focusNameKey}
                  hasProject={activeDrawingId !== null}
                  activeDrawingFilename={activeDrawing.filename}
                  onBackToDrawings={() => {
                    if (editingDimensionId) {
                      handleCancelEditing();
                    }
                    setDrawingSidebarView("drawings");
                  }}
                  onAddDimension={handleAddDimension}
                  onSelectDimension={handleSelectFromSidebar}
                  onStartEditing={handleStartEditing}
                  onFinishEditing={handleFinishEditing}
                  onCancelEditing={handleCancelEditing}
                  onUpdateDimension={handleUpdateDimension}
                  onDeleteDimension={handleDeleteDimension}
                  onStartPlacing={setPlacingDimensionId}
                  onClearMarker={handleClearMarker}
                />
              ) : (
                <DrawingListSidebar
                  activePart={activePart}
                  drawings={activePartDrawings}
                  activeDrawingId={activeDrawingId}
                  dimCountByDrawing={dimCountByDrawing}
                  onUploadPdf={() => {
                    if (activePart) void handleAttachPdf(activePart.id);
                  }}
                  onSelectDrawing={(drwId) => void handleOpenDrawing(drwId)}
                  onRemoveDrawing={(drwId) => {
                    if (activePart) void handleDetachPdf(activePart.id, drwId);
                  }}
                  onGoToProject={() => setActiveModule("project")}
                />
              )}
            </aside>

            {activeDrawing && pdfBytes ? (
              <PdfViewer
                pdfBytes={pdfBytes}
                drawingId={activeDrawing.id}
                drawingFilename={activeDrawing.filename}
                drawingOptions={drawingSwitchOptions}
                onSwitchDrawing={(drwId) => void handleOpenDrawing(drwId)}
                currentPage={currentPage}
                pageCount={pageCount}
                zoom={zoom}
                fitRequestKey={fitRequestKey}
                scrollToPageRequest={scrollToPageRequest}
                dimensions={activeDrawingDimensions}
                selectedDimensionId={selectedDimensionId}
                editingDimensionId={editingDimensionId}
                placingDimensionId={placingDimensionId}
                onPageCountLoaded={handlePageCountLoaded}
                onPageChange={setCurrentPage}
                onZoomChange={setZoom}
                onFitToView={() => setFitRequestKey((k) => k + 1)}
                onPlaceMarker={handlePlaceMarker}
                onSelectDimension={handleSelectFromDrawing}
                onMoveMarker={handleMoveMarker}
                onCancelPlacing={() => setPlacingDimensionId(null)}
              />
            ) : (
              <main className="flex flex-1 items-center justify-center bg-neutral-900 p-8">
                <div className="max-w-sm rounded-xl border border-neutral-800 bg-neutral-950/90 p-6 text-center shadow-xl">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300">
                    <Network className="h-5 w-5" />
                  </div>
                  <h2 className="text-sm font-semibold text-neutral-100">
                    {activePart
                      ? `No Drawing Attached`
                      : `No Drawing Active`}
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                    {activePart ? (
                      <>
                        Active part{" "}
                        <span className="font-medium text-neutral-200">
                          {activePart.name.trim() || "Untitled Part"}
                        </span>{" "}
                        has no PDF drawing attached yet.
                      </>
                    ) : (
                      <>
                        Activate a part in the{" "}
                        <span className="font-medium text-neutral-200">
                          Project
                        </span>{" "}
                        module to display its PDF drawing here.
                      </>
                    )}
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    {activePart && (
                      <button
                        type="button"
                        onClick={() => void handleAttachPdf(activePart.id)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-3.5 py-2 text-xs font-medium text-neutral-950 hover:bg-white"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                        Attach PDF
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveModule("project")}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium ${
                        activePart
                          ? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                          : "bg-neutral-100 text-neutral-950 hover:bg-white"
                      }`}
                    >
                      <Network className="h-3.5 w-3.5" />
                      Go to Project
                    </button>
                  </div>
                </div>
              </main>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
