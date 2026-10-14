# Delivery plan

Who does what, in what order. Scope and acceptance criteria live in `docs/ROADMAP.md`. Model routing rules live in `docs/MODELS.md`. This file only adds the delegation.

## The team

| Owner | What they are | Takes |
| --- | --- | --- |
| **Der** | The human | Accounts, approvals, real-Safari checks on his Mac, sign-off |
| **Opus** | Opus 5.5, main session | Planning, contracts, `core/parse`, `core/ir`, security code, all review |
| **Sonnet** | Sonnet 5.5, main session or subagent | Scaffold, Svelte UI, tests, encoder wiring |
| **Haiku** | Haiku 5.5 subagent | Fixtures, corpus collection, copy drafts, lint fixes |
| `effect-builder` | Sonnet subagent, own worktree | One effect per run, from the pattern |
| `corpus-runner` | Haiku subagent | Runs `pnpm corpus` and `pnpm parity`, reports failures only |
| `webkit-checker` | Sonnet subagent | Runs WebKit e2e, lists what needs a check in real Safari |
| `security-reviewer` | Opus subagent, read-only | Sanitiser, sandbox, export escaping, payload suite |
| **Fable** | Fable 5.1 | Optional. One architecture review in M7. Never security testing |

## The loop every stage follows

1. **Opus** plans the stage in plan mode. **Der** approves.
2. The owners below build it. One concern per commit.
3. The builder runs `pnpm lint` and `pnpm test`. `corpus-runner` and `webkit-checker` run the heavy suites.
4. **Opus** reviews every diff that Sonnet or Haiku wrote in `core/` or the sandbox bridge.
5. `security-reviewer` runs where the table says so.
6. **Der** does the real-Safari checks and merges.

A stage is not done until step 6. The tables below list only what is specific to each stage.

## Stage 0. Scaffold (M0)

Done. Merged in PR #1.

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | Create the GitHub repo and the Vercel project. Link them | Der | | ✓ |
| 2 | `git init`, Astro 7, Svelte, Tailwind, daisyUI, static output | Opus | | ✓ |
| 3 | Vitest, Playwright (three engines), ESLint, svelte-check, `tsc` | Opus | | ✓ |
| 4 | All `pnpm` scripts. `corpus` and `parity` as stubs | Opus | | ✓ |
| 5 | GitHub Actions: lint, unit, e2e on every PR | Opus | | ✓ |
| 6 | Strict CSP on the app page | Opus | | ✓ |
| 7 | Bring `CLAUDE.md` status, layout and commands up to date | Opus | | ✓ |
| 8 | Open the Vercel preview in Chrome, Firefox and Safari | Der | Sign-off | ✓ |

## Stage 1. Normalisation pipeline and corpus (M1, risk 1)

Done. Merged in PRs #2 and #3.

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | Collect 50+ SVGs across the tool mix. Record each licence | Haiku | Der approves the licence list | ✓ |
| 2 | Write XSS payloads by attack class into `tests/security/` | Opus | | ✓ |
| 3 | Size cap, SVGO pass and its worker | Opus | | ✓ |
| 4 | Sanitiser config, hooks and label harvest | Opus | `security-reviewer` | ✓ |
| 5 | Rewrite: viewBox, units, ID namespacing, `data-k`, wrappers | Opus | | ✓ |
| 6 | `pnpm corpus` harness: render before and after, pixel-diff, report | Opus | | ✓ |
| 7 | Run the corpus. Fix or explain each failure | Opus, `corpus-runner` confirms | 95%+ identical | ✓ |
| 8 | Security suite in all three engines | `security-reviewer`, CI for Firefox | Must pass before merge | ✓ |
| 9 | Time the pipeline on a file at the caps, Chromium and WebKit | Opus | Numbers in ARCHITECTURE section 1 | ✓ |

Der's real-Safari timing check moved to Stage 2, when there is a drop zone to use.

## Stage 2. Sandbox render and inventory (M2)

Two PRs to `main`. A merges before B starts.

Done. A merged in PR #4, B in PR #6, plus a boot fix in PR #5.

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| A1 | Sandbox iframe filled by DOM import, its CSP, the parent bridge | Opus | `security-reviewer` | ✓ |
| A2 | Inventory: structure up front, geometry on demand | Opus | | ✓ |
| A3 | Drop zone, file picker, paste, error messages | Opus | | ✓ |
| A4 | Load-time test on the largest corpus file | Opus | Under 2 s | ✓ |
| A5 | Drop the 3.8 MB world map in all three browsers. Check each stays responsive. Note how long real Safari takes | Der | Sign-off, merge A | ✓ |
| B1 | Layer tree with keyboard navigation | Opus | | ✓ |
| B2 | Hover and click picking, shift-click, lasso | Opus | | ✓ |
| B3 | Select same type, fill, stroke, siblings, parent | Opus | | ✓ |
| B4 | Size and warnings panel | Opus | | ✓ |
| B5 | UI copy | Opus | Der reads it | ✓ |
| B6 | WebKit e2e run | `webkit-checker` | | ✓ |
| B7 | Hover, click, lasso and use the tree by keyboard in all three browsers | Der | Sign-off, merge B | ✓ |

