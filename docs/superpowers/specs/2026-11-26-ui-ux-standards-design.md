# Q-One UI/UX Design System & Cross-AI-Client Development Standards

**Date:** 2026-11-26
**Status:** Approved
**Scope:** Documentation standards, multi-AI-client rule wiring (Codex, GitHub Copilot, Antigravity), Tailwind v4 semantic tokens, lean UI primitives, and targeted drift fixes.

---

## 1. Intent & Why

Q-One is a Tauri v2 + React 19 + TypeScript + Tailwind CSS v4 desktop Quality Management workstation (currently covering Project BOM management and 2D PDF Drawing annotation, with more quality modules planned).

Development is performed across multiple AI coding clients — primarily **Codex**, **GitHub Copilot**, and **Antigravity**. Today, the repository has no root AI instruction files, no CSS design tokens, and no shared UI component primitives. While the existing app already exhibits a cohesive dark precision-engineering aesthetic, visual and interaction patterns live only as ad-hoc Tailwind strings inside 1,000+ line feature components, and minor drift has already started to appear (e.g., welcome screen still using a `Q1` text placeholder instead of `<QOneLogo />`, mixed `window.confirm` vs. Tauri native dialog calls).

Without a single canonical specification and reusable code primitives, each AI client will invent slightly different colors, spacing, keyboard behaviors, and component structures as Q-One grows, fragmenting the user experience.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Codify Q-One's Design Language**: Formalize the existing dark monochrome precision-engineering aesthetic into explicit visual tokens and UX interaction contracts.
2. **Cross-AI-Client Consistency**: Provide a single source of truth (`AGENTS.md` + `docs/standards/`) with thin, zero-duplication adapters so Codex, GitHub Copilot, and Antigravity all enforce identical design and workflow rules.
3. **Code-Level Guardrails**: Establish Tailwind v4 `@theme` semantic tokens in `src/index.css` and a small, zero-dependency `src/components/ui/` primitive library so AI agents compose shared building blocks instead of hand-writing raw utility strings.
4. **Standardized Development Workflow**: Define a repeatable feature/UI workflow (Spec → Reuse Check → Build → Verify → UI Self-Review) that keeps future modules consistent without slowing iteration.
5. **Surgical Drift Cleanup**: Fix existing minor inconsistencies spotted during the audit without disrupting ongoing feature work.

### Non-Goals
- **No big-bang rewrite** of existing large feature components (`App.tsx`, `ProjectWorkspace.tsx`, `DimensionSidebar.tsx`, `PdfViewer.tsx`). Existing components migrate opportunistically when touched.
- **No third-party UI component library** (e.g., Radix UI, shadcn/ui, MUI, Ant Design). Q-One stays lean on React + Tailwind v4 + `lucide-react`.
- **No light mode / multi-theme switcher** in this phase. Tokens are structured semantically so theming is possible later, but Q-One ships dark-only.
- **No visual redesign** of the existing workstation. Standards codify and tighten the aesthetic already established in Q-One.

### Anti-Goals (Failure Conditions)
- **Rule duplication across clients**: Copying long design specs into `AGENTS.md`, `.github/copilot-instructions.md`, and client rules separately — this guarantees rules will drift out of sync.
- **Context bloat**: Making always-on root instruction files so large that they crowd out task context.
- **Over-engineered UI library**: Abstracting single-use domain widgets (e.g., GD&T Feature Control Frame or BOM Node Card) into `src/components/ui/`.
- **Regressing uncommitted work**: Breaking or overwriting the currently uncommitted PDF viewer tool bar or annotation sorting/reordering work on `main`.

---

## 3. Constraints

