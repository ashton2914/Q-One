import { useEffect, useRef, useState } from "react";
import {
  Check,
  Crosshair,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  findTypeCompletion,
  formatTolerance,
  validateDimensionId,
} from "../lib/dimensions";
import type { Dimension } from "../types/project";

export interface DimensionSidebarProps {
  dimensions: Dimension[];
  typeHistory: string[];
  selectedDimensionId: string | null;
  editingDimensionId: string | null;
  placingDimensionId: string | null;
  focusNameKey: number;
  hasProject: boolean;
  onAddDimension: () => void;
  onSelectDimension: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onCancelEditing: () => void;
  onUpdateDimension: (id: string, patch: Partial<Dimension>) => void;
  onDeleteDimension: (id: string) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
}

interface InlineEditCardProps {
  dimension: Dimension;
  allDimensions: Dimension[];
  typeHistory: string[];
  isPlacing: boolean;
  focusNameKey: number;
  onUpdate: (id: string, patch: Partial<Dimension>) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
}

function InlineEditCard({
  dimension,
  allDimensions,
  typeHistory,
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
  const lastTypeInputLenRef = useRef<number>(
    (dimension.dimensionType ?? "").length,
  );
  const [idError, setIdError] = useState<string | null>(null);

  useEffect(() => {
    const input = typeInputRef.current;
    if (!input) return;
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }, [dimension.id, focusNameKey]);

  const tryConfirm = () => {
    const err = validateDimensionId(dimension.name, dimension.id, allDimensions);
    if (err) {
      setIdError(err);
      idInputRef.current?.focus();
      idInputRef.current?.select();
      return;
    }
    setIdError(null);
    onDone();
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const isDeleting = raw.length < lastTypeInputLenRef.current;
    const inputEvent = e.nativeEvent as InputEvent;
    const isComposing = Boolean(inputEvent.isComposing);

    if (!isDeleting && !isComposing && raw.length > 0) {
      const match = findTypeCompletion(raw, typeHistory);
      if (match && match.length >= raw.length) {
        lastTypeInputLenRef.current = raw.length;
        onUpdate(dimension.id, { dimensionType: match });
        const inputEl = e.target;
        const start = raw.length;
        const end = match.length;
        window.requestAnimationFrame(() => {
          if (document.activeElement === inputEl) {
            inputEl.setSelectionRange(start, end);
          }
        });
        return;
      }
    }

    lastTypeInputLenRef.current = raw.length;
    onUpdate(dimension.id, { dimensionType: raw });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      tryConfirm();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-neutral-600 bg-neutral-900 p-3 shadow-lg"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-neutral-100">
          {dimension.name.trim() ? `ID: ${dimension.name.trim()}` : "New Dimension"}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onStartPlacing(dimension.id)}
            title="Drag on drawing to select or redraw region"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              isPlacing
                ? "bg-blue-600 text-white"
                : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
            }`}
          >
            <Crosshair className="h-3 w-3" />
            {dimension.marker ? "Redraw" : "Mark Area"}
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
        <div className="grid grid-cols-[92px_1fr] gap-1.5">
          <div>
            <label className="mb-1 block text-[11px] text-neutral-400">
              Type
            </label>
            <input
              ref={typeInputRef}
              type="text"
              value={dimension.dimensionType ?? ""}
              placeholder="e.g. CTQ"
              onChange={handleTypeChange}
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
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

        {idError && (
          <p className="text-[11px] text-rose-400">{idError}</p>
        )}

        <div className="grid grid-cols-3 gap-1.5">
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
            Notes
          </label>
          <input
            type="text"
            value={dimension.notes}
            placeholder="Inspection notes, GD&T reference..."
            onChange={(e) => onUpdate(dimension.id, { notes: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
          />
        </div>
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
            title="Confirm (Enter)"
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
  typeHistory,
  selectedDimensionId,
  editingDimensionId,
  placingDimensionId,
  focusNameKey,
  hasProject,
  onAddDimension,
  onSelectDimension,
  onStartEditing,
  onFinishEditing,
  onCancelEditing,
  onUpdateDimension,
  onDeleteDimension,
  onStartPlacing,
  onClearMarker,
}: DimensionSidebarProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Dimensions
          </h2>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
            {dimensions.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!hasProject ? (
          <div className="px-3 py-8 text-center text-xs text-neutral-500">
            Open a PDF drawing or project to manage dimensions.
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={onAddDimension}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-700 bg-neutral-900/70 px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Dimension
            </button>

            {dimensions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">
                No dimensions yet. Click{" "}
                <span className="font-medium text-neutral-300">
                  Add Dimension
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
                          typeHistory={typeHistory}
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

                  const tol = formatTolerance(dim.upperTol, dim.lowerTol);

                  return (
                    <li key={dim.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectDimension(dim.id)}
                        onDoubleClick={() => onStartEditing(dim.id)}
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
                          <div className="flex items-center gap-1.5">
                            {dim.dimensionType?.trim() && (
                              <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-[1px] font-mono text-[10px] font-medium text-neutral-300 ring-1 ring-neutral-700/80">
                                {dim.dimensionType.trim()}
                              </span>
                            )}
                            <span className="truncate font-mono text-xs font-semibold text-neutral-100">
                              {dim.name.trim() || "—"}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400">
                            {dim.nominal.trim() ? (
                              <span className="font-mono text-neutral-300">
                                {dim.nominal.trim()}
                                {tol ? ` ${tol}` : ""} {dim.unit}
                              </span>
                            ) : (
                              <span className="italic text-neutral-500">
                                No nominal
                              </span>
                            )}

                            {isPlacing ? (
                              <span className="text-blue-400">Marking…</span>
                            ) : dim.marker ? (
                              <span className="inline-flex items-center gap-0.5 text-emerald-400">
                                <MapPin className="h-3 w-3" />P
                                {dim.marker.page}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-amber-400/90">
                                <MapPinOff className="h-3 w-3" />
                                Unmarked
                              </span>
                            )}
                          </div>
                          {dim.notes.trim() && (
                            <div className="mt-1 line-clamp-1 text-[11px] text-neutral-500">
                              {dim.notes.trim()}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            aria-label={`Edit dimension ${dim.name || dim.id}`}
                            title="Edit dimension"
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
                            aria-label={`Delete dimension ${dim.name || dim.id}`}
                            title="Delete dimension"
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
    </div>
  );
}
