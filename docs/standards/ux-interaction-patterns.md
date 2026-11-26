# Q-One UX & Interaction Patterns

This document defines the behavioral and interaction contracts for **Q-One** across all modules.

---

## 1. Module & Active-Entity Mental Model

- **Upstream-to-Downstream Flow**: `Project` owns the BOM part hierarchy and the **Active Part** (`activePartId`). Downstream modules (`Drawing`, and future quality modules) operate on the active part's artifacts.
- **Actionable Empty States**: Whenever a module lacks required upstream context (no open project, no active part, no attached PDF), render an `<EmptyState />` that explains *what* is missing and provides a direct 1-click CTA (e.g., `Attach PDF`, `Go to Project`). Never leave a blank dark panel.

---

## 2. Inline Editing Lifecycle

Applies to in-place editors such as `InPlacePartEditor` and `InlineEditCard`:
1. **Auto-Open & Focus**: Newly created entities open immediately in edit mode and focus their primary input.
2. **Confirm & Cancel**:
   - Confirm: `⌘/Ctrl+Enter` or explicit `Done` button (`<Button variant="primary">`).
   - Cancel: `Esc` or explicit cancel button — deletes a newly created uncommitted item, or restores the pre-edit snapshot for an existing item.
3. **Mandatory IME Guard**: Every `keydown` handler inspecting `Enter`, `Escape`, `Tab`, or single-key shortcuts MUST return early when `e.nativeEvent.isComposing` (or `e.isComposing` on native `KeyboardEvent`) is `true`.

---

## 3. Keyboard Shortcuts Hygiene

- Single-letter shortcuts (e.g., `N` new annotation, `C` hand tool, `V` text selection tool) MUST ignore events when:
  - `e.metaKey || e.ctrlKey || e.altKey` is pressed,
  - IME composition is active (`e.isComposing`), or
  - Focus is inside `INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable`.
- Keep shortcut resolution pure and testable in `src/lib/*` (see `resolveViewerToolShortcut` in `src/lib/viewerState.ts`).
- Every shortcut must be hinted visually in `font-mono` (e.g., `⌘/Ctrl+S`, `C`, `V`) and documented in the control's `title` and `aria-label`.

---

## 4. Pointer-Based Drag & Drop (Tauri WebView Contract)

Native HTML5 Drag-and-Drop (`draggable`, `onDragStart`) is unreliable inside Tauri WebView and is **forbidden** for in-app canvas manipulation and list reordering.
- Use Pointer Events (`onPointerDown` + window `pointermove`/`pointerup`/`pointercancel` or `setPointerCapture`).
- Require a drag activation threshold (`>= 4–6px` Euclidean distance) before entering active drag state so clicks remain crisp.
- Render a clear visual drop indicator (`blue-400`/`blue-500` line or target highlight).
- Suppress the trailing synthetic `click` event after a completed drag (`suppressClickRef`).

---

## 5. Canvas & Viewport Controls

- **Pan**: Left-drag on empty canvas (or in Hand mode on PDFs) with `cursor-grab` / `cursor-grabbing` and `select-none`.
- **Zoom**: `⌘/Ctrl + Wheel` (with `{ passive: false }` and `e.preventDefault()`) plus a standardized `<ToolbarGroup>` containing Zoom Out, monospace `%` readout, Zoom In, and `Fit`.
- **Mode Passthrough**: When a secondary tool (such as PDF Text Selection) needs access to underlying content, pass pointer events through overlays rather than hiding visual markers.

---

## 6. Destructive Actions & Unsaved Changes

- **Unified Confirmation**: All destructive deletions and unsaved-changes discard prompts MUST call `confirmAction(message, { title, kind: "warning" })` from `src/lib/confirm.ts` (uses Tauri native dialog with `window.confirm` fallback).
- **Explicit Impact Copy**: Confirmation messages must quantify cascading impact (e.g., number of sub-parts, drawings, and dimensions that will be removed).
- **Dirty Tracking**: Any mutation to persisted `ProjectData` must call `markDirty()`. Unsaved state is shown by the amber dot beside the project name in `MenuBar` and guarded on project switch, close, and window close.
- **Calm Dense Lists**: Secondary destructive row actions (e.g., remove drawing) stay hidden until hover or keyboard focus (`opacity-0 group-hover:opacity-100 focus:opacity-100`).

---

## 7. Feedback, Mode Banners & Accessibility

- **Floating Status Toast**: Top-right fixed toast (`z-50`). `info` messages use emerald accent and auto-dismiss after `3.5s`; `error` messages use rose accent and persist until manually dismissed.
- **Persistent Mode Banners**: Interactive canvas modes (e.g., marker placement) show a `z-30` top banner explaining the gesture, hinting `Esc`, and offering a `Cancel` button.
- **Accessible Controls**: Every icon-only button requires `aria-label` (enforced by `<IconButton>`). Segmented controls use `role="group"` and `aria-pressed`; navigation items use `aria-current="page"`.
