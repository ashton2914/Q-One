import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Crosshair,
  Eye,
  FileText,
  ListPlus,
  Plus,
  Redo2,
  Search,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  ANNOTATION_KIND_OPTIONS,
  getAnnotationKind,
  getGdtSymbolGlyph,
  getMaterialConditionGlyph,
} from "../lib/annotations";
import {
  applyTableCellEdits,
  formatMarkerPosition,
  getColumnsForKind,
  type AnnotationTableContext,
  type CellEdit,
} from "../lib/annotationTable";
import { formatTolerance, getAnnotationPage } from "../lib/dimensions";
import { resolveLinkedPointDisplayTokens } from "../lib/pointGroups";
import type {
  AnnotationKind,
  Dimension,
  DrawingEntry,
  PointGroup,
} from "../types/project";
import type { DrawingSwitchOption } from "./PdfViewer";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { Badge, Button, EmptyState, IconButton, Input, ToolbarGroup } from "./ui";

export interface AnnotationsWorkspaceProps {
  isActive?: boolean;
  activeDrawing: DrawingEntry | null;
  drawingOptions: DrawingSwitchOption[];
  dimensions: Dimension[];
  pointGroups: PointGroup[];
  onSwitchDrawing: (drawingId: string) => void;
  onGoToProject: () => void;
  onReplaceDrawingDimensions: (
    nextDimensions: Dimension[],
    nextPointGroups?: PointGroup[],
  ) => void;
  onAddAnnotationRow: (kind: AnnotationKind) => void;
  onInsertAnnotationRows: (
    kind: AnnotationKind,
    anchorId: string,
    position: "above" | "below",
    count: number,
  ) => void;
  onDuplicateRows: (ids: string[]) => void;
  onDeleteRows: (ids: string[]) => void;
  onLocateOnDrawing: (dimensionId: string) => void;
  onNotify: (kind: "info" | "error", text: string) => void;
}

type CategoryTab = "all" | AnnotationKind;
type DisplayMode = "view" | "edit";

const MAX_UNDO_STACK = 40;

function formatLinearSpec(dim: Dimension): {
  nominal: string;
  tol: string;
  unit: string;
} {
  return {
    nominal: dim.nominal.trim() || "—",
    tol: formatTolerance(dim.upperTol, dim.lowerTol),
    unit: dim.unit,
  };
}

function matchesSearch(
  dim: Dimension,
  query: string,
  groupNameByPointId: ReadonlyMap<string, string>,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (dim.name.toLowerCase().includes(q)) return true;
  if ((dim.dimensionType ?? "").toLowerCase().includes(q)) return true;
  if (dim.nominal.toLowerCase().includes(q)) return true;
  if (dim.notes.toLowerCase().includes(q)) return true;
  if (dim.upperTol.toLowerCase().includes(q)) return true;
  if (dim.lowerTol.toLowerCase().includes(q)) return true;
  if (dim.gdt) {
    if (dim.gdt.symbol.toLowerCase().includes(q)) return true;
    if (dim.gdt.tolerance.toLowerCase().includes(q)) return true;
    if (dim.gdt.datums.some((d) => d.datum.toLowerCase().includes(q))) {
      return true;
    }
  }
  if (dim.point) {
    if (dim.point.x.toLowerCase().includes(q)) return true;
    if (dim.point.y.toLowerCase().includes(q)) return true;
    if (dim.point.z.toLowerCase().includes(q)) return true;
    if (dim.point.datums.some((d) => d.toLowerCase().includes(q))) return true;
  }
  const groupName = groupNameByPointId.get(dim.id);
  if (groupName && groupName.toLowerCase().includes(q)) return true;
  return false;
}

