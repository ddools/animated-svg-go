# Architecture

Last updated: 13 Oct 2026. Versions were checked on that date. Re-check before pinning.

Core idea: don't make the animation engine cope with arbitrary SVG. Normalise every upload into a predictable shape, then animate only that shape.

```
Upload -> Sanitise -> Optimise -> Rewrite        (Web Worker)
                                    |
                              Sandbox render -> Inventory -> Controls -> Spec
                                                                         |
                                                                   Compile to IR
                                                                         |
                       WAAPI preview | CSS export | JS snippet | Frame sampler -> GIF / MP4
```

## 1. Normalisation pipeline

Two threads. SVGO is string in, string out, so it runs in `workers/pipeline.worker.ts`. DOMPurify needs a real DOM, so sanitise and rewrite run on the main thread, on the inert document DOMPurify returns. That document is never adopted into the app DOM.

Order matters: nothing but our own rewrite touches the markup after it is sanitised. Entry point: `normalise()` in `src/core/parse/index.ts`.

1. **Size cap.** Reject over 5 MB, measured on the string.
2. **Optimise.** Worker, `core/parse/optimise.ts`. SVGO 4 via `svgo/browser`, custom config, not `preset-default`. It does three jobs:
   - Rejects malformed XML. There is no separate well-formedness parse.
   - Enforces the element and depth caps early, off the main thread, so an oversized file is refused before the sanitiser has to walk it.
   - Removes every element that is not plain SVG (prefixed elements, or a non-SVG `xmlns`). Editor and test-suite metadata embeds XHTML, and under the sanitiser's HTML parser a `<p>` closes the `<svg>` and loses the drawing.
   - Inlines styles (`inlineStyles` with `onlyMatchedOnce: false`, then `convertStyleToAttrs`), so class-based fills survive the sanitiser dropping `<style>`.
   Nothing here may merge paths, collapse groups, rename IDs, round numbers or strip editor labels. The worker is terminated after 10 s.
3. **Sanitise.** Main thread. See section 2. Editor layer names (`inkscape:label`, `serif:id`, `sketch:name`) are read inside a sanitiser hook, as plain strings, just before those attributes are stripped.
4. **Tree caps.** Element count (20,000) and nesting depth (64) again, on the sanitised tree. Plus an expansion cap: at most 200,000 shapes once every `<use>` is followed, so a few hundred nested `<use>` cannot render billions.
5. **Rewrite.** Main thread, `core/parse/rewrite.ts`. The product's core. In order:
   - Remove authored `data-k`, `data-anim` and `data-for`. They are ours, and copies could spoof keys and wrappers.
   - Guarantee a `viewBox`. Derive from `width`/`height` if missing, converting `mm`, `pt`, `in`, `cm`, `pc` to user units. With no usable size, use `0 0 300 150` (what browsers assume) and warn `no-size`. Remove fixed `width`/`height` on the root.
   - Stamp `data-k` on every animatable element. Key = hash(tag + index chain from root), salted on collision. M2 adds a geometry fingerprint (rounded bbox, path command count) for rebinding after re-upload.
   - Read layer names into a `data-k -> name` map. Preference: editor label, `data-name`, child `<title>`, `aria-label`, `id`. They are data, never markup.
   - Namespace every ID with a prefix derived from a hash of the input (`a` plus 8 hex characters and a hyphen), so output is deterministic. Only the prefix is inserted; values are never re-tokenised. Rewrite every reference: `url(#…)` in attributes and inline styles, `href`, `xlink:href`, `aria-labelledby`, `aria-describedby`.
   - Wrap each animatable element in `<g data-anim data-for="<data-k>">`. Transform and opacity animations target these wrappers. Paint and dash animations target the element (section 3, IR rules). Direct children of `<switch>` are not wrapped: a wrapper would always pass the conditional test and change which branch renders.
   - Leave `<use>` instances intact. Expand to a real clone (with re-namespaced IDs) only when the user drills into one.
6. **Serialise** with `XMLSerializer`.