## Stage 3. Spec, IR and preview (M3, risk 2)

Done. Merged in PR #7.

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | Zod spec, IR types, `compile` | Opus | Der approves the contracts in plan mode | ✓ |
| 2 | `waapi.ts`: wrapper tracks and element tracks, scrub, throttled updates | Opus | | ✓ |
| 3 | Spin with pivot handle. The pattern for transform effects | Opus | | ✓ |
| 4 | Draw. The pattern for paint and dash effects on the element | Opus | | ✓ |
| 5 | Fade, from the pattern | `effect-builder` (Sonnet) | Opus reviews | ✓ |
| 6 | Snapshot undo/redo, IndexedDB autosave | Opus (moved from Sonnet: built on the new contracts) | | ✓ |
| 7 | Playhead, play/pause, scrub, loop UI | Opus (moved from Sonnet) | | ✓ |
| 8 | Schema-driven control panel from each effect's `ui` | Opus (moved from Sonnet) | | ✓ |
| 9 | WebKit e2e run on nested-transform fixtures | `webkit-checker` | | Partly. Opus ran the WebKit suite (all pass); `webkit-checker` was not run |
| 10 | Nested-transform rotation and slider frame rate in all three browsers | Der | Sign-off | ✓ |

## Stage 4. CSS export, snippets and parity (M4, risk 3)

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | `css.ts` and `snippet.ts`, with reduced-motion handling | Opus | |  |
| 2 | `sampler.ts`: exact cubic-bezier, steps and `linear()` | Opus | |  |
| 3 | Sanitiser export profile | Opus | `security-reviewer` |  |
| 4 | `pnpm parity` harness: preview, CSS in `<img>`, sampler | Opus | |  |
| 5 | Copy and download UI | Sonnet | |  |
| 6 | Run parity in Chromium and WebKit. Report failures | `corpus-runner`, `webkit-checker` | All v1 effects pass |  |
| 7 | Drop an exported SVG into a plain page in Safari. Compare to the editor | Der | Sign-off |  |

## Stage 5. Effects catalogue and controls (M5)

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | Pop, Float, Wiggle, Pulse, Slide in. One run each, in parallel worktrees | `effect-builder` | Opus reviews each diff |  |
| 2 | Colour shift, including gradient cloning on first edit | Opus | |  |
| 3 | Stagger reveal. Shared keyframes, per-element delay | Opus | |  |
| 4 | Easing picker: presets, cubic-bezier editor, spring to `linear()` | Sonnet | Opus reviews the spring sampler |  |
| 5 | Timeline bars, shuffle with stored seed | Sonnet | |  |
| 6 | Keyboard support. Autoplay respects reduced motion | Sonnet | |  |
| 7 | Fixtures, effect copy, docs | Haiku | |  |
| 8 | Parity and corpus smoke test per effect | `corpus-runner` | |  |
| 9 | Try every effect in all three browsers | Der | Sign-off |  |

## Stage 6. GIF and MP4 export (M6, risk 4)

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | Frame loop: yielding, memory strategy, cancel | Opus | |  |
| 2 | Font embedding or fallback warning | Opus | |  |
| 3 | MP4 through Mediabunny with capability detection | Sonnet | Opus reviews |  |
| 4 | GIF through gifenc with a size estimate | Sonnet | Opus reviews |  |
| 5 | Resolution and fps presets, progress UI | Sonnet | |  |
| 6 | Measure canvas and memory limits in Chrome and Safari | Der | Opus sets the caps from the numbers |  |
| 7 | Export a 5 s, 30 fps, 1080p MP4 in Chrome and Safari | Der | Sign-off |  |

## Stage 7. Hardening and launch (M7)

| # | Action | Owner | Gate | Done |
| --- | --- | --- | --- | --- |
| 1 | Full security review, upload to export. Re-run payloads | `security-reviewer` | Must pass |  |
| 2 | Fix what the review finds | Opus | |  |
| 3 | Performance caps with friendly messages | Sonnet | |  |
| 4 | Accessibility pass, WCAG 2.2 AA | Sonnet | Opus reviews |  |
| 5 | Landing, about and privacy pages | Sonnet builds, Haiku drafts copy | Der edits the copy |  |
| 6 | Optional whole-architecture review | Fable | Der decides whether to run it |  |
| 7 | Full pass in Chrome, Firefox and Safari | Der | Launch sign-off |  |

## What only Der can do

- Create and link the GitHub and Vercel accounts.
- Approve every plan, every new dependency and the corpus licences.
- Every real-Safari check on his Mac. Playwright WebKit is not Safari.
- Merge to main, and the launch decision.

## When a stage goes wrong

Follow the escalation rules in `docs/MODELS.md`. Sonnet fails twice, hand it to Opus. Opus fails twice on an algorithm, brief Fable. Anything that needs a decision outside the locked list in `CLAUDE.md` goes to Der before work continues.
