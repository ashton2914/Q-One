import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  DEFAULT_PDF_DISPLAY_SETTINGS,
  normalizePdfDisplaySettings,
  type PdfDisplaySettings,
} from "./pdfDisplay";
import type {
  ImportedPdfPayload,
  OpenedProjectPayload,
  ProjectData,
} from "../types/project";

export interface AppSettings {
  pdfDisplay: PdfDisplaySettings;
}

const LOCAL_SETTINGS_STORAGE_KEY = "qone.appSettings.v1";

interface RawImportedPdfPayload {
  drawingId: string;
  filename: string;
  pdfBytes: number[];
}

interface RawOpenedProjectPayload {
  project: ProjectData;
  activeDrawingId: string | null;
  pdfBytes: number[] | null;
}

export async function pickPdfFile(): Promise<string | null> {
  const selected = await open({
    title: "Open PDF Drawing",
    multiple: false,
    directory: false,
    filters: [{ name: "PDF Drawing", extensions: ["pdf"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickOpenProjectFile(): Promise<string | null> {
  const selected = await open({
    title: "Open Q-One Project",
    multiple: false,
    directory: false,
    filters: [{ name: "Q-One Project", extensions: ["qone"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickSaveProjectFile(
  defaultName: string,
): Promise<string | null> {
  const safeBase = defaultName.trim() || "project";
  const defaultPath = safeBase.toLowerCase().endsWith(".qone")
    ? safeBase
    : `${safeBase}.qone`;
  const selected = await save({
    title: "Save Q-One Project",
    defaultPath,
    filters: [{ name: "Q-One Project", extensions: ["qone"] }],
  });
  if (!selected) return null;
  return selected.toLowerCase().endsWith(".qone")
    ? selected
    : `${selected}.qone`;
}

export async function importPdf(path: string): Promise<ImportedPdfPayload> {
  const raw = await invoke<RawImportedPdfPayload>("import_pdf", { path });
  return {
    drawingId: raw.drawingId,
    filename: raw.filename,
    pdfBytes: new Uint8Array(raw.pdfBytes),
  };
}

export async function getDrawingBytes(drawingId: string): Promise<Uint8Array> {
  const raw = await invoke<number[]>("get_drawing_bytes", { drawingId });
  return new Uint8Array(raw);
}

export async function removeDrawingBytes(drawingId: string): Promise<void> {
  await invoke<void>("remove_drawing_bytes", { drawingId });
}

export async function clearDrawings(): Promise<void> {
  await invoke<void>("clear_drawings");
}

export async function saveProject(
  path: string,
  project: ProjectData,
): Promise<void> {
  await invoke<void>("save_project", { path, project });
}

export async function openProject(path: string): Promise<OpenedProjectPayload> {
  const raw = await invoke<RawOpenedProjectPayload>("open_project", { path });
  return {
    project: raw.project,
    activeDrawingId: raw.activeDrawingId,
    pdfBytes: raw.pdfBytes ? new Uint8Array(raw.pdfBytes) : null,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const raw = await invoke<Partial<AppSettings>>("load_app_settings");
    return {
      pdfDisplay: normalizePdfDisplaySettings(raw?.pdfDisplay),
    };
  } catch {
    try {
      const stored = window.localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        return {
          pdfDisplay: normalizePdfDisplaySettings(parsed?.pdfDisplay),
        };
      }
    } catch {
      // Ignore storage failures
    }
    return { pdfDisplay: { ...DEFAULT_PDF_DISPLAY_SETTINGS } };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const normalized: AppSettings = {
    pdfDisplay: normalizePdfDisplaySettings(settings.pdfDisplay),
  };
  try {
    await invoke<void>("save_app_settings", { settings: normalized });
  } catch {
    try {
      window.localStorage.setItem(
        LOCAL_SETTINGS_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      // Ignore storage failures outside Tauri
    }
  }
}
