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
   - Inlines styles (`inlineStyles` with `onlyMatchedOnce: false`, then `convertStyleToAttrs`), then removes any `<style>` element that is left and reports it. Class-based fills survive; media queries, keyframes and `@font-face` do not.
   Nothing here may merge paths, collapse groups, rename IDs, round numbers or strip editor labels. The worker is terminated after 10 s.
3. **Sanitise.** Main thread. See section 2. Editor layer names (`inkscape:label`, `serif:id`, `sketch:name`) are read inside a sanitiser hook, as plain strings, just before those attributes are stripped.
4. **Tree caps.** Element count (20,000) and nesting depth (64) again, on the sanitised tree. Plus an expansion cap: at most 200,000 shapes once every `<use>` is followed, so a few hundred nested `<use>` cannot render billions.
5. **Rewrite.** Main thread, `core/parse/rewrite.ts`. The product's core. In order:
   - Remove authored `data-k`, `data-anim`, `data-for` and `data-asg`. They are ours, and copies could spoof keys, wrappers and export scopes.
   - Remove `style`, `class`, `overflow`, `transform`, `transform-origin` and `filter` from the root. On the root they act on the host page's box, not the drawing: pasted inline, a file could cover the page (M4 security review). SVGO has already moved presentation styles and classes to attributes, so those cost nothing. A root `transform` or `filter` does change how a file looks, but SVG 1.1 ignored root transforms and tools rarely write either. A deny-list for now; an allow-list would hold up better as browsers map more SVG 2 attributes to CSS.
   - Guarantee a `viewBox`. Derive from `width`/`height` if missing, converting `mm`, `pt`, `in`, `cm`, `pc` to user units. With no usable size, use `0 0 300 150` (what browsers assume) and warn `no-size`. Remove fixed `width`/`height` on the root.
   - Stamp `data-k` on every animatable element. Key = hash(tag + index chain from root), salted on collision. M2 adds a geometry fingerprint (rounded bbox, path command count) for rebinding after re-upload.
   - Read layer names into a `data-k -> name` map. Preference: editor label, `data-name`, child `<title>`, `aria-label`, `id`. They are data, never markup.
   - Namespace every ID with a prefix derived from a hash of the input (`a` plus 8 hex characters and a hyphen), so output is deterministic. Only the prefix is inserted; values are never re-tokenised. Rewrite every reference: `url(#…)` in attributes and inline styles, `href`, `xlink:href`, `aria-labelledby`, `aria-describedby`.
   - Wrap each animatable element in `<g data-anim data-for="<data-k>">`. Transform and opacity animations target these wrappers. Paint and dash animations target the element (section 3, IR rules). Direct children of `<switch>` are not wrapped: a wrapper would always pass the conditional test and change which branch renders.
   - Leave `<use>` instances intact. Expand to a real clone (with re-namespaced IDs) only when the user drills into one.
6. **Serialise** with `XMLSerializer`.

Measured at the caps on an M-series Mac (5 MB, 19,901 elements): Chromium 1.2 s optimise, 1.1 s sanitise, 0.5 s rewrite. WebKit 0.9 s, 0.8 s, 0.4 s. Sanitise and rewrite block the main thread. The caps stay as they are; M2's "loads in under 2 s" target needs this revisited.

