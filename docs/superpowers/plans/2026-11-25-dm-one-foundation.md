# DM-One Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cross-platform Tauri v2 foundation of DM-One: an English-UI desktop app that opens a PDF drawing, manages dimensions in a left sidebar, marks each dimension's location with a draggable numbered balloon pin on the PDF, and persists everything into a self-contained `.dmone` ZIP project file.

**Architecture:** React + TypeScript + Vite + Tailwind frontend renders PDF pages to `<canvas>` via `pdfjs-dist` (bundled offline worker) with an aligned SVG/HTML balloon overlay using normalized `[0, 1]` page coordinates. The Tauri v2 Rust backend manages native file dialogs (`tauri-plugin-dialog`), caches the active drawing's raw PDF bytes in managed state (`AppState`), and performs atomic ZIP read/write of `.dmone` archives (`project.json` + `drawings/<drawing-id>.pdf`).

**Tech Stack:** Tauri v2 (Rust `zip`, `serde`, `serde_json`, `uuid`, `tauri-plugin-dialog`), React 19, TypeScript, Vite, Tailwind CSS v4, `pdfjs-dist`, `lucide-react`, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-25-dm-one-foundation-design.md](../specs/2026-11-25-dm-one-foundation-design.md)

## Global Constraints

- Cross-platform desktop via **Tauri v2** (macOS, Windows, Linux); zero native C++ PDFium dependencies.
- **English-only** UI copy across all labels, buttons, placeholders, dialogs, and empty states.
- Self-contained single-file project format (`.dmone`, standard ZIP containing `project.json` with `schemaVersion: 1` and `drawings/<drawing-id>.pdf` stored uncompressed).
- Normalized `[0.0, 1.0]` top-left PDF page coordinates (`marker: { drawingId, page, x, y } | null`, 1-based `page`).
- `nominal`, `upperTol`, `lowerTol` stored as strings to preserve exact engineering precision (e.g. `10.00`).
- Atomic `.dmone` save (write sibling temp file then replace destination).

## Review Focus

1. **Invalid or empty PDF file** passed to `import_pdf` → rejected cleanly with a descriptive error before mutating `AppState` (pinned in Task 2).
2. **Corrupt `.dmone`, unsupported `schemaVersion`, missing drawing entry, or unsafe `archivePath` (e.g. `../`)** → `read_dmone` rejects cleanly without panicking or mutating `AppState` (pinned in Task 2).
3. **Overwriting an existing `.dmone` file** → atomic temp-file replacement succeeds, preserves exact PDF bytes, and leaves no stray `.tmp` file behind (pinned in Task 2).
4. **Pointer click/drag outside PDF canvas bounds or against a zero-width/height rect** → `clientPointToNormalized` clamps strictly to `[0, 1]` and never returns `NaN`/`Infinity` (pinned in Task 3).
5. **Deleting a middle dimension (`#2` out of `#1, #2, #3`) then adding a new dimension** → `nextBalloonNumber` returns `4` (`max + 1`), never colliding with existing balloon numbers (pinned in Task 3).

---

### Task 1: Project Scaffolding (Tauri v2 + React/TS/Vite + Tailwind + Vitest)

