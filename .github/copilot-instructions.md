# GitHub Copilot Instructions — Q-One

Follow the canonical project standards in [AGENTS.md](../AGENTS.md) and `docs/standards/`:
- Visual Design System: [docs/standards/ui-design-system.md](../docs/standards/ui-design-system.md)
- UX & Interaction Patterns: [docs/standards/ux-interaction-patterns.md](../docs/standards/ux-interaction-patterns.md)
- Development Workflow & Self-Review: [docs/standards/development-workflow.md](../docs/standards/development-workflow.md)

## Key Guardrails
- Keep UI copy, code comments, and docs in **English**.
- Reuse `src/components/ui/` primitives and `src/index.css` `@theme` tokens (`surface-*`, `border-*`, `ink-*`, `accent-*`); do not add third-party UI libraries.
- Use pointer events (never HTML5 DnD), guard keyboard handlers for IME (`isComposing`) and form inputs, and use `confirmAction()` from `src/lib/confirm.ts` for destructive/discard prompts.
- Separate pure logic into `src/lib/*.ts` with Vitest tests in `src/lib/__tests__/`.
- Migrate legacy components opportunistically when touched; avoid unrequested big-bang rewrites.

## Verification
Before completing changes, run `npm test` and `npm run build` (plus `cargo test --manifest-path src-tauri/Cargo.toml` when `src-tauri/` changes).
