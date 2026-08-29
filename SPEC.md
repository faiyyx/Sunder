# Sunder Enterprise — Build Contract

Static site. **No build step, no framework, no bundler.** Plain HTML + CSS + ES modules,
served straight from the repo root (Netlify-friendly).

## Brand

| Token            | Value     | Notes                                   |
|------------------|-----------|-----------------------------------------|
| Charcoal (plate) | `#35383D` | logo plate + dark sections              |
| Ink (deepest)    | `#212327` | page background for dark surfaces       |
| Gold             | `#D8912C` | primary accent, from the logo           |
| Gold light       | `#F0A64F` | hover / sheen                           |
| Paper            | `#F6F4EF` | light section background                |
| White            | `#FFFFFF` | logo counterform                        |

Typeface direction: a high-contrast serif for display (headings/wordmark) and a
clean grotesque for UI. Load from Google Fonts with real fallback stacks.

## Files & ownership

```
index.html          page structure
css/tokens.css      design tokens (custom properties) — imported first
css/base.css        reset, typography, layout primitives, utilities
css/preloader.css   animated logo preloader
css/fabric.css      the cloth effect + swatch grid + detail panel
css/site.css        section-level styling
js/colors.js        PALETTE DATA — single source of truth (DONE, do not edit)
js/preloader.js     preloader controller
js/fabric.js        swatch rendering + interaction
js/main.js          nav, scroll reveal, misc
assets/logo.svg     full logo, charcoal plate (DONE, do not edit)
assets/logo-mark.svg  same geometry, transparent background (DONE, do not edit)
```

## Palette rules (hard requirements)

* The site offers **exactly the 21 shades in `js/colors.js`** — no colour picker,
  no arbitrary hex input, no generated ramps. This is a *limited stocked range*.
* Never hard-code a swatch colour anywhere else. Import from `js/colors.js`.
* Each colour has `base` / `sheen` / `shade` — the cloth renderer must use all
  three so the pile reads as real velvet, not a flat rectangle.
* `ink: 'light' | 'dark'` decides label colour on top of a swatch.

## The cloth effect (the centrepiece)

Swatches must look like **cut velvet**, not CSS colour chips:

1. **Woven grain** — fine fibre texture (SVG `feTurbulence` displacement or a
   tiled noise mask). Must be subtle at rest, ~3–6% contrast.
2. **Directional pile / nap** — velvet changes shade with viewing angle. A
   diagonal sheen gradient from `sheen` → `base` → `shade` sells this.
3. **Live sheen** — the highlight tracks the pointer across the swatch, so the
   nap appears to shift under the light. Fall back to a slow ambient drift on
   touch/no-pointer.
4. **Selvedge / cut edge** — a soft inner shadow so the swatch reads as a piece
   of cloth with thickness, not a flat tile.
5. Everything must degrade gracefully: with `prefers-reduced-motion: reduce` the
   sheen is static; with no JS the swatches still render as coloured cloth.

## Preloader (hard requirement)

* Full-bleed charcoal curtain, logo centred.
* The logo is animated **without being redrawn or restyled** — the paths in
  `assets/logo-mark.svg` are inlined verbatim and only *revealed* (clip/mask
  wipes, opacity, transform). Do not change any `d` attribute, fill, or the
  viewBox. The finished frame must be pixel-identical to the static logo.
* Suggested beats: orange S parts wipe in along their own diagonal → white mark
  wipes in → a gold sheen sweeps across the plate → wordmark
  `SUNDER` / `ENTERPRISE` rises → curtain lifts.
* Total ≤ 2.6s, and it must never block: if `window.load` fires early it may
  finish early, and a hard 4s failsafe always dismisses it.
* `prefers-reduced-motion: reduce` → static logo, ~400ms fade, no sweeps.
* Runs once per tab (`sessionStorage`), short re-entry after that.
* Must set `inert`/`aria-hidden` correctly and return focus to the document.

## Accessibility

* Keyboard: every swatch is a real focusable control with a visible focus ring.
* Swatch grid is a listbox-style widget; arrow keys move between swatches.
* Colour is never the only signal — every swatch shows its name.
* Contrast: all body text ≥ 4.5:1, large text ≥ 3:1.
* Respect `prefers-reduced-motion` everywhere.

## Conventions

* CSS custom properties for everything themable; BEM-ish class names
  (`.swatch`, `.swatch__label`, `.swatch--active`).
* ES modules with explicit `.js` extensions in import paths.
* No dependencies. No inline `<style>`/`<script>` blocks except the tiny
  preloader boot script.
* Comment density: light. Explain *why*, not *what*.