**Files:**
- Create: `.gitignore`
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/index.css`, `src/App.tsx`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Create: `src-tauri/icons/icon.png` (and `32x32.png`, `128x128.png`, `icon.ico`, `icon.icns` generated via Tauri CLI or valid PNG assets)

**Interfaces:**
- Produces: Buildable Vite + React + TypeScript + Tailwind v4 + Vitest frontend (`npm run build`, `npm test`) and compilable Tauri v2 Rust crate (`cargo check --manifest-path src-tauri/Cargo.toml`) with `tauri-plugin-dialog`, `zip`, `serde`, `serde_json`, `uuid` dependencies installed.

- [ ] **Step 1: Create root config, frontend entry files, and Tauri v2 backend scaffold**
  - Configure `package.json` with scripts `dev`, `build`, `test` (`vitest run`), `tauri` (`tauri`), and dependencies `react`, `react-dom`, `pdfjs-dist`, `lucide-react`, `@tauri-apps/api`, `@tauri-apps/plugin-dialog`; devDependencies `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@tauri-apps/cli`, `vitest`, `@types/react`, `@types/react-dom`.
  - Configure `src-tauri/Cargo.toml` with `tauri = "2"`, `tauri-plugin-dialog = "2"`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `zip = { version = "2", default-features = false, features = ["deflate"] }`, `uuid = { version = "1", features = ["v4"] }`, `tempfile = "3"` (dev-dependency).
  - Configure `src-tauri/tauri.conf.json` (`productName: "DM-One"`, `identifier: "com.dmone.app"`, window `title: "DM-One — Dimension Manager"`, `width: 1280`, `height: 820`, `minWidth: 960`, `minHeight: 640`).
  - Configure `src-tauri/capabilities/default.json` granting `core:default` and `dialog:default`.
  - Generate valid app icons in `src-tauri/icons/` so Tauri builds cleanly on macOS/Windows/Linux.

- [ ] **Step 2: Install npm dependencies and verify both frontend and Rust toolchains compile**
  - Run: `npm install && npm run build && cargo check --manifest-path src-tauri/Cargo.toml`
  - Expected: Exit 0, `dist/` built cleanly, Rust crate compiles with zero errors.

- [ ] **Step 3: Commit scaffold and approved design doc**
  - Run: `git add .gitignore docs/ package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html src/ src-tauri/ && git commit -m "chore: scaffold Tauri v2 + React/TS project and add foundation spec"`

---

### Task 2: Rust `.dmone` Archive Engine & Tauri Commands

**Files:**
- Create: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces (Rust):
  - Structs (serde `#[serde(rename_all = "camelCase")]`): `ProjectData`, `DrawingEntry`, `Dimension`, `MarkerPosition`, `CachedDrawing`, `AppState`, `ImportedPdfPayload`, `OpenedProjectPayload`.
  - Functions:
    - `validate_pdf_bytes(bytes: &[u8]) -> Result<(), String>`
    - `write_dmone_atomic(path: &Path, project: &ProjectData, pdf_bytes: &[u8]) -> Result<(), String>`
    - `read_dmone(path: &Path) -> Result<(ProjectData, Vec<u8>), String>`
  - Tauri commands registered in `lib.rs`:
    - `import_pdf(path: String, state: tauri::State<'_, AppState>) -> Result<ImportedPdfPayload, String>`
    - `save_project(path: String, project: ProjectData, state: tauri::State<'_, AppState>) -> Result<(), String>`
    - `open_project(path: String, state: tauri::State<'_, AppState>) -> Result<OpenedProjectPayload, String>`

- [ ] **Step 1: Write failing Rust unit tests in `src-tauri/src/project.rs`**
  - `test_validate_pdf_bytes_accepts_valid_header_and_rejects_invalid`: accepts `b"%PDF-1.7\n..."`, rejects empty `&[]` and `b"not a pdf"`.
  - `test_dmone_round_trip_preserves_project_and_pdf_bytes`: writes a `ProjectData` with 2 dimensions (one with marker, one `marker: None`) and sample PDF bytes, reads it back, asserts exact equality on all fields and raw PDF bytes.
  - `test_atomic_save_overwrites_existing_and_leaves_no_temp_files`: saves twice to the same `.dmone` path with updated dimensions, verifies updated data on read and checks parent directory contains only the `.dmone` file (no `.tmp` files).
  - `test_read_dmone_rejects_corrupt_zip_missing_entries_bad_version_and_unsafe_path`: verifies descriptive `Err` for (a) non-ZIP bytes, (b) ZIP missing `project.json`, (c) ZIP with `schemaVersion: 99`, (d) ZIP with empty `drawings: []`, (e) ZIP with `archivePath: "../evil.pdf"` or missing drawing file.