Measured at the caps on an M-series Mac (5 MB, 19,901 elements): Chromium 1.2 s optimise, 1.1 s sanitise, 0.5 s rewrite. WebKit 0.9 s, 0.8 s, 0.4 s. Sanitise and rewrite block the main thread. The caps stay as they are; M2's "loads in under 2 s" target needs this revisited.

7. **Render** into the sandbox iframe (section 2, layer 2).
8. **Inventory.** After layout, per wrapper: `getBBox()` (includes the child's authored transform, in the wrapper's space), `getTotalLength()` for stroke-capable shapes, type, fill/stroke presence, stroke width, closed path, filter applied, inside clip/mask/pattern/marker, `vector-effect`, node count. Flags: `heavyFilter`, `embeddedRaster`, `textNeedsFont`, `degenerate` (zero-size bbox), `preserveAspectRatioNone`.

Animatable types: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `image`, `use`, `g`. Exclude descendants of `defs`, `symbol`, `clipPath`, `mask`, `pattern`, `marker` from the default tree (show them in an advanced view).

## 2. Security

Three independent layers. One failing must not be enough for an exploit.

### Layer 1: DOMPurify with hooks

The code is `src/core/parse/sanitise.ts`. It is the source of truth; this section explains the rules. DOMPurify is pinned to an exact version (3.4.17).

- **Profile:** `svg` and `svgFilters`, HTML-parser mode, returning DOM.
- **Forbidden tags:** `foreignObject`, `script`, `style`, and all SMIL (`set`, `animate`, `animateMotion`, `animateTransform`, `animateColor`, `mpath`, `discard`).
- **`<use>` is allowed.** DOMPurify blocks it by default and real files need it. It is safe only because of the next rule.
- **`href` and `xlink:href`** must start with `#`. The one exception is a base64 raster `data:` URI (png, jpeg, gif, webp) on `<image>`. No SVG-in-SVG, nothing external, on any element.
- **Every other attribute** is dropped unless every `url(` in it is a complete, local reference: `url(#fragment)` with no whitespace, brackets, quotes or escapes inside the fragment. Unterminated, remote and oddly quoted forms all fail. It is also dropped if it names another CSS loader (`image-set`, `@import`, `expression`, `src(`, `image(`) or pairs a backslash with a bracket. The checks are linear in the length of the value.
- **Stray `xmlns`.** A non-SVG `xmlns` on any element is removed. Under the HTML parser it is a plain attribute, but WebKit serialises it as written and an XML parser would then move the subtree into that namespace.
- **Clobbering guard off, ids prefixed instead.** `SANITIZE_DOM: false`, because the guard deleted legitimate ids such as `blur` and `body`. The rewrite pass prefixes every id, so none can shadow a DOM property. `name` and `xml:id` are forbidden outright.
- **Uploaded `<style>` is dropped.** SVGO inlines what it can first. Whatever is left (media queries, keyframes, `@font-face`) goes, and the pipeline returns a `style-dropped` warning.

Tests: `tests/security/`. Each payload is normalised, checked structurally (as XML and again as HTML), then loaded with no sandbox and no CSP, inline in HTML and as a standalone SVG document. Links get a real click. Any dialog or network request fails. Control tests prove the trap fires on raw script, handler, `javascript:` link, image and CSS `url()` payloads.

Notes:
- Any change to `sanitise.ts` needs the security-reviewer subagent. It reviews again in M4 (export profile) and M7.
- Watch https://github.com/cure53/DOMPurify/security/advisories before bumping the pin (3.4.0 and 3.4.1 shipped security fixes in April 2026).

### Layer 2: inert sandbox

```html
<iframe sandbox="allow-same-origin" srcdoc="…"></iframe>
```

srcdoc content:

```html
<!doctype html>
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<style>html,body{margin:0;height:100%}svg{width:100%;height:100%}</style>
<!-- sanitised, rewritten SVG here -->
```

No `allow-scripts`, so nothing inside can run. The parent reaches in through `iframe.contentDocument` to call `element.animate()` and read geometry.

