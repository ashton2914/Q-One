# Q-One UI Design System

This document is the canonical visual specification for **Q-One**, a desktop Quality Management workstation built with Tauri v2, React 19, TypeScript, Tailwind CSS v4, and `lucide-react`.

---

## 1. Design Philosophy

**Monochrome Precision Engineering Workstation.**
- High-contrast dark neutral chrome inspired by CAD/IDE tools.
- Crisp 1px borders define structure; avoid decorative drop shadows, gradients, or consumer-style rounded-2xl cards.
- Color is never decorative: chromatic accents are strictly reserved for state, selection, and domain semantics.

---

## 2. Surface & Elevation Hierarchy

All semantic tokens are defined in `src/index.css` via Tailwind v4 `@theme`. Prefer semantic tokens in all new code.

| Token | Utility Examples | Hex / Neutral | Role |
| :--- | :--- | :--- | :--- |
| `--color-surface-chrome` | `bg-surface-chrome` | `#0a0a0a` (`neutral-950`) | `MenuBar`, `ActivityBar`, sidebars, module sub-toolbars (`bg-surface-chrome/90`), elevated popovers/editors |
| `--color-surface-canvas` | `bg-surface-canvas` | `#171717` (`neutral-900`) | Main workspaces (`ProjectWorkspace`, `PdfViewer`, empty/welcome backdrops), toolbar pill groups, cards |
| `--color-surface-raised` | `bg-surface-raised` | `#262626` (`neutral-800`) | Active nav items, secondary buttons, hover fills, count pills |
| `--color-surface-hover` | `hover:bg-surface-hover` | `#404040` (`neutral-700`) | Hover state on secondary buttons and active segmented controls |

### Input Contrast Rule
Editable inputs must always have 1-step depth contrast against their container plus a 1px `border-border-control` border:
- Inside a `surface-chrome` (`#0a0a0a`) container (e.g., sidebars, `InPlacePartEditor`): use `<Input surface="on-chrome" />` (`bg-surface-canvas`).
- Inside a `surface-canvas` (`#171717`) container (e.g., inline edit cards): use `<Input surface="on-canvas" />` (`bg-surface-chrome`).
- Inline title/version edits: use `<Input surface="inline" />` (transparent until hover/focus).

---

## 3. Border & Text (`ink-*`) Hierarchy

### Borders
| Token | Hex / Neutral | Role |
| :--- | :--- | :--- |
| `--color-border-subtle` | `#262626` (`neutral-800`) | Structural dividers (bars, sidebars, section rules, resting cards) |
| `--color-border-control` | `#404040` (`neutral-700`) | Form inputs, popovers, dashed upload zones, resting rings |
| `--color-border-focus` | `#737373` (`neutral-500`) | Focused inputs and active edit card outlines |

### Text (`ink-*`)
| Token | Hex / Neutral | Role |
| :--- | :--- | :--- |
| `--color-ink-primary` | `#f5f5f5` (`neutral-100`) | Headings, active values, primary labels |
| `--color-ink-secondary` | `#d4d4d4` (`neutral-300`) | Control labels, toolbar readouts, resting nav text |
| `--color-ink-muted` | `#a3a3a3` (`neutral-400`) | Field labels, metadata, inactive icons |
| `--color-ink-subtle` | `#737373` (`neutral-500`) | Counts, filenames, empty-state helper copy, shortcut hints |
| `--color-ink-disabled` | `#525252` (`neutral-600`) | Placeholders and disabled controls |

---

## 4. Primary CTA & Semantic Accent Matrix

Do **not** repurpose semantic colors for unrelated meanings.

| Role | Token / Classes | Allowed Usage |
| :--- | :--- | :--- |
| **Primary CTA** | `bg-neutral-100 text-neutral-950 hover:bg-white` (`<Button variant="primary" />`) | Primary actions (`New Project`, `Add Part`, `Done`, `Attach PDF`) — monochrome to match the B1 logo |
| **Selection / Focus / Placement** | `--color-accent-selection` (`#3b82f6` / `blue-500`, `blue-400`) | Active module left rail, selected annotation/box/ring, placing-mode banner, drag-reorder drop indicator |
| **Active Entity / Success** | `--color-accent-active` (`#34d399` / `emerald-400`, `emerald-500`) | Active Part / Active Drawing indicator dot & pill, info/success status toast |
| **Attention / Version / Datum** | `--color-accent-warning` (`#fbbf24` / `amber-400`, `amber-500`) | Unsaved dirty dot, `Latest` drawing star badge, GD&T datum & material-condition highlights |
| **Destructive / Error / Default Box** | `--color-accent-danger` (`#f43f5e` / `rose-500`, `rose-400`, `rose-950`) | Delete/Unlink hover states, error toast/banner, unselected dimension region boxes on PDF |
| **Point Annotation** | `--color-accent-point` (`#c084fc` / `purple-400`, `purple-600`) | Unselected point marker dot & badge on PDF |

