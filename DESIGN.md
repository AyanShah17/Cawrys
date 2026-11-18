# Cawrys Design System (`DESIGN.md`)

Grounded in the `pbakaus/impeccable` UI craftsmanship standard (Operate mode: precision, scanability, restrained surface contrast, and earned familiarity).

---

## 1. Visual Philosophy & Anti-Slop Guardrails

- **Surface Mode**: **Operate** — industrial engineering dashboard, playbook execution DAGs, and full-viewport conversational intelligence. The UI stays out of the way of work while surfacing live telemetry and document provenance cleanly.
- **Zero Emojis**: Strictly `0` emoji or decorative unicode characters across all UI components, CSS, Python services, and LLM output (enforced by automated test gates).
- **Single Elevation Declaration**: Surfaces declare either a crisp 1px hairline border (`border border-neutral-200`) for cards/panels OR a single ambient shadow (`shadow-[0_12px_32px_rgba(15,23,42,0.14)]`) for floating popovers/dialogs—never double-stacking border + soft shadow ghost cards.
- **No Violet / AI Slop**: Zero violet, indigo, or lavender accents in UI chrome (`taste-skill` rule); shift any former indigo accents or status dots to crisp cobalt (`#2563eb` / `blue-600` / `blue-800` on `blue-50`) or obsidian/slate. Zero gratuitous gradients on headings, zero nested card-in-card boilerplate, zero decorative >1px side accent bars, zero neon cyan-on-dark cliches, and zero middle-screen suggestion clutter in Agent Chat.

---

## 2. OKLCH Color & Contrast System (`apps/web/app/globals.css`)

| Token | Value | Role |
| :--- | :--- | :--- |
| `--surface-canvas` | `oklch(0.968 0.004 260)` | Soft cool-tinted canvas backdrop (`#f4f5f8`) |
| `--surface-card` | `oklch(1 0 0)` | Primary card & chat canvas surface |
| `--surface-elevated` | `oklch(0.992 0.002 260)` | Assistant response & elevated panel surface (`#fcfcfd`) |
| `--surface-obsidian` | `oklch(0.175 0.006 260)` | Sidebar, top pill navbar, primary CTA, and AI Mode FAB |
| `--ink-primary` | `oklch(0.18 0.014 260)` | Primary copy & headings (`>= 12:1` on light) |
| `--ink-secondary` | `oklch(0.41 0.012 260)` | Subtitles, metadata & table headers (`>= 4.5:1` WCAG AA) |
| `--ink-muted` | `oklch(0.49 0.01 260)` | Supporting hints & placeholders (`>= 4.5:1` WCAG AA; `neutral-600`/`neutral-500` floor) |
| `--border-subtle` | `oklch(0.9 0.006 260)` | Hairline borders & structural dividers |
| `--border-strong` | `oklch(0.81 0.008 260)` | Interactive control & focus boundaries |
| `--accent-cobalt` | `oklch(0.546 0.215 262.88)` | Crisp cobalt accent (`#2563eb` / `blue-600`) replacing legacy indigo |
| `--accent-cobalt-ink` | `oklch(0.424 0.199 265.64)` | Darkened cobalt foreground (`blue-800` on `blue-50` >= 4.5:1 AA) |
| `--focus-ring` | `oklch(0.18 0.014 260)` | Instant `focus-visible:ring-2` obsidian ring |

### Semantic Status & Tinted Hue Rule
- Never place raw gray text on colored badges; always pair saturated darkened `-800` foreground ink with `-50` tinted backgrounds and `-200` borders (`text-emerald-800 bg-emerald-50 border-emerald-200`, `text-amber-800 bg-amber-50 border-amber-200`, `text-rose-800 bg-rose-50 border-rose-200`, `text-sky-800 bg-sky-50 border-sky-200`, `text-blue-800 bg-blue-50 border-blue-200`).
- **Persistence Indicators**: `bg-emerald-600` for Local SQLite/Filesystem mode; `bg-blue-600` (`#2563eb` crisp cobalt) for Neon Cloud Lakebase Postgres + S3 Object Storage.
- **AA Text Floor**: On light surfaces (`white`, `neutral-50`), body/secondary/placeholder copy must never drop below `neutral-500` (placeholders/hints) or `neutral-600` (metadata/descriptions/headers). Never use `neutral-400` for readable text or placeholders on white.

