# DM-One Project Module (BOM & Multi-Drawing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a far-left module Activity Bar (`Project` + `Drawing`), an interactive visual BOM node-tree `Project` workspace (parts, nested sub-parts, drag-to-reparent, per-part PDF attachments, right-side inspector drawer), and multi-drawing backward-compatible `.dmone` persistence.

**Architecture:** Pure TypeScript deterministic left-to-right tree layout (`partTree.ts`) drives an SVG cubic Bézier edge layer + interactive HTML Part cards with drag-to-reparent (with cycle prevention) and pan/zoom. Rust `AppState` upgrades to `HashMap<String, Vec<u8>>` to cache `0..N` PDFs per project and atomically write/read multi-drawing `.dmone` archives while remaining backward-compatible with Milestone 1 `.dmone` files.

**Tech Stack:** Tauri v2 (Rust `zip`, `serde`, `serde_json`, `uuid`, `tempfile`), React 19, TypeScript, Tailwind CSS v4, `lucide-react`, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-25-project-module-design.md](../specs/2026-11-25-project-module-design.md)

## Global Constraints
- English-only UI copy, pure neutral dark (`neutral-*`) theme.
- Zero third-party graph libraries; pure TS deterministic layout + SVG Bézier + HTML cards.
- 100% backward-compatible with Milestone 1 `.dmone` files (`schemaVersion: 1`, defaulted `parts[]` and `dimension.drawingId`).
- Per-drawing unique Dimension ID validation.

## Review Focus
1. Reparenting a part onto itself or a transitive descendant must be rejected (no cycles).
2. Opening a Milestone 1 `.dmone` (no `parts` array, no `dimension.drawingId`) must migrate cleanly in-memory without errors or dirtying the project.
3. Saving a project with `0` drawings (`New Project`) or `2+` drawings must round-trip cleanly and error clearly if a referenced drawing is missing from Rust cache.
4. Deleting a parent part must remove its entire descendant subtree, detach/remove all drawings belonging to that subtree, clean up their dimensions, and free their cached PDF bytes in Rust.
5. Switching drawings in `Drawing` must load the selected drawing's PDF bytes and filter dimensions/markers strictly to that drawing without bleeding markers across drawings.

---

### Task 1: Rust Multi-Drawing `.dmone` Engine & Commands
**Files:** `src-tauri/src/project.rs`, `src-tauri/src/lib.rs`
- Add `Part` struct, `#[serde(default)] parts: Vec<Part>` on `ProjectData`, `#[serde(default)] drawing_id: Option<String>` on `Dimension`.
- Upgrade `AppState` to `drawings: Mutex<HashMap<String, Vec<u8>>>`.
- Update `write_dmone_atomic` & `read_dmone` to handle `0..N` drawings via `&HashMap<String, Vec<u8>>`.
- Add `get_drawing_bytes`, `remove_drawing_bytes`, `clear_drawings`; update `import_pdf`, `save_project`, `open_project`.
- TDD: write tests for 0-drawing save/open, 2-drawing + parts hierarchy round-trip, Milestone 1 legacy `.dmone` read, and missing drawing bytes error.

### Task 2: Frontend BOM Tree Model, Pure Layout & Migration Helpers
**Files:** `src/types/project.ts`, `src/lib/partTree.ts`, `src/lib/tauriApi.ts`, `src/lib/dimensions.ts`, `src/lib/__tests__/partTree.test.ts`
- Add `Part`, `ActiveModule`, `Dimension.drawingId`, updated `OpenedProjectPayload` (`activeDrawingId`, `pdfBytes: Uint8Array | null`).
- Implement `createEmptyProject`, `createPart`, `canReparentPart`, `reparentPart`, `deletePartSubtree`, `layoutPartTree`, `normalizeLoadedProject`.
- Add `getDrawingBytes`, `removeDrawingBytes`, `clearDrawings` to `tauriApi.ts`.
- TDD: Vitest tests for cycle prevention, subtree deletion, multi-root deterministic layout + collapse, and Milestone 1 migration.

### Task 3: Far-Left Activity Bar, MenuBar Update & Visual BOM Project Workspace
**Files:** `src/components/ActivityBar.tsx`, `src/components/MenuBar.tsx`, `src/components/ProjectWorkspace.tsx`
- `ActivityBar`: `48px` far-left rail switching between `Project` and `Drawing`.
- `MenuBar`: add `New Project` to `File` menu.
- `ProjectWorkspace`: top bar (editable project name, `+ Add Part`, zoom/fit), pan/zoom SVG Bézier + HTML node tree canvas (cards with `+ Sub-part`, `+ PDF`, PDF chips, dim counts, collapse chevron, drag-to-reparent + root promotion drop zone), and right-side Part Inspector Drawer.

### Task 4: Multi-Drawing Integration in `PdfViewer` & `App.tsx` + Verification & Review
**Files:** `src/components/PdfViewer.tsx`, `src/App.tsx`
- Add compact Part/Drawing dropdown switcher to `PdfViewer`'s top bar.
- Wire full `Project` ↔ `Drawing` state, per-drawing filtered dimensions, `New Project`, attach/detach PDF, part CRUD, and drawing switching in `App.tsx`.
- Verify `npm test`, `npm run build`, `cargo test`, run whole-branch `pro` review, fix any Critical/Important findings, and relaunch `npm run tauri dev`.
