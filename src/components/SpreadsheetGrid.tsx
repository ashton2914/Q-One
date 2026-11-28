import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Crosshair,
  Eraser,
  Lock,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  buildGridTsv,
  computePasteEdits,
  formatCellDisplayValue,
  normalizeGridRange,
  parseClipboardTsv,
  type AnnotationColumnDef,
  type CellEdit,
  type GridPosition,
  type GridRange,
} from "../lib/annotationTable";
import { FloatingMenu } from "./ui";

export interface SpreadsheetGridProps {
  isActive?: boolean;
  columns: readonly AnnotationColumnDef[];
  /** Raw string values matrix [rowIndex][colIndex] */
  rows: readonly (readonly string[])[];
  /** Stable row IDs aligned with `rows` */
  rowIds: readonly string[];
  onApplyEdits: (edits: CellEdit[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onLocateRow?: (rowId: string) => void;
  onInsertRows?: (
    anchorRowId: string,
    position: "above" | "below",
    count: number,
  ) => void;
  onDuplicateRows?: (rowIds: string[]) => void;
  onDeleteRows?: (rowIds: string[]) => void;
  onSelectionChange?: (summary: {
    selectedRowIds: string[];
    rowCount: number;
    colCount: number;
  }) => void;
  onNotify?: (kind: "info" | "error", text: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  row: number;
  col: number;
}

const ROW_HDR_WIDTH = 44;

export function SpreadsheetGrid({
  isActive = true,
  columns,
  rows,
  rowIds,
  onApplyEdits,
  onUndo,
  onRedo,
  onLocateRow,
  onInsertRows,
  onDuplicateRows,
  onDeleteRows,
  onSelectionChange,
  onNotify,
}: SpreadsheetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  const editInputRef = useRef<HTMLInputElement>(null);
  const editSelectRef = useRef<HTMLSelectElement>(null);
  const skipNextBlurCommitRef = useRef(false);

  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [activeCell, setActiveCell] = useState<GridPosition | null>(
    rows.length > 0 && columns.length > 0 ? { row: 0, col: 0 } : null,
  );
  const [selection, setSelection] = useState<GridRange | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set());
  const [editCell, setEditCell] = useState<GridPosition | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [fillPreview, setFillPreview] = useState<GridRange | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const rowCount = rows.length;
  const colCount = columns.length;

  // Clamp selection when rows/columns change (e.g., category switch or row deletion)
  useEffect(() => {
    setEditCell(null);
    setContextMenu(null);
    if (rowCount === 0 || colCount === 0) {
      setActiveCell(null);
      setSelection(null);
      setSelectedRows(new Set());
      setSelectedCols(new Set());
      return;
    }
    setActiveCell((prev) => {
      if (!prev) return { row: 0, col: 0 };
      return {
        row: Math.min(prev.row, rowCount - 1),
        col: Math.min(prev.col, colCount - 1),
      };
    });
    setSelection((prev) => {
      if (!prev) return null;
      return {
        startRow: Math.min(prev.startRow, rowCount - 1),
        startCol: Math.min(prev.startCol, colCount - 1),
        endRow: Math.min(prev.endRow, rowCount - 1),
        endCol: Math.min(prev.endCol, colCount - 1),
      };
    });
    setSelectedRows((prev) => {
      const next = new Set([...prev].filter((r) => r < rowCount));
      return next.size === prev.size ? prev : next;
    });
    setSelectedCols((prev) => {
      const next = new Set([...prev].filter((c) => c < colCount));
      return next.size === prev.size ? prev : next;
    });
  }, [rowCount, colCount, columns]);

  const normalizedSelection = useMemo(
    () => (selection ? normalizeGridRange(selection) : null),
    [selection],
  );

  const normalizedFillPreview = useMemo(
    () => (fillPreview ? normalizeGridRange(fillPreview) : null),
    [fillPreview],
  );

  // Report selection summary upward (for toolbar Delete / readout)
  useEffect(() => {
    if (!onSelectionChange) return;
    if (selectedRows.size > 0) {
      const ids = [...selectedRows]
        .sort((a, b) => a - b)
        .map((r) => rowIds[r])
        .filter((id): id is string => Boolean(id));
      onSelectionChange({
        selectedRowIds: ids,
        rowCount: ids.length,
        colCount,
      });
      return;
    }
    if (selectedCols.size > 0) {
      onSelectionChange({
        selectedRowIds: [...rowIds],
        rowCount,
        colCount: selectedCols.size,
      });
      return;
    }
    if (normalizedSelection) {
      const ids: string[] = [];
      for (let r = normalizedSelection.r1; r <= normalizedSelection.r2; r++) {
        if (rowIds[r]) ids.push(rowIds[r]);
      }
      onSelectionChange({
        selectedRowIds: ids,
        rowCount: normalizedSelection.r2 - normalizedSelection.r1 + 1,
        colCount: normalizedSelection.c2 - normalizedSelection.c1 + 1,
      });
      return;
    }
    if (activeCell && rowIds[activeCell.row]) {
      onSelectionChange({
        selectedRowIds: [rowIds[activeCell.row]],
        rowCount: 1,
        colCount: 1,
      });
      return;
    }
    onSelectionChange({ selectedRowIds: [], rowCount: 0, colCount: 0 });
  }, [
    selectedRows,
    selectedCols,
    normalizedSelection,
    activeCell,
    rowIds,
    rowCount,
    colCount,
    onSelectionChange,
  ]);

  // Focus inline editor when entering edit mode
  useEffect(() => {
    if (!editCell) return;
    const col = columns[editCell.col];
    if (col?.editorType === "select" || col?.editorType === "boolean") {
      editSelectRef.current?.focus();
    } else {
      const input = editInputRef.current;
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  }, [editCell, columns]);

  // Restore scroll position when returning to the Annotations module
  useLayoutEffect(() => {
    if (!isActive) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollLeft = savedScrollRef.current.left;
    el.scrollTop = savedScrollRef.current.top;
  }, [isActive]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    window.addEventListener("pointerdown", handleClose);
    return () => window.removeEventListener("pointerdown", handleClose);
  }, [contextMenu]);

  const getColumnWidth = useCallback(
    (col: AnnotationColumnDef) => colWidths[col.key] ?? col.width,
    [colWidths],
  );

  const startEdit = useCallback(
    (row: number, col: number, initialValue?: string) => {
      const colDef = columns[col];
      if (!colDef || !colDef.editable) return;
      const current = rows[row]?.[col] ?? "";
      setActiveCell({ row, col });
      setSelection(null);
      setSelectedRows(new Set());
      setSelectedCols(new Set());
      setEditCell({ row, col });
      setEditValue(initialValue !== undefined ? initialValue : current);
    },
    [columns, rows],
  );

  const moveFocusAfterEdit = useCallback(
    (
      from: GridPosition,
      direction: "none" | "down" | "right" | "left",
    ) => {
      if (direction === "none") return;
      let nextRow = from.row;
      let nextCol = from.col;
      if (direction === "down") {
        nextRow = Math.min(rowCount - 1, from.row + 1);
      } else if (direction === "right") {
        nextCol = Math.min(colCount - 1, from.col + 1);
      } else if (direction === "left") {
        nextCol = Math.max(0, from.col - 1);
      }
      setActiveCell({ row: nextRow, col: nextCol });
      setSelection(null);
      containerRef.current?.focus();
    },
    [rowCount, colCount],
  );

  const commitEdit = useCallback(
    (
      direction: "none" | "down" | "right" | "left" = "none",
      overrideValue?: string,
    ) => {
      if (!editCell) return;
      const valueToSave = overrideValue !== undefined ? overrideValue : editValue;
      const current = rows[editCell.row]?.[editCell.col] ?? "";
      const pos = editCell;
      setEditCell(null);
      if (valueToSave !== current) {
        onApplyEdits([{ row: pos.row, col: pos.col, value: valueToSave }]);
      }
      moveFocusAfterEdit(pos, direction);
    },
    [editCell, editValue, rows, onApplyEdits, moveFocusAfterEdit],
  );

  const cancelEdit = useCallback(() => {
    skipNextBlurCommitRef.current = true;
    setEditCell(null);
    containerRef.current?.focus();
  }, []);

  const resolveSelectionCells = useCallback((): {
    rowIndices: number[];
    colIndices: number[];
  } | null => {
    if (rowCount === 0 || colCount === 0) return null;
    if (selectedRows.size > 0) {
      return {
        rowIndices: [...selectedRows].sort((a, b) => a - b),
        colIndices: Array.from({ length: colCount }, (_, i) => i),
      };
    }
    if (selectedCols.size > 0) {
      return {
        rowIndices: Array.from({ length: rowCount }, (_, i) => i),
        colIndices: [...selectedCols].sort((a, b) => a - b),
      };
    }
    if (normalizedSelection) {
      const rowIndices: number[] = [];
      for (let r = normalizedSelection.r1; r <= normalizedSelection.r2; r++) {
        rowIndices.push(r);
      }
      const colIndices: number[] = [];
      for (let c = normalizedSelection.c1; c <= normalizedSelection.c2; c++) {
        colIndices.push(c);
      }
      return { rowIndices, colIndices };
    }
    if (activeCell) {
      return { rowIndices: [activeCell.row], colIndices: [activeCell.col] };
    }
    return null;
  }, [rowCount, colCount, selectedRows, selectedCols, normalizedSelection, activeCell]);

  const handleCopy = useCallback(
    async (withHeader = false): Promise<boolean> => {
      const sel = resolveSelectionCells();
      if (!sel) return false;
      const headers = withHeader ? columns.map((c) => c.label) : undefined;
      const tsv = buildGridTsv(rows, sel.rowIndices, sel.colIndices, headers);
      try {
        await navigator.clipboard.writeText(tsv);
        return true;
      } catch {
        onNotify?.("error", "Failed to write to clipboard");
        return false;
      }
    },
    [resolveSelectionCells, columns, rows, onNotify],
  );

  const handleClearSelection = useCallback(() => {
    const sel = resolveSelectionCells();
    if (!sel) return;
    const edits: CellEdit[] = [];
    for (const r of sel.rowIndices) {
      for (const c of sel.colIndices) {
        if (columns[c]?.editable || columns[c]?.pasteable) {
          edits.push({ row: r, col: c, value: "" });
        }
      }
    }
    if (edits.length > 0) {
      onApplyEdits(edits);
    }
  }, [resolveSelectionCells, columns, onApplyEdits]);

  const handleCut = useCallback(async () => {
    const ok = await handleCopy(false);
    if (ok) {
      handleClearSelection();
    }
  }, [handleCopy, handleClearSelection]);

  const applyPasteText = useCallback(
    (text: string) => {
      if (!text) return;
      const matrix = parseClipboardTsv(text);
      if (matrix.length === 0) return;
      const anchor = activeCell ?? { row: 0, col: 0 };
      const rangeForPaste: GridRange | null =
        selectedRows.size > 0
          ? {
              startRow: Math.min(...selectedRows),
              endRow: Math.max(...selectedRows),
              startCol: 0,
              endCol: colCount - 1,
            }
          : selectedCols.size > 0
            ? {
                startRow: 0,
                endRow: rowCount - 1,
                startCol: Math.min(...selectedCols),
                endCol: Math.max(...selectedCols),
              }
            : selection;

      const edits = computePasteEdits(
        matrix,
        anchor,
        rangeForPaste,
        rowCount,
        colCount,
      );
      if (edits.length > 0) {
        onApplyEdits(edits);
        // Highlight pasted area
        const minR = Math.min(...edits.map((e) => e.row));
        const maxR = Math.max(...edits.map((e) => e.row));
        const minC = Math.min(...edits.map((e) => e.col));
        const maxC = Math.max(...edits.map((e) => e.col));
        setActiveCell({ row: minR, col: minC });
        setSelection(
          minR === maxR && minC === maxC
            ? null
            : { startRow: minR, startCol: minC, endRow: maxR, endCol: maxC },
        );
        setSelectedRows(new Set());
        setSelectedCols(new Set());
      }
    },
    [
      activeCell,
      selectedRows,
      selectedCols,
      selection,
      rowCount,
      colCount,
      onApplyEdits,
    ],
  );

  const handlePasteEvent = useCallback(
    (e: React.ClipboardEvent) => {
      if (editCell) return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tgt?.isContentEditable
      ) {
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      applyPasteText(text);
    },
    [editCell, applyPasteText],
  );

  const handlePasteFromClipboardApi = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) applyPasteText(text);
    } catch {
      onNotify?.("error", "Unable to read clipboard");
    }
  }, [applyPasteText, onNotify]);

  const handleFillDown = useCallback(() => {
    if (!normalizedSelection) return;
    const { r1, c1, r2, c2 } = normalizedSelection;
    if (r2 <= r1) return;
    const edits: CellEdit[] = [];
    for (let c = c1; c <= c2; c++) {
      if (!columns[c]?.editable && !columns[c]?.pasteable) continue;
      const sourceVal = rows[r1]?.[c] ?? "";
      for (let r = r1 + 1; r <= r2; r++) {
        edits.push({ row: r, col: c, value: sourceVal });
      }
    }
    if (edits.length > 0) {
      onApplyEdits(edits);
    }
  }, [normalizedSelection, columns, rows, onApplyEdits]);

  // Pointer drag selection on cells
  const handleCellPointerDown = useCallback(
    (e: React.PointerEvent, row: number, col: number) => {
      if (e.button !== 0) return;
      if (editCell && editCell.row === row && editCell.col === col) return;
      if (editCell) {
        commitEdit("none");
      }
      setContextMenu(null);
      setSelectedRows(new Set());
      setSelectedCols(new Set());

      if (e.shiftKey && activeCell) {
        setSelection({
          startRow: activeCell.row,
          startCol: activeCell.col,
          endRow: row,
          endCol: col,
        });
        containerRef.current?.focus();
        return;
      }

      setActiveCell({ row, col });
      setSelection(null);
      containerRef.current?.focus();

      const startRow = row;
      const startCol = col;
      const onPointerMove = (ev: PointerEvent) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const td = el?.closest<HTMLElement>("td[data-row][data-col]");
        if (!td) return;
        const r = Number(td.dataset.row);
        const c = Number(td.dataset.col);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;
        if (r === startRow && c === startCol) {
          setSelection(null);
        } else {
          setSelection({ startRow, startCol, endRow: r, endCol: c });
        }
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [editCell, commitEdit, activeCell],
  );

  // Drag fill handle (Excel-style corner drag)
  const handleFillHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const base = normalizedSelection ?? (
        activeCell
          ? {
              r1: activeCell.row,
              c1: activeCell.col,
              r2: activeCell.row,
              c2: activeCell.col,
            }
          : null
      );
      if (!base) return;

      let latestTarget: GridRange | null = null;

      const onPointerMove = (ev: PointerEvent) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const td = el?.closest<HTMLElement>("td[data-row][data-col]");
        if (!td) return;
        const r = Number(td.dataset.row);
        const c = Number(td.dataset.col);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;

        // Decide whether vertical or horizontal drag dominates
        const dy = r > base.r2 ? r - base.r2 : r < base.r1 ? base.r1 - r : 0;
        const dx = c > base.c2 ? c - base.c2 : c < base.c1 ? base.c1 - c : 0;
        if (dy === 0 && dx === 0) {
          latestTarget = null;
          setFillPreview(null);
          return;
        }
        if (dy >= dx) {
          latestTarget = {
            startRow: Math.min(base.r1, r),
            endRow: Math.max(base.r2, r),
            startCol: base.c1,
            endCol: base.c2,
          };
        } else {
          latestTarget = {
            startRow: base.r1,
            endRow: base.r2,
            startCol: Math.min(base.c1, c),
            endCol: Math.max(base.c2, c),
          };
        }
        setFillPreview(latestTarget);
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        setFillPreview(null);
        if (!latestTarget) return;

        const norm = normalizeGridRange(latestTarget);
        const srcHeight = base.r2 - base.r1 + 1;
        const srcWidth = base.c2 - base.c1 + 1;
        const edits: CellEdit[] = [];

        for (let r = norm.r1; r <= norm.r2; r++) {
          for (let c = norm.c1; c <= norm.c2; c++) {
            const insideSource =
              r >= base.r1 && r <= base.r2 && c >= base.c1 && c <= base.c2;
            if (
              insideSource ||
              (!columns[c]?.editable && !columns[c]?.pasteable)
            ) {
              continue;
            }
            const srcR =
              base.r1 + ((((r - base.r1) % srcHeight) + srcHeight) % srcHeight);
            const srcC =
              base.c1 + ((((c - base.c1) % srcWidth) + srcWidth) % srcWidth);
            edits.push({ row: r, col: c, value: rows[srcR]?.[srcC] ?? "" });
          }
        }
        if (edits.length > 0) {
          onApplyEdits(edits);
          setSelection({
            startRow: norm.r1,
            startCol: norm.c1,
            endRow: norm.r2,
            endCol: norm.c2,
          });
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [normalizedSelection, activeCell, columns, rows, onApplyEdits],
  );

  // Row header selection
  const handleRowHeaderPointerDown = useCallback(
    (e: React.PointerEvent, row: number) => {
      if (e.button !== 0) return;
      if (editCell) commitEdit("none");
      setContextMenu(null);
      setSelectedCols(new Set());
      setSelection(null);
      containerRef.current?.focus();

      if (e.shiftKey && activeCell) {
        const r1 = Math.min(activeCell.row, row);
        const r2 = Math.max(activeCell.row, row);
        const next = new Set<number>();
        for (let r = r1; r <= r2; r++) next.add(r);
        setSelectedRows(next);
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        setSelectedRows((prev) => {
          const next = new Set(prev);
          if (next.has(row)) next.delete(row);
          else next.add(row);
          return next;
        });
        setActiveCell({ row, col: 0 });
        return;
      }

      setActiveCell({ row, col: 0 });
      setSelectedRows(new Set([row]));

      const anchorRow = row;
      const onPointerMove = (ev: PointerEvent) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const hdr = el?.closest<HTMLElement>("td[data-row-hdr]");
        if (!hdr) return;
        const r = Number(hdr.dataset.rowHdr);
        if (!Number.isFinite(r)) return;
        const r1 = Math.min(anchorRow, r);
        const r2 = Math.max(anchorRow, r);
        const next = new Set<number>();
        for (let i = r1; i <= r2; i++) next.add(i);
        setSelectedRows(next);
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [editCell, commitEdit, activeCell],
  );

  // Column header selection
  const handleColHeaderPointerDown = useCallback(
    (e: React.PointerEvent, col: number) => {
      if (e.button !== 0) return;
      if (editCell) commitEdit("none");
      setContextMenu(null);
      setSelectedRows(new Set());
      setSelection(null);
      setActiveCell(rowCount > 0 ? { row: 0, col } : null);
      containerRef.current?.focus();

      if (e.shiftKey && activeCell) {
        const c1 = Math.min(activeCell.col, col);
        const c2 = Math.max(activeCell.col, col);
        const next = new Set<number>();
        for (let c = c1; c <= c2; c++) next.add(c);
        setSelectedCols(next);
        return;
      }

      setSelectedCols(new Set([col]));
    },
    [editCell, commitEdit, activeCell, rowCount],
  );

  // Pointer-based column resizing
  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent, col: AnnotationColumnDef) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = getColumnWidth(col);
      const minW = col.minWidth ?? 52;

      const onPointerMove = (ev: PointerEvent) => {
        const nextW = Math.max(minW, Math.round(startW + (ev.clientX - startX)));
        setColWidths((prev) => ({ ...prev, [col.key]: nextW }));
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [getColumnWidth],
  );

  // Keyboard navigation & shortcuts (IME-safe)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      if (editCell) return;

      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tgt?.isContentEditable
      ) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      const keyLower = e.key.toLowerCase();

      if (isMod && !e.shiftKey && keyLower === "z") {
        e.preventDefault();
        onUndo?.();
        return;
      }
      if (isMod && e.shiftKey && keyLower === "z") {
        e.preventDefault();
        onRedo?.();
        return;
      }
      if (isMod && !e.shiftKey && keyLower === "a") {
        if (rowCount > 0 && colCount > 0) {
          e.preventDefault();
          setActiveCell({ row: 0, col: 0 });
          setSelection({
            startRow: 0,
            startCol: 0,
            endRow: rowCount - 1,
            endCol: colCount - 1,
          });
          setSelectedRows(new Set());
          setSelectedCols(new Set());
        }
        return;
      }
      if (isMod && !e.shiftKey && keyLower === "c") {
        e.preventDefault();
        void handleCopy(false);
        return;
      }
      if (isMod && !e.shiftKey && keyLower === "x") {
        e.preventDefault();
        void handleCut();
        return;
      }
      if (isMod && !e.shiftKey && keyLower === "d") {
        e.preventDefault();
        handleFillDown();
        return;
      }

      if (!activeCell || rowCount === 0 || colCount === 0) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleClearSelection();
        return;
      }

      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        startEdit(activeCell.row, activeCell.col);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const nextCol = e.shiftKey
          ? Math.max(0, activeCell.col - 1)
          : Math.min(colCount - 1, activeCell.col + 1);
        setActiveCell({ row: activeCell.row, col: nextCol });
        setSelection(null);
        setSelectedRows(new Set());
        setSelectedCols(new Set());
        return;
      }

      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        const srcRow =
          e.shiftKey && selection ? selection.endRow : activeCell.row;
        const srcCol =
          e.shiftKey && selection ? selection.endCol : activeCell.col;
        let nextRow = srcRow;
        let nextCol = srcCol;

        if (e.key === "ArrowUp") {
          nextRow = isMod ? 0 : Math.max(0, srcRow - 1);
        } else if (e.key === "ArrowDown") {
          nextRow = isMod ? rowCount - 1 : Math.min(rowCount - 1, srcRow + 1);
        } else if (e.key === "ArrowLeft") {
          nextCol = isMod ? 0 : Math.max(0, srcCol - 1);
        } else if (e.key === "ArrowRight") {
          nextCol = isMod ? colCount - 1 : Math.min(colCount - 1, srcCol + 1);
        }

        setSelectedRows(new Set());
        setSelectedCols(new Set());
        if (e.shiftKey) {
          setSelection({
            startRow: activeCell.row,
            startCol: activeCell.col,
            endRow: nextRow,
            endCol: nextCol,
          });
        } else {
          setActiveCell({ row: nextRow, col: nextCol });
          setSelection(null);
        }
        return;
      }

      // Printable character: start typing directly into the active cell
      if (
        !isMod &&
        !e.altKey &&
        e.key.length === 1 &&
        columns[activeCell.col]?.editable
      ) {
        const colDef = columns[activeCell.col];
        if (colDef.editorType !== "select" && colDef.editorType !== "boolean") {
          e.preventDefault();
          startEdit(activeCell.row, activeCell.col, e.key);
        }
      }
    },
    [
      editCell,
      rowCount,
      colCount,
      activeCell,
      selection,
      columns,
      onUndo,
      onRedo,
      handleCopy,
      handleCut,
      handleFillDown,
      handleClearSelection,
      startEdit,
    ],
  );

  const handleCellContextMenu = useCallback(
    (e: React.MouseEvent, row: number, col: number) => {
      e.preventDefault();
      e.stopPropagation();
      const inRange =
        normalizedSelection &&
        row >= normalizedSelection.r1 &&
        row <= normalizedSelection.r2 &&
        col >= normalizedSelection.c1 &&
        col <= normalizedSelection.c2;
      if (!inRange && !selectedRows.has(row)) {
        setActiveCell({ row, col });
        setSelection(null);
        setSelectedRows(new Set());
        setSelectedCols(new Set());
      }
      setContextMenu({ x: e.clientX, y: e.clientY, row, col });
    },
    [normalizedSelection, selectedRows],
  );

  // Determine the cell where the drag fill handle sits (bottom-right of selection or active cell)
  const fillHandleCell = useMemo<GridPosition | null>(() => {
    if (editCell || selectedRows.size > 0 || selectedCols.size > 0) return null;
    if (normalizedSelection) {
      return { row: normalizedSelection.r2, col: normalizedSelection.c2 };
    }
    return activeCell;
  }, [editCell, selectedRows, selectedCols, normalizedSelection, activeCell]);

  const contextRowIds = useMemo(() => {
    if (selectedRows.size > 0) {
      return [...selectedRows]
        .sort((a, b) => a - b)
        .map((r) => rowIds[r])
        .filter((id): id is string => Boolean(id));
    }
    if (normalizedSelection) {
      const ids: string[] = [];
      for (let r = normalizedSelection.r1; r <= normalizedSelection.r2; r++) {
        if (rowIds[r]) ids.push(rowIds[r]);
      }
      return ids;
    }
    if (contextMenu && rowIds[contextMenu.row]) {
      return [rowIds[contextMenu.row]];
    }
    return [];
  }, [selectedRows, normalizedSelection, contextMenu, rowIds]);

  const totalTableWidth = useMemo(
    () =>
      ROW_HDR_WIDTH +
      columns.reduce((sum, col) => sum + getColumnWidth(col), 0),
    [columns, getColumnWidth],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePasteEvent}
      onScroll={(e) => {
        if (!isActive) return;
        const el = e.currentTarget;
        if (el.clientHeight > 0) {
          savedScrollRef.current = { left: el.scrollLeft, top: el.scrollTop };
        }
      }}
      className="relative flex-1 overflow-auto bg-surface-canvas outline-none select-none"
    >
      <table
        className="border-collapse table-fixed text-xs"
        style={{ width: totalTableWidth }}
      >
        <colgroup>
          <col style={{ width: ROW_HDR_WIDTH }} />
          {columns.map((col) => (
            <col key={col.key} style={{ width: getColumnWidth(col) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-surface-chrome">
          <tr>
            <th
              onClick={() => {
                if (rowCount > 0 && colCount > 0) {
                  setActiveCell({ row: 0, col: 0 });
                  setSelection({
                    startRow: 0,
                    startCol: 0,
                    endRow: rowCount - 1,
                    endCol: colCount - 1,
                  });
                  setSelectedRows(new Set());
                  setSelectedCols(new Set());
                  containerRef.current?.focus();
                }
              }}
              title="Select All"
              className="sticky left-0 z-30 h-7 cursor-pointer border-b border-r border-border-subtle bg-surface-chrome text-center font-mono text-[10px] font-medium text-ink-subtle hover:bg-surface-raised"
            >
              #
            </th>
            {columns.map((col, ci) => {
              const isColSel = selectedCols.has(ci);
              const isColActive =
                activeCell?.col === ci ||
                (normalizedSelection !== null &&
                  ci >= normalizedSelection.c1 &&
                  ci <= normalizedSelection.c2);
              return (
                <th
                  key={col.key}
                  onPointerDown={(e) => handleColHeaderPointerDown(e, ci)}
                  className={`group relative h-7 cursor-pointer border-b border-r border-border-subtle px-2 text-left text-[11px] font-medium transition-colors ${
                    isColSel
                      ? "bg-blue-500/20 text-blue-200"
                      : isColActive
                        ? "bg-surface-raised text-ink-primary"
                        : "bg-surface-chrome text-ink-muted hover:bg-surface-raised/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 overflow-hidden">
                    <span className="truncate">{col.label}</span>
                    {!col.editable && (
                      <span
                        title={
                          col.pasteable
                            ? "Paste / Fill existing values only"
                            : "Read-only"
                        }
                        className="shrink-0 text-ink-disabled"
                      >
                        <Lock className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                  <div
                    onPointerDown={(e) => handleResizePointerDown(e, col)}
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/60"
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((rowValues, ri) => {
            const isRowSelected = selectedRows.has(ri);
            const isRowActive =
              activeCell?.row === ri ||
              (normalizedSelection !== null &&
                ri >= normalizedSelection.r1 &&
                ri <= normalizedSelection.r2);

            return (
              <tr
                key={rowIds[ri] ?? ri}
                className={isRowSelected ? "bg-blue-500/10" : ""}
              >
                <td
                  data-row-hdr={ri}
                  onPointerDown={(e) => handleRowHeaderPointerDown(e, ri)}
                  onContextMenu={(e) => handleCellContextMenu(e, ri, 0)}
                  className={`sticky left-0 z-10 h-7 cursor-pointer border-b border-r border-border-subtle text-center font-mono text-[10px] transition-colors ${
                    isRowSelected
                      ? "bg-blue-500/25 text-blue-200 font-semibold"
                      : isRowActive
                        ? "bg-surface-raised text-ink-secondary"
                        : "bg-surface-chrome text-ink-subtle hover:bg-surface-raised/60"
                  }`}
                >
                  {ri + 1}
                </td>
                {columns.map((col, ci) => {
                  const rawVal = rowValues[ci] ?? "";
                  const isEditing =
                    editCell?.row === ri && editCell?.col === ci;
                  const isActive =
                    activeCell?.row === ri && activeCell?.col === ci;
                  const inSelection =
                    isRowSelected ||
                    selectedCols.has(ci) ||
                    (normalizedSelection !== null &&
                      ri >= normalizedSelection.r1 &&
                      ri <= normalizedSelection.r2 &&
                      ci >= normalizedSelection.c1 &&
                      ci <= normalizedSelection.c2);
                  const inFill =
                    normalizedFillPreview !== null &&
                    ri >= normalizedFillPreview.r1 &&
                    ri <= normalizedFillPreview.r2 &&
                    ci >= normalizedFillPreview.c1 &&
                    ci <= normalizedFillPreview.c2;
                  const showFillHandle =
                    fillHandleCell?.row === ri && fillHandleCell?.col === ci;

                  const alignClass =
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left";

                  return (
                    <td
                      key={col.key}
                      data-row={ri}
                      data-col={ci}
                      onPointerDown={(e) => handleCellPointerDown(e, ri, ci)}
                      onDoubleClick={() => startEdit(ri, ci)}
                      onContextMenu={(e) => handleCellContextMenu(e, ri, ci)}
                      className={`relative h-7 border-b border-r border-border-subtle px-2 align-middle ${alignClass} ${
                        col.mono ? "font-mono" : ""
                      } ${
                        !col.editable ? "text-ink-muted" : "text-ink-primary"
                      } ${
                        isActive && !isEditing
                          ? "z-10 bg-blue-500/15 shadow-[inset_0_0_0_2px_var(--color-accent-selection)]"
                          : inSelection
                            ? "bg-blue-500/15"
                            : inFill
                              ? "bg-blue-500/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.65)]"
                              : !col.editable
                                ? "bg-surface-chrome/40"
                                : ""
                      }`}
                    >
                      {isEditing ? (
                        col.editorType === "select" ||
                        col.editorType === "boolean" ? (
                          <select
                            ref={editSelectRef}
                            value={editValue}
                            onChange={(e) => {
                              const next = e.target.value;
                              setEditValue(next);
                              skipNextBlurCommitRef.current = true;
                              commitEdit("none", next);
                            }}
                            onBlur={() => {
                              if (skipNextBlurCommitRef.current) {
                                skipNextBlurCommitRef.current = false;
                                return;
                              }
                              commitEdit("none");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                skipNextBlurCommitRef.current = true;
                                commitEdit("down");
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                skipNextBlurCommitRef.current = true;
                                commitEdit(e.shiftKey ? "left" : "right");
                              }
                              e.stopPropagation();
                            }}
                            className="absolute inset-0 h-full w-full bg-surface-chrome px-1.5 text-xs text-ink-primary outline-none ring-2 ring-inset ring-accent-selection"
                          >
                            {(col.options ?? []).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => {
                              if (skipNextBlurCommitRef.current) {
                                skipNextBlurCommitRef.current = false;
                                return;
                              }
                              commitEdit("none");
                            }}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing) return;
                              if (e.key === "Enter") {
                                e.preventDefault();
                                skipNextBlurCommitRef.current = true;
                                commitEdit("down");
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                skipNextBlurCommitRef.current = true;
                                commitEdit(e.shiftKey ? "left" : "right");
                              }
                              e.stopPropagation();
                            }}
                            className={`absolute inset-0 h-full w-full bg-surface-chrome px-2 text-xs text-ink-primary outline-none ring-2 ring-inset ring-accent-selection ${alignClass} ${
                              col.mono ? "font-mono" : ""
                            }`}
                          />
                        )
                      ) : (
                        <div className="truncate">
                          {formatCellDisplayValue(col, rawVal) || (
                            <span className="text-ink-disabled">—</span>
                          )}
                        </div>
                      )}

                      {showFillHandle && (
                        <div
                          onPointerDown={handleFillHandlePointerDown}
                          title="Drag to fill"
                          className="absolute -bottom-[3px] -right-[3px] z-20 h-2 w-2 cursor-crosshair border border-surface-chrome bg-accent-selection"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {contextMenu && (
        <FloatingMenu
          x={contextMenu.x}
          y={contextMenu.y}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-[172px] rounded-md border border-border-control bg-surface-chrome py-1 text-xs shadow-2xl"
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void handleCopy(false);
            }}
            className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
          >
            <span className="flex items-center gap-2">
              <ClipboardCopy className="h-3.5 w-3.5 text-ink-muted" />
              Copy
            </span>
            <span className="font-mono text-[10px] text-ink-subtle">⌘C</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void handleCopy(true);
            }}
            className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
          >
            <span className="flex items-center gap-2">
              <ClipboardCopy className="h-3.5 w-3.5 text-ink-muted" />
              Copy with Headers
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void handleCut();
            }}
            className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
          >
            <span className="flex items-center gap-2">
              <Scissors className="h-3.5 w-3.5 text-ink-muted" />
              Cut
            </span>
            <span className="font-mono text-[10px] text-ink-subtle">⌘X</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void handlePasteFromClipboardApi();
            }}
            className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
          >
            <span className="flex items-center gap-2">
              <ClipboardPaste className="h-3.5 w-3.5 text-ink-muted" />
              Paste
            </span>
            <span className="font-mono text-[10px] text-ink-subtle">⌘V</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              handleClearSelection();
            }}
            className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
          >
            <span className="flex items-center gap-2">
              <Eraser className="h-3.5 w-3.5 text-ink-muted" />
              Clear Cells
            </span>
            <span className="font-mono text-[10px] text-ink-subtle">Del</span>
          </button>
          {normalizedSelection &&
            normalizedSelection.r2 > normalizedSelection.r1 && (
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  handleFillDown();
                }}
                className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
              >
                <span className="flex items-center gap-2">
                  <Copy className="h-3.5 w-3.5 text-ink-muted" />
                  Fill Down
                </span>
                <span className="font-mono text-[10px] text-ink-subtle">⌘D</span>
              </button>
            )}
          <div className="my-1 border-t border-border-subtle" />
          {onLocateRow && rowIds[contextMenu.row] && (
            <button
              type="button"
              onClick={() => {
                const id = rowIds[contextMenu.row];
                setContextMenu(null);
                if (id) onLocateRow(id);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
            >
              <Crosshair className="h-3.5 w-3.5 text-accent-selection" />
              Locate on Drawing
            </button>
          )}
          {onInsertRows && contextRowIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  const anchorId = contextRowIds[0];
                  const count = contextRowIds.length;
                  setContextMenu(null);
                  if (anchorId) onInsertRows(anchorId, "above", count);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
              >
                <ArrowUpToLine className="h-3.5 w-3.5 text-ink-muted" />
                Insert {contextRowIds.length > 1 ? `${contextRowIds.length} Rows` : "Row"} Above
              </button>
              <button
                type="button"
                onClick={() => {
                  const anchorId = contextRowIds[contextRowIds.length - 1];
                  const count = contextRowIds.length;
                  setContextMenu(null);
                  if (anchorId) onInsertRows(anchorId, "below", count);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
              >
                <ArrowDownToLine className="h-3.5 w-3.5 text-ink-muted" />
                Insert {contextRowIds.length > 1 ? `${contextRowIds.length} Rows` : "Row"} Below
              </button>
            </>
          )}
          {onDuplicateRows && contextRowIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                onDuplicateRows(contextRowIds);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
            >
              <Copy className="h-3.5 w-3.5 text-ink-muted" />
              Duplicate Row{contextRowIds.length > 1 ? `s (${contextRowIds.length})` : ""}
            </button>
          )}
          {onDeleteRows && contextRowIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                onDeleteRows(contextRowIds);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-accent-danger hover:bg-rose-950/60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Row{contextRowIds.length > 1 ? `s (${contextRowIds.length})` : ""}
            </button>
          )}
        </FloatingMenu>
      )}
    </div>
  );
}
