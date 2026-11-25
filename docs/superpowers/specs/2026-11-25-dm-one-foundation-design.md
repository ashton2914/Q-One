# DM-One Foundation Design Specification

**Date:** 2026-11-25
**Status:** Draft (pending review & user approval)

## 1. Intent & Why

DM-One is a cross-platform desktop application dedicated to manufacturing and quality **Dimension Management**. The end-to-end engineering lifecycle it is designed to support is:

> Receive Drawing → Compile Dimension List → Design Metrology → GRR → FAI → Cpk → SPC → Yield

This first milestone establishes the upstream foundation: **Receive Drawing → Compile Dimension List**. Engineers can open a PDF engineering drawing, build a structured list of dimensions in a left-hand navigator, mark each dimension's location directly on the PDF drawing, and persist everything into a single portable local project file (`.dmone`) that can be reopened or shared across macOS, Windows, and Linux.

Because every downstream quality module (Metrology, GRR, FAI, Cpk, SPC, Yield) will anchor to dimensions created here, the foundation keeps the UI minimal while establishing stable dimension IDs, versioned project metadata, and resolution-independent PDF coordinates from day one.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Launch a clean, responsive, **English-only** cross-platform desktop UI using **Tauri v2**.
- Load single-page and multi-page PDF drawings with zoom, pan, fit-to-view, and page navigation.
- Provide a left-hand **Dimension Navigator** to add, edit, select, and delete dimensions.
- Allow marking each dimension's position on the PDF drawing with a numbered balloon pin, supporting click-to-place, drag-to-reposition, and bidirectional selection/highlighting between the sidebar and the PDF canvas.
- Persist the entire project (drawing PDF + dimension list + marker coordinates + metadata) into a single self-contained `.dmone` local file, with Open, Save, and Save As workflows.

### Non-Goals (Out of Scope for Milestone 1)
- Automatic OCR / AI extraction of dimensions from PDF drawings.
- Downstream modules: Metrology planning, Gage R&R, FAI reports, Cpk/SPC charts, or Yield analytics.
- Multi-drawing / revision comparison within a single project (schema reserves a `drawings` array or `drawing` object with an ID so multi-drawing support can be added cleanly later, but Milestone 1 operates on one primary PDF per project).
- Cloud sync, multi-user collaboration, or PDF export with flattened annotations.

### Anti-Goals
- **Broken drawing links:** Storing only external filesystem paths to PDFs so projects break when moved or shared across OSes.
- **Pixel-locked coordinates:** Storing screen-pixel marker coordinates that drift when zoomed, resized, or opened on a different DPI monitor.
- **Native C++ build fragility:** Introducing platform-specific native PDF C++ binaries in Milestone 1 that complicate cross-platform compilation.

## 3. Constraints

- **Platform:** Cross-platform desktop (macOS, Windows, Linux) via **Tauri v2** (Rust backend + web frontend).
- **UI Language:** English across all labels, buttons, placeholders, dialogs, and empty states.
- **Project File Format:** Self-contained single file with `.dmone` extension.
- **Environment:** Local toolchain verified as Node v24.20, npm, Rust/Cargo 1.94.

## 4. Approaches Considered

### Approach 1 (Selected): Tauri v2 + React/TypeScript + `pdfjs-dist` + ZIP-based `.dmone`
- **How it works:** React + TypeScript + Vite + Tailwind frontend renders PDF pages to `<canvas>` via `pdfjs-dist` (with its Web Worker), overlaid with an interactive marker layer using normalized `(0..1, 0..1)` page coordinates. The Rust backend uses `tauri-plugin-dialog` for native file pickers and the `zip` crate to read/write `.dmone` archives (`project.json` + `drawing.pdf`) using atomic write-then-rename.
- **Tradeoffs:** Zero native C++ cross-compilation dependencies, human-inspectable ZIP archive, fast iteration, and React ecosystem readiness for future SPC/GRR charts. Rewrites the ZIP on save (tens of milliseconds for typical drawings).
- **Why selected:** Best balance of cross-platform reliability, maintainability, and future extensibility (additional files like SQLite/CSV for large SPC datasets can later live inside the same `.dmone` ZIP archive).