- **Stack**: Tauri v2, React 19, TypeScript 5.8 (strict), Tailwind CSS v4 (`@tailwindcss/vite`, `@import "tailwindcss";`), `lucide-react`, Vitest.
- **Zero new runtime dependencies**: Everything in `src/components/ui/` and `src/lib/confirm.ts` uses existing dependencies only.
- **Tauri WebView realities**: Native HTML5 Drag-and-Drop is unreliable in Tauri WebView; pointer events (`pointerdown`/`pointermove`/`pointerup` + capture) are the standard for drag interactions. Native dialogs (`@tauri-apps/plugin-dialog`) require browser-preview fallback (`window.confirm`) when running under plain Vite.
- **Language convention**: All repository standards, AI rule files, code comments, and UI copy are written in **English** to match Q-One's existing UI copy and `docs/superpowers/specs/` conventions, and to maximize instruction adherence across all AI models.
- **Context budget**: Root `AGENTS.md` must stay under ~150 lines (~6 KB); thin client adapters stay under ~50 lines. Full reference specs live in `docs/standards/` and are loaded on demand.

---

## 4. Approaches Considered

### Approach A: Single Canonical Spec + Thin Client Adapters + Lean Core Primitives (Progressive Migration) — **Selected**
- Root `AGENTS.md` + modular `docs/standards/*.md` as single source of truth; thin native adapters for Copilot (`.github/copilot-instructions.md`, `.github/instructions/ui.instructions.md`) and scoped directory rule (`src/components/AGENTS.md`) for Codex & Antigravity.
- Tailwind v4 `@theme` tokens in `src/index.css` + 7 zero-dependency primitives in `src/components/ui/` + `src/lib/confirm.ts`.
- Fix 3 concrete existing drifts; migrate large existing components opportunistically.
- **Trade-off**: Minimal regression risk, zero new dependencies, immediate protection for all new features; existing components will contain legacy raw classes until touched.

### Approach B: Same Standards + Big-Bang Refactor of All Existing Components
- Immediately rewrite `App.tsx`, `MenuBar.tsx`, `ActivityBar.tsx`, `ProjectWorkspace.tsx`, `DrawingListSidebar.tsx`, `DimensionSidebar.tsx`, and `PdfViewer.tsx` onto the new primitives.
- **Trade-off**: 100% clean reference codebase immediately, but touches ~5,000+ lines including uncommitted changes on `main`, carrying high regression risk on canvas pan/zoom, PDF tiling, and pointer drag interactions.

### Approach C: Adopt Headless Component Library (Radix UI / shadcn) + Standards
- Install Radix Primitives + `tailwind-merge` / `cva` to power menus, popovers, and dialogs.
- **Trade-off**: Stronger out-of-the-box ARIA/focus-trap behavior for complex overlays, but introduces new runtime dependencies and diverges from Q-One's lean architecture. Can still be adopted inside `src/components/ui/` later if modal/menu complexity grows.

---

## 5. Architecture & Deliverables

### 5.1 Layer 1 — Canonical Standards (`docs/standards/`)

Three focused documents under `docs/standards/`:

#### A. `docs/standards/ui-design-system.md`
Codifies Q-One's visual language:
1. **Design Philosophy**: Monochrome Precision Engineering Workstation — high-contrast dark neutral chrome, zero decorative gradients/shadows, crisp 1px borders, semantic color reserved strictly for state and domain meaning.
2. **Surface & Elevation Hierarchy** (mapped 1:1 to Tailwind v4 `@theme` tokens):
   - `surface-chrome` (`#0a0a0a` / `neutral-950`): `MenuBar`, `ActivityBar`, sidebars, top sub-toolbars (`bg-surface-chrome/90`), elevated popovers/cards.
   - `surface-canvas` (`#171717` / `neutral-900`): Main workspaces (`ProjectWorkspace`, `PdfViewer`, welcome/empty backdrop), toolbar pill groups, recessed input fields on chrome surfaces.
   - `surface-raised` (`#262626` / `neutral-800`): Active navigation items, secondary buttons, hover states, count pills.
   - `surface-hover` (`#404040` / `neutral-700`): Hover state on secondary buttons and active segmented controls.
   - **Input Contrast Rule**: Inputs inside `surface-chrome` (`neutral-950`) containers use `surface-canvas` (`neutral-900`); inputs inside `surface-canvas` (`neutral-900`) cards use `surface-chrome` (`neutral-950`), so every editable field has clear 1-step depth contrast and a 1px `border-control` (`neutral-700`) border.
