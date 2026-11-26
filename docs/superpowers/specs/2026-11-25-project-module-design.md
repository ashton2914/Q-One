# DM-One Project Module (BOM & Multi-Drawing) Design Specification

**Date:** 2026-11-25
**Status:** Draft (pending builder check & user approval)

## 1. Intent & Why

Real manufacturing products are assemblies composed of parts and sub-parts (e.g., an Assembly containing a C-Cover, Keyboard Frame, and subordinate parts), where each part may carry one or more engineering PDF drawings. To support the full dimension management lifecycle across an assembly, DM-One needs a dedicated **Project** module alongside the existing **Drawing** module.

This milestone adds:
1. A far-left **Module Navigation Bar (Activity Bar)** housing **`Project`** and **`Drawing`** (with room for future Metrology, GRR, FAI, Cpk, SPC, and Yield modules).
2. An interactive visual **Project** workspace where engineers can create Parts, nest Sub-parts into a multi-level BOM hierarchy, drag-and-drop to reparent parts, attach PDF drawings to any part, and jump directly from any attached PDF into the **Drawing** module to mark dimensions.
3. Multi-drawing `.dmone` persistence in Rust while remaining 100% backward-compatible with Milestone 1 single-drawing `.dmone` files.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Add a fixed far-left vertical **Activity Bar** (`48px` wide, neutral dark English UI) switching seamlessly between **`Project`** and **`Drawing`**.
- Provide an intuitive, interactive **Visual BOM Node Tree Canvas** in the **`Project`** module:
  - Add top-level Parts and nested Sub-parts (`+ Add Part`, `+ Sub-part`).
  - Render Parts as interactive cards connected by smooth SVG cubic Bézier edges using deterministic auto-layout (zero overlap, collapsible subtrees).
  - Support drag-and-drop reparenting (drag a Part card onto another Part card to make it a Sub-part, or onto a root drop target to promote it to top-level), strictly preventing cycles.
  - Support canvas click-drag panning and `Cmd/Ctrl + wheel` zoom.
- Provide a right-side **Part Inspector Drawer** for editing Part metadata (`Name`, `Part Number`, `Revision`, `Notes`), attaching/removing one or more PDF drawings, and opening any attached PDF directly in the **`Drawing`** module.
- Upgrade Rust `.dmone` persistence (`AppState` `HashMap<drawingId, Vec<u8>>`) to store `0..N` PDFs and the `parts[]` tree inside a single `.dmone` archive, with automatic non-destructive migration when opening Milestone 1 `.dmone` files.
- Scope dimensions in the **`Drawing`** module cleanly to the active drawing (`dim.drawingId`), with a quick Part/Drawing switcher in the PDF bar.

### Non-Goals (Out of Scope for Milestone 2)
- Freeform manual `(x, y)` node placement persisted per part (layout is deterministic auto-layout).
- Cross-part dimension linking, tolerance stack-up analysis, or automated BOM import from Excel/CAD.
- Multi-revision PDF diffing or side-by-side drawing comparison.
- Downstream modules (Metrology, GRR, FAI, Cpk, SPC, Yield).

### Anti-Goals
- **Breaking Milestone 1 `.dmone` files:** Previously saved `.dmone` files (with no `parts[]` array and no `dimension.drawingId`) must open seamlessly without errors or data loss.
- **Cyclic BOM hierarchies:** Allowing a part to be dropped onto itself or one of its own descendants, which would cause infinite recursion in tree layout or deletion.
- **Heavy graph-library bloat / style clashes:** Pulling in heavy third-party node-graph libraries that fight our Tailwind v4 neutral dark chrome.

## 3. Constraints

- **UI Language:** English-only across all menus, buttons, tooltips, empty states, and dialogs.
- **Theme:** Pure neutral dark (`neutral-*`) matching Milestone 1.
- **File Format:** Single self-contained `.dmone` ZIP archive (`schemaVersion: 1`, additive backward-compatible fields).
- **Zero-dependency layout:** Pure TypeScript deterministic tree layout + inline SVG Bézier edges + HTML cards.

