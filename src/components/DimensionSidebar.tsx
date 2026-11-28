import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Crosshair,
  FolderMinus,
  FolderPlus,
  GripVertical,
  LocateFixed,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
  ScanText,
  Trash2,
  X,
} from "lucide-react";
import {
  ANNOTATION_KIND_OPTIONS,
  createDefaultGdtSpec,
  createDefaultPointSpec,
  GDT_SYMBOL_OPTIONS,
  getAnnotationKind,
  getAvailableDatums,
  getGdtRules,
  getGdtSymbolGlyph,
  getMaterialConditionGlyph,
  MATERIAL_CONDITION_OPTIONS,
  resolveEditModeShortcut,
  sanitizeGdtSpec,
} from "../lib/annotations";
import {
  compareAnnotationId,
  findTypeCompletion,
  formatScopedAnnotationLabel,
  formatTolerance,
  getAnnotationPage,
  getAnnotationSectionKey,
  validateDimensionId,
} from "../lib/dimensions";
import { evaluateFormulaInput } from "../lib/mathEval";
import { resolveLinkedPointDisplayTokens } from "../lib/pointGroups";
import { FloatingMenu } from "./ui";
import type {
  AnnotationKind,
  Dimension,
  GdtDatumRef,
  GdtSpec,
  GdtSymbol,
  MaterialCondition,
  PointGroup,
  PointSpec,
} from "../types/project";

export interface DimensionSidebarProps {
  isActive?: boolean;
  dimensions: Dimension[];
  pointGroups?: PointGroup[];
  selectedDimensionId: string | null;
  selectedDimensionIds?: string[];
  editingDimensionId: string | null;
  placingDimensionId: string | null;
  pointCaptureDimensionId?: string | null;
  focusNameKey: number;
  hasProject: boolean;
  currentPage?: number;
  pageCount?: number;
  scrollToDimensionRequest?: {
    id: string;
    key: number;
    block?: ScrollLogicalPosition;
  } | null;
  activeDrawingFilename?: string | null;
  onBackToDrawings?: () => void;
  onJumpToPage?: (page: number) => void;
  onVisiblePageChange?: (page: number) => void;
  onAddDimension: (insertSlot?: number, targetPage?: number | null) => void;
  onSortDimensions: () => void;
  onReorderDimensions: (sourceId: string, targetSlot: number) => void;
  onSelectDimension: (id: string) => void;
  onSelectDimensions?: (ids: string[], primaryId: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onCancelEditing: () => void;
  onUpdateDimension: (id: string, patch: Partial<Dimension>) => void;
  onDuplicateDimension: (id: string) => void;
  onDuplicateDimensions: (ids: string[]) => void;
  onDeleteDimension: (id: string) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
  onAutoRecognizeDimension?: (id: string) => void | Promise<void>;
  onCreatePointGroup?: (pointIds: string[]) => void;
  onRenamePointGroup?: (groupId: string, name: string) => void;
  onTogglePointGroupCollapsed?: (groupId: string) => void;
  onSetAllPointGroupsCollapsed?: (collapsed: boolean) => void;
  onDeletePointGroup?: (groupId: string) => void;
  onResumePointEntryForGroup?: (groupId: string) => void;
  onAddPointsToGroup?: (groupId: string, pointIds: string[]) => void;
  onRemovePointsFromGroups?: (pointIds: string[]) => void;
}

interface InlineEditCardProps {
  dimension: Dimension;
  allDimensions: Dimension[];
  pointGroups?: PointGroup[];
  isPlacing: boolean;
  isCapturingPoint?: boolean;
  focusNameKey: number;
  onUpdate: (id: string, patch: Partial<Dimension>) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
  onAutoRecognize?: (id: string) => void | Promise<void>;
}

function normalizeGdtSpec(spec: GdtSpec | null | undefined): GdtSpec {
  const base = createDefaultGdtSpec();
  if (!spec) return base;
  const datums: GdtDatumRef[] = [0, 1, 2].map((i) => ({
    datum: spec.datums?.[i]?.datum ?? "",
    materialCondition: spec.datums?.[i]?.materialCondition ?? "",
  }));
  return {
    symbol: spec.symbol || base.symbol,
    diameterZone: Boolean(spec.diameterZone),
    tolerance: spec.tolerance ?? "",
    materialCondition: spec.materialCondition ?? "",
    datums,
  };
}

function normalizePointSpec(spec: PointSpec | null | undefined): PointSpec {
  if (!spec) return createDefaultPointSpec();
  return {
    x: spec.x ?? "",
    y: spec.y ?? "",
    z: spec.z ?? "",
    datums: [
      spec.datums?.[0] ?? "",
      spec.datums?.[1] ?? "",
      spec.datums?.[2] ?? "",
    ],
  };
}

function FeatureControlFrame({ gdt }: { gdt: GdtSpec }) {
  const rules = getGdtRules(gdt.symbol);
  const glyph = getGdtSymbolGlyph(gdt.symbol);
  const tolText = gdt.tolerance.trim() || "0.00";
  const mcGlyph = rules.allowMaterialCondition
    ? getMaterialConditionGlyph(gdt.materialCondition)
    : "";
  const activeDatums = rules.allowDatums
    ? gdt.datums.filter((d) => d.datum.trim().length > 0)
    : [];

  return (
    <div className="inline-flex max-w-full items-stretch overflow-hidden rounded border border-neutral-600 bg-neutral-950 font-mono text-[11px] text-neutral-100">
      <span className="flex items-center justify-center px-1.5 py-0.5 text-sm leading-none text-blue-300">
        {glyph}
      </span>
      <span className="flex items-center gap-0.5 border-l border-neutral-600 px-1.5 py-0.5">
        {rules.allowDiameterZone && gdt.diameterZone && (
          <span className="text-neutral-300">⌀</span>
        )}
        <span>{tolText}</span>
        {mcGlyph && <span className="text-amber-300">{mcGlyph}</span>}
      </span>
      {activeDatums.map((d, idx) => {
        const dMc = rules.allowDatumMaterialCondition
          ? getMaterialConditionGlyph(d.materialCondition)
          : "";
        return (
          <span
            key={idx}
            className="flex items-center gap-0.5 border-l border-neutral-600 px-1.5 py-0.5 text-amber-200"
          >
            <span>{d.datum.trim()}</span>
            {dMc && <span className="text-amber-300">{dMc}</span>}
          </span>
        );
      })}
    </div>
  );
}

function InlineEditCard({
  dimension,
  allDimensions,
  pointGroups = [],
  isPlacing,
  isCapturingPoint = false,
  focusNameKey,
  onUpdate,
  onDone,
  onCancel,
  onDelete,
  onStartPlacing,
  onClearMarker,
  onAutoRecognize,
}: InlineEditCardProps) {
  const typeInputRef = useRef<HTMLInputElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);
  const kindMenuRef = useRef<HTMLDivElement | null>(null);
  const [kindMenuOpen, setKindMenuOpen] = useState<boolean>(false);
  const [isRecognizing, setIsRecognizing] = useState<boolean>(false);
  const [idError, setIdError] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState<string>(
    dimension.quantity && dimension.quantity > 1
      ? String(dimension.quantity)
      : "",
  );

  const kind = getAnnotationKind(dimension);
  const dimPage = getAnnotationPage(dimension);
  const availableDatums = getAvailableDatums(allDimensions);
  const linkedPointIds = dimension.linkedPointIds ?? [];
  const linkedNoteIds = dimension.linkedNoteIds ?? [];
  const availablePoints = allDimensions
    .filter(
      (d) =>
        getAnnotationKind(d) === "point" &&
        d.name.trim().length > 0 &&
        ((dimPage !== null && d.marker?.page === dimPage) ||
          linkedPointIds.includes(d.id)),
    )
    .sort((a, b) => compareAnnotationId(a.name, b.name));
  const availableNotes = allDimensions
    .filter(
      (d) =>
        getAnnotationKind(d) === "note" &&
        d.name.trim().length > 0 &&
        ((dimPage !== null && d.marker?.page === dimPage) ||
          linkedNoteIds.includes(d.id)),
    )
    .sort((a, b) => compareAnnotationId(a.name, b.name));
  const gdt = normalizeGdtSpec(dimension.gdt);
  const gdtRules = getGdtRules(gdt.symbol);
  const point = normalizePointSpec(dimension.point);

  const toggleLinkedPoint = (pointId: string) => {
    const exists = linkedPointIds.includes(pointId);
    const next = exists
      ? linkedPointIds.filter((id) => id !== pointId)
      : [...linkedPointIds, pointId];
    onUpdate(dimension.id, { linkedPointIds: next });
  };

  const toggleLinkedPointGroup = (memberIds: string[]) => {
    const allSelected =
      memberIds.length > 0 &&
      memberIds.every((id) => linkedPointIds.includes(id));
    const memberSet = new Set(memberIds);
    const next = allSelected
      ? linkedPointIds.filter((id) => !memberSet.has(id))
      : [
          ...linkedPointIds,
          ...memberIds.filter((id) => !linkedPointIds.includes(id)),
        ];
    onUpdate(dimension.id, { linkedPointIds: next });
  };

  const availablePointIdSet = new Set(availablePoints.map((p) => p.id));
  const availablePointGroups = pointGroups
    .filter((g) => dimPage !== null && g.page === dimPage)
    .map((g) => ({
      group: g,
      memberIds: g.pointIds.filter((pid) => availablePointIdSet.has(pid)),
    }))
    .filter((entry) => entry.memberIds.length > 0);

  const toggleLinkedNote = (noteId: string) => {
    const exists = linkedNoteIds.includes(noteId);
    const next = exists
      ? linkedNoteIds.filter((id) => id !== noteId)
      : [...linkedNoteIds, noteId];
    onUpdate(dimension.id, { linkedNoteIds: next });
  };

  useEffect(() => {
    setQtyText(
      dimension.quantity && dimension.quantity > 1
        ? String(dimension.quantity)
        : "",
    );
  }, [dimension.id, dimension.quantity]);

  // Derive known types strictly from active annotations on the current drawing (excluding self)
  const knownTypes: string[] = [];
  const seenLower = new Set<string>();
  for (const d of allDimensions) {
    if (d.id === dimension.id) continue;
    const trimmed = (d.dimensionType ?? "").trim();
    if (trimmed && !seenLower.has(trimmed.toLowerCase())) {
      seenLower.add(trimmed.toLowerCase());
      knownTypes.push(trimmed);
    }
  }

  const typedType = dimension.dimensionType ?? "";
  const typeMatch = findTypeCompletion(typedType, knownTypes);
  const ghostSuffix =
    typeMatch &&
    typedType.length > 0 &&
    typeMatch.length > typedType.length
      ? typeMatch.slice(typedType.length)
      : "";