### Approach 2: Tauri v2 + React/TypeScript + `pdfjs-dist` + SQLite-based `.dmone`
- **How it works:** Same frontend, but `.dmone` is a single SQLite database storing the PDF as a BLOB and dimensions in relational tables via `rusqlite`.
- **Tradeoffs:** Supports incremental transactional writes for large future SPC datasets without rewriting PDF bytes, but adds early schema-migration overhead and makes files harder to inspect directly during early development.

### Approach 3: Tauri v2 + Rust PDFium (`pdfium-render`) + ZIP-based `.dmone`
- **How it works:** Rasterizes PDF pages in Rust using native PDFium shared libraries and sends bitmaps to the frontend.
- **Tradeoffs:** Higher performance ceiling on extreme CAD PDFs, but requires bundling platform/architecture-specific PDFium binaries for macOS, Windows, and Linux from day one.

## 5. System Design

### 5.1 Decisions Made by User vs. Agent Calls

- **User decisions:**
  - Cross-platform Tauri desktop app with English UI.
  - Core workflow: load PDF drawing → left dimension sidebar → add dimensions → mark positions on PDF → save all content in a local project file.
  - Self-contained single-file project format (`.dmone`).
  - Approach 1 (Tauri v2 + React/TS + `pdfjs-dist` + ZIP `.dmone`).
- **Agent calls (proposed defaults, open to correction):**
  - **Dimension fields in Milestone 1:** `balloonNumber` (auto-increment integer), `name` (short label/characteristic), `nominal` (string/numeric display, e.g. `10.00`), `upperTol` (e.g. `+0.05`), `lowerTol` (e.g. `-0.05`), `unit` (default `mm`, selectable `mm` / `in` / `deg`), `notes` (optional text). Storing nominal/tolerances as trimmed strings (or optional parsed numbers) avoids premature float-formatting surprises like `10.00` turning into `10` on engineering drawings.
  - **Marker style:** Numbered circular balloon pin (`1`, `2`, `3`...) placed via single click on the PDF and repositionable by dragging.
  - **Frontend styling:** Tailwind CSS with a clean, high-contrast engineering-tool aesthetic (neutral slate chrome so the PDF drawing and colored balloon pins stand out clearly).

### 5.2 `.dmone` Project Archive Format (v1)

A `.dmone` file is a standard ZIP archive containing:

```text
example.dmone (ZIP)
├── project.json                  # UTF-8 JSON metadata + dimension list (schemaVersion: 1)
└── drawings/
    └── <drawing-id>.pdf          # Original raw PDF bytes (stored without re-encoding)
```

`project.json` schema (v1):

```json
{
  "schemaVersion": 1,
  "projectId": "uuid-v4",
  "name": "Housing-RevB",
  "createdAt": "2026-11-25T07:00:00Z",
  "updatedAt": "2026-11-25T07:15:00Z",
  "drawings": [
    {
      "id": "drawing-uuid-v4",
      "filename": "Housing-RevB.pdf",
      "archivePath": "drawings/drawing-uuid-v4.pdf",
      "pageCount": 2
    }
  ],
  "dimensions": [
    {
      "id": "uuid-v4",
      "balloonNumber": 1,
      "name": "Outer Diameter",
      "nominal": "25.00",
      "upperTol": "+0.05",
      "lowerTol": "-0.05",
      "unit": "mm",
      "notes": "Critical mating surface",
      "marker": {
        "drawingId": "drawing-uuid-v4",
        "page": 1,
        "x": 0.4125,
        "y": 0.3082
      }
    }
  ]
}
```

