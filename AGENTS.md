# Q-One Engineering & UI/UX Standards

Q-One is a desktop Quality Management workstation built with **Tauri v2**, **React 19**, **TypeScript 5.8 (strict)**, **Tailwind CSS v4**, **`lucide-react`**, **`pdfjs-dist`**, and **Vitest**.

## Repository Map

- `src/App.tsx` — Top-level shell (`MenuBar`, `ActivityBar`, module router, project state, dirty tracking)
- `src/components/` — Feature modules (`ProjectWorkspace`, `PdfViewer`, `DimensionSidebar`, `DrawingListSidebar`, `BalloonOverlay`, `QOneLogo`)
- `src/components/ui/` — Shared zero-dependency UI primitives (`Button`, `IconButton`, `Input`, `Badge`, `ToolbarGroup`, `PanelHeader`, `EmptyState`, `cn`)
- `src/index.css` — Tailwind v4 `@theme` semantic design tokens and PDF `.textLayer` CSS
- `src/lib/` — Pure domain logic, state helpers, Tauri bridge (`tauriApi.ts`), and unified `confirmAction` (`confirm.ts`), with Vitest tests in `src/lib/__tests__/`
- `src-tauri/` — Rust backend & `.qone` archive persistence
- `docs/standards/` — Canonical UI/UX design system and development workflow specs

## Canonical Standards (Read Before Designing or Editing)

- **Visual Design System**: [docs/standards/ui-design-system.md](docs/standards/ui-design-system.md)
- **UX & Interaction Patterns**: [docs/standards/ux-interaction-patterns.md](docs/standards/ux-interaction-patterns.md)
- **Development Workflow & Self-Review**: [docs/standards/development-workflow.md](docs/standards/development-workflow.md)

## Non-Negotiable Guardrails

1. **Monochrome Precision Aesthetic**: Use semantic `@theme` tokens (`surface-*`, `border-*`, `ink-*`, `accent-*`) in `src/index.css` and shared primitives from `src/components/ui/`. Primary CTAs are monochrome (`<Button variant="primary" />`); never add decorative gradients or colored primary buttons.
2. **Strict Semantic Accents**: `blue` = selection/focus/placement, `emerald` = active part/drawing & success toast, `amber` = unsaved dirty dot / `Latest` badge / GD&T datums, `rose` = destructive hover / error / default dimension boxes, `purple` = point markers.
3. **Monospace Technical Data**: Always use `font-mono` for IDs, part numbers, revisions, tolerances, coordinates, filenames, counts, percentages, and shortcut hints.
4. **Zero New UI Libraries**: Stay on React + Tailwind v4 + `lucide-react`. Do not install external UI component kits without an approved spec.
5. **Tauri Pointer Drag-and-Drop**: Never use HTML5 `draggable`/`onDragStart` for in-app reordering or canvas dragging; use pointer events with a 4–6px threshold.
6. **Keyboard & IME Safety**: Always guard `keydown` handlers against `isComposing`, modifier keys, and `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` targets. Inline editors confirm on `⌘/Ctrl+Enter` and cancel on `Esc`.
7. **Unified Confirmations**: All destructive actions and dirty-state discards must use `confirmAction()` from `src/lib/confirm.ts` (never raw `window.confirm` or unguarded dialogs).
8. **Brand Mark**: Render `<QOneLogo />` for any Q-One brand surface (never a text `Q1` placeholder).
9. **Pure Logic + TDD**: Keep pure logic in `src/lib/*.ts` with Vitest tests in `src/lib/__tests__/`. Keep UI copy, code comments, and docs in English.
10. **Progressive Migration**: All new UI must follow these standards; migrate legacy components opportunistically when touched without unrequested big-bang rewrites.

## Mandatory Verification Commands

Run before declaring any task complete:
```bash
npm test
npm run build
```
If `src-tauri/` was modified, also run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
