# Q-One UI Components Rules

Applies to all files under `src/components/`.

- **Read first**: [docs/standards/ui-design-system.md](../../docs/standards/ui-design-system.md) and [docs/standards/ux-interaction-patterns.md](../../docs/standards/ux-interaction-patterns.md).
- **Reuse primitives**: Import `Button`, `IconButton`, `Input`, `Badge`, `ToolbarGroup`, `PanelHeader`, `EmptyState`, and `cn` from `./ui` (`src/components/ui/index.ts`) before writing raw Tailwind classes.
- **Use semantic tokens**: Prefer `bg-surface-*`, `border-border-*`, `text-ink-*`, and `accent-*` tokens from `src/index.css` `@theme`.
- **Input contrast**: Use `<Input surface="on-chrome" />` inside `surface-chrome` panels, `<Input surface="on-canvas" />` inside `surface-canvas` cards, and `<Input surface="inline" />` for borderless inline titles.
- **Tauri & UX invariants**:
  - Pointer events only for drag interactions (no HTML5 `draggable`).
  - Guard all keyboard handlers for IME (`e.nativeEvent.isComposing`) and form targets.
  - Use `confirmAction()` from `../lib/confirm` for destructive/discard confirmations.
  - Use `<QOneLogo />` for brand marks and `lucide-react` for all UI icons.
- **Keep `src/components/ui/` lean**: Only extract a new primitive when reused across 2+ distinct modules; keep domain widgets in their feature files.