## 4. Approaches Considered

### Approach A (Selected): Custom SVG Bézier + HTML Deterministic Tree Canvas + Rust Multi-Drawing `HashMap`
- **How it works:** Pure TypeScript `layoutPartTree()` computes non-overlapping left-to-right tree coordinates for all visible parts (supporting multiple root trees and collapsed subtrees). An SVG layer renders smooth cubic Bézier curves between parent and child cards; HTML cards render interactive controls, PDF chips, and HTML5/Pointer drag-to-reparent. Rust `AppState` upgrades from `Option<CachedDrawing>` to `HashMap<String, Vec<u8>>`.
- **Tradeoffs:** Zero external graph library overhead, seamless Tailwind v4 neutral dark styling, 100% deterministic layout, and pure unit-testable tree/layout/cycle-check logic. Nodes follow automatic tree alignment rather than arbitrary user-placed coordinates.
- **Why selected:** Fastest, cleanest, most maintainable fit for an engineering BOM hierarchy.

### Approach B: `@xyflow/react` (React Flow) + `dagre` + Rust Multi-Drawing `HashMap`
- **How it works:** Delegates canvas/edges/minimap to React Flow and recomputes positions with `dagre` on every hierarchy change.
- **Tradeoffs:** Built-in minimap and freeform dragging, but adds heavy dependency weight, dark-theme CSS overrides, and state synchronization glue between freeform coordinates and strict tree reparenting.

## 5. System Design

### 5.1 Data Model & `.dmone` Archive (v1 Backward-Compatible)

`project.json` remains `schemaVersion: 1` with additive defaulted fields:

```json
{
  "schemaVersion": 1,
  "projectId": "uuid-v4",
  "name": "Laptop-C-Cover",
  "createdAt": "2026-11-25T10:00:00Z",
  "updatedAt": "2026-11-25T10:15:00Z",
  "parts": [
    {
      "id": "part-uuid-1",
      "parentId": null,
      "name": "C-Cover Assembly",
      "partNumber": "M1292339",
      "revision": "Rev B",
      "notes": "",
      "drawingIds": ["drw-uuid-1"]
    },
    {
      "id": "part-uuid-2",
      "parentId": "part-uuid-1",
      "name": "Metal C-Cover",
      "partNumber": "M1292340",
      "revision": "Rev A",
      "notes": "",
      "drawingIds": ["drw-uuid-2"]
    }
  ],
  "drawings": [
    {
      "id": "drw-uuid-1",
      "filename": "c_cover_asm.pdf",
      "archivePath": "drawings/drw-uuid-1.pdf",
      "pageCount": 10
    }
  ],
  "dimensions": [
    {
      "id": "dim-uuid-1",
      "drawingId": "drw-uuid-1",
      "balloonNumber": 1,
      "dimensionType": "CTF",
      "name": "103",
      "quantity": 1,
      "nominal": "210.21",
      "upperTol": "0.10",
      "lowerTol": "0.10",
      "unit": "mm",
      "notes": "",
      "marker": {
        "drawingId": "drw-uuid-1",
        "page": 2,
        "x": 0.41,
        "y": 0.30,
        "width": 0.08,
        "height": 0.035
      }
    }
  ]
}
```

- **Backward compatibility on Open:**
  - Rust uses `#[serde(default)]` on `ProjectData.parts` (`Vec<Part>`) and `Dimension.drawing_id` (`Option<String>`).
  - On the frontend, a pure helper `normalizeLoadedProject(project)` ensures:
    - If `parts.length === 0 && drawings.length > 0`, synthesizes one root `Part` (`name: project.name`, `drawingIds: drawings.map(d => d.id)`).
    - For any dimension with missing `drawingId`, assigns `dim.marker?.drawingId ?? project.drawings[0]?.id ?? null`.
    - Normalization runs in-memory on load without marking `isDirty = true`.
