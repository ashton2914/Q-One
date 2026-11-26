---
applyTo: "src/**/*.{tsx,css}"
---

# Q-One UI & UX Standards (Scoped)

When editing React components or CSS in `src/`:
- Follow [docs/standards/ui-design-system.md](../../docs/standards/ui-design-system.md) and [docs/standards/ux-interaction-patterns.md](../../docs/standards/ux-interaction-patterns.md).
- Reuse primitives from `src/components/ui/` (`Button`, `IconButton`, `Input`, `Badge`, `ToolbarGroup`, `PanelHeader`, `EmptyState`, `cn`) and `@theme` tokens from `src/index.css`.
- Keep primary CTAs monochrome (`<Button variant="primary" />`) and preserve strict semantic accent roles (`blue`, `emerald`, `amber`, `rose`, `purple`).
- Use `font-mono` for IDs, tolerances, coordinates, filenames, counts, percentages, and shortcut hints.
- Use `<QOneLogo />` for brand surfaces, `lucide-react` for icons, pointer events for dragging, IME/form guards for shortcuts, and `confirmAction()` from `src/lib/confirm.ts` for confirmations.
- Complete the 8-item UI/UX self-review checklist in [docs/standards/development-workflow.md](../../docs/standards/development-workflow.md) before finishing.
