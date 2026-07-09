# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Site structure & sharp edges

This is a single-page docs site: `index.html` + `styles.css` + `script.js`. No build step.

- **Assets are cache-busted with a `?v=N` query** in `index.html` (`styles.css?v=N`, `script.js?v=N`).
  When you change `styles.css` or `script.js`, you MUST bump this number or browsers (and GitHub Pages) serve stale cached assets. Missing this makes edits look like they "didn't apply."
- **Sections** are `<section id="..." class="section">` (older ones use `content-section`) appended inside `<main>`.
  A single IntersectionObserver in `script.js` auto-wires nav highlighting + the progress bar for every `.section`/`.content-section` - no registration needed. Just add the section and a matching `.nav-link[data-section=...]`.
- **Nav groups** are collapsible `<li class="nav-group" id="...">` toggled by `toggleNavGroup(id)`.
- **CSS design tokens** live in `:root` (dark) and `[data-theme="light"]` at the top of `styles.css`. Both themes are first-class and fully defined; drive everything off `var(--*)` so a theme is a pure token swap. Never hardcode a text/background color that must survive a theme flip - use the ink ramp (`--txt`/`--txt2`/`--txt3`), surfaces (`--bg`/`--bg2`/`--bg3`/`--surface-1..3`), borders (`--border`/`--border-h`), brand (`--brand`, `--accent`, `--accent-ink`, `--accent2`), or semantic (`--blue`/`--green`/`--orange`/`--red`/`--cyan`). The semantic + section-brand tokens (`--helm`/`--argocd`/`--mcp`/`--adot`) are re-declared under `[data-theme="light"]` to darker shades so they pass contrast as text on light; keep that pattern for any new brand color.
  - Legacy `--glass*` names are now **solid surface aliases** (not translucent glass) - the design is restrained, not glassmorphic. No `backdrop-filter`, no `background-clip:text` gradient text, no `>1px` colored side-stripe borders (use full 1px borders + tint + a leading icon for callouts; neutral tree-guide left-borders are fine). Card radius stays 12-16px.
  - **`--code-well`** is the token for terminal/sim/code panels: a dark inset in dark mode, a light inset in light mode. Text inside inherits theme ink, so it stays legible in both. The macOS-style `.term-*` terminal is the exception - it stays dark in both themes and uses fixed (non-token) colors on purpose.
  - Motion uses `--ease` (ease-out) and there is a global `prefers-reduced-motion` block; section reveals are `animation ... both` so content is never gated on a JS class (never ships blank on hidden tabs/headless).
  - Responsive safety net near the code-block rules: code surfaces get `overflow-x:auto`/`min-width:0`, and grid/flex children get `min-width:0` so wide code in sim cards scrolls internally instead of forcing horizontal page overflow on mobile.
- Reuse the existing component kit (`.sec-header`, `.card`, `.eli5-card`, `.ctag`, `.two-col`, `.card-grid-4`, `.timeline`, `.devops-box`, `.takeaways`, `.callout` with `.callout-icon`, `.code-block`/`.cb-code` with `.kw`/`.str`/`.cmt`/`.num` highlight spans) rather than inventing styles. Namespace any new JS/CSS per-feature (e.g. `otel*`, `adot*`).