- **Zero-drawing Projects:** A newly created project (`File → New Project`) starts with `drawings: []`, `parts: []` (or 1 editable root part), and `dimensions: []`. Saving a `.dmone` with `0` drawings is valid and writes `project.json` alone in the ZIP.

### 5.2 Rust Backend Commands (`src-tauri/src/project.rs`)

`AppState` changes from `Mutex<Option<CachedDrawing>>` to `Mutex<HashMap<String, Vec<u8>>>` (keyed by `drawing_id`).

Commands:
1. `import_pdf(path: String, state) -> Result<ImportedPdfPayload, String>`
   - Validates `%PDF-` header, generates UUID `drawing_id`, **inserts** `(drawing_id, bytes)` into `AppState.drawings` (preserving all other drawings in the project), returns `{ drawingId, filename, pdfBytes }`.
2. `get_drawing_bytes(drawing_id: String, state) -> Result<Vec<u8>, String>`
   - Looks up cached PDF bytes in `AppState.drawings` when the user switches to another drawing in the `Drawing` module.
3. `remove_drawing_bytes(drawing_id: String, state) -> Result<(), String>`
   - Removes a detached/deleted drawing's bytes from `AppState.drawings`.
4. `clear_drawings(state) -> Result<(), String>`
   - Clears `AppState.drawings` on `New Project`, `Close Project`, or quick `Open PDF Drawing`.
5. `save_project(path: String, project: ProjectData, state) -> Result<(), String>`
   - Validates `schemaVersion == 1` and safe `archivePath` for every drawing in `project.drawings` (`0..N` drawings).
   - Fetches each drawing's bytes from `AppState.drawings` (returns descriptive error if any referenced `drawing.id` is missing from cache).
   - Atomically writes `project.json` (Deflate) + all `drawings/<id>.pdf` (Stored) via `NamedTempFile::new_in` + `sync_all()` + `persist()`.
6. `open_project(path: String, state) -> Result<OpenedProjectPayload, String>`
   - Opens `.dmone`, parses `project.json`, validates `schemaVersion == 1`, extracts and validates every drawing in `project.drawings` (`0..N`), replaces `AppState.drawings` with the loaded map, and returns `{ project, activeDrawingId, pdfBytes }` where `activeDrawingId` is `project.drawings[0]?.id ?? null` and `pdfBytes` is that first drawing's bytes (or `null` if `0` drawings).

### 5.3 Frontend Module Architecture

```text
src/
├── types/project.ts                # Add Part, Dimension.drawingId, ActiveModule ("project" | "drawing")
├── lib/
│   ├── partTree.ts                 # Pure tree helpers: createPart, canReparentPart, reparentPart, deletePartSubtree, layoutPartTree, normalizeLoadedProject
│   ├── __tests__/partTree.test.ts  # Comprehensive Vitest tests for tree, cycle prevention, layout, migration
│   └── tauriApi.ts                 # Add getDrawingBytes, removeDrawingBytes, clearDrawings
├── components/
│   ├── ActivityBar.tsx             # Far-left 48px vertical module switcher (Project, Drawing)
│   ├── MenuBar.tsx                 # Add "New Project" to File menu
│   ├── ProjectWorkspace.tsx        # Top project bar + Visual BOM Node Tree Canvas + SVG Bézier edges + drag-to-reparent + Right Part Inspector Drawer
│   ├── PdfViewer.tsx               # Show active Part / Drawing switcher in PDF top bar
│   └── ...
└── App.tsx                         # Orchestrate activeModule ("project" | "drawing"), activeDrawingId, parts CRUD, drawing switching
```

### 5.4 Key User Flows

1. **Module Switching (`ActivityBar`):**
   - Far-left vertical rail always visible when the app is open.
   - Clicking **`Project`** switches main content to `ProjectWorkspace`.
   - Clicking **`Drawing`** switches main content to the Dimension Sidebar + `PdfViewer` for `activeDrawingId`.
2. **Start a New Project (`File → New Project` or Empty State `"New Project"`):**
   - Creates a fresh project with `name: "Untitled Project"`, clears Rust drawing cache, switches to **`Project`** module, and offers an immediate `+ Add Part` button (and quick empty-canvas prompt).
