# Animated SVG GO

A free, public, browser-only tool. Drop in any SVG, animate its parts with sliders, toggles and pickers, export the result. Think SVGOMG (https://jakearchibald.github.io/svgomg/), but for motion.

Status: M0 scaffold built (empty editor page, tooling, CI). No product code yet. Research complete 13 Oct 2026. Full research write-up (private to Der): https://claude.ai/code/artifact/d6a21a86-3bb1-464a-b262-f396c3234298

Owner: Der (Dermot Dooley). Mac for development and testing.

## Read before you work

| Working on | Read first |
| --- | --- |
| Anything in `src/core/parse/` or security | `docs/ARCHITECTURE.md` sections 1, 2 and 6 |
| Spec, IR, effects, backends, exports | `docs/ARCHITECTURE.md` sections 3 to 5 |
| Picking the next task | `docs/ROADMAP.md`, then `docs/PLAN.md` for who owns it |
| Which model or subagent to use | `docs/MODELS.md` |

## Locked decisions

- **Audience:** public, free, no accounts. Desktop browsers only in v1: Chrome, Firefox and Safari on Mac. Mobile is not a target and is not tested. Local-first: every byte stays in the browser in v1. No server storage, no uploads.
- **v1 exports:** animated SVG with embedded CSS, inline SVG + CSS snippet, JS (WAAPI) snippet, GIF, MP4.
- **Not in v1:** path morphing (v1.1), Lottie export (deferred, likely never), sharing links (later, via Vercel Blob).
- **Stack:** Astro 7, one Svelte 5 editor island (`client:only="svelte"`), Tailwind 4, daisyUI 5, Vercel static hosting, GitHub Actions.
- **No GSAP.** Its Standard licence prohibits visual no-code animation builders that compete with Webflow. That is this product. Don't add it, don't copy its plugins, don't suggest it.
- **No runtime animation library is load-bearing.** Preview uses native WAAPI. Exports are CSS (and SMIL in v1.1). anime.js may be used as a utility later for morph resampling only.

## Invariants (never break these)

1. **Untrusted markup never enters the app DOM.** Uploaded SVG is rendered only inside an `<iframe sandbox="allow-same-origin">` with no `allow-scripts`, plus a deny-all CSP meta. The parent drives it via `contentDocument`.
2. **Nothing unsanitised is rendered, inserted or rewritten.** Before sanitising, only three things touch the file: the size, element and depth caps, the label harvest (plain strings) and the SVGO style-inlining string pass. DOMPurify with the hooks in `docs/ARCHITECTURE.md`. Uploaded SMIL is stripped.
3. **Move the wrapper, paint the element, write to neither's attributes.** The rewrite pass wraps each animatable element in `<g data-anim>`. `transform` and `opacity` target that wrapper. `fill`, `stroke` and dash properties target the element itself through CSS or WAAPI, because its own presentation attributes beat anything inherited from the wrapper. Authored attributes are never written to.
4. **Bake pivots into keyframes.** Emit `translate(ox,oy) <op> translate(-ox,-oy)` with identical function lists in every keyframe. Do not use `transform-origin` or `transform-box` on SVG.
5. **The spec is the only state.** The DOM, WAAPI animations and exports are all derived. Undo/redo works on the spec.
6. **Everything downstream reads the IR, never the spec.** `compile(spec, inventory) -> IR`, then backends.
7. **Preview must equal export.** If an effect can't be expressed as CSS keyframes, it is not a v1 effect.
8. **Easing is limited to** `cubic-bezier()`, `steps()` and `linear()`. Springs export as sampled `linear()` stops. This keeps the raster sampler exact.
9. **Every SVG, CSS and JS export handles `prefers-reduced-motion`.** GIF and MP4 can't.
10. **Never rely on authored IDs.** Stable keys are `data-k` stamped by the rewrite pass. Authored IDs are namespaced with a per-document prefix.

## Repository layout (target)

Built so far: `src/pages/`, `src/editor/App.svelte`, `tests/e2e/`. The rest arrives with its first file.

```
src/
  pages/                    Astro pages (landing, editor, about)
  editor/                   Svelte 5 island: App.svelte, panels/, controls/
  core/                     Framework-free TypeScript. Unit tested. No DOM globals at import time.
    parse/                  sanitise.ts, optimise.ts, rewrite.ts, inventory.ts
    spec/                   schema.ts (Zod), effects/<effect>.ts (schema + compile per effect)
    ir/                     types.ts, compile.ts, evaluate.ts (sampler maths)
    backends/               waapi.ts, css.ts, snippet.ts, sampler.ts
    export/                 gif.ts, video.ts
  workers/                  pipeline.worker.ts (SVGO passes only. Parse, sanitise and rewrite need a DOM, so they run on the main thread)
tests/
  unit/                     Vitest
  e2e/                      Playwright: chromium, firefox, webkit projects
  corpus/                   Real-world SVGs + golden PNGs for pixel diffs
  security/                 XSS payload fixtures
docs/                       ARCHITECTURE.md, ROADMAP.md, MODELS.md
.claude/agents/             Project subagents (see docs/MODELS.md)
```

## Commands

```
pnpm dev            Astro dev server
pnpm build          Production build
pnpm test           Vitest unit tests
pnpm test:e2e       Playwright, all three engines
pnpm corpus         (stub until M1) Run the pipeline over tests/corpus and pixel-diff against goldens
pnpm parity         (stub until M4) Compare WAAPI preview, CSS-in-<img> export and sampler frames
pnpm lint           ESLint + svelte-check + tsc --noEmit
```

## How to work in this repo

- **Plan first** for any milestone or anything touching `core/parse`, `core/ir` or security. Use plan mode and wait for approval.
- **Verify before you say done.** Run `pnpm lint` and `pnpm test`. For anything visual, run `pnpm corpus` and the WebKit e2e project. Say what you ran and what passed.
- **Playwright WebKit is not Safari.** If a change affects rendering, performance or export, list what Der should check in real Safari on his Mac.
- **Dependencies:** the approved list is in `docs/ARCHITECTURE.md` section 7. Ask before adding anything else, and say why.
- **Small, reviewable commits.** One concern per commit. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- **Keep docs true.** If you change an architectural decision, update `docs/ARCHITECTURE.md` in the same PR and add a dated line to its decision log.

## Writing style for UI copy and docs

British English (-ise spellings). Short, punchy sentences. No em dashes. No stock AI phrases.

## Known traps

One-line summaries. Detail, bug numbers and the unverified list live in `docs/ARCHITECTURE.md` section 6. Add new traps there first.

- Safari (up to 27.1) has no CSS `d` property. Path morphs need SMIL. Not a v1 problem; don't try to "fix" it with CSS.
- `getBBox()` excludes stroke width. Pad pivots and raster crops by half the stroke.
- The root `<svg>` clips overflow. Motion that leaves the viewBox gets cut. Offer viewBox padding, not `overflow: visible`.
- SVG loaded as an image can't fetch external fonts. Raster export must embed fonts or warn.
- Shared gradients: editing one element's gradient edits every element using it. Clone on first edit.
- `pnpm test:e2e` builds the site and serves it on port 4399, so the CSP is live. The dev server does not apply the CSP.
- Astro 7 puts `astro dev` and `astro preview` in the background when an AI agent runs them. Pass `--ignore-lock` for a foreground server, and stop any server you start.
- Playwright Firefox can't launch inside the Claude Code command sandbox. Run Chromium and WebKit locally and let CI cover Firefox.
