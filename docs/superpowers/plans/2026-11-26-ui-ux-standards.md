# Q-One UI/UX Design System & Cross-AI-Client Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Q-One's canonical UI/UX design system, cross-AI-client rule wiring (Codex, GitHub Copilot, Antigravity), Tailwind v4 semantic tokens, lean zero-dependency UI primitives, unified confirmation helper, and targeted drift fixes.

**Architecture:** Three layered deliverables: (1) Tailwind v4 `@theme` semantic tokens in `src/index.css`, 7 zero-dependency primitives in `src/components/ui/`, and `src/lib/confirm.ts` with targeted drift fixes in `src/App.tsx`; (2) three canonical specification documents under `docs/standards/`; (3) zero-duplication AI client rule adapters (`AGENTS.md`, `src/components/AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/ui.instructions.md`). Existing large feature components migrate opportunistically rather than in a big-bang rewrite.

**Tech Stack:** Tauri v2, React 19, TypeScript 5.8 (strict), Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, Vitest.

**Spec:** [2026-11-26-ui-ux-standards-design.md](file:///Users/ashton/git/ashton2914/Q-One/docs/superpowers/specs/2026-11-26-ui-ux-standards-design.md)

## Global Constraints

- **Zero new runtime or dev dependencies**: Do not modify `package.json` or `package-lock.json`.
- **Language**: All standards docs, AI rule files, code comments, and UI copy must be in **English**.
- **Preserve uncommitted work**: Existing uncommitted edits on `main` (PDF viewer tool bar, `.textLayer` CSS, annotation sorting/reordering) must remain intact; never run `git checkout --`, `git reset`, or `git add -A`.
- **Context budgets**: `AGENTS.md` ≤ 150 lines (~6 KB); `src/components/AGENTS.md` ≤ 50 lines; `.github/copilot-instructions.md` ≤ 50 lines; `.github/instructions/ui.instructions.md` ≤ 40 lines; no frontmatter in `AGENTS.md` files.
- **No big-bang rewrites**: Do not refactor `MenuBar.tsx`, `ActivityBar.tsx`, `ProjectWorkspace.tsx`, `DrawingListSidebar.tsx`, `DimensionSidebar.tsx`, or `PdfViewer.tsx` beyond what is explicitly scoped below.
- **Verification**: `npm test` and `npm run build` (`tsc && vite build`) must pass cleanly after code changes.

## Review Focus

- `confirmAction()` called in a non-Tauri browser preview (where `@tauri-apps/plugin-dialog` rejects) must silently fall back to `window.confirm(message)` instead of throwing an unhandled rejection.
- `confirmAction()` called in a headless/non-DOM environment (where `window.confirm` is unavailable) must return `false` safely rather than throwing `ReferenceError`.
- `confirmDiscardIfDirty()` in `src/App.tsx` becoming `async` must be `await`ed at all four call sites (`handleNewProject`, `handleOpenPdf`, `handleOpenProject`, `handleCloseProject`), otherwise a truthy `Promise` would bypass the unsaved-changes guard.
- `Button` and `IconButton` must default `type="button"` so placing them inside a `<form>` never triggers unintended form submission.
- Every relative file path referenced inside `AGENTS.md`, `src/components/AGENTS.md`, `.github/copilot-instructions.md`, and `.github/instructions/ui.instructions.md` must resolve to an existing file on disk so AI clients never hit broken pointers.

---

### Task 1: Tailwind v4 Semantic Design Tokens

**Files:**
- Modify: `src/index.css:1-12`

**Interfaces:**
- Consumes: `@import "tailwindcss";` in `src/index.css`
- Produces: Tailwind v4 `@theme` color tokens generating utility classes:
  - Surfaces: `surface-chrome` (`#0a0a0a`), `surface-canvas` (`#171717`), `surface-raised` (`#262626`), `surface-hover` (`#404040`)
  - Borders: `border-subtle` (`#262626`), `border-control` (`#404040`), `border-focus` (`#737373`)
  - Text (`ink-*`): `ink-primary` (`#f5f5f5`), `ink-secondary` (`#d4d4d4`), `ink-muted` (`#a3a3a3`), `ink-subtle` (`#737373`), `ink-disabled` (`#525252`)
  - Semantic accents: `accent-selection` (`#3b82f6`), `accent-active` (`#34d399`), `accent-warning` (`#fbbf24`), `accent-danger` (`#f43f5e`), `accent-point` (`#c084fc`)

- [ ] **Step 1: Add `@theme` semantic tokens to `src/index.css`**

Insert the `@theme` block immediately after `@import "tailwindcss";` in `src/index.css` with the exact hex values listed in Interfaces above. Leave all existing `html, body, #root` and `.textLayer` rules untouched.

- [ ] **Step 2: Verify TypeScript and Tailwind v4 production build**

Run: `npm run build`
Expected: `tsc` and `vite build` exit 0 with CSS bundle emitted cleanly.

---

### Task 2: Unified Confirmation Utility (`src/lib/confirm.ts`)

**Files:**
- Create: `src/lib/confirm.ts`
- Test: `src/lib/__tests__/confirm.test.ts`

**Interfaces:**
- Consumes: `confirm` from `@tauri-apps/plugin-dialog`
- Produces:
  - `export interface ConfirmActionOptions { title?: string; kind?: "info" | "warning" | "error"; }`
  - `export async function confirmAction(message: string, options?: ConfirmActionOptions): Promise<boolean>`

- [ ] **Step 1: Write the failing unit tests in `src/lib/__tests__/confirm.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/confirm.test.ts`
Expected: FAIL because `../confirm` does not exist yet.

- [ ] **Step 3: Implement `confirmAction` in `src/lib/confirm.ts`**

Implement `ConfirmActionOptions` and `confirmAction(message, options)` calling `confirm(message, { title: options?.title, kind: options?.kind ?? "warning" })` inside `try/catch`, falling back to `typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : false`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/confirm.test.ts`
Expected: 4/4 tests PASS.

---

### Task 3: Lean UI Primitives (`src/components/ui/`)

**Files:**
- Create: `src/components/ui/cn.ts`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/IconButton.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/ToolbarGroup.tsx`
- Create: `src/components/ui/PanelHeader.tsx`
- Create: `src/components/ui/EmptyState.tsx`
- Create: `src/components/ui/index.ts`
- Test: `src/components/ui/__tests__/cn.test.ts`

**Interfaces:**
- Consumes: Task 1 `@theme` tokens in `src/index.css`
- Produces (exported from `src/components/ui/index.ts`):
  - `cn(...values: Array<string | false | null | undefined>): string`
  - `Button`: `ButtonProps` (`variant?: "primary" | "secondary" | "ghost" | "danger" | "dashed"`, `size?: "xs" | "sm" | "md"`, `type` defaults to `"button"`)
  - `IconButton`: `IconButtonProps` (`variant?: "ghost" | "subtle" | "danger"`, `size?: "xs" | "sm"`, required `aria-label: string`, `type` defaults to `"button"`)
  - `Input`: `InputProps` (`surface?: "on-chrome" | "on-canvas" | "inline"`, `mono?: boolean`, forwards `ref`)
  - `Badge`: `BadgeProps` (`tone?: "neutral" | "active" | "accent" | "warning" | "danger" | "point"`, `dot?: boolean`)
  - `ToolbarGroup`: `ToolbarGroupProps` (native `div` props, standardized bordered pill container)
  - `PanelHeader`: `PanelHeaderProps` (`title: string`, `count?: number`, `subtitle?: ReactNode`, `actions?: ReactNode`, `className?: string`)
  - `EmptyState`: `EmptyStateProps` (`icon?: ReactNode`, `title: string`, `description: ReactNode`, `actions?: ReactNode`, `size?: "sm" | "lg"`, `className?: string`)

- [ ] **Step 1: Write failing test for `cn` in `src/components/ui/__tests__/cn.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { cn } from "../cn";

describe("cn", () => {
  it("joins truthy class strings and drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b c")).toBe("a b c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/__tests__/cn.test.ts`
Expected: FAIL because `../cn` does not exist yet.

- [ ] **Step 3: Implement `cn.ts` and the 7 UI primitives + `index.ts`**

Implement each file using Task 1's semantic tokens (`bg-surface-chrome`, `bg-surface-canvas`, `bg-surface-raised`, `hover:bg-surface-hover`, `border-border-subtle`, `border-border-control`, `focus:border-border-focus`, `text-ink-primary`, `text-ink-secondary`, `text-ink-muted`, `text-ink-subtle`, `disabled:text-ink-disabled`) and exact visual rules from spec Section 5.1 & 5.3:
- `Button`: `primary` = monochrome `bg-neutral-100 text-neutral-950 hover:bg-white`; `secondary` = `bg-surface-raised text-ink-secondary hover:bg-surface-hover hover:text-white`; `ghost` = `text-ink-secondary hover:bg-surface-raised hover:text-white`; `danger` = `text-ink-muted hover:bg-rose-950/70 hover:text-rose-300`; `dashed` = `border border-dashed border-border-control bg-surface-canvas/70 text-ink-primary hover:border-border-focus hover:bg-surface-raised`. Always default `type="button"`.
- `IconButton`: compact square icon button (`xs` = `p-0.5`, `sm` = `p-1`), always default `type="button"`, required `aria-label`.
- `Input`: `on-chrome` uses `bg-surface-canvas border-border-control`, `on-canvas` uses `bg-surface-chrome border-border-control`, `inline` uses transparent border/bg until hover/focus; `mono` adds `font-mono`.
- `Badge`: `rounded-full` pill with tone-matched text/bg/ring; optional `dot` renders a `h-1.5 w-1.5 rounded-full` indicator.
- `ToolbarGroup`: `flex items-center gap-1 rounded bg-surface-canvas px-1 py-0.5 ring-1 ring-border-subtle`.
- `PanelHeader`: `border-b border-border-subtle px-3 py-2.5` with `text-xs font-semibold uppercase tracking-wider text-ink-secondary`, optional `count` pill, optional `actions`, optional `subtitle`.
- `EmptyState`: centered dark card (`rounded-xl border border-border-subtle bg-surface-chrome/90 text-center shadow-xl`, `size="sm"` → `max-w-sm p-6`, `size="lg"` → `max-w-lg p-8`) with icon slot, heading, description, and actions row.
- `index.ts`: re-export all 7 components, their prop types, and `cn`.

- [ ] **Step 4: Run unit tests and typecheck/build**

Run: `npx vitest run src/components/ui/__tests__/cn.test.ts && npm run build`
Expected: `cn.test.ts` PASS and `tsc && vite build` exit 0.

---

### Task 4: Targeted Drift Fixes in `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes:
  - `confirmAction` from `./lib/confirm` (Task 2)
  - `Button`, `EmptyState` from `./components/ui` (Task 3)
  - `QOneLogo` from `./components/QOneLogo` (existing)
- Produces: Unified confirmation flow and `<QOneLogo />` welcome card + `EmptyState` usage in `src/App.tsx`.

- [ ] **Step 1: Replace `confirmDestructive` and `confirmDiscardIfDirty` with `confirmAction`**

In `src/App.tsx`:
- Remove the local `confirmDestructive` helper and import `confirmAction` from `./lib/confirm`.
- Update `confirmDiscardIfDirty` to `async (): Promise<boolean>` calling `confirmAction("You have unsaved changes. Discard them and continue?", { title: "Unsaved Changes", kind: "warning" })`.
- Update all 4 call sites (`handleNewProject`, `handleOpenPdf`, `handleOpenProject`, `handleCloseProject`) to `if (!(await confirmDiscardIfDirty())) return;`.
- Update `handleDeletePart`, `handleDetachPdf`, and `handleDeleteDimension` to call `confirmAction(message, { title, kind: "warning" })`.

- [ ] **Step 2: Replace welcome screen `Q1` placeholder with `<QOneLogo />` and adopt `EmptyState` + `Button`**

In `src/App.tsx`:
- Import `QOneLogo` from `./components/QOneLogo` and `{ Button, EmptyState }` from `./components/ui`.
- Replace the `!project` welcome screen markup with `<EmptyState size="lg" ... />` using `<QOneLogo className="h-7 w-7 text-ink-primary" />` inside the logo tile and `<Button>` (`primary` for `New Project`, `secondary` for `Open PDF Drawing` and `Open Project (.qone)`).
- Replace the `!activeDrawing || !pdfBytes` empty state card in the `Drawing` module with `<EmptyState size="sm" ... />` and `<Button>`.

- [ ] **Step 3: Run full test suite and build**

Run: `npm test && npm run build`
Expected: All Vitest tests PASS (38/38) and `tsc && vite build` exit 0.

---

### Task 5: Canonical Standards Documentation (`docs/standards/`)

**Files:**
- Create: `docs/standards/ui-design-system.md`
- Create: `docs/standards/ux-interaction-patterns.md`
- Create: `docs/standards/development-workflow.md`

**Interfaces:**
- Consumes: Spec Section 5.1, Task 1 tokens, Task 2 `confirmAction`, Task 3 `src/components/ui/` primitives.
- Produces: Three English canonical reference documents consumed by `AGENTS.md` and AI client adapters in Task 6.

- [ ] **Step 1: Write `docs/standards/ui-design-system.md`**

Document in English:
1. Design Philosophy (Monochrome Precision Engineering Workstation)
2. Surface & Elevation Hierarchy + exact `@theme` token table + Input Contrast Rule (`on-chrome` vs `on-canvas` vs `inline`)
3. Border & Text (`ink-*`) Hierarchy tables
4. Primary CTA & Semantic Accent Matrix (`neutral-100` CTA, `blue` selection/placement, `emerald` active/success, `amber` dirty/latest/datum, `rose` destructive/error/default box, `purple` point marker)
5. Typography & Compact Desktop Density (sans vs mandatory `font-mono` fields, 9px–18px scale)
6. Layout Shell Anatomy (`MenuBar` 36px, `ActivityBar` 48px, sub-toolbar 40px, sidebar 320px, z-index contract `z-10`–`z-50`)
7. Iconography (`lucide-react` sizing) & `<QOneLogo />` Brand Mark rule
8. Reusable Primitives Catalog (`src/components/ui/` API summary)
9. Forbidden Anti-Patterns

- [ ] **Step 2: Write `docs/standards/ux-interaction-patterns.md`**

Document in English:
1. Module & Active-Entity Mental Model (`Project` → `Drawing` → future modules)
2. Inline Editing Lifecycle (auto-open & focus, `⌘/Ctrl+Enter` confirm, `Esc` revert/cancel, mandatory `e.nativeEvent.isComposing` IME guard)
3. Keyboard Shortcuts Hygiene (modifier guards, form/contentEditable guards, monospace hints + `title`/`aria-label`)
4. Pointer-Based Drag & Drop (Tauri WebView contract: no HTML5 DnD, 4–6px threshold, pointer capture/window listeners, blue drop indicator, post-drag click suppression)
5. Canvas & Viewport Controls (pan, `⌘/Ctrl+Wheel` zoom, `ToolbarGroup` controls)
6. Destructive Confirmations & Unsaved-Changes Guard (`confirmAction()` in `src/lib/confirm.ts`, cascading impact copy, hover-revealed destructive icons with `focus:opacity-100`)
7. Notifications (floating top-right toast timing), Mode Banners (`Esc` + Cancel), and Empty States (actionable 1-click CTA)

- [ ] **Step 3: Write `docs/standards/development-workflow.md`**

Document in English:
1. Standard Feature & UI Development Flow (Read Standards → Reuse-First Check → Pure Logic Separation in `src/lib/` + Vitest → Build & Verify → UI/UX Self-Review Checklist)
2. Verification Gate (`npm test`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` when Rust changes)
3. UI/UX Consistency Self-Review Checklist (8 concrete pass/fail checks)
4. Progressive Migration Policy (new features must use tokens/primitives; opportunistically migrate touched blocks in legacy components)
5. Cross-Client Sync Discipline (edit `docs/standards/*` first; keep client adapters thin pointers only)

- [ ] **Step 4: Verify all 3 docs exist and are non-empty**

Run: `wc -l docs/standards/*.md`
Expected: All 3 files exist with clean, focused content.

---

### Task 6: Cross-AI-Client Rule Wiring (Codex, GitHub Copilot, Antigravity)

**Files:**
- Create: `AGENTS.md`
- Create: `src/components/AGENTS.md`
- Create: `.github/copilot-instructions.md`
- Create: `.github/instructions/ui.instructions.md`

**Interfaces:**
- Consumes: Task 5 `docs/standards/*.md`, Task 1–3 code paths (`src/index.css`, `src/components/ui/`, `src/lib/confirm.ts`)
- Produces: Native entrypoints for Codex, GitHub Copilot, and Antigravity with zero duplicated spec prose.

- [ ] **Step 1: Create root `AGENTS.md` (no frontmatter, ≤ 150 lines)**

Include:
- Project identity & stack summary (Q-One, Tauri v2 + React 19 + TS + Tailwind v4 + `lucide-react` + Vitest)
- Repository map (`src/components/`, `src/components/ui/`, `src/lib/`, `src-tauri/`, `docs/standards/`)
- Mandatory standards index pointing to `docs/standards/ui-design-system.md`, `docs/standards/ux-interaction-patterns.md`, and `docs/standards/development-workflow.md`
- Top 8 non-negotiable UI/UX & engineering guardrails (one bullet each)
- Verification commands (`npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`)

- [ ] **Step 2: Create `src/components/AGENTS.md` (no frontmatter, ≤ 50 lines)**

Concise hierarchical UI directory rule for Codex & Antigravity:
- Reuse `src/components/ui/` primitives and `src/index.css` `@theme` tokens first.
- Follow `docs/standards/ui-design-system.md` and `docs/standards/ux-interaction-patterns.md`.
- Always guard keyboard handlers for IME (`isComposing`) and form inputs, use pointer events for drag interactions, use `confirmAction` from `src/lib/confirm.ts`, and use `<QOneLogo />` for brand marks.

- [ ] **Step 3: Create `.github/copilot-instructions.md` (≤ 50 lines) and `.github/instructions/ui.instructions.md` (≤ 40 lines)**

- `.github/copilot-instructions.md`: Thin workspace entrypoint pointing GitHub Copilot to `AGENTS.md` and `docs/standards/*`, listing the core verification commands and non-negotiable rules without duplicating spec prose.
- `.github/instructions/ui.instructions.md`: YAML frontmatter with `applyTo: "src/**/*.{tsx,css}"`, pointing Copilot to `docs/standards/ui-design-system.md`, `docs/standards/ux-interaction-patterns.md`, `src/index.css` `@theme` tokens, and `src/components/ui/`.

- [ ] **Step 4: Verify line counts, byte sizes, path integrity, and full test/build gate**

Run:
```bash
wc -l AGENTS.md src/components/AGENTS.md .github/copilot-instructions.md .github/instructions/ui.instructions.md && npm test && npm run build
```
Expected:
- `AGENTS.md` ≤ 150 lines, `src/components/AGENTS.md` ≤ 50 lines, `.github/copilot-instructions.md` ≤ 50 lines, `.github/instructions/ui.instructions.md` ≤ 40 lines.
- All Vitest tests pass and `tsc && vite build` exits 0.