**Open for M2:** an `srcdoc` iframe inherits the parent page's CSP. The editor page's hash-based `style-src` would block the inline `<style>` and `style` attributes inside the sandbox. M2 must decide how the sandbox document gets inline styles (for example a blob URL or a dedicated static page with its own policy) and re-check invariant 1 against the choice.

### Layer 3: storage and sharing (not v1)

When sharing arrives: re-sanitise server-side with `isomorphic-dompurify`; serve stored SVGs from a separate origin with `Content-Type: image/svg+xml`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, and `Content-Disposition: attachment` for downloads.

### Always

- The app page itself gets a strict CSP (Astro 7 `security.csp`: hash-based `script-src` and `style-src` in a meta tag, plus `frame-ancestors` and `nosniff` as headers in `vercel.json`).
- Generated exports embed user-derived strings only via `JSON.stringify` or XML escaping. Run every export through the sanitiser as a final check, using an export profile: same hooks, but `style` is not forbidden, because the only `<style>` left is the one `css.ts` generated. The upload profile would strip the keyframes. The security-reviewer subagent must review the export profile in M4.

## 3. Spec and IR

### Spec (the only state)

```ts
type Spec = {
  version: 1;
  duration: number;            // seconds, global timeline length
  loop: boolean;
  reducedMotion: 'final-frame' | 'opacity-only' | 'none';
  effects: Effect[];
};

type Effect = {
  id: string;
  type: EffectType;            // 'fade' | 'spin' | 'draw' | 'pop' | 'float' | 'wiggle' | 'pulse' | 'slide' | 'colour' | 'stagger'
  targets: string[];           // data-k values
  params: Record<string, number | string | boolean>; // validated by the effect's own Zod schema
  timing: {
    start: number; duration: number; delay: number;
    easing: Easing; iterations: number | 'infinite';
    direction: 'normal' | 'reverse' | 'alternate';
  };
  pivot?: { fx: number; fy: number }; // fraction of bbox, default 0.5/0.5
  seed?: number;
};

type Easing =
  | { kind: 'cubic'; p: [number, number, number, number] }
  | { kind: 'steps'; n: number; pos: 'start' | 'end' }
  | { kind: 'spring'; stiffness: number; damping: number }; // compiled to linear() stops
```

Each effect lives in `core/spec/effects/<type>.ts` and exports `{ schema, defaults, ui, compile }`. `ui` describes controls (label, control type, min, max, step, unit) so the editor generates panels from data. `compile(effect, inventory) -> Track[]`.

### IR

```ts
type Track = {
  target: string;              // data-k. The property decides wrapper or element, see rules
  property: 'transform' | 'opacity' | 'stroke-dashoffset' | 'stroke-dasharray' | 'fill' | 'stroke';
  keyframes: { offset: number; value: string; easing?: string }[]; // CSS-ready strings
  timing: { delay: number; duration: number; iterations: number | 'infinite'; direction: string; fill: 'both' };
};
```

Rules:
- `transform` and `opacity` tracks apply to the wrapper (`[data-for="k"]`). `fill`, `stroke`, `stroke-dashoffset` and `stroke-dasharray` tracks apply to the element itself (`[data-k="k"]`). After style inlining the element carries its own presentation attributes, and those beat anything inherited from the wrapper. CSS and WAAPI override presentation attributes without writing to them.
- Paint and dash effects on a `g` target compile to one track per descendant shape, each with its own `getTotalLength()`.
- Every transform keyframe uses the same function list, so CSS interpolates function by function. Pivot is baked in: `translate(ox px, oy px) rotate(a) scale(s) translate(-ox px, -oy px)`.
- Effects with many targets (stagger) share one keyframe set and vary only `delay`. The CSS backend emits one `@keyframes` plus per-element `--i` custom properties.

### Backends

