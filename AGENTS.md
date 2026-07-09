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
- **CSS design tokens** live in `:root` (dark) and `[data-theme="light"]` in `styles.css`. Use only defined `var(--*)` tokens so theming works in both modes.
  Note: `--glass2` was historically referenced (~60x, e.g. ADOT sections) without being defined, silently falling back to transparent; it is now defined in both themes.
- Reuse the existing component kit (`.sec-header`, `.card`, `.eli5-card`, `.ctag`, `.two-col`, `.card-grid-4`, `.timeline`, `.devops-box`, `.takeaways`, `.code-block` with `.kw`/`.str`/`.cmt`/`.num` highlight spans) rather than inventing styles. Namespace any new JS/CSS per-feature (e.g. `otel*`, `adot*`).