  const focusFirstTextInput = () => {
    const target =
      kind === "linear" || kind === "gdt" || kind === "non_dimensional"
        ? typeInputRef.current
        : idInputRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    const len = target.value.length;
    target.setSelectionRange(len, len);
  };

  useEffect(() => {
    // When actively placing a new region on the PDF, blur any active text input
    // and stay in shortcut-ready mode until the user presses Tab or clicks an input.
    if (isPlacing) {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        active.blur();
      }
      return;
    }
    focusFirstTextInput();
  }, [dimension.id, focusNameKey]);

  useEffect(() => {
    if (!kindMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        kindMenuRef.current &&
        !kindMenuRef.current.contains(e.target as Node)
      ) {
        setKindMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setKindMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [kindMenuOpen]);

  const handleKindChange = (nextKind: AnnotationKind) => {
    setKindMenuOpen(false);
    setIdError(null);
    const patch: Partial<Dimension> = { kind: nextKind };
    if (nextKind === "gdt" && !dimension.gdt) {
      patch.gdt = createDefaultGdtSpec();
    } else if (nextKind === "point" && !dimension.point) {
      patch.point = createDefaultPointSpec();
    }
    onUpdate(dimension.id, patch);
  };

  const updateGdt = (patch: Partial<GdtSpec>) => {
    onUpdate(dimension.id, { gdt: sanitizeGdtSpec({ ...gdt, ...patch }) });
  };

  const updateGdtDatum = (index: number, patch: Partial<GdtDatumRef>) => {
    const nextDatums = gdt.datums.map((d, i) =>
      i === index
        ? {
            ...d,
            ...patch,
            materialCondition:
              patch.datum === ""
                ? ""
                : (patch.materialCondition ?? d.materialCondition),
          }
        : d,
    );
    updateGdt({ datums: nextDatums });
  };

  const updatePoint = (patch: Partial<PointSpec>) => {
    onUpdate(dimension.id, { point: { ...point, ...patch } });
  };

  const updatePointDatum = (index: number, value: string) => {
    const nextDatums = point.datums.map((d, i) => (i === index ? value : d));
    updatePoint({ datums: nextDatums });
  };

  const tryConfirm = () => {
    const err = validateDimensionId(
      dimension.name,
      dimension.id,
      allDimensions,
      kind,
    );
    if (err) {
      setIdError(err);
      idInputRef.current?.focus();
      idInputRef.current?.select();
      return;
    }
    setIdError(null);
    onDone();
  };

  const handleTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Tab" && !e.shiftKey && typeMatch && typedType.length > 0) {
      if (typeMatch !== typedType) {
        onUpdate(dimension.id, { dimensionType: typeMatch });
      }
      return;
    }
    if (
      e.key === "ArrowRight" &&
      ghostSuffix &&
      typeMatch &&
      e.currentTarget.selectionStart === typedType.length
    ) {
      e.preventDefault();
      onUpdate(dimension.id, { dimensionType: typeMatch });
    }
  };

  const handleFormulaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    value: string,
    onCommit: (computed: string) => void,
  ) => {
    if (
      e.nativeEvent.isComposing ||
      e.key !== "Enter" ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    ) {
      return;
    }
    const result = evaluateFormulaInput(value);
    if (result === null) return;
    e.preventDefault();
    e.stopPropagation();
    onCommit(result);
  };

  const triggerAutoRecognize = async () => {
    if (!dimension.marker || !onAutoRecognize || isRecognizing) return;
    setIsRecognizing(true);
    try {
      await onAutoRecognize(dimension.id);
    } finally {
      setIsRecognizing(false);
    }
  };

  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        tryConfirm();
        return;
      }
      const target = e.target as HTMLElement | null;
      const action = resolveEditModeShortcut(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
          targetTagName: target?.tagName,
          isContentEditable: target?.isContentEditable,
        },
        kind,
        Boolean(dimension.marker),
      );
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.type === "kind") {
        handleKindChange(action.kind);
      } else if (action.type === "recognize") {
        void triggerAutoRecognize();
      } else if (action.type === "focusFirstInput") {
        focusFirstTextInput();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      tryConfirm();
    }
  };

  const renderDatumSelectOptions = (currentValue: string) => {
    const list =
      currentValue &&
      !availableDatums.some(
        (d) => d.toUpperCase() === currentValue.toUpperCase(),
      )
        ? [currentValue, ...availableDatums]
        : availableDatums;
    return (
      <>
        <option value="">—</option>
        {list.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </>
    );
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-neutral-600 bg-neutral-900 p-3 shadow-lg"
    >
      {/* Card Header: Annotation Kind Selector (custom menu avoids WKWebView native <select> pointer-swallow) */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div ref={kindMenuRef} className="relative">
          <button
            type="button"
            aria-label="Annotation kind"
            aria-haspopup="listbox"
            aria-expanded={kindMenuOpen}
            onClick={() => setKindMenuOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs font-semibold text-neutral-100 transition-colors hover:border-neutral-500 focus:border-neutral-400 focus:outline-none"
          >
            <span>
              {ANNOTATION_KIND_OPTIONS.find((o) => o.value === kind)?.label ??
                "Linear"}
            </span>
            <ChevronDown className="h-3 w-3 text-neutral-400" />
          </button>

          {kindMenuOpen && (
            <div
              role="listbox"
              aria-label="Annotation kind options"
              className="absolute left-0 top-full z-50 mt-1 min-w-[164px] rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl"
            >
              {ANNOTATION_KIND_OPTIONS.map((opt) => {
                const selected = opt.value === kind;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => handleKindChange(opt.value)}
                    className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors ${
                      selected
                        ? "bg-neutral-800 font-semibold text-white"
                        : "text-neutral-300 hover:bg-neutral-800/70 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-neutral-800/90 font-mono text-[10px] font-medium text-neutral-400">
                        {opt.shortcut}
                      </span>
                      <span>{opt.label}</span>
                    </span>
                    {selected && <Check className="h-3 w-3 text-blue-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onStartPlacing(dimension.id)}
            title={
              kind === "point"
                ? "Click on drawing to place or relocate point"
                : "Drag on drawing to select or redraw region"
            }
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              isPlacing
                ? "bg-blue-600 text-white"
                : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
            }`}
          >
            <Crosshair className="h-3 w-3" />
            {kind === "point"
              ? dimension.marker
                ? "Relocate"
                : "Mark Point"
              : dimension.marker
                ? "Redraw"
                : "Mark Area"}
          </button>

          {onAutoRecognize && (
            <button
              type="button"
              tabIndex={-1}
              disabled={!dimension.marker || isRecognizing}
              title={
                !dimension.marker
                  ? kind === "point"
                    ? "Mark point on the drawing first to auto-recognize (G)"
                    : "Mark an area on the drawing first to auto-recognize text (G)"
                  : kind === "point"
                    ? isCapturingPoint
                      ? "Apply captured regions to fill Point ID and X/Y/Z (G / Enter)"
                      : "Select regions on drawing to auto-fill Point ID and X/Y/Z (G)"
                    : "Recognize text in the marked area and auto-fill fields (G)"
              }
              onClick={() => void triggerAutoRecognize()}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isCapturingPoint
                  ? "bg-purple-600 text-white hover:bg-purple-500"
                  : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              <ScanText className="h-3 w-3" />
              <span>
                {isRecognizing
                  ? "…"
                  : isCapturingPoint
                    ? "Apply"
                    : "Auto"}
              </span>
              {!isRecognizing && (
                <span className="font-mono text-[10px] opacity-65">G</span>
              )}
            </button>
          )}

          {dimension.marker && (
            <button
              type="button"
              tabIndex={-1}
              title="Clear marker from drawing"
              onClick={() => onClearMarker(dimension.id)}
              className="rounded bg-neutral-800 p-1 text-neutral-400 hover:bg-neutral-700 hover:text-amber-300"
            >
              <MapPinOff className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {/* LINEAR, GD&T & NON-DIMENSIONAL: Type + ID */}
        {(kind === "linear" || kind === "gdt" || kind === "non_dimensional") && (
          <div className="grid grid-cols-[92px_1fr] gap-1.5">
            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Type
              </label>
              <div className="relative rounded bg-neutral-950">
                {ghostSuffix && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre border border-transparent px-2 py-1 font-mono text-xs"
                  >
                    <span className="invisible">{typedType}</span>
                    <span className="text-neutral-500">{ghostSuffix}</span>
                  </div>
                )}
                <input
                  ref={typeInputRef}
                  type="text"
                  value={typedType}
                  placeholder="e.g. CTF"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onKeyDown={handleTypeKeyDown}
                  onChange={(e) =>
                    onUpdate(dimension.id, {
                      dimensionType: e.target.value.toUpperCase(),
                    })
                  }
                  className="relative z-10 w-full rounded border border-neutral-700 bg-transparent px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                ID <span className="text-rose-400">*</span>
              </label>
              <input
                ref={idInputRef}
                type="text"
                value={dimension.name}
                placeholder="e.g. 104, 512A"
                onChange={(e) => {
                  if (idError) setIdError(null);
                  onUpdate(dimension.id, { name: e.target.value });
                }}
                className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                  idError
                    ? "border-rose-500 focus:border-rose-400"
                    : "border-neutral-700 focus:border-neutral-400"
                }`}
              />
            </div>
          </div>
        )}

        {/* LINEAR fields */}
        {kind === "linear" && (
          <>
            {idError && <p className="text-[11px] text-rose-400">{idError}</p>}

            <div className="grid grid-cols-[54px_1fr_1fr_1fr] gap-1.5">
              <div>
                <label className="mb-1 block text-[11px] text-neutral-400">
                  Qty
                </label>
                <div className="flex items-center gap-0.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={qtyText}
                    placeholder="1"
                    onChange={(e) => {
                      const digits = e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 3);
                      setQtyText(digits);
                      const parsed = digits
                        ? Math.max(1, parseInt(digits, 10))
                        : 1;
                      onUpdate(dimension.id, { quantity: parsed });
                    }}
                    className="w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-center font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
                  />
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-neutral-400">
                    X
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-neutral-400">
                  Nominal
                </label>
                <input
                  type="text"
                  value={dimension.nominal}
                  placeholder="25.00"
                  title="Tip: type =formula and press Enter to calculate (e.g. =50/2)"
                  onKeyDown={(e) =>
                    handleFormulaKeyDown(e, dimension.nominal, (val) =>
                      onUpdate(dimension.id, { nominal: val }),
                    )
                  }
                  onChange={(e) =>
                    onUpdate(dimension.id, { nominal: e.target.value })
                  }
                  className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                    dimension.nominal.trimStart().startsWith("=")
                      ? "border-sky-500/70 focus:border-sky-400"
                      : "border-neutral-700 focus:border-neutral-400"
                  }`}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-neutral-400">
                  +Tol
                </label>
                <input
                  type="text"
                  value={dimension.upperTol}
                  placeholder="+0.05"
                  title="Tip: type =formula and press Enter to calculate"
                  onKeyDown={(e) =>
                    handleFormulaKeyDown(e, dimension.upperTol, (val) =>
                      onUpdate(dimension.id, { upperTol: val }),
                    )
                  }
                  onChange={(e) =>
                    onUpdate(dimension.id, { upperTol: e.target.value })
                  }
                  className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                    dimension.upperTol.trimStart().startsWith("=")
                      ? "border-sky-500/70 focus:border-sky-400"
                      : "border-neutral-700 focus:border-neutral-400"
                  }`}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-neutral-400">
                  -Tol
                </label>
                <input
                  type="text"
                  value={dimension.lowerTol}
                  placeholder="-0.05"
                  title="Tip: type =formula and press Enter to calculate"
                  onKeyDown={(e) =>
                    handleFormulaKeyDown(e, dimension.lowerTol, (val) =>
                      onUpdate(dimension.id, { lowerTol: val }),
                    )
                  }
                  onChange={(e) =>
                    onUpdate(dimension.id, { lowerTol: e.target.value })
                  }
                  className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                    dimension.lowerTol.trimStart().startsWith("=")
                      ? "border-sky-500/70 focus:border-sky-400"
                      : "border-neutral-700 focus:border-neutral-400"
                  }`}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Description
              </label>
              <input
                type="text"
                value={dimension.notes}
                placeholder="Dimension description (e.g. A Cover Width)"
                onChange={(e) =>
                  onUpdate(dimension.id, { notes: e.target.value })
                }
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {/* GD&T (AutoCAD-style Feature Control Frame editor) */}
        {kind === "gdt" && (
          <>
            {idError && <p className="text-[11px] text-rose-400">{idError}</p>}

            {/* Live FCF Preview */}
            <div className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950/80 px-2 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                FCF
              </span>
              <FeatureControlFrame gdt={gdt} />
            </div>

            {/* Geometric Characteristic Symbol */}
            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Characteristic
              </label>
              <select
                value={gdt.symbol}
                onChange={(e) =>
                  updateGdt({ symbol: e.target.value as GdtSymbol })
                }
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 focus:border-neutral-400 focus:outline-none"
              >
                {GDT_SYMBOL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.glyph}  {opt.label} ({opt.group})
                  </option>
                ))}
              </select>
            </div>

            {/* Tolerance Zone: Diameter toggle + Value + Material Condition */}
            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Tolerance & Material Condition
              </label>
              <div className="grid grid-cols-[32px_1fr_92px] gap-1.5">
                <button
                  type="button"
                  disabled={!gdtRules.allowDiameterZone}
                  title={
                    gdtRules.allowDiameterZone
                      ? "Toggle cylindrical tolerance zone (⌀)"
                      : "Diameter zone (⌀) is not applicable for this GD&T characteristic"
                  }
                  onClick={() =>
                    updateGdt({ diameterZone: !gdt.diameterZone })
                  }
                  className={`rounded border font-mono text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950/50 disabled:text-neutral-600 disabled:opacity-45 ${
                    gdtRules.allowDiameterZone && gdt.diameterZone
                      ? "border-blue-500 bg-blue-600/20 text-blue-300"
                      : "border-neutral-700 bg-neutral-950 text-neutral-500 hover:text-neutral-200"
                  }`}
                >
                  ⌀
                </button>
                <input
                  type="text"
                  value={gdt.tolerance}
                  placeholder="0.05"
                  title="Tip: type =formula and press Enter to calculate"
                  onKeyDown={(e) =>
                    handleFormulaKeyDown(e, gdt.tolerance, (val) =>
                      updateGdt({ tolerance: val }),
                    )
                  }
                  onChange={(e) => updateGdt({ tolerance: e.target.value })}
                  className={`w-full min-w-0 rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                    gdt.tolerance.trimStart().startsWith("=")
                      ? "border-sky-500/70 focus:border-sky-400"
                      : "border-neutral-700 focus:border-neutral-400"
                  }`}
                />
                <select
                  aria-label="Material condition"
                  disabled={!gdtRules.allowMaterialCondition}
                  title={
                    gdtRules.allowMaterialCondition
                      ? "Material condition modifier"
                      : "Material condition modifier is not applicable for this GD&T characteristic"
                  }
                  value={gdtRules.allowMaterialCondition ? gdt.materialCondition : ""}
                  onChange={(e) =>
                    updateGdt({
                      materialCondition: e.target.value as MaterialCondition,
                    })
                  }
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-xs text-neutral-100 focus:border-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600 disabled:opacity-45"
                >
                  {MATERIAL_CONDITION_OPTIONS.map((mc) => (
                    <option key={mc.value} value={mc.value}>
                      {mc.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Datum References (Primary / Secondary / Tertiary) */}
            <div className={!gdtRules.allowDatums ? "opacity-45" : ""}>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-neutral-400">
                  Datum References
                </label>
                {!gdtRules.allowDatums ? (
                  <span className="text-[10px] text-neutral-500">
                    Not applicable
                  </span>
                ) : (
                  availableDatums.length === 0 && (
                    <span className="text-[10px] text-amber-400/90">
                      Add Datum first
                    </span>
                  )
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {["1st", "2nd", "3rd"].map((slotLabel, idx) => {
                  const slot = gdt.datums[idx];
                  const datumDisabled = !gdtRules.allowDatums;
                  const mcDisabled =
                    !gdtRules.allowDatums ||
                    !gdtRules.allowDatumMaterialCondition ||
                    !slot.datum;
                  return (
                    <div
                      key={slotLabel}
                      className="space-y-1 rounded border border-neutral-800 bg-neutral-950/60 p-1.5"
                    >
                      <div className="text-[10px] text-neutral-500">
                        {slotLabel}
                      </div>
                      <select
                        aria-label={`${slotLabel} datum`}
                        disabled={datumDisabled}
                        value={datumDisabled ? "" : slot.datum}
                        onChange={(e) =>
                          updateGdtDatum(idx, { datum: e.target.value })
                        }
                        className="w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 font-mono text-xs text-neutral-100 focus:border-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600"
                      >
                        {renderDatumSelectOptions(slot.datum)}
                      </select>
                      <select
                        aria-label={`${slotLabel} datum condition`}
                        disabled={mcDisabled}
                        value={mcDisabled ? "" : slot.materialCondition}
                        onChange={(e) =>
                          updateGdtDatum(idx, {
                            materialCondition: e.target
                              .value as MaterialCondition,
                          })
                        }
                        className="w-full rounded border border-neutral-800 bg-neutral-950 px-1 py-0.5 text-[11px] text-neutral-300 focus:border-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:text-neutral-600 disabled:opacity-50"
                      >
                        <option value="">RFS</option>
                        <option value="MMC">Ⓜ MMC</option>
                        <option value="LMC">Ⓛ LMC</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Description
              </label>
              <input
                type="text"
                value={dimension.notes}
                placeholder="GD&T description (e.g. Mounting hole position)"
                onChange={(e) =>
                  onUpdate(dimension.id, { notes: e.target.value })
                }
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {/* LINKED POINTS & NOTES (shared by Linear and GD&T dimensions) */}
        {/* NON-DIMENSIONAL fields (angles, weights, torques, etc.) */}
        {kind === "non_dimensional" && (
          <>
            {idError && <p className="text-[11px] text-rose-400">{idError}</p>}

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Requirement
              </label>
              <textarea
                rows={3}
                value={dimension.notes}
                placeholder="e.g. Weight: 1247 ±37.41 g, Torque: 6.4 ±0.7 N·m, Angle: 45° ±0.5°"
                onChange={(e) =>
                  onUpdate(dimension.id, { notes: e.target.value })
                }
                className="w-full resize-none rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {/* Linked Points & Notes (for Linear, GD&T, and Non-Dimensional) */}
        {(kind === "linear" || kind === "gdt" || kind === "non_dimensional") && (
          <div className="space-y-2 border-t border-neutral-800/90 pt-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-neutral-400">
                  Linked Points{dimPage !== null ? ` (P${dimPage})` : ""}
                </label>
                {linkedPointIds.length > 0 && (
                  <span className="font-mono text-[10px] text-purple-300">
                    {linkedPointIds.length} selected
                  </span>
                )}
              </div>
              {availablePoints.length === 0 ? (
                <div className="text-[10px] italic text-neutral-500">
                  {dimPage === null
                    ? "Mark this dimension on a page to link same-page Points"
                    : `No Point annotations on P${dimPage} yet`}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {availablePointGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {availablePointGroups.map(({ group, memberIds }) => {
                        const allSelected = memberIds.every((id) =>
                          linkedPointIds.includes(id),
                        );
                        const someSelected =
                          !allSelected &&
                          memberIds.some((id) => linkedPointIds.includes(id));
                        return (
                          <button
                            key={group.id}
                            type="button"
                            tabIndex={-1}
                            title={`Toggle all ${memberIds.length} points in group ${group.name}`}
                            onClick={() => toggleLinkedPointGroup(memberIds)}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                              allSelected
                                ? "bg-purple-500/25 text-purple-100 ring-1 ring-purple-400/80"
                                : someSelected
                                  ? "bg-purple-500/10 text-purple-200 ring-1 ring-purple-400/40"
                                  : "bg-neutral-950 text-purple-300/80 ring-1 ring-purple-500/30 hover:bg-purple-950/40 hover:text-purple-100"
                            }`}
                          >
                            <span>{group.name}</span>
                            <span className="text-[9px] opacity-75">
                              ({memberIds.length})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {availablePoints.map((pt) => {
                      const selected = linkedPointIds.includes(pt.id);
                      const ptLabel = formatScopedAnnotationLabel(
                        pt,
                        allDimensions,
                      );
                      const ptTip = pt.point
                        ? `${ptLabel} (${pt.point.x || "—"}, ${pt.point.y || "—"}, ${pt.point.z || "—"})${pt.notes ? ` — ${pt.notes}` : ""}`
                        : ptLabel;
                      return (
                        <button
                          key={pt.id}
                          type="button"
                          tabIndex={-1}
                          title={ptTip}
                          onClick={() => toggleLinkedPoint(pt.id)}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                            selected
                              ? "bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/70"
                              : "bg-neutral-950 text-neutral-400 ring-1 ring-neutral-800 hover:text-neutral-200 hover:ring-neutral-600"
                          }`}
                        >
                          {ptLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-neutral-400">
                  Linked Notes{dimPage !== null ? ` (P${dimPage})` : ""}
                </label>
                {linkedNoteIds.length > 0 && (
                  <span className="font-mono text-[10px] text-sky-300">
                    {linkedNoteIds.length} selected
                  </span>
                )}
              </div>
              {availableNotes.length === 0 ? (
                <div className="text-[10px] italic text-neutral-500">
                  {dimPage === null
                    ? "Mark this dimension on a page to link same-page Notes"
                    : `No Note annotations on P${dimPage} yet`}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {availableNotes.map((nt) => {
                    const selected = linkedNoteIds.includes(nt.id);
                    const ntLabel = formatScopedAnnotationLabel(
                      nt,
                      allDimensions,
                    );
                    const ntTip = nt.notes.trim()
                      ? `${ntLabel}: ${nt.notes.trim()}`
                      : ntLabel;
                    return (
                      <button
                        key={nt.id}
                        type="button"
                        tabIndex={-1}
                        title={ntTip}
                        onClick={() => toggleLinkedNote(nt.id)}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                          selected
                            ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/70"
                            : "bg-neutral-950 text-neutral-400 ring-1 ring-neutral-800 hover:text-neutral-200 hover:ring-neutral-600"
                        }`}
                      >
                        {ntLabel}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* NOTE fields */}
        {kind === "note" && (
          <>
            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Note # <span className="text-rose-400">*</span>
              </label>
              <input
                ref={idInputRef}
                type="text"
                value={dimension.name}
                placeholder="e.g. N1, 1"
                onChange={(e) => {
                  if (idError) setIdError(null);
                  onUpdate(dimension.id, { name: e.target.value });
                }}
                className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                  idError
                    ? "border-rose-500 focus:border-rose-400"
                    : "border-neutral-700 focus:border-neutral-400"
                }`}
              />
            </div>

            {idError && <p className="text-[11px] text-rose-400">{idError}</p>}

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Note Text
              </label>
              <textarea
                rows={3}
                value={dimension.notes}
                placeholder="Enter drawing note content..."
                onChange={(e) =>
                  onUpdate(dimension.id, { notes: e.target.value })
                }
                className="w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {/* DATUM fields */}
        {kind === "datum" && (
          <>
            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Datum Name <span className="text-rose-400">*</span>
              </label>
              <input
                ref={idInputRef}
                type="text"
                value={dimension.name}
                placeholder="e.g. A, B, C"
                autoCapitalize="characters"
                onChange={(e) => {
                  if (idError) setIdError(null);
                  onUpdate(dimension.id, {
                    name: e.target.value.toUpperCase(),
                  });
                }}
                className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs font-semibold text-amber-200 placeholder:font-normal placeholder:text-neutral-600 focus:outline-none ${
                  idError
                    ? "border-rose-500 focus:border-rose-400"
                    : "border-neutral-700 focus:border-neutral-400"
                }`}
              />
            </div>

            {idError && <p className="text-[11px] text-rose-400">{idError}</p>}

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Description
              </label>
              <input
                type="text"
                value={dimension.notes}
                placeholder="e.g. Primary mounting plane"
                onChange={(e) =>
                  onUpdate(dimension.id, { notes: e.target.value })
                }
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {/* POINT fields */}
        {kind === "point" && (
          <>
            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Point # <span className="text-rose-400">*</span>
              </label>
              <input
                ref={idInputRef}
                type="text"
                value={dimension.name}
                placeholder="e.g. P1, TP1"
                onChange={(e) => {
                  if (idError) setIdError(null);
                  onUpdate(dimension.id, { name: e.target.value });
                }}
                className={`w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                  idError
                    ? "border-rose-500 focus:border-rose-400"
                    : "border-neutral-700 focus:border-neutral-400"
                }`}
              />
            </div>

            {idError && <p className="text-[11px] text-rose-400">{idError}</p>}

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Coordinates (X / Y / Z)
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["x", "y", "z"] as const).map((axis) => (
                  <div key={axis} className="flex items-center gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase text-neutral-500">
                      {axis}
                    </span>
                    <input
                      type="text"
                      value={point[axis]}
                      placeholder="0.00"
                      title="Tip: type =formula and press Enter to calculate (e.g. =44.88/2)"
                      onKeyDown={(e) =>
                        handleFormulaKeyDown(e, point[axis], (val) =>
                          updatePoint({ [axis]: val }),
                        )
                      }
                      onChange={(e) => updatePoint({ [axis]: e.target.value })}
                      className={`w-full min-w-0 rounded border bg-neutral-950 px-1.5 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none ${
                        point[axis].trimStart().startsWith("=")
                          ? "border-sky-500/70 focus:border-sky-400"
                          : "border-neutral-700 focus:border-neutral-400"
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-neutral-400">
                  Coordinate Datums
                </label>
                {availableDatums.length === 0 && (
                  <span className="text-[10px] text-amber-400/90">
                    Add Datum first
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {["1st", "2nd", "3rd"].map((slotLabel, idx) => (
                  <div key={slotLabel}>
                    <span className="mb-0.5 block text-[10px] text-neutral-500">
                      {slotLabel}
                    </span>
                    <select
                      aria-label={`Point ${slotLabel} datum`}
                      value={point.datums[idx]}
                      onChange={(e) => updatePointDatum(idx, e.target.value)}
                      className="w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 font-mono text-xs text-neutral-100 focus:border-neutral-400 focus:outline-none"
                    >
                      {renderDatumSelectOptions(point.datums[idx])}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-neutral-400">
                Description
              </label>
              <input
                type="text"
                value={dimension.notes}
                placeholder="e.g. Datum target / inspection point"
                onChange={(e) =>
                  onUpdate(dimension.id, { notes: e.target.value })
                }
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-neutral-800 pt-2.5">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onDelete(dimension.id)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-rose-950/70 hover:text-rose-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onClick={onCancel}
            title="Cancel (Esc)"
            className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Esc
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={tryConfirm}
            title="Confirm (⌘/Ctrl+Enter)"
            className="inline-flex items-center gap-1 rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-white"
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

interface SidebarPageNavRailProps {
  initialPage: number;
  pageCount: number;
  globalCount: number;
  annotationCountByPage: Map<number, number>;
  setActivePageRef: React.MutableRefObject<((page: number) => void) | null>;
  onSelectGlobal: () => void;
  onSelectPage: (page: number) => void;
}

const SidebarPageNavRail = memo(function SidebarPageNavRail({
  initialPage,
  pageCount,
  globalCount,
  annotationCountByPage,
  setActivePageRef,
  onSelectGlobal,
  onSelectPage,
}: SidebarPageNavRailProps) {
  const [activePage, setActivePage] = useState<number>(initialPage);
  const btnElsRef = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    setActivePageRef.current = setActivePage;
    return () => {
      if (setActivePageRef.current === setActivePage) {
        setActivePageRef.current = null;
      }
    };
  }, [setActivePageRef]);

  useEffect(() => {
    const btn = btnElsRef.current.get(activePage);
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activePage]);

  const isGlobalActive = activePage === 0;

  return (
    <nav
      aria-label="Page navigation"
      className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-neutral-800/90 bg-neutral-950/90 px-1 py-2 select-none"
    >
      <button
        ref={(el) => {
          if (el) {
            btnElsRef.current.set(0, el);
          } else {
            btnElsRef.current.delete(0);
          }
        }}
        type="button"
        onClick={() => {
          setActivePage(0);
          onSelectGlobal();
        }}
        title={`Global / Datums${globalCount > 0 ? ` (${globalCount})` : ""}`}
        aria-label="Jump to Global / Datums"
        aria-current={isGlobalActive ? "page" : undefined}
        className={`relative flex w-full flex-col items-center justify-center rounded py-1.5 font-mono transition-colors ${
          isGlobalActive
            ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
            : globalCount > 0
              ? "text-amber-300/80 hover:bg-neutral-800/80 hover:text-amber-200"
              : "text-neutral-600 hover:bg-neutral-900 hover:text-neutral-400"
        }`}
      >
        {isGlobalActive && (
          <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-r bg-amber-400" />
        )}
        <span className="text-[10px] font-semibold leading-none">G</span>
        {globalCount > 0 && (
          <span
            className={`mt-0.5 text-[9px] leading-none ${
              isGlobalActive ? "text-amber-300/90" : "text-neutral-500"
            }`}
          >
            {globalCount}
          </span>
        )}
      </button>
      <div className="my-0.5 h-px w-6 bg-neutral-800" />
      {Array.from({ length: Math.max(1, pageCount) }, (_, idx) => {
        const page = idx + 1;
        const isActivePage = page === activePage;
        const count = annotationCountByPage.get(page) ?? 0;
        return (
          <button
            key={page}
            ref={(el) => {
              if (el) {
                btnElsRef.current.set(page, el);
              } else {
                btnElsRef.current.delete(page);
              }
            }}
            type="button"
            onClick={() => {
              setActivePage(page);
              onSelectPage(page);
            }}
            title={`Page ${page}${count > 0 ? ` (${count} annotations)` : ""}`}
            aria-label={`Jump to page ${page}`}
            aria-current={isActivePage ? "page" : undefined}
            className={`relative flex w-full flex-col items-center justify-center rounded py-1.5 font-mono transition-colors ${
              isActivePage
                ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/50"
                : count > 0
                  ? "text-neutral-300 hover:bg-neutral-800/80 hover:text-white"
                  : "text-neutral-600 hover:bg-neutral-900 hover:text-neutral-400"
            }`}
          >
            {isActivePage && (
              <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-r bg-blue-500" />
            )}
            <span className="text-[10px] font-semibold leading-none">
              P{page}
            </span>
            {count > 0 && (
              <span
                className={`mt-0.5 text-[9px] leading-none ${
                  isActivePage ? "text-blue-300/90" : "text-neutral-500"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
});

export function DimensionSidebar({
  isActive = true,
  dimensions,
  pointGroups = [],
  selectedDimensionId,
  selectedDimensionIds,
  editingDimensionId,
  placingDimensionId,
  pointCaptureDimensionId = null,
  focusNameKey,
  hasProject,
  currentPage = 1,
  pageCount = 1,
  scrollToDimensionRequest = null,
  activeDrawingFilename,
  onBackToDrawings,
  onJumpToPage,
  onVisiblePageChange,
  onAddDimension,
  onSortDimensions,
  onReorderDimensions,
  onSelectDimension,
  onSelectDimensions,
  onStartEditing,
  onFinishEditing,
  onCancelEditing,
  onUpdateDimension,
  onDuplicateDimension,
  onDuplicateDimensions,
  onDeleteDimension,
  onStartPlacing,
  onClearMarker,
  onAutoRecognizeDimension,
  onCreatePointGroup,
  onRenamePointGroup,
  onTogglePointGroupCollapsed,
  onSetAllPointGroupsCollapsed,
  onDeletePointGroup,
  onResumePointEntryForGroup,
  onAddPointsToGroup,
  onRemovePointsFromGroups,
}: DimensionSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    dimensionId: string;
    selectedIds: string[];
    x: number;
    y: number;
  } | null>(null);

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string>("");

  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const anchorIdRef = useRef<string | null>(null);

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const itemElsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const groupElsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const pageSectionElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const railSetActivePageRef = useRef<((page: number) => void) | null>(null);
  const suppressScrollSyncUntilRef = useRef<number>(0);
  const sidebarPageRef = useRef<number>(currentPage);
  const setSidebarPage = useCallback((page: number) => {
    sidebarPageRef.current = page;
    railSetActivePageRef.current?.(page);
  }, []);
  const suppressClickRef = useRef<boolean>(false);
  const [dragState, setDragState] = useState<{
    sourceId: string;
    sectionKey: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    targetSlot: number;
  } | null>(null);
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const dimensionsById = useMemo(
    () => new Map(dimensions.map((d) => [d.id, d])),
    [dimensions],
  );
  const pointGroupByPointId = useMemo(() => {
    const map = new Map<string, PointGroup>();
    for (const grp of pointGroups) {
      for (const pid of grp.pointIds) {
        map.set(pid, grp);
      }
    }
    return map;
  }, [pointGroups]);
  const commitGroupRename = (groupId: string) => {
    setEditingGroupId(null);
    onRenamePointGroup?.(groupId, editingGroupName);
  };
  const effectiveSelectedIds =
    selectedDimensionIds !== undefined
      ? selectedDimensionIds
      : multiSelectedIds;
  const linkedNoteIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const id of effectiveSelectedIds) {
      const d = dimensionsById.get(id);
      if (!d) continue;
      for (const nid of d.linkedNoteIds ?? []) {
        set.add(nid);
      }
    }
    return set;
  }, [effectiveSelectedIds, dimensionsById]);

  const { annotationCountByPage, datumItems, sections, sectionItemsByKey } =
    useMemo(() => {
      const countByPage = new Map<number, number>();
      const datums: Array<{ dim: Dimension; globalIdx: number }> = [];
      const pageMap = new Map<
        number,
        Array<{ dim: Dimension; globalIdx: number }>
      >();
      const unassigned: Array<{ dim: Dimension; globalIdx: number }> = [];

      dimensions.forEach((d, globalIdx) => {
        if (getAnnotationKind(d) === "datum") {
          datums.push({ dim: d, globalIdx });
          return;
        }
        const p = getAnnotationPage(d);
        if (p !== null) {
          countByPage.set(p, (countByPage.get(p) ?? 0) + 1);
          const list = pageMap.get(p) ?? [];
          list.push({ dim: d, globalIdx });
          pageMap.set(p, list);
        } else {
          unassigned.push({ dim: d, globalIdx });
        }
      });

      const nextSections: Array<{
        key: string;
        title: string;
        page: number | null;
        items: Array<{ dim: Dimension; globalIdx: number }>;
      }> = [];
      if (datums.length > 0) {
        nextSections.push({
          key: "datum",
          title: "Datums",
          page: null,
          items: datums,
        });
      }
      const totalP = Math.max(1, pageCount);
      for (let p = 1; p <= totalP; p += 1) {
        nextSections.push({
          key: `page:${p}`,
          title: `Page ${p}`,
          page: p,
          items: pageMap.get(p) ?? [],
        });
      }
      if (unassigned.length > 0) {
        nextSections.push({
          key: "unassigned",
          title: "Unassigned",
          page: null,
          items: unassigned,
        });
      }

      return {
        annotationCountByPage: countByPage,
        datumItems: datums,
        sections: nextSections,
        sectionItemsByKey: new Map(nextSections.map((s) => [s.key, s.items])),
      };
    }, [dimensions, pageCount]);

  // Smoothly scroll the list so a clicked PDF marker / newly added / arrow-navigated / moved-to-Datum item is visible
  useEffect(() => {
    if (!scrollToDimensionRequest) return;
    const targetId = scrollToDimensionRequest.id;
    const targetDim = dimensionsById.get(targetId);
    const isDatum = targetDim && getAnnotationKind(targetDim) === "datum";
    const targetPage = targetDim ? getAnnotationPage(targetDim) : null;
    if (isDatum) {
      setSidebarPage(0);
    } else if (targetPage !== null) {
      setSidebarPage(targetPage);
    }
    const block = scrollToDimensionRequest.block ?? "start";
    suppressScrollSyncUntilRef.current = performance.now() + 750;
    const rafId = window.requestAnimationFrame(() => {
      const targetGroup = pointGroupByPointId.get(targetId);
      const el =
        itemElsRef.current.get(targetId) ??
        (targetGroup ? groupElsRef.current.get(targetGroup.id) : undefined);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block });
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [scrollToDimensionRequest]);

  const listScrollRafRef = useRef<number | null>(null);
  const savedListScrollTopRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (!isActive) return;
    const scroller = listScrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = savedListScrollTopRef.current;
  }, [isActive]);

  const syncVisibleSidebarPage = () => {
    const scroller = listScrollRef.current;
    if (!scroller) return;
    if (
      performance.now() < suppressScrollSyncUntilRef.current ||
      dragStateRef.current?.active
    ) {
      return;
    }

    const totalP = Math.max(1, pageCount);
    const atBottom =
      scroller.scrollHeight > scroller.clientHeight + 4 &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 6;
    if (atBottom) {
      if (totalP !== sidebarPageRef.current) {
        setSidebarPage(totalP);
        onVisiblePageChange?.(totalP);
      }
      return;
    }

    const thresholdTop = scroller.scrollTop + 36;
    const datumEl = pageSectionElsRef.current.get(0);
    if (datumEl && datumEl.offsetTop + datumEl.offsetHeight > thresholdTop) {
      if (sidebarPageRef.current !== 0) {
        setSidebarPage(0);
      }
      return;
    }
    for (let p = 1; p <= totalP; p += 1) {
      const secEl = pageSectionElsRef.current.get(p);
      if (!secEl) continue;
      if (secEl.offsetTop + secEl.offsetHeight > thresholdTop) {
        if (p !== sidebarPageRef.current) {
          setSidebarPage(p);
          onVisiblePageChange?.(p);
        }
        break;
      }
    }
  };

  const handleListScroll = () => {
    const scroller = listScrollRef.current;
    if (isActive && scroller && scroller.clientHeight > 0) {
      savedListScrollTopRef.current = scroller.scrollTop;
    }
    if (listScrollRafRef.current === null) {
      listScrollRafRef.current = window.requestAnimationFrame(() => {
        listScrollRafRef.current = null;
        syncVisibleSidebarPage();
      });
    }
  };

  useEffect(() => {
    return () => {
      if (listScrollRafRef.current !== null) {
        window.cancelAnimationFrame(listScrollRafRef.current);
      }
    };
  }, []);

  // Keep multi-selection pruned to existing items on the active drawing
  useEffect(() => {
    const validIds = new Set(dimensions.map((d) => d.id));
    setMultiSelectedIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [dimensions]);

  // Sync external single-selection changes (e.g. clicking a marker on the PDF)
  useEffect(() => {
    if (!selectedDimensionId) {
      setMultiSelectedIds([]);
      anchorIdRef.current = null;
      return;
    }
    setMultiSelectedIds((prev) =>
      prev.includes(selectedDimensionId) ? prev : [selectedDimensionId],
    );
    if (!anchorIdRef.current) {
      anchorIdRef.current = selectedDimensionId;
    }
  }, [selectedDimensionId]);

  const multiSelectedSet = new Set(effectiveSelectedIds);

  const commitSelection = (ids: string[], primaryId: string) => {
    setMultiSelectedIds(ids);
    if (onSelectDimensions) {
      onSelectDimensions(ids, primaryId);
    } else {
      onSelectDimension(primaryId);
    }
  };

  const handleCardClick = (e: React.MouseEvent, dimId: string) => {
    if (suppressClickRef.current) return;

    if (e.shiftKey) {
      e.preventDefault();
      const anchorId = anchorIdRef.current ?? selectedDimensionId ?? dimId;
      const anchorIdx = dimensions.findIndex((d) => d.id === anchorId);
      const targetIdx = dimensions.findIndex((d) => d.id === dimId);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const rangeIds = dimensions.slice(start, end + 1).map((d) => d.id);
        commitSelection(rangeIds, dimId);
        return;
      }
    }

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const base =
        effectiveSelectedIds.length > 0
          ? effectiveSelectedIds
          : selectedDimensionId
            ? [selectedDimensionId]
            : [];
      const nextIds = base.includes(dimId)
        ? base.filter((id) => id !== dimId)
        : [...base, dimId];
      anchorIdRef.current = dimId;
      commitSelection(nextIds, nextIds.includes(dimId) ? dimId : (nextIds[nextIds.length - 1] ?? ""));
      return;
    }

    anchorIdRef.current = dimId;
    commitSelection([dimId], dimId);
  };

  useEffect(() => {
    if (!dragState) return;

    const computeTargetSlot = (
      clientY: number,
      sectionKey: string,
    ): number => {
      const items = sectionItemsByKey.get(sectionKey) ?? [];
      for (let i = 0; i < items.length; i += 1) {
        const el = itemElsRef.current.get(items[i].dim.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          return i;
        }
      }
      return items.length;
    };

    const onPointerMove = (e: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || e.pointerId !== current.pointerId) return;

      const movedEnough =
        current.active ||
        Math.hypot(e.clientX - current.startX, e.clientY - current.startY) >= 6;
      if (!movedEnough) return;

      const scroller = listScrollRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const edge = 36;
        if (e.clientY < rect.top + edge) {
          scroller.scrollTop -= 12;
        } else if (e.clientY > rect.bottom - edge) {
          scroller.scrollTop += 12;
        }
      }

      const nextSlot = computeTargetSlot(e.clientY, current.sectionKey);
      if (!current.active || current.targetSlot !== nextSlot) {
        setDragState({
          ...current,
          active: true,
          targetSlot: nextSlot,
        });
      }
    };

    const finishDrag = (e: PointerEvent, commit: boolean) => {
      const current = dragStateRef.current;
      if (!current || e.pointerId !== current.pointerId) return;
      if (current.active) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (commit) {
          onReorderDimensions(current.sourceId, current.targetSlot);
        }
      }
      setDragState(null);
    };

    const onPointerUp = (e: PointerEvent) => finishDrag(e, true);
    const onPointerCancel = (e: PointerEvent) => finishDrag(e, false);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [dragState !== null, dimensions, onReorderDimensions]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const scroller = listScrollRef.current;
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    // Only close on sidebar list scroll — NOT PDF viewer auto-scroll triggered by selecting an item
    scroller?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", close);
    };
  }, [contextMenu]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onBackToDrawings && (
        <div className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/70 px-2.5 py-1.5">
          <button
            type="button"
            onClick={onBackToDrawings}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Drawings
          </button>
          {activeDrawingFilename && (
            <span
              title={activeDrawingFilename}
              className="truncate font-mono text-[10px] text-neutral-400"
            >
              {activeDrawingFilename}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Annotations
          </h2>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
            {dimensions.length}
          </span>
          {effectiveSelectedIds.length > 1 && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 font-mono text-[10px] font-medium text-blue-300 ring-1 ring-blue-500/40">
              {effectiveSelectedIds.length} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onSetAllPointGroupsCollapsed && (() => {
            const allGroupsCollapsed =
              pointGroups.length > 0 &&
              pointGroups.every((g) => Boolean(g.collapsed));
            return (
              <button
                type="button"
                onClick={() => onSetAllPointGroupsCollapsed(!allGroupsCollapsed)}
                disabled={pointGroups.length === 0}
                title={
                  pointGroups.length === 0
                    ? "No point groups to collapse"
                    : allGroupsCollapsed
                      ? "Expand all point groups"
                      : "Collapse all point groups"
                }
                aria-label={
                  allGroupsCollapsed
                    ? "Expand all point groups"
                    : "Collapse all point groups"
                }
                className="inline-flex items-center justify-center rounded border border-neutral-800 bg-neutral-900 p-1 text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {allGroupsCollapsed ? (
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                )}
              </button>
            );
          })()}
          <button
            type="button"
            onClick={onSortDimensions}
            disabled={dimensions.length < 2}
            title="Sort by ID: Datums first, then per-page Notes → Dimensions (Linear & GD&T) → Points"
            aria-label="Sort annotations"
            className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUpDown className="h-3 w-3" />
            <span>Sort</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {hasProject && pageCount > 0 && (
          <SidebarPageNavRail
            initialPage={sidebarPageRef.current}
            pageCount={pageCount}
            globalCount={datumItems.length}
            annotationCountByPage={annotationCountByPage}
            setActivePageRef={railSetActivePageRef}
            onSelectGlobal={() => {
              sidebarPageRef.current = 0;
              suppressScrollSyncUntilRef.current = performance.now() + 650;
              const datumEl = pageSectionElsRef.current.get(0);
              if (datumEl) {
                datumEl.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              } else {
                listScrollRef.current?.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
              }
            }}
            onSelectPage={(page) => {
              sidebarPageRef.current = page;
              suppressScrollSyncUntilRef.current = performance.now() + 650;
              const secEl = pageSectionElsRef.current.get(page);
              if (secEl) {
                secEl.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }
              onJumpToPage?.(page);
            }}
          />
        )}

        <div
          ref={listScrollRef}
          onWheel={() => {
            suppressScrollSyncUntilRef.current = 0;
          }}
          onScroll={handleListScroll}
          style={{ willChange: "scroll-position" }}
          className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {!hasProject ? (
            <div className="px-3 py-8 text-center text-xs text-neutral-500">
              Open a PDF drawing or project to manage annotations.
            </div>
          ) : (
            <div className={`space-y-3 ${dragState?.active ? "select-none" : ""}`}>
              {sections.map((section) => {
                const sectionItems = section.items;
                const activeDragInSection =
                  dragState?.active === true &&
                  dragState.sectionKey === section.key;
                const activeDragSourceIdx = activeDragInSection
                  ? sectionItems.findIndex(
                      (entry) => entry.dim.id === dragState.sourceId,
                    )
                  : -1;
                const prependGlobalSlot =
                  sectionItems.length > 0
                    ? sectionItems[0].globalIdx
                    : dimensions.length;

                const renderInsertDivider = (
                  globalSlot: number,
                  targetPage: number | null,
                ) => {
                  if (dragState?.active) return null;
                  return (
                    <div className="group/insert relative flex h-2.5 items-center justify-center">
                      <div className="pointer-events-none h-px w-full bg-blue-500/70 opacity-0 transition-opacity group-hover/insert:opacity-100" />
                      <button
                        type="button"
                        onClick={() => onAddDimension(globalSlot, targetPage)}
                        title={
                          targetPage !== null
                            ? `Insert annotation on Page ${targetPage}`
                            : "Insert annotation here"
                        }
                        className="absolute z-10 inline-flex items-center gap-0.5 rounded-full border border-blue-500/60 bg-neutral-950 px-2 py-0.5 text-[10px] font-medium text-blue-300 opacity-0 shadow-md transition-opacity hover:bg-blue-600 hover:text-white group-hover/insert:opacity-100 focus:opacity-100"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  );
                };

                return (
                  <section
                    key={section.key}
                    ref={(el) => {
                      const railKey =
                        section.key === "datum" ? 0 : section.page;
                      if (railKey === null) return;
                      if (el) {
                        pageSectionElsRef.current.set(railKey, el);
                      } else {
                        pageSectionElsRef.current.delete(railKey);
                      }
                    }}
                    style={{ contain: "layout style" }}
                    className="scroll-mt-2"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 border-b border-neutral-800/90 px-1 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                          {section.title}
                        </span>
                        <span className="rounded-full bg-neutral-800/90 px-1.5 py-[1px] font-mono text-[10px] text-neutral-500">
                          {sectionItems.length}
                        </span>
                      </div>
                      {section.page !== null && (
                        <button
                          type="button"
                          onClick={() =>
                            onAddDimension(prependGlobalSlot, section.page)
                          }
                          title={`Add annotation on Page ${section.page}`}
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Add</span>
                        </button>
                      )}
                    </div>

                    {sectionItems.length === 0 ? (
                      <div className="rounded border border-dashed border-neutral-800/80 px-2.5 py-2 text-center text-[11px] text-neutral-600">
                        No annotations on {section.title}
                      </div>
                    ) : (
                      (() => {
                        const renderAnnotationItem = (
                          dim: Dimension,
                          globalIdx: number,
                          idx: number,
                          insideGroup = false,
                        ) => {
                          const isEditing = dim.id === editingDimensionId;
                          const isMultiSelected =
                            effectiveSelectedIds.length > 1 &&
                            multiSelectedSet.has(dim.id);
                          const isSelected =
                            dim.id === selectedDimensionId || isMultiSelected;
                          const isLinkedNoteToSelected =
                            !isSelected && linkedNoteIdSet.has(dim.id);
                          const isPlacing = dim.id === placingDimensionId;
                          const isDraggingThis =
                            activeDragInSection &&
                            dragState.sourceId === dim.id;
                          const showDropBefore =
                            !insideGroup &&
                            activeDragInSection &&
                            dragState.targetSlot === idx &&
                            activeDragSourceIdx !== idx &&
                            activeDragSourceIdx !== idx - 1;
                          const showDropAfterLast =
                            !insideGroup &&
                            activeDragInSection &&
                            idx === sectionItems.length - 1 &&
                            dragState.targetSlot === sectionItems.length &&
                            activeDragSourceIdx !== sectionItems.length - 1;

                          const setItemRef = (el: HTMLLIElement | null) => {
                            if (el) {
                              itemElsRef.current.set(dim.id, el);
                            } else {
                              itemElsRef.current.delete(dim.id);
                            }
                          };

                          if (isEditing) {
                            return (
                              <li
                                key={dim.id}
                                ref={setItemRef}
                                className="relative scroll-mt-2"
                              >
                                {!insideGroup &&
                                  renderInsertDivider(globalIdx, section.page)}
                                {showDropBefore && (
                                  <div className="pointer-events-none mb-1.5 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                                )}
                                <InlineEditCard
                                  dimension={dim}
                                  allDimensions={dimensions}
                                  pointGroups={pointGroups}
                                  isPlacing={isPlacing}
                                  isCapturingPoint={
                                    dim.id === pointCaptureDimensionId
                                  }
                                  focusNameKey={focusNameKey}
                                  onUpdate={onUpdateDimension}
                                  onDone={onFinishEditing}
                                  onCancel={onCancelEditing}
                                  onDelete={onDeleteDimension}
                                  onStartPlacing={onStartPlacing}
                                  onClearMarker={onClearMarker}
                                  onAutoRecognize={onAutoRecognizeDimension}
                                />
                                {showDropAfterLast && (
                                  <div className="pointer-events-none mt-1.5 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                                )}
                                {!insideGroup &&
                                  idx === sectionItems.length - 1 &&
                                  renderInsertDivider(
                                    globalIdx + 1,
                                    section.page,
                                  )}
                              </li>
                            );
                          }

                          const kind = getAnnotationKind(dim);
                          const tol = formatTolerance(
                            dim.upperTol,
                            dim.lowerTol,
                          );
                          const gdt =
                            kind === "gdt" ? normalizeGdtSpec(dim.gdt) : null;
                          const point =
                            kind === "point"
                              ? normalizePointSpec(dim.point)
                              : null;

                          const markerStatus = isPlacing ? (
                            <span className="text-blue-400">Marking…</span>
                          ) : dim.marker ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-400">
                              <MapPin className="h-3 w-3" />P{dim.marker.page}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-amber-400/90">
                              <MapPinOff className="h-3 w-3" />
                              Unmarked
                            </span>
                          );

                          return (
                            <li
                              key={dim.id}
                              ref={setItemRef}
                              className="relative scroll-mt-2"
                            >
                              {!insideGroup &&
                                renderInsertDivider(globalIdx, section.page)}
                              {showDropBefore && (
                                <div className="pointer-events-none mb-1.5 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                              )}
                              <div
                                role="button"
                                tabIndex={0}
                                onPointerDown={(e) => {
                                  if (
                                    e.button !== 0 ||
                                    sectionItems.length < 2
                                  ) {
                                    return;
                                  }
                                  if ((e.target as HTMLElement).closest("button"))
                                    return;
                                  setDragState({
                                    sourceId: dim.id,
                                    sectionKey: getAnnotationSectionKey(dim),
                                    pointerId: e.pointerId,
                                    startX: e.clientX,
                                    startY: e.clientY,
                                    active: false,
                                    targetSlot: idx,
                                  });
                                }}
                        onClick={(e) => handleCardClick(e, dim.id)}
                        onDoubleClick={() => onStartEditing(dim.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const keepMulti =
                            effectiveSelectedIds.length > 1 &&
                            multiSelectedSet.has(dim.id);
                          const targetIds = keepMulti
                            ? effectiveSelectedIds
                            : [dim.id];
                          if (!keepMulti) {
                            anchorIdRef.current = dim.id;
                            commitSelection([dim.id], dim.id);
                          }
                          const menuW = 188;
                          const menuH = keepMulti ? 82 : 112;
                          const x = Math.min(
                            e.clientX,
                            window.innerWidth - menuW - 8,
                          );
                          const y = Math.min(
                            e.clientY,
                            window.innerHeight - menuH - 8,
                          );
                          setContextMenu({
                            dimensionId: dim.id,
                            selectedIds: targetIds,
                            x,
                            y,
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            anchorIdRef.current = dim.id;
                            setMultiSelectedIds([dim.id]);
                            onSelectDimension(dim.id);
                          }
                        }}
                        className={`group flex items-start justify-between gap-1.5 rounded-md border px-2 py-2 transition-colors select-none focus:outline-none ${
                          isDraggingThis
                            ? "cursor-grabbing border-blue-500/70 bg-neutral-800/70 opacity-45"
                            : dragState?.active
                              ? "cursor-grabbing border-neutral-800/80 bg-neutral-900/60 text-neutral-300"
                              : isMultiSelected
                                ? "cursor-pointer border-blue-500/70 bg-blue-950/35 text-neutral-100"
                                : isSelected
                                  ? "cursor-pointer border-neutral-500 bg-neutral-800/90 text-neutral-100"
                                  : isLinkedNoteToSelected
                                    ? "cursor-pointer border-blue-500/60 bg-blue-950/25 text-neutral-100"
                                    : "cursor-pointer border-neutral-800/80 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          title="Drag to reorder"
                          className="mt-0.5 shrink-0 cursor-grab text-neutral-600 opacity-50 transition-opacity group-hover:text-neutral-400 group-hover:opacity-100"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          {/* Title Row */}
                          <div className="flex items-center gap-1.5">
                            {kind === "datum" ? (
                              <>
                                <span
                                  title="Annotation kind: Datum"
                                  className="shrink-0 rounded bg-amber-500/15 px-1.5 py-[1px] text-[10px] font-medium text-amber-300 ring-1 ring-amber-500/40"
                                >
                                  DATUM
                                </span>
                                <span className="inline-flex items-center justify-center rounded border border-amber-400/70 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs font-bold leading-none text-amber-200">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "note" ? (
                              <>
                                <span
                                  title="Annotation kind: Note"
                                  className="shrink-0 rounded bg-sky-500/15 px-1.5 py-[1px] text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/40"
                                >
                                  NOTE
                                </span>
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "point" ? (
                              <>
                                <span
                                  title="Annotation kind: Point"
                                  className="shrink-0 rounded bg-purple-500/15 px-1.5 py-[1px] text-[10px] font-medium text-purple-300 ring-1 ring-purple-500/40"
                                >
                                  POINT
                                </span>
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "gdt" ? (
                              <>
                                <span
                                  title="Annotation kind: GD&T"
                                  className="shrink-0 rounded bg-blue-500/15 px-1.5 py-[1px] text-[10px] font-medium text-blue-300 ring-1 ring-blue-500/40"
                                >
                                  GD&T
                                </span>
                                {dim.dimensionType?.trim() && (
                                  <span
                                    title="Dimension type"
                                    className="shrink-0 rounded bg-neutral-800 px-1.5 py-[1px] font-mono text-[10px] font-medium text-neutral-200 ring-1 ring-neutral-700/80"
                                  >
                                    {dim.dimensionType.trim()}
                                  </span>
                                )}
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "non_dimensional" ? (
                              <>
                                <span
                                  title="Annotation kind: Non-Dimensional"
                                  className="shrink-0 rounded bg-neutral-500/15 px-1.5 py-[1px] text-[10px] font-medium text-neutral-300 ring-1 ring-neutral-500/40"
                                >
                                  NON-DIM
                                </span>
                                {dim.dimensionType?.trim() && (
                                  <span
                                    title="Dimension type"
                                    className="shrink-0 rounded bg-neutral-800 px-1.5 py-[1px] font-mono text-[10px] font-medium text-neutral-200 ring-1 ring-neutral-700/80"
                                  >
                                    {dim.dimensionType.trim()}
                                  </span>
                                )}
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : (
                              <>
                                <span
                                  title="Annotation kind: Linear"
                                  className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-[1px] text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/35"
                                >
                                  LINEAR
                                </span>
                                {dim.dimensionType?.trim() && (
                                  <span
                                    title="Dimension type"
                                    className="shrink-0 rounded bg-neutral-800 px-1.5 py-[1px] font-mono text-[10px] font-medium text-neutral-200 ring-1 ring-neutral-700/80"
                                  >
                                    {dim.dimensionType.trim()}
                                  </span>
                                )}
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Spec Row */}
                          {kind === "linear" && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400">
                              {dim.nominal.trim() ? (
                                <span className="font-mono text-neutral-300">
                                  {dim.quantity > 1 ? `${dim.quantity}X ` : ""}
                                  {dim.nominal.trim()}
                                  {tol ? ` ${tol}` : ""} {dim.unit}
                                </span>
                              ) : (
                                <span className="italic text-neutral-500">
                                  No nominal
                                </span>
                              )}
                              {markerStatus}
                            </div>
                          )}

                          {kind === "gdt" && gdt && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                              <FeatureControlFrame gdt={gdt} />
                              {markerStatus}
                            </div>
                          )}

                          {kind === "datum" && (
                            <div className="mt-1 flex items-center gap-2 text-[11px]">
                              {markerStatus}
                            </div>
                          )}

                          {kind === "non_dimensional" && (
                            <div className="mt-1 space-y-1 text-[11px]">
                              {dim.notes.trim() ? (
                                <div className="line-clamp-2 text-neutral-300">
                                  {dim.notes.trim()}
                                </div>
                              ) : (
                                <div className="italic text-neutral-500">
                                  No requirement
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                {markerStatus}
                              </div>
                            </div>
                          )}

                          {kind === "note" && (
                            <div className="mt-1 space-y-1 text-[11px]">
                              {dim.notes.trim() ? (
                                <div className="line-clamp-2 text-neutral-300">
                                  {dim.notes.trim()}
                                </div>
                              ) : (
                                <div className="italic text-neutral-500">
                                  Empty note
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                {markerStatus}
                              </div>
                            </div>
                          )}

                          {kind === "point" && point && (
                            <div className="mt-1 space-y-1 text-[11px] text-neutral-400">
                              <div className="flex flex-wrap items-center gap-x-2 font-mono text-neutral-300">
                                <span>X:{point.x.trim() || "—"}</span>
                                <span>Y:{point.y.trim() || "—"}</span>
                                <span>Z:{point.z.trim() || "—"}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {point.datums.some((d) => d.trim()) && (
                                  <span className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                                    {point.datums
                                      .filter((d) => d.trim())
                                      .join(" | ")}
                                  </span>
                                )}
                                {markerStatus}
                              </div>
                            </div>
                          )}

                          {/* Description Row (for Linear, GD&T, Datum, Point) */}
                          {kind !== "note" &&
                            kind !== "non_dimensional" &&
                            dim.notes.trim() && (
                            <div className="mt-1 line-clamp-1 text-[11px] text-neutral-500">
                              {dim.notes.trim()}
                            </div>
                          )}

                          {/* Linked Points & Notes badges (for Linear, GD&T, and Non-Dimensional) */}
                          {(kind === "linear" ||
                            kind === "gdt" ||
                            kind === "non_dimensional") &&
                            (() => {
                              const linkedPointTokens =
                                resolveLinkedPointDisplayTokens(
                                  dim.linkedPointIds ?? [],
                                  dimensionsById,
                                  pointGroups,
                                );
                              const linkedNts = (dim.linkedNoteIds ?? [])
                                .map((id) => dimensionsById.get(id))
                                .filter((d): d is Dimension => Boolean(d));
                              if (
                                linkedPointTokens.length === 0 &&
                                linkedNts.length === 0
                              ) {
                                return null;
                              }
                              return (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                  {linkedPointTokens.map((token) => {
                                    if (token.kind === "group") {
                                      const memberNames = token.points
                                        .map((pt) =>
                                          formatScopedAnnotationLabel(
                                            pt,
                                            dimensions,
                                          ),
                                        )
                                        .join(", ");
                                      return (
                                        <span
                                          key={`grp-${token.group.id}`}
                                          title={`Point Group ${token.group.name} (${token.points.length} points: ${memberNames})`}
                                          className="rounded bg-purple-500/20 px-1.5 py-[1px] font-mono text-[10px] font-semibold text-purple-200 ring-1 ring-purple-400/50"
                                        >
                                          {token.group.name}
                                        </span>
                                      );
                                    }
                                    const pt = token.point;
                                    const ptLabel = formatScopedAnnotationLabel(
                                      pt,
                                      dimensions,
                                    );
                                    return (
                                      <span
                                        key={pt.id}
                                        title={
                                          pt.point
                                            ? `Point ${ptLabel} (${pt.point.x || "—"}, ${pt.point.y || "—"}, ${pt.point.z || "—"})`
                                            : `Point ${ptLabel}`
                                        }
                                        className="rounded bg-purple-500/15 px-1.5 py-[1px] font-mono text-[10px] font-medium text-purple-300 ring-1 ring-purple-500/35"
                                      >
                                        {ptLabel}
                                      </span>
                                    );
                                  })}
                                  {linkedNts.map((nt) => {
                                    const ntLabel = formatScopedAnnotationLabel(
                                      nt,
                                      dimensions,
                                    );
                                    return (
                                      <span
                                        key={nt.id}
                                        title={
                                          nt.notes.trim()
                                            ? `Note ${ntLabel}: ${nt.notes.trim()}`
                                            : `Note ${ntLabel}`
                                        }
                                        className="rounded bg-sky-500/15 px-1.5 py-[1px] font-mono text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/35"
                                      >
                                        {ntLabel}
                                      </span>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            aria-label={`Edit annotation ${dim.name || dim.id}`}
                            title="Edit annotation"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartEditing(dim.id);
                            }}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete annotation ${dim.name || dim.id}`}
                            title="Delete annotation"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteDimension(dim.id);
                            }}
                            className="rounded p-1 text-neutral-400 hover:bg-rose-950 hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {showDropAfterLast && (
                        <div className="pointer-events-none mt-1.5 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                      )}
                      {!insideGroup &&
                        idx === sectionItems.length - 1 &&
                        renderInsertDivider(globalIdx + 1, section.page)}
                    </li>
                          );
                        };

                        type SectionRenderEntry =
                          | {
                              type: "item";
                              dim: Dimension;
                              globalIdx: number;
                              idx: number;
                            }
                          | {
                              type: "group";
                              group: PointGroup;
                              members: Array<{
                                dim: Dimension;
                                globalIdx: number;
                                idx: number;
                              }>;
                              firstGlobalIdx: number;
                              lastGlobalIdx: number;
                              isLastInSection: boolean;
                            };

                        const renderEntries: SectionRenderEntry[] = [];
                        const emittedGroupIds = new Set<string>();

                        sectionItems.forEach(({ dim, globalIdx }, idx) => {
                          const grp =
                            section.page !== null &&
                            getAnnotationKind(dim) === "point"
                              ? pointGroupByPointId.get(dim.id)
                              : undefined;
                          if (grp && grp.page === section.page) {
                            if (emittedGroupIds.has(grp.id)) return;
                            emittedGroupIds.add(grp.id);
                            const memberSet = new Set(grp.pointIds);
                            const members = sectionItems
                              .map((entry, mIdx) => ({ ...entry, idx: mIdx }))
                              .filter((entry) => memberSet.has(entry.dim.id));
                            if (members.length > 0) {
                              renderEntries.push({
                                type: "group",
                                group: grp,
                                members,
                                firstGlobalIdx: members[0].globalIdx,
                                lastGlobalIdx:
                                  members[members.length - 1].globalIdx,
                                isLastInSection: false,
                              });
                            }
                            return;
                          }
                          renderEntries.push({
                            type: "item",
                            dim,
                            globalIdx,
                            idx,
                          });
                        });

                        if (renderEntries.length > 0) {
                          const lastEntry =
                            renderEntries[renderEntries.length - 1];
                          if (lastEntry.type === "group") {
                            lastEntry.isLastInSection = true;
                          }
                        }

                        return (
                          <ul>
                            {renderEntries.map((entry) => {
                              if (entry.type === "item") {
                                return renderAnnotationItem(
                                  entry.dim,
                                  entry.globalIdx,
                                  entry.idx,
                                  false,
                                );
                              }

                              const { group, members } = entry;
                              const memberIds = members.map((m) => m.dim.id);
                              const allMembersSelected =
                                memberIds.length > 0 &&
                                memberIds.every((id) =>
                                  multiSelectedSet.has(id),
                                );
                              const anyMemberSelected =
                                memberIds.length > 0 &&
                                memberIds.some((id) =>
                                  multiSelectedSet.has(id),
                                );
                              const anyMemberEditing =
                                editingDimensionId !== null &&
                                memberIds.includes(editingDimensionId);
                              const isCollapsed =
                                Boolean(group.collapsed) && !anyMemberEditing;
                              const isRenaming = editingGroupId === group.id;

                              return (
                                <li
                                  key={`point-group-${group.id}`}
                                  ref={(el) => {
                                    if (el) {
                                      groupElsRef.current.set(group.id, el);
                                    } else {
                                      groupElsRef.current.delete(group.id);
                                    }
                                  }}
                                  className="relative scroll-mt-2"
                                >
                                  {renderInsertDivider(
                                    entry.firstGlobalIdx,
                                    section.page,
                                  )}
                                  <div
                                    className={`rounded-md border transition-colors ${
                                      allMembersSelected ||
                                      (isCollapsed && anyMemberSelected)
                                        ? "border-purple-400/80 bg-purple-950/35"
                                        : "border-purple-500/35 bg-purple-950/15"
                                    }`}
                                  >
                                    <div
                                      onClick={() => {
                                        if (isRenaming) return;
                                        if (memberIds.length > 0) {
                                          anchorIdRef.current = memberIds[0];
                                          commitSelection(
                                            memberIds,
                                            memberIds[0],
                                          );
                                        }
                                      }}
                                      className="group/grp flex cursor-pointer items-center justify-between gap-1.5 px-2 py-1.5 select-none"
                                    >
                                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                        <button
                                          type="button"
                                          aria-label={
                                            isCollapsed
                                              ? `Expand point group ${group.name}`
                                              : `Collapse point group ${group.name}`
                                          }
                                          title={
                                            isCollapsed
                                              ? "Expand group"
                                              : "Collapse group"
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onTogglePointGroupCollapsed?.(
                                              group.id,
                                            );
                                          }}
                                          className="shrink-0 rounded p-0.5 text-purple-300/80 hover:bg-purple-500/20 hover:text-purple-100"
                                        >
                                          {isCollapsed ? (
                                            <ChevronRight className="h-3.5 w-3.5" />
                                          ) : (
                                            <ChevronDown className="h-3.5 w-3.5" />
                                          )}
                                        </button>
                                        <span className="shrink-0 rounded bg-purple-500/20 px-1.5 py-[1px] text-[10px] font-medium text-purple-300 ring-1 ring-purple-500/40">
                                          POINTS
                                        </span>
                                        {isRenaming ? (
                                          <input
                                            type="text"
                                            autoFocus
                                            value={editingGroupName}
                                            placeholder="Auto range name"
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) =>
                                              setEditingGroupName(
                                                e.target.value,
                                              )
                                            }
                                            onBlur={() =>
                                              commitGroupRename(group.id)
                                            }
                                            onKeyDown={(e) => {
                                              if (e.nativeEvent.isComposing)
                                                return;
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                commitGroupRename(group.id);
                                              } else if (e.key === "Escape") {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setEditingGroupId(null);
                                              }
                                            }}
                                            className="min-w-0 flex-1 rounded border border-purple-400/70 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs text-purple-100 focus:outline-none"
                                          />
                                        ) : (
                                          <span
                                            title={`${group.name} (${memberIds.length} points) — double-click to rename`}
                                            onDoubleClick={(e) => {
                                              e.stopPropagation();
                                              setEditingGroupId(group.id);
                                              setEditingGroupName(group.name);
                                            }}
                                            className="truncate font-mono text-xs font-semibold text-purple-100"
                                          >
                                            {group.name}
                                          </span>
                                        )}
                                        <span className="shrink-0 rounded-full bg-purple-500/15 px-1.5 py-[1px] font-mono text-[10px] text-purple-300/90">
                                          {memberIds.length}
                                        </span>
                                      </div>

                                      {!isRenaming && (
                                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/grp:opacity-100 focus-within:opacity-100">
                                          {onResumePointEntryForGroup && (
                                            <button
                                              type="button"
                                              aria-label={`Continue adding points to ${group.name}`}
                                              title="Continue adding points with Point Entry tool"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onResumePointEntryForGroup(
                                                  group.id,
                                                );
                                              }}
                                              className="rounded p-1 text-purple-300/80 hover:bg-purple-500/25 hover:text-purple-100"
                                            >
                                              <LocateFixed className="h-3 w-3" />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            aria-label={`Rename point group ${group.name}`}
                                            title="Rename group (leave blank for auto range)"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingGroupId(group.id);
                                              setEditingGroupName(group.name);
                                            }}
                                            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                          <button
                                            type="button"
                                            aria-label={`Ungroup ${group.name}`}
                                            title="Ungroup points (keeps all points)"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onDeletePointGroup?.(group.id);
                                            }}
                                            className="rounded p-1 text-neutral-400 hover:bg-rose-950/70 hover:text-rose-300"
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    {!isCollapsed && (
                                      <ul className="space-y-1 border-t border-purple-500/20 p-1.5">
                                        {members.map((m) =>
                                          renderAnnotationItem(
                                            m.dim,
                                            m.globalIdx,
                                            m.idx,
                                            true,
                                          ),
                                        )}
                                      </ul>
                                    )}
                                  </div>
                                  {entry.isLastInSection &&
                                    renderInsertDivider(
                                      entry.lastGlobalIdx + 1,
                                      section.page,
                                    )}
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })()
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {contextMenu && (() => {
        const selectedDims = contextMenu.selectedIds
          .map((id) => dimensionsById.get(id))
          .filter((d): d is Dimension => Boolean(d));
        const firstPointPage =
          selectedDims.length >= 1 ? getAnnotationPage(selectedDims[0]) : null;
        const allSamePagePoints =
          selectedDims.length >= 1 &&
          firstPointPage !== null &&
          selectedDims.every(
            (d) =>
              getAnnotationKind(d) === "point" &&
              getAnnotationPage(d) === firstPointPage,
          );
        const canCreatePointGroup =
          Boolean(onCreatePointGroup) &&
          allSamePagePoints &&
          selectedDims.length >= 2;
        const anyInGroup =
          allSamePagePoints &&
          selectedDims.some((d) => pointGroupByPointId.has(d.id));
        const targetGroupsOnPage =
          allSamePagePoints && onAddPointsToGroup && firstPointPage !== null
            ? pointGroups.filter(
                (g) =>
                  g.page === firstPointPage &&
                  !selectedDims.every((d) => g.pointIds.includes(d.id)),
              )
            : [];

        return (
        <FloatingMenu
          x={contextMenu.x}
          y={contextMenu.y}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          className="w-52 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl"
        >
          {contextMenu.selectedIds.length > 1 ? (
            <>
              {canCreatePointGroup && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const ids = contextMenu.selectedIds;
                    setContextMenu(null);
                    onCreatePointGroup?.(ids);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-purple-200 hover:bg-purple-950/60 hover:text-purple-100"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-purple-300" />
                  Create Point Group ({contextMenu.selectedIds.length})
                </button>
              )}
              {anyInGroup && onRemovePointsFromGroups && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const ids = contextMenu.selectedIds;
                    setContextMenu(null);
                    onRemovePointsFromGroups(ids);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
                >
                  <FolderMinus className="h-3.5 w-3.5 text-purple-300" />
                  Remove from Group ({contextMenu.selectedIds.length})
                </button>
              )}
              {targetGroupsOnPage.length > 0 && onAddPointsToGroup && (
                <>
                  <div className="my-1 border-t border-neutral-800" />
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    Add to Group
                  </div>
                  {targetGroupsOnPage.map((grp) => (
                    <button
                      key={grp.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const ids = contextMenu.selectedIds;
                        setContextMenu(null);
                        onAddPointsToGroup(grp.id, ids);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-purple-200 hover:bg-purple-950/60 hover:text-purple-100"
                    >
                      <FolderPlus className="h-3 w-3 shrink-0 text-purple-400" />
                      <span className="truncate">{grp.name}</span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-neutral-800" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const ids = contextMenu.selectedIds;
                  setContextMenu(null);
                  setMultiSelectedIds([]);
                  onDuplicateDimensions(ids);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <Copy className="h-3.5 w-3.5 text-neutral-400" />
                Duplicate ({contextMenu.selectedIds.length})
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = contextMenu.dimensionId;
                  setContextMenu(null);
                  onDuplicateDimension(id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <Copy className="h-3.5 w-3.5 text-neutral-400" />
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = contextMenu.dimensionId;
                  setContextMenu(null);
                  onStartEditing(id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5 text-neutral-400" />
                Edit
              </button>
              {anyInGroup && onRemovePointsFromGroups && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const id = contextMenu.dimensionId;
                    setContextMenu(null);
                    onRemovePointsFromGroups([id]);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-purple-200 hover:bg-purple-950/60 hover:text-purple-100"
                >
                  <FolderMinus className="h-3.5 w-3.5 text-purple-300" />
                  Remove from Group
                </button>
              )}
              {targetGroupsOnPage.length > 0 && onAddPointsToGroup && (
                <>
                  <div className="my-1 border-t border-neutral-800" />
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    Add to Group
                  </div>
                  {targetGroupsOnPage.map((grp) => (
                    <button
                      key={grp.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const id = contextMenu.dimensionId;
                        setContextMenu(null);
                        onAddPointsToGroup(grp.id, [id]);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-purple-200 hover:bg-purple-950/60 hover:text-purple-100"
                    >
                      <FolderPlus className="h-3 w-3 shrink-0 text-purple-400" />
                      <span className="truncate">{grp.name}</span>
                    </button>
                  ))}
                </>
              )}
              <div className="my-1 border-t border-neutral-800" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = contextMenu.dimensionId;
                  setContextMenu(null);
                  onDeleteDimension(id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-300 hover:bg-rose-950/70 hover:text-rose-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          )}
        </FloatingMenu>
        );
      })()}
    </div>
  );
}
