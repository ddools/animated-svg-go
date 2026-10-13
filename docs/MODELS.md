# Model routing

Default setup: run the main Claude Code session on **Opus 5.5** as lead. Delegate to subagents on cheaper models for mechanical and well-specified work. Escalate to **Fable 5.1** only for the few genuinely hard algorithm problems.

Model facts here were checked against the Claude Code subagent docs on 13 Oct 2026: https://code.claude.com/docs/en/sub-agents

## Who does what

| Model | Alias / ID | Role on this project | Use it for | Don't use it for |
| --- | --- | --- | --- | --- |
| Fable 5.1 | `fable` / `claude-fable-5-1` | Specialist for the hardest problems | v1.1 subpath matching for morphs, a stubborn cross-engine transform bug Opus can't crack, a one-off whole-architecture review | Routine work. Security bypass testing (see caution below) |
| Opus 5.5 | `opus` / `claude-opus-5-5` | Lead engineer and reviewer | Main session. Pipeline (`core/parse`), spec and IR design, sampler maths, sandbox and security code, parity harness, plan mode, code review of subagent output | Bulk edits, copy, fixture wrangling |
| Sonnet 5.5 | `sonnet` / `claude-sonnet-5-5` | Implementer | Scaffold, Svelte components, effects built from the established pattern, encoder wiring, tests for existing code, e2e specs | Designing new contracts, security-critical code without Opus review |
| Haiku 5.5 | `haiku` / `claude-haiku-5-5` | Fast helper | Corpus collection and triage, running test suites and summarising failures, fixture generation, lint fixes, docs and UI copy drafts, codebase lookups | Anything that needs judgement about architecture or security |

## Caution: Fable 5.1 and security work

Fable 5.1 is the Mythos-tier model with additional safety measures for cybersecurity. Sanitiser-bypass testing with XSS payload corpora may trip those measures. Do security review and payload testing on **Opus 5.5**. This is about fit, not trust: the payload tests are legitimate defensive work.

## Escalation rules

1. Start on the model in the milestone's "Lead" line (`docs/ROADMAP.md`).
2. If Sonnet fails the same task twice, or its output fails review, hand it to Opus with the failing diff and test output.
3. If Opus has made two full attempts at an algorithmic problem without passing its tests, try Fable 5.1 with a tight brief: the failing tests, the constraints in `CLAUDE.md`, and what was tried.
4. Never escalate for speed alone. Escalate for difficulty.

## Effort levels

The `effort` frontmatter field accepts `low`, `medium`, `high`, `xhigh` and `max` (availability depends on the model).

| Task | Suggested effort |
| --- | --- |
| Corpus triage, running tests, lint fixes | `low` |
| Implementing an effect from the pattern, UI components | `medium` |
| Pipeline, IR, sampler maths, security review | `high` |
| Morph subpath matching (Fable) | `xhigh` |

## How to set models

- **Main session:** `/model opus` in Claude Code, or `"model": "opus"` in `.claude/settings.json`.
- **Per subagent:** the `model` field in `.claude/agents/<name>.md` frontmatter. Accepts `sonnet`, `opus`, `haiku`, `fable`, a full ID such as `claude-opus-5-5`, or `inherit`.
- **Per call:** ask Claude to run a subagent on a specific model; that overrides the frontmatter.
- **Default for subagents without a model:** the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable, else the main session's model.
- **Built-in Explore** runs on the main session's model (on Opus if the main session is Fable). To make exploration cheaper, add a project subagent named `Explore` with `model: haiku`.
- **Check what's running:** `/tasks` shows each subagent's model and effort.

## Project subagents (in `.claude/agents/`)

| Subagent | Model | Effort | Tools | Job |
| --- | --- | --- | --- | --- |
| `corpus-runner` | haiku | low | Read, Grep, Glob, Bash | Run `pnpm corpus` and `pnpm parity`, report only failures with likely causes |
| `effect-builder` | sonnet | medium | all, worktree isolation | Implement one effect end to end from the existing pattern |
| `security-reviewer` | opus | high | Read, Grep, Glob, Bash | Review sanitiser, sandbox, export escaping. Run the payload suite. Read-only |
| `webkit-checker` | sonnet | medium | Read, Grep, Glob, Bash | Run the Playwright WebKit project, analyse visual diffs, list what needs a check in real Safari |

## Session patterns that work

- **Plan, then fan out.** Opus plans a milestone in plan mode. After approval, it hands well-specified slices to `effect-builder` runs in parallel worktrees, then reviews each diff.
- **Keep noisy output out of the main context.** Test runs, corpus reports and payload results go through `corpus-runner` or `webkit-checker`, which return summaries.
- **One concern per subagent.** A subagent that builds an effect doesn't also refactor the IR.
- **Review is not optional for `core/`.** Anything Sonnet or Haiku changes in `core/parse`, `core/ir` or the sandbox bridge gets an Opus review before merge, and `security-reviewer` if it touches sanitise or export escaping.