7. **Render** into the sandbox iframe (section 2, layer 2). Wait for the iframe's `load` event first: Firefox replaces a new iframe's first document when it finishes loading.
8. **Inventory.** `core/parse/inventory.ts`, built from the live tree in the sandbox.
   - Up front, per `data-k` element: type, label, parent, children, `referenced` (inside `defs`, `symbol`, `clipPath`, `mask`, `pattern`, `marker`), `hasFilter`. This is cheap.
   - Up front also `wrapped`: whether the element has a `data-anim` wrapper.
   - On first use, cached: `getBBox()` of the wrapper (so it includes the element's authored transform) padded by half the stroke width, dash length for shapes (`pathLength` if set, else `getTotalLength()`), computed fill, stroke and stroke width, `dashed` (has its own `stroke-dasharray`), `degenerate`. Measuring 20,000 elements up front would cost more than the pipeline.
   - Still to add when an effect needs them: closed path, `vector-effect`, heavy filter, `preserveAspectRatio="none"`, text that needs a font.

On top of the inventory, the editor's selection tools (same type, same fill, same stroke, siblings, parent) and the lasso work on visible nodes only. On the world map below they take 60 to 350 ms.

Measured on the largest real corpus file (3.8 MB world map, 5,444 elements), from choosing the file to seeing it: 1.7 s in Chromium, 1.15 s in WebKit, headless on an M-series Mac with nothing else running.

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
- **Uploaded `<style>` is dropped.** SVGO inlines what it can and removes the rest in the worker, returning a `style-dropped` warning. The sanitiser still forbids `style` as a backstop.

Tests: `tests/security/`. Each payload is normalised, checked structurally (as XML and again as HTML), then loaded with no sandbox and no CSP, inline in HTML and as a standalone SVG document. Links get a real click. Any dialog or network request fails. Control tests prove the trap fires on raw script, handler, `javascript:` link, image and CSS `url()` payloads.

Notes:
- Any change to `sanitise.ts` needs the security-reviewer subagent. It reviewed the export path in M4 and reviews again in M7.
- Watch https://github.com/cure53/DOMPurify/security/advisories before bumping the pin (3.4.0 and 3.4.1 shipped security fixes in April 2026).

### Layer 2: inert sandbox

The code is `src/editor/sandbox.ts`. It must hold even if layer 1 fails, and is tested that way: `tests/e2e/editor.spec.ts` mounts raw hostile markup, skipping the sanitiser. A control on a page with no CSP proves the `sandbox` attribute itself is what stops script: the same payload fires without it and stays silent with it.

```html
<iframe sandbox="allow-same-origin"></iframe>
```

- **No `src`, no `srcdoc`.** The iframe keeps its initial `about:blank` document, which is same-origin with the editor and inherits the page CSP.
- **Rendered by DOM import.** `mount()` parses the normalised string as XML into an inert document, then `importNode`s it into the iframe. The markup is never parsed as HTML at this sink, so there is no re-parse for a mutation attack to exploit, and it never enters the app document.
- **SVG only.** `mount()` removes any element outside the SVG namespace before the import, and turns `<a>` into a plain `<g>`. An XHTML `<iframe>`, `<form>` or `<img>` would otherwise be live in the sandbox, and a link could swap the drawing for an error page.
- **No `allow-scripts`**, so nothing inside can run. No `allow-top-navigation`, `allow-popups` or `allow-forms` either. The iframe is also `inert`, so keyboard focus cannot reach inside.
- **The page's `default-src 'none'` with no `frame-src` is load-bearing.** It is what stops the frame navigating itself to a real page. Do not add `frame-src`.
- **Its own CSP `<meta>`**, added with DOM calls before the drawing is imported: `default-src 'none'; style-src-attr 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'`. Independent of the inherited page policy.
- **The editor reaches in, nothing reaches out.** The parent reads geometry and calls `element.animate()` through `contentDocument`. Pointer input is taken by an overlay in the parent, which asks `elementFromPoint()` what is underneath. No listener is attached inside the sandboxed document.

Why not `srcdoc`: it would inherit the page CSP just the same, and it parses the markup as HTML a second time.

### Layer 3: storage and sharing (not v1)

When sharing arrives: re-sanitise server-side with `isomorphic-dompurify`; serve stored SVGs from a separate origin with `Content-Type: image/svg+xml`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, and `Content-Disposition: attachment` for downloads.

### Always

- The app page has a strict CSP (Astro 7 `security.csp`): `default-src 'none'`, hash-based `script-src` and `style-src` in a meta tag, plus `frame-ancestors` and `nosniff` as headers in `vercel.json`. One deliberate allowance: `style-src-attr 'unsafe-inline'`. Chromium reports a violation the moment it parses any style attribute, even in an inert `DOMParser` or DOMPurify document, and uploaded SVGs carry them. `<style>` elements and stylesheets are still restricted.
- Values read back from the sandbox (labels, computed fill and stroke) are data. In the app, put them in the DOM as text or through the CSSOM, never by building a `style="…"` or HTML string.
- Generated exports embed user-derived strings only via `JSON.stringify` (with `<` escaped) or XML escaping. `css.ts` refuses any key that is not `k` plus hex, and any value or easing outside a small character set or with a CSS function other than `translate`, `rotate`, `scale`, `cubic-bezier` and `steps`. It refuses rather than escapes: every value is generated, but the spec behind it comes from storage.
- Every SVG export goes through `sanitise()` as a final check, with the same rules as uploads, so no `<style>` survives it. Our own style is checked as text by `exportStyleIsSafe()` (no `<`, `>` or `&`, and the same `url()` and CSS-loader check as attributes), then added after the root's start tag as a string. It is never parsed into a DOM on the main thread, because Chromium reports a CSP violation for any `<style>` it parses there, inert document or not. A malformed file, an unexpected root or an unsafe style refuses the export.
- Tests: every payload that normalises is exported, with a spin and a draw if it has anything to animate, checked structurally and detonated as SVG and as the JS snippet. A separate test proves the check refuses remote, `@import`, escaped, entity and breakout styles and malformed files, and strips an authored `<style>`.

## 3. Spec and IR

### Spec (the only state)

The code is `src/core/spec/schema.ts` (Zod, types inferred). It is the source of truth; this is the shape.

```ts
type Spec = {
  version: 1;
  duration: number;            // seconds, the timeline, 0.1 to 60
  loop: boolean;               // the whole timeline repeats
  effects: Effect[];
};

type Effect = {
  id: string;
  type: EffectType;            // 'spin' | 'fade' | 'draw' in M3. Discriminated union: params are typed per effect
  targets: string[];           // data-k values
  params: SpinParams | FadeParams | DrawParams;
  timing: {
    start: number;             // seconds from the start of the timeline
    duration: number;          // seconds per run
    easing: Easing;
    iterations: number | 'infinite';   // whole runs. 'infinite' repeats until the timeline ends
    direction: 'normal' | 'reverse' | 'alternate';
  };
  pivot?: { fx: number; fy: number }; // fraction of each target's bbox, default 0.5/0.5. Effects with a pivot only
  stagger?: {                  // each target starts `gap` seconds after the one before
    gap: number;
    order: 'start' | 'end' | 'centre' | 'random' | 'x' | 'y';  // document order, or by position, or shuffled
    seed: number;              // for 'random'. Shuffle stores a new one
  };
};

type Easing =
  | { kind: 'cubic'; p: [number, number, number, number] }
  | { kind: 'steps'; n: number; pos: 'start' | 'end' }
  | { kind: 'spring'; bounce: number };  // 0 to 0.9. Compiled to linear() stops
```

Arriving later, with a default so saved specs stay valid: `reducedMotion` (when there is a second behaviour to choose; exports stop all motion until then).

Each effect lives in `core/spec/effects/<type>.ts` and exports a params schema (with defaults) and a module `{ type, label, params, ui, pivot, timing?, minDuration?, compile }`. `ui` describes controls (a range with min, max, step and unit; a select; or a colour) so the editor generates panels from data. `pivot` says whether it rotates or scales about a point. `timing` is what a new effect starts with (Float alternates). `minDuration` is the shortest run the schema accepts, for effects that would flash (WCAG 2.3.1). `compile(effect, inventory)` describes **one run** per target, offsets 0 to 1. Timing is the shared compiler's job, never the effect's.

### IR

The code is `src/core/ir/types.ts` and `compile.ts`.

```ts
type IR = {
  duration: number;            // seconds. Every track runs exactly this long
  iterations: 1 | 'infinite';  // from spec.loop
  tracks: Track[];
  notes: Note[];               // what the editor should tell the user, per effect
};

type Track = {
  target: string;              // data-k. The property decides wrapper or element, see rules
  property: 'transform' | 'opacity' | 'stroke-dashoffset' | 'stroke-dasharray' | 'fill' | 'stroke';  // paint as rgb()
  keyframes: { offset: number; value: string; easing: string }[]; // CSS-ready. Easing runs to the next keyframe
};
```

Rules:
- **Every track spans the whole timeline.** `compile` places each effect's runs at `start + i × duration`, holds the first value from 0 and the last to the end, and puts easing on keyframes. Backends play every track with the same timing: the timeline's duration, 1 or infinite iterations, linear, `fill: both`. CSS can't loop a sequence (draw, then fade, then again) any other way, and one shared clock makes scrub, export and the sampler agree by construction.
- **Whole runs only.** Runs that don't fit before the end are dropped. One run that doesn't fit is shortened to fit. Both get a note. Cutting a run part-way would need easing maths in compile and can't cut `steps()` exactly.
- **Reversed runs mirror their easing**, as CSS `reverse` and `alternate` do: `cubic-bezier(x1,y1,x2,y2)` becomes `(1-x2,1-y2,1-x1,1-y1)`; `steps(n,start)` becomes `steps(n,end)`.
- **Two keyframes at one offset are a jump.** WAAPI takes that as written. CSS merges duplicate percentages, so `css.ts` pulls the earlier one back 0.001% (or pushes the later one forward at 0%). At the exact instant CSS then shows the later value, as WAAPI and the sampler do.
- **Effects on the same target and property merge**, holding the last value between them: fade in, then fade out later, is one track. Where two overlap in time, the later effect in the list wins and the other is dropped for that target, with a note.
- **Transforms stack instead** (`ADDITIVE_PROPERTIES`). Each effect keeps its own transform track, and a target's tracks compose in list order: WAAPI `composite: 'add'`, CSS `animation-composition` (written only where two stack, so a lone transform exports as before), and the sampler joins the values into one list. The wrapper is ours with no authored transform, so there is nothing underneath. Two spins in sequence now add up (90°, then −90°, ends where it began). Checked in SVG-as-image in Chromium and WebKit before building on it.
- **Stagger** gives each target its own start, `start + i × gap` in the chosen order, and `compile` plans and compiles each target on its own. Runs stay whole, so the loop seam needs no negative delay. The cost: with "until the end", later targets fit fewer runs and hold sooner. Position orders use each target's box in its parent's space, exact for siblings and approximate across transformed groups.
- **Springs** compile to `linear()` stops: a damped spring, damping ratio `1 − bounce`, stiff enough that the wobble is under 0.01% by the end of the run, sampled at 12 or more stops per wobble and at least 30 per run, ending exactly at (1, 1). A reversed run mirrors each stop to `(1 − x, 1 − y)`. Bounce 0.4 takes 24 stops; 0.9 takes 133.
- `transform` and `opacity` tracks apply to the wrapper (`[data-for="k"]`). The rest apply to the element itself (`[data-k="k"]`). After style inlining the element carries its own presentation attributes, and those beat anything inherited from the wrapper. CSS and WAAPI override presentation attributes without writing to them. An element with no wrapper (a `<switch>` child) can't take wrapper tracks; `compile` drops them with a note.
- Paint and dash effects on a `g` target compile to one track per descendant shape, each with its own length.
- Every transform keyframe uses the same function list, so CSS interpolates function by function. Pivot is baked in: `translate(ox px, oy px) rotate(a deg) translate(-ox px, -oy px)`, from the wrapper's box.
- Values are rounded to three decimal places, so the same spec always gives the same strings.

### Backends

- `waapi.ts`: `element.animate()` inside the sandbox. One clock animation with no keyframes on the root `<svg>` is the time source, so play and scrub work with no effects. `apply(ir)` diffs tracks by target and property: `setKeyframes()` and `updateTiming()` for existing ones, `animate()` (synced to the clock) for new ones, `cancel()` for removed ones. The editor calls it at most once per animation frame, which is the slider throttle. Scrub pauses nothing; it sets `currentTime` on all.
- `css.ts`: one `@keyframes` per track, percentages to four decimals, easing per keyframe. Each wrapper or element gets one comma-listed `animation` with the timeline's duration, `linear`, 1 or `infinite`, `both`. The play rules sit inside `@media (prefers-reduced-motion: no-preference)`, so under reduced motion nothing plays and the drawing shows as authored. `exportMarkup()` puts the result in the file (section 5).
- **Scope.** Inline SVG styles are global to the page, and `data-k` is a hash of structure only, so two inlined drawings could match each other's rules. Every export stamps `data-asg="s<hash>"` on the root, and every selector (`[data-asg=S] [data-for=K]`) and keyframe name (`S-0`) carries it. The hash covers the normalised file and the IR, so two animations of one file never share names.
- `snippet.ts`: inline SVG + CSS, or inline SVG + a small WAAPI script with the tracks as JSON and a `matchMedia('(prefers-reduced-motion: reduce)')` check.
- `ir/evaluate.ts`: `evaluate(ir, t)` returns every track's value at t, the way browsers compute it. `cubic-bezier()` is solved by Newton then bisection, `steps()` follows CSS Easing 1, `linear()` follows CSS Easing 2 for the form compile writes (every stop has an input position), keyframe intervals are chosen as Web Animations chooses them, and value strings are interpolated number by number.
- `sampler.ts`: `frameCss(ir, t, scope)` writes those values as static `!important` rules on the export's selectors. Raster export (M6) and the parity test render frames from it.

### Editor state

- `editor/project.svelte.ts` holds the spec. Undo keeps whole spec snapshots (a spec is a few KB), capped at 100. A slider drag changes the spec on every `input` and becomes one undo step on `change`.
- Autosave keeps one IndexedDB slot: file name, the original file text, and the spec. Restore is offered with a button, never automatic, and runs the text back through the whole pipeline and the spec through the schema. Storage is not trusted, and the pipeline is deterministic, so `data-k` keys still match.
- Play state and the playhead are view state, outside the spec and outside undo.

Measured: compile plus `apply` for a 200-shape spin takes 1.5 ms in Chromium and 1.3 ms in WebKit, headless on an M-series Mac.

## 4. Effects catalogue (v1)

| Effect | Properties | Key params | Notes |
| --- | --- | --- | --- |
| Fade | opacity | from, to | |
| Spin | transform | degrees (one param: 720 is two turns) | Pivot handle |
| Draw | stroke-dashoffset/dasharray | from %, to % | Dash length from `pathLength` if set, else `getTotalLength()`. Gap is twice the length so no round cap shows at 0 %. Fill-only shapes get a note. The "outline then fill" variant needs `fill-opacity` and is not in v1. Notes authored dashes |
| Pop | transform | scale | Spring easing by default (bounce is the overshoot) |
| Float | transform | distance x/y | Alternate direction |
| Wiggle | transform | angle, frequency | Seeded noise baked to keyframes |
| Pulse | transform, opacity | scale, frequency | Cap at 3 Hz (WCAG 2.3.1) |
| Slide in | transform, opacity | direction, distance | |
| Colour shift | fill / stroke | colours (default: colours in file) | Solid colours only in v1. Gradient and pattern paint gets a note |
| Stagger | a setting on any effect | order (start, end, centre, random, by x, by y), gap | Not an effect type. A staggered Fade or Pop is the "reveal" |

Each effect carries an `exports` badge: all v1 effects must be `css`. Morph and motion path (v1.1) will be `smil`.

## 5. Export

| Format | v1 | Implementation | Gotchas |
| --- | --- | --- | --- |
| Animated SVG (CSS) | Yes | `css.ts` | Works inline and in `<img>` |
| Inline SVG + CSS snippet | Yes | `snippet.ts` | User must keep the `data-*` attributes and namespaced IDs. Downloads as `.html` |
| JS snippet (WAAPI) | Yes | `snippet.ts` | Inline SVG only. Downloads as `.html`. Pause button (WCAG 2.2.2) deferred to M7 |
| MP4 | Yes | Sampler -> canvas -> Mediabunny (MPL-2.0) on WebCodecs | Safari 26+ only. Feature-detect `VideoEncoder` + `isConfigSupported()`. H.264 default. Fall back to GIF |
| GIF | Yes | Sampler -> canvas -> gifenc | 256 colours, banding, 1-bit alpha, big files. Show estimated size |
| SMIL (morph, motion path) | v1.1 | `smil.ts` | |
| Lottie | No | | No filters, limited masks, no CSS. A second renderer's worth of work |

### SVG exports

`exportMarkup(svg, scope, style?)` in `css.ts`: XML-parse the normalised file, stamp `data-asg`, put `width` and `height` back from the viewBox (normalise removed them, and without them an `<img>` falls back to 300 × 150), serialise, run it through `sanitise()`, then check the style text and splice it in after the root's start tag (section 2). Exports keep every wrapper and `data-k`; stripping the unused ones is a size win for M7.

Exports are made on demand when the user copies or downloads, not on every edit: the export check re-sanitises the whole file.

### Parity

`pnpm parity` (`tests/parity/`, Chromium and WebKit, also in CI). For eight scenarios at four fixed times, it renders three frames in one 512 × 384 box and pixel-diffs them: the editor's WAAPI preview after a seek; the animated SVG export in `<img>`, frozen at t by an injected `animation-play-state: paused; animation-delay: -t`; and the sampler's static frame in `<img>`. Times avoid jumps, run ends and half turns. It also checks that `prefers-reduced-motion` reaches an SVG in `<img>`, with a control.

Measured in M4, headless on an M-series Mac: every scenario passes in both engines. The worst diff was 0.002% of pixels (Chromium, preview against CSS export). WebKit and the sampler matched to the pixel. Tolerance is 0.05%; a control test shows a frame 50 ms out fails it by more than ten times.

### Raster frame loop

For each frame t: the export with `frameCss(ir, t, scope)` as its style -> Blob URL -> `new Image()` -> `await img.decode()` -> `ctx.drawImage`. Yield between frames (`scheduler.yield()` or `setTimeout(0)`) so the UI stays responsive. Assume SVG decoding needs the main thread on Safari. Running the export check on every frame is too slow at the caps, so M6 needs a cheaper path for frames, which never leave the browser.

Fonts: SVG-as-image can't fetch fonts. Embed used fonts as `data:` `@font-face`, or warn that text will fall back.

## 6. Platform notes

- **Safari:** no CSS `d` up to 27.1 (WebKit cites performance). Long bug history around SVG `transform-origin` (WebKit 194903, 201854), which invariant 4 avoids. Complete WebCodecs only from 26.0.
- **Overflow:** root `<svg>` clips. Offer "add padding" that expands the viewBox.
- **Strokes:** `getBBox()` excludes stroke width. Pad by half `stroke-width`.
- **`pathLength`:** an authored `pathLength` rescales dash values. Draw uses it as the length instead of `getTotalLength()`, or the dash would be the wrong size.
- **Half turns:** a centrally symmetric shape turned 180° has the same box. Tests that check a spin by its bounding box must avoid half-turn times.
- **Unverified:** how `vector-effect: non-scaling-stroke` changes the units of dash values in each engine.
- **Accessibility:** reduced-motion fallback in every SVG, CSS and JS export (GIF and MP4 can't have one); keep `<title>`; add `role="img"` and `aria-label`; layer tree is the keyboard alternative to canvas picking; editor autoplay pauses under reduced motion.
- **Targets:** desktop Chrome, Firefox and Safari on Mac. Mobile is not a v1 target. If it becomes one, measure iOS Low Power Mode rAF throttling (~30 fps) and the iOS canvas area cap (~16.7 MP) on a real device first. Both figures are unverified.
- **Reduced motion in `<img>`:** measured in M4 under Playwright emulation, neither Chromium nor WebKit passes `prefers-reduced-motion` into an SVG shown as an image. It always matches `no-preference`, so an exported SVG in `<img>` keeps moving. Inline exports and the JS snippet do stop. Whether the real macOS setting reaches SVG-as-image is unverified: Der checks in Safari and Chrome. If it doesn't, the fix is on the host page (`<picture>` with a `prefers-reduced-motion` source), and the export panel could say so.
- **Unverified, measure in each browser:** Safari `linear()` support since 17.2.

## 7. Approved dependencies

| Package | Purpose | Licence |
| --- | --- | --- |
| astro (7.x), @astrojs/svelte (9.x), svelte (5.x) | Shell and editor island | MIT |
| tailwindcss (4.x), @tailwindcss/vite, daisyui (5.x) | UI | MIT |
| dompurify (3.4.x) | Sanitiser | MPL-2.0 / Apache-2.0 |
| svgo (4.x) | Optimiser | MIT |
| zod | Spec validation | MIT |
| immer | Undo/redo patches. Not used: undo keeps snapshots (decision log, 14 Oct) | MIT |
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
- 2026-10-13: Sandbox is an iframe with no `src` or `srcdoc`, filled by `importNode` from an XML parse. Settles the M0 question about `srcdoc` inheriting the page CSP.
- 2026-10-13: Page CSP allows `style-src-attr 'unsafe-inline'`. Chromium reports any parsed style attribute, inert document or not. Chosen over carrying styles out-of-band through the sanitiser path.
- 2026-10-13: Leftover `<style>` elements are removed in the SVGO worker pass, not left for the sanitiser.
- 2026-10-13: Inventory geometry is measured lazily. The `data-k` geometry fingerprint moves to "Later" with re-upload rebinding.
- 2026-10-13: Picking uses an overlay in the parent and `elementFromPoint()`, with no listeners inside the sandbox.
- 2026-10-13: Security review of M2 part A. Nothing critical or high. Fixed: sandbox tests could pass without the sandbox (now has a no-CSP control), `mount()` accepted non-SVG elements, the sandbox CSP was installed after the import and lacked `base-uri` and `form-action`, `measure()` could throw in Firefox. Links become groups in the sandbox.
- 2026-10-14: The layer tree renders only the rows in view (fixed row height, no dependency). Content inside `defs`, `clipPath`, `mask`, `pattern`, `marker` and `symbol` is left out of the tree and the canvas tools.
- 2026-10-14: M3 contracts approved. Every IR track spans the whole timeline, with runs unrolled into keyframes, so a sequence can loop in CSS and every backend shares one clock.
- 2026-10-14: Whole runs only. Runs past the end are dropped; a single run that doesn't fit is shortened. Reversed runs mirror their easing.
- 2026-10-14: Effects on the same target and property merge with holds between. Overlaps resolve to the later effect, with a note. Composition is deferred to M5.
- 2026-10-14: `timing.delay` removed; `start` places an effect. Spring easing, `seed` and `reducedMotion` arrive with the milestones that use them.
- 2026-10-14: No Immer. Undo keeps whole spec snapshots made with `structuredClone`. Immer stays approved if specs grow.
- 2026-10-14: Autosave stores the original file text, not normalised markup, and restore re-runs the pipeline. Offered, never automatic.
- 2026-10-14: Draw in M3 covers stroked shapes. Fill-only shapes wait for M5.
- 2026-10-14: M4 exports are scoped by `data-asg="s<hash>"` on the root, because inline SVG styles are global to the page.
- 2026-10-14: Reduced motion in exports stops all motion and shows the drawing as authored. No spec field until there is a second behaviour.
- 2026-10-14: Exports put `width` and `height` back from the viewBox.
- 2026-10-14: `linear()` in the sampler moves to M5, with the spring easing that is the only thing that emits it.
- 2026-10-14: Parity runs in CI, Chromium and WebKit.
- 2026-10-14: No export sanitiser profile. Exports go through the upload rules, and our `<style>` is checked as text and added after, because parsing it logs a CSP violation in Chromium. Supersedes the 2026-10-13 export profile decision.
- 2026-10-14: Security review of M4. Nothing critical or high. Fixed: root `style`, `class`, `overflow`, `transform`, `transform-origin` and `filter` let an inline paste cover the host page (medium, found across two passes); unchecked property and duration; authored `<style>` passed when no style was given; `data-asg` not reserved; the export test skipped the mXSS payloads.
- 2026-10-14: M5 contracts. Transforms stack, one track per effect, composed in list order; other properties still merge and resolve overlaps to the later effect. Supersedes the deferral above.
- 2026-10-14: Spring easing is one setting, `bounce`, sampled to `linear()` stops that settle within the run.
- 2026-10-14: Stagger is an optional setting on every effect, not an effect type. Each target is planned on its own, not phase-shifted with a negative delay.
- 2026-10-14: Colour shift animates solid fill and stroke only, as `rgb()`. Gradients are not cloned in v1, so `core/parse` is unchanged.
- 2026-10-14: Security review of the M5 contracts. Nothing critical, high or medium. Fixed: a stored spec could make compile build hundreds of megabytes (now duplicate targets are dropped, easings made once per effect, and effects past a 16 MB keyframe budget are left out with a note); the payload suite did not detonate the new output forms.
- 2026-10-13: Astro 7, not 6. Astro 6 had no release after June 2026. TypeScript held at 6.x because Astro, Svelte and typescript-eslint tooling do not accept 7 yet.
