import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { confirmAction } from "../confirm";

describe("confirmAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("delegates to Tauri confirm dialog with default warning kind", async () => {
    vi.mocked(tauriConfirm).mockResolvedValue(true);
    const result = await confirmAction("Delete part?", { title: "Delete Part" });
    expect(result).toBe(true);
    expect(tauriConfirm).toHaveBeenCalledWith("Delete part?", {
      title: "Delete Part",
      kind: "warning",
    });
  });

  it("forwards explicit kind and returns false when user cancels", async () => {
    vi.mocked(tauriConfirm).mockResolvedValue(false);
    const result = await confirmAction("Discard?", {
      title: "Unsaved Changes",
      kind: "info",
    });
    expect(result).toBe(false);
    expect(tauriConfirm).toHaveBeenCalledWith("Discard?", {
      title: "Unsaved Changes",
      kind: "info",
    });
  });

  it("falls back to window.confirm when Tauri dialog throws", async () => {
    vi.mocked(tauriConfirm).mockRejectedValue(new Error("not in tauri"));
    const winConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("window", { confirm: winConfirm });

    const result = await confirmAction("Discard unsaved changes?");
    expect(result).toBe(true);
    expect(winConfirm).toHaveBeenCalledWith("Discard unsaved changes?");
  });

  it("returns false safely when both Tauri dialog and window.confirm are unavailable", async () => {
    vi.mocked(tauriConfirm).mockRejectedValue(new Error("not in tauri"));
    vi.stubGlobal("window", undefined);

    const result = await confirmAction("Proceed?");
    expect(result).toBe(false);
  });
});
