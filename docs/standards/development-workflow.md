# Q-One Standardized Development Workflow

This workflow applies to **all AI coding clients** (Codex, GitHub Copilot, Antigravity) and human contributors working on Q-One.

---

## 1. Standard Feature & UI Development Flow

1. **Read Standards First**: Review `AGENTS.md` and the relevant files in `docs/standards/` before designing or editing.
2. **Reuse-First Audit**:
   - Check `src/components/ui/` and `src/index.css` `@theme` tokens before writing new UI markup.
   - Extract a new primitive into `src/components/ui/` **only** when a generic UI pattern is reused across 2+ distinct modules. Keep domain-specific widgets (e.g., GD&T Feature Control Frame, BOM Node Card) in their owning feature folder.
3. **Pure Logic Separation**:
   - Place pure state transitions, sorting, coordinate transforms, validation, and shortcut resolution in `src/lib/*.ts`.
   - Cover all new pure logic with Vitest unit tests in `src/lib/__tests__/*.test.ts` (TDD: failing test first, then minimal implementation).
4. **Verification Gate (Mandatory Before Claiming Done)**:
   - Run `npm test` (Vitest) — 0 failures.
   - Run `npm run build` (`tsc && vite build`) — exit 0 with zero TypeScript errors.
   - If `src-tauri/` was modified, run `cargo test --manifest-path src-tauri/Cargo.toml` — 0 failures.
5. **UI/UX Self-Review Checklist**: Verify every item in Section 2 before finishing a UI change.

---

## 2. UI/UX Consistency Self-Review Checklist

Before completing any UI or interaction change, verify all 8 gates:
- [ ] **Tokens & Primitives**: New UI uses `@theme` tokens (`surface-*`, `border-*`, `ink-*`, `accent-*`) and `src/components/ui/` primitives where applicable.
- [ ] **Semantic Colors**: Primary CTA is monochrome (`variant="primary"`); `blue`/`emerald`/`amber`/`rose`/`purple` are used strictly for their documented roles.
- [ ] **Monospace Values**: IDs, part numbers, revisions, tolerances, coordinates, filenames, counts, percentages, and shortcut hints use `font-mono`.
- [ ] **Keyboard & IME Guards**: All keyboard handlers guard `isComposing`, modifier keys, and `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` targets.
- [ ] **Tauri Pointer DnD**: Drag interactions use pointer events (never HTML5 `draggable` / `onDragStart`).
- [ ] **Unified Confirmations**: Destructive actions and dirty-state discards call `confirmAction()` from `src/lib/confirm.ts` with explicit impact copy.
- [ ] **States Complete**: Empty, disabled, loading/error, and hover/focus states are handled cleanly.
- [ ] **Brand Mark**: Any Q-One logo renders `<QOneLogo />` (never plain text `Q1`).

---

## 3. Progressive Migration Policy

- **New code**: 100% compliant with `docs/standards/ui-design-system.md`, `docs/standards/ux-interaction-patterns.md`, `@theme` tokens, and `src/components/ui/`.
- **Existing large components** (`App.tsx`, `ProjectWorkspace.tsx`, `DimensionSidebar.tsx`, `PdfViewer.tsx`, `MenuBar.tsx`, `ActivityBar.tsx`, `DrawingListSidebar.tsx`): Migrate touched sections opportunistically when modifying them; do **not** perform unrequested big-bang rewrites.

---

## 4. Cross-Client Rule Sync Discipline

- `docs/standards/*.md` and root `AGENTS.md` are the **single source of truth**.
- Client-specific files (`.github/copilot-instructions.md`, `.github/instructions/ui.instructions.md`, `src/components/AGENTS.md`) must remain **thin pointers** — never copy full design specs into them.
- When a standard changes, update `docs/standards/*` first (and `AGENTS.md` only if a top-level guardrail or file path changed).