- [ ] **Step 2: Run tests to verify they fail**
  - Run: `cargo test --manifest-path src-tauri/Cargo.toml`
  - Expected: FAIL (functions unimplemented).

- [ ] **Step 3: Implement `src-tauri/src/project.rs` and wire commands in `src-tauri/src/lib.rs`**
  - `write_dmone_atomic`: validate `project.schema_version == 1`, `project.drawings.len() == 1`, safe `archive_path` (starts with `drawings/`, no `..`), write `project.json` (Deflate) + `drawings/<id>.pdf` (Stored) into a sibling temp file in the same directory, flush/sync, then `std::fs::rename` (with clean replacement on Windows if destination exists).
  - `read_dmone`: open ZIP, parse `project.json`, validate `schema_version == 1`, non-empty `drawings`, safe `archive_path`, extract `drawings[0].archive_path`, validate `%PDF-` header.
  - Wire `AppState` (`Mutex<Option<CachedDrawing>>`), `tauri_plugin_dialog::init()`, and `tauri::generate_handler![import_pdf, save_project, open_project]` in `lib.rs`.

- [ ] **Step 4: Run Rust tests to verify all pass**
  - Run: `cargo test --manifest-path src-tauri/Cargo.toml`
  - Expected: All tests PASS, zero compiler warnings.

- [ ] **Step 5: Commit**
  - Run: `git add src-tauri/src/project.rs src-tauri/src/lib.rs && git commit -m "feat(backend): add .dmone ZIP archive engine and Tauri commands"`

---

### Task 3: Frontend Domain Types, Pure Helpers & Tauri API Bridge

**Files:**
- Create: `src/types/project.ts`
- Create: `src/lib/coordinates.ts`
- Create: `src/lib/dimensions.ts`
- Create: `src/lib/tauriApi.ts`
- Test: `src/lib/__tests__/coordinates.test.ts`
- Test: `src/lib/__tests__/dimensions.test.ts`

**Interfaces:**
- Consumes: Tauri commands `import_pdf`, `save_project`, `open_project` (Task 2).
- Produces:
  - `src/types/project.ts`: `DimensionUnit`, `MarkerPosition`, `Dimension`, `DrawingEntry`, `ProjectData`, `ImportedPdfPayload`, `OpenedProjectPayload`.
  - `src/lib/coordinates.ts`:
    - `clamp01(value: number): number`
    - `clientPointToNormalized(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null`
    - `normalizedToPixel(x: number, y: number, width: number, height: number): { px: number; py: number }`
  - `src/lib/dimensions.ts`:
    - `nextBalloonNumber(dimensions: readonly Dimension[]): number`
    - `createDimension(existing: readonly Dimension[]): Dimension`
    - `formatTolerance(upperTol: string, lowerTol: string): string`
    - `createProjectFromPdf(drawingId: string, filename: string, pageCount: number): ProjectData`
  - `src/lib/tauriApi.ts`:
    - `pickPdfFile(): Promise<string | null>`
    - `pickOpenProjectFile(): Promise<string | null>`
    - `pickSaveProjectFile(defaultName: string): Promise<string | null>`
    - `importPdf(path: string): Promise<ImportedPdfPayload>`
    - `saveProject(path: string, project: ProjectData): Promise<void>`
    - `openProject(path: string): Promise<OpenedProjectPayload>`

