# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Site structure & sharp edges

This is a single-page docs site: `index.html` + `styles.css` + `script.js`. No build step.

- **Assets are cache-busted with a `?v=N` query** in `index.html` (`styles.css?v=N`, `script.js?v=N`).
  When you change `styles.css` or `script.js`, you MUST bump this number or browsers (and GitHub Pages) serve stale cached assets. Missing this makes edits look like they "didn't apply."
- **Sections** are `<section id="..." class="section">` (older ones use `content-section`) appended inside `<main>`.
  Two IntersectionObservers in `script.js` auto-wire this for every `.section`/`.content-section` - no registration needed. Just add the section and a matching `.nav-link[data-section=...]`.
  - **Scroll-spy is height-independent by design - keep it that way.** Active-section detection uses a **trigger-band** observer (`threshold: 0`, `rootMargin: "-45% 0px -45% 0px"`), so whichever section crosses the thin band near the viewport middle is the active one regardless of section height. Do NOT revert to a visibility-ratio threshold (e.g. `threshold: 0.2`): OTel sections like Core Concepts / Traces, Metrics & Logs are 6-7x viewport height and can never reach a positive ratio, so a ratio threshold silently never marks them active (nav/breadcrumb/progress stall). `pickActiveSection()` picks exactly one (topmost if two straddle the band; scroll-position fallback at page top/bottom) via the shared `setActiveSection(id)` helper. Reveal + progress use a separate `threshold: 0` observer so tall sections still count toward progress and get `.visible`.
- **Nav groups** are collapsible `<li class="nav-group" id="...">` toggled by `toggleNavGroup(id)`.
- **Sticky top bar / breadcrumb** (`.topbar`, first child of `<main>`) shows `group / section` and hosts the theme toggle. The breadcrumb (`#tbGroup`/`#tbSection`) is updated by the shared `setActiveSection()` that drives scroll-spy - it mirrors the active nav-link's label and its `.nav-group` label. Sections carry `scroll-margin-top` so anchor jumps clear the bar; keep that if you touch section padding. The topbar is the one intentional use of `backdrop-filter` (frosted sticky header) - not glassmorphism-by-default.
- **CSS design tokens** live in `:root` (dark) and `[data-theme="light"]` at the top of `styles.css`. Both themes are first-class and fully defined; drive everything off `var(--*)` so a theme is a pure token swap. Never hardcode a text/background color that must survive a theme flip - use the ink ramp (`--txt`/`--txt2`/`--txt3`), surfaces (`--bg`/`--bg2`/`--bg3`/`--surface-1..3`), borders (`--border`/`--border-h`), brand (`--brand`, `--accent`, `--accent-ink`, `--accent2`), or semantic (`--blue`/`--green`/`--orange`/`--red`/`--cyan`). The semantic + section-brand tokens (`--helm`/`--argocd`/`--mcp`/`--adot`) are re-declared under `[data-theme="light"]` to darker shades so they pass contrast as text on light; keep that pattern for any new brand color.
  - Legacy `--glass*` names are now **solid surface aliases** (not translucent glass) - the design is restrained, not glassmorphic. No `backdrop-filter`, no `background-clip:text` gradient text, no `>1px` colored side-stripe borders (use full 1px borders + tint + a leading icon for callouts; neutral tree-guide left-borders are fine). Card radius stays 12-16px.
  - **`--code-well`** is the token for terminal/sim/code panels: a dark inset in dark mode, a light inset in light mode. Text inside inherits theme ink, so it stays legible in both. The macOS-style `.term-*` terminal is the exception - it stays dark in both themes and uses fixed (non-token) colors on purpose.
  - Motion uses `--ease` (ease-out) and there is a global `prefers-reduced-motion` block; section reveals are `animation ... both` so content is never gated on a JS class (never ships blank on hidden tabs/headless).
  - Responsive safety net near the code-block rules: code surfaces get `overflow-x:auto`/`min-width:0`, and grid/flex children get `min-width:0` so wide code in sim cards scrolls internally instead of forcing horizontal page overflow on mobile.
- Reuse the existing component kit (`.sec-header`, `.card`, `.eli5-card`, `.ctag`, `.two-col`, `.card-grid-4`, `.timeline`, `.devops-box`, `.takeaways`, `.callout` with `.callout-icon`, `.code-block`/`.cb-code` with `.kw`/`.str`/`.cmt`/`.num` highlight spans) rather than inventing styles. Namespace any new JS/CSS per-feature (e.g. `otel*`, `adot*`).
- **Native theme-aware diagrams** (no raster screenshots): build them with inline SVG or CSS grid and drive every color off tokens so they flip with the theme. Reusable patterns already exist in the OTel deep-dive sections: `.otel-seq*` (SVG sequence diagram - lifelines, activation bars, request/response arrows via `<marker>`, colors set inline as `fill:var(--blue)` etc.), `.otel-wf*` (Jaeger-style trace waterfall in CSS grid - bars positioned with inline `left`/`width` percentages, indented per depth), `.otel-cpipe`/`.ocp-*` (a horizontal box→box→box pipeline flow with a per-box `--ocp` color var and arrows that rotate to vertical on mobile - used for the Collector Receiver→Processor→Exporter and app→agent→gateway diagrams), `.otel-anat*` (a labeled field-by-field "anatomy" table), and `.otel-comp*` (mono component chips + explanation lists). Wrap any wide SVG in an `overflow-x:auto` scroller with a `min-width` so it scrolls internally on mobile instead of overflowing the page.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