---

## 3. Shared Component & Radius Contract (`apps/web/components/ui/*`)

- **Radii Scale**:
  - Cards, stats & dialogs: `rounded-2xl` (`16px`)
  - Inputs, selects & notice callouts: `rounded-xl` (`12px`)
  - Buttons, pills, badges & segmented tab controls: `rounded-full`
- **Unified Control Heights**:
  - Default `Button`, `Input`, `TabsList`, `btnCls`, `btnGhostCls`, `inputCls`: `h-9` (`36px`).
  - Compact `Button size="sm"`, `TabsTrigger`, header pill tabs: `h-8` (`32px`) / `h-7` (`28px`).
  - Large `Button size="lg"`: `h-10` (`40px`).
- **Exports (`@/components/ui/kit`)**:
  - `PageHeader`, `Card`, `Stat`, `Pill`, `Empty`, `Notice`, `tableCls`, `thCls`, `tdCls`, `inputCls`, `btnCls`, `btnGhostCls`, plus re-exports of `Button`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `Badge`, `Input`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Separator`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`.

---

## 4. Typography & Optical Hierarchy

- **Sans Stack (`--font-sans`)**: `"Plus Jakarta Sans", "Geist", "Inter Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` with optical alternate glyphs (`font-feature-settings: "cv02", "cv03", "cv04", "cv11"`). Does not rely on runtime Google Fonts fetches so offline builds never stall.
- **Mono Stack (`--font-mono`)**: `"JetBrains Mono", "Geist Mono", "SF Mono", ui-monospace, monospace` reserved strictly for code blocks, identifiers, model IDs, and numerical latency telemetry.
- **Scale & Tracking**:
  - Page Titles (`PageHeader`): `1.625rem` (`26px`), line-height `1.2`, tracking `-0.025em`, balanced wrapping (`text-wrap: balance`).
  - KPI Metrics (`Stat`): `1.75rem`–`1.875rem`, bold, `tracking-[-0.02em]`, `tabular-nums`.
  - Section Labels & Table Headers: `0.75rem`, uppercase `tracking-[0.06em]`, `font-semibold`.
  - Body Measure: Centered `max-w-3xl` in chat conversation feeds for comfortable reading (`65–75ch`).

---

## 5. Layout Rhythm, Browser Surfaces & Motion

- **Full-Page Chat Canvas (`/chat`)**:
  - Locked `h-screen w-screen overflow-hidden` frame in `LayoutWrapper` with responsive device framing (`p-2 sm:p-3.5 md:p-4 lg:p-5`).
  - Collapsible dark conversation history sidebar toggled via the header button `[||]`.
  - Corner Floating Action Button (FAB) in `TopNav` replaces the horizontal navbar across AI Mode while keeping `/connectors`, `/marketplace`, and `/settings` vertically scrollable (`min-h-screen`, `pt-14`).
- **Composer Controls**:
  - Contains strictly `+` upload popover, Local/Neon Persistence Capsule, model-name-only selector (`{activeModelShort}` — provider tabs shown inside dropdown), and send button (no "Auto"/shield badge, no center prompt cards).
- **Browser Surfaces & Reduced Motion**:
  - Custom cobalt-tinted `::selection` highlight, `caret-color`, and `text-underline-offset: 0.18em`.
  - Cross-browser invisible scrollbars (`::-webkit-scrollbar { display: none }`, `scrollbar-width: none`).
  - Exponential ease-out transitions (`--ease-out-quart: cubic-bezier(0.22, 1, 0.36, 1)`) at `150–200ms` (`duration-150 ease-out-quart`), wrapped in `@media (prefers-reduced-motion: reduce)` fallbacks.
  - Tactile active state (`active:scale-[0.98]`) and instant `focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2` keyboard focus rings on interactive buttons, inputs, and links.
