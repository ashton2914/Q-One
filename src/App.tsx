import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Network,
  X,
} from "lucide-react";
import { ActivityBar } from "./components/ActivityBar";
import { AnnotationsWorkspace } from "./components/AnnotationsWorkspace";
import { DimensionSidebar } from "./components/DimensionSidebar";
import { DrawingListSidebar } from "./components/DrawingListSidebar";
import { MenuBar } from "./components/MenuBar";
import {
  PdfViewer,
  type DrawingSwitchOption,
  type PointEntrySession,
  type ScrollToPageRequest,
} from "./components/PdfViewer";
import { ProjectWorkspace } from "./components/ProjectWorkspace";
import { QOneLogo } from "./components/QOneLogo";
import { Button, EmptyState } from "./components/ui";
import { confirmAction } from "./lib/confirm";
import {
  createDimension,
  createProjectFromPdf,
  duplicateDimension,
  duplicateDimensionsBatch,
  getAnnotationPage,
  insertDimensionAtSlot,
  insertDimensionsAtSlot,
  reorderWithinSection,
  replaceDrawingDimensionsOrder,
  resolveAdjacentDimensionId,
  sortDrawingAnnotations,
  validateDimensionId,
} from "./lib/dimensions";
import {
  addPointsToGroup,
  computeCalibratedPointCoords,
  createEmptyCalibration,
  createPointGroup,
  formatPointGroupDefaultName,
  hasPointIdCollisionOnPage,
  incrementPointId,
  prunePointGroups,
  recalculatePointGroupCoordinates,
  rebindSamePageLinkedPoints,
  removePointsFromGroups,
  resolveUniquePointIdOnPage,
  suggestNextPointIdForGroup,
} from "./lib/pointGroups";
import {
  createAnnotationRevision,
  duplicateAnnotationRevisionData,
  hasAnnotationRevisionNameCollision,
  makeDefaultAnnotationRevisionId,
  nextAnnotationRevisionName,
  resolveLatestAnnotationRevisionId,
  resolveUniqueAnnotationRevisionName,
} from "./lib/annotationRevisions";
import {
  createDefaultGdtSpec,
  createDefaultPointSpec,
  getAnnotationKind,
} from "./lib/annotations";
import {
  POINT_CAPTURE_STEPS,
  parseAnnotationFromRegionText,
  parsePointFromFieldCaptures,
  type PointCaptureField,
} from "./lib/annotationRecognize";
import { extractTextLinesInMarker } from "./lib/pdfTextExtract";
import {
  createEmptyProject,
  createPart,
  deletePartSubtree,
  normalizeLoadedProject,
  reparentPart,
  resolveLatestDrawingId,
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
  computeHighlightUnionRegion,
  shouldBlockWindowClose,
  shouldClearDirtyAfterSave,
} from "./lib/viewerState";
import type {
  ActiveModule,
  AnnotationKind,
  Dimension,
  DrawingEntry,
  MarkerPosition,
  Part,
  PointGroup,
  PointGroupCalibration,
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
  const [activeAnnotationRevisionId, setActiveAnnotationRevisionId] = useState<
    string | null
  >(null);
  const [copiedReview, setCopiedReview] = useState<{
    drawingId: string;
    revisionId: string;
    reviewName: string;
  } | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [fitRequestKey, setFitRequestKey] = useState<number>(0);
  const [scrollToPageRequest, setScrollToPageRequest] =
    useState<ScrollToPageRequest | null>(null);
  const [scrollSidebarRequest, setScrollSidebarRequest] = useState<{
    id: string;
    key: number;
    block?: ScrollLogicalPosition;
  } | null>(null);

  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(
    null,
  );
  const [selectedDimensionIds, setSelectedDimensionIds] = useState<string[]>(
    [],
  );
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(
    null,
  );
  const [placingDimensionId, setPlacingDimensionId] = useState<string | null>(
    null,
  );
  const [pointCaptureState, setPointCaptureState] = useState<{
    dimensionId: string;
    page: number;
    stepIndex: number;
    boxes: Partial<
      Record<
        PointCaptureField,
        { page: number; x: number; y: number; width: number; height: number }
      >
    >;
  } | null>(null);
  const [pointEntrySession, setPointEntrySession] =
    useState<PointEntrySession | null>(null);
  const [copiedPointCalibration, setCopiedPointCalibration] =
    useState<PointGroupCalibration | null>(null);
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
  const pageAspectRatiosRef = useRef<number[]>([]);
  const suppressPdfToSidebarSyncUntilRef = useRef<number>(0);
  const lastSelectedDimensionIdRef = useRef<string | null>(null);
  const applyPointCaptureRef = useRef<() => Promise<void>>(async () => {});
  const advancePointCaptureStepRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (selectedDimensionId) {
      lastSelectedDimensionIdRef.current = selectedDimensionId;
    }
  }, [selectedDimensionId]);

  useEffect(() => {
    if (
      pointCaptureState &&
      (!editingDimensionId ||
        pointCaptureState.dimensionId !== editingDimensionId)
    ) {
      setPointCaptureState(null);
    }
  }, [editingDimensionId, pointCaptureState]);

  useEffect(() => {
    setPointEntrySession(null);
  }, [activeDrawingId]);

  const clearSelection = useCallback(() => {
    setSelectedDimensionId(null);
    setSelectedDimensionIds([]);
  }, []);

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

  const activePartLatestDrawingId = useMemo(
    () => (activePart ? resolveLatestDrawingId(activePart) : null),
    [activePart],
  );

  const dimCountByRevision = useMemo(() => {
    const byRevision = new Map<string, number>();
    if (!project) return byRevision;

    const latestByDrawing = new Map<string, string | null>();
    for (const drw of project.drawings) {
      latestByDrawing.set(drw.id, resolveLatestAnnotationRevisionId(drw));
    }

    for (const dim of project.dimensions) {
      const drwId = dim.drawingId ?? dim.marker?.drawingId ?? null;
      if (!drwId) continue;
      const latestRevId = latestByDrawing.get(drwId) ?? null;
      const revId = dim.annotationRevisionId ?? latestRevId;
      if (revId) {
        const key = `${drwId}::${revId}`;
        byRevision.set(key, (byRevision.get(key) ?? 0) + 1);
      }
    }
    return byRevision;
  }, [project]);

  const activeDrawing = useMemo(
    () => project?.drawings.find((d) => d.id === activeDrawingId) ?? null,
    [project, activeDrawingId],
  );
  const pageCount = activeDrawing?.pageCount ?? 1;

  const resolvedActiveRevisionId = useMemo(() => {
    if (!activeDrawing) return null;
    const revisions = activeDrawing.annotationRevisions ?? [];
    if (
      activeAnnotationRevisionId &&
      revisions.some((r) => r.id === activeAnnotationRevisionId)
    ) {
      return activeAnnotationRevisionId;
    }
    return resolveLatestAnnotationRevisionId(activeDrawing);
  }, [activeDrawing, activeAnnotationRevisionId]);

  const activeAnnotationRevision = useMemo(() => {
    if (!activeDrawing || !resolvedActiveRevisionId) return null;
    return (
      (activeDrawing.annotationRevisions ?? []).find(
        (r) => r.id === resolvedActiveRevisionId,
      ) ?? null
    );
  }, [activeDrawing, resolvedActiveRevisionId]);

  const activeDrawingDimensions = useMemo(() => {
    if (!project || !activeDrawingId) return [];
    return project.dimensions.filter((d) => {
      if ((d.drawingId ?? d.marker?.drawingId ?? null) !== activeDrawingId) {
        return false;
      }
      if (!resolvedActiveRevisionId) return true;
      return (
        (d.annotationRevisionId ?? resolvedActiveRevisionId) ===
        resolvedActiveRevisionId
      );
    });
  }, [project, activeDrawingId, resolvedActiveRevisionId]);

  const activeDrawingPointGroups = useMemo(() => {
    if (!project || !activeDrawingId) return [];
    return (project.pointGroups ?? []).filter((g) => {
      if (g.drawingId !== activeDrawingId) return false;
      if (!resolvedActiveRevisionId) return true;
      return (
        (g.annotationRevisionId ?? resolvedActiveRevisionId) ===
        resolvedActiveRevisionId
      );
    });
  }, [project, activeDrawingId, resolvedActiveRevisionId]);

  // Keep selectedDimensionIds pruned to existing items on the active drawing
  useEffect(() => {
    const validIds = new Set(activeDrawingDimensions.map((d) => d.id));
    setSelectedDimensionIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [activeDrawingDimensions]);

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
      const drwTitle = drw.version?.trim()
        ? `Version: ${drw.version.trim()}`
        : drw.filename;
      const label = part
        ? `${part.name.trim() || "Untitled Part"} / ${drwTitle}`
        : drwTitle;
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

  const confirmDiscardIfDirty = useCallback(async (): Promise<boolean> => {
    if (!isDirty) return true;
    return confirmAction(
      "You have unsaved changes. Discard them and continue?",
      { title: "Unsaved Changes", kind: "warning" },
    );
  }, [isDirty]);

  const handleNewProject = useCallback(async () => {
    if (!(await confirmDiscardIfDirty())) return;
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
    if (!(await confirmDiscardIfDirty())) return;
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
    if (!(await confirmDiscardIfDirty())) return;
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
      setDrawingSidebarView("drawings");
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
      setActiveModule("project");
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
          const discard = await confirmAction(
            "You have unsaved changes. Discard them and close Q-One?",
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
    if (!(await confirmDiscardIfDirty())) return;
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
      const targetPart = project.parts.find((p) => p.id === partId);
      const partLabel = targetPart?.name.trim() || "Untitled Part";
      const preview = deletePartSubtree(project.parts, partId);
      const removedSet = new Set(preview.removedDrawingIds);
      const affectedDims = project.dimensions.filter((d) =>
        removedSet.has(d.drawingId ?? d.marker?.drawingId ?? ""),
      ).length;

      const hasNestedImpact =
        preview.removedPartIds.length > 1 ||
        preview.removedDrawingIds.length > 0 ||
        affectedDims > 0;
      const message = hasNestedImpact
        ? `Delete "${partLabel}" along with ${preview.removedPartIds.length - 1} sub-part(s), ${preview.removedDrawingIds.length} drawing(s), and ${affectedDims} dimension(s)?`
        : `Delete part "${partLabel}"?`;
      const ok = await confirmAction(message, {
        title: "Delete Part",
        kind: "warning",
      });
      if (!ok) return;

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
        const defaultRevId = makeDefaultAnnotationRevisionId(
          imported.drawingId,
        );
        const newDrawing = {
          id: imported.drawingId,
          version: "",
          filename: imported.filename,
          archivePath: `drawings/${imported.drawingId}.pdf`,
          pageCount: 1,
          annotationRevisions: [
            createAnnotationRevision("Review 1", defaultRevId),
          ],
          latestAnnotationRevisionId: defaultRevId,
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
          setActiveAnnotationRevisionId(defaultRevId);
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

  const handleUpdateDrawingVersion = useCallback(
    (drawingId: string, version: string) => {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              drawings: prev.drawings.map((d) =>
                d.id === drawingId ? { ...d, version } : d,
              ),
            }
          : prev,
      );
      markDirty();
    },
    [markDirty],
  );

  const handleMarkLatestDrawing = useCallback(
    (partId: string, drawingId: string) => {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) =>
                p.id === partId ? { ...p, latestDrawingId: drawingId } : p,
              ),
            }
          : prev,
      );
      markDirty();
    },
    [markDirty],
  );

  const handleReorderDrawings = useCallback(
    (partId: string, orderedDrawingIds: string[]) => {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) =>
                p.id === partId ? { ...p, drawingIds: orderedDrawingIds } : p,
              ),
            }
          : prev,
      );
      markDirty();
    },
    [markDirty],
  );

  const handleDuplicateAnnotationRevision = useCallback(
    (drawingId: string, sourceRevisionId: string) => {
      if (!project) return;
      const drawing = project.drawings.find((d) => d.id === drawingId);
      if (!drawing) return;
      const revisions = drawing.annotationRevisions ?? [];
      const sourceRev = revisions.find((r) => r.id === sourceRevisionId);
      const newRev = createAnnotationRevision(
        nextAnnotationRevisionName(revisions),
      );
      const { clonedDimensions, clonedPointGroups } =
        duplicateAnnotationRevisionData({
          drawingId,
          sourceRevisionId,
          targetRevisionId: newRev.id,
          dimensions: project.dimensions,
          pointGroups: project.pointGroups ?? [],
        });

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawings: prev.drawings.map((d) =>
            d.id === drawingId
              ? {
                  ...d,
                  annotationRevisions: [...(d.annotationRevisions ?? []), newRev],
                }
              : d,
          ),
          dimensions: [...prev.dimensions, ...clonedDimensions],
          pointGroups: [...(prev.pointGroups ?? []), ...clonedPointGroups],
        };
      });
      markDirty();
      showStatus(
        "info",
        `Duplicated "${sourceRev?.name ?? "Review"}" → "${newRev.name}" (${clonedDimensions.length} annotations)`,
      );
    },
    [project, markDirty, showStatus],
  );

  const handleCopyAnnotationRevision = useCallback(
    (drawingId: string, revisionId: string) => {
      if (!project) return;
      const drawing = project.drawings.find((d) => d.id === drawingId);
      const rev = drawing?.annotationRevisions?.find(
        (r) => r.id === revisionId,
      );
      if (!drawing || !rev) return;
      setCopiedReview({
        drawingId,
        revisionId,
        reviewName: rev.name,
      });
      showStatus(
        "info",
        `Copied "${rev.name}" — right-click any drawing version to paste`,
      );
    },
    [project, showStatus],
  );

  const handlePasteAnnotationRevision = useCallback(
    (targetDrawingId: string) => {
      if (!project || !copiedReview) return;
      const sourceDrawing = project.drawings.find(
        (d) => d.id === copiedReview.drawingId,
      );
      const sourceRev = sourceDrawing?.annotationRevisions?.find(
        (r) => r.id === copiedReview.revisionId,
      );
      const targetDrawing = project.drawings.find(
        (d) => d.id === targetDrawingId,
      );
      if (!sourceDrawing || !sourceRev || !targetDrawing) {
        setCopiedReview(null);
        showStatus("error", "Copied review is no longer available");
        return;
      }

      const targetRevisions = targetDrawing.annotationRevisions ?? [];
      const uniqueName = resolveUniqueAnnotationRevisionName(
        targetRevisions,
        sourceRev.name,
      );
      const newRev = createAnnotationRevision(uniqueName);
      const { clonedDimensions, clonedPointGroups } =
        duplicateAnnotationRevisionData({
          drawingId: copiedReview.drawingId,
          targetDrawingId,
          targetDrawingPageCount: targetDrawing.pageCount,
          sourceRevisionId: copiedReview.revisionId,
          targetRevisionId: newRev.id,
          dimensions: project.dimensions,
          pointGroups: project.pointGroups ?? [],
        });

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawings: prev.drawings.map((d) =>
            d.id === targetDrawingId
              ? {
                  ...d,
                  annotationRevisions: [...(d.annotationRevisions ?? []), newRev],
                }
              : d,
          ),
          dimensions: [...prev.dimensions, ...clonedDimensions],
          pointGroups: [...(prev.pointGroups ?? []), ...clonedPointGroups],
        };
      });
      markDirty();
      const targetLabel = targetDrawing.version?.trim()
        ? `Version ${targetDrawing.version.trim()}`
        : targetDrawing.filename;
      showStatus(
        "info",
        `Pasted "${newRev.name}" into ${targetLabel} (${clonedDimensions.length} annotations)`,
      );
    },
    [project, copiedReview, markDirty, showStatus],
  );

  const handleCreateBlankAnnotationRevision = useCallback(
    (drawingId: string) => {
      if (!project) return;
      const drawing = project.drawings.find((d) => d.id === drawingId);
      if (!drawing) return;
      const revisions = drawing.annotationRevisions ?? [];
      const newRev = createAnnotationRevision(
        nextAnnotationRevisionName(revisions),
      );
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawings: prev.drawings.map((d) =>
            d.id === drawingId
              ? {
                  ...d,
                  annotationRevisions: [...(d.annotationRevisions ?? []), newRev],
                }
              : d,
          ),
        };
      });
      markDirty();
      showStatus("info", `Created review "${newRev.name}"`);
    },
    [project, markDirty, showStatus],
  );

  const handleRenameAnnotationRevision = useCallback(
    (drawingId: string, revisionId: string, name: string) => {
      if (!project) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const drawing = project.drawings.find((d) => d.id === drawingId);
      if (!drawing) return;
      const revisions = drawing.annotationRevisions ?? [];
      if (hasAnnotationRevisionNameCollision(revisions, trimmed, revisionId)) {
        showStatus(
          "error",
          `Review name "${trimmed}" already exists on this drawing`,
        );
        return;
      }
      const current = revisions.find((r) => r.id === revisionId);
      if (current && current.name === trimmed) return;
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawings: prev.drawings.map((d) =>
            d.id === drawingId
              ? {
                  ...d,
                  annotationRevisions: (d.annotationRevisions ?? []).map((r) =>
                    r.id === revisionId ? { ...r, name: trimmed } : r,
                  ),
                }
              : d,
          ),
        };
      });
      markDirty();
    },
    [project, markDirty, showStatus],
  );

  const handleMarkLatestAnnotationRevision = useCallback(
    (drawingId: string, revisionId: string) => {
      if (!project) return;
      const drawing = project.drawings.find((d) => d.id === drawingId);
      const targetRev = drawing?.annotationRevisions?.find(
        (r) => r.id === revisionId,
      );
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawings: prev.drawings.map((d) =>
            d.id === drawingId
              ? { ...d, latestAnnotationRevisionId: revisionId }
              : d,
          ),
        };
      });
      markDirty();
      if (targetRev) {
        showStatus("info", `Marked "${targetRev.name}" as Selected`);
      }
    },
    [project, markDirty, showStatus],
  );

  const handleDeleteAnnotationRevision = useCallback(
    async (drawingId: string, revisionId: string) => {
      if (!project) return;
      const drawing = project.drawings.find((d) => d.id === drawingId);
      if (!drawing) return;
      const revisions = drawing.annotationRevisions ?? [];
      if (revisions.length <= 1) {
        showStatus("info", "Cannot delete the only review on a drawing");
        return;
      }
      const targetRev = revisions.find((r) => r.id === revisionId);
      if (!targetRev) return;

      const count = project.dimensions.filter(
        (d) =>
          (d.drawingId ?? d.marker?.drawingId ?? null) === drawingId &&
          d.annotationRevisionId === revisionId,
      ).length;

      const confirmed = await confirmAction(
        `Delete review "${targetRev.name}"${count > 0 ? ` and its ${count} annotation(s)` : ""}?`,
        { title: "Delete Review", kind: "warning" },
      );
      if (!confirmed) return;

      const remainingRevs = revisions.filter((r) => r.id !== revisionId);
      const nextLatestId =
        drawing.latestAnnotationRevisionId === revisionId
          ? remainingRevs[remainingRevs.length - 1]?.id ?? null
          : drawing.latestAnnotationRevisionId ?? null;

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawings: prev.drawings.map((d) =>
            d.id === drawingId
              ? {
                  ...d,
                  annotationRevisions: remainingRevs,
                  latestAnnotationRevisionId: nextLatestId,
                }
              : d,
          ),
          dimensions: prev.dimensions.filter(
            (d) =>
              !(
                (d.drawingId ?? d.marker?.drawingId ?? null) === drawingId &&
                d.annotationRevisionId === revisionId
              ),
          ),
          pointGroups: (prev.pointGroups ?? []).filter(
            (g) =>
              !(
                g.drawingId === drawingId &&
                g.annotationRevisionId === revisionId
              ),
          ),
        };
      });

      if (
        activeDrawingId === drawingId &&
        resolvedActiveRevisionId === revisionId
      ) {
        setActiveAnnotationRevisionId(nextLatestId);
        setSelectedDimensionId(null);
        setPlacingDimensionId(null);
        setEditingDimensionId(null);
      }

      markDirty();
      showStatus("info", `Deleted review "${targetRev.name}"`);
    },
    [
      project,
      activeDrawingId,
      resolvedActiveRevisionId,
      markDirty,
      showStatus,
    ],
  );

  const handleDetachPdf = useCallback(
    async (partId: string, drawingId: string) => {
      if (!project) return;
      const drw = project.drawings.find((d) => d.id === drawingId);
      const drwLabel = drw?.version?.trim()
        ? `Version: ${drw.version.trim()} (${drw.filename})`
        : drw?.filename ?? "this drawing";
      const dimCount = project.dimensions.filter(
        (d) => (d.drawingId ?? d.marker?.drawingId ?? null) === drawingId,
      ).length;
      const message =
        dimCount > 0
          ? `Delete ${drwLabel} and its ${dimCount} dimension(s)?`
          : `Delete ${drwLabel}?`;
      const ok = await confirmAction(message, {
        title: "Delete Drawing",
        kind: "warning",
      });
      if (!ok) return;
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
              ? {
                  ...p,
                  drawingIds: p.drawingIds.filter((id) => id !== drawingId),
                  latestDrawingId:
                    p.latestDrawingId === drawingId ? null : p.latestDrawingId,
                }
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
      const isSwitchingPart = partId !== activePartId;
      setActivePartId(partId);
      setSelectedPartId(partId);
      if (isSwitchingPart) {
        setDrawingSidebarView("drawings");
      }

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

      const preferredLatestId =
        resolveLatestDrawingId(part) ?? part.drawingIds[0];
      const targetDrawingId =
        activeDrawingId && part.drawingIds.includes(activeDrawingId)
          ? activeDrawingId
          : preferredLatestId;

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
      activePartId,
      editingDimensionId,
      handleCancelEditing,
      activeDrawingId,
      pdfBytes,
      showStatus,
    ],
  );

  const handleOpenDrawing = useCallback(
    async (drawingId: string, revisionId?: string | null) => {
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
      const targetDrawing = project.drawings.find((d) => d.id === drawingId);
      const nextRevId =
        revisionId ?? resolveLatestAnnotationRevisionId(targetDrawing);
      try {
        if (drawingId !== activeDrawingId || !pdfBytes) {
          const seq = ++drawingLoadSeqRef.current;
          const bytes = await getDrawingBytes(drawingId);
          if (drawingLoadSeqRef.current !== seq) return;
          setActiveDrawingId(drawingId);
          setActiveAnnotationRevisionId(nextRevId);
          setPdfBytes(bytes);
          setCurrentPage(1);
          setSelectedDimensionId(null);
          setPlacingDimensionId(null);
          setFitRequestKey((k) => k + 1);
        } else if (nextRevId !== resolvedActiveRevisionId) {
          setActiveAnnotationRevisionId(nextRevId);
          setSelectedDimensionId(null);
          setPlacingDimensionId(null);
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
      resolvedActiveRevisionId,
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
    (count: number, aspectRatios?: number[]) => {
      if (aspectRatios) {
        pageAspectRatiosRef.current = aspectRatios;
      }
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

  const handleSortDimensions = useCallback(() => {
    if (!activeDrawingId) return;
    setProject((prev) => {
      if (!prev) return prev;
      const active = prev.dimensions.filter(
        (d) =>
          (d.drawingId ?? d.marker?.drawingId ?? null) === activeDrawingId &&
          (!resolvedActiveRevisionId ||
            (d.annotationRevisionId ?? resolvedActiveRevisionId) ===
              resolvedActiveRevisionId),
      );
      if (active.length < 2) return prev;
      const sorted = sortDrawingAnnotations(active);
      return {
        ...prev,
        dimensions: replaceDrawingDimensionsOrder(
          prev.dimensions,
          activeDrawingId,
          sorted,
          resolvedActiveRevisionId,
        ),
      };
    });
    markDirty();
    showStatus("info", "Sorted annotations");
  }, [activeDrawingId, resolvedActiveRevisionId, markDirty, showStatus]);

  const handleReorderDimensions = useCallback(
    (sourceId: string, targetSectionSlot: number) => {
      if (!activeDrawingId) return;
      let changed = false;
      setProject((prev) => {
        if (!prev) return prev;
        const active = prev.dimensions.filter(
          (d) =>
            (d.drawingId ?? d.marker?.drawingId ?? null) === activeDrawingId &&
            (!resolvedActiveRevisionId ||
              (d.annotationRevisionId ?? resolvedActiveRevisionId) ===
                resolvedActiveRevisionId),
        );
        const reordered = reorderWithinSection(
          active,
          sourceId,
          targetSectionSlot,
        );
        const sameOrder =
          reordered.length === active.length &&
          reordered.every((d, i) => d.id === active[i].id);
        if (sameOrder) return prev;
        changed = true;
        return {
          ...prev,
          dimensions: replaceDrawingDimensionsOrder(
            prev.dimensions,
            activeDrawingId,
            reordered,
            resolvedActiveRevisionId,
          ),
        };
      });
      if (changed) {
        markDirty();
      }
    },
    [activeDrawingId, resolvedActiveRevisionId, markDirty],
  );

  const handleAddDimension = useCallback(
    (insertSlot?: number, explicitPage?: number | null) => {
      if (!project || !activeDrawingId) return;

      // Resolve insertion slot & locked owning page
      let resolvedSlot = insertSlot;
      let owningPage: number | null =
        explicitPage !== undefined ? explicitPage : null;

      if (resolvedSlot === undefined) {
        const anchorId =
          selectedDimensionId ?? lastSelectedDimensionIdRef.current;
        if (anchorId) {
          const selIdx = activeDrawingDimensions.findIndex(
            (d) => d.id === anchorId,
          );
          if (selIdx !== -1) {
            resolvedSlot = selIdx + 1;
            if (explicitPage === undefined) {
              owningPage =
                getAnnotationPage(activeDrawingDimensions[selIdx]) ??
                currentPage;
            }
          }
        }
        if (resolvedSlot === undefined) {
          const targetP = owningPage ?? currentPage;
          const lastOnPageIdx = activeDrawingDimensions.reduce(
            (acc, d, idx) => (getAnnotationPage(d) === targetP ? idx : acc),
            -1,
          );
          resolvedSlot =
            lastOnPageIdx !== -1
              ? lastOnPageIdx + 1
              : activeDrawingDimensions.length;
        }
      }

      if (owningPage === null && explicitPage === undefined) {
        owningPage = currentPage;
      }

      const nextDim = {
        ...createDimension(activeDrawingDimensions, activeDrawingId, owningPage),
        annotationRevisionId: resolvedActiveRevisionId,
      };
      editingOriginRef.current = { id: nextDim.id, isNew: true, snapshot: null };

      setProject({
        ...project,
        dimensions: insertDimensionAtSlot(
          project.dimensions,
          activeDrawingId,
          nextDim,
          resolvedSlot,
          resolvedActiveRevisionId,
        ),
      });
      setSelectedDimensionId(nextDim.id);
      setSelectedDimensionIds([nextDim.id]);
      setEditingDimensionId(nextDim.id);
      setPlacingDimensionId(nextDim.id);
      setFocusNameKey((k) => k + 1);
      setScrollSidebarRequest({ id: nextDim.id, key: Date.now() });
      if (owningPage !== null && owningPage !== currentPage) {
        setCurrentPage(owningPage);
        setScrollToPageRequest({ page: owningPage, key: Date.now() });
      }
      markDirty();
    },
    [
      project,
      activeDrawingId,
      activeDrawingDimensions,
      selectedDimensionId,
      currentPage,
      markDirty,
    ],
  );

  const handleCreatePointGroup = useCallback(
    (pointIds: string[]) => {
      if (!project || !activeDrawingId || pointIds.length < 2) return;
      const idSet = new Set(pointIds);
      const selectedPoints = activeDrawingDimensions.filter(
        (d) => idSet.has(d.id) && getAnnotationKind(d) === "point",
      );
      if (selectedPoints.length < 2) return;
      const page = getAnnotationPage(selectedPoints[0]);
      if (
        page === null ||
        selectedPoints.some((p) => getAnnotationPage(p) !== page)
      ) {
        return;
      }

      const nextGroup = {
        ...createPointGroup(selectedPoints, activeDrawingId, page),
        annotationRevisionId: resolvedActiveRevisionId,
      };
      setProject((prev) => {
        if (!prev) return prev;
        const cleaned = (prev.pointGroups ?? [])
          .map((g) => ({
            ...g,
            pointIds: g.pointIds.filter((pid) => !idSet.has(pid)),
          }))
          .filter((g) => g.pointIds.length > 0);
        return {
          ...prev,
          pointGroups: [...cleaned, nextGroup],
        };
      });
      markDirty();
      showStatus("info", `Created point group "${nextGroup.name}"`);
    },
    [project, activeDrawingId, activeDrawingDimensions, markDirty, showStatus],
  );

  const handleRenamePointGroup = useCallback(
    (groupId: string, nextName: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        const trimmed = nextName.trim();
        return {
          ...prev,
          pointGroups: (prev.pointGroups ?? []).map((g) => {
            if (g.id !== groupId) return g;
            if (trimmed) return { ...g, name: trimmed };
            const memberNames = g.pointIds
              .map(
                (pid) =>
                  prev.dimensions.find((d) => d.id === pid)?.name ?? "",
              )
              .filter(Boolean);
            return {
              ...g,
              name: formatPointGroupDefaultName(memberNames),
            };
          }),
        };
      });
      markDirty();
    },
    [markDirty],
  );

  const handleTogglePointGroupCollapsed = useCallback(
    (groupId: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pointGroups: (prev.pointGroups ?? []).map((g) =>
            g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
          ),
        };
      });
      markDirty();
    },
    [markDirty],
  );

  const handleSetAllPointGroupsCollapsed = useCallback(
    (collapsed: boolean) => {
      if (!activeDrawingId) return;
      let changed = false;
      setProject((prev) => {
        if (!prev) return prev;
        const groups = prev.pointGroups ?? [];
        const nextGroups = groups.map((g) => {
          if (g.drawingId !== activeDrawingId) return g;
          if (Boolean(g.collapsed) === collapsed) return g;
          changed = true;
          return { ...g, collapsed };
        });
        return changed ? { ...prev, pointGroups: nextGroups } : prev;
      });
      if (changed) {
        markDirty();
      }
    },
    [activeDrawingId, markDirty],
  );

  const handleDeletePointGroup = useCallback(
    async (groupId: string) => {
      const grp = (project?.pointGroups ?? []).find((g) => g.id === groupId);
      const label = grp?.name.trim()
        ? `point group "${grp.name.trim()}"`
        : "this point group";
      const ok = await confirmAction(
        `Ungroup ${label}? All member points will be kept.`,
        {
          title: "Ungroup Points",
          kind: "warning",
        },
      );
      if (!ok) return;

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pointGroups: (prev.pointGroups ?? []).filter((g) => g.id !== groupId),
        };
      });
      setPointEntrySession((prev) =>
        prev && prev.groupId === groupId ? { ...prev, groupId: null } : prev,
      );
      markDirty();
      showStatus("info", "Ungrouped points");
    },
    [project, markDirty, showStatus],
  );

  const handleAddPointsToGroup = useCallback(
    (groupId: string, pointIds: string[]) => {
      if (pointIds.length === 0) return;
      setProject((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.dimensions.map((d) => [d.id, d]));
        return {
          ...prev,
          pointGroups: addPointsToGroup(
            prev.pointGroups ?? [],
            groupId,
            pointIds,
            byId,
          ),
        };
      });
      markDirty();
      showStatus(
        "info",
        `Added ${pointIds.length} point${pointIds.length > 1 ? "s" : ""} to group`,
      );
    },
    [markDirty, showStatus],
  );

  const handleRemovePointsFromGroups = useCallback(
    (pointIds: string[]) => {
      if (pointIds.length === 0) return;
      setProject((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.dimensions.map((d) => [d.id, d]));
        return {
          ...prev,
          pointGroups: removePointsFromGroups(
            prev.pointGroups ?? [],
            pointIds,
            byId,
          ),
        };
      });
      markDirty();
      showStatus(
        "info",
        `Removed ${pointIds.length} point${pointIds.length > 1 ? "s" : ""} from group`,
      );
    },
    [markDirty, showStatus],
  );

  const handleTogglePointEntry = useCallback(() => {
    if (!project || !activeDrawingId) return;
    if (pointEntrySession) {
      setPointEntrySession(null);
      return;
    }
    if (editingDimensionId) {
      handleCancelEditing();
    }
    setPlacingDimensionId(null);
    setPointCaptureState(null);
    setDrawingSidebarView("dimensions");
    const existingPagePointNames = activeDrawingDimensions
      .filter(
        (d) =>
          getAnnotationKind(d) === "point" &&
          getAnnotationPage(d) === currentPage,
      )
      .map((d) => d.name);
    setPointEntrySession({
      page: currentPage,
      groupId: null,
      pickMode: "x_zero",
      nextId: resolveUniquePointIdOnPage("P1", existingPagePointNames),
      calibration: createEmptyCalibration(),
      placedCount: 0,
    });
  }, [
    project,
    activeDrawingId,
    activeDrawingDimensions,
    pointEntrySession,
    editingDimensionId,
    handleCancelEditing,
    currentPage,
  ]);

  const handleResumePointEntryForGroup = useCallback(
    (groupId: string) => {
      if (!project || !activeDrawingId) return;
      const group = (project.pointGroups ?? []).find((g) => g.id === groupId);
      if (!group) return;
      if (editingDimensionId) {
        handleCancelEditing();
      }
      setPlacingDimensionId(null);
      setPointCaptureState(null);
      const byId = new Map(project.dimensions.map((d) => [d.id, d]));
      const memberNames = group.pointIds
        .map((pid) => byId.get(pid)?.name ?? "")
        .filter(Boolean);
      const existingPagePointNames = activeDrawingDimensions
        .filter(
          (d) =>
            getAnnotationKind(d) === "point" &&
            getAnnotationPage(d) === group.page,
        )
        .map((d) => d.name);
      const cal = group.calibration
        ? { ...group.calibration }
        : createEmptyCalibration();
      const hasCalibration =
        cal.xZero !== null && cal.yZero !== null && cal.anchorX !== null;
      setPointEntrySession({
        page: group.page,
        groupId: group.id,
        pickMode: hasCalibration ? "place" : "x_zero",
        nextId: resolveUniquePointIdOnPage(
          suggestNextPointIdForGroup(memberNames),
          existingPagePointNames,
        ),
        calibration: cal,
        placedCount: 0,
      });
      if (group.page !== currentPage) {
        setCurrentPage(group.page);
        setScrollToPageRequest({ page: group.page, key: Date.now() });
      }
    },
    [
      project,
      activeDrawingId,
      activeDrawingDimensions,
      editingDimensionId,
      handleCancelEditing,
      currentPage,
    ],
  );

  const handleUpdatePointEntry = useCallback(
    (patch: Partial<PointEntrySession>) => {
      setPointEntrySession((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  const handleUpdatePointEntryCalibration = useCallback(
    (patch: Partial<PointGroupCalibration>) => {
      setPointEntrySession((prev) => {
        if (!prev) return prev;
        const nextCal = { ...prev.calibration, ...patch };
        if (prev.groupId) {
          const targetGroupId = prev.groupId;
          setProject((proj) =>
            proj
              ? {
                  ...proj,
                  pointGroups: (proj.pointGroups ?? []).map((g) =>
                    g.id === targetGroupId ? { ...g, calibration: nextCal } : g,
                  ),
                }
              : proj,
          );
          markDirty();
        }
        return { ...prev, calibration: nextCal };
      });
    },
    [markDirty],
  );

  const handleCopyPointEntryCalibration = useCallback(() => {
    if (!pointEntrySession) return;
    setCopiedPointCalibration({ ...pointEntrySession.calibration });
    showStatus("info", "Copied coordinate definition");
  }, [pointEntrySession, showStatus]);

  const handlePastePointEntryCalibration = useCallback(() => {
    if (!pointEntrySession || !copiedPointCalibration) return;
    const cal = { ...copiedPointCalibration };
    handleUpdatePointEntryCalibration(cal);
    if (cal.xZero !== null && cal.yZero !== null && cal.anchorX !== null) {
      setPointEntrySession((prev) =>
        prev ? { ...prev, pickMode: "place" } : prev,
      );
    }
    showStatus("info", "Pasted coordinate definition");
  }, [
    pointEntrySession,
    copiedPointCalibration,
    handleUpdatePointEntryCalibration,
    showStatus,
  ]);

  const handleRecalculatePointGroupCoords = useCallback(async () => {
    if (!project || !pointEntrySession || !pointEntrySession.groupId) return;
    const group = (project.pointGroups ?? []).find(
      (g) => g.id === pointEntrySession.groupId,
    );
    if (!group) return;

    const pageAspect = pageAspectRatiosRef.current[group.page - 1];
    const preview = recalculatePointGroupCoordinates(
      project.dimensions,
      group,
      pointEntrySession.calibration,
      pageAspect,
    );
    if (preview.updatedCount === 0) {
      showStatus(
        "error",
        "No marked points in this group can be recalculated with the current calibration",
      );
      return;
    }

    const ok = await confirmAction(
      `Regenerate X/Y coordinates for ${preview.updatedCount} point(s) in "${group.name}" using the current coordinate definition? Existing X/Y values in this group will be overwritten.`,
      { title: "Regenerate Group Coordinates", kind: "warning" },
    );
    if (!ok) return;

    const savedCal = { ...pointEntrySession.calibration };
    setProject((prev) => {
      if (!prev) return prev;
      const liveGroup = (prev.pointGroups ?? []).find((g) => g.id === group.id);
      if (!liveGroup) return prev;
      const res = recalculatePointGroupCoordinates(
        prev.dimensions,
        liveGroup,
        savedCal,
        pageAspect,
      );
      return {
        ...prev,
        dimensions: res.updatedDimensions,
        pointGroups: (prev.pointGroups ?? []).map((g) =>
          g.id === liveGroup.id ? { ...g, calibration: savedCal } : g,
        ),
      };
    });
    markDirty();
    showStatus(
      "info",
      `Regenerated X/Y coordinates for ${preview.updatedCount} point(s) in "${group.name}"`,
    );
  }, [project, pointEntrySession, markDirty, showStatus]);

  const handlePointEntryClick = useCallback(
    (page: number, clickX: number, clickY: number) => {
      if (!pointEntrySession || !project || !activeDrawingId) return;
      if (page !== pointEntrySession.page) return;

      const { pickMode, calibration } = pointEntrySession;

      if (pickMode === "x_zero") {
        const nextCal: PointGroupCalibration = {
          ...calibration,
          xZero: clickX,
        };
        const nextMode =
          nextCal.yZero === null
            ? "y_zero"
            : nextCal.anchorX === null
              ? "anchor"
              : "place";
        handleUpdatePointEntryCalibration({ xZero: clickX });
        setPointEntrySession((prev) =>
          prev ? { ...prev, pickMode: nextMode } : prev,
        );
        return;
      }

      if (pickMode === "y_zero") {
        const nextCal: PointGroupCalibration = {
          ...calibration,
          yZero: clickY,
        };
        const nextMode = nextCal.anchorX === null ? "anchor" : "place";
        handleUpdatePointEntryCalibration({ yZero: clickY });
        setPointEntrySession((prev) =>
          prev ? { ...prev, pickMode: nextMode } : prev,
        );
        return;
      }

      if (pickMode === "anchor") {
        const nextMode =
          calibration.anchorValX.trim() && calibration.anchorValY.trim()
            ? "place"
            : "anchor";
        handleUpdatePointEntryCalibration({
          anchorX: clickX,
          anchorY: clickY,
        });
        setPointEntrySession((prev) =>
          prev ? { ...prev, pickMode: nextMode } : prev,
        );
        return;
      }

      // Place mode: enforce same-page Point ID uniqueness, then create a new Point with frozen calibrated X/Y
      const desiredName = pointEntrySession.nextId.trim();
      if (!desiredName) {
        showStatus("error", "Point ID is required before placing a point");
        return;
      }
      const existingPagePointNames = activeDrawingDimensions
        .filter(
          (d) =>
            getAnnotationKind(d) === "point" && getAnnotationPage(d) === page,
        )
        .map((d) => d.name);
      if (hasPointIdCollisionOnPage(desiredName, existingPagePointNames)) {
        showStatus(
          "error",
          `Point ID "${desiredName}" already exists on Page ${page}`,
        );
        return;
      }

      const pageAspect = pageAspectRatiosRef.current[page - 1];
      const { x, y } = computeCalibratedPointCoords(
        clickX,
        clickY,
        calibration,
        pageAspect,
      );
      const baseDim = createDimension(
        activeDrawingDimensions,
        activeDrawingId,
        page,
      );
      const newPoint: Dimension = {
        ...baseDim,
        annotationRevisionId: resolvedActiveRevisionId,
        kind: "point",
        name: desiredName,
        dimensionType: "",
        nominal: "",
        upperTol: "",
        lowerTol: "",
        notes: "",
        point: {
          ...createDefaultPointSpec(),
          x,
          y,
        },
        marker: {
          drawingId: activeDrawingId,
          page,
          x: clickX,
          y: clickY,
          width: 0,
          height: 0,
        },
      };

      const lastOnPageIdx = activeDrawingDimensions.reduce(
        (acc, d, idx) => (getAnnotationPage(d) === page ? idx : acc),
        -1,
      );
      const insertSlot =
        lastOnPageIdx !== -1
          ? lastOnPageIdx + 1
          : activeDrawingDimensions.length;

      let resolvedGroupId = pointEntrySession.groupId;
      const savedCal = { ...calibration };

      if (!resolvedGroupId) {
        const createdGroup = {
          ...createPointGroup([newPoint], activeDrawingId, page),
          annotationRevisionId: resolvedActiveRevisionId,
          calibration: savedCal,
        };
        resolvedGroupId = createdGroup.id;
        setProject((prev) =>
          prev
            ? {
                ...prev,
                dimensions: insertDimensionAtSlot(
                  prev.dimensions,
                  activeDrawingId,
                  newPoint,
                  insertSlot,
                  resolvedActiveRevisionId,
                ),
                pointGroups: [...(prev.pointGroups ?? []), createdGroup],
              }
            : prev,
        );
      } else {
        const targetGroupId = resolvedGroupId;
        setProject((prev) => {
          if (!prev) return prev;
          const nextDimensions = insertDimensionAtSlot(
            prev.dimensions,
            activeDrawingId,
            newPoint,
            insertSlot,
            resolvedActiveRevisionId,
          );
          const byId = new Map(nextDimensions.map((d) => [d.id, d]));
          const updatedGroups = addPointsToGroup(
            prev.pointGroups ?? [],
            targetGroupId,
            [newPoint.id],
            byId,
          ).map((g) =>
            g.id === targetGroupId ? { ...g, calibration: savedCal } : g,
          );
          return {
            ...prev,
            dimensions: nextDimensions,
            pointGroups: updatedGroups,
          };
        });
      }

      setSelectedDimensionId(newPoint.id);
      setSelectedDimensionIds([newPoint.id]);
      const nextFreeId = resolveUniquePointIdOnPage(
        incrementPointId(desiredName),
        [...existingPagePointNames, desiredName],
      );
      setPointEntrySession((prev) =>
        prev
          ? {
              ...prev,
              groupId: resolvedGroupId,
              nextId: nextFreeId,
              placedCount: prev.placedCount + 1,
            }
          : prev,
      );
      markDirty();
    },
    [
      pointEntrySession,
      project,
      activeDrawingId,
      activeDrawingDimensions,
      handleUpdatePointEntryCalibration,
      markDirty,
      showStatus,
    ],
  );

  const handleDuplicateDimension = useCallback(
    (sourceId: string) => {
      if (!project || !activeDrawingId) return;
      const sourceIdx = activeDrawingDimensions.findIndex(
        (d) => d.id === sourceId,
      );
      const source = sourceIdx !== -1 ? activeDrawingDimensions[sourceIdx] : null;
      if (!source) return;
      if (editingDimensionId) {
        handleCancelEditing();
      }
      const dup = {
        ...duplicateDimension(source, activeDrawingDimensions),
        annotationRevisionId: resolvedActiveRevisionId,
      };
      const insertSlot = sourceIdx + 1;
      editingOriginRef.current = { id: dup.id, isNew: true, snapshot: null };
      setProject((prev) =>
        prev
          ? {
              ...prev,
              dimensions: insertDimensionAtSlot(
                prev.dimensions,
                activeDrawingId,
                dup,
                insertSlot,
                resolvedActiveRevisionId,
              ),
            }
          : prev,
      );
      setSelectedDimensionId(dup.id);
      setSelectedDimensionIds([dup.id]);
      setEditingDimensionId(dup.id);
      setPlacingDimensionId(dup.id);
      setFocusNameKey((k) => k + 1);
      setScrollSidebarRequest({ id: dup.id, key: Date.now() });
      markDirty();
    },
    [
      project,
      activeDrawingId,
      activeDrawingDimensions,
      editingDimensionId,
      handleCancelEditing,
      markDirty,
    ],
  );

  const handleDuplicateDimensions = useCallback(
    (sourceIds: string[]) => {
      if (!project || !activeDrawingId || sourceIds.length === 0) return;
      if (sourceIds.length === 1) {
        handleDuplicateDimension(sourceIds[0]);
        return;
      }
      if (editingDimensionId) {
        handleCancelEditing();
      }
      const idSet = new Set(sourceIds);
      const sources: Dimension[] = [];
      let lastSourceIdx = -1;
      activeDrawingDimensions.forEach((d, idx) => {
        if (idSet.has(d.id)) {
          sources.push(d);
          lastSourceIdx = idx;
        }
      });
      if (sources.length === 0) return;

      const dups = duplicateDimensionsBatch(sources, activeDrawingDimensions).map(
        (d) => ({ ...d, annotationRevisionId: resolvedActiveRevisionId }),
      );
      const insertSlot = lastSourceIdx + 1;
      setProject((prev) =>
        prev
          ? {
              ...prev,
              dimensions: insertDimensionsAtSlot(
                prev.dimensions,
                activeDrawingId,
                dups,
                insertSlot,
                resolvedActiveRevisionId,
              ),
            }
          : prev,
      );
      setSelectedDimensionId(dups[0]?.id ?? null);
      setEditingDimensionId(null);
      setPlacingDimensionId(null);
      if (dups[0]) {
        setScrollSidebarRequest({ id: dups[0].id, key: Date.now() });
      }
      markDirty();
      const namesPreview = dups
        .map((d) => d.name.trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      showStatus(
        "info",
        `Duplicated ${dups.length} annotations${namesPreview ? ` (${namesPreview}${dups.length > 5 ? "…" : ""})` : ""}`,
      );
    },
    [
      project,
      activeDrawingId,
      activeDrawingDimensions,
      editingDimensionId,
      handleCancelEditing,
      handleDuplicateDimension,
      markDirty,
      showStatus,
    ],
  );

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

  // Global keyboard shortcuts: Esc cancels editing/placement, Cmd/Ctrl+S saves, N adds dimension in Dimensions view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pointEntrySession) {
          e.preventDefault();
          setPointEntrySession(null);
        } else if (pointCaptureState) {
          e.preventDefault();
          setPointCaptureState(null);
        } else if (editingDimensionId) {
          handleCancelEditing();
        } else if (placingDimensionId) {
          setPlacingDimensionId(null);
        } else if (selectedDimensionId || selectedDimensionIds.length > 0) {
          e.preventDefault();
          clearSelection();
        }
      } else if (
        (e.key === " " || e.code === "Space") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.isComposing &&
        pointCaptureState
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag !== "INPUT" &&
          tag !== "TEXTAREA" &&
          tag !== "SELECT" &&
          !target?.isContentEditable
        ) {
          e.preventDefault();
          advancePointCaptureStepRef.current();
        }
      } else if (
        e.key === "Enter" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.isComposing &&
        pointCaptureState
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag !== "INPUT" &&
          tag !== "TEXTAREA" &&
          tag !== "SELECT" &&
          !target?.isContentEditable
        ) {
          e.preventDefault();
          void applyPointCaptureRef.current();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (project) {
          e.preventDefault();
          void persistProject(false);
        }
      } else if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.isComposing &&
        activeModule === "drawing" &&
        drawingSidebarView === "dimensions" &&
        activeDrawingId !== null &&
        !editingDimensionId
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target?.isContentEditable
        ) {
          return;
        }
        if (e.key.toLowerCase() === "n") {
          e.preventDefault();
          handleAddDimension();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const nextId = resolveAdjacentDimensionId(
            activeDrawingDimensions,
            selectedDimensionId,
            e.key === "ArrowDown" ? "down" : "up",
          );
          if (!nextId) return;
          e.preventDefault();
          if (nextId === selectedDimensionId) return;
          setSelectedDimensionId(nextId);
          setSelectedDimensionIds([nextId]);
          setScrollSidebarRequest({
            id: nextId,
            key: Date.now(),
            block: "nearest",
          });
          const nextDim = activeDrawingDimensions.find((d) => d.id === nextId);
          if (nextDim?.marker) {
            const byId = new Map(activeDrawingDimensions.map((d) => [d.id, d]));
            const targetPage = nextDim.marker.page;
            const relatedMarkers: MarkerPosition[] = [];
            for (const pid of nextDim.linkedPointIds ?? []) {
              const pt = byId.get(pid);
              if (pt?.marker && pt.marker.page === targetPage) {
                relatedMarkers.push(pt.marker);
              }
            }
            for (const nid of nextDim.linkedNoteIds ?? []) {
              const nt = byId.get(nid);
              if (nt?.marker && nt.marker.page === targetPage) {
                relatedMarkers.push(nt.marker);
              }
            }
            const union = computeHighlightUnionRegion(
              nextDim.marker,
              relatedMarkers,
            );
            suppressPdfToSidebarSyncUntilRef.current = performance.now() + 750;
            setCurrentPage(targetPage);
            setScrollToPageRequest({
              page: targetPage,
              marker: {
                drawingId: nextDim.marker.drawingId,
                page: targetPage,
                x: union.x,
                y: union.y,
                width: union.width,
                height: union.height,
              },
              key: Date.now(),
            });
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeModule,
    drawingSidebarView,
    activeDrawingId,
    activeDrawingDimensions,
    selectedDimensionId,
    selectedDimensionIds,
    editingDimensionId,
    placingDimensionId,
    pointCaptureState,
    pointEntrySession,
    project,
    clearSelection,
    handleAddDimension,
    handleCancelEditing,
    persistProject,
  ]);

  const buildHighlightScrollRequest = useCallback(
    (primaryDim: Dimension, extraIds?: readonly string[]) => {
      if (!primaryDim.marker) return null;
      const targetPage = primaryDim.marker.page;
      const byId = new Map(activeDrawingDimensions.map((d) => [d.id, d]));
      const relatedMarkers: MarkerPosition[] = [];

      const collectLinked = (dim: Dimension) => {
        for (const pid of dim.linkedPointIds ?? []) {
          const pt = byId.get(pid);
          if (pt?.marker && pt.marker.page === targetPage) {
            relatedMarkers.push(pt.marker);
          }
        }
        for (const nid of dim.linkedNoteIds ?? []) {
          const nt = byId.get(nid);
          if (nt?.marker && nt.marker.page === targetPage) {
            relatedMarkers.push(nt.marker);
          }
        }
      };

      collectLinked(primaryDim);
      if (extraIds) {
        for (const id of extraIds) {
          if (id === primaryDim.id) continue;
          const other = byId.get(id);
          if (other?.marker && other.marker.page === targetPage) {
            relatedMarkers.push(other.marker);
            collectLinked(other);
          }
        }
      }

      const union = computeHighlightUnionRegion(
        primaryDim.marker,
        relatedMarkers,
      );
      return {
        page: targetPage,
        marker: {
          drawingId: primaryDim.marker.drawingId,
          page: targetPage,
          x: union.x,
          y: union.y,
          width: union.width,
          height: union.height,
        },
        key: Date.now(),
      };
    },
    [activeDrawingDimensions],
  );

  const handleSelectFromSidebar = useCallback(
    (id: string) => {
      setSelectedDimensionId(id);
      setSelectedDimensionIds([id]);
      const dim = activeDrawingDimensions.find((d) => d.id === id);
      if (dim?.marker) {
        const req = buildHighlightScrollRequest(dim);
        if (req) {
          suppressPdfToSidebarSyncUntilRef.current = performance.now() + 750;
          setCurrentPage(req.page);
          setScrollToPageRequest(req);
        }
      }
    },
    [activeDrawingDimensions, buildHighlightScrollRequest],
  );

  const handleSelectMultiFromSidebar = useCallback(
    (ids: string[], primaryId: string) => {
      setSelectedDimensionIds(ids);
      setSelectedDimensionId(primaryId || null);
      if (!primaryId) return;
      const dim = activeDrawingDimensions.find((d) => d.id === primaryId);
      if (dim?.marker) {
        const req = buildHighlightScrollRequest(dim, ids);
        if (req) {
          suppressPdfToSidebarSyncUntilRef.current = performance.now() + 750;
          setCurrentPage(req.page);
          setScrollToPageRequest(req);
        }
      }
    },
    [activeDrawingDimensions, buildHighlightScrollRequest],
  );

  const handleSelectFromDrawing = useCallback(
    (id: string, additive = false) => {
      setDrawingSidebarView("dimensions");
      if (additive) {
        setSelectedDimensionIds((prev) => {
          const base =
            prev.length > 0
              ? prev
              : selectedDimensionId
                ? [selectedDimensionId]
                : [];
          const next = base.includes(id)
            ? base.filter((existingId) => existingId !== id)
            : [...base, id];
          setSelectedDimensionId(
            next.includes(id) ? id : (next[next.length - 1] ?? null),
          );
          return next;
        });
        return;
      }
      setSelectedDimensionId(id);
      setSelectedDimensionIds([id]);
      const dim = activeDrawingDimensions.find((d) => d.id === id);
      if (dim?.marker) {
        setCurrentPage(dim.marker.page);
      }
      setScrollSidebarRequest({ id, key: Date.now() });
    },
    [activeDrawingDimensions, selectedDimensionId],
  );

  const handleJumpToPage = useCallback((page: number) => {
    setCurrentPage(page);
    setScrollToPageRequest({ page, key: Date.now() });
  }, []);

  // Decoupled PDF scroll: only updates the active page indicator (never yanks the annotations list)
  const handlePdfPageChange = useCallback((page: number) => {
    setCurrentPage(page);
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
      if (patch.kind !== undefined && id === editingDimensionId) {
        setScrollSidebarRequest({ id, key: Date.now(), block: "start" });
      }
      markDirty();
    },
    [editingDimensionId, markDirty],
  );

  const handleDeleteDimension = useCallback(
    async (id: string) => {
      const dim = project?.dimensions.find((d) => d.id === id);
      const label = dim?.name.trim()
        ? `dimension "${dim.name.trim()}"`
        : "this dimension";
      const ok = await confirmAction(`Delete ${label}?`, {
        title: "Delete Dimension",
        kind: "warning",
      });
      if (!ok) return;

      setProject((prev) => {
        if (!prev) return prev;
        const nextDimensions = prev.dimensions
          .filter((d) => d.id !== id)
          .map((d) => {
            const hasPoint = d.linkedPointIds?.includes(id) ?? false;
            const hasNote = d.linkedNoteIds?.includes(id) ?? false;
            if (!hasPoint && !hasNote) return d;
            return {
              ...d,
              linkedPointIds: hasPoint
                ? d.linkedPointIds!.filter((pid) => pid !== id)
                : d.linkedPointIds,
              linkedNoteIds: hasNote
                ? d.linkedNoteIds!.filter((nid) => nid !== id)
                : d.linkedNoteIds,
            };
          });
        return {
          ...prev,
          dimensions: nextDimensions,
          pointGroups: prunePointGroups(prev.pointGroups ?? [], nextDimensions),
        };
      });
      setSelectedDimensionId((prev) => (prev === id ? null : prev));
      setEditingDimensionId((prev) => (prev === id ? null : prev));
      setPlacingDimensionId((prev) => (prev === id ? null : prev));
      markDirty();
    },
    [project, markDirty],
  );

  const handlePlaceMarker = useCallback(
    (dimensionId: string, marker: MarkerPosition) => {
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.id === dimensionId
              ? {
                  ...d,
                  drawingId: marker.drawingId,
                  page: marker.page,
                  marker,
                }
              : d,
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

  const handleBatchMoveMarkers = useCallback(
    (updates: Array<{ id: string; marker: MarkerPosition }>) => {
      if (updates.length === 0) return;
      const byId = new Map(updates.map((u) => [u.id, u.marker]));
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dimensions: prev.dimensions.map((d) => {
            const nextMarker = byId.get(d.id);
            return nextMarker ? { ...d, marker: nextMarker } : d;
          }),
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

  const handleApplyPointCapture = useCallback(async () => {
    if (!pointCaptureState || !project || !pdfBytes || !activeDrawingId) return;
    const dim = project.dimensions.find(
      (d) => d.id === pointCaptureState.dimensionId,
    );
    if (!dim || !dim.marker) {
      setPointCaptureState(null);
      return;
    }
    const entries = Object.entries(pointCaptureState.boxes) as Array<
      [
        PointCaptureField,
        { page: number; x: number; y: number; width: number; height: number },
      ]
    >;
    if (entries.length === 0) {
      setPointCaptureState(null);
      return;
    }
    try {
      const capturedTexts: Partial<Record<PointCaptureField, string[]>> = {};
      await Promise.all(
        entries.map(async ([field, box]) => {
          capturedTexts[field] = await extractTextLinesInMarker(pdfBytes, {
            drawingId: activeDrawingId,
            page: box.page,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          });
        }),
      );
      const patch = parsePointFromFieldCaptures(capturedTexts, dim.point);
      setPointCaptureState(null);
      if (!patch) {
        showStatus(
          "info",
          "Could not recognize Point ID or coordinates from selected regions",
        );
        return;
      }
      handleUpdateDimension(dim.id, patch);
      const parts: string[] = [];
      if (patch.name) parts.push(patch.name);
      if (patch.point?.x) parts.push(`X:${patch.point.x}`);
      if (patch.point?.y) parts.push(`Y:${patch.point.y}`);
      if (patch.point?.z) parts.push(`Z:${patch.point.z}`);
      showStatus(
        "info",
        `Auto-filled Point${parts.length > 0 ? ` (${parts.join(" ")})` : ""}`,
      );
    } catch (err) {
      setPointCaptureState(null);
      showStatus("error", err instanceof Error ? err.message : String(err));
    }
  }, [
    pointCaptureState,
    project,
    pdfBytes,
    activeDrawingId,
    handleUpdateDimension,
    showStatus,
  ]);
  applyPointCaptureRef.current = handleApplyPointCapture;

  const handleAdvancePointCaptureStep = useCallback(() => {
    if (!pointCaptureState) return;
    if (pointCaptureState.stepIndex >= POINT_CAPTURE_STEPS.length - 1) {
      void handleApplyPointCapture();
      return;
    }
    setPointCaptureState((prev) =>
      prev ? { ...prev, stepIndex: prev.stepIndex + 1 } : prev,
    );
  }, [pointCaptureState, handleApplyPointCapture]);
  advancePointCaptureStepRef.current = handleAdvancePointCaptureStep;

  const handleAddPointCaptureRegion = useCallback(
    (rect: {
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }) => {
      setPointCaptureState((prev) => {
        if (!prev) return prev;
        const field = POINT_CAPTURE_STEPS[prev.stepIndex];
        return {
          ...prev,
          boxes: {
            ...prev.boxes,
            [field]: rect,
          },
        };
      });
    },
    [],
  );

  const handleCancelPointCapture = useCallback(() => {
    setPointCaptureState(null);
  }, []);

  const handleAutoRecognizeDimension = useCallback(
    async (dimensionId: string) => {
      if (!project || !pdfBytes) return;
      const dim = project.dimensions.find((d) => d.id === dimensionId);
      if (!dim || !dim.marker) return;
      const kind = getAnnotationKind(dim);
      if (kind === "point") {
        if (pointCaptureState && pointCaptureState.dimensionId === dimensionId) {
          await handleApplyPointCapture();
          return;
        }
        setPlacingDimensionId(null);
        setPointCaptureState({
          dimensionId,
          page: dim.marker.page,
          stepIndex: 0,
          boxes: {},
        });
        return;
      }

      try {
        const lines = await extractTextLinesInMarker(pdfBytes, dim.marker);
        if (lines.length === 0) {
          showStatus("info", "No selectable text found in the marked area");
          return;
        }
        const patch = parseAnnotationFromRegionText(kind, lines, dim);
        if (!patch || Object.keys(patch).length === 0) {
          showStatus("info", "Could not parse fields from marked area text");
          return;
        }
        handleUpdateDimension(dimensionId, patch);
        showStatus("info", "Auto-filled fields from marked area");
      } catch (err) {
        showStatus("error", err instanceof Error ? err.message : String(err));
      }
    },
    [
      project,
      pdfBytes,
      pointCaptureState,
      handleApplyPointCapture,
      handleUpdateDimension,
      showStatus,
    ],
  );

  const handleReplaceDrawingDimensions = useCallback(
    (
      nextDrawingDimensions: Dimension[],
      nextDrawingPointGroups?: PointGroup[],
    ) => {
      if (!activeDrawingId) return;
      const stampedDims = nextDrawingDimensions.map((d) => ({
        ...d,
        annotationRevisionId:
          d.annotationRevisionId ?? resolvedActiveRevisionId,
      }));
      const stampedGroups = nextDrawingPointGroups?.map((g) => ({
        ...g,
        annotationRevisionId:
          g.annotationRevisionId ?? resolvedActiveRevisionId,
      }));
      setProject((prev) => {
        if (!prev) return prev;
        const nextAll = rebindSamePageLinkedPoints(
          replaceDrawingDimensionsOrder(
            prev.dimensions,
            activeDrawingId,
            stampedDims,
            resolvedActiveRevisionId,
          ),
        );
        const mergedGroups = stampedGroups
          ? [
              ...(prev.pointGroups ?? []).filter(
                (g) =>
                  !(
                    g.drawingId === activeDrawingId &&
                    (!resolvedActiveRevisionId ||
                      (g.annotationRevisionId ?? resolvedActiveRevisionId) ===
                        resolvedActiveRevisionId)
                  ),
              ),
              ...stampedGroups,
            ]
          : (prev.pointGroups ?? []);
        return {
          ...prev,
          dimensions: nextAll,
          pointGroups: prunePointGroups(mergedGroups, nextAll),
        };
      });
      markDirty();
    },
    [activeDrawingId, resolvedActiveRevisionId, markDirty],
  );

  const handleInsertAnnotationRows = useCallback(
    (
      kind: AnnotationKind,
      anchorId: string,
      position: "above" | "below",
      count: number,
    ) => {
      if (!project || !activeDrawingId || count < 1) return;
      const anchorIdx = activeDrawingDimensions.findIndex(
        (d) => d.id === anchorId,
      );
      if (anchorIdx === -1) return;
      const insertSlot = position === "above" ? anchorIdx : anchorIdx + 1;

      const working = [...activeDrawingDimensions];
      const created: Dimension[] = [];
      for (let i = 0; i < count; i++) {
        const base = createDimension(working, activeDrawingId, null);
        let nextDim: Dimension = {
          ...base,
          annotationRevisionId: resolvedActiveRevisionId,
          kind,
          name: "",
          page: null,
          quantity: 0,
          unit: "",
        };
        if (kind === "gdt") {
          nextDim = { ...nextDim, gdt: createDefaultGdtSpec() };
        } else if (kind === "point") {
          nextDim = {
            ...nextDim,
            point: createDefaultPointSpec(),
          };
        }
        working.push(nextDim);
        created.push(nextDim);
      }

      setProject((prev) =>
        prev
          ? {
              ...prev,
              dimensions: insertDimensionsAtSlot(
                prev.dimensions,
                activeDrawingId,
                created,
                insertSlot,
                resolvedActiveRevisionId,
              ),
            }
          : prev,
      );
      markDirty();
    },
    [
      project,
      activeDrawingId,
      resolvedActiveRevisionId,
      activeDrawingDimensions,
      currentPage,
      markDirty,
    ],
  );

  const handleAddAnnotationRow = useCallback(
    (kind: AnnotationKind) => {
      if (!project || !activeDrawingId) return;
      const base = createDimension(
        activeDrawingDimensions,
        activeDrawingId,
        null,
      );
      let nextDim: Dimension = {
        ...base,
        annotationRevisionId: resolvedActiveRevisionId,
        kind,
        name: "",
        page: null,
        quantity: 0,
        unit: "",
      };
      if (kind === "gdt") {
        nextDim = { ...nextDim, gdt: createDefaultGdtSpec() };
      } else if (kind === "point") {
        nextDim = {
          ...nextDim,
          point: createDefaultPointSpec(),
        };
      }
      setProject((prev) =>
        prev
          ? {
              ...prev,
              dimensions: [...prev.dimensions, nextDim],
            }
          : prev,
      );
      markDirty();
    },
    [project, activeDrawingId, activeDrawingDimensions, markDirty],
  );

  const handleDeleteDimensionsBatch = useCallback(
    async (ids: string[]) => {
      if (!project || ids.length === 0) return;
      const ok = await confirmAction(
        ids.length === 1
          ? "Delete this annotation?"
          : `Delete ${ids.length} selected annotations?`,
        { title: "Delete Annotations", kind: "warning" },
      );
      if (!ok) return;
      const removeSet = new Set(ids);
      setProject((prev) => {
        if (!prev) return prev;
        const remaining = prev.dimensions
          .filter((d) => !removeSet.has(d.id))
          .map((d) => {
            const nextLinkedPoints = d.linkedPointIds?.filter(
              (pid) => !removeSet.has(pid),
            );
            const nextLinkedNotes = d.linkedNoteIds?.filter(
              (nid) => !removeSet.has(nid),
            );
            const pointsChanged =
              (d.linkedPointIds?.length ?? 0) !== (nextLinkedPoints?.length ?? 0);
            const notesChanged =
              (d.linkedNoteIds?.length ?? 0) !== (nextLinkedNotes?.length ?? 0);
            if (!pointsChanged && !notesChanged) return d;
            return {
              ...d,
              linkedPointIds: nextLinkedPoints,
              linkedNoteIds: nextLinkedNotes,
            };
          });
        return {
          ...prev,
          dimensions: remaining,
          pointGroups: prunePointGroups(prev.pointGroups ?? [], remaining),
        };
      });
      if (selectedDimensionId && removeSet.has(selectedDimensionId)) {
        setSelectedDimensionId(null);
      }
      setSelectedDimensionIds((prev) => prev.filter((id) => !removeSet.has(id)));
      markDirty();
    },
    [project, selectedDimensionId, markDirty],
  );

  const handleSwitchDrawingInAnnotations = useCallback(
    async (drawingId: string) => {
      if (!project) return;
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
        }
      } catch (err) {
        showStatus("error", err instanceof Error ? err.message : String(err));
      }
    },
    [project, activeDrawingId, pdfBytes, showStatus],
  );

  const handleLocateAnnotationOnDrawing = useCallback(
    (dimensionId: string) => {
      setDrawingSidebarView("dimensions");
      setActiveModule("drawing");
      handleSelectFromSidebar(dimensionId);
      setScrollSidebarRequest({
        id: dimensionId,
        key: Date.now(),
        block: "center",
      });
    },
    [handleSelectFromSidebar],
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
          role="status"
          aria-live="polite"
          className={`fixed right-4 top-[84px] z-50 flex max-w-md items-center gap-2.5 rounded-lg border px-3 py-2 text-xs shadow-2xl backdrop-blur-md ${
            status.kind === "error"
              ? "border-rose-500/40 bg-rose-950/95 text-rose-200"
              : "border-emerald-500/35 bg-neutral-950/95 text-emerald-200"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              status.kind === "error" ? "bg-rose-400" : "bg-emerald-400"
            }`}
          />
          <span className="min-w-0 flex-1 break-words leading-snug">
            {status.text}
          </span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setStatus(null)}
            className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ActivityBar
          activeModule={activeModule}
          onSelectModule={handleSelectModule}
          hasActiveDrawing={activeDrawingId !== null}
          hasAnnotations={activeDrawingDimensions.length > 0}
        />

        {!project ? (
          <main className="flex flex-1 items-center justify-center bg-surface-canvas p-8">
            <EmptyState
              size="lg"
              icon={<QOneLogo className="h-7 w-7 text-ink-primary" />}
              title="Q-One Quality Manager"
              description={
                <>
                  Create a new quality management project, open a PDF
                  engineering drawing directly, or resume an existing{" "}
                  <span className="font-mono text-ink-secondary">.qone</span>{" "}
                  project.
                </>
              }
              actions={
                <>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => void handleNewProject()}
                  >
                    <FolderPlus className="h-4 w-4" />
                    New Project
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => void handleOpenPdf()}
                  >
                    <FilePlus2 className="h-4 w-4" />
                    Open PDF Drawing
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => void handleOpenProject()}
                  >
                    <FolderOpen className="h-4 w-4 text-accent-warning" />
                    Open Project (.qone)
                  </Button>
                </>
              }
            />
          </main>
        ) : (
          <>
            <div
              className={
                activeModule === "project"
                  ? "flex min-h-0 min-w-0 flex-1"
                  : "hidden"
              }
            >
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
                onDetachPdf={(partId, drwId) =>
                  void handleDetachPdf(partId, drwId)
                }
                onOpenDrawing={(drwId) => void handleOpenDrawing(drwId)}
              />
            </div>

            <div
              className={
                activeModule === "annotations"
                  ? "flex min-h-0 min-w-0 flex-1"
                  : "hidden"
              }
            >
              <AnnotationsWorkspace
                isActive={activeModule === "annotations"}
                activeDrawing={activeDrawing}
                drawingOptions={drawingSwitchOptions}
                dimensions={activeDrawingDimensions}
                pointGroups={activeDrawingPointGroups}
                onSwitchDrawing={(drwId) =>
                  void handleSwitchDrawingInAnnotations(drwId)
                }
                onGoToProject={() => setActiveModule("project")}
                onReplaceDrawingDimensions={handleReplaceDrawingDimensions}
                onAddAnnotationRow={handleAddAnnotationRow}
                onInsertAnnotationRows={handleInsertAnnotationRows}
                onDuplicateRows={handleDuplicateDimensions}
                onDeleteRows={(ids) => void handleDeleteDimensionsBatch(ids)}
                onLocateOnDrawing={handleLocateAnnotationOnDrawing}
                onNotify={showStatus}
              />
            </div>

            <div
              className={
                activeModule === "drawing"
                  ? "flex min-h-0 min-w-0 flex-1"
                  : "hidden"
              }
            >
              <aside className="relative flex w-[356px] shrink-0 flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950">
                {(() => {
                  const isShowingDimensions =
                    drawingSidebarView === "dimensions" &&
                    Boolean(activeDrawing);
                  return (
                    <div
                      className={`flex h-full min-h-0 w-[200%] will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        isShowingDimensions
                          ? "translate-x-0"
                          : "-translate-x-1/2"
                      }`}
                    >
                      {/* Level 2 (left slot): slides in from left while Level 1 pushes right */}
                      <div
                        aria-hidden={!isShowingDimensions}
                        className={`flex h-full min-h-0 w-1/2 shrink-0 flex-col ${
                          isShowingDimensions ? "" : "pointer-events-none"
                        }`}
                      >
                        <DimensionSidebar
                          isActive={
                            activeModule === "drawing" && isShowingDimensions
                          }
                          dimensions={activeDrawingDimensions}
                          pointGroups={activeDrawingPointGroups}
                          selectedDimensionId={selectedDimensionId}
                          selectedDimensionIds={selectedDimensionIds}
                          editingDimensionId={editingDimensionId}
                          placingDimensionId={placingDimensionId}
                          pointCaptureDimensionId={
                            pointCaptureState?.dimensionId ?? null
                          }
                          focusNameKey={focusNameKey}
                          hasProject={activeDrawingId !== null}
                          currentPage={currentPage}
                          pageCount={pageCount}
                          scrollToDimensionRequest={scrollSidebarRequest}
                          onJumpToPage={handleJumpToPage}
                          activeDrawingFilename={
                            activeDrawing
                              ? (() => {
                                  const drwLabel = activeDrawing.version?.trim()
                                    ? `Version: ${activeDrawing.version.trim()}`
                                    : activeDrawing.filename;
                                  const revLabel =
                                    activeAnnotationRevision?.name?.trim();
                                  return revLabel
                                    ? `${drwLabel} · ${revLabel}`
                                    : drwLabel;
                                })()
                              : undefined
                          }
                          onBackToDrawings={() => {
                            if (editingDimensionId) {
                              handleCancelEditing();
                            }
                            setDrawingSidebarView("drawings");
                          }}
                          onAddDimension={handleAddDimension}
                          onSortDimensions={handleSortDimensions}
                          onReorderDimensions={handleReorderDimensions}
                          onSelectDimension={handleSelectFromSidebar}
                          onSelectDimensions={handleSelectMultiFromSidebar}
                          onStartEditing={handleStartEditing}
                          onFinishEditing={handleFinishEditing}
                          onCancelEditing={handleCancelEditing}
                          onUpdateDimension={handleUpdateDimension}
                          onDuplicateDimension={handleDuplicateDimension}
                          onDuplicateDimensions={handleDuplicateDimensions}
                          onCreatePointGroup={handleCreatePointGroup}
                          onRenamePointGroup={handleRenamePointGroup}
                          onTogglePointGroupCollapsed={
                            handleTogglePointGroupCollapsed
                          }
                          onSetAllPointGroupsCollapsed={
                            handleSetAllPointGroupsCollapsed
                          }
                          onDeletePointGroup={(id) =>
                            void handleDeletePointGroup(id)
                          }
                          onResumePointEntryForGroup={
                            handleResumePointEntryForGroup
                          }
                          onAddPointsToGroup={handleAddPointsToGroup}
                          onRemovePointsFromGroups={handleRemovePointsFromGroups}
                          onDeleteDimension={(id) =>
                            void handleDeleteDimension(id)
                          }
                          onStartPlacing={setPlacingDimensionId}
                          onClearMarker={handleClearMarker}
                          onAutoRecognizeDimension={handleAutoRecognizeDimension}
                        />
                      </div>

                      {/* Level 1 (right slot): pushes right when entering Level 2, pulls back in from right on Back */}
                      <div
                        aria-hidden={isShowingDimensions}
                        className={`flex h-full min-h-0 w-1/2 shrink-0 flex-col ${
                          isShowingDimensions ? "pointer-events-none" : ""
                        }`}
                      >
                        <DrawingListSidebar
                          activePart={activePart}
                          drawings={activePartDrawings}
                          activeDrawingId={activeDrawingId}
                          activeAnnotationRevisionId={resolvedActiveRevisionId}
                          latestDrawingId={activePartLatestDrawingId}
                          dimCountByRevision={dimCountByRevision}
                          onUploadPdf={() => {
                            if (activePart) void handleAttachPdf(activePart.id);
                          }}
                          onSelectDrawing={(drwId, revId) =>
                            void handleOpenDrawing(drwId, revId)
                          }
                          onUpdateDrawingVersion={handleUpdateDrawingVersion}
                          onReorderDrawings={(orderedIds) => {
                            if (activePart)
                              handleReorderDrawings(activePart.id, orderedIds);
                          }}
                          onMarkLatest={(drwId) => {
                            if (activePart)
                              handleMarkLatestDrawing(activePart.id, drwId);
                          }}
                          onRemoveDrawing={(drwId) => {
                            if (activePart)
                              void handleDetachPdf(activePart.id, drwId);
                          }}
                          copiedReviewName={copiedReview?.reviewName ?? null}
                          onCopyAnnotationRevision={
                            handleCopyAnnotationRevision
                          }
                          onPasteAnnotationRevision={
                            handlePasteAnnotationRevision
                          }
                          onDuplicateAnnotationRevision={
                            handleDuplicateAnnotationRevision
                          }
                          onCreateBlankAnnotationRevision={
                            handleCreateBlankAnnotationRevision
                          }
                          onRenameAnnotationRevision={
                            handleRenameAnnotationRevision
                          }
                          onMarkLatestAnnotationRevision={
                            handleMarkLatestAnnotationRevision
                          }
                          onDeleteAnnotationRevision={(drwId, revId) =>
                            void handleDeleteAnnotationRevision(drwId, revId)
                          }
                          onGoToProject={() => setActiveModule("project")}
                        />
                      </div>
                    </div>
                  );
                })()}
              </aside>

            {activeDrawing && pdfBytes ? (
              <PdfViewer
                isActive={activeModule === "drawing"}
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
                selectedDimensionIds={selectedDimensionIds}
                editingDimensionId={editingDimensionId}
                placingDimensionId={placingDimensionId}
                pointCapturePage={pointCaptureState?.page ?? null}
                pointCaptureStep={
                  pointCaptureState
                    ? POINT_CAPTURE_STEPS[pointCaptureState.stepIndex]
                    : null
                }
                pointCaptureRegions={
                  pointCaptureState
                    ? (
                        Object.entries(pointCaptureState.boxes) as Array<
                          [
                            PointCaptureField,
                            {
                              page: number;
                              x: number;
                              y: number;
                              width: number;
                              height: number;
                            },
                          ]
                        >
                      ).map(([field, box]) => ({
                        field,
                        label: field.toUpperCase(),
                        ...box,
                      }))
                    : []
                }
                onPageCountLoaded={handlePageCountLoaded}
                onPageChange={handlePdfPageChange}
                onZoomChange={setZoom}
                onFitToView={() => setFitRequestKey((k) => k + 1)}
                onPlaceMarker={handlePlaceMarker}
                onAddPointCaptureRegion={handleAddPointCaptureRegion}
                onAdvancePointCaptureStep={handleAdvancePointCaptureStep}
                onApplyPointCapture={() => void handleApplyPointCapture()}
                onCancelPointCapture={handleCancelPointCapture}
                pointEntrySession={pointEntrySession}
                onTogglePointEntry={handleTogglePointEntry}
                onUpdatePointEntry={handleUpdatePointEntry}
                onUpdatePointEntryCalibration={
                  handleUpdatePointEntryCalibration
                }
                hasCopiedPointEntryCalibration={copiedPointCalibration !== null}
                onCopyPointEntryCalibration={handleCopyPointEntryCalibration}
                onPastePointEntryCalibration={handlePastePointEntryCalibration}
                onRecalculatePointGroupCoords={() =>
                  void handleRecalculatePointGroupCoords()
                }
                onPointEntryClick={handlePointEntryClick}
                onClosePointEntry={() => setPointEntrySession(null)}
                onSelectDimension={handleSelectFromDrawing}
                onClearSelection={clearSelection}
                onMoveMarker={handleMoveMarker}
                onBatchMoveMarkers={handleBatchMoveMarkers}
                onCancelPlacing={() => setPlacingDimensionId(null)}
              />
            ) : (
              <main className="flex flex-1 items-center justify-center bg-surface-canvas p-8">
                <EmptyState
                  size="sm"
                  icon={<Network className="h-5 w-5" />}
                  title={
                    activePart ? "No Drawing Attached" : "No Drawing Active"
                  }
                  description={
                    activePart ? (
                      <>
                        Active part{" "}
                        <span className="font-medium text-ink-primary">
                          {activePart.name.trim() || "Untitled Part"}
                        </span>{" "}
                        has no PDF drawing attached yet.
                      </>
                    ) : (
                      <>
                        Activate a part in the{" "}
                        <span className="font-medium text-ink-primary">
                          Project
                        </span>{" "}
                        module to display its PDF drawing here.
                      </>
                    )
                  }
                  actions={
                    <>
                      {activePart && (
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => void handleAttachPdf(activePart.id)}
                          className="px-3.5"
                        >
                          <FilePlus2 className="h-3.5 w-3.5" />
                          Attach PDF
                        </Button>
                      )}
                      <Button
                        variant={activePart ? "secondary" : "primary"}
                        size="md"
                        onClick={() => setActiveModule("project")}
                        className="px-3.5"
                      >
                        <Network className="h-3.5 w-3.5" />
                        Go to Project
                      </Button>
                    </>
                  }
                />
              </main>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
