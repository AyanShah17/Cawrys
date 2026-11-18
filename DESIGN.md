# Cawrys Design System (`DESIGN.md`)

Grounded in the `pbakaus/impeccable` UI craftsmanship standard (Operate mode: precision, scanability, restrained surface contrast, and earned familiarity).

---

## 1. Visual Philosophy & Anti-Slop Guardrails

- **Surface Mode**: **Operate** — industrial engineering dashboard, playbook execution DAGs, and full-viewport conversational intelligence. The UI stays out of the way of work while surfacing live telemetry and document provenance cleanly.
- **Zero Emojis**: Strictly `0` emoji or decorative unicode characters across all UI components, CSS, Python services, and LLM output (enforced by automated test gates).
- **Single Elevation Declaration**: Surfaces declare either a crisp hairline border or a restrained ambient shadow (`0 1px 2px rgba(15,23,42,0.04)`) rather than double-stacking ghost card shadows.
- **No AI Slop**: Zero gratuitous gradients on headings, zero nested card-in-card boilerplate, zero decorative side accent bars, zero neon cyan-on-dark cliches, and zero middle-screen suggestion clutter in Agent Chat.

---

## 2. OKLCH Color & Contrast System (`apps/web/app/globals.css`)

| Token | Value | Role |
| :--- | :--- | :--- |
| `--surface-canvas` | `oklch(0.968 0.004 260)` | Soft cool-tinted canvas backdrop (`#f4f5f8`) |
| `--surface-card` | `oklch(1 0 0)` | Primary card & chat canvas surface |
| `--surface-elevated` | `oklch(0.992 0.002 260)` | Assistant response & elevated panel surface (`#fcfcfd`) |
| `--surface-obsidian` | `oklch(0.175 0.006 260)` | Sidebar, top pill navbar, and AI Mode FAB |
| `--ink-primary` | `oklch(0.18 0.014 260)` | Primary copy & headings (`>= 12:1` on light) |
| `--ink-secondary` | `oklch(0.41 0.012 260)` | Subtitles, metadata & table headers (`>= 4.5:1` WCAG AA) |
| `--ink-muted` | `oklch(0.49 0.01 260)` | Supporting hints & placeholders (`>= 4.5:1` WCAG AA) |
| `--border-subtle` | `oklch(0.9 0.006 260)` | Hairline borders & structural dividers |
| `--border-strong` | `oklch(0.81 0.008 260)` | Interactive control & focus boundaries |

### Semantic Status & Tinted Hue Rule
- Never place raw gray text on colored badges; always pair saturated darkened `-800` foreground ink with `-50` tinted backgrounds and `-200` borders (`text-emerald-800 bg-emerald-50 border-emerald-200`, `text-amber-800 bg-amber-50 border-amber-200`, `text-rose-800 bg-rose-50 border-rose-200`, `text-sky-800 bg-sky-50 border-sky-200`).
- **Persistence Indicators**: `bg-emerald-600` for Local SQLite/Filesystem mode; `bg-indigo-600` for Neon Cloud Lakebase Postgres + S3 Object Storage.

---

## 3. Typography & Optical Hierarchy

- **Sans Stack (`--font-sans`)**: `"Plus Jakarta Sans", "Geist", "Inter Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` with optical alternate glyphs (`font-feature-settings: "cv02", "cv03", "cv04", "cv11"`). Does not rely on runtime Google Fonts fetches so offline builds never stall.
- **Mono Stack (`--font-mono`)**: `"JetBrains Mono", "Geist Mono", "SF Mono", ui-monospace, monospace` reserved strictly for code blocks, identifiers, model IDs, and numerical latency telemetry.
- **Scale & Tracking**:
  - Page Titles (`PageHeader`): `1.625rem` (`26px`), line-height `1.2`, tracking `-0.025em`, balanced wrapping (`text-wrap: balance`).
  - KPI Metrics (`Stat`): `1.75rem`–`1.875rem`, bold, `tracking-[-0.02em]`, `tabular-nums`.
  - Section Labels & Table Headers: `0.75rem`, uppercase `tracking-[0.06em]`, `font-semibold`.
  - Body Measure: Centered `max-w-3xl` in chat conversation feeds for comfortable reading (`65–75ch`).

---

## 4. Layout Rhythm, Browser Surfaces & Motion

- **Full-Page Chat Canvas (`/chat`)**:
  - Locked `h-screen w-screen overflow-hidden` frame in `LayoutWrapper` with responsive device framing (`p-2 sm:p-3.5 md:p-4 lg:p-5`).
  - Collapsible dark conversation history sidebar toggled via the header button `[||]`.
  - Corner Floating Action Button (FAB) in `TopNav` replaces the horizontal navbar across AI Mode while keeping `/connectors`, `/marketplace`, and `/settings` vertically scrollable (`min-h-screen`, `pt-14`).
- **Composer Controls**:
  - Contains strictly `+` upload popover, Local/Neon Persistence Capsule, model-name-only selector (`{activeModelShort}` — provider tabs shown inside dropdown), and send button (no "Auto"/shield badge, no center prompt cards).
- **Browser Surfaces & Reduced Motion**:
  - Custom palette-tinted `::selection` highlight and `caret-color`.
  - Cross-browser invisible scrollbars (`::-webkit-scrollbar { display: none }`, `scrollbar-width: none`).
  - Exponential ease-out transitions (`--ease-out-quart: cubic-bezier(0.22, 1, 0.36, 1)`) at `150–200ms`, wrapped in `@media (prefers-reduced-motion: reduce)` fallbacks.
  - Explicit `focus-visible:ring-2` keyboard focus rings on interactive buttons and links.
