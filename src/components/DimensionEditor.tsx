import { Crosshair, MapPinOff } from "lucide-react";
import type { Dimension, DimensionUnit } from "../types/project";

export interface DimensionEditorProps {
  dimension: Dimension | null;
  isPlacing: boolean;
  onUpdate: (id: string, patch: Partial<Dimension>) => void;
  onStartPlacing: (id: string) => void;
  onClearMarker: (id: string) => void;
}

const UNITS: DimensionUnit[] = ["mm", "in", "deg"];

export function DimensionEditor({
  dimension,
  isPlacing,
  onUpdate,
  onStartPlacing,
  onClearMarker,
}: DimensionEditorProps) {
  if (!dimension) {
    return (
      <div className="border-t border-slate-800 bg-slate-950/90 p-3 text-xs text-slate-500">
        Select a dimension to edit its specification or reposition its pin.
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-slate-800 bg-slate-950 p-3 text-xs">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
            {dimension.balloonNumber}
          </span>
          <span className="font-semibold text-slate-200">
            Dimension #{dimension.balloonNumber}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onStartPlacing(dimension.id)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
              isPlacing
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
          >
            <Crosshair className="h-3 w-3" />
            {dimension.marker ? "Reposition Pin" : "Place Pin"}
          </button>

          {dimension.marker && (
            <button
              type="button"
              title="Clear marker from drawing"
              onClick={() => onClearMarker(dimension.id)}
              className="rounded bg-slate-800 p-1 text-slate-400 hover:bg-slate-700 hover:text-amber-300"
            >
              <MapPinOff className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Name</label>
          <input
            type="text"
            value={dimension.name}
            placeholder="e.g. Outer Diameter"
            onChange={(e) => onUpdate(dimension.id, { name: e.target.value })}
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="mb-1 block text-[11px] text-slate-400">
              Nominal
            </label>
            <input
              type="text"
              value={dimension.nominal}
              placeholder="25.00"
              onChange={(e) =>
                onUpdate(dimension.id, { nominal: e.target.value })
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Unit</label>
            <select
              value={dimension.unit}
              onChange={(e) =>
                onUpdate(dimension.id, {
                  unit: e.target.value as DimensionUnit,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">+Tol</label>
            <input
              type="text"
              value={dimension.upperTol}
              placeholder="+0.05"
              onChange={(e) =>
                onUpdate(dimension.id, { upperTol: e.target.value })
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">-Tol</label>
            <input
              type="text"
              value={dimension.lowerTol}
              placeholder="-0.05"
              onChange={(e) =>
                onUpdate(dimension.id, { lowerTol: e.target.value })
              }
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Notes</label>
          <textarea
            rows={2}
            value={dimension.notes}
            placeholder="Inspection notes, GD&T reference..."
            onChange={(e) => onUpdate(dimension.id, { notes: e.target.value })}
            className="w-full resize-none rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
