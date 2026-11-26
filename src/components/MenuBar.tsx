import { useEffect, useRef, useState } from "react";
import {
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Save,
  SaveAll,
  XCircle,
} from "lucide-react";

export interface MenuBarProps {
  projectName: string | null;
  isDirty: boolean;
  hasProject: boolean;
  onNewProject: () => void;
  onOpenPdf: () => void;
  onOpenProject: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseProject: () => void;
}

export function MenuBar({
  projectName,
  isDirty,
  hasProject,
  onNewProject,
  onOpenPdf,
  onOpenProject,
  onSave,
  onSaveAs,
  onCloseProject,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<"file" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const runAction = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <header className="relative z-40 flex h-9 shrink-0 select-none items-center justify-between border-b border-neutral-800 bg-neutral-950 px-2.5 text-xs text-neutral-200">
      <div className="flex items-center gap-1" ref={menuRef}>
        <div className="mr-2 flex items-center gap-2 border-r border-neutral-800 pr-3">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-neutral-800 text-[10px] font-bold text-neutral-100 ring-1 ring-neutral-700">
            Q1
          </div>
          <span className="font-semibold tracking-tight text-neutral-100">
            Q-One
          </span>
        </div>

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "file"}
            onClick={() => setOpenMenu((m) => (m === "file" ? null : "file"))}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              openMenu === "file"
                ? "bg-neutral-800 text-white"
                : "text-neutral-300 hover:bg-neutral-800/80 hover:text-white"
            }`}
          >
            File
          </button>

          {openMenu === "file" && (
            <div
              role="menu"
              className="absolute left-0 top-full mt-1 w-56 rounded-md border border-neutral-700/90 bg-neutral-900 py-1 shadow-2xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => runAction(onNewProject)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <FolderPlus className="h-3.5 w-3.5 text-neutral-400" />
                  New Project
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => runAction(onOpenPdf)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <FilePlus2 className="h-3.5 w-3.5 text-neutral-400" />
                  Open PDF Drawing…
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => runAction(onOpenProject)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <FolderOpen className="h-3.5 w-3.5 text-neutral-400" />
                  Open Project…
                </span>
              </button>

              <div className="my-1 border-t border-neutral-800" />

              <button
                type="button"
                role="menuitem"
                disabled={!hasProject}
                onClick={() => runAction(onSave)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
              >
                <span className="inline-flex items-center gap-2">
                  <Save className="h-3.5 w-3.5 text-neutral-400" />
                  Save
                </span>
                <span className="font-mono text-[10px] text-neutral-500">
                  ⌘/Ctrl+S
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={!hasProject}
                onClick={() => runAction(onSaveAs)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
              >
                <span className="inline-flex items-center gap-2">
                  <SaveAll className="h-3.5 w-3.5 text-neutral-400" />
                  Save As…
                </span>
              </button>

              <div className="my-1 border-t border-neutral-800" />

              <button
                type="button"
                role="menuitem"
                disabled={!hasProject}
                onClick={() => runAction(onCloseProject)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
              >
                <span className="inline-flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 text-neutral-400" />
                  Close Project
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-sm truncate text-xs text-neutral-400">
        {projectName ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="truncate font-medium text-neutral-200">
              {projectName}
            </span>
            {isDirty && (
              <span
                title="Unsaved changes"
                className="h-2 w-2 rounded-full bg-amber-400"
              />
            )}
          </span>
        ) : (
          <span>No project open</span>
        )}
      </div>
    </header>
  );
}
