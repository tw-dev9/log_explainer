# Integration Path

safe-log-explainer intentionally starts as a local, offline CLI that reads a
file and prints a Markdown "debug packet." This document describes the
intended path for extending it further, staged so each phase adds one
capability without changing the trust model of the phases before it.

The rule across all phases: **nothing sensitive leaves the machine unless a
later, explicit phase says so — and even then, only after redaction.**

## Phase 1: Local file input

Status: implemented ([cli.ts](../src/cli.ts)).

The tool reads a single log file from the local filesystem via a CLI
argument and writes output to stdout. No network access, no daemon, no
implicit file discovery. This is the trust boundary everything else is
built on: input is something the user explicitly pointed at.

A second input mode — reading from stdin (`cat app.log | safe-log-explainer`)
— is also implemented. It's still local, still explicit, and doesn't change
the trust model; it just adds a way to pipe input instead of naming a file
path.

## Phase 2: Configurable patterns

Status: implemented ([pattern-loader.ts](../src/pattern-loader.ts)).

Error-classification patterns (category, keywords, likely cause, next
checks) live in [patterns/default-patterns.json](../patterns/default-patterns.json);
`--patterns <file>` swaps in an alternative set.

Redaction rules have a built-in set in [sanitiser.ts](../src/sanitiser.ts)
(bearer tokens, JWTs, `key=value` secrets, AWS key IDs, emails, IPv4/IPv6,
`userId=`) and `--redaction-rules <file>` appends caller-supplied rules
(see [patterns/example-redaction-rules.json](../patterns/example-redaction-rules.json)).
Config is loaded locally only; no remote pattern fetching.

## Phase 3: Redaction

Status: implemented ([sanitiser.ts](../src/sanitiser.ts),
[explain.ts](../src/explain.ts)).

[sanitiser.ts](../src/sanitiser.ts) exposes two separate functions:
`detectSensitiveData` (surfaces matches as `Warning[]`) and
`redactSensitiveData` (replaces matched spans, e.g. `user@example.com` →
`[REDACTED:email]`). [explain.ts](../src/explain.ts) applies redaction to
evidence lines, extracted context values and the warning values themselves
before anything reaches a renderer. Redaction is on by default and can be
toggled off (`redact: false`, or the checkbox in the web UI) for
local-only use.

## Phase 4: Structured debug packet

Status: implemented ([types.ts](../src/types.ts),
[output.ts](../src/output.ts)).

The `DebugPacket` shape (`summary`, `category`, `likelyCause`,
`relevantLines`, `nextChecks`, `confidence`) is the stable contract between
parsing and presentation. This phase is really about keeping that contract
serializable and self-contained (already true) so it can be handed to a
renderer (Markdown today), a future AI summarizer (Phase 5), or an
external system (Phase 6) without re-parsing the log.

The JSON renderer alongside the Markdown one ([output.ts](../src/output.ts),
`--json` on the CLI) is the same `DebugPacket` consumed by a second output
format, not a new contract. JSON output is also what Phase 6 will want by
default, since MCP/adapter consumers are programs, not humans reading
Markdown.

**Update:** Exports now also embed a fixed instructions block (Markdown: an
"Instructions for AI assistants" section; JSON: a top-level `instructions`
field) that structures an external AI's response around five fixed questions
(investigation path, strongest clues, unknowns, what to check next, how to
explain it to another person), and evidence lines carry original line numbers
plus a small window of surrounding context (configurable, capped) instead of
a flat filtered list. This is still the same offline packet-contract shape —
no network access is added, no new phase is needed.

## Phase 5: Optional AI summary

Status: not yet implemented.

An opt-in step that sends the **redacted** `DebugPacket` (never raw log
content) **from inside this application** to an LLM to produce a plain-language
summary layered on top of `summary`/`likelyCause`. To be clear: this phase is
specifically about safe-log-explainer itself making a live API call. A human
copying or downloading the exported packet and pasting it into an AI assistant
of their own choosing is already possible today (Phase 4) and involves zero
network access from this tool.

Requirements for this phase:

- Off by default; requires an explicit flag/config (e.g. `--ai-summary`).
- Only ever receives output that has already passed through Phase 3
  redaction — the AI call is a consumer of the sanitised packet, not the
  raw file.
- Network access is isolated to this phase; Phases 1–4 remain fully
  offline regardless of whether this phase is enabled.

## Phase 6: Controlled MCP/database adapter

Status: not yet implemented.

An adapter that lets safe-log-explainer be invoked as an MCP tool, or that
lets it pull log data from a database/log store instead of a local file.
This is the highest-trust-boundary phase, so it's last:

- Reuses the exact same pipeline (parse → sanitise/redact → packet →
  output) as the CLI; the adapter only changes *where input comes from*
  and *how output is returned*, not what runs in between.
- Any credentials/connection config are scoped to this adapter layer and
  never implicitly inherited by Phases 1–5.
- Redaction (Phase 3) is mandatory and non-optional in this mode, since
  output may be consumed by another automated system rather than a human
  reviewing it directly.

## Cross-cutting: synthetic log scenario coverage

Not a phase — an orthogonal, ongoing track. The golden-output test
currently exercises one log shape (see [test/](../test)). As parsing
logic grows (new patterns in Phase 2, redaction in Phase 3, new categories
in [parser.ts](../src/parser.ts)), it needs a broader set of synthetic
log fixtures — timeouts, auth failures, crashes, multi-line stack traces,
mixed sensitive-data shapes — to guard against regressions. This work can
land alongside any phase above rather than blocking on one.