- [ ] **Step 1: Write failing Vitest unit tests**
  - `src/lib/__tests__/coordinates.test.ts`:
    - `clamp01` clamps `< 0` to `0`, `> 1` to `1`, keeps `[0, 1]` values, handles `NaN` → `0`.
    - `clientPointToNormalized` maps center/corners accurately, clamps out-of-bounds drag points to `[0, 1]`, returns `null` when `width <= 0` or `height <= 0`.
    - `normalizedToPixel` round-trips with `clientPointToNormalized` at `1.0x` and `2.5x` zoom scales.
  - `src/lib/__tests__/dimensions.test.ts`:
    - `nextBalloonNumber([]) === 1`; `nextBalloonNumber([#1, #3]) === 4` (after `#2` deleted).
    - `createDimension` assigns UUID `id`, `balloonNumber`, default `unit: "mm"`, `marker: null`.
    - `formatTolerance("+0.05", "-0.05") === "±0.05"`, `formatTolerance("+0.05", "-0.02") === "+0.05 / -0.02"`, `formatTolerance("", "") === ""`.
    - `createProjectFromPdf` sets `schemaVersion: 1`, derives project `name` by stripping `.pdf`, sets `drawings[0].archivePath = "drawings/<id>.pdf"`.

- [ ] **Step 2: Run Vitest to verify tests fail**
  - Run: `npm test`
  - Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/types/project.ts`, `src/lib/coordinates.ts`, `src/lib/dimensions.ts`, and `src/lib/tauriApi.ts`**
  - Match Rust `serde` camelCase field names verbatim.
  - Ensure `tauriApi.ts` converts incoming `number[]` / `Uint8Array` PDF bytes cleanly to `Uint8Array` for `pdfjs-dist`.

- [ ] **Step 4: Run Vitest to verify all pass**
  - Run: `npm test`
  - Expected: All tests PASS.

- [ ] **Step 5: Commit**
  - Run: `git add src/types/ src/lib/ && git commit -m "feat(frontend): add project types, coordinate/dimension helpers, and Tauri API bridge"`

---

### Task 4: PDF Viewer & Interactive Balloon Overlay

**Files:**
- Create: `src/components/PdfViewer.tsx`
- Create: `src/components/BalloonOverlay.tsx`

**Interfaces:**
- Consumes: `Dimension`, `MarkerPosition` (`src/types/project.ts`), `clientPointToNormalized`, `normalizedToPixel` (`src/lib/coordinates.ts`).
- Produces:
  - `BalloonOverlayProps`: `dimensions`, `currentPage`, `drawingId`, `width`, `height`, `selectedDimensionId`, `placingDimensionId`, `onPlaceMarker(dimensionId, marker)`, `onSelectDimension(dimensionId)`, `onMoveMarker(dimensionId, x, y)`.
  - `PdfViewerProps`: `pdfBytes: Uint8Array | null`, `drawingId: string | null`, `currentPage: number`, `zoom: number`, `dimensions: Dimension[]`, `selectedDimensionId: string | null`, `placingDimensionId: string | null`, `onPageCountLoaded(count: number)`, `onPlaceMarker(...)`, `onSelectDimension(...)`, `onMoveMarker(...)`, `onCancelPlacing()`.

- [ ] **Step 1: Implement `src/components/BalloonOverlay.tsx`**
  - Renders an absolutely positioned layer matching the rendered PDF canvas's CSS `width` and `height`.
  - When `placingDimensionId` is active, sets `cursor: crosshair` and clicking anywhere converts the pointer event via `clientPointToNormalized` and invokes `onPlaceMarker(placingDimensionId, { drawingId, page: currentPage, x, y })`.
  - Renders numbered circular balloon pins for every dimension whose `marker?.page === currentPage`. Selected pin gets high-contrast accent ring and elevated `z-index`.
  - Supports pointer drag-to-reposition (`setPointerCapture`) with a 4px movement threshold so normal clicks trigger `onSelectDimension` without accidental micro-drags.

- [ ] **Step 2: Implement `src/components/PdfViewer.tsx`**
  - Configure `pdfjs-dist` worker via Vite URL import (`import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; GlobalWorkerOptions.workerSrc = pdfWorkerUrl;`) so PDF rendering works completely offline in Tauri.
  - Load PDF document from a cloned `Uint8Array` copy (avoiding detached ArrayBuffer on re-renders), call `onPageCountLoaded(pdf.numPages)`.
  - Render `currentPage` to `<canvas>` at `zoom * window.devicePixelRatio` with CSS size set to viewport `width x height`, cancelling any in-flight render task cleanly on page/zoom change.
  - Show a non-intrusive top status banner when `placingDimensionId` is active: `"Click on the drawing to place Balloon #N (Press Esc to cancel)"`.
  - Support Ctrl/Cmd + mouse wheel zoom and scrollable canvas viewport.

- [ ] **Step 3: Verify TypeScript compilation and build**
  - Run: `npm run build`
  - Expected: Clean Vite + TypeScript build with zero errors.

- [ ] **Step 4: Commit**
  - Run: `git add src/components/PdfViewer.tsx src/components/BalloonOverlay.tsx && git commit -m "feat(viewer): add pdfjs-dist canvas viewer and interactive balloon overlay"`

---

### Task 5: Top Toolbar, Left Dimension Navigator, Dimension Editor & App Integration

**Files:**
- Create: `src/components/TopToolbar.tsx`
- Create: `src/components/DimensionSidebar.tsx`
- Create: `src/components/DimensionEditor.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `TopToolbar`, `DimensionSidebar`, `DimensionEditor`, `PdfViewer`, `tauriApi`, `dimensions.ts`, `project.ts`.
- Produces: Complete working English-UI DM-One desktop application wired end-to-end.