3. **Border Hierarchy**:
   - `border-subtle` (`#262626` / `neutral-800`): Structural dividers (bars, sidebars, section rules, resting cards).
   - `border-control` (`#404040` / `neutral-700`): Form controls, popovers, dashed upload zones, resting rings.
   - `border-focus` (`#737373` / `neutral-500` or `neutral-400`): Focused inputs and active edit card outlines.
4. **Text Hierarchy**:
   - `text-primary` (`#f5f5f5` / `neutral-100`): Titles, active values, primary labels.
   - `text-secondary` (`#d4d4d4` / `neutral-300`): Body controls, toolbar labels, resting nav text.
   - `text-muted` (`#a3a3a3` / `neutral-400`): Field labels, metadata, inactive icons.
   - `text-subtle` (`#737373` / `neutral-500`): Counts, filenames, empty-state helper copy, shortcut hints.
   - `text-disabled` (`#525252` / `neutral-600`): Placeholders and disabled controls.
5. **Primary CTA & Semantic Accent Matrix** (strict role assignment — never repurpose):
   - **Primary CTA**: Monochrome high-contrast `bg-neutral-100 text-neutral-950 hover:bg-white` (matches the monochrome B1 Q-One brand identity).
   - **Selection / Focus / Placement (`blue`)**: Active module left rail indicator (`blue-500`), selected annotation/box/ring (`blue-500`/`blue-400`), placing-mode banner, drag-reorder drop indicator.
   - **Active Entity / Positive Feedback (`emerald`)**: Active Part / Active Drawing status dot and pill (`emerald-400`/`emerald-500`), info/success status toast.
   - **Attention / Version / Datum (`amber`)**: Unsaved dirty indicator dot (`amber-400`), `Latest` drawing star badge, GD&T material-condition & datum highlights.
   - **Destructive / Error / Default Dimension Region (`rose`)**: Delete/Unlink hover states (`hover:bg-rose-950 hover:text-rose-300`), error banner/toast, unselected dimension marker boxes on PDF (`rose-500/80`).
   - **Point Annotation (`purple`)**: Unselected point marker dot & badge on PDF (`purple-400`/`purple-600`).
6. **Typography & Compact Desktop Density**:
   - UI sans-serif: system font stack (already in `src/index.css`).
   - Monospace (`font-mono`): mandatory for IDs, part numbers, revisions, tolerances, coordinates, filenames, page counts, zoom percentages, and keyboard shortcut hints.
   - Scale: `12px` (`text-xs`) default UI body & controls; `11px` (`text-[11px]`) field labels, toolbar readouts, compact secondary buttons; `10px` (`text-[10px]`) micro-badges, metadata, shortcut chips; `9px` (`text-[9px]`) ActivityBar labels; `14px`/`18px` (`text-sm`/`text-lg`) empty-state & welcome headings only.
7. **Layout Shell Anatomy**:
   - `MenuBar`: fixed `h-9` (36px), `z-40`, brand mark (`<QOneLogo />` 18px + `Q-One`) + top-level menus left, project name + dirty dot right.
   - `ActivityBar`: fixed `w-12` (48px), vertical icon+label module buttons (`40x40px`), left 2px `blue-500` active rail.
   - Module Sub-Toolbar: fixed `h-10` (40px), `border-b border-subtle bg-surface-chrome/90 px-3`.
   - Module Sidebar (when used): fixed `w-80` (320px), `border-r border-subtle bg-surface-chrome`.
   - Z-index layering contract: `z-10` PDF text layer, `z-20` resting markers, `z-30` selected markers / mode banners, `z-40` menus & in-place editors & drag preview, `z-50` floating toasts.