- `waapi.ts`: `wrapper.animate(keyframes, timing)` inside the sandbox. Scrub by pausing all and setting `currentTime`. Timing-only changes via `effect.updateTiming()`; keyframe changes via `effect.setKeyframes()`, throttled to one per animation frame while a slider drags. Full rebuild on `pointerup`.
- `css.ts`: `<style>` block inside the SVG with `@keyframes`, per-wrapper rules, and the reduced-motion media query.
- `snippet.ts`: inline SVG + CSS, or inline SVG + a tiny WAAPI script with JSON keyframes and a `matchMedia('(prefers-reduced-motion: reduce)')` check.
- `sampler.ts`: `evaluate(ir, t)` returns static values per wrapper. Used by raster export and the parity test.

## 4. Effects catalogue (v1)

| Effect | Properties | Key params | Notes |
| --- | --- | --- | --- |
| Fade | opacity | from, to | |
| Spin | transform | degrees, turns | Pivot handle |
| Draw | stroke-dashoffset/dasharray | from %, to % | Measure `getTotalLength()`. Fill-only shapes get "outline then fill" variant. Warn on authored dashes |
| Pop | transform | scale, overshoot | Spring easing |
| Float | transform | distance x/y | Alternate direction |
| Wiggle | transform | angle, frequency | Seeded noise baked to keyframes |
| Pulse | transform, opacity | scale, frequency | Cap at 3 Hz (WCAG 2.3.1) |
| Slide in | transform, opacity | direction, distance | |
| Colour shift | fill / stroke | colours (default: colours in file) | Clone shared gradients first |
| Stagger reveal | wraps another effect | order (start, end, centre, random, by x, by y), gap | Order by position uses inventory bboxes |

Each effect carries an `exports` badge: all v1 effects must be `css`. Morph and motion path (v1.1) will be `smil`.

## 5. Export

| Format | v1 | Implementation | Gotchas |
| --- | --- | --- | --- |
| Animated SVG (CSS) | Yes | `css.ts` | Works inline and in `<img>` |
| Inline SVG + CSS snippet | Yes | `snippet.ts` | User must keep namespaced IDs and classes |
| JS snippet (WAAPI) | Yes | `snippet.ts` | Inline SVG only. Optional pause button (WCAG 2.2.2) |
| MP4 | Yes | Sampler -> canvas -> Mediabunny (MPL-2.0) on WebCodecs | Safari 26+ only. Feature-detect `VideoEncoder` + `isConfigSupported()`. H.264 default. Fall back to GIF |
| GIF | Yes | Sampler -> canvas -> gifenc | 256 colours, banding, 1-bit alpha, big files. Show estimated size |
| SMIL (morph, motion path) | v1.1 | `smil.ts` | |
| Lottie | No | | No filters, limited masks, no CSS. A second renderer's worth of work |

### Raster frame loop

For each frame t: `evaluate(ir, t)` -> apply to a detached clone -> `XMLSerializer` -> Blob URL -> `new Image()` -> `await img.decode()` -> `ctx.drawImage`. Yield between frames (`scheduler.yield()` or `setTimeout(0)`) so the UI stays responsive. Assume SVG decoding needs the main thread on Safari.

Fonts: SVG-as-image can't fetch fonts. Embed used fonts as `data:` `@font-face`, or warn that text will fall back.

## 6. Platform notes

