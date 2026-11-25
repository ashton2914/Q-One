import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  Crosshair,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
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
  sanitizeGdtSpec,
} from "../lib/annotations";
import {
  findTypeCompletion,
  formatTolerance,
  validateDimensionId,
} from "../lib/dimensions";
import type {
  AnnotationKind,
  Dimension,
  GdtDatumRef,
  GdtSpec,
  GdtSymbol,
  MaterialCondition,
  PointSpec,
} from "../types/project";

export interface DimensionSidebarProps {
  dimensions: Dimension[];
  selectedDimensionId: string | null;
  editingDimensionId: string | null;
  placingDimensionId: string | null;
  focusNameKey: number;
  hasProject: boolean;
  activeDrawingFilename?: string | null;
  onBackToDrawings?: () => void;
  onAddDimension: () => void;
  onSelectDimension: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onCancelEditing: () => void;
  onUpdateDimension: (id: string, patch: Partial<Dimension>) => void;
  onDuplicateDimension: (id: string) => void;
  onDeleteDimension: (id: string) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
}

interface InlineEditCardProps {
  dimension: Dimension;
  allDimensions: Dimension[];
  isPlacing: boolean;
  focusNameKey: number;
  onUpdate: (id: string, patch: Partial<Dimension>) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
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
  isPlacing,
  focusNameKey,
  onUpdate,
  onDone,
  onCancel,
  onDelete,
  onStartPlacing,
  onClearMarker,
}: InlineEditCardProps) {
  const typeInputRef = useRef<HTMLInputElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState<string>(
    dimension.quantity && dimension.quantity > 1
      ? String(dimension.quantity)
      : "",
  );

  const kind = getAnnotationKind(dimension);
  const availableDatums = getAvailableDatums(allDimensions);
  const gdt = normalizeGdtSpec(dimension.gdt);
  const gdtRules = getGdtRules(gdt.symbol);
  const point = normalizePointSpec(dimension.point);

  useEffect(() => {
    setQtyText(
      dimension.quantity && dimension.quantity > 1
        ? String(dimension.quantity)
        : "",
    );
  }, [dimension.id]);

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

  useEffect(() => {
    const target =
      kind === "linear" || kind === "gdt"
        ? typeInputRef.current
        : idInputRef.current;
    if (!target) return;
    target.focus();
    const len = target.value.length;
    target.setSelectionRange(len, len);
  }, [dimension.id, focusNameKey, kind]);

  const handleKindChange = (nextKind: AnnotationKind) => {
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
      {/* Card Header: Annotation Kind Selector + Mark Area / Redraw */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <select
          aria-label="Annotation kind"
          value={kind}
          onChange={(e) => handleKindChange(e.target.value as AnnotationKind)}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs font-semibold text-neutral-100 focus:border-neutral-400 focus:outline-none"
        >
          {ANNOTATION_KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

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
        {/* LINEAR & GD&T: Type + ID */}
        {(kind === "linear" || kind === "gdt") && (
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
                  onChange={(e) =>
                    onUpdate(dimension.id, { nominal: e.target.value })
                  }
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
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
                  onChange={(e) =>
                    onUpdate(dimension.id, { upperTol: e.target.value })
                  }
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
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
                  onChange={(e) =>
                    onUpdate(dimension.id, { lowerTol: e.target.value })
                  }
                  className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
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
                  onChange={(e) => updateGdt({ tolerance: e.target.value })}
                  className="w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
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
                      onChange={(e) => updatePoint({ [axis]: e.target.value })}
                      className="w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
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

export function DimensionSidebar({
  dimensions,
  selectedDimensionId,
  editingDimensionId,
  placingDimensionId,
  focusNameKey,
  hasProject,
  activeDrawingFilename,
  onBackToDrawings,
  onAddDimension,
  onSelectDimension,
  onStartEditing,
  onFinishEditing,
  onCancelEditing,
  onUpdateDimension,
  onDuplicateDimension,
  onDeleteDimension,
  onStartPlacing,
  onClearMarker,
}: DimensionSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    dimensionId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!hasProject ? (
          <div className="px-3 py-8 text-center text-xs text-neutral-500">
            Open a PDF drawing or project to manage annotations.
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={onAddDimension}
              title="Add Annotation (N)"
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-700 bg-neutral-900/70 px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Annotation</span>
              <kbd className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 ring-1 ring-neutral-700">
                N
              </kbd>
            </button>

            {dimensions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">
                No annotations yet. Click{" "}
                <span className="font-medium text-neutral-300">
                  Add Annotation
                </span>{" "}
                above to create your first item.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {dimensions.map((dim) => {
                  const isEditing = dim.id === editingDimensionId;
                  const isSelected = dim.id === selectedDimensionId;
                  const isPlacing = dim.id === placingDimensionId;

                  if (isEditing) {
                    return (
                      <li key={dim.id}>
                        <InlineEditCard
                          dimension={dim}
                          allDimensions={dimensions}
                          isPlacing={isPlacing}
                          focusNameKey={focusNameKey}
                          onUpdate={onUpdateDimension}
                          onDone={onFinishEditing}
                          onCancel={onCancelEditing}
                          onDelete={onDeleteDimension}
                          onStartPlacing={onStartPlacing}
                          onClearMarker={onClearMarker}
                        />
                      </li>
                    );
                  }

                  const kind = getAnnotationKind(dim);
                  const tol = formatTolerance(dim.upperTol, dim.lowerTol);
                  const gdt = kind === "gdt" ? normalizeGdtSpec(dim.gdt) : null;
                  const point =
                    kind === "point" ? normalizePointSpec(dim.point) : null;

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
                    <li key={dim.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectDimension(dim.id)}
                        onDoubleClick={() => onStartEditing(dim.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onSelectDimension(dim.id);
                          const menuW = 160;
                          const menuH = 112;
                          const x = Math.min(
                            e.clientX,
                            window.innerWidth - menuW - 8,
                          );
                          const y = Math.min(
                            e.clientY,
                            window.innerHeight - menuH - 8,
                          );
                          setContextMenu({ dimensionId: dim.id, x, y });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectDimension(dim.id);
                          }
                        }}
                        className={`group flex cursor-pointer items-start justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                          isSelected
                            ? "border-neutral-500 bg-neutral-800/90 text-neutral-100"
                            : "border-neutral-800/80 bg-neutral-900/60 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          {/* Title Row */}
                          <div className="flex items-center gap-1.5">
                            {kind === "datum" ? (
                              <>
                                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-[1px] text-[10px] font-medium text-amber-300 ring-1 ring-amber-500/40">
                                  DATUM
                                </span>
                                <span className="inline-flex items-center justify-center rounded border border-amber-400/70 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs font-bold leading-none text-amber-200">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "note" ? (
                              <>
                                <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-[1px] text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/40">
                                  NOTE
                                </span>
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "point" ? (
                              <>
                                <span className="shrink-0 rounded bg-purple-500/15 px-1.5 py-[1px] text-[10px] font-medium text-purple-300 ring-1 ring-purple-500/40">
                                  POINT
                                </span>
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : kind === "gdt" ? (
                              <>
                                {dim.dimensionType?.trim() ? (
                                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-[1px] font-mono text-[10px] font-medium text-neutral-300 ring-1 ring-neutral-700/80">
                                    {dim.dimensionType.trim()}
                                  </span>
                                ) : (
                                  <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-[1px] text-[10px] font-medium text-blue-300 ring-1 ring-blue-500/40">
                                    GD&T
                                  </span>
                                )}
                                <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                                  {dim.name.trim() || "—"}
                                </span>
                              </>
                            ) : (
                              <>
                                {dim.dimensionType?.trim() && (
                                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-[1px] font-mono text-[10px] font-medium text-neutral-300 ring-1 ring-neutral-700/80">
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

                          {/* Description Row (for non-note kinds) */}
                          {kind !== "note" && dim.notes.trim() && (
                            <div className="mt-1 line-clamp-1 text-[11px] text-neutral-500">
                              {dim.notes.trim()}
                            </div>
                          )}
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
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-40 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl"
        >
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
        </div>
      )}
    </div>
  );
}
