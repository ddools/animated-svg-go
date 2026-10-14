# Roadmap

Milestones run in order. Each has a lead model (see `docs/MODELS.md`) and acceptance criteria. Task-by-task owners are in `docs/PLAN.md`. A milestone is done when every criterion is met and Der has checked the real-Safari items on his Mac.

The first three milestones retire the biggest technical risks. Don't skip ahead to UI polish.

## M0. Scaffold

Lead: Opus 5.5 (the main session built it directly)

- `git init`, GitHub repo.
- Astro 7 + `@astrojs/svelte` + Svelte 5 + Tailwind 4 + daisyUI 5. Static output.
- Vitest, Playwright with chromium, firefox and webkit projects, ESLint, svelte-check, `tsc --noEmit`.
- All `pnpm` scripts from `CLAUDE.md`, even if `corpus` and `parity` are stubs.
- GitHub Actions: lint, unit, e2e (all three engines) on every PR.
- Vercel project linked to the repo, preview deploys per PR.
- Strict CSP on the app page.
- Update `CLAUDE.md`: status line, repository layout and commands match what now exists.

Done when: CI is green on an empty editor page deployed to a Vercel preview.

## M1. Normalisation pipeline and corpus (risk 1)

Lead: Opus 5.5. Haiku 5.5 subagent for corpus collection and triage. Security-reviewer subagent before merge.

- `core/parse/`: size cap, SVGO pass (style inlining, non-SVG elements removed), sanitise with label harvest, tree caps, rewrite (viewBox, units, ID namespacing, `data-k`, wrappers).
- `tests/corpus/`: 50+ real files with permissive licences. Mix: Illustrator, Figma, Inkscape, Sketch, icon sets, auto-traced logos, CAD exports, files with `<use>`, gradients, masks, clips, filters, nested `<svg>`, embedded rasters, text.
- `pnpm corpus`: render original and normalised versions in Chromium and WebKit, pixel-diff with pixelmatch, write a report of failures. Failures need an entry in `tests/corpus/known-failures.json`.
- `tests/security/`: public SVG XSS payload collections. Assert nothing executes, nothing fetches externally.

Done when: 95%+ of the corpus renders identically before and after, every failure is explained, and the security suite passes in all three engines.

## M2. Sandbox render and inventory

Lead: Opus 5.5 (the main session). `security-reviewer` on the sandbox. Delivered as two PRs: A is sandbox, inventory and loading; B is the tree, picking, selection and size panel.

- Sandbox iframe with deny-all CSP, filled by DOM import. Parent-side bridge to `contentDocument`.
- Inventory per element: structure up front, bbox, length and paint on demand.
- UI: drop zone, file picker, paste-from-clipboard. Layer tree with harvested names. Canvas hover and click picking. Select by colour, by type, siblings, lasso.
- Size and warnings panel, SVGOMG-style.

Done when: a 5 MB corpus file loads in under 2 s on a recent Mac and stays interactive in Chrome, Firefox and Safari.

Measured: the largest corpus file (3.8 MB) loads in 1.7 s in Chromium and 1.15 s in WebKit, headless. Selection tools on it take under 0.4 s.

## M3. Spec, IR and WAAPI preview (risk 2)

Lead: Opus 5.5 designs spec, IR, Spin and Draw (one wrapper effect, one element effect). Sonnet 5.5 implements Fade from that pattern.

- Zod spec, Immer undo/redo, IndexedDB autosave.
- `compile -> IR -> waapi.ts`. Playhead, play/pause, scrub, loop.
- Effects: Spin (with pivot handle), Fade, Draw.
- Schema-driven control panel generated from each effect's `ui` description.

Done when: rotating an element that carries nested authored transforms looks correct in Chrome, Firefox and Mac Safari, and slider drags hold 60 fps in all three for a 200-element file.

## M4. CSS export, snippets and parity (risk 3)

Lead: Opus 5.5

- `css.ts`, `snippet.ts`, copy and download UI.
- `sampler.ts` with exact cubic-bezier, steps and `linear()` evaluation.
- `pnpm parity`: for fixed times, compare WAAPI preview, CSS export rendered in `<img>`, and sampler output. Threshold-based pixel diff.
- Reduced-motion handling in every SVG, CSS and JS export.
- Sanitiser export profile (allows the generated `<style>`), reviewed by the security-reviewer subagent.

Done when: parity passes for all v1 effects in Chromium and WebKit, and an exported SVG dropped into a plain HTML page in Mac Safari matches the editor.

## M5. Effects catalogue and controls polish

Lead: Sonnet 5.5, one effect per subagent run. Haiku 5.5 for copy, docs and fixtures.

- Remaining effects: Pop, Float, Wiggle, Pulse, Slide in, Colour shift, Stagger reveal.
- Easing picker (presets, cubic-bezier editor, spring).
- Timeline bars per effect. Shuffle button with stored seed.
- Keyboard support across all controls. Editor autoplay respects reduced motion.

Done when: each effect has unit tests, a parity test, and a corpus smoke test.

## M6. GIF and MP4 export (risk 4)

Lead: Opus 5.5 for the frame loop and memory strategy. Sonnet 5.5 for encoder wiring and UI.

- Frame loop with yielding, font embedding, progress and cancel.
- MP4 via Mediabunny with capability detection. GIF via gifenc with size estimate.
- Resolution and fps presets. Caps measured in Chrome and Mac Safari.

Done when: a 5 s, 30 fps, 1080p MP4 exports in Chrome and Mac Safari without crashing, and GIF size estimates are within 25% of actual.

## M7. Hardening and launch

Lead: Opus 5.5. Fable 5.1 optional for a final cross-cutting architecture review (see `docs/MODELS.md` for the caution on security work).

- Security review of every path from upload to export. Re-run the payload suite.
- Performance caps enforced with friendly messages.
- Accessibility pass (WCAG 2.2 AA on the editor).
- Landing page, about page, privacy note ("your files never leave your browser").

Done when: Der signs off on a pass through Chrome, Firefox and Safari on his Mac.

## Later

| Item | Lead | Notes |
| --- | --- | --- |
| v1.1 path morph + SMIL backend | Fable 5.1 for the subpath-matching algorithm, Opus 5.5 to integrate | Pair subpaths by area, collapse extras to centroids. anime.js `morphTo` as a baseline to beat |
| v1.1 motion path | Opus 5.5 | SMIL `<animateMotion>` |
| Share links | Opus 5.5 | Vercel Blob, separate origin, server re-sanitise (ARCHITECTURE section 2, layer 3) |
| Re-upload rebinding | Sonnet 5.5 | Needs the `data-k` geometry fingerprint (rounded bbox, path command count), which is not built yet |
| Mobile and touch support | Sonnet 5.5 | Not a v1 target. Needs iOS canvas and memory limits measured on a real device first |
| Lottie | Not planned | Revisit only with real demand, and only for a transform/opacity/trim-path subset |