- **Safari:** no CSS `d` up to 27.1 (WebKit cites performance). Long bug history around SVG `transform-origin` (WebKit 194903, 201854), which invariant 4 avoids. Complete WebCodecs only from 26.0.
- **Overflow:** root `<svg>` clips. Offer "add padding" that expands the viewBox.
- **Strokes:** `getBBox()` excludes stroke width. Pad by half `stroke-width`.
- **Accessibility:** reduced-motion fallback in every SVG, CSS and JS export (GIF and MP4 can't have one); keep `<title>`; add `role="img"` and `aria-label`; layer tree is the keyboard alternative to canvas picking; editor autoplay pauses under reduced motion.
- **Targets:** desktop Chrome, Firefox and Safari on Mac. Mobile is not a v1 target. If it becomes one, measure iOS Low Power Mode rAF throttling (~30 fps) and the iOS canvas area cap (~16.7 MP) on a real device first. Both figures are unverified.
- **Unverified, measure in each browser:** `prefers-reduced-motion` inside SVG-as-image in every engine, Safari `linear()` support since 17.2.

## 7. Approved dependencies

| Package | Purpose | Licence |
| --- | --- | --- |
| astro (7.x), @astrojs/svelte (9.x), svelte (5.x) | Shell and editor island | MIT |
| tailwindcss (4.x), @tailwindcss/vite, daisyui (5.x) | UI | MIT |
| dompurify (3.4.x) | Sanitiser | MPL-2.0 / Apache-2.0 |
| svgo (4.x) | Optimiser | MIT |
| zod | Spec validation | MIT |
| immer | Undo/redo patches | MIT |
| idb-keyval | Local project storage | Apache-2.0 |
| mediabunny | MP4 via WebCodecs | MPL-2.0 |
| gifenc | GIF encoding | MIT |
| @tweakpane/plugin-essentials (optional) | Cubic-bezier editor | MIT |
| vitest, @playwright/test, pixelmatch, pngjs, @types/pngjs, @types/node | Testing | MIT / Apache-2.0 / ISC |
| typescript (6.x), eslint, @eslint/js, typescript-eslint, eslint-plugin-svelte, svelte-check | Lint and type checks | Apache-2.0 / MIT |
| animejs (4.x), v1.1 only | Morph resampling utility | MIT |

Forbidden: gsap (licence), lottie-web as an engine, theatre.js (inactive).

## 8. Decision log

- 2026-10-13: Public free tool, local-first, no accounts.
- 2026-10-13: v1 exports are CSS SVG, snippets, GIF, MP4. Lottie deferred.
- 2026-10-13: Morph deferred to v1.1.
- 2026-10-13: Svelte 5 for the editor island.
- 2026-10-13: No GSAP, on licence grounds.
- 2026-10-13: `<style>` forbidden after sanitise; styles inlined by SVGO first.
- 2026-10-13: Parse, sanitise and rewrite run on the main thread (no `DOMParser` in workers). Only SVGO runs in the worker. Chosen over adding a DOM shim dependency.
- 2026-10-13: Transform and opacity animate the wrapper; paint and dash properties animate the element, since its presentation attributes beat inheritance.
- 2026-10-13: Exports are checked with a separate sanitiser profile that allows our generated `<style>`.
- 2026-10-13: Reduced-motion handling applies to SVG, CSS and JS exports only.
- 2026-10-13: Desktop only in v1 (Chrome, Firefox, Safari on Mac). Mobile is not a target. Real-device iPhone gates removed.
- 2026-10-13: Pipeline order is size cap, SVGO, sanitise, tree caps, rewrite. One SVGO pass before the sanitiser, not two around it, so nothing third-party touches sanitised markup.
- 2026-10-13: Editor labels are read in a sanitiser hook into a WeakMap, not by a pre-pass keyed on structural position.
- 2026-10-13: Sanitiser runs in DOMPurify's default HTML-parser mode. SVGO strips non-SVG elements first so embedded XHTML cannot close the `<svg>`.
- 2026-10-13: `<use>` is allowed (DOMPurify blocks it by default), restricted to same-document `href`.
- 2026-10-13: DOMPurify's clobbering guard is off (`SANITIZE_DOM: false`) because it removed ids such as `blur`. Every id is prefixed instead, and `name` is forbidden.
- 2026-10-13: Security review of M1 (Opus subagent). No script execution found. Fixed: two `url()` forms that could reach the network, a quadratic regex on the main thread, no limit on `<use>` expansion, caps enforced only after sanitising, spoofable `data-k`/`data-anim`, leftover SMIL tags, `xml:id`, stray `xmlns`. ID prefix widened from 16 to 32 bits.
- 2026-10-13: Embedded SVG fonts are dropped. Only WebKit renders them.
- 2026-10-13: Astro 7, not 6. Astro 6 had no release after June 2026. TypeScript held at 6.x because Astro, Svelte and typescript-eslint tooling do not accept 7 yet.