8. **Iconography & Brand Mark**:
   - Exclusively `lucide-react` icons. Standard sizes: `h-3.5 w-3.5` (14px) in buttons/menus/toolbars, `h-4 w-4` (16px) in ActivityBar & welcome CTAs, `h-3 w-3` (12px) in dense micro-buttons/badges.
   - Brand mark MUST always render `<QOneLogo />` (never plain text `Q1`).
9. **Forbidden Anti-Patterns**:
   - No decorative gradients, colored primary buttons, rounded-2xl consumer cards, light-mode hardcoded backgrounds (`bg-white` except primary CTA hover), or unstyled native alerts.

#### B. `docs/standards/ux-interaction-patterns.md`
Codifies Q-One's behavioral contracts:
1. **Module & Active-Entity Mental Model**: `Project` owns the BOM tree and "Active Part"; `Drawing` operates on the active part's drawings and dimensions. Empty states in downstream modules must always explain what is missing and offer a direct 1-click navigation/creation CTA.
2. **Inline Editing Lifecycle**:
   - Newly created items auto-open in edit mode and focus the primary input.
   - Confirm: `⌘/Ctrl+Enter` (or explicit `Done` button). Cancel: `Esc` (reverts new unsaved item by deleting it, or restores snapshot for existing item).
   - **Mandatory IME Guard**: Every `keydown` handler checking `Enter`, `Escape`, `Tab`, or single-letter shortcuts MUST return early when `e.nativeEvent.isComposing` is `true`.
3. **Keyboard Shortcuts Hygiene**:
   - Single-key shortcuts (e.g., `N` new annotation, `C` hand tool, `V` text tool) MUST ignore events when `metaKey`/`ctrlKey`/`altKey` is held, when IME is composing, or when focus is inside `INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable`.
   - Every toolbar/menu shortcut must be visibly hinted in monospace (`⌘/Ctrl+S`, `C`, `V`) and reflected in `title` / `aria-label`.
4. **Pointer-Based Drag & Drop (Tauri Contract)**:
   - Never use HTML5 `draggable` / `onDragStart` for in-app reordering or canvas manipulation.
   - Use pointer events with a movement threshold (`>= 4–6px`) before activating drag, `setPointerCapture` / window listeners, clear visual drop indicator (`blue-400/500`), and post-drag click suppression.
5. **Canvas & Viewport Controls**:
   - Pan via left-drag (in Hand mode or empty canvas); zoom via `⌘/Ctrl + Wheel` plus unified `ToolbarGroup` (`-`, `%`, `+`, `Fit`).
6. **Destructive Actions & Unsaved Changes**:
   - All destructive confirmations and unsaved-change discards MUST go through `confirmAction()` in `src/lib/confirm.ts` (Tauri native dialog with `window.confirm` fallback) and explicitly state cascading impact (e.g., sub-parts, drawings, dimensions count).
   - Hover-revealed destructive icons (`opacity-0 group-hover:opacity-100 focus:opacity-100`) keep dense lists calm while remaining keyboard-discoverable.
7. **Feedback & Notifications**:
   - Transient status uses the floating top-right toast (`info` auto-dismisses at 3.5s; `error` persists until dismissed).
   - Modal/active canvas modes (e.g., Placing mode) show a persistent top banner with explicit `Esc` hint and `Cancel` button.

#### C. `docs/standards/development-workflow.md`
Standardizes how any AI client (or human) builds in Q-One:
1. **Standard Feature Workflow**:
   - **Step 1 — Read Standards**: Check `AGENTS.md` and relevant `docs/standards/*.md` before designing or editing.
   - **Step 2 — Reuse-First Audit**: Before creating UI markup, check `src/components/ui/` and `src/index.css` tokens. Extract a new primitive only when a pattern is used in 2+ distinct modules.
   - **Step 3 — Pure Logic Separation**: Keep pure state, layout, sorting, validation, and coordinate math in `src/lib/*.ts` (with Vitest unit tests in `src/lib/__tests__/*.test.ts`), separate from React rendering.
   - **Step 4 — Verification Gate**: Run `npm test` and `npm run build` (`tsc && vite build`); if `src-tauri/` was touched, also run `cargo test --manifest-path src-tauri/Cargo.toml`.
   - **Step 5 — UI/UX Consistency Self-Review Checklist** (concise 8-item gate: tokens/primitives used, semantic colors respected, monospace on engineering values, IME & input guards on shortcuts, pointer events instead of HTML5 DnD, `confirmAction` for destructive/discard flows, empty/disabled states handled, `<QOneLogo />` for brand marks).