export function AnnotationsWorkspace({
  isActive = true,
  activeDrawing,
  drawingOptions,
  dimensions,
  pointGroups,
  onSwitchDrawing: _onSwitchDrawing,
  onGoToProject,
  onReplaceDrawingDimensions,
  onAddAnnotationRow,
  onInsertAnnotationRows,
  onDuplicateRows,
  onDeleteRows,
  onLocateOnDrawing,
  onNotify,
}: AnnotationsWorkspaceProps) {
  const [mode, setMode] = useState<DisplayMode>("view");
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectionSummary, setSelectionSummary] = useState<{
    selectedRowIds: string[];
    rowCount: number;
    colCount: number;
  }>({ selectedRowIds: [], rowCount: 0, colCount: 0 });

  const viewScrollRef = useRef<HTMLDivElement>(null);
  const savedViewScrollTopRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (!isActive || mode !== "view") return;
    const el = viewScrollRef.current;
    if (!el) return;
    el.scrollTop = savedViewScrollTopRef.current;
  }, [isActive, mode]);

  // Undo / Redo snapshot stacks scoped to the active drawing
  const [undoStack, setUndoStack] = useState<
    Array<{ dimensions: Dimension[]; pointGroups: PointGroup[] }>
  >([]);
  const [redoStack, setRedoStack] = useState<
    Array<{ dimensions: Dimension[]; pointGroups: PointGroup[] }>
  >([]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [activeDrawing?.id]);

  const groupNameByPointId = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of pointGroups) {
      for (const pid of g.pointIds) {
        map.set(pid, g.name);
      }
    }
    return map;
  }, [pointGroups]);

  const dimById = useMemo(
    () => new Map(dimensions.map((d) => [d.id, d])),
    [dimensions],
  );

  const groupedByKind = useMemo(() => {
    const map = new Map<AnnotationKind, Dimension[]>();
    for (const opt of ANNOTATION_KIND_OPTIONS) {
      map.set(opt.value, []);
    }
    const trimmed = searchQuery.trim();
    for (const dim of dimensions) {
      if (!matchesSearch(dim, trimmed, groupNameByPointId)) continue;
      const kind = getAnnotationKind(dim);
      map.get(kind)?.push(dim);
    }
    return map;
  }, [dimensions, searchQuery, groupNameByPointId]);

  const totalFilteredCount = useMemo(() => {
    let total = 0;
    for (const list of groupedByKind.values()) total += list.length;
    return total;
  }, [groupedByKind]);

  // Ensure Edit mode always has a concrete category tab selected
  const effectiveEditKind: AnnotationKind = useMemo(() => {
    if (activeTab !== "all") return activeTab;
    for (const opt of ANNOTATION_KIND_OPTIONS) {
      if ((groupedByKind.get(opt.value)?.length ?? 0) > 0) {
        return opt.value;
      }
    }
    return "linear";
  }, [activeTab, groupedByKind]);

  const handleSetMode = useCallback(
    (nextMode: DisplayMode) => {
      setMode(nextMode);
      if (nextMode === "edit" && activeTab === "all") {
        setActiveTab(effectiveEditKind);
      }
    },
    [activeTab, effectiveEditKind],
  );

  const handleEditCategoryFromView = useCallback((kind: AnnotationKind) => {
    setActiveTab(kind);
    setMode("edit");
  }, []);

  // Table model for Edit mode
  const editRows = useMemo(
    () => groupedByKind.get(effectiveEditKind) ?? [],
    [groupedByKind, effectiveEditKind],
  );
  const editColumns = useMemo(
    () => getColumnsForKind(effectiveEditKind),
    [effectiveEditKind],
  );
  const tableCtx = useMemo<AnnotationTableContext>(
    () => ({ pointGroups, allDrawingDimensions: dimensions }),
    [pointGroups, dimensions],
  );
  const gridMatrix = useMemo(
    () =>
      editRows.map((dim) => editColumns.map((col) => col.getValue(dim, tableCtx))),
    [editRows, editColumns, tableCtx],
  );
  const gridRowIds = useMemo(() => editRows.map((d) => d.id), [editRows]);

  const handleApplyEdits = useCallback(
    (edits: CellEdit[]) => {
      if (edits.length === 0) return;
      const result = applyTableCellEdits(
        dimensions,
        editRows,
        editColumns,
        edits,
        pointGroups,
        activeDrawing?.pageCount,
      );
      if (result.skippedDuplicatePointIds.length > 0) {
        const uniq = [...new Set(result.skippedDuplicatePointIds)].join(", ");
        onNotify(
          "error",
          `Duplicate Point ID on the same page skipped: ${uniq}`,
        );
      }
      if (result.changedCount > 0) {
        setUndoStack((prev) => [
          ...prev.slice(-(MAX_UNDO_STACK - 1)),
          { dimensions, pointGroups },
        ]);
        setRedoStack([]);
        onReplaceDrawingDimensions(
          result.updatedDimensions,
          result.updatedPointGroups,
        );
      }
    },
    [
      dimensions,
      editRows,
      editColumns,
      pointGroups,
      activeDrawing?.pageCount,
      onReplaceDrawingDimensions,
      onNotify,
    ],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const previousSnapshot = prev[prev.length - 1];
      setRedoStack((r) => [
        ...r.slice(-(MAX_UNDO_STACK - 1)),
        { dimensions, pointGroups },
      ]);
      onReplaceDrawingDimensions(
        previousSnapshot.dimensions,
        previousSnapshot.pointGroups,
      );
      return prev.slice(0, -1);
    });
  }, [dimensions, pointGroups, onReplaceDrawingDimensions]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const nextSnapshot = prev[prev.length - 1];
      setUndoStack((u) => [
        ...u.slice(-(MAX_UNDO_STACK - 1)),
        { dimensions, pointGroups },
      ]);
      onReplaceDrawingDimensions(
        nextSnapshot.dimensions,
        nextSnapshot.pointGroups,
      );
      return prev.slice(0, -1);
    });
  }, [dimensions, pointGroups, onReplaceDrawingDimensions]);

  if (!activeDrawing) {
    return (
      <main className="flex flex-1 items-center justify-center bg-surface-canvas p-8">
        <EmptyState
          size="sm"
          icon={<Table2 className="h-5 w-5" />}
          title="No Drawing Active"
          description="Select or attach a PDF drawing in the Project or Drawing module to inspect and edit its annotations here."
          actions={
            <Button variant="primary" size="md" onClick={onGoToProject}>
              <FileText className="h-3.5 w-3.5" />
              Go to Project
            </Button>
          }
        />
      </main>
    );
  }

  const renderLinkedPointsCell = (dim: Dimension) => {
    const tokens = resolveLinkedPointDisplayTokens(
      dim.linkedPointIds ?? [],
      dimById,
      pointGroups,
    );
    if (tokens.length === 0) {
      return <span className="text-ink-disabled">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {tokens.map((tok) =>
          tok.kind === "group" ? (
            <Badge key={`g-${tok.group.id}`} tone="point">
              {tok.group.name}
            </Badge>
          ) : (
            <Badge key={`p-${tok.point.id}`} tone="point">
              {tok.point.name || "—"}
            </Badge>
          ),
        )}
      </div>
    );
  };

  const renderLinkedNotesCell = (dim: Dimension) => {
    const ids = dim.linkedNoteIds ?? [];
    if (ids.length === 0) {
      return <span className="text-ink-disabled">—</span>;
    }
    const labels = ids
      .map((id) => dimById.get(id)?.name.trim() || "")
      .filter(Boolean);
    if (labels.length === 0) {
      return <span className="text-ink-disabled">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {labels.map((label, idx) => (
          <Badge key={`${label}-${idx}`} tone="neutral">
            {label}
          </Badge>
        ))}
      </div>
    );
  };

  const renderViewTableForKind = (
    kind: AnnotationKind,
    items: Dimension[],
    showSectionHeader: boolean,
  ) => {
    const kindMeta = ANNOTATION_KIND_OPTIONS.find((o) => o.value === kind);
    return (
      <section
        key={kind}
        className="overflow-hidden rounded-md border border-border-subtle bg-surface-chrome/60"
      >
        {showSectionHeader && (
          <div className="flex items-center justify-between border-b border-border-subtle bg-surface-chrome px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-primary">
                {kindMeta?.label ?? kind}
              </span>
              <span className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                {items.length}
              </span>
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => handleEditCategoryFromView(kind)}
            >
              <Table2 className="h-3 w-3" />
              Edit Table
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-chrome/90 text-[11px] font-medium text-ink-muted">
                <th className="w-10 px-2 py-1.5 text-center font-mono">#</th>
                <th className="w-24 px-2.5 py-1.5 text-left">ID</th>
                {(kind === "linear" ||
                  kind === "gdt" ||
                  kind === "non_dimensional") && (
                  <th className="w-20 px-2.5 py-1.5 text-left">Type</th>
                )}
                <th className="w-14 px-2 py-1.5 text-center">Page</th>
                <th className="w-44 px-2.5 py-1.5 text-left">Position</th>
                {kind === "linear" && (
                  <>
                    <th className="w-14 px-2 py-1.5 text-right">Qty</th>
                    <th className="w-44 px-2.5 py-1.5 text-left">
                      Nominal &amp; Tolerance
                    </th>
                    <th className="w-36 px-2.5 py-1.5 text-left">
                      Linked Points
                    </th>
                    <th className="w-28 px-2.5 py-1.5 text-left">
                      Linked Notes
                    </th>
                    <th className="px-2.5 py-1.5 text-left">Notes</th>
                  </>
                )}
                {kind === "gdt" && (
                  <>
                    <th className="w-14 px-2 py-1.5 text-right">Qty</th>
                    <th className="w-60 px-2.5 py-1.5 text-left">
                      Feature Control Frame
                    </th>
                    <th className="w-14 px-2 py-1.5 text-center">Unit</th>
                    <th className="w-36 px-2.5 py-1.5 text-left">
                      Linked Points
                    </th>
                    <th className="w-28 px-2.5 py-1.5 text-left">
                      Linked Notes
                    </th>
                    <th className="px-2.5 py-1.5 text-left">Notes</th>
                  </>
                )}
                {kind === "non_dimensional" && (
                  <>
                    <th className="w-14 px-2 py-1.5 text-right">Qty</th>
                    <th className="w-64 px-2.5 py-1.5 text-left">
                      Specification
                    </th>
                    <th className="w-36 px-2.5 py-1.5 text-left">
                      Linked Points
                    </th>
                    <th className="w-28 px-2.5 py-1.5 text-left">
                      Linked Notes
                    </th>
                    <th className="px-2.5 py-1.5 text-left">Notes</th>
                  </>
                )}
                {kind === "note" && (
                  <th className="px-2.5 py-1.5 text-left">Note Content</th>
                )}
                {kind === "datum" && (
                  <th className="px-2.5 py-1.5 text-left">Description</th>
                )}
                {kind === "point" && (
                  <>
                    <th className="w-28 px-2.5 py-1.5 text-left">Group</th>
                    <th className="w-24 px-2.5 py-1.5 text-right">X</th>
                    <th className="w-24 px-2.5 py-1.5 text-right">Y</th>
                    <th className="w-24 px-2.5 py-1.5 text-right">Z</th>
                    <th className="w-32 px-2.5 py-1.5 text-left">Datums</th>
                    <th className="px-2.5 py-1.5 text-left">Notes</th>
                  </>
                )}
                <th className="w-10 px-2 py-1.5 text-center" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/70">
              {items.map((dim, idx) => {
                const page = getAnnotationPage(dim);
                return (
                  <tr
                    key={dim.id}
                    className="transition-colors hover:bg-surface-raised/40"
                  >
                    <td className="px-2 py-1.5 text-center font-mono text-[10px] text-ink-subtle">
                      {idx + 1}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono font-medium text-ink-primary">
                      {kind === "datum" ? (
                        <Badge tone="warning">{dim.name || "—"}</Badge>
                      ) : kind === "point" ? (
                        <Badge tone="point">{dim.name || "—"}</Badge>
                      ) : (
                        dim.name || <span className="text-ink-disabled">—</span>
                      )}
                    </td>
                    {(kind === "linear" ||
                      kind === "gdt" ||
                      kind === "non_dimensional") && (
                      <td className="px-2.5 py-1.5 font-mono">
                        {dim.dimensionType?.trim() ? (
                          <Badge tone="neutral">
                            {dim.dimensionType.trim()}
                          </Badge>
                        ) : (
                          <span className="text-ink-disabled">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-center font-mono text-[11px] text-ink-muted">
                      {page !== null ? `P${page}` : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-[11px] text-ink-muted">
                      {dim.marker ? (
                        <span className="truncate">
                          {formatMarkerPosition(dim.marker)}
                        </span>
                      ) : (
                        <span className="text-ink-disabled">—</span>
                      )}
                    </td>

                    {kind === "linear" && (() => {
                      const spec = formatLinearSpec(dim);
                      return (
                        <>
                          <td className="px-2 py-1.5 text-right font-mono text-ink-secondary">
                            {dim.quantity > 1 ? (
                              `${dim.quantity}×`
                            ) : dim.quantity === 1 ? (
                              "1"
                            ) : (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono">
                            <span className="text-ink-primary">
                              {spec.nominal}
                            </span>
                            {spec.tol && (
                              <span className="ml-1.5 text-ink-secondary">
                                {spec.tol}
                              </span>
                            )}
                            <span className="ml-1 text-[10px] text-ink-subtle">
                              {spec.unit}
                            </span>
                          </td>
                          <td className="px-2.5 py-1.5">
                            {renderLinkedPointsCell(dim)}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {renderLinkedNotesCell(dim)}
                          </td>
                          <td className="max-w-xs truncate px-2.5 py-1.5 text-ink-secondary">
                            {dim.notes || (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}

                    {kind === "gdt" && (() => {
                      const spec = dim.gdt;
                      const datums = (spec?.datums ?? []).filter((d) =>
                        d.datum.trim(),
                      );
                      return (
                        <>
                          <td className="px-2 py-1.5 text-right font-mono text-ink-secondary">
                            {dim.quantity > 1 ? (
                              `${dim.quantity}×`
                            ) : dim.quantity === 1 ? (
                              "1"
                            ) : (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {spec ? (
                              <span className="inline-flex items-center divide-x divide-border-control rounded border border-border-control bg-surface-canvas font-mono text-[11px]">
                                <span className="px-1.5 py-0.5 text-ink-primary">
                                  {getGdtSymbolGlyph(spec.symbol)}
                                </span>
                                <span className="px-1.5 py-0.5 text-ink-primary">
                                  {spec.diameterZone ? "Ø" : ""}
                                  {spec.tolerance || "—"}
                                  {spec.materialCondition ? (
                                    <span className="ml-0.5 text-accent-warning">
                                      {getMaterialConditionGlyph(
                                        spec.materialCondition,
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                                {datums.map((d, dIdx) => (
                                  <span
                                    key={dIdx}
                                    className="px-1.5 py-0.5 text-accent-warning"
                                  >
                                    {d.datum}
                                    {d.materialCondition
                                      ? getMaterialConditionGlyph(
                                          d.materialCondition,
                                        )
                                      : ""}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center font-mono text-[11px] text-ink-muted">
                            {dim.unit}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {renderLinkedPointsCell(dim)}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {renderLinkedNotesCell(dim)}
                          </td>
                          <td className="max-w-xs truncate px-2.5 py-1.5 text-ink-secondary">
                            {dim.notes || (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}

                    {kind === "non_dimensional" && (
                      <>
                        <td className="px-2 py-1.5 text-right font-mono text-ink-secondary">
                          {dim.quantity > 1 ? `${dim.quantity}×` : "1"}
                        </td>
                        <td className="px-2.5 py-1.5 text-ink-primary">
                          {dim.nominal || (
                            <span className="text-ink-disabled">—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5">
                          {renderLinkedPointsCell(dim)}
                        </td>
                        <td className="px-2.5 py-1.5">
                          {renderLinkedNotesCell(dim)}
                        </td>
                        <td className="max-w-xs truncate px-2.5 py-1.5 text-ink-secondary">
                          {dim.notes || (
                            <span className="text-ink-disabled">—</span>
                          )}
                        </td>
                      </>
                    )}

                    {(kind === "note" || kind === "datum") && (
                      <td className="px-2.5 py-1.5 text-ink-secondary whitespace-pre-wrap">
                        {dim.notes || (
                          <span className="text-ink-disabled">—</span>
                        )}
                      </td>
                    )}

                    {kind === "point" && (() => {
                      const groupName = groupNameByPointId.get(dim.id);
                      const ptDatums = (dim.point?.datums ?? []).filter((d) =>
                        d.trim(),
                      );
                      return (
                        <>
                          <td className="px-2.5 py-1.5">
                            {groupName ? (
                              <Badge tone="neutral">{groupName}</Badge>
                            ) : (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-ink-primary">
                            {dim.point?.x || (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-ink-primary">
                            {dim.point?.y || (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-ink-primary">
                            {dim.point?.z || (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {ptDatums.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ptDatums.map((d, dIdx) => (
                                  <Badge key={dIdx} tone="warning">
                                    {d}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                          <td className="max-w-xs truncate px-2.5 py-1.5 text-ink-secondary">
                            {dim.notes || (
                              <span className="text-ink-disabled">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}

                    <td className="px-2 py-1 text-center">
                      <IconButton
                        variant="ghost"
                        size="xs"
                        aria-label={`Locate ${dim.name || "annotation"} on drawing`}
                        title="Locate on Drawing"
                        onClick={() => onLocateOnDrawing(dim.id)}
                      >
                        <Crosshair className="h-3.5 w-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-canvas">
      {/* Module Sub-Toolbar */}
      <div className="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border-subtle bg-surface-chrome/90 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            title={
              drawingOptions.find((opt) => opt.id === activeDrawing.id)
                ?.label ?? activeDrawing.filename
            }
            className="max-w-[220px] truncate font-mono text-[11px] text-ink-muted"
          >
            {drawingOptions.find((opt) => opt.id === activeDrawing.id)?.label ??
              activeDrawing.filename}
          </span>

          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-subtle" />
            <Input
              surface="on-chrome"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter ID, value, notes..."
              className="h-7 w-48 pl-7 pr-6 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 text-ink-subtle hover:text-ink-primary"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ToolbarGroup>
            <button
              type="button"
              onClick={() => handleSetMode("view")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mode === "view"
                  ? "bg-surface-hover text-ink-primary"
                  : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              View
            </button>
            <button
              type="button"
              onClick={() => handleSetMode("edit")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mode === "edit"
                  ? "bg-surface-hover text-ink-primary"
                  : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              Edit
            </button>
          </ToolbarGroup>
        </div>

        <div className="flex items-center justify-self-end gap-1.5">
          {mode === "edit" ? (
            <>
              <IconButton
                variant="ghost"
                size="xs"
                aria-label="Undo table edit"
                title="Undo (⌘Z)"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="xs"
                aria-label="Redo table edit"
                title="Redo (⌘⇧Z)"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </IconButton>
              <div className="mx-1 h-4 w-px bg-border-subtle" />
              <Button
                variant="primary"
                size="xs"
                onClick={() => onAddAnnotationRow(effectiveEditKind)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Row
              </Button>
              <Button
                variant="secondary"
                size="xs"
                title="Insert row(s) below selection"
                disabled={selectionSummary.selectedRowIds.length === 0}
                onClick={() => {
                  const ids = selectionSummary.selectedRowIds;
                  if (ids.length === 0) return;
                  onInsertAnnotationRows(
                    effectiveEditKind,
                    ids[ids.length - 1],
                    "below",
                    ids.length,
                  );
                }}
              >
                <ListPlus className="h-3.5 w-3.5" />
                Insert
                {selectionSummary.selectedRowIds.length > 1
                  ? ` (${selectionSummary.selectedRowIds.length})`
                  : ""}
              </Button>
              <Button
                variant="secondary"
                size="xs"
                title="Duplicate selected row(s)"
                disabled={selectionSummary.selectedRowIds.length === 0}
                onClick={() => onDuplicateRows(selectionSummary.selectedRowIds)}
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
                {selectionSummary.selectedRowIds.length > 1
                  ? ` (${selectionSummary.selectedRowIds.length})`
                  : ""}
              </Button>
              <Button
                variant="danger"
                size="xs"
                disabled={selectionSummary.selectedRowIds.length === 0}
                onClick={() => onDeleteRows(selectionSummary.selectedRowIds)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
                {selectionSummary.selectedRowIds.length > 1
                  ? ` (${selectionSummary.selectedRowIds.length})`
                  : ""}
              </Button>
            </>
          ) : (
            <span className="font-mono text-[11px] text-ink-subtle">
              {totalFilteredCount} annotation
              {totalFilteredCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle bg-surface-chrome px-3 py-1.5">
        {mode === "view" && (
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "all"
                ? "bg-surface-raised text-ink-primary"
                : "text-ink-muted hover:bg-surface-raised/50 hover:text-ink-secondary"
            }`}
          >
            <span>All</span>
            <span className="font-mono text-[10px] text-ink-subtle">
              {totalFilteredCount}
            </span>
          </button>
        )}
        {ANNOTATION_KIND_OPTIONS.map((opt) => {
          const count = groupedByKind.get(opt.value)?.length ?? 0;
          const isSelected =
            mode === "edit"
              ? effectiveEditKind === opt.value
              : activeTab === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setActiveTab(opt.value)}
              className={`flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                isSelected
                  ? "bg-surface-raised text-ink-primary"
                  : "text-ink-muted hover:bg-surface-raised/50 hover:text-ink-secondary"
              }`}
            >
              <span>{opt.label}</span>
              <span className="font-mono text-[10px] text-ink-subtle">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      {mode === "view" ? (
        <div
          ref={viewScrollRef}
          onScroll={(e) => {
            if (!isActive) return;
            const el = e.currentTarget;
            if (el.clientHeight > 0) {
              savedViewScrollTopRef.current = el.scrollTop;
            }
          }}
          className="min-h-0 flex-1 overflow-auto p-4"
        >
          {totalFilteredCount === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                size="sm"
                icon={<Table2 className="h-5 w-5" />}
                title={
                  searchQuery.trim()
                    ? "No Matching Annotations"
                    : "No Annotations Yet"
                }
                description={
                  searchQuery.trim()
                    ? "Try clearing or adjusting your filter query."
                    : "Add dimensions in the Drawing module or switch to Edit mode to create rows directly."
                }
                actions={
                  searchQuery.trim() ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSearchQuery("")}
                    >
                      Clear Filter
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSetMode("edit")}
                    >
                      <Table2 className="h-3.5 w-3.5" />
                      Switch to Edit Mode
                    </Button>
                  )
                }
              />
            </div>
          ) : activeTab === "all" ? (
            <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
              {ANNOTATION_KIND_OPTIONS.map((opt) => {
                const items = groupedByKind.get(opt.value) ?? [];
                if (items.length === 0) return null;
                return renderViewTableForKind(opt.value, items, true);
              })}
            </div>
          ) : (
            <div className="mx-auto max-w-[1600px]">
              {(groupedByKind.get(activeTab)?.length ?? 0) === 0 ? (
                <div className="flex py-16 items-center justify-center">
                  <EmptyState
                    size="sm"
                    icon={<Table2 className="h-5 w-5" />}
                    title={`No ${
                      ANNOTATION_KIND_OPTIONS.find((o) => o.value === activeTab)
                        ?.label ?? activeTab
                    } Annotations`}
                    description="Switch to Edit mode to add rows for this category."
                    actions={
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSetMode("edit")}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Edit Table
                      </Button>
                    }
                  />
                </div>
              ) : (
                renderViewTableForKind(
                  activeTab,
                  groupedByKind.get(activeTab) ?? [],
                  false,
                )
              )}
            </div>
          )}
        </div>
      ) : editRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            size="sm"
            icon={<Table2 className="h-5 w-5" />}
            title={`No ${
              ANNOTATION_KIND_OPTIONS.find((o) => o.value === effectiveEditKind)
                ?.label ?? effectiveEditKind
            } Rows`}
            description="Add a new row to start batch editing in spreadsheet mode."
            actions={
              <Button
                variant="primary"
                size="sm"
                onClick={() => onAddAnnotationRow(effectiveEditKind)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Row
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <SpreadsheetGrid
            isActive={isActive && mode === "edit"}
            columns={editColumns}
            rows={gridMatrix}
            rowIds={gridRowIds}
            onApplyEdits={handleApplyEdits}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onLocateRow={onLocateOnDrawing}
            onInsertRows={(anchorId, position, count) =>
              onInsertAnnotationRows(
                effectiveEditKind,
                anchorId,
                position,
                count,
              )
            }
            onDuplicateRows={onDuplicateRows}
            onDeleteRows={onDeleteRows}
            onSelectionChange={setSelectionSummary}
            onNotify={onNotify}
          />
          <div className="flex h-6 shrink-0 items-center justify-between border-t border-border-subtle bg-surface-chrome px-3 font-mono text-[10px] text-ink-subtle">
            <span>
              Enter/F2 Edit · ⌘C/X/V TSV · ⌘D Fill Down · ⌘Z/⌘⇧Z Undo/Redo ·
              Drag corner to fill
            </span>
            <span>
              {editRows.length} row{editRows.length === 1 ? "" : "s"}
              {selectionSummary.rowCount > 0 && selectionSummary.colCount > 0
                ? ` · Selected ${selectionSummary.rowCount}×${selectionSummary.colCount}`
                : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