- **Milestone 1 scope on `drawings[]` (agent call):** `drawings` is an array from v1 so future multi-drawing / revision comparison never requires a breaking `.dmone` schema migration. In Milestone 1, every project has exactly one active entry (`drawings[0]`), and all markers reference `drawings[0].id` via `marker.drawingId`.
- **Coordinate System:** `marker.x` and `marker.y` are normalized floats in `[0.0, 1.0]` relative to the rendered PDF page's unrotated visual width and height (origin top-left). `marker.page` is 1-based. `marker` may be `null` if a dimension has been created in the sidebar but not yet placed on the drawing.
- **Atomic Save:** Rust writes the new ZIP to a sibling temporary file (e.g. `<target>.dmone.tmp.<pid>`) and atomically replaces the destination path so interrupted writes cannot corrupt an existing project.
- **Compression:** `project.json` uses Deflate; PDF files under `drawings/` use `Stored` (no compression) because PDFs are already compressed and `Stored` makes saving/opening significantly faster.

### 5.3 Rust Backend Architecture (`src-tauri/`)

The Rust backend owns filesystem I/O, native file dialogs, and `.dmone` archive serialization/deserialization. It keeps the currently loaded drawing's raw PDF bytes in managed Tauri state (`AppState`) — or loads them on open — so saving a project does not require transferring megabytes of PDF bytes back and forth over JSON IPC on every save!

> **Design highlight:** Keeping the active PDF bytes in Rust `Mutex<Option<CachedDrawing>>` state means:
> - `import_pdf(path)` reads the PDF bytes into Rust state (with a newly generated `drawingId`) and returns `{ drawingId, filename, pdfBytes }` to the frontend for `pdfjs-dist` rendering.
> - `save_project(path, project_json)` combines `project_json` with the cached PDF bytes in Rust state and writes the `.dmone` ZIP atomically (`project.json` + `drawings/<drawing-id>.pdf`).
> - `open_project(path)` reads `.dmone`, validates `schemaVersion == 1`, caches `drawings[0]` PDF bytes in Rust state, and returns `{ project, pdfBytes }` to the frontend.

Tauri commands:
1. `import_pdf(path: String) -> Result<ImportedPdfPayload, String>`
   - Reads the PDF file at `path`, verifies non-empty `%PDF-` header, generates a UUID `drawingId`, stores `{ drawingId, bytes }` in Rust `AppState`, and returns `{ drawingId, filename, pdfBytes }` to the frontend.
2. `save_project(path: String, project: ProjectData) -> Result<(), String>`
   - Reads active PDF bytes from `AppState` (returns clear error if no PDF is loaded), validates `project`, and atomically writes `.dmone` ZIP (`project.json` + `drawings/<drawing-id>.pdf`).
3. `open_project(path: String) -> Result<OpenedProjectPayload, String>`
   - Opens `.dmone` ZIP at `path`, parses `project.json` (validating `schemaVersion == 1` and non-empty `drawings`), extracts `drawings[0].archivePath`, stores `{ drawingId, bytes }` in `AppState`, and returns `{ project, pdfBytes }` to the frontend.

Native dialogs:
- Uses `tauri-plugin-dialog` (`open` and `save` with `.pdf` and `.dmone` extension filters) triggered from the frontend with clean Tauri capabilities configured in `src-tauri/capabilities/default.json`.

### 5.4 Frontend Architecture (`src/`)

```text
src/
├── types/
│   └── project.ts              # TypeScript interfaces matching Rust ProjectData/Dimension/Marker
├── lib/
│   ├── coordinates.ts          # Pure functions: pixel <-> normalized (0..1) clamping & conversion
│   ├── dimensions.ts           # Pure functions: nextBalloonNumber, createDimension, formatTolerance
│   └── tauriApi.ts             # Typed wrappers around Tauri invoke() and dialog plugin
├── components/
│   ├── TopToolbar.tsx          # Open PDF, Open Project, Save, Save As, Page Nav, Zoom controls, Dirty badge
│   ├── DimensionSidebar.tsx    # Left navigator: dimension list, Add button, unplaced indicator, quick delete
│   ├── DimensionEditor.tsx     # Bottom-left inspector for selected dimension (Name, Nominal, +Tol, -Tol, Unit, Notes, Place/Move Marker button)
│   ├── PdfViewer.tsx           # pdfjs-dist canvas renderer, HiDPI scaling, pan/zoom, page switching
│   └── BalloonOverlay.tsx      # Interactive SVG/HTML marker layer: click-to-place, select, drag-to-reposition
├── App.tsx                     # Root state orchestration, keyboard shortcuts (Esc, Cmd/Ctrl+S), unsaved-changes confirmation
└── main.tsx
```