3. **Quick Open PDF (`File → Open PDF Drawing…`):**
   - Preserves Milestone 1 convenience: clears cache, imports the PDF, creates a project with 1 root Part (`name` derived from PDF filename) linked to that drawing, sets it as `activeDrawingId`, and opens the **`Drawing`** module directly.
4. **Build & Reorganize BOM in `Project`:**
   - Click **`+ Add Part`** (top bar) → creates a new root Part and selects it in the right inspector drawer (auto-focusing Part Name).
   - Click **`+ Sub-part`** on any Part card (or in inspector) → creates a child Part under that parent, expands the parent if collapsed, and selects the new Sub-part.
   - **Drag-to-reparent:** Drag a Part card onto another Part card → highlights valid drop target in blue (or ignores invalid self/descendant targets via `canReparentPart`); dropping updates `parentId` and smoothly recalculates the tree layout. Dragging a Sub-part onto the top `"Drop here to make Root Part"` zone promotes it to `parentId: null`.
   - Click the collapse chevron on a parent card to collapse/expand its subtree.
5. **Attach PDF & Jump to `Drawing`:**
   - Click **`+ PDF`** on a Part card or **`+ Attach PDF`** in the right inspector → native `.pdf` picker → Rust `import_pdf` caches bytes under a new `drawingId` → appends `DrawingEntry` to `project.drawings` and `drawingId` to `part.drawingIds`.
   - Clicking any attached PDF chip on a Part card (or `"Open in Drawing"` in the inspector) loads its bytes via `get_drawing_bytes` (if not already active), sets `activeDrawingId`, and switches `activeModule` to **`Drawing`**.
6. **Per-Drawing Dimensions in `Drawing`:**
   - `DimensionSidebar` and `BalloonOverlay` display dimensions whose `drawingId === activeDrawingId`.
   - `validateDimensionId` enforces uniqueness per drawing (or project-wide — agent call: **per-drawing** uniqueness? Wait: in a BOM assembly, two different sub-part drawings can both have their own balloon `101`, so per-drawing uniqueness is what engineers expect! We will scope `validateDimensionId` to the active drawing's dimensions).
   - The PDF bar shows a compact Part/Drawing dropdown (`C-Cover Assembly / c_cover_asm.pdf`) so engineers can switch directly between drawings without leaving `Drawing`.

### 5.5 Verification & Testing Plan

- **Rust unit tests (`cargo test`):**
  - Multi-drawing `.dmone` round-trip (`0` drawings, `2` drawings with `parts[]` hierarchy and per-drawing `dimensions[]`).
  - Backward compatibility: reading a Milestone 1 `.dmone` without `parts` or `dimension.drawingId` succeeds cleanly.
  - Missing cached drawing bytes on save returns a clear error.
- **Frontend unit tests (`vitest`):**
  - `canReparentPart` rejects self and transitive descendants, accepts valid parent or `null` (root).
  - `deletePartSubtree` removes a part and all nested descendants cleanly and returns removed drawing IDs.
  - `layoutPartTree` produces deterministic non-overlapping coordinates for multi-root & multi-level trees and hides collapsed subtrees.
  - `normalizeLoadedProject` migrates Milestone 1 projects (empty `parts[]`) into 1 default root Part and backfills `dimension.drawingId`.
- **Build & Live Smoke Verification:**
  - `npm test`, `npm run build`, `cargo test` all pass with zero warnings/errors.
  - Relaunch `npm run tauri dev` and verify Project ↔ Drawing switching, adding Parts/Sub-parts, drag-reparenting, attaching multiple PDFs, marking dimensions on each PDF, saving `.dmone`, and reopening `.dmone`.

## 6. Left to the Builder

- Exact card dimensions (`240px × ~110px`), horizontal/vertical tree spacing, and cubic Bézier control-point tension.
- Exact Lucide icon choices for Activity Bar and Part cards.
- Visual drop-target ring styling and root-promotion drop banner styling.