- [ ] **Step 1: Implement `src/components/TopToolbar.tsx`**
  - English controls: **Open PDF**, **Open Project**, **Save**, **Save As**, project title + unsaved dot (`*`), page navigation (`Prev` / `Page X / Y` / `Next`), zoom controls (`-`, `100%`, `+`, `Fit`).
  - Disable Save/Save As/Page/Zoom when no drawing is loaded.

- [ ] **Step 2: Implement `src/components/DimensionSidebar.tsx` and `src/components/DimensionEditor.tsx`**
  - `DimensionSidebar`: Header `"Dimensions"` with count badge and **`+ Add`** button (disabled when no PDF is loaded). Scrollable list showing each dimension's `#N` balloon badge, name (fallback `"Untitled Dimension"`), nominal + formatted tolerance + unit, placement badge (`P1` if placed, `"Unplaced"` if not), and delete button.
  - `DimensionEditor`: Bottom panel in the left sidebar for the selected dimension: editable `Name`, `Nominal`, `+Tol`, `-Tol`, `Unit` (`mm` / `in` / `deg`), `Notes`, and a **`Place Pin`** / **`Reposition Pin`** button (plus `Clear Pin` when placed).

- [ ] **Step 3: Wire full application state and flows in `src/App.tsx`**
  - Empty state with prominent **Open PDF Drawing** and **Open Project (.dmone)** buttons.
  - Dirty-state tracking (`isDirty`) with native/modal confirmation before discarding unsaved changes on Open PDF or Open Project.
  - Bidirectional selection: selecting a dimension in the sidebar jumps `currentPage` to `marker.page` if placed; clicking a balloon selects the dimension in the sidebar.
  - Adding a dimension auto-selects it and immediately activates `placingDimensionId` so the user can click directly on the PDF to mark its position.
  - Global keyboard shortcuts: `Escape` cancels placement mode; `Cmd/Ctrl+S` triggers Save.
  - Non-blocking status/error banner for save confirmations (`"Project saved"`) and clear error feedback.

- [ ] **Step 4: Run full verification suite (unit tests + build + Cargo tests)**
  - Run: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml`
  - Expected: All Vitest tests PASS, production Vite bundle builds cleanly, all Rust tests PASS.

- [ ] **Step 5: Live Tauri dev smoke verification**
  - Launch `npm run tauri dev` and verify the native macOS desktop window opens cleanly with zero runtime/console errors.

- [ ] **Step 6: Commit**
  - Run: `git add src/components/TopToolbar.tsx src/components/DimensionSidebar.tsx src/components/DimensionEditor.tsx src/App.tsx && git commit -m "feat(app): integrate dimension navigator, editor, toolbar, and .dmone persistence"`