---

## 5. Typography & Compact Desktop Density

- **UI Sans**: System sans-serif stack (`src/index.css`).
- **Monospace (`font-mono`) — Mandatory for technical values**: IDs, part numbers, revisions, tolerances, coordinates, filenames, page counts, zoom percentages, and keyboard shortcut hints (`⌘/Ctrl+S`, `C`, `V`).
- **Scale**:
  - `text-xs` (`12px`): Default UI body, buttons, inputs, menu items.
  - `text-[11px]`: Field labels, toolbar readouts, compact buttons (`size="xs"`).
  - `text-[10px]`: Badges, metadata rows, shortcut chips, marker labels.
  - `text-[9px]`: `ActivityBar` labels.
  - `text-sm` (`14px`) / `text-lg` (`18px`): Empty-state and welcome-screen headings only.

---

## 6. Layout Shell Anatomy & Z-Index Contract

- **`MenuBar`**: Fixed `h-9` (36px), `z-40`, left brand mark (`<QOneLogo />` 18px + `Q-One`) + top-level menus, right project name + dirty dot.
- **`ActivityBar`**: Fixed `w-12` (48px), vertical `40×40px` icon+label buttons, 2px `blue-500` left active indicator rail.
- **Module Sub-Toolbar**: Fixed `h-10` (40px), `border-b border-border-subtle bg-surface-chrome/90 px-3`.
- **Module Sidebar**: `w-80` (320px) default (`w-[356px]` for dense multi-column annotation editors), `border-r border-border-subtle bg-surface-chrome`.
- **Z-Index Layers**:
  - `z-10`: PDF selectable `TextLayer`
  - `z-20`: Resting canvas/PDF markers
  - `z-30`: Selected/linked markers & persistent mode banners (e.g., Placing mode)
  - `z-40`: Menus, in-place editors, drag previews, root drop zones
  - `z-50`: Floating status toasts

---

## 7. Iconography & Brand Mark

- Use **`lucide-react`** exclusively for UI icons.
  - `h-3.5 w-3.5` (14px): Buttons, menus, toolbars, list actions.
  - `h-4 w-4` (16px): `ActivityBar` and large welcome CTAs.
  - `h-3 w-3` (12px): Micro-buttons and dense badges.
- Always render the Q-One brand mark via `<QOneLogo />` (`src/components/QOneLogo.tsx`). Never render a text placeholder like `Q1`.

---

## 8. Reusable UI Primitives (`src/components/ui/`)

Import shared primitives from `src/components/ui` instead of hand-writing repeated Tailwind strings:
- `Button` (`variant`: `primary` | `secondary` | `ghost` | `danger` | `dashed`; `size`: `xs` | `sm` | `md`)
- `IconButton` (`variant`: `ghost` | `subtle` | `danger`; `size`: `xs` | `sm`; requires `aria-label`)
- `Input` (`surface`: `on-chrome` | `on-canvas` | `inline`; `mono?: boolean`)
- `Badge` (`tone`: `neutral` | `active` | `accent` | `warning` | `danger` | `point`; `dot?: boolean`)
- `ToolbarGroup` (bordered pill container for segmented controls, page controls, and zoom bars)
- `PanelHeader` (uppercase sidebar title, count pill, optional subtitle and actions)
- `EmptyState` (centered card with icon tile, heading, description, and actions; `size`: `sm` | `lg`)

---

## 9. Forbidden Anti-Patterns

- Decorative gradients, colored primary CTA buttons (e.g. `bg-blue-600` for main CTAs), or `rounded-2xl` consumer cards.
- Hardcoded light-mode backgrounds (`bg-white`, `bg-gray-100`) outside the monochrome primary button hover state.
- Raw `window.alert` / unguarded `window.confirm` calls (always use `confirmAction()` in `src/lib/confirm.ts`).
- Adding third-party UI component libraries without an approved design spec.