2. **Progressive Migration Policy**:
   - All **new** components and features MUST use semantic tokens and `src/components/ui/` primitives.
   - When modifying an **existing** component, migrate the touched block opportunistically without unrelated mass rewrites.
3. **Keeping Standards & Clients in Sync**:
   - Never put rules only in a client adapter. Update `docs/standards/*` (and `AGENTS.md` if top-level summary changes); client adapters remain thin pointers.

---

### 5.2 Layer 2 — Cross-AI-Client Rule Wiring

Zero-duplication topology tailored to **Codex**, **GitHub Copilot**, and **Antigravity**:

| File | Consumed By | Role & Size Target |
| :--- | :--- | :--- |
| `AGENTS.md` | **Codex**, **Antigravity** (native) | Canonical project overview, architecture map, non-negotiable UI/UX & engineering rules, verification commands, and index to `docs/standards/*`. (≤150 lines) |
| `src/components/AGENTS.md` | **Codex**, **Antigravity** (hierarchical on UI edits) | Concise UI component contract: reuse `src/components/ui/`, use `@theme` tokens, follow `docs/standards/ui-design-system.md` & `ux-interaction-patterns.md`. (≤50 lines) |
| `.github/copilot-instructions.md` | **GitHub Copilot** (always-on) | Thin workspace pointer referencing `AGENTS.md` and summarizing core workflow + verification commands. (≤50 lines) |
| `.github/instructions/ui.instructions.md` | **GitHub Copilot** (`applyTo: "src/**/*.{tsx,css}"`) | Thin UI-scoped pointer to `docs/standards/ui-design-system.md`, `ux-interaction-patterns.md`, and `src/components/ui/`. (≤40 lines) |

---

### 5.3 Layer 3 — Code-Level Enforcement Foundation

