import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";

export interface ConfirmActionOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
}

export async function confirmAction(
  message: string,
  options?: ConfirmActionOptions,
): Promise<boolean> {
  try {
    return await tauriConfirm(message, {
      title: options?.title,
      kind: options?.kind ?? "warning",
    });
  } catch {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(message);
    }
    return false;
  }
}