### 5.5 Key User Flows

1. **Empty State (Launch):**
   - App opens to a clean English workspace showing two primary actions: **Open PDF Drawing** and **Open Project (.dmone)** (also accessible in the top toolbar).
2. **Load PDF Drawing:**
   - User clicks **Open PDF** → native `.pdf` file picker → Rust reads and caches PDF → `pdfjs-dist` renders Page 1 fitted to the viewport. Project is marked as unsaved (`Untitled` or derived from PDF filename).
3. **Add & Mark Dimension:**
   - User clicks **+ Add** in the left **Dimensions** sidebar.
   - A new dimension is created with the next available `balloonNumber` (`max + 1`), selected in the sidebar/editor, and the viewer enters **Place Marker** mode (crosshair cursor + status hint `"Click on the drawing to place #N (Esc to cancel)"`).
   - Clicking anywhere on the PDF page stores `{ page: currentPage, x, y }` in normalized coordinates, renders the numbered balloon pin, and exits placement mode.
   - User can click **Place / Reposition Pin** in the inspector at any time to re-place an existing dimension's pin, or drag any pin directly on the PDF canvas to fine-tune its position.
4. **Bidirectional Navigation & Editing:**
   - Clicking a dimension row in the left sidebar selects it; if its marker is on another page, the PDF viewer automatically switches to that page and highlights the balloon.
   - Clicking a balloon on the PDF selects the corresponding dimension in the left sidebar and opens its fields in the editor.
   - Deleting a dimension removes it from both the sidebar and the PDF canvas.
5. **Save / Save As / Open Project:**
   - **Save** (`Cmd/Ctrl+S`): If the project already has a `.dmone` file path, saves directly to that path; otherwise opens the native Save dialog with `.dmone` filter.
   - **Save As**: Always opens the native Save dialog with `.dmone` filter and updates the active project path.
   - **Open Project**: If there are unsaved changes, prompts for confirmation before discarding; opens native `.dmone` file picker, restores PDF + dimensions + markers, and clears the dirty indicator.

### 5.6 Verification & Testing Plan

- **Rust unit tests (`cargo test`):**
  - `.dmone` ZIP round-trip (write `project.json` + PDF bytes, read back, verify exact match).
  - Atomic save overwrite (saving over an existing `.dmone` succeeds and leaves no stray `.tmp` files).
  - Error handling for corrupt ZIP, missing `project.json`, missing `drawing.pdf`, and unsupported `schemaVersion`.
- **Frontend unit tests (`vitest`):**
  - Coordinate normalization/denormalization and clamping (`[0, 1]`) across different zoom scales.
  - Dimension creation (`nextBalloonNumber` after additions and deletions) and tolerance formatting.
- **Integration / Manual Smoke Verification:**
  - `npm run build` and `cargo test` both pass cleanly.
  - Launch `npm run tauri dev` on macOS, load a real multi-page PDF, add and place multiple dimensions across pages, drag a pin, save to a `.dmone` file, reopen the `.dmone` file, and verify all dimensions and pin positions restore accurately.

## 6. Left to the Builder

- Exact Tailwind color palette, spacing, typography, and icon library (`lucide-react` recommended).
- Zoom step increments (e.g., 25%–400%, wheel zoom with Ctrl/Cmd, Fit Width / Fit Page).
- Exact drag-threshold ergonomics so clicking a balloon selects it without accidental micro-drags.
- Toast / inline status banner styling for save confirmations and error messages.