#### A. Semantic Tokens in `src/index.css`
Add a Tailwind v4 `@theme` block right after `@import "tailwindcss";` defining Q-One's semantic color tokens so Tailwind generates `bg-surface-chrome`, `border-border-subtle`, `text-ink-primary`, etc. without breaking any existing `neutral-*` classes:
- Surfaces: `--color-surface-chrome: #0a0a0a`, `--color-surface-canvas: #171717`, `--color-surface-raised: #262626`, `--color-surface-hover: #404040`
- Borders: `--color-border-subtle: #262626`, `--color-border-control: #404040`, `--color-border-focus: #737373`
- Text (`ink-*` to avoid colliding with Tailwind's `text-*` font-size utilities cleanly — e.g. `text-ink-primary`): `--color-ink-primary: #f5f5f5`, `--color-ink-secondary: #d4d4d4`, `--color-ink-muted: #a3a3a3`, `--color-ink-subtle: #737373`, `--color-ink-disabled: #525252`
- Semantic accents: `--color-accent-selection: #3b82f6`, `--color-accent-active: #34d399`, `--color-accent-warning: #fbbf24`, `--color-accent-danger: #f43f5e`, `--color-accent-point: #c084fc`

*(Design call: using `--color-ink-*` for text colors produces `text-ink-primary`, `text-ink-muted`, etc., avoiding ambiguity with Tailwind v4 font-size utilities like `text-xs`.)*

#### B. Lean UI Primitives in `src/components/ui/`
Seven small, focused, zero-dependency React components + `index.ts` barrel export:
1. `Button.tsx`:
   - `variant`: `"primary"` | `"secondary"` | `"ghost"` | `"danger"` | `"dashed"` (default `"secondary"`)
   - `size`: `"xs"` | `"sm"` | `"md"` (default `"sm"`)
   - Native `<button>` props forwarded, `type="button"` default.
2. `IconButton.tsx`:
   - `variant`: `"ghost"` | `"subtle"` | `"danger"` (default `"ghost"`)
   - `size`: `"xs"` | `"sm"` (default `"sm"`)
   - Requires `aria-label` (type-enforced) for accessibility.
3. `Input.tsx`:
   - `surface`: `"on-chrome"` (uses `bg-surface-canvas`) | `"on-canvas"` (uses `bg-surface-chrome`) | `"inline"` (transparent until hover/focus)
   - `mono?: boolean`
   - Forwards `ref` and native `<input>` props.
4. `Badge.tsx`:
   - `tone`: `"neutral"` | `"active"` | `"accent"` | `"warning"` | `"danger"` | `"point"`
   - `dot?: boolean` (renders the 6px status indicator dot used for Active Part / Active Drawing).
5. `ToolbarGroup.tsx`:
   - Standardized bordered pill group (`flex items-center gap-1 rounded bg-surface-canvas px-1 py-0.5 ring-1 ring-border-subtle`) with optional `role="group"` and `aria-label`.
6. `PanelHeader.tsx`:
   - Standardized sidebar header (`border-b border-border-subtle px-3 py-2.5`) with uppercase title, optional `count` pill, optional `actions` slot, and optional `subtitle` slot.
7. `EmptyState.tsx`:
   - Standardized centered card (`max-w-sm` or `max-w-lg`) with icon container, title, description, and `actions` slot.

#### C. Unified Confirmation Utility (`src/lib/confirm.ts`)
- Export `confirmAction(message: string, options?: { title?: string; kind?: "info" | "warning" | "error" }): Promise<boolean>`
- Calls `@tauri-apps/plugin-dialog`'s `confirm` and falls back cleanly to `window.confirm(message)` outside the Tauri runtime.
- Unit tested in `src/lib/__tests__/confirm.test.ts` (mocking Tauri dialog success + fallback behavior).

#### D. Targeted Drift Fixes (Surgical)
1. **`src/App.tsx` Welcome Screen**: Replace the `Q1` text placeholder box with `<QOneLogo className="h-7 w-7 text-ink-primary" />` inside the logo tile, and use `EmptyState` / `Button` primitives for the welcome card and "No Drawing Attached / Active" empty state.
2. **`src/App.tsx` Confirmations**: Replace both local `confirmDestructive` and synchronous `confirmDiscardIfDirty` with `confirmAction` from `src/lib/confirm.ts` (making `confirmDiscardIfDirty` `async` and awaiting it in `handleNewProject`, `handleOpenPdf`, `handleOpenProject`, `handleCloseProject`).
3. **Preserve all uncommitted work**: Keep all current uncommitted edits in `src/App.tsx`, `src/components/BalloonOverlay.tsx`, `src/components/DimensionSidebar.tsx`, `src/components/PdfViewer.tsx`, `src/index.css`, and `src/lib/*` intact.

---

## 6. Verification Plan

1. **Unit tests**: `npm test` — all existing 33 Vitest tests pass, plus new unit tests for `src/lib/confirm.ts`.
2. **Typecheck & production build**: `npm run build` (`tsc && vite build`) passes cleanly with Tailwind v4 `@theme` tokens and all `src/components/ui/` primitives compiled.
3. **Rule file integrity**: Verify all cross-referenced paths in `AGENTS.md`, `src/components/AGENTS.md`, `.github/copilot-instructions.md`, and `.github/instructions/ui.instructions.md` exist on disk and stay within line/size budgets.
4. **Live app check**: Confirm no runtime/render regressions in the Q-One UI.

---

## 7. Left to the Builder

- Exact class-name concatenation helper (inline template literals or a tiny `cn(...parts)` utility in `src/components/ui/cn.ts` with zero dependencies).
- Exact TypeScript prop types and `forwardRef` / React 19 `ref`-as-prop style for `src/components/ui/*`.
- Exact markdown formatting and example code snippets inside `docs/standards/*.md`.
